import type { NoteEvent } from './timelineTypes';
import { barsToDuration, durationToBars } from './timelineTypes';
import type { TrackRole } from './beatSwitch';
import { CLAP, cutGap, HAT, KICK, OPEN_HAT, SNARE } from './beatSwitch';

/**
 * Song form: a whole song laid out from a 4- or 8-bar loop, the way a rap song is usually built:
 * intro, hook, verse, hook, verse, bridge, hook, outro. Every section plays the loop over and
 * over, with parts taken out or thinned so the song moves: the intro has no drums or bass, the
 * verses a thinner beat (no hat rolls or open hats, the melody a little softer) so a voice has
 * room, the bridge only the kick under the melody and bass, the hook everything, and the outro the
 * melody alone. Optionally the drums drop out for the last half bar before each hook, so the hook
 * lands. This file plans it; arrangeActions.ts builds the clips. Pure, so Node can unit-test it.
 */

export type SectionKind = 'intro' | 'hook' | 'verse' | 'bridge' | 'outro';

/** How a part plays in a section. */
export type PartTreatment = 'full' | 'off' | 'thin' | 'kick' | 'soft';

/** The order of the sections. */
export const SONG_FORM: readonly SectionKind[] = ['intro', 'hook', 'verse', 'hook', 'verse', 'bridge', 'hook', 'outro'];

export const SECTION_NAMES: Record<SectionKind, string> = { intro: 'Intro', hook: 'Hook', verse: 'Verse', bridge: 'Bridge', outro: 'Outro' };

/** What each section does to each kind of part. */
export const SECTION_RECIPES: Record<SectionKind, Record<TrackRole, PartTreatment>> = {
  intro: { drums: 'off', bass: 'off', melody: 'full', fx: 'off', audio: 'full', mix: 'full' },
  hook: { drums: 'full', bass: 'full', melody: 'full', fx: 'full', audio: 'full', mix: 'full' },
  verse: { drums: 'thin', bass: 'full', melody: 'soft', fx: 'off', audio: 'full', mix: 'full' },
  bridge: { drums: 'kick', bass: 'full', melody: 'full', fx: 'off', audio: 'off', mix: 'full' },
  outro: { drums: 'off', bass: 'off', melody: 'full', fx: 'off', audio: 'off', mix: 'full' },
};

/** Section lengths in bars; 0 leaves a section out. */
export type SectionLengths = Record<SectionKind, number>;

/** The usual lengths for a loop of `loopBars`: short intro and outro, 8-bar hooks, 16-bar verses. */
export function defaultLengths(loopBars: number): SectionLengths {
  return { intro: loopBars >= 8 ? 8 : 4, hook: 8, verse: 16, bridge: 8, outro: loopBars >= 8 ? 8 : 4 };
}

export interface PlannedSection {
  kind: SectionKind;
  /** "Verse 2" */
  name: string;
  /** Bars from the song's start (0-based) */
  at: number;
  bars: number;
}

/** The sections in order, numbered where a kind comes back (Hook 1, Hook 2...), with where each starts. */
export function planSongForm(lengths: SectionLengths): PlannedSection[] {
  const used = SONG_FORM.filter((k) => lengths[k] > 0);
  const total: Partial<Record<SectionKind, number>> = {};
  for (const k of used) total[k] = (total[k] ?? 0) + 1;
  const seen: Partial<Record<SectionKind, number>> = {};
  let at = 0;
  return used.map((kind) => {
    seen[kind] = (seen[kind] ?? 0) + 1;
    const name = (total[kind] ?? 0) > 1 ? `${SECTION_NAMES[kind]} ${seen[kind]}` : SECTION_NAMES[kind];
    const s = { kind, name, at, bars: Math.round(lengths[kind]) };
    at += s.bars;
    return s;
  });
}

const EPS = 1e-6;

/**
 * A loop's notes (positions from the loop's start) repeated to fill `bars`; a note ringing past the
 * loop's end or the section's end stops there, so repeats never overlap.
 */
export function repeatLoop(notes: readonly NoteEvent[], loopBars: number, bars: number, newId: () => string): NoteEvent[] {
  const inLoop = notes.filter((n) => n.startOffset >= -EPS && n.startOffset < loopBars - EPS);
  const out: NoteEvent[] = [];
  for (let k = 0; k * loopBars < bars - EPS; k++) {
    for (const n of inLoop) {
      const at = n.startOffset + k * loopBars;
      if (at >= bars - EPS) continue;
      const len = Math.min(durationToBars(n.duration), loopBars - n.startOffset, bars - at);
      out.push({ ...n, id: newId(), startOffset: at, duration: barsToDuration(Math.max(1 / 64, len)) });
    }
  }
  return out;
}

/** A drum part thinned for a verse: the kick, snare and clap stay; hats only on 8ths, and no open hats or extra hits. */
export function thinDrums(notes: readonly NoteEvent[]): NoteEvent[] {
  return notes.filter((n) => {
    if (n.note === KICK || n.note === SNARE || n.note === CLAP) return true;
    if (n.note === HAT) return Math.abs(n.startOffset * 8 - Math.round(n.startOffset * 8)) < 1e-3;
    return false;
  });
}

/** Only the kicks (a bridge's heartbeat). */
export const kickOnly = (notes: readonly NoteEvent[]): NoteEvent[] => notes.filter((n) => n.note === KICK);

/** A part played in a section: its notes treated as the recipe says (null: the part sits out). */
export function treatPart(notes: readonly NoteEvent[], role: TrackRole, treatment: PartTreatment): NoteEvent[] | null {
  if (treatment === 'off') return null;
  if (treatment === 'thin') return role === 'drums' ? thinDrums(notes) : [...notes];
  if (treatment === 'kick') return role === 'drums' ? kickOnly(notes) : [...notes];
  if (treatment === 'soft') return notes.map((n) => ({ ...n, velocity: Math.round(Math.max(0.1, n.velocity * 0.82) * 100) / 100 }));
  return [...notes];
}

/** Whether a note row is a hat (for tests and the verse's thinning). */
export const isHat = (note: string) => note === HAT || note === OPEN_HAT;

/**
 * The drums of a section that a hook follows, with their last half bar dropped out (the pre-hook
 * drop). `bars` is the section's length.
 */
export const preHookDrop = (notes: readonly NoteEvent[], bars: number): NoteEvent[] => cutGap(notes, bars - 0.5, bars);
