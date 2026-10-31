/**
 * The Drum Designer's synth: renders a designed drum (src/store/drumDesign.ts) into samples, one
 * hit at full velocity. Each layer is one voice: a kick's swept sine with a click, a snare's tone
 * and wires, a clap's slaps and tail, a hat's six detuned square waves and noise, a rim, a tom, a
 * shaker, a bell, and the layered kick (a click, a driven body falling from its punch pitch, a
 * clean sub tail, and a hardcore mode whose driven tail holds through the beat) and layered snare
 * (a transient, a tuned body, wires, a clap and a room that rings or is gated). Plain maths into a Float32Array, no Web Audio, so a hit renders the same in the
 * app, in an export and in Node's tests; the noise comes from a seed (seededNoise.ts), so each
 * hit's variation repeats exactly.
 *
 * A sound is made to a set loudness for its row (ROW_LOUDNESS, from the existing kits' own
 * levels) and its level knob, its peak never above DRUM_CEILING: switching presets or turning up
 * the drive doesn't make a drum jump out of the mix.
 */
import { seededRandom } from './seededNoise';
import type { DesignRow, DrumLayer, DrumSound } from '../store/drumDesign';
import { maxOf } from '../support/minMax';

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Each row's loudness at full velocity and a level of 0 dB, as the RMS of its loudest 50 ms in
 * dBFS: what the synthesized and recorded kits play their rows at (measured through the app's own
 * render, which takes about 4 dB off at the track strip), so a designed kit swaps in for them at
 * about the same balance, and every preset of a row comes out equally loud. The snare and clap
 * sit a little under the kick as heard (K-weighted, about 2.5 dB): their RMS is lower than
 * the kick's because the ear hears their mids more than the kick's lows.
 */
export const ROW_LOUDNESS: Record<DesignRow, number> = {
  kick: -4.6,
  snare: -9.1,
  clap: -9.6,
  closedHat: -22.1,
  openHat: -19.1,
  tomLow: -10.1,
  tomMid: -10.6,
  tomHigh: -11.1,
  cowbell: -17.1,
  crash: -23.8,
  ride: -25.6,
};

/** The highest a designed hit's samples go (a loud, spiky sound stops here, under its loudness). */
export const DRUM_CEILING = 0.95;
/** The longest a hit lasts, seconds. */
export const MAX_HIT_SECONDS = 3.5;
/**
 * Goes up whenever the same design renders differently (2: the hats, cymbals and shakers in
 * stereo, renderDrumStereo), so a Designed Kit or synthesized kit frozen before plays live again
 * and freezes afresh (see store/freeze.ts).
 */
export const DRUM_RENDER_VERSION = 2;

/**
 * A state-variable filter (the zero-delay "TPT" form): low, band and high at once, stable while
 * its cutoff moves. (The sound effects maker's Svf gives one output at a time; drums want the
 * high-pass and band-pass of the same noise.)
 */
class Svf {
  private g = 0;
  private k = 1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private ic1 = 0;
  private ic2 = 0;
  low = 0;
  band = 0;
  high = 0;
  constructor(cutoff: number, q: number, sampleRate: number) {
    this.set(cutoff, q, sampleRate);
  }
  set(cutoff: number, q: number, sampleRate: number): void {
    this.g = Math.tan((Math.PI * clamp(cutoff, 10, sampleRate * 0.45)) / sampleRate);
    this.k = 1 / Math.max(0.1, q);
    this.a1 = 1 / (1 + this.g * (this.g + this.k));
    this.a2 = this.g * this.a1;
    this.a3 = this.g * this.a2;
  }
  run(v: number): void {
    const v3 = v - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = v - this.k * v1 - v2;
  }
}

/** PolyBLEP: the correction that takes most of the aliasing out of a naive square's jumps. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

/** A band-limited square wave's value at `phase` (0 to 1) for a step of `dt` a sample. */
const square = (phase: number, dt: number) => (phase < 0.5 ? 1 : -1) + blep(phase, dt) - blep((phase + 0.5) % 1, dt);

/** The analog hat's six oscillators, as ratios of the lowest (a classic drum machine's 205-800 Hz set). */
const METAL = [1, 1.4826, 1.8004, 2.5459, 2.6303, 3.8968];

/** A body's fall: holds early and lets go late (kicks and toms), reaching 0 at x = 1. */
const holdEnv = (x: number) => (x >= 1 ? 0 : (1 - x) * (1 - x));
/** A fast fall that still reaches 0 at x = 1 (noise, metal, clicks). */
const fastEnv = (x: number) => (x >= 1 ? 0 : Math.exp(-5 * x) * (1 - x));

/**
 * A level that has fallen 20 dB by `t20` seconds: 10^-((t / t20)^p). Past 1, `p` holds the level
 * early and lets go late (a kick's body); 1 is a plain exponential fall. The layered voices'
 * lengths are all "how long until 20 dB down", so the knobs read as the measured targets do.
 */
const fall = (t: number, t20: number, p: number) => 10 ** -((t / Math.max(1e-4, t20)) ** p);
/** How long `fall` takes to reach -60 dB */
const fallSeconds = (t20: number, p: number) => t20 * 3 ** (1 / p);
/** A layered kick's body falls this way (hardcore: holds through the beat at its tail's length) */
const KICK_BODY_P = 1.5;
const HARDCORE_P = 1.4;
/** A layered kick's sub falls this way */
const KICK_SUB_P = 1.6;

/** How long a layered kick's body sounds for: its decay, or (hardcore) its tail */
const kickBodyT20 = (l: DrumLayer) => (l.hardcore >= 0.5 ? Math.max(l.tail, l.decay) : l.decay);

/** How long a layer sounds, seconds after its own start. */
function layerSeconds(l: DrumLayer): number {
  if (l.voice === 'layerKick') {
    const body = fallSeconds(kickBodyT20(l), l.hardcore >= 0.5 ? HARDCORE_P : KICK_BODY_P);
    return Math.min(MAX_HIT_SECONDS, Math.max(l.noiseDecay * 3, l.body > 0 ? body : 0, l.sub > 0 ? fallSeconds(l.tail, KICK_SUB_P) : 0, 0.01) + 0.005);
  }
  if (l.voice === 'layerSnare') {
    const room = l.room > 0 ? (l.gate >= 0.5 ? l.gateHold + 0.01 : fallSeconds(l.tail, 1)) : 0;
    return Math.min(MAX_HIT_SECONDS, Math.max(0.05, l.body > 0 ? fallSeconds(l.decay, 1) : 0, l.noise > 0 ? fallSeconds(l.noiseDecay, 1) : 0, room, l.clap > 0 ? 0.25 : 0) + 0.005);
  }
  const noiseTail = l.noise > 0 || l.voice === 'clap' || l.voice === 'shaker' ? l.noiseDecay : 0;
  const bursts = l.voice === 'clap' || l.voice === 'shaker' ? ((l.bursts - 1) * l.spread) / 1000 : 0;
  return Math.min(MAX_HIT_SECONDS, l.attack + Math.max(l.decay, noiseTail + bursts, 0.01) + 0.005);
}

/** How long a sound is (its longest layer, after its delay), seconds. */
export function drumSeconds(s: DrumSound): number {
  return Math.min(MAX_HIT_SECONDS, maxOf(s.layers.map((l) => l.delay / 1000 + layerSeconds(l))));
}

/** Soft clipping that keeps the level of quiet parts: `drive` 0 is clean, 1 is crushed. */
function drive(x: Float32Array, amount: number): void {
  if (!(amount > 0)) return;
  const g = 1 + amount * 14;
  const norm = Math.tanh(g);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * g) / norm;
}

/** A layered kick's body drive: soft (tanh), hard (clipped) or folded, `amount` 0 to 1, peak kept at 1. */
export function shapeBody(x: number, amount: number, mode: number): number {
  if (!(amount > 0)) return x;
  const g = 1 + amount * 24;
  if (mode >= 1.5) {
    // Folded: past the top it turns back down (a sine fold), so loud parts get brighter rather than flatter
    return Math.sin(0.5 * Math.PI * Math.max(-1, Math.min(1, x)) * (1 + amount * 5));
  }
  if (mode >= 0.5) return Math.max(-1, Math.min(1, x * g));
  return Math.tanh(x * g) / Math.tanh(g);
}

/** The band-limited saw's value at `phase` (0 to 1) for a step of `dt` a sample. */
const saw = (phase: number, dt: number) => 2 * phase - 1 - blep(phase, dt);

/** The three slaps of a layered snare's clap, seconds after the hit */
const CLAP_SLAPS = [0, 0.009, 0.019];

/** One layer, at a peak of about 1, `length` samples long. */
function renderLayer(l: DrumLayer, length: number, sampleRate: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  const random = seededRandom(seed);
  const white = () => random() * 2 - 1;
  const n = Math.min(length, Math.round(layerSeconds(l) * sampleRate));
  const decay = Math.max(0.005, l.decay);
  const noiseDecay = Math.max(0.005, l.noiseDecay);
  let phase = 0;
  let phase2 = 0;
  switch (l.voice) {
    case 'kick':
    case 'tom': {
      // A sine swept down onto its pitch, a click on the front, a little filtered noise
      const click = new Svf(l.voice === 'kick' ? 3500 : 2500, 0.7, sampleRate);
      const hiss = new Svf(l.color, 0.8, sampleRate);
      const clickTime = 0.004;
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const f = l.pitch * 2 ** ((l.sweep / 12) * Math.exp(-t / Math.max(0.001, l.sweepTime)));
        phase = (phase + f / sampleRate) % 1;
        let v = Math.sin(TAU * phase) * holdEnv(t / decay) * l.body;
        const w = white();
        if (l.click > 0 && t < clickTime * 6) {
          click.run(w);
          // A short bright tick and a tiny overshoot of the body: the beater
          v += l.click * (0.9 * click.band * Math.exp(-t / clickTime) + 0.35 * Math.sin(TAU * phase) * Math.exp(-t / 0.006));
        }
        if (l.noise > 0) {
          hiss.run(w);
          v += l.noise * 0.6 * hiss.band * fastEnv(t / noiseDecay);
        }
        out[i] = v;
      }
      break;
    }
    case 'snare': {
      // Two drum-head modes with a little sweep, the wires (high-passed noise), and a snap
      const wires = new Svf(l.color, 0.6, sampleRate);
      const snap = new Svf(Math.min(12000, l.color * 1.6), 0.9, sampleRate);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const bend = 2 ** ((l.sweep / 12) * Math.exp(-t / Math.max(0.001, l.sweepTime)));
        phase = (phase + (l.pitch * bend) / sampleRate) % 1;
        phase2 = (phase2 + (l.pitch * 1.59 * bend) / sampleRate) % 1;
        const tone = (Math.sin(TAU * phase) + 0.45 * Math.sin(TAU * phase2)) * fastEnv(t / decay) * l.body;
        const w = white();
        wires.run(w);
        snap.run(w);
        // The wires: high-passed noise with some of its band, so it isn't only fizz
        const noise = (wires.high * 0.8 + wires.band * 0.5) * fastEnv(t / noiseDecay) * l.noise * 1.4;
        const crack = l.click * snap.band * 0.9 * Math.exp(-t / 0.005);
        out[i] = tone + noise + crack;
      }
      break;
    }
    case 'clap': {
      // Several slaps a few ms apart, each a burst of band-passed noise, then the room's tail
      const band = new Svf(l.color, 1.4, sampleRate);
      const air = new Svf(l.color * 3, 0.8, sampleRate);
      const gap = l.spread / 1000;
      const last = (l.bursts - 1) * gap;
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const w = white();
        band.run(w);
        air.run(w);
        let env = 0;
        if (t < last + gap) {
          const k = Math.min(l.bursts - 1, Math.floor(t / gap));
          const since = t - k * gap;
          env = (1 - 0.08 * k) * Math.exp(-since / Math.max(0.0015, gap * 0.3));
        }
        const tail = t >= last ? 0.75 * fastEnv((t - last) / noiseDecay) : 0;
        out[i] = (band.band * 1.7 + l.click * 0.5 * air.high) * Math.max(env, tail) * l.noise;
      }
      break;
    }
    case 'hat': {
      // Six square waves at inharmonic ratios, band-passed high, with noise for the sizzle
      const phases = new Float64Array(METAL.length);
      const metalBand = new Svf(l.color, 1.2, sampleRate);
      const metalHigh = new Svf(l.color * 0.6, 0.7, sampleRate);
      const noiseHigh = new Svf(l.color, 0.7, sampleRate);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        let m = 0;
        for (let k = 0; k < METAL.length; k++) {
          const dt = Math.min(0.5, (l.pitch * METAL[k]) / sampleRate);
          phases[k] = (phases[k] + dt) % 1;
          m += square(phases[k], dt);
        }
        metalBand.run(m / METAL.length);
        metalHigh.run(metalBand.band);
        noiseHigh.run(white());
        const env = fastEnv(t / decay);
        const tick = l.click * Math.exp(-t / 0.002);
        out[i] = (metalHigh.high * 2.2 * (1 - 0.6 * l.noise) + noiseHigh.high * l.noise) * (env + tick * 0.6);
      }
      break;
    }
    case 'rim': {
      // Two high modes, very short, high-passed, with a click of noise
      const hp = new Svf(400, 0.7, sampleRate);
      const crack = new Svf(l.color, 1, sampleRate);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        phase = (phase + l.pitch / sampleRate) % 1;
        phase2 = (phase2 + (l.pitch * 2.17) / sampleRate) % 1;
        const w = white();
        crack.run(w);
        const v = (Math.sin(TAU * phase) + 0.5 * Math.sin(TAU * phase2)) * fastEnv(t / decay) + l.click * 1.2 * crack.band * Math.exp(-t / 0.003) + l.noise * crack.band * fastEnv(t / Math.max(0.01, decay * 1.5));
        hp.run(v);
        out[i] = hp.high;
      }
      break;
    }
    case 'shaker': {
      // Band-passed noise that swells in and dies away, once or a few times
      const band = new Svf(l.color, 1.8, sampleRate);
      const gap = l.spread / 1000;
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        band.run(white());
        let env = 0;
        for (let k = 0; k < l.bursts; k++) {
          const s = t - k * gap;
          if (s < 0) break;
          const level = k === 0 ? 1 : 0.65;
          const rise = l.attack > 0 ? Math.min(1, s / l.attack) : 1;
          env = Math.max(env, level * rise * rise * fastEnv(Math.max(0, s - l.attack) / noiseDecay));
        }
        out[i] = band.band * 2.2 * env * l.noise;
      }
      break;
    }
    case 'layerKick': {
      // Three parts: a click (band-passed noise, 1-5 kHz, a few ms), a body (a sine or saw falling
      // from its punch pitch onto the tail pitch, the only part driven, then a cabinet's low-pass) and
      // a clean sine sub on the same pitch for the tail. Hardcore holds the driven body through the beat.
      const f0 = l.pitch;
      const f1 = Math.max(f0, l.startPitch);
      // The drop: an exponential glide, 95% of the way down by sweepTime
      const tau = Math.max(0.002, l.sweepTime / 3);
      const hard = l.hardcore >= 0.5;
      const bodyT20 = kickBodyT20(l);
      const bodyP = hard ? HARDCORE_P : KICK_BODY_P;
      const clickBand = new Svf(l.color, 1.1, sampleRate);
      const cabinet = new Svf(l.tone, 0.85, sampleRate);
      const lowCut = new Svf(28, 0.7, sampleRate);
      const clickTau = Math.max(0.0008, l.noiseDecay / 3);
      const clickEnd = l.noiseDecay * 3;
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const f = f0 + (f1 - f0) * Math.exp(-t / tau);
        const dt = Math.min(0.5, f / sampleRate);
        phase = (phase + dt) % 1;
        // (A 1 ms rise: the click is the front, not a jump in the body)
        const rise = Math.min(1, t / 0.001);
        const sine = Math.sin(TAU * phase);
        let v = 0;
        if (l.body > 0) {
          const wave = sine * (1 - l.shape) + saw(phase, dt) * l.shape * 0.85;
          // Hardcore: the wave is driven at a steady level and the level shaped after, so the tail
          // stays distorted as it falls; otherwise the drive eases off as the body falls
          let b = hard ? shapeBody(wave * 0.9, l.drive, l.driveMode) * fall(t, bodyT20, bodyP) * rise : shapeBody(wave * fall(t, bodyT20, bodyP) * rise, l.drive, l.driveMode);
          cabinet.run(b);
          lowCut.run(cabinet.low);
          b = lowCut.high;
          v += b * l.body;
        }
        if (l.sub > 0) v += sine * fall(t, l.tail, KICK_SUB_P) * rise * l.sub;
        if (l.click > 0 && t < clickEnd) {
          clickBand.run(white());
          v += clickBand.band * 3 * Math.exp(-t / clickTau) * l.click;
        }
        out[i] = v;
      }
      // (Its drive is the body's own, above)
      return out;
    }
    case 'layerSnare': {
      // A transient (a crack of noise and a blip, falling 12 dB in about 8 ms), a tuned body (two drum
      // modes with a little sweep), the wires (noise high-passed under its colour, low-passed at its
      // tone), an optional clap and a room (band-passed noise that rings on, or is gated)
      const crack = new Svf(Math.max(2500, l.color * 0.9), 0.8, sampleRate);
      const wiresHi = new Svf(l.color * 0.55, 0.7, sampleRate);
      const wiresLo = new Svf(l.tone, 0.7, sampleRate);
      const clapBand = new Svf(1400, 1.4, sampleRate);
      const roomHi = new Svf(1000, 0.7, sampleRate);
      const roomLo = new Svf(9000, 0.7, sampleRate);
      const gated = l.gate >= 0.5;
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const bend = 2 ** ((l.sweep / 12) * Math.exp(-t / Math.max(0.001, l.sweepTime)));
        phase = (phase + (l.pitch * bend) / sampleRate) % 1;
        phase2 = (phase2 + (l.pitch * 1.6 * bend) / sampleRate) % 1;
        const rise = Math.min(1, t / 0.0005);
        let v = 0;
        if (l.body > 0) v += (Math.sin(TAU * phase) + 0.35 * Math.sin(TAU * phase2)) * fall(t, l.decay, 1) * rise * l.body;
        const w = white();
        if (l.click > 0) {
          crack.run(w);
          v += (crack.band * 1.4 + 0.5 * Math.sin(TAU * phase * 2)) * Math.exp(-t / 0.006) * rise * l.click;
        }
        if (l.noise > 0) {
          wiresHi.run(w);
          wiresLo.run(wiresHi.high);
          v += wiresLo.low * 1.3 * fall(t, l.noiseDecay, 1) * rise * l.noise;
        }
        const w2 = white();
        if (l.clap > 0 && t < 0.25) {
          clapBand.run(w2);
          let env = 0;
          for (const at of CLAP_SLAPS) if (t >= at) env = Math.max(env, Math.exp(-(t - at) / 0.0035));
          env = Math.max(env, t >= CLAP_SLAPS[2] ? 0.5 * fall(t - CLAP_SLAPS[2], 0.07, 1) : 0);
          v += clapBand.band * 2 * env * l.clap;
        }
        if (l.room > 0) {
          roomHi.run(white());
          roomLo.run(roomHi.high);
          // Swells in over 6 ms behind the hit, then rings on (or holds and is cut off: gated)
          const swell = Math.min(1, t / 0.006);
          const env = gated ? (t < l.gateHold ? 10 ** (-0.15 * (t / l.gateHold)) : Math.max(0, 1 - (t - l.gateHold) / 0.006) * 10 ** -0.15) : fall(t, l.tail, 1);
          v += roomLo.low * 0.9 * swell * env * l.room;
        }
        out[i] = v;
      }
      break;
    }
    case 'bell': {
      // Two square waves a fifth-ish apart through a band-pass: the analog cowbell
      const band = new Svf(l.color, 2.5, sampleRate);
      for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        const dt1 = Math.min(0.5, l.pitch / sampleRate);
        const dt2 = Math.min(0.5, (l.pitch * 1.4815) / sampleRate);
        phase = (phase + dt1) % 1;
        phase2 = (phase2 + dt2) % 1;
        band.run((square(phase, dt1) + square(phase2, dt2)) * 0.5);
        // A quick drop from the strike, then the ring
        const env = 0.6 * fastEnv(t / decay) + 0.4 * Math.exp(-t / 0.012) + l.click * 0.4 * Math.exp(-t / 0.002);
        out[i] = band.band * 2 * env;
      }
      break;
    }
  }
  drive(out, l.drive);
  return out;
}

/** The RMS of the loudest 50 ms of `x`. */
export function loudestRms(x: Float32Array, sampleRate: number): number {
  const win = Math.max(1, Math.round(0.05 * sampleRate));
  let sum = 0;
  let best = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i];
    if (i >= win) sum -= x[i - win] * x[i - win];
    best = Math.max(best, sum);
  }
  return Math.sqrt(Math.max(0, best) / win);
}

/** A layer's own noise seed within a sound (`variant` 0 is the sound as it always was; the others are other noise for its sides). */
const layerSeed = (seed: number, i: number, variant = 0) => (seed ^ Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(variant, 0x85ebca6b)) >>> 0;

/** A sound mixed, trimmed and made to its row's loudness, and what that took (for its sides, see renderDrumStereo). */
function renderMixed(sound: DrumSound, row: DesignRow, sampleRate: number, seed: number): { out: Float32Array; length: number; gain: number } | null {
  const length = Math.max(1, Math.round(drumSeconds(sound) * sampleRate));
  const mix = new Float32Array(length);
  sound.layers.forEach((l, i) => {
    const start = Math.round((l.delay / 1000) * sampleRate);
    if (start >= length) return;
    const y = renderLayer(l, length - start, sampleRate, layerSeed(seed, i));
    const gain = 10 ** (l.level / 20);
    for (let j = 0; j < y.length; j++) mix[start + j] += y[j] * gain;
  });
  const peak = peakOf(mix);
  if (!(peak > 0)) return null;
  // Trim what's under -70 dB of the peak off the end, then fade the last 3 ms
  let end = length;
  while (end > 1 && Math.abs(mix[end - 1]) < peak * 3.2e-4) end--;
  const out = mix.slice(0, Math.min(length, end + Math.round(0.003 * sampleRate)));
  fadeEnd(out, sampleRate);
  const rms = loudestRms(out, sampleRate);
  const gain = Math.min(10 ** ((ROW_LOUDNESS[row] + sound.level) / 20) / Math.max(1e-9, rms), DRUM_CEILING / peakOf(out));
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return { out, length, gain };
}

/** Fade the last 3 ms of `x` out. */
function fadeEnd(x: Float32Array, sampleRate: number): void {
  const fade = Math.min(x.length >> 1, Math.round(0.003 * sampleRate));
  for (let i = 0; i < fade; i++) x[x.length - 1 - i] *= i / fade;
}

/**
 * Render `sound` for `row` at `sampleRate`: its layers mixed at their levels and delays, made to
 * the row's loudness (ROW_LOUDNESS) plus its level, the peak kept under DRUM_CEILING, the silence
 * after it trimmed and the end faded. `seed` picks the noise.
 */
export function renderDrumSound(sound: DrumSound, row: DesignRow, sampleRate: number, seed = 0): Float32Array {
  return renderMixed(sound, row, sampleRate, seed)?.out ?? new Float32Array(1);
}

/** The voices whose noise is spread across the stereo field (renderDrumStereo): hats, cymbals and shakers. */
export const WIDE_VOICES: ReadonlySet<DrumLayer['voice']> = new Set(['hat', 'shaker']);
/** How wide they spread: the side's level against the noise in the middle (0.55: about 5 dB under it). */
export const DRUM_NOISE_WIDTH = 0.55;
/** Under this (Hz) nothing is spread: the side is high-passed here. */
export const DRUM_SIDE_LOW_CUT = 1200;

/**
 * The sound in stereo, for a sound with a hat or shaker layer (WIDE_VOICES); null for any other,
 * which plays in mono as before. A real hat or shaker is heard a little differently by each ear
 * (each mic of a stereo pair picks up its own mix of the sizzle), so its noise is spread: the
 * middle is the sound exactly as renderDrumSound makes it, and each side adds or takes away the
 * same "other" noise, the difference of two more renders of the noisy layers with other seeds, so
 * it is noise only (the metal, the clicks and every other layer cancel out of it), high-passed at
 * DRUM_SIDE_LOW_CUT and DRUM_NOISE_WIDTH as loud. Left plus right is the mono sound, so nothing
 * changes in mono but the level; both sides are turned down together so the hit carries the same
 * energy as the mono one did in each speaker, which keeps the row's loudness.
 */
export function renderDrumStereo(sound: DrumSound, row: DesignRow, sampleRate: number, seed = 0): { left: Float32Array; right: Float32Array } | null {
  if (!sound.layers.some((l) => WIDE_VOICES.has(l.voice))) return null;
  const mixed = renderMixed(sound, row, sampleRate, seed);
  if (!mixed) return null;
  const { out, length, gain } = mixed;
  const side = new Float32Array(length);
  sound.layers.forEach((l, i) => {
    const start = Math.round((l.delay / 1000) * sampleRate);
    if (!WIDE_VOICES.has(l.voice) || start >= length) return;
    const a = renderLayer(l, length - start, sampleRate, layerSeed(seed, i, 1));
    const b = renderLayer(l, length - start, sampleRate, layerSeed(seed, i, 2));
    const g = (10 ** (l.level / 20) * Math.SQRT1_2) * gain * DRUM_NOISE_WIDTH;
    for (let j = 0; j < a.length; j++) side[start + j] += (a[j] - b[j]) * g;
  });
  const s = side.subarray(0, out.length);
  const hp = new Svf(DRUM_SIDE_LOW_CUT, Math.SQRT1_2, sampleRate);
  for (let i = 0; i < s.length; i++) {
    hp.run(s[i]);
    s[i] = hp.high;
  }
  fadeEnd(s, sampleRate);
  let mid = 0;
  let wide = 0;
  for (let i = 0; i < out.length; i++) {
    mid += out[i] * out[i];
    wide += s[i] * s[i];
  }
  const left = new Float32Array(out.length);
  const right = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    left[i] = out[i] + s[i];
    right[i] = out[i] - s[i];
  }
  // The same energy in each speaker as the mono hit, and the peak still under the ceiling
  const k = Math.min(1 / Math.sqrt(1 + wide / Math.max(1e-20, mid)), DRUM_CEILING / Math.max(1e-9, peakOf(left), peakOf(right)));
  for (let i = 0; i < out.length; i++) {
    left[i] *= k;
    right[i] *= k;
  }
  return { left, right };
}

/** The peak of `x`. */
export function peakOf(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}
