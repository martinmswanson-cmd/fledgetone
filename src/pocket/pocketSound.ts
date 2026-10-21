/**
 * What Pocket's pads and grids play: the drum kit's sounds in pad order (or a Drum Rack's own 16
 * pads), and audition (a note through a track as it sounds in the song, starting the audio on the
 * first tap).
 */
import { DRUM_NOTES } from '../audio/instruments';
import { initAudio, rawAudioState } from '../audio/engine';
import { previewTrackNotes } from '../audio/liveTracks';
import { defaultRack, padNote } from '../store/sampleKits';
import type { Track } from '../store/timelineTypes';
import { isRackKey } from './pocketStore';

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

/** A pad as the drawer shows it: its note, name and colour; a Drum Rack's pad also its number, and whether it's empty. */
export interface PocketPad {
  note: string;
  label: string;
  color: string;
  /** A Drum Rack's pad number (0 to 15) */
  index?: number;
  empty?: boolean;
}

/** Colours for a Drum Rack's pads, a row of four at a time. */
const RACK_COLORS = ['#f59e0b', '#ef4444', '#ec4899', '#22d3ee', '#38bdf8', '#a78bfa', '#8b5cf6', '#facc15', '#a3e635', '#fb923c', '#34d399', '#f472b6', '#60a5fa', '#fbbf24', '#c084fc', '#2dd4bf'];

/** A track's pads: a Drum Rack's 16 (pad 1 on C2, see sampleKits.ts), else the kit's. */
export function padsOf(track: Pick<Track, 'instrumentKey' | 'rack'>): PocketPad[] {
  if (!isRackKey(track.instrumentKey)) return DRUM_PADS;
  return (track.rack ?? defaultRack()).pads.map((p, i) => ({ note: padNote(i), label: p.soundId ? p.name : 'Empty', color: RACK_COLORS[i % RACK_COLORS.length], index: i, ...(p.soundId ? {} : { empty: true }) }));
}

/** Play notes through a track as it sounds in the song (starting the audio if it isn't running: the first tap, or back from the background). */
export async function audition(trackId: string, note: string, velocity = 0.85): Promise<void> {
  if (rawAudioState() !== 'running') await initAudio();
  previewTrackNotes(trackId, [{ note, duration: '16n', velocity }]);
}

