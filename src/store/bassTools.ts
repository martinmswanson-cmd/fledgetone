/**
 * The heavy bass tools' settings and rules, apart from the 808 designer's own (bass808.ts): legato
 * glide on monophonic synth tracks (Track.glide), the Sub enhancer (Track.subLayer: a clean sine
 * under a bass's notes) and the Bass Drive insert (TrackFx.bassDrive: distortion on the mids and
 * highs only, the sub kept clean and mono). Reading them from a project file, with defaults, so
 * old files keep opening. Pure, so Node tests it.
 */
import type { DriveCharacter } from '../audio/driveCurves';
import { DRIVE_CHARACTERS } from '../audio/driveCurves';
import { normalizeBass808 } from './bass808';
import type { Bass808Settings } from './bass808';

/** The Sub enhancer: a sine under every note, an octave down or on the note itself, mono. */
export interface SubLayer {
  /** 'octave': an octave below the note (a new, deeper floor); 'fundamental': on the note (a weak bass made solid) */
  mode: 'octave' | 'fundamental';
  /** How loud, 0 to 1 */
  level: number;
  /** Seconds it takes to die away (by 60 dB) while the note is held; 0 holds it for the whole note */
  decay: number;
}

/** The Bass Drive insert: the sound split at `crossover`; below it stays clean and mono, above it is distorted. */
export interface BassDriveFx {
  on: boolean;
  /** Hz, BASS_DRIVE_CROSSOVER_MIN to BASS_DRIVE_CROSSOVER_MAX */
  crossover: number;
  /** 0 to 1 */
  drive: number;
  character: DriveCharacter;
  /** How much of the distorted mids and highs replaces the clean ones, 0 to 1 */
  mix: number;
  /** A low-pass on the distorted part, Hz (1000 to 16000): tames the fizz */
  tone: number;
}

export const BASS_DRIVE_CROSSOVER_MIN = 60;
export const BASS_DRIVE_CROSSOVER_MAX = 300;
export const BASS_DRIVE_TONE_MIN = 1000;
export const BASS_DRIVE_TONE_MAX = 16000;
/** Longest legato glide, seconds. */
export const GLIDE_MAX = 1;
/** A sub below this many Hz is felt as rumble, not heard: an octave down from a low note plays on the note instead. */
export const SUB_FLOOR_HZ = 28;

export function defaultBassDrive(): BassDriveFx {
  return { on: false, crossover: 120, drive: 0.5, character: 'tube', mix: 1, tone: 7000 };
}

export function defaultSubLayer(): SubLayer {
  return { mode: 'octave', level: 0.5, decay: 0 };
}

/**
 * Instruments that play one note at a time and slide between overlapping notes: the ones the
 * Glide setting (Track.glide) works on. The 808 has its own slide time in its designer and the
 * Synth Designer its own in its patch.
 */
export const GLIDE_KEYS: ReadonlySet<string> = new Set(['bass', 'subBass', 'lead', 'wobbleBass', 'growlBass', 'reeseBass']);

/** The sub's frequency for a note of `noteHz`. */
export function subFrequency(noteHz: number, mode: SubLayer['mode']): number {
  if (mode === 'fundamental') return noteHz;
  return noteHz / 2 >= SUB_FLOOR_HZ ? noteHz / 2 : noteHz;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);

/** A saved Bass Drive made safe, or undefined if there's none. */
export function normalizeBassDrive(v: unknown): BassDriveFx | undefined {
  if (!isObj(v)) return undefined;
  const d = defaultBassDrive();
  return {
    on: v.on === true,
    crossover: num(v.crossover, d.crossover, BASS_DRIVE_CROSSOVER_MIN, BASS_DRIVE_CROSSOVER_MAX),
    drive: num(v.drive, d.drive, 0, 1),
    character: DRIVE_CHARACTERS.includes(v.character as DriveCharacter) ? (v.character as DriveCharacter) : d.character,
    mix: num(v.mix, d.mix, 0, 1),
    tone: num(v.tone, d.tone, BASS_DRIVE_TONE_MIN, BASS_DRIVE_TONE_MAX),
  };
}

/** A saved Sub enhancer made safe, or undefined if there's none. */
export function normalizeSubLayer(v: unknown): SubLayer | undefined {
  if (!isObj(v)) return undefined;
  const d = defaultSubLayer();
  return { mode: v.mode === 'fundamental' ? 'fundamental' : 'octave', level: num(v.level, d.level, 0, 1), decay: num(v.decay, d.decay, 0, 8) };
}

/** The heavy bass fields of a track in a project file, each only when it's there and readable. */
export function parseBassFields(v: Record<string, unknown>): { bass808?: Bass808Settings; glide?: number; subLayer?: SubLayer } {
  const bass808 = normalizeBass808(v.bass808);
  const subLayer = normalizeSubLayer(v.subLayer);
  const glide = typeof v.glide === 'number' && Number.isFinite(v.glide) ? Math.max(0, Math.min(GLIDE_MAX, v.glide)) : undefined;
  return { ...(bass808 ? { bass808 } : {}), ...(glide !== undefined ? { glide } : {}), ...(subLayer ? { subLayer } : {}) };
}
