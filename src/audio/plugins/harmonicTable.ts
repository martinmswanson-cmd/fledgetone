/**
 * A wavetable drawn as harmonics: the sound built from sine waves. Each drawing is the level of
 * every harmonic (the 1st is the note itself, the 2nd an octave up, the 3rd a fifth above that...),
 * a bar from silent to full on a decibel scale; one to four drawings make the table's cycles, and
 * Fledge Synth's Position morphs from the first to the last. The drawings travel with the table
 * (UserTable.harmonics), so they can be opened and changed again. Plain maths, so Node can
 * unit-test it.
 */
import { DRAWINGS_MAX, HARMONICS_MAX, packUserTable, USER_CYCLE, type HarmonicPhase, type Harmonics, type UserTable } from './userTable';

export { DRAWINGS_MAX, HARMONICS_MAX, normalizeHarmonics, type HarmonicPhase, type Harmonics } from './userTable';

/** How many harmonics a drawing may show */
export const HARMONIC_COUNTS = [16, 32, 64] as const;
/** A bar's height from just above 0 to 1 covers this many dB, up to full level */
export const HARMONIC_RANGE_DB = 48;
/** Samples a cycle a drawn table is stored at: room for 127 harmonics, a few kB in the song */
export const HARMONIC_TABLE_SIZE = 256;

/** The ways the harmonics can line up (HarmonicPhase), as offered */
export const HARMONIC_PHASES: ReadonlyArray<{ value: HarmonicPhase; label: string; title: string }> = [
  { value: 'together', label: 'Together', title: 'Every harmonic starts together: the classic saw, square and triangle shapes' },
  { value: 'alternate', label: 'Alternating', title: 'Every second harmonic is turned over: the same tone, a different wave' },
  { value: 'spread', label: 'Spread', title: 'The harmonics start spread through the cycle: the same tone, and a bright drawing no longer piles up into a spike' },
];

/** A bar's height (0..1) as the harmonic's level: 0 is silent, 1 full, the rest HARMONIC_RANGE_DB of decibels. */
export const heightToGain = (h: number): number => (h > 0 ? 10 ** (((Math.min(1, h) - 1) * HARMONIC_RANGE_DB) / 20) : 0);
/** A harmonic's level (0..1) as its bar's height; one too quiet for the scale is 0. */
export const gainToHeight = (g: number): number => {
  if (!(g > 0)) return 0;
  const h = 1 + (20 * Math.log10(Math.min(1, g))) / HARMONIC_RANGE_DB;
  return h > 0 ? Math.round(h * 1000) / 1000 : 0;
};

/** Where harmonic `k` (1 the first) of `count` starts, in radians. */
function phaseOf(phase: HarmonicPhase, k: number, count: number): number {
  if (phase === 'alternate') return k % 2 === 0 ? Math.PI : 0;
  // (Schroeder's phases: the flattest wave a set of harmonics makes)
  if (phase === 'spread') return (Math.PI * k * (k - 1)) / Math.max(1, count);
  return 0;
}

/** How loud a drawn cycle's highest point is: under full, so the stored samples never clip */
const PEAK = 0.9;

/**
 * One cycle of a drawing, `size` samples: its harmonics as sine waves, added up and brought to the
 * same peak whatever is drawn (the synth then levels every cycle by its loudness). Silence if
 * nothing is drawn. No harmonic the size can't hold.
 */
export function harmonicCycle(heights: readonly number[], phase: HarmonicPhase, size = USER_CYCLE): Float32Array {
  const out = new Float32Array(size);
  const count = Math.min(heights.length, HARMONICS_MAX, size / 2 - 1);
  const acc = new Float64Array(size);
  for (let k = 1; k <= count; k++) {
    const g = heightToGain(heights[k - 1]);
    if (!g) continue;
    const ph = phaseOf(phase, k, count);
    const w = (2 * Math.PI * k) / size;
    for (let i = 0; i < size; i++) acc[i] += g * Math.sin(w * i + ph);
  }
  let peak = 0;
  for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(acc[i]));
  if (peak < 1e-9) return out;
  for (let i = 0; i < size; i++) out[i] = (acc[i] * PEAK) / peak;
  return out;
}

/** The table's cycles as the synth takes them: one per drawing, USER_CYCLE samples each. */
export function harmonicCycles(h: Harmonics): { cycles: Float32Array; frames: number } {
  const frames = Math.min(h.drawings.length, DRAWINGS_MAX);
  const cycles = new Float32Array(frames * USER_CYCLE);
  for (let f = 0; f < frames; f++) cycles.set(harmonicCycle(h.drawings[f], h.phase), f * USER_CYCLE);
  return { cycles, frames };
}

/** Whether anything is drawn (a table of silence plays nothing). */
export const anyHarmonic = (h: Harmonics): boolean => h.drawings.some((d) => d.some((x) => x > 0));

const fill = (count: number, gain: (k: number) => number): number[] => Array.from({ length: count }, (_, i) => gainToHeight(gain(i + 1)));

/** Drawings to start from: each a name and the level of harmonic `k`. */
export const HARMONIC_SHAPES: ReadonlyArray<{ name: string; title: string; gain: (k: number) => number }> = [
  { name: 'Sine', title: 'The 1st harmonic alone: the purest tone', gain: (k) => (k === 1 ? 1 : 0) },
  { name: 'Saw', title: 'Every harmonic, each quieter by its number: bright and buzzy', gain: (k) => 1 / k },
  { name: 'Square', title: 'The odd harmonics only: hollow, like a clarinet', gain: (k) => (k % 2 ? 1 / k : 0) },
  { name: 'Triangle', title: 'The odd harmonics, falling away fast: soft and flute-like', gain: (k) => (k % 2 ? 1 / (k * k) : 0) },
  { name: 'Organ', title: 'A few low harmonics, as an organ’s drawbars pull them', gain: (k) => ({ 1: 1, 2: 0.7, 3: 0.5, 4: 0.6, 6: 0.3, 8: 0.35 } as Record<number, number>)[k] ?? 0 },
  { name: 'Bright', title: 'Every harmonic nearly as loud as the first: thin and cutting', gain: (k) => 1 / Math.sqrt(k) },
  { name: 'Vowel', title: 'Two bumps in the harmonics, as a sung "ah" has', gain: (k) => (1 / k) * (1 + 5 * Math.exp(-((k - 7) ** 2) / 6) + 3 * Math.exp(-((k - 12) ** 2) / 8)) / 3.2 },
];

/** A drawing of `count` harmonics in a named shape (the Saw if the name isn't one). */
export function harmonicShape(name: string, count: number): number[] {
  const shape = HARMONIC_SHAPES.find((s) => s.name === name) ?? HARMONIC_SHAPES[1];
  return fill(Math.min(HARMONICS_MAX, count), shape.gain);
}

/** What a new drawing starts as: a saw of 32 harmonics. */
export const defaultHarmonics = (): Harmonics => ({ v: 1, drawings: [harmonicShape('Saw', 32)], phase: 'together' });

/** Ways to change a whole drawing at once. */
export type HarmonicTool = 'odd' | 'even' | 'darker' | 'brighter' | 'clear';

/** A drawing with a tool applied: only the odd or the even harmonics kept, 3 dB an octave darker or brighter, or cleared. */
export function applyHarmonicTool(heights: readonly number[], tool: HarmonicTool): number[] {
  if (tool === 'clear') return heights.map(() => 0);
  if (tool === 'odd') return heights.map((h, i) => ((i + 1) % 2 ? h : 0));
  // (The 1st harmonic stays: without it the note drops out from under the sound)
  if (tool === 'even') return heights.map((h, i) => (i === 0 || (i + 1) % 2 === 0 ? h : 0));
  const sign = tool === 'brighter' ? 1 : -1;
  return heights.map((h, i) => (h > 0 ? gainToHeight(Math.min(1, heightToGain(h) * 10 ** ((sign * 3 * Math.log2(i + 1)) / 20))) : 0));
}

/** A drawing with `count` harmonics: cut short, or filled out with silent ones. */
export const resizeDrawing = (heights: readonly number[], count: number): number[] => Array.from({ length: Math.min(HARMONICS_MAX, count) }, (_, i) => heights[i] ?? 0);

/** A table drawn as harmonics, packed small: its cycles hold only what was drawn. */
export async function harmonicUserTable(harmonics: Harmonics, name = 'Drawn harmonics'): Promise<UserTable> {
  const { cycles, frames } = harmonicCycles(harmonics);
  return { ...(await packUserTable(cycles, frames, name, HARMONIC_TABLE_SIZE)), harmonics };
}
