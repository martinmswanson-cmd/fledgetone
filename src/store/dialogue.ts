import type { AutomationPoint } from './timelineTypes';
import { AUTOMATION, laneValueAt, normalizePoints } from '../audio/automation';

/**
 * Dip under dialogue: find where people talk in a video's own sound, then dip the music there,
 * the way a film mixer rides the score under the lines. Speech is found by its level in the voice
 * band (300 Hz to 3.4 kHz), against the quiet between lines, with short pauses bridged so the
 * music doesn't bob up between words. The dip is written as volume automation, so it shows on
 * the tracks, can be edited, and plays the same live and in every export. No browser or store
 * here, so Node can unit-test it.
 */

export interface Span {
  /** Seconds */
  start: number;
  end: number;
}

const FRAME = 0.02;

/** A two-pole band-pass (biquad) over `x`, in place in a copy. */
function biquad(x: Float32Array, sampleRate: number, type: 'highpass' | 'lowpass', freq: number): Float32Array {
  const w = (2 * Math.PI * freq) / sampleRate;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const cos = Math.cos(w);
  const [b0, b1, b2] = type === 'lowpass' ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** The voice band's level (dBFS) and its share of all the sound, every 20 ms. */
export function voiceLevels(samples: Float32Array, sampleRate: number): { db: number[]; share: number[] } {
  const band = biquad(biquad(samples, sampleRate, 'highpass', 300), sampleRate, 'lowpass', 3400);
  const n = Math.max(1, Math.round(FRAME * sampleRate));
  const db: number[] = [];
  const share: number[] = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let e = 0;
    let all = 0;
    for (let k = i; k < i + n; k++) {
      e += band[k] * band[k];
      all += samples[k] * samples[k];
    }
    db.push(10 * Math.log10(e / n + 1e-12));
    share.push(all > 0 ? e / all : 0);
  }
  return { db, share };
}

export interface SpeechOptions {
  /** How far above the quiet between lines a voice must be, dB */
  above?: number;
  /** Pauses shorter than this (seconds) are bridged */
  bridge?: number;
  /** Bursts shorter than this (seconds) are ignored (a click, a door) */
  minimum?: number;
}

/** Where people talk, from voiceLevels. */
export function speechSpans(levels: { db: number[]; share: number[] }, { above = 12, bridge = 0.6, minimum = 0.25 }: SpeechOptions = {}): Span[] {
  const { db, share } = levels;
  if (!db.length) return [];
  // The quiet between lines: a low percentile of the voice band's level
  const sorted = [...db].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)];
  const threshold = Math.max(floor + above, -50);
  const spans: Span[] = [];
  let start = -1;
  for (let i = 0; i <= db.length; i++) {
    const on = i < db.length && db[i] > threshold && share[i] > 0.2;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      spans.push({ start: start * FRAME, end: i * FRAME });
      start = -1;
    }
  }
  const joined: Span[] = [];
  for (const s of spans) {
    const last = joined[joined.length - 1];
    if (last && s.start - last.end < bridge) last.end = s.end;
    else joined.push({ ...s });
  }
  return joined.filter((s) => s.end - s.start >= minimum);
}

export interface DipShape {
  /** How far the music dips, dB (positive) */
  depth: number;
  /** Seconds the dip starts before the voice, and takes to come back after it */
  attack: number;
  release: number;
}

export const DEFAULT_DIP: DipShape = { depth: 10, attack: 0.15, release: 0.5 };

/**
 * A track's volume lane with the dips cut into it: `dips` are in bars (where the voice starts and
 * ends), `secondsPerBar` sets the ramps' length. An empty lane starts from the track's fader
 * (`faderDb`); an existing one keeps its shape and is lowered by the depth inside the dips.
 */
export function dipLane(points: readonly AutomationPoint[], faderDb: number, dips: ReadonlyArray<{ from: number; to: number }>, shape: DipShape, secondsPerBar: number): AutomationPoint[] {
  const spec = AUTOMATION.volume;
  const base = (bar: number) => (points.length ? spec.toReal(laneValueAt(points, bar)!) : faderDb);
  const lowered = (bar: number) => spec.toNorm(Math.max(-60, base(bar) - shape.depth));
  const normal = (bar: number) => spec.toNorm(base(bar));
  const attack = shape.attack / secondsPerBar;
  const release = shape.release / secondsPerBar;
  // Join dips whose ramps would overlap
  const merged: Array<{ from: number; to: number }> = [];
  for (const d of [...dips].sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && d.from - attack <= last.to + release) last.to = Math.max(last.to, d.to);
    else merged.push({ ...d });
  }
  const inDip = (bar: number) => merged.some((d) => bar > d.from - attack - 1e-9 && bar < d.to + release + 1e-9);
  const out: AutomationPoint[] = points.filter((p) => !inDip(p.bar)).map((p) => ({ ...p }));
  for (const d of merged) {
    const a = Math.max(1, d.from - attack);
    out.push({ bar: a, value: normal(a) });
    out.push({ bar: Math.max(a, d.from), value: lowered(d.from) });
    // Existing points inside the dip, lowered
    for (const p of points) if (p.bar > d.from && p.bar < d.to) out.push({ bar: p.bar, value: lowered(p.bar) });
    out.push({ bar: d.to, value: lowered(d.to) });
    out.push({ bar: d.to + release, value: normal(d.to + release) });
  }
  return normalizePoints(out);
}
