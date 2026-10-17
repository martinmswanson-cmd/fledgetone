/**
 * The note-name and sample-map helpers for the older sample sets: the General MIDI soundfonts
 * rendered by midi-js-soundfonts (FluidR3_GM, MusyngKite), whose instruments are in
 * instrumentCatalogRetro.ts, and the tonejs-instruments recordings. Kept apart from
 * instrumentCatalog.ts so the retro catalog can use them without the two importing each other.
 */
import type { SampleSource } from './instrumentCatalog';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLATS: Record<string, string> = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** General MIDI (FluidR3) soundfont set: every note exists; take one every `step` semitones. */
export function gm(instrument: string, lo: number, hi: number, step = 3, release = 1): SampleSource {
  return soundfont('FluidR3_GM', instrument, lo, hi, step, release);
}

/** Sustained soundfont notes loop their steady part until they're 10 s long (see SampleSource.sustain). */
export const SOUNDFONT_SUSTAIN = { from: 1.2, to: 3.0, hold: 10 };

/** A soundfont set rendered by midi-js-soundfonts (FluidR3_GM, MusyngKite, FatBoy): every note exists. */
export function soundfont(font: string, instrument: string, lo: number, hi: number, step = 3, release = 1): SampleSource {
  const samples: Record<string, string> = {};
  const add = (m: number) => {
    const n = noteName(m);
    const pitch = n.replace(/\d+$/, '');
    samples[n] = `${(FLATS[pitch] ?? pitch) + n.slice(pitch.length)}.mp3`;
  };
  for (let m = lo; m <= hi; m += step) add(m);
  add(hi);
  return { baseUrl: `https://gleitz.github.io/midi-js-soundfonts/${font}/${instrument}-mp3/`, samples, release };
}

/** nbrosowsky/tonejs-instruments set: listed files ("As3" = A#3). */
export function nb(folder: string, files: string[], release = 1, onset?: number): SampleSource {
  const samples: Record<string, string> = {};
  for (const f of files) samples[f.replace('s', '#')] = `${f}.mp3`;
  return { baseUrl: `https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/${folder}/`, samples, release, onset };
}

/** A Musyng Kite soundfont instrument that plays on while held (its notes are looped past 3.1 s). */
export const held = (instrument: string, lo: number, hi: number, release = 0.8, onset?: number): SampleSource => ({
  ...soundfont('MusyngKite', instrument, lo, hi, 3, release),
  sustain: SOUNDFONT_SUSTAIN,
  ...(onset !== undefined ? { onset } : {}),
});
/** A Musyng Kite soundfont instrument whose notes die away by themselves (plucked, struck). */
export const struck = (instrument: string, lo: number, hi: number, release = 1): SampleSource => soundfont('MusyngKite', instrument, lo, hi, 3, release);
