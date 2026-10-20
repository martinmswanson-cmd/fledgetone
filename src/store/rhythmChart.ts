/**
 * The rhythm game's chart, made from the song itself: the notes falling down four lanes are the
 * song's own kicks, snares and melody. The melody is the top note of whatever pitched parts play
 * at each moment; its notes move across the lanes the way the tune moves (up a step: a lane to the
 * right), kicks fall on the left and snares on the right. Strong notes (kicks, snares, notes on a
 * beat) are kept first, then weaker ones fill in while there's room, so an easier chart keeps the
 * song's backbone and a harder one adds the tune's quick notes. Long melody notes become holds.
 * Plain data from store/showcase.ts, so Node can unit-test it.
 */
import type { ShowcaseData } from './showcase';

export type RhythmDifficulty = 'easy' | 'normal' | 'hard';
export const LANES = 4;

export interface ChartNote {
  /** Seconds from the start of the song */
  time: number;
  lane: number;
  /** A hold's end (seconds); absent for a tap */
  end?: number;
}

/** Per difficulty: the least time between two notes, between two in one lane, and the shortest hold */
const SPACING: Record<RhythmDifficulty, { gap: number; sameLane: number; hold: number | null; pairs: boolean }> = {
  easy: { gap: 0.42, sameLane: 0.6, hold: null, pairs: false },
  normal: { gap: 0.22, sameLane: 0.3, hold: 0.7, pairs: false },
  hard: { gap: 0.12, sameLane: 0.16, hold: 0.5, pairs: true },
};

/** The drum kits' rows (instruments.ts DRUM_NOTES): the kick, and the snare, clap and toms */
const KICK = 24;
const SNARES = new Set([26, 27, 29, 35, 38]);

interface Candidate {
  time: number;
  /** Where it wants to go: 'kick' left, 'snare' right, a pitch across the lanes */
  kind: 'kick' | 'snare' | 'melody';
  midi: number;
  end: number;
  weight: number;
}

/** How close `t` is to a beat of the bar it's in (1 on a beat, 0.5 on an eighth, else 0) */
function onBeat(t: number, bars: readonly number[]): number {
  let i = 0;
  while (i + 1 < bars.length && bars[i + 1] <= t) i++;
  const from = bars[i] ?? 0;
  const to = bars[i + 1] ?? from + 2;
  const beat = (to - from) / 4;
  if (beat <= 0) return 0;
  const pos = (t - from) / beat;
  const near = (step: number) => Math.abs(pos / step - Math.round(pos / step)) * step < 0.06;
  return near(1) ? 1 : near(0.5) ? 0.5 : 0;
}

/** The song's notes as the chart's candidates: kicks, snares and the melody's top line. */
function candidates(data: ShowcaseData): Candidate[] {
  const out: Candidate[] = [];
  // Drum hits (kits only; a rack or a slicer's rows are its own, so its lowest row counts as the kick)
  const standard = data.drumRows.includes(KICK);
  const lowest = data.drumRows[0];
  for (const n of data.notes) {
    if (!n.drum) continue;
    const kick = standard ? n.midi === KICK : n.midi === lowest;
    const snare = standard ? SNARES.has(n.midi) : !kick && n.midi === data.drumRows[1];
    if (!kick && !snare) continue;
    out.push({ time: n.start, kind: kick ? 'kick' : 'snare', midi: n.midi, end: n.start, weight: 3 + onBeat(n.start, data.bars) });
  }
  // The melody: at each onset (notes within 30 ms count as together), the highest pitched note
  const pitched = data.notes.filter((n) => !n.drum);
  for (let i = 0; i < pitched.length; ) {
    let j = i;
    let top = pitched[i];
    while (j < pitched.length && pitched[j].start - pitched[i].start < 0.03) {
      if (pitched[j].midi > top.midi) top = pitched[j];
      j++;
    }
    out.push({ time: top.start, kind: 'melody', midi: top.midi, end: top.end, weight: 2 + onBeat(top.start, data.bars) + (top.end - top.start > 0.4 ? 0.5 : 0) });
    i = j;
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Index of the first time in sorted `times` at or after `t` */
function lowerBound(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The chart for a song's notes at a difficulty. */
export function buildChart(data: ShowcaseData, difficulty: RhythmDifficulty): ChartNote[] {
  const rule = SPACING[difficulty];
  const all = candidates(data);
  // Strongest first: each is kept if nothing kept is too close to it
  const order = all.map((_, i) => i).sort((a, b) => all[b].weight - all[a].weight || all[a].time - all[b].time);
  const keptTimes: number[] = [];
  const kept = new Set<number>();
  for (const i of order) {
    const t = all[i].time;
    const at = lowerBound(keptTimes, t);
    if ((at < keptTimes.length && keptTimes[at] - t < rule.gap) || (at > 0 && t - keptTimes[at - 1] < rule.gap)) continue;
    keptTimes.splice(at, 0, t);
    kept.add(i);
  }
  const chosen = all.filter((_, i) => kept.has(i));

  // Lanes: kicks left, snares right, the melody following its tune; nothing lands in a lane that
  // was just used (too soon to hit again), moving to the nearest free lane instead
  const notes: ChartNote[] = [];
  const lastIn = new Array<number>(LANES).fill(-Infinity);
  let lane = 1;
  let lastMidi: number | null = null;
  for (const c of chosen) {
    let want: number;
    if (c.kind === 'kick') want = lane <= 0 ? 1 : 0;
    else if (c.kind === 'snare') want = lane >= LANES - 1 ? LANES - 2 : LANES - 1;
    else {
      const step = lastMidi === null ? 0 : Math.sign(c.midi - lastMidi) * (Math.abs(c.midi - lastMidi) > 4 ? 2 : 1);
      want = lastMidi === null ? 1 : Math.max(0, Math.min(LANES - 1, lane + step));
      lastMidi = c.midi;
    }
    const free = (l: number) => c.time - lastIn[l] >= rule.sameLane;
    if (!free(want)) {
      const near = [...Array(LANES).keys()].filter(free).sort((a, b) => Math.abs(a - want) - Math.abs(b - want));
      if (!near.length) continue;
      want = near[0];
    }
    lane = want;
    const note: ChartNote = { time: c.time, lane };
    if (rule.hold !== null && c.kind === 'melody' && c.end - c.time >= rule.hold) note.end = c.end;
    notes.push(note);
    lastIn[lane] = note.end ?? c.time;
  }

  // A hold ends before the next note in any lane comes (two hands can't hold and tap far apart);
  // too short then, it's a tap
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.end === undefined) continue;
    const next = notes[i + 1];
    if (next && n.end > next.time - 0.12) n.end = next.time - 0.12;
    if (n.end - n.time < (rule.hold ?? 0)) delete n.end;
  }

  // Hard: a second note with the strongest beats (the bar's downbeats), in the lane across
  if (rule.pairs) {
    const extra: ChartNote[] = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.end !== undefined || data.bars.every((b) => Math.abs(b - n.time) > 0.03)) continue;
      const other = (n.lane + 2) % LANES;
      const prev = notes[i - 1];
      const next = notes[i + 1];
      if ((prev && n.time - prev.time < rule.sameLane) || (next && next.time - n.time < rule.sameLane)) continue;
      extra.push({ time: n.time, lane: other });
    }
    notes.push(...extra);
    notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
  }
  return notes;
}
