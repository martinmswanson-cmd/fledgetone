/**
 * Scene-cut detection maths: how different two video frames look, and which of the differences
 * along a video are cuts. A frame is a small picture (RGB bytes); two frames differ by their
 * pixels and by their colour histograms, so both a camera move and a lighting change score low
 * while a hard cut scores high. A cut must stand out from the frames around it, which keeps fast
 * action from reading as a run of cuts. No browser or store here, so Node can unit-test it.
 */

const BINS = 8;

/** How different two equally sized RGB(A) frames are, 0 (same) to 1. */
export function frameDifference(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array, channels = 4): number {
  const pixels = Math.floor(Math.min(a.length, b.length) / channels);
  if (!pixels) return 0;
  let diff = 0;
  const ha = new Float64Array(BINS * 3);
  const hb = new Float64Array(BINS * 3);
  for (let p = 0; p < pixels; p++) {
    const i = p * channels;
    for (let c = 0; c < 3; c++) {
      diff += Math.abs(a[i + c] - b[i + c]);
      ha[c * BINS + ((a[i + c] * BINS) >> 8)]++;
      hb[c * BINS + ((b[i + c] * BINS) >> 8)]++;
    }
  }
  let hist = 0;
  for (let k = 0; k < ha.length; k++) hist += Math.abs(ha[k] - hb[k]);
  // Pixels: mean change out of 255; histograms: share of the picture whose colours moved
  return 0.5 * (diff / (pixels * 3 * 255)) + 0.5 * (hist / (pixels * 3 * 2));
}

export interface CutOptions {
  /** A difference at least this big can be a cut (0 to 1) */
  threshold?: number;
  /** ...and at least this many times the typical difference around it */
  contrast?: number;
  /** Seconds: no two cuts closer than this */
  minGap?: number;
}

/**
 * Which steps are cuts: `diffs[i]` is the difference between the frames at `times[i]` and
 * `times[i + 1]`. Returns the indexes of the steps that hold a cut.
 */
export function pickCuts(diffs: readonly number[], times: readonly number[], { threshold = 0.25, contrast = 2.5, minGap = 0.4 }: CutOptions = {}): number[] {
  const out: number[] = [];
  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    if (d < threshold) continue;
    // The typical difference nearby, leaving this step out
    const around: number[] = [];
    for (let k = Math.max(0, i - 6); k <= Math.min(diffs.length - 1, i + 6); k++) if (k !== i) around.push(diffs[k]);
    around.sort((x, y) => x - y);
    const typical = around.length ? around[Math.floor(around.length / 2)] : 0;
    if (d < contrast * Math.max(typical, 0.02)) continue;
    // A local peak (a cut seen across two steps counts once, at its bigger step)
    if ((i > 0 && diffs[i - 1] > d) || (i + 1 < diffs.length && diffs[i + 1] >= d)) continue;
    const last = out[out.length - 1];
    if (last !== undefined && times[i + 1] - times[last + 1] < minGap) {
      if (d > diffs[last]) out[out.length - 1] = i;
      continue;
    }
    out.push(i);
  }
  return out;
}
