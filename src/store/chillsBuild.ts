import type { AutomationPoint } from './timelineTypes';
import { FILTER_CUTOFF_MAX } from './timelineTypes';
import { AUTOMATION, laneValueAt, VOLUME_FLOOR_DB } from '../audio/automation';
import { measuresBetween, meterAt, type MeterMap } from '../audio/tempoMap';

/**
 * The build for chills, as lanes: over the bars before a peak the tracks swell (their volume
 * rises from a little under where it was to where it was, and a low-pass filter opens), with a
 * moment of near-silence just before the peak if asked. Or, started from the music's level
 * (BuildStart 'level'), nothing dips first: the tracks keep their level all through the build, and
 * only the near-silence is written (the lift then comes from the parts the build adds: the riser,
 * the breath, the pad at the peak). Ear safety comes first: the swell only
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

/**
 * How the build starts: 'dip' (the tracks start a little under their level and darker, and grow
 * back to it by the peak) or 'level' (nothing dips: they keep their level all through the build).
 */
export type BuildStart = 'dip' | 'level';

export interface BuildSpan {
  /** Where the build starts (a song position) */
  from: number;
  /** The peak: where the build ends and the next part arrives */
  peak: number;
  /** The near-silence just before the peak */
  gap: boolean;
  /** How it starts (none given: 'dip') */
  start?: BuildStart;
}

/** Whether a build starts by dipping (the swell and the filter's opening) or from the music's level. */
export const dipsFirst = (o: Pick<BuildSpan, 'start'>): boolean => o.start !== 'level';

/**
 * The build's places: where the dip into it starts (a beat before, from bar 2 on; started from the
 * music's level, the build's own start: nothing before it changes), the measure lines in it, and
 * where the near-silence starts.
 */
export function buildPlaces(o: BuildSpan, map: MeterMap): { lead: number; marks: number[]; gapStart: number; gapIn: number; gapOut: number } {
  const beat = 1 / meterAt(o.from, map).den;
  const lead = dipsFirst(o) ? Math.max(1, o.from - beat) : o.from;
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

/**
 * The places a lane is written at inside the build (lead, peak): `own` (the build's places) and
 * every point the track's own lane has in there, a curved stretch of it every 128th of a bar, so
 * the build follows the lane at every one of its corners. The track's points at the lead and the
 * peak themselves are kept as they are. Returns the bars, in order, the lane's own points kept by
 * reference (a jump at one place stays a jump).
 */
function samples(existing: readonly AutomationPoint[] | undefined, lead: number, peak: number, own: number[]): Array<{ bar: number; point?: AutomationPoint; curved?: boolean }> {
  const out: Array<{ bar: number; point?: AutomationPoint; curved?: boolean }> = [];
  const pts = existing ?? [];
  const at = new Set(pts.map((p) => r6(p.bar)));
  for (const bar of new Set(own.map(r6))) if (bar > lead - 1e-9 && bar < peak + 1e-9 && !at.has(bar)) out.push({ bar });
  pts.forEach((p, i) => {
    if (p.bar > lead - 1e-9 && p.bar < peak + 1e-9) out.push({ bar: p.bar, point: p });
    // (a bent stretch of the lane: followed closely)
    const next = pts[i + 1];
    if (p.curve && next && next.bar > lead && p.bar < peak) {
      for (let b = Math.max(lead, p.bar) + 1 / 128; b < Math.min(peak, next.bar) - 1e-9; b += 1 / 128) if (!at.has(r6(b))) out.push({ bar: b, curved: true });
    }
  });
  return out.sort((a, b) => a.bar - b.bar);
}

/** A lane's points with the build's stretch (lead, peak) taken out (its points at the lead and the peak kept), and `mine` put in. */
function splice(existing: readonly AutomationPoint[] | undefined, lead: number, peak: number, mine: AutomationPoint[]): AutomationPoint[] {
  const kept = (existing ?? []).filter((p) => p.bar <= lead + 1e-9 || p.bar >= peak - 1e-9);
  return [...kept, ...mine].map((p, i) => ({ p, i })).sort((a, b) => a.p.bar - b.p.bar || a.i - b.i).map(({ p }) => p);
}

/** How far under the lane the build holds it at `bar`, dB (0 or less): the dip in, the swell, the near-silence. */
function swellOffset(bar: number, o: BuildSpan & { depthDb: number }, p: ReturnType<typeof buildPlaces>): number {
  // (from the music's level: no dip, only the near-silence)
  const depth = dipsFirst(o) ? Math.max(0, Math.min(BUILD_MOST_RISE_DB, o.depthDb)) : 0;
  if (bar <= p.lead) return 0;
  if (bar < o.from) return (-depth * (bar - p.lead)) / (o.from - p.lead);
  if (bar <= p.gapStart) return -depth * (1 - swellShape((bar - o.from) / (p.gapStart - o.from)));
  if (!p.gapIn) return 0;
  if (bar < p.gapStart + p.gapIn) return (-GAP_DB * (bar - p.gapStart)) / p.gapIn;
  if (bar <= o.peak - p.gapOut) return -GAP_DB;
  if (bar < o.peak) return (-GAP_DB * (o.peak - bar)) / p.gapOut;
  return 0;
}

/**
 * A track's volume lane with the swell in it: `existing` its lane now (or none: the fader's
 * `trackDb` all along), `depthDb` how far under its level the build starts (at most
 * BUILD_MOST_RISE_DB; 0 with only the near-silence, as when it starts from the music's level). The build is taken off the lane as it is, at
 * every one of its points: never louder than it was at any moment. Null when the track is silent
 * all through the build (nothing to swell).
 */
export function swellLane(existing: readonly AutomationPoint[] | undefined, trackDb: number, o: BuildSpan & { depthDb: number }, map: MeterMap): AutomationPoint[] | null {
  const has = !!existing?.length;
  const dbAt = (bar: number) => (has ? volumeDb(laneValueAt(existing!, bar)!) : trackDb);
  const p = buildPlaces(o, map);
  if (!(o.peak > o.from)) return null;
  const own = [p.lead, o.from, ...p.marks, p.gapStart, ...(p.gapIn ? [p.gapStart + p.gapIn, o.peak - p.gapOut] : []), o.peak];
  const places = samples(existing, p.lead, o.peak, own);
  if (!places.some((x) => (x.point ? volumeDb(x.point.value) : dbAt(x.bar)) > VOLUME_FLOOR_DB + 12)) return null;
  const mine = places.map((x): AutomationPoint => {
    const db = (x.point ? volumeDb(x.point.value) : dbAt(x.bar)) + swellOffset(x.bar, o, p) - (x.curved ? 0.05 : 0);
    // (a point of the track's own at the lead or the peak: as it was)
    const value = Math.min(x.point ? x.point.value : volumeNorm(dbAt(x.bar)), r6(volumeNorm(db)));
    return { bar: r6(x.bar), value };
  });
  return splice(existing, p.lead, o.peak, mine);
}

/**
 * A track's filter cutoff lane with the build in it: it closes over the beat before the build to
 * BUILD_LOW_CUTOFF (or where it already was, if lower) and opens back to `openHz` (or the lane's
 * own value, followed at every one of its points) by the peak: never brighter than it was. A build
 * from the music's level leaves it as it was.
 */
export function openingLane(existing: readonly AutomationPoint[] | undefined, openHz: number, o: BuildSpan, map: MeterMap): AutomationPoint[] {
  // (a build from the music's level isn't darkened first, so nothing opens: the lane as it was)
  if (!dipsFirst(o)) return [...(existing ?? [])];
  const has = !!existing?.length;
  const openAt = (bar: number) => (has ? laneValueAt(existing!, bar)! : cutoffNorm(Math.min(FILTER_CUTOFF_MAX, openHz)));
  const p = buildPlaces(o, map);
  const low = cutoffNorm(BUILD_LOW_CUTOFF);
  const shut = (bar: number) => (bar <= p.lead ? 0 : bar < o.from ? (bar - p.lead) / (o.from - p.lead) : bar >= p.gapStart ? 0 : 1 - swellShape((bar - o.from) / (p.gapStart - o.from)));
  const places = samples(existing, p.lead, o.peak, [p.lead, o.from, ...p.marks, p.gapStart, o.peak]);
  const mine = places.map((x): AutomationPoint => {
    const open = x.point ? x.point.value : openAt(x.bar);
    const closed = Math.min(open, low);
    return { bar: r6(x.bar), value: Math.min(open, r6(open - (open - closed) * shut(x.bar))) };
  });
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
