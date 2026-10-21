import type { ProjectSnapshot } from './project';
import type { Step } from './demoSong';
import { everyBar } from './demoSong';
import { clip as baseClip, D, master, project, track } from './starterKit';
import { midiOf, nameOf } from './noteTools';
import { barsToDuration } from './timelineTypes';
import type { Clip, PeqBand, Track, TrackFx } from './timelineTypes';
import { INSTRUMENTS } from '../audio/instrumentCatalog';

/**
 * Two starters on the newer world recordings: a plaza groove on the Latin percussion with nylon
 * guitar and trumpet, and a morning in the garden on mbira, balafon, folk harp, hand chimes and a
 * didgeridoo drone. Every part plays a recorded instrument.
 */

// ---------- Helpers ----------

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

/** A melody: [step, note, length in 16ths], a little louder on the beats. */
const melody = (notes: Array<[number, string, number]>, vel = 0.8): Step[] =>
  notes.map(([s, n, len]): Step => [s, n, s % 4 === 0 ? vel : vel * 0.9, dur(len)]);

/** One chord per bar, played at `steps` of each bar. */
const stabs = (chords: string[][], steps: number[], len: number, vel = 0.7): Step[] =>
  everyBar(chords.length, (b) => steps.map((s): Step => [s, chords[b], s === steps[0] ? vel : vel * 0.85, dur(len)]));

/** `n` measures of `len` 16ths each, each from `fn`. */
const measures = (n: number, len: number, fn: (m: number) => Step[]): Step[] =>
  Array.from({ length: n }, (_, m) => fn(m).map(([s, x, v, d]): Step => [s + m * len, x, v, d])).flat();

const band = (type: PeqBand['type'], freq: number, gain = 0, q = Math.SQRT1_2): PeqBand => ({ on: true, type, freq, gain, q });
/** A Pro EQ, switched on, with these bands. */
const peq = (...bands: PeqBand[]): TrackFx['peq'] => ({ on: true, bands });
const lowCut = (hz: number) => band('lowcut', hz);
/** The Pro EQ for brass: no rumble, a little body, the top rounded off. */
const brassEq = () => peq(lowCut(100), band('bell', 300, 2, 1), band('highcut', 8000));

/** HUMAN at `amount`: timing as given, dynamics a little less. */
const human = (amount: number): TrackFx['human'] => ({ on: true, timing: amount, dynamics: amount * 0.6, pitch: 0 });

/** A track in a stem group (for the Game tab's stems). */
const grouped = (t: Track, stemGroup: 'Ambient' | 'Percussion' | 'Climax'): Track => ({ ...t, stemGroup });

/** The master reverb's lengths: Room, Studio. */
const ROOM = 1;
const STUDIO = 1.8;
/** The project with its master reverb set to a space. */
const inSpace = (p: ProjectSnapshot, reverbDecay: number): ProjectSnapshot => ({ ...p, masterFx: { reverbDecay, delayTime: p.masterFx?.delayTime ?? '8n', delayFeedback: p.masterFx?.delayFeedback ?? 0.35 } });

/**
 * A clip (see starterKit's clip) in its instrument's range: the whole part moved by octaves to
 * where most of it fits, then any note still outside folded in by octaves.
 */
function clip(t: Track, name: string, startBar: number, bars: number, steps: Step[], times = 1): Clip {
  const c = baseClip(t, name, startBar, bars, steps, times);
  const def = INSTRUMENTS[t.instrumentKey];
  if (!def?.range || def.kind === 'drums' || t.instrumentKey === 'fx' || !c.notes.length) return c;
  const [lo, hi] = def.range;
  const midis = c.notes.map((n) => midiOf(n.note));
  let best = 0;
  let bestFit = -1;
  for (const k of [0, 12, -12, 24, -24, 36, -36]) {
    const fit = midis.filter((m) => m + k >= lo && m + k <= hi).length;
    if (fit > bestFit) {
      best = k;
      bestFit = fit;
    }
  }
  const fold = (m: number) => {
    let x = m + best;
    while (x > hi && x - 12 >= lo) x -= 12;
    while (x < lo && x + 12 <= hi) x += 12;
    return x;
  };
  return { ...c, notes: c.notes.map((n, i) => ({ ...n, note: nameOf(fold(midis[i])) })) };
}

// ---------- Plaza: a Latin groove ----------

function plaza(): ProjectSnapshot {
  const guitar = track('Nylon guitar', 'realNylonGuitar', { volume: -7, pan: -0.25, reverbSend: 0.2, fx: { human: human(0.3) } });
  const bass = track('Upright bass', 'realUprightBass', { volume: -7, fx: { peq: peq(lowCut(35)), human: human(0.25) } });
  const trumpet = grouped(track('Trumpet', 'realTrumpet', { volume: -9, pan: 0.2, reverbSend: 0.35, distance: 0.3, fx: { peq: brassEq(), human: human(0.3) } }), 'Climax');
  const perc = grouped(track('Latin percussion', 'latinPercussion', { volume: -6, reverbSend: 0.15, fx: { human: human(0.3) } }), 'Percussion');
  const extras = grouped(track('Guiro & woodblock', 'percussionExtras', { volume: -13, pan: 0.35, reverbSend: 0.15, fx: { human: human(0.3) } }), 'Percussion');

  // A minor: Am - Dm - E7 - Am, then Dm - G - C - E7
  const verse = [['A3', 'C4', 'E4'], ['A3', 'D4', 'F4'], ['G#3', 'B3', 'E4'], ['A3', 'C4', 'E4']];
  const turn = [['A3', 'D4', 'F4'], ['G3', 'B3', 'D4'], ['G3', 'C4', 'E4'], ['G#3', 'B3', 'E4']];
  const vRoots = ['A1', 'D2', 'E2', 'A1'];
  const tRoots = ['D2', 'G1', 'C2', 'E2'];
  // A montuno: the chord pushed on the offbeats, its top note answering
  const montuno = (cs: string[][]) => stabs(cs, [2, 6, 10, 14], 2, 0.5);
  // The tumbao: the bass on the and of two and on four, anticipating the next chord
  const tumbao = (rs: string[]) => measures(rs.length, 16, (m) => [[6, rs[m], 0.7, dur(4)], [12, rs[(m + 1) % rs.length], 0.75, dur(4)]]);
  // Son clave 3-2 on the claves, a conga tumbao, bongo martillo, shaker 8ths
  const groove = beat([
    [D.clap, 'X..X...X....X.X.'.slice(0, 16)],
    [D.snare, '......X.X.....X.'],
    [D.kick, '..............x.'],
    [D.tomMid, 'x.o.x.o.x.o.x.o.'],
    [D.tomLow, '...x.......x....'],
    [D.closedHat, 'x.o.x.o.x.o.x.o.'],
  ], 0.7);
  const guiro = beat([['F1', 'X.......X.......'], ['D#1', '....o.......o...']], 0.6);
  const tune = melody([
    [0, 'E5', 4], [4, 'C5', 2], [6, 'D5', 2], [8, 'E5', 6], [14, 'A4', 2], [16, 'F5', 4], [20, 'E5', 2], [22, 'D5', 2], [24, 'A4', 8],
    [32, 'B4', 4], [36, 'D5', 2], [38, 'E5', 2], [40, 'G#4', 8], [48, 'A4', 12],
  ], 0.7);
  return inSpace(project(
    'Plaza starter',
    104,
    0,
    [1, 17],
    [guitar, bass, trumpet, perc, extras],
    [
      clip(perc, 'Groove', 1, 1, groove, 16),
      clip(guitar, 'Verse', 1, 4, montuno(verse), 2),
      clip(bass, 'Verse', 1, 4, tumbao(vRoots), 2),
      clip(extras, 'Guiro', 5, 1, guiro, 12),
      clip(guitar, 'Montuno', 9, 4, montuno([...turn]), 1),
      clip(bass, 'Montuno', 9, 4, tumbao(tRoots), 1),
      clip(guitar, 'Montuno', 13, 4, montuno(verse), 1),
      clip(bass, 'Montuno', 13, 4, tumbao(vRoots), 1),
      clip(trumpet, 'Theme', 9, 4, tune, 2),
    ],
    [[1, 'Verse'], [9, 'Montuno']],
    master({ on: false }, { on: true, amount: 1.1 })
  ), ROOM);
}

// ---------- Mbira Morning: a garden of world instruments ----------

function mbiraMorning(): ProjectSnapshot {
  const mbira = track('Mbira', 'realMbira', { volume: -6, pan: -0.2, reverbSend: 0.3, fx: { human: human(0.25) } });
  const balafon = track('Balafon', 'realBalafon', { volume: -10, pan: 0.3, reverbSend: 0.3, fx: { human: human(0.25) } });
  const harp = grouped(track('Folk harp', 'realFolkHarp', { volume: -10, pan: 0.1, reverbSend: 0.35, fx: { human: human(0.2) } }), 'Ambient');
  const drone = grouped(track('Didgeridoo', 'realDidgeridoo', { volume: -12, reverbSend: 0.3 }), 'Ambient');
  const chimes = grouped(track('Hand chimes', 'realHandChimes', { volume: -16, pan: -0.35, reverbSend: 0.5 }), 'Climax');
  const shaker = grouped(track('Shaker', 'latinPercussion', { volume: -15, pan: 0.2, reverbSend: 0.2, fx: { human: human(0.35) } }), 'Percussion');

  // D major pentatonic (D E F# A B), over a D drone: two interlocking mbira lines
  const left = ['D4', 'A4', 'F#4', 'A4', 'E4', 'A4', 'F#4', 'B4'];
  const right = ['B4', 'D5', 'A4', 'E5', 'F#4', 'D5', 'A4', 'E5'];
  const kalimba = measures(2, 16, (m) => Array.from({ length: 8 }, (_, i): Step => [i * 2, (m ? right : left)[i], i % 4 === 0 ? 0.6 : 0.45, dur(2)]));
  const answer = measures(2, 16, (m) => [[3, m ? 'F#5' : 'A5', 0.5, dur(2)], [7, m ? 'E5' : 'B5', 0.42, dur(2)], [11, m ? 'D5' : 'A5', 0.5, dur(2)], [15, 'F#5', 0.4, dur(1)]]);
  const harpChords = [['D3', 'A3', 'F#4'], ['B2', 'F#3', 'D4'], ['G2', 'D3', 'B3'], ['A2', 'E3', 'C#4']];
  const tune = melody([[0, 'A5', 8], [8, 'F#5', 4], [12, 'E5', 4], [16, 'D5', 8], [24, 'E5', 8], [32, 'F#5', 8], [40, 'A5', 4], [44, 'B5', 4], [48, 'A5', 16]], 0.55);
  return inSpace(project(
    'Mbira Morning starter',
    96,
    0,
    [1, 17],
    [mbira, balafon, harp, drone, chimes, shaker],
    [
      clip(drone, 'Drone', 1, 4, [[0, 'D2', 0.5, dur(64)]], 4),
      clip(mbira, 'Morning', 1, 2, kalimba, 8),
      clip(shaker, 'Shaker', 5, 1, beat([[D.closedHat, 'x.o.x.o.x.o.x.o.']], 0.6), 12),
      clip(harp, 'Morning', 5, 4, measures(4, 16, (m) => [[0, harpChords[m], 0.45, dur(16)]]), 3),
      clip(balafon, 'Answer', 9, 2, answer, 4),
      clip(chimes, 'Theme', 9, 4, tune, 2),
    ],
    [[1, 'Morning'], [9, 'Garden']],
    master({ on: false }, { on: true, amount: 1.05 })
  ), STUDIO + 0.5);
}

export const WORLD_BUILDERS = { plaza, mbiraMorning };
