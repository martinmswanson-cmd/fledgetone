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
