/**
 * The tempo finder: given hit points in a video (moments that must land on the music, as seconds
 * from bar 1), find the tempos that put the most of them on the beat. Film composers do this with
 * a calculator; here it tries every tempo in a range, 0.01 BPM apart. No audio or store here, so
 * Node can unit-test it.
 */

/** What a hit should land on. */
export type HitGrid = 'bar' | 'beat' | '8th';
export const HIT_GRIDS: ReadonlyArray<{ value: HitGrid; label: string; perBeat: number }> = [
  { value: 'bar', label: 'Bar', perBeat: 1 / 4 },
  { value: 'beat', label: 'Beat', perBeat: 1 },
  { value: '8th', label: '1/8', perBeat: 2 },
];

export interface HitFit {
  /** Seconds from bar 1 */
  seconds: number;
  /** Seconds early (-) or late (+) the nearest grid line is from the hit */
  off: number;
  /** Bar (1-based, fractional) of the nearest grid line */
  bar: number;
}

export interface TempoSuggestion {
  bpm: number;
  /** How many hits land within the tolerance */
  onGrid: number;
  /** Mean distance from the grid, seconds */
  meanOff: number;
  hits: HitFit[];
}

/** Where each hit falls against `grid` at `bpm`. */
export function fitHits(hits: readonly number[], bpm: number, grid: HitGrid): HitFit[] {
  const perBeat = HIT_GRIDS.find((g) => g.value === grid)!.perBeat;
  const step = 60 / bpm / perBeat; // seconds per grid line
  return hits.map((seconds) => {
    const line = Math.round(seconds / step) * step;
    return { seconds, off: line - seconds, bar: (line * bpm) / 240 + 1 };
  });
}

function score(hits: readonly number[], bpm: number, grid: HitGrid, tolerance: number): TempoSuggestion {
  const fit = fitHits(hits, bpm, grid);
  let onGrid = 0;
  let total = 0;
  for (const h of fit) {
    const off = Math.abs(h.off);
    if (off <= tolerance) onGrid++;
    total += off;
  }
  return { bpm, onGrid, meanOff: fit.length ? total / fit.length : 0, hits: fit };
}

/** Best first: more hits on the grid, then closer on average, then nearer the tempo you have. */
const better = (a: TempoSuggestion, b: TempoSuggestion, near: number) =>
  b.onGrid - a.onGrid || a.meanOff - b.meanOff || Math.abs(a.bpm - near) - Math.abs(b.bpm - near);

export interface FindOptions {
  grid: HitGrid;
  min: number;
  max: number;
  /** Seconds a hit may be off and still count (a frame is about 0.033 at 30 fps) */
  tolerance: number;
  /** The tempo now, preferred on a tie */
  near: number;
  /** How many suggestions (default 5) */
  count?: number;
}

/**
 * The best tempos between `min` and `max` for these hits. Suggestions are at least 1 BPM apart,
 * so the list offers real choices rather than one tempo five times over.
 */
export function findTempos(hits: readonly number[], { grid, min, max, tolerance, near, count = 5 }: FindOptions): TempoSuggestion[] {
  const usable = hits.filter((s) => Number.isFinite(s) && s > 0);
  if (!usable.length || !(max >= min)) return [];
  const all: TempoSuggestion[] = [];
  const lo = Math.round(min * 100);
  const hi = Math.round(max * 100);
  for (let i = lo; i <= hi; i++) all.push(score(usable, i / 100, grid, tolerance));
  all.sort((a, b) => better(a, b, near));
  const picked: TempoSuggestion[] = [];
  for (const s of all) {
    if (picked.some((p) => Math.abs(p.bpm - s.bpm) < 1)) continue;
    picked.push(s);
    if (picked.length === count) break;
  }
  return picked;
}

/** How the hits sit at a tempo, scored the same way (for "now" next to the suggestions). */
export const scoreTempo = (hits: readonly number[], bpm: number, grid: HitGrid, tolerance: number) =>
  score(hits.filter((s) => Number.isFinite(s) && s > 0), bpm, grid, tolerance);
