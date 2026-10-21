import type { ProjectSnapshot } from './project';
import { everyBar } from './demoSong';
import { clip, D, master, progression, project, track } from './starterKit';
import { WORLD_BUILDERS } from './startersWorld';
import { starterTrimDb, trimMix } from './startersLoudness';
import { INSTRUMENTS, seatOf } from '../audio/instrumentCatalog';
import type { InstrumentKey } from '../audio/instrumentCatalog';
import { swellLane } from './swell';
import { midiOf, nameOf } from './noteTools';
import { presetPatch } from './synthPatch';
import { DEFAULT_MASTER_FX, durationToBars, withStableIds } from './timelineTypes';
import type { Clip, ClipExpression, MasterFx, MasterSettings, PeqBand, Track } from './timelineTypes';
import type { Step } from './demoSong';

/**
 * Song starters for the New dialog: a 16-bar arrangement in each style, with its tempo, a mixed
 * set of tracks, sections marked, the loop on the whole song and the master set up for the style.
 * Built from data, so they are ordinary projects once opened. Steps are 16th notes: offset =
 * step / 16 bars.
 */
export const STARTERS = [
  { id: 'lofi', group: 'Chill & World', name: 'Lo-Fi', detail: '82 BPM, D minor, swung. Electric piano ninths through tape, a dusty breakbeat, upright bass, a flute line and rain: calm levels and menus.' },
  { id: 'ambient', group: 'Chill & World', name: 'Ambient', detail: '70 BPM, D major. Warm and glass pads, a kalimba melody and crystal sparkles: exploring, resting.' },
  { id: 'celtic', group: 'Chill & World', name: 'Celtic', detail: '112 BPM, D major. A fiddle reel over strummed guitar and bodhrán, a tin whistle, then the pipes.' },
  { id: 'tavern', group: 'Chill & World', name: 'Fantasy Tavern', detail: '110 BPM, D minor jig. Hammered dulcimer, lute, hand drum, accordion and recorder: inns and villages.' },
  { id: 'latin', group: 'Chill & World', name: 'Latin', detail: '130 BPM, bossa nova. Nylon guitar comping, upright bass, bongos, shaker and agogô bells, a flute melody.' },
  { id: 'plaza', group: 'Chill & World', name: 'Plaza', detail: '104 BPM, A minor. Congas, bongos, claves and shaker in son clave, a nylon guitar montuno, an upright bass tumbao and a trumpet theme.' },
  { id: 'mbiraMorning', group: 'Chill & World', name: 'Mbira Morning', detail: '96 BPM, D major pentatonic. Two interlocking mbira lines over a didgeridoo drone, folk harp, a balafon answering and hand chimes.' },
  { id: 'eastern', group: 'Chill & World', name: 'Eastern', detail: '84 BPM, D in-scale. Koto, shakuhachi, taiko and shamisen over a glass drone: temples and gardens.' },
] as const;
export type StarterId = (typeof STARTERS)[number]['id'];
export const STARTER_GROUPS = ['Chill & World'] as const;

export const isStarterId = (v: unknown): v is StarterId => STARTERS.some((s) => s.id === v);


// ---------- Mix helpers ----------

const lowCut = (freq: number): PeqBand => ({ on: true, type: 'lowcut', freq, gain: 0, q: Math.SQRT1_2 });
const highCut = (freq: number): PeqBand => ({ on: true, type: 'highcut', freq, gain: 0, q: Math.SQRT1_2 });
/** A Pro EQ with these bands (a fresh copy each call, so no two tracks share one). */
const peq = (...bands: PeqBand[]) => ({ on: true, bands });

/** HUMAN: timing and dynamics `amount` (0 to 1), pitch only where it suits (never piano). */
const human = (amount: number, pitch = 0) => ({ on: true, timing: amount, dynamics: amount, pitch });
/** LO-FI crush in bits (16 clean, 3 gritty). */
const bits = (n: number) => (16 - n) / 13;

/** Master reverb lengths (the Master tab's spaces) and the project's shared reverb / delay. */
const ROOM = 1, STUDIO = 1.8, HALL = 3.2, HEAVEN = 11;
const inSpace = (p: ProjectSnapshot, reverbDecay: number, delay?: Pick<MasterFx, 'delayTime' | 'delayFeedback'>): ProjectSnapshot => ({ ...p, masterFx: { ...DEFAULT_MASTER_FX, ...p.masterFx, ...delay, reverbDecay } });

// ---------- Note helpers ----------

/** A chord strummed (TOOLS -> Strum): each string `gap` 16ths after the last; upstrokes start at the top. */
const strum = (at: number, notes: string[], vel: number, dur: string, gap = 0.06, up = false): Step[] => (up ? [...notes].reverse() : notes).map((n, i): Step => [at + i * gap, n, vel, dur]);
/** Notes held a 16th past their length (TOOLS -> Legato): lines connect, mono synths slide. */
const legato = (steps: Step[]): Step[] => steps.map(([s, n, v, d = '16n']): Step => [s, n, v, `0:0:${durationToBars(d) * 16 + 1}`]);
/** A clip with controller lanes: mod wheel vibrato, pitch bend, the sustain pedal. */
const withLanes = (c: Clip, expression: ClipExpression): Clip => ({ ...c, expression });
/** Light mod-wheel vibrato for the whole clip. */
const VIBRATO: ClipExpression = { vibrato: [{ at: 0, value: 0.3 }] };


// ---------- Lo-Fi ----------

function lofi(): ProjectSnapshot {
  const tape = { crush: bits(12), tone: 5000, wow: 0.25, mix: 0.5 };
  const keys = track('Keys', 'rhodes', {
    volume: -11.5, reverbSend: 0.3,
    fx: { lofi: { on: true, ...tape }, chorus: { on: true, rate: 0.8, depth: 0.5, mix: 0.3 }, filter: { on: true, type: 'lowpass', cutoff: 3000 }, human: human(0.4) },
  });
  const drums = track('Drums', 'breakbeatKit', {
    volume: -4,
    fx: { lofi: { on: true, crush: bits(10), tone: 7000, wow: 0, mix: 0.4 }, filter: { on: true, type: 'lowpass', cutoff: 5000 }, compressor: { on: true, threshold: -20, ratio: 3, makeup: 2 }, human: human(0.5) },
  });
  const bass = track('Bass', 'uprightBass', { volume: -4, fx: { peq: peq(lowCut(35)), filter: { on: true, type: 'lowpass', cutoff: 2000 }, human: human(0.3) } });
  const melody = track('Flute', 'flute', { volume: -14, reverbSend: 0.4, delaySend: 0.15, pan: 0.2, fx: { lofi: { on: true, ...tape, wow: 0.15, mix: 0.4 }, peq: peq(lowCut(200)), human: human(0.3, 0.2) } });
  const rain = track('Rain', 'rainPad', { volume: -26, reverbSend: 0.3, fx: { filter: { on: true, type: 'lowpass', cutoff: 4000 } } });
  // Dm9 - G13 - Cmaj9 - A7(b9), a bar each, played lazily (a little after the beat), the pedal held
  const chords: Step[] = [
    [1, ['D3', 'C4', 'E4', 'F4'], 0.6, '2n.'],
    [17, ['G2', 'F3', 'B3', 'E4'], 0.6, '2n.'],
    [33, ['C3', 'E3', 'G3', 'B3', 'D4'], 0.6, '2n.'],
    [49, ['A2', 'G3', 'C#4', 'A#4'], 0.6, '2n.'],
  ];
  // Snares about 20 ms late, ghost notes, a kick that skips
  const late = 0.11;
  const beat = everyBar(2, (b): Step[] => [
    [0, D.kick, 0.8], [7, D.kick, 0.5], [10, D.kick, 0.7], ...(b ? [[13, D.kick, 0.45] as Step] : []),
    [4 + late, D.snare, 0.75], [12 + late, D.snare, 0.78], [9, D.snare, 0.25], ...(b ? [[15, D.snare, 0.3] as Step] : []),
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [s, D.closedHat, s % 4 === 0 ? 0.45 : 0.28]),
  ]);
  const bassLine: Step[] = [
    [0, 'D2', 0.8, '4n.'], [10, 'A1', 0.6, '8n'], [16, 'G1', 0.8, '4n.'], [26, 'D2', 0.6, '8n'],
    [32, 'C2', 0.8, '4n.'], [42, 'G1', 0.6, '8n'], [48, 'A1', 0.8, '4n.'], [58, 'E2', 0.6, '8n'],
  ];
  const tune: Step[] = [
    [4, 'F5', 0.7, '8n'], [6, 'E5', 0.6, '8n'], [8, 'C5', 0.7, '4n.'],
    [22, 'B4', 0.6, '8n'], [24, 'D5', 0.7, '4n'], [28, 'E5', 0.6, '4n'],
    [36, 'E5', 0.7, '8n'], [38, 'D5', 0.6, '8n'], [40, 'B4', 0.65, '2n'],
    [56, 'A#4', 0.55, '8n'], [58, 'C#5', 0.6, '8n'],
  ];
  return inSpace(project(
    'Lo-Fi starter',
    82,
    0.3,
    [5, 17],
    [keys, drums, bass, melody, rain],
    [
      withLanes(clip(keys, 'Chords', 1, 4, chords, 4), { sustain: [0, 1, 2, 3].flatMap((b) => [{ at: b, value: 0 }, { at: b + 0.08, value: 1 }]) }),
      clip(drums, 'Dusty beat', 5, 2, beat, 6),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      withLanes(clip(melody, 'Flute', 9, 4, tune, 2), VIBRATO),
      clip(rain, 'Rain', 1, 16, [[0, ['D3', 'A3'], 0.5, '16m']]),
    ],
    [[1, 'Intro'], [5, 'Groove'], [9, 'Melody']],
    master({ on: false }, { on: true, amount: 1.05 })
  ), ROOM);
}

// ---------- Ambient ----------

function ambient(): ProjectSnapshot {
  // Pads well under the melody (-16 to -18), sparse kalimba and crystal, a long, endless space
  const warm = track('Warm pad', 'warmPad', { volume: -16, reverbSend: 0.5, fx: { peq: peq(lowCut(120)) } });
  const glass = track('Glass', 'glassPad', { volume: -18, reverbSend: 0.6, pan: 0.2, fx: { peq: peq(lowCut(200)) } });
  const kalimba = track('Kalimba', 'kalimba', { volume: -6, reverbSend: 0.5, delaySend: 0.35, pan: -0.2, fx: { human: human(0.3) } });
  const crystal = track('Crystal', 'crystal', { volume: -12, reverbSend: 0.7, delaySend: 0.3, pan: 0.3, fx: { peq: peq(lowCut(500), highCut(8000)) } });
  // Dmaj9 - Bm11 - Gmaj9 - A6sus, two bars each
  const pad = progression([['D3', 'A3', 'C#4', 'E4'], ['B2', 'F#3', 'A3', 'E4'], ['G2', 'D3', 'F#3', 'A3'], ['A2', 'E3', 'F#3', 'B3']], 32, '2m', 0.6);
  const air = progression([['F#5', 'A5'], ['D5', 'F#5'], ['B4', 'D5'], ['C#5', 'E5']], 32, '2m', 0.5);
  const tune: Step[] = [
    [0, 'F#5', 0.7, '4n'], [3, 'A5', 0.55, '4n'], [6, 'E5', 0.6, '4n'], [12, 'D5', 0.5, '4n'],
    [20, 'C#5', 0.6, '4n'], [24, 'E5', 0.65, '4n'], [28, 'F#5', 0.5, '4n'],
    [36, 'D5', 0.65, '4n'], [40, 'B4', 0.55, '4n'], [46, 'A4', 0.6, '4n'], [52, 'B4', 0.5, '4n'], [56, 'D5', 0.6, '2n'],
  ];
  const shimmer: Step[] = [[0, 'A6', 0.5, '2n'], [22, 'E6', 0.45, '2n'], [40, 'F#6', 0.5, '2n'], [58, 'C#6', 0.4, '2n']];
  return inSpace(project(
    'Ambient starter',
    70,
    0,
    [1, 17],
    [warm, glass, kalimba, crystal],
    [
      clip(warm, 'Pad', 1, 8, pad, 2),
      clip(glass, 'Air', 5, 8, air, 1),
      clip(glass, 'Air', 13, 4, air.slice(0, 2)),
      clip(kalimba, 'Kalimba', 5, 4, tune, 3),
      clip(crystal, 'Shimmer', 9, 4, shimmer, 2),
    ],
    [[1, 'Drift'], [5, 'Kalimba'], [9, 'Shimmer']],
    master({ on: false }, { on: true, amount: 1.4 })
  ), HEAVEN, { delayTime: '8n', delayFeedback: 0.4 });
}

// ---------- Celtic ----------

function celtic(): ProjectSnapshot {
  const fiddle = track('Fiddle', 'fiddle', { volume: -2, pan: -0.2, reverbSend: 0.3, fx: { human: human(0.35, 0.3) } });
  const whistle = track('Whistle', 'recorder', { volume: -3, pan: 0.25, reverbSend: 0.3, fx: { human: human(0.35, 0.3) } });
  const guitar = track('Guitar', 'steelGuitar', { volume: -8, reverbSend: 0.2, fx: { human: human(0.3) } });
  // The bodhrán on the acoustic kit's toms
  const bodhran = track('Bodhrán', 'acousticKit', { volume: -4, reverbSend: 0.2, fx: { human: human(0.4) } });
  const pipes = track('Pipes', 'bagpipe', { volume: -8, reverbSend: 0.4, pan: 0.1, fx: { peq: peq(lowCut(200)) } });
  // A reel in D: D - G - D - A, a bar each, strummed down (0.8) and up (0.55)
  const shapes = [['D3', 'A3', 'D4', 'F#4'], ['G2', 'D3', 'G3', 'B3', 'D4'], ['D3', 'A3', 'D4', 'F#4'], ['A2', 'E3', 'A3', 'C#4', 'E4']];
  const strumming = everyBar(4, (b) => [0, 3, 4, 6, 8, 11, 12, 14].flatMap((i, k) => (k % 2 ? strum(i, shapes[b].slice(-3), 0.55, '8n', 0.05, true) : strum(i, shapes[b], 0.8, '8n', 0.06))));
  const reel: Step[] = [
    'F#5', 'A5', 'A5', 'F#5', 'D5', 'F#5', 'A5', 'F#5', 'G5', 'B5', 'B5', 'A5', 'G5', 'F#5', 'E5', 'D5',
    'F#5', 'A5', 'A5', 'F#5', 'D5', 'F#5', 'A5', 'D6', 'C#6', 'A5', 'E5', 'F#5', 'G5', 'E5', 'C#5', 'E5',
  ].map((n, i): Step => [i * 2, n, i % 4 === 0 ? 0.85 : i % 2 ? 0.6 : 0.7, '8n']);
  const harmony = reel.map(([st, n, v, d]): Step => [st, n, v * 0.85, d]).filter((_, i) => i % 2 === 0);
  const drum = everyBar(1, (): Step[] => [[0, D.tomLow, 0.85], [3, D.tomMid, 0.45], [4, D.tomLow, 0.65], [6, D.tomHigh, 0.5], [8, D.tomLow, 0.8], [11, D.tomMid, 0.45], [12, D.tomLow, 0.65], [14, D.snare, 0.45]]);
  const drone: Step[] = [[0, ['D4', 'A4'], 0.6, '4m']];
  return inSpace(project(
    'Celtic starter',
    112,
    0,
    [5, 17],
    [fiddle, whistle, guitar, bodhran, pipes],
    [
      clip(guitar, 'Strum', 1, 4, strumming, 4),
      clip(bodhran, 'Bodhrán', 1, 1, drum, 16),
      withLanes(clip(fiddle, 'Reel', 5, 4, reel, 3), { vibrato: [{ at: 0, value: 0.2 }] }),
      withLanes(clip(whistle, 'Whistle', 9, 4, harmony, 2), { vibrato: [{ at: 0, value: 0.2 }] }),
      clip(pipes, 'Drone', 13, 4, drone),
    ],
    [[1, 'Intro'], [5, 'Reel'], [9, 'Whistle'], [13, 'Pipes']],
    master({ on: false }, { on: true, amount: 1.15 })
  ), STUDIO);
}

// ---------- Latin (bossa nova) ----------

function latin(): ProjectSnapshot {
  const guitar = track('Guitar', 'nylonGuitar', { volume: -3, reverbSend: 0.2, fx: { human: human(0.35) } });
  const bass = track('Bass', 'uprightBass', { volume: 0, fx: { peq: peq(lowCut(35)), human: human(0.35, 0.15) } });
  const perc = track('Percussion', 'bongos', { volume: -1, fx: { human: human(0.4) } });
  const kit = track('Kit', 'acousticKit', { volume: -2, fx: { human: human(0.35) } });
  const agogo = track('Agogô', 'agogo', { volume: -16, pan: 0.35, reverbSend: 0.2, fx: { human: human(0.4) } });
  const flute = track('Flute', 'flute', { volume: -4, reverbSend: 0.35, delaySend: 0.15, fx: { peq: peq(lowCut(200)), human: human(0.35, 0.3) } });
  // Dm9 - G13 - Cmaj9 - A7, a bar each
  const voicings = [['D3', 'F3', 'C4', 'E4'], ['G2', 'F3', 'B3', 'E4'], ['C3', 'E3', 'B3', 'D4'], ['A2', 'G3', 'C#4', 'F4']];
  const comp = everyBar(4, (b) => [0, 3, 6, 10, 12].flatMap((i, k) => strum(i, voicings[b], k === 0 ? 0.7 : 0.52 + 0.04 * (k % 2), '8n', 0.05)));
  const bassLine = everyBar(4, (b): Step[] => { const r = ['D2', 'G1', 'C2', 'A1'][b]; const f = ['A2', 'D2', 'G2', 'E2'][b]; return [[0, r, 0.85, '4n.'], [6, f, 0.65, '8n'], [8, f, 0.75, '4n.'], [14, r, 0.6, '8n']]; });
  const shaker = everyBar(1, (): Step[] => [...Array.from({ length: 8 }, (_, i): Step => [i * 2, D.closedHat, i % 2 ? 0.32 : 0.5]), [0, D.tomHigh, 0.6], [6, D.tomHigh, 0.45], [10, D.tomMid, 0.55], [14, D.tomLow, 0.6]]);
  const rim: Step[] = [...[0, 6, 8, 14, 16, 22, 24, 30].map((i): Step => [i, D.kick, i % 8 === 0 ? 0.6 : 0.45]), ...[0, 3, 6, 10, 12, 19, 22, 26, 28].map((i): Step => [i, D.snare, 0.3])];
  // Two bells, low and high
  const bells = everyBar(2, (b): Step[] => [[0, 'C5', 0.6], [3, 'G4', 0.45], [6, 'G4', 0.5], [10, 'C5', 0.55], ...(b ? [[12, 'G4', 0.45] as Step] : [[13, 'C5', 0.45] as Step])]);
  const tune: Step[] = [
    [0, 'A5', 0.75, '4n.'], [6, 'G5', 0.65, '8n'], [8, 'F5', 0.7, '4n'], [12, 'E5', 0.65, '4n'],
    [16, 'F5', 0.75, '2n'], [24, 'D5', 0.65, '4n'], [28, 'E5', 0.65, '4n'],
    [32, 'E5', 0.75, '4n.'], [38, 'D5', 0.65, '8n'], [40, 'B4', 0.7, '2n'],
    [48, 'C#5', 0.75, '2n'], [56, 'E5', 0.65, '4n'], [60, 'G5', 0.65, '4n'],
  ];
  return inSpace(project(
    'Latin starter',
    130,
    0,
    [5, 17],
    [guitar, bass, perc, kit, agogo, flute],
    [
      clip(guitar, 'Bossa comping', 1, 4, comp, 4),
      clip(perc, 'Shaker & bongos', 1, 1, shaker, 16),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(kit, 'Rim & kick', 5, 2, rim, 6),
      clip(agogo, 'Agogô', 9, 2, bells, 4),
      withLanes(clip(flute, 'Melody', 9, 4, legato(tune), 2), VIBRATO),
    ],
    [[1, 'Intro'], [5, 'Groove'], [9, 'Melody']],
    master({ on: false }, { on: true, amount: 1.1 })
  ), ROOM);
}

// ---------- Fantasy Tavern ----------

function tavern(): ProjectSnapshot {
  const dulcimer = track('Dulcimer', 'dulcimer', { volume: -2, reverbSend: 0.25, pan: -0.2, fx: { human: human(0.35) } });
  const lute = track('Lute', 'nylonGuitar', { volume: -3, reverbSend: 0.2, pan: 0.2, fx: { human: human(0.35) } });
  const recorder = track('Recorder', 'recorder', { volume: -3, reverbSend: 0.3, fx: { human: human(0.35, 0.3) } });
  const drum = track('Hand drum', 'bongos', { volume: 4, reverbSend: 0.15, fx: { human: human(0.45) } });
  const accordion = track('Accordion', 'accordion', { volume: -8, reverbSend: 0.25, fx: { human: human(0.3) } });
  // D minor jig feel (triplet 8ths): Dm - C - Bb - A, a bar each
  const t = 16 / 6;
  const triads = [['D4', 'F4', 'A4'], ['C4', 'E4', 'G4'], ['A#3', 'D4', 'F4'], ['A3', 'C#4', 'E4']];
  const lutePart = everyBar(4, (b) => [0, 1, 2, 3, 4, 5].map((k): Step => [k * t, k === 0 ? triads[b][0].replace(/\d/, (o) => String(Number(o) - 1)) : triads[b][k % 2 ? 1 : 2], k % 3 === 0 ? 0.75 : 0.5, '8n']));
  const tune: Step[] = [
    ...['A4', 'D5', 'D5', 'E5', 'F5', 'E5'], ...['G5', 'E5', 'C5', 'E5', 'G5', 'E5'],
    ...['F5', 'D5', 'A#4', 'D5', 'F5', 'A5'], ...['E5', 'C#5', 'A4', 'C#5', 'E5', 'A4'],
  ].map((n, i): Step => [i * t, n, i % 3 === 0 ? 0.85 : 0.6 + 0.05 * (i % 2), '8n']);
  const drumPart = everyBar(1, (): Step[] => [[0, D.tomLow, 0.85], [2 * t, D.tomHigh, 0.5], [3 * t, D.tomLow, 0.7], [5 * t, D.tomHigh, 0.55]]);
  const harmony = tune.filter((_, i) => i % 3 === 0).map(([st, n, v]): Step => [st, n, v * 0.8, '4n.']);
  const squeeze = legato(progression(triads, 16, '1n', 0.55));
  return inSpace(project(
    'Fantasy Tavern starter',
    110,
    0,
    [5, 17],
    [dulcimer, lute, recorder, drum, accordion],
    [
      clip(lute, 'Lute', 1, 4, lutePart, 4),
      clip(drum, 'Hand drum', 1, 1, drumPart, 16),
      clip(dulcimer, 'Tune', 5, 4, tune, 3),
      clip(accordion, 'Accordion', 9, 4, squeeze, 2),
      withLanes(clip(recorder, 'Recorder', 13, 4, harmony), { vibrato: [{ at: 0, value: 0.2 }] }),
    ],
    [[1, 'Intro'], [5, 'Tune'], [9, 'Full tavern']],
    master({ on: false }, { on: true, amount: 1.1 })
  ), ROOM);
}

// ---------- Eastern ----------

function eastern(): ProjectSnapshot {
  const koto = track('Koto', 'koto', { volume: -3, reverbSend: 0.4, pan: -0.2, fx: { human: human(0.35) } });
  const flute = track('Shakuhachi', 'shakuhachi', { volume: -4, reverbSend: 0.5, delaySend: 0.15, fx: { human: human(0.3, 0.3) } });
  const taiko = track('Taiko', 'taiko', { volume: -5, reverbSend: 0.35, fx: { human: human(0.15) } });
  const pad = track('Pad', 'glassPad', { volume: -20, reverbSend: 0.5 });
  const shamisen = track('Shamisen', 'shamisen', { volume: -1, pan: 0.25, reverbSend: 0.3, fx: { human: human(0.35) } });
  // The in scale on D: D, Eb, G, A, Bb
  const pattern = ['D4', 'A4', 'D5', 'D#5', 'A4', 'D5', 'A#4', 'G4'];
  const kotoPart = everyBar(2, (b) => pattern.map((n, i): Step => [i * 2, b && i === 7 ? 'A4' : n, i % 4 === 0 ? 0.8 : 0.55 + 0.05 * (i % 2), '4n']));
  const tune: Step[] = [
    [0, 'A5', 0.75, '2n'], [8, 'A#5', 0.6, '8n'], [10, 'A5', 0.7, '4n.'],
    [16, 'G5', 0.7, '4n'], [20, 'D#5', 0.6, '4n'], [24, 'D5', 0.75, '2n'],
    [32, 'D#5', 0.7, '4n.'], [38, 'G5', 0.6, '8n'], [40, 'A5', 0.75, '2n'],
    [48, 'D6', 0.7, '4n'], [52, 'A#5', 0.6, '4n'], [56, 'A5', 0.7, '2n'],
  ];
  // Each phrase's long last note falls away (a bend of about -70 cents), as a shakuhachi player lets it go
  const fall = (end: number) => [{ at: end - 0.1, value: 0 }, { at: end - 0.01, value: -0.7 }, { at: end, value: 0 }];
  const lanes: ClipExpression = { vibrato: [{ at: 0, value: 0.25 }], bend: [{ at: 0, value: 0 }, ...fall(0.5), ...fall(2), ...fall(3), ...fall(4)] };
  // Low taiko: D2, A2 and G1
  const drums = everyBar(2, (b): Step[] => [[0, 'D2', 0.85, '4n'], [6, 'D2', 0.55, '8n'], [8, 'A2', 0.75, '4n'], ...(b ? [[12, 'G1', 0.65, '8n'] as Step, [13, 'G1', 0.7, '8n'] as Step, [14, 'D2', 0.8, '8n'] as Step] : [[12, 'D2', 0.65, '4n'] as Step])]);
  const drone: Step[] = [[0, ['D3', 'A3', 'D4'], 0.6, '4m']];
  const pluck = everyBar(1, (): Step[] => [[0, 'D4', 0.8, '8n'], [3, 'D4', 0.55, '16n'], [6, 'A4', 0.7, '8n'], [10, 'G4', 0.65, '8n'], [12, 'D#4', 0.6, '8n']]);
  return inSpace(project(
    'Eastern starter',
    84,
    0,
    [5, 17],
    [koto, flute, taiko, pad, shamisen],
    [
      clip(pad, 'Drone', 1, 4, drone, 4),
      clip(koto, 'Koto', 1, 2, kotoPart, 8),
      withLanes(clip(flute, 'Shakuhachi', 5, 4, tune), lanes),
      withLanes(clip(flute, 'Shakuhachi', 9, 4, tune), lanes),
      withLanes(clip(flute, 'Shakuhachi', 13, 4, tune), lanes),
      clip(taiko, 'Taiko', 9, 2, drums, 4),
      clip(shamisen, 'Shamisen', 13, 1, pluck, 4),
    ],
    [[1, 'Garden'], [5, 'Flute'], [9, 'Drums'], [13, 'Shamisen']],
    master({ on: false }, { on: true, amount: 1.2 })
  ), HALL);
}

const BUILDERS: Record<StarterId, () => ProjectSnapshot> = {
  lofi, ambient, celtic, latin, tavern, eastern,
  ...WORLD_BUILDERS,
};

/**
 * A fresh copy of a starter. Its ids are the same every time (withStableIds), so every copy plays
 * and exports exactly alike: the Human insert's drift, and the recordings it picks, follow them.
 */
export function createStarter(id: StarterId): ProjectSnapshot {
  return withStableIds(`starter_${id}`, () => {
    const p = withGlue(id, wholeSong(withSwells(inRange(withSeats(recorded(BUILDERS[id]()))))));
    // Last, the level: each starter brought to its group's loudness (see startersLoudness.ts)
    return trimMix(ownVibrato(p), starterTrimDb(id));
  });
}

/**
 * The recorded instrument (or Synth Designer pad) each older General MIDI sound in the starters
 * becomes, with `db` added to the track's volume so its level in the mix stays where it was
 * (measured: the same notes through both, A-weighted). `short` plays parts of short notes (under an
 * eighth on average) with the short-stroke recordings, and `high` takes parts too high for the
 * recording (the horn's top, which the section's trumpet plays). `anyNote`: a note out of the
 * recording's range moves by octaves into it (a timpani hit stays a hit). Taiko, music box and the rest
 * have no free recording yet and stay as they are.
 */
const RECORDED: Record<string, { to: InstrumentKey; db: number; short?: InstrumentKey; shortDb?: number; high?: InstrumentKey; highDb?: number; preset?: string; anyNote?: boolean }> = {
  cello: { to: 'realCello', db: -4, short: 'realCelloShort', shortDb: -2.5 },
  brassSection: { to: 'realBrass', db: -3 },
  distortionGuitar: { to: 'realLeadGuitar', db: 1.5 },
  timpani: { to: 'realTimpani', db: 1.0, anyNote: true },
  slowStrings: { to: 'realStrings', db: -15 },
  strings: { to: 'realStrings', db: 0 },
  tremolo: { to: 'realTremolo', db: 2 },
  uprightBass: { to: 'realUprightBass', db: 1.5 },
  cleanGuitar: { to: 'realGuitar', db: -1.0 },
  harp: { to: 'realHarp', db: -2 },
  flute: { to: 'realFlute', db: 0.0, short: 'realFluteShort', shortDb: -3.0 },
  frenchHorn: { to: 'realHorn', db: 3.0, short: 'realHornShort', shortDb: -2.5, high: 'realBrass', highDb: -4 },
  pizzicato: { to: 'realPizzicato', db: -3.5 },
  // (Matched A-weighted, which hardly hears a double bass's low notes: at -3.5 it played 3 to 10 dB
  // over every other part in all five starters that have one; now it sits a little under the cellos)
  contrabass: { to: 'realDoubleBass', db: -12 },
  marimba: { to: 'realMarimba', db: 0.5 },
  violin: { to: 'realViolin', db: -3, short: 'realViolinsShort', shortDb: -2.5 },
  viola: { to: 'realViolas', db: -1.0, short: 'realViolasShort', shortDb: -3.5 },
  trombone: { to: 'realTrombone', db: -0.5, short: 'realTromboneShort', shortDb: 2.0 },
  pickBass: { to: 'realElectricBass', db: 1 },
  fingerBass: { to: 'realElectricBass', db: -0.5 },
  vibraphone: { to: 'realVibraphone', db: -5.0 },
  // (the tenor's parts play the alto with vibrato, which is 2.8 dB quieter: they all fit its range)
  tenorSax: { to: 'realAltoSax', db: 3.3 },
  saxophone: { to: 'realAltoSax', db: 1.5 },
  glockenspiel: { to: 'realGlockenspiel', db: 4.0 },
  overdriveGuitar: { to: 'realCrunchGuitar', db: 5 },
  pipeOrgan: { to: 'realPipeOrgan', db: -3.5 },
  kalimba: { to: 'realKalimba', db: -3.5 },
  chimes: { to: 'realTubularBells', db: -1.0 },
  trumpet: { to: 'realTrumpet', db: 3.0, short: 'realTrumpetShort', shortDb: -0.5 },
  bassoon: { to: 'realBassoon', db: -0.5 },
  clarinet: { to: 'realClarinet', db: -0.5 },
  harpsichord: { to: 'realHarpsichord', db: -0.5 },
  tuba: { to: 'realTuba', db: 1.5 },
  glassPad: { to: 'synthDesigner', preset: 'Glass pad', db: -8 },
  warmPad: { to: 'synthDesigner', preset: 'Warm pad', db: -5 },
  haloPad: { to: 'synthDesigner', preset: 'Halo pad', db: -4.0 },
  sweepPad: { to: 'synthDesigner', preset: 'Sweep pad', db: 1.5 },
  polysynthPad: { to: 'synthDesigner', preset: 'Polysynth', db: 0.0 },
  soundtrackPad: { to: 'synthDesigner', preset: 'Soundtrack pad', db: 0.5 },
  // The electric piano rings on for a held chord (up to 8 s), so every part moves to it. Matched
  // part by part rather than here (A-weighted, each starter's part through both): against the old
  // sound they ranged from -0.5 to +3.5 dB, so each starter's electric piano fader is set for it
  rhodes: { to: 'realElectricPiano', db: 0 },
  acousticKit: { to: 'studioKit', db: 0, anyNote: true },
  banjo: { to: 'realBanjo', db: 0 },
  harmonica: { to: 'realHarmonica', db: 0 },
  ocarina: { to: 'realOcarina', db: 0 },
  steelDrums: { to: 'realSteelDrums', db: 0 },
  // (Matched part by part, A-weighted, each starter's part through both: the celesta's parts
  // ranged from +0.3 to +2.4 dB, the recorder's +1.3 to +2.7, the muted trumpet's +1.7 to +7.5,
  // its highest parts most; the farthest parts' faders are set for it)
  celesta: { to: 'realCelesta', db: -1.0 },
  recorder: { to: 'realRecorder', db: -2.0 },
  // (the muted trumpet's parts now play the open trumpet with vibrato, 0.8 dB under the muted one)
  mutedTrumpet: { to: 'realTrumpet', db: -4.2 },
  // (Matched part by part, by loudness, each starter's part through both: the classical guitar's
  // four parts came out 0.5 to 1.2 dB louder)
  nylonGuitar: { to: 'realNylonGuitar', db: -0.8 },
};

/**
 * Starters play the recorded instruments: each track on an older General MIDI sound moves to its
 * recording (see RECORDED) when its notes fit the recording's range, at a level that keeps the mix.
 */
function recorded(p: ProjectSnapshot): ProjectSnapshot {
  const tracks = p.tracks.map((t) => {
    const swap = RECORDED[t.instrumentKey];
    if (!swap) return t;
    const notes = p.clips.filter((c) => c.trackId === t.id).flatMap((c) => c.notes);
    const average = notes.length ? notes.reduce((a, n) => a + durationToBars(n.duration), 0) / notes.length : 1;
    const fits = (key: InstrumentKey) => {
      const [lo, hi] = INSTRUMENTS[key].range;
      return key === 'synthDesigner' || swap.anyNote || notes.filter((n) => midiOf(n.note) >= lo && midiOf(n.note) <= hi).length >= notes.length * 0.9;
    };
    const choices: Array<[InstrumentKey | undefined, number | undefined]> = [
      ...(average < 0.125 - 1e-6 ? [[swap.short, swap.shortDb] as [InstrumentKey | undefined, number | undefined]] : []),
      [swap.to, swap.db],
      [swap.high, swap.highDb],
    ];
    const [to, db] = choices.find(([key]) => key && fits(key)) ?? [];
    if (!to) return t;
    return { ...t, instrumentKey: to, volume: t.volume + db!, ...(swap.preset ? { synth: presetPatch(swap.preset) } : {}) };
  });
  const stingers = p.stingers?.map((st) => {
    const to = RECORDED[st.instrumentKey]?.to;
    if (!to || to === 'synthDesigner') return st;
    const [lo, hi] = INSTRUMENTS[to].range;
    return st.notes.every((n) => midiOf(n.note) >= lo && midiOf(n.note) <= hi) ? { ...st, instrumentKey: to } : st;
  });
  return { ...p, tracks, ...(stingers ? { stingers } : {}) };
}

/** The master compressor's style each group of starters suits (see GLUE_STYLES). */
const GROUP_GLUE: Partial<Record<(typeof STARTER_GROUPS)[number], MasterSettings['glue']>> = {
  'Chill & World': 'gentle',
};

/**
 * Orchestral instruments take their seats on the stage (seatOf): their usual distance, and their
 * usual side where the starter left them in the middle.
 */
function withSeats(p: ProjectSnapshot): ProjectSnapshot {
  return {
    ...p,
    tracks: p.tracks.map((t) => {
      const seat = seatOf(t.instrumentKey);
      if (!seat || t.distance !== undefined) return t;
      return { ...t, distance: seat.distance, pan: t.pan === 0 ? seat.pan : t.pan };
    }),
  };
}

/** A starter's master glue from its group, unless its builder chose one. */
function withGlue(id: StarterId, p: ProjectSnapshot): ProjectSnapshot {
  const group = STARTERS.find((s) => s.id === id)?.group;
  const glue = group && GROUP_GLUE[group];
  if (!glue || !p.master || p.master.glue !== 'standard') return p;
  return { ...p, master: { ...p.master, glue } };
}

/**
 * The bowed strings that already play with a vibrato: recorded with one (the sections and the
 * solo violin of VSCO), or given one note by note (InstrumentDef.vibrato).
 */
const OWN_VIBRATO = new Set<string>(['realSoloViolin', 'realViolins', 'realViolas', 'realCello', 'realStrings']);
const hasOwnVibrato = (key: InstrumentKey) => OWN_VIBRATO.has(key) || !!INSTRUMENTS[key]?.vibrato;

/**
 * A string part that plays its own vibrato loses the vibrato lane its starter drew for the older
 * sound: the lane's even wobble on top of a player's vibrato is two vibratos at once, a seasick,
 * synthetic sound.
 */
function ownVibrato(p: ProjectSnapshot): ProjectSnapshot {
  const own = new Set(p.tracks.filter((t) => hasOwnVibrato(t.instrumentKey)).map((t) => t.id));
  if (!own.size) return p;
  const clips = p.clips.map((c) => {
    if (!own.has(c.trackId) || !c.expression?.vibrato) return c;
    const { vibrato: _, ...rest } = c.expression;
    return { ...c, expression: rest };
  });
  return { ...p, clips };
}

/**
 * Play loops the whole starter, its first bar to its last: someone new presses Play and hears all
 * of it, rather than the first section over and over until they find the loop's Out point. (The
 * song may not loop seamlessly end to start; that's for its writer to shape.)
 */
function wholeSong(p: ProjectSnapshot): ProjectSnapshot {
  const end = Math.ceil(Math.max(2, ...p.clips.map((c) => c.startBar + c.lengthBars)) - 1e-6);
  return { ...p, loopRegion: { inBar: 1, outBar: end, enabled: true } };
}

/** The held, bowed, blown and sung instruments a player shapes as they sustain (see withSwells). */
const SWELLED = new Set<string>([
  'strings', 'slowStrings', 'synthStrings', 'synthStrings2', 'violin', 'viola', 'cello', 'contrabass', 'tremolo',
  'realViolins', 'realViolas', 'realCello', 'realSoloViolin', 'realDoubleBass', 'realTremolo',
  'realViolin', 'realViola', 'realSoloCello', 'realContrabass',
  'realStrings', 'realBrass', 'realTenorSax',
  'realChoir', 'realChoirOoh', 'choir', 'voiceOohs', 'synthChoir', 'choirPad', 'haloPad', 'warmPad', 'newAgePad', 'glassPad', 'sweepPad', 'polysynthPad', 'soundtrackPad', 'atmosphere',
  'frenchHorn', 'realHorn', 'tuba', 'realTuba', 'trombone', 'realTrombone', 'oboe', 'realOboe', 'clarinet', 'realClarinet', 'bassoon', 'realBassoon', 'englishHorn',
]);

/**
 * Every starter's held parts breathe: a clip of strings, pads, voices, horns or woodwinds whose
 * notes last a beat or more on average gets a gentle swell on the mod wheel (dynamics), each
 * phrase growing to its middle and easing off, half as deep as the Swell tool's, so the part
 * moves without falling back. A clip with its own mod wheel lane is left as it is.
 */
function withSwells(p: ProjectSnapshot): ProjectSnapshot {
  // and the Synth Designer's slow-starting pads
  const pad = (t: Track) => t.instrumentKey === 'synthDesigner' && (t.synth?.amp.attack ?? 0) >= 0.3;
  const swelled = new Set(p.tracks.filter((t) => SWELLED.has(t.instrumentKey) || pad(t)).map((t) => t.id));
  const shaped = new Set<string>();
  const clips = p.clips.map((c) => {
    if (!swelled.has(c.trackId) || !c.notes.length || c.audio || c.expression?.mod) return c;
    const average = c.notes.reduce((sum, n) => sum + durationToBars(n.duration), 0) / c.notes.length;
    if (average < 0.25 - 1e-6) return c;
    shaped.add(c.trackId);
    return { ...c, expression: { ...c.expression, mod: swellLane(undefined, c.notes, 'swell', SWELL_DEPTH) } };
  });
  // The swells' dips would leave the part quieter on the whole: its level made up, so the tops of
  // the swells sit a little over where it was and the dips a little under
  return { ...p, clips, tracks: p.tracks.map((t) => (shaped.has(t.id) ? { ...t, volume: t.volume + SWELL_MAKEUP_DB } : t)) };
}
/** The level the starters' swells cost a part, made up (dB). */
const SWELL_MAKEUP_DB = 2.5;
/** How deep the starters' swells are (the Swell tool's is 1). */
const SWELL_DEPTH = 0.5;

/**
 * Each pitched part's notes within what its instrument really plays: a note past the end moves an
 * octave (or more) in. A recording stretched far below its lowest note or above its highest sounds
 * thin or muddy, and a bassoon can't play a G1 at all. Drum kits' notes are drum names, left alone.
 */
function inRange(p: ProjectSnapshot): ProjectSnapshot {
  const ranges = new Map(p.tracks.map((t) => [t.id, INSTRUMENTS[t.instrumentKey]?.kind === 'drums' ? undefined : INSTRUMENTS[t.instrumentKey]?.range]));
  let moved = false;
  const clips = p.clips.map((c) => {
    const range = ranges.get(c.trackId);
    if (!range || !c.notes.length) return c;
    const [lo, hi] = range;
    let changed = false;
    const notes = c.notes.map((n) => {
      let m = midiOf(n.note);
      if (!Number.isFinite(m) || (m >= lo && m <= hi)) return n;
      while (m < lo && m + 12 <= hi) m += 12;
      while (m > hi && m - 12 >= lo) m -= 12;
      changed = true;
      return { ...n, note: nameOf(m) };
    });
    if (!changed) return c;
    moved = true;
    return { ...c, notes };
  });
  return moved ? { ...p, clips } : p;
}
