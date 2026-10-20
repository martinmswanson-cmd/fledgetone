/**
 * The Drum Designer's settings: a synthesized sound for each drum row of the Designed Kit, each
 * one or two layers of a drum voice (kick, snare, clap, hat, rim, tom, shaker, bell) with its own
 * knobs, plus the presets (named by sound) and the checks that repair a project file's settings.
 * Stored on the track (Track.drumDesign); the sound is made by src/audio/drumSynth.ts and played
 * by src/audio/presets/designedKit.ts. Plain data, no Web Audio, so Node can test it.
 */

/** The drum rows a kit plays (the same names and notes as DRUM_NOTES in instruments.ts, kept here so Node can read them). */
export const DESIGN_ROWS = [
  { row: 'kick', note: 'C1', label: 'Kick' },
  { row: 'snare', note: 'D1', label: 'Snare' },
  { row: 'clap', note: 'D#1', label: 'Clap' },
  { row: 'closedHat', note: 'F#1', label: 'Closed Hat' },
  { row: 'openHat', note: 'A#1', label: 'Open Hat' },
  { row: 'tomLow', note: 'F1', label: 'Tom Low' },
  { row: 'tomMid', note: 'B1', label: 'Tom Mid' },
  { row: 'tomHigh', note: 'D2', label: 'Tom High' },
  { row: 'cowbell', note: 'G#2', label: 'Perc' },
  { row: 'crash', note: 'C#2', label: 'Crash' },
  { row: 'ride', note: 'D#2', label: 'Ride' },
] as const;
export type DesignRow = (typeof DESIGN_ROWS)[number]['row'];
export const DESIGN_ROW_IDS: readonly DesignRow[] = DESIGN_ROWS.map((r) => r.row);

/** What a layer is: each voice has its own way of making the sound, and its own knobs (VOICE_CONTROLS). */
export const DRUM_VOICES = ['kick', 'snare', 'clap', 'hat', 'rim', 'tom', 'shaker', 'bell'] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number];
export const DRUM_VOICE_LABELS: Record<DrumVoice, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  hat: 'Hat / cymbal',
  rim: 'Rim',
  tom: 'Tom',
  shaker: 'Shaker',
  bell: 'Bell / cowbell',
};

/**
 * One layer of a designed drum. Every voice reads the same fields, each in its own way (see
 * drumSynth.ts and VOICE_CONTROLS for which knobs each one shows).
 */
export interface DrumLayer {
  voice: DrumVoice;
  /** The layer's level in the sound, dB (-24 to 0) */
  level: number;
  /** When it starts after the hit, ms (0 to 40): a clap a hair after a snare */
  delay: number;
  /** Its pitch, Hz: a kick's or tom's body where the sweep ends, a snare's tone, a hat's or bell's metal */
  pitch: number;
  /** How far above `pitch` the body starts, semitones (0 to 60): a kick's punch drop */
  sweep: number;
  /** How quickly the sweep falls, seconds (0.005 to 0.4) */
  sweepTime: number;
  /** How long the body (or the metal) rings, seconds (0.01 to 3) */
  decay: number;
  /** The tonal part's level, 0 to 1 (a snare's body) */
  body: number;
  /** The attack's click or snap, 0 to 1 */
  click: number;
  /** The noise's level, 0 to 1 (a snare's wires, a hat's sizzle) */
  noise: number;
  /** Where the noise sits, Hz (200 to 16000): low is dark, high is crisp */
  color: number;
  /** How long the noise rings, seconds (0.005 to 2): a clap's tail */
  noiseDecay: number;
  /** A clap's slaps, 1 to 6 */
  bursts: number;
  /** The time between a clap's slaps, ms (2 to 40) */
  spread: number;
  /** A swell into the hit, seconds (0 to 0.1): a shaker's */
  attack: number;
  /** Distortion, 0 (clean) to 1 (crushed) */
  drive: number;
}

/** A designed drum: one or two layers, and its level against the row's (dB, -18 to 6). */
export interface DrumSound {
  layers: DrumLayer[];
  level: number;
  /** The preset it started from (shown in the menu until it's changed); absent: none */
  preset?: string;
}

/** The Designed Kit's sounds by row (absent rows play their default preset, DEFAULT_ROW_PRESET). */
export type DrumDesign = Partial<Record<DesignRow, DrumSound>>;

/** Each field's range: what the knobs reach and what a file is repaired into. */
export const LAYER_RANGES: Record<Exclude<keyof DrumLayer, 'voice'>, [number, number]> = {
  level: [-24, 0],
  delay: [0, 40],
  pitch: [20, 4000],
  sweep: [0, 60],
  sweepTime: [0.005, 0.4],
  decay: [0.01, 3],
  body: [0, 1],
  click: [0, 1],
  noise: [0, 1],
  color: [200, 16000],
  noiseDecay: [0.005, 2],
  bursts: [1, 6],
  spread: [2, 40],
  attack: [0, 0.1],
  drive: [0, 1],
};
export const SOUND_LEVEL: [number, number] = [-18, 6];
/** At most two layers a sound */
export const MAX_DRUM_LAYERS = 2;

/** One knob of the Drum Designer: which field, its name for the voice, and how it's shown. */
export interface DrumControl {
  key: Exclude<keyof DrumLayer, 'voice'>;
  label: string;
  /** Moves in steps of this */
  step: number;
  /** Shown as: Hz, ms, s, st (semitones), dB, % (0 to 1), or a plain count */
  unit: 'Hz' | 'ms' | 's' | 'st' | 'dB' | '%' | '';
  /** The knob moves on a log scale (pitches, times) */
  log?: boolean;
  /** Narrower than LAYER_RANGES for this voice */
  range?: [number, number];
}

const C = (key: DrumControl['key'], label: string, unit: DrumControl['unit'], step: number, log = false, range?: [number, number]): DrumControl => ({ key, label, unit, step, ...(log ? { log } : {}), ...(range ? { range } : {}) });

/** The knobs each voice shows, in order (level and delay are shown for every layer). */
export const VOICE_CONTROLS: Record<DrumVoice, DrumControl[]> = {
  kick: [C('click', 'Punch', '%', 0.01), C('pitch', 'Pitch', 'Hz', 1, true, [25, 120]), C('sweep', 'Sweep', 'st', 1), C('sweepTime', 'Sweep time', 's', 0.001, true), C('decay', 'Decay', 's', 0.01, true, [0.05, 3]), C('noise', 'Noise', '%', 0.01), C('drive', 'Distortion', '%', 0.01)],
  snare: [C('pitch', 'Tone', 'Hz', 1, true, [100, 400]), C('body', 'Body', '%', 0.01), C('decay', 'Body decay', 's', 0.005, true, [0.03, 0.6]), C('noise', 'Noise', '%', 0.01), C('color', 'Noise color', 'Hz', 10, true, [800, 12000]), C('noiseDecay', 'Decay', 's', 0.005, true, [0.04, 1]), C('click', 'Snap', '%', 0.01), C('sweep', 'Sweep', 'st', 1, false, [0, 24]), C('drive', 'Distortion', '%', 0.01)],
  clap: [C('bursts', 'Bursts', '', 1), C('spread', 'Spread', 'ms', 0.5, false, [3, 30]), C('color', 'Color', 'Hz', 10, true, [600, 6000]), C('noiseDecay', 'Tail', 's', 0.005, true, [0.05, 1.5]), C('click', 'Snap', '%', 0.01), C('drive', 'Distortion', '%', 0.01)],
  hat: [C('pitch', 'Metal', 'Hz', 1, true, [150, 900]), C('color', 'Color', 'Hz', 10, true, [3000, 16000]), C('decay', 'Decay', 's', 0.005, true, [0.02, 3]), C('noise', 'Noise', '%', 0.01), C('click', 'Click', '%', 0.01), C('drive', 'Distortion', '%', 0.01)],
  rim: [C('pitch', 'Pitch', 'Hz', 1, true, [300, 3000]), C('decay', 'Decay', 's', 0.002, true, [0.01, 0.3]), C('click', 'Click', '%', 0.01), C('noise', 'Noise', '%', 0.01), C('drive', 'Distortion', '%', 0.01)],
  tom: [C('pitch', 'Pitch', 'Hz', 1, true, [50, 400]), C('sweep', 'Sweep', 'st', 1, false, [0, 24]), C('sweepTime', 'Sweep time', 's', 0.001, true), C('decay', 'Decay', 's', 0.01, true, [0.08, 2]), C('click', 'Punch', '%', 0.01), C('noise', 'Noise', '%', 0.01), C('drive', 'Distortion', '%', 0.01)],
  shaker: [C('color', 'Color', 'Hz', 10, true, [2000, 14000]), C('attack', 'Attack', 's', 0.001, false, [0, 0.06]), C('noiseDecay', 'Decay', 's', 0.005, true, [0.02, 0.5]), C('bursts', 'Shakes', '', 1, false, [1, 3]), C('spread', 'Shake gap', 'ms', 0.5, false, [8, 40]), C('drive', 'Distortion', '%', 0.01)],
  bell: [C('pitch', 'Pitch', 'Hz', 1, true, [300, 2000]), C('decay', 'Decay', 's', 0.005, true, [0.03, 1.5]), C('color', 'Tone', 'Hz', 10, true, [500, 6000]), C('click', 'Click', '%', 0.01), C('drive', 'Distortion', '%', 0.01)],
};

/** A layer of `voice` with middling settings for it. */
export function defaultLayer(voice: DrumVoice): DrumLayer {
  const base: DrumLayer = { voice, level: 0, delay: 0, pitch: 200, sweep: 0, sweepTime: 0.04, decay: 0.2, body: 1, click: 0.3, noise: 0, color: 4000, noiseDecay: 0.15, bursts: 1, spread: 10, attack: 0, drive: 0 };
  switch (voice) {
    case 'kick':
      return { ...base, pitch: 48, sweep: 36, sweepTime: 0.03, decay: 0.5, click: 0.5, color: 3000, noiseDecay: 0.02 };
    case 'snare':
      return { ...base, pitch: 190, sweep: 7, sweepTime: 0.02, decay: 0.12, body: 0.6, click: 0.5, noise: 0.8, color: 4500, noiseDecay: 0.18 };
    case 'clap':
      return { ...base, body: 0, click: 0.3, noise: 1, color: 1300, noiseDecay: 0.3, bursts: 4, spread: 10 };
    case 'hat':
      return { ...base, pitch: 330, decay: 0.06, click: 0.3, noise: 0.35, color: 9000 };
    case 'rim':
      return { ...base, pitch: 1700, decay: 0.035, click: 0.6, noise: 0.2, color: 5000, noiseDecay: 0.02 };
    case 'tom':
      return { ...base, pitch: 120, sweep: 7, sweepTime: 0.06, decay: 0.45, click: 0.3, noise: 0.1, color: 2000, noiseDecay: 0.05 };
    case 'shaker':
      return { ...base, body: 0, click: 0, noise: 1, color: 7000, noiseDecay: 0.09, attack: 0.02, bursts: 1, spread: 18 };
    case 'bell':
      return { ...base, pitch: 540, decay: 0.25, click: 0.2, color: 1600 };
  }
}

/** A sound of one layer of `voice`, with `edit` on top. */
const one = (voice: DrumVoice, edit: Partial<DrumLayer> = {}, level = 0): DrumSound => ({ layers: [{ ...defaultLayer(voice), ...edit }], level });
/** A sound of two layers. */
const two = (a: [DrumVoice, Partial<DrumLayer>], b: [DrumVoice, Partial<DrumLayer>], level = 0): DrumSound => ({ layers: [{ ...defaultLayer(a[0]), ...a[1] }, { ...defaultLayer(b[0]), ...b[1] }], level });

/** Which kind of drum a preset is, for the menus (the row's kind is offered first). */
export type PresetGroup = 'Kicks' | 'Snares' | 'Claps' | 'Hats' | 'Cymbals' | 'Percussion';

export interface DrumPreset {
  id: string;
  name: string;
  group: PresetGroup;
  sound: DrumSound;
}

/** The presets, named by how they sound. */
export const DRUM_PRESETS: readonly DrumPreset[] = [
  // Kicks
  { id: 'hardTrapKick', name: 'Hard hitting kick', group: 'Kicks', sound: one('kick', { pitch: 46, sweep: 40, sweepTime: 0.028, decay: 0.75, click: 0.7, drive: 0.35 }) },
  { id: 'punchyKick', name: 'Punchy short kick', group: 'Kicks', sound: one('kick', { pitch: 55, sweep: 32, sweepTime: 0.02, decay: 0.28, click: 0.85, drive: 0.15 }) },
  { id: 'distortedBoomKick', name: 'Distorted boom kick', group: 'Kicks', sound: one('kick', { pitch: 42, sweep: 36, sweepTime: 0.04, decay: 1.2, click: 0.5, drive: 0.75 }) },
  { id: 'drillKick', name: 'Tight kick', group: 'Kicks', sound: one('kick', { pitch: 52, sweep: 30, sweepTime: 0.018, decay: 0.32, click: 0.9, noise: 0.1, drive: 0.3 }) },
  { id: 'clickySubKick', name: 'Clicky sub kick', group: 'Kicks', sound: two(['kick', { pitch: 40, sweep: 24, sweepTime: 0.05, decay: 0.9, click: 0.2, drive: 0.1 }], ['rim', { pitch: 2200, decay: 0.012, click: 1, noise: 0.4, level: -10 }]) },
  { id: 'dustyKick', name: 'Dusty lo-fi kick', group: 'Kicks', sound: one('kick', { pitch: 58, sweep: 24, sweepTime: 0.03, decay: 0.3, click: 0.3, noise: 0.25, color: 1200, noiseDecay: 0.05, drive: 0.5 }, -1) },
  // Snares
  { id: 'drillSnare', name: 'Punchy snare', group: 'Snares', sound: one('snare', { pitch: 210, sweep: 9, body: 0.75, decay: 0.09, noise: 0.85, color: 5200, noiseDecay: 0.16, click: 0.8, drive: 0.3 }) },
  { id: 'trapSnare', name: 'Crisp snare', group: 'Snares', sound: one('snare', { pitch: 230, sweep: 5, body: 0.5, decay: 0.07, noise: 1, color: 7000, noiseDecay: 0.22, click: 0.7, drive: 0.15 }) },
  { id: 'fatSnare', name: 'Fat layered snare', group: 'Snares', sound: two(['snare', { pitch: 180, sweep: 10, body: 0.9, decay: 0.14, noise: 0.7, color: 3800, noiseDecay: 0.2, click: 0.6, drive: 0.35 }], ['clap', { bursts: 3, spread: 8, color: 1500, noiseDecay: 0.25, level: -5, delay: 2 }]) },
  { id: 'tightSnare', name: 'Tight dry snare', group: 'Snares', sound: one('snare', { pitch: 250, sweep: 4, body: 0.7, decay: 0.07, noise: 0.8, color: 6000, noiseDecay: 0.12, click: 0.7 }) },
  { id: 'dustySnare', name: 'Dusty lo-fi snare', group: 'Snares', sound: one('snare', { pitch: 170, sweep: 6, body: 0.7, decay: 0.1, noise: 0.7, color: 2600, noiseDecay: 0.17, click: 0.4, drive: 0.55 }, -1) },
  // Claps
  { id: 'crispClap', name: 'Crisp clap', group: 'Claps', sound: one('clap', { bursts: 4, spread: 9, color: 1600, noiseDecay: 0.22, click: 0.5, drive: 0.1 }) },
  { id: 'wideClap', name: 'Big room clap', group: 'Claps', sound: one('clap', { bursts: 5, spread: 14, color: 1100, noiseDecay: 0.6, click: 0.3 }) },
  { id: 'snappyClap', name: 'Snappy short clap', group: 'Claps', sound: one('clap', { bursts: 3, spread: 6, color: 2000, noiseDecay: 0.1, click: 0.8, drive: 0.2 }) },
  { id: 'clapSnare', name: 'Clap and snare stack', group: 'Claps', sound: two(['clap', { bursts: 4, spread: 10, color: 1400, noiseDecay: 0.3 }], ['snare', { pitch: 200, body: 0.8, decay: 0.08, noise: 0.4, noiseDecay: 0.1, level: -6 }]) },
  // Hats
  { id: 'tightHat', name: 'Tight closed hat', group: 'Hats', sound: one('hat', { pitch: 360, color: 10000, decay: 0.035, noise: 0.35, click: 0.4 }) },
  { id: 'trapHat', name: 'Bright hat', group: 'Hats', sound: one('hat', { pitch: 420, color: 12000, decay: 0.05, noise: 0.5, click: 0.5 }) },
  { id: 'darkHat', name: 'Dark closed hat', group: 'Hats', sound: one('hat', { pitch: 280, color: 6500, decay: 0.06, noise: 0.25, click: 0.25 }) },
  { id: 'openHat', name: 'Open hat', group: 'Hats', sound: one('hat', { pitch: 360, color: 9500, decay: 0.42, noise: 0.4, click: 0.3 }) },
  { id: 'longOpenHat', name: 'Long sizzling open hat', group: 'Hats', sound: one('hat', { pitch: 400, color: 11000, decay: 0.9, noise: 0.6, click: 0.2 }) },
  // Cymbals
  { id: 'crash', name: 'Washy crash', group: 'Cymbals', sound: one('hat', { pitch: 300, color: 7000, decay: 2.4, noise: 0.7, click: 0.3 }) },
  { id: 'ride', name: 'Ping ride', group: 'Cymbals', sound: two(['hat', { pitch: 470, color: 8000, decay: 1.4, noise: 0.3, click: 0.1 }], ['bell', { pitch: 1180, decay: 0.5, color: 3500, click: 0.1, level: -9 }]) },
  // Percussion
  { id: 'woodRim', name: 'Wood rim', group: 'Percussion', sound: one('rim', { pitch: 1300, decay: 0.04, click: 0.6, noise: 0.15 }) },
  { id: 'sharpRim', name: 'Sharp rim', group: 'Percussion', sound: one('rim', { pitch: 1900, decay: 0.025, click: 0.9, noise: 0.35, drive: 0.2 }) },
  { id: 'lowTom', name: 'Low tom', group: 'Percussion', sound: one('tom', { pitch: 85, sweep: 9, decay: 0.6 }) },
  { id: 'midTom', name: 'Mid tom', group: 'Percussion', sound: one('tom', { pitch: 125, sweep: 8, decay: 0.45 }) },
  { id: 'highTom', name: 'High tom', group: 'Percussion', sound: one('tom', { pitch: 175, sweep: 7, decay: 0.35 }) },
  { id: 'shaker', name: 'Shaker', group: 'Percussion', sound: one('shaker', { color: 7500, attack: 0.018, noiseDecay: 0.08 }) },
  { id: 'doubleShaker', name: 'Double shake', group: 'Percussion', sound: one('shaker', { color: 6500, attack: 0.01, noiseDecay: 0.06, bursts: 2, spread: 22 }) },
  { id: 'cowbell', name: 'Cowbell', group: 'Percussion', sound: one('bell', { pitch: 545, decay: 0.3, color: 1700, click: 0.2 }) },
];

const PRESET_BY_ID = new Map(DRUM_PRESETS.map((p) => [p.id, p]));
export const drumPreset = (id: string): DrumPreset | undefined => PRESET_BY_ID.get(id);

/** The sound each row has until it's designed: a hard modern kit. */
export const DEFAULT_ROW_PRESET: Record<DesignRow, string> = {
  kick: 'hardTrapKick',
  snare: 'drillSnare',
  clap: 'crispClap',
  closedHat: 'trapHat',
  openHat: 'openHat',
  tomLow: 'lowTom',
  tomMid: 'midTom',
  tomHigh: 'highTom',
  cowbell: 'sharpRim',
  crash: 'crash',
  ride: 'ride',
};

/** The preset groups each row offers first. */
export const ROW_GROUP: Record<DesignRow, PresetGroup> = {
  kick: 'Kicks',
  snare: 'Snares',
  clap: 'Claps',
  closedHat: 'Hats',
  openHat: 'Hats',
  tomLow: 'Percussion',
  tomMid: 'Percussion',
  tomHigh: 'Percussion',
  cowbell: 'Percussion',
  crash: 'Cymbals',
  ride: 'Cymbals',
};

/** A preset's sound, as a row's (marked as that preset). */
export function presetSound(id: string): DrumSound | undefined {
  const p = drumPreset(id);
  return p ? { ...structuredClone(p.sound), preset: id } : undefined;
}

/** The sound `row` plays in `design`: its own, or its default preset's. */
export function soundForRow(design: DrumDesign | undefined, row: DesignRow): DrumSound {
  return design?.[row] ?? presetSound(DEFAULT_ROW_PRESET[row])!;
}

// ---------- reading a file ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clampNum = (v: unknown, d: number, [lo, hi]: [number, number]) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** A layer from a file: every field checked and kept in range, an unknown voice read as a kick. */
export function normalizeDrumLayer(v: unknown): DrumLayer | undefined {
  if (!isObj(v)) return undefined;
  const voice = (DRUM_VOICES as readonly string[]).includes(v.voice as string) ? (v.voice as DrumVoice) : 'kick';
  const d = defaultLayer(voice);
  const out = { voice } as DrumLayer;
  for (const key of Object.keys(LAYER_RANGES) as Array<keyof typeof LAYER_RANGES>) out[key] = clampNum(v[key], d[key], LAYER_RANGES[key]);
  out.bursts = Math.round(out.bursts);
  return out;
}

/** A sound from a file (one or two good layers), or undefined. */
export function normalizeDrumSound(v: unknown): DrumSound | undefined {
  if (!isObj(v) || !Array.isArray(v.layers)) return undefined;
  const layers = v.layers.map(normalizeDrumLayer).filter((l): l is DrumLayer => !!l).slice(0, MAX_DRUM_LAYERS);
  if (!layers.length) return undefined;
  return { layers, level: clampNum(v.level, 0, SOUND_LEVEL), ...(typeof v.preset === 'string' && PRESET_BY_ID.has(v.preset) ? { preset: v.preset } : {}) };
}

/** A track's drum design from a file: the rows it can read (none: undefined). */
export function normalizeDrumDesign(v: unknown): DrumDesign | undefined {
  if (!isObj(v)) return undefined;
  const out: DrumDesign = {};
  for (const row of DESIGN_ROW_IDS) {
    const s = normalizeDrumSound(v[row]);
    if (s) out[row] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

/** `design` with `row`'s sound set (a new object). */
export function withRowSound(design: DrumDesign | undefined, row: DesignRow, sound: DrumSound): DrumDesign {
  return { ...(design ?? {}), [row]: sound };
}

/** `sound` with one layer's field changed (the sound no longer is its preset). */
export function withLayerValue(sound: DrumSound, layer: number, key: keyof typeof LAYER_RANGES, value: number): DrumSound {
  const [lo, hi] = LAYER_RANGES[key];
  const v = Math.max(lo, Math.min(hi, key === 'bursts' ? Math.round(value) : value));
  const { preset: _p, ...rest } = sound;
  return { ...rest, layers: sound.layers.map((l, i) => (i === layer ? { ...l, [key]: v } : l)) };
}
