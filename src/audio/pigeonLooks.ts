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
}

export const PIGEON_BACKGROUNDS: PigeonBackground[] = [
  { id: 'plaza', name: 'Plaza', blurb: 'Pale paving stones, a few crumbs', floor: '#e9e6e1', sky: '#ffffff', bounce: '#b8b2a8', skyLight: 1.6, sun: '#ffffff', sunLight: 1.6, dark: false },
  { id: 'park', name: 'Park', blurb: 'Grass with daisies and fallen leaves', floor: '#a5cf83', sky: '#f4ffe9', bounce: '#7fa860', skyLight: 1.6, sun: '#fff8e0', sunLight: 1.6, dark: false },
  { id: 'sunset', name: 'Rooftop at sunset', blurb: 'Warm terracotta tiles in low orange light', floor: '#e9ab84', sky: '#ffd9b8', bounce: '#c9785a', skyLight: 1.5, sun: '#ffb070', sunLight: 1.8, dark: false },
  { id: 'night', name: 'Night street', blurb: 'Dark wet paving with puddles: the keys glow', floor: '#232844', sky: '#8f9fe0', bounce: '#2a2f55', skyLight: 1.5, sun: '#b9c6ff', sunLight: 1.1, dark: true },
  { id: 'snow', name: 'Snow', blurb: 'Fresh snow with trails of bird tracks', floor: '#f1f5fb', sky: '#ffffff', bounce: '#b9c8e0', skyLight: 1.7, sun: '#eef4ff', sunLight: 1.4, dark: false },
  { id: 'space', name: 'Space', blurb: 'Stars, planets and drifting nebulas under a keyboard afloat', floor: '#0d0b24', sky: '#b9b4ff', bounce: '#3a2a6e', skyLight: 1.5, sun: '#ffffff', sunLight: 1.5, dark: true },
  { id: 'neon', name: 'Future city', blurb: 'A dark grid lit in neon pink and cyan, circuits running under the keys', floor: '#120d2b', sky: '#9fd8ff', bounce: '#7a2a8a', skyLight: 1.5, sun: '#ffc4f4', sunLight: 1.3, dark: true },
  { id: 'clouds', name: 'Above the clouds', blurb: 'Blue sky with white clouds far below', floor: '#8fc4f2', sky: '#ffffff', bounce: '#9fc6ea', skyLight: 1.7, sun: '#fffbe6', sunLight: 1.6, dark: false },
  { id: 'beach', name: 'Beach', blurb: 'Rippled sand with shells and starfish', floor: '#eed9a6', sky: '#fffbe8', bounce: '#c9ab72', skyLight: 1.6, sun: '#fff3d0', sunLight: 1.7, dark: false },
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
  { id: 'behind', name: 'From behind', blurb: 'Over the black keys, the other way up the frame', yaw: Math.PI - 0.55, pitch: 0.85, slope: { tall: -0.66, wide: -0.22 }, across: { tall: 16, wide: 17 }, furthest: 0.4 },
  { id: 'close', name: 'Close up', blurb: 'In close on what is playing; far-off parts go out of the frame', yaw: -0.3, pitch: 0.8, slope: { tall: 0.6, wide: 0.16 }, across: { tall: 10, wide: 9 }, furthest: 0.75 },
];

/** Which backgrounds and camera angles a video uses, in the order they appear, and when it changes to the next (seconds from its start) */
export interface PigeonLook {
  backgrounds: BackgroundId[];
  backgroundAt: number[];
  cameras: CameraId[];
  cameraAt: number[];
}

export const DEFAULT_PIGEON_LOOK: PigeonLook = { backgrounds: ['plaza'], backgroundAt: [], cameras: ['diagonal'], cameraAt: [] };

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
}

export const DEFAULT_PIGEON_CHOICES: PigeonChoices = { backgrounds: ['plaza'], backgroundWhen: 'sections', backgroundBars: 8, cameras: ['diagonal'], cameraWhen: 'bars', cameraBars: 4 };

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
  });
}
