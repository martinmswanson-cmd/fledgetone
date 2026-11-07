import * as Tone from 'tone';
import { keepActive, nativeContextOf, nativeInputOf } from '../nativeNodes';
import { fillWhiteNoise, noiseStart } from '../seededNoise';
import { UNHEARD_FADE } from './toneStop';
import { notLate } from './monotonic';
import { ATTACK_TRIES } from '../soundLead';

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
  /**
   * When the hit it is part of starts, if that's earlier: a clap's later slaps and its room are
   * voices of their own, and a Stop or Pause treats them with the hit (heard, they ring out).
   */
  hit?: number;
  /** When its sources stop. */
  stopAt: number;
  sources: AudioScheduledSourceNode[];
  /** Every node to disconnect once it has finished (sources included). */
  nodes: AudioNode[];
  /** Its loudness envelope, ramped down by releaseAll. */
  amp: GainNode;
  /** Where it was asked to start and where it went, when strikeLive moved it later (live). */
  moved?: { asked: number; at: number };
  /** Seconds its envelopes begin before its start, if they do (the Synth Designer's, see SHAPER_LATENCY there). */
  early?: number;
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
  // A voice still to come never starts: its amp (at 0 until the note: some oscillators start a
  // render block early, see createOscAhead) stays at 0, so not one frame of it opens before the stop
  const callOff = (v: NativeVoice, now: number) => {
    v.stopAt = v.start;
    v.amp.gain.cancelScheduledValues(now);
    v.amp.gain.setValueAtTime(0, now);
  };
  const set = {
    add(v: NativeVoice): void {
      voices.add(v);
      struck?.voices.push({ voice: v, drop: () => set.drop(v) });
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
          callOff(v, now);
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
     * ones ring out as they would have, but with `heard` (Pause: the time being heard now) those
     * begun at or after it, not heard yet, fade out over UNHEARD_FADE: Play will play them again.
     * A voice goes by its hit's start (`hit`): the rest of a clap begun goes on as it would have,
     * and of one not heard yet, a part still to come never starts (faded, it would start at the
     * level it has before its own start, not the hit's).
     */
    callOffComing(now: number, heard?: number): void {
      for (const v of voices) {
        if (v.stopAt <= now) continue;
        const begun = v.hit ?? v.start;
        const unheard = heard !== undefined && begun >= heard;
        if (begun >= now || (unheard && v.start >= now)) callOff(v, now);
        else if (unheard) {
          const gain = v.amp.gain;
          if (typeof gain.cancelAndHoldAtTime === 'function') {
            gain.cancelAndHoldAtTime(now);
            gain.linearRampToValueAtTime(0, now + UNHEARD_FADE);
            v.stopAt = Math.min(v.stopAt, now + UNHEARD_FADE);
          } else {
            // (no hold: from where the level is heading, about 50 dB down before it stops)
            gain.cancelScheduledValues(now);
            gain.setTargetAtTime(0, now, UNHEARD_FADE / 2);
            v.stopAt = Math.min(v.stopAt, now + UNHEARD_FADE * 3);
          }
          silenceAtStop(v);
        } else continue;
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
        callOff(v, at);
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
    /**
     * Let go of a voice of a strike found late (see strikeLive) at once: never connected to where
     * it sounds, it was never heard, so nothing is cut.
     */
    drop(v: NativeVoice): void {
      if (!voices.delete(v)) return;
      v.stopAt = Math.min(v.stopAt, raw.currentTime);
      v.sources.forEach((s) => {
        s.onended = null;
        s.stop();
      });
      if (lingerSeconds > 0) atAudioTime(raw, raw.currentTime + lingerSeconds, () => disconnect(v));
      else disconnect(v);
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
  return set;
}

/**
 * What strikeLive's note has done so far while it builds one: the voices it added (each with how to
 * let it go unheard), and what waits until the strike is found in time (its outputs' connections,
 * the note before it giving way).
 */
type Strike = { voices: { voice: NativeVoice; drop: () => void }[]; settle: (() => void)[] };
let struck: Strike | null = null;
/** Live notes struck again (see strikeLive): the page held up while building them. */
export const struckAgain = { count: 0, dropped: 0 };

/**
 * Connect a note's output to where it sounds (the instrument's bus, or a filter its notes share).
 * Live, inside strikeLive, only once the strike is found in time: until then nothing of it can be
 * heard, so a strike found late is never heard at all (its envelopes, set after the sound had
 * passed their start, would have jumped straight to the peak: a burst and a click).
 */
export function connectOut(node: AudioNode, to: AudioNode): void {
  if (struck) struck.settle.push(() => node.connect(to));
  else node.connect(to);
}

/**
 * Run `then` once the note being struck is found in time (see strikeLive), or now outside one:
 * what a note does to others (the note before a mono one giving way, a hat choking the open one),
 * left undone by a strike found late.
 */
export function onceStruck(then: () => void): void {
  if (struck) struck.settle.push(then);
  else then();
}

/**
 * A live note (or hit) of plain Web Audio nodes, built by `build` from its start: notLate's, no
 * sooner than a render callback past the clock (see soundLead.ts). The page can still be held up
 * longer than that while it builds the note, and then its envelopes reach the browser after the
 * sound has passed their start: they never rise (silent, or 20 to 40 dB quiet), or jump straight
 * to the peak. So each strike is silent until it's built: its outputs are connected (connectOut)
 * and what it does to other notes is done (onceStruck) only once the clock is found short of its
 * start. One the clock has got to is let go unheard and struck again (built anew) a callback past
 * the clock as it is then, three strikes at most, as Tone's synths are (see toneFixes.ts); a third
 * found late is let go too (the note is missed rather than heard as a burst). `again` is called
 * after each strike let go, to put back what it changed (the last note a mono voice slides from).
 * Its voices remember how far they were moved, for their release (see movedRelease). An export
 * (whose clock waits for its notes) builds every note once, where it was asked.
 */
export function strikeLive<T>(context: Tone.BaseContext, time: number | undefined, build: (start: number) => T, again?: () => void): T {
  // (A note built inside another's strike is struck with it)
  if (context.isOffline || struck) return build(notLate(context, time));
  const raw = context.rawContext;
  const asked = time ?? raw.currentTime;
  let start = notLate(context, time);
  let result: T;
  for (let tries = 1; ; tries++) {
    const made: Strike = { voices: [], settle: [] };
    struck = made;
    try {
      result = build(start);
    } finally {
      struck = null;
    }
    // (The clock, which steps on a block at a time as the blocks are rendered, not yet past the
    // start, or an envelope's earlier start: the sound hadn't got there when the last of the note was set)
    let earliest = start;
    for (const { voice } of made.voices) earliest = Math.min(earliest, voice.start - (voice.early ?? 0));
    if (!made.voices.length || raw.currentTime < earliest) {
      for (const then of made.settle) then();
      if (start > asked) for (const { voice } of made.voices) voice.moved = { asked, at: start };
      return result;
    }
    for (const { drop } of made.voices) drop();
    again?.();
    if (tries >= ATTACK_TRIES) {
      struckAgain.dropped++;
      return result;
    }
    struckAgain.count++;
    start = notLate(context, undefined);
  }
}

/**
 * When a key let go at `when` lets `voice` go: a release that would come before its moved start
 * (see strikeLive), or within as long again after it, moves with it (so a quick tap still sounds
 * as long as it was held); a later one is left where it is. As Tone's synths' releases (toneFixes.ts).
 */
export function movedRelease(voice: NativeVoice | undefined, when: number): number {
  const moved = voice?.moved;
  if (!moved) return when;
  const delay = moved.at - moved.asked;
  return when >= moved.asked && when < moved.at + delay ? when + delay : when;
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
  // (Its own frequency from the first sample: set only on the timeline, an oscillator started off a
  // render block's edge first plays the default 440 Hz for a moment and then starts its wave at a
  // phase that depends on where in the block it began, so live and export would differ)
  osc.frequency.value = frequency;
  osc.frequency.setValueAtTime(frequency, at);
  if (detune) osc.detune.value = detune;
  osc.start(at);
  return osc;
}

/** Frames in one of the browser's render blocks (the audio thread works in blocks this long). */
export const RENDER_BLOCK = 128;

/**
 * createOsc for a pitch that starts to move at `at`, the note's start (a drum's fast drop, an
 * 808's punch). Chrome works out the first render block of a starting oscillator from the pitch at
 * that block's start, so a drop that begins with the oscillator ran late by however far into the
 * block the note landed: each hit came out a little different, and the export differed from what
 * was heard. This oscillator starts one block early instead (no earlier than now) at 0 Hz
 * (waiting at the start of its wave) and takes `frequency` at `at`, so the drop begins on its own frame wherever the note lands. Whatever it
 * feeds must be silent until `at`.
 */
export function createOscAhead(raw: BaseAudioContext, type: OscillatorType | PeriodicWave, frequency: number, at: number, detune = 0): OscillatorNode {
  // At 0 Hz until the note, the wave waits at its start (phase 0) and begins there, as one started
  // at the note would: started at its own pitch it would be part way round its cycle by then, and
  // the amp opening onto it would click
  const osc = createOsc(raw, type, 0, Math.max(raw.currentTime, at - RENDER_BLOCK / raw.sampleRate), detune);
  // (The drop the caller sets runs from here, not from the early start)
  osc.frequency.setValueAtTime(frequency, at);
  return osc;
}

/** A pitch going from `f0` at `t0` to `f1` at `t1` along an exponential ramp (held before and after). */
export interface PitchGlide { t0: number; f0: number; t1: number; f1: number }

/** The pitch `g` is at by `at`. */
export function glidePitch(g: PitchGlide, at: number): number {
  if (at <= g.t0 || g.t1 <= g.t0) return at <= g.t0 ? g.f0 : g.f1;
  if (at >= g.t1) return g.f1;
  return g.f0 * (g.f1 / g.f0) ** ((at - g.t0) / (g.t1 - g.t0));
}

/**
 * Slides `freq` from where it is at `at` to `to` over `seconds`, and returns the new glide. The
 * slide's start is set as well as held: holding alone adds nothing when no ramp is still to come,
 * so the ramp would run from the note's start instead, creeping over the whole earlier note.
 */
export function slidePitch(freq: AudioParam, g: PitchGlide, at: number, to: number, seconds: number): PitchGlide {
  const from = glidePitch(g, at);
  freq.cancelAndHoldAtTime(at);
  freq.setValueAtTime(from, at);
  freq.exponentialRampToValueAtTime(to, at + seconds);
  return { t0: at, f0: from, t1: at + seconds, f1: to };
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
export function phasedSawSeries(phase: number): { real: Float32Array; imag: Float32Array } {
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

/**
 * The normalizers (see waveNormalizer) of the waves every note of some synths starts from: the
 * browser's four in its three table sizes, and the unison saws' (phasedSaw) at each of the Synth
 * Designer's seven unison voices' phases. Worked out on the main thread, the bigger ones take
 * 15 to 400 ms (a sawtooth at 44.1 kHz, 36 ms; four times that on a slow computer), which the
 * first note to need one waited for: a Pluck's first note after the page loaded was silent, the
 * Synth Designer's late and quiet. These are what waveNormalizer gives for them (checked by
 * scripts/nativeStrike.test.mjs), so nothing a note or an export plays changes.
 */
const KNOWN_NORMALIZERS: Record<string, number> = {
  'builtin:sine:2048|2048': 1, 'builtin:square:2048|2048': 0.8481907649443438, 'builtin:sawtooth:2048|2048': 0.848894256816183, 'builtin:triangle:2048|2048': 1.000395949147455,
  'saw@0|2048': 0.8495989166130806, 'saw@0.618|2048': 0.8683998753302336, 'saw@0.236|2048': 0.8675691990683159, 'saw@0.8540000000000001|2048': 0.8495992195876465, 'saw@0.472|2048': 0.8692471643338691, 'saw@0.08999999999999986|2048': 0.8667552872001335, 'saw@0.7080000000000002|2048': 0.8496227993447771,
  'builtin:sine:4096|4096': 1, 'builtin:square:4096|4096': 0.848190936655004, 'builtin:sawtooth:4096|4096': 0.8485424509977015, 'builtin:triangle:4096|4096': 1.0001979387790656,
  'saw@0|4096': 0.8495989166130783, 'saw@0.618|4096': 0.8544345629463914, 'saw@0.236|4096': 0.8548933564794062, 'saw@0.8540000000000001|4096': 0.8495992195876442, 'saw@0.472|4096': 0.853995476348954, 'saw@0.08999999999999986|4096': 0.8553716874631527, 'saw@0.7080000000000002|4096': 0.8496227993447765,
  'builtin:sine:16384|16384': 1, 'builtin:square:16384|16384': 0.8481909897890367, 'builtin:sawtooth:16384|16384': 0.8482788251732132, 'builtin:triangle:16384|16384': 1.0000494823683175,
  'saw@0|16384': 0.8495989166130777, 'saw@0.618|16384': 0.8498220086204636, 'saw@0.236|16384': 0.8499376132657783, 'saw@0.8540000000000001|16384': 0.8495992195876517, 'saw@0.472|16384': 0.8497304424376024, 'saw@0.08999999999999986|16384': 0.8500774615669802, 'saw@0.7080000000000002|16384': 0.8496227993447838,
};
/** 1 / the peak of a wave's full-band table, as the browser normalizes it. Keyed by the wave's id and table size. */
const normalizers = new Map<string, number>(Object.entries(KNOWN_NORMALIZERS));
/** The normalizer kept ready for wave `id` at table size `size`, if one is. */
export const knownNormalizer = (id: string, size: number): number | undefined => KNOWN_NORMALIZERS[`${id}|${size}`];

function normalizer(id: string, real: Float32Array, imag: Float32Array, size: number): number {
  const key = `${id}|${size}`;
  let scale = normalizers.get(key);
  if (scale === undefined) {
    scale = waveNormalizer(real, imag, size);
    normalizers.set(key, scale);
  }
  return scale;
}

/** 1 / the peak of the full-band table of size `size` of the wave of these harmonics. */
export function waveNormalizer(real: Float32Array, imag: Float32Array, size: number): number {
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
  return peak > 0 ? 1 / peak : 1;
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
export function builtinWave(raw: BaseAudioContext, type: BuiltinType, level: number, phase = 0): PeriodicWave {
  const size = waveTableSize(raw.sampleRate);
  return scaledWave(raw, `builtin:${type}:${size}`, () => builtinSeries(type, size), level, phase);
}

type BuiltinType = 'sine' | 'square' | 'sawtooth' | 'triangle';

/** The harmonics of the browser's own `type` in a table of `size`. */
export function builtinSeries(type: BuiltinType, size: number): { real: Float32Array; imag: Float32Array } {
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
