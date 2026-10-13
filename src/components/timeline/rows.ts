/**
 * The timeline's vertical layout: where each shown track's row starts, below the ruler, the video
 * lane and the folder rows.
 */
import type { Track } from '../../store/timelineTypes';
import { trackRows } from '../../store/folders';
import { RULER_HEIGHT, TRACK_HEIGHT } from './layout';

/** A folder's row in the timeline. */
export const FOLDER_ROW_HEIGHT = 30;
/** The reference video's lane under the ruler (see VideoLane). */
export const VIDEO_LANE_HEIGHT = 48;

/**
 * Where each shown track's row starts, from the top of the timeline's content (the ruler, the
 * video lane if there is one, folder rows and tracks in between), and where the rows end. Tracks
 * folded away in a folder have no row.
 */
export function laneTops(tracks: readonly Track[], hasVideo: boolean): { tops: Map<string, number>; bottom: number } {
  const tops = new Map<string, number>();
  let y = RULER_HEIGHT + (hasVideo ? VIDEO_LANE_HEIGHT : 0);
  for (const row of trackRows(tracks)) {
    if (row.kind === 'folder') {
      y += FOLDER_ROW_HEIGHT;
      continue;
    }
    tops.set(row.track.id, y);
    y += TRACK_HEIGHT;
  }
  return { tops, bottom: y };
}
