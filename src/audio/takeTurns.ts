/**
 * Which take a recorded instrument plays for a song's note, where it has more than one take of a
 * note at a loudness (the recorded drum kits, a sampled instrument: see SampleSource.layers). Plain
 * logic, no Web Audio, so Node's tests cover it.
 *
 * A song's note plays its takes in turn by its place in the song: its turn is how many notes of
 * the same name at the same loudness come before it on its track, counted from the song's start
 * (each note's loudness as it plays, the Human insert's drift in it: see songTurns and scheduler.ts
 * humanVelocities), and it plays take (turn mod takes). So it plays the same take wherever playback
 * began, after a pause, on every pass of a loop and in every export (the whole song or a range, at
 * any sample rate, a stem or a part of one), and the hits of one row, or one note, never play the
 * same take twice running, whatever their rhythm (16ths, 8ths, quarters, offbeats, swung, a roll)
 * or the accents on another loudness between them. It's the take an export of the whole song from
 * bar 1 has always given a drum kit's hit, but where an Expressive kit's own small level
 * differences (made in the kit, instruments.ts playDrums) take a hit over into the next loudness:
 * it plays that loudness's recording on its turn at the loudness it was asked for, so a steady
 * row's hits still never play one recording twice running, but within that loudness a take can
 * come back after a hit at the other. A loop with an odd number of a note's hits in it plays the
 * same take at its end and as it comes round, as the song does there.
 *
 * Before, each instrument counted the notes it had played since it was made: live, every one since
 * the page opened (playing from bar 5, after a Pause, which let go of the notes set up ahead but
 * had counted them, after playing before), in an export from where the export began, so a hit
 * could play the other take than in the file, hit after hit. (No rule by a note's place alone can
 * do this with two takes: 16ths need neighbouring 16ths to differ, 8ths need every other 16th to.)
 * And a sampled instrument counted every pitch together, so two notes played in turn (an octave
 * bass line) each played the same take every time.
 *
 * A note played by hand (a pad, a key, MIDI, a preview) has no turn: it plays the instrument's next
 * take, as before.
 */

/** The loudness `velocity` plays at: the first of `tops` (each loudness's highest velocity) it's within, else the loudest. */
export function loudnessOf(velocity: number, tops: readonly number[]): number {
  const l = tops.findIndex((top) => velocity <= top + 1e-6);
  return l < 0 ? tops.length - 1 : l;
}

/** One of a track's song notes: where it begins (in Transport ticks), its note and its velocity. */
export interface TurnNote {
  tick: number;
  note: string;
  velocity: number;
}

/**
 * Each of a track's song notes' turn (see the top of the file), in the order given: how many notes
 * of the same name and loudness (by `tops`, the instrument's loudnesses, at each note's velocity as
 * it plays) begin before it, or at the same tick earlier in `notes` (a track's notes in the order
 * they play at a tick).
 */
export function songTurns(notes: readonly TurnNote[], tops: readonly number[]): number[] {
  const order = notes.map((_, i) => i).sort((a, b) => notes[a].tick - notes[b].tick || a - b);
  const counts = new Map<string, number>();
  const turns = new Array<number>(notes.length);
  for (const i of order) {
    const k = `${notes[i].note}|${loudnessOf(notes[i].velocity, tops)}`;
    const n = counts.get(k) ?? 0;
    turns[i] = n;
    counts.set(k, n + 1);
  }
  return turns;
}

/** Which of `takes` takes a note on `turn` plays. */
export const takeOf = (turn: number, takes: number): number => ((turn % takes) + takes) % takes;
