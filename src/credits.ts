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
  { prefixes: [`${NB}guitar-acoustic/`], samples: 'University of Iowa Electronic Music Studios, via [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments)', licence: CC_BY },
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
    ].map((set) => `${HOSTED}${set}/`),
    samples:
      'Strings, woodwinds, brass, harp, mallets and organ from the [Versilian Community Sample Library, VSCO 2 CE](https://github.com/sgossner/VSCO-2-CE) by Versilian Studios (converted to MP3, hosted with the app)',
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
    prefixes: [`${HOSTED}guitar-black/`, `${HOSTED}guitar-green/`],
    samples: 'Electric guitars from [Black And Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars) by Karoryfer Lecolds, recorded by Brian Wood (converted to MP3, hosted with the app)',
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
