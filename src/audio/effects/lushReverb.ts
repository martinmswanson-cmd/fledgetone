/**
 * The "Lush" master reverb: an algorithmic room (a feedback delay network) run as an AudioWorklet,
 * in place of the convolver. A long convolution costs the computer more the longer its tail, and
 * runs even in silence; this costs the same at any decay, a fraction of it, and rests when nothing
 * is playing. Its tail is smooth, dense and gently moving.
 *
 * How it works: the sound, after a short pre-delay, goes through four allpass diffusers per side
 * (which smear each click into a dense wash), then into sixteen delay lines of mutually prime
 * lengths (so their echoes never line up into a pitch). Each line's output is damped, the highs
 * more than the lows, so each band dies at its own RT60, as roomIR.ts's low and high multipliers
 * set it; then a 16 x 16 Hadamard matrix mixes every line into every other and feeds them back.
 * The matrix is orthogonal and every damping gain is under 1, so the loop never gains energy: it's
 * stable at any decay, frozen included. Each line's length drifts slowly (a fraction of a
 * millisecond, at its own rate), read through a first-order allpass so the drift neither dulls
 * nor clicks: this chorusing keeps the tail from ringing metallically. Left and right are two
 * different rows of the mixing matrix, so they're decorrelated.
 *
 * The room runs at half the sample rate (halfband filters down and back up): what reaches the
 * reverb is already damped above 5.5 kHz (busEffects.ts), so the top octave would only cost time.
 *
 * Its level is matched to the generated hall at the same decay: the convolver scales its impulse
 * response by its length (the Web Audio normalization), and the output gain here follows the same
 * curve, so switching between them keeps the reverb about as loud.
 *
 * The kernel is plain JavaScript (no imports, no closures over module state) so the worklet module
 * can embed it with Function.prototype.toString, and the unit test can run it directly.
 */

/** Options fixed when the kernel is made. */
export interface LushOptions {
  /** How much longer the lows ring than the middle (>= 1), as in roomIR.ts. */
  low?: number;
  /** Seconds before the room answers. */
  preDelay?: number;
}

export interface LushKernel {
  /**
   * Process `frames` samples (an even number, as Web Audio's 128 is). `decay`: the middle's RT60
   * in seconds (Infinity holds the tail); `high`: how much shorter the highs ring (0.1 to 1);
   * `size`: the room's size (0.5 to 2, 1 as designed); `freeze`: 1 holds the tail as it is and
   * takes no new sound. Every change is smoothed.
   */
  process: (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, decay: number, high: number, size: number, freeze: number) => void;
  /** Whether it's resting (no sound in, the tail gone): it then costs almost nothing. */
  idle: () => boolean;
}

export function createLushKernel(sampleRate: number, options: LushOptions = {}): LushKernel {
  const sr = sampleRate;
  // The room's own rate
  const fs = sr / 2;
  const N = 16;
  const lowMult = Math.max(1, options.low ?? 1.25);
  // (less the halfband filters' delay, 19 samples there and back)
  const pre = Math.max(1, Math.round((options.preDelay ?? 0.01) * fs - 9.5));

  const isPrime = (n: number) => {
    if (n < 2) return false;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
    return true;
  };
  const primeFrom = (n: number, taken: number[]) => {
    let p = Math.max(2, Math.round(n));
    while (!isPrime(p) || taken.includes(p)) p++;
    return p;
  };
  const pow2 = (n: number) => {
    let s = 1;
    while (s < n) s <<= 1;
    return s;
  };

  // The halfband filters (19 taps, flat to 0.2 of the full rate, -39 dB past 0.3): every other
  // tap is zero but the middle one (1/2), so only these five, each used either side of the middle
  const hb = [0.314515, -0.095116, 0.046588, -0.023941, 0.01364];
  const hbSum = hb.reduce((a, b) => a + b, 0);
  const H0 = (hb[0] * 0.25) / hbSum;
  const H1 = (hb[1] * 0.25) / hbSum;
  const H2 = (hb[2] * 0.25) / hbSum;
  const H3 = (hb[3] * 0.25) / hbSum;
  const H4 = (hb[4] * 0.25) / hbSum;
  // The last 18 samples in (full rate) and the last 9 out of the room (half rate), per side
  let inHistL = new Float64Array(18 + 128);
  let inHistR = new Float64Array(18 + 128);
  let outHistL = new Float64Array(9 + 64);
  let outHistR = new Float64Array(9 + 64);
  let dL = new Float64Array(64);
  let dR = new Float64Array(64);

  // The lines: distinct primes (so mutually prime), spread evenly on a log scale from 21 to 88 ms
  const base: number[] = [];
  for (let i = 0; i < N; i++) base.push(primeFrom(0.021 * fs * Math.pow(0.088 / 0.021, i / (N - 1)), base));
  // Interleave short and long, so neighbours in the matrix differ
  const order = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
  const lineBase = new Float64Array(order.map((k) => base[k]));
  // The drift: about a quarter of a millisecond each way, each line at its own slow rate
  const modDepth = 0.00025 * fs;
  const maxSize = 2;
  // All the lines in one block of memory, each a power of two long (so wrapping is a mask)
  const offsets = new Int32Array(N);
  const masks = new Int32Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    const len = pow2(Math.ceil(lineBase[i] * maxSize + modDepth + 4));
    offsets[i] = total;
    masks[i] = len - 1;
    total += len;
  }
  const mem = new Float32Array(total);
  // The drift and the size move slowly, so the delays are worked out every SUB samples; every
  // line is longer than that, so each step's reads all come from before it
  const SUB = 16;
  const whole = new Int32Array(N);
  const coef = new Float64Array(N);
  const modCos = new Float64Array(N);
  const modSin = new Float64Array(N);
  const rotC = new Float64Array(N);
  const rotS = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const rate = 0.13 + 0.71 * ((i * 0.618034) % 1);
    const w = (2 * Math.PI * rate * SUB) / fs;
    rotC[i] = Math.cos(w);
    rotS[i] = Math.sin(w);
    const phase = i * 2.39996;
    modCos[i] = Math.cos(phase);
    modSin[i] = Math.sin(phase);
  }
  const apState = new Float64Array(N);
  // The damping: each line's sound split into low, middle and high at 300 Hz and 4 kHz
  const cLow = 1 - Math.exp((-2 * Math.PI * 300) / fs);
  const cHigh = 1 - Math.exp((-2 * Math.PI * 4000) / fs);
  const lp1 = new Float64Array(N);
  const lp2 = new Float64Array(N);
  const gLow = new Float64Array(N);
  const gMid = new Float64Array(N);
  const gHigh = new Float64Array(N);
  // One step's worth (SUB samples) of each line's output, and of the diffused input
  const z = new Float64Array(N * SUB);
  const xL = new Float64Array(SUB);
  const xR = new Float64Array(SUB);

  // Hadamard rows: the sound goes in along two (one per side), and the sides hear two others, so
  // all four are orthogonal; the sides' rows come free out of the mixing below
  const row = (k: number) => {
    const r = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      let b = i & k;
      let bits = 0;
      while (b) {
        bits += b & 1;
        b >>= 1;
      }
      r[i] = bits & 1 ? -1 : 1;
    }
    return r;
  };
  const inLv = row(0b0110).map((v) => v / (4 * Math.SQRT2));
  const inRv = row(0b1011).map((v) => v / (4 * Math.SQRT2));
  const OUT_L = 13;
  const OUT_R = 7;

  // The pre-delay and the diffusers (a different set of lengths on each side)
  const preSize = pow2(pre + 1);
  const preL = new Float32Array(preSize);
  const preR = new Float32Array(preSize);
  const diffMs = [
    [4.77, 3.61, 12.73, 9.31],
    [5.13, 3.89, 11.87, 8.69],
  ];
  const diffG = new Float64Array([0.75, 0.75, 0.625, 0.625]);
  // Left's four then right's four, in one block of memory
  const dLen = new Int32Array(8);
  const dOff = new Int32Array(8);
  const dMask = new Int32Array(8);
  let dTotal = 0;
  for (let side = 0; side < 2; side++) {
    const taken: number[] = [];
    for (let d = 0; d < 4; d++) {
      const len = primeFrom((diffMs[side][d] / 1000) * fs, taken);
      taken.push(len);
      const size = pow2(len + 1);
      dLen[side * 4 + d] = len;
      dOff[side * 4 + d] = dTotal;
      dMask[side * 4 + d] = size - 1;
      dTotal += size;
    }
  }
  const dMem = new Float32Array(dTotal);

  // The convolver's level for the hall at this decay: Web Audio scales an impulse response of
  // total energy 1 by 10^(-58/20) / sqrt(1 / (channels x length)) x 44100 / sampleRate, and the
  // hall's (roomIR.ts) is 0.022 + decay x 1.25 x 1.1 seconds long, at most 12
  const hallEnergy = (rt: number) => {
    const n = Math.round(Math.min(12, 0.022 + Math.max(0.2, rt) * 1.25 * 1.1) * sr);
    const k = (44100 / sr) * Math.pow(10, -58 / 20);
    return k * k * 2 * n;
  };
  // The tail's energy (per side, for a unit impulse): in each band a line's sound falls by that
  // band's gain per pass (g^2 + g^4 + ... = g^2 / (1 - g^2)), each band holds its share of the
  // spectrum (an impulse is flat, so most of it is above 4 kHz), and each side hears a sixteenth
  // of the lines. The calibration is measured against the hall, A-weighted, through the filters
  // in front of the reverb (scripts/lushReverb.test.mjs, and a song in the browser)
  const CALIBRATION = 1.33;
  const lowShare = 300 / (fs / 2);
  const midShare = 3700 / (fs / 2);
  const series = (len: number, t: number) => {
    const g2 = Math.exp((-2 * 6.907755 * len) / (t * fs));
    return g2 / (1 - g2);
  };
  // A hair under 1 even frozen, so rounding can never build up
  const top = 1 - 1e-7;
  // Each line's gains for this block (from the smoothed decay, highs, size and freeze), and the
  // output gain that matches the hall's level
  const setGains = (rt: number, high: number, size: number, frozen: number) => {
    const t = Math.min(rt, 12);
    let energy = 0;
    for (let i = 0; i < N; i++) {
      const len = lineBase[i] * size;
      const fall = (d: number) => (d > 1e5 ? 1 : Math.exp((-6.907755 * len) / (d * fs)));
      const hold = (g: number) => Math.min(top, g + (top - g) * frozen);
      gLow[i] = hold(fall(rt * lowMult));
      gMid[i] = hold(fall(rt));
      gHigh[i] = hold(fall(rt * high));
      energy += lowShare * series(len, t * lowMult) + midShare * series(len, t) + (1 - lowShare - midShare) * series(len, t * high);
    }
    energy /= N * N;
    return CALIBRATION * Math.sqrt(hallEnergy(t) / (2 * energy));
  };

  // Smoothed controls, and where everything is
  let rtNow = -1;
  let highNow = -1;
  let freezeNow = 0;
  let sizeNow = 1;
  let gainNow = 0;
  let write = 0;
  let preAt = 0;
  let diffAt = 0;
  let n = 0;
  let quietFor = 0;
  let resting = true;
  // How long (full-rate samples) a sound takes to get through and die out of a quiet room
  const tailLen = 2 * (pre + 4 * dMask[3] + Math.ceil(lineBase[N - 1] * maxSize * 2)) + 64;

  const clear = () => {
    mem.fill(0);
    dMem.fill(0);
    preL.fill(0);
    preR.fill(0);
    apState.fill(0);
    lp1.fill(0);
    lp2.fill(0);
    inHistL.fill(0);
    inHistR.fill(0);
    outHistL.fill(0);
    outHistR.fill(0);
  };

  const process = (inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array, frames: number, decay: number, high: number, size: number, freeze: number) => {
    // Silent in: count how long, and rest once the tail has died away
    let inPeak = 0;
    for (let i = 0; i < frames; i++) {
      const a = Math.abs(inL[i]) + Math.abs(inR[i]);
      if (a > inPeak) inPeak = a;
    }
    const frozen = freeze >= 0.5 ? 1 : 0;
    if (inPeak < 1e-9 && !frozen && freezeNow < 1e-3) quietFor += frames;
    else quietFor = 0;
    if (resting) {
      if (quietFor > 0) {
        outL.fill(0, 0, frames);
        outR.fill(0, 0, frames);
        return;
      }
      resting = false;
    }
    const M = frames >> 1;
    if (inHistL.length < 18 + frames) {
      const grow = (a: Float64Array, size: number) => {
        const b = new Float64Array(size);
        b.set(a.subarray(0, Math.min(a.length, size)));
        return b;
      };
      inHistL = grow(inHistL, 18 + frames);
      inHistR = grow(inHistR, 18 + frames);
      outHistL = grow(outHistL, 9 + M);
      outHistR = grow(outHistR, 9 + M);
      dL = new Float64Array(M);
      dR = new Float64Array(M);
    }

    // Smooth the controls: decay and highs over about 50 ms (the gains are set per block, a tiny
    // step each time), size over a second (it moves the delays, so a fast change would warble)
    const rtTarget = Math.max(0.1, decay > 1e5 ? 1e6 : decay);
    const highTarget = Math.min(1, Math.max(0.1, high));
    const sizeTarget = Math.min(maxSize, Math.max(0.5, size));
    const k = 1 - Math.exp(-frames / (0.05 * sr));
    if (rtNow < 0) {
      rtNow = rtTarget;
      highNow = highTarget;
    } else {
      rtNow = Math.exp(Math.log(rtNow) + (Math.log(rtTarget) - Math.log(rtNow)) * k);
      highNow += (highTarget - highNow) * k;
    }
    freezeNow += (frozen - freezeNow) * k;
    if (Math.abs(freezeNow - frozen) < 1e-4) freezeNow = frozen;
    const gainTarget = setGains(rtNow, highNow, sizeNow, freezeNow);
    const gainStart = gainNow === 0 ? gainTarget : gainNow;
    const gainStep = (gainTarget - gainStart) / M;
    const inGain = 1 - freezeNow;
    const sizeK = 1 - Math.exp(-SUB / fs);

    // Down to the room's rate: the halfband filter, every other sample
    for (let i = 0; i < frames; i++) {
      inHistL[18 + i] = inL[i];
      inHistR[18 + i] = inR[i];
    }
    for (let m = 0; m < M; m++) {
      const c = 2 * m + 10;
      const hl = inHistL;
      const hr = inHistR;
      dL[m] = inGain * (0.5 * hl[c] + H0 * (hl[c - 1] + hl[c + 1]) + H1 * (hl[c - 3] + hl[c + 3]) + H2 * (hl[c - 5] + hl[c + 5]) + H3 * (hl[c - 7] + hl[c + 7]) + H4 * (hl[c - 9] + hl[c + 9]));
      dR[m] = inGain * (0.5 * hr[c] + H0 * (hr[c - 1] + hr[c + 1]) + H1 * (hr[c - 3] + hr[c + 3]) + H2 * (hr[c - 5] + hr[c + 5]) + H3 * (hr[c - 7] + hr[c + 7]) + H4 * (hr[c - 9] + hr[c + 9]));
    }
    inHistL.copyWithin(0, frames, frames + 18);
    inHistR.copyWithin(0, frames, frames + 18);

    // The running positions as locals (the loops below run faster on them than on the closure's)
    let pos = write;
    let pa = preAt;
    let da = diffAt;
    let count = n;
    let gain = gainStart;
    for (let i0 = 0; i0 < M; i0 += SUB) {
      const len = Math.min(SUB, M - i0);
      // The delays for this step: drifting, and following the size
      sizeNow += (sizeTarget - sizeNow) * sizeK;
      for (let j = 0; j < N; j++) {
        const c = modCos[j];
        const s = modSin[j];
        modCos[j] = c * rotC[j] - s * rotS[j];
        modSin[j] = s * rotC[j] + c * rotS[j];
        const delay = lineBase[j] * sizeNow + modDepth * s;
        // Whole samples, plus a fraction from 0.5 to 1.5 that a first-order allpass makes up
        const w = Math.floor(delay - 0.5);
        const frac = delay - w;
        whole[j] = w;
        coef[j] = (1 - frac) / (1 + frac);
      }

      // In: the pre-delay, then four allpass diffusers each side
      for (let t = 0; t < len; t++) {
        // Keep every state far from the denormal range: a tiny signal that alternates sign
        const dn = count & 1 ? 1e-20 : -1e-20;
        count++;
        preL[pa] = dL[i0 + t];
        preR[pa] = dR[i0 + t];
        const pr = (pa - pre) & (preSize - 1);
        let xl = preL[pr] + dn;
        let xr = preR[pr] - dn;
        pa = (pa + 1) & (preSize - 1);
        for (let d = 0; d < 4; d++) {
          const g = diffG[d];
          const ml = dMask[d];
          const ol = dOff[d];
          const dl = dMem[ol + ((da - dLen[d]) & ml)];
          const wl = xl + g * dl;
          dMem[ol + (da & ml)] = wl;
          xl = dl - g * wl;
          const mr = dMask[d + 4];
          const orr = dOff[d + 4];
          const dr = dMem[orr + ((da - dLen[d + 4]) & mr)];
          const wr = xr + g * dr;
          dMem[orr + (da & mr)] = wr;
          xr = dr - g * wr;
        }
        da++;
        xL[t] = xl;
        xR[t] = xr;
      }

      // Read each line through its allpass and damp it
      for (let j = 0; j < N; j++) {
        const o = offsets[j];
        const m = masks[j];
        const c = coef[j];
        const gl = gLow[j];
        const gm = gMid[j];
        const gh = gHigh[j];
        let ap = apState[j];
        let l1 = lp1[j];
        let l2 = lp2[j];
        let at = pos - whole[j];
        const r = j * SUB;
        for (let t = 0; t < len; t++, at++) {
          const y = c * (mem[o + (at & m)] - ap) + mem[o + ((at - 1) & m)];
          ap = y;
          // Low / middle / high, each with its own loss
          l1 += cLow * (y - l1);
          l2 += cHigh * (y - l2);
          z[r + t] = gl * l1 + gm * (l2 - l1) + gh * (y - l2);
        }
        apState[j] = ap;
        lp1[j] = l1;
        lp2[j] = l2;
      }

      // Mix every line into every other: a fast 16-point Hadamard (scaled by 1/4 on the way back
      // in, so it's orthogonal)
      for (let h = 1; h < N; h <<= 1) {
        for (let b = 0; b < N; b += h << 1) {
          for (let j = b; j < b + h; j++) {
            const p = j * SUB;
            const q = (j + h) * SUB;
            for (let t = 0; t < len; t++) {
              const a = z[p + t];
              const e = z[q + t];
              z[p + t] = a + e;
              z[q + t] = a - e;
            }
          }
        }
      }
      // ...and back into the lines, with the new sound
      for (let j = 0; j < N; j++) {
        const o = offsets[j];
        const m = masks[j];
        const bl = inLv[j];
        const br = inRv[j];
        const r = j * SUB;
        for (let t = 0; t < len; t++) mem[o + ((pos + t) & m)] = 0.25 * z[r + t] + bl * xL[t] + br * xR[t];
      }
      pos += len;

      // Out: two of the mixed rows
      const rl = OUT_L * SUB;
      const rr = OUT_R * SUB;
      for (let t = 0; t < len; t++) {
        gain += gainStep;
        outHistL[9 + i0 + t] = 0.25 * z[rl + t] * gain;
        outHistR[9 + i0 + t] = 0.25 * z[rr + t] * gain;
      }
    }
    write = pos & 0x3fffffff;
    preAt = pa;
    diffAt = da & 0x3fffffff;
    n = count & 0x3fffffff;
    gainNow = gainTarget;
    // Keep the drift's sines on the unit circle
    for (let j = 0; j < N; j++) {
      const r = 1 / Math.sqrt(modCos[j] * modCos[j] + modSin[j] * modSin[j]);
      modCos[j] *= r;
      modSin[j] *= r;
    }

    // Back up to the full rate: every other sample is the room's (delayed), the ones between
    // come through the halfband filter
    let outPeak = 0;
    for (let m = 0; m < M; m++) {
      const u = outHistL;
      const v = outHistR;
      const c = m + 4;
      const l0 = u[c];
      const r0 = v[c];
      const l1 = 2 * (H0 * (u[c] + u[c + 1]) + H1 * (u[c - 1] + u[c + 2]) + H2 * (u[c - 2] + u[c + 3]) + H3 * (u[c - 3] + u[c + 4]) + H4 * (u[c - 4] + u[c + 5]));
      const r1 = 2 * (H0 * (v[c] + v[c + 1]) + H1 * (v[c - 1] + v[c + 2]) + H2 * (v[c - 2] + v[c + 3]) + H3 * (v[c - 3] + v[c + 4]) + H4 * (v[c - 4] + v[c + 5]));
      outL[2 * m] = l0;
      outR[2 * m] = r0;
      outL[2 * m + 1] = l1;
      outR[2 * m + 1] = r1;
      const p = Math.abs(l0) + Math.abs(r0) + Math.abs(l1) + Math.abs(r1);
      if (p > outPeak) outPeak = p;
    }
    outHistL.copyWithin(0, M, M + 9);
    outHistR.copyWithin(0, M, M + 9);

    // Rest once nothing has come in for longer than the sound takes to get through, and the
    // tail is under -140 dB
    if (quietFor > tailLen && outPeak < 1e-7) {
      resting = true;
      clear();
    }
  };

  return { process, idle: () => resting };
}

/** The worklet processor's name. */
export const LUSH_PROCESSOR = 'bbx-lush-reverb';

/**
 * The AudioWorklet module: the kernel above with k-rate `decay` (seconds), `high` (the highs'
 * decay as a fraction of the middle's), `size` and `freeze` params, and `low` and `preDelay`
 * in processorOptions. A 'dispose' message stops it for good.
 */
export const LUSH_WORKLET_SOURCE = `
const createLushKernel = ${createLushKernel.toString()};
class LushProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'decay', defaultValue: 2.4, minValue: 0.1, maxValue: 1e6, automationRate: 'k-rate' },
      { name: 'high', defaultValue: 0.5, minValue: 0.1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'size', defaultValue: 1, minValue: 0.5, maxValue: 2, automationRate: 'k-rate' },
      { name: 'freeze', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor(options) {
    super();
    this.kernel = createLushKernel(sampleRate, (options && options.processorOptions) || {});
    this.alive = true;
    this.silence = new Float32Array(128);
    this.port.onmessage = (e) => {
      if (e.data === 'dispose') this.alive = false;
    };
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const frames = outL.length;
    if (this.silence.length < frames) this.silence = new Float32Array(frames);
    const inL = input && input.length > 0 ? input[0] : this.silence;
    const inR = input && input.length > 1 ? input[1] : inL;
    this.kernel.process(inL, inR, outL, outR, frames, parameters.decay[0], parameters.high[0], parameters.size[0], parameters.freeze[0]);
    return this.alive;
  }
}
registerProcessor('${LUSH_PROCESSOR}', LushProcessor);
`;
