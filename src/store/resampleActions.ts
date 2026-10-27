/**
 * Resample, in one move: what was chosen (a clip or clips, the loop range across the tracks, or the
 * whole mix) is printed to a new sound, with its effects, before the master section unless asked
 * to go through it, and that sound goes onto a new Audio track, a new Slicer track already chopped
 * (at its hits, or into 8 or 16 equal slices, with a pattern that plays them), or a new Fledge
 * Synth track as its user table. Each is one undo step, the new track included. The maths is in
 * resample.ts; the studio's Resample dialog and Pocket's section sheet use these.
 */
import { create } from 'zustand';
import { masterFxOf, songGeneration, songTempo, useTimelineStore } from './timelineStore';
import type { Clip, SlicerSettings, Track } from './timelineTypes';
import { uid } from './timelineTypes';
import { audibleTracks, channelsOf, encodeChannels, renderArrangement, SAMPLE_RATES, type RenderOptions, type SampleRate } from '../audio/exportWav';
import { decodeSound, importSoundFile } from '../audio/soundLibrary';
import { liveMix } from '../audio/engine';
import { barToSeconds, secondsToBar, tempoAt } from '../audio/tempoMap';
import { resliced, slicerFor } from '../audio/slicerTools';
import { sliceNotes } from '../audio/slicing';
import { PLAYBACK_DB } from './freezeActions';
import { printLevel, ROLE_PRESETS, resampleName, resampleSpan, slicePattern, type ResampleSource, type ResampleTarget, type SliceChoice, type SlicePattern, type WavetableRole } from './resample';
import { packUserTable, tableFromSound, USER_TABLE_INDEX, type CycleChoice, type UserTable } from '../audio/plugins/userTable';
import { FLEDGE_PRESETS, FLEDGE_URL } from '../audio/plugins/fledgeMacros';
import { findBuiltin } from '../audio/plugins/builtinHost';
import { fledgeValues } from '../audio/plugins/fledgeWave';

/** A resample under way: how far along (0 to 1). Null when none is. */
export const useResampling = create<{ fraction: number | null }>(() => ({ fraction: null }));

/** A resample may be up to this big (16-bit stereo: about 6 minutes at 44.1 kHz). */
const MAX_BYTES = 64 * 1024 * 1024;
/** Stored a little under full scale; the clip gain or track level puts the level back */
const STORED_PEAK = 0.89;
const SILENT = 10 ** (-90 / 20);

export interface ResampleRequest {
  source: ResampleSource;
  target: ResampleTarget;
  /** Through the master section too (its glue, OTT, width, limiter); default: before it */
  withMaster?: boolean;
  /** Let reverb and echo ring out past the end (default: exactly the bars, so it loops in time) */
  tail?: boolean;
  /** Mute the tracks it came from (not for the whole mix) */
  muteSource?: boolean;
  /** Slicer: how it's cut, the pattern its clip plays, the last slice backwards */
  slices?: SliceChoice;
  pattern?: SlicePattern;
  reverseLast?: boolean;
  /** Wavetable: how many cycles, how they're cut, and what it plays as */
  frames?: number;
  cycle?: CycleChoice;
  role?: WavetableRole;
}

export interface ResampleResult {
  message: string;
  trackId?: string;
}

/** A number from a text, for seeds: the same text, the same number. */
const hashOf = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A new track's own settings for a print: its sends off (the reverb and echo are in the sound). */
function printed(id: string, patch: Partial<Track> = {}): void {
  useTimelineStore.setState((st) => ({ tracks: st.tracks.map((t) => (t.id === id ? { ...t, reverbSend: 0, delaySend: 0, ...patch } : t)) }));
}

/**
 * Resample as `req` says. Playback stops first (a render swaps the global audio context while it
 * sets up). Resolves to what to tell the person (and the new track), rejects with a message.
 */
export async function resample(req: ResampleRequest): Promise<ResampleResult> {
  if (useResampling.getState().fraction !== null) return { message: 'A resample is already under way.' };
  const s = useTimelineStore.getState();
  const span = resampleSpan(req.source, s.clips);
  if (!span) return { message: req.source.kind === 'clips' ? 'Choose a clip to resample.' : 'Nothing plays there to resample: set the loop In and Out around some music (I and O).' };
  const from = Math.max(1, span.from);
  const to = span.to;
  // Only what's heard, of what was chosen
  const only = req.source.kind === 'range' ? req.source.trackIds : undefined;
  const tracks = only?.length ? s.tracks.map((t) => (only.includes(t.id) ? { ...t, isSoloed: true, isMuted: false } : { ...t, isSoloed: false })) : s.tracks;
  const heard = new Set(audibleTracks(tracks).map((t) => t.id));
  const clips = req.source.kind === 'clips' ? span.clips : s.clips;
  if (!span.clips.some((c) => heard.has(c.trackId))) return { message: 'What was chosen is muted: nothing to resample.' };
  const song = songGeneration();
  s.pause();
  useResampling.setState({ fraction: 0 });
  try {
    const rate = liveMix.bus.context.sampleRate;
    const sampleRate: SampleRate = (SAMPLE_RATES as readonly number[]).includes(rate) ? (rate as SampleRate) : 48000;
    const opts: RenderOptions = {
      tracks,
      clips,
      bpm: s.bpm,
      tempoPoints: s.tempoPoints,
      swing: s.swing,
      startBar: from,
      endBar: to,
      masterFx: masterFxOf(s),
      ...(req.withMaster ? { master: s.master } : { bypassMaster: true, peakCeilingDbtp: 60 }),
      ending: req.tail ? 'ringOut' : 'exact',
      sampleRate,
      intensity: { value: s.intensity, curves: s.intensityCurves },
    };
    const audio = await renderArrangement(opts, (f) => useResampling.setState({ fraction: Math.min(0.95, f) }));
    let channels = channelsOf(audio).map((ch) => ch.slice());
    let peak = 0;
    let end = 0;
    for (const ch of channels) for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (v > peak) peak = v;
      if (v > SILENT && i > end) end = i;
    }
    if (!(peak > SILENT * 10)) return { message: 'It is silent there: nothing to resample.' };
    if (req.tail) channels = channels.map((ch) => ch.slice(0, Math.min(ch.length, end + Math.round(0.05 * sampleRate))));
    const normalizeDb = 20 * Math.log10(peak / STORED_PEAK);
    const scale = STORED_PEAK / peak;
    const stored = channels.map((ch) => ch.map((v) => v * scale));
    const names = new Map(s.tracks.map((t) => [t.id, t.name]));
    const name = resampleName(req.source, s.clips, names);
    // (Checked after each wait: a song opened meanwhile gets nothing)
    const elsewhere = () => songGeneration() !== song;
    const ELSEWHERE: ResampleResult = { message: 'Another song was opened while it rendered: nothing was added.' };
    if (elsewhere()) return ELSEWHERE;
    // The level it plays back at: as loud as it was in the song
    const playDb = normalizeDb + PLAYBACK_DB;
    const seconds = stored[0].length / sampleRate;
    const tempo = songTempo(useTimelineStore.getState());
    const lengthBars = req.tail ? secondsToBar(barToSeconds(from, tempo) + seconds, tempo) - from : to - from;
    const sourceTracks = new Set(span.clips.map((c) => c.trackId));
    const mute = () => {
      if (!req.muteSource || (req.source.kind === 'range' && !only?.length)) return;
      useTimelineStore.setState((st) => ({ tracks: st.tracks.map((t) => (sourceTracks.has(t.id) && !t.isMuted ? { ...t, isMuted: true } : t)) }));
    };
    const short = name.replace(/ \(resampled\)$/, '').slice(0, 32);

    // A wavetable (its table is in the synth's settings: no sound file needed)
    if (req.target === 'wavetable') {
      const made = await userTableFrom(channels, sampleRate, name.replace(/ \(resampled\)$/, ''), req.frames ?? 16, req.cycle ?? 'pitch');
      if (elsewhere()) return ELSEWHERE;
      if (!made) return { message: 'Couldn’t make a table from that: it needs a held, steady sound at least a few cycles long.' };
      const id = await addWavetableTrack(made.table, req.role ?? 'lead', `${short} ${req.role ?? 'lead'}`, () => !elsewhere());
      if (elsewhere()) return ELSEWHERE;
      mute();
      return { message: `A Fledge Synth track, ${short} ${req.role ?? 'lead'}, plays it as a ${req.role ?? 'lead'} (${made.table.frames} cycles, cut at ${Math.round(made.hz)} Hz${made.found ? '' : ', no pitch found'}).`, trackId: id ?? undefined };
    }

    const meta = await importSoundFile(encodeChannels(stored, sampleRate, 16, []), `${name}.wav`, MAX_BYTES);
    if (elsewhere()) return ELSEWHERE;

    if (req.target === 'audio') {
      const st = useTimelineStore.getState();
      const id = st.addTrack('audio', `${short} print`);
      // (What the clip gain can't take down, the track's fader does: never louder than it was)
      const { gain, volume } = printLevel(playDb);
      printed(id, { volume });
      const clip: Clip = {
        id: uid('clip'),
        trackId: id,
        name: `${short} print`,
        startBar: from,
        lengthBars,
        notes: [],
        isSelected: true,
        audio: { soundId: meta.id, offset: 0, gain, fadeIn: 0, fadeOut: 0 },
      };
      useTimelineStore.setState((x) => ({ clips: [...x.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), clip] }));
      mute();
      return { message: `Printed to audio on a new track, ${short} print: chop, reverse or mangle it in its editor (double-click the clip).`, trackId: id };
    }

    // A Slicer (its hits found in the sound as the live context decodes it)
    await decodeSound(meta.id, rate);
    if (elsewhere()) return ELSEWHERE;
    const base = slicerFor(meta);
    const choice = req.slices ?? 'transients';
    let slicer: SlicerSettings = choice === 'transients' ? base : resliced({ ...base, mode: 'equal', count: choice });
    if (req.reverseLast && slicer.slices.length > 1) slicer = { ...slicer, reversed: [slicer.slices.length - 1] };
    const bpm = tempoAt(from, tempo);
    const pattern = req.pattern ?? 'order';
    const bars = Math.max(1 / 16, to - from);
    const notes =
      pattern === 'order' ? sliceNotes(slicer.slices, slicer.start, slicer.end, bpm) : slicePattern(pattern, slicer.slices.length, bars, bars, hashOf(meta.id));
    const st = useTimelineStore.getState();
    const id = st.addTrack('slicer', `${short} chops`);
    useTimelineStore.getState().setTrackSlicer(id, slicer, false);
    printed(id, { volume: Math.max(-60, Math.min(6, Math.round(playDb * 10) / 10)) });
    const clip: Clip = {
      id: uid('clip'),
      trackId: id,
      name: pattern === 'order' ? `${short} chops` : `${short} ${pattern}`,
      startBar: from,
      lengthBars: bars,
      notes: notes.map((n) => ({ ...n, id: uid('note') })),
      isSelected: true,
    };
    useTimelineStore.setState((x) => ({ clips: [...x.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), clip] }));
    mute();
    return { message: `${slicer.slices.length} slices on a new Slicer track (C3 up)${pattern === 'order' ? ', played in order' : `, in a ${pattern} pattern`}. Draw notes on its rows to rearrange them.`, trackId: id };
  } finally {
    useResampling.setState({ fraction: null });
  }
}

/** A user table from a sound's channels, packed for the synth's settings (null when it can't be made). */
export async function userTableFrom(channels: Float32Array[], sampleRate: number, name: string, frames: number, cycle: CycleChoice): Promise<{ table: UserTable; hz: number; found: boolean } | null> {
  const cut = tableFromSound(channels, sampleRate, { frames, cycle });
  if (!cut) return null;
  return { table: await packUserTable(cut.cycles, cut.frames, name), hz: cut.hz, found: cut.found };
}

/** A user table from a sound in the library ([from, to) seconds of it). */
export async function userTableFromSound(soundId: string, name: string, frames: number, cycle: CycleChoice, from?: number, to?: number): Promise<{ table: UserTable; hz: number; found: boolean } | null> {
  const buffer = await decodeSound(soundId, 44100);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const cut = tableFromSound(channels, 44100, { frames, cycle, from, to });
  if (!cut) return null;
  return { table: await packUserTable(cut.cycles, cut.frames, name), hz: cut.hz, found: cut.found };
}

/**
 * What a new wavetable synth sets over its preset: oscillator A on the user table (B off, so it's
 * the table you hear), and LFO 2 sweeping A's position through the table, from the top with each
 * note (over a bar; half a bar for a bass).
 */
export function wavetableSets(role: WavetableRole): Record<string, number> {
  return {
    'A table': USER_TABLE_INDEX,
    'A position': 0.5,
    'A unison': role === 'pad' ? 5 : role === 'lead' ? 3 : 1,
    'B on': 0,
    'LFO 2 shape': 1,
    'LFO 2 sync': 1,
    // ("1/2" or "1 bar")
    'LFO 2 rate (sync)': role === 'bass' ? 4 : 2,
    'LFO 2 mode': 1,
    'LFO 2 target 1': 3,
    'LFO 2 amount 1': 0.5,
  };
}

/**
 * A new Fledge Synth track playing `table` as a bass, lead or pad (one undo step). Its id, or null
 * (also when `still()` says, after working out its settings, that it's no longer wanted).
 */
export async function addWavetableTrack(table: UserTable, role: WavetableRole, name: string, still: () => boolean = () => true): Promise<string | null> {
  const ref = findBuiltin(FLEDGE_URL);
  if (!ref) return null;
  const program = Math.max(0, FLEDGE_PRESETS.indexOf(ROLE_PRESETS[role]));
  const values = await fledgeValues(ref.family, program, wavetableSets(role));
  if (!still()) return null;
  const state = { builtin: 1, program, ...(values ? { values } : {}), table };
  return useTimelineStore.getState().addPluginTrack(FLEDGE_URL, name.slice(0, 40), state);
}
