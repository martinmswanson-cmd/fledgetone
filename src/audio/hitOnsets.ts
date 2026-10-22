/**
 * Where the kicks and snares hit in a stretch of the song, from its drum notes (the kits' note
 * map: C1 the kick, D1 the snare, D#1 the clap, which counts as a snare; not a percussion kit's
 * rows of other names), in seconds from the
 * stretch's start: what the "Does it hit?" check (hitCheck.ts) needs to measure the sidechain,
 * the sub ducking under the snare and how far the drums poke out. Reading the notes is exact
 * where finding hits in the audio would guess. Swing is left out (it moves off-beat 16ths by a
 * few ms, inside the measures' windows). Pure, so Node tests it.
 */
import { isDrumKind, pumpHitOf } from './instrumentCatalog';
import { barToSeconds, type Tempo } from './tempoMap';
import type { Clip, Track } from '../store/timelineTypes';

/** Hits closer than this (seconds) are one hit (a snare and a clap together). */
const TOGETHER = 0.015;

function merged(times: number[]): number[] {
  const out: number[] = [];
  for (const t of times.sort((a, b) => a - b)) if (!out.length || t - out[out.length - 1] > TOGETHER) out.push(t);
  return out;
}

/** The kicks and snares of the drum kits among `tracks` (the audible ones) in bars [fromBar, toBar), seconds from fromBar. */
export function drumOnsets(tracks: readonly Track[], clips: readonly Clip[], tempo: Tempo, fromBar: number, toBar: number): { kicks: number[]; snares: number[] } {
  const drums = new Map(tracks.filter((t) => isDrumKind(t.instrumentKey)).map((t) => [t.id, t.instrumentKey]));
  const zero = barToSeconds(fromBar, tempo);
  const kicks: number[] = [];
  const snares: number[] = [];
  for (const c of clips) {
    if (!drums.has(c.trackId) || c.audio || c.startBar >= toBar || c.startBar + c.lengthBars <= fromBar) continue;
    for (const n of c.notes) {
      if (n.startOffset < 0 || n.startOffset >= c.lengthBars) continue;
      const at = c.startBar + n.startOffset;
      if (at < fromBar || at >= toBar) continue;
      // (As the Pumps hear them: a percussion kit's conga on D1 is no snare, see pumpHitOf)
      const hit = pumpHitOf(drums.get(c.trackId), n.note);
      const list = hit === 'kick' ? kicks : hit === 'snare' ? snares : null;
      list?.push(barToSeconds(at, tempo) - zero);
    }
  }
  return { kicks: merged(kicks), snares: merged(snares) };
}
