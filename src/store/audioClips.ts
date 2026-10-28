import type { Clip, ClipAudio, EmbeddedSound, GainPoint, SliceCount, SlicerSettings, Track } from './timelineTypes';
import { clipSecondsAt, normalizeWarp, sourceAt } from './warp';
import { barToSeconds, secondsBetween, secondsToBar, steadyBetween, tempoAt, type Tempo } from '../audio/tempoMap';
import { AUDIO_FADE_MAX, AUDIO_GAIN_MAX, AUDIO_GAIN_MIN, ENVELOPE_DB_MAX, ENVELOPE_DB_MIN, MAX_SLICES, SLICE_COUNTS, STRETCH_BPM_MAX, STRETCH_BPM_MIN } from './timelineTypes';

/**
 * Audio clip and Slicer maths with no audio or store in it, so Node can unit-test it: how a clip's
 * length follows the tempo, what the edits do to its offset into the sound, which sounds a project
 * uses, and reading these settings from a project file.
 */

const EPS = 1e-9;

/** Seconds in one bar of 4/4 at `bpm`. */
export const secondsPerBar = (bpm: number): number => 240 / bpm;

/** How long an audio clip plays, in seconds. */
export const audioClipSeconds = (clip: Pick<Clip, 'lengthBars'>, bpm: number): number => clip.lengthBars * secondsPerBar(bpm);

/**
 * How fast a clip plays its sound at `bpm`: 1 as recorded, or for a clip that follows the tempo,
 * the song's tempo over the recording's (2: twice as fast, at the same pitch).
 */
export const stretchRatio = (audio: Pick<ClipAudio, 'stretchBpm'>, bpm: number): number => (audio.stretchBpm ? bpm / audio.stretchBpm : 1);

/** Seconds of the sound a clip plays (its length in seconds times its stretch, or along its warp markers). */
export const audioSourceSeconds = (clip: Pick<Clip, 'lengthBars' | 'audio'>, bpm: number): number =>
  clip.audio ? sourceAt(clip.audio, audioClipSeconds(clip, bpm), bpm) - clip.audio.offset : audioClipSeconds(clip, bpm);

/**
 * The bar where the moment `src` seconds into an audio clip's sound plays: along its stretch and
 * warp at the tempo where it starts, and then in seconds from its start, as the clips play.
 */
export function barOfSource(clip: Pick<Clip, 'startBar' | 'audio'>, src: number, tempo: Tempo): number {
  if (!clip.audio) return clip.startBar;
  const seconds = clipSecondsAt(clip.audio, src, tempoAt(clip.startBar, tempo));
  return secondsToBar(barToSeconds(clip.startBar, tempo) + seconds, tempo);
}

/** How far into its sound (seconds) a clip's audio moves when the clip is cut, or its left edge moved, `bars` in (at `bpm`). */
export const audioShift = (audio: ClipAudio, bars: number, bpm: number): number => sourceAt(audio, bars * secondsPerBar(bpm), bpm) - audio.offset;

/**
 * Whether an audio clip's seconds between its start and bar `to` (either side of it) are counted
 * along the song's tempo changes: a clip that plays its sound in real time does, across a change,
 * as it plays (audioClipSchedule.ts), as the timeline draws it and as a freeze or bounce is
 * measured. One that follows the tempo, or sits in one tempo, counts them at the tempo where it starts.
 */
export const playsAlongMap = (clip: Pick<Clip, 'startBar' | 'audio'>, to: number, tempo: Tempo): boolean =>
  !!clip.audio && !clip.audio.stretchBpm && !steadyBetween(Math.min(clip.startBar, to), Math.max(clip.startBar, to), tempo);

/**
 * How far into its sound (seconds) a clip's audio moves when the clip is cut, or its left edge
 * moved, `bars` in (negative: back): what it plays there, along the tempo map where it plays along
 * it (see playsAlongMap), else as audioShift at the tempo where it starts.
 */
export function soundShift(clip: Pick<Clip, 'startBar' | 'audio'>, bars: number, tempo: Tempo): number {
  const to = clip.startBar + bars;
  if (playsAlongMap(clip, to, tempo)) return secondsBetween(clip.startBar, to, tempo);
  return clip.audio ? audioShift(clip.audio, bars, tempoAt(clip.startBar, tempo)) : 0;
}

/**
 * The bars `seconds` of sound played in real time fill from `startBar` (negative seconds: back
 * from it): at the tempo there, or along the tempo map where that crosses a change. With
 * `stretched` (the clip follows the tempo), always at the tempo there.
 */
export function barsForSeconds(startBar: number, seconds: number, tempo: Tempo, stretched = false): number {
  const bars = seconds / secondsPerBar(tempoAt(startBar, tempo));
  if (stretched || steadyBetween(Math.min(startBar, startBar + bars), Math.max(startBar, startBar + bars), tempo)) return bars;
  return secondsToBar(barToSeconds(startBar, tempo) + seconds, tempo) - startBar;
}

/**
 * The clips after a tempo change: an audio clip keeps its start bar and its length in seconds, so
 * its length in bars scales with the tempo where it starts (along the tempo map, where it plays
 * across a change before or after), unless it follows the tempo (then it
 * keeps its bars and is stretched instead). Note clips are untouched; the same array comes back
 * when nothing changes.
 */
export function retimeAudioClips(clips: Clip[], from: Tempo, to: Tempo): Clip[] {
  if (from === to || !clips.some((c) => c.audio && !c.audio.stretchBpm)) return clips;
  let changed = false;
  const next = clips.map((c) => {
    if (!c.audio || c.audio.stretchBpm) return c;
    const ratio = tempoAt(c.startBar, to) / tempoAt(c.startBar, from);
    const end = c.startBar + c.lengthBars;
    // Across a tempo change (before or after), its seconds are counted along the map, as it plays
    // (see playsAlongMap); in one tempo, scaled by the tempos where it starts
    if (playsAlongMap(c, end, from) || playsAlongMap(c, c.startBar + c.lengthBars * ratio, to)) {
      const secondsTo = (bars: number) => (playsAlongMap(c, c.startBar + bars, from) ? secondsBetween(c.startBar, c.startBar + bars, from) : bars * secondsPerBar(tempoAt(c.startBar, from)));
      const barsAt = (bars: number) => barsForSeconds(c.startBar, secondsTo(bars), to);
      const lengthBars = barsAt(c.lengthBars);
      const comp = c.comp?.map((seg) => ({ ...seg, at: barsAt(seg.at) }));
      if (Math.abs(lengthBars - c.lengthBars) < EPS && !(comp ?? []).some((seg, i) => Math.abs(seg.at - c.comp![i].at) >= EPS)) return c;
      changed = true;
      return { ...c, lengthBars, ...(comp ? { comp } : {}) };
    }
    if (Math.abs(ratio - 1) < EPS) return c;
    changed = true;
    // A take folder's comp keeps its place in the sound, so its bars scale too
    return { ...c, lengthBars: c.lengthBars * ratio, ...(c.comp ? { comp: c.comp.map((seg) => ({ ...seg, at: seg.at * ratio })) } : {}) };
  });
  return changed ? next : clips;
}

/**
 * Likely tempos a loop was recorded at, from its length: tempos at which it lasts a whole number
 * of bars (1, 2, 4, 8 or 16), between 60 and 200 BPM, nearest `near` first.
 */
export function loopTempos(seconds: number, near: number): number[] {
  const found: number[] = [];
  for (const bars of [1, 2, 4, 8, 16]) {
    let bpm = (240 * bars) / seconds;
    // Halve or double into range: a loop at 70 might be 140 counted the other way
    while (bpm > 200) bpm /= 2;
    while (bpm < 60) bpm *= 2;
    const rounded = Math.round(bpm * 100) / 100;
    if (!found.some((b) => Math.abs(b - rounded) < 0.05)) found.push(rounded);
  }
  return found.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
}

/**
 * A clip's audio once it plays only part of what it played (a half of a split, a trimmed start):
 * no longer the whole of a mangle, so it can't go back to that mangle's original (which would
 * bring back all of it, in the wrong place). Undo still does.
 */
export function partOfMangle(audio: ClipAudio): ClipAudio {
  if (!audio.mangled) return audio;
  const { mangled: _m, ...rest } = audio;
  return rest;
}

/** The audio of a clip's right half when it is cut `seconds` into the clip. */
export function splitAudio(audio: ClipAudio, seconds: number): ClipAudio {
  return { ...partOfMangle(audio), offset: audio.offset + Math.max(0, seconds) };
}

/**
 * The audio of a clip whose left edge moved by `seconds` (positive: later): the start plays from
 * further into the sound. Never before the sound's start.
 */
export function trimAudioStart(audio: ClipAudio, seconds: number): ClipAudio {
  return { ...(seconds ? partOfMangle(audio) : audio), offset: Math.max(0, audio.offset + seconds) };
}

/** The earliest bar a clip's left edge can be dragged to: no earlier than the sound's own start. */
export function audioTrimStartLimit(clip: Pick<Clip, 'startBar' | 'audio'>, bpm: number): number {
  return clip.audio ? clip.startBar + clipSecondsAt(clip.audio, 0, bpm) / secondsPerBar(bpm) : 1;
}

/** The most bars an audio clip can be, given its sound's length in seconds (Infinity when that isn't known). */
export function audioLengthLimit(audio: ClipAudio, soundSeconds: number | undefined, bpm: number): number {
  if (soundSeconds === undefined) return Infinity;
  return Math.max(0, clipSecondsAt(audio, soundSeconds, bpm)) / secondsPerBar(bpm);
}

/**
 * audioTrimStartLimit along the song's tempo: a clip that plays its sound in real time reaches its
 * sound's start across a tempo change at the bar it plays there (see playsAlongMap).
 */
export function audioTrimStartLimitAt(clip: Pick<Clip, 'startBar' | 'audio'>, tempo: Tempo): number {
  const bpm = tempoAt(clip.startBar, tempo);
  const bar = audioTrimStartLimit(clip, bpm);
  if (!clip.audio || clip.audio.stretchBpm || steadyBetween(Math.min(bar, clip.startBar), clip.startBar, tempo)) return bar;
  return clip.startBar + barsForSeconds(clip.startBar, -clip.audio.offset, tempo);
}

/** audioLengthLimit along the song's tempo, as audioTrimStartLimitAt. */
export function audioLengthLimitAt(clip: Pick<Clip, 'startBar' | 'audio'>, soundSeconds: number | undefined, tempo: Tempo): number {
  if (!clip.audio) return Infinity;
  const bars = audioLengthLimit(clip.audio, soundSeconds, tempoAt(clip.startBar, tempo));
  if (!Number.isFinite(bars) || clip.audio.stretchBpm || steadyBetween(clip.startBar, clip.startBar + bars, tempo)) return bars;
  return Math.max(0, barsForSeconds(clip.startBar, soundSeconds! - clip.audio.offset, tempo));
}

/** The sounds a project refers to: audio clips (in the clip launcher's slots too), Slicer tracks and Sampler tracks (each id once). */
export function referencedSoundIds(p: { clips: ReadonlyArray<Pick<Clip, 'audio' | 'takes'>>; tracks: ReadonlyArray<Pick<Track, 'sample' | 'slicer' | 'rack' | 'multi' | 'slots'>>; masterFx?: { room?: string } }): string[] {
  const ids = new Set<string>();
  // The recorded room the master reverb plays through
  if (p.masterFx?.room) ids.add(p.masterFx.room);
  const clips: ReadonlyArray<Pick<Clip, 'audio' | 'takes'>> = [...p.clips, ...p.tracks.flatMap((t) => (t.slots ?? []).map((s) => s.clip))];
  for (const c of clips) {
    // A take folder keeps every take's sound, not only the one its comp starts with
    for (const audio of [c.audio, ...(c.takes ?? []).map((t) => t.audio)]) {
      if (!audio) continue;
      // (A mangled clip keeps the audio it had before, to go back to)
      for (const a of [audio, audio.mangled?.was]) {
        if (!a) continue;
        ids.add(a.soundId);
        if (a.tunedFrom) ids.add(a.tunedFrom);
        if (a.reversedFrom) ids.add(a.reversedFrom);
        if (a.shiftedFrom) ids.add(a.shiftedFrom);
      }
      if (audio.mangled) ids.add(audio.mangled.from);
    }
  }
  for (const t of p.tracks) {
    if (t.sample?.soundId) ids.add(t.sample.soundId);
    if (t.slicer) ids.add(t.slicer.soundId);
    for (const pad of t.rack?.pads ?? []) if (pad.soundId) ids.add(pad.soundId);
    for (const zone of t.multi?.zones ?? []) ids.add(zone.soundId);
  }
  return [...ids];
}

/** A file name without its extension, for a clip's name ("take 3.wav" -> "take 3"). */
export function clipNameFromFile(fileName: string): string {
  const name = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim();
  return name || 'Audio';
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A clip's audio settings from a file, or undefined if there aren't any (a note clip, or a broken entry). */
export function normalizeClipAudio(raw: unknown): ClipAudio | undefined {
  if (!isObj(raw) || typeof raw.soundId !== 'string' || !raw.soundId) return undefined;
  return {
    soundId: raw.soundId,
    offset: isNum(raw.offset) ? Math.max(0, raw.offset) : 0,
    gain: isNum(raw.gain) ? clamp(raw.gain, AUDIO_GAIN_MIN, AUDIO_GAIN_MAX) : 0,
    fadeIn: isNum(raw.fadeIn) ? clamp(raw.fadeIn, 0, AUDIO_FADE_MAX) : 0,
    fadeOut: isNum(raw.fadeOut) ? clamp(raw.fadeOut, 0, AUDIO_FADE_MAX) : 0,
    ...(isNum(raw.stretchBpm) ? { stretchBpm: clamp(raw.stretchBpm, STRETCH_BPM_MIN, STRETCH_BPM_MAX) } : {}),
    ...(typeof raw.tunedFrom === 'string' && raw.tunedFrom ? { tunedFrom: raw.tunedFrom } : {}),
    ...(typeof raw.reversedFrom === 'string' && raw.reversedFrom ? { reversedFrom: raw.reversedFrom } : {}),
    ...(typeof raw.shiftedFrom === 'string' && raw.shiftedFrom && isNum(raw.shift) ? { shiftedFrom: raw.shiftedFrom, shift: clamp(raw.shift, -12, 12) } : {}),
    ...(() => {
      const m = raw.mangled;
      if (!isObj(m) || typeof m.from !== 'string' || !m.from || !isNum(m.offset) || !isNum(m.bars) || !(m.bars > 0)) return {};
      const steps = Array.isArray(m.steps) ? m.steps.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 40)).slice(-16) : [];
      // (The audio it had before, without a mangle of its own)
      const was = normalizeClipAudio(m.was);
      if (was) delete was.mangled;
      return { mangled: { from: m.from, offset: Math.max(0, m.offset), bars: Math.min(10000, m.bars), steps, ...(was ? { was } : {}) } };
    })(),
    ...(() => {
      const warp = normalizeWarp(raw.warp, isNum(raw.stretchBpm) ? clamp(raw.stretchBpm, STRETCH_BPM_MIN, STRETCH_BPM_MAX) : 60);
      return warp.length ? { warp } : {};
    })(),
    ...(() => {
      const envelope = normalizeEnvelope(raw.envelope);
      return envelope.length ? { envelope } : {};
    })(),
  };
}

/** Gain envelope points tidied: finite, in order, inside the envelope's range, at most 1024. */
export function normalizeEnvelope(raw: unknown): GainPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is GainPoint => isObj(p) && isNum(p.src) && isNum(p.db))
    .map((p) => ({ src: Math.max(0, p.src), db: clamp(p.db, ENVELOPE_DB_MIN, ENVELOPE_DB_MAX) }))
    .sort((a, b) => a.src - b.src)
    .slice(0, 1024);
}

/** The envelope's gain (dB) at `src` seconds into the sound: straight lines between points, held beyond them (0 dB with none). */
export function envelopeDbAt(points: readonly GainPoint[] | undefined, src: number): number {
  if (!points?.length) return 0;
  if (src <= points[0].src) return points[0].db;
  const last = points[points.length - 1];
  if (src >= last.src) return last.db;
  let i = 1;
  while (points[i].src < src) i++;
  const a = points[i - 1];
  const b = points[i];
  return b.src - a.src < 1e-9 ? b.db : a.db + ((src - a.src) / (b.src - a.src)) * (b.db - a.db);
}

/**
 * Slice starts tidied: finite, inside [start, end), ascending with no repeats, the first at
 * `start`, at most MAX_SLICES.
 */
export function normalizeSlices(raw: unknown, start: number, end: number): number[] {
  const inside = (Array.isArray(raw) ? raw : []).filter((v): v is number => isNum(v) && v > start + EPS && v < end - EPS).sort((a, b) => a - b);
  const slices = [start];
  for (const v of inside) if (v - slices[slices.length - 1] > EPS) slices.push(v);
  return slices.slice(0, MAX_SLICES);
}

/** The sounds a project file embeds, keeping the well-formed ones (a damaged entry just leaves its sound missing). */
export function parseEmbeddedSounds(raw: unknown): EmbeddedSound[] {
  if (!Array.isArray(raw)) return [];
  const sounds: EmbeddedSound[] = [];
  for (const v of raw) {
    if (!isObj(v) || typeof v.id !== 'string' || !v.id || typeof v.data !== 'string') continue;
    sounds.push({
      id: v.id,
      name: typeof v.name === 'string' ? v.name : 'Sound',
      type: typeof v.type === 'string' ? v.type : 'application/octet-stream',
      size: isNum(v.size) ? v.size : 0,
      seconds: isNum(v.seconds) ? v.seconds : 0,
      data: v.data,
    });
  }
  return sounds;
}

/** A track's Slicer settings from a file, or undefined if there aren't any usable ones. */
export function normalizeSlicer(raw: unknown): SlicerSettings | undefined {
  if (!isObj(raw) || typeof raw.soundId !== 'string' || !raw.soundId) return undefined;
  const start = isNum(raw.start) ? Math.max(0, raw.start) : 0;
  const end = isNum(raw.end) && raw.end > start ? raw.end : start + 1;
  const slices = normalizeSlices(raw.slices, start, end);
  return {
    soundId: raw.soundId,
    name: typeof raw.name === 'string' ? raw.name : 'Sound',
    start,
    end,
    slices,
    mode: raw.mode === 'equal' ? 'equal' : 'auto',
    count: SLICE_COUNTS.includes(raw.count as SliceCount) ? (raw.count as SliceCount) : 8,
    sensitivity: isNum(raw.sensitivity) ? clamp(raw.sensitivity, 0, 1) : 0.5,
    pitch: raw.pitch === true,
    focus: isNum(raw.focus) ? clamp(Math.round(raw.focus), 0, slices.length - 1) : 0,
    ...(() => {
      const reversed = normalizeReversed(raw.reversed, slices.length);
      return reversed.length ? { reversed } : {};
    })(),
  };
}

/** Which slices play backwards, tidied: whole indexes of slices there are, ascending, once each. */
export function normalizeReversed(raw: unknown, count: number): number[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((v): v is number => isNum(v) && Number.isInteger(v) && v >= 0 && v < count))].sort((a, b) => a - b);
}

/** How long an audio clip crossfades with its neighbours on the track, in seconds. */
export interface Crossfade {
  /** Fading in under the clip before it */
  in: number;
  /** Fading out under the clip after it */
  out: number;
}

/**
 * Automatic crossfades: where two audio clips on one track overlap, and the earlier one ends
 * inside the later one, the earlier fades out and the later fades in across the overlap (equal
 * power, so the level holds through it). A clip lying wholly inside another is a layer and plays
 * on top, uncrossfaded. Only clips with a crossfade are in the map. The overlap's seconds are
 * counted at the tempo where it is (along the song's tempo changes, across one).
 */
export function crossfades(clips: ReadonlyArray<Pick<Clip, 'id' | 'trackId' | 'startBar' | 'lengthBars' | 'audio'>>, tempo: Tempo): Map<string, Crossfade> {
  const out = new Map<string, Crossfade>();
  const byTrack = new Map<string, typeof clips[number][]>();
  for (const c of clips) {
    if (!c.audio) continue;
    const list = byTrack.get(c.trackId);
    if (list) list.push(c);
    else byTrack.set(c.trackId, [c]);
  }
  for (const list of byTrack.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.startBar - b.startBar || a.lengthBars - b.lengthBars);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const aEnd = a.startBar + a.lengthBars;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.startBar >= aEnd - EPS) break;
        const bEnd = b.startBar + b.lengthBars;
        // b inside a (or starting with it): a layer, not a handover
        if (bEnd <= aEnd + EPS || b.startBar <= a.startBar + EPS) continue;
        const seconds = steadyBetween(b.startBar, aEnd, tempo) ? (aEnd - b.startBar) * secondsPerBar(tempoAt(b.startBar, tempo)) : secondsBetween(b.startBar, aEnd, tempo);
        const fa = out.get(a.id) ?? { in: 0, out: 0 };
        const fb = out.get(b.id) ?? { in: 0, out: 0 };
        fa.out = Math.max(fa.out, seconds);
        fb.in = Math.max(fb.in, seconds);
        out.set(a.id, fa);
        out.set(b.id, fb);
      }
    }
  }
  return out;
}
