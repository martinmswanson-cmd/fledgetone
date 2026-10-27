/**
 * Feels measured from real music: for each part of a song (kick, snare or clap, hats, percussion,
 * bass, chords or keys, lead), how early or late each of the 16 steps of a bar plays (a share of a
 * 16th note, so it scales with the tempo) and how hard (a velocity scale). Measured from reference
 * recordings by the same analysis "Groove from audio" runs (grooveExtract.ts): the median of every
 * bar's hit on each step, kept only where it's clear; everything else plays on the grid at an even
 * velocity. Numbers only (no audio), named by feel.
 *
 * A clip's feel (ClipGroove.feel) plays through the clip schedule (scheduler.ts), live and in
 * exports alike: each note moves by its part's offset at its step, times the feel's Amount, and its
 * velocity scales the same way. A note off the 16th grid (a triplet, a 32nd) moves with the beat:
 * the offsets of the 8ths either side, blended, so a triplet run keeps its shape and only leans
 * the way the beat does. Pure, so Node tests it.
 */

import { isPlainMeter, measureAt, type MeterMap } from '../audio/tempoMap';

export type GrooveRole = 'kick' | 'snare' | 'hats' | 'perc' | 'bass' | 'chords' | 'lead';
export const GROOVE_ROLES: readonly GrooveRole[] = ['kick', 'snare', 'hats', 'perc', 'bass', 'chords', 'lead'];
export const GROOVE_ROLE_NAMES: Record<GrooveRole, string> = { kick: 'Kick', snare: 'Snare / clap', hats: 'Hats', perc: 'Percussion', bass: 'Bass', chords: 'Chords / keys', lead: 'Lead' };

/** One part's map: per 16th step of the bar, the offset (share of a 16th, late +) and the velocity scale. */
export interface GrooveMap {
  t: number[];
  v: number[];
}

/** A feel: per part, its map (a part left out plays as written). */
export interface GrooveFeel {
  id: string;
  name: string;
  about: string;
  /** What it was measured from, in plain words (the tempo and style, no names) */
  from: string;
  /** The tempo it was measured at */
  bpm: number;
  roles: Partial<Record<GrooveRole, GrooveMap>>;
}

/** A clip's feel: which one, how much of it (0 to 1), and the part its notes play (absent: from the track and the notes). */
export interface ClipFeel {
  id: string;
  amount: number;
  role?: GrooveRole;
  /** A feel taken from audio in this song (Groove from audio): carried in the clip, so it plays wherever the clip goes */
  user?: GrooveFeel;
}

/** How far a feel may move a note, a share of a 16th either way. */
export const MAX_FEEL_SHIFT = 0.4;

export const GROOVE_FEELS: readonly GrooveFeel[] = [
  {
    id: 'bassTight',
    name: 'Bass music, tight',
    about: 'Every part on the grid; the kick, bass and hats accented on the syncopated hits and soft on the ghost notes',
    from: 'two bass-music drops, 100 and 174 BPM',
    bpm: 137,
    roles: {
      kick: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.07, 0.94, 0.85, 1.07, 1.07, 1.07, 0.91, 1.07, 0.85, 1.07, 1.07, 0.92, 0.92, 1.07, 0.9, 0.85] },
      snare: { t: [0, 0, 0, 0, 0, 0, 0.009, 0, 0, 0, 0.009, 0, 0, 0, 0, 0], v: [0.91, 1, 0.85, 1, 1.07, 1, 0.77, 1, 0.85, 1.07, 0.89, 1, 1.07, 1, 0.94, 1] },
      hats: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.99, 1.07, 0.86, 0.93, 1.07, 1, 0.92, 0.92, 0.92, 1.07, 0.89, 0.85, 1.07, 0.94, 0.74, 1] },
      perc: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.07, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      bass: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.038, 0, 0, 0.067, 0, 0, 0], v: [0.99, 1.07, 1.07, 0.9, 1.15, 0.94, 0.85, 1, 0.85, 0.92, 1.07, 0.9, 1.15, 0.85, 0.96, 0.82] },
      chords: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.07, 1.07, 1.01, 0.89, 1.07, 0.88, 1.07, 1, 1, 1, 0.99, 1, 1.07, 0.86, 1, 1] },
      lead: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 0.89, 1, 0.85, 1, 0.88, 1, 0.85, 1, 1, 1, 0.94, 1, 0.92, 1, 0.94] },
    },
  },
  {
    id: 'rhythmGame',
    name: 'Four on the floor, tight',
    about: 'On the grid, with strong beats: loud kick and hats on the beat, the snare a hair late, the off-beats lighter',
    from: 'a 160 BPM four-on-the-floor drop',
    bpm: 160,
    roles: {
      kick: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.15, 1, 1, 1, 0.79, 1, 1, 1, 1.15, 1, 1, 1, 0.8, 1, 1, 1] },
      snare: { t: [0, 0, 0, 0, 0.016, 0, 0, 0, 0, 0, 0, 0, 0.019, 0, 0, 0], v: [1, 1, 0.77, 1, 1.15, 1, 0.81, 1, 1, 1, 0.75, 1, 1.15, 1, 0.81, 1] },
      hats: { t: [-0.019, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.044, 0, 0, -0.023, 0, 0], v: [1.15, 0.7, 0.86, 1.14, 1.15, 0.7, 0.82, 1.15, 1.15, 0.73, 0.85, 1.15, 1.15, 0.7, 0.79, 1] },
      perc: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1, 1, 1, 1, 0.7, 1, 1, 1, 1, 1, 1.15, 1, 1, 1, 1] },
      bass: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1.15, 1, 0.83, 1, 1.15, 0.87, 0.76, 1, 1.15, 0.78, 0.7, 1.15, 1.15, 0.77, 0.87] },
      chords: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 0.7, 1, 1, 1, 0.79, 1, 1, 1, 0.76, 0.78, 1, 1.13, 0.7, 1.15, 1.15] },
    },
  },
  {
    id: 'futureLaidBack',
    name: 'Future bass, laid back',
    about: 'The bass a little behind the kick on every beat, a lazy hat before the last beat, percussion late',
    from: 'a 125 BPM future-bass drop',
    bpm: 125,
    roles: {
      snare: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.88, 1, 1, 1, 1.15, 1, 1, 0.78, 1, 1, 1, 1, 1.15, 1, 1, 1] },
      hats: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.225, 0, 0], v: [1, 1, 1, 1, 1, 1, 1, 0.7, 1, 0.7, 1, 1, 1, 0.7, 1, 1] },
      perc: { t: [0, 0, 0, 0.319, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      bass: { t: [0.107, 0, 0, 0, 0, 0, 0, 0, 0.122, 0, 0, 0, 0.125, 0, 0, 0], v: [1.15, 1, 1, 1, 1.15, 1, 1, 1, 1.15, 1, 1, 1, 1.15, 1, 0.86, 0.88] },
      chords: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.15, 1, 1.13, 1, 0.85, 0.75, 1, 1, 1, 0.78, 0.88, 1.12, 1.14, 0.89, 1, 1] },
    },
  },
  {
    id: 'houseShuffle',
    name: 'House shuffle',
    about: 'The second 16th of every beat swung late on the hats, shaker and percussion; open hats loud on the off-beat',
    from: 'a 135 BPM house track',
    bpm: 135,
    roles: {
      kick: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.85, 1, 1, 1, 0.8, 1.15, 1, 1.15, 1, 1.15, 0.86, 1, 0.76, 1, 1.15, 1] },
      snare: { t: [0, 0.154, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.87, 0.79, 1, 1, 1.15, 1, 0.81, 1, 1, 1, 0.83, 1, 1.15, 1, 0.79, 1] },
      hats: { t: [0, 0.24, 0, 0, 0, 0.269, 0, 0, 0, 0.265, 0, 0, 0, 0.311, 0, 0], v: [0.89, 0.7, 1.15, 1, 1, 0.7, 1.15, 1, 0.7, 0.7, 1.15, 1, 1, 0.7, 1.15, 1] },
      perc: { t: [0, 0.159, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1.15, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
      bass: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.15, 1, 0.84, 1, 1.15, 1, 1, 1, 1.15, 1, 1, 1, 1.15, 1, 0.81, 1] },
      chords: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.15, 1, 1.15, 1, 1, 1, 1.12, 1, 1.15, 1, 1, 0.84, 1, 1, 1, 1] },
      lead: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1, 1, 0.84, 1, 1, 1, 1, 1, 1, 1, 0.76, 1, 1, 1, 1.15] },
    },
  },
  {
    id: 'hardcorePush',
    name: 'Hardcore push',
    about: 'The bass jumps ahead on the 16th after each beat, the lead rushes; drums tight, hats accented on the 8ths',
    from: 'a 163 BPM hardcore drop',
    bpm: 163,
    roles: {
      kick: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1.15, 1, 1, 1, 1, 1.15, 1, 1, 1, 1.15, 1, 1, 1, 1.15, 1] },
      snare: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -0.023, 0], v: [1, 1, 0.78, 1, 1, 1, 0.78, 1, 1, 1, 1, 1, 1, 1, 0.74, 1] },
      hats: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.15, 0.76, 1, 0.71, 1.15, 0.7, 1, 0.8, 1.15, 0.7, 1.15, 0.87, 1.15, 0.7, 1, 0.82] },
      bass: { t: [0, -0.128, 0, 0, 0, -0.129, 0, 0, 0, -0.128, 0, 0, 0, -0.093, 0, 0], v: [1, 1.15, 0.73, 1, 1, 1.15, 0.72, 1, 1, 1.15, 0.82, 1, 1, 1.15, 0.72, 1] },
      chords: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.85, 1, 1, 1, 1, 1, 1, 1.15, 1, 1, 1, 1, 1, 1, 0.87, 1] },
      lead: { t: [0, 0, 0, 0, 0, 0, -0.23, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1, 1, 1, 1, 1, 0.88, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    },
  },
  {
    id: 'artcoreBreathe',
    name: 'Artcore breathe',
    about: 'Hats a hair early on the 8ths and late on the 16ths between: a light, breathing swing at high tempo',
    from: 'a 175 BPM artcore track',
    bpm: 175,
    roles: {
      kick: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1, 0.76, 1, 1, 1, 1.15, 1, 1.15, 1, 1, 1, 1, 1, 1, 1] },
      hats: { t: [-0.027, 0.133, 0, 0.125, -0.05, 0, 0, 0, -0.062, 0, -0.027, 0.085, -0.047, 0.078, -0.036, 0], v: [1, 0.7, 0.83, 0.7, 1.15, 1, 1.15, 1, 1.15, 1, 1, 0.7, 1, 0.7, 1.15, 1] },
      bass: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.13, 1, 1, 1, 0.89, 1.13, 1, 0.88, 1, 1, 1, 0.81, 1, 1, 1, 1] },
      chords: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1.14, 1.15, 1, 1, 1, 1, 1, 1, 0.82, 0.76, 0.84, 1, 1, 1.13, 1] },
    },
  },
  {
    id: 'artcoreBounce',
    name: 'Artcore bounce',
    about: 'Every off-beat 16th hat swung about a fifth late, percussion late on the one: a bouncing 16th swing',
    from: 'a 128 BPM artcore drop',
    bpm: 128,
    roles: {
      kick: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.81, 1.15, 1, 1, 0.82, 1.15, 1, 1, 0.76, 1.15, 1, 1, 0.83, 1.15, 1.15, 1] },
      snare: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.247], v: [1, 1, 1, 1, 1, 0.82, 0.87, 1, 1, 1, 0.82, 1, 1, 1, 1, 1] },
      hats: { t: [0, 0.199, 0, 0, 0, 0.203, 0, 0.222, 0, 0.211, 0, 0.22, 0, 0.206, 0, 0.2], v: [0.86, 1, 1.15, 1, 0.84, 1, 1.15, 1, 1, 1, 1.15, 1, 0.86, 1, 1.12, 1.15] },
      perc: { t: [0.194, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.78, 1, 1, 1, 1, 1, 1, 1.15, 1, 1, 1, 1, 1, 0.89, 1, 1] },
      bass: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 1, 1.15, 0.78, 1.15, 1, 1, 0.7, 0.73, 1, 0.82, 0.7, 1.15, 1, 1, 1] },
      chords: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.14, 1, 1.15, 0.86, 1.15, 0.83, 1, 0.89, 0.88, 1, 1, 0.73, 1.15, 1.15, 1, 1.13] },
      lead: { t: [0, 0, 0, 0, -0.016, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1, 0.74, 1, 1, 1.15, 0.88, 1, 1, 1, 0.8, 0.84, 1, 1, 0.88, 1, 1] },
    },
  },
  {
    id: 'darksynthDrive',
    name: 'Synthwave drive',
    about: 'Straight and driving; a late ghost snare before the backbeat and late percussion, strong beats',
    from: 'a 131 BPM dark synthwave drop',
    bpm: 131,
    roles: {
      kick: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.15, 1, 1.13, 1, 0.74, 1, 1, 1, 1.15, 1, 1.15, 0.85, 0.79, 1, 1, 1] },
      snare: { t: [0, 0, 0.114, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.015, 0, 0, 0], v: [1.15, 1, 0.83, 1, 1.15, 1, 1, 1, 1.15, 1, 1, 0.87, 1.15, 1, 1, 1] },
      hats: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.15, 0.75, 0.73, 1, 1.15, 0.75, 1.15, 1, 1, 0.76, 0.7, 1, 1.15, 1, 1, 1] },
      perc: { t: [0, 0, 0, 0, 0, 0.142, 0, 0, 0.292, 0, 0, 0, 0, 0, 0, 0], v: [0.7, 1, 1, 1, 1, 1.12, 1, 1, 0.7, 0.88, 1, 1, 1, 1.15, 1.14, 1] },
      bass: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [1.15, 0.75, 0.87, 1, 1.15, 1, 1, 1.15, 1.15, 1, 1, 1, 1.15, 1, 1, 1] },
      chords: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.75, 1, 1, 1.14, 0.83, 1, 1, 1, 0.86, 1, 1, 1, 1.15, 0.81, 1.15, 1] },
      lead: { t: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], v: [0.7, 1, 1, 1, 0.7, 0.89, 1, 1, 1, 1, 1, 1, 0.7, 1, 1, 1] },
    },
  },
];

export const grooveFeelById = (id: string): GrooveFeel | undefined => GROOVE_FEELS.find((f) => f.id === id);

/** The feel a clip's feel plays: its own (from audio) or the built-in one. */
export const feelOf = (f: ClipFeel | undefined): GrooveFeel | undefined => (f ? (f.user && f.user.id === f.id ? f.user : grooveFeelById(f.id)) : undefined);

/**
 * The part a drum note plays, by the kits' note map (DRUM_NOTES): the kick, the snare and clap,
 * the hats and cymbals, the rest percussion (toms, cowbell, shakers).
 */
export function drumRoleOf(note: string): GrooveRole {
  if (note === 'C1' || note === 'B0') return 'kick';
  if (note === 'D1' || note === 'D#1' || note === 'E1') return 'snare';
  if (note === 'F#1' || note === 'G#1' || note === 'A#1' || note === 'D#2' || note === 'C#2' || note === 'F2' || note === 'A2' || note === 'B2') return 'hats';
  return 'perc';
}

/**
 * The part a Drum Rack pad plays, by its name (its pads are your own sounds, not the kits' note
 * map): a kick, a snare, clap or rim, a hat or cymbal; anything else percussion.
 */
export function padRoleOf(name: string | undefined): GrooveRole {
  const n = (name ?? '').toLowerCase();
  if (/kick|\bkik\b|\bbd\b|bass ?drum/.test(n)) return 'kick';
  if (/snare|clap|\brim|\bsd\b|snap/.test(n)) return 'snare';
  if (/hat|\bhh\b|\b[oc]h\b|cymbal|ride|crash|splash/.test(n)) return 'hats';
  return 'perc';
}

/**
 * Where a note at `bar` sits in its measure, in 16ths, for a feel's 16 steps (mapAt wraps a longer
 * measure). Counted from the measure's start in the song's meter, so in 3/4 every downbeat reads
 * step 0; in plain 4/4, from the bar line as always.
 */
export function feelPos(bar: number, meter: MeterMap): number {
  if (isPlainMeter(meter)) return (bar - Math.floor(bar + 1e-9)) * 16;
  return (bar - measureAt(bar, meter).start) * 16;
}

/** `map` with its steps moved `k` 16ths later round the bar (a map measured from a clip that starts `k` 16ths into the bar). */
export function rotateMap(map: GrooveMap, k: number): GrooveMap {
  const r = ((Math.round(k) % 16) + 16) % 16;
  if (!r) return map;
  const turn = (a: number[]) => a.map((_, s) => a[(s - r + 16) % 16]);
  return { t: turn(map.t), v: turn(map.v) };
}

/**
 * The maps of a groove measured from a clip that starts at `startBar` (its start taken as step 0)
 * turned to the song's bars: a loop that starts on beat 3 has its first hit on step 8.
 */
export function rolesAtClipStart(roles: Partial<Record<GrooveRole, GrooveMap>>, startBar: number, meter: MeterMap): Partial<Record<GrooveRole, GrooveMap>> {
  const k = Math.round(feelPos(startBar, meter));
  const out: Partial<Record<GrooveRole, GrooveMap>> = {};
  for (const r of GROOVE_ROLES) if (roles[r]) out[r] = rotateMap(roles[r]!, k);
  return out;
}

/**
 * The part a melodic clip plays: the bass for a bass track, else chords when at least a third of
 * its note starts hold two or more notes, else the lead.
 */
export function melodicRoleOf(trackRole: string, notes: ReadonlyArray<{ startOffset: number }>): GrooveRole {
  if (trackRole === 'bass') return 'bass';
  const starts = new Map<number, number>();
  for (const n of notes) {
    const k = Math.round(n.startOffset * 768);
    starts.set(k, (starts.get(k) ?? 0) + 1);
  }
  if (!starts.size) return 'lead';
  const chords = [...starts.values()].filter((c) => c > 1).length;
  return chords * 3 >= starts.size ? 'chords' : 'lead';
}

/**
 * What a map does to a note `pos` 16ths into its bar (0 to 16): its offset (a share of a 16th) and
 * velocity scale, at full amount. On a 16th line (within a 12th of a 16th): that step's. Off the
 * grid: the 8th lines either side, blended by distance, and an even velocity.
 */
export function mapAt(map: GrooveMap, pos: number): { shift: number; vel: number } {
  const p = ((pos % 16) + 16) % 16;
  const k = Math.round(p);
  if (Math.abs(p - k) < 1 / 12) {
    const s = k % 16;
    return { shift: map.t[s] ?? 0, vel: map.v[s] ?? 1 };
  }
  const a = Math.floor(p / 2) * 2;
  const f = (p - a) / 2;
  return { shift: (map.t[a % 16] ?? 0) * (1 - f) + (map.t[(a + 2) % 16] ?? 0) * f, vel: 1 };
}

/**
 * What a clip's feel does to one note: its shift (a share of a 16th, late +) and velocity scale,
 * scaled by the feel's Amount. `pos` is the note's place in its bar in 16ths, `role` its part.
 */
export function feelNote(feel: GrooveFeel | undefined, amount: number, role: GrooveRole, pos: number): { shift: number; vel: number } {
  const map = feel?.roles[role];
  const a = Math.max(0, Math.min(1, amount));
  if (!map || !a) return { shift: 0, vel: 1 };
  const at = mapAt(map, pos);
  const shift = Math.max(-MAX_FEEL_SHIFT, Math.min(MAX_FEEL_SHIFT, at.shift * a));
  return { shift: Math.round(shift * 10000) / 10000, vel: 1 + (at.vel - 1) * a };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 16 numbers held to lo..hi, or undefined. */
const nums = (v: unknown, lo: number, hi: number): number[] | undefined =>
  Array.isArray(v) && v.length === 16 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? v.map((x: number) => Math.max(lo, Math.min(hi, x))) : undefined;

/** A part's map from a file, or undefined. */
export function normalizeGrooveMap(v: unknown): GrooveMap | undefined {
  if (!isObj(v)) return undefined;
  const t = nums(v.t, -MAX_FEEL_SHIFT, MAX_FEEL_SHIFT);
  const vel = nums(v.v, 0.5, 1.5);
  return t && vel ? { t, v: vel } : undefined;
}

/** A feel taken from audio, from a file, or undefined. */
export function normalizeUserFeel(v: unknown): GrooveFeel | undefined {
  if (!isObj(v) || typeof v.id !== 'string' || !/^user-[\w-]{1,40}$/.test(v.id)) return undefined;
  const roles: Partial<Record<GrooveRole, GrooveMap>> = {};
  if (isObj(v.roles)) for (const r of GROOVE_ROLES) {
    const m = normalizeGrooveMap(v.roles[r]);
    if (m) roles[r] = m;
  }
  const bpm = typeof v.bpm === 'number' && Number.isFinite(v.bpm) ? Math.max(20, Math.min(400, v.bpm)) : 120;
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 60) : 'Groove from audio';
  return { id: v.id, name, about: typeof v.about === 'string' ? v.about.slice(0, 200) : '', from: typeof v.from === 'string' ? v.from.slice(0, 120) : '', bpm, roles };
}

/** A clip's feel from a file, or undefined (an unknown built-in, a broken one from audio). */
export function normalizeClipFeel(v: unknown): ClipFeel | undefined {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.amount !== 'number' || !Number.isFinite(v.amount)) return undefined;
  const user = v.user !== undefined ? normalizeUserFeel(v.user) : undefined;
  if (user ? user.id !== v.id : !grooveFeelById(v.id)) return undefined;
  const role = typeof v.role === 'string' && (GROOVE_ROLES as readonly string[]).includes(v.role) ? (v.role as GrooveRole) : undefined;
  return { id: v.id, amount: Math.max(0, Math.min(1, v.amount)), ...(role ? { role } : {}), ...(user ? { user } : {}) };
}

/** The feels taken from audio that a song's clips carry (each once), for picking again. */
export function userFeelsIn(clips: ReadonlyArray<{ groove?: { feel?: ClipFeel } }>): GrooveFeel[] {
  const seen = new Map<string, GrooveFeel>();
  for (const c of clips) {
    const u = c.groove?.feel?.user;
    if (u && !seen.has(u.id)) seen.set(u.id, u);
  }
  return [...seen.values()];
}
