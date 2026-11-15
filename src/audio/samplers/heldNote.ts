/**
 * Living notes (Track.living): how a held note of a bowed or blown instrument moves while it
 * sounds. Pure maths, so Node can test it; samplerManager.ts plays it.
 *
 * Measured on real playing against the same notes played by the app (solo violin, cello and
 * French horn recordings from MusicNet, each long note tracked by its harmonics): a real held
 * note's level moves 5 to 6 dB while it sounds where the app's moved 2 to 4; its pitch drifts 9 to
 * 31 cents where the app's drifted 2 to 5; no two notes are tuned quite alike (12 to 18 cents
 * apart, the app's 2 to 4); and a string player's vibrato is there from the start of the note and
 * quicker (6.6 to 7 Hz against 4.9 to 5.7), where the app's faded in over most of a second. The
 * app's notes were more exact than anyone plays, and each one the same as the last.
 *
 * So a living note:
 * - comes up to its loudest part of the way in and then eases off (levelCurve), a couple of dB;
 * - sits a few cents off true if it is a soloist's and drifts slowly while held (pitchOffset,
 *   pitchCurve); a section's notes stay true on average, so a chord of them doesn't turn sour;
 * - has its vibrato from the start (vibratoOnset), at the quicker rate its instrument gives for
 *   it (InstrumentDef.vibrato.living).
 * Everything is set well under what was measured (one player an instrument, slow solo pieces), and
 * each note's own numbers come from `jitter` (noteJitter: the note and where it is in the song),
 * so a note moves the same way every time it plays and an export comes out the same.
 */

/** A note's own numbers by `salt`, each from -1 to 1 (see noteJitter in songPlace.ts). */
export type Jitter = (salt: number) => number;

/** The shortest note (seconds) whose level and pitch move: under it there is no time to hear it. */
export const LIVING_SHORTEST = 0.3;
/** A note held by hand has no known end: its pitch drifts over this long (seconds), then holds. */
export const LIVING_HELD_SECONDS = 12;
/** Points in a level curve. */
const LEVEL_POINTS = 24;
/** Points a second in a pitch curve. */
const PITCH_RATE = 25;

const unit = (jitter: Jitter, salt: number) => (jitter(salt) + 1) / 2;

/**
 * A held note's level through its `seconds`, as gains from its start to its end: from 0.8 to 2 dB
 * under its loudest, up to its loudest between 28% and 55% of the way, then easing off by 1.5 to 4
 * dB (a note under a second by less, in proportion). Never over 1: a note is never louder than it
 * was without this.
 */
export function levelCurve(seconds: number, jitter: Jitter): Float32Array {
  const peak = 0.28 + 0.27 * unit(jitter, 101);
  const from = -(0.8 + 1.2 * unit(jitter, 103));
  const to = -(1.5 + 2.5 * unit(jitter, 107)) * Math.min(1, seconds);
  const curve = new Float32Array(LEVEL_POINTS);
  for (let i = 0; i < LEVEL_POINTS; i++) {
    const x = i / (LEVEL_POINTS - 1);
    const db = x < peak ? from * (1 - Math.sin((Math.PI / 2) * (x / peak))) : to * (1 - Math.cos((Math.PI / 2) * ((x - peak) / (1 - peak))));
    curve[i] = 10 ** (db / 20);
  }
  // (its loudest point is one of the points, exactly its own level)
  curve[Math.min(LEVEL_POINTS - 1, Math.max(0, Math.round(peak * (LEVEL_POINTS - 1))))] = 1;
  return curve;
}

/** How far off true a note sits, cents: a soloist's up to 3.5 either way; a section's none. */
export function pitchOffset(soloist: boolean, jitter: Jitter): number {
  return soloist ? 3.5 * jitter(109) : 0;
}

/**
 * A held note's pitch through its `seconds`, cents from the note, PITCH_RATE points a second: its
 * offset (pitchOffset) and a slow drift, two waves of 1.2 to 2.5 s and 0.5 to 0.9 s, up to 4 and
 * 1.5 cents for a soloist and half that for a section.
 */
export function pitchCurve(seconds: number, soloist: boolean, jitter: Jitter): Float32Array {
  const off = pitchOffset(soloist, jitter);
  const a1 = (soloist ? 4 : 2) * (0.6 + 0.4 * unit(jitter, 113));
  const a2 = (soloist ? 1.5 : 0.8) * (0.6 + 0.4 * unit(jitter, 127));
  const t1 = 1.2 + 1.3 * unit(jitter, 131);
  const t2 = 0.5 + 0.4 * unit(jitter, 137);
  const p1 = 2 * Math.PI * unit(jitter, 139);
  const p2 = 2 * Math.PI * unit(jitter, 149);
  const n = Math.max(8, Math.ceil(seconds * PITCH_RATE));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * seconds;
    curve[i] = off + a1 * Math.sin((2 * Math.PI * t) / t1 + p1) + a2 * Math.sin((2 * Math.PI * t) / t2 + p2);
  }
  return curve;
}

/**
 * When a note's vibrato comes in: `delay` seconds after the note starts it grows over `ramp`
 * seconds (to `first` of its depth, a legato change's reaching the rest a little later), its speed
 * starting at `from` of its rate and settling over `settle` seconds. `jitter`: the note's own
 * number, -1 to 1. Living: there within a quarter second, near its speed from the start, as a
 * player's is. Not living: as it has always been (a fifth of a second or so in, growing over half a
 * second, from 82% of its speed), so a track without Living notes sounds as it did.
 */
export function vibratoOnset(legato: boolean, living: boolean, jitter: number): { delay: number; ramp: number; from: number; settle: number; first: number } {
  if (!living) return legato ? { delay: 0.03, ramp: 0.25, from: 0.95, settle: 0.3, first: 0.8 } : { delay: 0.2 + 0.06 * jitter, ramp: 0.5, from: 0.82, settle: 0.9, first: 1 };
  return legato ? { delay: 0.02, ramp: 0.1, from: 0.94, settle: 0.3, first: 0.9 } : { delay: 0.05 + 0.03 * jitter, ramp: 0.16, from: 0.94, settle: 0.3, first: 1 };
}
