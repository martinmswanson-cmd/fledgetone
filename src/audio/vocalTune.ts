/**
 * Vocal tuning: find the pitch a voice (or any one-note-at-a-time instrument) is singing, pull it
 * towards the nearest note of the song's key, and sing it again at the corrected pitch with its
 * timing, length and character unchanged.
 *
 * - Pitch: YIN (de Cheveigné & Kawahara) every 10 ms, 60 Hz to 1 kHz, with a voiced / unvoiced call.
 * - Target: the nearest note of the scale; `strength` is how far the way there (100% lands on it),
 *   and `speed` how quickly it gets there (0 ms snaps at once, the hard tuned sound; 50 to 200 ms
 *   keeps slides and vibrato natural).
 * - Resynthesis: TD-PSOLA. Two-period slices of the voice, one per cycle, are laid down closer
 *   together (higher) or further apart (lower), each where it was in time, so the pitch moves and
 *   nothing else does. Breaths and consonants (unvoiced) pass straight through.
 *
 * Plain arrays, so Node can unit-test it.
 */
import { sincAt } from './resample';

export interface PitchFrame {
  /** Seconds into the sound */
  time: number;
  /** Hz, or 0 where it isn't a pitched sound (a breath, an S, silence) */
  hz: number;
}

export interface TuneSettings {
  /** Key root, 0 = C ... 11 = B */
  root: number;
  /** The notes allowed, as semitones up from the root (all 12: chromatic) */
  steps: readonly number[];
  /** 0 to 1: how far towards the note */
  strength: number;
  /** Milliseconds to get there */
  speed: number;
}

export const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const HOP_SECONDS = 0.01;
const MIN_HZ = 60;
const MAX_HZ = 1000;
/** YIN's threshold: lower is stricter about what counts as pitched */
const YIN_THRESHOLD = 0.15;

export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** The pitch every 10 ms (YIN). Above 32 kHz it listens at half the rate (a voice's pitch is far below), four times faster. */
export function detectPitch(input: Float32Array, rate: number): PitchFrame[] {
  let x = input;
  let sampleRate = rate;
  if (rate > 32000) {
    x = new Float32Array(Math.floor(input.length / 2));
    for (let i = 0; i < x.length; i++) x[i] = 0.5 * (input[2 * i] + input[2 * i + 1]);
    sampleRate = rate / 2;
  }
  // Fractional hop: frame k starts at round(k * hop), so frames sit exactly HOP_SECONDS apart
  // (a rounded hop drifts, e.g. 221 samples at 22050 Hz is 10.023 ms)
  const hop = HOP_SECONDS * sampleRate;
  const maxLag = Math.floor(sampleRate / MIN_HZ);
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const w = maxLag; // integration window
  const frames: PitchFrame[] = [];
  const d = new Float32Array(maxLag + 1);
  // Quiet frames are unvoiced: well under the loudest part
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const floor = peak * 0.03;
  for (let k = 0, start = 0; start + w + maxLag < x.length; k++, start = Math.round(k * hop)) {
    let level = 0;
    for (let i = start; i < start + w; i++) level = Math.max(level, Math.abs(x[i]));
    const time = (start + w / 2) / sampleRate;
    if (level < floor) {
      frames.push({ time, hz: 0 });
      continue;
    }
    // Difference function and its cumulative-mean normalisation
    d[0] = 1;
    let running = 0;
    let found = -1;
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      for (let i = start; i < start + w; i++) {
        const diff = x[i] - x[i + tau];
        sum += diff * diff;
      }
      running += sum;
      d[tau] = running > 0 ? (sum * tau) / running : 1;
      if (found < 0 && tau > minLag && d[tau - 1] < YIN_THRESHOLD && d[tau] > d[tau - 1]) {
        found = tau - 1;
        break;
      }
    }
    if (found < 0) {
      frames.push({ time, hz: 0 });
      continue;
    }
    // Parabolic interpolation for a lag between samples
    const a = d[found - 1] ?? d[found];
    const b = d[found];
    const c = d[found + 1] ?? d[found];
    const denom = a - 2 * b + c;
    const lag = found + (denom !== 0 ? (0.5 * (a - c)) / denom : 0);
    frames.push({ time, hz: sampleRate / lag });
  }
  // Lone voiced or unvoiced frames are glitches: smooth them over
  for (let i = 1; i < frames.length - 1; i++) {
    const [p, f, n] = [frames[i - 1], frames[i], frames[i + 1]];
    if (f.hz > 0 && p.hz === 0 && n.hz === 0) f.hz = 0;
    else if (f.hz === 0 && p.hz > 0 && n.hz > 0) f.hz = Math.sqrt(p.hz * n.hz);
    // An octave jump for a single frame
    else if (f.hz > 0 && p.hz > 0 && n.hz > 0 && Math.abs(Math.log2(f.hz / Math.sqrt(p.hz * n.hz))) > 0.8) f.hz = Math.sqrt(p.hz * n.hz);
  }
  return frames;
}

/** The nearest note of the scale to `midi` (a MIDI note number, fractional). */
export function nearestNote(midi: number, root: number, steps: readonly number[]): number {
  let best = Math.round(midi);
  let distance = Infinity;
  const base = Math.floor(midi) - 12;
  for (let n = base; n <= base + 24; n++) {
    if (!steps.includes((((n - root) % 12) + 12) % 12)) continue;
    const dist = Math.abs(n - midi);
    if (dist < distance) {
      distance = dist;
      best = n;
    }
  }
  return best;
}

/**
 * The pitch change, in semitones, at each frame: towards the scale's nearest note by `strength`,
 * eased in over `speed` ms. 0 where unvoiced.
 */
export function corrections(frames: readonly PitchFrame[], s: TuneSettings): number[] {
  const out: number[] = [];
  // One-pole smoothing towards the wanted correction; reset at the start of each phrase
  const k = s.speed <= 0 ? 1 : 1 - Math.exp(-(HOP_SECONDS * 1000) / s.speed);
  let current = 0;
  let voiced = false;
  for (const f of frames) {
    if (f.hz <= 0) {
      out.push(0);
      voiced = false;
      continue;
    }
    const midi = hzToMidi(f.hz);
    const wanted = (nearestNote(midi, s.root, s.steps) - midi) * s.strength;
    current = voiced ? current + (wanted - current) * k : wanted;
    voiced = true;
    out.push(current);
  }
  return out;
}

/** How alike `x` is at `a` and `b` (fractional, read between samples) over `len` samples: normalised correlation. */
function likeness(x: Float32Array, a: number, b: number, len: number): number {
  let xy = 0;
  let xx = 0;
  let yy = 0;
  const ia = Math.round(a);
  const ib = Math.round(b);
  for (let i = 0; i < len; i++) {
    const u = ia + i >= 0 && ia + i < x.length ? x[ia + i] : 0;
    const v = ib + i >= 0 && ib + i < x.length ? x[ib + i] : 0;
    xy += u * v;
    xx += u * u;
    yy += v * v;
  }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
}

/**
 * The phase (radians) of the fundamental of period `period` in `x` around the fractional sample
 * `at` (two periods, Hann-weighted, read at `at` exactly), and how strong it is there.
 */
function fundamentalPhase(x: Float32Array, at: number, period: number): { phase: number; strength: number } | null {
  const w = (2 * Math.PI) / period;
  const lo = Math.ceil(at - period);
  const hi = Math.floor(at + period);
  if (lo < 0 || hi >= x.length) return null;
  let re = 0;
  let im = 0;
  for (let i = lo; i <= hi; i++) {
    const t = i - at;
    const g = x[i] * (0.5 + 0.5 * Math.cos((Math.PI * t) / period));
    re += g * Math.cos(w * t);
    im -= g * Math.sin(w * t);
  }
  return { phase: Math.atan2(im, re), strength: Math.hypot(re, im) };
}

/** An analysis mark: a point of the sound (fractional samples) and the period there (UNVOICED marks: none). */
interface Mark {
  at: number;
  period: number;
  voiced: boolean;
}

/**
 * Where the cycles of `x` are: one mark per cycle where voiced, each a period after the last (the
 * period measured there by how the waveform repeats, to a fraction of a sample, so every slice is
 * one true cycle on from the one before), every 5 ms elsewhere.
 */
export function pitchMarks(x: Float32Array, sampleRate: number, frames: readonly PitchFrame[]): Mark[] {
  const n = x.length;
  const frameAt = (t: number) => Math.max(0, Math.min(frames.length - 1, Math.round((t / sampleRate - (frames[0]?.time ?? 0)) / HOP_SECONDS)));
  const unvoiced = Math.round(0.005 * sampleRate);
  const marks: Mark[] = [];
  let t = 0;
  while (t < n) {
    const f = frames[frameAt(t)];
    if (!f || f.hz <= 0) {
      marks.push({ at: t, period: unvoiced, voiced: false });
      t += unvoiced;
      continue;
    }
    let period = sampleRate / f.hz;
    const last = marks[marks.length - 1];
    if (!last || !last.voiced) {
      // A voiced stretch starts: on the strongest sample of its first cycle
      let best = Math.floor(t);
      let bestV = -Infinity;
      for (let i = Math.floor(t); i < Math.min(n, t + period); i++) {
        if (Math.abs(x[i]) > bestV) {
          bestV = Math.abs(x[i]);
          best = i;
        }
      }
      marks.push({ at: best, period, voiced: true });
      t = best + period;
      continue;
    }
    // A cycle on: the lag (near the tracked period) at which the waveform repeats best, between samples
    const len = 2 * Math.round(period);
    const reach = Math.max(2, Math.round(period * 0.03));
    const base = Math.round(period);
    let bestLag = base;
    let bestScore = -Infinity;
    const scores: number[] = [];
    for (let d = -reach; d <= reach; d++) {
      const score = likeness(x, last.at, last.at + base + d, len);
      scores.push(score);
      if (score > bestScore) {
        bestScore = score;
        bestLag = base + d;
      }
    }
    const k = bestLag - base + reach;
    if (bestScore > 0.5 && k > 0 && k < scores.length - 1) {
      const [p, q, r] = [scores[k - 1], scores[k], scores[k + 1]];
      const denom = p - 2 * q + r;
      period = bestLag + (denom < 0 ? (0.5 * (p - r)) / denom : 0);
      // Finer: the fundamental's phase a cycle on should be what it was (a waveform's sharp edges
      // pull the correlation's peak a little; the fundamental's phase doesn't)
      const here = fundamentalPhase(x, last.at, period);
      const there = fundamentalPhase(x, last.at + period, period);
      if (here && there && there.strength > 0.3 * here.strength && here.strength > 0.3 * there.strength) {
        let d = there.phase - here.phase;
        d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
        const shift = (d / (2 * Math.PI)) * period;
        if (Math.abs(shift) < 0.25 * reach + 0.5) period -= shift;
      }
    }
    marks.push({ at: last.at + period, period, voiced: true });
    t = last.at + 2 * period;
  }
  // Each measured period has a little error (a few hundredths of a sample) of its own: over a run
  // of cycles, average it out (over 7), and lay the marks along the averaged periods
  for (let a = 0; a < marks.length; ) {
    if (!marks[a].voiced) {
      a++;
      continue;
    }
    let b = a;
    while (b < marks.length && marks[b].voiced) b++;
    const raw = marks.slice(a, b).map((mk) => mk.period);
    for (let j = a + 1; j < b; j++) {
      let sum = 0;
      let count = 0;
      for (let q = Math.max(a + 1, j - 3); q <= Math.min(b - 1, j + 3); q++) {
        sum += raw[q - a];
        count++;
      }
      marks[j].period = sum / count;
      marks[j].at = marks[j - 1].at + marks[j].period;
    }
    if (b - a > 1) marks[a].period = marks[a + 1].period;
    a = b;
  }
  return marks;
}

/**
 * Sing `x` again with the pitch moved by `shift` semitones (one value per frame of `frames`),
 * keeping its timing (TD-PSOLA). Unvoiced stretches are copied as they are. Every slice is read
 * and laid down to a fraction of a sample, so the slices' joins don't scatter noise over the highs.
 */
export function psola(x: Float32Array, sampleRate: number, frames: readonly PitchFrame[], shift: readonly number[]): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const weight = new Float32Array(n);
  const frameAt = (t: number) => Math.max(0, Math.min(frames.length - 1, Math.round((t / sampleRate - (frames[0]?.time ?? 0)) / HOP_SECONDS)));
  const marks = pitchMarks(x, sampleRate, frames);
  // Synthesis: a mark every (period / ratio), each taking the slice of the nearest analysis mark
  let m = 0;
  let s = 0;
  while (s < n) {
    while (m + 1 < marks.length && Math.abs(marks[m + 1].at - s) <= Math.abs(marks[m].at - s)) m++;
    const mark = marks[m];
    const ratio = mark.voiced ? 2 ** ((shift[frameAt(s)] ?? 0) / 12) : 1;
    const p = mark.period;
    // A two-period Hann slice around the analysis mark, laid down centred on s
    const offset = mark.at - s;
    const whole = Number.isInteger(offset);
    for (let dst = Math.max(0, Math.ceil(s - p)); dst < Math.min(n, s + p); dst++) {
      const i = dst - s;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * i) / p);
      if (w <= 0) continue;
      const src = dst + offset;
      const v = whole ? (src >= 0 && src < n ? x[src] : 0) : sincAt(x, src);
      out[dst] += v * w;
      weight[dst] += w;
    }
    s += Math.max(8, p / ratio);
  }
  // Even out the overlaps (slices laid closer together add up to more)
  for (let i = 0; i < n; i++) out[i] = weight[i] > 1e-3 ? out[i] / weight[i] : out[i];
  return out;
}

/** Tune a sound (all channels moved by the pitch of their mix). Returns the new channels and the analysis, for drawing. */
export function tuneChannels(channels: readonly Float32Array[], sampleRate: number, s: TuneSettings): { channels: Float32Array[]; frames: PitchFrame[]; shift: number[] } {
  const mix = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < mix.length; i++) mix[i] += ch[i] / channels.length;
  const frames = detectPitch(mix, sampleRate);
  const shift = corrections(frames, s);
  return { channels: channels.map((ch) => psola(ch, sampleRate, frames, shift)), frames, shift };
}
