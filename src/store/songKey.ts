import type { Clip, Track } from './timelineTypes';
import { isPitched } from './keyChange';
import { midiOf } from './noteTools';
import { durationToBars } from './timelineTypes';

/**
 * The song's key, worked out from its notes: how long each pitch class sounds, matched against
 * the usual major and minor key profiles (Krumhansl-Kessler). Used to tune sound effects and
 * stingers to the song. No audio or store here, so Node can unit-test it.
 */

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11] as const;
export const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10] as const;

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** A weight per pitch class (tonic first) for each mode. */
export interface KeyProfiles {
  major: readonly number[];
  minor: readonly number[];
}
/** Krumhansl-Kessler: listeners' ratings of how well each note fits a key. */
export const KK_PROFILES: KeyProfiles = { major: MAJOR_PROFILE, minor: MINOR_PROFILE };

export interface SongKey {
  /** 0 = C */
  root: number;
  mode: 'major' | 'minor';
  name: string;
  steps: readonly number[];
}

// ---------- Spelling: flats in flat keys, sharps in sharp ones ----------

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11] as const;
/** Each home note as keys on it are written (D♭ major, C♯ minor, F♯ both ways). */
const MAJOR_HOME = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;
const MINOR_HOME = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'] as const;
/** The scale step a note `semis` over home is written on (♭II, ii, ♭III, III, IV, ♯IV, V, ♭VI, VI, ♭VII, VII). */
const STEP_OF = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6] as const;
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const;
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;
const pcOf = (m: number) => ((m % 12) + 12) % 12;

/** The home note's name as a key on `root` in `mode` is written: B♭ major, C♯ minor. */
export const keyHomeName = (root: number, mode: 'major' | 'minor'): string => (mode === 'minor' ? MINOR_HOME : MAJOR_HOME)[pcOf(root)];

/** A note on `letter` (0 C … 6 B) with pitch class `target`: "E♭", "F♯", or null past a single flat or sharp. */
function onLetter(letter: number, target: number): string | null {
  const acc = ((target - LETTER_PC[letter] + 18) % 12) - 6;
  return acc === 0 ? LETTERS[letter] : acc === -1 ? `${LETTERS[letter]}♭` : acc === 1 ? `${LETTERS[letter]}♯` : null;
}

/**
 * The name of the note `semis` over a home note named `home` (as keyHomeName gives, or a key a
 * change moves to), spelled by the scale step it stands on: in F major ♭VI is D♭ and IV is B♭; in
 * A minor ♭III is C. (Where a step would need a double flat or sharp, the plain flat or sharp of the
 * key's kind.)
 */
export function spellFrom(home: string, root: number, semis: number): string {
  const letter = (LETTERS.indexOf(home[0] as (typeof LETTERS)[number]) + STEP_OF[pcOf(semis)]) % 7;
  const target = pcOf(root + semis);
  return onLetter(letter, target) ?? (home.includes('♯') ? SHARP_NAMES : FLAT_NAMES)[target];
}

/** The name of the note `semis` over the home note of a key on `root` in `mode`, spelled by its step (spellFrom). */
export const spellNote = (root: number, mode: 'major' | 'minor', semis: number): string => spellFrom(keyHomeName(root, mode), root, semis);

/**
 * The home note of the key `up` semitones over the key named `home`, written to agree with it: up a
 * whole step the next letter (G♯ minor to A♯ minor, so its V7 before is E♯7); up a half step the
 * next letter or the same one raised, whichever needs no sharp or flat, else the kind the key had
 * (F to G♭, F♯ to G, B♭ to B).
 */
export function liftedHome(home: string, root: number, up: number): string {
  const letter = LETTERS.indexOf(home[0] as (typeof LETTERS)[number]);
  const target = pcOf(root + up);
  const next = onLetter((letter + 1) % 7, target);
  if (up === 2 || (next && !/[♭♯]/.test(next))) return next ?? SHARP_NAMES[target];
  const same = onLetter(letter, target);
  if (same && !/[♭♯]/.test(same)) return same;
  return home.includes('♯') ? (same ?? next ?? SHARP_NAMES[target]) : (next ?? same ?? FLAT_NAMES[target]);
}

export const keyOf = (root: number, mode: 'major' | 'minor'): SongKey => ({
  root,
  mode,
  name: `${keyHomeName(root, mode)} ${mode}`,
  steps: mode === 'major' ? MAJOR_STEPS : MINOR_STEPS,
});

function correlation(a: readonly number[], b: readonly number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * How much the song's opening bass note counts towards a key on that root. The notes alone can't
 * tell a key from its relative (A minor and C major share every note); where the song starts
 * usually can. Tuned on the starters: their stated keys, 17 of 57 wrong without it, 9 with it.
 */
const OPENING_BASS_WEIGHT = 0.2;

/** The likeliest key of the pitched notes, or null if there are none. */
export function detectKey(clips: readonly Clip[], tracks: readonly Track[]): SongKey | null {
  const pitched = new Set(tracks.filter((t) => isPitched(t.instrumentKey)).map((t) => t.id));
  const weight = new Array(12).fill(0);
  // The lowest note starting in the song's first beat (bars from the song's start)
  let first = Infinity;
  const starts: Array<[number, number]> = [];
  for (const c of clips) {
    if (!pitched.has(c.trackId) || c.audio) continue;
    for (const n of c.notes) {
      const m = midiOf(n.note);
      if (!Number.isFinite(m) || n.startOffset >= c.lengthBars) continue;
      // Longer and lower notes say more about the key (a bass note more than a passing one)
      const len = Math.min(1, durationToBars(n.duration) || 0.25);
      weight[((m % 12) + 12) % 12] += len * (m < 60 ? 1.5 : 1);
      const at = c.startBar + n.startOffset;
      starts.push([at, m]);
      first = Math.min(first, at);
    }
  }
  if (!starts.length) return null;
  let low = Infinity;
  for (const [at, m] of starts) if (at < first + 0.25 && m < low) low = m;
  const opening = ((low % 12) + 12) % 12;
  // A major key whose leading tone (the note under its root) never sounds isn't the key: a song
  // in D dorian (C major's notes) leaned on G otherwise, and wrote an F# that never plays. A
  // minor key keeps its chance, since natural minor has no leading tone
  const ranked = rankKeys(weight)
    .filter((k) => k.key.mode === 'minor' || weight[(k.key.root + 11) % 12] > 0)
    .map((k) => ({ ...k, score: k.score + (k.key.root === opening ? OPENING_BASS_WEIGHT : 0) }));
  // (stable: a tie keeps rankKeys' order)
  return ranked.reduce((best, k) => (k.score > best.score ? k : best)).key;
}

/**
 * Every key, likeliest first, for a weight per pitch class (C first): the weights' correlation
 * with the major and minor key profiles turned to each root. Notes (detectKey) and recordings
 * (sampleAnalysis.ts) are matched the same way.
 */
export function rankKeys(weight: readonly number[], profiles: KeyProfiles = KK_PROFILES): Array<{ key: SongKey; score: number }> {
  const all: Array<{ key: SongKey; score: number }> = [];
  for (let root = 0; root < 12; root++) {
    for (const mode of ['major', 'minor'] as const) {
      const profile = profiles[mode];
      const rotated = profile.map((_, i) => profile[(i - root + 12) % 12]);
      all.push({ key: keyOf(root, mode), score: correlation(weight, rotated) });
    }
  }
  // Stable, so a tie goes to the earlier key (C before C#, major before minor), as it always has
  return all.map((k, i) => ({ k, i })).sort((a, b) => b.k.score - a.k.score || a.i - b.i).map(({ k }) => k);
}
