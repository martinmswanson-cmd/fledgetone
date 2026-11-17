/**
 * Lines video: the chord sounding at each moment, worked out from the notes the video shows
 * (showcase.ts), for the big chord name the picture can draw (audio/linesDraw.ts). Careful rather
 * than clever: a name is given only where the pitched notes of half a measure make a chord with a
 * third in it, and only as a plain triad or seventh; anywhere else there is no name, which the
 * picture shows as nothing. Plain data, so Node can unit-test it.
 */
import type { ShowcaseData } from './showcase';
import { chordNameIn, chordRoot } from './smartTools';
import type { SongKey } from './songKey';

export interface ChordSpan {
  /** Seconds from the start of the video */
  at: number;
  end: number;
  name: string;
}

/** A pitch class counts in a window when its notes sound for this much of it */
const COUNTS_FROM = 0.25;

const pc = (m: number) => ((m % 12) + 12) % 12;

/** The name of the notes sounding in [from, to), or null where they don't make a clear chord */
function nameIn(d: ShowcaseData, first: number, from: number, to: number, key: Pick<SongKey, 'root' | 'mode'> | null): string | null {
  const length = to - from;
  const time = new Array<number>(12).fill(0);
  const lowest = new Array<number>(12).fill(Infinity);
  for (let i = first; i < d.notes.length; i++) {
    const n = d.notes[i];
    if (n.start >= to) break;
    if (n.drum || n.perc) continue;
    const overlap = Math.min(n.end, to) - Math.max(n.start, from);
    if (overlap <= 0) continue;
    const p = pc(n.midi);
    time[p] += overlap;
    if (n.midi < lowest[p]) lowest[p] = n.midi;
  }
  const midis: number[] = [];
  for (let p = 0; p < 12; p++) if (time[p] >= length * COUNTS_FROM - 1e-9) midis.push(lowest[p]);
  if (midis.length < 3) return null;
  const root = chordRoot(midis);
  const has = new Set(midis.map((m) => pc(m - root)));
  const major = has.has(4);
  const minor = !major && has.has(3);
  if (!major && !minor) return null;
  // Cut down to the triad, and a seventh where there is one
  const kept = [0, major ? 4 : 3];
  // (an augmented chord is never named as one: a major third under a raised fifth is far more
  // often a melody note over a plain chord, so it's named as the plain chord)
  if (minor && has.has(6) && !has.has(7)) kept.push(6);
  else {
    if (has.has(7)) kept.push(7);
    if (has.has(10)) kept.push(10);
    else if (major && has.has(11)) kept.push(11);
  }
  return chordNameIn(key, kept.map((iv) => pc(root + iv)));
}

/**
 * The chords of a video's notes: a name per half measure (a whole measure where it has an odd
 * number of beats), neighbours with the same name joined, nothing where the notes aren't clear.
 * `key` only decides how roots are spelled (flats or sharps).
 */
export function lineChords(d: ShowcaseData, key: Pick<SongKey, 'root' | 'mode'> | null): ChordSpan[] {
  const out: ChordSpan[] = [];
  // Notes are sorted by start: the earliest note that could still sound in a window
  let first = 0;
  let longest = 0;
  for (const n of d.notes) longest = Math.max(longest, n.end - n.start);
  for (let b = 0; b + 1 < d.bars.length; b++) {
    const from = d.bars[b];
    const to = d.bars[b + 1];
    if (!(to > from)) continue;
    const halves = (d.beats?.[b] ?? 4) % 2 === 0 ? 2 : 1;
    for (let h = 0; h < halves; h++) {
      const at = from + ((to - from) * h) / halves;
      const end = from + ((to - from) * (h + 1)) / halves;
      while (first < d.notes.length && d.notes[first].start < at - longest - 1e-6) first++;
      const name = nameIn(d, first, at, end, key);
      if (!name) continue;
      const last = out[out.length - 1];
      if (last && last.name === name && Math.abs(last.end - at) < 1e-6) last.end = end;
      else out.push({ at, end, name });
    }
  }
  return out;
}
