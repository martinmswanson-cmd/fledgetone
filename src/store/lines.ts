/**
 * Lines video: each instrument's path, as the export draws it (audio/linesDraw.ts). From the notes
 * the Showcase video collects (showcase.ts), every pitched track becomes runs of line: a run lasts
 * while the track plays with no silence longer than an allowance, so ordinary rests don't break it,
 * and its path says which pitch the line heads for and when. A chord follows its top note; a fast
 * passage (an arpeggio, a trill) follows its average, so its line is a calm curve and not a zig-zag.
 * Drum hits, and instruments with no pitch to follow, are the hits of the drum row. Plain data and
 * no app state, so Node can unit-test it.
 */
import type { ShowcaseData, ShowcaseNote } from './showcase';

/** A track silent for longer than this ends its line (seconds); a shorter rest runs on flat */
export const LINE_ALLOWANCE = 1.5;
/** How long a line takes to bend to a new pitch (seconds) */
export const LINE_BEND = 0.16;
/** How long a new line takes to rise from under the picture to its first note (seconds) */
export const LINE_ENTRY = 1.1;

/** Notes starting within this of each other are one chord (a strum, a flam) */
const TOGETHER = 0.03;
/** Lead notes starting closer than this, FAST_COUNT or more in a row, are a fast passage */
const FAST = 0.22;
const FAST_COUNT = 4;
/** A fast passage's line heads for its average pitch over each stretch of this long */
const CALM = 0.45;

export interface LinePoint {
  /** From this time the line heads for `pitch` (a MIDI note, with fractions for an average) */
  t: number;
  pitch: number;
  /** How long it takes to get there */
  bend: number;
  /** Where the line is at `t` */
  from: number;
}

export interface LineRun {
  /** The first note's start and the last note's end (seconds from the start of the video) */
  start: number;
  end: number;
  /** Sorted by time; the first is at `start` */
  path: LinePoint[];
  /** When notes start (a chord once), for the rings */
  starts: number[];
  /** When the track is sounding, merged and sorted */
  sounding: Array<[number, number]>;
}

export interface LineTrack {
  name: string;
  runs: LineRun[];
}

export interface LinesData {
  /** The tracks with pitched notes, in timeline order */
  tracks: LineTrack[];
  /** Drum hits and the notes of instruments with no pitch to follow, sorted by time */
  hits: Array<{ t: number; kick: boolean }>;
  /** The pitched notes' lowest and highest MIDI note */
  low: number;
  high: number;
  /** Where each bar line falls (seconds) */
  bars: number[];
}

/** 0 to 1, slow at both ends */
export const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** The lead of a run's notes (sorted by start): the highest note sounding, never dropping to a lower voice held under it */
function leadOf(notes: readonly ShowcaseNote[]): { lead: Array<{ t: number; pitch: number }>; starts: number[] } {
  const lead: Array<{ t: number; pitch: number }> = [];
  const starts: number[] = [];
  let top: ShowcaseNote | null = null;
  for (let i = 0; i < notes.length; ) {
    const at = notes[i].start;
    let best = notes[i];
    let j = i + 1;
    for (; j < notes.length && notes[j].start - at < TOGETHER; j++) if (notes[j].midi > best.midi) best = notes[j];
    i = j;
    starts.push(at);
    // A lower note under a top note still held: the line stays on the top note
    if (top && top.end > at + 1e-6 && top.midi > best.midi) continue;
    if (!lead.length || lead[lead.length - 1].pitch !== best.midi) lead.push({ t: at, pitch: best.midi });
    top = best;
  }
  return { lead, starts };
}

/** The lead with its fast passages replaced by their average over each CALM seconds */
function calmed(lead: ReadonlyArray<{ t: number; pitch: number }>): Array<{ t: number; pitch: number; bend: number }> {
  const out: Array<{ t: number; pitch: number; bend: number }> = [];
  for (let i = 0; i < lead.length; ) {
    let j = i;
    while (j + 1 < lead.length && lead[j + 1].t - lead[j].t < FAST) j++;
    if (j - i + 1 < FAST_COUNT) {
      for (let k = i; k <= j; k++) out.push({ ...lead[k], bend: LINE_BEND });
      i = j + 1;
      continue;
    }
    // Notes i..j-1 become averages; the last one (held longer) keeps its own point
    const from = lead[i].t;
    const to = lead[j].t;
    const count = Math.max(1, Math.round((to - from) / CALM));
    const step = (to - from) / count;
    for (let b = 0; b < count; b++) {
      const b0 = from + b * step;
      const b1 = b0 + step;
      let sum = 0;
      for (let k = i; k < j; k++) {
        const overlap = Math.min(b1, lead[k + 1].t) - Math.max(b0, lead[k].t);
        if (overlap > 0) sum += overlap * lead[k].pitch;
      }
      out.push({ t: b0, pitch: sum / step, bend: b === 0 ? LINE_BEND : step });
    }
    out.push({ ...lead[j], bend: LINE_BEND });
    i = j + 1;
  }
  return out;
}

function runOf(notes: readonly ShowcaseNote[]): LineRun {
  const { lead, starts } = leadOf(notes);
  const path: LinePoint[] = [];
  for (const p of calmed(lead)) {
    const prev = path[path.length - 1];
    const from = prev ? prev.from + (prev.pitch - prev.from) * ease((p.t - prev.t) / prev.bend) : p.pitch;
    path.push({ ...p, from });
  }
  const sounding: Array<[number, number]> = [];
  let end = notes[0].end;
  for (const n of notes) {
    const last = sounding[sounding.length - 1];
    if (last && n.start <= last[1] + 1e-6) last[1] = Math.max(last[1], n.end);
    else sounding.push([n.start, n.end]);
    end = Math.max(end, n.end);
  }
  return { start: notes[0].start, end, path, starts, sounding };
}

/** The lines and hits of a Showcase's notes */
export function linesData(d: ShowcaseData): LinesData {
  const byTrack = new Map<number, ShowcaseNote[]>();
  const hits: LinesData['hits'] = [];
  let low = Infinity;
  let high = -Infinity;
  // (d.notes is sorted by start, then pitch)
  for (const n of d.notes) {
    if (n.drum || n.perc) {
      hits.push({ t: n.start, kick: !!n.kick });
      continue;
    }
    if (!byTrack.has(n.track)) byTrack.set(n.track, []);
    byTrack.get(n.track)!.push(n);
    if (n.midi < low) low = n.midi;
    if (n.midi > high) high = n.midi;
  }
  const tracks: LineTrack[] = [];
  for (const index of [...byTrack.keys()].sort((a, b) => a - b)) {
    const notes = byTrack.get(index)!;
    const runs: LineRun[] = [];
    let from = 0;
    let end = notes[0].end;
    for (let i = 1; i <= notes.length; i++) {
      if (i === notes.length || notes[i].start - end > LINE_ALLOWANCE) {
        runs.push(runOf(notes.slice(from, i)));
        from = i;
        if (i < notes.length) end = notes[i].end;
      } else end = Math.max(end, notes[i].end);
    }
    tracks.push({ name: d.tracks[index]?.name ?? '', runs });
  }
  return { tracks, hits, low: Number.isFinite(low) ? low : 60, high: Number.isFinite(high) ? high : 72, bars: d.bars };
}

/** The pitch a run's line shows at `t` (before its start: its first pitch) */
export function runPitch(run: LineRun, t: number): number {
  const path = run.path;
  let lo = 0;
  let hi = path.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (path[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const p = path[lo];
  return p.from + (p.pitch - p.from) * ease((t - p.t) / p.bend);
}

/** Whether a note of the run sounds at `t` */
export function isSounding(run: LineRun, t: number): boolean {
  for (const [s, e] of run.sounding) {
    if (s > t) return false;
    if (e > t) return true;
  }
  return false;
}
