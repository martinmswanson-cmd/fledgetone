/**
 * Maths on a recording's samples as it loads, to keep it small in memory without changing how it
 * sounds: where its silent tail can be cut, whether its two channels are one sound twice (a mono
 * recording saved as stereo, as many soundfont files are), and a coarse outline of its level over
 * time (for choosing which note to let go when too many sound: see noteStealing.ts).
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
