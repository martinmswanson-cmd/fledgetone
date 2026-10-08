import * as Tone from 'tone';

/**
 * Building blocks for instruments made of plain Web Audio nodes, created for each note and let go
 * when it ends (the EDM synths and the FX instrument). Nothing of theirs runs between notes. Tone's
 * envelopes, LFOs and filters are the opposite: their ConstantSourceNodes (and, for Tone.Filter,
 * per-sample filter coefficients) keep the audio thread busy whether anything plays or not.
 * Envelopes and sweeps are parameter automation scheduled with the note, so they are
 * sample-accurate live and in the WAV export alike.
 *
 * Nodes come from the raw context of the output they're given: the WAV export builds instruments
 * in its own OfflineAudioContext. Live, that's standardized-audio-context's wrapper and offline the
 * native context, so only the factory methods both share are used (createOscillator, createGain...).
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
  return { bus, raw: bus.context.rawContext as unknown as BaseAudioContext, input: bus.input as unknown as AudioNode };
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
 */
export function createVoiceSet(raw: BaseAudioContext, lingerSeconds = 0) {
  const voices = new Set<NativeVoice>();
  const disconnect = (v: NativeVoice) => v.nodes.forEach((n) => n.disconnect());
  return {
    add(v: NativeVoice): void {
      voices.add(v);
      v.sources.forEach((s) => s.stop(v.stopAt));
      v.sources[0].onended = () => {
        voices.delete(v);
        if (lingerSeconds > 0) atAudioTime(raw, raw.currentTime + lingerSeconds, () => disconnect(v));
        else disconnect(v);
      };
    },
    /** Let a voice ring until `stopAt` instead (a later stop() replaces an earlier one). */
    extend(v: NativeVoice, stopAt: number): void {
      v.stopAt = stopAt;
      v.sources.forEach((s) => s.stop(stopAt));
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
        }
        v.sources.forEach((s) => s.stop(v.stopAt));
      }
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

const driveCurves = new Map<number, Float32Array<ArrayBuffer>>();

/** A soft-clipping WaveShaper curve (tanh), `amount` 1 = gentle, 4 = hard. Shared, as nodes copy it. */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  let curve = driveCurves.get(amount);
  if (!curve) {
    curve = new Float32Array(2049);
    const norm = Math.tanh(amount);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 1024 - 1) * amount) / norm;
    driveCurves.set(amount, curve);
  }
  return curve;
}

export function createDrive(raw: BaseAudioContext, amount: number): WaveShaperNode {
  const shaper = raw.createWaveShaper();
  shaper.curve = driveCurve(amount);
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
      const real = new Float32Array(SAW_PARTIALS + 1);
      const imag = new Float32Array(SAW_PARTIALS + 1);
      const shift = phase * 2 * Math.PI;
      for (let k = 1; k <= SAW_PARTIALS; k++) {
        // The saw's sine series, each partial rotated by k times the shift
        const b = (k % 2 ? 2 : -2) / (Math.PI * k);
        real[k] = b * Math.sin(k * shift);
        imag[k] = b * Math.cos(k * shift);
      }
      return raw.createPeriodicWave(real, imag);
    });
    sets.set(key, waves);
  }
  return waves;
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
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * NOISE_LEVEL;
    }
    noiseBuffers.set(raw, buffer);
  }
  return buffer;
}

/** Looping stereo noise from `at`, starting at a random point of the loop. */
export function createNoise(raw: BaseAudioContext, at: number): AudioBufferSourceNode {
  const noise = raw.createBufferSource();
  noise.buffer = noiseBuffer(raw);
  noise.loop = true;
  noise.start(at, Math.random() * NOISE_SECONDS);
  return noise;
}
