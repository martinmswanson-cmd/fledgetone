import type { ClipAudio, WarpMarker } from './timelineTypes';

/**
 * Warp markers: where moments of a recording land in the music. Plain maths (no audio), so Node
 * can unit-test it and the player, the clip drawing and the editing all agree.
 *
 * A clip that follows the tempo (ClipAudio.stretchBpm) plays its recording on a beat grid: a
 * moment `src` seconds into the sound sits `src * stretchBpm / 60` beats into it. Warp markers
 * bend that grid: each pins a moment of the sound (`src`) to a beat (`beat`, quarter notes from
 * the sound's own beat 0). Between two markers the sound is stretched evenly; before the first
 * and after the last it keeps the recording's tempo. A clip then plays beat for beat at the
 * song's tempo, so dragging a marker moves that moment (a drum hit, a word) earlier or later
 * and stretches the audio either side of it to fit.
 */

const EPS = 1e-9;
/** The most markers a clip may have. */
export const MAX_WARP_MARKERS = 512;
/** The closest two markers may be, in seconds of sound and in beats. */
export const WARP_MIN_GAP = 0.01;
/** The most one stretch between markers may speed the sound up or slow it down. */
export const WARP_MAX_RATIO = 4;

type Warpable = Pick<ClipAudio, 'stretchBpm' | 'warp'>;

/** Beats per second of sound at the recording's own tempo. */
const slope = (audio: Warpable): number => (audio.stretchBpm ?? 60) / 60;

/** The beat a moment of the sound (`src` seconds in) lands on. */
export function beatAt(audio: Warpable, src: number): number {
  const m = audio.warp;
  const k = slope(audio);
  if (!m?.length) return src * k;
  if (src <= m[0].src) return m[0].beat + (src - m[0].src) * k;
  const last = m[m.length - 1];
  if (src >= last.src) return last.beat + (src - last.src) * k;
  let lo = 0;
  let hi = m.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (m[mid].src <= src) lo = mid;
    else hi = mid;
  }
  const a = m[lo];
  const b = m[hi];
  return a.beat + ((src - a.src) / (b.src - a.src)) * (b.beat - a.beat);
}

/** The moment of the sound (seconds in) that lands on `beat`. */
export function srcAt(audio: Warpable, beat: number): number {
  const m = audio.warp;
  const k = slope(audio);
  if (!m?.length) return beat / k;
  if (beat <= m[0].beat) return m[0].src + (beat - m[0].beat) / k;
  const last = m[m.length - 1];
  if (beat >= last.beat) return last.src + (beat - last.beat) / k;
  let lo = 0;
  let hi = m.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (m[mid].beat <= beat) lo = mid;
    else hi = mid;
  }
  const a = m[lo];
  const b = m[hi];
  return a.src + ((beat - a.beat) / (b.beat - a.beat)) * (b.src - a.src);
}

/** The clip warps (it follows the tempo and has markers). */
export const isWarped = (audio: Warpable): boolean => !!audio.stretchBpm && !!audio.warp?.length;

/**
 * Where in its sound a clip is `seconds` into itself at `bpm`, from its offset: as recorded (no
 * stretch), stretched evenly (following the tempo), or along its warp markers.
 */
export function sourceAt(audio: Pick<ClipAudio, 'offset' | 'stretchBpm' | 'warp'>, seconds: number, bpm: number): number {
  if (!audio.stretchBpm) return audio.offset + seconds;
  if (!audio.warp?.length) return audio.offset + (seconds * bpm) / audio.stretchBpm;
  return srcAt(audio, beatAt(audio, audio.offset) + (seconds * bpm) / 60);
}

/** How many seconds into the clip (at `bpm`) the moment `src` of its sound plays: sourceAt turned round. */
export function clipSecondsAt(audio: Pick<ClipAudio, 'offset' | 'stretchBpm' | 'warp'>, src: number, bpm: number): number {
  if (!audio.stretchBpm) return src - audio.offset;
  if (!audio.warp?.length) return ((src - audio.offset) * audio.stretchBpm) / bpm;
  return ((beatAt(audio, src) - beatAt(audio, audio.offset)) * 60) / bpm;
}

/** One straight stretch of the warp: the sound from src0 to src1 plays over beats beat0 to beat1. */
export interface WarpPiece {
  src0: number;
  src1: number;
  beat0: number;
  beat1: number;
}

/** The straight stretches the warp maps the sound from `from` to `to` (seconds) with, in order. */
export function warpPieces(audio: Warpable, from: number, to: number): WarpPiece[] {
  if (to <= from + EPS) return [];
  const cuts = [from, ...(audio.warp ?? []).map((m) => m.src).filter((s) => s > from + EPS && s < to - EPS), to];
  const pieces: WarpPiece[] = [];
  for (let i = 0; i < cuts.length - 1; i++) pieces.push({ src0: cuts[i], src1: cuts[i + 1], beat0: beatAt(audio, cuts[i]), beat1: beatAt(audio, cuts[i + 1]) });
  return pieces;
}

/**
 * Markers tidied: finite, in order of the sound and of the beats both (a marker that would fold
 * the sound back on itself goes), at least WARP_MIN_GAP apart, no stretch beyond WARP_MAX_RATIO
 * either way, at most MAX_WARP_MARKERS.
 */
export function normalizeWarp(raw: unknown, stretchBpm = 60): WarpMarker[] {
  if (!Array.isArray(raw)) return [];
  const k = stretchBpm / 60;
  const points = raw
    .filter((m): m is WarpMarker => typeof m === 'object' && m !== null && Number.isFinite((m as WarpMarker).src) && Number.isFinite((m as WarpMarker).beat))
    .map((m) => ({ src: Math.max(0, m.src), beat: m.beat }))
    .sort((a, b) => a.src - b.src);
  const out: WarpMarker[] = [];
  for (const m of points) {
    const prev = out[out.length - 1];
    if (prev) {
      const ds = m.src - prev.src;
      const db = m.beat - prev.beat;
      if (ds < WARP_MIN_GAP || db < WARP_MIN_GAP * k) continue;
      // How much faster than recorded this stretch plays: within WARP_MAX_RATIO either way
      const ratio = ds / (db / k);
      if (ratio > WARP_MAX_RATIO || ratio < 1 / WARP_MAX_RATIO) continue;
    }
    out.push(m);
    if (out.length >= MAX_WARP_MARKERS) break;
  }
  return out;
}

/** A short key for a clip's markers (what a warped copy of its sound was made for). */
export const warpKey = (audio: Warpable): string => (audio.warp?.length ? audio.warp.map((m) => `${m.src.toFixed(5)}:${m.beat.toFixed(5)}`).join(',') : '');

/**
 * Markers that pull the hits `onsets` (seconds into the sound) onto the nearest `grid` (in beats)
 * of the song, `strength` (0 to 1) of the way. `songBeatOf` gives the song beat a beat of the
 * sound plays on (the clip's placement). Hits that would land on a grid line already taken, or
 * that are already on the grid, get no marker. Existing markers are replaced in the range
 * [from, to] (seconds of sound), and markers at its ends hold the rest of the clip where it was.
 */
export function quantizeWarp(
  audio: Warpable,
  onsets: readonly number[],
  opts: { grid: number; strength: number; from: number; to: number; songBeatOf: (soundBeat: number) => number }
): WarpMarker[] {
  const { grid, from, to, songBeatOf } = opts;
  const strength = Math.max(0, Math.min(1, opts.strength));
  const keep = (audio.warp ?? []).filter((m) => m.src < from - EPS || m.src > to + EPS);
  const anchors: WarpMarker[] = [
    { src: from, beat: beatAt(audio, from) },
    { src: to, beat: beatAt(audio, to) },
  ];
  const moved: WarpMarker[] = [];
  const taken = new Set<number>();
  for (const src of onsets) {
    if (src <= from + WARP_MIN_GAP || src >= to - WARP_MIN_GAP) continue;
    const beat = beatAt(audio, src);
    const song = songBeatOf(beat);
    const line = Math.round(song / grid);
    if (taken.has(line)) continue;
    taken.add(line);
    const shift = (line * grid - song) * strength;
    if (Math.abs(shift) < 1e-4) continue;
    moved.push({ src, beat: beat + shift });
  }
  return normalizeWarp([...keep, ...anchors, ...moved], audio.stretchBpm ?? 60);
}
