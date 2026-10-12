import * as Tone from 'tone';

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
const madeIn = new WeakMap<Wave, unknown>();

const contextProto = Tone.Context.prototype as unknown as {
  createPeriodicWave: (this: Tone.Context, ...args: unknown[]) => Wave;
};
const createPeriodicWave = contextProto.createPeriodicWave;
contextProto.createPeriodicWave = function (...args) {
  const wave = createPeriodicWave.apply(this, args);
  madeIn.set(wave, this.rawContext);
  return wave;
};

const Oscillator = Tone.Oscillator as unknown as {
  _periodicWaveCache: Array<{ wave: Wave }>;
  prototype: { _getCachedPeriodicWave: (this: Tone.Oscillator) => unknown };
};
const getCached = Oscillator.prototype._getCachedPeriodicWave;
Oscillator.prototype._getCachedPeriodicWave = function () {
  const all = Oscillator._periodicWaveCache;
  // Tone looks the wave up in this list; let it see only waves made in this oscillator's context
  Oscillator._periodicWaveCache = all.filter((entry) => madeIn.get(entry.wave) === this.context.rawContext);
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
