import { tempoAt, type Tempo } from '../audio/tempoMap';
import type { Clip, NoteEvent } from './timelineTypes';
import { barsToDuration, durationToBars, TOTAL_BARS } from './timelineTypes';

/**
 * Recording MIDI takes: the settings, how a take gathers the notes it hears into a clip, and
 * quantize. Pure, so the unit tests cover it; the live side (audio times, the Transport) is in
 * src/audio/recorder.ts.
 */

/** Where recorded notes snap to on stop (song grid). "T" is a triplet: three in the space of two. */
export const QUANTIZE_GRIDS = ['off', '1/16', '1/8', '1/16T'] as const;
export type QuantizeGrid = (typeof QUANTIZE_GRIDS)[number];

/** Transport ticks (192 per quarter) in one step of each grid. */
export const QUANTIZE_TICKS: Record<Exclude<QuantizeGrid, 'off'>, number> = { '1/16': 48, '1/8': 96, '1/16T': 32 };

const TICKS_PER_BAR = 768;

/** Recording settings, kept per browser (they aren't part of a project). */
export interface RecordOptions {
  /** One bar of clicks before the take starts. */
  countIn: boolean;
  quantize: QuantizeGrid;
  /** The metronome clicks while playing (and recording). The count-in always clicks. */
  metronome: boolean;
  /** 0 to 1 */
  metronomeVolume: number;
}

export const DEFAULT_RECORD_OPTIONS: RecordOptions = { countIn: true, quantize: 'off', metronome: false, metronomeVolume: 0.6 };

const RECORD_OPTIONS_KEY = 'bos-beat-box.record';

/** Fill in missing or out-of-range settings (an older browser copy, a hand-edited one). */
export function normalizeRecordOptions(raw: unknown): RecordOptions {
  const d = DEFAULT_RECORD_OPTIONS;
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const volume = r.metronomeVolume;
  return {
    countIn: typeof r.countIn === 'boolean' ? r.countIn : d.countIn,
    quantize: QUANTIZE_GRIDS.includes(r.quantize as QuantizeGrid) ? (r.quantize as QuantizeGrid) : d.quantize,
    metronome: typeof r.metronome === 'boolean' ? r.metronome : d.metronome,
    metronomeVolume: typeof volume === 'number' && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : d.metronomeVolume,
  };
}

/** The settings last used in this browser (the defaults if none, or if storage is blocked). */
export function readRecordOptions(): RecordOptions {
  try {
    const json = localStorage.getItem(RECORD_OPTIONS_KEY);
    return normalizeRecordOptions(json ? JSON.parse(json) : null);
  } catch {
    return DEFAULT_RECORD_OPTIONS;
  }
}

export function writeRecordOptions(options: RecordOptions): void {
  try {
    localStorage.setItem(RECORD_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // Storage blocked or full: the settings last for this page
  }
}

/** The notes of a finished take, placed as a clip on the timeline. */
export interface TakeClip {
  startBar: number;
  lengthBars: number;
  notes: Omit<NoteEvent, 'id'>[];
}

/** A note played into the take, in song bars (1-based) and audio seconds (for its length). */
interface TakeNote {
  /** The note as the clip plays it (a drum pad's row). */
  note: string;
  velocity: number;
  bar: number;
  start: number;
  end: number;
}

/** The shortest note a take keeps: a 32nd, the finest grid the piano roll shows. */
const MIN_NOTE_BARS = 1 / 32;
const EPS = 1e-6;

/**
 * One take in progress. Notes arrive as they're heard, keyed by the number the keyboard sent
 * (its note-off carries the same number) and named as the track plays them, with the song
 * position of each start (bars, from the Transport) and the audio time of each start and end (so
 * a note's length is right even when the loop comes round in the middle of it). A note-off while
 * the sustain pedal is down waits for the pedal, as the ear hears it. Striking a key that's still
 * held (or still sustained) ends the earlier note first.
 */
export interface Take {
  /** The bar the take started at (the Transport's position at the record start). */
  readonly startBar: number;
  noteOn: (key: number, note: string, velocity: number, bar: number, seconds: number) => void;
  noteOff: (key: number, seconds: number) => void;
  sustain: (down: boolean, seconds: number) => void;
  /** The take covered these bars too (a loop pass came round), so its clip spans them. */
  cover: (fromBar: number, toBar: number) => void;
  /** Notes recorded so far, the held ones included. */
  count: () => number;
  /**
   * End the take at `bar` (where the Transport stopped) and `seconds`: notes still held end
   * there. The clip runs from the first whole bar the take started or played in to the bar line
   * nearest where it stopped, or to the end of the last note, whichever is later. Null if
   * nothing was played.
   */
  finish: (bar: number, seconds: number, tempo: Tempo) => TakeClip | null;
}

export function createTake(startBar: number): Take {
  const notes: TakeNote[] = [];
  const held = new Map<number, TakeNote>();
  /** Let go while the pedal was down: they end when it comes up. */
  const sustained = new Map<number, TakeNote>();
  let pedal = false;
  let low = startBar;
  let high = startBar;

  const close = (n: TakeNote, seconds: number) => {
    n.end = Math.max(n.start, seconds);
    notes.push(n);
  };
  const endEarlier = (key: number, seconds: number) => {
    const h = held.get(key);
    if (h) {
      held.delete(key);
      close(h, seconds);
    }
    const s = sustained.get(key);
    if (s) {
      sustained.delete(key);
      close(s, seconds);
    }
  };

  return {
    startBar,
    noteOn: (key, note, velocity, bar, seconds) => {
      endEarlier(key, seconds);
      held.set(key, { note, velocity, bar, start: seconds, end: seconds });
      low = Math.min(low, bar);
      high = Math.max(high, bar);
    },
    noteOff: (key, seconds) => {
      const h = held.get(key);
      if (!h) return;
      held.delete(key);
      if (pedal) sustained.set(key, h);
      else close(h, seconds);
    },
    sustain: (down, seconds) => {
      pedal = down;
      if (down) return;
      for (const n of sustained.values()) close(n, seconds);
      sustained.clear();
    },
    cover: (fromBar, toBar) => {
      low = Math.min(low, fromBar);
      high = Math.max(high, toBar);
    },
    count: () => notes.length + held.size + sustained.size,
    finish: (bar, seconds, tempo) => {
      for (const n of held.values()) close(n, seconds);
      held.clear();
      for (const n of sustained.values()) close(n, seconds);
      sustained.clear();
      if (notes.length === 0) return null;
      // Held this many seconds, at the tempo where the note started
      const lengthOf = (n: TakeNote) => Math.max(MIN_NOTE_BARS, ((n.end - n.start) * tempoAt(n.bar, tempo)) / 240);
      // Stopped just past a bar line, the take ends on that line rather than a bar later
      high = Math.max(high, Math.round(bar), ...notes.map((n) => n.bar + lengthOf(n)));
      const clipStart = Math.max(1, Math.min(TOTAL_BARS, Math.floor(low + EPS)));
      const clipEnd = Math.max(clipStart + 1, Math.min(TOTAL_BARS + 1, Math.ceil(high - EPS)));
      return {
        startBar: clipStart,
        lengthBars: clipEnd - clipStart,
        notes: notes
          .slice()
          .sort((a, b) => a.bar - b.bar || a.start - b.start)
          .map((n) => ({
            note: n.note,
            startOffset: Math.max(0, n.bar - clipStart),
            duration: barsToDuration(lengthOf(n)),
            velocity: Math.max(0.01, Math.min(1, n.velocity)),
          })),
      };
    },
  };
}

/**
 * Snap a take's notes to `grid` on the song's grid (the clip starts on a whole bar, so the clip's
 * grid is the song's). Lengths stay as played. Two notes of the same pitch landing on one line
 * become one (the louder, then the longer: a double strike would play as a flam). A note snapped
 * onto the clip's end would be hidden there (a clip plays the notes inside it), so the clip grows
 * a bar to keep it.
 */
export function quantizeTakeClip(clip: Clip, grid: QuantizeGrid): Clip {
  if (grid === 'off') return clip;
  const step = QUANTIZE_TICKS[grid];
  const clipTicks = Math.round((clip.startBar - 1) * TICKS_PER_BAR);
  const snapped = new Map<string, { note: NoteEvent; tick: number }>();
  for (const note of clip.notes) {
    const tick = Math.round((clipTicks + note.startOffset * TICKS_PER_BAR) / step) * step;
    const key = `${note.note}|${tick}`;
    const other = snapped.get(key);
    if (!other || louder(note, other.note)) snapped.set(key, { note, tick });
  }
  const notes = [...snapped.values()]
    .sort((a, b) => a.tick - b.tick)
    .map(({ note, tick }) => ({ ...note, startOffset: (tick - clipTicks) / TICKS_PER_BAR }));
  const last = notes.length ? notes[notes.length - 1].startOffset : 0;
  // The shortest whole number of bars that holds the last note
  const lengthBars = last >= clip.lengthBars - EPS ? Math.min(TOTAL_BARS + 1 - clip.startBar, Math.floor(last + EPS) + 1) : clip.lengthBars;
  return { ...clip, notes, lengthBars: Math.max(clip.lengthBars, lengthBars) };
}

/** Which of two notes to keep when they land on the same line: the louder, then the longer. */
function louder(a: NoteEvent, b: NoteEvent): boolean {
  if (a.velocity !== b.velocity) return a.velocity > b.velocity;
  return durationToBars(a.duration) > durationToBars(b.duration);
}
