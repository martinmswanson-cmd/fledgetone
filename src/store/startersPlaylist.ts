import { FX_NOTES } from '../audio/instrumentCatalog';
import type { ProjectSnapshot } from './project';
import { everyBar } from './demoSong';
import type { Step } from './demoSong';
import { midiOf, nameOf } from './noteTools';
import { barsToDuration } from './timelineTypes';
import { clip, D, master, progression, project, snareRoll, track } from './starterKit';

/**
 * More genre starters, for the styles of the owner's playlist: artcore boss fights, bass music,
 * internet rap and phonk, bedroom pop and jazz-pop, theatrical pop and two band styles. Melodies
 * are written for these starters (not copied from any song); progressions, tempos and grooves
 * follow each style's conventions.
 *
 * Kept gentle on the ears: kicks below full velocity, no sub drops, soft impacts, distortion on
 * one track at most, and builds that get quieter before a drop rather than louder drops.
 */

/** A length in 16ths as a note duration. */
const dur = (sixteenths: number) => barsToDuration(sixteenths / 16);

const VEL: Record<string, number> = { X: 0.9, x: 0.6, o: 0.45, g: 0.28 };

/**
 * Drum rows written as grids, one character per 16th (X loud, x medium, o soft, g ghost, . rest),
 * any length. Kicks are scaled by `kick` (kept under full velocity).
 */
function beat(rows: Array<[note: string, pattern: string]>, kick = 0.85): Step[] {
  return rows.flatMap(([note, pattern]) =>
    [...pattern.replace(/\s/g, '')].flatMap((c, i): Step[] => (VEL[c] ? [[i, note, VEL[c] * (note === D.kick ? kick : 1)]] : []))
  );
}

/** Every note `semitones` up (down if negative). */
const up = (steps: Step[], semitones: number): Step[] =>
  steps.map(([s, n, v, d]): Step => [s, Array.isArray(n) ? n.map((x) => nameOf(midiOf(x) + semitones)) : nameOf(midiOf(n) + semitones), v, d]);

/** Moved later by `by` 16ths. */
const later = (steps: Step[], by: number): Step[] => steps.map(([s, n, v, d]): Step => [s + by, n, v, d]);

/** A melody: [step, note, length in 16ths], a little louder on the beats. */
const melody = (notes: Array<[number, string, number]>, vel = 0.8): Step[] =>
  notes.map(([s, n, len]): Step => [s, n, s % 4 === 0 ? vel : vel * 0.9, dur(len)]);

/** Each note doubled an octave below (a piano octave lead) or above. */
const octaves = (steps: Step[], dir = -1): Step[] =>
  steps.map(([s, n, v, d]): Step => [s, (Array.isArray(n) ? n : [n]).flatMap((x) => [x, nameOf(midiOf(x) + 12 * dir)]), v, d]);

/** A 32nd-note roll on `note` from step `from` to `to`, getting louder. */
const roll32 = (note: string, from: number, to: number, v0 = 0.35, v1 = 0.85): Step[] => {
  const n = (to - from) * 2;
  return Array.from({ length: n }, (_, i): Step => [from + i / 2, note, v0 + ((v1 - v0) * i) / Math.max(1, n - 1), '32n']);
};

/** One chord per bar, played at `steps` of each bar. */
const stabs = (chords: string[][], steps: number[], len: number, vel = 0.7): Step[] =>
  everyBar(chords.length, (b) => steps.map((s): Step => [s, chords[b], s === steps[0] ? vel : vel * 0.85, dur(len)]));

/** One root per bar, played at `steps` of each bar. */
const pulse = (notes: string[], steps: number[], len: number, vel = 0.8): Step[] =>
  everyBar(notes.length, (b) => steps.map((s): Step => [s, notes[b], s === steps[0] ? vel : vel * 0.85, dur(len)]));

/** Each bar's notes one after another, `every` 16ths apart, each lasting `len`. */
const broken = (bars: string[][], every: number, len: number, vel = 0.65): Step[] =>
  everyBar(bars.length, (b) => bars[b].map((n, i): Step => [i * every, n, i === 0 ? vel + 0.1 : vel, dur(len)]));

/** A riser and noise sweep over `bars`, with a reverse crash into the next downbeat. */
const softBuild = (bars: number): Step[] => [
  [0, FX_NOTES.riser, 0.7, `${bars}:0:0`],
  [0, FX_NOTES.noiseSweep, 0.45, `${bars}:0:0`],
  [(bars - 1) * 16, FX_NOTES.reverseCrash, 0.75, '1n'],
];

/** A soft impact on the drop and a downlifter after it (no sub drop: kind to the ears). */
const softHit: Step[] = [[0, FX_NOTES.impact, 0.45], [16, FX_NOTES.downlifter, 0.45, '1n']];

/** A snare roll with the last beat left silent before the drop. */
const rollWithGap = snareRoll.filter(([s]) => s < 60);

/** The Amen-style break rebuilt from single hits, two bars; `fill` ends bar 2 with a 32nd roll. */
const amen = (fill = false): Step[] => [
  ...beat([[D.kick, 'X.X.......XX....'], [D.snare, '...gX.gX.X..Xg.X'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8),
  ...later(
    fill
      ? [...beat([[D.kick, 'X.X.......X.....'], [D.snare, '...gX.gX.X.g....'], [D.closedHat, 'x.x.x.x.x.x.....']], 0.8), ...roll32(D.snare, 12, 16, 0.4, 0.85)]
      : beat([[D.kick, 'X.X.......X.....'], [D.snare, '...gX.gX.X.g.gX.'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8),
    16
  ),
];

/** Notes of a scale run, 32nds, rising in velocity (a harp gliss). */
const gliss = (notes: string[], from: number): Step[] => notes.map((n, i): Step => [from + i / 2, n, 0.4 + (0.4 * i) / notes.length, '8n']);

// ---------- Artcore: final boss ----------

function artcore(): ProjectSnapshot {
  const piano = track('Piano', 'piano', { volume: 0, reverbSend: 0.3, delaySend: 0.08 });
  const violin = track('Violin', 'violin', { volume: -5, reverbSend: 0.35 });
  const cello = track('Cello', 'cello', { volume: -5, reverbSend: 0.3 });
  const choir = track('Choir', 'choir', { volume: -11, reverbSend: 0.45, fx: { pump: { on: true, depth: 0.25, release: 200, trigger: 'beat' } } });
  const saw = track('Supersaw', 'supersaw', { volume: -4, reverbSend: 0.2, fx: { pump: { on: true, depth: 0.45, release: 160, trigger: 'kick' } } });
  const reese = track('Reese', 'reeseBass', { volume: -6, eq: { low: -3, mid: 0, high: -6 }, fx: { filter: { on: true, cutoff: 900 } } });
  const drums = track('Breaks', 'breakbeatKit', { volume: -2, reverbSend: 0.08 });
  const taiko = track('Taiko', 'taiko', { volume: -4, reverbSend: 0.2 });
  const harp = track('Harp', 'harp', { volume: -6, reverbSend: 0.4 });
  const chimes = track('Chimes', 'chimes', { volume: -12, reverbSend: 0.5 });
  const sfx = track('FX', 'fx', { volume: -9, reverbSend: 0.3 });

  // Intro: Dm - Bb - Gm - A, the left hand in whole-note octaves under a slow fragment
  const introLeft = progression([['D2', 'D3'], ['A#1', 'A#2'], ['G1', 'G2'], ['A1', 'A2']], 16, '1n', 0.55);
  const introRight = melody(
    [[0, 'A4', 4], [4, 'D5', 4], [8, 'E5', 4], [12, 'F5', 4], [16, 'F5', 6], [22, 'E5', 2], [24, 'D5', 8], [32, 'D5', 4], [36, 'G5', 4], [40, 'F5', 4], [44, 'D5', 4], [48, 'E5', 8], [56, 'C#5', 8]],
    0.6
  );
  // Build: Bbmaj7 - C/E - Asus4 - A, broken in 8ths, the harp sweeping up into the drop
  const buildArp = broken(
    [['A#2', 'F3', 'A3', 'D4', 'F4', 'A4', 'D4', 'A3'], ['E2', 'G3', 'C4', 'E4', 'G4', 'C5', 'G4', 'E4'], ['A2', 'E3', 'A3', 'D4', 'E4', 'A4', 'E4', 'D4'], ['A2', 'E3', 'A3', 'C#4', 'E4', 'A4', 'E4', 'C#4']],
    2,
    3,
    0.6
  );
  const buildCello = progression(['A#2', 'E2', 'A2', 'A2'], 16, '1n', 0.65);
  const buildChoir = progression([['D4', 'F4', 'A4'], ['E4', 'G4', 'C5'], ['D4', 'E4', 'A4'], ['C#4', 'E4', 'A4']], 16, '1n', 0.55);
  const harpGliss = gliss(['D4', 'E4', 'F4', 'G4', 'A4', 'A#4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'A#5', 'C6', 'D6', 'E6'], 56);

  // Drop: Dm - Bb - F - C. The tune in octaves on the piano, doubled by the violin
  const tune = melody(
    [
      [0, 'A5', 2], [2, 'F5', 2], [4, 'D5', 2], [6, 'E5', 1], [7, 'F5', 1], [8, 'A5', 4], [12, 'G5', 2], [14, 'F5', 2],
      [16, 'F5', 2], [18, 'D5', 2], [20, 'A#4', 2], [22, 'C5', 1], [23, 'D5', 1], [24, 'F5', 4], [28, 'E5', 2], [30, 'D5', 2],
      [32, 'C6', 2], [34, 'A5', 2], [36, 'F5', 2], [38, 'G5', 1], [39, 'A5', 1], [40, 'C6', 4], [44, 'A#5', 2], [46, 'A5', 2],
      [48, 'G5', 4], [52, 'E5', 2], [54, 'F5', 2], [56, 'G5', 6], [62, 'E5', 2],
    ],
    0.85
  );
  const roots = [['D2', 'D3'], ['A#1', 'A#2'], ['F2', 'F3'], ['C2', 'C3']];
  const left = everyBar(4, (b): Step[] => [[0, roots[b], 0.7, '4n'], [8, roots[b], 0.6, '4n']]);
  const dropPiano = [...octaves(tune), ...left];
  const sawStabs = stabs([['D4', 'F4', 'A4'], ['D4', 'F4', 'A#4'], ['C4', 'F4', 'A4'], ['C4', 'E4', 'G4']], [2, 6, 10, 14], 1, 0.7);
  const bassRoots = ['D2', 'A#1', 'F1', 'C2'];
  const reeseLine = everyBar(4, (b): Step[] => [[0, bassRoots[b], 0.85, '4n'], [6, bassRoots[b], 0.7, '8n'], [10, bassRoots[b], 0.7, '8n'], [12, nameOf(midiOf(bassRoots[b]) + 12), 0.75, '4n']]);
  const dropChoir = progression([['D4', 'F4', 'A4'], ['D4', 'F4', 'A#4'], ['C4', 'F4', 'A4'], ['C4', 'E4', 'G4']], 16, '1n', 0.5);
  const dropDrums = [[0, D.crash, 0.55] as Step, ...amen(), ...later(amen(true), 32)];
  const taikoHits: Step[] = [[0, 'D2', 0.85], [8, 'A2', 0.7], [60, 'D2', 0.7], [62, 'A2', 0.75]];

  return project(
    'Final Boss Artcore starter',
    174,
    0,
    [9, 17],
    [piano, violin, cello, choir, saw, reese, drums, taiko, harp, chimes, sfx],
    [
      clip(piano, 'Intro', 1, 4, [...introLeft, ...introRight]),
      clip(chimes, 'Chime', 1, 1, [[0, 'D5', 0.5, '1n']]),
      clip(piano, 'Lift', 5, 4, buildArp),
      clip(cello, 'Lift', 5, 4, buildCello),
      clip(choir, 'Lift', 5, 4, buildChoir),
      clip(drums, 'Snare ladder', 5, 4, rollWithGap),
      clip(taiko, 'Build', 5, 4, everyBar(4, (): Step[] => [[0, 'D2', 0.65], [8, 'D2', 0.55]])),
      clip(harp, 'Gliss', 5, 4, harpGliss),
      clip(sfx, 'Build-up', 5, 4, softBuild(4)),
      clip(piano, 'Drop', 9, 4, dropPiano),
      clip(violin, 'Drop', 9, 4, tune.map(([s, n, v, d]): Step => [s, n, v * 0.9, d])),
      clip(saw, 'Stabs', 9, 4, sawStabs),
      clip(reese, 'Reese', 9, 4, reeseLine),
      clip(choir, 'Drop', 9, 4, dropChoir),
      clip(drums, 'Breaks', 9, 4, dropDrums),
      clip(taiko, 'Hits', 9, 4, taikoHits),
      clip(chimes, 'Chime', 9, 1, [[0, 'D5', 0.6, '1n']]),
      clip(sfx, 'Hit', 9, 2, softHit),
      // The last drop a whole step up: the same parts in E minor
      clip(piano, 'Drop (E minor)', 13, 4, up(dropPiano, 2)),
      clip(violin, 'Drop (E minor)', 13, 4, up(tune, 2)),
      clip(saw, 'Stabs', 13, 4, up(sawStabs, 2)),
      clip(reese, 'Reese', 13, 4, up(reeseLine, 2)),
      clip(choir, 'Drop', 13, 4, up(dropChoir, 2)),
      clip(drums, 'Breaks', 13, 4, dropDrums),
      clip(taiko, 'Hits', 13, 4, taikoHits),
      clip(chimes, 'Chime', 13, 1, [[0, 'E5', 0.6, '1n']]),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop'], [13, 'Key change']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.15 })
  );
}

// ---------- Melodic hardcore (rhythm-game piano) ----------

function hardcore(): ProjectSnapshot {
  const piano = track('Piano', 'piano', { volume: 0, reverbSend: 0.25 });
  const violin = track('Violin', 'violin', { volume: -5, reverbSend: 0.3 });
  const cello = track('Cello', 'cello', { volume: -6, reverbSend: 0.3 });
  const saw = track('Supersaw', 'supersaw', { volume: -4, reverbSend: 0.2, fx: { distortion: { on: true, amount: 0.08 }, pump: { on: true, depth: 0.6, release: 160, trigger: 'kick' } } });
  const brass = track('Brass', 'brassSection', { volume: -8, reverbSend: 0.25, fx: { pump: { on: true, depth: 0.3, release: 160, trigger: 'kick' } } });
  const sub = track('Sub', 'subBass', { volume: -6, fx: { pump: { on: true, depth: 0.6, release: 140, trigger: 'kick' } } });
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const harp = track('Harp', 'harp', { volume: -6, reverbSend: 0.4 });
  const chimes = track('Chimes', 'chimes', { volume: -12, reverbSend: 0.5 });
  const sfx = track('FX', 'fx', { volume: -9, reverbSend: 0.3 });

  // Intro in E minor: Em - Cmaj7 - G/B - D
  const introLeft = progression([['E2', 'E3'], ['C2', 'C3'], ['B1', 'B2'], ['D2', 'D3']], 16, '1n', 0.55);
  const introTune = melody(
    [
      [0, 'B4', 2], [2, 'E5', 2], [4, 'F#5', 2], [6, 'G5', 2], [8, 'F#5', 4], [12, 'E5', 2], [14, 'D5', 2],
      [16, 'E5', 4], [20, 'G5', 2], [22, 'B5', 2], [24, 'A5', 4], [28, 'G5', 2], [30, 'F#5', 2],
      [32, 'D5', 2], [34, 'G5', 2], [36, 'A5', 2], [38, 'B5', 2], [40, 'A5', 4], [44, 'G5', 2], [46, 'A5', 2],
      [48, 'F#5', 6], [54, 'A5', 2], [56, 'D6', 4], [60, 'A5', 4],
    ],
    0.65
  );
  // Build: Am7 - Em/G - Cadd9 - B7 in 16th arpeggios; the last bar stutters on B7, then a beat of silence
  const cells = [['A3', 'C4', 'E4', 'G4'], ['G3', 'B3', 'E4', 'G4'], ['C4', 'D4', 'E4', 'G4'], ['B3', 'D#4', 'F#4', 'A4']];
  const buildArp = everyBar(4, (b): Step[] =>
    b === 3
      ? [...Array.from({ length: 8 }, (_, i): Step => [i, cells[3][[0, 1, 2, 3, 2, 1, 2, 3][i]], 0.6, '16n']), ...Array.from({ length: 8 }, (_, i): Step => [8 + i / 2, cells[3], 0.45 + i * 0.05, '32n'])]
      : Array.from({ length: 16 }, (_, i): Step => [i, cells[b][[0, 1, 2, 3, 2, 1, 2, 3][i % 8]], i % 4 === 0 ? 0.7 : 0.55, '16n'])
  );
  const buildLeft = pulse(['A2', 'G2', 'C3', 'B2'], [0, 4, 8], 4, 0.6);
  const buildSub = progression(['A1', 'G1', 'C2', 'B1'], 16, '1n', 0.7);

  // Drop: Cmaj7 - D - Bm7 - Em (the "Royal Road"), four-on-the-floor
  const arpCells = [['G4', 'C5', 'E5', 'C5'], ['A4', 'D5', 'F#5', 'D5'], ['F#4', 'B4', 'D5', 'B4'], ['B4', 'E5', 'G5', 'E5']];
  const dropRoots = [['C2', 'C3'], ['D2', 'D3'], ['B1', 'B2'], ['E2', 'E3']];
  const dropPiano = everyBar(4, (b): Step[] => [
    ...Array.from({ length: 16 }, (_, i): Step => [i, arpCells[b][i % 4], i % 4 === 0 ? 0.7 : 0.55, '16n']),
    ...[0, 4, 8, 12].map((s): Step => [s, dropRoots[b], 0.65, '8n']),
  ]);
  const tuneA = melody(
    [[0, 'B5', 6], [6, 'C6', 2], [8, 'B5', 4], [12, 'G5', 4], [16, 'A5', 6], [22, 'B5', 2], [24, 'A5', 4], [28, 'F#5', 4], [32, 'F#5', 6], [38, 'G5', 2], [40, 'A5', 4], [44, 'B5', 4], [48, 'G5', 8], [56, 'E5', 4], [60, 'F#5', 4]],
    0.85
  );
  const tuneB = [...tuneA.filter(([s]) => s < 48), ...melody([[48, 'G5', 4], [52, 'B5', 4], [56, 'E6', 8]], 0.85)];
  const brassStabs = stabs([['E4', 'G4', 'B4'], ['D4', 'F#4', 'A4'], ['D4', 'F#4', 'A4'], ['E4', 'G4', 'B4']], [2, 6, 10, 14], 1, 0.6);
  const subLine = pulse(['C2', 'D2', 'B1', 'E2'], [0, 4, 8, 12], 3, 0.75);
  const fourFloor = beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X.......X...'], [D.closedHat, '.x.x.x.x.x.x.x.x'], [D.openHat, '..x...x...x...x.']], 0.8);

  return project(
    'Melodic Hardcore starter',
    180,
    0,
    [9, 17],
    [piano, violin, cello, saw, brass, sub, drums, harp, chimes, sfx],
    [
      clip(piano, 'Intro', 1, 4, [...introLeft, ...introTune]),
      clip(cello, 'Roots', 1, 4, progression(['E3', 'C3', 'B2', 'D3'], 16, '1n', 0.55)),
      clip(harp, 'Gliss', 4, 1, gliss(['E4', 'F#4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F#5', 'G5', 'A5', 'B5', 'C6', 'D6', 'E6', 'F#6'], 8)),
      clip(piano, 'Build', 5, 4, [...buildArp, ...buildLeft]),
      clip(sub, 'Build', 5, 4, buildSub),
      clip(drums, 'Snare ladder', 5, 4, rollWithGap),
      clip(sfx, 'Build-up', 5, 4, softBuild(4)),
      clip(piano, 'Drop', 9, 4, dropPiano, 2),
      clip(violin, 'Tune', 9, 4, tuneA),
      clip(violin, 'Tune', 13, 4, tuneB),
      clip(saw, 'Tune', 9, 4, up(tuneA, -12)),
      clip(saw, 'Tune', 13, 4, up(tuneB, -12)),
      clip(brass, 'Stabs', 9, 4, brassStabs, 2),
      clip(sub, 'Sub', 9, 4, subLine, 2),
      clip(drums, 'Four on the floor', 9, 1, fourFloor, 8),
      clip(chimes, 'Chime', 9, 1, [[0, 'G5', 0.6, '1n']]),
      clip(chimes, 'Chime', 13, 1, [[0, 'G5', 0.6, '1n']]),
      clip(sfx, 'Hit', 9, 2, softHit),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.25 }, { on: true, amount: 1.2 })
  );
}

// ---------- Breakcore / digicore ----------

function breakcore(): ProjectSnapshot {
  const breaks = track('Breaks', 'breakbeatKit', { volume: -2, reverbSend: 0.06 });
  const kit = track('Hardcore kit', 'drumMachine', { volume: -3 });
  const rhodes = track('Keys', 'rhodes', { volume: -16, reverbSend: 0.3 });
  const saw = track('Hook', 'supersaw', { volume: 4, reverbSend: 0.2, fx: { distortion: { on: true, amount: 0.08 }, pump: { on: true, depth: 0.5, release: 150, trigger: 'kick' } } });
  const pluck = track('Arp', 'pluck', { volume: -9, delaySend: 0.25, reverbSend: 0.2 });
  const growl = track('Growl', 'growlBass', { volume: -4, eq: { low: -8, mid: 0, high: 0 } });
  const sub = track('Sub', 'subBass', { volume: -7, fx: { pump: { on: true, depth: 0.5, release: 150, trigger: 'kick' } } });

  // C#m - A - E - B, a bar each
  const hook = melody(
    [
      [0, 'G#5', 2], [2, 'C#6', 2], [4, 'B5', 2], [6, 'G#5', 2], [8, 'E5', 2], [10, 'F#5', 2], [12, 'G#5', 4],
      [16, 'A5', 2], [18, 'G#5', 2], [20, 'E5', 2], [22, 'C#5', 2], [24, 'E5', 4], [28, 'F#5', 2], [30, 'G#5', 2],
      [32, 'B5', 4], [36, 'G#5', 2], [38, 'B5', 2], [40, 'E6', 4], [44, 'D#6', 2], [46, 'B5', 2],
      [48, 'D#6', 4], [52, 'C#6', 4], [56, 'B5', 4], [60, 'F#5', 4],
    ],
    0.8
  );
  const chords = [['C#4', 'E4', 'G#4', 'B4'], ['A3', 'C#4', 'E4', 'G#4'], ['B3', 'E4', 'G#4'], ['B3', 'D#4', 'F#4']];
  const roots = ['C#2', 'A1', 'E2', 'B1'];
  const hardcoreBeat = beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X.......X...'], [D.openHat, '..x...x...x...x.']], 0.8);
  // Breakcore: the Amen, its last bars chopped (bar 3 starts with bar 1's second half) and a stop-time
  const chopped = [
    ...amen(),
    ...later(beat([[D.kick, '..XX....X.X.....'], [D.snare, 'X.g.X.gX.X..'], [D.closedHat, 'x.x.x.x.x.x.']], 0.8), 32),
    ...later(roll32(D.snare, 12, 16, 0.3, 0.9), 32),
    ...later(beat([[D.kick, 'X.X.....'], [D.snare, '...gX.gX'], [D.closedHat, 'x.x.x.x.']], 0.8), 48),
  ];
  return project(
    'Breakcore starter',
    172,
    0,
    [9, 17],
    [breaks, kit, rhodes, saw, pluck, growl, sub],
    [
      clip(kit, 'Hardcore', 1, 1, hardcoreBeat, 4),
      clip(saw, 'Hook A', 1, 4, hook),
      clip(growl, 'Stabs', 1, 4, pulse(roots, [2, 6, 10, 14], 1, 0.65), 1, '1/16'),
      clip(sub, 'Sub', 1, 4, progression(roots, 16, '1n', 0.7)),
      clip(rhodes, 'Chords', 5, 4, progression(chords, 16, '1n', 0.6)),
      clip(breaks, 'Breakcore A', 5, 4, chopped),
      clip(sub, 'Sub', 5, 4, progression(roots, 16, '2n.', 0.65)),
      clip(breaks, 'Breaks', 9, 4, [...amen(), ...later(amen(true), 32)], 2),
      clip(saw, 'Hook B', 9, 4, hook, 2),
      clip(pluck, 'Arp', 9, 4, everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, chords[b][i % chords[b].length].replace(/\d/, (o) => String(Number(o) + 1)), i % 4 === 0 ? 0.7 : 0.5, '16n'])), 2),
      clip(rhodes, 'Chords', 9, 4, progression(chords, 16, '1n', 0.5), 2),
      clip(sub, 'Sub', 9, 4, progression(roots, 16, '1n', 0.7), 2),
    ],
    [[1, 'Hook'], [5, 'Breakcore'], [9, 'Hook over breaks']],
    master({ on: true, depth: 0.25 }, { on: true, amount: 1.15 })
  );
}

// ---------- RPG battle (leitmotif) ----------

function rpg(): ProjectSnapshot {
  const lead = track('Lead', 'pluck', { volume: 1, reverbSend: 0.15, fx: { filter: { on: true, cutoff: 2500, resonance: 4, slope: 12 } } });
  const counter = track('Counter', 'keys', { volume: -2, reverbSend: 0.15 });
  const bass = track('Bass', 'bass', { volume: -7 });
  const piano = track('Piano', 'piano', { volume: -4, reverbSend: 0.25 });
  const marimba = track('Marimba', 'marimba', { volume: -4, reverbSend: 0.25 });
  const brass = track('Brass', 'brassSection', { volume: -5, reverbSend: 0.3 });
  const drums = track('Drums', 'drums', { volume: -3 });

  // The hero's motif, then the same shape a step lower over each root: D - C - B - Bb
  const motif = melody([[0, 'D5', 2], [2, 'F5', 2], [4, 'G5', 1], [5, 'A5', 3], [8, 'G5', 2], [10, 'F5', 2], [12, 'D5', 2], [14, 'C5', 2]], 0.8);
  const battle = [...motif, ...later(up(motif, -2), 16), ...later(up(motif, -3), 32), ...later(up(motif, -4), 48)];
  // In town: the motif at half speed, major, on marimba
  const town = melody([[0, 'D5', 4], [4, 'F#5', 4], [8, 'G5', 2], [10, 'A5', 6], [16, 'G5', 4], [20, 'F#5', 4], [24, 'D5', 4], [28, 'C#5', 4]], 0.7);
  const roots = ['D2', 'C2', 'B1', 'A#1'];
  const bassLine = everyBar(4, (b): Step[] => [0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Step => [s, i % 2 ? nameOf(midiOf(roots[b]) + 12) : roots[b], i % 4 === 0 ? 0.85 : 0.7, '8n']));
  const counterLine = everyBar(4, (b) => {
    const r = midiOf(roots[b]) + 24;
    return Array.from({ length: 16 }, (_, i): Step => [i, nameOf(r + [0, 7, 3, 7][i % 4]), i % 4 === 0 ? 0.55 : 0.4, '16n']);
  });
  const groove = beat([[D.kick, 'X.....X.X.......'], [D.snare, '....X.......X...'], [D.closedHat, 'xoxoxoxoxoxoxo.o'], [D.openHat, '..............x.']], 0.8);
  return project(
    'RPG Battle starter',
    120,
    0,
    [5, 17],
    [lead, counter, bass, piano, marimba, brass, drums],
    [
      clip(marimba, 'Town theme', 1, 2, town, 2),
      clip(bass, 'Town bass', 1, 4, progression(['D2', 'G1', 'D2', 'A1'], 16, '2n', 0.6)),
      clip(lead, 'Battle motif', 5, 4, battle, 2),
      clip(bass, 'Battle bass', 5, 4, bassLine, 3),
      clip(counter, 'Counter', 5, 4, counterLine, 3),
      clip(drums, 'Battle', 5, 1, groove, 12),
      // Finale: the motif stacked on brass and piano
      clip(brass, 'Finale', 13, 4, up(battle.map(([s, n, v]): Step => [s, n, v, '8n']), -12)),
      clip(piano, 'Finale', 13, 4, octaves(battle)),
    ],
    [[1, 'Town'], [5, 'Battle'], [13, 'Finale']],
    master({ on: true, depth: 0.15 }, { on: true, amount: 1.1 })
  );
}

// ---------- Metal dubstep ----------

function metalDubstep(): ProjectSnapshot {
  const gtrL = track('Guitar L', 'distortionGuitar', { volume: -7, pan: -0.6 });
  const gtrR = track('Guitar R', 'distortionGuitar', { volume: -8, pan: 0.6 });
  const lead = track('Lead', 'lead', { volume: 0, reverbSend: 0.25, delaySend: 0.15 });
  const growl = track('Growl', 'growlBass', { volume: 0, eq: { low: -10, mid: 0, high: 0 } });
  const wobble = track('Wobble', 'wobbleBass', { volume: -5, eq: { low: -10, mid: 0, high: 0 } });
  const sub = track('Sub', 'subBass', { volume: -7, fx: { filter: { on: true, cutoff: 110 }, pump: { on: true, depth: 0.4, release: 200, trigger: 'kick' } } });
  const drums = track('Drums', 'acousticKit', { volume: -1 });
  const taiko = track('Taiko', 'taiko', { volume: -4 });
  const pad = track('Brass & cello', 'brassSection', { volume: -12, reverbSend: 0.3 });
  const sfx = track('FX', 'fx', { volume: -9 });

  // E minor with F as its flat second: E5 - F5 - G5 - E5 power chords and 16th chugs
  const pc = (r: string): string[] => [r, nameOf(midiOf(r) + 7), nameOf(midiOf(r) + 12)];
  const riff = everyBar(1, (): Step[] => [
    [0, pc('E2'), 0.9, '8n'], [2, 'E2', 0.6, '16n'], [3, 'E2', 0.6, '16n'], [4, pc('F2'), 0.85, '8n'], [6, 'E2', 0.6, '16n'], [7, 'E2', 0.6, '16n'],
    [8, pc('G2'), 0.9, '4n'], [12, pc('E2'), 0.85, '8n'], [14, 'E2', 0.6, '16n'], [15, 'E2', 0.6, '16n'],
  ]);
  const lift = [...riff, ...later(riff, 16), ...later(riff, 32), [48, pc('C3'), 0.9, '4n'] as Step, [52, pc('D3'), 0.9, '4n'] as Step];
  const verse = beat([[D.kick, 'X.X...X.X.X...X.'], [D.snare, '....X.......X...'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8);
  // The drop in half time: guitar and growl chug exactly on the kicks, an F stab on step 11
  const kicks = [0, 3, 6, 12, 14];
  const half = beat([[D.kick, 'X..X..X.....X.X.'], [D.snare, '........X.......'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8);
  const chugs = (low: string, f: string, vel: number): Step[] => everyBar(1, (): Step[] => [...kicks.map((s): Step => [s, low, vel, '16n']), [10, f, vel, '16n']]);
  return project(
    'Metal Dubstep starter',
    150,
    0,
    [9, 17],
    [gtrL, gtrR, lead, growl, wobble, sub, drums, taiko, pad, sfx],
    [
      clip(gtrL, 'Riff', 1, 4, lift, 2),
      clip(gtrR, 'Riff', 1, 4, later(lift, 0.06), 2),
      clip(drums, 'Verse', 5, 1, verse, 3),
      clip(drums, 'Build', 8, 1, beat([[D.snare, 'xxxxXXXX']], 0.8)),
      clip(sfx, 'Build-up', 5, 4, softBuild(4)),
      clip(drums, 'Half time', 9, 1, [[0, D.crash, 0.6] as Step, ...half], 8),
      clip(taiko, 'Taiko', 9, 1, kicks.map((s): Step => [s, 'E2', 0.75]), 8),
      clip(gtrL, 'Chugs', 9, 1, chugs('E2', 'F2', 0.85), 8),
      clip(gtrR, 'Chugs', 9, 1, later(chugs('E2', 'F2', 0.8), 0.06), 8),
      clip(growl, 'Chugs', 9, 1, chugs('E1', 'F1', 0.85), 4, '1/16'),
      clip(growl, 'Chugs', 13, 1, chugs('E1', 'F1', 0.85), 4, '1/8T'),
      clip(wobble, 'Wobble', 9, 2, [[0, 'E1', 0.4, '1m'], [16, 'E1', 0.4, '2n'], [24, 'G1', 0.4, '2n']], 4, '1/8'),
      clip(sub, 'Sub', 9, 1, [[0, 'E1', 0.75, '1m']], 8),
      clip(pad, 'Chords', 9, 4, progression([['E3', 'G3', 'B3'], ['C3', 'E3', 'G3'], ['D3', 'F#3', 'A3'], ['B2', 'D#3', 'F#3']], 16, '1n', 0.6), 2),
      clip(lead, 'Line', 13, 4, melody([[0, 'B4', 8], [8, 'C5', 4], [12, 'B4', 4], [16, 'G4', 8], [24, 'A4', 8], [32, 'B4', 8], [40, 'D5', 4], [44, 'C5', 4], [48, 'B4', 16]], 0.8)),
      clip(sfx, 'Hit', 9, 2, softHit),
    ],
    [[1, 'Riff'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.25 }, { on: true, amount: 1.1 })
  );
}

// ---------- Melodic dubstep (with a violin lead) ----------

function melodicDubstep(): ProjectSnapshot {
  const piano = track('Piano', 'piano', { volume: -2, reverbSend: 0.35 });
  const pad = track('Pad', 'wavetable', { volume: -12, reverbSend: 0.4, fx: { pump: { on: true, depth: 0.5, release: 260, trigger: 'kick' } } });
  const saw = track('Supersaw', 'supersaw', { volume: -2, reverbSend: 0.25, fx: { pump: { on: true, depth: 0.7, release: 220, trigger: 'kick' } } });
  const lead = track('Lead', 'lead', { volume: -5, reverbSend: 0.25, delaySend: 0.2 });
  const violin = track('Violin', 'violin', { volume: -4, reverbSend: 0.35 });
  const wobble = track('Wobble', 'wobbleBass', { volume: -5, eq: { low: -10, mid: 0, high: 0 } });
  const sub = track('Sub', 'subBass', { volume: -7, fx: { pump: { on: true, depth: 0.5, release: 200, trigger: 'kick' } } });
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const taiko = track('Taiko', 'taiko', { volume: -5 });
  const sfx = track('FX', 'fx', { volume: -9, reverbSend: 0.3 });

  // Dm - Bb - F - C, the build ending on A (the harmonic minor's pull back to D)
  const chords = [['D4', 'F4', 'A4'], ['D4', 'F4', 'A#4'], ['C4', 'F4', 'A4'], ['C4', 'E4', 'G4']];
  const introPiano = [...progression(chords, 16, '1n', 0.55), ...progression(['D2', 'A#1', 'F1', 'C2'], 16, '1n', 0.5)];
  const buildPiano = [...broken([['D3', 'A3', 'D4', 'F4', 'A4', 'F4', 'D4', 'A3'], ['A#2', 'F3', 'A#3', 'D4', 'F4', 'D4', 'A#3', 'F3'], ['F2', 'C3', 'F3', 'A3', 'C4', 'A3', 'F3', 'C3'], ['A2', 'E3', 'A3', 'C#4', 'E4', 'C#4', 'A3', 'E3']], 2, 2, 0.5)];
  // The hook: a dotted-8th line, one idea through the drop
  const hook = melody(
    [
      [0, 'A5', 3], [3, 'F5', 3], [6, 'D5', 3], [9, 'E5', 3], [12, 'F5', 4],
      [16, 'F5', 3], [19, 'D5', 3], [22, 'A#4', 3], [25, 'C5', 3], [28, 'D5', 4],
      [32, 'C6', 3], [35, 'A5', 3], [38, 'F5', 3], [41, 'G5', 3], [44, 'A5', 4],
      [48, 'G5', 6], [54, 'E5', 2], [56, 'C5', 8],
    ],
    0.85
  );
  const wobbleLine: Step[] = [[0, 'D2', 0.9, '4n.'], [10, 'F2', 0.8, '8n'], [12, 'D2', 0.85, '4n'], [16, 'C2', 0.9, '4n'], [20, 'D2', 0.8, '4n.'], [30, 'A1', 0.8, '8n']];
  const half = beat([[D.kick, 'X.........X.....'], [D.snare, '........X......g'], [D.closedHat, 'x.x.x.x.x.x.x.x.'], [D.openHat, '..............x.']], 0.8);
  return project(
    'Melodic Dubstep starter',
    150,
    0,
    [9, 17],
    [piano, pad, saw, lead, violin, wobble, sub, drums, taiko, sfx],
    [
      clip(piano, 'Intro', 1, 4, introPiano),
      clip(pad, 'Pad', 1, 4, progression(chords, 16, '1n', 0.5), 2),
      clip(piano, 'Build', 5, 4, buildPiano),
      clip(drums, 'Snare roll', 5, 4, rollWithGap),
      clip(sfx, 'Build-up', 5, 4, softBuild(4)),
      clip(saw, 'Stabs', 9, 4, stabs(chords, [2, 6, 10, 14], 1, 0.7), 2),
      clip(lead, 'Hook', 9, 4, hook, 2),
      clip(violin, 'Hook', 13, 4, hook),
      clip(wobble, 'Wobble', 9, 2, wobbleLine, 2, '1/8'),
      clip(wobble, 'Wobble', 13, 2, wobbleLine, 2, '1/16'),
      clip(sub, 'Sub', 9, 4, progression(['D2', 'A#1', 'F1', 'C2'], 16, '1n', 0.7), 2),
      clip(drums, 'Half time', 9, 1, half, 8),
      clip(taiko, 'Taiko', 9, 1, [[0, 'D2', 0.75], [10, 'A2', 0.65]], 8),
      clip(sfx, 'Hit', 9, 2, softHit),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop'], [13, 'Violin']],
    master({ on: true, depth: 0.3 }, { on: true, amount: 1.2 })
  );
}

// ---------- Riddim ----------

function riddim(): ProjectSnapshot {
  const organ = track('Organ drone', 'pipeOrgan', { volume: -12, reverbSend: 0.4 });
  const growl = track('Growl', 'growlBass', { volume: 2, eq: { low: -8, mid: 0, high: 0 } });
  const wobble = track('Wobble', 'wobbleBass', { volume: 1, eq: { low: -8, mid: 0, high: 0 } });
  const reese = track('Reese', 'reeseBass', { volume: -14, eq: { low: -8, mid: 0, high: 0 } });
  const sub = track('Sub', 'subBass', { volume: -7 });
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const taiko = track('Taiko', 'taiko', { volume: -5 });
  const sfx = track('FX', 'fx', { volume: -9 });

  // The call: triplets on G, G, Ab, then G, G, G up an octave, short with gaps
  const t = 4 / 3;
  const call: Step[] = [[0, 'G1', 0.85, '16n'], [t, 'G1', 0.75, '16n'], [2 * t, 'G#1', 0.8, '16n'], [8, 'G1', 0.85, '16n'], [8 + t, 'G1', 0.75, '16n'], [8 + 2 * t, 'G2', 0.8, '16n']];
  // The answer: a held G, an Ab, back to G
  const answer: Step[] = [[0, 'G1', 0.85, '4n'], [8 + 2 * t, 'G#1', 0.8, '16n'], [12, 'G1', 0.8, '8n']];
  const drop = beat([[D.kick, 'X...........o...'], [D.snare, '........X.......'], [D.closedHat, '..x...x...x...x.']], 0.8);
  return project(
    'Riddim starter',
    140,
    0,
    [9, 17],
    [organ, growl, wobble, reese, sub, drums, taiko, sfx],
    [
      clip(organ, 'Drone', 1, 4, [[0, ['G2', 'D3'], 0.6, '3m'], [48, ['G#2', 'D3'], 0.6, '1m']]),
      clip(taiko, 'Toll', 1, 2, [[0, 'G2', 0.6]], 2),
      clip(sub, 'Pulse', 5, 4, pulse(['G1', 'G1', 'G1', 'G1'], [0, 4, 8, 12], 2, 0.6)),
      clip(growl, 'Tease', 7, 1, call, 1, '1/8T'),
      clip(drums, 'Snare roll', 5, 4, rollWithGap),
      clip(sfx, 'Build-up', 5, 4, softBuild(4)),
      clip(growl, 'Call', 9, 1, call, 1, '1/8T'),
      clip(wobble, 'Answer', 10, 1, answer, 1, '1/16'),
      clip(growl, 'Call', 11, 1, call, 1, '1/8T'),
      clip(wobble, 'Answer', 12, 1, answer, 1, '1/16'),
      clip(growl, 'Call', 13, 1, call, 1, '1/16T'),
      clip(wobble, 'Answer', 14, 1, answer, 1, '1/8'),
      clip(growl, 'Call', 15, 1, call, 1, '1/8T'),
      clip(reese, 'Answer', 16, 1, answer),
      clip(sub, 'Pulse', 9, 1, pulse(['G1'], [0, 4, 8, 12], 2, 0.7), 8),
      clip(drums, 'Drop', 9, 1, drop, 8),
      clip(taiko, 'Toll', 9, 2, [[0, 'G2', 0.7]], 4),
      clip(sfx, 'Hit', 9, 2, softHit),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.3 }, { on: true, amount: 1.1 })
  );
}

// ---------- Kawaii future bass ----------

function futureBass(): ProjectSnapshot {
  const saw = track('Chords', 'supersaw', { volume: 0, reverbSend: 0.25, fx: { chorus: { on: true, mix: 0.3 }, pump: { on: true, depth: 0.8, release: 220, trigger: 'kick' } } });
  const pad = track('Pad', 'wavetable', { volume: -12, reverbSend: 0.4, fx: { pump: { on: true, depth: 0.6, release: 300, trigger: 'kick' } } });
  const pluck = track('Pluck', 'pluck', { volume: -9, delaySend: 0.25, reverbSend: 0.2 });
  const chimes = track('Twinkles', 'chimes', { volume: -12, reverbSend: 0.5, pan: 0.3 });
  const marimba = track('Marimba', 'marimba', { volume: -10, reverbSend: 0.2, pan: -0.15 });
  const lead = track('Lead', 'lead', { volume: -5, delaySend: 0.15, fx: { filter: { on: true, cutoff: 4000 } } });
  const sub = track('Sub', 'subBass', { volume: -7, fx: { filter: { on: true, cutoff: 180 }, pump: { on: true, depth: 0.7, release: 220, trigger: 'kick' } } });
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const sfx = track('FX', 'fx', { volume: -10, reverbSend: 0.3 });

  // Gmaj9 - A6add9 - F#m7 - Bm9 in D
  const chords = [['G3', 'B3', 'D4', 'F#4', 'A4'], ['A3', 'C#4', 'E4', 'F#4', 'B4'], ['F#3', 'A3', 'C#4', 'E4'], ['B3', 'D4', 'F#4', 'A4', 'C#5']];
  // Chopped to the drums, two bars a chord; each chord blooms up from a grace chord a step below
  const chops = everyBar(8, (b): Step[] => {
    const c = chords[Math.floor(b / 2)];
    const hits = [0, 3, 6, 8, 10, 11, 13, 14].map((s, i): Step => [s === 0 && b % 2 === 0 ? 0.5 : s, c, i === 0 ? 0.85 : 0.7, i % 3 === 2 ? '8n' : '16n']);
    return b % 2 === 0 ? [[0, up([[0, c, 0.5]], -2)[0][1], 0.5, '32n'], ...hits] : hits;
  });
  const topline = melody(
    [
      [0, 'F#5', 2], [3, 'A5', 2], [6, 'D6', 2], [8, 'C#6', 2], [10, 'A5', 2], [12, 'F#5', 2], [14, 'A5', 2], [16, 'B5', 4], [22, 'A5', 2], [24, 'F#5', 4], [28, 'E5', 4],
      [32, 'E5', 2], [35, 'A5', 2], [38, 'C#6', 2], [40, 'B5', 2], [42, 'A5', 2], [44, 'F#5', 2], [46, 'A5', 2], [48, 'B5', 4], [54, 'C#6', 2], [56, 'E6', 4], [60, 'C#6', 4],
      [64, 'C#6', 2], [67, 'A5', 2], [70, 'F#5', 2], [72, 'E5', 2], [74, 'F#5', 2], [76, 'A5', 2], [78, 'C#6', 2], [80, 'B5', 6], [86, 'A5', 2], [88, 'F#5', 8],
      [96, 'D6', 2], [99, 'C#6', 2], [102, 'A5', 2], [104, 'F#5', 2], [106, 'A5', 2], [108, 'B5', 2], [110, 'C#6', 2], [112, 'D6', 8], [120, 'E6', 4], [124, 'F#6', 4],
    ],
    0.8
  );
  const twinkles = everyBar(8, (b): Step[] => [[3, 'A5', 0.4, '16n'], [7, b % 2 ? 'F#5' : 'B5', 0.35, '16n'], [11, 'D5', 0.4, '16n'], [15, 'E5', 0.35, '16n']]);
  const half = (b: number): Step[] => [
    ...beat([[D.kick, 'X.....X...X.....'], [D.snare, '........X.......'], [D.closedHat, b % 2 ? 'xoxoxoxoxoxo....' : 'xoxoxoxoxoxoxoxo']], 0.8),
    ...(b % 2 ? roll32(D.closedHat, 12, 16, 0.3, 0.7) : []),
  ];
  const introArp = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, chords[b][i % chords[b].length].replace(/\d/, (o) => String(Number(o) + 1)), i % 4 === 0 ? 0.65 : 0.5, '16n']));
  return project(
    'Kawaii Future Bass starter',
    150,
    0,
    [9, 17],
    [saw, pad, pluck, chimes, marimba, lead, sub, drums, sfx],
    [
      clip(pad, 'Pad', 1, 4, progression(chords, 16, '1n', 0.5), 2),
      clip(pluck, 'Arp', 1, 4, introArp, 2),
      clip(chimes, 'Twinkles', 1, 8, twinkles.filter(([s]) => s < 64)),
      clip(saw, 'Held', 5, 4, progression(chords, 16, '1n', 0.55)),
      clip(drums, 'Snare roll', 5, 4, rollWithGap),
      clip(sfx, 'Build-up', 5, 4, softBuild(4)),
      clip(saw, 'Chops', 9, 8, chops),
      clip(lead, 'Topline', 9, 8, topline),
      clip(marimba, 'Melody', 9, 8, up(topline, -12)),
      clip(chimes, 'Twinkles', 9, 8, twinkles),
      clip(sub, 'Sub', 9, 8, progression(['G1', 'A1', 'F#1', 'B1'], 32, '2m', 0.7)),
      clip(drums, 'Half time', 9, 2, [...half(0), ...later(half(1), 16)], 4),
      clip(sfx, 'Hit', 9, 2, softHit),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.3 }, { on: true, amount: 1.25 })
  );
}

// ---------- Drift phonk ----------

function phonk(): ProjectSnapshot {
  const bell = track('Cowbell lead', 'pluck', { volume: 1, eq: { low: -6, mid: 3, high: 4 }, fx: { distortion: { on: true, amount: 0.08 }, pump: { on: true, depth: 0.45, release: 180, trigger: 'kick' } } });
  const marimba = track('Bell octave', 'marimba', { volume: -9, eq: { low: -10, mid: 0, high: 5 } });
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const bass = track('808', 'bass808', { volume: -4 });
  const dirt = track('808 grit', 'growlBass', { volume: -16, eq: { low: -12, mid: 4, high: 0 }, fx: { pump: { on: true, depth: 0.5, release: 180, trigger: 'kick' } } });
  const pad = track('Pad', 'rhodes', { volume: -10, reverbSend: 0.35 });

  // D Phrygian (D Eb F G A Bb C): the bell riff, two bars, every note doubled by the kit's cowbell
  const riff: Step[] = [
    [0, 'D5', 0.85, '16n'], [3, 'D5', 0.75, '16n'], [6, 'D#5', 0.8, '16n'], [8, 'D5', 0.8, '16n'], [10, 'C5', 0.75, '16n'], [11, 'D5', 0.75, '16n'], [14, 'A4', 0.75, '16n'], [15, 'A#4', 0.75, '16n'],
    [16, 'D5', 0.85, '16n'], [19, 'D5', 0.75, '16n'], [22, 'D#5', 0.8, '16n'], [24, 'F5', 0.8, '16n'], [26, 'D#5', 0.75, '16n'], [27, 'D5', 0.75, '16n'], [28, 'C5', 0.75, '16n'], [30, 'A#4', 0.75, '16n'],
  ];
  const cowbells = riff.map(([s]): Step => [s, D.cowbell, 0.35]);
  const house = (b: number): Step[] => [
    ...beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X..g....X..g'], [D.closedHat, 'x.xx.xxx.xx.xx.x'], [D.openHat, '..o...o...o...o.']], 0.8),
    ...(b === 3 ? roll32(D.closedHat, 12, 16, 0.3, 0.8) : []),
  ];
  const drive = everyBar(4, house);
  // The 808 on every kick; at the end of bar 2 a C runs into the next D, so it slides up
  const eight: Step[] = [[0, 'D2', 0.8, '8n'], [4, 'D2', 0.75, '8n'], [8, 'D2', 0.8, '8n'], [12, 'D2', 0.75, '8n'], [16, 'D2', 0.8, '8n'], [20, 'D2', 0.75, '8n'], [24, 'D2', 0.8, '8n'], [28, 'C2', 0.8, '4n']];
  // The switch: the riff a fourth up, the octave layer running D-Eb 16ths
  const switchRun = everyBar(2, () => Array.from({ length: 16 }, (_, i): Step => [i, i % 2 ? 'D#6' : 'D6', i % 4 === 0 ? 0.7 : 0.5, '16n']));
  return project(
    'Drift Phonk starter',
    130,
    0.04,
    [5, 17],
    [bell, marimba, drums, bass, dirt, pad],
    [
      clip(bell, 'Riff', 1, 2, riff, 2),
      clip(drums, 'Hats', 3, 2, beat([[D.closedHat, 'x.xx.xxx.xx.xx.xx.xx.xxx.xx.xx.x']])),
      clip(bell, 'Riff', 5, 2, riff, 4),
      clip(marimba, 'Octave', 5, 2, up(riff, 12), 4),
      clip(drums, 'Drive', 5, 4, [...drive, ...cowbells, ...later(cowbells, 32)], 2),
      clip(bass, '808', 5, 2, eight, 6),
      clip(dirt, 'Grit', 5, 2, up(eight, 12), 6, '1/16'),
      clip(bell, 'Switch', 13, 2, up(riff, 5), 2),
      clip(marimba, 'Run', 13, 2, switchRun, 2),
      clip(pad, 'Pad', 13, 2, progression([['D3', 'F3', 'A3'], ['D#3', 'G3', 'A#3']], 16, '1n', 0.5), 2),
    ],
    [[1, 'Intro'], [5, 'Drop'], [13, 'Switch']],
    master({ on: true, depth: 0.25 }, { on: true, amount: 1.1 })
  );
}

// ---------- UK drill ----------

function drill(): ProjectSnapshot {
  const keys = track('FM keys', 'fmPiano', { volume: -3, reverbSend: 0.3, delaySend: 0.15 });
  const strings = track('Strings', 'strings', { volume: -15, reverbSend: 0.4 });
  const mist = track('Mist', 'wavetable', { volume: -14, reverbSend: 0.5, fx: { filter: { on: true, cutoff: 1500 } } });
  const bass = track('808', 'bass808', { volume: -3 });
  const drums = track('Drums', 'drumMachine', { volume: -2 });

  // A four-bar motif with a gap in every bar; the last bar changes its ending
  const motif = melody(
    [[0, 'G4', 2], [3, 'A#4', 2], [6, 'D5', 2], [10, 'D#5', 2], [13, 'D5', 2], [16, 'G4', 2], [19, 'A#4', 2], [22, 'D5', 4], [32, 'G4', 2], [35, 'A#4', 2], [38, 'D5', 2], [42, 'D#5', 2], [45, 'D5', 2], [48, 'G4', 2], [51, 'A#4', 2], [54, 'D5', 2], [58, 'F5', 2], [61, 'C5', 2]],
    0.75
  );
  // Gm - Ebmaj7 - Cm - D7(b9)
  const chords = [['G3', 'A#3', 'D4'], ['D#3', 'G3', 'A#3', 'D4'], ['C4', 'D#4', 'G4'], ['D3', 'F#3', 'C4', 'D#4']];
  // The drill bounce over two bars: snare on 3, then late, on 4; triplet hat bursts before each snare
  const tri = 2 / 3;
  const bounce: Step[] = [
    ...[0, 11, 18, 26].map((s): Step => [s, D.kick, 0.8]),
    [8, D.snare, 0.9], [14, D.snare, 0.28], [22, D.snare, 0.28], [28, D.snare, 0.9],
    // 8th hats with a few left out
    ...[0, 2, 8, 10, 12, 16, 18, 20, 24, 30].map((s): Step => [s, D.closedHat, s % 4 === 0 ? 0.6 : 0.45]),
    ...[5, 5 + tri, 5 + 2 * tri, 25, 25 + tri, 25 + 2 * tri].map((s): Step => [s, D.closedHat, 0.5]),
  ];
  // 808 on the kicks, with one slide up (D# into G) and one down (Bb into G) per four bars
  const eight: Step[] = [
    [0, 'G1', 0.85, '8n.'], [11, 'G1', 0.75, '8n'], [18, 'G1', 0.85, '8n.'], [26, 'D#1', 0.8, '4n'], [29, 'G1', 0.75, '8n'],
    [32, 'G1', 0.85, '8n.'], [43, 'G1', 0.75, '8n'], [50, 'A#1', 0.8, '4n.'], [54, 'G1', 0.75, '8n'],
  ];
  return project(
    'UK Drill starter',
    142,
    0,
    [5, 17],
    [keys, strings, mist, bass, drums],
    [
      clip(keys, 'Motif', 1, 4, motif, 4),
      clip(strings, 'Chords', 1, 4, progression(chords, 16, '1n', 0.55), 4),
      clip(mist, 'Mist', 1, 4, progression(chords, 16, '1n', 0.45), 4),
      clip(drums, 'Bounce', 5, 2, bounce, 6),
      clip(bass, '808', 5, 4, eight, 3),
    ],
    [[1, 'Intro'], [5, 'Verse']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.1 })
  );
}

// ---------- Rage ----------

function rage(): ProjectSnapshot {
  const saw = track('Rage lead', 'supersaw', { volume: 3, reverbSend: 0.45, fx: { distortion: { on: true, amount: 0.08 }, chorus: { on: true, mix: 0.35 } } });
  const low = track('Lead (low)', 'lead', { volume: -4, delaySend: 0.2 });
  const bells = track('Bells', 'glockenspiel', { volume: -12, reverbSend: 0.5 });
  const pad = track('Pad', 'wavetable', { volume: -13, reverbSend: 0.5, fx: { pump: { on: true, depth: 0.6, release: 260, trigger: 'kick' } } });
  const bass = track('808', 'bass808', { volume: -3 });
  const grit = track('Grit', 'reeseBass', { volume: -16, eq: { low: -12, mid: 3, high: 0 } });
  const drums = track('Drums', 'drumMachine', { volume: -2 });

  // F#m - D, two bars: the hook in short stabs
  const hook: Step[] = [
    [0, 'C#5', 0.85, '16n'], [2, 'E5', 0.8, '16n'], [3, 'F#5', 0.85, '8n'], [6, 'E5', 0.8, '16n'], [8, 'C#5', 0.8, '16n'], [10, 'B4', 0.8, '4n.'],
    [16, 'C#5', 0.85, '16n'], [18, 'E5', 0.8, '16n'], [19, 'F#5', 0.85, '8n'], [22, 'A5', 0.8, '16n'], [24, 'G#5', 0.8, '16n'], [26, 'F#5', 0.8, '4n.'],
  ];
  const groove = (b: number): Step[] => [
    ...beat([[D.kick, b === 3 ? 'X...............' : 'X......X..X.....'], [D.snare, b === 3 ? '................' : '........X.......'], [D.closedHat, b === 3 ? '' : 'x...x...x...x...']], 0.8),
    ...(b === 1 ? [12, 12 + 2 / 3, 12 + 4 / 3].map((s, i): Step => [s, D.closedHat, 0.35 + i * 0.15]) : []),
    ...(b === 3 ? [[8, D.snare, 0.85] as Step, ...roll32(D.closedHat, 8, 16, 0.3, 0.75)] : []),
  ];
  const eight = everyBar(2, (b): Step[] => [[0, b ? 'D1' : 'F#1', 0.85, '4n'], [7, b ? 'D1' : 'F#1', 0.75, '8n'], [10, b ? 'D1' : 'F#1', 0.75, '8n']]);
  return project(
    'Rage starter',
    160,
    0,
    [5, 17],
    [saw, low, bells, pad, bass, grit, drums],
    [
      clip(saw, 'Hook', 1, 2, hook, 8),
      clip(bells, 'Bells', 1, 2, up(hook, 12), 2),
      clip(pad, 'Pad', 1, 2, progression([['F#3', 'A3', 'C#4'], ['D3', 'F#3', 'A3']], 16, '1n', 0.5), 8),
      clip(drums, 'Beat', 5, 4, everyBar(4, groove), 3),
      clip(bass, '808', 5, 2, eight, 6),
      clip(grit, 'Grit', 5, 2, up(eight, 12).map(([s, n, , d]): Step => [s, n, 0.35, d]), 6),
      clip(low, 'Hook (low)', 13, 2, up(hook, -12), 2),
      clip(bells, 'Bells', 13, 2, up(hook, 12), 2),
    ],
    [[1, 'Intro'], [5, 'Verse'], [13, 'Hook']],
    master({ on: true, depth: 0.25 }, { on: true, amount: 1.35 })
  );
}

// ---------- Neo-soul (chord-first hip-hop) ----------

function neoSoul(): ProjectSnapshot {
  const rhodes = track('Rhodes', 'rhodes', {
    volume: -10,
    reverbSend: 0.25,
    fx: { chorus: { on: true, mix: 0.3, depth: 0.4 }, filter: { on: true, cutoff: 6000 } },
    automation: [{ param: 'filterCutoff', points: [{ bar: 1, value: 0.35 }, { bar: 5, value: 0.9 }, { bar: 17, value: 0.9 }] }],
  });
  const piano = track('Piano', 'piano', { volume: -3, reverbSend: 0.25 });
  const lead = track('Lead', 'lead', { volume: 1, delaySend: 0.2 });
  const flute = track('Flute', 'flute', { volume: -2, reverbSend: 0.3 });
  const bass = track('Bass', 'bassGuitar', { volume: -3 });
  const eight = track('808', 'bass808', { volume: -10 });
  const cello = track('Cello', 'cello', { volume: -7, reverbSend: 0.3 });
  const drums = track('Drums', 'drumMachine', { volume: -3 });

  // Bbmaj7 - Am7 - Gm9 - Am7; the pre-hook swaps the Am7s for A7#9
  const hook = [['A3', 'D4', 'F4', 'C5'], ['G3', 'C4', 'E4', 'G4'], ['F3', 'A#3', 'D4', 'A4'], ['G3', 'C4', 'E4', 'G4']];
  const pre = [hook[0], ['G3', 'C#4', 'C5'], hook[2], ['G3', 'C#4', 'C5']];
  const roots = ['A#1', 'A1', 'G1', 'A1'];
  const comp = (chords: string[][]) => everyBar(4, (b): Step[] => [[0, chords[b], 0.7, '2n.'], [12, chords[b], 0.5, '8n'], [14, chords[b], 0.55, '8n']]);
  const bassLine = everyBar(4, (b): Step[] => [[0, roots[b], 0.85, '4n.'], [6, roots[b], 0.6, '8n'], [10, nameOf(midiOf(roots[b]) + 7), 0.65, '8n'], [14, nameOf(midiOf(roots[b]) + 12), 0.6, '8n']]);
  const tune = melody([[0, 'F5', 4], [4, 'E5', 2], [6, 'D5', 2], [8, 'C5', 6], [14, 'A4', 2], [16, 'C5', 4], [20, 'E5', 4], [24, 'G5', 6], [30, 'E5', 2], [32, 'F5', 4], [36, 'D5', 2], [38, 'A#4', 2], [40, 'A4', 4], [44, 'G4', 4], [48, 'A4', 8], [56, 'C5', 4], [60, 'E5', 4]], 0.7);
  // Drums that drag: the snare a little late (12 ms at 80 BPM), ghost notes, a hat run every 4th bar
  const late = 0.064;
  const drag = everyBar(4, (b): Step[] => [
    ...beat([[D.kick, 'X......X..X.....'], [D.snare, '......g.......g.'], [D.closedHat, b === 3 ? 'x.x.x.x.x.x.x.xx' : 'x.x.x.x.x.x.x.x.']], 0.75),
    [4 + late, D.snare, 0.8], [12 + late, D.snare, 0.85],
  ]);
  return project(
    'Neo-Soul starter',
    80,
    0.18,
    [5, 17],
    [rhodes, piano, lead, flute, bass, eight, cello, drums],
    [
      clip(rhodes, 'Intro', 1, 4, comp(hook)),
      clip(rhodes, 'Hook', 5, 4, comp(hook)),
      clip(rhodes, 'Pre-hook', 9, 4, comp(pre)),
      clip(lead, 'Melody', 5, 4, tune),
      clip(piano, 'Doubles', 9, 4, up(tune, 12)),
      clip(flute, 'Counterline', 9, 4, melody([[8, 'D5', 4], [12, 'C5', 4], [24, 'A#4', 4], [28, 'A4', 4], [40, 'F5', 4], [44, 'E5', 4], [56, 'C#5', 8]], 0.6)),
      clip(bass, 'Bass', 5, 4, bassLine, 2),
      clip(eight, '808', 5, 4, roots.map((r, b): Step => [b * 16, r, 0.7, '4n']), 2),
      clip(drums, 'Drag', 5, 4, drag, 2),
      // The switch: up a minor third (Db), drumless at first, then the drums come back
      clip(rhodes, 'Switch', 13, 4, up(comp(hook), 3)),
      clip(cello, 'Switch', 13, 4, up(progression(['A#2', 'A2', 'G2', 'A2'], 16, '1n', 0.6), 3)),
      clip(bass, 'Bass', 15, 2, up(bassLine.filter(([s]) => s < 32), 3)),
      clip(drums, 'Back in', 15, 2, drag.filter(([s]) => s < 32)),
    ],
    [[1, 'Intro'], [5, 'Hook'], [9, 'Pre-hook'], [13, 'Switch']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

// ---------- Bedroom pop ----------

function bedroomPop(): ProjectSnapshot {
  const gtr = track('Guitar', 'cleanGuitar', { volume: -2, pan: -0.2, reverbSend: 0.2, fx: { chorus: { on: true, rate: 0.8, depth: 0.6, mix: 0.4 }, filter: { on: true, cutoff: 4500, slope: 12 } } });
  const rhodes = track('Rhodes', 'rhodes', { volume: -10, pan: 0.2, fx: { filter: { on: true, cutoff: 3000 } } });
  const bass = track('Bass', 'fingerBass', { volume: -7, fx: { compressor: { on: true, threshold: -20, ratio: 4 } } });
  const sax = track('Sax', 'saxophone', { volume: -3, reverbSend: 0.3, delaySend: 0.2, fx: { filter: { on: true, cutoff: 3500 } } });
  const pad = track('Pad', 'wavetable', { volume: -16, reverbSend: 0.4, fx: { filter: { on: true, cutoff: 1500 } } });
  const drums = track('Drums', 'drums', { volume: 1, fx: { filter: { on: true, cutoff: 7000 } } });

  // Cmaj7 - Bm7 - Em9 - Am7 / B7b9 in E minor (a minor v where pop would have a major V)
  const verse = [['C3', 'G3', 'B3', 'E4'], ['B2', 'F#3', 'A3', 'D4'], ['E3', 'G3', 'D4', 'F#4'], ['A2', 'E3', 'G3', 'C4']];
  const b7 = ['B2', 'D#3', 'A3', 'C4'];
  // The guitar strums low to high, a few ms apart
  const strum = (chord: string[], step: number, vel: number, len: string): Step[] => chord.map((n, i): Step => [step + i * 0.08, n, vel, len]);
  const comp = everyBar(4, (b): Step[] =>
    [0, 3, 6, 10, 13].flatMap((s, i) => strum(b === 3 && s >= 8 ? b7 : verse[b], s, i === 0 ? 0.7 : 0.55, i === 0 ? '8n.' : '8n'))
  );
  const roots = ['C2', 'B1', 'E2', 'A1'];
  const bassLine = everyBar(4, (b): Step[] => {
    const r = b === 3 ? ['A1', 'A1', 'A2', 'B1', 'B1', 'B2'] : [roots[b], roots[b], nameOf(midiOf(roots[b]) + 12), roots[b], nameOf(midiOf(roots[b]) + 7), roots[b]];
    return [0, 3, 6, 8, 11, 14].map((s, i): Step => [s, r[i], i === 0 ? 0.85 : 0.65, '8n']);
  });
  const lazy = beat([[D.kick, 'X..o......x.....'], [D.closedHat, 'xoxoxoxoxoxoxoxo'], [D.openHat, '..............o.'], [D.snare, '......g........g']], 0.8);
  const snares: Step[] = [[4.15, D.snare, 0.75], [12.09, D.snare, 0.72]];
  // The sax sits a touch behind the beat
  const sing = later(melody([[2, 'E4', 4], [6, 'G4', 2], [8, 'B4', 6], [14, 'A4', 2], [18, 'F#4', 4], [22, 'A4', 2], [24, 'D5', 4], [28, 'B4', 4], [34, 'G4', 4], [38, 'F#4', 2], [40, 'E4', 6], [46, 'D4', 2], [48, 'E4', 4], [52, 'C5', 4], [56, 'B4', 8]], 0.7), 0.1);
  // Chorus: I - vi - ii - III in G (the III pointing at the relative minor)
  const chorus = [['G3', 'B3', 'D4', 'F#4'], ['E3', 'G3', 'B3', 'D4', 'F#4'], ['A3', 'C4', 'E4', 'G4', 'B4'], ['B3', 'D#4', 'G4', 'A4']];
  return project(
    'Bedroom Pop starter',
    90,
    0.12,
    [5, 17],
    [gtr, rhodes, bass, sax, pad, drums],
    [
      clip(gtr, 'Verse', 1, 4, comp, 3),
      clip(drums, 'Lazy', 5, 1, [...lazy, ...snares], 8),
      clip(bass, 'Bass', 5, 4, bassLine, 2),
      clip(rhodes, 'Doubles', 5, 4, progression(verse, 16, '1n', 0.45), 2),
      clip(sax, 'Melody', 5, 4, sing, 2),
      clip(gtr, 'Chorus', 13, 4, everyBar(4, (b) => [0, 3, 6, 10, 13].flatMap((s, i) => strum(chorus[b].slice(0, 4), s, i === 0 ? 0.7 : 0.55, '8n')))),
      clip(pad, 'Chorus pad', 13, 4, progression(chorus, 16, '1n', 0.5)),
      clip(rhodes, 'Chorus', 13, 4, progression(chorus, 16, '1n', 0.5)),
      clip(bass, 'Chorus', 13, 4, pulse(['G1', 'E2', 'A1', 'B1'], [0, 6, 10], 3, 0.8)),
    ],
    [[1, 'Intro'], [5, 'Verse'], [13, 'Chorus']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

// ---------- Bossa jazz-pop ----------

function bossa(): ProjectSnapshot {
  const gtr = track('Nylon guitar', 'nylonGuitar', { volume: -2, eq: { low: 0, mid: 0, high: -5 }, fx: { filter: { on: true, cutoff: 3000, slope: 12 } } });
  const piano = track('Piano', 'piano', { volume: -3, pan: 0.25, reverbSend: 0.25 });
  const bass = track('Upright', 'uprightBass', { volume: -8, fx: { filter: { on: true, cutoff: 700 } } });
  const drums = track('Brushes', 'drums', { volume: -3, fx: { filter: { on: true, cutoff: 3000 } } });
  const flute = track('Flute', 'flute', { volume: -5, reverbSend: 0.25 });
  const strings = track('Strings', 'strings', { volume: -14, reverbSend: 0.4 });

  // Db major: Ebm9 - Ab13 - Dbmaj7 - D dim7 (a passing chord back up to ii)
  const verse = [['F#3', 'A#3', 'C#4', 'F4'], ['F#3', 'A#3', 'C4', 'F4'], ['C#3', 'F3', 'G#3', 'C4'], ['F3', 'G#3', 'B3', 'D4']];
  const roots = ['D#2', 'G#1', 'C#2', 'D2'];
  // The bossa comping rhythm over two bars, anticipating the next chord every other cycle
  const comp = (chords: string[][]) => everyBar(4, (b): Step[] => (b % 2 === 0 ? [0, 6, 12] : [4, 10]).map((s): Step => [s, chords[b], 0.55, '8n']));
  const bassLine = everyBar(4, (b): Step[] => [[0, roots[b], 0.8, '4n.'], [6, nameOf(midiOf(roots[b]) + 7), 0.6, '8n'], [8, nameOf(midiOf(roots[b]) + 7), 0.65, '4n.'], [14, roots[b], 0.6, '8n']]);
  const brushes = everyBar(2, (b): Step[] => [
    ...beat([[D.kick, 'o......oo......o'], [D.closedHat, 'gggggggggggggggg']], 0.5),
    ...(b === 0 ? [0, 6, 12] : [4, 10]).map((s): Step => [s, D.snare, 0.2]),
  ]);
  const tune = melody([[0, 'F5', 6], [6, 'C#5', 2], [8, 'A#4', 8], [16, 'C5', 4], [20, 'F5', 4], [24, 'D#5', 8], [32, 'C5', 6], [38, 'G#4', 2], [40, 'F4', 8], [48, 'G#4', 4], [52, 'B4', 4], [56, 'D5', 8]], 0.65);
  // Chorus: Ebm11 - Ab13 - Dbmaj9 - Gbmaj7
  const chorus = [['C#4', 'F#4', 'G#4', 'A#4'], ['F#3', 'A#3', 'C4', 'F4'], ['C4', 'D#4', 'F4', 'G#4'], ['F3', 'A#3', 'C#4']];
  const counter = everyBar(4, (b) => verse[b].map((n, i): Step => [8 + i * 2, nameOf(midiOf(n) + 12), 0.45, '8n']));
  return project(
    'Bossa Jazz-Pop starter',
    82,
    0,
    [5, 17],
    [gtr, piano, bass, drums, flute, strings],
    [
      clip(gtr, 'Verse', 1, 4, comp(verse), 3),
      clip(bass, 'Bass', 5, 4, bassLine, 2),
      clip(drums, 'Brushes', 5, 2, brushes, 6),
      clip(flute, 'Melody', 5, 4, tune, 2),
      clip(piano, 'Counter', 9, 4, counter),
      clip(gtr, 'Chorus', 13, 4, comp(chorus)),
      clip(strings, 'Chorus', 13, 4, progression(chorus, 16, '1n', 0.5)),
      clip(bass, 'Chorus', 13, 4, pulse(['D#2', 'G#1', 'C#2', 'F#1'], [0, 8], 6, 0.75)),
      clip(flute, 'Chorus', 13, 4, melody([[0, 'A#5', 8], [8, 'G#5', 8], [16, 'F#5', 8], [24, 'F5', 8], [32, 'F5', 6], [38, 'D#5', 2], [40, 'C5', 8], [48, 'C#5', 16]], 0.65)),
    ],
    [[1, 'Intro'], [5, 'Verse'], [13, 'Chorus']],
    master({ on: false }, { on: false })
  );
}

// ---------- City pop / fusion ----------

function cityPop(): ProjectSnapshot {
  const drums = track('Drums', 'drumMachine', { volume: -6, fx: { compressor: { on: true, threshold: -20, ratio: 4 } } });
  const slap = track('Slap bass', 'slappedBass', { volume: -2 });
  const ep = track('FM piano', 'fmPiano', { volume: -4, reverbSend: 0.2 });
  const rhodes = track('Rhodes', 'rhodes', { volume: -12, reverbSend: 0.25 });
  const cut = track('Cutting guitar', 'mutedGuitar', { volume: -9, pan: 0.3 });
  const brass = track('Horns', 'brassSection', { volume: -7, reverbSend: 0.2 });
  const sax = track('Sax', 'saxophone', { volume: -3, reverbSend: 0.25, delaySend: 0.1 });

  // A theme: Amaj9 - B13 - G#m7(11) - C#m9 in E
  const a = [['G#3', 'B3', 'C#4', 'E4'], ['A3', 'D#4', 'G#4'], ['F#3', 'B3', 'C#4', 'D#4'], ['E3', 'G#3', 'B3', 'D#4']];
  const aRoots = ['A2', 'B2', 'G#2', 'C#2'];
  // B theme: Amaj7 - G#7b13 - C#m9 - Bm9 to E9
  const b = [['G#3', 'C#4', 'E4'], ['F#3', 'C4', 'E4'], ['E3', 'G#3', 'B3', 'D#4'], ['D3', 'F#3', 'A3', 'C#4']];
  const bRoots = ['A2', 'G#2', 'C#2', 'B2'];
  // Slap: thumb on the root, pops an octave up, ghosted dead notes in between
  const slapLine = (roots: string[]) =>
    everyBar(4, (bar): Step[] => [
      ...[0, 3, 6, 8, 11, 12, 15].map((s): Step => [s, roots[bar], s === 0 ? 0.85 : 0.7, '16n']),
      ...[2, 5, 7, 10, 13, 14].map((s): Step => [s, nameOf(midiOf(roots[bar]) + 12), 0.6, '16n']),
    ]);
  const chops = (chords: string[][]) => everyBar(4, (bar): Step[] => [2, 6, 10, 14].flatMap((s): Step[] => [[s, chords[bar].slice(-2), 0.55, '32n'], [s + 0.5, chords[bar].slice(-2), 0.45, '32n']]));
  const tight = beat([[D.kick, 'X.....X...X....X'], [D.snare, '..g.X..g.g..X.g.'], [D.closedHat, 'xoxoxoxoxoxoxoxo'], [D.openHat, '..............o.']], 0.8);
  const themeA = melody([[0, 'C#5', 2], [2, 'E5', 2], [4, 'G#5', 6], [10, 'F#5', 2], [12, 'E5', 4], [16, 'D#5', 2], [18, 'F#5', 2], [20, 'G#5', 6], [26, 'F#5', 2], [28, 'D#5', 4], [32, 'B4', 2], [34, 'D#5', 2], [36, 'F#5', 6], [42, 'E5', 2], [44, 'D#5', 4], [48, 'E5', 8], [56, 'G#4', 4], [60, 'B4', 4]], 0.8);
  const themeB = melody([[0, 'C#5', 4], [4, 'E5', 4], [8, 'G#5', 8], [16, 'G#5', 4], [20, 'E5', 2], [22, 'C5', 2], [24, 'C5', 8], [32, 'B4', 4], [36, 'D#5', 4], [40, 'E5', 8], [48, 'F#5', 4], [52, 'E5', 4], [56, 'D5', 4], [60, 'G#4', 4]], 0.8);
  return project(
    'City Pop starter',
    113,
    0.04,
    [1, 17],
    [drums, slap, ep, rhodes, cut, brass, sax],
    [
      clip(drums, 'Groove', 1, 1, tight, 16),
      clip(slap, 'A', 1, 4, slapLine(aRoots), 2),
      clip(ep, 'A', 1, 4, stabs(a, [0, 7, 10], 3, 0.65), 2),
      clip(rhodes, 'A', 1, 4, progression(a, 16, '1n', 0.45), 2),
      clip(cut, 'Cutting', 1, 4, chops(a), 2),
      clip(sax, 'Theme A', 1, 4, themeA, 2),
      clip(slap, 'B', 9, 4, slapLine(bRoots)),
      clip(ep, 'B', 9, 4, stabs(b, [0, 7, 10], 3, 0.65)),
      clip(cut, 'Cutting', 9, 4, chops(b)),
      clip(sax, 'Theme B', 9, 4, themeB),
      clip(brass, 'Hits', 9, 4, stabs(b.map((c) => c.map((n) => nameOf(midiOf(n) + 12))), [14], 1, 0.7)),
      clip(slap, 'A', 13, 4, slapLine(aRoots)),
      clip(ep, 'A', 13, 4, stabs(a, [0, 7, 10], 3, 0.65)),
      clip(cut, 'Cutting', 13, 4, chops(a)),
      clip(sax, 'Theme A', 13, 4, themeA),
      clip(brass, 'Hits', 13, 4, stabs(a.map((c) => c.map((n) => nameOf(midiOf(n) + 12))), [7, 14], 1, 0.7)),
    ],
    [[1, 'Theme A'], [9, 'Theme B'], [13, 'Theme A']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

// ---------- Theatrical pop ----------

function theatrical(): ProjectSnapshot {
  const drums = track('Drums', 'drumMachine', { volume: -3, reverbSend: 0.25 });
  const bass = track('Bass', 'bassGuitar', { volume: -3 });
  const piano = track('Piano', 'piano', { volume: -2, reverbSend: 0.25 });
  const pizz = track('Pizzicato', 'pizzicato', { volume: -13, reverbSend: 0.3 });
  const harp = track('Harp', 'harp', { volume: -7, reverbSend: 0.4 });
  const box = track('Music box', 'musicBox', { volume: -10, reverbSend: 0.5 });
  const lead = track('Voice', 'lead', { volume: -2, reverbSend: 0.3, delaySend: 0.1 });
  const horns = track('Horns', 'trumpet', { volume: -8, reverbSend: 0.25 });
  const french = track('French horn', 'frenchHorn', { volume: -9, reverbSend: 0.3 });
  const pad = track('Pad', 'supersaw', { volume: -14, reverbSend: 0.3, fx: { pump: { on: true, depth: 0.4, release: 220, trigger: 'kick' } } });

  // Verse: the line cliche Dm - Dm(maj7) - Dm7 - Dm6, then Bbmaj7 - Gm7 - Eb/G (Neapolitan) - A7b9
  const verse = [['F3', 'A3', 'D4'], ['F3', 'A3', 'C#4'], ['F3', 'A3', 'C4'], ['F3', 'A3', 'B3'], ['D3', 'F3', 'A3'], ['F3', 'A#3', 'D4'], ['D#3', 'G3', 'A#3'], ['C#3', 'G3', 'A#3']];
  const vRoots = ['D2', 'D2', 'D2', 'D2', 'A#1', 'G1', 'G1', 'A1'];
  const verseTune = melody(
    [[0, 'A4', 4], [4, 'D5', 4], [8, 'F5', 6], [14, 'E5', 2], [16, 'E5', 8], [24, 'D5', 4], [28, 'C#5', 4], [32, 'C5', 4], [36, 'D5', 4], [40, 'F5', 6], [46, 'E5', 2], [48, 'D5', 8], [56, 'B4', 8],
      [64, 'A#4', 4], [68, 'D5', 4], [72, 'F5', 6], [78, 'A5', 2], [80, 'G5', 8], [88, 'F5', 4], [92, 'D5', 4], [96, 'D#5', 8], [104, 'D5', 4], [108, 'A#4', 4], [112, 'A4', 8], [120, 'C#5', 8]],
    0.75
  );
  // Chorus in F: F - C - Dm - Bb, ending on a glam turn Db - Eb back to F
  const chorus = [['A3', 'C4', 'F4'], ['G3', 'C4', 'E4'], ['A3', 'D4', 'F4'], ['A#3', 'D4', 'F4']];
  const cRoots = ['F2', 'C2', 'D2', 'A#1'];
  const chorusTune = melody([[0, 'C5', 4], [4, 'F5', 4], [8, 'A5', 6], [14, 'G5', 2], [16, 'G5', 8], [24, 'E5', 4], [28, 'C5', 4], [32, 'D5', 4], [36, 'F5', 4], [40, 'A5', 4], [44, 'D6', 4], [48, 'C6', 8], [56, 'A#5', 4], [60, 'A5', 4]], 0.85);
  const bounce = (roots: string[]) => everyBar(roots.length, (b): Step[] => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 2 ? nameOf(midiOf(roots[b]) + 12) : roots[b], i % 4 === 0 ? 0.8 : 0.6, '8n']));
  const verseBeat = beat([[D.kick, 'X.......X.X.....'], [D.snare, '....X.......X...'], [D.cowbell, '...o.......o....']], 0.8);
  const disco = beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X.......X...'], [D.openHat, '..x...x...x...x.'], [D.closedHat, 'x...x...x...x...']], 0.8);
  const turn: Step[] = [[0, ['C#3', 'C#4', 'F4', 'G#4'], 0.75, '2n'], [8, ['D#3', 'D#4', 'G4', 'A#4'], 0.8, '2n']];
  return project(
    'Theatrical Pop starter',
    132,
    0,
    [1, 17],
    [drums, bass, piano, pizz, harp, box, lead, horns, french, pad],
    [
      clip(drums, 'Verse', 1, 1, verseBeat, 8),
      clip(bass, 'Verse', 1, 8, bounce(vRoots)),
      clip(piano, 'Verse', 1, 8, stabs(verse, [0, 4, 8, 12], 3, 0.6)),
      clip(pizz, 'Verse', 1, 8, everyBar(8, (b) => verse[b].map((n, i): Step => [2 + i * 4, n, 0.55, '8n']))),
      clip(box, 'Leitmotif', 1, 1, melody([[0, 'D6', 4], [4, 'A5', 4], [8, 'F5', 4], [12, 'E5', 4]], 0.5)),
      clip(box, 'Leitmotif', 5, 1, melody([[0, 'D6', 4], [4, 'A5', 4], [8, 'F5', 4], [12, 'C#6', 4]], 0.5)),
      clip(lead, 'Verse', 1, 8, verseTune),
      clip(harp, 'Gliss', 8, 1, gliss(['A3', 'C#4', 'D4', 'E4', 'F4', 'G4', 'A4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'C6', 'D6', 'F6'], 8)),
      clip(drums, 'Disco', 9, 1, [[0, D.crash, 0.6] as Step, ...disco], 8),
      clip(bass, 'Chorus', 9, 4, bounce(cRoots), 2),
      clip(piano, 'Chorus', 9, 4, stabs(chorus, [0, 4, 8, 12], 3, 0.65)),
      clip(piano, 'Chorus', 13, 3, stabs(chorus.slice(0, 3), [0, 4, 8, 12], 3, 0.65)),
      clip(piano, 'Turn', 16, 1, turn),
      clip(pad, 'Chorus', 9, 4, progression(chorus, 16, '1n', 0.5), 2),
      clip(lead, 'Chorus', 9, 4, chorusTune),
      clip(lead, 'Chorus', 13, 3, chorusTune.filter(([s]) => s < 48)),
      clip(lead, 'Turn', 16, 1, melody([[0, 'G#5', 8], [8, 'A#5', 8]], 0.85)),
      clip(horns, 'Fanfare', 9, 4, stabs(chorus.map((c) => c.map((n) => nameOf(midiOf(n) + 12))), [0, 6, 12], 2, 0.6), 2),
      clip(french, 'Fanfare', 9, 4, stabs(chorus, [0, 6, 12], 2, 0.6), 2),
    ],
    [[1, 'Verse'], [9, 'Chorus']],
    master({ on: true, depth: 0.15 }, { on: true, amount: 1.15 })
  );
}

// ---------- Rap-rock ----------

function rapRock(): ProjectSnapshot {
  const gtrL = track('Guitar L', 'distortionGuitar', { volume: -7, pan: -0.65 });
  const gtrR = track('Guitar R', 'distortionGuitar', { volume: -8, pan: 0.65 });
  const bass = track('Bass', 'bassGuitar', { volume: -2 });
  const eight = track('808', 'bass808', { volume: -9 });
  const flow = track('Flow keys', 'keys', { volume: -2 });
  const chant = track('Chant', 'lead', { volume: 0, reverbSend: 0.2 });
  const tpt = track('Trumpet', 'trumpet', { volume: -8, reverbSend: 0.2 });
  const brass = track('Brass', 'brassSection', { volume: -8, reverbSend: 0.2 });
  const drums = track('Drums', 'acousticKit', { volume: -1 });
  const taiko = track('Taiko', 'taiko', { volume: -5 });

  // The verse riff: G, G, Ab, G, Db, C power chords (chromatic neighbours) in 8ths
  const pc = (r: string): string[] => [r, nameOf(midiOf(r) + 7)];
  const riff = everyBar(1, (): Step[] => ['G2', 'G2', 'G#2', 'G2', 'C#3', 'C3', 'G2', 'G2'].map((r, i): Step => [i * 2, pc(r), i % 4 === 0 ? 0.85 : 0.7, '8n']));
  const halfTime = beat([[D.kick, 'X.........X.....'], [D.snare, '........X....g..'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8);
  // The last verse bar stops dead on its final 16th
  const stop = beat([[D.kick, 'X.........X.....'], [D.snare, '........X.XXX...'], [D.closedHat, 'x.x.x.x.x.x.x...']], 0.8);
  // Chorus: Gm - Eb - Bb - F, double time, the chant in unison on lead, trumpet and brass
  const chords = ['G2', 'D#3', 'A#2', 'F2'];
  const chorusGtr = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, pc(chords[b]), i % 4 === 0 ? 0.85 : 0.7, '8n']));
  const chantLine = everyBar(4, (b): Step[] => (b === 3 ? [[0, 'D5', 0.85, '8n'], [2, 'C5', 0.8, '8n'], [4, 'A#4', 0.8, '8n'], [6, 'G4', 0.85, '4n']] : [[0, 'G4', 0.85, '8n'], [2, 'A#4', 0.8, '16n'], [3, 'C5', 0.8, '8n'], [6, 'D5', 0.85, '4n']]));
  const double = everyBar(4, (b): Step[] => [
    ...beat([[D.kick, 'X.X....XX.X.....'], [D.snare, '....X.......X...'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8),
    ...(b === 0 ? [[0, D.crash, 0.6] as Step] : []),
  ]);
  return project(
    'Rap-Rock starter',
    154,
    0,
    [9, 17],
    [gtrL, gtrR, bass, eight, flow, chant, tpt, brass, drums, taiko],
    [
      clip(gtrL, 'Riff', 1, 1, riff, 8),
      clip(gtrR, 'Riff', 1, 1, later(riff, 0.064), 8),
      clip(drums, 'Verse', 1, 1, halfTime, 7),
      clip(drums, 'Stop', 8, 1, stop),
      clip(bass, 'Riff', 1, 1, riff.map(([s, n, v, d]): Step => [s, nameOf(midiOf((n as string[])[0]) - 12), v, d]), 8),
      clip(eight, '808', 1, 1, [[0, 'G1', 0.8, '4n'], [10, 'G1', 0.7, '8n']], 8),
      clip(flow, 'Flow', 5, 1, Array.from({ length: 16 }, (_, i): Step => [i, i % 2 ? 'F4' : 'D4', i % 4 === 0 ? 0.45 : 0.35, '16n']), 4),
      clip(gtrL, 'Chorus', 9, 4, chorusGtr, 2),
      clip(gtrR, 'Chorus', 9, 4, later(chorusGtr, 0.064), 2),
      clip(bass, 'Chorus', 9, 4, everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, ['G1', 'D#2', 'A#1', 'F1'][b], 0.8, '8n'])), 2),
      clip(drums, 'Chorus', 9, 4, double, 2),
      clip(chant, 'Chant', 9, 4, chantLine, 2),
      clip(tpt, 'Chant', 9, 4, chantLine, 2),
      clip(brass, 'Chant', 9, 4, up(chantLine, -12), 2),
      clip(taiko, 'Hits', 9, 4, [[0, 'G2', 0.75], [16, 'G2', 0.65], [32, 'G2', 0.75], [48, 'G2', 0.65], [62, 'D2', 0.7], [63, 'A2', 0.75]], 2),
    ],
    [[1, 'Verse'], [9, 'Chorus']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.15 })
  );
}

// ---------- Math rock ----------

function mathRock(): ProjectSnapshot {
  const twinkle = track('Twinkle guitar', 'cleanGuitar', { volume: -2, pan: -0.3, reverbSend: 0.25 });
  const tap = track('Tapping guitar', 'cleanGuitar', { volume: -2, pan: 0.4, reverbSend: 0.2 });
  const marimba = track('Marimba', 'marimba', { volume: -9, reverbSend: 0.2 });
  const bass = track('Bass', 'bassGuitar', { volume: -2 });
  const tpt = track('Trumpet', 'trumpet', { volume: -6, reverbSend: 0.3 });
  const drums = track('Drums', 'acousticKit', { volume: -1 });

  // Amaj9 - E/G# - F#m11 - Cmaj7#11 (a borrowed bVI), B and E ringing on top
  const twinkles = broken(
    [['A2', 'E3', 'G#3', 'B3', 'E4', 'B4', 'E5', 'B4'], ['G#2', 'E3', 'B3', 'E4', 'G#4', 'B4', 'E5', 'B4'], ['F#2', 'E3', 'A3', 'B3', 'E4', 'B4', 'E5', 'B4'], ['C3', 'E3', 'G3', 'B3', 'F#4', 'B4', 'E5', 'B4']],
    2,
    6,
    0.6
  );
  // Tapping: six notes a beat (16th-note triplets) for two beats a bar
  const cell = ['E4', 'A4', 'B4', 'E5', 'B4', 'A4'];
  const tapping = everyBar(4, (): Step[] => Array.from({ length: 12 }, (_, i): Step => [(i * 2) / 3, cell[i % 6], i % 6 === 0 ? 0.7 : 0.55, '16n']));
  const roots = ['A1', 'G#1', 'F#1', 'C2'];
  const verseBeat = beat([[D.kick, 'X.......X.......'], [D.snare, '....X.......X...'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8);
  // Chorus: accents grouped 3+3+3+3+2+2 across the bar, guitar and bass stabbing with them
  const accents = [0, 3, 6, 9, 12, 14];
  const chorusBeat = beat([[D.kick, 'X.....X.....X...'], [D.snare, '...X.....X....X.'], [D.ride, 'x.x.x.x.x.x.x.x.']], 0.8);
  const chorusChords = [['A2', 'E3', 'G#3', 'B3'], ['G#2', 'E3', 'B3'], ['F#2', 'E3', 'A3', 'B3'], ['C3', 'E3', 'G3', 'B3']];
  // Breakdown: E chugs with the kick on every one
  const chugSteps = [0, 1, 2, 4, 5, 6, 8, 9, 12];
  const tune = melody([[0, 'G#4', 4], [4, 'B4', 4], [8, 'E5', 6], [14, 'D#5', 2], [16, 'E5', 4], [20, 'B4', 4], [24, 'G#4', 8], [32, 'A4', 4], [36, 'C#5', 4], [40, 'E5', 4], [44, 'F#5', 4], [48, 'G5', 8], [56, 'F#5', 8]], 0.7);
  return project(
    'Math Rock starter',
    150,
    0,
    [5, 17],
    [twinkle, tap, marimba, bass, tpt, drums],
    [
      clip(twinkle, 'Twinkle', 1, 4, twinkles, 2),
      clip(tap, 'Tapping', 5, 4, tapping),
      clip(marimba, 'Tapping', 5, 4, up(tapping, 12)),
      clip(bass, 'Verse', 5, 4, pulse(roots, [0, 6, 10], 4, 0.8)),
      clip(drums, 'Verse', 5, 1, verseBeat, 4),
      clip(tpt, 'Melody', 5, 4, tune),
      clip(twinkle, 'Chorus', 9, 4, stabs(chorusChords, accents, 2, 0.75)),
      clip(bass, 'Chorus', 9, 4, pulse(roots, accents, 2, 0.8)),
      clip(drums, 'Chorus', 9, 1, chorusBeat, 4),
      clip(tpt, 'Chorus', 9, 4, up(tune, 12).map(([s, n, v, d]): Step => [s, midiOf(n as string) > 84 ? nameOf(midiOf(n as string) - 12) : n, v, d])),
      clip(tap, 'Chugs', 13, 1, chugSteps.map((s): Step => [s, 'E2', 0.8, '16n']), 4),
      clip(bass, 'Chugs', 13, 1, chugSteps.map((s): Step => [s, 'E1', 0.8, '16n']), 4),
      clip(drums, 'Breakdown', 13, 1, [...chugSteps.map((s): Step => [s, D.kick, 0.75]), [4, D.snare, 0.9], [12, D.snare, 0.9]], 4),
    ],
    [[1, 'Intro'], [5, 'Verse'], [9, 'Chorus'], [13, 'Breakdown']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

export const PLAYLIST_BUILDERS = {
  artcore,
  hardcore,
  breakcore,
  rpg,
  metaldub: metalDubstep,
  melodicdub: melodicDubstep,
  riddim,
  futurebass: futureBass,
  phonk,
  drill,
  rage,
  neosoul: neoSoul,
  bedroom: bedroomPop,
  bossa,
  citypop: cityPop,
  theatrical,
  raprock: rapRock,
  mathrock: mathRock,
};
