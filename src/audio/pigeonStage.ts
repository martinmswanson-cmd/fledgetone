/**
 * The Pigeons picture's stage for a busy song: which parts play on the keyboard and which get an
 * instrument of their own, and where those stand. A fast part (short notes, quickly, on a handful
 * of pitches) gets a touch pad: a small bank of pads in front of the keyboard, one for each note it
 * uses, with birds of its own that hop pad to pad (short hops stay readable at speed, and the part
 * stays in view however far it is from the others in pitch). The drums get drum pads behind the
 * keyboard: a kick pad a bird stomps, and drums birds peck. The keyboard keeps the slower parts,
 * and so needs fewer octaves. Plain data and sums (no three.js); pigeonScene.ts plans the birds
 * and draws it.
 */
import type { ShowcaseData, ShowcaseNote } from '../store/showcase';

// The keyboard's size, as pigeonScene.ts has it (a white key is 1 wide, 6 long; its bed 0.2 wider)
const KEYS_FRONT = 3.2;

/** A pad: 1.3 wide and 2.9 deep (a bird facing the viewer stands on it, clear of the birds on the pads beside, before and behind), 0.2 between pads */
export const PAD_W = 1.3;
export const PAD_D = 2.9;
export const PAD_GAP = 0.2;
/** How high a pad's top is off the floor */
export const PAD_TOP = 0.14;
/** The room left between the keyboard and the pads, and between banks of pads: a lane birds walk along */
export const STAGE_LANE = 2.6;
/** A drum: how far across, how tall */
export const DRUM_R = 0.95;
export const DRUM_TOP = 0.5;
/** The kick's pad: a big square one */
export const KICK_SIZE = 2.6;

/** A part is fast, and gets pads, when its notes are this short (the median, seconds) and come this quickly, on no more pitches than a bank holds */
export const FAST_LENGTH = 0.3;
export const FAST_GAP = 0.3;
export const MOST_PADS = 16;
/** The most banks of pads on a stage (further fast parts stay on the keyboard) */
export const MOST_BANKS = 3;

export interface PadBank {
  /** Index into ShowcaseData.tracks */
  track: number;
  name: string;
  color: string;
  /** Its pitches, low to high: one pad each */
  pitches: number[];
  cols: number;
  rows: number;
  /** Its middle */
  x: number;
  z: number;
  /** How many birds play it: one more than its most notes at once (two to four) */
  birds: number;
  notes: ShowcaseNote[];
}

export type DrumKind = 'kick' | 'snare' | 'hat' | 'other';
export interface DrumPad {
  kind: DrumKind;
  name: string;
  /** Its middle (the kick's pad lies on the floor; a drum stands DRUM_TOP tall) */
  x: number;
  z: number;
  /** When it's hit (seconds), in order, and how hard (0 to 1) */
  hits: number[];
  color: string;
}

export interface Stage {
  /** The notes the keyboard's birds play */
  keys: ShowcaseNote[];
  banks: PadBank[];
  drums: DrumPad[];
}

const median = (sorted: number[]) => (sorted.length ? sorted[sorted.length >> 1] : Infinity);

/** How a track plays: how long its notes are and how quickly they come (medians), how many pitches it uses, the most notes at once */
export function trackProfile(notes: ShowcaseNote[]): { length: number; gap: number; pitches: number[]; atOnce: number } {
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  const lengths = sorted.map((n) => n.end - n.start).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start - sorted[i - 1].start > 0.01) gaps.push(sorted[i].start - sorted[i - 1].start);
  gaps.sort((a, b) => a - b);
  const edges = sorted.flatMap((n): Array<[number, number]> => [[n.start, 1], [n.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let atOnce = 0;
  for (const [, d] of edges) atOnce = Math.max(atOnce, (now += d));
  return { length: median(lengths), gap: median(gaps), pitches: [...new Set(sorted.map((n) => n.midi))].sort((a, b) => a - b), atOnce };
}

/** Whether a track is a fast part: short notes, coming quickly, a few of them at least, on few enough pitches for a bank of pads */
export function isFastPart(notes: ShowcaseNote[]): boolean {
  if (notes.length < 16) return false;
  const p = trackProfile(notes);
  return p.length < FAST_LENGTH && p.gap < FAST_GAP && p.pitches.length <= MOST_PADS;
}

/** Which drum a hit is: the kick (marked, or its note), the snare and clap, the hats, anything else. By the drum notes Fledgetone writes (C1, D1...) and General MIDI's an octave up */
export function drumKind(n: Pick<ShowcaseNote, 'midi' | 'kick'>): DrumKind {
  if (n.kick || n.midi === 24 || n.midi === 36 || n.midi === 35) return 'kick';
  if ([26, 27, 38, 39, 40].includes(n.midi)) return 'snare';
  if ([30, 34, 42, 44, 46].includes(n.midi)) return 'hat';
  return 'other';
}
const DRUM_NAMES: Record<DrumKind, string> = { kick: 'Kick', snare: 'Snare', hat: 'Hats', other: 'Percussion' };
const DRUM_COLORS: Record<DrumKind, string> = { kick: '#ef4444', snare: '#f59e0b', hat: '#22d3ee', other: '#a3e635' };

/** How a bank of `count` pads is laid out: one row up to six pads, two rows beyond */
export const bankShape = (count: number): { cols: number; rows: number } => (count <= 6 ? { cols: Math.max(1, count), rows: 1 } : { cols: Math.ceil(count / 2), rows: 2 });
export const bankSize = (b: Pick<PadBank, 'cols' | 'rows'>): { w: number; d: number } => ({ w: b.cols * PAD_W + (b.cols - 1) * PAD_GAP, d: b.rows * PAD_D + (b.rows - 1) * PAD_GAP });

/** Where a bank's pad for `midi` is: its middle (low pitches at the left; the lower half of them in the front row, as a bank's nearer row is) */
export function padSpot(b: PadBank, midi: number): { x: number; z: number } | null {
  const i = b.pitches.indexOf(midi);
  if (i < 0) return null;
  const row = i < b.cols ? 0 : 1;
  const col = row === 0 ? i : i - b.cols;
  const { w, d } = bankSize(b);
  // (a short back row sits to the left, over the front row's first pads)
  return { x: b.x - w / 2 + PAD_W / 2 + col * (PAD_W + PAD_GAP), z: b.rows === 1 ? b.z : b.z + d / 2 - PAD_D / 2 - row * (PAD_D + PAD_GAP) };
}

/**
 * The stage for a song: the keyboard's notes, the banks of pads and the drum pads. `centre` is
 * given the keyboard's notes and says where the keyboard's middle will be along x (the banks and
 * drums are set out about it). With `pads` off everything pitched stays on the keyboard and the
 * drums aren't shown, as it was before there was a stage.
 */
export function stageFor(data: ShowcaseData, pads: boolean, centre: (keys: ShowcaseNote[]) => number): Stage {
  const pitched = data.notes.filter((n) => !n.drum && !n.perc && n.end > n.start);
  if (!pads) return { keys: pitched, banks: [], drums: [] };
  const byTrack = new Map<number, ShowcaseNote[]>();
  for (const n of pitched) byTrack.set(n.track, [...(byTrack.get(n.track) ?? []), n]);
  // The fast parts, busiest first, as many as there are banks; and never all of them: the keyboard keeps something to play
  const fast = [...byTrack.entries()].filter(([, notes]) => isFastPart(notes)).sort((a, b) => b[1].length - a[1].length);
  const slow = byTrack.size - fast.length;
  const taken = fast.slice(0, Math.min(MOST_BANKS, slow > 0 ? fast.length : fast.length - 1)).sort((a, b) => trackProfile(a[1]).pitches[0] - trackProfile(b[1]).pitches[0]);
  const padTracks = new Set(taken.map(([t]) => t));
  const keys = pitched.filter((n) => !padTracks.has(n.track));
  const cx = centre(keys);
  // The banks, in a row in front of the keyboard, lowest part at the left, the row centred on the keyboard
  const banks: PadBank[] = taken.map(([track, notes]) => {
    const p = trackProfile(notes);
    return { track, name: data.tracks[track]?.name ?? '', color: data.tracks[track]?.color ?? notes[0].color, pitches: p.pitches, ...bankShape(p.pitches.length), x: 0, z: 0, birds: Math.min(4, Math.max(2, p.atOnce + 1)), notes };
  });
  const widths = banks.map((b) => bankSize(b).w);
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, banks.length - 1) * STAGE_LANE;
  let at = cx - total / 2;
  banks.forEach((b, i) => {
    b.x = at + widths[i] / 2;
    b.z = KEYS_FRONT + STAGE_LANE + bankSize(b).d / 2;
    at += widths[i] + STAGE_LANE;
  });
  // The drums, in a row behind the keyboard: kick, snare, hats, the rest
  const hits = data.notes.filter((n) => n.drum || n.perc);
  const kinds: DrumKind[] = ['kick', 'snare', 'hat', 'other'];
  const used = kinds.filter((k) => hits.some((n) => drumKind(n) === k));
  const spacing = 4.4;
  const drums: DrumPad[] = used.map((kind, i) => ({
    kind,
    name: DRUM_NAMES[kind],
    x: cx + (i - (used.length - 1) / 2) * spacing,
    z: -(KEYS_FRONT + STAGE_LANE + KICK_SIZE / 2),
    // (hits closer together than a 32nd of a second are one hit: a kit's layered kicks, a clap on a snare)
    hits: hits.filter((n) => drumKind(n) === kind).map((n) => n.start).sort((a, b) => a - b).filter((t, k, all) => k === 0 || t - all[k - 1] > 0.03),
    color: DRUM_COLORS[kind],
  }));
  return { keys, banks, drums };
}

/** The floor the stage takes up: from its left to its right, its back to its front (the keyboard from keysLeft to keysRight) */
export function stageBox(stage: Stage, keysLeft: number, keysRight: number): { x0: number; x1: number; z0: number; z1: number } {
  let x0 = keysLeft;
  let x1 = keysRight;
  let z0 = -KEYS_FRONT;
  let z1 = KEYS_FRONT;
  for (const b of stage.banks) {
    const { w, d } = bankSize(b);
    x0 = Math.min(x0, b.x - w / 2);
    x1 = Math.max(x1, b.x + w / 2);
    z1 = Math.max(z1, b.z + d / 2);
  }
  for (const d of stage.drums) {
    x0 = Math.min(x0, d.x - KICK_SIZE / 2);
    x1 = Math.max(x1, d.x + KICK_SIZE / 2);
    // (a drum's bird stands behind it)
    z0 = Math.min(z0, d.z - KICK_SIZE / 2 - 2.4);
  }
  return { x0, x1, z0, z1 };
}
