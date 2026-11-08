/**
 * Which take a recorded instrument plays for a song's note, where it has more than one take of a
 * note at a loudness (the recorded drum kits, a sampled instrument: see SampleSource.layers), and
 * which way a guitar strums a song's chord. Plain logic, no Web Audio, so Node's tests cover it.
 *
 * A song's note plays its takes in turn by its place in the song: its turn at a loudness is how
 * many hits of the same sound the instrument has played at that loudness before it on its track,
 * counted from the song's start as an export of the whole song plays them, and it plays take
 * (turn mod takes) there. The hits are counted as the instrument plays them (trackTakes): only the
 * notes that play (a note on a chance plays on the passes the export gives it), each at the
 * loudness it really plays at, with everything that moves it there: the Human insert's drift, an
 * Expressive kit's own small level differences (drumHits.ts, picked by the hit's place in the song,
 * so worked out here the same way), the loudest note of a chord (a sampled instrument plays a chord
 * at it), a sampled instrument's blend of the two loudnesses either side of a boundary (both are
 * counted) and the mod wheel's dynamics; a closed hat an open hat replaces isn't counted, and a kit
 * counts each sound it plays (a row it has no recording of isn't). So the take a hit plays is the
 * one a kit or instrument counting its own hits from bar 1 plays (what a whole-song export always
 * gave a drum kit), and the hits of one sound never play the same recording twice running,
 * whatever their rhythm, accents, drift or loudness, wherever playback began, after a pause, on
 * every pass of a loop and in every export (the whole song or a range, at any sample rate, a stem
 * or a part of one). A sampled instrument counts each note on its own, so two notes played in turn
 * each alternate.
 *
 * A loop holding an odd number of a sound's hits plays the same take at its end and as it comes
 * round: every pass plays each hit's take as the export has it at that place, and the export's
 * takes alternate along the song, so the take where the loop ends and the take where it begins
 * are both fixed, and an odd count makes them the same. No rule can change that without a pass
 * playing another take than the export at that place.
 *
 * A guitar's chord (two notes or more played together) is strummed down, or up when it follows a
 * downstroke closely enough for the hand to be coming back up (guitarStrum.ts strumsDown): a
 * song's chord after the song's strum before it, by their places in the song, so it's strummed
 * the same way live from anywhere, after a pause, round a loop and in every export.
 *
 * Before, each instrument counted the notes it had played since it was made: live, every one since
 * the page opened (playing from bar 5, after a Pause, which let go of the notes set up ahead but
 * had counted them, after playing before), in an export from where the export began, so a hit
 * could play the other take than in the file, hit after hit; and a strum followed the instrument's
 * last strum, so a chord could be strummed the other way. A sampled instrument counted every
 * pitch together, so two notes played in turn (an octave bass line) each played one take.
 *
 * A note played by hand (a pad, a key, MIDI, a preview) has no turn: it plays the instrument's next
 * take, and a chord played by hand is strummed after the strum the instrument played last.
 */
import { INSTRUMENTS, type InstrumentKey } from './instrumentCatalog';
import { BLEND_ZONE } from './samplers/songSamples';
import { drumHits, ROW_OF, type DrumRow } from './drumHits';
import { DRUM_NOTES } from '../store/drumNotes';
import { jitterAt } from './songPlace';
import { STRUMMED, strumsDown, type LastStrum } from './guitarStrum';
import { noteDrift } from './human';
import { notePlays } from '../store/noteChance';
import { isExpressive } from '../store/noteExpression';
import { durationToBars } from '../store/timelineTypes';
import type { NoteEvent, NoteExpression, TrackFx } from '../store/timelineTypes';
import { midiOf } from '../store/noteTools';
import { maxOf } from '../support/minMax';
import { playsTakesInTurn } from './noteMemory';

/** The loudness `velocity` plays at: the first of `tops` (each loudness's highest velocity) it's within, else the loudest. */
export function loudnessOf(velocity: number, tops: readonly number[]): number {
  const l = tops.findIndex((top) => velocity <= top + 1e-6);
  return l < 0 ? tops.length - 1 : l;
}

/**
 * The loudness a recorded kit plays a hit on a row at `velocity` from: its own (by `tops`), or where
 * the row has no recording at it (`has`, for each of the row's `count` loudnesses), the nearest
 * softer one, else the nearest harder (not the loudest: a medium hit mustn't play the hardest
 * recording).
 */
export function recordedLoudness(velocity: number, tops: readonly number[], count: number, has: (layer: number) => boolean): number {
  let l = tops.findIndex((top) => velocity <= top + 1e-6);
  if (l < 0) l = count - 1;
  const wanted = l;
  while (l > 0 && !has(l)) l--;
  if (!has(l)) for (l = wanted; l < count - 1 && !has(l); l++);
  return l;
}

/** Under the mod wheel's dynamics `dyn` (0 to 1), the softer of the two loudnesses (of `layers`) a sampled note plays; -1 with one loudness. */
export function wheelLoudness(dyn: number, layers: number): number {
  const span = layers - 1;
  return span > 0 ? Math.min(span - 1, Math.floor(dyn * span)) : -1;
}

/** Near a loudness boundary (within BLEND_ZONE of one of `tops`), the softer loudness of the two a sampled note blends; else -1. */
export function blendEdge(velocity: number, tops: readonly number[]): number {
  for (let l = 0; l < tops.length - 1; l++) if (Math.abs(velocity - tops[l]) < BLEND_ZONE) return l;
  return -1;
}

/**
 * The loudnesses a sampled instrument picks a recording from for a note at `velocity`: under the
 * mod wheel's dynamics (`wheel`, null when off) the wheel's two, near a boundary the two either side
 * (blended), else its own (see samplerManager.ts samplerVoice start).
 */
export function sampledLoudnesses(velocity: number, tops: readonly number[], wheel: number | null): number[] {
  const low = wheel !== null ? wheelLoudness(wheel, tops.length) : -1;
  if (low >= 0) return [low, low + 1];
  const edge = tops.length > 1 ? blendEdge(velocity, tops) : -1;
  return edge >= 0 ? [edge, edge + 1] : [loudnessOf(velocity, tops)];
}

/** A solo bowed string plays two notes at most (a double stop): the outer two of a chord (by `midi`). */
export function outerTwo<T>(notes: readonly T[], midi: (n: T) => number): T[] {
  if (notes.length <= 2) return [...notes];
  return [...notes].sort((a, b) => midi(a) - midi(b)).filter((_, i, all) => i === 0 || i === all.length - 1);
}

/** Which of `takes` takes a note on `turn` plays. */
export const takeOf = (turn: number, takes: number): number => ((turn % takes) + takes) % takes;

/** The Human insert's settings for a track (see scheduler.ts): `together`, its notes that start together drift as one. */
export interface TakeFeel {
  human: TrackFx['human'];
  together: boolean;
}

/**
 * The velocity each of a group's notes plays at under the Human insert `f`: each its own drift,
 * or, together, the first note's drift for all (see scheduler.ts playGroup).
 */
export function humanVelocities(group: { notes: ReadonlyArray<{ velocity: number }>; seeds: readonly number[] }, f: TakeFeel): number[] {
  const drifted = (n: { velocity: number }, seed: number) => Math.max(0.05, Math.min(1, n.velocity * noteDrift(seed, f.human).gain));
  if (!f.together) return group.notes.map((n, i) => drifted(n, group.seeds[i]));
  const first = drifted(group.notes[0], group.seeds[0]);
  // (A silent first note: the others keep their own velocities)
  const gain = group.notes[0].velocity > 0 ? first / group.notes[0].velocity : 1;
  return group.notes.map((n, i) => (i === 0 ? first : Math.max(0.05, Math.min(1, n.velocity * gain))));
}

/** A note of a song's group, as written (its velocity before the Human insert). */
export interface TakeNote {
  note: string;
  velocity: number;
  duration: string;
  expr?: NoteExpression;
}

/**
 * What a track plays at one tick, in the order the scheduler plays it: a group of notes starting
 * together (one clip's, of one length), or a clip's mod wheel event.
 */
export interface SongItem {
  tick: number;
  notes?: readonly TakeNote[];
  /** Each note's Human seed (also what decides a note on a chance), in step with `notes` */
  seeds?: readonly number[];
  /** Each note's chance and condition (null: always), in step with `notes` */
  conds?: ReadonlyArray<Pick<NoteEvent, 'chance' | 'cond'> | null>;
  /** The pass its clip plays on in an export (see noteChance.ts passOf) */
  pass?: number;
  /** Where it plays in the song (seconds from bar 1: its swing and row shift in it, as the scheduler hands it in: see songPlace.ts) */
  place?: number;
  /** A mod wheel event: its dynamics (null: back to the notes' velocities), `end` at a clip's end */
  wheel?: { value: number | null; end: boolean };
}

/** A group's takes (see trackTakes): each note's turn by loudness, and which way a chord here is strummed. */
export interface GroupTakes {
  turns: Array<readonly number[] | undefined>;
  down?: boolean;
}

/**
 * How an instrument's song notes carry takes (see trackTakes): a recorded kit with takes, a sampled
 * instrument with takes or strummed, or not at all.
 */
export function takesKind(key: InstrumentKey): 'kit' | 'sampled' | null {
  const def = INSTRUMENTS[key];
  if (!def?.samples) return null;
  if (def.kind === 'drums') return playsTakesInTurn(key) ? 'kit' : null;
  if (def.kind === 'sampled') return playsTakesInTurn(key) || (STRUMMED.has(key) && !def.bowed) ? 'sampled' : null;
  return null;
}

const recordedMemo = new Map<InstrumentKey, Map<string, boolean[]>>();
/** Each note's loudnesses a kit has recordings at (from its catalog entry). */
function recordedNotes(key: InstrumentKey): Map<string, boolean[]> {
  let known = recordedMemo.get(key);
  if (!known) {
    known = new Map();
    for (const name of Object.keys(INSTRUMENTS[key]?.samples?.samples ?? {})) {
      const [note, l = '0'] = name.split('|');
      const row = known.get(note) ?? [];
      row[Number(l)] = true;
      known.set(note, row);
    }
    recordedMemo.set(key, known);
  }
  return known;
}

/**
 * Each of a track's song groups' takes (see the top of the file), in step with `items` (the track's
 * groups and mod wheel events in the order the scheduler plays them: by tick, a clip's in its
 * order): undefined for a mod wheel event, or every item on an instrument without takes or strum.
 * `expressive`: the track's Expressive switch (a kit's hits a hair different in level); `feel`: its
 * Human insert while on. Every note gets its turns at every loudness, a note that sits the export's
 * pass out too (a live loop's later pass may play it: the take after the export's hits before it).
 */
export function trackTakes(key: InstrumentKey, expressive: boolean, feel: TakeFeel | undefined, items: readonly SongItem[]): Array<GroupTakes | undefined> {
  const out = new Array<GroupTakes | undefined>(items.length);
  const kind = takesKind(key);
  if (!kind) return out;
  const def = INSTRUMENTS[key];
  const tops = def.samples?.layers ?? [1];
  const strummed = kind === 'sampled' && STRUMMED.has(key) && !def.bowed;
  const recorded = kind === 'kit' ? recordedNotes(key) : null;
  /** The note a kit plays a row's hit from (an open hat from the closed hat's recordings where it has none: see instruments.ts recordedKit) */
  const kitNote = (row: DrumRow) => (row === 'openHat' && !recorded!.has(DRUM_NOTES.openHat) ? DRUM_NOTES.closedHat : DRUM_NOTES[row]);
  /** The sound a note's takes are counted by: a kit's recording it plays from (none for a row it hasn't recorded), a sampled instrument's note */
  const soundOf = (note: string): string | undefined => {
    if (!recorded) return note;
    const row = ROW_OF.get(note);
    return row && recorded.has(kitNote(row)) ? kitNote(row) : undefined;
  };
  const counts = new Map<string, number[]>();
  /** The turns at every loudness for a hit of `sound` here; counted at `layers` (the ones it plays) */
  const turnsOf = (sound: string, layers: readonly number[]): number[] => {
    let c = counts.get(sound);
    if (!c) counts.set(sound, (c = tops.map(() => 0)));
    const turns = c.slice();
    for (const l of layers) c[l]++;
    return turns;
  };
  let wheel: number | null = null;
  let last: LastStrum | null = null;

  /** One call of the instrument's play: `idx` of the group's notes, at `velocities`, at `place` (each note's turns into `turns`) */
  const call = (notes: readonly TakeNote[], idx: readonly number[], velocities: readonly number[], place: number, turns: GroupTakes['turns']) => {
    if (recorded) {
      const hits = drumHits(
        idx.map((i, k) => ({ note: notes[i].note, velocity: velocities[k], expr: notes[i].expr })),
        (row, salt) => jitterAt(row, place, salt),
        expressive,
        false
      );
      for (const h of hits) {
        const sound = kitNote(h.row);
        const row = recorded.get(sound);
        if (!row) continue;
        turns[idx[h.index]] = turnsOf(sound, [recordedLoudness(h.velocity, tops, row.length, (l) => !!row[l])]);
      }
      return;
    }
    // A chord at its loudest note's velocity (instruments.ts), a solo string's outer two
    const velocity = maxOf(velocities);
    const layers = sampledLoudnesses(velocity, tops, def.dynamics ? wheel : null);
    const sounding = def.bowed?.solo ? outerTwo(idx, (i) => midiOf(notes[i].note)) : idx;
    for (const i of sounding) turns[i] = turnsOf(notes[i].note, layers);
  };

  const group = (item: SongItem): GroupTakes => {
    const notes = item.notes!;
    const seeds = item.seeds ?? [];
    const place = item.place ?? 0;
    // (no holes: a group's notes are filtered with their turns in step, see scheduler.ts gate)
    const turns: GroupTakes['turns'] = notes.map(() => undefined);
    // The notes that play on the export's pass (see noteChance.ts)
    const idx = notes.map((_, i) => i).filter((i) => !item.conds?.[i] || notePlays(item.conds[i]!, seeds[i], item.pass ?? 0));
    // As playGroup hands them out: under the Human insert, drifted (together as one, or each on its own)
    const calls: Array<{ idx: number[]; velocities: number[]; place: number }> = [];
    if (!idx.length) {
      // (nothing plays)
    } else if (feel) {
      const v = humanVelocities({ notes: idx.map((i) => notes[i]), seeds: idx.map((i) => seeds[i]) }, feel);
      if (feel.together) calls.push({ idx, velocities: v, place: place + noteDrift(seeds[idx[0]], feel.human).late });
      else idx.forEach((i, k) => calls.push({ idx: [i], velocities: [v[k]], place: place + noteDrift(seeds[i], feel.human).late }));
    } else calls.push({ idx, velocities: idx.map((i) => notes[i].velocity), place });
    let down: boolean | undefined;
    for (const c of calls) {
      // As playNotes plays them: the plain notes together, then each with its own bend or pressure on its own
      const own = c.idx.map((i) => isExpressive(notes[i].expr, durationToBars(notes[i].duration)));
      const plain = c.idx.filter((_, k) => !own[k]);
      if (plain.length) {
        call(notes, plain, c.velocities.filter((_, k) => !own[k]), c.place, turns);
        if (strummed && plain.length > 1) {
          down = strumsDown(last, c.place);
          last = { at: c.place, down };
        }
      }
      c.idx.forEach((i, k) => {
        if (own[k]) call(notes, [i], [c.velocities[k]], c.place, turns);
      });
    }
    // A note that doesn't sound here (sitting the export's pass out, a closed hat an open hat
    // replaced): the turns it would play at, should it play (a live loop's later pass may), the
    // take after the hits before it
    notes.forEach((n, i) => {
      const sound = turns[i] ? undefined : soundOf(n.note);
      if (sound !== undefined) turns[i] = turnsOf(sound, []);
    });
    // (no chord strummed here: the way one here would be)
    if (strummed && down === undefined) down = strumsDown(last, place);
    return strummed ? { turns, down } : { turns };
  };

  // By tick: the mod wheel's events ending a clip's, then the others, then the notes (as the scheduler plays them)
  for (let i = 0; i < items.length; ) {
    let j = i;
    while (j < items.length && items[j].tick === items[i].tick) j++;
    for (const ends of [true, false])
      for (let k = i; k < j; k++) {
        const w = items[k].wheel;
        if (w && w.end === ends) wheel = w.value === null ? null : Math.max(0, Math.min(1, w.value));
      }
    for (let k = i; k < j; k++) if (items[k].notes) out[k] = group(items[k]);
    i = j;
  }
  return out;
}
