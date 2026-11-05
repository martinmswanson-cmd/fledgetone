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
  sources: Array<States & { start: (time: number) => unknown }>;
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

/**
 * Before a Tone synth's note at `start` (before triggerAttack): when its oscillator is stopped,
 * its pitch is set a render block early, so the note starts on its own pitch wherever in the
 * block it lands. A MembraneSynth (a kick's drop), a MetalSynth (a hat) and an FMSynth also start
 * their oscillators a block early, held at 0 Hz from a block before that until `start` (where Tone
 * sets the note's pitch), so the note starts on time and at the start of its wave wherever it
 * lands (its envelope is silent until `start`). A note that starts while the oscillator still
 * sounds (legato, a ringing tail) is left as it was.
 */
export function pitchAhead(synth: NoteSynth, note: Tone.Unit.Frequency, start: number): void {
  const early = earlyStartOf(synth, note);
  if (!early) {
    const from = silentFrom(sourceOf(synth), start, synth.context, 1);
    if (from !== null) synth.frequency.setValueAtTime(synth.toFrequency(note), from);
    return;
  }
  // Every one of them silent from then (an FMSynth's modulator stops before its carrier); one
  // ending a moment before the note gets only its pitch early
  const quietFrom = (blocks: number) => {
    const times = early.sources.map((source) => silentFrom(source, start, synth.context, blocks));
    return times.every((t) => t !== null) ? (times[0] as number) : null;
  };
  const from = quietFrom(2);
  const ahead = start - RENDER_BLOCK / synth.context.sampleRate;
  if (from !== null && from < ahead) {
    // (At 0 Hz until the note, where Tone sets its pitch: the wave waits at its start and begins
    // there, as one started at the note would, so the envelope opening onto it can't click)
    early.pitch.setValueAtTime(0, from);
    for (const source of early.sources) source.start(ahead);
    return;
  }
  // (Too close to now, or to the last note, for two blocks: the pitch is still set early, the
  // oscillators left to start with the note)
  const near = from ?? quietFrom(1);
  if (near !== null) early.pitch.setValueAtTime(early.hz, near);
}
