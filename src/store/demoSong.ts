import { DRUM_NOTES } from '../audio/scheduler';
import { compatibleInstruments } from '../audio/instrumentCatalog';
import type { ProjectSnapshot } from './project';
import type { Clip, InstrumentKey, NoteEvent, Track } from './timelineTypes';
import { DEFAULT_MASTER_FX, defaultTrackFx, uid } from './timelineTypes';

/**
 * Default tracks, plus the "Sunset Stroll" demo: a mellow neo-soul groove in C major
 * (Fmaj9 - Em7 - Dm9 - G13) at 88 BPM. Its parts double as the stock patterns offered
 * by "Insert pattern" on an empty lane. Steps are 16th notes: offset = step / 16 bars.
 */

export const INITIAL_TRACKS: Track[] = [
  {
    id: 'track-drums',
    name: 'Drums',
    color: '#f59e0b',
    instrumentKey: 'drums',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    pan: 0,
    eq: { low: 0, mid: 0, high: 0 },
    fx: defaultTrackFx(),
    reverbSend: 0.1,
    delaySend: 0,
  },
  {
    id: 'track-bass',
    name: 'Slap Bass',
    color: '#06b6d4',
    instrumentKey: 'bass',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    pan: 0,
    eq: { low: 1.5, mid: -1.0, high: 0.5 },
    fx: defaultTrackFx(),
    reverbSend: 0,
    delaySend: 0,
  },
  {
    id: 'track-keys',
    name: 'Space Clav',
    color: '#a855f7',
    instrumentKey: 'keys',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: -1,
    pan: -0.15,
    eq: { low: -1.0, mid: 0.5, high: 2.0 },
    fx: defaultTrackFx(),
    reverbSend: 0.35,
    delaySend: 0.25,
  },
  {
    id: 'track-brass',
    name: 'Brass Stabs',
    color: '#22c55e',
    instrumentKey: 'brass',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: -2,
    pan: 0.2,
    eq: { low: -2.0, mid: 1.5, high: 1.0 },
    fx: defaultTrackFx(),
    reverbSend: 0.4,
    delaySend: 0.2,
  },
];

/** [step, note(s), velocity, duration] */
type Step = [step: number, notes: string | string[], velocity: number, duration?: string];

function toNotes(steps: Step[]): NoteEvent[] {
  return steps.flatMap(([step, notes, velocity, duration = '16n']) =>
    (Array.isArray(notes) ? notes : [notes]).map((note) => ({
      id: uid('note'),
      note,
      startOffset: step / 16,
      duration,
      velocity,
    }))
  );
}

/** Repeat a one-bar step list across `bars` bars. */
function everyBar(bars: number, bar: (b: number) => Step[]): Step[] {
  return Array.from({ length: bars }, (_, b) => bar(b).map(([s, n, v, d]): Step => [s + b * 16, n, v, d])).flat();
}

// ---------- Drums ----------

function lazyBeat(): Step[] {
  return everyBar(4, (b) => {
    const steps: Step[] = [
      [0, DRUM_NOTES.kick, 0.95],
      [7, DRUM_NOTES.kick, 0.7],
      [10, DRUM_NOTES.kick, 0.85],
      [4, DRUM_NOTES.snare, 0.9],
      [12, DRUM_NOTES.snare, 0.9],
    ];
    if (b === 3) steps.push([13, DRUM_NOTES.kick, 0.75]);
    if (b % 2 === 1) steps.push([15, DRUM_NOTES.snare, 0.3]); // ghost into the next bar
    for (let s = 0; s < 16; s += 2) {
      if (b === 3 && s === 14) steps.push([s, DRUM_NOTES.openHat, 0.6]);
      else steps.push([s, DRUM_NOTES.closedHat, s % 4 === 0 ? 0.7 : 0.5]);
    }
    return steps;
  });
}

function hatsIntro(): Step[] {
  return everyBar(4, (b) => {
    const steps: Step[] = [];
    for (let s = 0; s < 16; s += 2) {
      if (b === 3 && s === 14) steps.push([s, DRUM_NOTES.openHat, 0.45]);
      else steps.push([s, DRUM_NOTES.closedHat, s % 4 === 0 ? 0.5 : 0.35]);
    }
    steps.push([12, DRUM_NOTES.snare, 0.3]);
    return steps;
  });
}

// ---------- Bass ----------

const BASS_WALK: Step[] = [
  // Fmaj9
  [0, 'F1', 0.9, '8n'], [6, 'F1', 0.6], [8, 'C2', 0.8, '8n'], [11, 'F1', 0.7, '8n'], [14, 'E1', 0.75, '8n'],
  // Em7
  [16, 'E1', 0.9, '8n'], [22, 'E1', 0.6], [24, 'B1', 0.8, '8n'], [27, 'E1', 0.7, '8n'], [30, 'D1', 0.75, '8n'],
  // Dm9
  [32, 'D1', 0.9, '8n'], [38, 'D1', 0.6], [40, 'A1', 0.8, '8n'], [43, 'D2', 0.7, '8n'], [46, 'C2', 0.75, '8n'],
  // G13
  [48, 'G1', 0.9, '8n'], [54, 'G1', 0.6], [56, 'D2', 0.8, '8n'], [59, 'A1', 0.7, '8n'], [61, 'B1', 0.75, '8n'],
];

// ---------- Keys ----------

const FMAJ9 = ['F3', 'A3', 'C4', 'E4', 'G4'];
const EM7 = ['E3', 'B3', 'D4', 'G4'];
const DM9 = ['D3', 'F3', 'A3', 'C4', 'E4'];
const G13 = ['G2', 'F3', 'B3', 'E4'];

const KEYS_CHORDS: Step[] = everyBar(4, (b) => {
  const chord = [FMAJ9, EM7, DM9, G13][b];
  return [
    [0, chord, 0.7, '4n'],
    [6, chord, 0.5, '8n'],
    [10, chord, 0.6, '8n'],
  ];
});

// ---------- Brass ----------

const HORN_HOOK: Step[] = [
  [0, ['A4', 'C5'], 0.8, '8n'], [3, ['A4', 'C5'], 0.7], [6, ['C5', 'E5'], 0.85, '8n'],
  [16, ['B4', 'D5'], 0.8, '4n'], [24, ['G4', 'B4'], 0.7, '8n'],
  [32, ['A4', 'C5'], 0.8, '8n'], [35, ['A4', 'C5'], 0.7], [38, ['C5', 'F5'], 0.85, '8n'],
  [48, ['B4', 'D5'], 0.85, '8n'], [52, ['D5', 'G5'], 0.9, '4n'],
];

// ---------- Pattern library ----------

interface Pattern {
  id: string;
  name: string;
  instrument: InstrumentKey;
  lengthBars: number;
  steps: () => Step[];
}

const PATTERNS: Pattern[] = [
  { id: 'lazy-beat', name: 'Lazy Beat', instrument: 'drums', lengthBars: 4, steps: lazyBeat },
  { id: 'hats-intro', name: 'Hats Intro', instrument: 'drums', lengthBars: 4, steps: hatsIntro },
  { id: 'bass-walk', name: 'Walking Bass', instrument: 'bass', lengthBars: 4, steps: () => BASS_WALK },
  { id: 'keys-chords', name: 'Soul Chords', instrument: 'keys', lengthBars: 4, steps: () => KEYS_CHORDS },
  { id: 'horn-hook', name: 'Horn Hook', instrument: 'brass', lengthBars: 4, steps: () => HORN_HOOK },
];

export interface PatternInfo {
  id: string;
  name: string;
  lengthBars: number;
}

/** Stock patterns available for an instrument, for "Insert pattern". */
export function patternsFor(instrument: InstrumentKey): PatternInfo[] {
  // Drum patterns work on any drum kit (they share the drum note map)
  return PATTERNS.filter((p) => compatibleInstruments(p.instrument, instrument)).map(({ id, name, lengthBars }) => ({ id, name, lengthBars }));
}

export function createPatternClip(track: Track, patternId: string, startBar: number): Clip | null {
  const p = PATTERNS.find((x) => x.id === patternId && compatibleInstruments(x.instrument, track.instrumentKey));
  if (!p) return null;
  return {
    id: uid('clip'),
    trackId: track.id,
    name: p.name,
    startBar,
    lengthBars: p.lengthBars,
    notes: toNotes(p.steps()),
    isSelected: false,
  };
}

// ---------- Demo song ----------

/** "Sunset Stroll": intro (keys + hats), groove (drums + bass enter), hook (horns join). */
export function createDemoProject(): ProjectSnapshot {
  const tracks = INITIAL_TRACKS.map((t) => ({ ...t }));
  const byKey = (k: InstrumentKey) => tracks.find((t) => t.instrumentKey === k)!;
  const place: Array<[InstrumentKey, string, number]> = [
    ['keys', 'keys-chords', 1],
    ['keys', 'keys-chords', 5],
    ['keys', 'keys-chords', 9],
    ['drums', 'hats-intro', 1],
    ['drums', 'lazy-beat', 5],
    ['drums', 'lazy-beat', 9],
    ['bass', 'bass-walk', 5],
    ['bass', 'bass-walk', 9],
    ['brass', 'horn-hook', 9],
  ];
  return {
    name: 'Sunset Stroll',
    bpm: 88,
    swing: 0.15,
    loopRegion: { inBar: 1, outBar: 13, enabled: true },
    masterFx: DEFAULT_MASTER_FX,
    tracks,
    clips: place.map(([k, id, bar]) => createPatternClip(byKey(k), id, bar)!),
  };
}
