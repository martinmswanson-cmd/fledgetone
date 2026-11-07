import { isPlainMeter, measureAt, roundToMeasure, secondsBetween, tempoAt, type MeterMap, type Tempo } from '../audio/tempoMap';
import type { Clip, ClipExpression, NoteEvent, NoteExpression } from './timelineTypes';
import { tidyNoteLane } from './noteExpression';
import { barsToDuration, durationToBars, TOTAL_BARS } from './timelineTypes';
import { maxOf } from '../support/minMax';

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
  /** The song's time signatures: the clip starts and ends on its measure lines (whole bars in 4/4, or without it). */
  meter?: MeterMap;
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
  /** Its own bend (semitones) and pressure as played on an MPE keyboard, in song bars */
  expr?: Partial<Record<'bend' | 'pressure', Array<{ bar: number; value: number }>>>;
}

/** The shortest note a take keeps: a 32nd, the finest grid the piano roll shows. */
const MIN_NOTE_BARS = 1 / 32;

/** A usable tempo (a garbled one counts as 120 BPM). */
const tempoOr120 = (bpm: number) => (Number.isFinite(bpm) && bpm > 0 ? bpm : 120);

/**
 * Seconds of the shortest note a take keeps, at `bpm`. A key let go sooner still sounds this long
 * live (liveInput.ts), so what's heard is what the take, and the export, plays.
 */
export const shortestNoteSeconds = (bpm: number): number => (MIN_NOTE_BARS * 240) / tempoOr120(bpm);

/**
 * How early (seconds) a note can be played before a take starts and still be its first note, put
 * at the start: a 32nd at `bpm`, at most 40 ms. A note aimed at the first downbeat after the
 * count-in (or at a punch-in) is often a few ms early; one played sooner than this is in the
 * count-in (50 ms early is a 40th of a bar at 120 BPM: a note of its own), and isn't kept.
 */
export const earlyNoteSeconds = (bpm: number): number => Math.min(0.04, shortestNoteSeconds(bpm));

/**
 * Where a note heard at `heard` starts in a take that starts at `startAudio` (audio seconds, the
 * tempo there `bpm`): as heard, or at the start for one a moment early (see earlyNoteSeconds).
 * Null for one played in the count-in, which isn't kept.
 */
export function noteStartInTake(heard: number, startAudio: number, bpm: number): number | null {
  if (heard >= startAudio) return heard;
  return startAudio - heard <= earlyNoteSeconds(bpm) ? startAudio : null;
}
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
  /** The pitch bend (semitones), mod wheel or another controller (0 to 1) moved to `value` at `bar` (heard at `seconds`): it goes in the clip's expression lanes. */
  control: (lane: 'bend' | 'mod' | `cc${number}`, value: number, bar: number, seconds?: number) => void;
  /** A held note's own bend (semitones) or pressure (0 to 1) moved, at `bar` (an MPE keyboard's per-note expression). */
  noteControl: (key: number, lane: 'bend' | 'pressure', value: number, bar: number) => void;
  /**
   * The loop comes round at audio time `at`: the take covers these bars too, so its clip spans
   * them, and what's played from then on is the next pass. (The Transport says so a little ahead
   * of the wrap, so what's still played before `at` stays in this pass. Without `at`: from now.)
   */
  cover: (fromBar: number, toBar: number, at?: number) => void;
  /** Notes recorded so far, the held ones included. */
  count: () => number;
  /**
   * End the take at `bar` (where the Transport stopped) and `seconds`: notes still held end
   * there. The clip runs from the first whole bar (measure, with `options.meter`) the take started or played in to the bar line
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
  const controls: Record<string, Array<{ bar: number; value: number; pass: number }>> = { bend: [], mod: [] };
  /** When each loop wrap is heard (audio seconds) */
  const wraps: number[] = [];
  const passAt = (seconds: number | undefined) => (seconds === undefined ? wraps.length : wraps.filter((w) => w <= seconds + 1e-6).length);
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
      held.set(key, { note, velocity, bar, start: seconds, end: seconds, pass: passAt(seconds) });
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
    control: (lane, value, bar, seconds) => {
      const list = (controls[lane] ??= []);
      const pass = passAt(seconds);
      // Wheels send a stream: keep a point only where the value has moved on
      const last = list[list.length - 1];
      if (last && last.pass === pass && Math.abs(last.value - value) < (lane === 'bend' ? 0.02 : 0.01) && bar - last.bar < 1 / 16) return;
      list.push({ bar, value, pass });
    },
    noteControl: (key, lane, value, bar) => {
      const n = held.get(key) ?? sustained.get(key);
      if (!n) return;
      const list = ((n.expr ??= {})[lane] ??= []);
      const last = list[list.length - 1];
      if (last && Math.abs(last.value - value) < (lane === 'bend' ? 0.02 : 0.01) && bar - last.bar < 1 / 32) return;
      list.push({ bar, value });
    },
    cover: (fromBar, toBar, at) => {
      low = Math.min(low, fromBar);
      high = Math.max(high, toBar);
      wraps.push(at ?? -Infinity);
    },
    count: () => notes.length + held.size + sustained.size,
    finish: (bar, seconds, tempo, options = {}) => {
      for (const n of held.values()) close(n, seconds);
      held.clear();
      for (const n of sustained.values()) close(n, seconds);
      sustained.clear();
      const punch = options.punch && options.punch.outBar > options.punch.inBar + EPS ? options.punch : null;
      // Punching, only what starts inside the range is kept, and what starts a moment before the
      // punch in (see earlyNoteSeconds), moved to it: it still ends where it was let go. The window
      // is a 32nd at the tempo at the punch in, measured in seconds: the bars before it pass at
      // whatever tempo plays there
      const early = punch ? earlyNoteSeconds(tempoAt(punch.inBar, tempo)) : 0;
      const kept = punch
        ? notes
            .filter((n) => n.bar < punch.outBar - EPS && (n.bar >= punch.inBar || secondsBetween(n.bar, punch.inBar, tempo) <= early + EPS))
            .map((n) => (n.bar >= punch.inBar ? n : { ...n, bar: punch.inBar, start: n.start + secondsBetween(n.bar, punch.inBar, tempo) }))
        : notes;
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
        const meter = options.meter && !isPlainMeter(options.meter) ? options.meter : null;
        // Stopped just past a bar line, the take ends on that line rather than a bar later
        high = maxOf(high, meter ? roundToMeasure(bar, meter) : Math.round(bar), kept.map((n) => n.bar + lengthOf(n)));
        if (meter) {
          // From the start of the measure it began or played in to the end of the one it reached (at least one measure)
          const first = measureAt(Math.max(1, low), meter);
          const end = measureAt(high, meter);
          clipStart = Math.min(TOTAL_BARS, first.start);
          // (a measure running past the timeline's end stops there, as Save + reopen keeps it)
          clipEnd = Math.min(TOTAL_BARS + 1, Math.max(first.start + first.length, high - end.start > EPS ? end.start + end.length : end.start));
        } else {
          clipStart = Math.max(1, Math.min(TOTAL_BARS, Math.floor(low + EPS)));
          clipEnd = Math.max(clipStart + 1, Math.min(TOTAL_BARS + 1, Math.ceil(high - EPS)));
        }
      }
      const notesOf = (list: TakeNote[]) =>
        list
          .slice()
          .sort((a, b) => a.bar - b.bar || a.start - b.start)
          .map((n) => {
            const expr: NoteExpression = {};
            for (const lane of ['bend', 'pressure'] as const) {
              const pts = (n.expr?.[lane] ?? []).filter((p) => p.bar >= n.bar - EPS && p.bar <= n.bar + lengthOf(n) + EPS);
              if (pts.length) expr[lane] = tidyNoteLane(pts.map((p) => ({ at: p.bar - n.bar, value: Math.round(p.value * 1000) / 1000 })), lane, lengthOf(n));
            }
            return {
              note: n.note,
              startOffset: Math.max(0, n.bar - clipStart),
              duration: barsToDuration(lengthOf(n)),
              velocity: Math.max(0.01, Math.min(1, n.velocity)),
              ...(Object.keys(expr).length ? { expr } : {}),
            };
          });
      // The wheels as played (of one pass, or all of them)
      const expressionOf = (only?: number): { expression?: ClipExpression } => {
        const expression: ClipExpression = {};
        for (const lane of Object.keys(controls) as Array<keyof ClipExpression>) {
          const inClip = controls[lane].filter((c) => c.bar >= clipStart && c.bar <= clipEnd);
          // All passes in one clip: a lane can only follow one of them, the last that moved it
          const pass = only ?? maxOf(-1, inClip.map((c) => c.pass));
          const list = inClip.filter((c) => c.pass === pass).sort((a, b) => a.bar - b.bar);
          // (A wheel left at rest throughout adds nothing; a knob's lane is kept wherever it was)
          if (lane === 'bend' || lane === 'mod' ? !list.some((c) => c.value !== 0) : !list.length) continue;
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
 * Snap a take's notes to `grid` on the song's grid (measured from bar 1, so a clip that starts off
 * a line, like a punch-in, snaps the same lines). A note never moves before the clip's start: it
 * goes to the first line at or after it. Lengths stay as played. Two notes of the same pitch landing
 * on one line become one (the louder, then the longer: a double strike would play as a flam). A
 * note snapped onto the clip's end would be hidden there (a clip plays the notes inside it), so a
 * clip on a whole bar grows a bar to keep it; one that can't grow (`grow` false, or starting off a
 * bar line) keeps it on the last line before its end. With the song's `meter` (not 4/4) the bar is
 * a measure: a clip on a measure line grows to the end of the measure the note is in. Either way
 * it stops at the timeline's end.
 */
export function quantizeTakeClip(clip: Clip, grid: QuantizeGrid, grow = true, meter?: MeterMap): Clip {
  const measured = meter && !isPlainMeter(meter) ? meter : null;
  if (grid === 'off') return clip;
  const step = QUANTIZE_TICKS[grid];
  const clipTicks = (clip.startBar - 1) * TICKS_PER_BAR;
  const endTicks = clipTicks + clip.lengthBars * TICKS_PER_BAR;
  const canGrow = grow && Math.abs(clip.startBar - (measured ? roundToMeasure(clip.startBar, measured) : Math.round(clip.startBar))) < EPS;
  // The lines a note can go to: from the first at or after the start to the last before the end
  const first = Math.ceil(clipTicks / step - EPS) * step;
  const last = Math.ceil(endTicks / step - 1 - EPS) * step;
  const songLast = Math.ceil((TOTAL_BARS * TICKS_PER_BAR) / step - 1 - EPS) * step;
  const snapped = new Map<string, { note: NoteEvent; tick: number }>();
  for (const note of clip.notes) {
    const played = clipTicks + note.startOffset * TICKS_PER_BAR;
    let tick = Math.max(first, Math.round(played / step) * step);
    // (a clip too short to hold a line: the note stays as played)
    if (!canGrow) tick = first > last ? played : Math.min(last, tick);
    // (one that can grow still stops at the song's end: kept on the last line before it)
    else tick = Math.min(tick, Math.max(first, songLast));
    const key = `${note.note}|${tick}`;
    const other = snapped.get(key);
    if (!other || louder(note, other.note)) snapped.set(key, { note, tick });
  }
  const notes = [...snapped.values()]
    .sort((a, b) => a.tick - b.tick)
    .map(({ note, tick }) => ({ ...note, startOffset: Math.max(0, (tick - clipTicks) / TICKS_PER_BAR) }));
  const lastStart = notes.length ? notes[notes.length - 1].startOffset : 0;
  // The shortest whole number of bars (measures) that holds the last note
  const holding = () => {
    if (!measured) return Math.floor(lastStart + EPS) + 1;
    const m = measureAt(clip.startBar + lastStart, measured);
    return m.start + m.length - clip.startBar;
  };
  const lengthBars = canGrow && lastStart >= clip.lengthBars - EPS ? Math.min(TOTAL_BARS + 1 - clip.startBar, holding()) : clip.lengthBars;
  return { ...clip, notes, lengthBars: Math.min(TOTAL_BARS + 1 - clip.startBar, Math.max(clip.lengthBars, lengthBars)) };
}

/** Which of two notes to keep when they land on the same line: the louder, then the longer. */
function louder(a: NoteEvent, b: NoteEvent): boolean {
  if (a.velocity !== b.velocity) return a.velocity > b.velocity;
  return durationToBars(a.duration) > durationToBars(b.duration);
}
