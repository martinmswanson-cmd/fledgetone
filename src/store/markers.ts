import type { Marker, MarkerAnchor } from './timelineTypes';
import { TOTAL_BARS, uid } from './timelineTypes';

/**
 * Marker maths: names, keeping a marker's bar and time in step with the tempo, the ripple edits,
 * and reading markers from a project file. No audio or store here, so Node can unit-test it.
 */

/** Longest marker name (the name fields stop there; longer ones in a file are cut). */
export const MARKER_NAME_MAX = 80;

/** The end of the timeline: the last place a marker can be dragged or pushed to. */
const LAST_BAR = TOTAL_BARS + 1;
const EPS = 1e-6;

// 4/4 at a constant tempo, as barToSeconds / secondsToBar in transport.ts (which loads Tone.js)
const barToSeconds = (bar: number, bpm: number) => ((bar - 1) * 240) / bpm;
const secondsToBar = (seconds: number, bpm: number) => (seconds * bpm) / 240 + 1;

const byPosition = (a: Marker, b: Marker) => a.bar - b.bar;

/**
 * A name as typed, tidied: one line, trimmed, at most MARKER_NAME_MAX characters. Null if nothing
 * is left. Control characters (a NUL from a hand-edited file) become spaces: a WAV label is read
 * as a C string, so one would hide the rest of the name in other apps.
 */
export function cleanMarkerName(name: string): string | null {
  const clean = name
    .replace(/[\s\p{Cc}]+/gu, ' ')
    .trim()
    .slice(0, MARKER_NAME_MAX)
    // The cut can split an emoji in two: don't keep its first half
    .replace(/[\uD800-\uDBFF]$/, '')
    .trim();
  return clean || null;
}

/** "Marker N", one past the highest "Marker N" in use, so a new marker never repeats a name. */
export function nextMarkerName(markers: readonly Marker[]): string {
  let highest = 0;
  for (const m of markers) {
    const n = /^Marker (\d+)$/.exec(m.name);
    if (n) highest = Math.max(highest, Number(n[1]));
  }
  return `Marker ${highest + 1}`;
}

/** A marker held to its bar, at `bar` (put on the timeline). */
export function createMarker(bar: number, bpm: number, name: string, id = uid('marker')): Marker {
  return placeMarker({ id, name, anchor: 'bar', bar: 1, seconds: 0 }, bar, bpm);
}

/** The marker moved to `bar` (put on the timeline). Both positions move; the anchor stays. */
export function placeMarker(marker: Marker, bar: number, bpm: number): Marker {
  const at = Math.max(1, Math.min(LAST_BAR, bar));
  return { ...marker, bar: at, seconds: barToSeconds(at, bpm) };
}

/** The marker held to `anchor` from now on (where it is doesn't change). */
export function anchorMarker(marker: Marker, anchor: MarkerAnchor): Marker {
  return marker.anchor === anchor ? marker : { ...marker, anchor };
}

/**
 * The markers at `bpm`: each one's bar or time recomputed from the one its anchor holds, in
 * position order. A marker held to its time keeps its time, so a faster tempo can put it past the
 * end of the timeline (it comes back when the tempo drops). The same array if nothing changes.
 */
export function retimeMarkers(markers: Marker[], bpm: number): Marker[] {
  let changed = false;
  const next = markers.map((m) => {
    const bar = m.anchor === 'time' ? secondsToBar(m.seconds, bpm) : m.bar;
    const seconds = m.anchor === 'time' ? m.seconds : barToSeconds(m.bar, bpm);
    if (bar === m.bar && seconds === m.seconds) return m;
    changed = true;
    return { ...m, bar, seconds };
  });
  return sortedOrSame(changed ? next : markers);
}

/** `markers` in position order: the same array if it already was (sorting is stable, so ties keep their order). */
function sortedOrSame(markers: Marker[]): Marker[] {
  return markers.every((m, i) => i === 0 || markers[i - 1].bar <= m.bar) ? markers : [...markers].sort(byPosition);
}

/**
 * The first marker held to its bar that inserting `bars` bars at `at` would push past the end of
 * the timeline, or null. The insert is refused then, as for a clip, rather than pile markers up at
 * the end.
 */
export function markerPushedPastEnd(markers: readonly Marker[], at: number, bars: number): Marker | null {
  return markers.find((m) => m.anchor === 'bar' && m.bar >= at - EPS && m.bar + bars > LAST_BAR + EPS) ?? null;
}

/**
 * Markers after inserting `bars` bars at `at`: markers held to their bar from there on move with
 * the music; markers held to their time stay. The same array if nothing moves. (Check
 * markerPushedPastEnd first: one pushed past the end would stop at the end.)
 */
export function insertMarkerBars(markers: Marker[], at: number, bars: number, bpm: number): Marker[] {
  if (!(bars > 0)) return markers;
  return rippleMarkers(markers, (bar) => (bar >= at - EPS ? bar + bars : bar), bpm);
}

/**
 * Markers after removing the bars from `from` to `to`: markers held to their bar inside them go
 * (one at `from` marks what was removed; one at `to` marks what now follows the cut, so it
 * stays), later ones move left. Markers held to their time stay. The same array if nothing changes.
 */
export function removeMarkerBars(markers: Marker[], from: number, to: number, bpm: number): Marker[] {
  const length = to - from;
  if (!(length > EPS)) return markers;
  return rippleMarkers(markers, (bar) => (bar < from - EPS ? bar : bar >= to - EPS ? bar - length : null), bpm);
}

/** Bar-held markers moved by `move` (null removes one); time-held ones untouched. */
function rippleMarkers(markers: Marker[], move: (bar: number) => number | null, bpm: number): Marker[] {
  let changed = false;
  const next: Marker[] = [];
  for (const m of markers) {
    const bar = m.anchor === 'bar' ? move(m.bar) : m.bar;
    if (bar === null) {
      changed = true;
    } else if (bar === m.bar) {
      next.push(m);
    } else {
      changed = true;
      next.push(placeMarker(m, bar, bpm));
    }
  }
  return changed ? sortedOrSame(next) : markers;
}

/**
 * The nearest marker before (`direction` -1) or after (1) `bar`, or null. Going back skips
 * markers less than `gap` bars behind `bar` (while playing, the one just passed). Markers past the
 * end of the timeline (a time-held marker after a tempo rise) can't be reached, so they don't count.
 */
export function adjacentMarker(markers: readonly Marker[], bar: number, direction: -1 | 1, gap = EPS): Marker | null {
  if (direction < 0) {
    for (let i = markers.length - 1; i >= 0; i--) if (markers[i].bar < bar - Math.max(gap, EPS)) return markers[i];
    return null;
  }
  return markers.find((m) => m.bar > bar + EPS && m.bar <= LAST_BAR + EPS) ?? null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Markers from a project file (untrusted): entries that aren't markers are skipped, not the
 * whole file. The anchored position is the one used (the other is recomputed at `bpm`), or the
 * other one if only that is there. Markers held to their bar are put on the timeline. Ids are
 * made unique, names tidied. In position order.
 */
export function parseMarkers(raw: unknown, bpm: number): Marker[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  const markers: Marker[] = [];
  for (const v of raw) {
    if (!isObj(v)) continue;
    const anchor: MarkerAnchor = v.anchor === 'time' ? 'time' : 'bar';
    const seconds = isNum(v.seconds) ? v.seconds : isNum(v.bar) ? barToSeconds(v.bar, bpm) : null;
    const bar = isNum(v.bar) ? v.bar : seconds !== null ? secondsToBar(seconds, bpm) : null;
    if (bar === null || seconds === null) continue;
    let id = typeof v.id === 'string' && v.id ? v.id : uid('marker');
    if (ids.has(id)) id = uid('marker');
    ids.add(id);
    const name = (typeof v.name === 'string' && cleanMarkerName(v.name)) || 'Marker';
    const time = Math.max(0, seconds);
    markers.push(anchor === 'time' ? { id, name, anchor, bar: secondsToBar(time, bpm), seconds: time } : placeMarker({ id, name, anchor, bar, seconds }, bar, bpm));
  }
  return sortedOrSame(markers);
}
