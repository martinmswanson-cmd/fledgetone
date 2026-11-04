import { FX_NOTES } from '../audio/instrumentCatalog';
import { DRUM_NOTES } from './drumNotes';
import { DROP_HIT } from './demoSong';
import type { Step } from './demoSong';
import type { Clip, NoteEvent } from './timelineTypes';
import { barsToDuration, uid } from './timelineTypes';

/**
 * "Build-up & drop here": the parts a drop is usually made of, written in one go before a bar.
 * A riser and a noise sweep over the build with a reverse crash into the drop, a snare roll that
 * speeds up over the build, and an impact with a sub drop on the drop's downbeat. Not in 4/4,
 * each part is written in the song's measures: `measures` gives each measure's length in bars
 * (whole notes), 0.75 for a 3/4 or 6/8 measure.
 */

/** How long the build is, in bars (measures), when there's room. */
export const BUILD_BARS = 4;
/** How long the drop hit's clip is, in bars (measures). */
export const HIT_BARS = 2;

/** 16th steps from the part's start to where measure `i` starts. */
const stepsTo = (measures: readonly number[], i: number) => Math.round(measures.slice(0, i).reduce((a, b) => a + b, 0) * 16 * 1e6) / 1e6;

/** The riser and sweep across `bars`, and the reverse crash in its last bar (or the last of `measures`). */
export function buildUpSteps(bars: number, measures?: readonly number[]): Step[] {
  if (measures?.length) {
    const total = measures.reduce((a, b) => a + b, 0);
    const last = measures[measures.length - 1];
    return [
      [0, FX_NOTES.riser, 0.85, barsToDuration(total)],
      [0, FX_NOTES.noiseSweep, 0.7, barsToDuration(total)],
      [stepsTo(measures, measures.length - 1), FX_NOTES.reverseCrash, 0.85, barsToDuration(last)],
    ];
  }
  return [
    [0, FX_NOTES.riser, 0.85, `${bars}:0:0`],
    [0, FX_NOTES.noiseSweep, 0.7, `${bars}:0:0`],
    [(bars - 1) * 16, FX_NOTES.reverseCrash, 0.85, '1n'],
  ];
}

/**
 * The four-bar roll (quarters, 8ths, then 16ths getting louder); a shorter build keeps its end.
 * With `measures`, the roll's bars are those measures (the last of them the 16ths).
 */
export function snareRollSteps(bars: number, measures?: readonly number[]): Step[] {
  const s = DRUM_NOTES.snare;
  if (measures?.length) {
    const kept = measures.slice(-BUILD_BARS);
    const tail = kept.slice(-2).reduce((a, b) => a + Math.round(b * 16), 0);
    const out: Step[] = [];
    let k = 0;
    kept.forEach((len, i) => {
      const at = stepsTo(kept, i);
      const steps = Math.round(len * 16);
      const fromEnd = kept.length - 1 - i;
      const every = fromEnd === 3 ? 4 : fromEnd === 2 ? 2 : 1;
      for (let j = 0; j < steps; j += every) {
        out.push(every === 1 ? [at + j, s, 0.65 + (0.3 * k) / Math.max(1, tail - 1)] : [at + j, s, every === 4 ? 0.5 : 0.6]);
        if (every === 1) k++;
      }
    });
    return out;
  }
  const roll: Step[] = [
    ...[0, 4, 8, 12].map((i): Step => [i, s, 0.5]),
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((i): Step => [16 + i, s, 0.6]),
    ...Array.from({ length: 32 }, (_, i): Step => [32 + i, s, 0.65 + (0.3 * i) / 31]),
  ];
  const skip = (BUILD_BARS - bars) * 16;
  return roll.filter(([i]) => i >= skip).map(([i, n, v, d]): Step => [i - skip, n, v, d]);
}

/** The drop hit: an impact and sub drop on the downbeat, a downlifter from its second bar (the second of `measures`). */
export function dropHitSteps(measures?: readonly number[]): Step[] {
  if (!measures?.length) return DROP_HIT;
  const [first, second = first] = measures;
  return [
    [0, FX_NOTES.impact, 0.95],
    [0, FX_NOTES.subDrop, 0.9, '1n'],
    [stepsTo(measures, 1), FX_NOTES.downlifter, 0.7, barsToDuration(second)],
  ];
}

export function partClip(trackId: string, name: string, startBar: number, lengthBars: number, notes: NoteEvent[]): Clip {
  return { id: uid('clip'), trackId, name, startBar, lengthBars, notes, isSelected: true };
}
