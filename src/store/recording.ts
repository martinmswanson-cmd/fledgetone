import { tempoAt, type Tempo } from '../audio/tempoMap';
import type { Clip, ClipExpression, NoteEvent } from './timelineTypes';
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
  /**
   * Each loop pass is a take of its own (kept in one take folder, the last pass playing) rather
   * than all of them playing together, and a take recorded over a clip of the same span joins it
   * as another take.
   */
  takes: boolean;
}

export const DEFAULT_RECORD_OPTIONS: RecordOptions = { countIn: true, quantize: 'off', metronome: false, metronomeVolume: 0.6, takes: false };

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
    takes: typeof r.takes === 'boolean' ? r.takes : d.takes,
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
  /** The pitch bend and mod wheel as played */
  expression?: ClipExpression;
  /** Recorded as takes (one per loop pass that played something), in the order played; the clip's notes are the last one's. */
  takes?: Array<{ notes: Omit<NoteEvent, 'id'>[]; expression?: ClipExpression }>;
}

/** How a take is finished: split into a take per loop pass, and/or cut to a punch range. */
export interface FinishOptions {
  passes?: boolean;
  /** Only what was played from `inBar` to `outBar` is kept, and the clip is exactly that span. */
  punch?: { inBar: number; outBar: number } | null;
}

/** A note played into the take, in song bars (1-based) and audio seconds (for its length). */
interface TakeNote {
  /** The note as the clip plays it (a drum pad's row). */
  note: string;
  velocity: number;
  bar: number;
  start: number;
  end: number;
  /** The loop pass it was played in (0 for the first) */
  pass: number;
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
  /** The pitch bend (semitones) or mod wheel (0 to 1) moved to `value` at `bar`: it goes in the clip's expression lanes. */
  control: (lane: 'bend' | 'mod', value: number, bar: number) => void;
  /** The loop came round: the take covered these bars too, so its clip spans them, and a new pass begins. */
  cover: (fromBar: number, toBar: number) => void;
  /** Notes recorded so far, the held ones included. */
  count: () => number;
  /**
   * End the take at `bar` (where the Transport stopped) and `seconds`: notes still held end
   * there. The clip runs from the first whole bar the take started or played in to the bar line
   * nearest where it stopped, or to the end of the last note, whichever is later. Null if
   * nothing was played.
   */
  finish: (bar: number, seconds: number, tempo: Tempo, options?: FinishOptions) => TakeClip | null;
}

export function createTake(startBar: number): Take {
  const notes: TakeNote[] = [];
  const held = new Map<number, TakeNote>();
  /** Let go while the pedal was down: they end when it comes up. */
  const sustained = new Map<number, TakeNote>();
  let pedal = false;
  const controls: Record<'bend' | 'mod', Array<{ bar: number; value: number; pass: number }>> = { bend: [], mod: [] };
  let pass = 0;
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
      held.set(key, { note, velocity, bar, start: seconds, end: seconds, pass });
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
    control: (lane, value, bar) => {
      const list = controls[lane];
      // Wheels send a stream: keep a point only where the value has moved on
      const last = list[list.length - 1];
      if (last && last.pass === pass && Math.abs(last.value - value) < (lane === 'bend' ? 0.02 : 0.01) && bar - last.bar < 1 / 16) return;
      list.push({ bar, value, pass });
    },
    cover: (fromBar, toBar) => {
      low = Math.min(low, fromBar);
      high = Math.max(high, toBar);
      pass++;
    },
    count: () => notes.length + held.size + sustained.size,
    finish: (bar, seconds, tempo, options = {}) => {
      for (const n of held.values()) close(n, seconds);
      held.clear();
      for (const n of sustained.values()) close(n, seconds);
      sustained.clear();
      const punch = options.punch && options.punch.outBar > options.punch.inBar + EPS ? options.punch : null;
      // Punching, only what starts inside the range is kept
      const kept = punch ? notes.filter((n) => n.bar >= punch.inBar - EPS && n.bar < punch.outBar - EPS) : notes;
      if (kept.length === 0) return null;
      // Held this many seconds, at the tempo where the note started (and, punching, no further than the punch out)
      const lengthOf = (n: TakeNote) => {
        const played = ((n.end - n.start) * tempoAt(n.bar, tempo)) / 240;
        return Math.max(MIN_NOTE_BARS, punch ? Math.min(played, punch.outBar - n.bar) : played);
      };
      let clipStart: number;
      let clipEnd: number;
      if (punch) {
        clipStart = punch.inBar;
        clipEnd = punch.outBar;
      } else {
        // Stopped just past a bar line, the take ends on that line rather than a bar later
        high = Math.max(high, Math.round(bar), ...kept.map((n) => n.bar + lengthOf(n)));
        clipStart = Math.max(1, Math.min(TOTAL_BARS, Math.floor(low + EPS)));
        clipEnd = Math.max(clipStart + 1, Math.min(TOTAL_BARS + 1, Math.ceil(high - EPS)));
      }
      const notesOf = (list: TakeNote[]) =>
        list
          .slice()
          .sort((a, b) => a.bar - b.bar || a.start - b.start)
          .map((n) => ({
            note: n.note,
            startOffset: Math.max(0, n.bar - clipStart),
            duration: barsToDuration(lengthOf(n)),
            velocity: Math.max(0.01, Math.min(1, n.velocity)),
          }));
      // The wheels as played (of one pass, or all of them)
      const expressionOf = (only?: number): { expression?: ClipExpression } => {
        const expression: ClipExpression = {};
        for (const lane of ['bend', 'mod'] as const) {
          const inClip = controls[lane].filter((c) => c.bar >= clipStart && c.bar <= clipEnd);
          // All passes in one clip: a lane can only follow one of them, the last that moved it
          const pass = only ?? Math.max(-1, ...inClip.map((c) => c.pass));
          const list = inClip.filter((c) => c.pass === pass).sort((a, b) => a.bar - b.bar);
          if (!list.some((c) => c.value !== 0)) continue;
          expression[lane] = list.map((c) => ({ at: c.bar - clipStart, value: Math.round(c.value * 1000) / 1000 }));
        }
        return Object.keys(expression).length ? { expression } : {};
      };
      const base = { startBar: clipStart, lengthBars: clipEnd - clipStart };
      if (options.passes) {
        const passes = [...new Set(kept.map((n) => n.pass))].sort((a, b) => a - b);
        if (passes.length > 1) {
          const takes = passes.map((p) => ({ notes: notesOf(kept.filter((n) => n.pass === p)), ...expressionOf(p) }));
          const last = takes[takes.length - 1];
          return { ...base, notes: last.notes, ...(last.expression ? { expression: last.expression } : {}), takes };
        }
      }
      return { ...base, notes: notesOf(kept), ...expressionOf() };
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
