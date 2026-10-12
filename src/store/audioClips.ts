import type { Clip, ClipAudio, EmbeddedSound, SliceCount, SlicerSettings, Track } from './timelineTypes';
import { AUDIO_FADE_MAX, AUDIO_GAIN_MAX, AUDIO_GAIN_MIN, MAX_SLICES, SLICE_COUNTS, STRETCH_BPM_MAX, STRETCH_BPM_MIN } from './timelineTypes';

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

/** Seconds of the sound a clip plays (its length in seconds times its stretch). */
export const audioSourceSeconds = (clip: Pick<Clip, 'lengthBars' | 'audio'>, bpm: number): number =>
  audioClipSeconds(clip, bpm) * (clip.audio ? stretchRatio(clip.audio, bpm) : 1);

/**
 * The clips after a tempo change: an audio clip keeps its start bar and its length in seconds, so
 * its length in bars scales with the tempo, unless it follows the tempo (then it keeps its bars
 * and is stretched instead). Note clips are untouched; the same array comes back when nothing changes.
 */
export function retimeAudioClips(clips: Clip[], fromBpm: number, toBpm: number): Clip[] {
  if (fromBpm === toBpm || !clips.some((c) => c.audio && !c.audio.stretchBpm)) return clips;
  const ratio = toBpm / fromBpm;
  return clips.map((c) => (c.audio && !c.audio.stretchBpm ? { ...c, lengthBars: c.lengthBars * ratio } : c));
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

/** The audio of a clip's right half when it is cut `seconds` into the clip. */
export function splitAudio(audio: ClipAudio, seconds: number): ClipAudio {
  return { ...audio, offset: audio.offset + Math.max(0, seconds) };
}

/**
 * The audio of a clip whose left edge moved by `seconds` (positive: later): the start plays from
 * further into the sound. Never before the sound's start.
 */
export function trimAudioStart(audio: ClipAudio, seconds: number): ClipAudio {
  return { ...audio, offset: Math.max(0, audio.offset + seconds) };
}

/** The earliest bar a clip's left edge can be dragged to: no earlier than the sound's own start. */
export function audioTrimStartLimit(clip: Pick<Clip, 'startBar' | 'audio'>, bpm: number): number {
  return clip.audio ? clip.startBar - clip.audio.offset / stretchRatio(clip.audio, bpm) / secondsPerBar(bpm) : 1;
}

/** The most bars an audio clip can be, given its sound's length in seconds (Infinity when that isn't known). */
export function audioLengthLimit(audio: ClipAudio, soundSeconds: number | undefined, bpm: number): number {
  if (soundSeconds === undefined) return Infinity;
  return Math.max(0, soundSeconds - audio.offset) / stretchRatio(audio, bpm) / secondsPerBar(bpm);
}

/** The sounds a project refers to: audio clips, Slicer tracks and Sampler tracks (each id once). */
export function referencedSoundIds(p: { clips: ReadonlyArray<Pick<Clip, 'audio'>>; tracks: ReadonlyArray<Pick<Track, 'sample' | 'slicer'>> }): string[] {
  const ids = new Set<string>();
  for (const c of p.clips) if (c.audio) ids.add(c.audio.soundId);
  for (const t of p.tracks) {
    if (t.sample?.soundId) ids.add(t.sample.soundId);
    if (t.slicer) ids.add(t.slicer.soundId);
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
  };
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
  };
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
 * on top, uncrossfaded. Only clips with a crossfade are in the map.
 */
export function crossfades(clips: ReadonlyArray<Pick<Clip, 'id' | 'trackId' | 'startBar' | 'lengthBars' | 'audio'>>, bpm: number): Map<string, Crossfade> {
  const out = new Map<string, Crossfade>();
  const byTrack = new Map<string, typeof clips[number][]>();
  for (const c of clips) {
    if (!c.audio) continue;
    const list = byTrack.get(c.trackId);
    if (list) list.push(c);
    else byTrack.set(c.trackId, [c]);
  }
  const spb = secondsPerBar(bpm);
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
        const seconds = (aEnd - b.startBar) * spb;
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
