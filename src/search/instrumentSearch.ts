/**
 * Searching the instrument list: each instrument's searchable fields (name, its group's style and
 * mood words, its description) and the ranked matches for what's typed, used by every instrument
 * picker and the search palette.
 */
import type { InstrumentCategory, InstrumentDef, InstrumentKey } from '../audio/instrumentCatalog';
import { INSTRUMENTS, INSTRUMENT_KEYS } from '../audio/instrumentCatalog';
import { rank, type SearchFields } from './searchCore';

/**
 * Words each group is looked for by, beyond its name: the styles and moods it's used for, so a
 * search for "8-bit", "angelic", "horror" or "orchestral" finds the instruments for it.
 */
const CATEGORY_WORDS: Record<InstrumentCategory, string> = {
  'Drums & Percussion': 'drum drums kit beat beats percussion rhythm groove hip hop trap rock breakbeat',
  Bass: 'bass bassline low sub funk',
  'Choir & Voices': 'choir voice vocal vocals singing angelic heavenly church sacred aah ooh classical',
  'Pads & Atmospheres': 'pad pads ambient atmosphere drone texture cinematic dreamy angelic background horror space',
  Orchestra: 'orchestra orchestral classical cinematic film score epic symphony strings fantasy',
  'Keys & Synths': 'keys keyboard piano synth synthesizer electronic edm pop lead synthwave',
  'Guitars & Strings': 'guitar guitars strings rock folk acoustic plucked country metal',
  'Winds & Brass': 'wind winds brass horn horns woodwind woodwinds jazz orchestral',
  'Mallets & Bells': 'bells bell mallet mallets chime chimes tuned percussion sparkle music box christmas',
  World: 'world ethnic folk traditional',
  FX: 'fx transition riser sweep impact build buildup drop whoosh',
  'Sound Effects': 'sfx sound effect effects foley noise',
  Chiptune: 'chip chiptune 8 bit 8bit retro nes gameboy game pixel arcade',
  'Retro (1990s soundfonts)': 'retro general midi gm old older classic 90s 1990s soundfont',
  'Your Sounds': 'sample samples your own audio import slicer chop recording',
};

const KIND_WORDS: Record<InstrumentDef['kind'], string> = {
  synth: 'synth electronic',
  drums: 'drums',
  fx: 'fx',
  sampled: 'recorded real',
  custom: 'sample',
  slicer: 'slice chop',
  audio: 'audio',
  bus: 'bus group',
  plugin: 'plugin wam',
  return: 'return aux send effect',
  rack: 'drum rack pads kit sampler drums one shots choke 808 own samples',
  multi: 'multi sampler multisample zones velocity layers own samples keymap',
  drop: 'drop pad stutter filter sweep tape stop crush gate echo throw performance dj effects build',
};

const fieldsCache = new Map<InstrumentKey, SearchFields>();

/** What an instrument is found by. */
export function instrumentFields(def: InstrumentDef): SearchFields {
  let f = fieldsCache.get(def.key);
  if (!f) {
    f = {
      title: def.name,
      keywords: `${def.category} ${CATEGORY_WORDS[def.category]} ${KIND_WORDS[def.kind]}${def.retro ? ` ${CATEGORY_WORDS['Retro (1990s soundfonts)']}` : ''}`,
      detail: def.blurb,
    };
    fieldsCache.set(def.key, f);
  }
  return f;
}

/** The instruments matching `query`, best first, among those `include` lets through. */
export function searchInstruments(query: string, include: (def: InstrumentDef) => boolean = () => true): InstrumentDef[] {
  const defs = INSTRUMENT_KEYS.map((k) => INSTRUMENTS[k]).filter((d) => d.kind !== 'bus' && d.kind !== 'plugin' && d.kind !== 'return' && include(d));
  return rank(defs, query, instrumentFields);
}
