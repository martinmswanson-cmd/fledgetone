import type { Clip, NoteEvent, Track } from './timelineTypes';
import { uid } from './timelineTypes';
import { isDrumKind } from '../audio/instrumentCatalog';

/**
 * Loop variations: a few takes of the same loop that a game can rotate through, so a player who
 * stays in one place for twenty minutes doesn't hear the very same loop again and again. Every
 * take keeps the loop's length, key and parts; what changes is the feel (each take gets its own
 * Human drift, see human.ts, because its clips get new ids) and the drums at the turnaround: a
 * snare fill, a tom fill, or the hats dropping out for the first half. Take A is the loop as
 * written. No audio or store here, so Node can unit-test it.
 */

export const VARIATION_NAMES = ['A', 'B', 'C', 'D'] as const;
export const VARIATION_BLURBS = ['as written', 'a snare fill into the loop point', 'a tom fill into the loop point', 'hats out for the first half, a kick pickup at the end'];

const KICK = 'C1';
const SNARE = 'D1';
const HATS = new Set(['F#1', 'A#1']);
const TOMS = ['D2', 'B1', 'F1'];
const EPS = 1e-6;

/** Notes in a clip, with their song positions, that fall inside [from, to). */
const at = (c: Clip, n: NoteEvent) => c.startBar + n.startOffset;

/**
 * The clips of take `k` (0 = A) of the loop [inBar, outBar). Drum clips that reach the loop's
 * last beat get the take's fill; every clip gets a new id so the Human drift differs per take.
 */
export function loopVariation(clips: readonly Clip[], tracks: readonly Track[], inBar: number, outBar: number, k: number): Clip[] {
  if (k === 0) return clips.map((c) => c);
  const drums = new Set(tracks.filter((t) => isDrumKind(t.instrumentKey)).map((t) => t.id));
  const lastBeat = outBar - 0.25;
  const half = inBar + (outBar - inBar) / 2;
  // The fill goes on one drum clip only: the first one covering the last beat
  const fillClip = clips.find((c) => drums.has(c.trackId) && !c.audio && c.startBar <= lastBeat + EPS && c.startBar + c.lengthBars >= outBar - EPS);
  return clips.map((c) => {
    const copy: Clip = { ...c, id: `${c.id}~take${k}` };
    if (!drums.has(c.trackId) || c.audio) return copy;
    let notes = c.notes;
    if (k === 3) {
      // Hats out for the first half of the loop
      notes = notes.filter((n) => !(HATS.has(n.note) && at(c, n) >= inBar - EPS && at(c, n) < half - EPS));
    }
    if (c === fillClip) {
      const keep = notes.filter((n) => !(at(c, n) >= lastBeat - EPS && at(c, n) < outBar - EPS && n.note !== KICK));
      const base = lastBeat - c.startBar;
      const fill: NoteEvent[] = [];
      const add = (note: string, step: number, velocity: number) => fill.push({ id: uid('note'), note, startOffset: base + step / 16, duration: '16n', velocity });
      if (k === 1) [0, 1, 2, 3].forEach((i) => add(SNARE, i, 0.5 + i * 0.12));
      if (k === 2) [0, 1, 2, 3].forEach((i) => add(TOMS[Math.min(2, i)], i, 0.7 + i * 0.06));
      if (k === 2) add(SNARE, 0, 0.6);
      if (k === 3) add(KICK, 2, 0.8);
      notes = [...keep, ...fill];
    }
    return notes === c.notes ? copy : { ...copy, notes };
  });
}
