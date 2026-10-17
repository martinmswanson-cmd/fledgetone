import type { Clip, NoteEvent } from './timelineTypes';
import { durationToBars } from './timelineTypes';
import { measureAt, measuresBetween, type Meter, type MeterMap } from '../audio/tempoMap';
import type { SongKey } from './songKey';

/**
 * A note clip as sheet music: measures of notes and rests on a staff (or a grand staff), the way
 * the notation view draws it and MusicXML exports it. Pure, so it's unit tested.
 *
 * The clip's notes are put on a grid (a 16th by default), each staff is one voice: notes that
 * start together are a chord, held until the next chord starts (or they end), and silences are
 * rests. A note crossing a bar line is tied over it. Lengths are spelled as the plain and dotted
 * note values, a note starting off the beat split at the beat, so the beats can be read.
 */

/** One grid step in bars (a 16th note). Lengths below are counted in these. */
export const GRID = 1 / 16;

/** Note values in 16ths, longest first: whole, dotted half, half, dotted quarter, quarter, dotted 8th, 8th, 16th. */
const VALUES = [16, 12, 8, 6, 4, 3, 2, 1] as const;

export interface Glyph {
  /** MIDI notes of a chord (empty: a rest) */
  keys: number[];
  /** Length in 16ths (one of VALUES) */
  units: number;
  /** Where it starts in its measure, in 16ths */
  at: number;
  /** Tied to the next glyph (the same notes carry on) */
  tie?: boolean;
}

export type Clef = 'treble' | 'bass' | 'percussion';

export interface Measure {
  /** Song position of its start (bars) */
  bar: number;
  /** Its number in the song */
  number: number;
  meter: Meter;
  /** A new meter starts here (or it's the first measure) */
  meterChange: boolean;
  /** Each staff's glyphs, in the order of `Score.staves` */
  staves: Glyph[][];
}

export interface Score {
  staves: Clef[];
  measures: Measure[];
  /** The key, for the key signature (null: C major / A minor, no sharps or flats) */
  key: SongKey | null;
}

/** 16ths in a measure of `meter`. */
export const measureUnits = (meter: Meter) => Math.round((meter.num * 16) / meter.den);
/** 16ths in one of its beats (a dotted quarter in 6/8 and the like). */
const beatUnits = (meter: Meter) => (meter.den === 8 && meter.num % 3 === 0 && meter.num > 3 ? 6 : 16 / meter.den);

/**
 * A length (16ths) starting `at` 16ths into a measure, spelled as note values: off the beat, it
 * first runs to the beat. A rest is never dotted across a beat, as rests are written.
 */
export function spell(at: number, length: number, meter: Meter, rest = false): number[] {
  const out: number[] = [];
  const beat = beatUnits(meter);
  let pos = at;
  let left = length;
  while (left > 0) {
    // Off the beat: up to the beat first; on it: the longest value that fits (a whole note only in a full 4/4 bar)
    const toBeat = pos % beat === 0 ? left : Math.min(left, beat - (pos % beat));
    // (A half in 4/4 sits on a half of the bar, as do dotted halves; dotted quarters start on an 8th)
    const halves = measureUnits(meter) % 8 === 0;
    const v =
      VALUES.find(
        (n) =>
          n <= toBeat &&
          (n !== 16 || (pos === 0 && measureUnits(meter) === 16)) &&
          (n !== 12 || pos % 8 === 0) &&
          (n !== 8 || !halves || pos % 8 === 0) &&
          (n !== 6 || pos % 2 === 0) &&
          (!rest || n < beat || n % beat === 0 || n === measureUnits(meter))
      ) ?? 1;
    out.push(v);
    pos += v;
    left -= v;
  }
  return out;
}

const midiOf = (note: string): number => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(note);
  if (!m) return NaN;
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1] as 'C'];
  return base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
};

interface Placed {
  midi: number;
  /** Start and end in 16ths from the first measure's start */
  start: number;
  end: number;
}

/** One staff's notes as events over the clip (16ths from `origin`): chords and rests, before measures. */
function voiceOf(notes: Placed[], total: number): Array<{ keys: number[]; start: number; end: number }> {
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  const events: Array<{ keys: number[]; start: number; end: number }> = [];
  let pos = 0;
  starts.forEach((start, i) => {
    if (start > pos) events.push({ keys: [], start: pos, end: start });
    const chord = notes.filter((n) => n.start === start);
    const next = i + 1 < starts.length ? starts[i + 1] : total;
    // Held until the next chord, or until its longest note ends
    const end = Math.min(next, Math.max(...chord.map((n) => n.end)));
    events.push({ keys: [...new Set(chord.map((n) => n.midi))].sort((a, b) => a - b), start, end });
    pos = end;
  });
  if (pos < total) events.push({ keys: [], start: pos, end: total });
  return events;
}

/**
 * The clip as a score. `drums`: one percussion staff, each note at its row's place (see
 * DRUM_POSITIONS in the view). Otherwise one staff if every note fits on one (treble from
 * middle C up, bass below), else a grand staff split at middle C.
 */
export function notate(clip: Pick<Clip, 'startBar' | 'lengthBars' | 'notes'>, meter: MeterMap, key: SongKey | null, drums = false): Score {
  const first = measureAt(clip.startBar, meter);
  const end = clip.startBar + clip.lengthBars;
  const measures = measuresBetween(first.start, end, meter);
  const origin = first.start;
  const total = Math.round((measures.length ? measures[measures.length - 1].bar + measureUnits(measures[measures.length - 1].meter) / 16 - origin : clip.lengthBars) / GRID);
  const visible = clip.notes.filter((n) => n.startOffset >= -1e-6 && n.startOffset < clip.lengthBars - 1e-6);
  const placed: Placed[] = visible
    .map((n: NoteEvent) => {
      const s = Math.round((clip.startBar + n.startOffset - origin) / GRID);
      const e = Math.max(s + 1, Math.round((clip.startBar + Math.min(clip.lengthBars, n.startOffset + durationToBars(n.duration)) - origin) / GRID));
      return { midi: midiOf(n.note), start: s, end: Math.min(e, total) };
    })
    .filter((n) => Number.isFinite(n.midi) && n.start < total);

  if (drums) {
    // Drum hits are written lasting until the next hit (a beat at most), as drum parts are read
    const starts = [...new Set(placed.map((n) => n.start))].sort((a, b) => a - b);
    const bars = measures.map((m) => Math.round((m.bar - origin) / GRID));
    for (const n of placed) {
      const next = starts.find((t) => t > n.start) ?? total;
      // (Never over the bar line: a hit isn't tied)
      const barEnd = bars.find((b) => b > n.start) ?? total;
      n.end = Math.min(next, n.start + 4, barEnd, total);
    }
  }
  let staves: Clef[];
  let parts: Placed[][];
  if (drums) {
    staves = ['percussion'];
    parts = [placed];
  } else if (placed.every((n) => n.midi >= 57) || !placed.length) {
    staves = ['treble'];
    parts = [placed];
  } else if (placed.every((n) => n.midi < 64)) {
    staves = ['bass'];
    parts = [placed];
  } else {
    staves = ['treble', 'bass'];
    parts = [placed.filter((n) => n.midi >= 60), placed.filter((n) => n.midi < 60)];
  }

  const out: Measure[] = measures.map((m, i) => ({
    bar: m.bar,
    number: m.measure,
    meter: m.meter,
    meterChange: i === 0 || m.meter.num !== measures[i - 1].meter.num || m.meter.den !== measures[i - 1].meter.den,
    staves: staves.map(() => []),
  }));
  const measureStartUnit = measures.map((m) => Math.round((m.bar - origin) / GRID));
  parts.forEach((notes, s) => {
    for (const ev of voiceOf(notes, total)) {
      // Cut at bar lines, each piece spelled; a chord's pieces are tied
      const made: Glyph[] = [];
      let pos = ev.start;
      while (pos < ev.end) {
        let mi = measureStartUnit.length - 1;
        while (mi > 0 && measureStartUnit[mi] > pos) mi--;
        const mStart = measureStartUnit[mi];
        const mEnd = mStart + measureUnits(measures[mi].meter);
        const pieceEnd = Math.min(ev.end, mEnd);
        let at = pos - mStart;
        for (const units of spell(at, pieceEnd - pos, measures[mi].meter, !ev.keys.length)) {
          const g: Glyph = { keys: ev.keys, units, at };
          out[mi].staves[s].push(g);
          made.push(g);
          at += units;
        }
        pos = pieceEnd;
      }
      if (ev.keys.length) made.slice(0, -1).forEach((g) => (g.tie = true));
    }
  });
  return { staves, measures: out, key };
}

// ---------- spelling the pitches ----------

const SHARP_KEYS = new Set(['G', 'D', 'A', 'E', 'B', 'F#']);
/** The key signature's name for VexFlow / MusicXML: its major (or minor, with "m") root, spelled sharp or flat as that key is. */
export function keySpec(key: SongKey | null): string {
  if (!key) return 'C';
  const flatNames = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const sharpNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  // The relative major decides the signature
  const major = key.mode === 'major' ? key.root : (key.root + 3) % 12;
  const majorName = SHARP_KEYS.has(sharpNames[major]) ? sharpNames[major] : flatNames[major];
  if (key.mode === 'major') return majorName === 'Gb' ? 'Gb' : majorName;
  const minorName = SHARP_KEYS.has(majorName) || majorName === 'C' ? sharpNames[key.root] : flatNames[key.root];
  return `${minorName}m`;
}

/** Sharps (positive) or flats (negative) in the key signature. */
export function keyFifths(key: SongKey | null): number {
  if (!key) return 0;
  const major = key.mode === 'major' ? key.root : (key.root + 3) % 12;
  // C=0, G=1, D=2, A=3, E=4, B=5, F#=6 / F=-1, Bb=-2, Eb=-3, Ab=-4, Db=-5, Gb=-6
  const fifths: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5 };
  return fifths[major];
}

/** A MIDI note spelled for the key: letter, alteration (-1 flat, 1 sharp) and octave. */
export function spellPitch(midi: number, key: SongKey | null): { step: string; alter: number; octave: number } {
  const flats = keyFifths(key) < 0;
  const names = flats ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = names[((midi % 12) + 12) % 12];
  return { step: name[0], alter: name.length > 1 ? (name[1] === '#' ? 1 : -1) : 0, octave: Math.floor(midi / 12) - 1 };
}

// ---------- MusicXML ----------

const TYPES: Record<number, { type: string; dot: boolean }> = {
  16: { type: 'whole', dot: false },
  12: { type: 'half', dot: true },
  8: { type: 'half', dot: false },
  6: { type: 'quarter', dot: true },
  4: { type: 'quarter', dot: false },
  3: { type: 'eighth', dot: true },
  2: { type: 'eighth', dot: false },
  1: { type: '16th', dot: false },
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The score as a MusicXML 4.0 file (one part; a grand staff as two staves of it), which notation
 * programs open. Drums go on a percussion staff with each row at its place (`drumPlace`).
 */
export function musicXml(score: Score, opts: { title: string; partName: string; bpm: number; drumPlace?: (midi: number) => { step: string; octave: number } }): string {
  const divisions = 4; // per quarter: a 16th is 1
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  out.push('<score-partwise version="4.0">');
  out.push(`  <work><work-title>${esc(opts.title)}</work-title></work>`);
  out.push(`  <part-list><score-part id="P1"><part-name>${esc(opts.partName)}</part-name></score-part></part-list>`);
  out.push('  <part id="P1">');
  score.measures.forEach((m, mi) => {
    out.push(`    <measure number="${mi + 1}">`);
    if (mi === 0 || m.meterChange) {
      out.push('      <attributes>');
      if (mi === 0) out.push(`        <divisions>${divisions}</divisions>`);
      if (mi === 0) out.push(`        <key><fifths>${score.staves[0] === 'percussion' ? 0 : keyFifths(score.key)}</fifths></key>`);
      out.push(`        <time><beats>${m.meter.num}</beats><beat-type>${m.meter.den}</beat-type></time>`);
      if (mi === 0) {
        if (score.staves.length > 1) out.push(`        <staves>${score.staves.length}</staves>`);
        score.staves.forEach((clef, s) => {
          const [sign, line] = clef === 'treble' ? ['G', 2] : clef === 'bass' ? ['F', 4] : ['percussion', 2];
          out.push(`        <clef${score.staves.length > 1 ? ` number="${s + 1}"` : ''}><sign>${sign}</sign><line>${line}</line></clef>`);
        });
      }
      out.push('      </attributes>');
      if (mi === 0) out.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(opts.bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(opts.bpm)}"/></direction>`);
    }
    m.staves.forEach((glyphs, s) => {
      if (s > 0) out.push(`      <backup><duration>${measureUnits(m.meter)}</duration></backup>`);
      for (const g of glyphs) {
        const t = TYPES[g.units];
        const staff = score.staves.length > 1 ? `<staff>${s + 1}</staff>` : '';
        if (!g.keys.length) {
          out.push(`      <note><rest/><duration>${g.units}</duration><voice>${s + 1}</voice><type>${t.type}</type>${t.dot ? '<dot/>' : ''}${staff}</note>`);
          continue;
        }
        g.keys.forEach((midi, k) => {
          const chord = k > 0 ? '<chord/>' : '';
          let pitch: string;
          if (score.staves[s] === 'percussion') {
            const p = opts.drumPlace?.(midi) ?? { step: 'C', octave: 5 };
            pitch = `<unpitched><display-step>${p.step}</display-step><display-octave>${p.octave}</display-octave></unpitched>`;
          } else {
            const p = spellPitch(midi, score.key);
            pitch = `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
          }
          const tie = g.tie ? '<tie type="start"/>' : '';
          const tied = g.tie ? '<notations><tied type="start"/></notations>' : '';
          out.push(`      <note>${chord}${pitch}<duration>${g.units}</duration>${tie}<voice>${s + 1}</voice><type>${t.type}</type>${t.dot ? '<dot/>' : ''}${staff}${tied}</note>`);
        });
      }
    });
    out.push('    </measure>');
  });
  out.push('  </part>');
  out.push('</score-partwise>');
  return out.join('\n');
}
