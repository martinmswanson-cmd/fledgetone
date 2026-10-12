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
const CC_BY_SA = '[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)';
const NB = 'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples/';
const GLEITZ = "Benjamin Gleitzman's [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts)";
const TONE_AUDIO = 'the [Tone.js audio collection](https://github.com/Tonejs/audio)';

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
  { prefixes: ['https://gleitz.github.io/midi-js-soundfonts/MusyngKite/'], samples: `Musyng Kite SoundFont, rendered by ${GLEITZ}`, licence: CC_BY_SA },
  { prefixes: ['https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/'], samples: `FluidR3 GM SoundFont by Frank Wen, rendered by ${GLEITZ}`, licence: CC_BY },
];

/** The credit for a sample address, if it's from a listed source. */
export const creditFor = (url: string): SampleCredit | undefined => SAMPLE_CREDITS.find((c) => c.prefixes.some((p) => url.startsWith(p)));
