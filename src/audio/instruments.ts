import * as Tone from 'tone';
import { createChipBass, createChipDrums, createChipLead } from './presets/chiptune';
import './toneFixes';
import type { InstrumentKey } from './instrumentCatalog';
import { INSTRUMENTS } from './instrumentCatalog';
import { createDrumKit } from './presets/drums';
import { createBassVoice } from './presets/bass';
import { createKeysVoice } from './presets/keys';
import { createBrassVoice } from './presets/brass';
import { create808, createDrumMachine, createLead, createSubBass, createWavetable } from './presets/synths';
import { createGrowlBass, createReeseBass, createWobbleBass } from './presets/edmBass';
import { createPluck, createSupersaw, HELD_NOTE } from './presets/edmSynths';
import { createFx } from './presets/fx';
import { createSlicer } from './presets/slicer';
import { createBus } from './presets/native';
import type { NativeBus } from './presets/native';
import { createCustomSamplerVoice, createSamplerVoice } from './samplers/samplerManager';
import type { CustomSample, SlicerSettings, WobbleRate } from '../store/timelineTypes';

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

/** Ends a note started by noteOn (a key let go) at an audio time. */
export type NoteOff = (time: number) => void;

/**
 * One playable instrument, the same shape whatever it is. Each track owns one (live and in
 * the export render), connected to that track's effects strip.
 */
export interface TrackInstrument {
  /** Play notes that start together (a chord, or simultaneous drum hits) at `time`. */
  play: (notes: PlayableNote[], time: number) => void;
  /**
   * Start one note at `time` and keep it sounding, as a key held on a MIDI keyboard; the
   * returned function ends it with the instrument's own release (`note.duration` is ignored).
   * One-shots (the drum kits) play the hit and ignore the end. An instrument without it is
   * played live as short sequenced notes (see liveInput.ts).
   */
  noteOn?: (note: PlayableNote, time: number) => NoteOff;
  /** Pitch bend in cents, for the instruments whose voices can bend (the others ignore it). */
  bend?: (cents: number, time: number) => void;
  releaseAll: () => void;
  /** Resolves when the instrument can sound (reverb generated, samples downloaded). */
  ready: Promise<unknown>;
  dispose: () => void;
  /** An Audio track's: where its audio clips play (see audioClipSchedule.ts). */
  clipBus?: NativeBus;
  /** The Slicer's: give it the track's slices and modes as they change, without a rebuild. */
  setSlicer?: (settings: SlicerSettings | undefined) => void;
}

/** What an instrument is built with: the Sampler's sound, the Slicer's sound and slices. */
export interface InstrumentOptions {
  sample?: CustomSample;
  slicer?: SlicerSettings;
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

interface MonoVoice {
  trigger: (note: string, d: string, t: number, v: number) => void;
  attack: (note: string, t: number, v: number) => void;
  release: (t: number) => void;
  bend: (cents: number, t: number) => void;
  releaseAll: () => void;
  dispose: () => void;
}

/** A monophonic synth: the loudest note at each tick wins. A held key is let go only if no later key took the voice. */
function mono(voice: MonoVoice): TrackInstrument {
  let held: string | null = null;
  return {
    play: (notes, time) => {
      const n = loudestNote(notes);
      held = null;
      voice.trigger(n.note, n.duration, time, n.velocity);
    },
    noteOn: (n, time) => {
      voice.attack(n.note, time, n.velocity);
      held = n.note;
      return (at) => {
        if (held !== n.note) return;
        held = null;
        voice.release(at);
      };
    },
    bend: voice.bend,
    releaseAll: () => {
      held = null;
      voice.releaseAll();
    },
    ready: Promise.resolve(),
    dispose: voice.dispose,
  };
}

/** A pool synth (chords): a held key gets a voice of its own until it's let go. */
function poly(
  synth: { attack: (note: string, t: number, v: number) => { release: (t: number) => void }; bend: (cents: number, t: number) => void },
  base: Omit<TrackInstrument, 'noteOn' | 'bend'>
): TrackInstrument {
  return {
    ...base,
    noteOn: (n, time) => {
      const voice = synth.attack(n.note, time, n.velocity);
      return (at) => voice.release(at);
    },
    bend: synth.bend,
  };
}

/** A one-shot (drum hit): a held key plays it once and the end does nothing. */
const oneShot = (play: TrackInstrument['play']): TrackInstrument['noteOn'] => (n, time) => {
  play([n], time);
  return () => {};
};

/**
 * Build `key`'s instrument in the current Tone context, connected to `output`.
 * `options` carry the user's sound for the Sampler and the Slicer's sound and slices.
 */
export function createInstrument(key: InstrumentKey, output: Tone.InputNode, options: InstrumentOptions = {}): TrackInstrument {
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

function buildInstrument(key: InstrumentKey, output: Tone.InputNode, options: InstrumentOptions): TrackInstrument {
  const kind = INSTRUMENTS[key].kind;

  if (kind === 'audio') {
    // An Audio track plays no notes: its clips play their sound files into this bus
    const bus = createBus(output);
    return { play: () => {}, releaseAll: () => {}, ready: Promise.resolve(), dispose: () => bus.bus.dispose(), clipBus: bus };
  }
  if (kind === 'slicer') return createSlicer(output, options.slicer);

  if (kind === 'sampled' || kind === 'custom') {
    const voice = kind === 'sampled' ? createSamplerVoice(key, output) : createCustomSamplerVoice(options.sample, output);
    return {
      play: (notes, time) => voice.play(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
      noteOn: (n, time) => {
        voice.attack(n.note, time, n.velocity);
        return (at) => voice.release(n.note, at);
      },
      releaseAll: voice.releaseAll,
      ready: voice.ready,
      dispose: voice.dispose,
    };
  }

  switch (key) {
    case 'drums': {
      const kit = createDrumKit(output);
      const play: TrackInstrument['play'] = (notes, time) => playDrums(kit, notes, time);
      return { play, noteOn: oneShot(play), releaseAll: () => {}, ready: Promise.resolve(), dispose: kit.dispose };
    }
    case 'drumMachine': {
      const kit = createDrumMachine(output);
      const play: TrackInstrument['play'] = (notes, time) => playDrums(kit, notes, time);
      return { play, noteOn: oneShot(play), releaseAll: () => {}, ready: Promise.resolve(), dispose: kit.dispose };
    }
    case 'bass': {
      const bass = createBassVoice(output);
      return mono({ ...bass, releaseAll: () => bass.synth.triggerRelease() });
    }
    case 'subBass':
      return mono(createSubBass(output));
    case 'bass808':
      return mono(create808(output));
    case 'lead':
      return mono(createLead(output));
    case 'keys': {
      const keys = createKeysVoice(output);
      return poly(keys, {
        play: (notes, time) => keys.trigger(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
        releaseAll: keys.releaseAll,
        ready: keys.ready,
        dispose: keys.dispose,
      });
    }
    case 'brass': {
      const brass = createBrassVoice(output);
      return poly(brass, {
        play: (notes, time) => brass.trigger(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
        releaseAll: brass.releaseAll,
        ready: Promise.resolve(),
        dispose: brass.dispose,
      });
    }
    case 'wavetable': {
      const pad = createWavetable(output);
      return poly(pad, {
        play: (notes, time) => pad.trigger(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
        releaseAll: pad.releaseAll,
        ready: Promise.resolve(),
        dispose: pad.dispose,
      });
    }
    case 'wobbleBass':
    case 'growlBass':
    case 'reeseBass': {
      const create = key === 'wobbleBass' ? createWobbleBass : key === 'growlBass' ? createGrowlBass : createReeseBass;
      const bass = create(output);
      // Monophonic: the loudest note at each tick wins. A held key is a long note let go early.
      return {
        play: (notes, time) => bass.trigger(loudestNote(notes), time),
        noteOn: (n, time) => {
          bass.trigger({ ...n, duration: HELD_NOTE }, time);
          return (at) => bass.release(n.note, at);
        },
        releaseAll: bass.releaseAll,
        ready: Promise.resolve(),
        dispose: bass.dispose,
      };
    }
    case 'chipDrums': {
      const kit = createChipDrums(output);
      const play: TrackInstrument['play'] = (notes, time) => playDrums(kit, notes, time);
      return { play, noteOn: oneShot(play), releaseAll: () => {}, ready: Promise.resolve(), dispose: kit.dispose };
    }
    case 'chipLead':
    case 'chipBass': {
      const synth = key === 'chipLead' ? createChipLead(output) : createChipBass(output);
      return { play: synth.play, noteOn: synth.hold, releaseAll: synth.releaseAll, dispose: synth.dispose, ready: Promise.resolve() };
    }
    case 'supersaw':
    case 'pluck':
    case 'fx': {
      const synth = key === 'supersaw' ? createSupersaw(output) : key === 'pluck' ? createPluck(output) : createFx(output);
      return { play: synth.play, noteOn: synth.hold, releaseAll: synth.releaseAll, dispose: synth.dispose, ready: Promise.resolve() };
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
