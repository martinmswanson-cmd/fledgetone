import * as Tone from 'tone';
import './toneFixes';
import type { InstrumentKey } from './instrumentCatalog';
import { INSTRUMENTS } from './instrumentCatalog';
import { createDrumKit } from './presets/drums';
import { createBassVoice } from './presets/bass';
import { createKeysVoice } from './presets/keys';
import { createBrassVoice } from './presets/brass';
import { create808, createDrumMachine, createLead, createSubBass, createWavetable } from './presets/synths';
import { createGrowlBass, createReeseBass, createWobbleBass } from './presets/edmBass';
import { createPluck, createSupersaw } from './presets/edmSynths';
import { createFx } from './presets/fx';
import { createCustomSamplerVoice, createSamplerVoice } from './samplers/samplerManager';
import type { CustomSample, WobbleRate } from '../store/timelineTypes';

/** Drum note map (GM-style). Drum clips store one note name per voice. */
export const DRUM_NOTES = {
  kick: 'C1',
  snare: 'D1',
  closedHat: 'F#1',
  openHat: 'A#1',
  cowbell: 'G#2',
} as const;

export interface PlayableNote {
  note: string;
  duration: string;
  velocity: number;
  /** Its clip's wobble rate (only Wobble and Growl Bass use it). */
  wobble?: WobbleRate;
}

/**
 * One playable instrument, the same shape whatever it is. Each track owns one (live and in
 * the export render), connected to that track's effects strip.
 */
export interface TrackInstrument {
  /** Play notes that start together (a chord, or simultaneous drum hits) at `time`. */
  play: (notes: PlayableNote[], time: number) => void;
  releaseAll: () => void;
  /** Resolves when the instrument can sound (reverb generated, samples downloaded). */
  ready: Promise<unknown>;
  dispose: () => void;
}

/**
 * Run one trigger, skipping just that hit if Tone rejects it, so a single bad hit can't take
 * the other notes of the same moment down with it.
 */
export function safely(trigger: () => void): void {
  try {
    trigger();
  } catch (err) {
    console.warn('Skipped a note:', err);
  }
}

const loudest = (notes: PlayableNote[]) => Math.max(...notes.map((n) => n.velocity));
const loudestNote = (notes: PlayableNote[]) => notes.reduce((a, b) => (b.velocity > a.velocity ? b : a));

interface DrumHits {
  kick: (time: number, velocity: number) => void;
  snare: (time: number, velocity: number) => void;
  hat: (open: boolean, time: number, velocity: number) => void;
  cowbell: (time: number, velocity: number) => void;
}

/** Map drum-clip notes onto a kit's hits. */
function playDrums(kit: DrumHits, notes: PlayableNote[], time: number): void {
  // One hi-hat voice: an open hat on the same tick replaces the closed one
  const openHat = notes.some((n) => n.note === DRUM_NOTES.openHat);
  for (const n of notes) {
    if (n.note === DRUM_NOTES.kick) safely(() => kit.kick(time, n.velocity));
    else if (n.note === DRUM_NOTES.snare) safely(() => kit.snare(time, n.velocity));
    else if (n.note === DRUM_NOTES.closedHat && !openHat) safely(() => kit.hat(false, time, n.velocity));
    else if (n.note === DRUM_NOTES.openHat) safely(() => kit.hat(true, time, n.velocity));
    else if (n.note === DRUM_NOTES.cowbell) safely(() => kit.cowbell(time, n.velocity));
  }
}

/** A monophonic synth: the loudest note at each tick wins. */
function mono(voice: { trigger: (note: string, d: string, t: number, v: number) => void; releaseAll: () => void; dispose: () => void }): TrackInstrument {
  return {
    play: (notes, time) => {
      const n = loudestNote(notes);
      voice.trigger(n.note, n.duration, time, n.velocity);
    },
    releaseAll: voice.releaseAll,
    ready: Promise.resolve(),
    dispose: voice.dispose,
  };
}

/**
 * Build `key`'s instrument in the current Tone context, connected to `output`.
 * `options.sample` is the user's sound for the Sampler instrument.
 */
export function createInstrument(key: InstrumentKey, output: Tone.InputNode, options: { sample?: CustomSample } = {}): TrackInstrument {
  const gain = INSTRUMENTS[key].gain;
  if (!gain) return buildInstrument(key, output, options);
  // Level correction so this instrument starts out about as loud as the others
  const trim = new Tone.Gain(Tone.dbToGain(gain)).connect(output);
  const inst = buildInstrument(key, trim, options);
  return {
    ...inst,
    dispose: () => {
      inst.dispose();
      trim.dispose();
    },
  };
}

function buildInstrument(key: InstrumentKey, output: Tone.InputNode, options: { sample?: CustomSample }): TrackInstrument {
  const kind = INSTRUMENTS[key].kind;

  if (kind === 'sampled' || kind === 'custom') {
    const voice = kind === 'sampled' ? createSamplerVoice(key, output) : createCustomSamplerVoice(options.sample, output);
    return {
      play: (notes, time) => voice.play(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
      releaseAll: voice.releaseAll,
      ready: voice.ready,
      dispose: voice.dispose,
    };
  }

  switch (key) {
    case 'drums': {
      const kit = createDrumKit(output);
      return { play: (notes, time) => playDrums(kit, notes, time), releaseAll: () => {}, ready: Promise.resolve(), dispose: kit.dispose };
    }
    case 'drumMachine': {
      const kit = createDrumMachine(output);
      return { play: (notes, time) => playDrums(kit, notes, time), releaseAll: () => {}, ready: Promise.resolve(), dispose: kit.dispose };
    }
    case 'bass': {
      const bass = createBassVoice(output);
      return mono({ trigger: bass.trigger, releaseAll: () => bass.synth.triggerRelease(), dispose: bass.dispose });
    }
    case 'subBass':
      return mono(createSubBass(output));
    case 'bass808':
      return mono(create808(output));
    case 'lead':
      return mono(createLead(output));
    case 'keys': {
      const keys = createKeysVoice(output);
      return {
        play: (notes, time) => keys.trigger(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
        releaseAll: keys.releaseAll,
        ready: keys.ready,
        dispose: keys.dispose,
      };
    }
    case 'brass': {
      const brass = createBrassVoice(output);
      return {
        play: (notes, time) => brass.trigger(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
        releaseAll: brass.releaseAll,
        ready: Promise.resolve(),
        dispose: brass.dispose,
      };
    }
    case 'wavetable': {
      const pad = createWavetable(output);
      return {
        play: (notes, time) => pad.trigger(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
        releaseAll: pad.releaseAll,
        ready: Promise.resolve(),
        dispose: pad.dispose,
      };
    }
    case 'wobbleBass':
    case 'growlBass':
    case 'reeseBass': {
      const create = key === 'wobbleBass' ? createWobbleBass : key === 'growlBass' ? createGrowlBass : createReeseBass;
      const bass = create(output);
      // Monophonic: the loudest note at each tick wins
      return { play: (notes, time) => bass.trigger(loudestNote(notes), time), releaseAll: bass.releaseAll, ready: Promise.resolve(), dispose: bass.dispose };
    }
    case 'supersaw':
    case 'pluck':
    case 'fx': {
      const synth = key === 'supersaw' ? createSupersaw(output) : key === 'pluck' ? createPluck(output) : createFx(output);
      return { ...synth, ready: Promise.resolve() };
    }
    default:
      throw new Error(`No synth for instrument: ${key}`);
  }
}

// ---------- instrument browser audition ----------

const auditionInstruments = new Map<InstrumentKey, TrackInstrument>();

/** A dry instrument per key for the instrument browser's pads (created on first use). */
export function auditionInstrument(key: InstrumentKey, auditionOutput: Tone.InputNode): TrackInstrument {
  let inst = auditionInstruments.get(key);
  if (!inst) {
    const created = createInstrument(key, auditionOutput);
    auditionInstruments.set(key, created);
    // A failed sample download leaves it silent for good: drop it, so the next use builds a new
    // one (which tries the download again)
    created.ready.catch(() => {
      if (auditionInstruments.get(key) !== created) return;
      auditionInstruments.delete(key);
      created.dispose();
    });
    inst = created;
  }
  return inst;
}
