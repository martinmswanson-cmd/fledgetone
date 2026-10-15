import type { DrumRack, MultiSample, MultiZone, RackPad } from './timelineTypes';
import { RACK_BASE_NOTE, RACK_PADS } from './timelineTypes';

/**
 * The Drum Rack's and the Multi Sampler's settings: defaults, reading them from a project file,
 * and laying a Multi Sampler's sounds across the keyboard. Plain maths, so Node can unit-test it.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback);

export const RACK_GAIN_MIN = -60;
export const RACK_GAIN_MAX = 12;
export const RACK_DECAY_MAX = 10;
export const RACK_CHOKE_GROUPS = 8;
/** Longest fade at a chop's edges, seconds */
export const RACK_FADE_MAX = 0.25;

/** A pad with nothing loaded, at neutral settings. */
export function emptyPad(i: number): RackPad {
  return { name: `Pad ${i + 1}`, gain: 0, pan: 0, pitch: 0, decay: 0, lowpass: 20000, highpass: 20, drive: 0, choke: 0 };
}

export const defaultRack = (): DrumRack => ({ pads: Array.from({ length: RACK_PADS }, (_, i) => emptyPad(i)) });

/** Pad `i`'s note name (C2 for pad 1). */
export const padNote = (i: number): string => midiName(RACK_BASE_NOTE + i);
/** The pad a note plays (or -1). */
export const padOfNote = (note: string): number => {
  const m = noteMidi(note);
  return m >= RACK_BASE_NOTE && m < RACK_BASE_NOTE + RACK_PADS ? m - RACK_BASE_NOTE : -1;
};

/**
 * Where in its buffer a pad plays, and for how long, seconds: all of it, or a chop's stretch
 * (start to end of the sound; in the reversed copy, the mirror of that stretch).
 */
export function chopSpan(pad: Pick<RackPad, 'start' | 'end' | 'reverse'>, duration: number): { offset: number; seconds: number } {
  if (pad.start === undefined || pad.end === undefined) return { offset: 0, seconds: duration };
  const start = Math.max(0, Math.min(duration, pad.start));
  const end = Math.max(start, Math.min(duration, pad.end));
  return { offset: pad.reverse ? duration - end : start, seconds: end - start };
}

export function normalizeRack(raw: unknown): DrumRack | undefined {
  if (!isObj(raw) || !Array.isArray(raw.pads)) return undefined;
  const list = raw.pads as unknown[];
  const pads = Array.from({ length: RACK_PADS }, (_, i) => {
    const p = list[i];
    const d = emptyPad(i);
    if (!isObj(p)) return d;
    return {
      name: typeof p.name === 'string' && p.name.trim() ? p.name.slice(0, 40) : d.name,
      ...(typeof p.soundId === 'string' && p.soundId ? { soundId: p.soundId } : {}),
      gain: num(p.gain, 0, RACK_GAIN_MIN, RACK_GAIN_MAX),
      pan: num(p.pan, 0, -1, 1),
      pitch: Math.round(num(p.pitch, 0, -24, 24) * 100) / 100,
      decay: num(p.decay, 0, 0, RACK_DECAY_MAX),
      lowpass: num(p.lowpass, 20000, 100, 20000),
      highpass: num(p.highpass, 20, 20, 5000),
      drive: num(p.drive, 0, 0, 1),
      choke: Math.round(num(p.choke, 0, 0, RACK_CHOKE_GROUPS)),
      ...(p.reverse === true ? { reverse: true } : {}),
      // A chop's stretch of its sound (both ends, in order, or neither)
      ...(typeof p.start === 'number' && typeof p.end === 'number' && Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start && p.start >= 0 ? { start: p.start, end: p.end } : {}),
      ...(typeof p.fade === 'number' && p.fade > 0 ? { fade: num(p.fade, 0, 0, RACK_FADE_MAX) } : {}),
    };
  });
  return { pads };
}

// ---------- Multi Sampler ----------

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** MIDI 60 is C4. */
export const midiName = (m: number): string => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
/** A note name (C4, F#2, Bb3) as MIDI, or NaN. */
export function noteMidi(note: string): number {
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(note.trim());
  if (!match) return NaN;
  const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[match[1].toLowerCase() as 'c'];
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return base + accidental + (Number(match[3]) + 1) * 12;
}

/**
 * The note a sample's file name says it plays ("Piano_C4.wav", "strings A#2 mf", "bass-Eb1"),
 * or NaN. A note name standing on its own in the name, the last one if several.
 */
export function rootFromName(name: string): number {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const found = [...base.matchAll(/(?:^|[^A-Za-z0-9])([A-Ga-g])([#b]?)(-?[0-8])(?=$|[^A-Za-z0-9])/g)];
  if (!found.length) return NaN;
  const m = found[found.length - 1];
  return noteMidi(`${m[1]}${m[2]}${m[3]}`);
}

/** Loudness marks in a file name (pp, p, mp, mf, f, ff, soft, hard...) as a loudness rank, or NaN. */
export function velocityRank(name: string): number {
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, '').toLowerCase();
  const ranks: Array<[RegExp, number]> = [
    // (Not "piano" or "forte": those are as likely the instrument's name)
    [/(^|[^a-z])(ppp|softest)([^a-z]|$)/, 0],
    [/(^|[^a-z])(pp|soft)([^a-z]|$)/, 1],
    [/(^|[^a-z])(p)([^a-z]|$)/, 2],
    [/(^|[^a-z])(mp)([^a-z]|$)/, 3],
    [/(^|[^a-z])(mf|medium|mid)([^a-z]|$)/, 4],
    [/(^|[^a-z])(f|loud)([^a-z]|$)/, 5],
    [/(^|[^a-z])(ff|fff|hard)([^a-z]|$)/, 6],
  ];
  for (const [re, rank] of ranks.slice().reverse()) if (re.test(base)) return rank;
  return NaN;
}

/**
 * Lay sounds across the keyboard. Each needs its root key (its pitch). Sounds with the same root
 * but different loudness words (pp, mf, ff) become velocity layers, quiet to loud. Each root plays
 * the keys from halfway to the root below to halfway to the root above, the lowest down to MIDI
 * 21 and the highest up to 108.
 */
export function mapZones(sounds: ReadonlyArray<{ soundId: string; name: string; root: number }>): MultiZone[] {
  const roots = [...new Set(sounds.map((s) => Math.round(s.root)))].sort((a, b) => a - b);
  const zones: MultiZone[] = [];
  roots.forEach((root, i) => {
    const lo = i === 0 ? Math.min(21, root) : Math.floor((roots[i - 1] + root) / 2) + 1;
    const hi = i === roots.length - 1 ? Math.max(108, root) : Math.floor((root + roots[i + 1]) / 2);
    const layers = sounds.filter((s) => Math.round(s.root) === root).map((s, k) => ({ s, rank: Number.isFinite(velocityRank(s.name)) ? velocityRank(s.name) : k }));
    layers.sort((a, b) => a.rank - b.rank);
    layers.forEach(({ s }, k) => {
      const velLo = Math.round((k * 127) / layers.length) + 1;
      const velHi = Math.round(((k + 1) * 127) / layers.length);
      zones.push({ soundId: s.soundId, name: s.name, root, lo, hi, velLo, velHi });
    });
  });
  return zones;
}

/** The zone that plays MIDI note `midi` at velocity `velocity` (0 to 1): the one whose ranges hold it, else the nearest root. */
export function zoneFor(zones: readonly MultiZone[], midi: number, velocity: number): MultiZone | undefined {
  const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)));
  const inKeys = zones.filter((z) => midi >= z.lo && midi <= z.hi);
  const exact = inKeys.find((z) => vel >= z.velLo && vel <= z.velHi);
  if (exact) return exact;
  const pool = inKeys.length ? inKeys : zones;
  let best: MultiZone | undefined;
  let score = Infinity;
  for (const z of pool) {
    const s = Math.abs(z.root - midi) * 1000 + (vel < z.velLo ? z.velLo - vel : vel > z.velHi ? vel - z.velHi : 0);
    if (s < score) {
      score = s;
      best = z;
    }
  }
  return best;
}

export const defaultMulti = (): MultiSample => ({ zones: [], attack: 0.002, release: 0.3 });

export function normalizeMulti(raw: unknown): MultiSample | undefined {
  if (!isObj(raw) || !Array.isArray(raw.zones)) return undefined;
  const zones = raw.zones
    .filter((z): z is Record<string, unknown> => isObj(z) && typeof z.soundId === 'string' && !!z.soundId)
    .slice(0, 128)
    .map((z) => {
      const root = Math.round(num(z.root, 60, 0, 127));
      const lo = Math.round(num(z.lo, 0, 0, 127));
      const hi = Math.round(num(z.hi, 127, lo, 127));
      const velLo = Math.round(num(z.velLo, 1, 1, 127));
      const velHi = Math.round(num(z.velHi, 127, velLo, 127));
      return { soundId: z.soundId as string, name: typeof z.name === 'string' ? z.name.slice(0, 80) : 'Sound', root, lo, hi, velLo, velHi };
    });
  return { zones, attack: num(raw.attack, 0.002, 0, 2), release: num(raw.release, 0.3, 0.005, 10) };
}
