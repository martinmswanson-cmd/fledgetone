/**
 * Every instrument Fledgetone can play, in one place. The Add Track menu, the inspector,
 * the piano roll's note range, the instrument menus and project validation all read this.
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
import { FLATS, nb, noteName } from './soundfontSets';
import { RETRO_INSTRUMENTS } from './instrumentCatalogRetro';

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
  'realTimpani', 'realTubularBells', 'realVibraphone', 'realHarpsichord', 'realKalimba', 'realTenorSax', 'realStrings', 'realBrass',
  'realSteelDrums', 'realElectricPiano', 'realBanjo', 'realHarmonica', 'realOcarina', 'realZither', 'realSoloVoice', 'realBassDrum', 'studioKit', 'sessionKit', 'brushKit', 'latinPercussion',
  'realCelesta', 'realRecorder', 'realMutedTrumpet',
  'realViolin', 'realViola', 'realSoloCello', 'realContrabass',
  'realNylonGuitar',
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
  // drums you design
  'designedKit',
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
  /** The 1990s General MIDI soundfonts and early sample sets (instrumentCatalogRetro.ts): optional, hidden from the lists until shown, and kept so older songs play as they were */
  'Retro (1990s soundfonts)',
] as const;
export type InstrumentCategory = (typeof CATEGORIES)[number];

/**
 * What a key sounds like as it's let go: a harpsichord's jack falling back, a piano's damper
 * settling on the string. `samples` are by "<note>|<take>"; `db` is how loud they are against the
 * note's own recording (as recorded together), and `decay` (seconds) how quickly they fade the
 * longer a note was held, as the string has less left to damp (none: always as loud).
 */
export interface ReleaseSounds {
  baseUrl: string;
  fallbackUrl?: string;
  version?: string;
  samples: Record<string, string>;
  db: number;
  decay?: number;
}

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
  /** dB to raise or lower each recording by when it loads (an ensemble's sections, levelled with each other) */
  gains?: Record<string, number>;
  /**
   * The stretch of each recording (by its key) that repeats seamlessly, in seconds: a note held
   * longer than its recording loops there for as long as the key is down (see hostedSets.ts).
   */
  loops?: Record<string, [number, number]>;
  /** Sounds the instrument makes as a key is let go, played when a note is released early (see ReleaseSounds) */
  releases?: ReleaseSounds;
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
  /**
   * Decode at twice the sample rate it plays at: the whole set (true) or a drum kit's rows (their
   * names in `samples` before the first |). For the brightest sets, chosen by measuring: a note
   * played at another pitch is resampled with linear interpolation, whose error lands in the top
   * octaves, and at twice the rate it's about half as much, for twice the memory (samplerManager.ts).
   */
  doubleRate?: true | readonly string[];
}

export interface InstrumentDef {
  key: InstrumentKey;
  name: string;
  /** One-line description shown in menus */
  blurb: string;
  color: string;
  category: InstrumentCategory;
  /** One of the optional retro instruments (instrumentCatalogRetro.ts): listed under the Retro heading, and only when retro instruments are shown */
  retro?: true;
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
   * outer two of a chord. A held note's bow comes in over up to `attack` seconds, the softer the
   * longer (a full-velocity note in a few hundredths: see bowAttack in samplerManager.ts), as a
   * bowed note swells in rather than starting at full level.
   */
  bowed?: { skip: number; solo?: boolean; attack?: number };
  /**
   * Recorded without vibrato: each held note gets a player's, `cents` deep (either way) at about
   * `hz`, coming in after the note has started and differing a little from note to note (see
   * samplerManager.ts). A note under a third of a second plays straight. `body`: the frequencies
   * (Hz) of the instrument's body resonances the vibrato moves its harmonics across (bodyChain).
   */
  vibrato?: { cents: number; hz: number; body?: readonly number[] };
  /**
   * Recorded in a dead (anechoic) room: the instrument plays in a small stage's early reflections
   * and short tail, `room` dB under the direct sound, as the other recordings have their room in
   * them. Before the track's own reverb send, which places it in the song's hall.
   */
  room?: number;
  /**
   * Recorded straight from the pickup or in a dead room (the guitars): it plays in a studio room's
   * short reflections and tail, `studio` dB under the direct sound, after its amp (see studioChain
   * in samplerManager.ts), as a microphone in front of the speaker or the guitar hears the room.
   */
  studio?: number;
  /**
   * Recorded at several loudnesses and sustained: the mod wheel (CC 1) crossfades the soft and loud
   * recordings while a note sounds (as orchestral sample libraries do). Every other instrument
   * takes the wheel as level and brightness (see instruments.ts).
   */
  dynamics?: boolean;
  /** A drum kit's own names for its rows, by the row's note (a percussion kit plays congas on the kick and snare rows) */
  rowLabels?: Readonly<Record<string, string>>;
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

/**
 * The recordings' fallback address, for a page that doesn't have them next to it (the one-file
 * build opened from a file, a copy hosted elsewhere): twobirdsworkshop.com still serves
 * public/fledgetone-samples there. The app itself is published at fledgetone.com, with the
 * recordings next to it.
 */
const SITE_SAMPLES = 'https://twobirdsworkshop.com/fledgetone-samples/';

/**
 * Recordings hosted with the app (public/fledgetone-samples/<folder>, converted by
 * scripts/real-samples/README.md): the MIDI notes `notes`, each at the loudnesses `layers` (see
 * SampleSource.layers) in `takes` takes, as <note>_<layer>_<take>.mp3 ("Cs3" = C#3). Next to the
 * page (relative), else from the site. A set recorded sparsely (HostedSet.shared) leaves some out,
 * the sampler stretching a nearby note's recording at that loudness, and plays another's file for
 * others.
 */
function hosted(folder: string, notes: number[], layers: number[], takes: number, release: number): SampleSource {
  const samples: Record<string, string> = {};
  const shared = HOSTED_SETS[folder]?.shared ?? {};
  const file = (m: number, l: number, t: number) => `${noteName(m).replace('#', 's')}_${l}_${t}.mp3`;
  for (const m of notes) {
    const n = noteName(m);
    for (let l = 0; l < layers.length; l++)
      for (let t = 0; t < takes; t++) {
        const other = shared[`${m}_${l}_${t}`];
        if (other === null) continue;
        const [om, ol, ot] = (other ?? `${m}_${l}_${t}`).split('_').map(Number);
        samples[`${n}|${l}|${t}`] = file(om, ol, ot);
      }
  }
  const loops = HOSTED_SETS[folder]?.loops;
  return { baseUrl: `fledgetone-samples/${folder}/`, fallbackUrl: `${SITE_SAMPLES}${folder}/`, samples, release, layers, version: HOSTED_SETS[folder]?.hash, ...(loops ? { loops: loopsOf(loops) } : {}) };
}
/** Velocity tops for a set recorded at `n` loudnesses (see SampleSource.layers) */
const LAYER_TOPS: Record<number, number[]> = { 1: [1], 2: [0.55, 1], 3: [0.35, 0.68, 1], 4: [0.3, 0.55, 0.8, 1], 5: [0.22, 0.42, 0.62, 0.82, 1] };
/** A set converted by scripts/real-samples (its notes, loudnesses and takes from hostedSets.ts) */
const real = (folder: string, release: number): SampleSource => {
  const set = HOSTED_SETS[folder];
  return { ...hosted(folder, set.notes, LAYER_TOPS[set.layers], set.takes, release), ...(DOUBLE_RATE_SETS.has(folder) ? { doubleRate: true as const } : {}) };
};
/**
 * The brightest hosted sets, decoded at twice the sample rate they play at (SampleSource.doubleRate):
 * those with the most of their sound above 8 kHz, measured over the first second of the loudest
 * recordings (harmonica -13 dB of the whole, trombone short notes -29, harpsichord -30,
 * glockenspiel -31; next come the solo violin and short trumpet at -32, the kalimba at -34, and the
 * xylophone, tubular bells, steel drums and vibraphone at -46 to -88, little to gain). The harpsichord
 * is left out: its set is large (about 126 MB decoded), so doubling it would cost 100 MB for a small gain.
 * The harmon-muted trumpet, measured the same way, is as bright as the harmonica.
 */
const DOUBLE_RATE_SETS = new Set(['harmonica', 'trombone-staccato', 'glockenspiel', 'muted-trumpet']);
/** The studio kit's brightest rows, measured the same way: closed hat -7 dB, crash -11, open hat -12, ride -16, snare -23 (the toms and kick -35 and under). */
const STUDIO_KIT_BRIGHT_ROWS = ['F#1', 'C#2', 'A#1', 'D#2', 'D1'] as const;
/** A hosted release set (see ReleaseSounds) */
const releasesOf = (folder: string, db: number, decay?: number): ReleaseSounds => {
  const set = HOSTED_SETS[folder];
  const samples: Record<string, string> = {};
  for (const m of set.notes) for (let t = 0; t < set.takes; t++) samples[`${noteName(m)}|${t}`] = `${noteName(m).replace('#', 's')}_0_${t}.mp3`;
  return { baseUrl: `fledgetone-samples/${folder}/`, fallbackUrl: `${SITE_SAMPLES}${folder}/`, version: set.hash, samples, db, ...(decay ? { decay } : {}) };
};
/** A set's loops ("<midi>_<layer>_<take>") by sample key ("<note>|<layer>|<take>"). */
function loopsOf(loops: Record<string, [number, number]>): Record<string, [number, number]> {
  return Object.fromEntries(
    Object.entries(loops).map(([k, v]) => {
      const [m, l, t] = k.split('_').map(Number);
      return [`${noteName(m)}|${l}|${t}`, v];
    })
  );
}
/**
 * Sections of an orchestra as one instrument: each part plays its set's recordings from `from` up
 * to the next part's `from` (MIDI), `gain` dB against the others so the sections match. A part
 * recorded at fewer loudnesses than the most of them spreads its takes across the loudnesses.
 */
function ensemble(parts: Array<{ folder: string; from: number; gain: number }>, release: number): SampleSource {
  const samples: Record<string, string> = {};
  const gains: Record<string, number> = {};
  const loops: Record<string, [number, number]> = {};
  const sets = parts.map((p) => HOSTED_SETS[p.folder]);
  const layers = Math.max(...sets.map((x) => x.layers));
  parts.forEach((part, i) => {
    const set = sets[i];
    const below = parts[i + 1]?.from ?? 128;
    for (const m of set.notes) {
      if (m < part.from || m >= below) continue;
      const n = noteName(m);
      for (let l = 0; l < layers; l++) {
        const own = layers === 1 ? 0 : Math.round((l * (set.layers - 1)) / (layers - 1));
        for (let t = 0; t < set.takes; t++) {
          samples[`${n}|${l}|${t}`] = `${part.folder}/${n.replace('#', 's')}_${own}_${t}.mp3`;
          if (part.gain) gains[`${n}|${l}|${t}`] = part.gain;
          const loop = set.loops?.[`${m}_${own}_${t}`];
          if (loop) loops[`${n}|${l}|${t}`] = loop;
        }
      }
    }
  });
  return {
    baseUrl: 'fledgetone-samples/',
    fallbackUrl: SITE_SAMPLES,
    samples,
    gains,
    loops,
    release,
    layers: LAYER_TOPS[layers],
    version: sets.map((x) => x.hash).join(''),
  };
}
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
/**
 * A violin's body resonances (Hz), for the vibrato's shimmer (InstrumentDef.vibrato.body): the
 * air and wood modes at the bottom, then the bridge hill's peaks; a viola's, cello's and double
 * bass's sit lower as the instruments are bigger (BODY_SCALE).
 */
const VIOLIN_BODY = [280, 470, 1050, 1650, 2350, 3050, 4200, 5400];
export const BODY_SCALE = { viola: 0.82, cello: 0.48, contrabass: 0.3 };
export const bodyOf = (scale: number) => VIOLIN_BODY.map((hz) => Math.round(hz * scale));
/** The cello section's notes: every third or fourth semitone from the open C string up */
const CELLO_NOTES = [36, 40, 43, 47, 50, 53, 57, 60, 64, 67, 71, 74, 77];
/** The electric guitars' notes: every third semitone from the open low E */
const GUITAR_NOTES = Array.from({ length: 16 }, (_, i) => 40 + i * 3);
/**
 * The black guitar's strings damped as a note is let go (the library's own release recordings),
 * as its clean and crunch amps play them: 26 dB under the note, fading the longer it rang (the
 * library's own 5 dB a second). The high-gain amp lifts them, so it plays them softer.
 */
const GUITAR_BLACK_RELEASES = releasesOf('guitar-black-release', -26, 1.7);
/**
 * The velocities each of the black guitar's loudnesses plays up to. Its hard-picked recordings
 * are 10 dB brighter from 2 to 5 kHz than its medium ones (picked near the bridge), so they play
 * only for accents (over 0.88: a new note's 0.8 plays the medium ones), not from 0.68 as before,
 * which made most notes sharp.
 */
const BLACK_LAYERS = [0.4, 0.88, 1];

/**
 * Extra processing that turns a recording into the instrument: the erhu's nasal, vibrato-laden
 * bowing, an amp for the electric guitar's dull direct recording, a brighter acoustic guitar, the
 * mandolin's doubled strings, a string player's EQ on the violins, and a hall's softening of a
 * close, dead-room solo string ('hall'). See samplerManager.ts.
 */
export type Shaping = 'erhu' | 'amp' | 'acoustic' | 'mandolin' | 'violin' | 'hall' | AmpModel;
/** Guitar amps for the real electric guitar recordings (direct from the pickup): see samplerManager.ts. */
export type AmpModel = 'cleanAmp' | 'crunchAmp' | 'leadAmp' | 'jazzAmp';
/**
 * The shapings with a compressor in them (samplerManager.ts: the amp's sustain, and the amps with a
 * squeeze), each of which holds the sound back by a compressor's look-ahead (see delayCompensation.ts).
 * Keep in step with shapingChain.
 */
export const COMPRESSED_SHAPINGS: ReadonlySet<Shaping> = new Set<Shaping>(['amp', 'cleanAmp', 'jazzAmp']);

/** The solo violin set, every file it has (so no note is stretched more than a few semitones). */
const VIOLIN_FILES = ['A3', 'C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'G5', 'A5', 'C6', 'E6', 'G6', 'A6', 'C7'];


/**
 * A kit converted by scripts/real-samples (kit.py): on each drum row (see DRUM_NOTES, an octave
 * under the General MIDI pads) the recordings of the General MIDI note `rows` gives it, at every
 * loudness and take the set has.
 */
function realKit(folder: string, rows: Record<string, number>): SampleSource {
  const set = HOSTED_SETS[folder];
  const samples: Record<string, string> = {};
  for (const [row, m] of Object.entries(rows)) {
    for (let l = 0; l < set.layers; l++) for (let t = 0; t < set.takes; t++) samples[`${row}|${l}|${t}`] = `${noteName(m).replace('#', 's')}_${l}_${t}.mp3`;
  }
  return { baseUrl: `fledgetone-samples/${folder}/`, fallbackUrl: `${SITE_SAMPLES}${folder}/`, samples, release: 0.2, layers: LAYER_TOPS[set.layers], version: set.hash };
}

/** A Tone.js drum-samples kit: its kick, snare, hat and three toms on the drum rows (see DRUM_NOTES). */
function kit(folder: string): SampleSource {
  return {
    baseUrl: `https://tonejs.github.io/audio/drum-samples/${folder}/`,
    samples: { C1: 'kick.mp3', D1: 'snare.mp3', 'F#1': 'hihat.mp3', D2: 'tom1.mp3', B1: 'tom2.mp3', F1: 'tom3.mp3' },
    release: 0.2,
  };
}

// ---------- the catalog ----------

const MAIN_INSTRUMENTS: Partial<Record<InstrumentKey, InstrumentDef>> = {
  // Drums & Percussion
  drums: { key: 'drums', name: 'Drums', blurb: 'Analog groove kit', color: '#f59e0b', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], mono: true },
  drumMachine: { key: 'drumMachine', name: 'Drum Machine', blurb: '808-style boom kit', color: '#ef4444', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], mono: true },
  designedKit: { key: 'designedKit', name: 'Designed Kit', blurb: 'Drums you design: hard kicks, snares, claps, hats and percs (Drum Designer)', color: '#dc2626', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], mono: true },

  // Bass
  bass: { key: 'bass', name: 'Slap Bass', blurb: 'Squelchy funk synth bass', color: '#06b6d4', category: 'Bass', kind: 'synth', range: [24, 55], taper: [41, 1.5] },
  subBass: { key: 'subBass', name: 'Sub-Bass', blurb: 'Deep sine sub', color: '#0e7490', category: 'Bass', kind: 'synth', range: [24, 48], gain: -10, taper: [37, 7] },
  bass808: { key: 'bass808', name: '808 Bass', blurb: 'Booming pitched 808', color: '#7c3aed', category: 'Bass', kind: 'synth', range: [24, 52], gain: -6, taper: [39, 2.5] },
  wobbleBass: { key: 'wobbleBass', name: 'Wobble Bass', blurb: 'Dubstep wobble, tempo-synced', color: '#84cc16', category: 'Bass', kind: 'synth', range: [24, 55], wobble: true, gain: -8, taper: [41, 3] },
  growlBass: { key: 'growlBass', name: 'Growl Bass', blurb: 'Talking riddim growl', color: '#d946ef', category: 'Bass', kind: 'synth', range: [24, 60], wobble: true, gain: -14, taper: [43, 2.5] },
  reeseBass: { key: 'reeseBass', name: 'Reese Bass', blurb: 'Detuned drum & bass Reese', color: '#6366f1', category: 'Bass', kind: 'synth', range: [24, 55], gain: -8, taper: [41, 2.5] },

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
  keys: { key: 'keys', name: 'Space Clav', blurb: 'FM electric keys', color: '#a855f7', category: 'Keys & Synths', kind: 'synth', range: [36, 88], taper: [63, 4.5] },
  wavetable: { key: 'wavetable', name: 'Wavetable Synth', blurb: 'Evolving sweeping pad', color: '#38bdf8', category: 'Keys & Synths', kind: 'synth', range: [36, 96], taper: [67, 1] },
  lead: { key: 'lead', name: 'Analog Lead', blurb: 'Gliding saw lead', color: '#facc15', category: 'Keys & Synths', kind: 'synth', range: [48, 96], taper: [73, 1.5] },
  supersaw: { key: 'supersaw', name: 'Supersaw', blurb: 'Wide trance / house chords', color: '#fb7185', category: 'Keys & Synths', kind: 'synth', range: [36, 96], gain: -5, taper: [67, 2] },
  synthDesigner: { key: 'synthDesigner', name: 'Synth Designer', blurb: 'Build your own sound: oscillators, filter, LFO', color: '#22d3ee', category: 'Keys & Synths', kind: 'synth', range: [24, 108], taper: [67, 1] },
  pluck: { key: 'pluck', name: 'Pluck', blurb: 'Short bright EDM pluck', color: '#2dd4bf', category: 'Keys & Synths', kind: 'synth', range: [48, 96], gain: -6, taper: [73, 2] },

  // Guitars & Strings
  guitar: {
    key: 'guitar', name: 'Acoustic Guitar (Real)', blurb: 'A recorded acoustic guitar voiced bright for strumming: folk, pop, campfire', color: '#b45309', category: 'Guitars & Strings', kind: 'sampled', range: [40, 76],
    samples: real('nylon-guitar', 1), shaping: 'acoustic', studio: -14, taper: [64, 2], gain: 7.4,
  },
  realCello: {
    key: 'realCello', name: 'Cellos (Real)', blurb: 'A recorded cello section, bowed with vibrato: soft and loud takes', color: '#c2410c', category: 'Guitars & Strings', kind: 'sampled', range: [36, 77],
    samples: hosted('cello-sustain', CELLO_NOTES, [0.55, 1], 1, 0.7), gain: 14.1, taper: [65, 4], bowed: { skip: 0.08, attack: 0.15 }, dynamics: true,
  },
  realCelloShort: {
    key: 'realCelloShort', name: 'Cellos Short (Real)', blurb: 'Recorded cellos, short bouncing bow strokes: ostinatos, drive', color: '#9a3412', category: 'Guitars & Strings', kind: 'sampled', range: [36, 77],
    samples: hosted('cello-spiccato', CELLO_NOTES, [0.55, 1], 2, 0.25), gain: 7.1, taper: [65, 4],
  },
  realGuitar: {
    key: 'realGuitar', name: 'Electric Guitar (Real)', blurb: 'A recorded electric through a clean amp: soft, medium and hard picking', color: '#e11d48', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: { ...hosted('guitar-black', GUITAR_NOTES, BLACK_LAYERS, 2, 0.3), releases: GUITAR_BLACK_RELEASES }, shaping: 'cleanAmp', gain: 0, taper: [64, 2], studio: -15,
  },
  realCrunchGuitar: {
    key: 'realCrunchGuitar', name: 'Crunch Guitar (Real)', blurb: 'The recorded electric through a pushed amp: rock rhythm', color: '#be123c', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: { ...hosted('guitar-black', GUITAR_NOTES, BLACK_LAYERS, 2, 0.25), releases: GUITAR_BLACK_RELEASES }, shaping: 'crunchAmp', gain: -5.7, taper: [64, 2], studio: -15,
  },
  realLeadGuitar: {
    key: 'realLeadGuitar', name: 'Distortion Guitar (Real)', blurb: 'The recorded electric through a high-gain amp: riffs, power chords, leads', color: '#9f1239', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: { ...hosted('guitar-black', GUITAR_NOTES, BLACK_LAYERS, 2, 0.2), releases: releasesOf('guitar-black-release', -32, 1.7) }, shaping: 'leadAmp', gain: -9.5, taper: [64, 2], studio: -16,
  },
  realHollowGuitar: {
    key: 'realHollowGuitar', name: 'Hollow-Body Guitar (Real)', blurb: 'A recorded hollow-body electric through a warm clean amp: jazz, soul, rockabilly', color: '#a16207', category: 'Guitars & Strings', kind: 'sampled', range: [40, 86],
    samples: { ...hosted('guitar-green', GUITAR_NOTES, [0.35, 0.68, 1], 2, 0.35), releases: releasesOf('guitar-green-release', -26, 1.7) }, shaping: 'jazzAmp', gain: 5.7, taper: [64, 2], studio: -14,
  },
  realFlatwoundGuitar: {
    key: 'realFlatwoundGuitar', name: 'Flatwound Guitar (Real)', blurb: 'A recorded electric with flatwound strings, warm and round: jazz, soul', color: '#b45309', category: 'Guitars & Strings', kind: 'sampled', range: realRange('guitar-flatwound'),
    samples: real('guitar-flatwound', 0.3), gain: 4.9, taper: [70, 4.5], shaping: 'cleanAmp', studio: -15, tone: { presence: 1 },
  },
  realNylonGuitar: {
    key: 'realNylonGuitar', name: 'Classical Guitar (Real)', blurb: 'A recorded nylon-string guitar, every note soft, medium and hard: Spanish, bossa nova, fingerpicking', color: '#c2884a', category: 'Guitars & Strings', kind: 'sampled', range: realRange('nylon-guitar'),
    samples: real('nylon-guitar', 0.8), studio: -13, taper: [71, 2], gain: 5.1,
  },
  realViolins: {
    key: 'realViolins', name: 'Violins (Real)', blurb: 'A recorded violin section, bowed with vibrato: soft and loud takes', color: '#ef4444', category: 'Orchestra', kind: 'sampled', range: realRange('violins-sustain'),
    samples: real('violins-sustain', 0.7), shaping: 'violin', gain: 14.9, taper: [70, 2.5], bowed: { skip: 0.12, attack: 0.15 }, dynamics: true,
  },
  realViolinsShort: {
    key: 'realViolinsShort', name: 'Violins Short (Real)', blurb: 'Recorded violins, short bouncing strokes: ostinatos, action', color: '#dc2626', category: 'Orchestra', kind: 'sampled', range: realRange('violins-spiccato'),
    samples: real('violins-spiccato', 0.25), gain: 7.4, taper: [70, 4],
  },
  realViolas: {
    key: 'realViolas', name: 'Violas (Real)', blurb: 'A recorded viola section, bowed with vibrato: warm middle voices', color: '#f97316', category: 'Orchestra', kind: 'sampled', range: realRange('violas-sustain'),
    samples: real('violas-sustain', 0.7), gain: 11.6, taper: [69, 1], bowed: { skip: 0.1, attack: 0.15 }, dynamics: true,
  },
  realViolasShort: {
    key: 'realViolasShort', name: 'Violas Short (Real)', blurb: 'Recorded violas, short bouncing strokes', color: '#ea580c', category: 'Orchestra', kind: 'sampled', range: realRange('violas-spiccato'),
    samples: real('violas-spiccato', 0.25), gain: 9.2, taper: [69, 4.5],
  },
  realPizzicato: {
    key: 'realPizzicato', name: 'Pizzicato Section (Real)', blurb: 'Recorded cellos, violas and violins plucking, low to high', color: '#fb7185', category: 'Orchestra', kind: 'sampled', range: realRange('strings-pizzicato'),
    samples: real('strings-pizzicato', 0.4), gain: 22, taper: [69, 1],
  },
  realTremolo: {
    key: 'realTremolo', name: 'Tremolo Section (Real)', blurb: 'Recorded strings trembling the bow: tension, suspense', color: '#e11d48', category: 'Orchestra', kind: 'sampled', range: realRange('strings-tremolo'),
    samples: real('strings-tremolo', 0.6), gain: 12.4, taper: [69, 2.5], dynamics: true,
  },
  realSoloViolin: {
    key: 'realSoloViolin', name: 'Solo Violin (Real)', blurb: 'One recorded violin with vibrato, soft and loud: melodies', color: '#f87171', category: 'Orchestra', kind: 'sampled', range: realRange('solo-violin'),
    samples: real('solo-violin', 0.5), shaping: 'violin', gain: 17, taper: [74, 3], bowed: { skip: 0.03, solo: true, attack: 0.3 }, dynamics: true,
  },
  // Solo strings, every semitone at three loudnesses, recorded without vibrato in a dead room:
  // the app gives them a player's vibrato (with their body's shimmer), a small stage around them,
  // and the bow's swell, and softens the bite a close microphone hears: the violin's (shaping
  // 'hall') to the old solo violin's balance, the cello's a little (3 dB at 2.5 kHz) to the cello
  // section's; the viola and bass, measured, are as dark as the sections as they are
  realViolin: {
    key: 'realViolin', name: 'Violin (Real)', blurb: 'One recorded violin, every note at three loudnesses, with a player\'s vibrato: melodies', color: '#fca5a5', category: 'Orchestra', kind: 'sampled', range: realRange('violin', 0),
    samples: real('violin', 0.45), shaping: 'hall', gain: 8.4, taper: [74, 3], bowed: { skip: 0.04, solo: true, attack: 0.3 }, vibrato: { cents: 15, hz: 5.6, body: VIOLIN_BODY }, room: -9, dynamics: true,
  },
  realViola: {
    key: 'realViola', name: 'Viola (Real)', blurb: 'One recorded viola, every note at three loudnesses, with a player\'s vibrato: warm middle lines', color: '#fdba74', category: 'Orchestra', kind: 'sampled', range: realRange('viola', 0),
    samples: real('viola', 0.5), gain: -0.2, taper: [69, 1.5], bowed: { skip: 0.04, solo: true, attack: 0.3 }, vibrato: { cents: 14, hz: 5.4, body: bodyOf(BODY_SCALE.viola) }, room: -9, dynamics: true,
  },
  realSoloCello: {
    key: 'realSoloCello', name: 'Cello (Real)', blurb: 'One recorded cello, every note at three loudnesses, with a player\'s vibrato: singing lines', color: '#fb923c', category: 'Orchestra', kind: 'sampled', range: realRange('cello', 0),
    samples: real('cello', 0.6), gain: 4.2, tone: { presence: -3 }, taper: [65, 3], bowed: { skip: 0.05, solo: true, attack: 0.35 }, vibrato: { cents: 13, hz: 5.2, body: bodyOf(BODY_SCALE.cello) }, room: -9, dynamics: true,
  },
  realContrabass: {
    key: 'realContrabass', name: 'Contrabass (Real)', blurb: 'One recorded double bass, every note at three loudnesses, bowed: deep held lines', color: '#9a3412', category: 'Orchestra', kind: 'sampled', range: realRange('contrabass', 0),
    samples: real('contrabass', 0.6), gain: 10.1, taper: [51, 1.5], bowed: { skip: 0.06, attack: 0.4 }, vibrato: { cents: 10, hz: 5, body: bodyOf(BODY_SCALE.contrabass) }, room: -9, dynamics: true,
  },
  realDoubleBass: {
    key: 'realDoubleBass', name: 'Double Bass (Real)', blurb: 'A recorded double bass, bowed: the floor of the orchestra', color: '#7c2d12', category: 'Orchestra', kind: 'sampled', range: realRange('double-bass'),
    samples: real('double-bass', 0.5), gain: 18.2, taper: [51, 1.5], bowed: { skip: 0.1, attack: 0.2 }, dynamics: true,
  },
  realHarp: {
    key: 'realHarp', name: 'Harp (Real)', blurb: 'A recorded concert harp: arpeggios, glissandos, magic', color: '#fbbf24', category: 'Orchestra', kind: 'sampled', range: realRange('harp'),
    samples: real('harp', 1.5), gain: 7,
  },
  realFlute: {
    key: 'realFlute', name: 'Flute (Real)', blurb: 'A recorded flute with vibrato: soaring melodies', color: '#7dd3fc', category: 'Orchestra', kind: 'sampled', range: realRange('flute'),
    samples: real('flute', 0.35), gain: 10, taper: [78, 12],
  },
  realFluteShort: {
    key: 'realFluteShort', name: 'Flute Short (Real)', blurb: 'Recorded flute, short tongued notes: soft, medium and loud', color: '#38bdf8', category: 'Orchestra', kind: 'sampled', range: realRange('flute-staccato'),
    samples: real('flute-staccato', 0.2), gain: 19.8, taper: [78, 9],
  },
  realOboe: {
    key: 'realOboe', name: 'Oboe (Real)', blurb: 'A recorded oboe with vibrato: plaintive, pastoral', color: '#a3e635', category: 'Orchestra', kind: 'sampled', range: realRange('oboe'),
    samples: real('oboe', 0.3), gain: 2.5, taper: [73, 0.5], dynamics: true,
  },
  realClarinet: {
    key: 'realClarinet', name: 'Clarinet (Real)', blurb: 'A recorded clarinet: soft, medium and loud, from dark low notes to a bright top', color: '#4ade80', category: 'Orchestra', kind: 'sampled', range: realRange('clarinet'),
    samples: real('clarinet', 0.3), gain: 9, taper: [71, 10], dynamics: true,
  },
  realBassoon: {
    key: 'realBassoon', name: 'Bassoon (Real)', blurb: 'A recorded bassoon with vibrato: woody, comic or noble', color: '#a16207', category: 'Orchestra', kind: 'sampled', range: realRange('bassoon'),
    samples: real('bassoon', 0.3), gain: 0, taper: [55, 1.5], dynamics: true,
  },
  realHorn: {
    key: 'realHorn', name: 'French Horn (Real)', blurb: 'A recorded French horn, low and middle register: soft, medium and loud, heroic and warm', color: '#facc15', category: 'Orchestra', kind: 'sampled', range: HORN_RANGE,
    samples: real('horn', 0.4), gain: 16, taper: [45, 3], dynamics: true,
  },
  realHornShort: {
    key: 'realHornShort', name: 'French Horn Short (Real)', blurb: 'Recorded horn, short punchy notes: fanfares, hits', color: '#eab308', category: 'Orchestra', kind: 'sampled', range: HORN_RANGE,
    samples: real('horn-staccato', 0.25), gain: 19.7, taper: [45, 4.5],
  },
  realTrumpet: {
    key: 'realTrumpet', name: 'Trumpet (Real)', blurb: 'A recorded trumpet with vibrato: soft and loud', color: '#fde047', category: 'Orchestra', kind: 'sampled', range: realRange('trumpet'),
    samples: real('trumpet', 0.35), gain: 3.5, taper: [68, 4.5], dynamics: true,
  },
  realTrumpetShort: {
    key: 'realTrumpetShort', name: 'Trumpet Short (Real)', blurb: 'Recorded trumpet, short stabs: fanfares, ska, funk', color: '#fcd34d', category: 'Orchestra', kind: 'sampled', range: realRange('trumpet-staccato'),
    samples: real('trumpet-staccato', 0.2), gain: 14.5, taper: [68, 7.5],
  },
  realTrombone: {
    key: 'realTrombone', name: 'Trombone (Real)', blurb: 'A recorded tenor trombone: soft, medium and loud', color: '#d97706', category: 'Orchestra', kind: 'sampled', range: realRange('trombone'),
    samples: real('trombone', 0.4), gain: 13.4, taper: [49, 7.5], dynamics: true,
  },
  realTromboneShort: {
    key: 'realTromboneShort', name: 'Trombone Short (Real)', blurb: 'Recorded trombone, short notes at four loudnesses: stabs, hits', color: '#b45309', category: 'Orchestra', kind: 'sampled', range: realRange('trombone-staccato'),
    samples: real('trombone-staccato', 0.25), gain: 13.5, taper: [49, 2.5],
  },
  realTuba: {
    key: 'realTuba', name: 'Tuba (Real)', blurb: 'A recorded tuba: soft, medium and loud, a deep brass floor', color: '#92400e', category: 'Orchestra', kind: 'sampled', range: realRange('tuba'),
    samples: real('tuba', 0.4), gain: 12, taper: [44, 5], dynamics: true,
  },
  realGrandPiano: {
    key: 'realGrandPiano', name: 'Concert Grand (Real)', blurb: 'A recorded concert grand at four loudnesses: soft and warm to bright and hard', color: '#f8fafc', category: 'Keys & Synths', kind: 'sampled', range: realRange('grand-piano'),
    samples: { ...real('grand-piano', 0.6), releases: releasesOf('piano-release', -19, 6) }, gain: -7.3,
  },
  realUprightPiano: {
    key: 'realUprightPiano', name: 'Upright Piano (Real)', blurb: 'A recorded upright piano, three loudnesses: intimate, homely', color: '#e7e5e4', category: 'Keys & Synths', kind: 'sampled', range: realRange('upright-piano'),
    samples: { ...real('upright-piano', 0.5), releases: releasesOf('piano-release', -19, 6) }, gain: -6.8,
  },
  realPipeOrgan: {
    key: 'realPipeOrgan', name: 'Pipe Organ (Real)', blurb: 'A recorded church organ, full and open, with its pedal pipes', color: '#c4b5fd', category: 'Keys & Synths', kind: 'sampled', range: realRange('pipe-organ'),
    samples: real('pipe-organ', 0.4), gain: 16,
  },
  realChapelOrgan: {
    key: 'realChapelOrgan', name: 'Chapel Organ (Real)', blurb: 'The recorded organ on a quiet, gentle stop', color: '#a78bfa', category: 'Keys & Synths', kind: 'sampled', range: realRange('chapel-organ'),
    samples: real('chapel-organ', 0.4), gain: 9, taper: [78, 5],
  },
  realMarimba: {
    key: 'realMarimba', name: 'Marimba (Real)', blurb: 'A recorded marimba: warm wooden bars', color: '#d6a35c', category: 'Mallets & Bells', kind: 'sampled', range: realRange('marimba'),
    samples: real('marimba', 0.8), gain: 0.5,
  },
  realXylophone: {
    key: 'realXylophone', name: 'Xylophone (Real)', blurb: 'A recorded xylophone: bright, dry and quick', color: '#fb923c', category: 'Mallets & Bells', kind: 'sampled', range: realRange('xylophone'),
    samples: real('xylophone', 0.4), gain: 0,
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
    samples: real('baritone-sax', 0.25), gain: 7, taper: [49, 4], dynamics: true,
  },
  realUprightBass: {
    key: 'realUprightBass', name: 'Upright Bass (Real)', blurb: 'A recorded double bass, plucked at four loudnesses: jazz, swing', color: '#155e75', category: 'Bass', kind: 'sampled', range: realRange('upright-bass'),
    samples: real('upright-bass', 0.3), gain: 8.5, taper: [42, 1],
  },
  realElectricBass: {
    key: 'realElectricBass', name: 'Electric Bass (Real)', blurb: 'A recorded fingered electric bass at four loudnesses', color: '#0e7490', category: 'Bass', kind: 'sampled', range: realRange('electric-bass'),
    samples: real('electric-bass', 0.25), gain: 7.8, taper: [46, 5],
  },
  realStrings: {
    key: 'realStrings', name: 'String Section (Real)', blurb: 'Recorded cellos, violas and violins as one section, low to high: pads, swells, film chords', color: '#f43f5e', category: 'Orchestra', kind: 'sampled', range: [36, 88],
    samples: ensemble([{ folder: 'cello-sustain', from: 36, gain: -4.4 }, { folder: 'violas-sustain', from: 50, gain: -6.9 }, { folder: 'violins-sustain', from: 62, gain: -3.6 }], 0.7), gain: 17.5, taper: [79, 3], bowed: { skip: 0.1, attack: 0.15 }, dynamics: true,
  },
  realBrass: {
    key: 'realBrass', name: 'Brass Section (Real)', blurb: 'Recorded trombone, French horn and trumpet as one section, low to high: chords, swells, fanfares', color: '#f59e0b', category: 'Orchestra', kind: 'sampled', range: [34, 86],
    samples: ensemble([{ folder: 'trombone', from: 34, gain: -2.6 }, { folder: 'horn', from: 50, gain: 0 }, { folder: 'trumpet', from: 60, gain: -13.2 }], 0.4), gain: 16, taper: [74, 3], dynamics: true,
  },
  realTimpani: {
    key: 'realTimpani', name: 'Timpani (Real)', blurb: 'Five recorded kettle drums, three loudnesses: rolls, hits, drama', color: '#78350f', category: 'Orchestra', kind: 'sampled', range: [39, 58],
    samples: real('timpani', 1.5), gain: 4.3,
  },
  realTubularBells: {
    key: 'realTubularBells', name: 'Tubular Bells (Real)', blurb: 'Recorded orchestral chimes: soft and loud strikes', color: '#cbd5e1', category: 'Mallets & Bells', kind: 'sampled', range: realRange('tubular-bells', 3),
    samples: real('tubular-bells', 2), gain: 3.5,
  },
  realVibraphone: {
    key: 'realVibraphone', name: 'Vibraphone (Real)', blurb: 'A recorded vibraphone with soft mallets: jazz, lounge, dreamy', color: '#93c5fd', category: 'Mallets & Bells', kind: 'sampled', range: realRange('vibraphone'),
    samples: real('vibraphone', 1.2), gain: -2.5, taper: [76, 5],
  },
  realHarpsichord: {
    key: 'realHarpsichord', name: 'Harpsichord (Real)', blurb: 'A recorded Flemish harpsichord: baroque, spooky, bright', color: '#d4a373', category: 'Keys & Synths', kind: 'sampled', range: realRange('harpsichord'),
    samples: { ...real('harpsichord', 0.4), releases: releasesOf('harpsichord-release', -14) }, gain: 3,
  },
  realKalimba: {
    key: 'realKalimba', name: 'Kalimba (Real)', blurb: 'A recorded thumb piano: soft plucked metal tines', color: '#a3e635', category: 'World', kind: 'sampled', range: realRange('kalimba', 3),
    samples: real('kalimba', 1), gain: 6,
  },
  realTenorSax: {
    key: 'realTenorSax', name: 'Tenor Sax (Real)', blurb: 'A recorded tenor saxophone, soft and loud: smoky jazz, soul, rock', color: '#d97706', category: 'Winds & Brass', kind: 'sampled', range: realRange('tenor-sax'),
    samples: real('tenor-sax', 0.25), gain: 5, taper: [70, 2], dynamics: true,
  },
  realSteelDrums: {
    key: 'realSteelDrums', name: 'Steel Drums (Real)', blurb: 'A recorded steel pan, soft to hard strokes: island, sunny, playful', color: '#06b6d4', category: 'World', kind: 'sampled', range: [57, 86],
    samples: real('steel-drums', 1), gain: 10.3,
  },
  realElectricPiano: {
    key: 'realElectricPiano', name: 'Electric Piano (Real)', blurb: 'A recorded vintage electric piano, four loudnesses: soul, jazz, lo-fi', color: '#f472b6', category: 'Keys & Synths', kind: 'sampled', range: [30, 95],
    samples: real('electric-piano', 0.6), gain: 4.1, taper: [80, 4], dynamics: true,
  },
  realBanjo: {
    key: 'realBanjo', name: 'Banjo (Real)', blurb: 'A recorded five-string banjo: bright, twangy folk and country', color: '#eab308', category: 'Guitars & Strings', kind: 'sampled', range: realRange('banjo', 3),
    samples: real('banjo', 0.4), gain: 15.5, taper: [64, 3],
  },
  realHarmonica: {
    key: 'realHarmonica', name: 'Harmonica (Real)', blurb: 'A recorded harmonica: blues, folk, lonesome', color: '#64748b', category: 'World', kind: 'sampled', range: [58, 96],
    samples: real('harmonica', 0.3), gain: 6.5, taper: [80, 6], dynamics: true,
  },
  realOcarina: {
    key: 'realOcarina', name: 'Ocarina (Real)', blurb: 'A recorded clay ocarina: pure, round, adventurous', color: '#a3e635', category: 'World', kind: 'sampled', range: [67, 88],
    samples: real('ocarina', 0.3), gain: 1, dynamics: true,
  },
  realZither: {
    key: 'realZither', name: 'Zither (Real)', blurb: 'A recorded plucked zither (dan tranh): delicate, shimmering, East Asian', color: '#be123c', category: 'World', kind: 'sampled', range: realRange('zither', 3),
    samples: real('zither', 1), gain: 4,
  },
  realSoloVoice: {
    key: 'realSoloVoice', name: 'Solo Voice (Real)', blurb: 'A recorded low male voice singing "aah": chant, drones, solemn', color: '#fde68a', category: 'Choir & Voices', kind: 'sampled', range: [36, 61],
    samples: real('solo-voice', 0.5), gain: -2, dynamics: true,
  },
  realCelesta: {
    key: 'realCelesta', name: 'Celesta (Real)', blurb: 'A recorded celesta, every key: little hammers on steel bars, sweet and twinkling', color: '#fef08a', category: 'Mallets & Bells', kind: 'sampled', range: realRange('celesta'),
    samples: real('celesta', 1.5), gain: 5.3,
  },
  realRecorder: {
    key: 'realRecorder', name: 'Recorder (Real)', blurb: 'Recorded wooden recorders (tenor, alto and soprano) played straight: pure, medieval, folk', color: '#d9f99d', category: 'Orchestra', kind: 'sampled', range: [60, 96],
    samples: real('recorder', 0.3), gain: 8.4, taper: [80, 6], dynamics: true,
  },
  realMutedTrumpet: {
    key: 'realMutedTrumpet', name: 'Muted Trumpet (Real)', blurb: 'A recorded trumpet with a harmon mute, soft and loud: cool jazz, late-night, noir', color: '#fb923c', category: 'Winds & Brass', kind: 'sampled', range: realRange('muted-trumpet'),
    samples: real('muted-trumpet', 0.4), gain: 6.4, taper: [70, 8], dynamics: true,
  },
  realBassDrum: {
    key: 'realBassDrum', name: 'Concert Bass Drum (Real)', blurb: 'A recorded orchestral bass drum, five loudnesses: booms, rolls, thunder', color: '#7f1d1d', category: 'Orchestra', kind: 'sampled', range: [33, 39],
    samples: real('concert-bass-drum', 2), gain: -3.4,
  },

  // Winds & Brass
  brass: { key: 'brass', name: 'Brass Stabs', blurb: 'Synth horn section', color: '#22c55e', category: 'Winds & Brass', kind: 'synth', range: [48, 84], taper: [67, 3] },


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
  studioKit: {
    key: 'studioKit', name: 'Studio Kit (Real)', blurb: 'A recorded drum kit, close and room mics, four loudnesses, two takes each: rock, pop, funk', color: '#b45309', category: 'Drums & Percussion', kind: 'drums', range: [36, 48],
    samples: { ...realKit('studio-kit', { C1: 36, D1: 38, 'F#1': 42, 'A#1': 46, F1: 41, B1: 45, D2: 48, 'C#2': 49, 'D#2': 51 }), doubleRate: STUDIO_KIT_BRIGHT_ROWS }, gain: 11,
  },
  sessionKit: {
    key: 'sessionKit', name: 'Session Kit (Real)', blurb: 'A recorded drum kit with its room, rimshot and cowbell, four loudnesses, two takes each: pop, soul, rock', color: '#a16207', category: 'Drums & Percussion', kind: 'drums', range: [36, 48],
    samples: realKit('session-kit', { C1: 36, D1: 38, 'D#1': 39, F1: 41, 'F#1': 42, B1: 45, 'A#1': 46, D2: 48, 'C#2': 49, 'D#2': 51, 'G#2': 56 }), gain: 6,
    rowLabels: { 'D#1': 'Rimshot' },
  },
  brushKit: {
    key: 'brushKit', name: 'Brush Kit (Real)', blurb: 'A recorded drum kit played with brushes, soft and warm: jazz, lounge, ballads', color: '#92400e', category: 'Drums & Percussion', kind: 'drums', range: [36, 48],
    samples: realKit('brush-kit', { C1: 36, D1: 38, 'D#1': 39, F1: 41, 'F#1': 42, B1: 45, 'A#1': 46, D2: 48, 'C#2': 49, 'D#2': 51, 'G#2': 56 }), gain: 6.5,
    rowLabels: { 'D#1': 'Rimshot', 'G#2': 'Woodblock' },
  },
  latinPercussion: {
    key: 'latinPercussion', name: 'Latin Percussion (Real)', blurb: 'Recorded congas, bongos, timbale, shaker, tambourine and bells: salsa, samba, Latin pop', color: '#b45309', category: 'Drums & Percussion', kind: 'drums', range: [36, 48],
    samples: realKit('latin-percussion', { C1: 36, D1: 38, 'D#1': 39, F1: 41, 'F#1': 42, B1: 45, 'A#1': 46, D2: 48, 'C#2': 49, 'D#2': 51, 'G#2': 56 }), gain: 1,
    rowLabels: { C1: 'Tumba', D1: 'Conga', 'D#1': 'Claves', F1: 'Bongo Low', 'F#1': 'Shaker', B1: 'Bongo High', 'A#1': 'Tambourine', D2: 'Timbale', 'C#2': 'Triangle', 'D#2': 'Agogo', 'G#2': 'Cowbell' },
  },
  acousticKit: { key: 'acousticKit', name: 'Acoustic Kit', blurb: 'Real drum kit (recorded): rock, pop, jazz', color: '#d97706', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('acoustic-kit'), gain: -1 },
  breakbeatKit: { key: 'breakbeatKit', name: 'Breakbeat Kit', blurb: 'Crunchy sampled break hits', color: '#c2410c', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('breakbeat9'), gain: 2 },
  linnDrum: { key: 'linnDrum', name: '80s Drum Machine', blurb: 'A sampled 80s drum machine: synthwave, pop', color: '#e11d48', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('LINN'), gain: -3 },
  cr78: { key: 'cr78', name: 'Rhythm Box', blurb: 'A sampled vintage rhythm box', color: '#9a3412', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('CR78'), gain: -2 },
  technoKit: { key: 'technoKit', name: 'Techno Kit', blurb: 'Hard electronic kit', color: '#be185d', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('Techno') },
  bongos: { key: 'bongos', name: 'Bongos & Percussion', blurb: 'Hand drums for Latin grooves', color: '#a16207', category: 'Drums & Percussion', kind: 'drums', range: [36, 48], samples: kit('Bongos'), gain: -1 },








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

/** Every instrument: the ones above and the retro ones (instrumentCatalogRetro.ts). INSTRUMENT_KEYS gives their order. */
export const INSTRUMENTS = { ...MAIN_INSTRUMENTS, ...RETRO_INSTRUMENTS } as Record<InstrumentKey, InstrumentDef>;

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
/** The heading the retro instruments are listed under (see InstrumentDef.retro). */
export const RETRO_CATEGORY: InstrumentCategory = 'Retro (1990s soundfonts)';

/** The group an instrument is listed under: its own, or Retro for the retro ones. */
export const listedCategory = (def: InstrumentDef): InstrumentCategory => (def.retro ? RETRO_CATEGORY : def.category);

/**
 * The instruments to pick from, by group, recordings first in each group (then the synths and
 * kits). The retro instruments come last, under one heading, and only with `retro`.
 */
export function instrumentsByCategory({ retro = true }: { retro?: boolean } = {}): Array<{ category: InstrumentCategory; instruments: InstrumentDef[] }> {
  const tier = (d: InstrumentDef) => (d.samples && !d.retro ? 0 : 1);
  return CATEGORIES.map((category) => ({
    category,
    // A bus isn't an instrument to pick (Add track makes one)
    instruments: INSTRUMENT_KEYS.map((k) => INSTRUMENTS[k])
      .filter((d) => listedCategory(d) === category && (retro || !d.retro) && d.kind !== 'bus' && d.kind !== 'plugin' && d.kind !== 'return')
      .sort((a, b) => tier(a) - tier(b)),
  })).filter((g) => g.instruments.length > 0);
}

/** Where an instrument sits on an orchestra's stage: its pan, and how far back (Track.distance). */
export interface Seat {
  pan: number;
  distance: number;
}

/**
 * The usual orchestral seating, seen from the audience: first violins on the left, cellos and basses
 * to the right, violas between; woodwinds in the middle behind the strings; horns behind them on the
 * left, trumpets, trombones and tuba to the right at the back; harp on the left; timpani and
 * percussion at the very back. Solo instruments and pianos sit up front. A band's instruments have
 * no seat: they're played close and placed by the mix.
 */
const SEATS: Partial<Record<InstrumentKey, Seat>> = {
  realViolins: { pan: -0.45, distance: 0.15 },
  realViolinsShort: { pan: -0.45, distance: 0.15 },
  realViolas: { pan: 0.1, distance: 0.2 },
  realViolasShort: { pan: 0.1, distance: 0.2 },
  realCello: { pan: 0.35, distance: 0.2 },
  realCelloShort: { pan: 0.35, distance: 0.2 },
  realDoubleBass: { pan: 0.55, distance: 0.3 },
  realBassDrum: { pan: 0.1, distance: 0.75 },
  realStrings: { pan: 0, distance: 0.2 },
  realPizzicato: { pan: 0, distance: 0.2 },
  realTremolo: { pan: 0, distance: 0.2 },
  realSoloViolin: { pan: -0.1, distance: 0.05 },
  realViolin: { pan: -0.1, distance: 0.05 },
  realViola: { pan: 0.05, distance: 0.08 },
  realSoloCello: { pan: 0.2, distance: 0.1 },
  realContrabass: { pan: 0.4, distance: 0.15 },
  realHarp: { pan: -0.55, distance: 0.35 },
  realFlute: { pan: -0.15, distance: 0.45 },
  realFluteShort: { pan: -0.15, distance: 0.45 },
  realOboe: { pan: 0.1, distance: 0.45 },
  realClarinet: { pan: -0.1, distance: 0.5 },
  realBassoon: { pan: 0.15, distance: 0.5 },
  realHorn: { pan: -0.3, distance: 0.6 },
  realHornShort: { pan: -0.3, distance: 0.6 },
  realTrumpet: { pan: 0.15, distance: 0.65 },
  realTrumpetShort: { pan: 0.15, distance: 0.65 },
  realTrombone: { pan: 0.35, distance: 0.65 },
  realTromboneShort: { pan: 0.35, distance: 0.65 },
  realTuba: { pan: 0.45, distance: 0.65 },
  realBrass: { pan: 0.1, distance: 0.6 },
  realTimpani: { pan: 0, distance: 0.75 },
  realTubularBells: { pan: 0.3, distance: 0.75 },
  realGlockenspiel: { pan: 0.25, distance: 0.7 },
  realXylophone: { pan: 0.25, distance: 0.7 },
  taiko: { pan: 0, distance: 0.6 },
  choir: { pan: 0, distance: 0.7 },
  voiceOohs: { pan: 0, distance: 0.7 },
  realPipeOrgan: { pan: 0, distance: 0.6 },
};

/** Where `key` sits on the stage, or undefined (no usual place: band, synths, your sounds). */
export const seatOf = (key: InstrumentKey): Seat | undefined => SEATS[key];

/**
 * Wind and brass players run out of breath: a note held longer than this many seconds starts to
 * fade (see samplerManager.ts), as a real player's would, instead of holding forever at full level.
 */
const BREATH: Partial<Record<InstrumentKey, number>> = {
  realFlute: 7,
  realOboe: 8,
  realClarinet: 9,
  realBassoon: 8,
  realHorn: 8,
  realTrumpet: 7,
  realTrombone: 7,
  realTuba: 6,
  realBrass: 8,
  realAltoSax: 8,
  realTenorSax: 8,
  realBariSax: 7,
  realHarmonica: 6,
  realOcarina: 7,
  realSoloVoice: 9,
  realRecorder: 7,
  realMutedTrumpet: 7,
};
/** How long a player of `key` can hold a note before it starts to fade (seconds), if they breathe. */
export const breathOf = (key: InstrumentKey): number | undefined => BREATH[key];

/**
 * Sections (several players on one part): the notes of a chord don't start in the same instant,
 * a few milliseconds apart, as no two players start together.
 */
const SECTIONS = new Set<InstrumentKey>(['realViolins', 'realViolas', 'realCello', 'realStrings', 'realBrass', 'realTremolo', 'realPizzicato', 'realDoubleBass', 'choir', 'voiceOohs']);
export const isSection = (key: InstrumentKey): boolean => SECTIONS.has(key);

/** How loose a player of each kind of instrument is: the Human insert's [timing, dynamics]. */
const FEEL: Partial<Record<InstrumentCategory, [timing: number, dynamics: number]>> = {
  Orchestra: [0.25, 0.3],
  'Choir & Voices': [0.25, 0.25],
  'Guitars & Strings': [0.2, 0.3],
  'Winds & Brass': [0.2, 0.25],
  World: [0.2, 0.25],
  Bass: [0.12, 0.2],
  'Keys & Synths': [0.1, 0.2],
  'Mallets & Bells': [0.1, 0.2],
  'Drums & Percussion': [0.06, 0.2],
};
/** Recorded drum machines: a machine plays them, exactly. */
const MACHINES = new Set<InstrumentKey>(['linnDrum', 'cr78', 'technoKit']);

/**
 * The feel a new track on `key` starts with (the Human insert's timing and dynamics), or undefined
 * to start exact: a recorded instrument plays like its player (an orchestra's a little loose in
 * time and touch, a band's a little less, keyboards and mallets tighter, a drum kit tight in time
 * with only its hits' strength varying); synths, drum machines (synthesized or recorded), buses
 * and your own sounds play exactly, as a machine does.
 */
export function playerFeel(key: InstrumentKey): { timing: number; dynamics: number } | undefined {
  const def = INSTRUMENTS[key];
  if (!def || MACHINES.has(key)) return undefined;
  if (!(def.kind === 'sampled' || (def.kind === 'drums' && def.samples))) return undefined;
  const f = FEEL[def.category];
  return f ? { timing: f[0], dynamics: f[1] } : undefined;
}
