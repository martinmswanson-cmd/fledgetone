import type { Clip, Track } from './timelineTypes';
import { durationToBars } from './timelineTypes';
import { audibleIds } from './buses';
import { DROP_ROWS, INSTRUMENTS } from '../audio/instrumentCatalog';

/**
 * The Drop pad's moves: where its effects are held over the song, read from the notes of the
 * tracks playing the Drop Pad (a note on a row holds that row's effect for as long as it lasts,
 * see DROP_ROWS and effects/dropFx.ts). Live, the scheduler plays those notes as it plays any
 * track's; an export reads them here and runs the effects over its render (masterAfter.ts), so
 * the two match. As live, a muted Drop track holds nothing, nor one left out by solo; notes hidden
 * by a clip's trim don't play, and a note that runs past its clip's end still lasts its length.
 * No audio here, so Node can unit-test it.
 */
export interface DropMove {
  /** The effect's index in DROP_EFFECTS */
  fx: number;
  /** Song bars */
  from: number;
  to: number;
}

const FX_OF = new Map(DROP_ROWS.map((r) => [r.note, r.fx]));

/** Whether a track plays the Drop Pad. */
export const isDropTrack = (track: Pick<Track, 'instrumentKey'>) => INSTRUMENTS[track.instrumentKey]?.kind === 'drop';

/** Every move in the song, in order of where it starts. */
export function dropMoves(tracks: readonly Track[], clips: readonly Clip[]): DropMove[] {
  const drop = tracks.filter(isDropTrack);
  if (!drop.length) return [];
  const heard = audibleIds(tracks);
  const ids = new Set(drop.filter((t) => heard.has(t.id)).map((t) => t.id));
  const moves: DropMove[] = [];
  for (const c of clips) {
    if (!ids.has(c.trackId) || c.audio) continue;
    for (const n of c.notes) {
      const fx = FX_OF.get(n.note);
      if (fx === undefined || n.startOffset < -1e-6 || n.startOffset >= c.lengthBars - 1e-6) continue;
      const from = c.startBar + n.startOffset;
      moves.push({ fx, from, to: from + durationToBars(n.duration) });
    }
  }
  return moves.sort((a, b) => a.from - b.from || a.fx - b.fx);
}
