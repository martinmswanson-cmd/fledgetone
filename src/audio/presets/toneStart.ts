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
 */
function silentFrom(source: States | undefined, start: number, context: Tone.BaseContext, blocks: number): number | null {
  const early = Math.max(context.currentTime, start - (blocks * RENDER_BLOCK) / context.sampleRate);
  const states = source?._state;
  if (!states || !(early < start)) return null;
  const last = states.get(start);
  return !last || (last.state !== 'started' && last.time <= early) ? early : null;
}

/**
 * Before a Tone synth's note at `start` (before triggerAttack): when its oscillator is stopped,
 * its pitch is set a render block early, so the note starts on its own pitch wherever in the
 * block it lands. A MembraneSynth (a kick's drop) also starts its oscillator a block early and has
 * its pitch set a block before that, so the drop itself starts on time (its envelope is silent
 * until `start`). A note that starts while the oscillator still sounds (legato, a ringing tail)
 * is left as it was.
 */
export function pitchAhead(synth: NoteSynth, note: Tone.Unit.Frequency, start: number): void {
  const source = sourceOf(synth);
  if (synth instanceof Tone.MembraneSynth) {
    const early = silentFrom(source, start, synth.context, 2);
    if (early === null) return;
    const ahead = start - RENDER_BLOCK / synth.context.sampleRate;
    synth.oscillator.frequency.setValueAtTime(synth.toFrequency(note) * synth.octaves, early);
    // (Too close to now for two blocks: the pitch is still set early, the drop left to start late)
    if (early < ahead) synth.oscillator.start(ahead);
    return;
  }
  const early = silentFrom(source, start, synth.context, 1);
  if (early !== null) synth.frequency.setValueAtTime(synth.toFrequency(note), early);
}
