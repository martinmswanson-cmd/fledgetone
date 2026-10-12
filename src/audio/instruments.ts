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
import { createKitExtras } from './presets/kitExtras';
import type { KitExtras } from './presets/kitExtras';
import { createSampledKit } from './presets/sampledKit';
import { createSlicer } from './presets/slicer';
import { createBus } from './presets/native';
import type { NativeBus } from './presets/native';
import { createCustomSamplerVoice, createSamplerVoice, noteJitter, taperGain } from './samplers/samplerManager';
import type { NoteExpression } from '../store/timelineTypes';
import type { CustomSample, DrumRack, MultiSample, SlicerSettings, Track, WamPlugin, WobbleRate } from '../store/timelineTypes';
import { createMultiInstrument, createRackInstrument } from './presets/sampleKits';
import { createPluginChain, createPluginInstrument } from './presets/wamPlugin';
import type { SynthPatch } from '../store/synthPatch';
import { createDesignedSynth } from './presets/designer';

/** Drum note map (GM-style). Drum clips store one note name per voice. */
export const DRUM_NOTES = {
  kick: 'C1',
  snare: 'D1',
  closedHat: 'F#1',
  openHat: 'A#1',
  cowbell: 'G#2',
  // Added later, on the General MIDI pads an octave down like the others
  clap: 'D#1',
  tomLow: 'F1',
  tomMid: 'B1',
  tomHigh: 'D2',
  crash: 'C#2',
  ride: 'D#2',
} as const;
export type DrumRow = keyof typeof DRUM_NOTES;
const ROW_OF = new Map(Object.entries(DRUM_NOTES).map(([row, note]) => [note as string, row as DrumRow]));

export interface PlayableNote {
  note: string;
  duration: string;
  velocity: number;
  /** Its own bend and pressure over its length (see noteExpression.ts) */
  expr?: NoteExpression;
  /** Its clip's wobble rate (only Wobble and Growl Bass use it). */
  wobble?: WobbleRate;
}

/** One sounding note's own controls (see TrackInstrument.noteVoice). */
export interface VoiceControl {
  /** Its bend from its own pitch, in cents, from `time` */
  bend: (cents: number, time: number) => void;
  /** Its key pressure (0 to 1: its level), from `time` */
  pressure: (value: number, time: number) => void;
  /** Let it go at `time` */
  off: (time: number) => void;
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
  /** A MIDI controller (0 to 119) moved to `value` (0 to 1): plugins get it as MIDI. */
  cc?: (cc: number, value: number, time: number) => void;
  /**
   * Start one note whose bend and pressure can then be moved on their own (per-note expression),
   * or null if it doesn't sound. Instruments without it play expressive notes as ordinary ones,
   * bending as a whole.
   */
  noteVoice?: (note: PlayableNote, time: number) => VoiceControl | null;
  releaseAll: () => void;
  /** Resolves when the instrument can sound (reverb generated, samples downloaded). */
  ready: Promise<unknown>;
  dispose: () => void;
  /** Set one of its plugins' parameters (0 to 1 of its range) at `time`: false while that plugin isn't loaded. */
  setPluginParam?: (pluginId: string, paramId: string, value: number, time: number) => boolean;
  /** Where sends to this track (a return) arrive: before its plugin effects, when it has some (else its strip's input). */
  sendInput?: Tone.InputNode;
  /** An Audio track's: where its audio clips play (see audioClipSchedule.ts). */
  clipBus?: NativeBus;
  /** The Slicer's: give it the track's slices and modes as they change, without a rebuild. */
  setSlicer?: (settings: SlicerSettings | undefined) => void;
  /** The Synth Designer's: its patch as it changes (from the next note), without a rebuild. */
  setSynth?: (patch: SynthPatch | undefined) => void;
  /** The Drum Rack's: its pads as they change, without a rebuild. */
  setRack?: (rack: DrumRack | undefined) => void;
  /** The Multi Sampler's: its sounds and shape as they change, without a rebuild. */
  setMulti?: (multi: MultiSample | undefined) => void;
}

/** What an instrument is built with: the Sampler's sound, the Slicer's sound and slices. */
export interface InstrumentOptions {
  sample?: CustomSample;
  slicer?: SlicerSettings;
  synth?: SynthPatch;
  /** A Plugin track's instrument */
  plugin?: WamPlugin;
  /** WAM effects between the instrument and the track's strip */
  pluginFx?: WamPlugin[];
  rack?: DrumRack;
  multi?: MultiSample;
  /** Expressive playing (Track.expressive) */
  expressive?: boolean;
}

/** What a track's instrument is built with (its sound, slices, patch, plugins). */
export function trackInstrumentOptions(track: Pick<Track, 'sample' | 'slicer' | 'synth' | 'plugin' | 'pluginFx' | 'rack' | 'multi' | 'expressive'> | null | undefined): InstrumentOptions {
  if (!track) return {};
  return { sample: track.sample, slicer: track.slicer, synth: track.synth, plugin: track.plugin, pluginFx: track.pluginFx, rack: track.rack, multi: track.multi, ...(track.expressive ? { expressive: true } : {}) };
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
  kick: (time: number, velocity: number, ratio?: number) => void;
  snare: (time: number, velocity: number, ratio?: number) => void;
  hat: (open: boolean, time: number, velocity: number, ratio?: number) => void;
  cowbell: (time: number, velocity: number, ratio?: number) => void;
}

/** Play one row of a kit at `time` (`ratio`: detune as a frequency ratio, 1 = none). */
type DrumPlayer = (row: DrumRow, time: number, velocity: number, ratio?: number) => void;

/** A synthesized kit's player: its own five sounds, and the extras for the rows added later. */
function synthKitPlayer(kit: DrumHits, extras: KitExtras): DrumPlayer {
  return (row, time, v, r = 1) => {
    switch (row) {
      case 'kick': return kit.kick(time, v, r);
      case 'snare': return kit.snare(time, v, r);
      case 'closedHat': return kit.hat(false, time, v, r);
      case 'openHat': return kit.hat(true, time, v, r);
      case 'cowbell': return kit.cowbell(time, v, r);
      default: return extraHit(extras, row, time, v, r);
    }
  };
}

function extraHit(extras: KitExtras, row: DrumRow, time: number, v: number, r = 1): void {
  if (row === 'clap') extras.clap(time, v, r);
  else if (row === 'tomLow') extras.tom('low', time, v, r);
  else if (row === 'tomMid') extras.tom('mid', time, v, r);
  else if (row === 'tomHigh') extras.tom('high', time, v, r);
  else if (row === 'crash') extras.crash(time, v, r);
  else if (row === 'ride') extras.ride(time, v, r);
  else if (row === 'cowbell') extras.cowbell(time, v, r);
}

/**
 * Expressive drums (Track.expressive): how far each row's hits may be detuned, in cents, so a
 * repeated hit isn't the identical sound (a real drum never is; real 808s drift too). The kick
 * hardly moves, so the low end stays put; hats and claps the most.
 */
const DRUM_SPREAD: Partial<Record<DrumRow, number>> = { kick: 4, snare: 14, clap: 18, closedHat: 20, openHat: 16, tomLow: 10, tomMid: 10, tomHigh: 10, crash: 12, ride: 12, cowbell: 6 };

/** Map drum-clip notes onto a kit's rows (expressive: each hit a hair different in pitch and level, seeded so exports repeat). */
function playDrums(play: DrumPlayer, notes: PlayableNote[], time: number, expressive = false): void {
  // One hi-hat voice: an open hat on the same tick replaces the closed one
  const openHat = notes.some((n) => n.note === DRUM_NOTES.openHat);
  for (const n of notes) {
    const row = ROW_OF.get(n.note);
    if (!row || (row === 'closedHat' && openHat)) continue;
    if (expressive) {
      const ratio = 2 ** (((DRUM_SPREAD[row] ?? 8) * noteJitter(row, time, 3)) / 1200);
      const velocity = Math.min(1, n.velocity * 10 ** ((0.8 * noteJitter(row, time, 5)) / 20));
      safely(() => play(row, time, velocity, ratio));
      continue;
    }
    safely(() => play(row, time, n.velocity));
  }
}

/** A synthesized kit as a track instrument. */
function synthKit(kit: DrumHits & { dispose: () => void }, output: Tone.InputNode, expressive = false): TrackInstrument {
  const extras = createKitExtras(output);
  const play: TrackInstrument['play'] = (notes, time) => playDrums(synthKitPlayer(kit, extras), notes, time, expressive);
  return {
    play,
    noteOn: oneShot(play),
    releaseAll: () => {},
    ready: Promise.resolve(),
    dispose: () => {
      kit.dispose();
      extras.dispose();
    },
  };
}

/** A recorded kit: its recordings, the hats shortened or let ring, the extras for rows it lacks. */
function recordedKit(key: InstrumentKey, output: Tone.InputNode, expressive = false): TrackInstrument {
  const kit = createSampledKit(key, output);
  const extras = createKitExtras(output);
  const player: DrumPlayer = (row, time, v, r = 1) => {
    const opts = row === 'closedHat' ? { seconds: 0.14, rate: r } : row === 'openHat' ? { rate: 0.94 * r } : { rate: r };
    const note = row === 'openHat' && !kit.has(DRUM_NOTES.openHat) ? DRUM_NOTES.closedHat : DRUM_NOTES[row];
    // Still downloading: nothing (rather than the extras standing in for every row)
    if (!kit.loaded()) return;
    if (!kit.hit(note, time, v, opts)) extraHit(extras, row, time, v, r);
  };
  const play: TrackInstrument['play'] = (notes, time) => playDrums(player, notes, time, expressive);
  return {
    play,
    noteOn: oneShot(play),
    releaseAll: kit.releaseAll,
    ready: kit.ready,
    dispose: () => {
      kit.dispose();
      extras.dispose();
    },
  };
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
  const fx = options.pluginFx?.filter((p) => !p.bypass) ?? [];
  if (!fx.length) return withTaper(key, buildGained(key, output, options));
  // The track's plugin effects come first, between the instrument and its strip
  const chain = createPluginChain(output, fx);
  const inst = withTaper(key, buildGained(key, chain.input, options));
  return {
    ...inst,
    sendInput: chain.input,
    setPluginParam: (pluginId, paramId, value, time) => chain.setPluginParam(pluginId, paramId, value, time) || (inst.setPluginParam?.(pluginId, paramId, value, time) ?? false),
    ready: Promise.all([inst.ready, chain.ready]),
    dispose: () => {
      inst.dispose();
      chain.dispose();
    },
  };
}

/**
 * The top notes of a generated instrument play quieter under its taper (see InstrumentDef.taper),
 * as the recorded ones do in their sampler: a note's velocity is scaled, which these synths turn
 * into level.
 */
function withTaper(key: InstrumentKey, inst: TrackInstrument): TrackInstrument {
  const { taper, kind } = INSTRUMENTS[key];
  if (!taper || kind === 'sampled') return inst;
  const soften = (n: PlayableNote): PlayableNote => {
    const g = taperGain(taper, n.note);
    return g === 1 ? n : { ...n, velocity: n.velocity * g };
  };
  return {
    ...inst,
    play: (notes, time) => inst.play(notes.map(soften), time),
    ...(inst.noteOn ? { noteOn: (n: PlayableNote, time: number) => inst.noteOn!(soften(n), time) } : {}),
  };
}

function buildGained(key: InstrumentKey, output: Tone.InputNode, options: InstrumentOptions): TrackInstrument {
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

  if (kind === 'plugin') return createPluginInstrument(output, options.plugin);
  if (kind === 'rack') return createRackInstrument(output, options.rack);
  if (kind === 'multi') return createMultiInstrument(output, options.multi);
  if (kind === 'bus' || kind === 'return') {
    // A bus plays nothing itself: the tracks routed to it play into its strip
    return { play: () => {}, releaseAll: () => {}, ready: Promise.resolve(), dispose: () => {} };
  }
  if (kind === 'audio') {
    // An Audio track plays no notes: its clips play their sound files into this bus
    const bus = createBus(output);
    return { play: () => {}, releaseAll: () => {}, ready: Promise.resolve(), dispose: () => bus.bus.dispose(), clipBus: bus };
  }
  if (kind === 'slicer') return createSlicer(output, options.slicer);
  if (kind === 'drums' && INSTRUMENTS[key].samples) return recordedKit(key, output, !!options.expressive);

  if (kind === 'sampled' || kind === 'custom') {
    const voice = kind === 'sampled' ? createSamplerVoice(key, output, !!options.expressive) : createCustomSamplerVoice(options.sample, output);
    return {
      play: (notes, time) => voice.play(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
      noteOn: (n, time) => {
        voice.attack(n.note, time, n.velocity);
        return (at) => voice.release(n.note, at);
      },
      bend: voice.bend,
      releaseAll: voice.releaseAll,
      ready: voice.ready,
      dispose: voice.dispose,
    };
  }

  switch (key) {
    case 'drums':
      return synthKit(createDrumKit(output), output, !!options.expressive);
    case 'drumMachine':
      return synthKit(createDrumMachine(output), output, !!options.expressive);
    case 'bass': {
      const bass = createBassVoice(output);
      return mono({ ...bass, releaseAll: () => bass.synth.triggerRelease() });
    }
    case 'subBass':
      return mono(createSubBass(output));
    case 'bass808':
      return mono(create808(output, !!options.expressive));
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
    case 'synthDesigner': {
      const synth = createDesignedSynth(output, options.synth);
      return { play: synth.play, noteOn: synth.hold, releaseAll: synth.releaseAll, dispose: synth.dispose, setSynth: synth.setPatch, ready: Promise.resolve() };
    }
    case 'chipDrums':
      return synthKit(createChipDrums(output), output);
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
