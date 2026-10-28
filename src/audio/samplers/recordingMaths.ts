/**
 * Maths on a recording's samples as it loads, to keep it small in memory without changing how it
 * sounds: where its silent tail can be cut, whether its two channels are one sound twice (a mono
 * recording saved as stereo, as many soundfont files are), and a coarse outline of its level over
 * time (for choosing which note to let go when too many sound: see noteStealing.ts). Also
 * lengthening a recording that stops dead from varied pieces of its steady part, and the cycle of
 * them that loops for a note held longer; giving a recording cut off while it still sounds the rest
 * of its decay; and taking out the DC some recordings carry.
 *
 * Plain arrays of samples in, numbers out: no Web Audio here, so Node can test it.
 */

/** A recording's tail is cut after its last sample above this far under its peak (about -90 dB). */
export const TAIL_FLOOR = 10 ** (-90 / 20);
/** How much is kept after that last sample, in seconds. */
export const TAIL_KEEP = 0.02;

/**
 * How many samples of a recording to keep: up to TAIL_KEEP seconds after its last sample above
 * `floor` (TAIL_FLOOR under its peak, or `ceiling` if that's lower: an absolute level the player
 * must still see above it), and never less than `keepSamples` (the end of a loop the recording
 * plays while held, which must stay whole). The whole length if nothing can be cut. Its level
 * outline (levelOutline), if already made, saves reading the whole recording again.
 */
export function keptLength(channels: Float32Array[], sampleRate: number, keepSamples = 0, ceiling = Infinity, outline = levelOutline(channels, sampleRate)): number {
  const length = channels[0]?.length ?? 0;
  let peak = 0;
  for (const p of outline) if (p > peak) peak = p;
  if (peak === 0) return Math.min(length, Math.max(keepSamples, 1));
  const floor = Math.min(peak * TAIL_FLOOR, ceiling);
  // The last stretch of the outline above the floor holds the last sample above it
  let w = outline.length - 1;
  while (w > 0 && !(outline[w] > floor)) w--;
  const step = Math.max(1, Math.round(OUTLINE_STEP * sampleRate));
  let last = 0;
  for (const data of channels) {
    for (let i = Math.min(data.length, (w + 1) * step) - 1; i > last && i >= w * step; i--) {
      if (data[i] > floor || data[i] < -floor) {
        last = i;
        break;
      }
    }
  }
  return Math.min(length, Math.max(keepSamples, last + 1 + Math.round(TAIL_KEEP * sampleRate)));
}

/** Correlation and level difference (dB) of two channels, reading every `stride`th sample. */
function likeness(left: Float32Array, right: Float32Array, stride: number): { correlation: number; levelDb: number; silent: boolean } {
  let ll = 0;
  let rr = 0;
  let lr = 0;
  for (let i = 0; i < left.length; i += stride) {
    const l = left[i];
    const r = right[i];
    ll += l * l;
    rr += r * r;
    lr += l * r;
  }
  if (ll === 0 || rr === 0) return { correlation: ll === rr ? 1 : 0, levelDb: ll === rr ? 0 : Infinity, silent: ll === 0 && rr === 0 };
  return { correlation: lr / Math.sqrt(ll * rr), levelDb: Math.abs(10 * Math.log10(ll / rr)), silent: false };
}

/**
 * True when two channels are the same sound: correlated above 0.999 and within 0.1 dB of each
 * other in level. Played as one channel the result is the same on both sides, as the mixer
 * spreads a one-channel sound equally to left and right. (A look at every 16th sample first
 * rules out most real stereo recordings without reading them whole.)
 */
export function isDualMono(left: Float32Array, right: Float32Array): boolean {
  if (left.length !== right.length) return false;
  const rough = likeness(left, right, 16);
  if (!rough.silent && (rough.correlation < 0.99 || rough.levelDb > 0.5)) return false;
  const exact = likeness(left, right, 1);
  return exact.correlation > 0.999 && exact.levelDb < 0.1;
}

/** One channel holding both of two near-identical ones (their average). */
export function foldToMono(left: Float32Array, right: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(left.length);
  for (let i = 0; i < out.length; i++) out[i] = (left[i] + right[i]) * 0.5;
  return out;
}

/**
 * The window of the DC estimate (removeDc), in seconds: a 100 ms average taken twice, a triangle
 * that passes nothing at 10, 20 and 30 Hz and under -42 dB of anything above 30 Hz, centred so it
 * moves nothing in time.
 */
export const DC_WINDOW = 0.1;
/**
 * The DC a recording must carry on average, against its peak (-60 dB), to be corrected: below it,
 * it's left alone. Measured: the recorded sets (a bass drum, timpani, double bass, electric bass)
 * stay under 0.00075, while the soundfont sets that carry DC (a celesta, a steel-string guitar, a
 * saxophone, an electric grand) reach 0.003 to 0.03. (The average, not the drift's highest: a
 * drum hit moves the drift for an instant, which is its sound, and averages out.) Relative, as an
 * instrument's level correction (InstrumentDef.gain, up to 20 dB and more) turns it up with the rest.
 */
export const DC_RATIO = 0.001;

/** `data` averaged over `width` samples (odd), centred, with silence beyond its ends (into `out`). */
function centredAverage(data: Float32Array, width: number, out: Float32Array): void {
  const half = width >> 1;
  const n = data.length;
  // A running sum in doubles: a long recording's float sum would drift
  let sum = 0;
  for (let i = 0; i < Math.min(n, half); i++) sum += data[i];
  for (let i = 0; i < n; i++) {
    const enter = i + half;
    const leave = i - half - 1;
    if (enter < n) sum += data[enter];
    if (leave >= 0) sum -= data[leave];
    out[i] = sum / width;
  }
}

/**
 * The slow drift in one channel of a recording: its DC, and whatever moves it under about 10 Hz
 * (see DC_WINDOW). Some soundfont recordings carry it: a celesta's notes start with an offset that
 * dies away over 50 ms, a saxophone's builds up as it's held.
 */
export function dcOf(data: Float32Array, sampleRate: number): Float32Array<ArrayBuffer> {
  const width = Math.max(1, Math.round(DC_WINDOW * sampleRate)) | 1;
  const once = new Float32Array(data.length);
  centredAverage(data, width, once);
  const twice = new Float32Array(data.length);
  centredAverage(once, width, twice);
  return twice;
}

/**
 * Take the drift (dcOf) out of a recording's channels, in place, once as it loads: it costs the
 * mix headroom, adds up to a measurable offset over a song of repeated notes, and steps at a note's
 * start or end. Only when it's measurable (an average over DC_RATIO of the peak in a channel): a
 * recording without it is left exactly as it was. Returns whether it changed anything.
 */
export function removeDc(channels: Float32Array[], sampleRate: number): boolean {
  let peak = 0;
  let offset = 0;
  for (const data of channels) {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i];
      const a = data[i] < 0 ? -data[i] : data[i];
      if (a > peak) peak = a;
    }
    offset = Math.max(offset, Math.abs(sum / Math.max(1, data.length)));
  }
  if (!(offset > DC_RATIO * peak)) return false;
  for (const data of channels) {
    const drift = dcOf(data, sampleRate);
    for (let i = 0; i < data.length; i++) data[i] -= drift[i];
  }
  return true;
}

/** The time step of a recording's level outline (levelOutline), in seconds. */
export const OUTLINE_STEP = 0.05;

/**
 * A recording's level over time, coarsely: the highest sample (of any channel) in each
 * OUTLINE_STEP. A piano note's outline falls away; a held string's stays up.
 */
export function levelOutline(channels: Float32Array[], sampleRate: number): Float32Array<ArrayBuffer> {
  const length = channels[0]?.length ?? 0;
  const step = Math.max(1, Math.round(OUTLINE_STEP * sampleRate));
  const out = new Float32Array(Math.max(1, Math.ceil(length / step)));
  for (const data of channels) {
    for (let w = 0; w < out.length; w++) {
      let peak = out[w];
      const end = Math.min(length, (w + 1) * step);
      for (let i = w * step; i < end; i++) {
        const a = data[i] < 0 ? -data[i] : data[i];
        if (a > peak) peak = a;
      }
      out[w] = peak;
    }
  }
  return out;
}

/**
 * Where a lengthened sustain (lengthenSustain) takes its sound from, piece by piece: each piece is
 * `data[from, to)`, crossfaded in over the end of the one before (its first `xf` samples over the
 * last `xf` of what's there), with `norm` keeping the level through the crossfade however alike the
 * two sides are. The pieces after the recording's own [0, end) make one cycle, which repeats until
 * the lengthened recording is full; `loop` is that cycle (from the start of its first crossfade),
 * which plays on seamlessly for a note held longer still, or null when none fits before the fade.
 */
export interface SustainPlan {
  pieces: Array<{ from: number; to: number; norm: number }>;
  loop: [number, number] | null;
}

/** The normalised correlation of `a` and `b` (same length), reading every `stride`th sample. */
function correlation(data: Float32Array, a: number, b: number, n: number, stride: number): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let k = 0; k < n; k += stride) {
    const x = data[a + k];
    const y = data[b + k];
    ab += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * The start near `at` (within `reach` samples either way, inside [lo, hi]) whose next `n` samples
 * best match `data[ref, ref + n)`, and how well (correlation). The search is coarse (every
 * other start, every fourth sample), then exact around the best.
 */
function bestMatch(data: Float32Array, ref: number, at: number, reach: number, lo: number, hi: number, n: number): [number, number] {
  let best = at;
  let score = -2;
  const from = Math.max(lo, at - reach);
  const to = Math.min(hi, at + reach);
  for (let s = from; s <= to; s += 2) {
    const r = correlation(data, ref, s, n, 4);
    if (r > score) [best, score] = [s, r];
  }
  for (let s = Math.max(lo, best - 1); s <= Math.min(hi, best + 1); s++) {
    const r = correlation(data, ref, s, n, 1);
    if (s === Math.max(lo, best - 1) || r > score) [best, score] = [s, r];
  }
  return [best, score];
}

/** The golden ratio's fractional part: successive multiples spread evenly over [0, 1). */
const SPREAD = 0.6180339887;

/**
 * How to lengthen a recording that stops dead (lengthenSustain): from its steady stretch
 * [start, end), a cycle of pieces of it, each a different part of the stretch and a different
 * length (0.55 to 0.95 of it), the last ending where the recording does, so the cycle runs as
 * long as the lengthened recording has room for (up to `length` less its `fade`) and the joins
 * don't come round at one steady beat. Repeating the whole stretch instead made the slow movement
 * in it (a vibrato, a pad's shimmer) come round every 1.7 s, which a held note let you hear.
 * Each piece starts where it best continues the sound before it (searched within `reach` samples:
 * a period of the note), so the crossfades don't cancel.
 *
 * `data` is the recording (one channel, or both mixed: the plan is the same for every channel).
 */
export function planSustain(data: Float32Array, start: number, end: number, xf: number, length: number, fade: number, reach: number): SustainPlan {
  const stretch = end - start;
  // (the room the cycle has, less what moving its last piece to a better join can add)
  const room = length - fade - (end - xf) - reach;
  if (stretch < xf * 3 || room < stretch - xf) {
    // (no room for a cycle of pieces: the stretch over and over)
    const pieces = [{ from: start, to: end, norm: stretch >= xf * 2 ? Math.max(0, correlation(data, end - xf, start, xf, 1)) : 1 }];
    const period = stretch - xf;
    return { pieces, loop: period > 0 && end - xf + period <= length - fade ? [end - xf, end - xf + period] : null };
  }
  // As many pieces as fill the room at about 3/4 of the stretch each (each adds its length less the crossfade)
  const count = Math.max(1, Math.round(room / (0.75 * stretch - xf)));
  const each = Math.min(stretch, Math.max(xf * 3, Math.floor(room / count) + xf));
  const pieces: SustainPlan['pieces'] = [];
  let ref = end - xf;
  let used = 0;
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    // (lengths vary around `each`, the room shared out so the cycle still fits)
    const want = last ? Math.min(stretch, room - used + xf) : Math.round(Math.min(stretch, each * (0.85 + 0.3 * ((i * SPREAD) % 1))));
    const len = Math.max(xf * 3, Math.min(want, stretch));
    let from: number;
    let score: number;
    if (last) {
      // (ends where the recording does, so the cycle's last join is its first)
      [from, score] = bestMatch(data, ref, end - len, reach, start, end - xf * 3, xf);
    } else {
      const at = start + Math.round(((i + 1) * SPREAD % 1) * (stretch - len));
      [from, score] = bestMatch(data, ref, at, reach, start, end - len, xf);
    }
    const to = last ? end : from + len;
    pieces.push({ from, to, norm: Math.max(0, Math.min(1, score)) });
    used += to - from - xf;
    ref = to - xf;
  }
  const cycle = pieces.reduce((n, p) => n + p.to - p.from - xf, 0);
  const at = end - xf;
  return { pieces, loop: at + cycle <= length - fade ? [at, at + cycle] : null };
}

/**
 * A recording that stops dead lengthened to `out.length` samples (into `out`): `data` up to `end`,
 * then the pieces of `plan` (planSustain) in turn, over and over, each crossfading in over `xf`
 * samples from the end of the one before; the last `fade` samples fade out. The crossfade keeps
 * the level whether the two sides are alike (they add up) or not (their powers do).
 */
export function lengthenSustain(out: Float32Array, data: Float32Array, end: number, plan: SustainPlan, xf: number, fade: number): void {
  const length = out.length;
  out.set(data.subarray(0, Math.min(end, length)));
  let pos = end;
  for (let i = 0; pos < length; i = (i + 1) % plan.pieces.length) {
    const { from, to, norm } = plan.pieces[i];
    const at = pos - xf;
    for (let k = 0; k < to - from && at + k < length; k++) {
      const v = data[from + k];
      if (k < xf) {
        const w = Math.sin(((k + 0.5) / xf) * (Math.PI / 2)) ** 2;
        const g = 1 / Math.sqrt((1 - w) ** 2 + w * w + 2 * norm * (1 - w) * w);
        out[at + k] = (out[at + k] * (1 - w) + v * w) * g;
      } else out[at + k] = v;
    }
    pos = at + (to - from);
  }
  const n = Math.min(length, fade);
  for (let k = 0; k < n; k++) out[length - 1 - k] *= k / n;
}

/**
 * A recording cut off while it still sounds (the General MIDI soundfont notes all end at 3.1 s:
 * a dulcimer, a crystal or a harp note held past that, or rung on by its release, stopped dead)
 * is given the rest of its decay. Cut off: its last 150 ms stand within RING_CUT_DB of its
 * loudest 20 ms.
 */
export const RING_CUT_DB = 45;
/** The slowest a lengthened decay falls (dB a second): a sound that had stopped falling (a pad-like bell) still dies away. */
export const RING_SLOWEST = -4;

/** How a cut-off recording rings on (ringOn): from `at`, its stretch [from, at) repeated, `rate` dB a second quieter, to `length` samples. */
export interface RingPlan {
  from: number;
  at: number;
  rate: number;
  length: number;
}

/** 20 ms power levels of `data` in dB. */
function levelsDb(data: Float32Array, hop: number): Float64Array {
  const n = Math.floor(data.length / hop);
  const out = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (let i = w * hop; i < (w + 1) * hop; i++) sum += data[i] * data[i];
    out[w] = 10 * Math.log10(sum / hop + 1e-20);
  }
  return out;
}

/**
 * How to give a recording cut off while sounding (one channel, or its channels mixed) the rest of
 * its decay, or null when it wasn't cut off: the rate it was dying away at over its later part
 * (a straight line through its level, from 45% of the way in; no slower than RING_SLOWEST), on
 * until 60 dB under its peak or `most` samples. It rings on from 30 ms before its end (past any
 * click there) with the stretch before that, a whole number of the note's periods (`hz`; 0 for
 * none) up to 0.3 s, moved to where it best continues the sound.
 */
export function planRingOn(data: Float32Array, sampleRate: number, hz: number, most: number): RingPlan | null {
  const hop = Math.round(0.02 * sampleRate);
  const env = levelsDb(data, hop);
  if (env.length < 25) return null;
  let top = -Infinity;
  let peakAt = 0;
  env.forEach((v, i) => {
    if (v > top) [top, peakAt] = [v, i];
  });
  const lastFrames = env.subarray(env.length - 8, env.length - 1);
  const tail = lastFrames.reduce((a, v) => a + v, 0) / lastFrames.length;
  if (tail < top - RING_CUT_DB) return null;
  // The decay over the later part
  const a = Math.max(peakAt + Math.round(0.2 / 0.02), Math.floor(env.length * 0.45));
  const b = env.length - 3;
  let rate = RING_SLOWEST;
  if (b - a >= 15) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const n = b - a;
    for (let i = a; i < b; i++) {
      const x = i * 0.02;
      sx += x;
      sy += env[i];
      sxx += x * x;
      sxy += x * env[i];
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    if (Number.isFinite(slope)) rate = Math.min(RING_SLOWEST, slope);
  }
  const at = data.length - Math.round(0.03 * sampleRate);
  const toGo = 60 - (top - tail);
  const length = Math.min(most, at + Math.round((toGo / -rate) * sampleRate));
  if (length < at + Math.round(0.1 * sampleRate)) return null;
  const period = hz > 0 ? sampleRate / hz : 0;
  const span = Math.min(0.3 * sampleRate, at - 0.15 * sampleRate);
  const whole = period > 0 && period <= span ? Math.floor(span / period) * period : span;
  const len = Math.round(whole);
  const xf = Math.min(Math.round(0.04 * sampleRate), len >> 1);
  // (the repeat's start moved to where the sound before it best matches the sound before the cut)
  const reach = Math.round(period > 0 ? period / 2 : 0.005 * sampleRate);
  const [from] = bestMatch(data, at - xf, at - len - xf, reach, 0, at - xf * 3, xf);
  return { from: from + xf, at, rate, length };
}

/**
 * A cut-off recording rung on (planRingOn) into `out` (its plan's length): `data` up to the plan's
 * `at`, then [from, at) over and over, each repeat as much quieter as the decay's rate says and
 * crossfaded in over 40 ms, the highs (over three times the note, `hz`, or 2 kHz) dying half again
 * as fast, as a real string's or bar's overtones do. If it reaches the plan's length still
 * sounding, it fades out over the last 1.5 s.
 */
export function ringOn(out: Float32Array, data: Float32Array, plan: RingPlan, sampleRate: number, hz: number): void {
  const { from, at, rate, length } = plan;
  const len = at - from;
  const xf = Math.min(Math.round(0.04 * sampleRate), len >> 1);
  out.set(data.subarray(0, at));
  const g = 10 ** ((rate * len) / sampleRate / 20);
  let pos = at;
  for (let rep = 1; pos < length; rep++) {
    const gain = g ** rep;
    const start = pos - xf;
    for (let k = 0; k < len + xf && start + k < length; k++) {
      const v = data[from - xf + k] * gain;
      if (k < xf) {
        const w = Math.sin(((k + 0.5) / xf) * (Math.PI / 2)) ** 2;
        out[start + k] = out[start + k] * (1 - w) + v * w;
      } else out[start + k] = v;
    }
    pos = start + len + xf;
  }
  // The highs die faster from the cut on: a one-pole lowpass, and the rest above it fading
  const cutoff = Math.min(hz > 0 ? 3 * hz : 2000, 0.4 * sampleRate);
  const c = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let lp = 0;
  for (let i = Math.max(0, at - Math.round(0.05 * sampleRate)); i < length; i++) {
    lp += c * (out[i] - lp);
    if (i >= at) out[i] = lp + (out[i] - lp) * 10 ** ((0.5 * rate * (i - at)) / sampleRate / 20);
  }
  // Still sounding at the end: a fade
  const fade = Math.min(Math.round(1.5 * sampleRate), length - at);
  for (let k = 0; k < fade; k++) out[length - 1 - k] *= Math.sin((k / fade) * (Math.PI / 2)) ** 2;
}
