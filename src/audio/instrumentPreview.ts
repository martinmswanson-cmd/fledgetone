/**
 * Hear an instrument before choosing it: a short phrase on a dry copy of it (the same build and
 * level a track gets, without any track's volume or effects), from the instrument menu's ▶ button.
 * Pitched instruments play a rising arpeggio and a chord in the middle of their range; drum kits
 * a short beat; sound effects a few of their sounds.
 */
import type { InstrumentKey } from './instrumentCatalog';
import { FX_NOTES, INSTRUMENTS, isDrumKind, isFxKind } from './instrumentCatalog';
import { auditionInstrument, DRUM_NOTES, safely } from './instruments';
import { auditionInput, initAudio } from './engine';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

interface PreviewNote {
  note: string;
  /** Seconds after the start */
  at: number;
  duration: string;
}

/** What `key` plays as its preview (pure: the notes and when). */
export function previewNotes(key: InstrumentKey): PreviewNote[] {
  const def = INSTRUMENTS[key];
  if (isDrumKind(key)) {
    const { kick, snare, closedHat } = DRUM_NOTES;
    return [
      { note: kick, at: 0, duration: '8n' },
      { note: closedHat, at: 0.2, duration: '16n' },
      { note: snare, at: 0.4, duration: '8n' },
      { note: closedHat, at: 0.6, duration: '16n' },
      { note: kick, at: 0.8, duration: '8n' },
      { note: kick, at: 1.0, duration: '8n' },
      { note: snare, at: 1.2, duration: '8n' },
    ];
  }
  if (isFxKind(key)) {
    // A few of its sounds, one after another (not an arpeggio of whatever rows a chord lands on)
    return [
      { note: FX_NOTES.impact, at: 0, duration: '2n' },
      { note: FX_NOTES.riser, at: 0.9, duration: '2n' },
      { note: FX_NOTES.subDrop, at: 1.9, duration: '2n' },
    ];
  }
  const [lo, hi] = def.range;
  // A C near the middle that leaves room for an octave above it
  const root = Math.max(lo, Math.min(hi - 12, Math.round((lo + hi) / 2 / 12 - 0.5) * 12));
  const up = [0, 4, 7, 12].map((i) => Math.min(hi, root + i));
  return [
    ...up.map((m, i) => ({ note: noteName(m), at: i * 0.22, duration: '8n' })),
    // Then the chord, held
    ...[0, 4, 7].map((i) => ({ note: noteName(Math.min(hi, root + i)), at: 1.0, duration: '2n' })),
  ];
}

let playing: { key: InstrumentKey; until: number } | null = null;

/** Play `key`'s preview; returns when it has finished (or right away if it couldn't load). */
export async function previewInstrument(key: InstrumentKey): Promise<void> {
  await initAudio();
  const inst = auditionInstrument(key, auditionInput);
  try {
    await inst.ready; // recorded instruments download on first use
  } catch {
    return;
  }
  const now = auditionInput.context.currentTime;
  // A second press while it plays doesn't pile another copy on top
  if (playing && playing.key === key && playing.until > now) return;
  const notes = previewNotes(key);
  for (const n of notes) safely(() => inst.play([{ note: n.note, duration: n.duration, velocity: 0.8 }], now + 0.02 + n.at));
  const seconds = Math.max(...notes.map((n) => n.at)) + 1.2;
  playing = { key, until: now + seconds };
  await new Promise((done) => setTimeout(done, seconds * 1000));
}
