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

const BUILDERS: Record<StarterId, () => ProjectSnapshot> = { dubstep, house, dnb, trap };

/** A fresh copy of a starter (new ids each time). */
export function createStarter(id: StarterId): ProjectSnapshot {
  return BUILDERS[id]();
}
