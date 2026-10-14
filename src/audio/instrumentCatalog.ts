/**
 * Every instrument Bo's Beatbox can play, in one place. The Add Track menu, the inspector,
 * the piano roll's note range, the instrument browser and project validation all read this.
 *
 * kind:
 *   synth   - generated live (no download)
 *   drums   - a drum kit on the GM-style drum note map (Kick / Snare / Hats / Cowbell)
 *   fx      - transition effects (risers, impacts...), one fixed row each, like a drum kit's (FX_ROWS)
 *   sampled - multi-sampled recordings streamed from free public libraries, or hosted with the app (needs internet)
 *   custom  - the Sampler: plays a sound the user loads from their own computer
 *   slicer  - the Slicer: a sound cut into slices, one per key from C3 up (vocal chops)
 *   rack    - the Drum Rack: 16 pads, each its own sound with its own effects
 *   multi   - the Multi Sampler: several sounds laid across the keys and velocities
 *   audio   - an Audio track: holds audio clips (sound files on the timeline) instead of notes
 */
import { SAMPLE_TUNING } from './sampleTuning';
import { HOSTED_SETS } from './hostedSets';

export const INSTRUMENT_KEYS = [
  // original set
  'drums', 'bass', 'keys', 'brass', 'piano', 'violin', 'cello', 'guitar',
  // real recordings at several loudnesses, hosted with the app
  'realCello', 'realCelloShort', 'realGuitar', 'realCrunchGuitar', 'realLeadGuitar', 'realHollowGuitar',
  'realViolins', 'realViolinsShort', 'realViolas', 'realViolasShort', 'realPizzicato', 'realTremolo', 'realSoloViolin', 'realDoubleBass', 'realHarp',
  'realFlute', 'realFluteShort', 'realOboe', 'realClarinet', 'realBassoon',
  'realHorn', 'realHornShort', 'realTrumpet', 'realTrumpetShort', 'realTrombone', 'realTromboneShort', 'realTuba',
  'realGrandPiano', 'realUprightPiano', 'realPipeOrgan', 'realChapelOrgan', 'realMarimba', 'realXylophone', 'realGlockenspiel',
  'realAltoSax', 'realBariSax', 'realUprightBass', 'realElectricBass', 'realFlatwoundGuitar',
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
  // a synth you design
  'synthDesigner',
  // the rest of the General MIDI set: more keys, leads, pads, guitars, basses, winds, percussion, sound effects
  'brightPiano', 'electricGrand', 'honkyTonk', 'fmPiano', 'clavinet', 'percussiveOrgan', 'reedOrgan', 'squareLead',
  'sawLead', 'calliope', 'chiffLead', 'charang', 'voiceLead', 'fifthsLead', 'bassLead', 'synthBrass',
  'synthBrass2', 'synthStrings2', 'polysynthPad', 'metallicPad', 'rainPad', 'soundtrackPad', 'brightnessPad', 'echoesPad',
  'jazzGuitar', 'cleanGuitar', 'steelGuitar', 'guitarHarmonics', 'fingerBass', 'pickBass', 'slappedBass', 'slappedBass2',
  'synthBass1', 'synthBass2', 'sopranoSax', 'baritoneSax', 'shanai', 'whistle', 'melodicTom', 'synthDrum',
  'woodblock', 'agogo', 'tinkleBell', 'reverseCymbal', 'seashore', 'birdTweet', 'telephone', 'helicopter',
  'applause', 'gunshot', 'fretNoise', 'breathNoise',
  // string section
  'strings',
  // chiptune
  'chipLead', 'chipBass', 'chipDrums',
  // recorded drum kits
  'acousticKit', 'breakbeatKit', 'linnDrum', 'cr78', 'technoKit', 'bongos',
  // choir, pads and atmospheres
  'choir', 'voiceOohs', 'synthChoir', 'haloPad', 'warmPad', 'newAgePad', 'choirPad', 'glassPad', 'sweepPad', 'atmosphere', 'crystal', 'sciFi', 'goblins',
  // orchestra
  'viola', 'contrabass', 'pizzicato', 'tremolo', 'slowStrings', 'synthStrings', 'timpani', 'orchestraHit',
  'oboe', 'clarinet', 'bassoon', 'englishHorn', 'piccolo', 'recorder', 'trombone', 'tuba', 'brassSection', 'mutedTrumpet', 'tenorSax',
  // keys, mallets and bells
  'harpsichord', 'celesta', 'glockenspiel', 'musicBox', 'vibraphone', 'xylophone', 'drawbarOrgan', 'rockOrgan',
  // guitars and basses
  'nylonGuitar', 'distortionGuitar', 'overdriveGuitar', 'mutedGuitar', 'banjo', 'uprightBass', 'fretlessBass',
  // world and folk
  'fiddle', 'sitar', 'koto', 'shamisen', 'shakuhachi', 'panFlute', 'ocarina', 'bagpipe', 'accordion', 'harmonica', 'kalimba', 'steelDrums', 'dulcimer',
  // audio clips and vocal chops
  'slicer', 'audio', 'drumRack', 'multiSampler',
  // a group channel (a bus) other tracks route into
  'bus',
  // a Web Audio Module instrument loaded from a URL
  'plugin',
  // an effect return the other tracks send to
  'return',
] as const;

export type InstrumentKey = (typeof INSTRUMENT_KEYS)[number];

export type InstrumentKind = 'synth' | 'drums' | 'fx' | 'sampled' | 'custom' | 'slicer' | 'audio' | 'bus' | 'plugin' | 'return' | 'rack' | 'multi';

export const CATEGORIES = [
  'Drums & Percussion',
  'Bass',
  'Choir & Voices',
  'Pads & Atmospheres',
  'Orchestra',
  'Keys & Synths',
  'Guitars & Strings',
  'Winds & Brass',
  'Mallets & Bells',
  'World',
  'FX',
  'Sound Effects',
  'Chiptune',
  'Your Sounds',
] as const;
export type InstrumentCategory = (typeof CATEGORIES)[number];

export interface SampleSource {
  baseUrl: string;
  /** Tone note name -> file name under baseUrl */
  samples: Record<string, string>;
  /** Seconds a note rings on after release */
  release?: number;
  /**
   * Recordings that start slowly (a bow settling onto the string over up to half a second) are
   * trimmed when loaded to where they first reach this many dB under their peak, so short notes
   * speak at once instead of sounding far away.
   */
  onset?: number;
  /**
   * The soundfont renders stop dead at 3.1 s while the note is still at full level. When loaded,
   * the part from `from` to `to` seconds is looped (crossfaded) until the recording is `hold`
   * seconds long, so a held note sustains instead of cutting off.
   */
  sustain?: { from: number; to: number; hold: number };
  /** Cents to re-pitch each recording by when it loads (out-of-tune recordings; see sampleTuning.ts). */
  tune?: Record<string, number>;
  /**
   * Recordings of each note played at several loudnesses, softest first: the highest velocity
   * (0..1) each plays up to (the last is 1). Their names in `samples` are `note|layer|take`; a
   * note's takes at one loudness play in turn (round robin), so a repeated note never sounds
   * exactly the same twice.
   */
  layers?: number[];
  /** Where to fetch the files instead when `baseUrl` can't serve them (the page opened from a file, or hosted elsewhere). */
  fallbackUrl?: string;
  /** Changes when the files at these addresses do, so a kept copy is downloaded afresh (see recordingStore.ts) */
  version?: string;
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
  shaping?: Shaping;
  /** Level correction in dB so instruments start out at similar loudness (measured) */
  gain?: number;
  /**
   * Notes above the first MIDI number play quieter by the second number of dB per octave above
   * it: a violin's or erhu's top octave sits where the ear is most sensitive and pierces at the
   * same level that suits its middle.
   */
  taper?: [fromMidi: number, dbPerOctave: number];
  /**
   * Tone correction for recordings that sound far away: `presence` dB of upper-mid (where the
   * attack and bite of an instrument are, around `presenceHz`, 2.5 kHz unless set) and `mud` dB at
   * 300 Hz (negative: a cut of the boom a room adds).
   */
  tone?: { presence?: number; presenceHz?: number; mud?: number };
  /**
   * A bowed string, played as a string player would (see samplerManager.ts): a short note starts
   * `skip` seconds into its recording, past the bow's slow start, so fast passages speak; a note
   * starting while the one before still sounds is a legato change, crossfading from it without a
   * new bow attack; and a `solo` instrument plays at most two notes at once (a double stop), the
   * outer two of a chord.
   */
  bowed?: { skip: number; solo?: boolean };
  /**
   * Recorded at several loudnesses and sustained: the mod wheel (CC 1) crossfades the soft and loud
   * recordings while a note sounds (as orchestral sample libraries do). Every other instrument
   * takes the wheel as level and brightness (see instruments.ts).
   */
  dynamics?: boolean;
  /** Its notes wobble at their clip's wobble rate (Clip.wobble), chosen in the piano roll */
  wobble?: boolean;
  /**
   * Folded to mono by its track, after the inserts: the synthesized kits, whose noise is stereo
   * but which were voiced hearing it folded (the track strip used to fold everything there)
   */
  mono?: boolean;
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
  return soundfont('FluidR3_GM', instrument, lo, hi, step, release);
}

/** Sustained soundfont notes loop their steady part until they're 10 s long (see SampleSource.sustain). */
const SOUNDFONT_SUSTAIN = { from: 1.2, to: 3.0, hold: 10 };

/** A soundfont set rendered by midi-js-soundfonts (FluidR3_GM, MusyngKite, FatBoy): every note exists. */
function soundfont(font: string, instrument: string, lo: number, hi: number, step = 3, release = 1): SampleSource {
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
function nb(folder: string, files: string[], release = 1, onset?: number): SampleSource {
  const samples: Record<string, string> = {};
  for (const f of files) samples[f.replace('s', '#')] = `${f}.mp3`;
  return { baseUrl: `https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/${folder}/`, samples, release, onset };
}

/** The site the app is published on, which hosts the recordings in public/bos-beat-box-samples too. */
const SITE_SAMPLES = 'https://twobirdsworkshop.com/bos-beat-box-samples/';

/**
 * Recordings hosted with the app (public/bos-beat-box-samples/<folder>, converted by
 * scripts/real-samples/README.md): the MIDI notes `notes`, each at the loudnesses `layers` (see
 * SampleSource.layers) in `takes` takes, as <note>_<layer>_<take>.mp3 ("Cs3" = C#3). Next to the
 * page (relative), else from the site.
 */
function hosted(folder: string, notes: number[], layers: number[], takes: number, release: number): SampleSource {
  const samples: Record<string, string> = {};
  for (const m of notes) {
    const n = noteName(m);
    for (let l = 0; l < layers.length; l++) for (let t = 0; t < takes; t++) samples[`${n}|${l}|${t}`] = `${n.replace('#', 's')}_${l}_${t}.mp3`;
  }
  return { baseUrl: `bos-beat-box-samples/${folder}/`, fallbackUrl: `${SITE_SAMPLES}${folder}/`, samples, release, layers, version: HOSTED_SETS[folder]?.hash };
}
/** Velocity tops for a set recorded at `n` loudnesses (see SampleSource.layers) */
const LAYER_TOPS: Record<number, number[]> = { 1: [1], 2: [0.55, 1], 3: [0.35, 0.68, 1], 4: [0.3, 0.55, 0.8, 1] };
/** A set converted by scripts/real-samples (its notes, loudnesses and takes from hostedSets.ts) */
const real = (folder: string, release: number): SampleSource => {
  const set = HOSTED_SETS[folder];
  return hosted(folder, set.notes, LAYER_TOPS[set.layers], set.takes, release);
};
/** The notes a real set can play: from its lowest recording to a little past its highest (no higher than a piano's top C) */
const realRange = (folder: string, extend = 2): [number, number] => {
  const { notes } = HOSTED_SETS[folder];
  return [notes[0], Math.min(108, notes[notes.length - 1] + extend)];
};
/**
 * The horn sets have nothing between C4 and D5 (the library skipped them), too far to stretch
 * either side's recordings across, so the real horns play up to D#4.
 */
const HORN_RANGE: [number, number] = [33, 63];
/** The cello section's notes: every third or fourth semitone from the open C string up */
const CELLO_NOTES = [36, 40, 43, 47, 50, 53, 57, 60, 64, 67, 71, 74, 77];
/** The electric guitars' notes: every third semitone from the open low E */
const GUITAR_NOTES = Array.from({ length: 16 }, (_, i) => 40 + i * 3);

/**
 * Extra processing that turns a recording into the instrument: the erhu's nasal, vibrato-laden
 * bowing, an amp for the electric guitar's dull direct recording, a brighter acoustic guitar, the
 * mandolin's doubled strings. See samplerManager.ts.
 */
export type Shaping = 'erhu' | 'amp' | 'acoustic' | 'mandolin' | 'violin' | AmpModel;
/** Guitar amps for the real electric guitar recordings (direct from the pickup): see samplerManager.ts. */
export type AmpModel = 'cleanAmp' | 'crunchAmp' | 'leadAmp' | 'jazzAmp';

/** The solo violin set, every file it has (so no note is stretched more than a few semitones). */
const VIOLIN_FILES = ['A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6', 'A6', 'C7'];

/** A Musyng Kite soundfont instrument that plays on while held (its notes are looped past 3.1 s). */
const held = (instrument: string, lo: number, hi: number, release = 0.8, onset?: number): SampleSource => ({
  ...soundfont('MusyngKite', instrument, lo, hi, 3, release),
  sustain: SOUNDFONT_SUSTAIN,
  ...(onset !== undefined ? { onset } : {}),
});
/** A Musyng Kite soundfont instrument whose notes die away by themselves (plucked, struck). */
const struck = (instrument: string, lo: number, hi: number, release = 1): SampleSource => soundfont('MusyngKite', instrument, lo, hi, 3, release);

/** A Tone.js drum-samples kit: its kick, snare, hat and three toms on the drum rows (see DRUM_NOTES). */
function kit(folder: string): SampleSource {
  return {
    baseUrl: `https://tonejs.github.io/audio/drum-samples/${folder}/`,
    samples: { C1: 'kick.mp3', D1: 'snare.mp3', 'F#1': 'hihat.mp3', D2: 'tom1.mp3', B1: 'tom2.mp3', F1: 'tom3.mp3' },
    release: 0.2,
  };
}

// ---------- the catalog ----------

export const INSTRUMENTS: Record<InstrumentKey, InstrumentDef> = {
  // Drums & Percussion
  drums: { key: 'drums', name: 'Drums', blurb: 'Analog groove kit', color: '#f59e0b', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], mono: true },
  drumMachine: { key: 'drumMachine', name: 'Drum Machine', blurb: '808-style boom kit', color: '#ef4444', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], mono: true },
  taiko: { key: 'taiko', name: 'Taiko Drums', blurb: 'Big Japanese drums', color: '#b91c1c', category: 'Drums & Percussion', kind: 'sampled', range: [36, 72], samples: gm('taiko_drum', 36, 72, 4, 1.5), gain: 9 },

  // Bass
  bass: { key: 'bass', name: 'Slap Bass', blurb: 'Squelchy funk synth bass', color: '#06b6d4', category: 'Bass', kind: 'synth', range: [24, 55], taper: [41, 1.5] },
  subBass: { key: 'subBass', name: 'Sub-Bass', blurb: 'Deep sine sub', color: '#0e7490', category: 'Bass', kind: 'synth', range: [24, 48], gain: -10, taper: [37, 7] },
  bass808: { key: 'bass808', name: '808 Bass', blurb: 'Booming pitched 808', color: '#7c3aed', category: 'Bass', kind: 'synth', range: [24, 52], gain: -6, taper: [39, 2.5] },
  wobbleBass: { key: 'wobbleBass', name: 'Wobble Bass', blurb: 'Dubstep wobble, tempo-synced', color: '#84cc16', category: 'Bass', kind: 'synth', range: [24, 55], wobble: true, gain: -8, taper: [41, 3] },
  growlBass: { key: 'growlBass', name: 'Growl Bass', blurb: 'Talking riddim growl', color: '#d946ef', category: 'Bass', kind: 'synth', range: [24, 60], wobble: true, gain: -14, taper: [43, 2.5] },
  reeseBass: { key: 'reeseBass', name: 'Reese Bass', blurb: 'Detuned drum & bass Reese', color: '#6366f1', category: 'Bass', kind: 'synth', range: [24, 55], gain: -8, taper: [41, 2.5] },
  bassGuitar: {
    key: 'bassGuitar', name: 'Bass Guitar', blurb: 'Electric bass (recorded)', color: '#0891b2', category: 'Bass', kind: 'sampled', range: [28, 60],
    samples: nb('bass-electric', ['E1', 'G1', 'As1', 'Cs2', 'E2', 'G2', 'As2', 'Cs3', 'E3', 'G3', 'As3', 'Cs4'], 0.4), taper: [45, 3], tone: { presence: 4, presenceHz: 1500, mud: -2 },
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
  rhodes: { key: 'rhodes', name: 'Electric Piano', blurb: 'Vintage electric piano (recorded)', color: '#f472b6', category: 'Keys & Synths', kind: 'sampled', range: [33, 100], samples: gm('electric_piano_1', 33, 100, 3, 0.8), gain: 18.5 },
  keys: { key: 'keys', name: 'Space Clav', blurb: 'FM electric keys', color: '#a855f7', category: 'Keys & Synths', kind: 'synth', range: [36, 88], taper: [63, 4.5] },
  wavetable: { key: 'wavetable', name: 'Wavetable Synth', blurb: 'Evolving sweeping pad', color: '#38bdf8', category: 'Keys & Synths', kind: 'synth', range: [36, 96], taper: [67, 1] },
  lead: { key: 'lead', name: 'Analog Lead', blurb: 'Gliding saw lead', color: '#facc15', category: 'Keys & Synths', kind: 'synth', range: [48, 96], taper: [73, 1.5] },
  supersaw: { key: 'supersaw', name: 'Supersaw', blurb: 'Wide trance / house chords', color: '#fb7185', category: 'Keys & Synths', kind: 'synth', range: [36, 96], gain: -5, taper: [67, 2] },
  synthDesigner: { key: 'synthDesigner', name: 'Synth Designer', blurb: 'Build your own sound: oscillators, filter, LFO', color: '#22d3ee', category: 'Keys & Synths', kind: 'synth', range: [24, 108], taper: [67, 1] },
  pluck: { key: 'pluck', name: 'Pluck', blurb: 'Short bright EDM pluck', color: '#2dd4bf', category: 'Keys & Synths', kind: 'synth', range: [48, 96], gain: -6, taper: [73, 2] },
  pipeOrgan: { key: 'pipeOrgan', name: 'Pipe Organ', blurb: 'Church organ (recorded)', color: '#d4a373', category: 'Keys & Synths', kind: 'sampled', range: [24, 96], samples: gm('church_organ', 24, 96, 3, 0.6), gain: 15, taper: [61, 1.5] },

  // Guitars & Strings
  guitar: {
    key: 'guitar', name: 'Acoustic Guitar', blurb: 'Steel-string (recorded)', color: '#b45309', category: 'Guitars & Strings', kind: 'sampled', range: [40, 76],
    samples: nb('guitar-acoustic', ['D2', 'E2', 'Fs2', 'Gs2', 'As2', 'C3', 'D3', 'E3', 'Fs3', 'Gs3', 'As3', 'C4', 'D4', 'E4', 'Fs4', 'Gs4', 'As4', 'C5', 'D5']), shaping: 'acoustic', taper: [59, 8],
  },
  electricGuitar: {
    key: 'electricGuitar', name: 'Electric Guitar', blurb: 'Clean electric (recorded)', color: '#dc2626', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: nb('guitar-electric', ['Cs2', 'E2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6']), shaping: 'amp', taper: [64, 2],
  },
  mandolin: {
    key: 'mandolin', name: 'Mandolin', blurb: 'Modeled: bright steel strings, doubled', color: '#ca8a04', category: 'Guitars & Strings', kind: 'sampled', range: [55, 88],
    samples: gm('acoustic_guitar_steel', 55, 88, 3, 0.6), shaping: 'mandolin', gain: 18,
  },
  harp: {
    key: 'harp', name: 'Harp', blurb: 'Concert harp (recorded)', color: '#fde68a', category: 'Guitars & Strings', kind: 'sampled', range: [24, 100],
    samples: nb('harp', ['E1', 'G1', 'B1', 'D2', 'F2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4', 'C5', 'E5', 'G5', 'B5', 'D6', 'F6', 'A6', 'B6', 'D7', 'F7'], 1.5),
  },
  violin: {
    key: 'violin', name: 'Violin', blurb: 'Solo violin, close and dry', color: '#f87171', category: 'Guitars & Strings', kind: 'sampled', range: [55, 96],
    samples: { ...soundfont('MusyngKite', 'violin', 55, 96, 3, 0.5), sustain: SOUNDFONT_SUSTAIN, onset: -8 }, shaping: 'violin', gain: 25.5, taper: [76, 6], bowed: { skip: 0.03, solo: true },
  },
  cello: {
    key: 'cello', name: 'Cello', blurb: 'Solo cello, close and dry', color: '#ea580c', category: 'Guitars & Strings', kind: 'sampled', range: [36, 76],
    samples: { ...soundfont('MusyngKite', 'cello', 36, 76, 3, 0.6), sustain: SOUNDFONT_SUSTAIN, onset: -6 }, gain: 22, taper: [57, 6], tone: { presence: 4, mud: -2 }, bowed: { skip: 0.05, solo: true },
  },
  realCello: {
    key: 'realCello', name: 'Cellos (Real)', blurb: 'A recorded cello section, bowed with vibrato: soft and loud takes', color: '#c2410c', category: 'Guitars & Strings', kind: 'sampled', range: [36, 77],
    samples: hosted('cello-sustain', CELLO_NOTES, [0.55, 1], 1, 0.7), gain: 3, taper: [65, 4], bowed: { skip: 0.08 }, dynamics: true,
  },
  realCelloShort: {
    key: 'realCelloShort', name: 'Cellos Short (Real)', blurb: 'Recorded cellos, short bouncing bow strokes: ostinatos, drive', color: '#9a3412', category: 'Guitars & Strings', kind: 'sampled', range: [36, 77],
    samples: hosted('cello-spiccato', CELLO_NOTES, [0.55, 1], 2, 0.25), gain: 7, taper: [65, 4],
  },
  realGuitar: {
    key: 'realGuitar', name: 'Electric Guitar (Real)', blurb: 'A recorded electric through a clean amp: soft, medium and hard picking', color: '#e11d48', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: hosted('guitar-black', GUITAR_NOTES, [0.35, 0.68, 1], 2, 0.3), shaping: 'cleanAmp', gain: -4, taper: [64, 2],
  },
  realCrunchGuitar: {
    key: 'realCrunchGuitar', name: 'Crunch Guitar (Real)', blurb: 'The recorded electric through a pushed amp: rock rhythm', color: '#be123c', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: hosted('guitar-black', GUITAR_NOTES, [0.35, 0.68, 1], 2, 0.25), shaping: 'crunchAmp', gain: -8.5, taper: [64, 2],
  },
  realLeadGuitar: {
    key: 'realLeadGuitar', name: 'Distortion Guitar (Real)', blurb: 'The recorded electric through a high-gain amp: riffs, power chords, leads', color: '#9f1239', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: hosted('guitar-black', GUITAR_NOTES, [0.35, 0.68, 1], 2, 0.2), shaping: 'leadAmp', gain: -14, taper: [64, 2],
  },
  realHollowGuitar: {
    key: 'realHollowGuitar', name: 'Hollow-Body Guitar (Real)', blurb: 'A recorded hollow-body electric through a warm clean amp: jazz, soul, rockabilly', color: '#a16207', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: hosted('guitar-green', GUITAR_NOTES, [0.35, 0.68, 1], 2, 0.35), shaping: 'jazzAmp', gain: 4, taper: [64, 2],
  },
  realFlatwoundGuitar: {
    key: 'realFlatwoundGuitar', name: 'Flatwound Guitar (Real)', blurb: 'A recorded electric with flatwound strings, warm and round: jazz, soul', color: '#b45309', category: 'Guitars & Strings', kind: 'sampled', range: realRange('guitar-flatwound'),
    samples: real('guitar-flatwound', 0.3), gain: 4.5, taper: [70, 4.5], shaping: 'cleanAmp',
  },
  realViolins: {
    key: 'realViolins', name: 'Violins (Real)', blurb: 'A recorded violin section, bowed with vibrato: soft and loud takes', color: '#ef4444', category: 'Orchestra', kind: 'sampled', range: realRange('violins-sustain'),
    samples: real('violins-sustain', 0.7), shaping: 'violin', gain: 14, taper: [70, 2.5], bowed: { skip: 0.12 }, dynamics: true,
  },
  realViolinsShort: {
    key: 'realViolinsShort', name: 'Violins Short (Real)', blurb: 'Recorded violins, short bouncing strokes: ostinatos, action', color: '#dc2626', category: 'Orchestra', kind: 'sampled', range: realRange('violins-spiccato'),
    samples: real('violins-spiccato', 0.25), gain: 5, taper: [70, 4],
  },
  realViolas: {
    key: 'realViolas', name: 'Violas (Real)', blurb: 'A recorded viola section, bowed with vibrato: warm middle voices', color: '#f97316', category: 'Orchestra', kind: 'sampled', range: realRange('violas-sustain'),
    samples: real('violas-sustain', 0.7), gain: 11, taper: [69, 1], bowed: { skip: 0.1 }, dynamics: true,
  },
  realViolasShort: {
    key: 'realViolasShort', name: 'Violas Short (Real)', blurb: 'Recorded violas, short bouncing strokes', color: '#ea580c', category: 'Orchestra', kind: 'sampled', range: realRange('violas-spiccato'),
    samples: real('violas-spiccato', 0.25), gain: 7.5, taper: [69, 4.5],
  },
  realPizzicato: {
    key: 'realPizzicato', name: 'Pizzicato Section (Real)', blurb: 'Recorded cellos, violas and violins plucking, low to high', color: '#fb7185', category: 'Orchestra', kind: 'sampled', range: realRange('strings-pizzicato'),
    samples: real('strings-pizzicato', 0.4), gain: 18, taper: [69, 1],
  },
  realTremolo: {
    key: 'realTremolo', name: 'Tremolo Section (Real)', blurb: 'Recorded strings trembling the bow: tension, suspense', color: '#e11d48', category: 'Orchestra', kind: 'sampled', range: realRange('strings-tremolo'),
    samples: real('strings-tremolo', 0.6), gain: 11, taper: [69, 2.5], dynamics: true,
  },
  realSoloViolin: {
    key: 'realSoloViolin', name: 'Solo Violin (Real)', blurb: 'One recorded violin with vibrato, soft and loud: melodies', color: '#f87171', category: 'Orchestra', kind: 'sampled', range: realRange('solo-violin'),
    samples: real('solo-violin', 0.5), shaping: 'violin', gain: 14, taper: [74, 3], bowed: { skip: 0.03, solo: true }, dynamics: true,
  },
  realDoubleBass: {
    key: 'realDoubleBass', name: 'Double Bass (Real)', blurb: 'A recorded double bass, bowed: the floor of the orchestra', color: '#7c2d12', category: 'Orchestra', kind: 'sampled', range: realRange('double-bass'),
    samples: real('double-bass', 0.5), gain: 20, taper: [51, 1.5], bowed: { skip: 0.1 }, dynamics: true,
  },
  realHarp: {
    key: 'realHarp', name: 'Harp (Real)', blurb: 'A recorded concert harp: arpeggios, glissandos, magic', color: '#fbbf24', category: 'Orchestra', kind: 'sampled', range: realRange('harp'),
    samples: real('harp', 1.5), gain: 4.5,
  },
  realFlute: {
    key: 'realFlute', name: 'Flute (Real)', blurb: 'A recorded flute with vibrato: soaring melodies', color: '#7dd3fc', category: 'Orchestra', kind: 'sampled', range: realRange('flute'),
    samples: real('flute', 0.35), gain: 8, taper: [78, 12],
  },
  realFluteShort: {
    key: 'realFluteShort', name: 'Flute Short (Real)', blurb: 'Recorded flute, short tongued notes: soft, medium and loud', color: '#38bdf8', category: 'Orchestra', kind: 'sampled', range: realRange('flute-staccato'),
    samples: real('flute-staccato', 0.2), gain: 17.5, taper: [78, 9],
  },
  realOboe: {
    key: 'realOboe', name: 'Oboe (Real)', blurb: 'A recorded oboe with vibrato: plaintive, pastoral', color: '#a3e635', category: 'Orchestra', kind: 'sampled', range: realRange('oboe'),
    samples: real('oboe', 0.3), gain: 0.5, taper: [73, 0.5], dynamics: true,
  },
  realClarinet: {
    key: 'realClarinet', name: 'Clarinet (Real)', blurb: 'A recorded clarinet: soft, medium and loud, from dark low notes to a bright top', color: '#4ade80', category: 'Orchestra', kind: 'sampled', range: realRange('clarinet'),
    samples: real('clarinet', 0.3), gain: 5, taper: [71, 10], dynamics: true,
  },
  realBassoon: {
    key: 'realBassoon', name: 'Bassoon (Real)', blurb: 'A recorded bassoon with vibrato: woody, comic or noble', color: '#a16207', category: 'Orchestra', kind: 'sampled', range: realRange('bassoon'),
    samples: real('bassoon', 0.3), gain: 0.5, taper: [55, 1.5], dynamics: true,
  },
  realHorn: {
    key: 'realHorn', name: 'French Horn (Real)', blurb: 'A recorded French horn, low and middle register: soft, medium and loud, heroic and warm', color: '#facc15', category: 'Orchestra', kind: 'sampled', range: HORN_RANGE,
    samples: real('horn', 0.4), gain: 16, taper: [45, 3], dynamics: true,
  },
  realHornShort: {
    key: 'realHornShort', name: 'French Horn Short (Real)', blurb: 'Recorded horn, short punchy notes: fanfares, hits', color: '#eab308', category: 'Orchestra', kind: 'sampled', range: HORN_RANGE,
    samples: real('horn-staccato', 0.25), gain: 18, taper: [45, 4.5],
  },
  realTrumpet: {
    key: 'realTrumpet', name: 'Trumpet (Real)', blurb: 'A recorded trumpet with vibrato: soft and loud', color: '#fde047', category: 'Orchestra', kind: 'sampled', range: realRange('trumpet'),
    samples: real('trumpet', 0.35), gain: -0.5, taper: [68, 4.5], dynamics: true,
  },
  realTrumpetShort: {
    key: 'realTrumpetShort', name: 'Trumpet Short (Real)', blurb: 'Recorded trumpet, short stabs: fanfares, ska, funk', color: '#fcd34d', category: 'Orchestra', kind: 'sampled', range: realRange('trumpet-staccato'),
    samples: real('trumpet-staccato', 0.2), gain: 12, taper: [68, 7.5],
  },
  realTrombone: {
    key: 'realTrombone', name: 'Trombone (Real)', blurb: 'A recorded tenor trombone: soft, medium and loud', color: '#d97706', category: 'Orchestra', kind: 'sampled', range: realRange('trombone'),
    samples: real('trombone', 0.4), gain: 14, taper: [49, 7.5], dynamics: true,
  },
  realTromboneShort: {
    key: 'realTromboneShort', name: 'Trombone Short (Real)', blurb: 'Recorded trombone, short notes at four loudnesses: stabs, hits', color: '#b45309', category: 'Orchestra', kind: 'sampled', range: realRange('trombone-staccato'),
    samples: real('trombone-staccato', 0.25), gain: 11.5, taper: [49, 2.5],
  },
  realTuba: {
    key: 'realTuba', name: 'Tuba (Real)', blurb: 'A recorded tuba: soft, medium and loud, a deep brass floor', color: '#92400e', category: 'Orchestra', kind: 'sampled', range: realRange('tuba'),
    samples: real('tuba', 0.4), gain: 4, taper: [44, 5], dynamics: true,
  },
  realGrandPiano: {
    key: 'realGrandPiano', name: 'Concert Grand (Real)', blurb: 'A recorded concert grand at four loudnesses: soft and warm to bright and hard', color: '#f8fafc', category: 'Keys & Synths', kind: 'sampled', range: realRange('grand-piano'),
    samples: real('grand-piano', 0.6), gain: -10,
  },
  realUprightPiano: {
    key: 'realUprightPiano', name: 'Upright Piano (Real)', blurb: 'A recorded upright piano, three loudnesses: intimate, homely', color: '#e7e5e4', category: 'Keys & Synths', kind: 'sampled', range: realRange('upright-piano'),
    samples: real('upright-piano', 0.5), gain: -6.5,
  },
  realPipeOrgan: {
    key: 'realPipeOrgan', name: 'Pipe Organ (Real)', blurb: 'A recorded church organ, full and open, with its pedal pipes', color: '#c4b5fd', category: 'Keys & Synths', kind: 'sampled', range: realRange('pipe-organ'),
    samples: real('pipe-organ', 0.4), gain: 14,
  },
  realChapelOrgan: {
    key: 'realChapelOrgan', name: 'Chapel Organ (Real)', blurb: 'The recorded organ on a quiet, gentle stop', color: '#a78bfa', category: 'Keys & Synths', kind: 'sampled', range: realRange('chapel-organ'),
    samples: real('chapel-organ', 0.4), gain: 3.5, taper: [78, 5],
  },
  realMarimba: {
    key: 'realMarimba', name: 'Marimba (Real)', blurb: 'A recorded marimba: warm wooden bars', color: '#d6a35c', category: 'Mallets & Bells', kind: 'sampled', range: realRange('marimba'),
    samples: real('marimba', 0.8), gain: -4,
  },
  realXylophone: {
    key: 'realXylophone', name: 'Xylophone (Real)', blurb: 'A recorded xylophone: bright, dry and quick', color: '#fb923c', category: 'Mallets & Bells', kind: 'sampled', range: realRange('xylophone'),
    samples: real('xylophone', 0.4), gain: -1,
  },
  realGlockenspiel: {
    key: 'realGlockenspiel', name: 'Glockenspiel (Real)', blurb: 'A recorded glockenspiel: sparkling steel bars', color: '#e0f2fe', category: 'Mallets & Bells', kind: 'sampled', range: realRange('glockenspiel'),
    samples: real('glockenspiel', 1.5), gain: 1.5,
  },
  realAltoSax: {
    key: 'realAltoSax', name: 'Alto Sax (Real)', blurb: 'A recorded alto saxophone, soft and loud: jazz, pop, soul', color: '#f59e0b', category: 'Winds & Brass', kind: 'sampled', range: realRange('alto-sax'),
    samples: real('alto-sax', 0.25), gain: -1.5, taper: [61, 4], dynamics: true,
  },
  realBariSax: {
    key: 'realBariSax', name: 'Baritone Sax (Real)', blurb: 'A recorded 1920s baritone saxophone: big, buzzing low end', color: '#b45309', category: 'Winds & Brass', kind: 'sampled', range: realRange('baritone-sax'),
    samples: real('baritone-sax', 0.25), gain: 11.5, taper: [49, 4], dynamics: true,
  },
  realUprightBass: {
    key: 'realUprightBass', name: 'Upright Bass (Real)', blurb: 'A recorded double bass, plucked at four loudnesses: jazz, swing', color: '#155e75', category: 'Bass', kind: 'sampled', range: realRange('upright-bass'),
    samples: real('upright-bass', 0.3), gain: 10, taper: [42, 1],
  },
  realElectricBass: {
    key: 'realElectricBass', name: 'Electric Bass (Real)', blurb: 'A recorded fingered electric bass at four loudnesses', color: '#0e7490', category: 'Bass', kind: 'sampled', range: realRange('electric-bass'),
    samples: real('electric-bass', 0.25), gain: 9, taper: [46, 5],
  },
  strings: {
    key: 'strings', name: 'Strings', blurb: 'String section: pads and swells', color: '#fb7185', category: 'Guitars & Strings', kind: 'sampled', range: [36, 96],
    samples: { ...soundfont('MusyngKite', 'string_ensemble_1', 36, 96, 3, 0.9), sustain: SOUNDFONT_SUSTAIN, onset: -7 }, gain: 17, taper: [84, 6], tone: { presence: 3, mud: -2 },
  },

  // Winds & Brass
  brass: { key: 'brass', name: 'Brass Stabs', blurb: 'Synth horn section', color: '#22c55e', category: 'Winds & Brass', kind: 'synth', range: [48, 84], taper: [67, 3] },
  saxophone: {
    key: 'saxophone', name: 'Saxophone', blurb: 'Alto sax (recorded)', color: '#eab308', category: 'Winds & Brass', kind: 'sampled', range: [49, 80],
    samples: nb('saxophone', ['Cs3', 'Ds3', 'F3', 'G3', 'As3', 'C4', 'D4', 'E4', 'Fs4', 'Gs4', 'As4', 'C5', 'D5', 'E5', 'Fs5', 'Gs5'], 0.5), taper: [66, 5.5], gain: -1.5,
  },
  trumpet: {
    key: 'trumpet', name: 'Trumpet', blurb: 'Solo trumpet (recorded)', color: '#f97316', category: 'Winds & Brass', kind: 'sampled', range: [52, 84],
    samples: nb('trumpet', ['F3', 'A3', 'C4', 'Ds4', 'F4', 'G4', 'As4', 'D5', 'F5', 'A5', 'C6'], 0.4), taper: [69, 6],
  },
  frenchHorn: {
    key: 'frenchHorn', name: 'French Horn', blurb: 'Warm orchestral horn (recorded)', color: '#c2410c', category: 'Winds & Brass', kind: 'sampled', range: [33, 77],
    samples: nb('french-horn', ['A1', 'C2', 'Ds2', 'G2', 'D3', 'F3', 'A3', 'C4', 'D5', 'F5'], 0.6, -12), taper: [56, 4.5], tone: { presence: 6, mud: -3 },
  },
  flute: {
    key: 'flute', name: 'Flute', blurb: 'Concert flute (recorded)', color: '#93c5fd', category: 'Winds & Brass', kind: 'sampled', range: [60, 96],
    samples: nb('flute', ['C4', 'E4', 'A4', 'C5', 'E5', 'A5', 'C6', 'E6', 'A6', 'C7'], 0.5), taper: [84, 8], gain: -4,
  },

  // Mallets & Bells
  marimba: { key: 'marimba', name: 'Marimba', blurb: 'Wooden mallets (recorded)', color: '#a16207', category: 'Mallets & Bells', kind: 'sampled', range: [45, 96], samples: gm('marimba', 45, 96, 3, 0.8), gain: 14, taper: [72, 2.5] },
  chimes: { key: 'chimes', name: 'Chimes', blurb: 'Tubular bells (recorded)', color: '#cbd5e1', category: 'Mallets & Bells', kind: 'sampled', range: [48, 84], samples: gm('tubular_bells', 48, 84, 3, 3), gain: 12 },

  // World
  erhu: {
    key: 'erhu', name: 'Erhu', blurb: 'Bowed strings, nasal tone, wide vibrato', color: '#be123c', category: 'World', kind: 'sampled', range: [62, 93],
    samples: nb('violin', VIOLIN_FILES, 0.5, -10), shaping: 'erhu', gain: -2.5, taper: [79, 5],
  },

  // Chiptune
  chipLead: { key: 'chipLead', name: 'Chip Lead', blurb: '8-bit pulse lead with vibrato', color: '#a3e635', category: 'Chiptune', kind: 'synth', range: [48, 96], taper: [73, 2] },
  chipBass: { key: 'chipBass', name: 'Chip Bass', blurb: '8-bit stepped triangle bass', color: '#22d3ee', category: 'Chiptune', kind: 'synth', range: [28, 72], taper: [51, 3.5] },
  chipDrums: { key: 'chipDrums', name: 'Chip Drums', blurb: '8-bit noise kit', color: '#f472b6', category: 'Chiptune', kind: 'drums', range: [36, 48], mono: true },

  // Recorded drum kits (the rows a kit has no recording of play synthesized hits)
  acousticKit: { key: 'acousticKit', name: 'Acoustic Kit', blurb: 'Real drum kit (recorded): rock, pop, jazz', color: '#d97706', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('acoustic-kit'), gain: -1 },
  breakbeatKit: { key: 'breakbeatKit', name: 'Breakbeat Kit', blurb: 'Crunchy sampled break hits', color: '#c2410c', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('breakbeat9'), gain: 2 },
  linnDrum: { key: 'linnDrum', name: 'LinnDrum', blurb: '80s drum machine: synthwave, pop', color: '#e11d48', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('LINN'), gain: -3 },
  cr78: { key: 'cr78', name: 'CR-78', blurb: 'Vintage rhythm box', color: '#9a3412', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('CR78'), gain: -2 },
  technoKit: { key: 'technoKit', name: 'Techno Kit', blurb: 'Hard electronic kit', color: '#be185d', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('Techno') },
  bongos: { key: 'bongos', name: 'Bongos & Percussion', blurb: 'Hand drums for Latin grooves', color: '#a16207', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('Bongos'), gain: -1 },
  timpani: { key: 'timpani', name: 'Timpani', blurb: 'Orchestral kettle drums', color: '#7f1d1d', category: 'Orchestra', kind: 'sampled', range: [36, 60], samples: struck('timpani', 36, 60, 2), gain: 16 },

  // Choir & Voices
  choir: { key: 'choir', name: 'Choir', blurb: 'Choir singing "aah": angelic, sacred', color: '#fef3c7', category: 'Choir & Voices', kind: 'sampled', range: [43, 84], samples: held('choir_aahs', 43, 84, 1.2, -16), gain: 21, taper: [65, 2.5], tone: { presence: 2, mud: -1 } },
  voiceOohs: { key: 'voiceOohs', name: 'Voices "Ooh"', blurb: 'Soft breathy voices: heavenly', color: '#fde68a', category: 'Choir & Voices', kind: 'sampled', range: [48, 84], samples: held('voice_oohs', 48, 84, 1.2), gain: 17, taper: [67, 5], tone: { presence: 3 } },
  synthChoir: { key: 'synthChoir', name: 'Synth Choir', blurb: 'Airy 80s synth voices', color: '#e9d5ff', category: 'Choir & Voices', kind: 'sampled', range: [43, 88], samples: held('synth_choir', 43, 88, 1.2), gain: 17, taper: [67, 3.5] },

  // Pads & Atmospheres
  haloPad: { key: 'haloPad', name: 'Halo Pad', blurb: 'Shimmering angelic pad', color: '#fef9c3', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('pad_7_halo', 36, 96, 1.5), gain: 21, taper: [67, 2.5] },
  warmPad: { key: 'warmPad', name: 'Warm Pad', blurb: 'Soft analog pad', color: '#fdba74', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('pad_2_warm', 36, 96, 1.5), gain: 10, taper: [67, 7] },
  newAgePad: { key: 'newAgePad', name: 'New Age Pad', blurb: 'Bell-like dreamy pad', color: '#c4b5fd', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('pad_1_new_age', 36, 96, 1.5), gain: 13, taper: [67, 3.5] },
  choirPad: { key: 'choirPad', name: 'Choir Pad', blurb: 'Voices blended into a pad', color: '#fbcfe8', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('pad_4_choir', 36, 96, 1.5), gain: 13, taper: [67, 1.5] },
  glassPad: { key: 'glassPad', name: 'Glass Pad', blurb: 'Bowed glass, ethereal', color: '#a5f3fc', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('pad_5_bowed', 36, 96, 1.5), gain: 18, taper: [67, 4] },
  sweepPad: { key: 'sweepPad', name: 'Sweep Pad', blurb: 'Slowly sweeping pad', color: '#93c5fd', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('pad_8_sweep', 36, 96, 1.5), gain: 18, taper: [67, 2.5] },
  atmosphere: { key: 'atmosphere', name: 'Atmosphere', blurb: 'Plucked shimmer with a long air', color: '#99f6e4', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: struck('fx_4_atmosphere', 36, 96, 2), gain: 17, taper: [67, 3.5] },
  crystal: { key: 'crystal', name: 'Crystal', blurb: 'Sparkling glassy bells', color: '#e0f2fe', category: 'Pads & Atmospheres', kind: 'sampled', range: [48, 96], samples: struck('fx_3_crystal', 48, 96, 2), gain: 23, taper: [73, 2.5] },
  sciFi: { key: 'sciFi', name: 'Sci-Fi', blurb: 'Space drone with movement', color: '#818cf8', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 84], samples: held('fx_8_scifi', 36, 84, 1.5), gain: 19, taper: [61, 2.5] },
  goblins: { key: 'goblins', name: 'Goblins', blurb: 'Eerie swelling drone: horror', color: '#4d7c0f', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 84], samples: held('fx_6_goblins', 36, 84, 1.5), gain: 5, taper: [61, 5] },

  // Orchestra
  viola: { key: 'viola', name: 'Viola', blurb: 'Solo viola, warm middle voice', color: '#f97316', category: 'Orchestra', kind: 'sampled', range: [48, 88], samples: held('viola', 48, 88, 0.6, -6), bowed: { skip: 0.04, solo: true }, gain: 23, taper: [69, 2.5], tone: { presence: 2, mud: -1 } },
  contrabass: { key: 'contrabass', name: 'Contrabass', blurb: 'Orchestral double bass, bowed', color: '#9a3412', category: 'Orchestra', kind: 'sampled', range: [28, 60], samples: held('contrabass', 28, 60, 0.6, -6), bowed: { skip: 0.03 }, gain: 22.5, taper: [45, 2], tone: { presence: 5, presenceHz: 1800, mud: -3 } },
  pizzicato: { key: 'pizzicato', name: 'Pizzicato Strings', blurb: 'Plucked string section', color: '#fda4af', category: 'Orchestra', kind: 'sampled', range: [36, 96], samples: soundfont('FluidR3_GM', 'pizzicato_strings', 36, 96, 1, 0.4), gain: 28, taper: [70, 1] },
  tremolo: { key: 'tremolo', name: 'Tremolo Strings', blurb: 'Trembling strings: tension, suspense', color: '#f43f5e', category: 'Orchestra', kind: 'sampled', range: [36, 96], samples: held('tremolo_strings', 36, 96, 0.8, -8), gain: 20, taper: [84, 6], tone: { presence: 2, mud: -1 } },
  slowStrings: { key: 'slowStrings', name: 'Slow Strings', blurb: 'Soft swelling string section', color: '#fecdd3', category: 'Orchestra', kind: 'sampled', range: [36, 96], samples: held('string_ensemble_2', 36, 96, 1), gain: 27, taper: [67, 3], tone: { presence: 3, mud: -2 } },
  synthStrings: { key: 'synthStrings', name: 'Synth Strings', blurb: '80s string machine', color: '#f9a8d4', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('synth_strings_1', 36, 96, 1, -8), gain: 23, taper: [67, 1], tone: { presence: 2 } },
  orchestraHit: { key: 'orchestraHit', name: 'Orchestra Hit', blurb: 'The whole orchestra in one stab', color: '#dc2626', category: 'Orchestra', kind: 'sampled', range: [48, 72], samples: struck('orchestra_hit', 48, 72, 0.6), gain: 24, taper: [61, 2] },
  oboe: { key: 'oboe', name: 'Oboe', blurb: 'Reedy, singing woodwind', color: '#86efac', category: 'Orchestra', kind: 'sampled', range: [58, 91], samples: held('oboe', 58, 91, 0.4), gain: 21.5, taper: [81, 5] },
  clarinet: { key: 'clarinet', name: 'Clarinet', blurb: 'Round, mellow woodwind', color: '#4ade80', category: 'Orchestra', kind: 'sampled', range: [50, 91], samples: held('clarinet', 50, 91, 0.4), gain: 17, taper: [72, 5.5] },
  bassoon: { key: 'bassoon', name: 'Bassoon', blurb: 'Low woodwind, playful or dark', color: '#15803d', category: 'Orchestra', kind: 'sampled', range: [34, 72], samples: held('bassoon', 34, 72, 0.4, -12), gain: 22, tone: { presence: 5, mud: -2 } },
  englishHorn: { key: 'englishHorn', name: 'English Horn', blurb: 'Melancholy alto oboe', color: '#22c55e', category: 'Orchestra', kind: 'sampled', range: [52, 81], samples: held('english_horn', 52, 81, 0.4), gain: 15.5, taper: [68, 3] },
  piccolo: { key: 'piccolo', name: 'Piccolo', blurb: 'Tiny bright flute', color: '#bfdbfe', category: 'Orchestra', kind: 'sampled', range: [74, 102], samples: held('piccolo', 74, 102, 0.3), gain: 20.5, taper: [86, 8] },
  recorder: { key: 'recorder', name: 'Recorder', blurb: 'Pure wooden whistle: medieval, folk', color: '#d9f99d', category: 'Orchestra', kind: 'sampled', range: [60, 96], samples: held('recorder', 60, 96, 0.3), gain: 19, taper: [84, 8] },
  trombone: { key: 'trombone', name: 'Trombone', blurb: 'Big low brass', color: '#ea580c', category: 'Orchestra', kind: 'sampled', range: [40, 72], samples: held('trombone', 40, 72, 0.4, -12), gain: 23.5, tone: { presence: 5, mud: -2 } },
  tuba: { key: 'tuba', name: 'Tuba', blurb: 'The deepest brass', color: '#7c2d12', category: 'Orchestra', kind: 'sampled', range: [28, 58], samples: held('tuba', 28, 58, 0.4, -12), gain: 13, taper: [44, 2.5], tone: { presence: 5, presenceHz: 1800, mud: -2 } },
  brassSection: { key: 'brassSection', name: 'Brass Section', blurb: 'Full brass: fanfares, epic', color: '#f59e0b', category: 'Orchestra', kind: 'sampled', range: [40, 84], samples: held('brass_section', 40, 84, 0.4, -14), gain: 21, taper: [63, 1.5] },
  mutedTrumpet: { key: 'mutedTrumpet', name: 'Muted Trumpet', blurb: 'Jazzy muted trumpet', color: '#fb923c', category: 'Winds & Brass', kind: 'sampled', range: [52, 82], samples: held('muted_trumpet', 52, 82, 0.4), gain: 16, taper: [68, 8] },
  tenorSax: { key: 'tenorSax', name: 'Tenor Sax', blurb: 'Smoky tenor saxophone', color: '#ca8a04', category: 'Winds & Brass', kind: 'sampled', range: [44, 75], samples: held('tenor_sax', 44, 75, 0.4), gain: 19, taper: [61, 7.5] },

  // Keys, mallets and bells
  harpsichord: { key: 'harpsichord', name: 'Harpsichord', blurb: 'Baroque plucked keyboard', color: '#b45309', category: 'Keys & Synths', kind: 'sampled', range: [41, 89], samples: struck('harpsichord', 41, 89, 0.4), gain: 20, taper: [66, 1] },
  drawbarOrgan: { key: 'drawbarOrgan', name: 'Drawbar Organ', blurb: 'Tonewheel organ: gospel, soul, jazz', color: '#a16207', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('drawbar_organ', 36, 96, 0.3), gain: 23, taper: [67, 1] },
  rockOrgan: { key: 'rockOrgan', name: 'Rock Organ', blurb: 'Gritty rock organ', color: '#92400e', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('rock_organ', 36, 96, 0.3), gain: 19, taper: [67, 3] },
  celesta: { key: 'celesta', name: 'Celesta', blurb: 'Music-box bells: magical, sugar-plum', color: '#fef08a', category: 'Mallets & Bells', kind: 'sampled', range: [60, 108], samples: struck('celesta', 60, 108, 1.5), gain: 14, taper: [85, 1.5] },
  glockenspiel: { key: 'glockenspiel', name: 'Glockenspiel', blurb: 'Bright steel bells', color: '#e5e7eb', category: 'Mallets & Bells', kind: 'sampled', range: [72, 108], samples: struck('glockenspiel', 72, 108, 1.5), gain: 24 },
  musicBox: { key: 'musicBox', name: 'Music Box', blurb: 'Tinkling music box', color: '#fbcfe8', category: 'Mallets & Bells', kind: 'sampled', range: [60, 96], samples: struck('music_box', 60, 96, 1.5), gain: 22 },
  vibraphone: { key: 'vibraphone', name: 'Vibraphone', blurb: 'Jazz vibes, soft and round', color: '#a5b4fc', category: 'Mallets & Bells', kind: 'sampled', range: [53, 89], samples: struck('vibraphone', 53, 89, 1.5), gain: 16, taper: [72, 2] },
  xylophone: { key: 'xylophone', name: 'Xylophone', blurb: 'Dry bright wood bars', color: '#fcd34d', category: 'Mallets & Bells', kind: 'sampled', range: [65, 96], samples: struck('xylophone', 65, 96, 0.6), gain: 17, taper: [82, 3] },

  // Guitars and basses
  nylonGuitar: { key: 'nylonGuitar', name: 'Classical Guitar', blurb: 'Nylon strings: Spanish, classical', color: '#d6a35c', category: 'Guitars & Strings', kind: 'sampled', range: [40, 84], samples: struck('acoustic_guitar_nylon', 40, 84, 0.8), gain: 20 },
  distortionGuitar: { key: 'distortionGuitar', name: 'Distortion Guitar', blurb: 'Heavy rock and metal', color: '#991b1b', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86], samples: held('distortion_guitar', 40, 86, 0.3), gain: 16.5, taper: [64, 1.5] },
  overdriveGuitar: { key: 'overdriveGuitar', name: 'Overdrive Guitar', blurb: 'Crunchy rock guitar', color: '#b91c1c', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86], samples: held('overdriven_guitar', 40, 86, 0.3), gain: 18, taper: [64, 2] },
  mutedGuitar: { key: 'mutedGuitar', name: 'Muted Guitar', blurb: 'Palm-muted funk and pop chugs', color: '#dc2626', category: 'Guitars & Strings', kind: 'sampled', range: [40, 76], samples: struck('electric_guitar_muted', 40, 76, 0.2), gain: 23, taper: [59, 3.5] },
  banjo: { key: 'banjo', name: 'Banjo', blurb: 'Bright twangy folk and country', color: '#eab308', category: 'Guitars & Strings', kind: 'sampled', range: [48, 84], samples: struck('banjo', 48, 84, 0.5), gain: 20, taper: [67, 1] },
  uprightBass: { key: 'uprightBass', name: 'Upright Bass', blurb: 'Plucked double bass: jazz', color: '#155e75', category: 'Bass', kind: 'sampled', range: [28, 60], samples: struck('acoustic_bass', 28, 60, 0.4), gain: 20, taper: [45, 2.5], tone: { presence: 5, presenceHz: 1500, mud: -2 } },
  fretlessBass: { key: 'fretlessBass', name: 'Fretless Bass', blurb: 'Smooth singing bass', color: '#0e7490', category: 'Bass', kind: 'sampled', range: [28, 60], samples: struck('fretless_bass', 28, 60, 0.4), gain: 15, taper: [45, 2.5], tone: { presence: 5, presenceHz: 1500, mud: -2 } },

  // World and folk
  fiddle: { key: 'fiddle', name: 'Fiddle', blurb: 'Folk and Celtic fiddle', color: '#e11d48', category: 'World', kind: 'sampled', range: [55, 93], samples: held('fiddle', 55, 93, 0.4), gain: 18, taper: [79, 5] },
  sitar: { key: 'sitar', name: 'Sitar', blurb: 'Indian buzzing strings', color: '#f59e0b', category: 'World', kind: 'sampled', range: [48, 84], samples: struck('sitar', 48, 84, 1), gain: 23 },
  koto: { key: 'koto', name: 'Koto', blurb: 'Japanese zither', color: '#fb7185', category: 'World', kind: 'sampled', range: [48, 88], samples: struck('koto', 48, 88, 1), gain: 14 },
  shamisen: { key: 'shamisen', name: 'Shamisen', blurb: 'Japanese banjo-like lute', color: '#f43f5e', category: 'World', kind: 'sampled', range: [50, 84], samples: struck('shamisen', 50, 84, 0.6), gain: 24, taper: [68, 1] },
  shakuhachi: { key: 'shakuhachi', name: 'Shakuhachi', blurb: 'Breathy Japanese bamboo flute', color: '#84cc16', category: 'World', kind: 'sampled', range: [55, 88], samples: held('shakuhachi', 55, 88, 0.4), gain: 14, taper: [73, 3] },
  panFlute: { key: 'panFlute', name: 'Pan Flute', blurb: 'Airy pipes: Andes, fantasy', color: '#bef264', category: 'World', kind: 'sampled', range: [60, 96], samples: held('pan_flute', 60, 96, 0.4), gain: 17.5, taper: [84, 8] },
  ocarina: { key: 'ocarina', name: 'Ocarina', blurb: 'Round clay flute: adventure games', color: '#a3e635', category: 'World', kind: 'sampled', range: [60, 96], samples: held('ocarina', 60, 96, 0.3), gain: 11.5, taper: [84, 8] },
  bagpipe: { key: 'bagpipe', name: 'Bagpipes', blurb: 'Scottish pipes and drone', color: '#65a30d', category: 'World', kind: 'sampled', range: [58, 84], samples: held('bagpipe', 58, 84, 0.3), gain: 20, taper: [72, 4.5] },
  accordion: { key: 'accordion', name: 'Accordion', blurb: 'French and folk squeezebox', color: '#dc2626', category: 'World', kind: 'sampled', range: [48, 89], samples: held('accordion', 48, 89, 0.3), gain: 22, taper: [70, 1.5] },
  harmonica: { key: 'harmonica', name: 'Harmonica', blurb: 'Blues harp', color: '#64748b', category: 'World', kind: 'sampled', range: [60, 84], samples: held('harmonica', 60, 84, 0.3), gain: 17 },
  kalimba: { key: 'kalimba', name: 'Kalimba', blurb: 'African thumb piano: cozy, gentle', color: '#d97706', category: 'World', kind: 'sampled', range: [48, 84], samples: struck('kalimba', 48, 84, 1), gain: 22, taper: [67, 2.5] },
  steelDrums: { key: 'steelDrums', name: 'Steel Drums', blurb: 'Caribbean steel pan', color: '#06b6d4', category: 'World', kind: 'sampled', range: [52, 84], samples: struck('steel_drums', 52, 84, 1), gain: 21 },
  dulcimer: { key: 'dulcimer', name: 'Dulcimer', blurb: 'Hammered strings: medieval, folk', color: '#ca8a04', category: 'World', kind: 'sampled', range: [48, 88], samples: struck('dulcimer', 48, 88, 1.2), gain: 27 },

  // The rest of the General MIDI set (levels measured; see sampleTuning.ts for tuning)
  brightPiano: { key: 'brightPiano', name: 'Bright Piano', blurb: 'Punchy pop and rock piano', color: '#f1f5f9', category: 'Keys & Synths', kind: 'sampled', range: [21, 108], samples: struck('bright_acoustic_piano', 21, 108, 1.2), gain: 22 },
  electricGrand: { key: 'electricGrand', name: 'Electric Grand', blurb: '80s stage piano (CP-70)', color: '#e2e8f0', category: 'Keys & Synths', kind: 'sampled', range: [28, 103], samples: struck('electric_grand_piano', 28, 103, 1), gain: 19 },
  honkyTonk: { key: 'honkyTonk', name: 'Honky-Tonk Piano', blurb: 'Saloon piano, slightly out of tune on purpose', color: '#fcd34d', category: 'Keys & Synths', kind: 'sampled', range: [21, 108], samples: struck('honkytonk_piano', 21, 108, 1), gain: 19 },
  fmPiano: { key: 'fmPiano', name: 'FM Electric Piano', blurb: 'Glassy 80s FM keys: ballads, city pop', color: '#c4b5fd', category: 'Keys & Synths', kind: 'sampled', range: [28, 103], samples: struck('electric_piano_2', 28, 103, 1), gain: 20 },
  clavinet: { key: 'clavinet', name: 'Clavinet', blurb: 'Funky plucked keyboard', color: '#fb923c', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: struck('clavinet', 36, 96, 0.3), gain: 19, taper: [67, 1.5] },
  percussiveOrgan: { key: 'percussiveOrgan', name: 'Percussive Organ', blurb: 'Organ with a click: soul, reggae', color: '#b45309', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('percussive_organ', 36, 96, 0.3), gain: 25 },
  reedOrgan: { key: 'reedOrgan', name: 'Reed Organ', blurb: 'Harmonium: church, folk, nostalgic', color: '#a16207', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('reed_organ', 36, 96, 0.4), gain: 21, taper: [67, 1.5] },
  squareLead: { key: 'squareLead', name: 'Square Lead', blurb: 'Hollow square-wave synth lead', color: '#a3e635', category: 'Keys & Synths', kind: 'sampled', range: [48, 96], samples: held('lead_1_square', 48, 96, 0.2), gain: 20 },
  sawLead: { key: 'sawLead', name: 'Saw Lead', blurb: 'Bright sawtooth synth lead', color: '#facc15', category: 'Keys & Synths', kind: 'sampled', range: [48, 96], samples: held('lead_2_sawtooth', 48, 96, 0.2), gain: 21, taper: [73, 2] },
  calliope: { key: 'calliope', name: 'Calliope', blurb: 'Steam-whistle organ: circus, fairground', color: '#f472b6', category: 'Keys & Synths', kind: 'sampled', range: [48, 96], samples: held('lead_3_calliope', 48, 96, 0.3), gain: 22, taper: [73, 2] },
  chiffLead: { key: 'chiffLead', name: 'Chiff Lead', blurb: 'Breathy synth flute lead', color: '#86efac', category: 'Keys & Synths', kind: 'sampled', range: [48, 96], samples: held('lead_4_chiff', 48, 96, 0.3), gain: 15 },
  charang: { key: 'charang', name: 'Charang', blurb: 'Distorted synth guitar lead', color: '#f87171', category: 'Keys & Synths', kind: 'sampled', range: [40, 96], samples: held('lead_5_charang', 40, 96, 0.3), gain: 12 },
  voiceLead: { key: 'voiceLead', name: 'Voice Lead', blurb: 'Synth lead with a vocal tone', color: '#fbcfe8', category: 'Keys & Synths', kind: 'sampled', range: [48, 96], samples: held('lead_6_voice', 48, 96, 0.4), gain: 25, taper: [73, 2] },
  fifthsLead: { key: 'fifthsLead', name: 'Fifths Lead', blurb: 'Synth in parallel fifths: epic, retro', color: '#fde047', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('lead_7_fifths', 36, 96, 0.3), gain: 25, taper: [67, 2] },
  bassLead: { key: 'bassLead', name: 'Bass + Lead', blurb: 'Thick synth lead with a bass layer', color: '#84cc16', category: 'Bass', kind: 'sampled', range: [28, 72], samples: held('lead_8_bass__lead', 28, 72, 0.2), gain: 11 },
  synthBrass: { key: 'synthBrass', name: 'Synth Brass', blurb: '80s synth brass stabs and swells', color: '#f59e0b', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('synth_brass_1', 36, 96, 0.3), gain: 19, taper: [67, 1.5] },
  synthBrass2: { key: 'synthBrass2', name: 'Synth Brass 2', blurb: 'Soft, warm synth brass', color: '#fbbf24', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('synth_brass_2', 36, 96, 0.3), gain: 22 },
  synthStrings2: { key: 'synthStrings2', name: 'Synth Strings 2', blurb: 'Slow, lush string machine', color: '#fda4af', category: 'Keys & Synths', kind: 'sampled', range: [36, 96], samples: held('synth_strings_2', 36, 96, 1), gain: 18, taper: [67, 2.5] },
  polysynthPad: { key: 'polysynthPad', name: 'Polysynth Pad', blurb: 'Classic analog poly pad', color: '#a78bfa', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('pad_3_polysynth', 36, 96, 1), gain: 16, taper: [67, 3] },
  metallicPad: { key: 'metallicPad', name: 'Metallic Pad', blurb: 'Shimmering metallic pad: sci-fi', color: '#94a3b8', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('pad_6_metallic', 36, 96, 1.5), gain: 20, taper: [67, 2.5] },
  rainPad: { key: 'rainPad', name: 'Rain', blurb: 'Rainy, glittering texture', color: '#7dd3fc', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('fx_1_rain', 36, 96, 1.5), gain: 20, taper: [67, 2.5] },
  soundtrackPad: { key: 'soundtrackPad', name: 'Soundtrack', blurb: 'Wide cinematic swell', color: '#c084fc', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('fx_2_soundtrack', 36, 96, 1.5), gain: 30 },
  brightnessPad: { key: 'brightnessPad', name: 'Brightness', blurb: 'Bright airy pad with sparkle', color: '#fef08a', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('fx_5_brightness', 36, 96, 1.5), gain: 20, taper: [67, 1.5] },
  echoesPad: { key: 'echoesPad', name: 'Echo Drops', blurb: 'Echoing droplets: caves, underwater', color: '#5eead4', category: 'Pads & Atmospheres', kind: 'sampled', range: [36, 96], samples: held('fx_7_echoes', 36, 96, 1.5), gain: 21, taper: [67, 1] },
  jazzGuitar: { key: 'jazzGuitar', name: 'Jazz Guitar', blurb: 'Warm hollow-body electric', color: '#92400e', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86], samples: struck('electric_guitar_jazz', 40, 86, 0.6), gain: 15 },
  cleanGuitar: { key: 'cleanGuitar', name: 'Clean Guitar', blurb: 'Bright clean electric: pop, funk, indie', color: '#ef4444', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86], samples: struck('electric_guitar_clean', 40, 86, 0.6), gain: 23, taper: [64, 2.5] },
  steelGuitar: { key: 'steelGuitar', name: 'Steel-String Guitar', blurb: 'Bright strummy acoustic', color: '#d97706', category: 'Guitars & Strings', kind: 'sampled', range: [40, 84], samples: struck('acoustic_guitar_steel', 40, 84, 0.8), gain: 22 },
  guitarHarmonics: { key: 'guitarHarmonics', name: 'Guitar Harmonics', blurb: 'Bell-like guitar harmonics', color: '#fde68a', category: 'Guitars & Strings', kind: 'sampled', range: [52, 88], samples: struck('guitar_harmonics', 52, 88, 1), gain: 21 },
  fingerBass: { key: 'fingerBass', name: 'Finger Bass', blurb: 'Electric bass played with fingers', color: '#0e7490', category: 'Bass', kind: 'sampled', range: [28, 60], samples: struck('electric_bass_finger', 28, 60, 0.4), gain: 9, taper: [45, 3] },
  pickBass: { key: 'pickBass', name: 'Pick Bass', blurb: 'Electric bass with a pick: rock, punk', color: '#155e75', category: 'Bass', kind: 'sampled', range: [28, 60], samples: struck('electric_bass_pick', 28, 60, 0.4), gain: 22, taper: [45, 2.5] },
  slappedBass: { key: 'slappedBass', name: 'Slapped Bass', blurb: 'Recorded slap bass: funk', color: '#0891b2', category: 'Bass', kind: 'sampled', range: [28, 60], samples: struck('slap_bass_1', 28, 60, 0.3), gain: 26, taper: [45, 3] },
  slappedBass2: { key: 'slappedBass2', name: 'Slapped Bass 2', blurb: 'Popped slap bass', color: '#06b6d4', category: 'Bass', kind: 'sampled', range: [28, 60], samples: struck('slap_bass_2', 28, 60, 0.3), gain: 21, taper: [45, 2.5] },
  synthBass1: { key: 'synthBass1', name: 'Analog Synth Bass', blurb: 'Recorded analog synth bass', color: '#4f46e5', category: 'Bass', kind: 'sampled', range: [24, 60], samples: held('synth_bass_1', 24, 60, 0.2), gain: 22, taper: [43, 1.5] },
  synthBass2: { key: 'synthBass2', name: 'Synth Bass 2', blurb: 'Round, rubbery synth bass', color: '#6366f1', category: 'Bass', kind: 'sampled', range: [24, 60], samples: held('synth_bass_2', 24, 60, 0.2), gain: 20, taper: [43, 2] },
  sopranoSax: { key: 'sopranoSax', name: 'Soprano Sax', blurb: 'Sweet, high saxophone', color: '#eab308', category: 'Winds & Brass', kind: 'sampled', range: [56, 87], samples: held('soprano_sax', 56, 87, 0.4), gain: 18, taper: [73, 4] },
  baritoneSax: { key: 'baritoneSax', name: 'Baritone Sax', blurb: 'Deep, honking saxophone', color: '#a16207', category: 'Winds & Brass', kind: 'sampled', range: [36, 69], samples: held('baritone_sax', 36, 69, 0.4), gain: 20, taper: [54, 4] },
  shanai: { key: 'shanai', name: 'Shehnai', blurb: 'Indian double-reed: weddings, temples', color: '#f97316', category: 'World', kind: 'sampled', range: [60, 91], samples: held('shanai', 60, 91, 0.4), gain: 14 },
  whistle: { key: 'whistle', name: 'Whistle', blurb: 'Clear whistling melody', color: '#e0f2fe', category: 'World', kind: 'sampled', range: [72, 96], samples: held('whistle', 72, 96, 0.3), gain: 17, taper: [85, 1] },
  melodicTom: { key: 'melodicTom', name: 'Melodic Toms', blurb: 'Tuned toms you can play as notes', color: '#b91c1c', category: 'Drums & Percussion', kind: 'sampled', range: [36, 72], samples: struck('melodic_tom', 36, 72, 0.5), gain: 15 },
  synthDrum: { key: 'synthDrum', name: 'Syndrum', blurb: '80s electronic tom sweeps', color: '#dc2626', category: 'Drums & Percussion', kind: 'sampled', range: [36, 72], samples: struck('synth_drum', 36, 72, 0.5), gain: 17 },
  woodblock: { key: 'woodblock', name: 'Woodblock', blurb: 'Hollow wood clicks', color: '#a16207', category: 'Drums & Percussion', kind: 'sampled', range: [48, 84], samples: struck('woodblock', 48, 84, 0.2), gain: 18 },
  agogo: { key: 'agogo', name: 'Agogô', blurb: 'Brazilian cowbells', color: '#ca8a04', category: 'Drums & Percussion', kind: 'sampled', range: [48, 84], samples: struck('agogo', 48, 84, 0.4), gain: 21 },
  tinkleBell: { key: 'tinkleBell', name: 'Tinkle Bell', blurb: 'Small bright bells: magic, sparkle', color: '#fef3c7', category: 'Mallets & Bells', kind: 'sampled', range: [60, 96], samples: struck('tinkle_bell', 60, 96, 1.5), gain: 21, taper: [79, 3] },
  reverseCymbal: { key: 'reverseCymbal', name: 'Reverse Cymbal', blurb: 'Cymbal swelling backwards into a hit', color: '#cbd5e1', category: 'Sound Effects', kind: 'sampled', range: [48, 72], samples: struck('reverse_cymbal', 48, 72, 0.5), gain: 18 },
  seashore: { key: 'seashore', name: 'Seashore', blurb: 'Waves on a beach', color: '#38bdf8', category: 'Sound Effects', kind: 'sampled', range: [48, 72], samples: held('seashore', 48, 72, 1), gain: 14 },
  birdTweet: { key: 'birdTweet', name: 'Birds', blurb: 'Birdsong chirps', color: '#86efac', category: 'Sound Effects', kind: 'sampled', range: [60, 84], samples: struck('bird_tweet', 60, 84, 0.5), gain: 26 },
  telephone: { key: 'telephone', name: 'Telephone', blurb: 'Phone ring', color: '#f1f5f9', category: 'Sound Effects', kind: 'sampled', range: [60, 72], samples: struck('telephone_ring', 60, 72, 0.3), gain: 19 },
  helicopter: { key: 'helicopter', name: 'Helicopter', blurb: 'Helicopter blades', color: '#64748b', category: 'Sound Effects', kind: 'sampled', range: [36, 60], samples: held('helicopter', 36, 60, 0.5), gain: 25 },
  applause: { key: 'applause', name: 'Applause', blurb: 'Crowd clapping', color: '#fbbf24', category: 'Sound Effects', kind: 'sampled', range: [48, 72], samples: held('applause', 48, 72, 1), gain: 20 },
  gunshot: { key: 'gunshot', name: 'Gunshot', blurb: 'Gun shot (pitch it down for cannons)', color: '#ef4444', category: 'Sound Effects', kind: 'sampled', range: [36, 60], samples: struck('gunshot', 36, 60, 0.5), gain: 11 },
  fretNoise: { key: 'fretNoise', name: 'Fret Noise', blurb: 'Guitar string squeaks', color: '#d6d3d1', category: 'Sound Effects', kind: 'sampled', range: [48, 72], samples: struck('guitar_fret_noise', 48, 72, 0.3), gain: 22 },
  breathNoise: { key: 'breathNoise', name: 'Breath', blurb: 'A breath in (pitch it for sighs and wind)', color: '#e5e7eb', category: 'Sound Effects', kind: 'sampled', range: [48, 72], samples: struck('breath_noise', 48, 72, 0.3), gain: 24 },

  // FX
  fx: { key: 'fx', name: 'FX', blurb: 'Risers, sweeps, impacts, drops', color: '#67e8f9', category: 'FX', kind: 'fx', range: [48, 57], gain: -5 },

  // Your Sounds
  sampler: { key: 'sampler', name: 'Sampler', blurb: 'Play your own sound file', color: '#14b8a6', category: 'Your Sounds', kind: 'custom', range: [36, 96] },
  // (The range is the most slices a sound can be cut into, from C3 up; the piano roll shows only the slices there are)
  drumRack: { key: 'drumRack', name: 'Drum Rack', blurb: 'Your own sounds on 16 pads, each with its own effects', color: '#fb7185', category: 'Your Sounds', kind: 'rack', range: [36, 51] },
  multiSampler: { key: 'multiSampler', name: 'Multi Sampler', blurb: 'Several of your sounds across the keys and velocities', color: '#2dd4bf', category: 'Your Sounds', kind: 'multi', range: [21, 108] },
  slicer: { key: 'slicer', name: 'Slicer', blurb: 'Vocal chops: a sound cut into slices', color: '#f0abfc', category: 'Your Sounds', kind: 'slicer', range: [48, 111] },
  audio: { key: 'audio', name: 'Audio', blurb: 'Your recordings, as clips', color: '#60a5fa', category: 'Your Sounds', kind: 'audio', range: [0, 127] },
  plugin: { key: 'plugin', name: 'Plugin', blurb: 'A Web Audio Module instrument, loaded from its URL', color: '#e879f9', category: 'Your Sounds', kind: 'plugin', range: [0, 127] },
  return: { key: 'return', name: 'Return', blurb: 'An effect return: tracks send to it, it plays its effects back into the mix', color: '#38bdf8', category: 'Your Sounds', kind: 'return', range: [0, 127] },
  bus: { key: 'bus', name: 'Bus', blurb: 'A group channel: the tracks routed to it share its fader, inserts and sends', color: '#94a3b8', category: 'Your Sounds', kind: 'bus', range: [0, 127] },
};

// Measured tuning: steadier recordings in place of badly tuned ones, and per-recording corrections
for (const [key, tuning] of Object.entries(SAMPLE_TUNING)) {
  const source = INSTRUMENTS[key as InstrumentKey]?.samples;
  if (!source) continue;
  if (tuning.notes) {
    source.samples = Object.fromEntries(
      tuning.notes.map((n) => {
        const pitch = n.replace(/\d+$/, '');
        return [n, `${(FLATS[pitch] ?? pitch) + n.slice(pitch.length)}.mp3`];
      })
    );
  }
  source.tune = tuning.cents;
}

export function isInstrumentKey(key: unknown): key is InstrumentKey {
  return typeof key === 'string' && key in INSTRUMENTS;
}

export function isDrumKind(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'drums';
}

/** The FX instrument: fixed named rows (FX_ROWS) instead of a keyboard. */
/** The Drum Rack: fixed pad rows (one per pad) instead of a keyboard. */
export function isRackKind(key: InstrumentKey): boolean {
  return INSTRUMENTS[key]?.kind === 'rack';
}

export function isFxKind(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'fx';
}

/** An Audio track: its clips are sound files, not notes. */
/** A bus (group channel): it plays nothing itself, the tracks routed to it play through it. */
export function isBusKind(key: InstrumentKey): boolean {
  return INSTRUMENTS[key]?.kind === 'bus';
}

/** A bus or a return: a track with no clips of its own, that others play or send into. */
export function isMixKind(key: InstrumentKey): boolean {
  const kind = INSTRUMENTS[key]?.kind;
  return kind === 'bus' || kind === 'return';
}

export function isAudioKind(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'audio';
}

/** The Slicer: its rows are the slices of its sound. */
export function isSlicerKind(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'slicer';
}

/** Can a deck sound / pattern made for `source` go on a `target` track? (Drum kits share notes.) */
export function compatibleInstruments(source: InstrumentKey, target: InstrumentKey): boolean {
  return source === target || (isDrumKind(source) && isDrumKind(target));
}

/** What a clip's notes mean: drum hits, FX rows, pitches, or none (an audio clip). */
const noteFamily = (key: InstrumentKey) => (isDrumKind(key) ? 'drums' : isFxKind(key) ? 'fx' : isAudioKind(key) ? 'audio' : isMixKind(key) ? 'bus' : 'pitched');

/**
 * Can a clip on a `source` track move (or be pasted) onto a `target` track? Drum parts only make
 * sense on a drum kit and FX parts on the FX instrument, a melody plays on any pitched
 * instrument (the Sampler and the Slicer included), and audio clips only go on Audio tracks.
 */
export function canMoveClipBetween(source: InstrumentKey, target: InstrumentKey): boolean {
  // A bus holds no clips
  return noteFamily(source) === noteFamily(target) && !isMixKind(target);
}

/** Instruments grouped by category, in menu order. */
export function instrumentsByCategory(): Array<{ category: InstrumentCategory; instruments: InstrumentDef[] }> {
  return CATEGORIES.map((category) => ({
    category,
    // A bus isn't an instrument to pick (Add track makes one)
    instruments: INSTRUMENT_KEYS.map((k) => INSTRUMENTS[k]).filter((d) => d.category === category && d.kind !== 'bus' && d.kind !== 'plugin' && d.kind !== 'return'),
  })).filter((g) => g.instruments.length > 0);
}
