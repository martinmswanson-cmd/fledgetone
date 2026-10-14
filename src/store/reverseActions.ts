import { songTempo, splitClipAt, useTimelineStore } from './timelineStore';
import { isMixTrack } from './buses';
import { defaultMasterSettings, defaultTrackFx, uid } from './timelineTypes';
import type { Clip, Track } from './timelineTypes';
import { encodeChannels, renderArrangement } from '../audio/exportWav';
import { importSoundFile } from '../audio/soundLibrary';
import { barToSeconds, secondsToBar } from '../audio/tempoMap';

/**
 * Play a block of music backwards, as a tape turned round: everything sounding from one bar to
 * another (or one clip, through its track) is rendered to audio, reversed, and put back in its
 * place on a new Audio track, and what it was rendered from is taken out of that stretch. Notes
 * fade in and their reverb comes before them. One undo step brings the forward music back, and the
 * new clip's Reverse button (in its audio editor) plays it forwards again as audio.
 *
 * (The notes themselves mirrored in time, a composer's retrograde, are noteTools.ts's retrograde.)
 */

const SAMPLE_RATE = 44100;
/** Stored a little under full scale; the clip's gain sets the level back */
const STORED_PEAK = 0.89;
const SILENT = 1e-4;
const EPS = 1e-6;

/** Encode, normalized, as a sound in the library; its level correction in dB. */
async function store(channels: Float32Array[], name: string): Promise<{ id: string; gainDb: number }> {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
  const gainDb = Math.max(-20, Math.min(20, 20 * Math.log10(peak / STORED_PEAK)));
  const scale = 10 ** (-gainDb / 20);
  const scaled = channels.map((ch) => ch.map((v) => v * scale));
  const meta = await importSoundFile(new Blob([encodeChannels(scaled, SAMPLE_RATE, 24)], { type: 'audio/wav' }), name);
  return { id: meta.id, gainDb };
}

/**
 * Reverse bars `from` to `to`: every track's music there (`clipId`: only that clip's). Returns
 * a message for the person (what happened, or why it couldn't).
 */
export async function reverseBlock(from: number, to: number, clipId?: string): Promise<string> {
  const s = useTimelineStore.getState();
  if (to - from < 1 / 16) return 'Set the loop In and Out around the music to reverse (I and O).';
  const only = clipId ? s.clips.find((c) => c.id === clipId) : undefined;
  if (clipId && (!only || only.audio)) return 'Only a clip of notes can be reversed this way (an audio clip has its own Reverse, in its editor).';
  const inRange = (c: Clip) => c.startBar < to - EPS && c.startBar + c.lengthBars > from + EPS;
  const source = only ? [only] : s.clips.filter(inRange);
  if (!source.length) return 'There is no music between those bars to reverse.';
  s.pause();
  const tempo = songTempo(s);
  const buffer = await renderArrangement({
    tracks: s.tracks,
    clips: source,
    bpm: s.bpm,
    tempoPoints: s.tempoPoints,
    swing: s.swing,
    // The master section stays off: the reversed audio comes back through it
    masterFx: { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback },
    master: defaultMasterSettings(),
    startBar: from,
    endBar: to,
    ending: 'exact',
    sampleRate: SAMPLE_RATE,
  });
  const forward = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
  if (!forward.some((ch) => ch.some((v) => Math.abs(v) > SILENT))) return 'That stretch is silent: nothing to reverse.';
  const label = only ? only.name : `bars ${Math.round(from * 100) / 100}–${Math.round(to * 100) / 100}`;
  const fwd = await store(forward, `${label} (forwards).wav`);
  const back = await store(
    forward.map((ch) => ch.slice().reverse()),
    `${label} (reversed).wav`
  );

  // One undo step: the forward music out of the stretch, the reversed audio in
  const now = useTimelineStore.getState();
  now.checkpoint();
  const sourceTrack = only ? now.tracks.find((t) => t.id === only.trackId) : undefined;
  const track: Track = {
    id: uid('track'),
    name: only ? `${sourceTrack?.name ?? only.name} (reversed)` : `Reversed ${label}`,
    color: sourceTrack?.color ?? '#22d3ee',
    instrumentKey: 'audio',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    pan: 0,
    eq: { low: 0, mid: 0, high: 0 },
    reverbSend: 0,
    delaySend: 0,
    fx: defaultTrackFx(),
    ...(sourceTrack?.folder ? { folder: sourceTrack.folder } : {}),
  };
  const seconds = forward[0].length / SAMPLE_RATE;
  const lengthBars = secondsToBar(barToSeconds(from, tempo) + seconds, tempo) - from;
  const reversed: Clip = {
    id: uid('clip'),
    trackId: track.id,
    name: `${label} (reversed)`,
    startBar: from,
    lengthBars,
    notes: [],
    isSelected: true,
    audio: { soundId: back.id, reversedFrom: fwd.id, offset: 0, gain: back.gainDb, fadeIn: 0, fadeOut: 0 },
  };
  useTimelineStore.setState((st) => {
    const taken = new Set(source.map((c) => c.id));
    const mix = new Set(st.tracks.filter(isMixTrack).map((t) => t.id));
    const clips: Clip[] = [];
    for (const c of st.clips) {
      if (!taken.has(c.id) || mix.has(c.trackId)) {
        clips.push(c.isSelected ? { ...c, isSelected: false } : c);
        continue;
      }
      if (only) continue;
      // Keep what lies outside the stretch: split at its edges
      let rest: Clip | null = c;
      let before: Clip | null = null;
      if (rest.startBar < from - EPS) {
        const halves = splitClipAt(rest, from, tempo);
        if (halves) [before, rest] = halves;
      }
      let after: Clip | null = null;
      if (rest && rest.startBar + rest.lengthBars > to + EPS) {
        const halves = splitClipAt(rest, to, tempo);
        if (halves) after = halves[1];
      }
      for (const piece of [before, after]) if (piece) clips.push({ ...piece, isSelected: false });
    }
    const at = sourceTrack ? st.tracks.findIndex((t) => t.id === sourceTrack.id) + 1 : st.tracks.length;
    return { tracks: [...st.tracks.slice(0, at), track, ...st.tracks.slice(at)], clips: [...clips, reversed] };
  });
  return only
    ? `"${only.name}" now plays backwards, as audio on a new track under it. Undo brings the notes back.`
    : `Bars ${Math.round(from * 100) / 100} to ${Math.round(to * 100) / 100} now play backwards, as audio on a new track. Undo brings the music back.`;
}
