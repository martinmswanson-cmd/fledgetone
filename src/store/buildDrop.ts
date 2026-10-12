import { FX_NOTES } from '../audio/instrumentCatalog';
import { DRUM_NOTES } from '../audio/scheduler';
import { DROP_HIT } from './demoSong';
import type { Step } from './demoSong';
import type { Clip, NoteEvent } from './timelineTypes';
import { uid } from './timelineTypes';

/**
 * "Build-up & drop here": the parts a drop is usually made of, written in one go before a bar.
 * A riser and a noise sweep over the build with a reverse crash into the drop, a snare roll that
 * speeds up over the build, and an impact with a sub drop on the drop's downbeat.
 */

/** How long the build is, in bars, when there's room. */
export const BUILD_BARS = 4;
/** How long the drop hit's clip is. */
export const HIT_BARS = 2;

/** The riser and sweep across `bars`, and the reverse crash in its last bar. */
export function buildUpSteps(bars: number): Step[] {
  return [
    [0, FX_NOTES.riser, 0.85, `${bars}:0:0`],
    [0, FX_NOTES.noiseSweep, 0.7, `${bars}:0:0`],
    [(bars - 1) * 16, FX_NOTES.reverseCrash, 0.85, '1n'],
  ];
}

/** The four-bar roll (quarters, 8ths, then 16ths getting louder); a shorter build keeps its end. */
export function snareRollSteps(bars: number): Step[] {
  const s = DRUM_NOTES.snare;
  const roll: Step[] = [
    ...[0, 4, 8, 12].map((i): Step => [i, s, 0.5]),
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((i): Step => [16 + i, s, 0.6]),
    ...Array.from({ length: 32 }, (_, i): Step => [32 + i, s, 0.65 + (0.3 * i) / 31]),
  ];
  const skip = (BUILD_BARS - bars) * 16;
  return roll.filter(([i]) => i >= skip).map(([i, n, v, d]): Step => [i - skip, n, v, d]);
}

export const dropHitSteps = (): Step[] => DROP_HIT;

export function partClip(trackId: string, name: string, startBar: number, lengthBars: number, notes: NoteEvent[]): Clip {
  return { id: uid('clip'), trackId, name, startBar, lengthBars, notes, isSelected: true };
}
