/**
 * The Drop pad, live: the Drop Pad instrument (its notes hold the master's effects, see
 * effects/dropFx.ts) and the pads in Pocket tell the master's Drop worklet when each effect starts
 * and stops, on the audio clock. The worklet is in the master chain only while the song has a
 * Drop track (masterChain.ts); until it has loaded, nothing here sounds.
 *
 * Every start, stop or pause of the Transport (a seek while playing included) lets go of every
 * effect and drops what was due, as other instruments' notes are cut off. A held note that runs
 * past the loop's end lets go there, so the next pass starts clean; an export does the same with
 * its range's end (see dropMoves.ts and masterAfter.ts), so the two match.
 */
import * as Tone from 'tone';
import { DROP_ROWS } from './instrumentCatalog';
import { liveContext, liveTransport } from './liveContext';
import { barToTicks, getLiveTempo, ticksToBar } from './transport';
import { secondsBetween } from './tempoMap';
import { dropDelaySeconds } from './latency';
import { durationToBars } from '../store/timelineTypes';
import type { NoteOff, PlayableNote, TrackInstrument } from './instruments';

let port: MessagePort | null = null;

/** The live worklet's port (null when it's taken out). */
export function setLiveDropPort(next: MessagePort | null): void {
  port = next;
}

/** Whether the live Drop effects can sound now (the worklet has loaded). */
export const liveDropReady = () => port !== null;

const post = (message: object) => {
  try {
    port?.postMessage(message);
  } catch {
    // The worklet is gone: nothing to tell
  }
};

/** Seconds a 16th lasts at the live tempo now. */
const sixteenth = () => 15 / liveTransport.bpm.value;

/** The song position (bars) the Transport plays at audio time `time`. */
const barAt = (time: number) => ticksToBar(liveTransport.getTicksAtTime(time));

/**
 * The times below are when the Transport plays the music; the music reaches the Drop effects later,
 * held back by the tracks' delay compensation and the master compressor (dropDelaySeconds), so
 * each message is moved that much later, as an export lines them up.
 */
/** Start effect `fx` at audio time `at` (a 16th lasting as long as it does there along the song's tempo). */
export const dropOn = (fx: number, at: number) => {
  const bar = barAt(at);
  const six = liveTransport.state === 'started' ? secondsBetween(bar, bar + 1 / 16, getLiveTempo()) : sixteenth();
  post({ on: fx, at: at + dropDelaySeconds(), sixteenth: six });
};
/** Let go of effect `fx` at audio time `at`, of the press or note that started at audio time `from`. */
export const dropOff = (fx: number, at: number, from: number) => {
  const delay = dropDelaySeconds();
  post({ off: fx, at: at + delay, from: from + delay });
};
/** Let go of everything at `at`, and forget what was due after it. */
export const dropCancel = (at: number) => post({ cancel: true, at: at + dropDelaySeconds() });

const FX_OF = new Map(DROP_ROWS.map((r) => [r.note, r.fx]));
/** The effect a note holds (undefined: not one of the Drop pad's rows). */
export const dropFxOf = (note: string) => FX_OF.get(note);

/**
 * When a note starting at `time` and lasting `bars` lets go: its end, or the loop's end if that
 * comes first, along the song's tempo (changes included), as an export reads it.
 */
function releaseAt(time: number, bars: number): number {
  const bar = barAt(time);
  let end = bar + bars;
  if (liveTransport.loop) {
    const loopEnd = ticksToBar(Math.round(liveTransport.toTicks(liveTransport.loopEnd)));
    if (bar < loopEnd - 1e-6) end = Math.min(end, loopEnd);
  }
  return time + secondsBetween(bar, end, getLiveTempo());
}

/**
 * The Drop Pad's instrument. In an export's offline context it does nothing: the export runs the
 * effects over its render instead (masterAfter.ts).
 */
export function createDropInstrument(offline: boolean): TrackInstrument {
  const idle: TrackInstrument = { play: () => {}, releaseAll: () => {}, ready: Promise.resolve(), dispose: () => {} };
  if (offline) return idle;
  const play = (notes: PlayableNote[], time: number) => {
    for (const n of notes) {
      const fx = dropFxOf(n.note);
      if (fx === undefined) continue;
      dropOn(fx, time);
      dropOff(fx, releaseAt(time, durationToBars(n.duration)), time);
    }
  };
  return {
    ...idle,
    play,
    noteOn: (n: PlayableNote, time: number): NoteOff => {
      const fx = dropFxOf(n.note);
      if (fx !== undefined) dropOn(fx, time);
      return (at: number) => {
        if (fx !== undefined) dropOff(fx, at, time);
      };
    },
  };
}

/** The 16th line at or after audio time `time` while playing (a press starts there), else `time`. */
export function nextSixteenthAt(time: number): number {
  if (liveTransport.state !== 'started') return time;
  const ticks = liveTransport.getTicksAtTime(time);
  const step = barToTicks(1 + 1 / 16);
  const next = Math.ceil(ticks / step - 1e-6) * step;
  return time + ((next - ticks) / step) * sixteenth();
}

/** Now, on the audio clock. */
export const audioNow = () => liveContext.immediate();

// Every start (a seek while playing included), stop and pause lets go of everything
const letGo = (time: number) => dropCancel(time ?? Tone.immediate());
liveTransport.on('start', letGo);
liveTransport.on('stop', letGo);
liveTransport.on('pause', letGo);
