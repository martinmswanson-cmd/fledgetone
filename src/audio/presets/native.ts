import * as Tone from 'tone';
import { keepActive, nativeContextOf, nativeInputOf } from '../nativeNodes';
import { fillWhiteNoise, noiseStart } from '../seededNoise';

/**
 * Building blocks for instruments made of plain Web Audio nodes, created for each note and let go
 * when it ends (the EDM synths and the FX instrument). Nothing of theirs runs between notes. Tone's
 * envelopes, LFOs and filters are the opposite: their ConstantSourceNodes (and, for Tone.Filter,
 * per-sample filter coefficients) keep the audio thread busy whether anything plays or not.
 * Envelopes and sweeps are parameter automation scheduled with the note, so they are
 * sample-accurate live and in the WAV export alike.
 *
 * Nodes are made on the browser's own context under the output they're given (createBus): the
 * live one, or the WAV export's OfflineAudioContext. Not through Tone's wrapper
 * (standardized-audio-context), which added a gain to every buffer source and walked the graph
 * downstream on every connect; per note, both added up (see nativeNodes.ts).
 */

/** An instrument's output gain on the track strip, and the raw context its notes are built in. */
export interface NativeBus {
  bus: Tone.Gain;
  raw: BaseAudioContext;
  /** Where notes connect. */
  input: AudioNode;
}

export function createBus(output: Tone.InputNode): NativeBus {
  const bus = new Tone.Gain(1).connect(output);
  // Notes are made on the browser's own context, not through Tone's wrapper (see nativeNodes.ts),
  // so the bus must be kept in the graph with nothing the wrapper knows of feeding it
  const letGo = keepActive(bus);
  const dispose = bus.dispose.bind(bus);
  bus.dispose = () => {
    letGo();
    return dispose();
  };
  return { bus, raw: nativeContextOf(bus.context), input: nativeInputOf(bus) };
}

/** Hz of a note name ("C2", "F#3"). */
export const noteFrequency = (note: string): number => Tone.Frequency(note).toFrequency();

/** One sounding note's nodes, kept so Stop can release them and dispose can silence them. */
export interface NativeVoice {
  /** When it starts sounding (seconds, context time). */
  start: number;
  /** When its sources stop. */
  stopAt: number;
  sources: AudioScheduledSourceNode[];
  /** Every node to disconnect once it has finished (sources included). */
  nodes: AudioNode[];
  /** Its loudness envelope, ramped down by releaseAll. */
  amp: GainNode;
}

/**
 * Run `then` when the audio reaches `at`: a source stopped as it starts is a free timer, whose
 * 'ended' event comes when the audio gets there (in the export, when the render does).
 */
export function atAudioTime(raw: BaseAudioContext, at: number, then: () => void): void {
  const timer = raw.createConstantSource();
  timer.onended = then;
  timer.start(at);
  timer.stop(at);
}

/**
 * The voices an instrument has playing. A voice is forgotten, and its nodes disconnected, when its
 * sources end, which the browser reports only once the audio has actually got there (in the
 * export, once the render has), so nothing is let go before it has been heard.
 *
 * `lingerSeconds` waits that long after the end before disconnecting, for voices fed by noise
 * (AudioBufferSourceNodes): in Chrome, a filter disconnected the instant the noise feeding it
 * ended went on costing render time for good, so a long export got slower and slower. Left a
 * moment, Chrome retires the finished nodes first and the disconnect costs nothing. Voices of
 * oscillators don't need it (and keeping them connected longer isn't free).
 *
 * A voice's amp falls to exactly 0 when its sources stop (it is about 60 dB down by then), so
 * whenever its nodes are let go, nothing is cut short: the ending is reported when the main
 * thread gets to it, a moment that varies, and a filter's last ringing cut there made two exports
 * of the same song differ (about -80 dB).
 */
export function createVoiceSet(raw: BaseAudioContext, lingerSeconds = 0) {
  const voices = new Set<NativeVoice>();
  const disconnect = (v: NativeVoice) => v.nodes.forEach((n) => n.disconnect());
  const silenceAtStop = (v: NativeVoice) => {
    if (Number.isFinite(v.stopAt)) v.amp.gain.setValueAtTime(0, v.stopAt);
  };
  return {
    add(v: NativeVoice): void {
      voices.add(v);
      v.sources.forEach((s) => s.stop(v.stopAt));
      silenceAtStop(v);
      v.sources[0].onended = () => {
        voices.delete(v);
        if (lingerSeconds > 0) atAudioTime(raw, raw.currentTime + lingerSeconds, () => disconnect(v));
        else disconnect(v);
      };
    },
    /**
     * Let a voice ring until `stopAt` instead (a later stop() replaces an earlier one). The caller
     * has cancelled the amp's events from before the old stop (its silence there with them).
     */
    extend(v: NativeVoice, stopAt: number): void {
      v.stopAt = stopAt;
      v.sources.forEach((s) => s.stop(stopAt));
      silenceAtStop(v);
    },
    /** Fade every voice out from `now` (Stop): sounding ones over `fade` seconds, future ones never start. */
    releaseAll(now: number, fade = 0.03): void {
      for (const v of voices) {
        if (v.stopAt <= now) continue;
        if (v.start >= now) {
          v.stopAt = v.start;
        } else {
          // Hold the level it has reached (cancelling would undo a swell in progress: a jump)
          const gain = v.amp.gain;
          if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
          else gain.cancelScheduledValues(now);
          gain.setTargetAtTime(0, now, fade / 3);
          v.stopAt = Math.min(v.stopAt, now + fade * 3);
          silenceAtStop(v);
        }
        v.sources.forEach((s) => s.stop(v.stopAt));
      }
    },
    /**
     * Call off the voices still to come at `now` (Stop on a drum kit): they never start. Sounding
     * ones ring out as they would have.
     */
    callOffComing(now: number): void {
      for (const v of voices) {
        if (v.start < now || v.stopAt <= now) continue;
        v.stopAt = v.start;
        v.sources.forEach((s) => s.stop(v.stopAt));
      }
    },
    /**
     * Let one voice go at `at` (a key released on a MIDI keyboard) with a release of `seconds`,
     * the way its own end would have: it holds the level it has reached and falls from there.
     */
    release(v: NativeVoice, at: number, seconds: number): void {
      if (!voices.has(v) || v.stopAt <= at) return;
      if (v.start >= at) {
        v.stopAt = v.start;
      } else {
        const gain = v.amp.gain;
        if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(at);
        else gain.cancelScheduledValues(at);
        gain.setTargetAtTime(0, at, releaseConstant(seconds));
        v.stopAt = Math.min(v.stopAt, at + releaseTail(seconds));
        silenceAtStop(v);
      }
      v.sources.forEach((s) => s.stop(v.stopAt));
    },
    /** For disposal: silence everything now. */
    stopAll(): void {
      for (const v of voices) {
        v.sources.forEach((s) => {
          s.onended = null;
          s.stop();
        });
        disconnect(v);
      }
      voices.clear();
    },
  };
}

/**
 * Attack and decay to a sustain level, from silence at `at`. Each stage is an exponential approach
 * (setTargetAtTime), like an analog envelope: an approach can be overtaken at any moment by the
 * next stage, a legato note or a release, without the jump a cancelled ramp would make.
 * `attack` and `decay` are the times to get 95% of the way.
 */
export function attackDecay(param: AudioParam, at: number, peak: number, attack: number, decay: number, sustain: number): void {
  param.setValueAtTime(0, at);
  param.setTargetAtTime(peak, at, attack / 3);
  param.setTargetAtTime(peak * sustain, at + attack, decay / 3);
}

/** Time constant of a release that falls 40 dB in `seconds`. */
export const releaseConstant = (seconds: number) => seconds / Math.log(100);

/** Release tail to let ring before stopping the sources: about -60 dB. */
export const releaseTail = (seconds: number) => seconds * 1.5;

const driveCurves = new Map<string, Float32Array<ArrayBuffer>>();

/**
 * A soft-clipping WaveShaper curve (tanh), `amount` 1 = gentle, 4 = hard. Shared, as nodes copy it.
 * `pre` and `post` are gains before and after it, folded in: the input is scaled by `pre`, clipped
 * to the curve's ends as a shaper would, and the result scaled by `post`. Points are spaced as
 * finely as the plain curve's over the part the input really uses.
 */
function driveCurve(amount: number, pre: number, post: number): Float32Array<ArrayBuffer> {
  const key = `${amount}|${pre}|${post}`;
  let curve = driveCurves.get(key);
  if (!curve) {
    const half = 1024 * Math.max(1, Math.ceil(pre));
    curve = new Float32Array(2 * half + 1);
    const norm = Math.tanh(amount);
    for (let i = 0; i < curve.length; i++) curve[i] = (post * Math.tanh(Math.max(-1, Math.min(1, (i / half - 1) * pre)) * amount)) / norm;
    // A patch's drive knob makes a new curve per setting: keep the most recent few
    if (driveCurves.size >= 32) driveCurves.delete(driveCurves.keys().next().value!);
    driveCurves.set(key, curve);
  }
  return curve;
}

/**
 * A tanh drive. `pre` and `post` are a gain before and after it, built into its curve instead of
 * being two more nodes (the same sound: gains commute with the shaper's oversampling filters).
 */
export function createDrive(raw: BaseAudioContext, amount: number, pre = 1, post = 1): WaveShaperNode {
  const shaper = raw.createWaveShaper();
  shaper.curve = driveCurve(amount, pre, post);
  // Clipping makes harmonics above the top of hearing, which fold back down as harsh, out-of-tune
  // fizz; shaped at four times the rate, they're filtered out before they can
  shaper.oversample = '4x';
  return shaper;
}

export function createFilter(raw: BaseAudioContext, type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
  const filter = raw.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  return filter;
}

/** An oscillator on `type` (or a PeriodicWave) at `frequency`, `detune` cents off, starting at `at`. */
export function createOsc(raw: BaseAudioContext, type: OscillatorType | PeriodicWave, frequency: number, at: number, detune = 0): OscillatorNode {
  const osc = raw.createOscillator();
  // (PeriodicWave is an empty interface to TypeScript, so a string narrows no better than this)
  if (typeof type === 'string') osc.type = type as OscillatorType;
  else osc.setPeriodicWave(type);
  osc.frequency.setValueAtTime(frequency, at);
  if (detune) osc.detune.value = detune;
  osc.start(at);
  return osc;
}

/**
 * Partials in the generated waves (the browser band-limits them per note): every harmonic up to
 * 20 kHz from C2 up. Lower bass notes lose only their top harmonics, which their filters remove anyway.
 */
const SAW_PARTIALS = 512;

const sawWaves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave[]>>();

/**
 * Sawtooth waves with their cycle shifted by each of `phases` (0-1). Detuned saws that all start
 * in step sweep audibly ("zip") as they drift apart; analog oscillators never line up like that.
 * Built once per context and set of phases.
 */
export function phasedSaws(raw: BaseAudioContext, phases: readonly number[]): PeriodicWave[] {
  let sets = sawWaves.get(raw);
  if (!sets) sawWaves.set(raw, (sets = new Map()));
  const key = phases.join(',');
  let waves = sets.get(key);
  if (!waves) {
    waves = phases.map((phase) => {
      const { real, imag } = phasedSawSeries(phase);
      return raw.createPeriodicWave(real, imag);
    });
    sets.set(key, waves);
  }
  return waves;
}

/** A sawtooth's harmonics with its cycle shifted by `phase` (0-1). */
function phasedSawSeries(phase: number): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(SAW_PARTIALS + 1);
  const imag = new Float32Array(SAW_PARTIALS + 1);
  const shift = phase * 2 * Math.PI;
  for (let k = 1; k <= SAW_PARTIALS; k++) {
    // The saw's sine series, each partial rotated by k times the shift
    const b = (k % 2 ? 2 : -2) / (Math.PI * k);
    real[k] = b * Math.sin(k * shift);
    imag[k] = b * Math.cos(k * shift);
  }
  return { real, imag };
}

/** One of phasedSaws' waves at `level` (see scaledWave): the oscillator needs no gain node after it. */
export const phasedSaw = (raw: BaseAudioContext, phase: number, level: number): PeriodicWave =>
  scaledWave(raw, `saw@${phase}`, () => phasedSawSeries(phase), level);

/**
 * The size of the table a browser builds a PeriodicWave in at `rate`, whose peak a normalized wave
 * is scaled to 1 by (Chrome's sizes; Firefox and Safari normalize the same way).
 */
const waveTableSize = (rate: number) => (rate <= 24000 ? 2048 : rate <= 88200 ? 4096 : 16384);

/** 1 / the peak of a wave's full-band table, as the browser normalizes it. Keyed by the wave's id and table size. */
const normalizers = new Map<string, number>();

function normalizer(id: string, real: Float32Array, imag: Float32Array, size: number): number {
  const key = `${id}|${size}`;
  let scale = normalizers.get(key);
  if (scale === undefined) {
    const partials = Math.min(real.length - 1, size / 2 - 1);
    const table = new Float64Array(size);
    for (let k = 1; k <= partials; k++) {
      const a = real[k];
      const b = imag[k];
      if (!a && !b) continue;
      // cos and sin of 2 pi k i / size, by turning a unit vector a step per sample (renormalized now and then)
      const stepCos = Math.cos((2 * Math.PI * k) / size);
      const stepSin = Math.sin((2 * Math.PI * k) / size);
      let c = 1;
      let s = 0;
      for (let i = 0; i < size; i++) {
        table[i] += a * c + b * s;
        const turned = c * stepCos - s * stepSin;
        s = s * stepCos + c * stepSin;
        c = turned;
        if ((i & 255) === 255) {
          const r = Math.hypot(c, s);
          c /= r;
          s /= r;
        }
      }
    }
    let peak = 0;
    for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(table[i]));
    scale = peak > 0 ? 1 / peak : 1;
    normalizers.set(key, scale);
  }
  return scale;
}

const scaledWaves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

/**
 * A wave played at `level` of its normalized self: exactly what the browser's normalized wave
 * through a gain of `level` sounds like, from one oscillator and no gain node. `id` names the
 * coefficients (`make` builds them); built once per context and level, the most recent 48 kept.
 * `phase` (0-1) starts it that far into its cycle.
 */
export function scaledWave(raw: BaseAudioContext, id: string, make: () => { real: Float32Array; imag: Float32Array }, level: number, phase = 0): PeriodicWave {
  let waves = scaledWaves.get(raw);
  if (!waves) scaledWaves.set(raw, (waves = new Map()));
  const key = `${id}|${level}|${phase}`;
  let wave = waves.get(key);
  if (!wave) {
    const { real, imag } = make();
    const scale = level * normalizer(id, real, imag, waveTableSize(raw.sampleRate));
    const r = real.map((v) => v * scale);
    const i = imag.map((v) => v * scale);
    if (phase) {
      // Each harmonic turned by k times the shift: the same wave, `phase` of a cycle further on
      for (let k = 1; k < r.length; k++) {
        const c = Math.cos(2 * Math.PI * k * phase);
        const sn = Math.sin(2 * Math.PI * k * phase);
        const a = r[k];
        const b = i[k];
        r[k] = a * c + b * sn;
        i[k] = b * c - a * sn;
      }
    }
    wave = raw.createPeriodicWave(r, i, { disableNormalization: true });
    // A patch's level knob makes a new wave per setting: keep the most recent ones
    if (waves.size >= 48) waves.delete(waves.keys().next().value!);
    waves.set(key, wave);
  }
  return wave;
}

/**
 * The browser's own sine, square, sawtooth or triangle at `level` (see scaledWave): the same
 * series and number of harmonics as its built-in waves.
 */
export function builtinWave(raw: BaseAudioContext, type: 'sine' | 'square' | 'sawtooth' | 'triangle', level: number, phase = 0): PeriodicWave {
  const size = waveTableSize(raw.sampleRate);
  return scaledWave(
    raw,
    `builtin:${type}:${size}`,
    () => {
      const n = size / 2;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) {
        if (type === 'sine') imag[k] = k === 1 ? 1 : 0;
        else if (type === 'square') imag[k] = k % 2 ? 4 / (Math.PI * k) : 0;
        else if (type === 'sawtooth') imag[k] = (k % 2 ? 2 : -2) / (Math.PI * k);
        else imag[k] = k % 2 ? (8 / (Math.PI * k) ** 2) * ((k - 1) % 4 ? -1 : 1) : 0;
      }
      return { real, imag };
    },
    level,
    phase
  );
}

const leveledWaves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

/**
 * A sine, square or sawtooth wave at `level` instead of full scale: an oscillator playing it
 * replaces an oscillator and a gain node. Each node a sounding voice has costs the audio thread
 * time in every block, so a busy bass line plays noticeably cheaper with fewer. Built once per
 * context and level.
 */
export function leveledWave(raw: BaseAudioContext, type: 'sine' | 'square' | 'sawtooth', level: number): PeriodicWave {
  let waves = leveledWaves.get(raw);
  if (!waves) leveledWaves.set(raw, (waves = new Map()));
  const key = `${type}|${level}`;
  let wave = waves.get(key);
  if (!wave) {
    const partials = type === 'sine' ? 1 : SAW_PARTIALS;
    const real = new Float32Array(partials + 1);
    const imag = new Float32Array(partials + 1);
    for (let k = 1; k <= partials; k++) {
      // Fourier series of each wave (the same phase as the browser's built-in types)
      if (type === 'sine') imag[k] = 1;
      else if (type === 'square') imag[k] = k % 2 ? 4 / (Math.PI * k) : 0;
      else imag[k] = (k % 2 ? 2 : -2) / (Math.PI * k);
      imag[k] *= level;
    }
    wave = raw.createPeriodicWave(real, imag, { disableNormalization: true });
    waves.set(key, wave);
  }
  return wave;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Seconds of stereo white noise the FX loop (long enough that the repeat isn't heard under a sweep). */
const NOISE_SECONDS = 4;
/**
 * The FX were voiced through a track strip that folded stereo to mono, where two unrelated noise
 * streams averaged to half their power. The strip keeps both sides now, so each is 3 dB down to
 * leave the FX as loud as they were voiced, only wide.
 */
const NOISE_LEVEL = Math.SQRT1_2;

function noiseBuffer(raw: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(raw);
  if (!buffer) {
    buffer = raw.createBuffer(2, Math.round(NOISE_SECONDS * raw.sampleRate), raw.sampleRate);
    // (from a fixed seed per side: the same noise in every context and every export, see seededNoise.ts)
    for (let c = 0; c < 2; c++) fillWhiteNoise(buffer.getChannelData(c), 0x51ed + c, NOISE_LEVEL);
    noiseBuffers.set(raw, buffer);
  }
  return buffer;
}

/**
 * Looping stereo noise from `at`, starting at a point of the loop picked by `key` (see noiseKey:
 * the instrument's seed and what plays) and `at`, so each burst differs from the next, the same
 * way every time the song plays.
 */
export function createNoise(raw: BaseAudioContext, at: number, key: number): AudioBufferSourceNode {
  const noise = raw.createBufferSource();
  noise.buffer = noiseBuffer(raw);
  noise.loop = true;
  noise.start(at, noiseStart(key, at) * NOISE_SECONDS);
  return noise;
}
