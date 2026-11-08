/**
 * A Tone synth's note that starts its oscillator from silence. Tone sets the note's pitch at the
 * same moment it makes a new oscillator, and Chrome works out the first render block (128 frames)
 * of a starting oscillator from the pitch at that block's start. So a note landing part way into a
 * block played its first moments (up to 64 frames) at the last note's pitch, or at Tone's default
 * 440 Hz for the first note, and its wave then went on from a place that depended on where in the
 * block it landed: identical notes came out a little different, and the export differed from what
 * was heard. The pitch is set a block early instead, while the oscillator is still silent.
 */
import * as Tone from 'tone';
import { RENDER_BLOCK } from './native';
import { ATTACK_TRIES, AttackMoved, attackRoom, settledAt, strikeExactly } from '../soundLead';

/** Where a Tone source keeps its starts and stops (Tone keeps it to itself). */
interface States {
  _state?: { get: (time: number) => { state: string; time: number } | null };
}

/** The parts of a Tone synth (Synth, MonoSynth, FMSynth, MembraneSynth, MetalSynth) used here. */
export interface NoteSynth {
  context: Tone.BaseContext;
  frequency: Tone.Signal<'frequency'>;
  toFrequency: (note: Tone.Unit.Frequency) => number;
}

/** The oscillator whose start a synth's note waits on. */
function sourceOf(synth: NoteSynth): States | undefined {
  const s = synth as unknown as { oscillator?: States; _carrier?: { oscillator?: States }; _oscillators?: States[] };
  return s.oscillator ?? s._carrier?.oscillator ?? s._oscillators?.[0];
}

/**
 * `blocks` render blocks before `start` (no earlier than now) when `source` is stopped from then
 * until `start`, so a pitch set then is heard by nothing; null when it's sounding then (a note
 * still ringing, whose last moments must keep their pitch), or when there's no time before `start`.
 * Now itself comes back half a frame sooner: it's on a render block's edge, and a time there can
 * come out a frame later (seconds and frames don't convert exactly), so the block about to be
 * rendered would still start on the old pitch; that happened in the export, which hands notes out
 * only just ahead of the render, and not live.
 */
function silentFrom(source: States | undefined, start: number, context: Tone.BaseContext, blocks: number): number | null {
  const now = context.currentTime;
  const early = Math.max(now, start - (blocks * RENDER_BLOCK) / context.sampleRate);
  const states = source?._state;
  if (!states || !(early < start)) return null;
  const last = states.get(start);
  if (last && (last.state === 'started' || last.time > early)) return null;
  return early > now ? early : now - 0.5 / context.sampleRate;
}

/** A synth whose note is started a render block early at 0 Hz (see pitchAhead), and how. */
interface EarlyStart {
  /** The oscillators its note starts. */
  sources: Array<States & { start: (time: number) => unknown; stop: (time: number) => unknown }>;
  /** The pitch they follow, held at 0 Hz until the note sets its own. */
  pitch: Tone.Signal<'frequency'> | Tone.Param<'frequency'>;
  /** The note's pitch on `pitch` (set early instead, when there's no time to start early). */
  hz: number;
}

/**
 * A MembraneSynth (a kick's drop), a MetalSynth (a hat: six FM oscillators) or an FMSynth (a
 * carrier and its modulator): where the pitch set early isn't enough, as the wave of an oscillator
 * driven by another (or by a sweep) goes on from a place that depends on where in the block its
 * note lands. null for the others.
 */
function earlyStartOf(synth: NoteSynth, note: Tone.Unit.Frequency): EarlyStart | null {
  if (synth instanceof Tone.MembraneSynth) return { sources: [synth.oscillator as unknown as EarlyStart['sources'][number]], pitch: synth.oscillator.frequency, hz: synth.toFrequency(note) * synth.octaves };
  if (synth instanceof Tone.MetalSynth) {
    const oscillators = (synth as unknown as { _oscillators: EarlyStart['sources'] })._oscillators;
    return { sources: oscillators, pitch: synth.frequency, hz: synth.toFrequency(note) };
  }
  if (synth instanceof Tone.FMSynth) return { sources: [synth.oscillator, synth.modulation] as unknown as EarlyStart['sources'], pitch: synth.frequency, hz: synth.toFrequency(note) };
  return null;
}

/** Where `source`'s last start is set (Tone moves a start that's already past up to now). */
function lastStart(source: States): number {
  const last = source._state?.get(Infinity);
  let t = last && last.state === 'started' ? last.time : -Infinity;
  // (An OmniOscillator's or FMOscillator's own oscillators clamp their start to the clock again: it can have moved on in between)
  const parts = source as unknown as { _oscillator?: States; _carrier?: States; _modulator?: States };
  for (const inner of [parts._oscillator, parts._carrier, parts._modulator]) if (inner && inner !== source && inner._state) t = Math.max(t, lastStart(inner));
  return t;
}

/**
 * Before a Tone synth's note at `start` (before triggerAttack): when its oscillator is stopped,
 * its pitch is set a render block early, so the note starts on its own pitch wherever in the
 * block it lands. A MembraneSynth (a kick's drop), a MetalSynth (a hat) and an FMSynth also start
 * their oscillators a block early, held at 0 Hz from a block before that until the note (where
 * its pitch is set), so the note starts on time and at the start of its wave wherever it lands
 * (its envelope is silent until then). A note that starts while the oscillator still sounds
 * (legato, a ringing tail) is left as it was.
 *
 * Returns when the note is to start: `start`, or later live (see earlyLive) when the audio clock
 * is too near it for its attack, or moves on while the oscillators are started (the main thread
 * held up for a moment): late by the hold-up, but whole and on its own pitch.
 */
export function pitchAhead(synth: NoteSynth, note: Tone.Unit.Frequency, start: number): number {
  const plan = planAhead(synth, note, start);
  if (!plan.waiting) return plan.at;
  // (Settled as a strike made exactly would be: see attackAhead)
  const at = settledAt(synth.context, plan.at);
  plan.waiting.pitch.setValueAtTime(plan.waiting.hz, at);
  return at;
}

/** Where a note set ahead is to start, and, when its oscillators were started live to wait for it at 0 Hz (see earlyLive), their pitch, still to be set where it comes. */
interface Planned {
  at: number;
  waiting: EarlyStart | null;
}

/** pitchAhead, leaving the pitch of oscillators that wait for the note to be set (see Planned). */
function planAhead(synth: NoteSynth, note: Tone.Unit.Frequency, start: number): Planned {
  const early = earlyStartOf(synth, note);
  if (!early) {
    const from = silentFrom(sourceOf(synth), start, synth.context, 1);
    if (from !== null) synth.frequency.setValueAtTime(synth.toFrequency(note), from);
    return { at: start, waiting: null };
  }
  // Every one of them silent from then (an FMSynth's modulator stops before its carrier); one
  // ending a moment before the note gets only its pitch early
  const quietFrom = (at: number, blocks: number) => {
    const times = early.sources.map((source) => silentFrom(source, at, synth.context, blocks));
    return times.every((t) => t !== null) ? (times[0] as number) : null;
  };
  if (!synth.context.isOffline) {
    const at = earlyLive(synth, early, start, quietFrom);
    if (at !== null) return { at, waiting: early };
  }
  const from = quietFrom(start, 2);
  const ahead = start - RENDER_BLOCK / synth.context.sampleRate;
  // (An export's clock waits for its notes: it's read again just before each start all the same)
  const inTime = () => ahead > synth.context.currentTime;
  if (synth.context.isOffline && from !== null && from < ahead && inTime()) {
    // (At 0 Hz until the note, where its pitch is set: the wave waits at its start and begins
    // there, as one started at the note would, so the envelope opening onto it can't click)
    early.pitch.setValueAtTime(0, from);
    early.pitch.setValueAtTime(early.hz, start);
    let at = start;
    for (const source of early.sources) {
      if (!inTime()) continue;
      source.start(ahead);
      const landed = lastStart(source);
      if (!(landed < start)) at = Math.max(at, landed + 1 / synth.context.sampleRate);
    }
    if (at !== start) early.pitch.setValueAtTime(early.hz, at);
    return { at, waiting: null };
  }
  // (Too close to now, or to the last note, for two blocks: the pitch is still set early, the
  // oscillators left to start with the note)
  const near = from ?? quietFrom(start, 1);
  if (near !== null) early.pitch.setValueAtTime(early.hz, near);
  return { at: start, waiting: null };
}

/**
 * pitchAhead's early start, live. Each of the synth's oscillators (a hat's six FM pairs) runs on
 * from where it's started, so all of them must begin their waves together, on the note's attack,
 * as they do in the export. Live, the clock can move on while they're started, and the attack
 * with it (an attack must be set a render callback past the clock: see soundLead.ts): pairs
 * started early were then already playing their waves when the rest started fresh with the
 * moved attack, out of step with them, and a hand-played hat came out up to 4.5 dB quieter or 2.5
 * dB louder than in the export (a kick, a snare's snap or an FM note began differently). So every one of
 * them is started early at 0 Hz, where a wave waits at its start however long it's held (Tone
 * moves a start the clock has passed up to the clock: still at 0 Hz), and the note's start is
 * settled only as it's struck, once they're all started: where it was to be while the clock is
 * still two blocks short of it (every start then reached the sound in time), or else that far
 * past the clock (see soundLead.ts settledAt), no later than any note's attack would go; its pitch
 * is set there, just before it's struck (see attackAhead). Returns where it was to be, or null
 * when they aren't all silent from two blocks before the note (it's left to pitchAhead).
 */
function earlyLive(synth: NoteSynth, early: EarlyStart, start: number, quietFrom: (at: number, blocks: number) => number | null): number | null {
  const frame = 1 / synth.context.sampleRate;
  // (Where the clock already puts the attack: the room for the early start is then before it)
  const planned = Math.max(start, attackRoom(synth.context));
  const from = quietFrom(planned, 2);
  const ahead = planned - RENDER_BLOCK * frame;
  if (from === null || !(from < ahead)) return null;
  early.pitch.setValueAtTime(0, from);
  for (const source of early.sources) source.start(ahead);
  // (After each start too: a note can't start an oscillator again at the moment it already starts)
  let at = planned;
  for (const source of early.sources) at = Math.max(at, lastStart(source) + frame);
  return at;
}

/**
 * Live: the oscillators started early for a note at `at` that has to come later after all,
 * stopped, and its pitch at `at` taken away, so they can be started early again for its new
 * time (their waves would otherwise set out at `at`, out of step with the moved attack). They're
 * silent: at 0 Hz, or behind the note's envelope, not set yet, which the last note left at 0.
 */
function stopWaiting(synth: NoteSynth, note: Tone.Unit.Frequency, at: number): void {
  const early = earlyStartOf(synth, note);
  if (!early) return;
  const now = synth.context.currentTime;
  for (const source of early.sources) source.stop(now);
  early.pitch.cancelScheduledValues(at);
}

/**
 * A Tone synth's note at `start`, its pitch set ahead (see pitchAhead): `attack` triggers it at
 * the time it's given, and the note's start comes back.
 *
 * Live, a note whose oscillators wait for it at 0 Hz (see earlyLive) is struck exactly
 * (strikeExactly, soundLead.ts): its pitch is set where the strike settles it, just before its
 * attack, so they set out together; should the clock move on too near it before its attack is set
 * (the page held up again), nothing of it is set and its oscillators are started again for where
 * it has to go (three tries; the third moves as it must).
 *
 * Should Tone refuse the start (it won't start an oscillator again at or before the moment its
 * last start is set, which the audio clock moving on at the wrong moment could still bring
 * about), the note is struck again just after every start already set, so it's never left silent
 * at the 0 Hz the early start holds (the first try's envelope, which opened, is taken over by the
 * second: one note, struck once).
 */
export function attackAhead(synth: NoteSynth, note: Tone.Unit.Frequency, start: number, attack: (time: number) => void): number {
  let plan = planAhead(synth, note, start);
  for (let tries = 1; plan.waiting && tries < ATTACK_TRIES; tries++) {
    const early = plan.waiting;
    let at = plan.at;
    let pitched = false;
    const pitch = (when: number) => {
      early.pitch.setValueAtTime(early.hz, when);
      at = when;
      pitched = true;
    };
    try {
      strikeExactly(() => attack(plan.at), pitch);
      // (One that didn't say where it went: its pitch all the same)
      if (!pitched) pitch(at);
      return at;
    } catch (err) {
      if (!(err instanceof AttackMoved)) {
        if (!pitched) pitch(at);
        return strikeAfterStarts(synth, note, at, attack);
      }
      stopWaiting(synth, note, plan.at);
      plan = planAhead(synth, note, err.at);
    }
  }
  // (The last try, as any note: a callback past the clock, so the strike needn't move it)
  const at = plan.waiting ? Math.max(plan.at, attackRoom(synth.context)) : plan.at;
  if (plan.waiting) plan.waiting.pitch.setValueAtTime(plan.waiting.hz, at);
  try {
    attack(at);
    return at;
  } catch {
    return strikeAfterStarts(synth, note, at, attack);
  }
}

/** A note at `at` Tone refused: struck again just after every start already set (see attackAhead). */
function strikeAfterStarts(synth: NoteSynth, note: Tone.Unit.Frequency, at: number, attack: (time: number) => void): number {
  const frame = 1 / synth.context.sampleRate;
  const sources = earlyStartOf(synth, note)?.sources ?? [];
  const one = sourceOf(synth);
  let latest = Math.max(at, synth.context.currentTime);
  for (const source of one ? [...sources, one] : sources) latest = Math.max(latest, lastStart(source));
  const after = latest + frame;
  try {
    attack(after);
  } catch (err) {
    // (Still refused: at least not held at 0 Hz)
    const early = earlyStartOf(synth, note);
    if (early) early.pitch.setValueAtTime(early.hz, after);
    throw err;
  }
  return after;
}
