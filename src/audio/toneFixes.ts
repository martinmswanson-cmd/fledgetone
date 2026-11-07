/**
 * Fixes for Tone.js behaviour that breaks this app, applied when the module is imported (engine.ts
 * imports it before any oscillator exists). See each fix's comment below.
 */
import * as Tone from 'tone';
import { smoothSet } from './effects/smoothParam';
import { noiseStart, toneNoiseChannel } from './seededNoise';
import type { NoiseColour } from './seededNoise';
import { ATTACK_TRIES, attackRoom, soundLead } from './soundLead';

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

/**
 * A Tone one-shot source (the node behind every oscillator and sample start) sets its gain to 1
 * at its start, and notes the start as no earlier than the clock, so that cancelling its stop
 * later (a restart, or any stop: Tone cancels from just after the start) leaves that alone. But
 * the browser moves a gain set in the past up to the clock as it's set, and the clock can step on
 * between Tone reading it and setting the gain (a busy main thread, live): the gain was then set
 * after the start Tone noted, the next stop or restart cancelled it, and the whole note played at
 * a gain of 0, silent (now and then a hi-hat, snare or kick hit played by hand under load). The
 * start is noted no earlier than the clock once the gain is set. (An export's clock waits for its
 * notes, so nothing changes there.)
 */
interface OneShotInside {
  context: Tone.BaseContext;
  _startTime: number;
}
const oneShotProto = Object.getPrototypeOf(Tone.ToneBufferSource.prototype) as { _startGain: (this: OneShotInside, time: number, gain?: number) => unknown };
const startGain = oneShotProto._startGain;
oneShotProto._startGain = function (time, gain) {
  const result = startGain.call(this, time, gain);
  this._startTime = Math.max(this._startTime, this.context.currentTime);
  return result;
};

/**
 * The browser renders sound a render block (128 frames) at a time, a whole render callback's worth
 * of blocks in one go (10 ms or so, the context's baseLatency), and the audio clock the page reads
 * steps on a block at a time as it does. So the page can read the clock at the start of a callback
 * the sound is already being made for, and a time up to a callback past what it read can be behind
 * the sound by the time it's set. A Tone envelope whose attack (and the start of its decay, a
 * millisecond on) reaches the browser once the sound has passed it has all those moments moved up
 * to where the sound is, at once, and the note then often never rises: it only creeps towards the
 * level it holds at (a drum's 0, a held note's sustain), silent or 20 to 40 dB quiet. A hit played
 * by hand (then 5 ms past the clock, see monotonic.ts) did that now and then, more often on a busy
 * computer, the page held up between reading the clock and setting the attack.
 *
 * Live, a Tone synth's note (every one-voice synth, a PolySynth's voices, the NoiseSynth) starts
 * no sooner than a render callback past the clock as it is when it's struck, the whole note
 * moved up together. Its envelopes' attacks are held to that too, as each is set; and when the
 * clock has moved on past that while an attack was being set (the page held up part way), it's
 * struck again a callback past the clock as it is then: a little late, but whole. A release that
 * would come before a moved attack, or within as long again after it, moves with it (so it can't
 * cut the attack off); a later one is left where it is. An export's clock waits for its notes, so
 * nothing changes there.
 */
interface EnvelopeInside {
  context: Tone.BaseContext;
  toSeconds: (time?: Tone.Unit.Time) => number;
  /** Where the last attack was asked for and where it went, when it was moved. */
  _movedAttack?: { asked: number; at: number };
  /** Where the last attack was set. */
  _struckAt?: number;
}
const envelopeProto = Tone.Envelope.prototype as unknown as {
  triggerAttack: (this: EnvelopeInside, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerRelease: (this: EnvelopeInside, time?: Tone.Unit.Time) => unknown;
};
const triggerAttack = envelopeProto.triggerAttack;
const triggerRelease = envelopeProto.triggerRelease;
// (How far past the clock an attack must be set: shared with the synths of plain Web Audio nodes, see soundLead.ts)
export { attackRoom, soundLead };

envelopeProto.triggerAttack = function (time, velocity) {
  if (this.context.isOffline) return triggerAttack.call(this, time, velocity);
  const asked = this.toSeconds(time);
  let at = Math.max(asked, attackRoom(this.context));
  let result = triggerAttack.call(this, at, velocity);
  for (let tries = 1; tries < ATTACK_TRIES && attackRoom(this.context) > at; tries++) {
    at = attackRoom(this.context);
    result = triggerAttack.call(this, at, velocity);
  }
  this._movedAttack = at > asked ? { asked, at } : undefined;
  this._struckAt = at;
  return result;
};

envelopeProto.triggerRelease = function (time) {
  const moved = this._movedAttack;
  if (!moved || this.context.isOffline) return triggerRelease.call(this, time);
  let when = this.toSeconds(time);
  const delay = moved.at - moved.asked;
  if (when >= moved.asked && when < moved.at + delay) when += delay;
  return triggerRelease.call(this, when);
};

/**
 * The same hold-up can come between a Tone synth's envelope and its sound source, which Tone
 * starts just after it: Tone moves a start that's already past up to the clock, so the source then
 * began after the attack had gone by on silence (and a drum's, stopped at the end of its decay,
 * was cut off at once). Live, when a synth's source has started more than a block after its
 * envelope's attack, the whole note is struck again a callback past the clock, sources and all
 * (and again, up to three strikes in all, should the page be held up once more).
 */
interface StartsInside {
  _state?: { getLastState: (state: 'started', time: number) => { time: number } | undefined };
  _oscillator?: StartsInside;
  _carrier?: StartsInside;
  _modulator?: StartsInside;
}
/** Where `source`'s last start is set, even if a stop is set after it (and its own inner oscillator's, which Tone clamps to the clock again). */
function latestStart(source: StartsInside | undefined): number {
  let t = source?._state?.getLastState('started', Infinity)?.time ?? -Infinity;
  for (const inner of [source?._oscillator, source?._carrier, source?._modulator]) if (inner && inner !== source && inner._state) t = Math.max(t, latestStart(inner));
  return t;
}
interface SynthInside {
  context: Tone.BaseContext;
  toSeconds: (time?: Tone.Unit.Time) => number;
  envelope?: EnvelopeInside;
  filterEnvelope?: EnvelopeInside;
  modulationEnvelope?: EnvelopeInside;
  oscillator?: StartsInside;
  modulation?: StartsInside;
  noise?: StartsInside;
  _oscillators?: StartsInside[];
  _strikingAgain?: boolean;
}
type Strike = (this: SynthInside, ...args: unknown[]) => unknown;
/** A synth's triggerAttack (its time argument `timeAt`): the whole note no sooner than a callback past the clock, and struck again when its source started after its envelope. */
function strikeWhole(proto: { triggerAttack: Strike }, timeAt: number): void {
  const strike = proto.triggerAttack;
  proto.triggerAttack = function (...args) {
    if (this.context.isOffline || this._strikingAgain) return strike.apply(this, args);
    const asked = this.toSeconds(args[timeAt] as Tone.Unit.Time);
    const first = [...args];
    first[timeAt] = Math.max(asked, attackRoom(this.context));
    this._strikingAgain = true;
    let result: unknown;
    try {
      result = strike.apply(this, first);
      // (Struck again until it comes whole: a page held up once is often held up again)
      for (let tries = 1; tries < ATTACK_TRIES; tries++) {
        const struck = this.envelope?._struckAt;
        let started = -Infinity;
        for (const source of [this.oscillator, this.modulation, this.noise, ...(this._oscillators ?? [])]) started = Math.max(started, latestStart(source));
        if (struck === undefined || !(started > struck + 128 / this.context.sampleRate)) break;
        const again = [...args];
        again[timeAt] = attackRoom(this.context);
        try {
          strike.apply(this, again);
        } catch {
          // (Refused: the note as it came last)
          break;
        }
      }
    } finally {
      this._strikingAgain = false;
    }
    // (Its release, if it would cut the attack where it went, moves with it: see the envelope's)
    for (const env of [this.envelope, this.filterEnvelope, this.modulationEnvelope]) if (env?._struckAt !== undefined && env._struckAt > asked) env._movedAttack = { asked, at: env._struckAt };
    return result;
  };
}
// (Monophonic, which Tone keeps to itself: every one-voice synth but the NoiseSynth, a PolySynth's voices too)
strikeWhole(Object.getPrototypeOf(Tone.Synth.prototype) as { triggerAttack: Strike }, 1);
strikeWhole(Tone.NoiseSynth.prototype as unknown as { triggerAttack: Strike }, 0);
