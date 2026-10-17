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

/**
 * Sing `x` again with the pitch moved by `shift` semitones (one value per frame of `frames`),
 * keeping its timing (TD-PSOLA). Unvoiced stretches are copied as they are.
 */
export function psola(x: Float32Array, sampleRate: number, frames: readonly PitchFrame[], shift: readonly number[]): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const weight = new Float32Array(n);
  const frameAt = (t: number) => Math.max(0, Math.min(frames.length - 1, Math.round((t / sampleRate - (frames[0]?.time ?? 0)) / HOP_SECONDS)));
  const UNVOICED = Math.round(0.005 * sampleRate);
  // Analysis marks: one per cycle where voiced (on the cycle's peak), every 5 ms elsewhere
  const marks: Array<{ at: number; period: number; exact: number }> = [];
  let t = 0;
  while (t < n) {
    const f = frames[frameAt(t)];
    if (!f || f.hz <= 0) {
      marks.push({ at: t, period: UNVOICED, exact: UNVOICED });
      t += UNVOICED;
      continue;
    }
    const period = Math.round(sampleRate / f.hz);
    // Settle on the strongest sample within the next cycle, so marks sit on the same point of each wave
    let best = t;
    let bestV = -Infinity;
    const lo = marks.length && marks[marks.length - 1].period !== UNVOICED ? t - Math.round(period * 0.2) : t;
    for (let i = Math.max(0, lo); i < Math.min(n, t + (marks.length ? Math.round(period * 0.2) : period)); i++) {
      if (Math.abs(x[i]) > bestV) {
        bestV = Math.abs(x[i]);
        best = i;
      }
    }
    if (marks.length && best <= marks[marks.length - 1].at) best = t;
    marks.push({ at: best, period, exact: sampleRate / f.hz });
    t = best + period;
  }
  // Synthesis: a mark every (period / ratio), each taking the slice of the nearest analysis mark
  let m = 0;
  let s = 0;
  while (s < n) {
    while (m + 1 < marks.length && Math.abs(marks[m + 1].at - s) <= Math.abs(marks[m].at - s)) m++;
    const mark = marks[m];
    const frame = frameAt(s);
    const ratio = mark.period === UNVOICED ? 1 : 2 ** ((shift[frame] ?? 0) / 12);
    const p = mark.period;
    const at = Math.round(s);
    // A two-period Hann slice around the analysis mark, laid down at s
    for (let i = -p; i < p; i++) {
      const src = mark.at + i;
      const dst = at + i;
      if (src < 0 || src >= n || dst < 0 || dst >= n) continue;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * i) / p);
      out[dst] += x[src] * w;
      weight[dst] += w;
    }
    // (the exact period, not the slice's whole samples, so the new pitch isn't rounded off)
    s += Math.max(8, mark.exact / ratio);
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
