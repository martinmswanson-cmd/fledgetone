// Made music for the hearing faults tests (scripts/hearingFaults.test.mjs and
// scripts/audio-check/hearing/faults-grid.mjs): the tonal bed, a kick, hat and snare pattern, square
// waves, kick loops with or without a pitch drop, mains hum mixes, and a way to plant a click away from
// a bass's corners. Built from scripts/fixtures/hearingSignals.mjs; every function returns a Float32Array.
import * as S from './hearingSignals.mjs';

const SR = 48000;

/** Two tones and quiet band-limited pink noise: the bed the click tests plant clicks in. */
export const bed = (sec) => S.mix(S.sine(110, sec, -12), S.sine(440, sec, -18), S.band(S.pink(sec, -30, 3), 100, 4000));

/** The RMS of x over 25 ms either side of sample i. */
export function rmsAround(x, i, sr = SR) {
  const a = x.subarray(Math.max(0, i - sr * 0.025), i + sr * 0.025);
  return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
}

/** `x` faded in and out over 10 ms (a raised cosine). */
export function fade(x, sr = SR) {
  const n = Math.round(sr * 0.01);
  return Float32Array.from(x, (v, i) => {
    const edge = Math.min(i, x.length - 1 - i);
    return edge >= n ? v : v * (0.5 - 0.5 * Math.cos((Math.PI * edge) / n));
  });
}

/**
 * One kick: a sine (or cosine) of `hz` gliding to `toHz` (time constant 30 ms), its level falling with
 * a time constant of a quarter of `decayMs`, so it has faded by `decayMs`; it lasts 2.5 times that.
 */
export function kick({ hz = 55, toHz, decayMs = 150, peak = 0.8, cosine = false }, sr = SR) {
  const n = Math.round((2.5 * decayMs * sr) / 1000);
  const tau = (decayMs / 4000) * sr;
  const out = new Float32Array(n);
  let phase = cosine ? Math.PI / 2 : 0;
  for (let i = 0; i < n; i++) {
    out[i] = peak * Math.exp(-i / tau) * Math.sin(phase);
    const f = toHz === undefined ? hz : toHz + (hz - toHz) * Math.exp(-i / (0.03 * sr));
    phase += (2 * Math.PI * f) / sr;
  }
  return out;
}

/** `rate` kicks a second for `sec`. */
export const kickLoop = (rate, sec, options) => S.every(rate, sec, () => kick(options));

/** Short noise bursts, `rate` a second. */
export const hats = (rate, sec, peakDb = -14) => S.every(rate, sec, (i) => S.burst(0.04, 6, 0, peakDb, i + 1));

/** A snare: a noise burst with a short tone at 190 Hz. */
export const snare = (seed) => S.mix(S.burst(0.2, 35, 0, -8, seed), S.decay(S.sine(190, 0.2, -12), 30));

/** Kick on every beat at 120 BPM, hats on eighths and a snare on the off beats. */
export const drums = (sec) =>
  S.mix(kickLoop(2, sec, { hz: 55, decayMs: 250, peak: 0.8 }), hats(8, sec), S.at(sec, Array.from({ length: Math.floor(sec) }, (_, i) => [i + 0.5, snare(i + 50)])));

/** A lighter kick and hats, for hum to sit under. */
export const kickAndHats = (sec) => S.mix(kickLoop(2, sec, { hz: 55, decayMs: 150, peak: 0.5 }), hats(8, sec, -16));

/** A square of `hz` jumping between plus and minus `amp`, with no smoothing of its edges. */
export const square = (hz, sec, amp, sr = SR) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => (((i * hz) / sr) % 1 < 0.5 ? amp : -amp));

/** A band-limited square of `hz` (odd harmonics up to 20 kHz), peaking near `amp`. */
export function limitedSquare(hz, sec, amp, sr = SR) {
  const parts = [];
  for (let k = 1; k * hz < 20000; k += 2) parts.push(S.gain(S.sine(hz * k, sec, 0, sr), -20 * Math.log10(k)));
  const x = S.mix(...parts);
  const g = (amp * Math.PI) / 4;
  return Float32Array.from(x, (v) => v * g);
}

/** Hum at 60 Hz and 120 Hz over pink noise (the brief's signal). */
export const hum60 = (sec) => S.mix(S.pink(sec, -18, 1), S.sine(60, sec, -27), S.sine(120, sec, -33));
/** Hum at 50 Hz with 100 and 150 Hz over pink noise. */
export const hum50 = (sec) => S.mix(S.pink(sec, -18, 4), S.sine(50, sec, -24), S.sine(100, sec, -30), S.sine(150, sec, -30));

/**
 * The first sample at or after `seconds` where nothing in the wave within 2 ms jumps (every second
 * difference under half the RMS around), and a copy of `x` with a click of 4
 * times the RMS around planted there, signed against the wave.
 */
export function plantAwayFromCorners(x, seconds, sr = SR) {
  let i = Math.round(seconds * sr);
  for (;; i++) {
    const bar = rmsAround(x, i, sr) / 2;
    let quiet = true;
    for (let k = i - 96; k <= i + 96 && quiet; k++) if (Math.abs(x[k + 1] - 2 * x[k] + x[k - 1]) > bar) quiet = false;
    if (quiet) break;
  }
  const y = x.slice();
  y[i] += (x[i] >= 0 ? -4 : 4) * rmsAround(x, i, sr);
  return { x: y, at: i };
}
