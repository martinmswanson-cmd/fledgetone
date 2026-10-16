/**
 * Fixes for Tone.js behaviour that breaks this app, applied when the module is imported (engine.ts
 * imports it before any oscillator exists). See each fix's comment below.
 */
import * as Tone from 'tone';
import { smoothSet } from './effects/smoothParam';
import { noiseStart, toneNoiseChannel } from './seededNoise';
import type { NoiseColour } from './seededNoise';

/**
 * Tone.Oscillator caches the PeriodicWave of every custom waveform (and any waveform with a
 * phase) in one list shared by all audio contexts, keyed only by the waveform. A PeriodicWave is
 * built for the sample rate of the context that made it, so an oscillator in another context
 * that reuses it plays at the wrong pitch: on a 48 kHz sound card the WAV export (44.1 kHz)
 * picked up the live context's Pad waveform and played it 44.1/48 slower, 147 cents flat, in
 * whichever passages its voices happened to be built from the cache. Each cached wave is tagged
 * with the context that made it, and an oscillator only reuses waves from its own context.
 */

type Wave = object;
/** (Held weakly: Tone keeps every wave for good, and a WAV export's context must still be let go) */
const madeIn = new WeakMap<Wave, WeakRef<object>>();

const contextProto = Tone.Context.prototype as unknown as {
  createPeriodicWave: (this: Tone.Context, ...args: unknown[]) => Wave;
};
const createPeriodicWave = contextProto.createPeriodicWave;
contextProto.createPeriodicWave = function (...args) {
  const wave = createPeriodicWave.apply(this, args);
  madeIn.set(wave, new WeakRef(this.rawContext as unknown as object));
  return wave;
};

const Oscillator = Tone.Oscillator as unknown as {
  _periodicWaveCache: Array<{ wave: Wave }>;
  prototype: { _getCachedPeriodicWave: (this: Tone.Oscillator) => unknown };
};
const getCached = Oscillator.prototype._getCachedPeriodicWave;
Oscillator.prototype._getCachedPeriodicWave = function () {
  // (Less the waves of contexts gone, such as finished exports')
  const all = Oscillator._periodicWaveCache.filter((entry) => madeIn.get(entry.wave)?.deref() !== undefined);
  // Tone looks the wave up in this list; let it see only waves made in this oscillator's context
  Oscillator._periodicWaveCache = all.filter((entry) => madeIn.get(entry.wave)?.deref() === (this.context.rawContext as unknown as object));
  try {
    return getCached.call(this);
  } finally {
    Oscillator._periodicWaveCache = all;
  }
};

/**
 * Tone turns a Transport position such as '768i' into ticks by way of seconds at the current
 * tempo, so a whole number of ticks can come back a hair off: 767.9999999999999 at 130 BPM,
 * 1536.0000000000002 at 150. The Transport files each event under the whole tick at or below its
 * time, so a note a hair short of its tick was filed under the tick before. It still played on
 * time in passing, but never when playback started on its tick or a loop came round to it: the
 * first beat after Play could be silent, and the downbeat of a loop went missing on every repeat.
 * A loop end a hair past its tick wrapped a tick late, so each pass of a loop (and of a seamless
 * loop export) ran a tick long. Every Transport time (events, loop points, start positions) goes
 * through here; a result within float noise of a whole tick is made whole.
 */
const timeProto = Tone.TimeClass.prototype as unknown as { toTicks: (this: Tone.TimeClass) => number };
const toTicks = timeProto.toTicks;
timeProto.toTicks = function () {
  const ticks = toTicks.call(this);
  const whole = Math.round(ticks);
  return Math.abs(ticks - whole) < 1e-6 ? whole : ticks;
};

/**
 * Tone.CrossFade (inside every Tone effect with a wet/dry mix: Reverb, Distortion, Chorus...)
 * connects the context's shared, always-running constant source to its panner and never
 * disconnects it, so each disposed effect left a panner alive and processing for good: one more
 * every time an instrument with a built-in effect was rebuilt (a new project, a changed
 * instrument). Disposing it now cuts that connection too.
 */
const crossFadeProto = Tone.CrossFade.prototype as unknown as {
  dispose: (this: Tone.CrossFade) => Tone.CrossFade;
};
const disposeCrossFade = crossFadeProto.dispose;
crossFadeProto.dispose = function () {
  const self = this as unknown as { _panner?: AudioNode; context: Tone.BaseContext };
  try {
    if (self._panner) (self.context.getConstant(1) as unknown as AudioNode).disconnect(self._panner);
  } catch {
    // Already disconnected
  }
  return disposeCrossFade.call(this);
};

/**
 * Tone.Solo silences the channels not soloed by setting their gain to 0 at once (and back to 1),
 * a click on every one of them that was sounding when a solo went on or off. It glides there
 * instead (see smoothParam.ts). A Solo just made isn't sounding yet, so it takes its gain at once.
 */
interface SoloInside {
  input: Tone.Gain;
  now: () => number;
  _isSoloed: () => boolean;
  _noSolos: () => boolean;
}
const soloProto = Tone.Solo.prototype as unknown as { _updateSolo: (this: SoloInside) => void };
const settled = new WeakSet<SoloInside>();
soloProto._updateSolo = function () {
  const gain = this.input.gain;
  const level = this._isSoloed() || this._noSolos() ? 1 : 0;
  if (!settled.has(this)) {
    settled.add(this);
    gain.value = level;
    return;
  }
  smoothSet(gain, level, this.now());
};

/**
 * Tone.Solo keeps every context's solos in a Map keyed by the context, and never lets go of the
 * key, so every WAV export's offline context (and the render it holds) stayed in memory for good.
 * The key goes with the context's last solo.
 */
const soloStatics = Tone.Solo as unknown as { _allSolos: Map<unknown, Set<unknown>>; _soloed: Map<unknown, Set<unknown>> };
const soloDisposer = Tone.Solo.prototype as unknown as { dispose: (this: Tone.Solo) => Tone.Solo };
const disposeSolo = soloDisposer.dispose;
soloDisposer.dispose = function () {
  const context = this.context;
  const result = disposeSolo.call(this);
  for (const all of [soloStatics._allSolos, soloStatics._soloed]) if (all.get(context)?.size === 0) all.delete(context);
  return result;
};

/**
 * Tone.Noise fills its noise buffers from Math.random (once per page) and starts each burst at a
 * random point of them, so the snare and hats of the synthesized kits came out different in every
 * export of the same song. Its noise comes from a fixed seed here (seededNoise.ts), the way Tone
 * makes it, and each burst starts at a point picked by the noise's key (seedToneNoise; 0 if it has
 * none) and its start time: each hit still differs from the next, the same way every time.
 * The buffers are made at 44.1 kHz whatever the context, as Tone's are, so the first context to
 * play noise doesn't decide its samples.
 */
interface NoiseInside {
  context: Tone.BaseContext;
  output: Tone.InputNode;
  _type: NoiseColour;
  _source: Tone.ToneBufferSource | null;
  _fadeIn: Tone.Unit.Time;
  _fadeOut: Tone.Unit.Time;
  _playbackRate: number;
  onstop: (source: unknown) => void;
  toSeconds: (time: Tone.Unit.Time) => number;
  /** Set by seedToneNoise */
  noiseKey?: number;
}
const TONE_NOISE_SECONDS = 5;
const toneNoiseBuffers = new Map<NoiseColour, Tone.ToneAudioBuffer>();
function toneNoiseBuffer(colour: NoiseColour): Tone.ToneAudioBuffer {
  let buffer = toneNoiseBuffers.get(colour);
  if (!buffer) {
    const rate = 44100;
    const audio = new AudioBuffer({ numberOfChannels: 2, length: TONE_NOISE_SECONDS * rate, sampleRate: rate });
    for (let c = 0; c < 2; c++) audio.copyToChannel(toneNoiseChannel(colour, audio.length, 0x70e + c * 0x1000), c);
    buffer = new Tone.ToneAudioBuffer(audio);
    toneNoiseBuffers.set(colour, buffer);
  }
  return buffer;
}
const noiseProto = Tone.Noise.prototype as unknown as { _start: (this: NoiseInside, time: Tone.Unit.Time) => void };
noiseProto._start = function (time) {
  const buffer = toneNoiseBuffer(this._type);
  const at = this.toSeconds(time);
  this._source = new Tone.ToneBufferSource({
    url: buffer,
    context: this.context,
    fadeIn: this._fadeIn,
    fadeOut: this._fadeOut,
    loop: true,
    onended: () => this.onstop(this),
    playbackRate: this._playbackRate,
  }).connect(this.output);
  this._source.start(at, noiseStart(this.noiseKey ?? 0, at) * (buffer.duration - 0.001));
};

/** Give a Tone.Noise (a NoiseSynth's `noise`) its key: see noiseKey, from the track's seed and which drum. */
export function seedToneNoise(noise: Tone.Noise, key: number): void {
  (noise as unknown as NoiseInside).noiseKey = key;
}
