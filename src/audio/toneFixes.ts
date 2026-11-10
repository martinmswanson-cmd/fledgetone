/**
 * Fixes for Tone.js behaviour that breaks this app, applied when the module is imported (engine.ts
 * imports it before any oscillator exists). See each fix's comment below.
 */
import * as Tone from 'tone';
import { smoothSet } from './effects/smoothParam';
import { noiseStart, toneNoiseLoop } from './seededNoise';
import type { NoiseColour } from './seededNoise';
import { struckLater } from './songPlace';
import { attackNow, attackRoom, ifUndone, soundLead, soundReached, strikeAsked, strikeSettled, strikeWhole, whenHeard } from './soundLead';

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
 * Tone.Oscillator (in every Tone synth: each note's oscillators, the hi-hat's six pairs, and the
 * pulse, fat, AM and FM kinds made of it) makes a new browser oscillator at each start and
 * connects its own pitch and detune to it, and never disconnects them: every oscillator that had
 * ended stayed connected and was kept in memory for good, with its settings' history. A hi-hat
 * left about ten behind each hit, so over a long session the page grew by tens of megabytes and
 * each hit played by hand took longer to set (on a busy computer a second and more after a few
 * thousand, some then late enough to play quiet). Once a browser oscillator has ended (it makes
 * no sound after that), its pitch and detune are disconnected from it; one still sounding, even
 * in its fade after a stop, keeps them. Exports sound the same.
 */
interface EndedInside {
  addEventListener: (type: 'ended', listener: () => void, options?: { once?: boolean }) => void;
}
interface Disconnects {
  disconnect: (destination: AudioParam) => unknown;
}
/** When `oscillator` (a browser oscillator) ends, disconnect each [source, its param] pair (each on its own: one already gone doesn't keep the rest). */
export function disconnectWhenEnded(oscillator: EndedInside, links: ReadonlyArray<readonly [Disconnects, AudioParam]>): void {
  oscillator.addEventListener(
    'ended',
    () => {
      for (const [from, to] of links) {
        try {
          from.disconnect(to);
        } catch {
          // (Already disconnected, or the source disposed with its connections)
        }
      }
    },
    { once: true }
  );
}
interface OscillatorInside {
  frequency: Disconnects;
  detune: Disconnects;
  _oscillator: { _oscillator?: EndedInside & { frequency: AudioParam; detune: AudioParam } } | null;
}
const oscillatorProto = Tone.Oscillator.prototype as unknown as { _start: (this: OscillatorInside, time?: Tone.Unit.Time) => void };
const startOscillator = oscillatorProto._start;
oscillatorProto._start = function (time) {
  startOscillator.call(this, time);
  const browserOscillator = this._oscillator?._oscillator;
  if (!browserOscillator) return;
  disconnectWhenEnded(browserOscillator, [
    [this.frequency, browserOscillator.frequency],
    [this.detune, browserOscillator.detune],
  ]);
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
 * The buffers are Tone's noise as made at 44.1 kHz, and for a context at any other rate that same
 * noise resampled (toneNoiseLoop), so a burst is the same sound below 20 kHz, band for band, live
 * and exported at every rate. Played as made at 44.1 kHz, a 48 kHz computer read them between their
 * samples (wholeFrameStarts.ts), and the Groove Drum Kit's snare played 0.8 dB quieter (its noise
 * 1.7 dB, a Drum Machine hat 2.2 dB) than exported; made sample by sample at 96 kHz, the same white
 * noise spread up to 48 kHz, and a 96 kHz export's snare noise was 3 dB duller below 20 kHz.
 * A kit's buffer is made with the kit (seedToneNoise): resampling takes a few tens of ms.
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
const toneNoiseBuffers = new Map<string, Tone.ToneAudioBuffer>();
function toneNoiseBuffer(colour: NoiseColour, rate: number): Tone.ToneAudioBuffer {
  let buffer = toneNoiseBuffers.get(`${colour}@${rate}`);
  if (!buffer) {
    const channels = [0, 1].map((c) => toneNoiseLoop(colour, TONE_NOISE_SECONDS, rate, 0x70e + c * 0x1000));
    const audio = new AudioBuffer({ numberOfChannels: 2, length: channels[0].length, sampleRate: rate });
    channels.forEach((data, c) => audio.copyToChannel(data, c));
    buffer = new Tone.ToneAudioBuffer(audio);
    toneNoiseBuffers.set(`${colour}@${rate}`, buffer);
  }
  return buffer;
}
const noiseProto = Tone.Noise.prototype as unknown as { _start: (this: NoiseInside, time: Tone.Unit.Time) => void };
noiseProto._start = function (time) {
  const buffer = toneNoiseBuffer(this._type, this.context.sampleRate);
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
  const source = this._source;
  source.start(at, noiseStart(this.noiseKey ?? 0, at) * (buffer.duration - 0.001));
  // (Live, a strike undone stops it before it's heard: Tone forgets a noise source once a stop is
  // set for it, so struck again it would play on under the new one, twice as loud; see strikeTone)
  ifUndone((gone) => source.stop(gone));
};
/**
 * Tone starts a burst asked for a time the clock has passed at the clock (a live note set late):
 * a song's note's burst is still picked from where it was asked for (songPlace.ts struckLater),
 * as it is in an export, whose clock waits for its notes.
 */
const noiseStarter = Tone.Noise.prototype as unknown as { start: (this: NoiseInside, time?: Tone.Unit.Time, offset?: Tone.Unit.Time, duration?: Tone.Unit.Time) => unknown };
const startNoise = noiseStarter.start;
noiseStarter.start = function (time, offset, duration) {
  if (time === undefined || this.context.isOffline) return startNoise.call(this, time, offset, duration);
  return struckLater(this.context.currentTime - this.toSeconds(time), () => startNoise.call(this, time, offset, duration));
};

/** Give a Tone.Noise (a NoiseSynth's `noise`) its key (see noiseKey, from the track's seed and which drum), and its buffer now rather than at its first hit. */
export function seedToneNoise(noise: Tone.Noise, key: number): void {
  const inside = noise as unknown as NoiseInside;
  inside.noiseKey = key;
  toneNoiseBuffer(inside._type, inside.context.sampleRate);
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
 * Live, every Tone synth's note (every one-voice synth, a PolySynth's voices, the NoiseSynth) is
 * struck by the one rule for live notes (soundLead.ts strikeWhole): where it goes is decided once
 * (where it's asked, or a render callback past the clock), its pitch, oscillators, noise and other
 * envelopes (a filter's, an FM note's modulation) are set for that time, and its loudness envelope,
 * which alone makes it heard, is set last, only once the clock is found to still leave a callback's
 * room before it. Held up while it was set, nothing of it has been heard: its oscillators started
 * for it are stopped, its pitch and other envelopes' moments taken away, and the whole note struck
 * again a callback past the clock. Its envelope is never set twice, so it never rises twice, and
 * no part of it moves without the rest. An export's clock waits for its notes: nothing changes there.
 *
 * A release that would come before a moved attack, or within as long again after it, moves with it
 * (so it can't cut the attack off); a later one is left where it is.
 * A song's note moved later is picked as it would have been on time (a NoiseSynth's burst from
 * where it was asked for, as in an export: songPlace.ts struckLater, applied by strikeWhole).
 */
/** A param (a Tone Signal) a note sets, and what's needed to hold it where it was. */
interface HeldParam {
  getValueAtTime: (time: number) => number;
  setValueAtTime: (value: number, time: number) => unknown;
  cancelScheduledValues: (time: number) => unknown;
  cancelAndHoldAtTime: (time: number) => unknown;
  linearRampToValueAtTime: (value: number, time: number) => unknown;
}
interface EnvelopeInside {
  context: Tone.BaseContext;
  toSeconds: (time?: Tone.Unit.Time) => number;
  cancel: (after?: Tone.Unit.Time) => unknown;
  /** Its signal (Tone keeps it to itself). */
  _sig: HeldParam;
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
// (How far past the clock a note must be set: shared with the synths of plain Web Audio nodes, see soundLead.ts)
export { attackRoom, soundLead };

/** The loudness envelopes of the strikes under way, and what's been asked of each, set as their strike's last step. */
const heldBack = new Map<EnvelopeInside, Array<() => void>>();
/**
 * Loudness envelopes set at once in their strike's build instead (see strikeTone): its time-critical
 * moments are all set already, and the rest of the note can come late with no harm.
 */
const setNow = new WeakSet<EnvelopeInside>();

envelopeProto.triggerAttack = function (time, velocity) {
  if (this.context.isOffline) return triggerAttack.call(this, time, velocity);
  const at = this.toSeconds(time);
  const held = heldBack.get(this);
  const attack = () => {
    this._struckAt = at;
    // (The clock read once its attack is set, before its decay: see soundLead.ts soundReached)
    const sig = this._sig as HeldParam & { exponentialApproachValueAtTime?: (...a: unknown[]) => unknown };
    const decay = sig.exponentialApproachValueAtTime;
    let reached: number | undefined;
    let decaying: [number, number, number] | undefined;
    const own = Object.prototype.hasOwnProperty.call(sig, 'exponentialApproachValueAtTime');
    if (typeof decay === 'function') {
      sig.exponentialApproachValueAtTime = (...a: unknown[]) => {
        reached ??= this.context.currentTime;
        decaying = a as [number, number, number];
        return decay.apply(sig, a);
      };
    }
    try {
      return triggerAttack.call(this, at, velocity);
    } finally {
      if (typeof decay === 'function') {
        if (own) sig.exponentialApproachValueAtTime = decay;
        else delete sig.exponentialApproachValueAtTime;
      }
      soundReached(reached ?? this.context.currentTime);
      if (decaying && reached !== undefined) catchUpDecay(this, sig, at, reached, decaying);
    }
  };
  if (!held) {
    // (A loudness envelope set during its strike's build, its time-critical moments already set:
    // set now if the clock still leaves room, else its strike is made again; see strikeTone)
    if (setNow.has(this)) {
      setNow.delete(this);
      attackNow(this.context, at);
    }
    return attack();
  }
  held.push(attack);
  return this;
};

envelopeProto.triggerRelease = function (time) {
  if (this.context.isOffline) return triggerRelease.call(this, time);
  const held = heldBack.get(this);
  if (held) {
    const when = this.toSeconds(time);
    held.push(() => releaseMoved(this, when));
    return this;
  }
  return releaseMoved(this, time);
};

/**
 * Live, an envelope whose attack at `at` reached the sound in time (the clock `reached`, read just
 * after it, a block short of it) but whose decay was set with the page held up past where it begins:
 * the browser would hold it at its peak until then, a loud stretch the export hasn't. It's taken
 * on from where it is, over two blocks, to where the decay has it by then, and decays on from
 * there as it would have (an exponential approach forgets where it began).
 */
function catchUpDecay(env: EnvelopeInside, sig: HeldParam & { setTargetAtTime?: (value: number, time: number, constant: number) => unknown }, at: number, reached: number, [value, start, seconds]: [number, number, number]): void {
  const context = env.context;
  const block = 128 / context.sampleRate;
  const now = context.currentTime;
  if (context.isOffline || !(reached + block < at) || now + block < start || typeof sig.setTargetAtTime !== 'function') return;
  const t = now + 2 * block + 1 / context.sampleRate;
  const end = start + seconds;
  const want = sig.getValueAtTime(t);
  sig.cancelAndHoldAtTime(now);
  sig.linearRampToValueAtTime(want, t);
  if (t < start + seconds * 0.9) {
    sig.setTargetAtTime(value, t, Math.log(seconds + 1) / Math.log(200));
    sig.cancelAndHoldAtTime(start + seconds * 0.9);
  }
  if (t < end) sig.linearRampToValueAtTime(value, end);
}

/** An envelope's release at `time`, moved with its attack when that was moved (see above). */
function releaseMoved(env: EnvelopeInside, time?: Tone.Unit.Time): unknown {
  const moved = env._movedAttack;
  if (!moved) return triggerRelease.call(env, time);
  let when = env.toSeconds(time);
  const delay = moved.at - moved.asked;
  if (when >= moved.asked && when < moved.at + delay) when += delay;
  return triggerRelease.call(env, when);
}

/** What of a Tone synth a note sets (Tone keeps them to itself). */
interface StateInside {
  _state?: { getValueAtTime: (time: number) => string | null };
  stop: (time?: number) => unknown;
}
interface SynthInside {
  context: Tone.BaseContext;
  toSeconds: (time?: Tone.Unit.Time) => number;
  envelope?: EnvelopeInside;
  filterEnvelope?: EnvelopeInside;
  modulationEnvelope?: EnvelopeInside;
  frequency?: HeldParam;
  oscillator?: StateInside;
  modulation?: StateInside;
  _oscillators?: StateInside[];
}
type Strike = (this: SynthInside, ...args: unknown[]) => unknown;
/** A synth's triggerAttack (its time argument `timeAt`), struck whole by the rule above. */
function strikeTone(proto: { triggerAttack: Strike }, timeAt: number): void {
  const strike = proto.triggerAttack;
  proto.triggerAttack = function (...args) {
    if (this.context.isOffline) return strike.apply(this, args);
    const asked = this.toSeconds(args[timeAt] as Tone.Unit.Time);
    return strikeWhole(this.context, asked, (at) => {
      const from = strikeAsked() ?? asked;
      const amp = this.envelope;
      const others = [this.filterEnvelope, this.modulationEnvelope].filter((env): env is EnvelopeInside => env !== undefined && env !== amp);
      // (The oscillators this note starts afresh, not ones still sounding that it carries on)
      const fresh = [this.oscillator, this.modulation, ...(this._oscillators ?? [])].filter((source): source is StateInside => typeof source?._state?.getValueAtTime === 'function' && source._state.getValueAtTime(at) !== 'started');
      // (A hit whose oscillators wait at 0 Hz, its pitch set, has nothing else that must come in
      // time before its attack: set as Tone gets to it, first, before the slow rest of the note)
      if (amp && strikeSettled()) setNow.add(amp);
      else if (amp) {
        const held: Array<() => void> = [];
        heldBack.set(amp, held);
        whenHeard(() => {
          heldBack.delete(amp);
          for (const then of held) then();
        });
      }
      // (What its pitch and other envelopes are at `at` before the note: a glide or a filter sweep
      // under way, which the note's own moments hold there, is held there again should it be undone)
      const params = [this.frequency, ...others.map((env) => env._sig)].filter((param): param is HeldParam => param !== undefined);
      const before = params.map((param) => param.getValueAtTime(at));
      ifUndone((gone, heard) => {
        if (amp) heldBack.delete(amp);
        if (heard && amp) {
          // (Heard late, maybe in part: faded out from where it is, not cut)
          amp._sig.cancelAndHoldAtTime(this.context.currentTime);
          amp._sig.linearRampToValueAtTime(0, gone);
        }
        for (const source of fresh) source.stop(gone);
        params.forEach((param, i) => {
          if (heard) {
            param.cancelAndHoldAtTime(gone);
            return;
          }
          param.cancelScheduledValues(at);
          if (Number.isFinite(before[i])) param.setValueAtTime(before[i], at);
        });
      });
      // (Its release, if it would cut the attack where it went, moves with it)
      whenHeard(() => {
        for (const env of [amp, ...others]) if (env) env._movedAttack = at > from ? { asked: from, at } : undefined;
      });
      const struck = [...args];
      struck[timeAt] = at;
      return strike.apply(this, struck);
    });
  };
}
// (Monophonic, which Tone keeps to itself: every one-voice synth but the NoiseSynth, a PolySynth's voices too)
strikeTone(Object.getPrototypeOf(Tone.Synth.prototype) as { triggerAttack: Strike }, 1);
strikeTone(Tone.NoiseSynth.prototype as unknown as { triggerAttack: Strike }, 0);
