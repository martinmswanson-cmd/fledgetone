/**
 * Pocket's note maths, as plain functions: how many 16th steps a bar has, how many steps a note
 * covers, note names to MIDI numbers and back, and the notes of the song's key over an
 * instrument's range (the rows of the pads and the piano roll); the piano roll's notes in
 * 16ths, and back; and a jump to another section waiting for the next bar line.
 */
import type { NoteEvent } from '../store/timelineTypes';
import { barSpan, barsToDuration, durationToBars, formatBarPosition, TOTAL_BARS } from '../store/timelineTypes';
import { NOTE_NAMES, type SongKey } from '../store/songKey';
import { chordSpans } from '../store/smartTools';
import { beatsBetween, FOUR_FOUR, isPlainMeter, measureAt, toMeasureBeat, type MeterMap } from '../audio/tempoMap';

/**
 * Note offsets and clip lengths are in 4/4 bars (whole notes), so a 16th step is always 1/16 of
 * one, whatever the meter. Convert steps to and from offsets with this; stepsPerBar is only how
 * many steps one measure (one page of the grid) shows.
 */
export const STEPS_PER_WHOLE = 16;

/** Steps in a bar: 16ths (16 in 4/4, 12 in 6/8, 12 in 3/4). */
export const stepsPerBar = (meter: { num: number; den: number }): number => Math.max(1, Math.round((meter.num * 16) / meter.den));

/** Bars a step lasts. */
export const stepBars = (_meter: { num: number; den: number }): number => 1 / STEPS_PER_WHOLE;

/** How many steps a note covers (at least 1), for drawing held notes across the grid. */
export const noteSteps = (n: Pick<NoteEvent, 'duration'>, perBar: number): number => Math.max(1, Math.round(durationToBars(n.duration) * perBar));

/** MIDI number to a note name ("C4"). */
export const midiToNote = (midi: number): string => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** A note name ("C#4", "Db4") to its MIDI number, or null. */
export function noteToMidi(note: string): number | null {
  const m = /^([A-G])([#b]?)(-?\d+)$/.exec(note);
  if (!m) return null;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  const shift = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return base + shift + (Number(m[3]) + 1) * 12;
}

/**
 * The note grid's rows, high to low: the key's scale notes from `low` up through `octaves`
 * octaves (and the top root), within the instrument's range.
 */
export function scaleRows(key: SongKey, range: readonly [number, number], centre: number, octaves = 2): string[] {
  const [lo, hi] = range;
  // Start on the root at or below the centre, an octave down, kept in range
  let start = centre - (((centre - key.root) % 12) + 12) % 12 - 12;
  while (start < lo) start += 12;
  const end = Math.min(hi, start + octaves * 12);
  const inKey = new Set(key.steps.map((s) => (key.root + s) % 12));
  const rows: string[] = [];
  for (let m = end; m >= start; m--) if (inKey.has(((m % 12) + 12) % 12)) rows.push(midiToNote(m));
  return rows;
}

/** A note as the piano roll sees it: its row's pitch, its 16th and its length in 16ths. */
export interface RollNote {
  id: string;
  midi: number;
  step: number;
  len: number;
  velocity: number;
  /** The note as it was (its name is kept when its pitch doesn't change) */
  from?: NoteEvent;
}

const rollOf = (n: NoteEvent): Omit<RollNote, 'id' | 'from'> => ({
  midi: noteToMidi(n.note) ?? 60,
  step: Math.round(n.startOffset * STEPS_PER_WHOLE),
  len: Math.max(1, Math.round(durationToBars(n.duration) * STEPS_PER_WHOLE)),
  velocity: n.velocity,
});

/** Notes as the roll draws them: on the nearest 16th, at least a 16th long. */
export const toRoll = (notes: readonly NoteEvent[]): RollNote[] => notes.map((n) => ({ id: n.id, ...rollOf(n), from: n }));

/**
 * The roll's notes as notes again. One the roll hasn't moved, stretched or re-pitched is kept
 * exactly as it was (off the grid, a triplet, a 32nd), so drawing a note doesn't snap the rest.
 */
export const fromRoll = (notes: readonly RollNote[]): NoteEvent[] =>
  notes.map((r) => {
    const was = r.from && rollOf(r.from);
    if (r.from && was && was.midi === r.midi && was.step === r.step && was.len === r.len && was.velocity === r.velocity) return { ...r.from, id: r.id };
    return {
      ...(r.from ?? {}),
      id: r.id,
      note: r.from && noteToMidi(r.from.note) === r.midi ? r.from.note : midiToNote(r.midi),
      startOffset: r.step / STEPS_PER_WHOLE,
      duration: barsToDuration(r.len / STEPS_PER_WHOLE),
      velocity: r.velocity,
    };
  });

/**
 * A jump to the section `from`–`to` while the song plays at `at` (bars): it lands on the next bar
 * line (`when`), the end of the measure playing in the song's meter `map` (in 3/4 three beats
 * long). Until then the song loops `loop`, the measure playing to the section, so it neither
 * wraps back early nor plays on past the bar line. Null when the song is already in the section.
 */
export interface SectionJump {
  from: number;
  to: number;
  when: number;
  loop: [number, number];
}

const PLAIN: MeterMap = { base: FOUR_FOUR, points: [] };

export function sectionJump(at: number, from: number, to: number, map: MeterMap = PLAIN): SectionJump | null {
  if (at >= from - 1e-6 && at < to - 1e-6) return null;
  const m = measureAt(at + 1e-6, map);
  // (the song's last measure, longer than what's left of the timeline in 3/2, ends with the timeline, as does the loop)
  const end = Math.min(TOTAL_BARS + 1, m.start + m.length);
  return { from, to, when: end, loop: [Math.min(from, m.start), Math.min(TOTAL_BARS + 1, Math.max(to, end))] };
}

/**
 * Where `bar` is in the section starting at `from`, as the header shows it ("1.4"): the measure
 * counted from the section's first, and the beat in the meter there (in 6/8 the eighths).
 */
export function sectionPlace(bar: number, from: number, map: MeterMap = PLAIN): { measure: number; beat: number } {
  if (isPlainMeter(map) || bar < 1) return { measure: Math.max(1, Math.floor(bar - from) + 1), beat: Math.floor((((bar % 1) + 1) % 1) * 4) + 1 };
  const at = toMeasureBeat(bar, map);
  return { measure: Math.max(1, at.measure - measureAt(from + 1e-6, map).measure + 1), beat: at.beat };
}

/**
 * What a waiting jump does with the song at `at`: wait; land (the song is in the section already,
 * by the loop wrapping there: only its loop is set); or seek there (the bar line has come).
 */
export function jumpStep(jump: SectionJump, at: number): 'wait' | 'land' | 'seek' {
  if (at >= jump.from - 1e-6 && at < jump.to - 1e-6) return 'land';
  return at >= jump.when - 0.01 ? 'seek' : 'wait';
}

/**
 * How the chords sheet fills the section `from`–`to`: a chord a bar in a section of 4 bars or more
 * (two in one of 8 or more), else as many as fit, the bars counted as the ruler counts measures.
 * `spans` (from the section's start) places each chord on the song's measures, as the studio's
 * chord clips do (three beats a bar in 3/4); in plain 4/4 there are none, a chord being chordBars,
 * unless the section's length isn't a whole number of chords: the last then stops at its end.
 */
export function sectionChordPlan(from: number, to: number, map: MeterMap = PLAIN): { chordBars: number; count: number; spans?: Array<{ start: number; length: number }> } {
  const plain = isPlainMeter(map);
  const len = plain ? to - from : barSpan(from, to, map);
  const chordBars = len >= 8 ? 2 : len >= 4 ? 1 : len / 4;
  const count = Math.max(1, Math.round(len / chordBars));
  const spans = plain ? Array.from({ length: count }, (_, i) => ({ start: i * chordBars, length: chordBars })) : chordSpans(from, count, chordBars, map).spans;
  // A section of an odd length: the last chord stops at its end rather than ringing into the next
  const end = to - from;
  const cut = spans.filter((s) => s.start < end - 1e-6).map((s) => (s.start + s.length > end + 1e-6 ? { start: s.start, length: end - s.start } : s));
  if (plain && cut.length === spans.length && cut.every((s, i) => s === spans[i])) return { chordBars, count };
  return { chordBars, count: cut.length, spans: cut };
}

/**
 * The piano roll ruler's marks over the section `from`–`to`: a step (16ths from the section's
 * start) and a label for each beat, "1" on a measure's first beat and "1.2" on the others,
 * measures counted from the section's first. In plain 4/4 a mark every 4 steps as always; in other
 * meters on the meter's beats (an eighth in 6/8, so stepsPerBar(meter) / num steps apart).
 */
export function rollRulerMarks(from: number, to: number, map: MeterMap = PLAIN): Array<{ step: number; label: string }> {
  const steps = Math.round((to - from) * STEPS_PER_WHOLE);
  if (isPlainMeter(map)) return Array.from({ length: Math.ceil(steps / 4) }, (_, b) => ({ step: b * 4, label: b % 4 === 0 ? `${b / 4 + 1}` : `${Math.floor(b / 4) + 1}.${(b % 4) + 1}` }));
  const first = measureAt(Math.max(1, from) + 1e-6, map).measure;
  const marks = beatsBetween(from, to, map).map(({ bar }) => {
    const at = toMeasureBeat(bar + 1e-9, map);
    const measure = at.measure - first + 1;
    return { step: Math.round((bar - from) * STEPS_PER_WHOLE), label: at.beat === 1 ? `${measure}` : `${measure}.${at.beat}` };
  });
  // A section starting part-way through a measure with no beat left in it (1/2 has one a measure):
  // its start is still the section's first measure, as the header counts it
  if (from >= 1 && (!marks.length || (marks[0].step > 0 && !/^1(\.|$)/.test(marks[0].label)))) marks.unshift({ step: 0, label: '1' });
  return marks;
}

/** Where a take starts, for its "bar …" label: in plain 4/4 to a tenth of a bar as always, else the measure and beat as the ruler numbers them. */
export const takePlace = (bar: number, map: MeterMap = PLAIN): string => (isPlainMeter(map) ? String(Math.round(bar * 10) / 10) : formatBarPosition(bar, map));
