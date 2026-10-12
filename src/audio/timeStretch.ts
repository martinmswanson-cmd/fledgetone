/**
 * Time-stretching: play a recording faster or slower without changing its pitch, so an audio clip
 * can follow the song's tempo. WSOLA (waveform-similarity overlap-add): the output is built from
 * short overlapping windows of the input, each taken from about where it should be, nudged to
 * where its waveform best continues the window before, so the joins don't beat or click. Good on
 * drums, loops and voices at the small changes tempo edits make (it smears sharp hits a little
 * beyond about ±30%). Plain arrays, so Node can unit-test it.
 */

/** Window length, in seconds: long enough for low notes, short enough to keep hits tight. */
const WINDOW_SECONDS = 0.04;
/** How far a window may move to find the best join, either way, in seconds. */
const SEARCH_SECONDS = 0.012;
/** The first, coarse search works on the input averaged over this many samples. */
const DECIMATE = 8;

/**
 * `input` (one array per channel) played `ratio` times as fast, at the same pitch: ratio 2 is half
 * as long, 0.5 twice as long. The channels are stretched together (one set of joins, chosen on
 * their mix), so a stereo image stays put.
 */
export function stretchChannels(input: readonly Float32Array[], ratio: number, sampleRate: number): Float32Array[] {
  const length = input[0]?.length ?? 0;
  if (!length || !(ratio > 0)) return input.map((ch) => ch.slice());
  if (Math.abs(ratio - 1) < 1e-6) return input.map((ch) => ch.slice());
  const outLength = Math.max(1, Math.round(length / ratio));
  const n = Math.max(64, 2 * Math.round((WINDOW_SECONDS * sampleRate) / 2));
  const hop = n / 2;
  const search = Math.max(DECIMATE, Math.round(SEARCH_SECONDS * sampleRate));
  // Periodic Hann: two of them half a window apart add up to exactly 1
  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);

  // The mix, and a coarse copy of it for the first search
  const mono = new Float32Array(length);
  for (const ch of input) for (let i = 0; i < length; i++) mono[i] += ch[i];
  const coarseLength = Math.ceil(length / DECIMATE);
  const coarse = new Float32Array(coarseLength);
  for (let j = 0; j < coarseLength; j++) {
    let sum = 0;
    const end = Math.min(length, (j + 1) * DECIMATE);
    for (let i = j * DECIMATE; i < end; i++) sum += mono[i];
    coarse[j] = sum;
  }
  const at = (a: Float32Array, i: number) => (i >= 0 && i < a.length ? a[i] : 0);
  // Hits (drum strikes, plucks) are placed exactly where they belong in the output and the windows
  // over them carry straight on, so each keeps its punch and its timing
  const hits = onsets(mono, sampleRate);
  let nextHit = 0;
  /** The hit being carried through, in input samples (-1: none) */
  let locked = -1;

  /** How alike the input is at `a` and at `b`, over `len` samples of `signal` (every `step`th). */
  const similarity = (signal: Float32Array, a: number, b: number, len: number) => {
    let sum = 0;
    if (a < 0 || b < 0 || a + len > signal.length || b + len > signal.length) {
      for (let i = 0; i < len; i++) sum += at(signal, a + i) * at(signal, b + i);
      return sum;
    }
    for (let i = 0; i < len; i++) sum += signal[a + i] * signal[b + i];
    return sum;
  };

  const output = input.map(() => new Float32Array(outLength + n));
  let prev = 0;
  const frames = Math.ceil(outLength / hop) + 1;
  for (let k = 0; k < frames; k++) {
    const outPos = k * hop;
    const nominal = Math.round(outPos * ratio);
    let start = nominal;
    const target = prev + hop;
    let placed = false;
    if (k > 0 && locked >= target && locked < target + n) {
      // Still over the hit: carry on, so its windows add up seamlessly
      start = target;
      placed = true;
    } else {
      locked = -1;
      while (nextHit < hits.length && hits[nextHit] / ratio < outPos) nextHit++;
      if (nextHit < hits.length && hits[nextHit] / ratio < outPos + n) {
        // A hit comes into this window: put it exactly on time (it enters past the window's
        // middle, so the next window, carrying on, covers it too)
        const h = hits[nextHit++];
        const at = Math.round(h - h / ratio + outPos);
        if (Math.abs(at - nominal) <= 2 * search) {
          start = at;
          locked = h;
          placed = true;
        }
      }
    }
    if (k > 0 && !placed) {
      // Where the last window would have carried on: find the start near `nominal` most like it
      const len = Math.round(n / 4);
      let best = -Infinity;
      let bestCoarse = 0;
      const lo = Math.round((nominal - search) / DECIMATE);
      const hi = Math.round((nominal + search) / DECIMATE);
      const t = Math.round(target / DECIMATE);
      for (let c = lo; c <= hi; c++) {
        const score = similarity(coarse, c, t, Math.ceil(len / DECIMATE));
        if (score > best) {
          best = score;
          bestCoarse = c;
        }
      }
      best = -Infinity;
      for (let d = bestCoarse * DECIMATE - DECIMATE; d <= bestCoarse * DECIMATE + DECIMATE; d++) {
        if (Math.abs(d - nominal) > search) continue;
        const score = similarity(mono, d, target, len);
        if (score > best) {
          best = score;
          start = d;
        }
      }
    }
    prev = start;
    for (let c = 0; c < input.length; c++) {
      const src = input[c];
      const dst = output[c];
      for (let i = 0; i < n; i++) {
        const s = start + i;
        if (s >= 0 && s < length) dst[outPos + i] += src[s] * window[i];
      }
    }
  }
  // The first half window only had one window over it: bring it up to full level
  for (const dst of output) for (let i = 0; i < hop && i < outLength; i++) dst[i] /= Math.max(window[i], 1e-3);
  return output.map((ch) => ch.slice(0, outLength));
}

/** Where the hits (sudden rises in loudness) are in `x`, in samples, in order. */
function onsets(x: Float32Array, sampleRate: number): number[] {
  const block = 128;
  const blocks = Math.floor(x.length / block);
  const energy = new Float32Array(blocks);
  let peak = 0;
  for (let b = 0; b < blocks; b++) {
    let e = 0;
    for (let i = b * block; i < (b + 1) * block; i++) e += x[i] * x[i];
    energy[b] = e;
    peak = Math.max(peak, e);
  }
  const floor = peak * 1e-4;
  const minGap = Math.round((0.05 * sampleRate) / block);
  const found: number[] = [];
  let last = -minGap;
  for (let b = 8; b < blocks; b++) {
    let before = 0;
    for (let j = b - 8; j < b; j++) before += energy[j];
    before /= 8;
    if (energy[b] > floor && energy[b] > 4 * before + 1e-12 && b - last >= minGap) {
      found.push(b * block);
      last = b;
    }
  }
  return found;
}
