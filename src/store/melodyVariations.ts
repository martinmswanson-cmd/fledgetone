import type { NoteEvent } from './timelineTypes';
import { barsToDuration, durationToBars } from './timelineTypes';
import { midiOf, nameOf } from './noteTools';

/**
 * Variations on a melody, in its key: an answering phrase, the tune darker or brighter, simpler or
 * busier, syncopated, moved up a step, mirrored, or a harmony a third above it. Everything moves
 * by the scale's own steps (a "third" is a major or minor third as the key has it), so the result
 * stays in key; notes outside the scale keep their sharp or flat. No audio or store here, so Node
 * can unit-test it.
 */

export type MelodyVariation = 'answer' | 'darker' | 'brighter' | 'simpler' | 'busier' | 'syncopated' | 'stepUp' | 'mirror' | 'harmony' | 'surprise';

export const MELODY_VARIATIONS: ReadonlyArray<{ id: MelodyVariation; name: string; detail: string; place: VariationPlace }> = [
  { id: 'answer', name: 'Answer phrase', detail: 'The same rhythm going the other way, coming home to the key note: call and response', place: 'after' },
  { id: 'darker', name: 'Darker', detail: 'The tune in the minor (a minor tune goes Phrygian, with its lowered second)', place: 'after' },
  { id: 'brighter', name: 'Brighter', detail: 'The tune in the major (a major tune goes Lydian, with its raised fourth)', place: 'after' },
  { id: 'simpler', name: 'Simpler', detail: 'Only the notes on the beat, each held to the next: for a quieter moment or a bass line', place: 'after' },
  { id: 'busier', name: 'Busier', detail: 'Passing notes filling the leaps: for a busier, more excited repeat', place: 'after' },
  { id: 'syncopated', name: 'Syncopated', detail: 'Downbeat notes pushed an eighth early: more groove, more urgency', place: 'after' },
  { id: 'stepUp', name: 'Up a step', detail: 'The tune a step higher in the scale: a sequence that builds', place: 'after' },
  { id: 'mirror', name: 'Mirror', detail: 'Upside down: every rise a fall, around the first note', place: 'after' },
  { id: 'harmony', name: 'Harmony a third above', detail: 'A second voice over the tune, a third up in the scale, to play along with it', place: 'track' },
  { id: 'surprise', name: 'Surprise me', detail: 'Two of the others together, picked at random (make another for another)', place: 'after' },
];

/** Where a variation goes: after the original on its track, in place of it, or on a new track under it. */
export type VariationPlace = 'after' | 'replace' | 'track';

export interface MelodyKey {
  /** 0 = C */
  root: number;
  /** The scale's notes, semitones above the root, rising (seven of them) */
  steps: readonly number[];
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

/** A note as a scale degree (counting from the root at 0, seven to an octave) and how far off the scale it is. */
function toDegree(midi: number, key: MelodyKey): { d: number; alt: number } {
  const rel = midi - key.root;
  const oct = Math.floor(rel / 12);
  const pc = rel - oct * 12;
  let i = 0;
  for (let k = 0; k < key.steps.length; k++) if (key.steps[k] <= pc) i = k;
  return { d: oct * 7 + i, alt: pc - key.steps[i] };
}

function fromDegree(d: number, alt: number, key: MelodyKey): number {
  const oct = Math.floor(d / 7);
  const i = d - oct * 7;
  return key.root + oct * 12 + key.steps[i] + alt;
}

/** Notes in time order (ties by pitch), as the variations read them. */
const ordered = (notes: readonly NoteEvent[]) => [...notes].sort((a, b) => a.startOffset - b.startOffset || midiOf(a.note) - midiOf(b.note));

const withPitch = (n: NoteEvent, midi: number, newId: () => string): NoteEvent => ({ ...n, id: newId(), note: nameOf(Math.max(0, Math.min(127, midi))) });

/** Every note moved `by` scale steps. */
function shift(notes: readonly NoteEvent[], by: number, key: MelodyKey, newId: () => string): NoteEvent[] {
  return notes.map((n) => {
    const { d, alt } = toDegree(midiOf(n.note), key);
    return withPitch(n, fromDegree(d + by, alt, key), newId);
  });
}

/** Upside down around `pivot` (a degree): each note as far below it as it was above. */
function invert(notes: readonly NoteEvent[], pivot: number, key: MelodyKey, newId: () => string): NoteEvent[] {
  return notes.map((n) => {
    const { d } = toDegree(midiOf(n.note), key);
    return withPitch(n, fromDegree(2 * pivot - d, 0, key), newId);
  });
}

/** The same degrees in another scale on the same root (the parallel minor, say). */
function remode(notes: readonly NoteEvent[], from: MelodyKey, to: readonly number[], newId: () => string): NoteEvent[] {
  const target: MelodyKey = { root: from.root, steps: to };
  return notes.map((n) => {
    const { d, alt } = toDegree(midiOf(n.note), from);
    return withPitch(n, fromDegree(d, alt, target), newId);
  });
}

const isMinor = (key: MelodyKey) => key.steps[2] === 3;

/**
 * A variation of `notes` (one clip's, offsets in bars) in `key`. `lengthBars` is the clip's
 * length; `measure` a measure's length in bars and `beats` its beats (for what's "on the beat").
 * Notes are new (fresh ids); the timing stays inside the clip.
 */
export function melodyVariation(notes: readonly NoteEvent[], kind: MelodyVariation, key: MelodyKey, lengthBars: number, measure = 1, beats = 4, seed = 1, newId: () => string = defaultId): NoteEvent[] {
  const tune = ordered(notes);
  if (!tune.length) return [];
  const beat = measure / beats;
  const eighth = Math.min(beat / 2, 1 / 8);
  switch (kind) {
    case 'stepUp':
      return shift(tune, 1, key, newId);
    case 'harmony':
      return shift(tune, 2, key, newId);
    case 'mirror':
      return invert(tune, toDegree(midiOf(tune[0].note), key).d, key, newId);
    case 'darker':
      return remode(tune, key, isMinor(key) ? PHRYGIAN : MINOR, newId);
    case 'brighter':
      return remode(tune, key, isMinor(key) ? MAJOR : LYDIAN, newId);
    case 'answer': {
      // The call's rhythm, its shape upside down, starting a step from where the call ended and
      // landing on the key note nearest the end
      const first = toDegree(midiOf(tune[0].note), key).d;
      const last = toDegree(midiOf(tune[tune.length - 1].note), key).d;
      const flipped = invert(tune, first, key, newId);
      const start = toDegree(midiOf(flipped[0].note), key).d;
      // Begin a step off the call's last note, on the side the answer moves toward
      const second = flipped[1] ? toDegree(midiOf(flipped[1].note), key).d : start;
      const offset = last + (second >= start ? -1 : 1) - start;
      const answer = shift(flipped, offset, key, newId);
      const end = toDegree(midiOf(answer[answer.length - 1].note), key).d;
      const home = Math.round(end / 7) * 7;
      answer[answer.length - 1] = withPitch(answer[answer.length - 1], fromDegree(home, 0, key), newId);
      return answer;
    }
    case 'simpler': {
      const onBeat = (n: NoteEvent) => Math.abs(n.startOffset / beat - Math.round(n.startOffset / beat)) < 1e-3;
      let kept = tune.filter((n, i) => i === 0 || onBeat(n));
      // A first note on a beat at most; never fewer than half the notes' starts
      if (kept.length < 2) kept = tune.filter((_, i) => i % 2 === 0);
      // One note per start (the top one of a chord), each held to the next
      const starts = [...new Map(kept.map((n) => [Math.round(n.startOffset * 192), n])).values()];
      return starts.map((n, i) => {
        const until = i + 1 < starts.length ? starts[i + 1].startOffset : Math.min(lengthBars, n.startOffset + Math.max(durationToBars(n.duration), beat));
        return { ...n, id: newId(), duration: barsToDuration(Math.max(eighth, until - n.startOffset) * 0.98) };
      });
    }
    case 'busier': {
      const out: NoteEvent[] = [];
      tune.forEach((n, i) => {
        const next = tune[i + 1];
        const gap = next ? next.startOffset - n.startOffset : 0;
        const a = toDegree(midiOf(n.note), key).d;
        const b = next ? toDegree(midiOf(next.note), key).d : a;
        if (!next || gap < 2 * eighth - 1e-6 || Math.abs(b - a) < 2) {
          out.push({ ...n, id: newId() });
          return;
        }
        // The note for half its room, then a step toward the next one
        const half = gap / 2;
        out.push({ ...n, id: newId(), duration: barsToDuration(Math.min(durationToBars(n.duration), half) * 0.95) });
        const step = a + Math.sign(b - a) * Math.max(1, Math.floor(Math.abs(b - a) / 2));
        out.push({ ...n, id: newId(), note: nameOf(fromDegree(step, 0, key)), startOffset: Math.round((n.startOffset + half) * 192) / 192, duration: barsToDuration(half * 0.9), velocity: Math.max(0.1, Math.round(n.velocity * 85) / 100) });
      });
      return out;
    }
    case 'syncopated': {
      // Notes on the measure's strong beats (bar line, middle) come an eighth early, from the second on
      const strong = (n: NoteEvent) => {
        const inBar = ((n.startOffset % measure) + measure) % measure;
        return Math.abs(inBar) < 1e-3 || (beats % 2 === 0 && Math.abs(inBar - measure / 2) < 1e-3);
      };
      const moved = tune.map((n, i) => (i > 0 && strong(n) && n.startOffset - eighth > tune[i - 1].startOffset + 1e-6 ? { ...n, id: newId(), startOffset: Math.round((n.startOffset - eighth) * 192) / 192, duration: barsToDuration(durationToBars(n.duration) + eighth) } : { ...n, id: newId() }));
      // Nothing held past the next note's new start
      return moved.map((n, i) => {
        const next = moved.slice(i + 1).find((m) => m.startOffset > n.startOffset + 1e-6);
        if (!next) return n;
        const room = next.startOffset - n.startOffset;
        return durationToBars(n.duration) > room ? { ...n, duration: barsToDuration(room * 0.98) } : n;
      });
    }
    case 'surprise': {
      const pairs: Array<[MelodyVariation, MelodyVariation]> = [
        ['brighter', 'busier'],
        ['darker', 'simpler'],
        ['answer', 'syncopated'],
        ['stepUp', 'busier'],
        ['mirror', 'syncopated'],
        ['darker', 'syncopated'],
        ['answer', 'busier'],
        ['brighter', 'syncopated'],
      ];
      const [a, b] = pairs[((Math.floor(seed) % pairs.length) + pairs.length) % pairs.length];
      return melodyVariation(melodyVariation(tune, a, key, lengthBars, measure, beats, seed, newId), b, key, lengthBars, measure, beats, seed, newId);
    }
  }
}

let counter = 0;
const defaultId = () => `note-var-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Which variation pair "Surprise me" makes with `seed` (for the toast). */
export function surprisePair(seed: number): string {
  const names = ['brighter and busier', 'darker and simpler', 'an answer, syncopated', 'up a step and busier', 'mirrored and syncopated', 'darker and syncopated', 'a busier answer', 'brighter and syncopated'];
  return names[((Math.floor(seed) % names.length) + names.length) % names.length];
}
