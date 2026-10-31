/**
 * The channel kit's plan: which bars of the song make each piece of a streamer's or video
 * creator's kit (audio/channelKit.ts renders them).
 * - The loops (Starting soon, Be right back, Ending) are the song's main section (its busiest and
 *   most important, as Cut to length scores them), at most 32 bars; Ending is the calmest other
 *   section long enough to loop (4 bars and 8 seconds at least) when the song has one.
 * - The intro is the start of the main section, about 6 seconds in whole bars, faded out.
 * - The outro is the song's last bars, about 10 seconds (8 at least), from a section's start or a
 *   4-bar phrase into one, ringing out as the song ends.
 * No audio or store here, so Node can unit-test it.
 */
import type { Section } from './cutToLength';
import { maxOf } from '../support/minMax';

export interface KitRange {
  from: number;
  to: number;
}

export interface ChannelKitPlan {
  main: Section;
  /** The loop for the main section: the section, cut to at most MAX_LOOP_BARS */
  loop: KitRange;
  /** A calmer section for Ending, if the song has one other than the main */
  calm: KitRange | null;
  intro: KitRange;
  outro: KitRange;
}

export const INTRO_SECONDS = 6;
export const OUTRO_SECONDS = 10;
export const MAX_LOOP_BARS = 32;
/** The shortest calm section Ending loops */
const MIN_CALM_BARS = 4;
const MIN_CALM_SECONDS = 8;

/** Whole bars from `from` lasting closest to `seconds` (at least one), never past `end`. */
function barsLasting(from: number, seconds: number, end: number, toSeconds: (bar: number) => number): number {
  const start = toSeconds(from);
  let best = from + 1;
  for (let b = from + 1; b <= end; b++) {
    if (Math.abs(toSeconds(b) - start - seconds) <= Math.abs(toSeconds(best) - start - seconds)) best = b;
    if (toSeconds(b) - start > seconds) break;
  }
  return Math.min(best, end);
}

/** The plan for a song with these sections, ending at `end` (bar), `toSeconds` its tempo map. Null for an empty song. */
export function planChannelKit(sections: readonly Section[], end: number, toSeconds: (bar: number) => number): ChannelKitPlan | null {
  if (!sections.length || end <= 1) return null;
  // The main section: the highest weight (the first of equals)
  const main = sections.reduce((a, b) => (b.weight > a.weight ? b : a));
  const loop = { from: main.from, to: Math.min(main.to, main.from + MAX_LOOP_BARS) };
  // A calmer one: the lowest weight of the others that's long enough to loop
  const others = sections.filter((s) => s !== main && s.weight < main.weight && s.to - s.from >= MIN_CALM_BARS && toSeconds(s.to) - toSeconds(s.from) >= MIN_CALM_SECONDS);
  const calmest = others.length ? others.reduce((a, b) => (b.weight < a.weight ? b : a)) : null;
  const calm = calmest ? { from: calmest.from, to: Math.min(calmest.to, calmest.from + MAX_LOOP_BARS) } : null;
  const intro = { from: main.from, to: barsLasting(main.from, INTRO_SECONDS, end, toSeconds) };
  // The outro: the latest phrase line (a section's start, or 4 bars on from one) at least 8 seconds
  // from the end, so it starts where the music does; the start of the song if it's shorter
  const lines = sections.flatMap((s) => Array.from({ length: Math.ceil((s.to - s.from) / 4) }, (_, k) => s.from + 4 * k)).filter((b) => b < end);
  const fits = lines.filter((b) => toSeconds(end) - toSeconds(b) >= OUTRO_SECONDS * 0.8 - 1e-6);
  const outFrom = fits.length ? maxOf(fits) : 1;
  return { main, loop, calm, intro, outro: { from: outFrom, to: end } };
}
