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
import { attackRoom, ifUndone, inStrike, strikeWhole } from '../soundLead';

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

/** A synth whose note is started a render block early at 0 Hz (see attackAhead), and how. */
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

/** Where a note set ahead is to start, and, when its oscillators were started live to wait for it at 0 Hz (see earlyLive), their pitch, still to be set where it comes. */
interface Planned {
  at: number;
  waiting: EarlyStart | null;
}

/** Before a note at `start` (see attackAhead): its pitch set early, or its oscillators started early, their pitch still to be set where it comes (see Planned). */
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
 * The early start, live. Each of the synth's oscillators (a hat's six FM pairs) runs on from where
 * it's started, so all of them must begin their waves together, on the note's attack, as they do in
 * the export. So every one of them is started a block early at 0 Hz, where a wave waits at its
 * start however long it's held (Tone moves a start the clock has passed up to the clock: still at
 * 0 Hz), and the note's own pitch is set at its start (see attackAhead), all inside the note's
 * strike (soundLead.ts strikeWhole): held up while they're set, they're stopped and the whole note
 * started again for its new time (stopWaiting). Returns where the note is to start (after every
 * start, should one have landed there), or null when they aren't all silent from two blocks
 * before the note (only its pitch is set early).
 */
function earlyLive(synth: NoteSynth, early: EarlyStart, start: number, quietFrom: (at: number, blocks: number) => number | null): number | null {
  const frame = 1 / synth.context.sampleRate;
  const from = quietFrom(start, 2);
  const ahead = start - RENDER_BLOCK * frame;
  if (from === null || !(from < ahead)) return null;
  early.pitch.setValueAtTime(0, from);
  for (const source of early.sources) source.start(ahead);
  // (After each start too: a note can't start an oscillator again at the moment it already starts)
  let at = start;
  for (const source of early.sources) at = Math.max(at, lastStart(source) + frame);
  return at;
}

/**
 * Live: the oscillators started early for a note at `at` that has to come later after all,
 * stopped (by `gone`), and its pitch at `at` taken away, so they can be started early again for
 * its new time (their waves would otherwise set out at `at`, out of step with the moved attack).
 * They're silent: at 0 Hz, or behind the note's envelope, not set yet, which the last note left
 * at 0; or (`heard`, its last step found late) faded out by `gone`.
 */
function stopWaiting(synth: NoteSynth, note: Tone.Unit.Frequency, at: number, gone = synth.context.currentTime, heard = false): void {
  const early = earlyStartOf(synth, note);
  if (!early) return;
  for (const source of early.sources) source.stop(gone);
  // (Heard late, maybe in part: its pitch held from where it fades out, not taken back to the last note's)
  if (heard) early.pitch.cancelAndHoldAtTime(gone);
  else early.pitch.cancelScheduledValues(at);
}

/**
 * A Tone synth's note at `start`: `attack` triggers it at the time it's given, and the note's start
 * comes back. Before it, when its oscillator is stopped, its pitch is set a render block early, so
 * the note starts on its own pitch wherever in the block it lands. A MembraneSynth (a kick's drop),
 * a MetalSynth (a hat) and an FMSynth also start their oscillators a block early, held at 0 Hz
 * from a block before that until the note (where its pitch is set), so the note starts on time and
 * at the start of its wave wherever it lands (its envelope is silent until then). A note that
 * starts while the oscillator still sounds (legato, a ringing tail) is left as it was.
 *
 * Live, all of it is one strike (soundLead.ts strikeWhole): where it starts is decided once, its
 * pitch set for that time, its attack heard last; held up while that's set, its oscillators are
 * stopped and the whole note struck again later. Its oscillators waiting at 0 Hz are readied before the
 * time is decided (they wait for any time); inside another strike (a snare's snap, struck with its
 * noise), whose time is decided already, they're started for it, and stopped should it be struck
 * again (see earlyLive).
 *
 * In an export, should Tone refuse the start (it won't start an oscillator again at or before the
 * moment its last start is set), the note is struck again just after every start already set, so
 * it's never left silent at the 0 Hz the early start holds.
 */
export function attackAhead(synth: NoteSynth, note: Tone.Unit.Frequency, start: number, attack: (time: number) => void): number {
  return strikeTogether(synth.context, start, [[synth, note]], (_at, play) => play(0, attack));
}

/** A note's oscillators readied ahead of its strike, live (see strikeTogether): where it can go, and what waits for its pitch. */
interface Readied {
  at: number;
  early: EarlyStart | null;
}

/**
 * A hit of one or more Tone synths' notes struck as one (a snare's noise and snap, a bell's two
 * tones): `build` sets the hit at its time `at`, playing part `i` of `parts` with `play(i,
 * attack)`, which sets that note up (see attackAhead) and calls `attack` with its time. Live, and
 * not inside another strike, every part's oscillators are readied first (started early at 0 Hz,
 * they wait at the start of their waves for any time after), and only then is where the hit goes
 * decided (soundLead.ts strikeWhole), so the slow part of a hat (six FM pairs) doesn't hold up the
 * strike itself; struck again, they're stopped and readied afresh, again before the new time is
 * decided (a part reusing oscillators restarted for a time given up came out a little off). Inside
 * another strike, whose time is decided already, they're started for that time, and stopped should
 * it be struck again. Returns what `build` returned.
 */
export function strikeTogether<R>(context: Tone.BaseContext, start: number, parts: Array<[NoteSynth, Tone.Unit.Frequency]>, build: (at: number, play: (i: number, attack: (time: number) => void) => number) => R): R {
  if (!context.isOffline && !inStrike()) {
    // (Readied for no sooner than `from`, before the time is decided; again before each strike made again)
    const ready = (from: number): Readied[] =>
      parts.map(([synth, note]) => {
        const plan = planAhead(synth, note, Math.max(from, attackRoom(context)));
        return { at: plan.at, early: plan.waiting };
      });
    let readied = ready(start);
    const latest = (from: number) => readied.reduce((l, r) => Math.max(l, r.at), from);
    return strikeWhole(
      context,
      start,
      (when) =>
        build(when, (i, attack) => {
          const [synth, note] = parts[i];
          const early = readied[i].early;
          if (early) {
            early.pitch.setValueAtTime(early.hz, when);
            ifUndone((gone, heard) => stopWaiting(synth, note, when, gone, heard));
          }
          attack(when);
          return when;
        }),
      latest(start),
      (from) => {
        readied = ready(from);
        return latest(from);
      }
    );
  }
  return strikeWhole(context, start, (when) => build(when, (i, attack) => playAhead(parts[i][0], parts[i][1], when, attack)));
}

/** A note set up and struck at `when` inside a strike already decided, or in an export (see attackAhead). */
function playAhead(synth: NoteSynth, note: Tone.Unit.Frequency, when: number, attack: (time: number) => void): number {
  const plan = planAhead(synth, note, when);
  const early = plan.waiting;
  if (early) {
    early.pitch.setValueAtTime(early.hz, plan.at);
    ifUndone((gone, heard) => stopWaiting(synth, note, plan.at, gone, heard));
  }
  if (!synth.context.isOffline) {
    attack(plan.at);
    return plan.at;
  }
  try {
    attack(plan.at);
    return plan.at;
  } catch {
    return strikeAfterStarts(synth, note, plan.at, attack);
  }
}

/** An export's note at `at` Tone refused: struck again just after every start already set (see attackAhead). */
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
