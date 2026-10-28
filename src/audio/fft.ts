/**
 * A fast in-place complex FFT for the spectral audio work (the phase vocoder in phaseVocoder.ts,
 * the formant shift): radix-2, with its twiddle factors and bit-reversal order worked out once per
 * size and kept, so the thousands of transforms a stretch takes cost only the butterflies. Plain
 * arrays, so Node can unit-test it.
 */

interface Plan {
  n: number;
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

const plans = new Map<number, Plan>();

function planFor(n: number): Plan {
  let plan = plans.get(n);
  if (plan) return plan;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size ${n} is not a power of two`);
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  plan = { n, rev, cos, sin };
  plans.set(n, plan);
  return plan;
}

/**
 * The FFT of (re, im) in place: X[k] = sum x[n] e^(-2 pi i k n / N). With `inverse`, the inverse
 * transform, scaled by 1/N, so a round trip gives back what went in. N must be a power of two.
 */
export function fftInPlace(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { rev, cos, sin } = planFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  if (n >= 4) {
    // The first two stages together (their twiddles are 1 and -i)
    for (let s = 0; s < n; s += 4) {
      const b0r = re[s] + re[s + 1];
      const b0i = im[s] + im[s + 1];
      const b1r = re[s] - re[s + 1];
      const b1i = im[s] - im[s + 1];
      const b2r = re[s + 2] + re[s + 3];
      const b2i = im[s + 2] + im[s + 3];
      const b3r = re[s + 2] - re[s + 3];
      const b3i = im[s + 2] - im[s + 3];
      re[s] = b0r + b2r;
      im[s] = b0i + b2i;
      re[s + 2] = b0r - b2r;
      im[s + 2] = b0i - b2i;
      const tr = inverse ? -b3i : b3i;
      const ti = inverse ? b3r : -b3r;
      re[s + 1] = b1r + tr;
      im[s + 1] = b1i + ti;
      re[s + 3] = b1r - tr;
      im[s + 3] = b1i - ti;
    }
  } else {
    const tr = re[1];
    const ti = im[1];
    re[1] = re[0] - tr;
    im[1] = im[0] - ti;
    re[0] += tr;
    im[0] += ti;
  }
  const sign = inverse ? -1 : 1;
  for (let size = 8; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let k = 0; k < half; k++) {
      const wr = cos[k * step];
      const wi = sign * sin[k * step];
      for (let a = k; a < n; a += size) {
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }
}
