/**
 * Bounce to pad, the plain maths: which Drum Rack pad a new sound goes on (the pad asked for, else
 * the first empty pad of a Drum Rack track, else a new Drum Rack track), the rack with the sound
 * on that pad, the level a bounce is stored at and the pad gain that plays it back as loud as it
 * was, and the stretch of a recording an audio clip (a vocal take) plays, as a pad. No audio or
 * store in it, so Node can unit-test it; the actions are in bounceToPadActions.ts.
 */
import type { Clip, DrumRack, RackPad, Track } from './timelineTypes';
import { RACK_PADS } from './timelineTypes';
import { defaultRack, emptyPad, RACK_FADE_MAX, RACK_GAIN_MAX, RACK_GAIN_MIN } from './sampleKits';
import { audioSourceSeconds } from './audioClips';

/** The name of the Drum Rack track a bounce makes when there's no pad free. */
export const BOUNCE_TRACK_NAME = 'Bounces';
/** A bounce is stored with its peak here (as a freeze is), and the pad's gain puts its level back. */
export const BOUNCE_PEAK = 0.98;
/** Below this a bounce is silence. */
export const BOUNCE_SILENCE = 10 ** (-90 / 20);

export const isRackTrack = (t: Pick<Track, 'instrumentKey'>): boolean => t.instrumentKey === 'drumRack';

/** The first pad with no sound on it, or -1 when all 16 have one. */
export function firstEmptyPad(rack: DrumRack | undefined): number {
  const pads = (rack ?? defaultRack()).pads;
  for (let i = 0; i < RACK_PADS; i++) if (!pads[i]?.soundId) return i;
  return -1;
}

/** Where a sound goes: a pad of a Drum Rack track, or pad 1 of a new one (trackId null). */
export interface PadTarget {
  trackId: string | null;
  pad: number;
}

/**
 * The pad a new sound goes on. `prefer`: a track (and pad) the person picked. A pad asked for is
 * used even when it holds a sound (it's replaced); a track asked for without a pad gives its first
 * empty one. Otherwise the first Drum Rack track with an empty pad, else a new track.
 */
export function choosePadTarget(tracks: ReadonlyArray<Pick<Track, 'id' | 'instrumentKey' | 'rack'>>, prefer?: { trackId?: string | null; pad?: number }): PadTarget {
  const wanted = prefer?.trackId ? tracks.find((t) => t.id === prefer.trackId && isRackTrack(t)) : undefined;
  if (wanted) {
    if (prefer?.pad !== undefined && Number.isInteger(prefer.pad) && prefer.pad >= 0 && prefer.pad < RACK_PADS) return { trackId: wanted.id, pad: prefer.pad };
    const free = firstEmptyPad(wanted.rack);
    if (free >= 0) return { trackId: wanted.id, pad: free };
  }
  for (const t of tracks) {
    if (!isRackTrack(t)) continue;
    const free = firstEmptyPad(t.rack);
    if (free >= 0) return { trackId: t.id, pad: free };
  }
  return { trackId: null, pad: 0 };
}

/** What goes on a pad: a sound (or a stretch of it), named, at a gain. */
export interface PadSound {
  soundId: string;
  name: string;
  gainDb: number;
  /** The stretch of the sound it plays, seconds (both or neither) */
  start?: number;
  end?: number;
  /** Fade at its edges, seconds */
  fade?: number;
}

/** `rack` (or an empty one) with pad `i` playing `sound`, at neutral settings otherwise. */
export function fillPad(rack: DrumRack | undefined, i: number, sound: PadSound): DrumRack {
  const base = rack ?? defaultRack();
  const pad: RackPad = {
    ...emptyPad(i),
    name: sound.name.trim().slice(0, 40) || emptyPad(i).name,
    soundId: sound.soundId,
    gain: Math.round(Math.max(RACK_GAIN_MIN, Math.min(RACK_GAIN_MAX, sound.gainDb)) * 100) / 100,
    ...(sound.start !== undefined && sound.end !== undefined && sound.end > sound.start && sound.start >= 0 ? { start: round(sound.start), end: round(sound.end) } : {}),
    ...(sound.fade && sound.fade > 0 ? { fade: Math.min(RACK_FADE_MAX, round(sound.fade)) } : {}),
  };
  return { pads: Array.from({ length: RACK_PADS }, (_, j) => (j === i ? pad : base.pads[j] ?? emptyPad(j))) };
}

/** `rack` with pad `i` emptied (its name and settings back to an empty pad's). */
export function clearPad(rack: DrumRack | undefined, i: number): DrumRack {
  const base = rack ?? defaultRack();
  return { pads: base.pads.map((p, j) => (j === i ? emptyPad(i) : p)) };
}

/**
 * How a bounce with peak `peak` is stored and played: scaled by `scale` to BOUNCE_PEAK, and played
 * at `gainDb` on its pad, which undoes that and adds `playbackDb` (what the track's strip and the
 * mix bus take off a sound they play, see freezeActions.ts), so the pad sounds as the song did.
 * The pad's gain stops at its +12 dB: a very loud bounce plays a little quieter, never louder.
 * Null for silence.
 */
export function padLevel(peak: number, playbackDb: number): { scale: number; gainDb: number } | null {
  if (!(peak > BOUNCE_SILENCE)) return null;
  const normalizeDb = 20 * Math.log10(peak / BOUNCE_PEAK);
  return { scale: BOUNCE_PEAK / peak, gainDb: Math.max(RACK_GAIN_MIN, Math.min(RACK_GAIN_MAX, normalizeDb + playbackDb)) };
}

/**
 * An audio clip (a vocal take) as a pad: the stretch of its sound it plays and its clip gain (both
 * play through a track's strip, so no correction). Its fades become the pad's fade (the shorter,
 * up to the pad's longest), at least a few ms when it starts or stops inside the sound.
 */
export function padFromClip(clip: Pick<Clip, 'name' | 'lengthBars' | 'audio'>, soundSeconds: number, bpm: number): PadSound | null {
  const audio = clip.audio;
  if (!audio) return null;
  const start = Math.max(0, audio.offset);
  const end = Math.min(soundSeconds, start + audioSourceSeconds(clip, bpm));
  if (!(end > start)) return null;
  const whole = start < 1e-4 && end > soundSeconds - 1e-3;
  const fade = Math.min(RACK_FADE_MAX, Math.max(whole ? 0 : 0.005, Math.min(audio.fadeIn, audio.fadeOut)));
  return {
    soundId: audio.soundId,
    name: clip.name,
    gainDb: audio.gain,
    ...(whole ? {} : { start, end }),
    ...(fade > 0 ? { fade } : {}),
  };
}

/** A bounce's name: the section's (or the bars'), and the track's when only one was bounced. */
export function bounceName(from: number, to: number, section?: string, trackName?: string): string {
  const bars = to - from <= 1 + 1e-9 ? `bar ${fmtBar(from)}` : `bars ${fmtBar(from)}–${fmtBar(to - 1)}`;
  const what = section ?? (trackName ? bars : bars.charAt(0).toUpperCase() + bars.slice(1));
  return (trackName ? `${trackName} ${what}` : what).slice(0, 40);
}

const fmtBar = (b: number) => (Number.isInteger(b) ? String(b) : b.toFixed(2).replace(/0+$/, ''));
const round = (s: number) => Math.round(s * 1e6) / 1e6;
