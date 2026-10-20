import type { InstrumentKey } from '../audio/instrumentCatalog';
import type { NoteEvent, Stinger, StingerKind } from './timelineTypes';
import { uid } from './timelineTypes';
import { NOTE_NAMES, type SongKey } from './songKey';

/**
 * Stingers: short musical cues a game plays over its music when something happens (a win, a level
 * up, an item found, game over), written in the song's key and played at its tempo, so they fit
 * whatever is playing. Each kind has a little recipe; Variation changes its rhythm and register.
 * No audio or store here, so Node can unit-test it.
 */

export const STINGER_KINDS: ReadonlyArray<{ kind: StingerKind; label: string; instrument: InstrumentKey; blurb: string }> = [
  { kind: 'victory', label: 'Victory', instrument: 'brass', blurb: 'A fanfare: a pickup into a big chord' },
  { kind: 'levelUp', label: 'Level up', instrument: 'chipLead', blurb: 'A fast rising arpeggio' },
  { kind: 'item', label: 'Item found', instrument: 'pluck', blurb: 'Up through two chords to a bright one' },
  { kind: 'checkpoint', label: 'Checkpoint', instrument: 'pluck', blurb: 'Two notes: "got it"' },
  { kind: 'danger', label: 'Danger', instrument: 'keys', blurb: 'Tense low pulses' },
  { kind: 'gameOver', label: 'Game over', instrument: 'keys', blurb: 'Falling to a low minor chord' },
];

export const stingerKind = (kind: StingerKind) => STINGER_KINDS.find((k) => k.kind === kind)!;

/** How many variations each kind has. */
export const STINGER_VARIATIONS = 3;

const nameOf = (midi: number) => `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** Notes and length of a stinger of `kind` in `key`. */
export function stingerNotes(kind: StingerKind, key: SongKey, variation = 0): { notes: NoteEvent[]; lengthBars: number } {
  const v = ((variation % STINGER_VARIATIONS) + STINGER_VARIATIONS) % STINGER_VARIATIONS;
  const steps = kind === 'gameOver' ? [0, 2, 3, 5, 7, 8, 10] : key.steps;
  // Scale degree `d` (0 = the root) above the root in octave 4, or 5 for the brighter variation
  const base = 60 + key.root - (key.root > 6 ? 12 : 0) + (v === 1 && kind !== 'gameOver' && kind !== 'danger' ? 12 : 0);
  const deg = (d: number) => base + steps[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const notes: NoteEvent[] = [];
  const add = (midi: number, at: number, duration: string, velocity: number) =>
    notes.push({ id: uid('note'), note: nameOf(midi), startOffset: at, duration, velocity });
  const chord = (degrees: number[], at: number, duration: string, velocity: number) => degrees.forEach((d) => add(deg(d), at, duration, velocity));
  let lengthBars = 1;

  switch (kind) {
    case 'victory': {
      // A pickup on the fifth (triplets, or straight 16ths), a step down and back, then the tonic chord held
      const pick = v === 2 ? [0, 1 / 16, 2 / 16] : [0, 1 / 12, 2 / 12];
      pick.forEach((at) => add(deg(4), at, v === 2 ? '16n' : '8t', 0.7));
      add(deg(3), 0.25, '8n', 0.75);
      add(deg(4), 0.375, '8n', 0.8);
      chord([0, 2, 4, 7], 0.5, '2n.', 0.85);
      lengthBars = 1.5;
      break;
    }
    case 'levelUp': {
      const run = v === 2 ? [0, 4, 7, 9, 11, 14] : [0, 2, 4, 7, 9, 11, 14];
      const step = v === 2 ? 1 / 12 : 1 / 16;
      run.forEach((d, i) => add(deg(d), i * step, v === 2 ? '8t' : '16n', 0.6 + i * 0.05));
      chord([7, 9, 11, 14], run.length * step, '2n', 0.8);
      lengthBars = Math.ceil((run.length * step + 0.5) * 4) / 4;
      break;
    }
    case 'item': {
      // IV, V, then I up high: the rising "you found something"
      const step = v === 2 ? 1 / 12 : 1 / 16;
      [3, 5, 7, 4, 6, 8].forEach((d, i) => add(deg(d), i * step, v === 2 ? '8t' : '16n', 0.65));
      chord([7, 9, 11], 6 * step, '2n', 0.8);
      add(deg(14), 6 * step, '2n', 0.6);
      lengthBars = Math.ceil((6 * step + 0.5) * 4) / 4;
      break;
    }
    case 'checkpoint':
      add(deg(4), 0, '16n', 0.7);
      if (v === 2) add(deg(5), 1 / 16, '16n', 0.7);
      chord([7, 9], v === 2 ? 0.125 : 0.0625 * 2, '4n', 0.85);
      lengthBars = 0.5;
      break;
    case 'danger': {
      // Root and the tritone above it, low and pulsing, then a clash
      const root = base - 12;
      const n = v === 2 ? 8 : 6;
      for (let i = 0; i < n; i++) add(i % 2 ? root + 6 : root, i * (v === 2 ? 1 / 16 : 1 / 8), v === 2 ? '16n' : '8n', 0.55 + (i / n) * 0.35);
      const end = n * (v === 2 ? 1 / 16 : 1 / 8);
      [0, 1, 6].forEach((s) => add(root + 12 + s, end, '4n', 0.75));
      lengthBars = Math.ceil((end + 0.25) * 4) / 4;
      break;
    }
    case 'gameOver': {
      const fall = v === 2 ? [7, 6, 4, 3, 2, 1] : [4, 3, 2, 1];
      const step = v === 2 ? 1 / 16 : 1 / 8;
      fall.forEach((d, i) => add(deg(d), i * step, v === 2 ? '16n' : '8n', 0.75 - i * 0.05));
      const at = fall.length * step;
      chord([-7, -5, -3, 0], at, '1m', 0.7);
      lengthBars = Math.ceil((at + 1) * 4) / 4;
      break;
    }
  }
  return { notes, lengthBars };
}

/** Move notes by octaves into an instrument's range (MIDI numbers, inclusive). */
export function fitNotesToRange(notes: NoteEvent[], [lo, hi]: readonly [number, number]): NoteEvent[] {
  const midi = (n: string) => {
    const m = /^([A-G]#?)(-?\d+)$/.exec(n);
    return m ? (Number(m[2]) + 1) * 12 + NOTE_NAMES.indexOf(m[1] as (typeof NOTE_NAMES)[number]) : NaN;
  };
  const ms = notes.map((n) => midi(n.note));
  const min = Math.min(...ms);
  const max = Math.max(...ms);
  let shift = 0;
  while (min + shift < lo && max + shift + 12 <= hi + 12) shift += 12;
  while (max + shift > hi && min + shift - 12 >= lo - 12) shift -= 12;
  return shift ? notes.map((n, i) => ({ ...n, note: nameOf(ms[i] + shift) })) : notes;
}

/** A new stinger of `kind` in `key`. */
export function createStinger(kind: StingerKind, key: SongKey, existing: readonly Stinger[]): Stinger {
  const meta = stingerKind(kind);
  const same = existing.filter((s) => s.kind === kind).length;
  const { notes, lengthBars } = stingerNotes(kind, key, 0);
  return { id: uid('stinger'), name: same ? `${meta.label} ${same + 1}` : meta.label, kind, instrumentKey: meta.instrument, variation: 0, notes, lengthBars };
}

const KINDS = new Set(STINGER_KINDS.map((k) => k.kind));

/** Stingers from a project file, keeping only well-formed ones. */
export function parseStingers(raw: unknown, isInstrument: (key: unknown) => key is InstrumentKey): Stinger[] {
  if (!Array.isArray(raw)) return [];
  const out: Stinger[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const s = r as Record<string, unknown>;
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || !KINDS.has(s.kind as StingerKind) || !isInstrument(s.instrumentKey)) continue;
    if (!Array.isArray(s.notes) || typeof s.lengthBars !== 'number' || !(s.lengthBars > 0 && s.lengthBars <= 8)) continue;
    const notes = s.notes.filter(
      (n): n is NoteEvent =>
        typeof n === 'object' && n !== null && typeof n.id === 'string' && typeof n.note === 'string' && typeof n.startOffset === 'number' && typeof n.duration === 'string' && typeof n.velocity === 'number'
    );
    out.push({
      id: s.id,
      name: s.name.slice(0, 80),
      kind: s.kind as StingerKind,
      instrumentKey: s.instrumentKey,
      variation: typeof s.variation === 'number' ? Math.round(s.variation) : 0,
      notes,
      lengthBars: s.lengthBars,
    });
  }
  return out;
}
