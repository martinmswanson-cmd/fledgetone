/**
 * The Pigeons picture's backgrounds and camera angles, and when a video changes from one to the
 * next: plain data and sums (no three.js), so the Export dialog and the tests can read them without
 * the scene. pigeonScene.ts draws them: the floor's details for each background are there.
 */

export type BackgroundId = 'plaza' | 'park' | 'sunset' | 'night' | 'snow' | 'beach' | 'space' | 'neon' | 'clouds';

export interface PigeonBackground {
  id: BackgroundId;
  name: string;
  /** What it looks like, for the Export dialog */
  blurb: string;
  /** The floor's colour */
  floor: string;
  /** The light from above and the light bounced up from the floor, and how strong they are together */
  sky: string;
  bounce: string;
  skyLight: number;
  /** The sun (or moon): its colour and strength */
  sun: string;
  sunLight: number;
  /** A dark floor: the export draws its title and marks in light ink over it */
  dark: boolean;
  /**
   * How much it moves with the music, 0 to 1: how far its details jump on the beat, flare on notes
   * and quicken in busy passages. The calm ones (the clouds, the plaza, the beach) are low.
   */
  lively: number;
  /** How fast its drifting things (clouds, stars, leaves, snow) cross the floor at their fastest, in white keys' widths a second */
  drift: number;
  /** What the light and floor become by the end of the song, if they change through it (the sunset going down) */
  late?: { floor: string; sky: string; sun: string };
}

export const PIGEON_BACKGROUNDS: PigeonBackground[] = [
  { id: 'plaza', name: 'Plaza', blurb: 'Pale paving stones, a few crumbs', floor: '#e9e6e1', sky: '#ffffff', bounce: '#b8b2a8', skyLight: 1.6, sun: '#ffffff', sunLight: 1.6, dark: false, lively: 0.3, drift: 0 },
  { id: 'park', name: 'Park', blurb: 'Grass with daisies and fallen leaves', floor: '#a5cf83', sky: '#f4ffe9', bounce: '#7fa860', skyLight: 1.6, sun: '#fff8e0', sunLight: 1.6, dark: false, lively: 0.5, drift: 0.25 },
  { id: 'sunset', name: 'Rooftop at sunset', blurb: 'Warm terracotta tiles in low orange light', floor: '#e9ab84', sky: '#ffd9b8', bounce: '#c9785a', skyLight: 1.5, sun: '#ffb070', sunLight: 1.8, dark: false, lively: 0.3, drift: 0, late: { floor: '#c98a78', sky: '#e9b5c0', sun: '#ff7f66' } },
  { id: 'night', name: 'Night street', blurb: 'Dark wet paving with puddles: the keys glow', floor: '#232844', sky: '#8f9fe0', bounce: '#2a2f55', skyLight: 1.5, sun: '#b9c6ff', sunLight: 1.1, dark: true, lively: 0.6, drift: 0 },
  { id: 'snow', name: 'Snow', blurb: 'Fresh snow with trails of bird tracks', floor: '#f1f5fb', sky: '#ffffff', bounce: '#b9c8e0', skyLight: 1.7, sun: '#eef4ff', sunLight: 1.4, dark: false, lively: 0.4, drift: 0.7 },
  { id: 'space', name: 'Space', blurb: 'Stars, planets and drifting nebulas under a keyboard afloat', floor: '#0d0b24', sky: '#b9b4ff', bounce: '#3a2a6e', skyLight: 1.5, sun: '#ffffff', sunLight: 1.5, dark: true, lively: 0.6, drift: 0.3 },
  { id: 'neon', name: 'Future city', blurb: 'A dark grid lit in neon pink and cyan, circuits running under the keys', floor: '#120d2b', sky: '#9fd8ff', bounce: '#7a2a8a', skyLight: 1.5, sun: '#ffc4f4', sunLight: 1.3, dark: true, lively: 1, drift: 0 },
  { id: 'clouds', name: 'Above the clouds', blurb: 'Blue sky with white clouds far below', floor: '#8fc4f2', sky: '#ffffff', bounce: '#9fc6ea', skyLight: 1.7, sun: '#fffbe6', sunLight: 1.6, dark: false, lively: 0.2, drift: 0.16 },
  { id: 'beach', name: 'Beach', blurb: 'Rippled sand with shells and starfish', floor: '#eed9a6', sky: '#fffbe8', bounce: '#c9ab72', skyLight: 1.6, sun: '#fff3d0', sunLight: 1.7, dark: false, lively: 0.3, drift: 0 },
];

export type CameraId = 'diagonal' | 'above' | 'low' | 'behind' | 'close';

export interface PigeonCamera {
  id: CameraId;
  name: string;
  blurb: string;
  /** Where the camera stands round the keys (radians; 0: straight in front of them) and how high it looks from (0: level, π/2: straight down) */
  yaw: number;
  pitch: number;
  /** How steeply the keyboard runs across the picture (radians up from level, left to right), in a tall frame and a wide one */
  slope: { tall: number; wide: number };
  /** How many white keys' width fits across the frame's narrow side at the closest it comes */
  across: { tall: number; wide: number };
  /** The furthest it pulls back to show parts far apart (1: not at all; 0.4: to two and a half times as much) */
  furthest: number;
}

export const PIGEON_CAMERAS: PigeonCamera[] = [
  { id: 'diagonal', name: 'Diagonal', blurb: 'From above and in front, the keys running corner to corner', yaw: -0.5, pitch: 0.92, slope: { tall: 0.66, wide: 0.24 }, across: { tall: 16, wide: 17 }, furthest: 0.4 },
  { id: 'above', name: 'From above', blurb: 'Straight down on the keys', yaw: 0, pitch: 1.5, slope: { tall: 0.95, wide: 0 }, across: { tall: 16, wide: 15 }, furthest: 0.4 },
  { id: 'low', name: 'Low, from the front', blurb: 'Down near the floor, the birds seen from the side', yaw: 0.42, pitch: 0.6, slope: { tall: 0.5, wide: 0.1 }, across: { tall: 15, wide: 13 }, furthest: 0.45 },
  { id: 'behind', name: 'From behind', blurb: 'Over the black keys, from the far side: the low notes are on the right, as they are from there', yaw: Math.PI - 0.55, pitch: 0.85, slope: { tall: -0.66, wide: -0.22 }, across: { tall: 16, wide: 17 }, furthest: 0.4 },
  { id: 'close', name: 'Close up', blurb: 'In close on what is playing; far-off parts go out of the frame', yaw: -0.3, pitch: 0.8, slope: { tall: 0.6, wide: 0.16 }, across: { tall: 10, wide: 9 }, furthest: 0.75 },
];

/**
 * How far to roll a camera (radians, about the way it looks) so the keyboard runs at `slope` across
 * the picture, given which way the keyboard runs across it unrolled (`alongX` to the right,
 * `alongY` up): the lesser turn of the two that give that slope, so the camera stays the right way
 * up. (From behind the keys that leaves the low notes on the right, as they are from there.)
 */
export function uprightRoll(alongX: number, alongY: number, slope: number): number {
  let roll = Math.atan2(alongY, alongX) - slope;
  roll = Math.atan2(Math.sin(roll), Math.cos(roll));
  if (Math.abs(roll) > Math.PI / 2) roll -= Math.sign(roll) * Math.PI;
  return roll;
}

/** Which backgrounds and camera angles a video uses, in the order they appear, and when it changes to the next (seconds from its start) */
export interface PigeonLook {
  backgrounds: BackgroundId[];
  backgroundAt: number[];
  cameras: CameraId[];
  cameraAt: number[];
  /** How much the backgrounds move with the music: 0 still, 1 fully (each background's own liveliness scales it) */
  motion: number;
}

export const DEFAULT_PIGEON_LOOK: PigeonLook = { backgrounds: ['plaza'], backgroundAt: [], cameras: ['diagonal'], cameraAt: [], motion: 1 };

/** How long one background takes to fade into the next (seconds) */
export const BACKGROUND_FADE = 0.8;

/** The ones of `ids` that are known, in the order given, each once; the usual one if there are none */
const known = <T extends string>(ids: unknown, all: readonly T[], fallback: T): T[] => {
  const picked = Array.isArray(ids) ? (ids.filter((id, i) => all.includes(id as T) && ids.indexOf(id) === i) as T[]) : [];
  return picked.length ? picked : [fallback];
};
const times = (list: unknown): number[] => (Array.isArray(list) ? list.filter((t): t is number => typeof t === 'number' && Number.isFinite(t) && t > 0).sort((a, b) => a - b) : []);

/** A look made whole and safe to draw: known backgrounds and cameras (at least one of each), times in order */
export function cleanLook(look?: Partial<PigeonLook> | null): PigeonLook {
  return {
    backgrounds: known(look?.backgrounds, PIGEON_BACKGROUNDS.map((b) => b.id), 'plaza'),
    backgroundAt: times(look?.backgroundAt),
    cameras: known(look?.cameras, PIGEON_CAMERAS.map((c) => c.id), 'diagonal'),
    cameraAt: times(look?.cameraAt),
    motion: typeof look?.motion === 'number' && Number.isFinite(look.motion) ? Math.min(1, Math.max(0, look.motion)) : 1,
  };
}

/** The times of every `every`th bar line after the first (bars: when each bar starts, in seconds): where a look changes "every N bars" */
export function everyBars(bars: number[], every: number): number[] {
  const n = Math.floor(every);
  if (!(n >= 1)) return [];
  const out: number[] = [];
  for (let i = n; i < bars.length; i += n) out.push(bars[i]);
  return out;
}

/** How many of `at` (in order) have passed by time t, and how long ago the last of them was (Infinity if none has) */
export function turnAt(at: number[], t: number): { turns: number; since: number } {
  let lo = 0;
  let hi = at.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return { turns: lo, since: lo ? t - at[lo - 1] : Infinity };
}

/** The background showing at t, the one it's fading from, and how far the fade has come (1: done) */
export function backgroundAt(look: PigeonLook, t: number): { now: BackgroundId; from: BackgroundId; mix: number } {
  const { turns, since } = turnAt(look.backgroundAt, t);
  const n = look.backgrounds.length;
  const now = look.backgrounds[turns % n];
  const from = turns ? look.backgrounds[(turns - 1) % n] : now;
  const k = Math.min(1, Math.max(0, since / BACKGROUND_FADE));
  return { now, from, mix: now === from ? 1 : k * k * (3 - 2 * k) };
}

/** The camera angle in use at t (it cuts from one to the next) */
export function cameraAt(look: PigeonLook, t: number): CameraId {
  return look.cameras[turnAt(look.cameraAt, t).turns % look.cameras.length];
}

export const backgroundOf = (id: BackgroundId): PigeonBackground => PIGEON_BACKGROUNDS.find((b) => b.id === id) ?? PIGEON_BACKGROUNDS[0];
export const cameraOf = (id: CameraId): PigeonCamera => PIGEON_CAMERAS.find((c) => c.id === id) ?? PIGEON_CAMERAS[0];

// ---------------------------------------------------------------------------------------------
// What the Export dialog asks: which backgrounds and angles, and when to change

/** When a video changes to its next background or camera angle: at each section (the song's markers), every so many bars, or never */
export type ChangeWhen = 'sections' | 'bars' | 'none';

export interface PigeonChoices {
  /** The backgrounds ticked (shown in the list's order, round and round) */
  backgrounds: BackgroundId[];
  backgroundWhen: ChangeWhen;
  backgroundBars: number;
  cameras: CameraId[];
  cameraWhen: ChangeWhen;
  cameraBars: number;
  /** How much the backgrounds move with the music */
  motion: MotionId;
}

/** The dialog's choices for how much the backgrounds move, and what each comes to */
export type MotionId = 'music' | 'calm' | 'still';
export const MOTIONS: Array<{ id: MotionId; name: string; blurb: string; amount: number }> = [
  { id: 'music', name: 'With the music', blurb: 'Rings spread from the keys as they play, and each background moves in its own way: on the beat, with the notes, more in busy passages', amount: 1 },
  { id: 'calm', name: 'Calmly', blurb: 'The same, at half strength', amount: 0.5 },
  { id: 'still', name: 'Still', blurb: 'The backgrounds stay as they are', amount: 0 },
];

export const DEFAULT_PIGEON_CHOICES: PigeonChoices = { backgrounds: ['plaza'], backgroundWhen: 'sections', backgroundBars: 8, cameras: ['diagonal'], cameraWhen: 'bars', cameraBars: 4, motion: 'music' };

/** The most bars between changes the dialog takes */
export const MOST_BARS = 64;

/** Saved choices, each falling back to the usual */
export function readPigeonChoices(raw: unknown): PigeonChoices {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PIGEON_CHOICES;
  const when = (v: unknown, fallback: ChangeWhen): ChangeWhen => (v === 'sections' || v === 'bars' || v === 'none' ? v : fallback);
  const bars = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(MOST_BARS, Math.max(1, Math.round(v))) : fallback);
  // (in the lists' own order, whatever order they were ticked in)
  const inOrder = <T extends string>(ids: T[], all: readonly T[]) => all.filter((id) => ids.includes(id));
  const look = cleanLook({ backgrounds: r.backgrounds as BackgroundId[], cameras: r.cameras as CameraId[] });
  return {
    backgrounds: inOrder(look.backgrounds, PIGEON_BACKGROUNDS.map((b) => b.id)),
    backgroundWhen: when(r.backgroundWhen, d.backgroundWhen),
    backgroundBars: bars(r.backgroundBars, d.backgroundBars),
    cameras: inOrder(look.cameras, PIGEON_CAMERAS.map((c) => c.id)),
    cameraWhen: when(r.cameraWhen, d.cameraWhen),
    cameraBars: bars(r.cameraBars, d.cameraBars),
    motion: MOTIONS.some((m) => m.id === r.motion) ? (r.motion as MotionId) : d.motion,
  };
}

/**
 * The look those choices make of a song: `bars` is when each bar starts and `sections` when each
 * section does (seconds from the video's start). With one background (or one angle) ticked there's
 * nothing to change to, whatever the "when".
 */
export function lookFor(choices: PigeonChoices, bars: number[], sections: number[]): PigeonLook {
  const at = (when: ChangeWhen, every: number) => (when === 'sections' ? sections : when === 'bars' ? everyBars(bars, every) : []);
  return cleanLook({
    backgrounds: choices.backgrounds,
    backgroundAt: choices.backgrounds.length > 1 ? at(choices.backgroundWhen, choices.backgroundBars) : [],
    cameras: choices.cameras,
    cameraAt: choices.cameras.length > 1 ? at(choices.cameraWhen, choices.cameraBars) : [],
    motion: MOTIONS.find((m) => m.id === choices.motion)?.amount ?? 1,
  });
}

// ---------------------------------------------------------------------------------------------
// What the backgrounds hear of the music: the beat, how busy it is, and the notes just struck. All
// worked out once from the notes, and read by time alone (a frame is the same however it's reached)

/** A note as the scene has it: seconds, a pitch, and whether it's a drum hit (a kick marked) */
export interface HeardNote {
  start: number;
  end: number;
  midi: number;
  drum?: boolean;
  kick?: true;
}

export interface MusicSense {
  /** When each beat the backgrounds jump on falls: the kicks, or the bar lines of a song without them */
  beats: number[];
  /** When each pitched note starts, in order */
  onsets: number[];
  /** How busy the music is (0 to 1), every SENSE_STEP seconds from 0 */
  energy: Float32Array;
  /** How far drifting things have travelled by then, in seconds of travel at full speed (it grows at 0.4 to 1 a second: slower in quiet passages) */
  travel: Float32Array;
}

export const SENSE_STEP = 0.25;
/** How long a beat's jump takes to die away (seconds), and a struck note's flare */
const PULSE_FADE = 0.24;
const FLARE_FADE = 0.5;

export function senseMusic(notes: HeardNote[], bars: number[]): MusicSense {
  const kicks = notes.filter((n) => n.kick).map((n) => n.start).sort((a, b) => a - b);
  // (kicks if the song has a few; hits closer than a twentieth of a second are one beat)
  const beats = (kicks.length >= 4 ? kicks : [...bars].sort((a, b) => a - b)).filter((t, i, all) => i === 0 || t - all[i - 1] > 0.05);
  const pitched = notes.filter((n) => !n.drum && !n.kick);
  const onsets = pitched.map((n) => n.start).sort((a, b) => a - b);
  let last = 0;
  for (const n of notes) if (n.end > last) last = n.end;
  const steps = Math.max(2, Math.ceil((last + 2) / SENSE_STEP) + 1);
  // How much is sounding round each moment: each note counts for where it sounds, fading out over a second either side (a drum hit counts half)
  const raw = new Float32Array(steps);
  for (const n of notes) {
    const weight = n.drum || n.kick ? 0.5 : 1;
    const i0 = Math.max(0, Math.floor((n.start - 2) / SENSE_STEP));
    const i1 = Math.min(steps - 1, Math.ceil((n.end + 2) / SENSE_STEP));
    for (let i = i0; i <= i1; i++) {
      const t = i * SENSE_STEP;
      const away = t < n.start ? n.start - t : t > n.end ? t - n.end : 0;
      raw[i] += weight * Math.exp(-(away * away) / 0.9);
    }
  }
  // Against the song's own busiest passages (the level nine tenths of it stays under), so a quiet song still has its louder and softer parts
  const sorted = Array.from(raw).filter((v) => v > 0).sort((a, b) => a - b);
  const top = sorted.length ? sorted[Math.floor(sorted.length * 0.9)] : 1;
  const energy = new Float32Array(steps);
  const travel = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    energy[i] = Math.min(1, raw[i] / (top || 1));
    if (i) travel[i] = travel[i - 1] + SENSE_STEP * (0.4 + 0.6 * (energy[i - 1] + energy[i]) * 0.5);
  }
  return { beats, onsets, energy, travel };
}

const sampled = (list: Float32Array, t: number, slopeAfter: number): number => {
  const x = t / SENSE_STEP;
  if (x <= 0) return list[0] + (slopeAfter ? t * 0.4 : 0);
  const end = list.length - 1;
  if (x >= end) return list[end] + (t - end * SENSE_STEP) * slopeAfter;
  const i = Math.floor(x);
  return list[i] + (list[i + 1] - list[i]) * (x - i);
};

/** How busy the music is at t, 0 to 1 */
export const energyAt = (sense: MusicSense, t: number): number => sampled(sense.energy, t, 0);
/** How far drifting things have travelled by t (it goes on at the slowest pace after the song) */
export const travelAt = (sense: MusicSense, t: number): number => sampled(sense.travel, t, 0.4);

/** The beat's jump at t: up at once on a beat (in a fiftieth of a second), then dying away */
export function pulseAt(sense: MusicSense, t: number): number {
  const { turns, since } = turnAt(sense.beats, t);
  if (!turns) return 0;
  return Math.min(1, since / 0.02) * Math.exp(-since / PULSE_FADE);
}

/** The last four notes struck by t: which of eight groups of details each lights (they take turns), and how bright it still is (1 fading to 0) */
export function flaresAt(sense: MusicSense, t: number): Array<{ group: number; glow: number }> {
  const { turns } = turnAt(sense.onsets, t);
  const out: Array<{ group: number; glow: number }> = [];
  for (let k = 0; k < 4; k++) {
    const i = turns - 1 - k;
    out.push(i >= 0 ? { group: (i * 3) % 8, glow: Math.exp(-(t - sense.onsets[i]) / FLARE_FADE) } : { group: -1, glow: 0 });
  }
  return out;
}

/** The fastest a background's drifting things ever move across the floor, in white keys' widths a second, with the backgrounds moving fully */
export const fastestDrift = (b: PigeonBackground): number => b.drift;
