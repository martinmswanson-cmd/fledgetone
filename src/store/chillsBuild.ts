import type { AutomationPoint } from './timelineTypes';
import { FILTER_CUTOFF_MAX } from './timelineTypes';
import { AUTOMATION, laneValueAt, VOLUME_FLOOR_DB } from '../audio/automation';
import { measuresBetween, meterAt, type MeterMap } from '../audio/tempoMap';

/**
 * The build for chills, as lanes: over the bars before a peak the tracks swell (their volume
 * rises from a little under where it was to where it was, and a low-pass filter opens), with a
 * moment of near-silence just before the peak if asked. Ear safety comes first: the swell only
 * ever takes level away and gives it back (nothing ends up louder than the bars before the build),
 * its whole rise is at most BUILD_MOST_RISE_DB, and every change is a slope, never a step (no two
 * points at one place). A lane the track already has is kept outside the build and followed
 * inside it. Plain maths, so Node can unit-test it; the store side is chillsActions.ts.
 */

/** The most the swell rises over the build, dB: it starts this far under the track's level. */
export const BUILD_MOST_RISE_DB = 6;
/** The swell depths offered, dB. */
export const BUILD_DEPTHS = [3, 4.5, 6] as const;
/** How far under the track's level the near-silence before the peak sits, dB. */
export const GAP_DB = 18;
/** Where the filter starts as the build begins, Hz (it opens to the track's own cutoff). */
export const BUILD_LOW_CUTOFF = 500;

export interface BuildSpan {
  /** Where the build starts (a song position) */
  from: number;
  /** The peak: where the build ends and the next part arrives */
  peak: number;
  /** The near-silence just before the peak */
  gap: boolean;
}

/** The build's places: where the dip into it starts (a beat before, from bar 2 on), the measure lines in it, and where the near-silence starts. */
export function buildPlaces(o: BuildSpan, map: MeterMap): { lead: number; marks: number[]; gapStart: number; gapIn: number; gapOut: number } {
  const beat = 1 / meterAt(o.from, map).den;
  const lead = Math.max(1, o.from - beat);
  // The near-silence: half a beat (an 8th in 4/4), where the build is long enough for it
  const gapLen = 1 / meterAt(Math.max(1, o.peak - 1e-6), map).den / 2;
  const gap = o.gap && o.peak - o.from >= 4 * gapLen;
  const gapStart = gap ? o.peak - gapLen : o.peak;
  const marks = measuresBetween(o.from + 1e-6, gapStart - 1e-6, map).map((m) => m.bar);
  return { lead, marks, gapStart, gapIn: gap ? Math.min(1 / 64, gapLen / 4) : 0, gapOut: gap ? Math.min(1 / 32, gapLen / 3) : 0 };
}

/** How far through the build the swell is at x (0 to 1): slow at first, quicker toward the peak. */
export const swellShape = (x: number): number => Math.max(0, Math.min(1, x)) ** 1.6;

const volumeNorm = AUTOMATION.volume.toNorm;
const volumeDb = AUTOMATION.volume.toReal;
const cutoffNorm = AUTOMATION.filterCutoff.toNorm;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** A lane's points with the build's stretch [lead, peak] taken out, and `mine` put in. */
function splice(existing: readonly AutomationPoint[] | undefined, lead: number, peak: number, mine: AutomationPoint[]): AutomationPoint[] {
  const kept = (existing ?? []).filter((p) => p.bar < lead - 1e-9 || p.bar > peak + 1e-9);
  return [...kept, ...mine].sort((a, b) => a.bar - b.bar);
}

/**
 * A track's volume lane with the swell in it: `existing` its lane now (or none: the fader's
 * `trackDb` all along), `depthDb` how far under its level the build starts (at most
 * BUILD_MOST_RISE_DB). Null when the track is silent there (nothing to swell).
 */
export function swellLane(existing: readonly AutomationPoint[] | undefined, trackDb: number, o: BuildSpan & { depthDb: number }, map: MeterMap): AutomationPoint[] | null {
  const has = !!existing?.length;
  const dbAt = (bar: number) => (has ? volumeDb(laneValueAt(existing!, bar)!) : trackDb);
  const p = buildPlaces(o, map);
  if (!(dbAt(p.lead) > VOLUME_FLOOR_DB + 12) || !(o.peak > o.from)) return null;
  const depth = Math.max(0, Math.min(BUILD_MOST_RISE_DB, o.depthDb));
  const at = (bar: number, offsetDb: number): AutomationPoint => ({ bar: r6(bar), value: r6(volumeNorm(dbAt(bar) + offsetDb)) });
  const mine: AutomationPoint[] = [];
  if (p.lead < o.from - 1e-9) mine.push(at(p.lead, 0));
  const span = p.gapStart - o.from;
  for (const bar of [o.from, ...p.marks, p.gapStart]) mine.push(at(bar, -depth * (1 - swellShape((bar - o.from) / span))));
  if (p.gapIn) {
    mine.push(at(p.gapStart + p.gapIn, -GAP_DB), at(o.peak - p.gapOut, -GAP_DB), at(o.peak, 0));
  }
  // (Values the peak and after already had, and before the dip: the rest of the song plays as it did)
  return splice(existing, p.lead, o.peak, mine);
}

/**
 * A track's filter cutoff lane with the build in it: it closes over the beat before the build to
 * BUILD_LOW_CUTOFF (or where it already was, if lower) and opens back to `openHz` (or the lane's
 * own value) by the peak.
 */
export function openingLane(existing: readonly AutomationPoint[] | undefined, openHz: number, o: BuildSpan, map: MeterMap): AutomationPoint[] {
  const has = !!existing?.length;
  const openAt = (bar: number) => (has ? laneValueAt(existing!, bar)! : cutoffNorm(Math.min(FILTER_CUTOFF_MAX, openHz)));
  const p = buildPlaces(o, map);
  const low = cutoffNorm(BUILD_LOW_CUTOFF);
  const mine: AutomationPoint[] = [];
  if (p.lead < o.from - 1e-9) mine.push({ bar: r6(p.lead), value: r6(openAt(p.lead)) });
  const span = p.gapStart - o.from;
  for (const bar of [o.from, ...p.marks, p.gapStart]) {
    const open = openAt(bar);
    const closed = Math.min(open, low);
    mine.push({ bar: r6(bar), value: r6(closed + (open - closed) * swellShape((bar - o.from) / span)) });
  }
  if (p.gapStart < o.peak - 1e-9) mine.push({ bar: r6(o.peak), value: r6(openAt(o.peak)) });
  return splice(existing, p.lead, o.peak, mine);
}

/**
 * How much a volume lane rises anywhere over [from, to) above `refDb` (the level before the
 * build), dB, read every `step` bars: the build's cap check.
 */
export function riseOver(points: readonly AutomationPoint[], from: number, to: number, refDb: number, step = 1 / 64): number {
  let most = -Infinity;
  for (let bar = from; bar <= to + 1e-9; bar += step) most = Math.max(most, volumeDb(laneValueAt(points, bar)!) - refDb);
  return most;
}

/**
 * The biggest jump up between two points at one place in a lane (an instant step), in lane
 * height: 0 when every change is a slope.
 */
export function stepUp(points: readonly AutomationPoint[]): number {
  let most = 0;
  for (let i = 1; i < points.length; i++) if (Math.abs(points[i].bar - points[i - 1].bar) < 1e-9) most = Math.max(most, points[i].value - points[i - 1].value);
  return most;
}
