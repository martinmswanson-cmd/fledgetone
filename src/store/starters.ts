import { DRUM_NOTES } from '../audio/scheduler';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import type { ProjectSnapshot } from './project';
import type { AutomationLane, Clip, InstrumentKey, MasterSettings, Track, TrackFx, WobbleRate } from './timelineTypes';
import { DEFAULT_MASTER_FX, defaultMasterSettings, defaultTrackFx, uid } from './timelineTypes';
import { createMarker } from './markers';
import { BUILD_UP, DROP_HIT, everyBar, GROWL_RIFF, PLUCK_ARP, REESE_LINE, toNotes, TRANCE_CHORDS, WOBBLE_RIFF } from './demoSong';
import type { Step } from './demoSong';

/**
 * Genre starters for the New dialog: a 16-bar arrangement in each style, with its tempo, a
 * mixed set of tracks, sections marked (intro, build, drop...), the loop on the main section and
 * the master set up for the style. Built from data like the demo song, so they are ordinary
 * projects once opened. Steps are 16th notes: offset = step / 16 bars.
 */
export const STARTERS = [
  { id: 'dubstep', name: 'Dubstep', detail: '140 BPM, F minor. Half-time drums, a wobble and growl call-and-response in the drop, supersaw chords pumping to the kick.' },
  { id: 'house', name: 'House', detail: '126 BPM, A minor. Four-on-the-floor, off-beat bass and hats, clav chord stabs, a pluck arp in the peak.' },
  { id: 'dnb', name: 'Drum & Bass', detail: '174 BPM, F minor. A two-step break, a gliding Reese bass, a string pad and a pluck arp.' },
  { id: 'trap', name: 'Trap', detail: '140 BPM, C minor. Half-time drums with hat rolls, a sliding 808, a dark pluck melody over strings.' },
  { id: 'cinematic', name: 'Cinematic', detail: '100 BPM, D minor. Harp and strings, a cello ostinato with taiko building, then French horns over it all: boss fights and title screens.' },
  { id: 'lofi', name: 'Lo-Fi', detail: '82 BPM, swung. Electric piano ninth chords, a dusty filtered beat, bass guitar and a flute line: calm levels and menus.' },
  { id: 'chiptune', name: 'Chiptune', detail: '150 BPM, A minor. 8-bit pulse lead and arpeggios, a bouncing triangle bass and a noise kit: retro games.' },
  { id: 'hiphop', name: 'Hip-Hop', detail: '90 BPM, boom bap. A swung beat, a piano loop, bass guitar and brass stabs in the hook.' },
] as const;
export type StarterId = (typeof STARTERS)[number]['id'];

export const isStarterId = (v: unknown): v is StarterId => STARTERS.some((s) => s.id === v);

const D = DRUM_NOTES;

type FxPatch = { [K in keyof TrackFx]?: Partial<TrackFx[K]> };

function fx(patch: FxPatch = {}): TrackFx {
  const d = defaultTrackFx();
  return {
    distortion: { ...d.distortion, ...patch.distortion },
    compressor: { ...d.compressor, ...patch.compressor },
    chorus: { ...d.chorus, ...patch.chorus },
    filter: { ...d.filter, ...patch.filter },
    pump: { ...d.pump, ...patch.pump },
  };
}

function track(name: string, key: InstrumentKey, opts: Partial<Omit<Track, 'fx'>> & { fx?: FxPatch; automation?: AutomationLane[] } = {}): Track {
  const { fx: patch, ...rest } = opts;
  return {
    id: uid('track'),
    name,
    color: INSTRUMENTS[key].color,
    instrumentKey: key,
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    pan: 0,
    eq: { low: 0, mid: 0, high: 0 },
    reverbSend: 0,
    delaySend: 0,
    ...rest,
    fx: fx(patch),
  };
}

/** A clip of `steps` (whose length is `bars`), repeated `times` from `startBar`. */
function clip(t: Track, name: string, startBar: number, bars: number, steps: Step[], times = 1, wobble?: WobbleRate): Clip {
  const all = Array.from({ length: times }, (_, i) => steps.map(([s, n, v, d]): Step => [s + i * bars * 16, n, v, d])).flat();
  return { id: uid('clip'), trackId: t.id, name, startBar, lengthBars: bars * times, notes: toNotes(all), isSelected: false, ...(wobble ? { wobble } : {}) };
}

function master(ott: Partial<MasterSettings['ott']>, width: Partial<MasterSettings['width']>): MasterSettings {
  const d = defaultMasterSettings();
  return { ott: { ...d.ott, ...ott }, width: { ...d.width, ...width } };
}

function project(name: string, bpm: number, swing: number, loop: [number, number], tracks: Track[], clips: Clip[], sections: Array<[number, string]>, m: MasterSettings): ProjectSnapshot {
  return {
    name,
    bpm,
    swing,
    loopRegion: { inBar: loop[0], outBar: loop[1], enabled: true },
    masterFx: DEFAULT_MASTER_FX,
    master: m,
    tracks,
    clips,
    markers: sections.map(([bar, label]) => createMarker(bar, bpm, label)),
  };
}

/** Hats every 8th, the bar's last one open every other bar. */
const hats8 = (bars: number, vel = 0.55): Step[] =>
  everyBar(bars, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, b % 2 === 1 && i === 7 ? D.openHat : D.closedHat, i % 2 ? vel * 0.7 : vel]));

/** A snare roll over 4 bars: quarters, 8ths, then 16ths twice, getting louder. */
const snareRoll: Step[] = [
  ...[0, 4, 8, 12].map((s): Step => [s, D.snare, 0.5]),
  ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [16 + s, D.snare, 0.6]),
  ...Array.from({ length: 32 }, (_, i): Step => [32 + i, D.snare, 0.65 + (0.3 * i) / 31]),
];

// ---------- Dubstep ----------

function dubstep(): ProjectSnapshot {
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const wobble = track('Wobble', 'wobbleBass', { volume: -1 });
  const growl = track('Growl', 'growlBass', { volume: -2 });
  const chords = track('Chords', 'supersaw', {
    volume: -1,
    reverbSend: 0.3,
    fx: { filter: { on: true, cutoff: 1200 }, pump: { on: true, depth: 0.75, release: 260, trigger: 'kick' } },
    automation: [{ param: 'filterCutoff', points: [{ bar: 1, value: 0.3 }, { bar: 9, value: 0.85 }, { bar: 17, value: 0.85 }] }],
  });
  const sfx = track('FX', 'fx', { volume: -4, reverbSend: 0.2 });
  // Half-time: kick on 1, snare on 3, a pickup kick every other bar
  const halfTime = everyBar(2, (b): Step[] => [[0, D.kick, 1], [8, D.snare, 0.95], ...(b === 1 ? [[10, D.kick, 0.8] as Step, [14, D.kick, 0.7] as Step] : [])]);
  return project(
    'Dubstep starter',
    140,
    0,
    [9, 17],
    [drums, wobble, growl, chords, sfx],
    [
      clip(drums, 'Hats', 1, 4, hats8(4, 0.45)),
      clip(drums, 'Snare roll', 5, 4, snareRoll),
      clip(drums, 'Half-time', 9, 2, [...halfTime, ...hats8(2, 0.6)], 4),
      clip(wobble, 'Wobble', 9, 2, WOBBLE_RIFF, 1, '1/8'),
      clip(growl, 'Growl', 11, 2, GROWL_RIFF, 1, '1/16'),
      clip(wobble, 'Wobble', 13, 2, WOBBLE_RIFF, 1, '1/4'),
      clip(growl, 'Growl', 15, 2, GROWL_RIFF, 1, '1/16'),
      clip(chords, 'Chords', 1, 4, TRANCE_CHORDS, 4),
      clip(sfx, 'Build-up', 5, 4, BUILD_UP),
      clip(sfx, 'Drop hit', 9, 2, DROP_HIT),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.35 }, { on: true, amount: 1.2 })
  );
}

// ---------- House ----------

function house(): ProjectSnapshot {
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const bass = track('Bass', 'subBass', { volume: -1 });
  const stabs = track('Stabs', 'keys', { volume: 5, reverbSend: 0.25, delaySend: 0.15, fx: { pump: { on: true, depth: 0.6, release: 220, trigger: 'kick' } } });
  const arp = track('Arp', 'pluck', { volume: 3, delaySend: 0.3, reverbSend: 0.2, pan: 0.15 });
  const fourOnFloor = (clap: boolean) =>
    everyBar(1, (): Step[] => [
      ...[0, 4, 8, 12].map((s): Step => [s, D.kick, 1]),
      ...[2, 6, 10, 14].map((s): Step => [s, D.openHat, 0.5]),
      ...[1, 3, 5, 7, 9, 11, 13, 15].map((s): Step => [s, D.closedHat, 0.3]),
      ...(clap ? [[4, D.snare, 0.85] as Step, [12, D.snare, 0.85] as Step] : []),
    ]);
  // Am7 - Dm7 - Fmaj7 - Em7, a bar each: off-beat bass on the roots, stabs on the "and"s
  const roots = ['A1', 'D2', 'F1', 'E1'];
  const chords = [['A3', 'C4', 'E4', 'G4'], ['D3', 'F3', 'A3', 'C4'], ['F3', 'A3', 'C4', 'E4'], ['E3', 'G3', 'B3', 'D4']];
  const bassLine = everyBar(4, (b) => [2, 6, 10, 14].map((s): Step => [s, roots[b], s === 2 ? 0.95 : 0.8, '8n']));
  const stabLine = everyBar(4, (b) => [[2, chords[b], 0.8, '8n'] as Step, [7, chords[b], 0.6, '16n'] as Step, [10, chords[b], 0.75, '8n'] as Step]);
  const arpLine = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, chords[b][(i * 3) % 4].replace(/\d/, (o) => String(Number(o) + 1)), i % 4 === 0 ? 0.85 : 0.6]));
  return project(
    'House starter',
    126,
    0.1,
    [5, 17],
    [drums, bass, stabs, arp],
    [
      clip(drums, 'Kick & hats', 1, 1, fourOnFloor(false), 4),
      clip(drums, 'Groove', 5, 1, fourOnFloor(true), 12),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(stabs, 'Stabs', 1, 4, stabLine, 4),
      clip(arp, 'Arp', 13, 4, arpLine),
    ],
    [[1, 'Intro'], [5, 'Groove'], [13, 'Peak']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.15 })
  );
}

// ---------- Drum & Bass ----------

function dnb(): ProjectSnapshot {
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const reese = track('Reese', 'reeseBass', { volume: -2 });
  const pad = track('Strings', 'strings', { volume: -17, reverbSend: 0.4 });
  const arp = track('Arp', 'pluck', { volume: 0, delaySend: 0.35, reverbSend: 0.2, pan: -0.15 });
  const sfx = track('FX', 'fx', { volume: -4, reverbSend: 0.2 });
  // Two-step: kick on 1 and the "and" of 3, snare on 2 and 4, ghost snares and 8th hats
  const twoStep = everyBar(1, (): Step[] => [
    [0, D.kick, 1], [10, D.kick, 0.9], [4, D.snare, 0.95], [12, D.snare, 0.95], [7, D.snare, 0.25], [15, D.snare, 0.3],
    ...Array.from({ length: 8 }, (_, i): Step => [i * 2, D.closedHat, i % 2 ? 0.4 : 0.6]),
  ]);
  return project(
    'Drum & Bass starter',
    174,
    0,
    [9, 17],
    [drums, reese, pad, arp, sfx],
    [
      clip(drums, 'Hats', 1, 4, hats8(4, 0.4)),
      clip(drums, 'Snare roll', 5, 4, snareRoll),
      clip(drums, 'Two-step', 9, 1, twoStep, 8),
      clip(reese, 'Reese', 9, 4, REESE_LINE, 2),
      clip(pad, 'Pad', 1, 4, TRANCE_CHORDS, 4),
      clip(arp, 'Arp', 5, 2, PLUCK_ARP, 2),
      clip(arp, 'Arp', 13, 2, PLUCK_ARP, 2),
      clip(sfx, 'Build-up', 5, 4, BUILD_UP),
      clip(sfx, 'Drop hit', 9, 2, DROP_HIT),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.3 }, { on: true, amount: 1.2 })
  );
}

// ---------- Trap ----------

function trap(): ProjectSnapshot {
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const bass = track('808', 'bass808', { volume: -1 });
  const melody = track('Melody', 'pluck', { volume: 1, reverbSend: 0.35, delaySend: 0.3 });
  const pad = track('Strings', 'strings', { volume: -16, reverbSend: 0.45 });
  // Half-time with rolling hats: 8ths, then 16ths, then 32nd and triplet rolls into the next bar
  const hats = everyBar(2, (b): Step[] => [
    ...Array.from({ length: 6 }, (_, i): Step => [i * 2, D.closedHat, i % 2 ? 0.45 : 0.6]),
    ...(b === 0
      ? [12, 13, 14, 15].map((s): Step => [s, D.closedHat, 0.5])
      : [12, 12.5, 13, 13.5, 14, 14 + 2 / 3, 14 + 4 / 3].map((s, i): Step => [s, D.closedHat, 0.4 + i * 0.06, '32n'])),
  ]);
  const beat = everyBar(2, (b): Step[] => [[0, D.kick, 1], [7, D.kick, 0.8], [8, D.snare, 0.95], ...(b === 1 ? [[11, D.kick, 0.85] as Step, [14, D.openHat, 0.5] as Step] : [])]);
  // The 808 follows the kick
  const slide: Step[] = [[0, 'C1', 1, '4n.'], [7, 'C1', 0.85, '8n'], [16, 'D#1', 1, '4n'], [23, 'G1', 0.9, '4n'], [27, 'F1', 0.85, '8n']];
  const tune: Step[] = [
    [0, 'C5', 0.85], [3, 'D#5', 0.7], [6, 'G5', 0.8], [8, 'F5', 0.75], [11, 'D#5', 0.7], [14, 'D5', 0.7],
    [16, 'C5', 0.85], [19, 'D#5', 0.7], [22, 'G#5', 0.8], [24, 'G5', 0.75], [28, 'D5', 0.7],
  ];
  // Cm - Ab - Fm - G, a bar each
  const padChords: Step[] = [
    [0, ['C3', 'D#3', 'G3', 'C4'], 0.7, '1n'],
    [16, ['G#2', 'C3', 'D#3', 'G#3'], 0.7, '1n'],
    [32, ['F2', 'G#2', 'C3', 'F3'], 0.7, '1n'],
    [48, ['G2', 'B2', 'D3', 'G3'], 0.7, '1n'],
  ];
  return project(
    'Trap starter',
    140,
    0,
    [5, 17],
    [drums, bass, melody, pad],
    [
      clip(drums, 'Hats', 1, 2, hats, 2),
      clip(drums, 'Beat', 5, 2, [...beat, ...hats], 6),
      clip(bass, '808', 5, 2, slide, 6),
      clip(melody, 'Melody', 1, 2, tune, 8),
      clip(pad, 'Pad', 1, 4, padChords, 4),
    ],
    [[1, 'Intro'], [5, 'Hook'], [13, 'Switch-up']],
    master({ on: true, depth: 0.25 }, { on: true, amount: 1.25 })
  );
}

// ---------- Cinematic ----------

function cinematic(): ProjectSnapshot {
  const harp = track('Harp', 'harp', { volume: -6, reverbSend: 0.45, pan: -0.2 });
  const strings = track('Strings', 'strings', { volume: -15, reverbSend: 0.5 });
  const cello = track('Cello', 'cello', { volume: -6, reverbSend: 0.35, pan: 0.15 });
  const horns = track('Horns', 'frenchHorn', { volume: -4, reverbSend: 0.5 });
  const taiko = track('Taiko', 'taiko', { volume: 3, reverbSend: 0.4 });
  const sfx = track('FX', 'fx', { volume: -6, reverbSend: 0.3 });
  // Dm - Bb - Gm - A, a bar each
  const pad: Step[] = [
    [0, ['D3', 'F3', 'A3', 'D4'], 0.7, '1n'],
    [16, ['A#2', 'D3', 'F3', 'A#3'], 0.7, '1n'],
    [32, ['G2', 'A#2', 'D3', 'G3'], 0.7, '1n'],
    [48, ['A2', 'C#3', 'E3', 'A3'], 0.75, '1n'],
  ];
  const roots = ['D', 'A#', 'G', 'A'];
  const thirds = ['F', 'D', 'A#', 'C#'];
  const fifths = ['A', 'F', 'D', 'E'];
  const arp = everyBar(4, (b) => [0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Step => [s, `${[roots, fifths, thirds, fifths][i % 4][b]}${i < 4 ? 4 : 5}`, i % 4 === 0 ? 0.8 : 0.6, '8n']));
  // Driving 8ths on the root, an octave jump on the last two
  const ostinato = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, `${roots[b]}${i >= 6 ? 3 : 2}`, i % 2 ? 0.7 : 0.9, '8n']));
  const theme: Step[] = [
    [0, 'D4', 0.85, '4n.'], [6, 'E4', 0.8, '8n'], [8, 'F4', 0.85, '2n'],
    [16, 'F4', 0.85, '4n.'], [22, 'G4', 0.8, '8n'], [24, 'A4', 0.9, '2n'],
    [32, 'A#4', 0.9, '4n.'], [38, 'A4', 0.8, '8n'], [40, 'G4', 0.85, '2n'],
    [48, 'A4', 0.9, '2n.'], [60, 'C#4', 0.75, '4n'],
  ];
  const war = everyBar(1, (): Step[] => [[0, 'C2', 1, '4n'], [6, 'C2', 0.7, '8n'], [8, 'G2', 0.85, '4n'], [12, 'C2', 0.8, '8n'], [14, 'C2', 0.9, '8n']]);
  return project(
    'Cinematic starter',
    100,
    0,
    [9, 17],
    [harp, strings, cello, horns, taiko, sfx],
    [
      clip(harp, 'Arpeggio', 1, 4, arp, 2),
      clip(strings, 'Pad', 1, 4, pad, 4),
      clip(cello, 'Ostinato', 5, 4, ostinato, 3),
      clip(taiko, 'Build', 5, 1, [[0, 'C2', 0.7, '4n'], [8, 'C2', 0.6, '4n']], 4),
      clip(taiko, 'War drums', 9, 1, war, 8),
      clip(horns, 'Theme', 9, 4, theme, 2),
      clip(sfx, 'Riser', 5, 4, BUILD_UP),
      clip(sfx, 'Impact', 9, 2, DROP_HIT),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Climax']],
    master({ on: false }, { on: true, amount: 1.25 })
  );
}

// ---------- Lo-Fi ----------

function lofi(): ProjectSnapshot {
  const keys = track('Keys', 'rhodes', { volume: -9, reverbSend: 0.3, fx: { chorus: { on: true, rate: 0.8, depth: 0.5, mix: 0.3 } } });
  const drums = track('Drums', 'drums', { volume: 2, fx: { filter: { on: true, type: 'lowpass', cutoff: 3200, resonance: 0.9 }, distortion: { on: true, amount: 0.15 } } });
  const bass = track('Bass', 'bassGuitar', { volume: 0 });
  const melody = track('Flute', 'flute', { volume: -4, reverbSend: 0.45, delaySend: 0.2, pan: 0.2 });
  // Fmaj9 - Em7 - Dm9 - Cmaj9, a bar each, played lazily (a little after the beat)
  const chords: Step[] = [
    [1, ['F3', 'A3', 'C4', 'E4', 'G4'], 0.6, '2n.'],
    [17, ['E3', 'G3', 'B3', 'D4'], 0.6, '2n.'],
    [33, ['D3', 'F3', 'A3', 'C4', 'E4'], 0.6, '2n.'],
    [49, ['C3', 'E3', 'G3', 'B3', 'D4'], 0.6, '2n.'],
  ];
  const beat = everyBar(2, (b): Step[] => [
    [0, D.kick, 0.85], [7, D.kick, 0.55], [10, D.kick, 0.7], ...(b ? [[13, D.kick, 0.5] as Step] : []),
    [4, D.snare, 0.7], [12, D.snare, 0.72],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [s, D.closedHat, s % 4 === 0 ? 0.45 : 0.3]),
  ]);
  const bassLine: Step[] = [
    [0, 'F1', 0.8, '4n.'], [10, 'C2', 0.6, '8n'], [16, 'E1', 0.8, '4n.'], [26, 'B1', 0.6, '8n'],
    [32, 'D2', 0.8, '4n.'], [42, 'A1', 0.6, '8n'], [48, 'C2', 0.8, '4n.'], [58, 'G1', 0.6, '8n'],
  ];
  const tune: Step[] = [
    [4, 'A5', 0.7, '8n'], [6, 'G5', 0.65, '8n'], [8, 'E5', 0.7, '4n.'],
    [22, 'D5', 0.65, '8n'], [24, 'E5', 0.7, '4n'], [28, 'G5', 0.65, '4n'],
    [36, 'F5', 0.7, '8n'], [38, 'E5', 0.65, '8n'], [40, 'C5', 0.7, '2n'],
    [56, 'D5', 0.6, '8n'], [58, 'E5', 0.65, '8n'],
  ];
  return project(
    'Lo-Fi starter',
    82,
    0.3,
    [5, 17],
    [keys, drums, bass, melody],
    [
      clip(keys, 'Chords', 1, 4, chords, 4),
      clip(drums, 'Dusty beat', 5, 2, beat, 6),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(melody, 'Flute', 9, 4, tune, 2),
    ],
    [[1, 'Intro'], [5, 'Groove'], [9, 'Melody']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

// ---------- Chiptune ----------

function chiptune(): ProjectSnapshot {
  const lead = track('Lead', 'chipLead', { volume: 1 });
  const arp = track('Arp', 'chipLead', { volume: -5, pan: 0.25, delaySend: 0.15 });
  const bass = track('Bass', 'chipBass', { volume: -8 });
  const drums = track('Drums', 'chipDrums', { volume: -1 });
  // Am - F - C - G, a bar each
  const triads = [['A4', 'C5', 'E5'], ['F4', 'A4', 'C5'], ['C5', 'E5', 'G5'], ['G4', 'B4', 'D5']];
  const roots = ['A1', 'F1', 'C2', 'G1'];
  const arps = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, triads[b][i % 3], i % 4 === 0 ? 0.8 : 0.55, '16n']));
  const bounce = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 2 ? roots[b].replace(/\d/, (o) => String(Number(o) + 1)) : roots[b], 0.9, '8n']));
  const beat = everyBar(1, (): Step[] => [
    [0, D.kick, 1], [6, D.kick, 0.7], [8, D.kick, 0.9], [4, D.snare, 0.9], [12, D.snare, 0.9],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [s, D.closedHat, 0.6]),
  ]);
  const theme: Step[] = [
    [0, 'E5', 0.9, '8n'], [2, 'A5', 0.9, '8n'], [4, 'B5', 0.9, '8n'], [6, 'C6', 0.9, '4n'], [10, 'B5', 0.8, '8n'], [12, 'A5', 0.85, '4n'],
    [16, 'F5', 0.9, '4n'], [20, 'A5', 0.85, '8n'], [22, 'C6', 0.9, '4n.'], [28, 'A5', 0.8, '8n'], [30, 'C6', 0.8, '8n'],
    [32, 'G5', 0.9, '4n'], [36, 'E5', 0.85, '8n'], [38, 'G5', 0.85, '8n'], [40, 'C6', 0.9, '4n.'], [46, 'E6', 0.85, '8n'],
    [48, 'D6', 0.9, '4n.'], [54, 'B5', 0.85, '8n'], [56, 'G5', 0.85, '4n'], [60, 'B5', 0.8, '8n'], [62, 'D6', 0.8, '8n'],
  ];
  return project(
    'Chiptune starter',
    150,
    0,
    [5, 17],
    [lead, arp, bass, drums],
    [
      clip(arp, 'Arpeggios', 1, 4, arps, 4),
      clip(bass, 'Bounce', 1, 4, bounce, 4),
      clip(drums, 'Beat', 5, 1, beat, 12),
      clip(lead, 'Theme', 5, 4, theme, 3),
    ],
    [[1, 'Intro'], [5, 'Theme'], [13, 'Repeat']],
    master({ on: false }, { on: false })
  );
}

// ---------- Hip-Hop ----------

function hiphop(): ProjectSnapshot {
  const drums = track('Drums', 'drums', { volume: -1, fx: { compressor: { on: true, threshold: -18, ratio: 3, makeup: 1 } } });
  const piano = track('Piano', 'piano', { volume: 4, reverbSend: 0.25 });
  const bass = track('Bass', 'bassGuitar', { volume: 3 });
  const stabs = track('Stabs', 'brass', { volume: 5, reverbSend: 0.3 });
  // Am9 - Dm9, two bars each
  const loop: Step[] = [
    [0, ['A2', 'E3', 'G3', 'B3', 'C4'], 0.65, '2n'], [10, ['A2', 'E3', 'G3', 'B3', 'C4'], 0.5, '8n'], [14, ['G3', 'B3', 'C4'], 0.45, '8n'],
    [32, ['D3', 'F3', 'A3', 'C4', 'E4'], 0.65, '2n'], [42, ['D3', 'F3', 'A3', 'C4', 'E4'], 0.5, '8n'], [46, ['F3', 'A3', 'C4'], 0.45, '8n'],
  ];
  const boomBap = everyBar(2, (b): Step[] => [
    [0, D.kick, 1], [7, D.kick, 0.6], [10, D.kick, 0.85], ...(b ? [[15, D.kick, 0.55] as Step] : []),
    [4, D.snare, 0.95], [12, D.snare, 0.95],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): Step => [s, b && s === 14 ? D.openHat : D.closedHat, s % 4 === 2 ? 0.35 : 0.5]),
  ]);
  const bassLine: Step[] = [[0, 'A1', 0.9, '4n.'], [10, 'A1', 0.7, '8n'], [14, 'G1', 0.7, '8n'], [32, 'D2', 0.9, '4n.'], [42, 'D2', 0.7, '8n'], [46, 'C2', 0.7, '8n']];
  const hook: Step[] = [[0, ['A4', 'C5', 'E5'], 0.85, '8n'], [3, ['A4', 'C5', 'E5'], 0.75, '16n'], [32, ['A4', 'D5', 'F5'], 0.85, '8n'], [35, ['A4', 'D5', 'F5'], 0.75, '16n']];
  return project(
    'Hip-Hop starter',
    90,
    0.15,
    [5, 17],
    [drums, piano, bass, stabs],
    [
      clip(piano, 'Piano loop', 1, 4, loop, 4),
      clip(drums, 'Boom bap', 5, 2, boomBap, 6),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(stabs, 'Hook stabs', 13, 4, hook),
    ],
    [[1, 'Intro'], [5, 'Verse'], [13, 'Hook']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.1 })
  );
}

const BUILDERS: Record<StarterId, () => ProjectSnapshot> = { dubstep, house, dnb, trap, cinematic, lofi, chiptune, hiphop };

/** A fresh copy of a starter (new ids each time). */
export function createStarter(id: StarterId): ProjectSnapshot {
  return BUILDERS[id]();
}
