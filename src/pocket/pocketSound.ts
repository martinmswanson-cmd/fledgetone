/**
 * What Pocket's pads and grids play: the drum kit's sounds in pad order, and audition (a note
 * through a track as it sounds in the song, starting the audio on the first tap).
 */
import { DRUM_NOTES } from '../audio/instruments';
import { initAudio } from '../audio/engine';
import { previewTrackNotes } from '../audio/liveTracks';

/** The kit's sounds: the pads (in this order) and the grid's rows (the first five always shown). */
export const DRUM_PADS: Array<{ note: string; label: string; color: string }> = [
  { note: DRUM_NOTES.kick, label: 'Kick', color: '#f59e0b' },
  { note: DRUM_NOTES.snare, label: 'Snare', color: '#ef4444' },
  { note: DRUM_NOTES.clap, label: 'Clap', color: '#ec4899' },
  { note: DRUM_NOTES.closedHat, label: 'Hat', color: '#22d3ee' },
  { note: DRUM_NOTES.openHat, label: 'Open hat', color: '#38bdf8' },
  { note: DRUM_NOTES.tomLow, label: 'Low tom', color: '#a78bfa' },
  { note: DRUM_NOTES.tomMid, label: 'Mid tom', color: '#8b5cf6' },
  { note: DRUM_NOTES.tomHigh, label: 'High tom', color: '#7c3aed' },
  { note: DRUM_NOTES.crash, label: 'Crash', color: '#facc15' },
  { note: DRUM_NOTES.ride, label: 'Ride', color: '#a3e635' },
  { note: DRUM_NOTES.cowbell, label: 'Cowbell', color: '#fb923c' },
];

let audioStarted = false;
/** Play notes through a track as it sounds in the song (starting the audio on the first tap). */
export async function audition(trackId: string, note: string, velocity = 0.85): Promise<void> {
  if (!audioStarted) {
    await initAudio();
    audioStarted = true;
  }
  previewTrackNotes(trackId, [{ note, duration: '16n', velocity }]);
}

