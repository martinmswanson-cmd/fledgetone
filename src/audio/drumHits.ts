/**
 * Which hits a drum kit plays for notes handed to it together, and how: each note's row, its
 * velocity (an Expressive kit's a hair different hit to hit) and its pitch. Plain logic, no Web
 * Audio, so Node's tests cover it; the kits play by it (instruments.ts playDrums), and the
 * scheduler counts a recorded kit's takes by it (takeTurns.ts), so the take a hit is counted at
 * is the one it plays.
 */
import { DRUM_NOTES } from '../store/drumNotes';
import type { NoteExpression } from '../store/timelineTypes';

export type DrumRow = keyof typeof DRUM_NOTES;

/** Each drum note's row (DRUM_NOTES the other way round). */
export const ROW_OF: ReadonlyMap<string, DrumRow> = new Map(Object.entries(DRUM_NOTES).map(([row, note]) => [note as string, row as DrumRow]));

/**
 * Expressive drums (Track.expressive): how far each row's hits may be detuned, in cents, so a
 * repeated hit isn't the identical sound (a real drum never is; real 808s drift too). The kick
 * hardly moves, so the low end stays put; hats and claps the most. Synthesized kits only: a kit
 * that plays recordings (a recorded kit, the Designed Kit's rendered hits) would resample every
 * hit for it, which dulls the cymbals, so its hits vary in level alone.
 */
const DRUM_SPREAD: Partial<Record<DrumRow, number>> = { kick: 4, snare: 14, clap: 18, closedHat: 20, openHat: 16, tomLow: 10, tomMid: 10, tomHigh: 10, crash: 12, ride: 12, cowbell: 6 };

/** An Expressive kit's hits vary in level by up to this much either way (dB) */
const LEVEL_SPREAD_DB = 0.8;

/**
 * A drum hit's own pitch, as a frequency ratio: the bend it starts with (in semitones, see
 * NoteExpression), as the hat roll painter's rising pitch writes it; 1 for none.
 */
export const hitPitch = (n: { expr?: NoteExpression }): number => {
  const st = n.expr?.bend?.[0]?.value ?? 0;
  return st ? 2 ** (Math.max(-24, Math.min(24, st)) / 12) : 1;
};

/** One hit a kit plays: the note it's for (`index` in the notes given), its row, velocity and pitch ratio. */
export interface DrumHit {
  index: number;
  row: DrumRow;
  velocity: number;
  ratio: number;
}

/**
 * The hits a kit plays for `notes` handed to it together: one per note on a row of the kit, but a
 * closed hat with an open hat among them (one hi-hat voice: the open one replaces it).
 * `expressive`: each hit a hair different in level, and in pitch where `detune`, by `jitter` (a
 * number from -1 to 1 for the row and a salt, picked by the hit's place in the song: songPlace.ts
 * noteJitter), so they're the same every time it plays.
 */
export function drumHits(notes: ReadonlyArray<{ note: string; velocity: number; expr?: NoteExpression }>, jitter: (row: DrumRow, salt: number) => number, expressive: boolean, detune: boolean): DrumHit[] {
  const openHat = notes.some((n) => n.note === DRUM_NOTES.openHat);
  const hits: DrumHit[] = [];
  notes.forEach((n, index) => {
    const row = ROW_OF.get(n.note);
    if (!row || (row === 'closedHat' && openHat)) return;
    const pitch = hitPitch(n);
    if (!expressive) {
      hits.push({ index, row, velocity: n.velocity, ratio: pitch });
      return;
    }
    const ratio = detune ? pitch * 2 ** (((DRUM_SPREAD[row] ?? 8) * jitter(row, 3)) / 1200) : pitch;
    const velocity = Math.min(1, n.velocity * 10 ** ((LEVEL_SPREAD_DB * jitter(row, 5)) / 20));
    hits.push({ index, row, velocity, ratio });
  });
  return hits;
}
