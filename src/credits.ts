/**
 * Where every recorded instrument's samples come from, by the start of their address. The Credits
 * in the guide are generated from this and the instrument list (`npm run guide-tables`), and a
 * test fails if an instrument loads samples from a source that isn't listed here, or if the guide's
 * tables are out of date.
 */
export interface SampleCredit {
  /** Every sample address starting with one of these is from this source */
  prefixes: string[];
  /** Who made the samples and where they come from (Markdown) */
  samples: string;
  /** The licence (Markdown) */
  licence: string;
}

const CC_BY = '[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)';
const CC0 = '[CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain)';
const CC_BY_SA = '[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)';
const NB = 'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/';
const GLEITZ = "Benjamin Gleitzman's [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts)";
const TONE_AUDIO = 'the [Tone.js audio collection](https://github.com/Tonejs/audio)';
/** The recordings hosted with the app (public/fledgetone-samples/) */
const HOSTED = 'fledgetone-samples/';

export const SAMPLE_CREDITS: SampleCredit[] = [
  { prefixes: ['https://tonejs.github.io/audio/salamander/'], samples: `Salamander Grand Piano by Alexander Holm, from ${TONE_AUDIO}`, licence: CC_BY },
  {
    prefixes: ['https://tonejs.github.io/audio/drum-samples/'],
    samples: `Drum machine and kit samples from Chris Wilson's Web Audio samples, from ${TONE_AUDIO}`,
    licence: 'Not stated by the collection (see its [drum-samples folder](https://github.com/Tonejs/audio/tree/master/drum-samples))',
  },
  { prefixes: [`${NB}bass-electric/`, `${NB}guitar-electric/`, `${NB}saxophone/`], samples: 'Karoryfer Samples, via [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments)', licence: CC_BY },
  {
    prefixes: [`${NB}violin/`, `${NB}harp/`, `${NB}trumpet/`, `${NB}french-horn/`, `${NB}flute/`],
    samples: 'Versilian Studios Orchestra (VSCO 2), via [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments)',
    licence: CC_BY,
  },
  {
    prefixes: [
      'cello-sustain', 'cello-spiccato', 'violins-sustain', 'violins-spiccato', 'violas-sustain', 'violas-spiccato', 'strings-pizzicato',
      'strings-tremolo', 'solo-violin', 'harp', 'flute', 'flute-staccato', 'oboe', 'clarinet', 'bassoon', 'horn', 'horn-staccato', 'trumpet',
      'trumpet-staccato', 'trombone', 'trombone-staccato', 'tuba', 'marimba', 'xylophone', 'glockenspiel', 'pipe-organ', 'chapel-organ',
      'muted-trumpet',
    ].map((set) => `${HOSTED}${set}/`),
    samples:
      'Strings, woodwinds, brass (and a trumpet with a harmon mute), harp, mallets and organ from the [Versilian Community Sample Library, VSCO 2 CE](https://github.com/sgossner/VSCO-2-CE) by Versilian Studios (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: ['timpani', 'tubular-bells', 'vibraphone', 'harpsichord', 'harpsichord-release', 'piano-release', 'kalimba', 'tenor-sax', 'harmonica', 'ocarina', 'zither', 'concert-bass-drum', 'recorder'].map((set) => `${HOSTED}${set}/`),
    samples:
      'Timpani, tubular bells, vibraphone, harpsichord, kalimba, tenor saxophone, harmonica, ocarina, zither (dan tranh), concert bass drum, baroque recorders, and the harpsichord and piano release sounds from the [Versilian Community Sample Library (VCSL)](https://github.com/sgossner/VCSL) by Versilian Studios (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: ['violin', 'viola', 'cello', 'contrabass', 'nylon-guitar'].map((set) => `${HOSTED}${set}/`),
    samples:
      'Solo violin, viola, cello and double bass, bowed, and a nylon-string classical guitar (played by Brian Penkrot), from the [University of Iowa Musical Instrument Samples](https://theremin.music.uiowa.edu/MIS.html) by Lawrence Fritts and the University of Iowa Electronic Music Studios (split into single notes and converted to MP3, hosted with the app)',
    licence: 'Free to download and use for any project, without restrictions (the studios\' statement)',
  },
  {
    prefixes: [`${HOSTED}celesta/`],
    samples: 'Celesta from [A Sampled Celesta](https://gitlab.com/echoparallax/a-sampled-celesta) by Neil Bickford (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}steel-drums/`],
    samples: 'Steel drums from [jSteelDrum](https://github.com/sfzinstruments/jlearman.SteelDrum) by jlearman (converted to MP3, hosted with the app)',
    licence: 'The Unlicense (public domain)',
  },
  {
    prefixes: [`${HOSTED}electric-piano/`],
    samples: 'Electric piano from [E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos) by Greg Sullivan (converted to MP3, hosted with the app)',
    licence: CC_BY,
  },
  {
    prefixes: [`${HOSTED}banjo/`],
    samples: 'Banjo from [ganjo](https://github.com/sfzinstruments/ganjo) by itsclipping (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}solo-voice/`],
    samples: 'Solo voice from the [legato vocal tutorial](https://github.com/sfzinstruments/legato_vocal_tutorial) by Karoryfer Samples (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}studio-kit/`],
    samples: 'Studio drum kit from [Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums) by Karoryfer Samples, close and overhead microphones mixed (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}session-kit/`, `${HOSTED}latin-percussion/`, `${HOSTED}percussion-extras/`],
    samples: 'Session drum kit, Latin percussion and percussion extras from [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums), microphones mixed (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}brush-kit/`],
    samples: 'Brush drum kit from [Unruly Drums](https://github.com/sfzinstruments/karoryfer.unruly-drums) by Karoryfer Samples, close and overhead microphones mixed (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}upright-piano/`],
    samples:
      'Upright piano sampled by Simon Dalzell of Ivy Audio, from the [VSCO 2 CE](https://github.com/sgossner/VSCO-2-CE) library by Versilian Studios, which may redistribute it (converted to MP3, hosted with the app)',
    licence: `${CC0}, as part of VSCO 2 CE`,
  },
  {
    prefixes: [`${HOSTED}grand-piano/`],
    samples: '[Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano), samples by AKAI, mapped by kinwie (converted to MP3, hosted with the app)',
    licence: 'Public domain',
  },
  {
    prefixes: [`${HOSTED}alto-sax/`],
    samples: 'Alto saxophone from [Weresax](https://github.com/sfzinstruments/karoryfer.weresax) by Karoryfer Lecolds (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}baritone-sax/`],
    samples: 'Baritone saxophone from [Bear Sax](https://github.com/sfzinstruments/karoryfer.bear-sax) by Karoryfer Lecolds (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}double-bass/`, `${HOSTED}upright-bass/`],
    samples: 'Double bass from [Meatbass](https://github.com/sfzinstruments/karoryfer.meatbass) by Karoryfer Lecolds, played by Drogomir Smolken (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}electric-bass/`],
    samples: 'Electric bass from [Growlybass](https://github.com/sfzinstruments/karoryfer.growlybass) by Karoryfer Lecolds (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: [`${HOSTED}guitar-flatwound/`],
    samples: 'Electric guitar from [Emily Guitar](https://github.com/sfzinstruments/karoryfer.emilyguitar) by Karoryfer Lecolds, played by D. Smolken (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  {
    prefixes: ['guitar-black', 'guitar-green', 'guitar-black-release', 'guitar-green-release'].map((set) => `${HOSTED}${set}/`),
    samples: 'Electric guitars and their release sounds from [Black And Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars) by Karoryfer Lecolds, recorded by Brian Wood (converted to MP3, hosted with the app)',
    licence: CC0,
  },
  { prefixes: ['https://gleitz.github.io/midi-js-soundfonts/MusyngKite/'], samples: `Musyng Kite SoundFont, rendered by ${GLEITZ}`, licence: CC_BY_SA },
  { prefixes: ['https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/'], samples: `FluidR3 GM SoundFont by Frank Wen, rendered by ${GLEITZ}`, licence: CC_BY },
];

/** The credit for a sample address, if it's from a listed source. */
export const creditFor = (url: string): SampleCredit | undefined => SAMPLE_CREDITS.find((c) => c.prefixes.some((p) => url.startsWith(p)));

/** Who made each built-in plugin family (see audio/plugins/), for the guide's Credits (generated). */
export interface PluginCredit {
  family: string;
  /** Who made them and where they come from (Markdown) */
  made: string;
  licence: string;
}

const MIT = '[MIT](https://opensource.org/license/mit)';
export const PLUGIN_CREDITS: PluginCredit[] = [
  {
    family: 'airwindows',
    made: 'The [Airwindows](https://www.airwindows.com) effects by Chris Johnson, through the [Airwin Consolidated](https://github.com/baconpaul/airwin2rack) library by Paul Walker',
    licence: MIT,
  },
  { family: 'mda', made: 'The mda plug-ins by Paul Kellett ([mda-vst](https://sourceforge.net/projects/mda-vst/))', licence: `${MIT} (offered under MIT or the GPL)` },
  { family: 'open303', made: '[Open303](https://github.com/RobinSchmidt/Open303) by Robin Schmidt', licence: MIT },
  {
    family: 'mutable',
    made: 'Plaits, Braids, Rings, Elements and Clouds by Emilie Gillet ([Mutable Instruments eurorack](https://github.com/pichenettes/eurorack) code)',
    licence: MIT,
  },
  {
    family: 'faust',
    made:
      'Physical models and effects from the [Faust](https://faust.grame.fr) libraries and examples by GRAME and contributors, among them Romain Michon, Julius O. Smith III, Yann Orlarey and Stéphane Letz (the waveguide models after the Synthesis ToolKit by Perry Cook and Gary Scavone)',
    licence: `${MIT}, BSD and STK-4.3 (the library code is used under the Faust exception to its LGPL)`,
  },
  // GPL families: only in builds with them (see audio/plugins/pluginSources.ts)
  { family: 'surge', made: '[Surge XT](https://surge-synthesizer.github.io) by the Surge Synth Team, with its factory patches', licence: '[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)' },
  { family: 'dragonfly', made: '[Dragonfly Reverb](https://michaelwillis.github.io/dragonfly-reverb/) by Michael Willis and Rob van den Berg', licence: '[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)' },
  { family: 'plateau', made: 'Plateau by Dale Johnson ([Valley Audio ValleyRackFree](https://github.com/ValleyAudio/ValleyRackFree))', licence: '[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)' },
  { family: 'setbfree', made: '[setBfree](https://setbfree.org/) tonewheel organ by Fredrik Kilander, Robin Gareus and Will Panther', licence: '[GPL-2.0-or-later](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html)' },
];

/** Where the notes of the starters built on public-domain pieces come from (the Classics), for the guide's Credits (generated). */
export interface ScoreCredit {
  /** The starters that play it (ids in starters.ts) */
  starters: string[];
  /** The piece and its composer */
  piece: string;
  /** The edition or transcription the notes were taken from or checked against (Markdown) */
  source: string;
  licence: string;
}

const PD = 'Public domain';
const MUTOPIA = 'https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=';
const IMSLP = 'https://imslp.org/wiki/Special:ImagefromIndex/';
export const SCORE_CREDITS: ScoreCredit[] = [
  {
    starters: ['canon'],
    piece: 'Canon in D, Johann Pachelbel (complete)',
    source: `Written out from Max Seiffert's edition (Kistner & Siegel, 1929, [IMSLP #44549](${IMSLP}44549)), the violins' line checked note by note against Alan Ernest Bonds's edition ([IMSLP #1022928](${IMSLP}1022928), CC0); the editors' dynamics, ornaments and keyboard part are not used`,
    licence: `${PD} (the edition it was checked against: ${CC0})`,
  },
  {
    starters: ['moonlight'],
    piece: 'Piano Sonata No. 14 in C sharp minor, Op. 27 No. 2, first movement, Ludwig van Beethoven (complete)',
    source: `Transcribed from the Breitkopf & Härtel complete edition (Beethovens Werke, Serie 16, [IMSLP #994719](${IMSLP}994719)), checked against the Mutopia Project's guitar-duo arrangement typeset by Jeffrey Olson after Francisco Tárrega ([Mutopia 2101](${MUTOPIA}2101))`,
    licence: PD,
  },
  {
    starters: ['prelude'],
    piece: 'Cello Suite No. 1 in G, BWV 1007, Prelude, Johann Sebastian Bach (complete)',
    source: `[Mutopia Project 517](${MUTOPIA}517), typeset by Andreas Scherer from the Schirmer edition (1916)`,
    licence: PD,
  },
  {
    starters: ['mountainKing'],
    piece: 'In the Hall of the Mountain King, Op. 46 No. 4, Edvard Grieg (complete, orchestrated in the app from his piano version)',
    source: `[Mutopia Project 1888](${MUTOPIA}1888), typeset by Coyau from The University Society edition (1918)`,
    licence: PD,
  },
  {
    starters: ['clairDeLune'],
    piece: 'Clair de lune, Suite bergamasque, Claude Debussy (complete)',
    source: `[Mutopia Project 1778](${MUTOPIA}1778), typeset by Keith OHara from the E. Fromont edition (1905)`,
    licence: PD,
  },
];
