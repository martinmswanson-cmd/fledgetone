/**
 * Shape dynamics: a part's notes get louder and softer the way a player phrases a line, without
 * drawing anything. The notes are split into phrases at each rest (a gap of an eighth of a bar or
 * more, or every two bars of non-stop notes); within each, the loudness rises to the phrase's
 * peak (its highest note) and falls away after it, higher notes leaning a little louder, and the
 * phrase's last note eases off. Each phrase keeps its own average loudness, so the part's overall
 * level, and any accents between phrases, stay as written.
 */
import { durationToBars } from './timelineTypes';
import { midiOf } from './noteTools';
import type { NoteEvent } from './timelineTypes';
import { maxOf, minOf } from '../support/minMax';

/** A rest this long (bars) or longer ends a phrase */
const PHRASE_GAP = 1 / 8;
/** Non-stop notes make a new phrase every this many bars */
const PHRASE_MAX = 2;

export function shapeDynamics(notes: NoteEvent[]): NoteEvent[] {
  if (notes.length < 3) return notes;
  const sorted = [...notes].sort((a, b) => a.startOffset - b.startOffset);
  // Phrases of note groups (a chord is one group)
  const phrases: NoteEvent[][][] = [];
  let phrase: NoteEvent[][] = [];
  let phraseStart = 0;
  let lastEnd = -Infinity;
  for (const n of sorted) {
    const group = phrase[phrase.length - 1];
    if (group && Math.abs(group[0].startOffset - n.startOffset) < 1e-6) {
      group.push(n);
      lastEnd = Math.max(lastEnd, n.startOffset + durationToBars(n.duration));
      continue;
    }
    if (phrase.length && (n.startOffset - lastEnd >= PHRASE_GAP - 1e-6 || n.startOffset - phraseStart >= PHRASE_MAX - 1e-6)) {
      phrases.push(phrase);
      phrase = [];
    }
    if (!phrase.length) phraseStart = n.startOffset;
    phrase.push([n]);
    lastEnd = Math.max(lastEnd, n.startOffset + durationToBars(n.duration));
  }
  if (phrase.length) phrases.push(phrase);

  const velocity = new Map<string, number>();
  for (const groups of phrases) {
    if (groups.length < 2) continue;
    const top = groups.map((g) => maxOf(g.map((n) => midiOf(n.note))));
    const lo = minOf(top);
    const hi = maxOf(top);
    // The peak: the highest note's place in the phrase (the first, if it repeats)
    const peakAt = top.indexOf(hi) / (groups.length - 1);
    const peak = Math.min(0.85, Math.max(0.3, peakAt));
    const raw = groups.map((_, i) => {
      const p = i / (groups.length - 1);
      const arch = 1 - (Math.abs(p - peak) / Math.max(peak, 1 - peak)) ** 1.5;
      const height = hi > lo ? (top[i] - lo) / (hi - lo) : 0.5;
      const ease = i === groups.length - 1 ? -0.08 : 0;
      return 0.82 + 0.3 * (0.7 * arch + 0.3 * height) + ease;
    });
    // Keep the phrase's average where it was
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    groups.forEach((g, i) => {
      for (const n of g) velocity.set(n.id, Math.max(0.12, Math.min(1, n.velocity * (raw[i] / mean))));
    });
  }
  return notes.map((n) => (velocity.has(n.id) ? { ...n, velocity: Math.round(velocity.get(n.id)! * 1000) / 1000 } : n));
}
