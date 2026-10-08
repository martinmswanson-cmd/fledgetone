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
 * The voices an instrument has playing. A voice is forgotten, and its nodes disconnected, when its
 * sources end, which the browser reports only once the audio has actually got there (in the
 * export, once the render has), so nothing is let go before it has been heard.
 */
export function createVoiceSet() {
  const voices = new Set<NativeVoice>();
  const disconnect = (v: NativeVoice) => v.nodes.forEach((n) => n.disconnect());
  return {
    add(v: NativeVoice): void {
      voices.add(v);
      v.sources.forEach((s) => s.stop(v.stopAt));
      v.sources[0].onended = () => {
        voices.delete(v);
        disconnect(v);
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
          v.amp.gain.cancelScheduledValues(now);
          v.amp.gain.setTargetAtTime(0, now, fade / 3);
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

const sawWaves = new WeakMap<BaseAudioContext, PeriodicWave[]>();

/** Partials in the phase-shifted saws: band-limited by the browser, enough for any note from C2 up. */
const SAW_PARTIALS = 512;

/**
 * Sawtooth waves with their cycle shifted by each of `phases` (0-1). Detuned saws that all start
 * in step sweep audibly ("zip") as they drift apart; analog oscillators never line up like that.
 * Built once per context.
 */
export function phasedSaws(raw: BaseAudioContext, phases: readonly number[]): PeriodicWave[] {
  let waves = sawWaves.get(raw);
  if (!waves) {
    waves = phases.map((phase) => {
      const real = new Float32Array(SAW_PARTIALS + 1);
      const imag = new Float32Array(SAW_PARTIALS + 1);
      const shift = phase * 2 * Math.PI;
      for (let k = 1; k <= SAW_PARTIALS; k++) {
        // The saw's sine series, each partial rotated by k times the shift
        const b = ((k % 2 ? 2 : -2) / (Math.PI * k));
        real[k] = b * Math.sin(k * shift);
        imag[k] = b * Math.cos(k * shift);
      }
      return raw.createPeriodicWave(real, imag);
    });
    sawWaves.set(raw, waves);
  }
  return waves;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Seconds of stereo white noise the FX loop (long enough that the repeat isn't heard under a sweep). */
const NOISE_SECONDS = 4;

function noiseBuffer(raw: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(raw);
  if (!buffer) {
    buffer = raw.createBuffer(2, Math.round(NOISE_SECONDS * raw.sampleRate), raw.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
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
