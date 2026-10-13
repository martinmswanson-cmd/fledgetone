import type { ProjectSnapshot } from './project';
import type { Step } from './demoSong';
import { clip as baseClip, master, progression, project, track } from './starterKit';
import { KIT } from './startersPlaylist';
import { gameReady, grouped } from './startersGame';
import { DRUM_STYLES, drummer } from './smartTools';
import type { DrumStyle } from './smartTools';
import { midiOf, nameOf } from './noteTools';
import { uid } from './timelineTypes';
import type { AutomationPoint, Clip, Track } from './timelineTypes';
import { AUTOMATION } from '../audio/automation';
import { FX_NOTES, INSTRUMENTS } from '../audio/instrumentCatalog';

/**
 * More game starters, one for each place or mood game music keeps coming back to: an open field,
 * a starlit waltz, a swinging city, a quiet blocky world, a sparse wild field, an underwater waltz,
 * a desert market, a town counting down, a foggy town, a save room, a cathedral boss and an arena
 * of metal. Each is game-ready like the others (states, stem groups, transitions, stingers) and
 * shows off a piece of the vocabulary: borrowed chords, 3/4 and 6/8, swung 8ths, the new scales,
 * tempo changes between states, and automation that turns one arrangement into another.
 */

const { melody, broken, stabs, pulse, power, lowCut, peq, EQ, human, glue, drumBus, inSpace, ROOM, STUDIO, HALL, dur } = KIT;

// ---------- Helpers ----------

/**
 * A clip (see starterKit's clip) in its instrument's range: the whole part moved by octaves to
 * where most of it fits, then any note still outside folded in by octaves. (The recorded
 * instruments only go as high or low as their samples: a horn tune written for a synth would
 * otherwise sit above the real horn's top note.)
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

/** A note `semis` semitones up (down if negative). */
const tr = (n: string, semis: number) => nameOf(midiOf(n) + semis);
/** Every note of some steps moved by `semis`. */
const shift = (steps: Step[], semis: number): Step[] => steps.map(([s, n, v, d]): Step => [s, Array.isArray(n) ? n.map((x) => tr(x, semis)) : tr(n, semis), v, d]);
/** `n` measures of `len` 16ths each (12 in 3/4), each from `fn`. */
const measures = (n: number, len: number, fn: (m: number) => Step[]): Step[] =>
  Array.from({ length: n }, (_, m) => fn(m).map(([s, x, v, d]): Step => [s + m * len, x, v, d])).flat();
/** A drum part from the Drummer, as a clip (with the style's swing, in its time signature). */
function drumClip(t: Track, name: string, startBar: number, style: DrumStyle, count: number, intensity: number, fillEvery: number, seed: number, meter?: { num: number; den: number }): Clip {
  const def = DRUM_STYLES.find((d) => d.id === style)!;
  const m = meter ?? def.meter ?? { num: 4, den: 4 };
  const notes = drummer(style, count, intensity, fillEvery, seed, () => uid('note'), m);
  return { id: uid('clip'), trackId: t.id, name, startBar, lengthBars: count * (m.num / m.den), notes, isSelected: false, ...(def.groove ? { groove: def.groove } : {}) };
}
/** A clip with its own swing. */
const swung = (c: Clip, swing = 0.5, grid: 8 | 16 = 8): Clip => ({ ...c, groove: { swing, grid } });
/** The song in a time signature, with changes at bars. */
const inMeter = (p: ProjectSnapshot, num: number, den: number, changes: Array<[bar: number, num: number, den: number]> = []): ProjectSnapshot => ({
  ...p,
  meter: { num, den },
  meterPoints: changes.map(([bar, n, d]) => ({ id: uid('meter'), bar, num: n, den: d })),
});
/** Tempo changes (jumps) at bars. */
const withTempo = (p: ProjectSnapshot, changes: Array<[bar: number, bpm: number]>): ProjectSnapshot => ({
  ...p,
  tempoPoints: changes.map(([bar, bpm]) => ({ id: uid('tempo'), bar, bpm, ramp: false })),
});
/** A held chord per measure (`len` 16ths long). */
const held = (chords: string[][], len: number, vel = 0.5): Step[] => measures(chords.length, len, (m) => [[0, chords[m], vel, dur(len)]]);
/** An oom-pah-pah waltz: the root on one, the chord on two and three. */
const waltz = (roots: string[], chords: string[][], vel = 0.6): { bass: Step[]; chords: Step[] } => ({
  bass: measures(roots.length, 12, (m) => [[0, roots[m], vel, dur(4)]]),
  chords: measures(chords.length, 12, (m) => [[4, chords[m], vel * 0.75, dur(3)], [8, chords[m], vel * 0.7, dur(3)]]),
});
/** Each measure's notes rising in 8ths (a harp's arpeggio), `len` 16ths a measure. */
const rising = (bars: string[][], len: number, vel = 0.5): Step[] =>
  measures(bars.length, len, (m) => bars[m].slice(0, len / 2).map((n, i): Step => [i * 2, n, i === 0 ? vel + 0.1 : vel, dur(6)]));
/** A triplet pickup of three notes into step `to` (8th triplets). */
const triplet = (to: number, notes: [string, string, string]): Array<[number, string, number]> => notes.map((n, i): [number, string, number] => [to - 4 + (i * 4) / 3, n, 4 / 3]);
/** Every track (not buses or returns) `db` louder: levels the starters against each other. */
const boost = (p: ProjectSnapshot, db: number): ProjectSnapshot => ({
  ...p,
  tracks: p.tracks.map((t) => (t.instrumentKey === 'bus' || t.instrumentKey === 'return' ? t : { ...t, volume: t.volume + db })),
});
/** An automation lane's point for a cutoff in Hz. */
const cutoffAt = (bar: number, hz: number): AutomationPoint => ({ bar, value: AUTOMATION.filterCutoff.toNorm(hz) });

// ---------- Open field: a sunny overworld ----------

function openField(): ProjectSnapshot {
  const harp = grouped(track('Harp', 'realHarp', { volume: -10, pan: -0.25, reverbSend: 0.35, fx: { human: human(0.2) } }), 'Ambient');
  const strings = grouped(track('Strings', 'slowStrings', { volume: -14, reverbSend: 0.4, fx: { peq: EQ.pad(9000) } }), 'Ambient');
  const spicc = grouped(track('Violins short', 'realViolinsShort', { volume: -10, pan: 0.3, reverbSend: 0.3, fx: { human: human(0.25) } }), 'Tension');
  const horn = track('French horn', 'realHorn', { volume: -7, pan: -0.1, reverbSend: 0.4, fx: { peq: EQ.brass(), human: human(0.3, 0.1) } });
  const trumpet = grouped(track('Trumpet', 'realTrumpet', { volume: -9, pan: 0.15, reverbSend: 0.4, fx: { peq: EQ.brass(), human: human(0.3, 0.1) } }), 'Climax');
  const cello = track('Cellos', 'realCello', { volume: -10, pan: 0.2, reverbSend: 0.3, fx: { peq: peq(lowCut(40)), human: human(0.3) } });
  const kit = drumBus();
  const drums = grouped(track('Snare & kit', 'acousticKit', { volume: -9, output: kit.id, reverbSend: 0.2, fx: { peq: EQ.kit(), human: human(0.2) } }), 'Percussion');
  const timpani = grouped(track('Timpani', 'timpani', { volume: -11, reverbSend: 0.4 }), 'Percussion');

  // B flat: I - bVII - IV - I, then the borrowed bVI - bVII - I cadence (Mixolydian sun, a heroic landing)
  const pads = [['A#3', 'D4', 'F4'], ['G#3', 'C4', 'D#4'], ['G3', 'A#3', 'D#4'], ['A#3', 'D4', 'F4'], ['F#3', 'A#3', 'C#4'], ['G#3', 'C4', 'D#4'], ['A#3', 'D4', 'F4'], ['A#3', 'D4', 'F4']];
  const roots = ['A#2', 'G#2', 'D#2', 'A#2', 'F#2', 'G#2', 'A#2', 'A#2'];
  const tune = melody([
    [0, 'F4', 4], [4, 'A#4', 4], [8, 'D5', 6], [14, 'C5', 2],
    [16, 'D#5', 8], [24, 'C5', 4], ...triplet(32, ['G#4', 'A#4', 'C5']),
    [32, 'D5', 6], [38, 'D#5', 2], [40, 'G5', 8],
    [48, 'F5', 12], ...triplet(64, ['F4', 'G4', 'A4']),
    [64, 'A#4', 4], [68, 'C#5', 4], [72, 'F5', 8],
    [80, 'D#5', 6], [86, 'C5', 2], [88, 'G#4', 4], [92, 'C5', 4],
    [96, 'D5', 16], [112, 'D5', 8], ...triplet(128, ['A#4', 'C5', 'D5']),
  ], 0.75);
  const arps = pads.map((c) => [...c.map((n) => tr(n, -12)), ...c, tr(c[0], 12)]);
  // Battle: G minor (the relative minor), i - VI - VII - V, at the same tempo so it can cut in on a bar
  const battle = [['G3', 'A#3', 'D4'], ['D#3', 'G3', 'A#3'], ['F3', 'A3', 'C4'], ['F#3', 'A3', 'D4']];
  const battleRoots = ['G2', 'D#2', 'F2', 'D2'];
  const call = melody([[0, 'D5', 6], [6, 'A#4', 2], [8, 'G4', 4], [12, 'A#4', 4], [16, 'D#5', 8], [24, 'D5', 4], [28, 'C5', 4], [32, 'C5', 6], [38, 'D5', 2], [40, 'F5', 8], [48, 'F#5', 8], [56, 'A5', 8]], 0.85);
  return gameReady(
    inSpace(
      boost(project(
        'Open Field starter',
        132,
        0,
        [1, 9],
        [harp, strings, spicc, horn, trumpet, cello, drums, timpani, kit],
        [
          clip(harp, 'Explore', 1, 8, broken(arps, 2, 3, 0.45)),
          clip(strings, 'Explore', 1, 8, progression(pads, 16, '1n', 0.45)),
          clip(horn, 'Theme', 1, 8, tune),
          clip(trumpet, 'Theme (high)', 5, 4, shift(tune.filter(([s]) => s >= 64).map(([s, n, v, d]): Step => [s - 64, n, v * 0.9, d]), 12)),
          clip(cello, 'Explore', 1, 8, pulse(roots, [0, 6, 8, 14], 4, 0.55)),
          drumClip(drums, 'March', 1, 'march', 8, 0.35, 4, 11),
          clip(timpani, 'Explore', 1, 8, pulse(roots, [0], 8, 0.55)),
          clip(strings, 'Idle', 9, 4, progression([pads[0], pads[2], pads[0], pads[3]], 16, '1n', 0.6)),
          clip(harp, 'Idle', 9, 4, broken([arps[0], arps[2], arps[0], arps[3]].map((a) => a.slice(0, 4)), 4, 6, 0.55)),
          clip(cello, 'Idle', 9, 4, progression([roots[0], roots[2], roots[0], roots[3]].map((r) => tr(r, 12)), 16, '1n', 0.5)),
          clip(horn, 'Idle', 9, 4, melody([[0, 'F4', 12], [16, 'G4', 8], [24, 'D#4', 8], [32, 'D4', 16], [48, 'F4', 16]], 0.5)),
          clip(spicc, 'Battle', 13, 4, stabs(battle, [0, 2, 4, 6, 8, 10, 12, 14], 1, 0.55), 2),
          clip(cello, 'Battle', 13, 4, pulse(battleRoots, [0, 2, 4, 6, 8, 10, 12, 14], 1, 0.6), 2),
          clip(horn, 'Battle call', 13, 4, call, 2),
          clip(trumpet, 'Battle answer', 17, 4, shift(call, 12).map(([s, n, v, d]): Step => [s, n, v * 0.85, d])),
          clip(strings, 'Battle', 13, 4, progression(battle, 16, '1n', 0.5), 2),
          drumClip(drums, 'March', 13, 'march', 8, 0.85, 4, 12),
          clip(timpani, 'Battle', 13, 4, pulse(battleRoots.map((r) => tr(r, 12)), [0, 8, 12], 2, 0.7), 2),
        ],
        [[1, 'Explore'], [9, 'Idle'], [13, 'Battle']],
        master({ on: true, depth: 0.08 }, { on: true, amount: 1.2 })
      ), 2),
      HALL
    ),
    {
      key: [10, 'major'],
      rules: [
        ['Explore', 'Idle', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
        ['Idle', 'Explore', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
        ['*', 'Battle', { kind: 'fill', quantize: 'bar' }],
        ['Battle', 'Explore', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['item', 'levelUp', 'victory', 'gameOver'],
    }
  );
}

// ---------- Cosmic waltz: a starlit observatory in 3/4 ----------

function cosmicWaltz(): ProjectSnapshot {
  const harp = grouped(track('Harp', 'realHarp', { volume: -10, pan: -0.3, reverbSend: 0.45, fx: { human: human(0.2) } }), 'Ambient');
  const celesta = track('Celesta', 'celesta', { volume: -8, pan: 0.2, reverbSend: 0.5, fx: { peq: EQ.bells() } });
  const box = grouped(track('Music box', 'musicBox', { volume: -14, pan: 0.4, reverbSend: 0.55, fx: { peq: EQ.bells() } }), 'Ambient');
  const pizz = grouped(track('Pizzicato', 'realPizzicato', { volume: -12, pan: 0.15, reverbSend: 0.35, fx: { human: human(0.25) } }), 'Tension');
  const bass = track('Double bass', 'realDoubleBass', { volume: -11, reverbSend: 0.3, fx: { peq: peq(lowCut(35)), human: human(0.2) } });
  const strings = grouped(track('Violins', 'realViolins', { volume: -13, reverbSend: 0.45, fx: { peq: EQ.pad(9000) } }), 'Climax');
  const voices = grouped(track('Voices', 'voiceOohs', { volume: -15, reverbSend: 0.55, fx: { peq: EQ.choir() } }), 'Climax');
  const horn = grouped(track('French horn', 'realHorn', { volume: -9, pan: -0.1, reverbSend: 0.45, fx: { peq: EQ.brass(), human: human(0.3, 0.1) } }), 'Climax');
  const glock = grouped(track('Glockenspiel', 'realGlockenspiel', { volume: -16, pan: 0.35, reverbSend: 0.5 }), 'Percussion');
  const timpani = grouped(track('Timpani', 'timpani', { volume: -13, reverbSend: 0.45 }), 'Percussion');

  // E flat with a Lydian A natural: Ebmaj7 - Abmaj7 - Ebmaj7 - F/Eb - Cm7 - Abmaj7 - Bb - Bb, in 3/4
  const chords = [['D#3', 'G3', 'A#3', 'D4'], ['G#3', 'C4', 'D#4', 'G4'], ['D#3', 'G3', 'A#3', 'D4'], ['F3', 'A3', 'C4', 'D#4'], ['C3', 'D#3', 'G3', 'A#3'], ['G#3', 'C4', 'D#4', 'G4'], ['A#3', 'D4', 'F4', 'A#4'], ['A#3', 'D4', 'F4', 'G#4']];
  const roots = ['D#2', 'G#1', 'D#2', 'D#2', 'C2', 'G#1', 'A#1', 'A#1'];
  const w = waltz(roots, chords.map((c) => c.slice(1).map((n) => tr(n, 12))), 0.6);
  const arps = chords.map((c) => [...c.map((n) => tr(n, -12)), ...c.slice(0, 2)]);
  const tune = melody([[0, 'A#5', 8], [8, 'G5', 4], [12, 'C6', 8], [20, 'A#5', 4], [24, 'G5', 12], [36, 'A5', 8], [44, 'C6', 4], [48, 'A#5', 8], [56, 'G5', 4], [60, 'D#6', 8], [68, 'C6', 4], [72, 'D6', 12], [84, 'F5', 8], [92, 'A#5', 4]], 0.6);
  const sparkle = measures(8, 12, (m) => (m % 2 ? [[10, tr(chords[m][3], 24), 0.4, dur(2)]] : [[6, tr(chords[m][2], 24), 0.4, dur(2)]]));
  // Flight: 4/4, up a whole step to F, a Lydian lift (F - G/F) and a big sweep
  const flight = [['F3', 'A3', 'C4', 'E4'], ['G3', 'B3', 'D4', 'F4'], ['F3', 'A3', 'C4', 'E4'], ['G3', 'B3', 'D4', 'F4'], ['D3', 'F3', 'A3', 'C4'], ['A#3', 'D4', 'F4', 'A4'], ['C4', 'E4', 'G4', 'A#4'], ['C4', 'E4', 'G4', 'C5']];
  const flightRoots = ['F2', 'F2', 'F2', 'F2', 'D2', 'A#1', 'C2', 'C2'];
  const soar = melody([[0, 'C5', 6], [6, 'E5', 2], [8, 'A5', 8], [16, 'B5', 6], [22, 'A5', 2], [24, 'G5', 8], [32, 'A5', 4], [36, 'C6', 4], [40, 'E6', 8], [48, 'D6', 12], [60, 'B5', 4], [64, 'A5', 8], [72, 'F5', 8], [80, 'A#5', 6], [86, 'A5', 2], [88, 'F5', 8], [96, 'G5', 16], [112, 'C6', 16]], 0.75);
  const flightArps = flight.map((c) => [...c, ...c.map((n) => tr(n, 12))]);
  return gameReady(
    inSpace(
      inMeter(
        project(
          'Cosmic Waltz starter',
          100,
          0,
          [1, 7],
          [harp, celesta, box, pizz, bass, strings, voices, horn, glock, timpani],
          [
            clip(harp, 'Observatory', 1, 6, rising(arps, 12, 0.42)),
            clip(celesta, 'Theme', 1, 6, tune),
            clip(bass, 'Waltz', 1, 6, w.bass, 2),
            clip(pizz, 'Waltz', 1, 6, w.chords, 2),
            clip(box, 'Sparkle', 1, 6, sparkle, 2),
            clip(harp, 'Restored', 7, 6, rising(arps, 12, 0.48)),
            clip(celesta, 'Theme', 7, 6, tune),
            clip(strings, 'Restored', 7, 6, held(chords.map((c) => c.slice(1)), 12, 0.45)),
            clip(voices, 'Restored', 7, 6, held(chords.map((c) => c.slice(0, 3).map((n) => tr(n, 12))), 12, 0.4)),
            clip(horn, 'Counter', 7, 6, shift(tune, -12).map(([s, n, v, d]): Step => [s + 2, n, v * 0.85, d])),
            clip(glock, 'Stars', 7, 6, sparkle),
            clip(timpani, 'Swell', 11.5, 1.5, [[0, 'A#2', 0.3, '16n'], [2, 'A#2', 0.35, '16n'], [4, 'A#2', 0.4, '16n'], [6, 'A#2', 0.45, '16n'], [8, 'A#2', 0.5, '16n'], [10, 'A#2', 0.55, '16n'], [12, 'A#2', 0.6, '16n'], [14, 'A#2', 0.65, '16n'], [16, 'A#2', 0.7, '16n'], [18, 'A#2', 0.75, '16n'], [20, 'A#2', 0.8, '16n'], [22, 'A#2', 0.85, '16n']]),
            clip(harp, 'Flight', 13, 8, broken(flightArps, 2, 2, 0.5)),
            clip(strings, 'Flight', 13, 8, progression(flight.map((c) => c.slice(1)), 16, '1n', 0.5)),
            clip(horn, 'Soar', 13, 8, shift(soar, -12)),
            clip(celesta, 'Soar', 13, 8, soar.map(([s, n, v, d]): Step => [s, n, v * 0.7, d])),
            clip(bass, 'Flight', 13, 8, pulse(flightRoots, [0, 8], 8, 0.6)),
            clip(voices, 'Flight', 17, 4, progression(flight.slice(4).map((c) => c.slice(0, 3).map((n) => tr(n, 12))), 16, '1n', 0.45)),
            clip(timpani, 'Flight', 13, 8, pulse(flightRoots.map((r) => tr(r, 12)), [0, 12], 4, 0.6)),
          ],
          [[1, 'Observatory'], [7, 'Restored'], [13, 'Flight']],
          master({ on: false }, { on: true, amount: 1.25 })
        ),
        3,
        4,
        [[13, 4, 4]]
      ),
      HALL + 2
    ),
    {
      key: [3, 'major'],
      rules: [
        ['Observatory', 'Restored', { kind: 'crossfade', quantize: 'bar', beats: 6 }],
        ['Restored', 'Observatory', { kind: 'crossfade', quantize: 'bar', beats: 6 }],
        ['*', 'Flight', { kind: 'riser', quantize: 'bar' }],
        ['Flight', '*', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['item', 'levelUp', 'victory'],
    }
  );
}

// ---------- Big band city: a swinging festival town ----------

function bigBandCity(): ProjectSnapshot {
  const piano = track('Piano', 'realUprightPiano', { volume: -12, pan: -0.2, reverbSend: 0.2, fx: { peq: EQ.piano(), human: human(0.3) } });
  const bass = track('Upright bass', 'realUprightBass', { volume: -8, fx: { peq: peq(lowCut(35)), human: human(0.25) } });
  const kit = drumBus(-20);
  const drums = grouped(track('Drums', 'acousticKit', { volume: -10, output: kit.id, reverbSend: 0.15, fx: { peq: EQ.kit(), human: human(0.25) } }), 'Percussion');
  const alto = track('Alto sax', 'realAltoSax', { volume: -9, pan: 0.15, reverbSend: 0.25, fx: { human: human(0.35, 0.15) } });
  const tenor = grouped(track('Tenor sax', 'tenorSax', { volume: -12, pan: -0.1, reverbSend: 0.25, fx: { human: human(0.35, 0.15) } }), 'Tension');
  const trumpets = grouped(track('Trumpets', 'realTrumpet', { volume: -10, pan: 0.3, reverbSend: 0.3, fx: { peq: EQ.brass(), human: human(0.3, 0.1) } }), 'Climax');
  const bones = grouped(track('Trombones', 'realTrombone', { volume: -11, pan: -0.3, reverbSend: 0.3, fx: { peq: EQ.brass(), human: human(0.3, 0.1) } }), 'Climax');
  const muted = grouped(track('Muted trumpet', 'mutedTrumpet', { volume: -14, pan: 0.4, reverbSend: 0.25 }), 'Ambient');

  // C: ii7 - V7 - Imaj7 - VI7 | ii7 - V7 - I6 - I6 (a swinging ii-V-I), then the festival a whole step up
  const comp = [['F3', 'A3', 'C4', 'E4'], ['F3', 'B3', 'D4', 'G4'], ['E3', 'G3', 'B3', 'D4'], ['G3', 'C#4', 'E4', 'G4'], ['F3', 'A3', 'C4', 'E4'], ['F3', 'B3', 'D4', 'G4'], ['E3', 'G3', 'A3', 'C4'], ['E3', 'G3', 'A3', 'D4']];
  const walk = [['D2', 'F2', 'A2', 'C3'], ['G2', 'B2', 'D3', 'C#3'], ['C2', 'E2', 'G2', 'B2'], ['A2', 'G2', 'E2', 'C#2'], ['D2', 'E2', 'F2', 'F#2'], ['G2', 'A2', 'B2', 'G2'], ['C2', 'D2', 'E2', 'G2'], ['A2', 'G2', 'D2', 'G#1']];
  const walking = walk.flatMap((bar, b) => bar.map((n, i): Step => [b * 16 + i * 4, n, i === 0 ? 0.75 : 0.62, dur(3.5)]));
  const charleston = stabs(comp, [0, 6], 1.5, 0.5);
  const head = melody([[0, 'A4', 2], [2, 'C5', 2], [4, 'E5', 4], [8, 'D5', 2], [10, 'C5', 4], [14, 'B4', 2], [16, 'D5', 2], [18, 'F5', 2], [20, 'A5', 4], [24, 'G5', 6], [32, 'E5', 2], [34, 'G5', 2], [36, 'B5', 4], [40, 'A5', 2], [42, 'G5', 4], [46, 'E5', 2], [48, 'G5', 8], [56, 'A4', 2], [58, 'C#5', 2], [60, 'E5', 4], [64, 'D5', 2], [66, 'F5', 2], [68, 'A5', 4], [72, 'G5', 2], [74, 'F5', 4], [78, 'D5', 2], [80, 'F5', 2], [82, 'A5', 2], [84, 'B5', 4], [88, 'G5', 8], [96, 'E5', 2], [98, 'G5', 2], [100, 'A5', 4], [104, 'C6', 6], [112, 'A5', 4], [116, 'G5', 4], [120, 'E5', 8]], 0.7);
  const thirds = shift(head, -4).map(([s, n, v, d]): Step => [s, n, v * 0.85, d]);
  const shout = stabs(comp.map((c) => c.map((n) => tr(n, 12))), [0, 3, 6, 14], 1.5, 0.75);
  const sw = (c: Clip) => swung(c, 0.5, 8);
  return gameReady(
    inSpace(
      project(
        'Big Band City starter',
        145,
        0,
        [1, 9],
        [piano, bass, drums, alto, tenor, trumpets, bones, muted, kit],
        [
          sw(clip(piano, 'Comping', 1, 8, charleston)),
          sw(clip(bass, 'Walk', 1, 8, walking)),
          drumClip(drums, 'Swing', 1, 'swing', 8, 0.45, 8, 21),
          sw(clip(alto, 'Head', 1, 8, head)),
          sw(clip(tenor, 'Head (thirds below)', 1, 8, thirds)),
          sw(clip(muted, 'Fills', 1, 8, melody([[28, 'G5', 2], [30, 'E5', 2], [60, 'A5', 2], [62, 'G5', 2], [92, 'F5', 2], [94, 'D5', 2], [124, 'G5', 4]], 0.5))),
          sw(clip(piano, 'Comping', 9, 8, shift(charleston, 2))),
          sw(clip(bass, 'Walk', 9, 8, shift(walking, 2))),
          drumClip(drums, 'Swing', 9, 'swing', 8, 0.85, 4, 22),
          sw(clip(alto, 'Festival', 9, 8, shift(head, 2))),
          sw(clip(tenor, 'Festival', 9, 8, shift(thirds, 2))),
          sw(clip(trumpets, 'Shout', 9, 8, shift(shout, 2))),
          sw(clip(bones, 'Shout', 9, 8, shift(shout.map(([s, n, v, d]): Step => [s, (n as string[]).map((x) => tr(x, -12)), v * 0.9, d]), 2))),
        ],
        [[1, 'Head'], [9, 'Festival']],
        master({ on: false }, { on: true, amount: 1.1 })
      ),
      STUDIO
    ),
    {
      key: [0, 'major'],
      rules: [
        ['Head', 'Festival', { kind: 'fill', quantize: 'bar' }],
        ['Festival', 'Head', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['item', 'levelUp', 'victory'],
    }
  );
}

// ---------- Quiet world: a calm, blocky open world ----------

function quietWorld(): ProjectSnapshot {
  const piano = track('Soft piano', 'realGrandPiano', { volume: -9, reverbSend: 0.55, fx: { peq: EQ.piano(), human: human(0.35, 0.05) } });
  const keys = grouped(track('Electric piano', 'rhodes', { volume: -15, pan: -0.2, reverbSend: 0.5, fx: { human: human(0.3) } }), 'Ambient');
  const pad = grouped(track('Glass pad', 'glassPad', { volume: -19, reverbSend: 0.5, fx: { peq: EQ.pad(7000) } }), 'Ambient');
  const halo = grouped(track('Halo pad', 'haloPad', { volume: -21, reverbSend: 0.55, fx: { peq: EQ.pad(6000) } }), 'Tension');

  // C: Cmaj7 - Fmaj7, a calm vamp; then Am7 - Fmaj7 - Cmaj7 - G6 for the second cue. Few notes, long rests.
  const vamp = [['E3', 'G3', 'B3', 'D4'], ['F3', 'A3', 'C4', 'E4']];
  const second = [['G3', 'C4', 'E4'], ['A3', 'C4', 'E4'], ['G3', 'B3', 'E4'], ['G3', 'B3', 'E4']];
  const cueA = melody([[0, 'E5', 8], [12, 'G5', 4], [16, 'D5', 12], [40, 'C5', 8], [48, 'E5', 4], [52, 'G5', 4], [56, 'A5', 16], [96, 'G5', 8], [104, 'E5', 12]], 0.45);
  const cueB = melody([[4, 'A4', 4], [8, 'C5', 8], [24, 'B4', 8], [36, 'E5', 12], [64, 'D5', 4], [68, 'E5', 4], [72, 'G5', 16], [100, 'D5', 4], [104, 'B4', 16]], 0.42);
  const lowNotes = measures(8, 16, (m) => [[0, m % 2 ? 'F2' : 'C3', 0.4, dur(16)]]);
  return gameReady(
    inSpace(
      boost(project(
        'Quiet World starter',
        76,
        0,
        [1, 9],
        [piano, keys, pad, halo],
        [
          clip(piano, 'Cue A', 1, 8, [...cueA, ...lowNotes]),
          clip(keys, 'Cue A', 1, 8, held([...vamp, ...vamp, ...vamp, ...vamp], 16, 0.32)),
          clip(pad, 'Cue A', 1, 8, held([vamp[0], vamp[0], vamp[1], vamp[1], vamp[0], vamp[0], vamp[1], vamp[1]].map((c) => c.slice(1)), 16, 0.3)),
          clip(piano, 'Cue B', 9, 8, [...cueB, ...measures(8, 16, (m) => [[0, ['A2', 'F2', 'C3', 'G2'][Math.floor(m / 2)], 0.4, dur(16)]])]),
          clip(keys, 'Cue B', 9, 8, held(second.flatMap((c) => [c, c]), 16, 0.3)),
          clip(halo, 'Cue B', 9, 8, held(second.flatMap((c) => [c, c]).map((c) => c.map((n) => tr(n, 12))), 16, 0.25)),
          clip(pad, 'Rest', 17, 4, held([['C4', 'G4'], ['C4', 'G4'], ['C4', 'G4'], ['C4', 'G4']], 16, 0.2)),
        ],
        [[1, 'Cue A'], [9, 'Cue B'], [17, 'Rest']],
        master({ on: false }, { on: true, amount: 1.3 })
      ), 8),
      HALL + 2
    ),
    {
      key: [0, 'major'],
      rules: [
        ['*', 'Rest', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['Rest', '*', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['Cue A', 'Cue B', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['Cue B', 'Cue A', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['item', 'checkpoint'],
    }
  );
}

// ---------- Wild field: sparse day, night, riding ----------

function wildField(): ProjectSnapshot {
  const piano = track('Piano', 'realGrandPiano', { volume: 0, reverbSend: 0.5, fx: { peq: EQ.piano(), human: human(0.4, 0.05) } });
  const birds = grouped(track('Birds', 'birdTweet', { volume: -26, pan: 0.4, reverbSend: 0.4 }), 'Ambient');
  const wind = grouped(track('Wind', 'seashore', { volume: -28, reverbSend: 0.2 }), 'Ambient');
  const celesta = track('Celesta', 'celesta', { volume: -11, pan: 0.2, reverbSend: 0.55, fx: { peq: EQ.bells() } });
  const strings = grouped(track('Violins', 'realViolins', { volume: -15, reverbSend: 0.5, fx: { peq: EQ.pad(8000) } }), 'Tension');
  const horn = grouped(track('French horn', 'realHorn', { volume: -11, pan: -0.15, reverbSend: 0.45, fx: { peq: EQ.brass(), human: human(0.3, 0.1) } }), 'Climax');
  const cellos = grouped(track('Cellos', 'realCello', { volume: -13, pan: 0.2, reverbSend: 0.35, fx: { peq: peq(lowCut(40)), human: human(0.3) } }), 'Tension');

  // D major pentatonic with a Lydian G#: dabs of piano with whole bars of air between them
  const day = melody([[0, 'A5', 2], [2, 'F#5', 2], [4, 'E5', 6], [20, 'B5', 2], [22, 'A5', 6], [80, 'D6', 2], [82, 'B5', 2], [84, 'G#5', 8], [100, 'F#5', 2], [102, 'E5', 2], [104, 'A5', 10]], 0.7);
  const dayLow = [[0, ['D3', 'A3'], 0.35, dur(16)], [80, ['B2', 'F#3'], 0.35, dur(16)]] as Step[];
  const chirps = measures(8, 16, (m) => (m % 3 === 1 ? [[6, 'C5', 0.4, dur(2)], [7, 'D5', 0.35, dur(2)]] : []));
  // Night: slower (a tempo change), celesta and violins over the same harmony
  const night = melody([[0, 'F#5', 8], [8, 'A5', 8], [16, 'G#5', 16], [40, 'E5', 8], [48, 'D5', 16], [72, 'B4', 8], [80, 'C#5', 8], [88, 'E5', 8], [96, 'D5', 24]], 0.4);
  const nightPads = [['D4', 'F#4', 'A4'], ['D4', 'F#4', 'A4'], ['E4', 'G#4', 'B4'], ['E4', 'G#4', 'B4'], ['B3', 'D4', 'F#4'], ['B3', 'D4', 'F#4'], ['G3', 'B3', 'D4'], ['A3', 'C#4', 'E4']];
  // Riding: faster, 16th piano chords, a horn tune
  const ride = [['D4', 'F#4', 'A4'], ['E4', 'G#4', 'B4'], ['B3', 'D4', 'F#4'], ['G3', 'B3', 'D4'], ['D4', 'F#4', 'A4'], ['E4', 'G#4', 'B4'], ['G3', 'B3', 'E4'], ['A3', 'C#4', 'E4']];
  const rideRoots = ['D2', 'E2', 'B1', 'G1', 'D2', 'E2', 'G1', 'A1'];
  const gallop = measures(8, 16, (m) => [0, 3, 4, 7, 8, 11, 12, 15].map((s, i): Step => [s, ride[m], i % 2 ? 0.45 : 0.58, dur(1)]));
  const rideTune = melody([[0, 'A4', 6], [6, 'D5', 2], [8, 'F#5', 8], [16, 'G#5', 6], [22, 'F#5', 2], [24, 'E5', 8], [32, 'D5', 4], [36, 'F#5', 4], [40, 'B5', 8], [48, 'A5', 12], [64, 'A4', 6], [70, 'D5', 2], [72, 'F#5', 8], [80, 'B5', 6], [86, 'A5', 2], [88, 'G#5', 8], [96, 'E5', 8], [104, 'G5', 8], [112, 'A5', 16]], 0.75);
  return gameReady(
    withTempo(
      inSpace(
        boost(project(
          'Wild Field starter',
          72,
          0,
          [1, 9],
          [piano, birds, wind, celesta, strings, horn, cellos],
          [
            clip(piano, 'Day', 1, 8, [...day, ...dayLow]),
            clip(birds, 'Day', 1, 8, chirps),
            clip(wind, 'Day', 1, 8, [[0, 'C4', 0.3, '8:0:0']]),
            clip(celesta, 'Night', 9, 8, night),
            clip(strings, 'Night', 9, 8, progression(nightPads, 16, '1n', 0.35)),
            clip(wind, 'Night', 9, 8, [[0, 'C4', 0.22, '8:0:0']]),
            clip(piano, 'Night', 9, 8, measures(8, 16, (m) => [[0, tr(nightPads[m][0], -12), 0.35, dur(16)]])),
            clip(piano, 'Riding', 17, 8, gallop),
            clip(cellos, 'Riding', 17, 8, pulse(rideRoots.map((r) => tr(r, 12)), [0, 8], 8, 0.55)),
            clip(strings, 'Riding', 17, 8, progression(ride, 16, '1n', 0.45)),
            clip(horn, 'Riding', 17, 8, shift(rideTune, -12)),
          ],
          [[1, 'Day'], [9, 'Night'], [17, 'Riding']],
          master({ on: false }, { on: true, amount: 1.3 })
        ), 2),
        HALL
      ),
      [[9, 61], [17, 96]]
    ),
    {
      key: [2, 'major'],
      rules: [
        ['Day', 'Night', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['Night', 'Day', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['*', 'Riding', { kind: 'crossfade', quantize: 'beat', beats: 2 }],
        ['Riding', '*', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['item', 'checkpoint', 'danger'],
    }
  );
}

// ---------- Underwater waltz: the same music, then deeper (a low-pass) ----------

function underwaterWaltz(): ProjectSnapshot {
  const water = track('Water bus', 'bus', {
    fx: { filter: { on: true, type: 'lowpass', cutoff: 16000, resonance: 0.9, slope: 24 }, reverb: { on: true, mix: 0.15 } },
    automation: [
      { param: 'filterCutoff', points: [cutoffAt(1, 16000), cutoffAt(6.99, 16000), cutoffAt(7, 850), cutoffAt(13, 850)] },
      { param: 'fx:reverb.mix', points: [{ bar: 1, value: 0.15 }, { bar: 6.99, value: 0.15 }, { bar: 7, value: 0.5 }, { bar: 13, value: 0.5 }] },
    ],
  });
  const harp = grouped(track('Harp', 'realHarp', { volume: -10, pan: -0.3, output: water.id, reverbSend: 0.4, fx: { human: human(0.2) } }), 'Ambient');
  const vibes = track('Vibraphone', 'vibraphone', { volume: -10, pan: 0.2, output: water.id, reverbSend: 0.4, fx: { chorus: { on: true, mix: 0.4 }, human: human(0.25) } });
  const pad = grouped(track('Glass pad', 'glassPad', { volume: -18, output: water.id, reverbSend: 0.5, fx: { peq: EQ.pad(7000) } }), 'Ambient');
  const flute = grouped(track('Flute', 'realFlute', { volume: -9, pan: 0.1, output: water.id, reverbSend: 0.45, fx: { human: human(0.3, 0.1) } }), 'Climax');
  const pizz = grouped(track('Pizzicato bass', 'realPizzicato', { volume: -10, output: water.id, reverbSend: 0.3, fx: { human: human(0.2) } }), 'Tension');

  // F Lydian in 3/4: Fmaj7 - G/F - Fmaj7 - G/F - Dm7 - Em7 - Fmaj7 - G
  const chords = [['A3', 'C4', 'E4'], ['G3', 'B3', 'D4'], ['A3', 'C4', 'E4'], ['G3', 'B3', 'D4'], ['F3', 'A3', 'C4'], ['G3', 'B3', 'D4'], ['A3', 'C4', 'E4'], ['G3', 'B3', 'D4']];
  const roots = ['F2', 'F2', 'F2', 'F2', 'D2', 'E2', 'F2', 'G2'];
  const w = waltz(roots, chords, 0.55);
  const arps = chords.map((c, m) => [roots[m].replace('2', '3'), ...c, ...c.map((n) => tr(n, 12))]);
  const tune = melody([[0, 'C5', 8], [8, 'A4', 4], [12, 'B4', 12], [24, 'C5', 4], [28, 'E5', 4], [32, 'G5', 4], [36, 'F#5', 12], [48, 'F5', 8], [56, 'E5', 4], [60, 'D5', 12], [72, 'E5', 4], [76, 'G5', 4], [80, 'C6', 4], [84, 'B5', 12]], 0.6);
  const section = (at: number, label: string): Clip[] => [
    clip(pizz, label, at, 6, w.bass),
    clip(vibes, label, at, 6, w.chords),
    clip(harp, label, at, 6, rising(arps, 12, 0.4)),
    clip(pad, label, at, 6, held(chords, 12, 0.3)),
    clip(flute, label, at, 6, tune),
  ];
  return gameReady(
    inSpace(
      inMeter(
        project('Underwater Waltz starter', 84, 0, [1, 7], [harp, vibes, pad, flute, pizz, water], [...section(1, 'Shore'), ...section(7, 'Deep')], [[1, 'Shore'], [7, 'Deep']], master({ on: false }, { on: true, amount: 1.3 })),
        3,
        4
      ),
      HALL
    ),
    {
      key: [5, 'major'],
      rules: [
        ['Shore', 'Deep', { kind: 'crossfade', quantize: 'bar', beats: 6 }],
        ['Deep', 'Shore', { kind: 'crossfade', quantize: 'bar', beats: 6 }],
      ],
      stingers: ['item', 'checkpoint'],
    }
  );
}

// ---------- Desert bazaar: Phrygian dominant over a drone, desert hand drums ----------

function desertBazaar(): ProjectSnapshot {
  const drone = grouped(track('Drone', 'sitar', { volume: -17, reverbSend: 0.4, fx: { peq: EQ.pad(7000) } }), 'Ambient');
  const dulcimer = track('Dulcimer', 'dulcimer', { volume: -12, pan: -0.25, reverbSend: 0.35, fx: { human: human(0.25) } });
  const reed = track('Shehnai', 'shanai', { volume: -11, pan: 0.15, reverbSend: 0.4, fx: { human: human(0.35, 0.2) } });
  const flute = grouped(track('Flute', 'panFlute', { volume: -12, pan: 0.25, reverbSend: 0.5, fx: { human: human(0.3, 0.15) } }), 'Ambient');
  const drums = grouped(track('Hand drums', 'bongos', { volume: -8, reverbSend: 0.2, fx: { human: human(0.3) } }), 'Percussion');
  const kit = grouped(track('Low drums', 'acousticKit', { volume: -11, reverbSend: 0.3, fx: { peq: EQ.kit(), human: human(0.2) } }), 'Percussion');
  const strings = grouped(track('Strings', 'realViolinsShort', { volume: -13, reverbSend: 0.3, fx: { human: human(0.25) } }), 'Tension');
  const brass = grouped(track('Trombones', 'realTromboneShort', { volume: -11, reverbSend: 0.35, fx: { peq: EQ.brass() } }), 'Climax');
  const bass = track('Bass', 'fretlessBass', { volume: -11, fx: { peq: peq(lowCut(35)) } });

  // E Phrygian dominant (E F G# A B C D): E - F - E - E | Dm - F - E - E
  const harmony = ['E', 'F', 'E', 'E', 'D', 'F', 'E', 'E'];
  const bassNotes = ['E2', 'F2', 'E2', 'E2', 'D2', 'F2', 'E2', 'E2'];
  const ost = measures(8, 16, (m) => {
    const r = bassNotes[m].replace('2', '4');
    const third = harmony[m] === 'E' ? 'G#4' : harmony[m] === 'F' ? 'A4' : 'F4';
    return [0, 2, 3, 6, 8, 10, 11, 14].map((s, i): Step => [s, i % 4 === 0 ? r : i % 2 ? third : tr(r, 7), i % 4 === 0 ? 0.62 : 0.45, dur(1)]);
  });
  const tune = melody([[0, 'E5', 3], [3, 'F5', 1], [4, 'G#5', 4], [8, 'A5', 2], [10, 'G#5', 2], [12, 'F5', 4], [16, 'E5', 8], [24, 'F5', 2], [26, 'E5', 2], [28, 'D5', 4], [32, 'E5', 6], [38, 'G#5', 2], [40, 'B5', 4], [44, 'A5', 2], [46, 'G#5', 2], [48, 'A5', 4], [52, 'G#5', 4], [56, 'F5', 4], [60, 'E5', 4], [64, 'D5', 3], [67, 'E5', 1], [68, 'F5', 4], [72, 'A5', 8], [80, 'G#5', 4], [84, 'F5', 4], [88, 'E5', 8], [96, 'F5', 2], [98, 'G#5', 2], [100, 'A5', 2], [102, 'B5', 2], [104, 'C6', 4], [108, 'B5', 4], [112, 'G#5', 4], [116, 'F5', 4], [120, 'E5', 8]], 0.7);
  // Ruins: night, sparse: the drone, a breathy flute, a frame drum now and then
  const ruins = melody([[0, 'B4', 12], [16, 'C5', 4], [20, 'B4', 4], [24, 'G#4', 8], [48, 'A4', 8], [56, 'G#4', 4], [60, 'F4', 4], [64, 'E4', 16], [96, 'F4', 4], [100, 'G#4', 4], [104, 'B4', 12]], 0.5);
  // Danger: battle drums, string 16ths on E and F, trombone stabs
  const danger = measures(8, 16, (m) => {
    const r = m % 4 === 1 ? 'F3' : m % 4 === 3 ? 'D3' : 'E3';
    return Array.from({ length: 16 }, (_, s): Step => [s, s % 4 === 0 ? tr(r, 12) : s % 2 ? r : tr(r, 7), s % 4 === 0 ? 0.62 : 0.45, dur(1)]);
  });
  const stabsLow = measures(8, 16, (m) => [[0, power(m % 4 === 1 ? 'F2' : 'E2'), 0.75, dur(3)], [6, power(m % 4 === 1 ? 'F2' : 'E2'), 0.6, dur(2)], [12, power(m % 4 === 3 ? 'D2' : 'F2'), 0.7, dur(3)]]);
  return gameReady(
    inSpace(
      boost(project(
        'Desert Bazaar starter',
        116,
        0,
        [1, 9],
        [drone, dulcimer, reed, flute, drums, kit, strings, brass, bass],
        [
          clip(drone, 'Market', 1, 8, [[0, ['E2', 'B2', 'E3'], 0.45, '8:0:0']]),
          clip(dulcimer, 'Market', 1, 8, ost),
          clip(reed, 'Market tune', 1, 8, tune),
          drumClip(drums, 'Maqsum', 1, 'maqsum', 8, 0.6, 4, 31),
          clip(bass, 'Market', 1, 8, pulse(bassNotes, [0, 6, 8], 2, 0.6)),
          clip(drone, 'Ruins', 9, 8, [[0, ['E2', 'B2'], 0.35, '8:0:0']]),
          clip(flute, 'Ruins', 9, 8, ruins),
          drumClip(drums, 'Frame drum', 9, 'maqsum', 8, 0.1, 0, 32),
          clip(drone, 'Danger', 17, 8, [[0, ['E2', 'B2', 'E3'], 0.45, '8:0:0']]),
          clip(strings, 'Danger', 17, 8, danger),
          clip(brass, 'Danger', 17, 8, stabsLow),
          drumClip(kit, 'Battle', 17, 'battle', 8, 0.8, 4, 33),
          drumClip(drums, 'Maqsum', 17, 'maqsum', 8, 0.9, 0, 34),
          clip(reed, 'Danger tune', 21, 4, tune.filter(([s]) => s < 64)),
          clip(bass, 'Danger', 17, 8, pulse(bassNotes, [0, 3, 6, 8, 11, 14], 1.5, 0.65)),
        ],
        [[1, 'Market'], [9, 'Ruins'], [17, 'Danger']],
        master({ on: true, depth: 0.08 }, { on: true, amount: 1.2 })
      ), 4),
      STUDIO
    ),
    {
      key: [4, 'major'],
      rules: [
        ['Market', 'Ruins', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['Ruins', 'Market', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
        ['*', 'Danger', { kind: 'impact', quantize: 'bar' }],
        ['Danger', '*', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['item', 'danger', 'victory', 'gameOver'],
    }
  );
}

// ---------- Countdown town: one tune, three days, faster and darker each day ----------

function countdownTown(): ProjectSnapshot {
  const accordion = track('Accordion', 'accordion', { volume: -10, pan: -0.15, reverbSend: 0.3, fx: { human: human(0.3, 0.1) } });
  const pizz = grouped(track('Pizzicato', 'realPizzicato', { volume: -12, pan: 0.25, reverbSend: 0.3, fx: { human: human(0.25) } }), 'Ambient');
  const clarinet = grouped(track('Clarinet', 'realClarinet', { volume: -12, pan: 0.2, reverbSend: 0.35, fx: { human: human(0.3, 0.1) } }), 'Tension');
  const marimba = grouped(track('Marimba', 'realMarimba', { volume: -13, pan: -0.3, reverbSend: 0.3, fx: { human: human(0.25) } }), 'Ambient');
  const tick = grouped(track('Clock', 'woodblock', { volume: -18, pan: 0.4, reverbSend: 0.2 }), 'Percussion');
  const bass = track('Bass', 'realUprightBass', { volume: -9, fx: { peq: peq(lowCut(35)), human: human(0.2) } });
  const drums = grouped(track('Drums', 'acousticKit', { volume: -11, reverbSend: 0.2, fx: { peq: EQ.kit(), human: human(0.2) } }), 'Percussion');
  const brass = grouped(track('Low brass', 'realTrombone', { volume: -12, reverbSend: 0.35, fx: { peq: EQ.brass() } }), 'Climax');

  // The tune as scale degrees (0 = G), re-sung in G major, G Dorian and G Phrygian
  const MODES = { major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10] };
  const deg = (d: number, mode: number[], base = 67) => nameOf(base + 12 * Math.floor(d / 7) + mode[((d % 7) + 7) % 7]);
  const shape: Array<[number, number, number]> = [[0, 4, 2], [2, 2, 2], [4, 0, 4], [8, 1, 2], [10, 2, 2], [12, 4, 4], [16, 5, 2], [18, 4, 2], [20, 2, 4], [24, 0, 8], [32, 4, 2], [34, 5, 2], [36, 7, 4], [40, 6, 2], [42, 5, 2], [44, 4, 4], [48, 2, 2], [50, 1, 2], [52, 0, 4], [56, -1, 4], [60, 0, 4]];
  const tuneIn = (mode: number[]) => melody(shape.map(([s, d, l]) => [s, deg(d, mode), l]), 0.72);
  const chordIn = (mode: number[], degrees: number[]) => degrees.map((d) => [d, d + 2, d + 4].map((x) => deg(x, mode, 55)));
  const prog = [0, 3, 4, 0];
  const day = (mode: number[], at: number, energy: number, style: DrumStyle, seed: number): Clip[] => [
    clip(accordion, 'Tune', at, 4, tuneIn(mode), 2),
    clip(pizz, 'Chords', at, 4, stabs(chordIn(mode, prog), [0, 4, 8, 12], 2, 0.5), 2),
    clip(marimba, 'Offbeats', at, 4, stabs(chordIn(mode, prog).map((c) => c.map((n) => tr(n, 12))), [2, 6, 10, 14], 1, 0.42), 2),
    clip(bass, 'Bass', at, 4, pulse(prog.map((d) => deg(d, mode, 43)), [0, 8], 6, 0.6), 2),
    clip(tick, 'Clock', at, 1, [0, 4, 8, 12].map((s): Step => [s, 'C5', s === 0 ? 0.6 : 0.45]), 8),
    drumClip(drums, 'Drums', at, style, 8, energy, 4, seed),
  ];
  return gameReady(
    withTempo(
      inSpace(
        project(
          'Countdown Town starter',
          112,
          0,
          [1, 9],
          [accordion, pizz, clarinet, marimba, tick, bass, drums, brass],
          [
            ...day(MODES.major, 1, 0.25, 'march', 41),
            ...day(MODES.dorian, 9, 0.5, 'rock', 42),
            clip(clarinet, 'Worry', 9, 4, shift(tuneIn(MODES.dorian), -12).map(([s, n, v, d]): Step => [s + 2, n, v * 0.75, d]), 2),
            ...day(MODES.phrygian, 17, 0.85, 'battle', 43),
            clip(clarinet, 'Worry', 17, 4, shift(tuneIn(MODES.phrygian), -12).map(([s, n, v, d]): Step => [s + 2, n, v * 0.8, d]), 2),
            clip(brass, 'Doom', 17, 4, stabs(chordIn(MODES.phrygian, [0, 1, 0, 6]).map((c) => c.map((n) => tr(n, -12))), [0, 6], 4, 0.65), 2),
          ],
          [[1, 'Day 1'], [9, 'Day 2'], [17, 'Final Hours']],
          master({ on: true, depth: 0.06 }, { on: true, amount: 1.15 })
        ),
        ROOM
      ),
      [[9, 124], [17, 140]]
    ),
    {
      key: [7, 'major'],
      rules: [
        ['Day 1', 'Day 2', { kind: 'stinger', quantize: 'bar', stingerId: 'danger' }],
        ['Day 2', 'Final Hours', { kind: 'stinger', quantize: 'bar', stingerId: 'danger' }],
        ['*', 'Day 1', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['danger', 'checkpoint', 'victory', 'gameOver'],
    }
  );
}

// ---------- Fog town: rusty, lonely, industrial ----------

function fogTown(): ProjectSnapshot {
  const fog = grouped(track('Fog', 'goblins', { volume: -17, reverbSend: 0.55, fx: { peq: EQ.pad(5000) } }), 'Ambient');
  const noise = grouped(track('Static', 'seashore', { volume: -24, fx: { lofi: { on: true, crush: 0.6, mix: 0.8 } } }), 'Ambient');
  const mandolin = track('Mandolin', 'mandolin', { volume: -13, pan: 0.25, reverbSend: 0.5, fx: { lofi: { on: true, wow: 0.4, mix: 0.4 }, human: human(0.3, 0.15) } });
  const kit = grouped(track('Breakbeat', 'breakbeatKit', { volume: -10, reverbSend: 0.25, fx: { lofi: { on: true, crush: 0.3, mix: 0.4 }, compressor: glue(-20) } }), 'Percussion');
  const guitar = grouped(track('Distorted guitar', 'distortionGuitar', { volume: -14, pan: -0.25, reverbSend: 0.4, fx: { peq: peq(lowCut(90)), lofi: { on: true, crush: 0.25, mix: 0.35 } } }), 'Climax');
  const sub = grouped(track('Sub', 'subBass', { volume: -12, fx: { peq: EQ.sub() } }), 'Tension');
  const clean = track('Clean guitar', 'cleanGuitar', { volume: -11, pan: -0.15, reverbSend: 0.55, fx: { human: human(0.35, 0.1) } });

  // E Phrygian: E - F, the half step that never resolves
  const scrape = measures(8, 16, (m) => (m % 2 ? [[8, ['F4', 'E5'], 0.35, dur(8)]] : [[0, ['E4', 'B4'], 0.35, dur(12)]]));
  const tremolo = (notes: string[], bars: number): Step[] => measures(bars, 16, (m) => Array.from({ length: 16 }, (_, s): Step => [s, notes[m % notes.length], 0.32 + (s % 4 === 0 ? 0.08 : 0), dur(1)]));
  const lament = melody([[0, 'B4', 6], [6, 'C5', 2], [8, 'B4', 4], [12, 'G4', 4], [16, 'A4', 12], [32, 'G4', 6], [38, 'F4', 2], [40, 'E4', 8], [48, 'F4', 4], [52, 'G4', 4], [56, 'E4', 8], [64, 'B4', 6], [70, 'D5', 2], [72, 'C5', 8], [80, 'B4', 4], [84, 'A4', 4], [88, 'G4', 8], [96, 'A4', 4], [100, 'G4', 4], [104, 'F4', 8], [112, 'E4', 16]], 0.55);
  const arp = measures(8, 16, (m) => {
    const c = [['E3', 'G3', 'B3', 'E4'], ['F3', 'A3', 'C4', 'E4'], ['D3', 'G3', 'B3', 'D4'], ['E3', 'G3', 'B3', 'E4']][m % 4];
    return [0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Step => [s, c[[0, 2, 1, 3, 2, 1, 3, 2][i]], i === 0 ? 0.5 : 0.38, dur(3)]);
  });
  return gameReady(
    inSpace(
      boost(project(
        'Fog Town starter',
        88,
        0,
        [1, 9],
        [fog, noise, mandolin, kit, guitar, sub, clean],
        [
          clip(fog, 'Fog', 1, 8, [[0, ['E3', 'F3', 'B3'], 0.4, '8:0:0']]),
          clip(noise, 'Fog', 1, 8, [[0, 'C4', 0.3, '8:0:0']]),
          clip(mandolin, 'Fog', 1, 8, scrape),
          swung(drumClip(kit, 'Sparse break', 1, 'hiphop', 8, 0.15, 0, 51), 0.3, 16),
          clip(fog, 'Otherworld', 9, 8, [[0, ['E2', 'F2', 'A#2', 'B2'], 0.5, '8:0:0']]),
          clip(noise, 'Otherworld', 9, 8, [[0, 'C4', 0.5, '8:0:0']]),
          clip(guitar, 'Wall', 9, 8, tremolo(['E3', 'E3', 'F3', 'E3', 'E3', 'F3', 'A#2', 'E3'].map((n) => n), 8).map(([s, n, v, d]): Step => [s, power(n as string), v + 0.1, d])),
          swung(drumClip(kit, 'Break', 9, 'hiphop', 8, 0.85, 4, 52), 0.3, 16),
          clip(sub, 'Otherworld', 9, 8, pulse(['E1', 'E1', 'F1', 'E1', 'E1', 'F1', 'A#0', 'E1'], [0, 10], 6, 0.6)),
          clip(clean, 'Lament', 17, 8, [...arp, ...shift(lament, 0).map(([s, n, v, d]): Step => [s, n, v, d])]),
          clip(fog, 'Lament', 17, 8, [[0, ['E3', 'B3'], 0.3, '8:0:0']]),
        ],
        [[1, 'Fog'], [9, 'Otherworld'], [17, 'Lament']],
        master({ on: true, depth: 0.08 }, { on: true, amount: 1.25 })
      ), 4),
      HALL + 4
    ),
    {
      key: [4, 'minor'],
      rules: [
        ['Fog', 'Otherworld', { kind: 'impact', quantize: 'bar' }],
        ['Otherworld', 'Fog', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['*', 'Lament', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['danger', 'checkpoint', 'gameOver'],
    }
  );
}

// ---------- Save room: two chords, safe for now ----------

function saveRoom(): ProjectSnapshot {
  const keys = track('Electric piano', 'rhodes', { volume: -11, reverbSend: 0.5, fx: { human: human(0.3), chorus: { on: true, mix: 0.25 } } });
  const pad = grouped(track('Glass pad', 'glassPad', { volume: -18, reverbSend: 0.55, fx: { peq: EQ.pad(6000) } }), 'Ambient');
  const piano = grouped(track('Piano', 'realGrandPiano', { volume: -12, pan: 0.15, reverbSend: 0.55, fx: { peq: EQ.piano(), human: human(0.35, 0.05) } }), 'Tension');
  const bass = track('Bass', 'fretlessBass', { volume: -14, fx: { peq: peq(lowCut(35)) } });
  const trem = grouped(track('Tremolo strings', 'realTremolo', { volume: -17, reverbSend: 0.5, fx: { peq: EQ.pad(5000) } }), 'Tension');
  const beat = grouped(track('Heartbeat', 'acousticKit', { volume: -16, reverbSend: 0.4, fx: { peq: EQ.kit() } }), 'Percussion');

  // A minor: Am9 - Fmaj7, and never quite home (the 9th and the major 7th keep it hanging)
  const chords = [['G3', 'B3', 'C4', 'E4'], ['E3', 'A3', 'C4', 'E4'], ['A3', 'C4', 'E4', 'G4'], ['E3', 'A3', 'C4', 'E4']];
  const tune = melody([[0, 'E5', 8], [8, 'D5', 4], [12, 'C5', 4], [16, 'B4', 12], [32, 'C5', 4], [36, 'B4', 4], [40, 'A4', 8], [48, 'G4', 4], [52, 'A4', 12], [64, 'E5', 8], [72, 'G5', 4], [76, 'E5', 4], [80, 'D5', 12], [96, 'C5', 4], [100, 'B4', 4], [104, 'A4', 4], [108, 'B4', 4], [112, 'C5', 16]], 0.45);
  const amFmaj = [chords[1], chords[0], chords[1], chords[0], chords[1], chords[0], chords[1], chords[2]];
  return gameReady(
    inSpace(
      boost(project(
        'Save Room starter',
        66,
        0,
        [1, 9],
        [keys, pad, piano, bass, trem, beat],
        [
          clip(keys, 'Safe', 1, 8, measures(8, 16, (m) => [[0, amFmaj[m], 0.42, dur(10)], [10, amFmaj[m].slice(2), 0.3, dur(6)]])),
          clip(pad, 'Safe', 1, 8, held(amFmaj.map((c) => c.map((n) => tr(n, 12)).slice(1)), 16, 0.25)),
          clip(piano, 'Safe', 1, 8, tune),
          clip(bass, 'Safe', 1, 8, pulse(['A1', 'F1', 'A1', 'F1', 'A1', 'F1', 'A1', 'F1'], [0], 14, 0.45)),
          // Uneasy: the same two chords, a low tremolo a half step off, a faint heartbeat
          clip(keys, 'Uneasy', 9, 8, measures(8, 16, (m) => [[0, amFmaj[m], 0.36, dur(14)]])),
          clip(trem, 'Uneasy', 9, 8, measures(8, 16, (m) => [[0, m % 2 ? ['F3', 'A#3'] : ['E3', 'F3'], 0.4, dur(16)]])),
          clip(piano, 'Uneasy', 9, 8, tune.filter(([st]) => st < 32 || (st >= 64 && st < 96))),
          clip(bass, 'Uneasy', 9, 8, pulse(['A1', 'A#1', 'A1', 'A#1', 'A1', 'A#1', 'A1', 'A#1'], [0], 14, 0.45)),
          drumClip(beat, 'Heartbeat', 9, 'heartbeat', 8, 0.2, 0, 81),
        ],
        [[1, 'Safe'], [9, 'Uneasy']],
        master({ on: false }, { on: true, amount: 1.2 })
      ), 3),
      HALL
    ),
    {
      key: [9, 'minor'],
      rules: [
        ['Safe', 'Uneasy', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['Uneasy', 'Safe', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['checkpoint', 'item', 'danger'],
    }
  );
}

// ---------- Cathedral boss: a dark waltz, three phases and a lament ----------

function cathedralBoss(): ProjectSnapshot {
  const choir = grouped(track('Choir', 'choir', { volume: -11, reverbSend: 0.55, fx: { peq: EQ.choir() } }), 'Climax');
  const organ = track('Chapel organ', 'realChapelOrgan', { volume: -14, reverbSend: 0.5 });
  const cellos = grouped(track('Cellos short', 'realCelloShort', { volume: -10, pan: 0.2, reverbSend: 0.35, fx: { human: human(0.25) } }), 'Tension');
  const bones = grouped(track('Trombones', 'realTrombone', { volume: -11, pan: -0.25, reverbSend: 0.45, fx: { peq: EQ.brass() } }), 'Climax');
  const tuba = grouped(track('Tuba', 'realTuba', { volume: -12, reverbSend: 0.35 }), 'Climax');
  const violin = track('Solo violin', 'realSoloViolin', { volume: -10, pan: 0.15, reverbSend: 0.5, fx: { human: human(0.35, 0.15) } });
  const timpani = grouped(track('Timpani', 'timpani', { volume: -9, reverbSend: 0.45 }), 'Percussion');
  const kit = grouped(track('Toms & cymbals', 'acousticKit', { volume: -13, reverbSend: 0.4, fx: { peq: EQ.kit() } }), 'Percussion');
  const bells = grouped(track('Chimes', 'chimes', { volume: -16, reverbSend: 0.55 }), 'Ambient');
  const piano = track('Piano', 'realGrandPiano', { volume: -2, reverbSend: 0.55, fx: { peq: EQ.piano(), human: human(0.35, 0.05) } });

  // D harmonic minor in 3/4: Dm - A - Dm - Bb - Gm - A - Dm - A
  const chords = [['D3', 'F3', 'A3'], ['C#3', 'E3', 'A3'], ['D3', 'F3', 'A3'], ['D3', 'F3', 'A#3'], ['D3', 'G3', 'A#3'], ['C#3', 'E3', 'A3'], ['D3', 'F3', 'A3'], ['C#3', 'E3', 'A3']];
  const roots = ['D2', 'A1', 'D2', 'A#1', 'G1', 'A1', 'D2', 'A1'];
  const ostinato = measures(8, 12, (m) => Array.from({ length: 6 }, (_, i): Step => [i * 2, i % 3 === 0 ? roots[m].replace('1', '2').replace(/2$/, '3') : chords[m][i % 3], i === 0 ? 0.72 : 0.5, dur(2)]));
  const theme = melody([[0, 'D5', 8], [8, 'E5', 4], [12, 'C#5', 12], [24, 'D5', 4], [28, 'F5', 4], [32, 'A5', 4], [36, 'A#5', 8], [44, 'A5', 4], [48, 'G5', 8], [56, 'F5', 4], [60, 'E5', 12], [72, 'D5', 4], [76, 'F5', 4], [80, 'E5', 4], [84, 'C#5', 12]], 0.75);
  const timp = measures(8, 12, (m) => [[0, roots[m].replace('1', '2'), 0.7, dur(4)], ...(m % 2 ? [[8, roots[m].replace('1', '2'), 0.5, dur(2)] as Step, [10, roots[m].replace('1', '2'), 0.55, dur(2)] as Step] : [])]);
  // Phase 2: a half step up (E flat minor), with a sudden B minor (a third away) where Bb stood
  const up = (s: Step[]) => shift(s, 1);
  const shock = chords.map((c, m) => (m === 3 ? ['D3', 'F#3', 'B3'] : c.map((n) => tr(n, 1))));
  return gameReady(
    inSpace(
      inMeter(
        project(
          'Cathedral Boss starter',
          150,
          0,
          [1, 7],
          [choir, organ, cellos, bones, tuba, violin, timpani, kit, bells, piano],
          [
            clip(organ, 'Phase 1', 1, 6, held(chords.map((c) => [...c, tr(c[0], 12)]), 12, 0.5)),
            clip(cellos, 'Ostinato', 1, 6, ostinato),
            clip(bones, 'Theme', 1, 6, shift(theme, -12)),
            clip(timpani, 'Phase 1', 1, 6, timp),
            drumClip(kit, 'Waltz', 1, 'waltz', 8, 0.5, 4, 61),
            clip(bells, 'Toll', 1, 6, measures(8, 12, (m) => (m % 4 === 0 ? [[0, 'D5', 0.5, dur(12)]] : []))),
            clip(organ, 'Phase 2', 7, 6, held(shock.map((c) => [...c, tr(c[0], 12)]), 12, 0.55)),
            clip(cellos, 'Ostinato', 7, 6, up(ostinato)),
            clip(choir, 'Phase 2', 7, 6, held(shock.map((c) => c.map((n) => tr(n, 12))), 12, 0.6)),
            clip(bones, 'Theme', 7, 6, up(shift(theme, -12))),
            clip(violin, 'Theme', 7, 6, up(theme)),
            clip(tuba, 'Phase 2', 7, 6, measures(8, 12, (m) => [[0, tr(roots[m], 1), 0.65, dur(10)]])),
            clip(timpani, 'Phase 2', 7, 6, up(timp)),
            drumClip(kit, 'Battle', 7, 'battle', 8, 0.8, 4, 62, { num: 3, den: 4 }),
            clip(organ, 'Phase 3', 13, 6, held(chords.map((c) => [c[0], tr(c[0], 12)]), 12, 0.45)),
            clip(timpani, 'Phase 3', 13, 6, measures(8, 12, (m) => [[0, roots[m].replace('1', '2'), 0.8, dur(12)]])),
            clip(choir, 'Phase 3', 16, 3, held(chords.slice(4).map((c) => c.map((n) => tr(n, 12))), 12, 0.65)),
            drumClip(kit, 'Half time', 13, 'heartbeat', 8, 0.5, 0, 63, { num: 3, den: 4 }),
            clip(piano, 'Lament', 19, 6, [...measures(8, 12, (m) => [[0, tr(roots[m], 12), 0.55, dur(12)], [4, chords[m].slice(1).map((n) => tr(n, 12)), 0.42, dur(8)]]), ...theme.map(([s, n, v, d]): Step => [s, n, v * 0.8, d])]),
          ],
          [[1, 'Phase 1'], [7, 'Phase 2'], [13, 'Phase 3'], [19, 'Lament']],
          master({ on: true, depth: 0.1 }, { on: true, amount: 1.2 })
        ),
        3,
        4
      ),
      HALL + 4
    ),
    {
      key: [2, 'minor'],
      rules: [
        ['Phase 1', 'Phase 2', { kind: 'impact', quantize: 'bar' }],
        ['Phase 2', 'Phase 3', { kind: 'fill', quantize: 'bar' }],
        ['Phase 3', 'Phase 1', { kind: 'riser', quantize: 'bar' }],
        ['*', 'Lament', { kind: 'stinger', quantize: 'bar', stingerId: 'victory' }],
      ],
      stingers: ['victory', 'danger', 'gameOver'],
    }
  );
}

// ---------- Arena metal: four combat levels ----------

function arenaMetal(): ProjectSnapshot {
  const air = grouped(track('Atmosphere', 'sciFi', { volume: -12, reverbSend: 0.5, fx: { peq: EQ.pad(6000) } }), 'Ambient');
  const pulseSynth = grouped(track('Pulse', 'synthBass2', { volume: -10, fx: { distortion: { on: true, amount: 0.25 }, lofi: { on: true, crush: 0.35, mix: 0.4 }, peq: peq(lowCut(40)) } }), 'Tension');
  const gtrL = grouped(track('Guitar L', 'realLeadGuitar', { volume: -12, pan: -0.6, fx: { peq: peq(lowCut(90)), human: human(0.15) } }), 'Climax');
  const gtrR = grouped(track('Guitar R', 'distortionGuitar', { volume: -13, pan: 0.6, fx: { peq: peq(lowCut(90)), human: human(0.15) } }), 'Climax');
  const bass = grouped(track('Reese bass', 'reeseBass', { volume: -12, fx: { peq: peq(lowCut(30)) } }), 'Tension');
  const kitBus = drumBus(-16);
  const drums = grouped(track('Drums', 'acousticKit', { volume: -8, output: kitBus.id, fx: { peq: EQ.kit() } }), 'Percussion');
  const hits = grouped(track('Hits', 'fx', { volume: -14, reverbSend: 0.3 }), 'Climax');

  // D Phrygian (D Eb F G A Bb C): chugs on D, the Eb half step above as the threat
  const riff = (bars: number, dense: boolean): Step[] =>
    measures(bars, 16, (m) => {
      const pattern = dense ? 'xxx.xx.xxx.xx.x.' : 'x..x..x...x..x..';
      const accent = m % 2 ? 'D#2' : m % 4 === 2 ? 'F2' : 'D2';
      return [...pattern].flatMap((c, s): Step[] => (c === 'x' ? [[s, power(s === 6 || s === 13 ? accent : 'D2'), s === 0 ? 0.85 : 0.62, dur(1)]] : []));
    });
  const pulses = measures(8, 16, (m) => [0, 3, 6, 10, 13].map((s): Step => [s, m % 4 === 3 ? 'D#2' : 'D2', 0.55, dur(2)]));
  // The last measure of High combat is in 7/8 (14 16ths): a lurch before it loops
  const last = [...'xx.xx.xx.x.xx.'].flatMap((c, s): Step[] => (c === 'x' ? [[s, power(s > 9 ? 'D#2' : 'D2'), 0.8, dur(1)]] : []));
  return gameReady(
    inMeter(
      inSpace(
        boost(project(
          'Arena Metal starter',
          130,
          0,
          [1, 9],
          [air, pulseSynth, gtrL, gtrR, bass, drums, hits, kitBus],
          [
            clip(air, 'Exploration', 1, 8, [[0, ['D3', 'A3', 'D#4'], 0.4, '8:0:0']]),
            clip(pulseSynth, 'Exploration', 5, 4, pulses.slice(0, 20)),
            clip(air, 'Incidental', 9, 8, [[0, ['D3', 'A3'], 0.45, '8:0:0']]),
            clip(pulseSynth, 'Incidental', 9, 8, pulses),
            clip(gtrL, 'Bursts', 9, 8, measures(8, 16, (m) => (m % 2 ? [[0, power('D2'), 0.8, dur(1)], [3, power('D2'), 0.7, dur(1)], [6, power('D#2'), 0.8, dur(2)]] : []))),
            clip(gtrL, 'Riff', 17, 8, riff(8, false)),
            clip(gtrR, 'Riff', 17, 8, riff(8, false).map(([s, n, v, d]): Step => [s + 0.05, n, v * 0.95, d])),
            clip(bass, 'Riff', 17, 8, pulse(['D1', 'D1', 'D#1', 'D1', 'D1', 'D1', 'F1', 'D#1'], [0, 6, 10], 4, 0.6)),
            drumClip(drums, 'Combat', 17, 'rock', 8, 0.75, 4, 71),
            clip(hits, 'Combat', 17, 8, [[0, FX_NOTES.impact, 0.5]]),
            clip(gtrL, 'High riff', 25, 7, riff(7, true)),
            clip(gtrR, 'High riff', 25, 7, riff(7, true).map(([s, n, v, d]): Step => [s + 0.05, n, v * 0.95, d])),
            clip(gtrL, 'Lurch', 32, 0.875, last),
            clip(gtrR, 'Lurch', 32, 0.875, last),
            clip(bass, 'High', 25, 7.875, measures(8, 16, (m) => [0, 2, 4, 6, 8, 10, 12].map((s): Step => [s, m % 2 ? 'D#1' : 'D1', 0.6, dur(2)]))),
            drumClip(drums, 'Blast', 25, 'blast', 7, 0.9, 0, 72),
            drumClip(drums, 'Lurch', 32, 'blast', 1, 0.5, 0, 73, { num: 7, den: 8 }),
            clip(hits, 'High', 25, 7.875, [[0, FX_NOTES.impact, 0.55]]),
            clip(air, 'High', 25, 7.875, [[0, ['D3', 'A3', 'D#4'], 0.45, '8:0:0']]),
          ],
          [[1, 'Exploration'], [9, 'Incidental'], [17, 'Combat'], [25, 'High combat']],
          master({ on: true, depth: 0.12 }, { on: true, amount: 1.2 })
        ), 2),
        ROOM
      ),
      4,
      4,
      [[32, 7, 8]]
    ),
    {
      key: [2, 'minor'],
      rules: [
        ['Exploration', 'Incidental', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
        ['*', 'Combat', { kind: 'impact', quantize: 'beat' }],
        ['Combat', 'High combat', { kind: 'fill', quantize: 'bar' }],
        ['High combat', 'Combat', { kind: 'cut', quantize: 'bar' }],
        ['Combat', 'Exploration', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['danger', 'victory', 'gameOver'],
    }
  );
}

export const MORE_GAME_BUILDERS = {
  openField,
  cosmicWaltz,
  bigBandCity,
  quietWorld,
  wildField,
  underwaterWaltz,
  desertBazaar,
  countdownTown,
  fogTown,
  saveRoom,
  cathedralBoss,
  arenaMetal,
};
