/**
 * Lining up recording: the maths of measuring how late a microphone take arrives. A few soft
 * clicks are played through the speaker and recorded with the microphone; where they turn up in
 * the recording, against where they were played, is the round trip (the output's delay, the
 * air, the input's delay) on this phone or computer. A take recorded later is moved back by that
 * much (micRecorder.ts) instead of by the browser's own estimate, which is often off on phones.
 *
 * Pure: no audio context here (lineUpRun.ts plays and records). The clicks are short, soft tone
 * bursts at irregular gaps, so the train only lines up with itself at one place; the delay is
 * found by cross-correlating the recording with the train, then checked click by click.
 */

/** How loud a click is (peak, full scale 1): about -16 dB, soft through a phone's speaker. */
export const CLICK_LEVEL = 0.16;
/** One click: a 2 kHz burst, 6 ms long, faded in and out (no hard edge, no pop). */
const CLICK_HZ = 2000;
const CLICK_SECONDS = 0.006;
/** When each click starts, from the first (seconds): uneven, so no other lag fits them all. */
export const CLICK_TIMES = [0, 0.37, 0.81, 1.16, 1.63, 1.98];
/** The longest round trip looked for (seconds): wired phones run 20 to 250 ms; Bluetooth up to 500 ms or so. */
export const MAX_ROUND_TRIP = 0.7;

/** The click train as samples, CLICK_TIMES apart, at `sampleRate`. */
export function clickTrain(sampleRate: number, level = CLICK_LEVEL): Float32Array<ArrayBuffer> {
  const clickLen = Math.round(CLICK_SECONDS * sampleRate);
  const out = new Float32Array(Math.ceil((CLICK_TIMES[CLICK_TIMES.length - 1] + CLICK_SECONDS) * sampleRate) + 1);
  for (const t of CLICK_TIMES) {
    const at = Math.round(t * sampleRate);
    for (let i = 0; i < clickLen; i++) {
      // A Hann window over the burst
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (clickLen - 1));
      out[at + i] = level * w * Math.sin((2 * Math.PI * CLICK_HZ * i) / sampleRate);
    }
  }
  return out;
}

export interface RoundTrip {
  /** Seconds from a click leaving the graph to the microphone's recording of it */
  seconds: number;
  /** 0..1: how alike the recording is to the clicks there (1: exactly) */
  match: number;
  /** How far apart the clicks' own delays are (seconds): small when the measurement is sound */
  spread: number;
}

/** A recording's DC and rumble taken out (a one-pole high-pass at about 300 Hz), so a hum doesn't pull the match. */
function highPass(x: Float32Array, sampleRate: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * 300) / sampleRate);
  const out = new Float32Array(x.length);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < x.length; i++) {
    prevY = a * (prevY + x[i] - prevX);
    prevX = x[i];
    out[i] = prevY;
  }
  return out;
}

/** The train's samples that aren't silent, as (place, value) pairs: correlating only those is quick. */
function sparse(train: Float32Array): { at: Int32Array; v: Float32Array } {
  const places: number[] = [];
  for (let i = 0; i < train.length; i++) if (train[i] !== 0) places.push(i);
  return { at: Int32Array.from(places), v: Float32Array.from(places, (i) => train[i]) };
}

/** The correlation of the recording with (part of) the train placed at `offset`, and the recording's energy there. */
function correlate(rec: Float32Array, ref: { at: Int32Array; v: Float32Array }, offset: number, from = 0, to = ref.at.length): { dot: number; energy: number } {
  let dot = 0;
  let energy = 0;
  for (let k = from; k < to; k++) {
    const j = offset + ref.at[k];
    if (j < 0 || j >= rec.length) continue;
    dot += rec[j] * ref.v[k];
    energy += rec[j] * rec[j];
  }
  return { dot, energy };
}

/**
 * Where the click train turns up in a recording: `recording` began `startOffset` samples before
 * the first click was played (so with no delay at all, the first click would sit at sample
 * `startOffset`). Returns the round trip, or null when the clicks can't be told apart from the
 * rest (too quiet, too noisy, or not heard at all).
 */
export function findRoundTrip(recording: Float32Array, sampleRate: number, startOffset: number, train: Float32Array = clickTrain(sampleRate)): RoundTrip | null {
  const rec = highPass(recording, sampleRate);
  const ref = sparse(train);
  let refEnergy = 0;
  for (let k = 0; k < ref.v.length; k++) refEnergy += ref.v[k] * ref.v[k];
  if (!refEnergy) return null;
  const maxLag = Math.round(MAX_ROUND_TRIP * sampleRate);
  // The whole train, at every lag: the best fit
  let best = -1;
  let bestScore = 0;
  for (let lag = 0; lag <= maxLag; lag++) {
    const { dot, energy } = correlate(rec, ref, startOffset + lag);
    if (dot <= 0 || energy <= 0) continue;
    const score = dot / Math.sqrt(energy * refEnergy);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  if (best < 0 || bestScore < 0.25) return null;
  // Each click on its own, near the best fit (a few ms either way): they should agree
  const clickLen = Math.round(CLICK_SECONDS * sampleRate) + 1;
  const near = Math.round(0.004 * sampleRate);
  const lags: number[] = [];
  for (const t of CLICK_TIMES) {
    const first = Math.round(t * sampleRate);
    let from = 0;
    while (from < ref.at.length && ref.at[from] < first) from++;
    let to = from;
    while (to < ref.at.length && ref.at[to] < first + clickLen) to++;
    let local = -1;
    let localScore = 0;
    for (let lag = Math.max(0, best - near); lag <= best + near; lag++) {
      const { dot, energy } = correlate(rec, ref, startOffset + lag, from, to);
      if (dot <= 0 || energy <= 0) continue;
      const score = dot / Math.sqrt(energy);
      if (score > localScore) {
        localScore = score;
        local = lag;
      }
    }
    if (local >= 0) lags.push(local);
  }
  // Most of the clicks must be heard, at the same delay (within a millisecond or so)
  if (lags.length < Math.ceil(CLICK_TIMES.length * 0.66)) return null;
  lags.sort((a, b) => a - b);
  const median = lags[Math.floor(lags.length / 2)];
  const close = lags.filter((l) => Math.abs(l - median) <= Math.round(0.0015 * sampleRate));
  if (close.length < Math.ceil(CLICK_TIMES.length * 0.66)) return null;
  const spread = (close[close.length - 1] - close[0]) / sampleRate;
  return { seconds: median / sampleRate, match: Math.min(1, bestScore), spread };
}

/**
 * Which setup a measurement belongs to: the sample rate, the microphone's name and whether the
 * output is a slow one (Bluetooth, typically over 100 ms). Headphones that change the delay
 * change the key, so a measurement is only used where it was made.
 */
export function lineUpKey(setup: { sampleRate: number; inputLabel?: string; outputLatency: number }): string {
  const mic = (setup.inputLabel ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60) || 'default';
  return `${setup.sampleRate}|${mic}|${setup.outputLatency > SLOW_OUTPUT ? 'slow' : 'quick'}`;
}

/** An output slower than this (seconds) is most likely Bluetooth: too slow to sing in time with. */
export const SLOW_OUTPUT = 0.1;

/** Whether to tell the singer that their headphones add delay: a slow output, or a Bluetooth microphone. */
export function likelyBluetooth(outputLatency: number, inputLabel = ''): boolean {
  return outputLatency > SLOW_OUTPUT || /bluetooth|airpods|buds|hands-?free|\bbt\b/i.test(inputLabel);
}
