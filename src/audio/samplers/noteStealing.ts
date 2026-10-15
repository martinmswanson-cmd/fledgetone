/**
 * Which note to let go when an instrument has too many sounding: the one quietest now, not the
 * oldest. A long-held chord under fast runs used to lose its oldest notes first, often the ones
 * still ringing loudest, while the last run's notes, already faded to a whisper, played on.
 *
 * Each note's level now is estimated from what is known without listening: how loud it started,
 * how far into its recording it has played (and the recording's level there, from its outline:
 * see recordingMaths.ts), and how far into its release it is. Pure maths, tested in Node.
 */
import { OUTLINE_STEP } from './recordingMaths';

/** A note younger than this (seconds) is only taken when every other note is as young. */
export const STEAL_GRACE = 0.05;
/**
 * A note whose key is still down counts this much louder than it is when choosing: a note already
 * let go (in its release, or a recording ringing out after its written length) goes first unless
 * a held one is much quieter.
 */
export const HELD_WEIGHT = 4;

/** What's known of a sounding note to estimate its level. */
export interface NoteLevelInput {
  /** Its gain from velocity (and breath), 0..1 or so */
  gain: number;
  /** Seconds into its recording it has reached now */
  position: number;
  /** Its recording's level outline (levelOutline), if known */
  outline?: Float32Array;
  /** The stretch it loops while held (seconds), if it does */
  loop?: [number, number];
  /** When it was let go (Infinity while held) */
  releasedAt: number;
  /** Its release's time constant (seconds) */
  releaseTc: number;
}

/** About how loud a note is at `now` (linear: its gain times its recording's level there, falling through its release). */
export function noteLevelNow(n: NoteLevelInput, now: number): number {
  let pos = n.position;
  if (n.loop && pos > n.loop[1] && n.loop[1] > n.loop[0]) pos = n.loop[0] + ((pos - n.loop[0]) % (n.loop[1] - n.loop[0]));
  let level = n.gain;
  if (n.outline && n.outline.length) {
    const i = Math.floor(Math.max(0, pos) / OUTLINE_STEP);
    level *= i < n.outline.length ? n.outline[i] : 0;
  }
  if (now > n.releasedAt) level *= Math.exp(-(now - n.releasedAt) / Math.max(1e-3, n.releaseTc));
  return level;
}

/** A sounding note as the choice sees it. */
export interface StealCandidate {
  start: number;
  /** Its level now (noteLevelNow) */
  level: number;
  /** Its key is still down (not in its release yet) */
  held: boolean;
}

/**
 * The note to fade out at `now` to make room for a new one (its index), or -1 for none: the
 * quietest, held notes counting HELD_WEIGHT times louder, and notes in their first STEAL_GRACE
 * seconds only if there's nothing older. Ties go to the oldest.
 */
export function chooseNoteToSteal(notes: StealCandidate[], now: number): number {
  let best = -1;
  let bestYoung = true;
  let bestScore = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const young = now - n.start < STEAL_GRACE;
    const score = n.level * (n.held ? HELD_WEIGHT : 1);
    const better =
      best < 0 ||
      (bestYoung && !young) ||
      (bestYoung === young && (score < bestScore || (score === bestScore && n.start < notes[best].start)));
    if (better) {
      best = i;
      bestYoung = young;
      bestScore = score;
    }
  }
  return best;
}
