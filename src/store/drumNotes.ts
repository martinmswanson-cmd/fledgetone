/**
 * The drum note map (General MIDI style): the note each drum row of a kit plays. Drum clips store
 * one note name per voice. Plain data, so the starters and the agent tools load in Node without
 * the audio engine (instruments.ts re-exports it, as the app has always read it from there).
 */

/** Drum note map (GM-style). Drum clips store one note name per voice. */
export const DRUM_NOTES = {
  kick: 'C1',
  snare: 'D1',
  closedHat: 'F#1',
  openHat: 'A#1',
  cowbell: 'G#2',
  // Added later, on the General MIDI pads an octave down like the others
  clap: 'D#1',
  tomLow: 'F1',
  tomMid: 'B1',
  tomHigh: 'D2',
  crash: 'C#2',
  ride: 'D#2',
} as const;
