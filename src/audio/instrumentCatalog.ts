/**
 * Every instrument Bo's Beatbox can play, in one place. The Add Track menu, the inspector,
 * the piano roll's note range, the instrument browser and project validation all read this.
 *
 * kind:
 *   synth   - generated live (no download)
 *   drums   - a drum kit on the GM-style drum note map (Kick / Snare / Hats / Cowbell)
 *   fx      - transition effects (risers, impacts...), one fixed row each, like a drum kit's (FX_ROWS)
 *   sampled - multi-sampled recordings streamed from free public libraries (needs internet)
 *   custom  - the Sampler: plays a sound the user loads from their own computer
 */
export const INSTRUMENT_KEYS = [
  // original set
  'drums', 'bass', 'keys', 'brass', 'piano', 'violin', 'cello', 'guitar',
  // phase 3 additions
  'drumMachine', 'taiko',
  'subBass', 'bass808', 'bassGuitar',
  'rhodes', 'wavetable', 'lead', 'pipeOrgan',
  'electricGuitar', 'harp', 'mandolin',
  'saxophone', 'trumpet', 'frenchHorn', 'flute',
  'marimba', 'chimes',
  'erhu',
  'sampler',
  // EDM batch
  'wobbleBass', 'growlBass', 'reeseBass',
  'supersaw', 'pluck',
  'fx',
] as const;

export type InstrumentKey = (typeof INSTRUMENT_KEYS)[number];

export type InstrumentKind = 'synth' | 'drums' | 'fx' | 'sampled' | 'custom';

export const CATEGORIES = [
  'Drums & Percussion',
  'Bass',
  'Keys & Synths',
  'Guitars & Strings',
  'Winds & Brass',
  'Mallets & Bells',
  'World',
  'FX',
  'Your Sounds',
] as const;
export type InstrumentCategory = (typeof CATEGORIES)[number];

export interface SampleSource {
  baseUrl: string;
  /** Tone note name -> file name under baseUrl */
  samples: Record<string, string>;
  /** Seconds a note rings on after release */
  release?: number;
}

export interface InstrumentDef {
  key: InstrumentKey;
  name: string;
  /** One-line description shown in menus */
  blurb: string;
  color: string;
  category: InstrumentCategory;
  kind: InstrumentKind;
  /** Playable MIDI range (piano roll rows, browser keyboard) */
  range: [number, number];
  samples?: SampleSource;
  /** Extra processing that turns a related recording into this instrument */
  shaping?: 'erhu' | 'mandolin';
  /** Level correction in dB so instruments start out at similar loudness (measured) */
  gain?: number;
  /** Its notes wobble at their clip's wobble rate (Clip.wobble), chosen in the piano roll */
  wobble?: boolean;
}

/**
 * The FX instrument's rows, top to bottom in the order a build-up and drop use them: one transition
 * effect each. The notes only name the row (like the drum map's), in a range no drum kit uses.
 * Everything but Impact (a one-shot) lasts as long as its note.
 */
export const FX_NOTES = {
  riser: 'C3',
  noiseSweep: 'D3',
  reverseCrash: 'E3',
  impact: 'F3',
  subDrop: 'G3',
  downlifter: 'A3',
} as const;

export const FX_ROWS: ReadonlyArray<{ note: string; label: string }> = [
  { note: FX_NOTES.riser, label: 'Riser' },
  { note: FX_NOTES.noiseSweep, label: 'Noise Sweep' },
  { note: FX_NOTES.reverseCrash, label: 'Reverse Crash' },
  { note: FX_NOTES.impact, label: 'Impact' },
  { note: FX_NOTES.subDrop, label: 'Sub Drop' },
  { note: FX_NOTES.downlifter, label: 'Downlifter' },
];

// ---------- sample-map helpers ----------

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS: Record<string, string> = { 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab', 'A#': 'Bb' };
const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** General MIDI (FluidR3) soundfont set: every note exists; take one every `step` semitones. */
function gm(instrument: string, lo: number, hi: number, step = 3, release = 1): SampleSource {
  const samples: Record<string, string> = {};
  const add = (m: number) => {
    const n = noteName(m);
    const pitch = n.replace(/\d+$/, '');
    samples[n] = `${(FLATS[pitch] ?? pitch) + n.slice(pitch.length)}.mp3`;
  };
  for (let m = lo; m <= hi; m += step) add(m);
  add(hi);
  return { baseUrl: `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/${instrument}-mp3/`, samples, release };
}

/** nbrosowsky/tonejs-instruments set: listed files ("As3" = A#3). */
function nb(folder: string, files: string[], release = 1): SampleSource {
  const samples: Record<string, string> = {};
  for (const f of files) samples[f.replace('s', '#')] = `${f}.mp3`;
  return { baseUrl: `https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/${folder}/`, samples, release };
}

// ---------- the catalog ----------

export const INSTRUMENTS: Record<InstrumentKey, InstrumentDef> = {
  // Drums & Percussion
  drums: { key: 'drums', name: 'Drums', blurb: 'Analog groove kit', color: '#f59e0b', category: 'Drums & Percussion', kind: 'drums', range: [36, 48] },
  drumMachine: { key: 'drumMachine', name: 'Drum Machine', blurb: '808-style boom kit', color: '#ef4444', category: 'Drums & Percussion', kind: 'drums', range: [36, 48] },
  taiko: { key: 'taiko', name: 'Taiko Drums', blurb: 'Big Japanese drums', color: '#b91c1c', category: 'Drums & Percussion', kind: 'sampled', range: [36, 72], samples: gm('taiko_drum', 36, 72, 4, 1.5), gain: 9 },

  // Bass
  bass: { key: 'bass', name: 'Slap Bass', blurb: 'Squelchy funk synth bass', color: '#06b6d4', category: 'Bass', kind: 'synth', range: [24, 55] },
  subBass: { key: 'subBass', name: 'Sub-Bass', blurb: 'Deep sine sub', color: '#0e7490', category: 'Bass', kind: 'synth', range: [24, 48], gain: -10 },
  bass808: { key: 'bass808', name: '808 Bass', blurb: 'Booming pitched 808', color: '#7c3aed', category: 'Bass', kind: 'synth', range: [24, 52], gain: -6 },
  wobbleBass: { key: 'wobbleBass', name: 'Wobble Bass', blurb: 'Dubstep wobble, tempo-synced', color: '#84cc16', category: 'Bass', kind: 'synth', range: [24, 55], wobble: true, gain: -8 },
  growlBass: { key: 'growlBass', name: 'Growl Bass', blurb: 'Talking riddim growl', color: '#d946ef', category: 'Bass', kind: 'synth', range: [24, 60], wobble: true, gain: -14 },
  reeseBass: { key: 'reeseBass', name: 'Reese Bass', blurb: 'Detuned drum & bass Reese', color: '#6366f1', category: 'Bass', kind: 'synth', range: [24, 55], gain: -8 },
  bassGuitar: {
    key: 'bassGuitar', name: 'Bass Guitar', blurb: 'Electric bass (recorded)', color: '#0891b2', category: 'Bass', kind: 'sampled', range: [28, 60],
    samples: nb('bass-electric', ['E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3', 'Cs4'], 0.4),
  },

  // Keys & Synths
  piano: {
    key: 'piano', name: 'Grand Piano', blurb: 'Salamander grand (recorded)', color: '#e2e8f0', category: 'Keys & Synths', kind: 'sampled', range: [21, 108],
    // Salamander has A, C, D# and F# per octave only; C + F# keeps every note within 3 semitones
    samples: {
      baseUrl: 'https://tonejs.github.io/audio/salamander/',
      samples: {
        A0: 'A0.mp3', C1: 'C1.mp3', 'F#1': 'Fs1.mp3', C2: 'C2.mp3', 'F#2': 'Fs2.mp3', C3: 'C3.mp3', 'F#3': 'Fs3.mp3',
        C4: 'C4.mp3', 'F#4': 'Fs4.mp3', C5: 'C5.mp3', 'F#5': 'Fs5.mp3', C6: 'C6.mp3', 'F#6': 'Fs6.mp3', C7: 'C7.mp3', C8: 'C8.mp3',
      },
      release: 1.2,
    },
  },
  rhodes: { key: 'rhodes', name: 'Fender Rhodes', blurb: 'Electric piano (recorded)', color: '#f472b6', category: 'Keys & Synths', kind: 'sampled', range: [33, 100], samples: gm('electric_piano_1', 33, 100, 3, 0.8), gain: 19 },
  keys: { key: 'keys', name: 'Space Clav', blurb: 'FM electric keys', color: '#a855f7', category: 'Keys & Synths', kind: 'synth', range: [36, 88] },
  wavetable: { key: 'wavetable', name: 'Wavetable Synth', blurb: 'Evolving sweeping pad', color: '#38bdf8', category: 'Keys & Synths', kind: 'synth', range: [36, 96] },
  lead: { key: 'lead', name: 'Analog Lead', blurb: 'Gliding saw lead', color: '#facc15', category: 'Keys & Synths', kind: 'synth', range: [48, 96] },
  supersaw: { key: 'supersaw', name: 'Supersaw', blurb: 'Wide trance / house chords', color: '#fb7185', category: 'Keys & Synths', kind: 'synth', range: [36, 96], gain: -5 },
  pluck: { key: 'pluck', name: 'Pluck', blurb: 'Short bright EDM pluck', color: '#2dd4bf', category: 'Keys & Synths', kind: 'synth', range: [48, 96], gain: -6 },
  pipeOrgan: { key: 'pipeOrgan', name: 'Pipe Organ', blurb: 'Church organ (recorded)', color: '#d4a373', category: 'Keys & Synths', kind: 'sampled', range: [24, 96], samples: gm('church_organ', 24, 96, 3, 0.6), gain: 15 },

  // Guitars & Strings
  guitar: {
    key: 'guitar', name: 'Acoustic Guitar', blurb: 'Steel-string (recorded)', color: '#b45309', category: 'Guitars & Strings', kind: 'sampled', range: [40, 76],
    samples: nb('guitar-acoustic', ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']),
  },
  electricGuitar: {
    key: 'electricGuitar', name: 'Electric Guitar', blurb: 'Clean electric (recorded)', color: '#dc2626', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: nb('guitar-electric', ['E2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5']),
  },
  mandolin: {
    key: 'mandolin', name: 'Mandolin', blurb: 'Modeled: bright steel strings, doubled', color: '#ca8a04', category: 'Guitars & Strings', kind: 'sampled', range: [55, 88],
    samples: gm('acoustic_guitar_steel', 55, 88, 3, 0.6), shaping: 'mandolin', gain: 18,
  },
  harp: {
    key: 'harp', name: 'Harp', blurb: 'Concert harp (recorded)', color: '#fde68a', category: 'Guitars & Strings', kind: 'sampled', range: [24, 100],
    samples: nb('harp', ['E1', 'G1', 'D2', 'F2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5', 'E5', 'G5', 'B5', 'D6', 'F6', 'D7'], 1.5),
  },
  violin: {
    key: 'violin', name: 'Violin', blurb: 'Solo violin (recorded)', color: '#f87171', category: 'Guitars & Strings', kind: 'sampled', range: [55, 96],
    samples: nb('violin', ['A3', 'G4', 'C5', 'G6']),
  },
  cello: {
    key: 'cello', name: 'Cello', blurb: 'Solo cello (recorded)', color: '#ea580c', category: 'Guitars & Strings', kind: 'sampled', range: [36, 72],
    samples: nb('cello', ['C2', 'G2', 'D3', 'A3', 'C4']),
  },

  // Winds & Brass
  brass: { key: 'brass', name: 'Brass Stabs', blurb: 'Synth horn section', color: '#22c55e', category: 'Winds & Brass', kind: 'synth', range: [48, 84] },
  saxophone: {
    key: 'saxophone', name: 'Saxophone', blurb: 'Alto sax (recorded)', color: '#eab308', category: 'Winds & Brass', kind: 'sampled', range: [49, 80],
    samples: nb('saxophone', ['Cs3', 'E3', 'G3', 'As3', 'Cs4', 'E4', 'G4', 'As4', 'Cs5', 'E5', 'G5'], 0.5),
  },
  trumpet: {
    key: 'trumpet', name: 'Trumpet', blurb: 'Solo trumpet (recorded)', color: '#f97316', category: 'Winds & Brass', kind: 'sampled', range: [52, 84],
    samples: nb('trumpet', ['F3', 'A3', 'C4', 'Ds4', 'F4', 'G4', 'As4', 'D5', 'F5', 'A5', 'C6'], 0.4),
  },
  frenchHorn: {
    key: 'frenchHorn', name: 'French Horn', blurb: 'Warm orchestral horn (recorded)', color: '#c2410c', category: 'Winds & Brass', kind: 'sampled', range: [33, 77],
    samples: nb('french-horn', ['A1', 'C2', 'Ds2', 'G2', 'D3', 'F3', 'A3', 'C4', 'D5', 'F5'], 0.6),
  },
  flute: {
    key: 'flute', name: 'Flute', blurb: 'Concert flute (recorded)', color: '#93c5fd', category: 'Winds & Brass', kind: 'sampled', range: [60, 96],
    samples: nb('flute', ['C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6', 'C7'], 0.5),
  },

  // Mallets & Bells
  marimba: { key: 'marimba', name: 'Marimba', blurb: 'Wooden mallets (recorded)', color: '#a16207', category: 'Mallets & Bells', kind: 'sampled', range: [45, 96], samples: gm('marimba', 45, 96, 3, 0.8), gain: 14 },
  chimes: { key: 'chimes', name: 'Chimes', blurb: 'Tubular bells (recorded)', color: '#cbd5e1', category: 'Mallets & Bells', kind: 'sampled', range: [48, 84], samples: gm('tubular_bells', 48, 84, 3, 3), gain: 12 },

  // World
  erhu: {
    key: 'erhu', name: 'Erhu', blurb: 'Modeled: bowed strings, nasal tone + vibrato', color: '#be123c', category: 'World', kind: 'sampled', range: [62, 93],
    samples: gm('violin', 60, 96, 3, 0.5), shaping: 'erhu', gain: 17,
  },

  // FX
  fx: { key: 'fx', name: 'FX', blurb: 'Risers, sweeps, impacts, drops', color: '#67e8f9', category: 'FX', kind: 'fx', range: [48, 57], gain: -5 },

  // Your Sounds
  sampler: { key: 'sampler', name: 'Sampler', blurb: 'Play your own sound file', color: '#14b8a6', category: 'Your Sounds', kind: 'custom', range: [36, 96] },
};

export function isInstrumentKey(key: unknown): key is InstrumentKey {
  return typeof key === 'string' && key in INSTRUMENTS;
}

export function isDrumKind(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'drums';
}

/** The FX instrument: fixed named rows (FX_ROWS) instead of a keyboard. */
export function isFxKind(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'fx';
}

/** Can a deck sound / pattern made for `source` go on a `target` track? (Drum kits share notes.) */
export function compatibleInstruments(source: InstrumentKey, target: InstrumentKey): boolean {
  return source === target || (isDrumKind(source) && isDrumKind(target));
}

/** What a clip's notes mean: drum hits, FX rows, or pitches. */
const noteFamily = (key: InstrumentKey) => (isDrumKind(key) ? 'drums' : isFxKind(key) ? 'fx' : 'pitched');

/**
 * Can a clip on a `source` track move (or be pasted) onto a `target` track? Drum parts only make
 * sense on a drum kit and FX parts on the FX instrument, and a melody plays on any pitched
 * instrument (the Sampler included).
 */
export function canMoveClipBetween(source: InstrumentKey, target: InstrumentKey): boolean {
  return noteFamily(source) === noteFamily(target);
}

/** Instruments grouped by category, in menu order. */
export function instrumentsByCategory(): Array<{ category: InstrumentCategory; instruments: InstrumentDef[] }> {
  return CATEGORIES.map((category) => ({
    category,
    instruments: INSTRUMENT_KEYS.map((k) => INSTRUMENTS[k]).filter((d) => d.category === category),
  })).filter((g) => g.instruments.length > 0);
}
