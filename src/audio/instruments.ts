/**
 * The TrackInstrument interface every instrument implements, and createInstrument, which builds
 * any instrument in the catalog (synths, drum kits, recorded instruments, the Sampler, Slicer,
 * Drum Rack, Multi Sampler, Synth Designer and plugins) in the current Tone context, with its
 * level correction and high-note taper. Also the drum note map (DRUM_NOTES) and the expressive
 * drum detune.
 */
import { createDropInstrument } from './dropLive';
import { liveContext } from './liveContext';
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
import { CLAP_DB, createKitExtras } from './presets/kitExtras';
import type { KitExtras } from './presets/kitExtras';
import { createSampledKit } from './presets/sampledKit';
import { createSlicer } from './presets/slicer';
import { createBus } from './presets/native';
import { alwaysStereo } from './nativeNodes';
import type { NativeBus } from './presets/native';
import { createCustomSamplerVoice, createSamplerVoice, noteJitter, taperGain, type PlayFeel } from './samplers/samplerManager';
import type { NoteExpression } from '../store/timelineTypes';
import type { CustomSample, DrumRack, MultiSample, SlicerSettings, Track, WamPlugin, WobbleRate } from '../store/timelineTypes';
import { createMultiInstrument, createRackInstrument } from './presets/sampleKits';
import { createPluginChain, createPluginInstrument } from './presets/wamPlugin';
import type { SynthPatch } from '../store/synthPatch';
import { createDesignedSynth } from './presets/designer';
import { createDesignedKit } from './presets/designedKit';
import type { DrumDesign } from '../store/drumDesign';
import { SYNTH_KIT_DESIGNS } from '../store/synthKits';
import { trackSeed } from './seededNoise';
import type { Bass808Settings } from '../store/bass808';
import type { SubLayer } from '../store/bassTools';
import { createBass808Designer } from './presets/bass808Designer';
import { createSubLayer } from './subLayer';
import { isPitched } from '../store/keyChange';
import type { TrackPlan } from './samplers/songSamples';
import { DRUM_NOTES } from '../store/drumNotes';

/** Drum note map (GM-style), kept in store/drumNotes.ts so Node can read it. */
export { DRUM_NOTES };
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
  /**
   * Pitch bend in cents, for the instruments whose voices can bend (the others ignore it).
   * `live`: the wheel on the player's keyboard (a plugin keeps it where the song's bend is at rest).
   * Bends may be sent well ahead of their time (a note's whole slide when it starts), and a note
   * starts at the bend in force when it starts (see bendTimeline.ts). `cut`: the bends sent for
   * `time` and after are dropped first (a jump, Stop).
   */
  bend?: (cents: number, time: number, live?: boolean, cut?: boolean) => void;
  /**
   * The mod wheel as dynamics (0 soft to 1 loud) from `time`, for instruments recorded at several
   * loudnesses (InstrumentDef.dynamics): played instead of the wheel's vibrato. null: no wheel.
   */
  dynamics?: (value: number | null, time: number) => void;
  /** A MIDI controller (0 to 119) moved to `value` (0 to 1): plugins get it as MIDI (`live`: from the player's keyboard). */
  cc?: (cc: number, value: number, time: number, live?: boolean) => void;
  /**
   * Reset All Controllers (CC 121) at `time`. True if that puts every controller back where the
   * fresh plugin has it (see resetsFresh in ccHold.ts); false where it may not.
   */
  resetControllers?: (time: number) => boolean;
  /**
   * Start one note whose bend and pressure can then be moved on their own (per-note expression),
   * or null if it doesn't sound. Instruments without it play expressive notes as ordinary ones,
   * bending as a whole.
   */
  noteVoice?: (note: PlayableNote, time: number) => VoiceControl | null;
  releaseAll: () => void;
  /** Resolves when the instrument can sound (reverb generated, samples downloaded). */
  ready: Promise<unknown>;
  /**
   * Make ahead what these notes will play (after `ready`): the copies of its recordings or sounds
   * at the other pitches they play them at (see pitchedCopies.ts). A render waits for it before it
   * plays, and then plays only those copies; live playback makes them in the background.
   */
  prepare?: (plan: TrackPlan) => Promise<unknown>;
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
  /** The 808's: its designer settings as they change (undefined: the original 808), without a rebuild. */
  setBass808?: (settings: Bass808Settings | undefined) => void;
  /** A monophonic synth's legato glide time as it changes (undefined: its own), without a rebuild. */
  setGlide?: (seconds: number | undefined) => void;
  /** A pitched instrument's Sub enhancer as it changes (undefined: off), without a rebuild. */
  setSubLayer?: (sub: SubLayer | undefined) => void;
  /** A recorded instrument's ring and breath (Track.ring, Track.breathe) as they change, from the next note, without a rebuild. */
  setFeel?: (ring: number | undefined, breathe: boolean | undefined) => void;
  /** The Drum Rack's: its pads as they change, without a rebuild. */
  setRack?: (rack: DrumRack | undefined) => void;
  /** The Multi Sampler's: its sounds and shape as they change, without a rebuild. */
  setMulti?: (multi: MultiSample | undefined) => void;
  /** The Designed Kit's: its drum sounds as they change, without a rebuild. */
  setDrumDesign?: (design: DrumDesign | undefined) => void;
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
  /** The Designed Kit's drum sounds */
  drumDesign?: DrumDesign;
  /** Expressive playing (Track.expressive) */
  expressive?: boolean;
  /** The track's seed (trackSeed): with each note's time it picks the noise in its drums and synths, the same on every play */
  seed?: number;
  /** The 808 designer's settings (Track.bass808) */
  bass808?: Bass808Settings;
  /** Legato glide seconds for a monophonic synth (Track.glide) */
  glide?: number;
  /** The Sub enhancer (Track.subLayer) */
  subLayer?: SubLayer;
  /** (Built by createInstrument) where a monophonic synth reads its glide, kept up to date by setGlide */
  glideRef?: GlideRef;
  /** How long a recorded instrument's notes ring once let go (Track.ring) */
  ring?: number;
  /** False: wind and brass players never run out of breath (Track.breathe) */
  breathe?: boolean;
  /** (Built by createInstrument) where a recorded instrument reads its ring and breath, kept up to date by setFeel */
  feel?: PlayFeel;
}

/** A monophonic synth's legato glide, read at each note: seconds, or undefined for the synth's own. */
export interface GlideRef {
  seconds: number | undefined;
}

/** What a track's instrument is built with (its sound, slices, patch, plugins). */
export function trackInstrumentOptions(track: Pick<Track, 'id' | 'sample' | 'slicer' | 'synth' | 'plugin' | 'pluginFx' | 'rack' | 'multi' | 'drumDesign' | 'expressive' | 'bass808' | 'glide' | 'subLayer' | 'ring' | 'breathe'> | null | undefined): InstrumentOptions {
  if (!track) return {};
  return {
    sample: track.sample,
    slicer: track.slicer,
    synth: track.synth,
    plugin: track.plugin,
    pluginFx: track.pluginFx,
    rack: track.rack,
    multi: track.multi,
    ...(track.drumDesign ? { drumDesign: track.drumDesign } : {}),
    ...(track.expressive ? { expressive: true } : {}),
    seed: trackSeed(track.id),
    ...(track.bass808 ? { bass808: track.bass808 } : {}),
    ...(track.glide !== undefined ? { glide: track.glide } : {}),
    ...(track.subLayer ? { subLayer: track.subLayer } : {}),
    ...(track.ring !== undefined ? { ring: track.ring } : {}),
    ...(track.breathe === false ? { breathe: false } : {}),
  };
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
 * hardly moves, so the low end stays put; hats and claps the most. Synthesized kits only: a kit
 * that plays recordings (a recorded kit, the Designed Kit's rendered hits) would resample every
 * hit for it, which dulls the cymbals, so its hits vary in level alone.
 */
const DRUM_SPREAD: Partial<Record<DrumRow, number>> = { kick: 4, snare: 14, clap: 18, closedHat: 20, openHat: 16, tomLow: 10, tomMid: 10, tomHigh: 10, crash: 12, ride: 12, cowbell: 6 };

/**
 * A drum hit's own pitch, as a frequency ratio: the bend it starts with (in semitones, see
 * NoteExpression), as the hat roll painter's rising pitch writes it; 1 for none.
 */
const hitPitch = (n: Pick<PlayableNote, 'expr'>) => {
  const st = n.expr?.bend?.[0]?.value ?? 0;
  return st ? 2 ** (Math.max(-24, Math.min(24, st)) / 12) : 1;
};

/**
 * Map drum-clip notes onto a kit's rows (expressive: each hit a hair different in level, and in
 * pitch where `detune`, seeded so exports repeat).
 */
function playDrums(play: DrumPlayer, notes: PlayableNote[], time: number, expressive = false, detune = true): void {
  // One hi-hat voice: an open hat on the same tick replaces the closed one
  const openHat = notes.some((n) => n.note === DRUM_NOTES.openHat);
  for (const n of notes) {
    const row = ROW_OF.get(n.note);
    if (!row || (row === 'closedHat' && openHat)) continue;
    const pitch = hitPitch(n);
    if (expressive) {
      const ratio = detune ? pitch * 2 ** (((DRUM_SPREAD[row] ?? 8) * noteJitter(row, time, 3)) / 1200) : pitch;
      const velocity = Math.min(1, n.velocity * 10 ** ((0.8 * noteJitter(row, time, 5)) / 20));
      safely(() => play(row, time, velocity, ratio));
      continue;
    }
    safely(() => play(row, time, n.velocity, pitch));
  }
}

/** A synthesized kit as a track instrument. */
function synthKit(kit: DrumHits & { dispose: () => void }, output: Tone.InputNode, expressive = false, seed = 0): TrackInstrument {
  const extras = createKitExtras(output, seed);
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

/**
 * How much quieter (dB) the Designed Kit's expressive hits play, by row: they were detuned once,
 * and resampling a hit dulled its noise (a snare, the hats and cymbals) by about this much, so an
 * expressive song keeps the level it had now that they play as designed (measured over 32 hits a
 * row of the default design, against the detuned ones).
 */
export const DESIGNED_EXPRESSIVE_DB: Partial<Record<DrumRow, number>> = { snare: -1.5, closedHat: -2.4, openHat: -2.4, crash: -2.5, ride: -0.9 };

/** The Designed Kit (see designedKit.ts): every row the sound designed for it. */
function designedKit(output: Tone.InputNode, design: DrumDesign | undefined, expressive = false, seed = 0): TrackInstrument {
  const kit = createDesignedKit(output, design, seed);
  // (a hit's level goes with its velocity to the 1.5: see designedKit.ts)
  const level = (row: DrumRow) => (expressive ? 10 ** ((DESIGNED_EXPRESSIVE_DB[row] ?? 0) / 20 / 1.5) : 1);
  const play: TrackInstrument['play'] = (notes, time) => playDrums((row, t, v, r = 1) => kit.hit(row, t, v * level(row), r), notes, time, expressive, false);
  return {
    play,
    noteOn: oneShot(play),
    releaseAll: kit.releaseAll,
    ready: Promise.resolve(),
    dispose: kit.dispose,
    setDrumDesign: kit.setDesign,
  };
}

/** A recorded kit: its recordings, the hats shortened or let ring, the extras for rows it lacks. */
function recordedKit(key: InstrumentKey, output: Tone.InputNode, expressive = false, seed = 0): TrackInstrument {
  const kit = createSampledKit(key, output);
  // (The kit's own raise in the catalog raises its extras too: the clap takes that much less)
  const extras = createKitExtras(output, seed, CLAP_DB - (INSTRUMENTS[key].gain ?? 0));
  /** What a row's hit at pitch `r` plays: the kit's note, and its rate (an open hat a little lower) */
  const hitOf = (row: DrumRow, r: number) => ({
    note: row === 'openHat' && !kit.has(DRUM_NOTES.openHat) ? DRUM_NOTES.closedHat : DRUM_NOTES[row],
    rate: row === 'openHat' ? 0.94 * r : r,
  });
  const player: DrumPlayer = (row, time, v, r = 1) => {
    const { note, rate } = hitOf(row, r);
    const opts = row === 'closedHat' ? { seconds: 0.14, rate } : { rate };
    // Still downloading: nothing (rather than the extras standing in for every row)
    if (!kit.loaded()) return;
    if (!kit.hit(note, time, v, opts)) extraHit(extras, row, time, v, r);
  };
  const play: TrackInstrument['play'] = (notes, time) => playDrums(player, notes, time, expressive, false);
  // Live: the open hat's copy a little lower, as soon as the kit is in (see sampledKit.ts)
  if (Tone.getContext() === liveContext) void kit.ready.then(() => kit.prepare(hitOf('openHat', 1).note, 0.94)).catch(() => {});
  return {
    play,
    noteOn: oneShot(play),
    releaseAll: kit.releaseAll,
    ready: kit.ready,
    // Every pitch the hits play at other than the recordings' own (the open hat's, a hit's starting bend)
    prepare: (plan) => {
      const want = new Map<string, number>();
      for (const n of plan.notes) {
        const row = ROW_OF.get(n.note);
        if (!row) continue;
        const { note, rate } = hitOf(row, hitPitch(n));
        if (rate !== 1) want.set(`${note}|${rate}`, rate);
      }
      return Promise.all([...want].map(([k, rate]) => kit.prepare(k.slice(0, k.lastIndexOf('|')), rate)));
    },
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
  bend: (cents: number, t: number, live?: boolean, cut?: boolean) => void;
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

/**
 * The 808: the designed one (bass808Designer.ts) while the track has designer settings, else the
 * original. Switching between them needs no rebuild: the one let go fades and is disposed.
 */
function create808Instrument(output: Tone.InputNode, options: InstrumentOptions): TrackInstrument {
  let legacy: TrackInstrument | null = null;
  let designed: ReturnType<typeof createBass808Designer> | null = null;
  let useDesigned = !!options.bass808;
  const getLegacy = () => (legacy ??= mono(create808(output, !!options.expressive)));
  const getDesigned = () => (designed ??= createBass808Designer(output, options.bass808));
  if (useDesigned) getDesigned();
  else getLegacy();
  const retire = (inst: { releaseAll: () => void; dispose: () => void }) => {
    inst.releaseAll();
    setTimeout(() => inst.dispose(), 1000);
  };
  return {
    play: (notes, time) => (useDesigned ? getDesigned().play(notes, time) : getLegacy().play(notes, time)),
    noteOn: (n, time) => (useDesigned ? getDesigned().hold(n, time) : getLegacy().noteOn!(n, time)),
    bend: (cents, time, live, cut) => (useDesigned ? getDesigned().bend(cents, time, live, cut) : getLegacy().bend?.(cents, time, live, cut)),
    setBass808: (settings) => {
      if (!!settings !== useDesigned) {
        useDesigned = !!settings;
        if (useDesigned && legacy) {
          retire(legacy);
          legacy = null;
        } else if (!useDesigned && designed) {
          retire(designed);
          designed = null;
        }
      }
      if (settings) getDesigned().setSettings(settings);
    },
    releaseAll: () => {
      legacy?.releaseAll();
      designed?.releaseAll();
    },
    ready: Promise.resolve(),
    dispose: () => {
      legacy?.dispose();
      designed?.dispose();
    },
  };
}

/** A pool synth (chords): a held key gets a voice of its own until it's let go. */
function poly(
  synth: { attack: (note: string, t: number, v: number) => { release: (t: number) => void }; bend: (cents: number, t: number, live?: boolean, cut?: boolean) => void },
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
  if (!fx.length) return withDynamics(output, (to) => withTaper(key, withBassTools(key, to, options)));
  // The track's plugin effects come first, between the instrument and its strip
  const chain = createPluginChain(output, fx);
  const inst = withDynamics(chain.input, (to) => withTaper(key, withBassTools(key, to, options)));
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

/** From the softest to the loudest under the mod wheel's dynamics, in dB (as the layered samplers' DYNAMICS_DB). */
const WHEEL_DB = 18;
/** The softest the mod wheel's dynamics make an instrument's top: this many octaves below fully open. */
const WHEEL_DARK_OCTAVES = 4;
/** How quickly the dynamics follow the wheel (time constant, s): smooth, without zipper noise. */
const WHEEL_TC = 0.03;

/**
 * The mod wheel as dynamics for every instrument (TrackInstrument.dynamics): one recorded at
 * several loudnesses crossfades them itself (see samplerManager.ts); any other is made quieter and
 * darker as the wheel comes down, as a softer note of a real instrument is, by a level and a
 * low-pass between it and `output`. Until a wheel moves, that stage is a plain gain of 1 (the
 * low-pass is only put in on the first wheel), so a song without a wheel lane sounds as it did.
 */
function withDynamics(output: Tone.InputNode, build: (to: Tone.InputNode) => TrackInstrument): TrackInstrument {
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const level = raw.createGain();
  Tone.connect(level, output);
  const inst = build(level);
  if (inst.dynamics) {
    return {
      ...inst,
      dispose: () => {
        inst.dispose();
        level.disconnect();
      },
    };
  }
  let tone: BiquadFilterNode | null = null;
  const open = raw.sampleRate / 2 - 1;
  return {
    ...inst,
    dynamics: (value, time) => {
      if (value === null) {
        if (!tone) return;
        level.gain.setTargetAtTime(1, time, WHEEL_TC);
        tone.frequency.setTargetAtTime(open, time, WHEEL_TC);
        return;
      }
      if (!tone) {
        tone = raw.createBiquadFilter();
        tone.type = 'lowpass';
        tone.Q.value = 0.5;
        tone.frequency.value = open;
        level.disconnect();
        level.connect(tone);
        Tone.connect(tone, output);
      }
      const x = Math.max(0, Math.min(1, value));
      level.gain.setTargetAtTime(10 ** ((-WHEEL_DB * (1 - x)) / 20), time, WHEEL_TC);
      tone.frequency.setTargetAtTime(Math.min(open, 20000 * 2 ** (-WHEEL_DARK_OCTAVES * (1 - x))), time, WHEEL_TC);
    },
    dispose: () => {
      inst.dispose();
      level.disconnect();
      tone?.disconnect();
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
    ...(inst.noteVoice ? { noteVoice: (n: PlayableNote, time: number) => inst.noteVoice!(soften(n), time) } : {}),
  };
}

/**
 * The heavy bass tools a track's instrument may carry: a legato glide it reads at each note (see
 * GlideRef), and for a pitched instrument the Sub enhancer, a sine under its notes (subLayer.ts),
 * which has no nodes while it's off.
 */
function withBassTools(key: InstrumentKey, output: Tone.InputNode, options: InstrumentOptions): TrackInstrument {
  const glideRef: GlideRef = { seconds: options.glide };
  const feel: PlayFeel = { ring: options.ring, breathe: options.breathe };
  const inst = buildGained(key, output, { ...options, glideRef, feel });
  const withGlide: TrackInstrument = {
    ...inst,
    setGlide: (seconds) => void (glideRef.seconds = seconds),
    setFeel: (ring, breathe) => Object.assign(feel, { ring, breathe }),
  };
  if (!isPitched(key)) return withGlide;
  const sub = createSubLayer(output, options.subLayer);
  const glide = () => glideRef.seconds ?? options.bass808?.glide;
  return {
    ...withGlide,
    play: (notes, time) => {
      inst.play(notes, time);
      sub.play(notes, time, glide());
    },
    ...(inst.noteOn
      ? {
          noteOn: (n: PlayableNote, time: number) => {
            const letGo = inst.noteOn!(n, time);
            const subGo = sub.hold(n, time, glide());
            return (at: number) => {
              letGo(at);
              subGo(at);
            };
          },
        }
      : {}),
    ...(inst.noteVoice
      ? {
          noteVoice: (n: PlayableNote, time: number) => {
            const voice = inst.noteVoice!(n, time);
            if (!voice) return voice;
            // Held with the note, and let go with it (not a fixed length)
            const subGo = sub.hold(n, time, glide());
            return {
              ...voice,
              off: (at: number) => {
                voice.off(at);
                subGo(at);
              },
            };
          },
        }
      : {}),
    setSubLayer: sub.set,
    releaseAll: () => {
      inst.releaseAll();
      sub.releaseAll();
    },
    dispose: () => {
      inst.dispose();
      sub.dispose();
    },
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
    // Two channels from here on, whatever mix of one- and two-channel sounds its clips play (see alwaysStereo)
    alwaysStereo(bus.bus);
    return { play: () => {}, releaseAll: () => {}, ready: Promise.resolve(), dispose: () => bus.bus.dispose(), clipBus: bus };
  }
  if (kind === 'slicer') return createSlicer(output, options.slicer);
  // Plays nothing itself: its notes hold the master's Drop effects (live only; an export runs them after its render)
  if (kind === 'drop') return createDropInstrument(Tone.getContext() !== liveContext);
  if (kind === 'drums' && INSTRUMENTS[key].samples) return recordedKit(key, output, !!options.expressive, options.seed);

  if (kind === 'sampled' || kind === 'custom') {
    const voice = kind === 'sampled' ? createSamplerVoice(key, output, !!options.expressive, options.feel) : createCustomSamplerVoice(options.sample, output);
    return {
      play: (notes, time) => voice.play(notes.map((n) => n.note), notes[0].duration, time, loudest(notes)),
      noteOn: (n, time) => {
        voice.attack(n.note, time, n.velocity);
        return (at) => voice.release(n.note, at);
      },
      bend: voice.bend,
      ...(kind === 'sampled' && INSTRUMENTS[key].dynamics && voice.dynamics ? { dynamics: voice.dynamics } : {}),
      releaseAll: voice.releaseAll,
      ready: voice.ready,
      prepare: voice.prepare,
      dispose: voice.dispose,
    };
  }

  switch (key) {
    case 'drums':
      return synthKit(createDrumKit(output, options.seed), output, !!options.expressive, options.seed);
    case 'drumMachine':
      return synthKit(createDrumMachine(output, options.seed), output, !!options.expressive, options.seed);
    case 'designedKit':
      return designedKit(output, options.drumDesign, !!options.expressive, options.seed);
    case 'technoKit':
    case 'retroDrumMachine':
    case 'rhythmBox':
    case 'breakbeatKit': {
      // A synthesized kit: the Designed Kit playing its fixed sounds (store/synthKits.ts)
      const kit = designedKit(output, SYNTH_KIT_DESIGNS[key], !!options.expressive, options.seed);
      return { ...kit, setDrumDesign: undefined };
    }
    case 'bass': {
      const bass = createBassVoice(output, options.glideRef);
      return mono({ ...bass, releaseAll: () => bass.synth.triggerRelease() });
    }
    case 'subBass':
      return mono(createSubBass(output, options.glideRef));
    case 'bass808':
      return create808Instrument(output, options);
    case 'lead':
      return mono(createLead(output, options.glideRef));
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
      const bass = create(output, options.glideRef);
      // Monophonic: the loudest note at each tick wins. A held key is a long note let go early.
      return {
        play: (notes, time) => bass.trigger(loudestNote(notes), time),
        noteOn: (n, time) => {
          bass.trigger({ ...n, duration: HELD_NOTE }, time);
          return (at) => bass.release(n.note, at);
        },
        bend: bass.bend,
        releaseAll: bass.releaseAll,
        ready: Promise.resolve(),
        dispose: bass.dispose,
      };
    }
    case 'synthDesigner': {
      const synth = createDesignedSynth(output, options.synth, options.seed);
      return { play: synth.play, noteOn: synth.hold, bend: synth.bend, releaseAll: synth.releaseAll, dispose: synth.dispose, setSynth: synth.setPatch, ready: Promise.resolve() };
    }
    case 'chipDrums':
      return synthKit(createChipDrums(output, options.seed), output, false, options.seed);
    case 'chipLead':
    case 'chipBass': {
      const synth = key === 'chipLead' ? createChipLead(output) : createChipBass(output);
      return { play: synth.play, noteOn: synth.hold, releaseAll: synth.releaseAll, dispose: synth.dispose, ready: Promise.resolve() };
    }
    case 'supersaw':
    case 'pluck':
    case 'fx': {
      const synth = key === 'supersaw' ? createSupersaw(output) : key === 'pluck' ? createPluck(output) : createFx(output, options.seed);
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
