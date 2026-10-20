/**
 * The 808 designer's settings, stored on an 808 Bass track (Track.bass808) and saved with the
 * project: drive and clip character with a tone control after it, the punch (a pitch drop at the
 * start), slide time, decay, a top layer of harmonics small speakers can play, an output level, and
 * an optional key the notes snap to. Absent, the track plays the original 808. The sound engine is
 * src/audio/presets/bass808Designer.ts. Pure, so Node tests it.
 */
import type { DriveCharacter } from '../audio/driveCurves';
import { DRIVE_CHARACTERS } from '../audio/driveCurves';
import type { ScaleId } from './noteTools';
import { midiOf, nameOf, SCALES, snapToScale } from './noteTools';

export interface Bass808Settings {
  /** Distortion, 0 (a clean sine) to 1 (clipped hard) */
  drive: number;
  /** How it distorts (see driveCurves.ts) */
  character: DriveCharacter;
  /** A low-pass after the distortion, Hz (BASS808_TONE_MIN to BASS808_TONE_MAX): lower is darker */
  tone: number;
  /** The punch: how far above the note each hit starts, in semitones (0 to 36), dropping to the note */
  punch: number;
  /** How long the punch takes to drop to the note, seconds (0.005 to 0.3) */
  punchTime: number;
  /** Seconds a note takes to slide to the next one's pitch when they overlap (0.01 to 0.6) */
  glide: number;
  /** Seconds a held note takes to die away (by 60 dB), 0.1 to 8 */
  decay: number;
  /** The top layer: distortion harmonics above the sub, for phones and laptops, 0 to 1 */
  top: number;
  /** Output level, dB (-12 to 6) */
  level: number;
  /** Snap every note to this key while it plays (absent: as written). Root 0 = C. */
  tuneToKey?: { root: number; scale: ScaleId };
}

export const BASS808_TONE_MIN = 200;
export const BASS808_TONE_MAX = 16000;

/** The designer's starting point: a clean, deep 808. */
export function defaultBass808(): Bass808Settings {
  return { drive: 0, character: 'tube', tone: 16000, punch: 7, punchTime: 0.04, glide: 0.08, decay: 2.5, top: 0.1, level: 0 };
}

/** Starting points, named by how they sound (and the style they suit). */
export const BASS808_PRESETS: ReadonlyArray<{ name: string; blurb: string; settings: Partial<Bass808Settings> }> = [
  { name: 'Clean deep', blurb: 'A pure, long sine sub: felt more than heard', settings: {} },
  { name: 'Punchy', blurb: 'A hard pitch drop and a short tail that hits like a kick', settings: { drive: 0.25, tone: 5000, punch: 14, punchTime: 0.03, decay: 0.9, top: 0.35, level: 2 } },
  { name: 'Distorted', blurb: 'Warm saturation all the way down: growls on small speakers', settings: { drive: 0.6, tone: 4000, punch: 10, decay: 1.8, top: 0.4 } },
  { name: 'Blown-out', blurb: 'Clipped flat and loud, buzzing through everything', settings: { drive: 1, character: 'hard', tone: 7000, punch: 12, punchTime: 0.05, decay: 2.2, top: 0.6, level: -1 } },
  { name: 'Long slide', blurb: 'A long tail with slow, wide slides between notes', settings: { drive: 0.35, tone: 3500, punch: 5, punchTime: 0.03, glide: 0.16, decay: 3.2, top: 0.4 } },
  { name: 'Dark (room for cowbell)', blurb: 'Folded grit kept dark, under the cowbell, with a tight tail', settings: { drive: 0.4, character: 'fold', tone: 800, punch: 9, punchTime: 0.035, glide: 0.06, decay: 0.8, top: 0.15 } },
];

/** A preset's full settings (unknown name: the default). */
export function bass808Preset(name: string): Bass808Settings {
  return { ...defaultBass808(), ...(BASS808_PRESETS.find((p) => p.name === name)?.settings ?? {}) };
}

/** The note `note` plays as: snapped into the settings' key when there is one. */
export function tuneNote(note: string, settings: Pick<Bass808Settings, 'tuneToKey'> | undefined): string {
  const key = settings?.tuneToKey;
  if (!key) return note;
  const m = midiOf(note);
  if (!Number.isFinite(m)) return note;
  const snapped = snapToScale(m, { root: key.root, id: key.scale });
  return snapped === m ? note : nameOf(snapped);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);

/** Saved (or hand-edited) settings made safe: every one present and in range. Undefined if it isn't one. */
export function normalizeBass808(v: unknown): Bass808Settings | undefined {
  if (!isObj(v)) return undefined;
  const d = defaultBass808();
  const k = isObj(v.tuneToKey) ? v.tuneToKey : null;
  const scale = k && typeof k.scale === 'string' && k.scale in SCALES ? (k.scale as ScaleId) : null;
  return {
    drive: num(v.drive, d.drive, 0, 1),
    character: DRIVE_CHARACTERS.includes(v.character as DriveCharacter) ? (v.character as DriveCharacter) : d.character,
    tone: num(v.tone, d.tone, BASS808_TONE_MIN, BASS808_TONE_MAX),
    punch: num(v.punch, d.punch, 0, 36),
    punchTime: num(v.punchTime, d.punchTime, 0.005, 0.3),
    glide: num(v.glide, d.glide, 0.01, 0.6),
    decay: num(v.decay, d.decay, 0.1, 8),
    top: num(v.top, d.top, 0, 1),
    level: num(v.level, d.level, -12, 6),
    ...(k && scale ? { tuneToKey: { root: Math.round(num(k.root, 0, 0, 11)), scale } } : {}),
  };
}
