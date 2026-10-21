/**
 * Loudness metering to ITU-R BS.1770-4 (what streaming services and broadcasters measure):
 * momentary (400 ms), short-term (3 s) and integrated loudness in LUFS, K-weighted and gated,
 * and the true peak in dBTP, found on a 4x oversampled signal so peaks between samples count.
 *
 * createLoudnessAnalyser holds the maths. It is written SELF-CONTAINED (nothing from this
 * module's scope) because its source text is pasted into an AudioWorklet (the live meter, see
 * loudnessMeter.ts) and a Worker (measuring an export after it is rendered), and Node unit-tests
 * the same code.
 */

export interface LoudnessReading {
  /** Loudness over the last 400 ms, in LUFS (-Infinity for silence). */
  momentary: number;
  /** Loudness over the last 3 s, in LUFS. */
  shortTerm: number;
  /** Gated loudness since the last reset, in LUFS. */
  integrated: number;
  /** The true peak over the last 400 ms, in dBTP. */
  truePeak: number;
  /** The highest true peak since the last reset, in dBTP. */
  truePeakMax: number;
  /** Seconds measured since the last reset. */
  seconds: number;
}

export interface LoudnessAnalyser {
  /** Measure the next `frames` samples of a stereo signal. */
  feed: (left: Float32Array, right: Float32Array, frames: number) => void;
  read: () => LoudnessReading;
  reset: () => void;
}

/**
 * A loudness analyser at one sample rate. The K-weighting filters are computed for the rate
 * (BS.1770-4 gives them at 48 kHz); the true-peak interpolator is the standard's own 4x filter.
 * Every 100 ms the mean square of the weighted signal is banked; momentary and short-term read
 * the last 4 and 30 of those, and every 400 ms gating block (75% overlap) above -70 LUFS is kept
 * for the integrated measure, which applies the relative gate (10 LU under their mean) on read.
 */
// The 4x interpolation filter of BS.1770-4 Annex 2: four phases of 12 taps over the latest samples
const PHASES = [
  [0.0017089843750, 0.0109863281250, -0.0196533203125, 0.0332031250000, -0.0594482421875, 0.1373291015625, 0.9721679687500, -0.1022949218750, 0.0476074218750, -0.0266113281250, 0.0148925781250, -0.0083007812500],
  [-0.0291748046875, 0.0292968750000, -0.0517578125000, 0.0891113281250, -0.1665039062500, 0.4650878906250, 0.7797851562500, -0.2003173828125, 0.1015625000000, -0.0582275390625, 0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625000000, -0.2003173828125, 0.7797851562500, 0.4650878906250, -0.1665039062500, 0.0891113281250, -0.0517578125000, 0.0292968750000, -0.0291748046875],
  [-0.0083007812500, 0.0148925781250, -0.0266113281250, 0.0476074218750, -0.1022949218750, 0.9721679687500, 0.1373291015625, -0.0594482421875, 0.0332031250000, -0.0196533203125, 0.0109863281250, 0.0017089843750],
].map((taps) => Float64Array.from(taps));
const TAPS = 12;

/** The most any interpolated point can be over the loudest sample under the filter */
const GAIN = Math.max(...PHASES.map((taps) => taps.reduce((sum, t) => sum + Math.abs(t), 0)));

/**
 * The true peak of audio (linear: 1 is full scale): the highest of its samples and the points the
 * 4x interpolation filter finds between them, where a converter's output can go over full scale
 * even though no sample does.
 */
export function truePeakOf(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    // A point between samples is at most GAIN times the loudest sample under the filter, so only
    // where a sample in the window could beat the peak found so far is it worth working out (the
    // same answer, a few times faster: most of a song is well under its peak)
    let lastLoud = -TAPS;
    // Silence before the audio (as a streaming meter starts): the first few samples have points
    // between them too, and a clip shorter than the filter still has its peaks found. (Not after
    // it: the export's limiter and meters read a file's end as they read it, without a tail.)
    const end = ch.length;
    for (let i = 0; i < end; i++) {
      const a = i < ch.length ? Math.abs(ch[i]) : 0;
      if (a > peak) peak = a;
      if (a * GAIN > peak) lastLoud = i;
      if (i - lastLoud >= TAPS) continue;
      for (let p = 0; p < 4; p++) {
        const taps = PHASES[p];
        let acc = 0;
        for (let k = 0; k < TAPS; k++) {
          const j = i - k;
          if (j >= 0 && j < ch.length) acc += taps[k] * ch[j];
        }
        const v = acc < 0 ? -acc : acc;
        if (v > peak) peak = v;
      }
    }
  }
  return peak;
}

/**
 * The K-weighting filters at `sampleRate` (the same two biquads the analyser below applies, kept
 * apart because that one must stay self-contained): a high shelf, then a high-pass, each as
 * [b0, b1, b2, a1, a2]. For measures that want the ear's weighting without the gating, such as
 * how far a kick pokes out of the mix (hitCheck.ts).
 */
export function kWeightingFilters(sampleRate: number): [number[], number[]] {
  let k = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  let q = 0.7071752369554196;
  const vh = Math.pow(10, 3.999843853973347 / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + k / q + k * k;
  const shelf = [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
  k = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  q = 0.5003270373238773;
  a0 = 1 + k / q + k * k;
  return [shelf, [1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0]];
}

// Its constants come in as arguments (TAPS and PHASES by default): the function is also inlined
// into the meter worklet and the export Worker as source text, where the minifier's names for
// module constants don't exist, so the inlined copies pass their own.
// `peaks` false leaves the true peak out (it reads -inf), for a caller that finds it faster with truePeakOf.
export function createLoudnessAnalyser(sampleRate: number, TAPS_N: number = TAPS, PHASE_TAPS: readonly Float64Array[] = PHASES, peaks = true): LoudnessAnalyser {
  const ABSOLUTE_GATE_LUFS = -70;
  const RELATIVE_GATE_LU = 10;
  const MOMENTARY_BLOCKS = 4;
  const SHORT_TERM_BLOCKS = 30;
  const HOP = Math.round(sampleRate / 10);
  /** Loudness of a mean-square power (summed over channels). */
  const lufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);
  const dbtp = (peak: number) => (peak > 0 ? 20 * Math.log10(peak) : -Infinity);

  // K-weighting: a high shelf (+4 dB above 1.5 kHz) then a high-pass near 38 Hz, as [b0, b1, b2, a1, a2]
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const g = 3.999843853973347;
    const q = 0.7071752369554196;
    const k = Math.tan((Math.PI * f0) / sampleRate);
    const vh = Math.pow(10, g / 20);
    const vb = Math.pow(vh, 0.4996667741545416);
    const a0 = 1 + k / q + k * k;
    return [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
  })();
  const highpass = (() => {
    const f0 = 38.13547087602444;
    const q = 0.5003270373238773;
    const k = Math.tan((Math.PI * f0) / sampleRate);
    const a0 = 1 + k / q + k * k;
    return [1, -2, 1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0];
  })();
  /** Filter memory per channel: shelf [x1, x2, y1, y2], then high-pass [x1, x2, y1, y2]. */
  const memory = [new Float64Array(8), new Float64Array(8)];

  /** The last 12 samples of each channel, twice over so a window is always contiguous. */
  const history = [new Float64Array(TAPS_N * 2), new Float64Array(TAPS_N * 2)];
  let historyAt = 0;

  /** Power (sum of the channels' mean squares) of each banked 100 ms block, newest last. */
  let blocks: number[] = [];
  /** True peak of each banked block. */
  let blockPeaks: number[] = [];
  /** Powers of the 400 ms gating blocks that passed the absolute gate. */
  let gated: number[] = [];
  /** The block being filled. */
  let sum = 0;
  let count = 0;
  let blockPeak = 0;
  let peakMax = 0;
  let total = 0;

  const reset = () => {
    blocks = [];
    blockPeaks = [];
    gated = [];
    sum = 0;
    count = 0;
    blockPeak = 0;
    peakMax = 0;
    total = 0;
    memory.forEach((m) => m.fill(0));
    history.forEach((h) => h.fill(0));
  };

  /** Bank the block being filled. */
  const bank = () => {
    const power = sum / count;
    blocks.push(power);
    blockPeaks.push(blockPeak);
    if (blockPeaks.length > SHORT_TERM_BLOCKS) {
      blocks.shift();
      blockPeaks.shift();
    }
    // A 400 ms gating block ends with every 100 ms block after the first three
    if (blocks.length >= MOMENTARY_BLOCKS) {
      let p = 0;
      for (let i = blocks.length - MOMENTARY_BLOCKS; i < blocks.length; i++) p += blocks[i];
      p /= MOMENTARY_BLOCKS;
      if (lufs(p) > ABSOLUTE_GATE_LUFS) gated.push(p);
    }
    sum = 0;
    count = 0;
    blockPeak = 0;
  };

  const feed = (left: Float32Array, right: Float32Array, frames: number) => {
    const channels = [left, right];
    for (let i = 0; i < frames; i++) {
      let power = 0;
      let peak = 0;
      for (let ch = 0; ch < 2; ch++) {
        const x = channels[ch][i];
        const m = memory[ch];
        // K-weighting
        const s = shelf[0] * x + shelf[1] * m[0] + shelf[2] * m[1] - shelf[3] * m[2] - shelf[4] * m[3];
        m[1] = m[0];
        m[0] = x;
        m[3] = m[2];
        m[2] = s;
        const w = highpass[0] * s + highpass[1] * m[4] + highpass[2] * m[5] - highpass[3] * m[6] - highpass[4] * m[7];
        m[5] = m[4];
        m[4] = s;
        m[7] = m[6];
        m[6] = w;
        power += w * w;
        if (!peaks) continue;
        // True peak: the sample itself and the three points interpolated after it
        const h = history[ch];
        h[historyAt] = x;
        h[historyAt + TAPS_N] = x;
        const base = historyAt + TAPS_N;
        const a = Math.abs(x);
        if (a > peak) peak = a;
        for (let p = 0; p < 4; p++) {
          const taps = PHASE_TAPS[p];
          let acc = 0;
          for (let k = 0; k < TAPS_N; k++) acc += taps[k] * h[base - k];
          const v = Math.abs(acc);
          if (v > peak) peak = v;
        }
      }
      historyAt = historyAt + 1 === TAPS_N ? 0 : historyAt + 1;
      sum += power;
      count++;
      if (peak > blockPeak) blockPeak = peak;
      if (peak > peakMax) peakMax = peak;
      if (count === HOP) bank();
    }
    total += frames;
  };

  const meanOfLast = (n: number) => {
    const from = Math.max(0, blocks.length - n);
    if (from === blocks.length) return 0;
    let p = 0;
    for (let i = from; i < blocks.length; i++) p += blocks[i];
    return p / (blocks.length - from);
  };

  const read = (): LoudnessReading => {
    let integrated = -Infinity;
    if (gated.length) {
      let mean = 0;
      for (const p of gated) mean += p;
      mean /= gated.length;
      const threshold = lufs(mean) - RELATIVE_GATE_LU;
      let above = 0;
      let n = 0;
      for (const p of gated) {
        if (lufs(p) > threshold) {
          above += p;
          n++;
        }
      }
      integrated = n ? lufs(above / n) : -Infinity;
    }
    let recentPeak = 0;
    for (let i = Math.max(0, blockPeaks.length - MOMENTARY_BLOCKS); i < blockPeaks.length; i++) if (blockPeaks[i] > recentPeak) recentPeak = blockPeaks[i];
    if (blockPeak > recentPeak) recentPeak = blockPeak;
    return {
      momentary: lufs(meanOfLast(MOMENTARY_BLOCKS)),
      shortTerm: lufs(meanOfLast(SHORT_TERM_BLOCKS)),
      integrated,
      truePeak: dbtp(recentPeak),
      truePeakMax: dbtp(peakMax),
      seconds: total / sampleRate,
    };
  };

  return { feed, read, reset };
}

/** The worklet processor's name. */
export const LOUDNESS_PROCESSOR = 'bbx-loudness';

/** How often the live meter posts its numbers. */
export const METER_RATE_HZ = 10;

/**
 * The live meter's AudioWorklet module: feeds the analyser and posts a reading ten times a
 * second. It takes 'reset' and 'dispose' messages (after 'dispose' the processor is let go).
 */
export const LOUDNESS_WORKLET_SOURCE = `
const TAPS = ${TAPS};
const PHASES = ${JSON.stringify(PHASES.map((p) => Array.from(p)))}.map((taps) => Float64Array.from(taps));
const analyserSource = ${createLoudnessAnalyser.toString()};
const createLoudnessAnalyser = (sr) => analyserSource(sr, TAPS, PHASES);
class LoudnessProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.analyser = createLoudnessAnalyser(sampleRate);
    this.alive = true;
    this.sinceReport = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'reset') this.analyser.reset();
      else if (e.data === 'dispose') this.alive = false;
    };
  }
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const left = input[0];
      const right = input.length > 1 ? input[1] : left;
      this.analyser.feed(left, right, left.length);
      this.sinceReport += left.length;
      if (this.sinceReport >= sampleRate / ${METER_RATE_HZ}) {
        this.sinceReport = 0;
        this.port.postMessage(this.analyser.read());
      }
    }
    return this.alive;
  }
}
registerProcessor('${LOUDNESS_PROCESSOR}', LoudnessProcessor);
`;

/** A Worker that measures whole channels off the main thread: { channels, sampleRate } in, a LoudnessReading out. */
export const LOUDNESS_WORKER_SOURCE = `
const TAPS = ${TAPS};
const PHASES = ${JSON.stringify(PHASES.map((p) => Array.from(p)))}.map((taps) => Float64Array.from(taps));
const analyserSource = ${createLoudnessAnalyser.toString()};
const createLoudnessAnalyser = (sr) => analyserSource(sr, TAPS, PHASES);
self.onmessage = (e) => {
  const { channels, sampleRate } = e.data;
  const analyser = createLoudnessAnalyser(sampleRate);
  const left = channels[0];
  const right = channels.length > 1 ? channels[1] : left;
  analyser.feed(left, right, left.length);
  self.postMessage(analyser.read());
};
`;

let workerUrl: string | null = null;

/**
 * Measure rendered audio (an export) in a Worker, so a long song doesn't stall the page. The
 * channels are copied to it. Rejects with the signal's reason if aborted; without Workers (or if
 * one can't start) it measures on this thread instead.
 */
export function measureLoudness(channels: Float32Array[], sampleRate: number, signal?: AbortSignal): Promise<LoudnessReading> {
  signal?.throwIfAborted();
  const inline = () => {
    const analyser = createLoudnessAnalyser(sampleRate);
    analyser.feed(channels[0], channels[1] ?? channels[0], channels[0].length);
    return analyser.read();
  };
  if (typeof Worker === 'undefined') return Promise.resolve(inline());
  return new Promise<LoudnessReading>((resolve, reject) => {
    let worker: Worker;
    try {
      workerUrl ??= URL.createObjectURL(new Blob([LOUDNESS_WORKER_SOURCE], { type: 'text/javascript' }));
      worker = new Worker(workerUrl);
    } catch {
      resolve(inline());
      return;
    }
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<LoudnessReading>) => {
      finish();
      resolve(e.data);
    };
    worker.onerror = () => {
      finish();
      resolve(inline());
    };
    const copies = channels.map((ch) => ch.slice());
    worker.postMessage({ channels: copies, sampleRate }, copies.map((c) => c.buffer));
  });
}

/** Where normalized exports are aimed: the loudness streaming services play at. */
export const NORMALIZE_TARGET_LUFS = -14;
/** The most a normalized export may peak at, so it never clips on the way to a listener. */
export const NORMALIZE_CEILING_DBTP = -1;

/**
 * The gain (dB) that brings a reading to `targetLufs`, held back so the true peak never passes
 * `ceilingDbtp`. `limited` says the ceiling held it back. Silence (no loudness) gets no gain.
 */
export function normalizeGainDb(reading: Pick<LoudnessReading, 'integrated' | 'truePeakMax'>, targetLufs = NORMALIZE_TARGET_LUFS, ceilingDbtp = NORMALIZE_CEILING_DBTP): { gainDb: number; limited: boolean } {
  if (!Number.isFinite(reading.integrated)) return { gainDb: 0, limited: false };
  const wanted = targetLufs - reading.integrated;
  const room = Number.isFinite(reading.truePeakMax) ? ceilingDbtp - reading.truePeakMax : Infinity;
  if (wanted > room) return { gainDb: room, limited: true };
  return { gainDb: wanted, limited: false };
}

/** "-14.0 LUFS" / "-inf LUFS" */
export function formatLufs(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : '-inf LUFS';
}

/** "-1.0 dBTP" / "-inf dBTP" */
export function formatDbtp(v: number): string {
  return Number.isFinite(v) ? `${v.toFixed(1)} dBTP` : '-inf dBTP';
}
