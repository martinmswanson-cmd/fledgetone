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
  { id: 'dubstep', group: 'Electronic', name: 'Dubstep', detail: '140 BPM, F minor. Half-time drums, a wobble and growl call-and-response in the drop, supersaw chords pumping to the kick.' },
  { id: 'house', group: 'Electronic', name: 'House', detail: '126 BPM, A minor. Four-on-the-floor, off-beat bass and hats, clav chord stabs, a pluck arp in the peak.' },
  { id: 'trance', group: 'Electronic', name: 'Trance', detail: '138 BPM, A minor. A pluck arp, a snare-roll build with a riser, then pumping supersaws and an off-beat bass.' },
  { id: 'dnb', group: 'Electronic', name: 'Drum & Bass', detail: '174 BPM, F minor. A two-step break, a gliding Reese bass, a string pad and a pluck arp.' },
  { id: 'synthwave', group: 'Electronic', name: 'Synthwave', detail: '100 BPM, A minor. LinnDrum beat, pulsing bass, chorused string machine, an arp and a soaring lead: night drives.' },
  { id: 'chiptune', group: 'Electronic', name: 'Chiptune', detail: '150 BPM, A minor. 8-bit pulse lead and arpeggios, a bouncing triangle bass and a noise kit: retro games.' },
  { id: 'classical', group: 'Orchestral & Choir', name: 'Classical', detail: '92 BPM, D major. A string quartet over a Baroque ground bass, harpsichord continuo, a theme and its variation.' },
  { id: 'angelic', group: 'Orchestral & Choir', name: 'Angelic', detail: '66 BPM, C Lydian. Choir and soft voices, a halo pad, harp and celesta: heaven, healing, sacred places.' },
  { id: 'cinematic', group: 'Orchestral & Choir', name: 'Cinematic', detail: '100 BPM, D minor. Harp and strings, a cello ostinato with taiko building, then French horns over it all: title screens.' },
  { id: 'epic', group: 'Orchestral & Choir', name: 'Epic Orchestral', detail: '130 BPM, C minor. Driving cellos, timpani, tremolo strings and choir, then a brass battle theme: boss fights.' },
  { id: 'horror', group: 'Orchestral & Choir', name: 'Horror', detail: '72 BPM. An eerie drone, string clusters, a broken music-box lullaby and timpani, then a chase.' },
  { id: 'rock', group: 'Band', name: 'Rock', detail: '124 BPM, E minor. A real drum kit with fills, distorted power chords, bass guitar and organ.' },
  { id: 'metal', group: 'Band', name: 'Metal', detail: '170 BPM, E Phrygian. Double-kick blast beat, twin chugging guitars, then a breakdown with choir.' },
  { id: 'pop', group: 'Band', name: 'Pop', detail: '112 BPM, C major. Piano 8ths, a punchy beat, bass guitar, a pluck hook and strings in the chorus.' },
  { id: 'funk', group: 'Band', name: 'Funk', detail: '104 BPM, E9. Ghost-note groove, slap bass, scratchy muted guitar, organ and horn hits.' },
  { id: 'jazz', group: 'Band', name: 'Jazz', detail: '132 BPM, swing. Ride cymbal, walking upright bass, piano comping, alto sax and vibes on a ii-V-I.' },
  { id: 'hiphop', group: 'Band', name: 'Hip-Hop', detail: '90 BPM, boom bap. A swung beat, a piano loop, bass guitar and brass stabs in the hook.' },
  { id: 'trap', group: 'Band', name: 'Trap', detail: '140 BPM, C minor. Half-time drums with hat rolls, a sliding 808, a dark pluck melody over strings.' },
  { id: 'lofi', group: 'Chill & World', name: 'Lo-Fi', detail: '82 BPM, swung. Electric piano ninth chords, a dusty filtered beat, bass guitar and a flute line: calm levels and menus.' },
  { id: 'ambient', group: 'Chill & World', name: 'Ambient', detail: '70 BPM, D major. Warm and glass pads, a kalimba melody and crystal sparkles: exploring, resting.' },
  { id: 'celtic', group: 'Chill & World', name: 'Celtic', detail: '112 BPM, D major. A fiddle reel over strummed guitar and bodhrán, a tin whistle, then the pipes.' },
  { id: 'tavern', group: 'Chill & World', name: 'Fantasy Tavern', detail: '110 BPM, D minor jig. Hammered dulcimer, lute, hand drum, accordion and recorder: inns and villages.' },
  { id: 'latin', group: 'Chill & World', name: 'Latin', detail: '130 BPM, bossa nova. Nylon guitar comping, upright bass, bongos and shaker, a flute melody.' },
  { id: 'eastern', group: 'Chill & World', name: 'Eastern', detail: '84 BPM, D in-scale. Koto, shakuhachi, taiko and shamisen over a glass drone: temples and gardens.' },
] as const;
export type StarterId = (typeof STARTERS)[number]['id'];
export const STARTER_GROUPS = ['Electronic', 'Orchestral & Choir', 'Band', 'Chill & World'] as const;

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

// ---------- Helpers for the starters below ----------

/** One chord (or note) per `every` steps, each held `dur`. */
const progression = (chords: Array<string | string[]>, every: number, dur: string, vel = 0.7): Step[] => chords.map((c, i): Step => [i * every, c, vel, dur]);

/** A rock/pop beat: kick on 1 and 3 (and the "and" of 3), snare on 2 and 4, 8th hats. */
const rockBeat = (bars: number, hat: string = D.closedHat): Step[] =>
  everyBar(bars, (): Step[] => [
    [0, D.kick, 1], [8, D.kick, 0.9], [10, D.kick, 0.75],
    [4, D.snare, 0.95], [12, D.snare, 0.95],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((i): Step => [i, hat, i % 4 === 0 ? 0.7 : 0.5]),
  ]);

/** A tom fill over the last beat or two of a bar, ending on a crash next bar's downbeat (with `crashAt`). */
const tomFill = (from: number): Step[] => [
  [from, D.tomHigh, 0.8], [from + 1, D.tomHigh, 0.75], [from + 2, D.tomMid, 0.8], [from + 3, D.tomMid, 0.75],
  [from + 4, D.tomLow, 0.85], [from + 5, D.tomLow, 0.8], [from + 6, D.snare, 0.9], [from + 7, D.snare, 0.95],
];

// ---------- Classical ----------

function classical(): ProjectSnapshot {
  const vln1 = track('Violin I', 'violin', { volume: -3, pan: -0.35, reverbSend: 0.35 });
  const vln2 = track('Violin II', 'violin', { volume: -9, pan: -0.15, reverbSend: 0.35 });
  const viola = track('Viola', 'viola', { volume: -4, pan: 0.15, reverbSend: 0.35 });
  const cello = track('Cello', 'cello', { volume: -4, pan: 0.35, reverbSend: 0.35 });
  const harpsi = track('Harpsichord', 'harpsichord', { volume: -8, reverbSend: 0.25 });
  // D - A - Bm - F#m - G - D - G - A, two beats each (the Canon's ground)
  const roots = ['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2'];
  const triads = [['D4', 'F#4', 'A4'], ['C#4', 'E4', 'A4'], ['D4', 'F#4', 'B4'], ['C#4', 'F#4', 'A4'], ['D4', 'G4', 'B4'], ['D4', 'F#4', 'A4'], ['D4', 'G4', 'B4'], ['C#4', 'E4', 'A4']];
  const ground = progression(roots, 8, '2n', 0.75);
  const violaPart = triads.flatMap((t, i): Step[] => [[i * 8, t[1], 0.6, '4n'], [i * 8 + 4, t[2], 0.55, '4n']]);
  const broken = triads.flatMap((t, i): Step[] => [t[0], t[1], t[2], t[1]].map((n, j): Step => [i * 8 + j * 2, n.replace('4', '5'), j === 0 ? 0.6 : 0.5, '8n']));
  const theme = progression(['F#5', 'E5', 'D5', 'C#5', 'B4', 'A4', 'B4', 'C#5'], 8, '2n', 0.8);
  const variation: Step[] = [['D5', 'F#5'], ['E5', 'C#5'], ['D5', 'B4'], ['C#5', 'A4'], ['B4', 'D5'], ['A4', 'F#4'], ['G4', 'B4'], ['A4', 'C#5']].flatMap(([a, b], i): Step[] => [[i * 8, a, 0.8, '4n'], [i * 8 + 4, b, 0.75, '4n']]);
  const continuo = triads.map((t, i): Step => [i * 8, t, 0.6, '2n']);
  return project(
    'Classical starter',
    92,
    0,
    [9, 17],
    [vln1, vln2, viola, cello, harpsi],
    [
      clip(cello, 'Ground bass', 1, 4, ground, 4),
      clip(viola, 'Inner voice', 1, 4, violaPart, 4),
      clip(vln2, 'Arpeggios', 5, 4, broken, 3),
      clip(vln1, 'Theme', 9, 4, theme),
      clip(vln1, 'Variation', 13, 4, variation),
      clip(harpsi, 'Continuo', 9, 4, continuo, 2),
    ],
    [[1, 'Ground'], [5, 'Second violins'], [9, 'Theme'], [13, 'Variation']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

// ---------- Angelic ----------

function angelic(): ProjectSnapshot {
  const choir = track('Choir', 'choir', { volume: -4, reverbSend: 0.6 });
  const voices = track('Voices', 'voiceOohs', { volume: -1, reverbSend: 0.65, delaySend: 0.15 });
  const halo = track('Halo', 'haloPad', { volume: -8, reverbSend: 0.5 });
  const harp = track('Harp', 'harp', { volume: -6, pan: -0.25, reverbSend: 0.55 });
  const celesta = track('Celesta', 'celesta', { volume: -1, pan: 0.3, reverbSend: 0.6, delaySend: 0.25 });
  // Cmaj7 - D/C - Em7 - Am7: the raised fourth of D/C gives the floating, heavenly sound
  const chords = [['C4', 'E4', 'G4', 'B4'], ['C4', 'D4', 'F#4', 'A4'], ['B3', 'E4', 'G4', 'D5'], ['A3', 'C4', 'E4', 'G4']];
  const pad = progression([['C3', 'G3', 'E4'], ['C3', 'A3', 'F#4'], ['E3', 'B3', 'G4'], ['A2', 'E3', 'C4']], 16, '1n', 0.6);
  const choirPart = progression(chords, 16, '1n', 0.7);
  const arp = everyBar(4, (b) => [0, 1, 2, 3, 2, 1, 2, 3].map((k, i): Step => [i * 2, chords[b][k].replace(/\d/, (o) => String(Number(o) + (i >= 4 ? 1 : 0))), i === 0 ? 0.7 : 0.5, '4n']));
  const melody: Step[] = [
    [0, 'E5', 0.7, '2n'], [8, 'D5', 0.65, '2n'], [16, 'F#5', 0.7, '2n.'], [28, 'E5', 0.6, '4n'],
    [32, 'D5', 0.7, '2n'], [40, 'B4', 0.65, '2n'], [48, 'C5', 0.7, '1n'],
  ];
  const sparkle = everyBar(4, (b) => [0, 3, 6, 10].map((st, i): Step => [st, chords[b][(i + b) % 4].replace(/\d/, '6'), 0.5, '8n']));
  return project(
    'Angelic starter',
    66,
    0,
    [9, 17],
    [choir, voices, halo, harp, celesta],
    [
      clip(halo, 'Halo', 1, 4, pad, 4),
      clip(harp, 'Harp', 1, 4, arp, 4),
      clip(choir, 'Choir', 5, 4, choirPart, 3),
      clip(voices, 'Melody', 9, 4, melody, 2),
      clip(celesta, 'Sparkle', 9, 4, sparkle, 2),
    ],
    [[1, 'Light'], [5, 'Choir'], [9, 'Heaven']],
    master({ on: false }, { on: true, amount: 1.3 })
  );
}

// ---------- Epic Orchestral ----------

function epic(): ProjectSnapshot {
  const lows = track('Low strings', 'contrabass', { volume: -4, reverbSend: 0.3 });
  const celli = track('Cellos', 'cello', { volume: -6, reverbSend: 0.3 });
  const trem = track('Tremolo', 'tremolo', { volume: -10, reverbSend: 0.45 });
  const brass = track('Brass', 'brassSection', { volume: -1, reverbSend: 0.45 });
  const choir = track('Choir', 'choir', { volume: -5, reverbSend: 0.55 });
  const timp = track('Timpani', 'timpani', { volume: -2, reverbSend: 0.4 });
  const perc = track('Percussion', 'acousticKit', { volume: -1, reverbSend: 0.35 });
  // Cm - Ab - Eb - Bb, a bar each
  const roots = ['C', 'G#', 'D#', 'A#'];
  const ostinato = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, `${roots[b]}${i % 4 === 3 ? 3 : 2}`, i % 4 === 0 ? 0.9 : 0.6, '16n']));
  const lowNotes = progression(['C2', 'G#1', 'D#2', 'A#1'], 16, '1n', 0.8);
  const chords = [['C4', 'D#4', 'G4'], ['C4', 'D#4', 'G#4'], ['A#3', 'D#4', 'G4'], ['A#3', 'D4', 'F4']];
  const tremChords = progression(chords.map((c) => c.map((n) => n.replace('4', '5').replace('3', '4'))), 16, '1n', 0.65);
  const choirPart = progression(chords, 16, '1n', 0.75);
  const theme: Step[] = [
    [0, 'C4', 0.95, '4n.'], [6, 'D4', 0.85, '8n'], [8, 'D#4', 0.95, '2n'],
    [16, 'G#4', 0.95, '4n.'], [22, 'G4', 0.85, '8n'], [24, 'D#4', 0.9, '2n'],
    [32, 'G4', 0.95, '4n.'], [38, 'F4', 0.85, '8n'], [40, 'D#4', 0.9, '4n'], [44, 'D4', 0.85, '4n'],
    [48, 'D4', 0.95, '2n.'], [60, 'G3', 0.85, '4n'],
  ];
  const rolls = everyBar(1, (): Step[] => [[0, 'C2', 1, '4n'], [8, 'G2', 0.85, '4n'], [12, 'C2', 0.7, '16n'], [13, 'C2', 0.75, '16n'], [14, 'C2', 0.8, '16n'], [15, 'C2', 0.85, '16n']]);
  const battle = everyBar(2, (b): Step[] => [
    [0, D.kick, 1], ...(b === 0 ? [[0, D.crash, 0.8] as Step] : []), [4, D.tomLow, 0.85], [6, D.tomLow, 0.7], [8, D.kick, 0.95], [8, D.snare, 0.8], [12, D.tomMid, 0.85], [14, D.tomHigh, 0.8],
  ]);
  return project(
    'Epic Orchestral starter',
    130,
    0,
    [9, 17],
    [lows, celli, trem, brass, choir, timp, perc],
    [
      clip(celli, 'Ostinato', 1, 4, ostinato, 4),
      clip(lows, 'Basses', 5, 4, lowNotes, 3),
      clip(timp, 'Timpani', 1, 1, rolls, 16),
      clip(trem, 'Tremolo', 5, 4, tremChords, 3),
      clip(choir, 'Choir', 5, 4, choirPart, 3),
      clip(brass, 'Battle theme', 9, 4, theme, 2),
      clip(perc, 'Battle drums', 9, 2, battle, 4),
    ],
    [[1, 'Tension'], [5, 'Rise'], [9, 'Battle']],
    master({ on: true, depth: 0.15 }, { on: true, amount: 1.2 })
  );
}

// ---------- Ambient ----------

function ambient(): ProjectSnapshot {
  const warm = track('Warm pad', 'warmPad', { volume: -6, reverbSend: 0.5 });
  const glass = track('Glass', 'glassPad', { volume: -6, reverbSend: 0.6, pan: 0.2 });
  const kalimba = track('Kalimba', 'kalimba', { volume: -2, reverbSend: 0.5, delaySend: 0.35, pan: -0.2 });
  const crystal = track('Crystal', 'crystal', { volume: -4, reverbSend: 0.7, delaySend: 0.3, pan: 0.3 });
  // Dmaj9 - Bm11 - Gmaj9 - A6sus, two bars each
  const pad = progression([['D3', 'A3', 'C#4', 'E4'], ['B2', 'F#3', 'A3', 'E4'], ['G2', 'D3', 'F#3', 'A3'], ['A2', 'E3', 'F#3', 'B3']], 32, '2m', 0.6);
  const air = progression([['F#5', 'A5'], ['D5', 'F#5'], ['B4', 'D5'], ['C#5', 'E5']], 32, '2m', 0.5);
  const tune: Step[] = [
    [0, 'F#5', 0.7, '4n'], [3, 'A5', 0.6, '4n'], [6, 'E5', 0.65, '4n'], [12, 'D5', 0.6, '4n'],
    [20, 'C#5', 0.6, '4n'], [24, 'E5', 0.65, '4n'], [28, 'F#5', 0.6, '4n'],
    [36, 'D5', 0.65, '4n'], [40, 'B4', 0.6, '4n'], [46, 'A4', 0.6, '4n'], [52, 'B4', 0.55, '4n'], [56, 'D5', 0.6, '2n'],
  ];
  const shimmer: Step[] = [[0, 'A6', 0.5, '2n'], [22, 'E6', 0.45, '2n'], [40, 'F#6', 0.5, '2n'], [58, 'C#6', 0.4, '2n']];
  return project(
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
  );
}

// ---------- Rock ----------

function rock(): ProjectSnapshot {
  const drums = track('Drums', 'acousticKit', { volume: 3, reverbSend: 0.15 });
  const gtr = track('Guitar', 'distortionGuitar', { volume: -7, pan: -0.3 });
  const gtr2 = track('Guitar 2', 'overdriveGuitar', { volume: -7, pan: 0.3 });
  const bass = track('Bass', 'bassGuitar', { volume: 1 });
  const organ = track('Organ', 'rockOrgan', { volume: -10, reverbSend: 0.2 });
  // Em - C - G - D, a bar each, as power chords
  const power = (root: string) => { const m = Number(root.slice(-1)); const p = root.slice(0, -1); return [root, `${({ E: 'B', C: 'G', G: 'D', D: 'A' } as Record<string, string>)[p]}${p === 'G' || p === 'D' ? m + 1 : m}`, `${p}${m + 1}`]; };
  const roots = ['E2', 'C3', 'G2', 'D3'];
  const chug = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, power(roots[b]), i % 4 === 0 ? 0.95 : 0.75, '8n']));
  const ring = everyBar(4, (b): Step[] => [[0, power(roots[b]), 0.95, '2n.'], [12, power(roots[b]), 0.8, '4n']]);
  const bassLine = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, roots[b].replace(/\d/, (o) => String(Number(o) - 1)), 0.85, '8n']));
  const organChords = progression([['E4', 'G4', 'B4'], ['E4', 'G4', 'C5'], ['D4', 'G4', 'B4'], ['D4', 'F#4', 'A4']], 16, '1n', 0.6);
  const beat = rockBeat(4);
  const fill = [...rockBeat(1).filter(([st]) => st < 8), ...tomFill(8)];
  const verse = [...beat.filter(([st]) => st < 48), ...fill.map(([st, n, v, d]): Step => [st + 48, n, v, d])];
  const chorus: Step[] = [[0, D.crash, 0.85, '1n'], ...rockBeat(4, D.ride).filter(([st]) => st < 48), ...fill.map(([st, n, v, d]): Step => [st + 48, n, v, d])];
  return project(
    'Rock starter',
    124,
    0,
    [9, 17],
    [drums, gtr, gtr2, bass, organ],
    [
      clip(gtr, 'Riff', 1, 4, chug, 2),
      clip(drums, 'Verse beat', 5, 4, verse),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(drums, 'Chorus beat', 9, 4, chorus, 2),
      clip(gtr, 'Chorus', 9, 4, ring, 2),
      clip(gtr2, 'Chugs', 9, 4, chug, 2),
      clip(organ, 'Organ', 9, 4, organChords, 2),
    ],
    [[1, 'Intro'], [5, 'Verse'], [9, 'Chorus']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.15 })
  );
}

// ---------- Metal ----------

function metal(): ProjectSnapshot {
  const drums = track('Drums', 'acousticKit', { volume: -3, fx: { compressor: { on: true, threshold: -16, ratio: 4, makeup: 2 } } });
  const left = track('Guitar L', 'distortionGuitar', { volume: -5, pan: -0.5 });
  const right = track('Guitar R', 'distortionGuitar', { volume: -5, pan: 0.5 });
  const bass = track('Bass', 'bassGuitar', { volume: 0, fx: { distortion: { on: true, amount: 0.25 } } });
  const choir = track('Choir', 'choir', { volume: -9, reverbSend: 0.5 });
  // E Phrygian: chugs on low E with stabs up to F, G and A#
  const riff = everyBar(2, (b): Step[] => [
    ...[0, 1, 2, 4, 5, 6, 8, 9].map((i): Step => [i, ['E2', 'B2'], 0.9, '16n']),
    [3, ['F2', 'C3'], 0.95, '16n'], [7, ['G2', 'D3'], 0.95, '16n'], [10, ['E2', 'B2'], 0.9, '8n'],
    [12, b ? ['A#2', 'F3'] : ['G2', 'D3'], 1, '8n'], [14, b ? ['A2', 'E3'] : ['F2', 'C3'], 1, '8n'],
  ]);
  const bassRiff = riff.map(([st, n, v, d]): Step => [st, (n as string[])[0].replace('2', '1'), v, d]);
  const blast = everyBar(1, (): Step[] => [
    ...Array.from({ length: 16 }, (_, i): Step => [i, D.kick, i % 4 === 0 ? 1 : 0.8]),
    [4, D.snare, 1], [12, D.snare, 1], [0, D.crash, 0.75], [8, D.crash, 0.6],
  ]);
  const breakdown = everyBar(2, (b): Step[] => [
    [0, D.kick, 1], [0, D.crash, 0.9], [3, D.kick, 0.9], [6, D.kick, 0.9], [8, D.snare, 1], [10, D.kick, 0.85], [11, D.kick, 0.85], ...(b ? [[14, D.tomLow, 0.9] as Step, [15, D.tomLow, 0.95] as Step] : []),
    ...[0, 4, 8, 12].map((i): Step => [i, D.ride, 0.6]),
  ]);
  const chug = everyBar(2, (b): Step[] => [[0, ['E2', 'B2'], 1, '8n'], [3, ['E2', 'B2'], 0.95, '16n'], [6, ['E2', 'B2'], 0.95, '16n'], [10, ['E2', 'B2'], 0.9, '16n'], [11, ['E2', 'B2'], 0.9, '16n'], ...(b ? [[14, ['A#2', 'F3'], 1, '8n'] as Step] : [])]);
  const choirPart = progression([['E4', 'G4', 'B4'], ['F4', 'A4', 'C5'], ['E4', 'G4', 'B4'], ['D4', 'F4', 'A#4']], 16, '1n', 0.7);
  return project(
    'Metal starter',
    170,
    0,
    [9, 17],
    [drums, left, right, bass, choir],
    [
      clip(left, 'Riff', 1, 2, riff, 4),
      clip(right, 'Riff', 1, 2, riff, 4),
      clip(bass, 'Riff', 1, 2, bassRiff, 4),
      clip(drums, 'Blast', 1, 1, blast, 8),
      clip(drums, 'Breakdown', 9, 2, breakdown, 4),
      clip(left, 'Breakdown', 9, 2, chug, 4),
      clip(right, 'Breakdown', 9, 2, chug, 4),
      clip(bass, 'Breakdown', 9, 2, chug.map(([st, n, v, d]): Step => [st, (n as string[])[0].replace('2', '1'), v, d]), 4),
      clip(choir, 'Choir', 9, 4, choirPart, 2),
    ],
    [[1, 'Riff'], [9, 'Breakdown']],
    master({ on: true, depth: 0.25 }, { on: true, amount: 1.2 })
  );
}

// ---------- Jazz ----------

function jazz(): ProjectSnapshot {
  const drums = track('Drums', 'acousticKit', { volume: 5, reverbSend: 0.2 });
  const bass = track('Upright bass', 'uprightBass', { volume: 0 });
  const piano = track('Piano', 'piano', { volume: 3, reverbSend: 0.25, pan: -0.15 });
  const sax = track('Sax', 'saxophone', { volume: -2, reverbSend: 0.3, pan: 0.15 });
  const vibes = track('Vibes', 'vibraphone', { volume: 0, reverbSend: 0.35, pan: 0.3 });
  // ii - V - I - VI in C (Dm7 G7 Cmaj7 A7), a bar each. Swung 8ths are written as triplets: the off-beat two triplet 8ths (2.67 steps) after the beat
  const tri = 4 / 3;
  const ride = everyBar(4, (): Step[] => [
    [0, D.ride, 0.7], [4, D.ride, 0.75], [4 + 2 * tri, D.ride, 0.55], [8, D.ride, 0.7], [12, D.ride, 0.75], [12 + 2 * tri, D.ride, 0.55],
    [4, D.closedHat, 0.5], [12, D.closedHat, 0.5], [0, D.kick, 0.35], [8, D.kick, 0.3], [10 + tri, D.snare, 0.25],
  ]);
  const walk: Step[] = ['D2', 'F2', 'A2', 'C3', 'G2', 'B1', 'D2', 'F2', 'C2', 'E2', 'G2', 'B2', 'A1', 'C#2', 'E2', 'G2'].map((n, i): Step => [i * 4, n, i % 4 === 0 ? 0.9 : 0.75, '4n']);
  const voicings = [['F3', 'A3', 'C4', 'E4'], ['F3', 'B3', 'E4'], ['E3', 'G3', 'B3', 'D4'], ['C#4', 'G4', 'B4']];
  const comp = everyBar(4, (b): Step[] => [[4 + 2 * tri, voicings[b], 0.6, '8n'], [12, voicings[b], 0.5, '4n']]);
  const head: Step[] = [
    [0, 'A4', 0.8, '4n'], [4 + 2 * tri, 'C5', 0.75, '8n'], [8, 'E5', 0.85, '4n'], [12, 'D5', 0.75, '4n'],
    [16, 'B4', 0.8, '4n.'], [24, 'G4', 0.7, '8n'], [24 + 2 * tri, 'A4', 0.75, '8n'], [28, 'B4', 0.75, '4n'],
    [32, 'C5', 0.85, '2n'], [40 + 2 * tri, 'E5', 0.7, '8n'], [44, 'D5', 0.7, '4n'],
    [48, 'C#5', 0.8, '4n'], [52, 'A4', 0.7, '4n'], [56, 'G4', 0.7, '4n'], [60, 'E4', 0.7, '4n'],
  ];
  const vibeLine = progression([['F4', 'A4', 'E5'], ['F4', 'B4', 'E5'], ['E4', 'G4', 'D5'], ['C#5', 'G5']], 16, '2n', 0.5);
  return project(
    'Jazz starter',
    132,
    0,
    [5, 17],
    [drums, bass, piano, sax, vibes],
    [
      clip(drums, 'Ride', 1, 4, ride, 4),
      clip(bass, 'Walking bass', 1, 4, walk, 4),
      clip(piano, 'Comping', 1, 4, comp, 4),
      clip(sax, 'Head', 5, 4, head, 2),
      clip(vibes, 'Vibes', 13, 4, vibeLine),
      clip(sax, 'Head', 13, 4, head),
    ],
    [[1, 'Intro'], [5, 'Head'], [13, 'Out chorus']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

// ---------- Synthwave ----------

function synthwave(): ProjectSnapshot {
  const drums = track('Drums', 'linnDrum', { volume: 0, reverbSend: 0.25 });
  const bass = track('Bass', 'reeseBass', { volume: -4, fx: { filter: { on: true, type: 'lowpass', cutoff: 900, resonance: 1 } } });
  const pads = track('Strings', 'synthStrings', { volume: -8, reverbSend: 0.4, fx: { chorus: { on: true, rate: 0.6, depth: 0.6, mix: 0.4 } } });
  const arp = track('Arp', 'pluck', { volume: -3, delaySend: 0.35, pan: 0.2 });
  const lead = track('Lead', 'lead', { volume: -2, reverbSend: 0.35, delaySend: 0.25 });
  // Am - F - C - G, a bar each
  const roots = ['A1', 'F1', 'C2', 'G1'];
  const triads = [['A3', 'C4', 'E4'], ['A3', 'C4', 'F4'], ['G3', 'C4', 'E4'], ['G3', 'B3', 'D4']];
  const pulse = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 2 ? roots[b].replace(/\d/, (o) => String(Number(o) + 1)) : roots[b], 0.85, '8n']));
  const pad = progression(triads, 16, '1n', 0.65);
  const arps = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, triads[b][i % 3].replace(/\d/, (o) => String(Number(o) + 1)), i % 4 === 0 ? 0.75 : 0.5, '16n']));
  const beat = everyBar(1, (): Step[] => [
    [0, D.kick, 1], [8, D.kick, 0.95], [4, D.snare, 0.95], [12, D.snare, 0.95], [4, D.clap, 0.6], [12, D.clap, 0.6],
    ...Array.from({ length: 16 }, (_, i): Step => [i, D.closedHat, i % 2 ? 0.35 : 0.55]),
  ]);
  const melody: Step[] = [
    [0, 'E5', 0.85, '4n.'], [6, 'D5', 0.75, '8n'], [8, 'C5', 0.8, '4n'], [12, 'A4', 0.75, '4n'],
    [16, 'C5', 0.85, '2n'], [24, 'F5', 0.8, '4n'], [28, 'E5', 0.75, '4n'],
    [32, 'G5', 0.85, '4n.'], [38, 'E5', 0.75, '8n'], [40, 'C5', 0.8, '2n'],
    [48, 'D5', 0.85, '2n.'], [60, 'B4', 0.7, '4n'],
  ];
  return project(
    'Synthwave starter',
    100,
    0,
    [9, 17],
    [drums, bass, pads, arp, lead],
    [
      clip(pads, 'Strings', 1, 4, pad, 4),
      clip(arp, 'Arp', 1, 4, arps, 4),
      clip(bass, 'Pulse', 5, 4, pulse, 3),
      clip(drums, 'Beat', 5, 1, beat, 12),
      clip(lead, 'Lead', 9, 4, melody, 2),
    ],
    [[1, 'Night drive'], [5, 'Groove'], [9, 'Lead']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.3 })
  );
}

// ---------- Pop ----------

function pop(): ProjectSnapshot {
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const piano = track('Piano', 'piano', { volume: 2, reverbSend: 0.25 });
  const bass = track('Bass', 'bassGuitar', { volume: 0 });
  const hook = track('Hook', 'pluck', { volume: 3, delaySend: 0.2, reverbSend: 0.25 });
  const strings = track('Strings', 'slowStrings', { volume: -7, reverbSend: 0.4 });
  // C - G - Am - F, a bar each
  const triads = [['C4', 'E4', 'G4'], ['B3', 'D4', 'G4'], ['C4', 'E4', 'A4'], ['C4', 'F4', 'A4']];
  const roots = ['C2', 'G1', 'A1', 'F1'];
  const keys = everyBar(4, (b) => Array.from({ length: 8 }, (_, i): Step => [i * 2, triads[b], i % 4 === 0 ? 0.7 : 0.5, '8n']));
  const bassLine = everyBar(4, (b): Step[] => [[0, roots[b], 0.9, '4n.'], [6, roots[b], 0.7, '8n'], [10, roots[b], 0.75, '8n'], [12, roots[b].replace(/\d/, (o) => String(Number(o) + 1)), 0.7, '8n']]);
  const beat = everyBar(1, (): Step[] => [
    [0, D.kick, 1], [6, D.kick, 0.7], [8, D.kick, 0.9], [4, D.clap, 0.9], [12, D.clap, 0.9],
    ...[0, 2, 4, 6, 8, 10, 12, 14].map((i): Step => [i, D.closedHat, i % 4 === 2 ? 0.55 : 0.4]),
  ]);
  const tune: Step[] = [
    [0, 'G5', 0.85, '8n'], [2, 'E5', 0.8, '8n'], [4, 'G5', 0.85, '8n'], [6, 'A5', 0.8, '4n'], [10, 'G5', 0.75, '8n'],
    [16, 'D5', 0.8, '8n'], [18, 'G5', 0.85, '4n'], [22, 'F5', 0.75, '8n'], [24, 'E5', 0.8, '4n'],
    [32, 'E5', 0.8, '8n'], [34, 'C5', 0.75, '8n'], [36, 'E5', 0.8, '8n'], [38, 'A5', 0.85, '4n'], [42, 'G5', 0.75, '8n'],
    [48, 'F5', 0.8, '4n'], [52, 'E5', 0.75, '4n'], [56, 'D5', 0.8, '4n'], [60, 'C5', 0.75, '4n'],
  ];
  const pad = progression([['E5', 'G5'], ['D5', 'G5'], ['E5', 'A5'], ['F5', 'A5']], 16, '1n', 0.6);
  return project(
    'Pop starter',
    112,
    0,
    [9, 17],
    [drums, piano, bass, hook, strings],
    [
      clip(piano, 'Piano', 1, 4, keys, 4),
      clip(drums, 'Beat', 5, 1, beat, 12),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(hook, 'Hook', 9, 4, tune, 2),
      clip(strings, 'Strings', 9, 4, pad, 2),
    ],
    [[1, 'Intro'], [5, 'Verse'], [9, 'Chorus']],
    master({ on: true, depth: 0.25 }, { on: true, amount: 1.2 })
  );
}

// ---------- Trance ----------

function trance(): ProjectSnapshot {
  const drums = track('Drums', 'drumMachine', { volume: -2 });
  const bass = track('Bass', 'subBass', { volume: -3, fx: { pump: { on: true, depth: 0.8, release: 200, trigger: 'kick' } } });
  const chords = track('Supersaw', 'supersaw', { volume: 3, reverbSend: 0.35, fx: { pump: { on: true, depth: 0.7, release: 240, trigger: 'kick' } } });
  const arp = track('Pluck arp', 'pluck', { volume: -4, delaySend: 0.3, pan: -0.2 });
  const sfx = track('FX', 'fx', { volume: -6, reverbSend: 0.3 });
  const kit = everyBar(1, (): Step[] => [...[0, 4, 8, 12].map((i): Step => [i, D.kick, 1]), ...[2, 6, 10, 14].map((i): Step => [i, D.openHat, 0.6]), [4, D.clap, 0.8], [12, D.clap, 0.8]]);
  const roots = ['A1', 'F1', 'C2', 'G1'];
  const offbeat = everyBar(4, (b) => [2, 6, 10, 14].map((i): Step => [i, roots[b], 0.9, '8n']));
  const arps = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, [['A4', 'C5', 'E5', 'A5'], ['F4', 'A4', 'C5', 'F5'], ['G4', 'C5', 'E5', 'G5'], ['G4', 'B4', 'D5', 'G5']][b][[0, 1, 2, 3, 2, 1][i % 6]], i % 4 === 0 ? 0.8 : 0.55, '16n']));
  const saws = progression([['A3', 'C4', 'E4', 'A4'], ['A3', 'C4', 'F4', 'A4'], ['G3', 'C4', 'E4', 'G4'], ['G3', 'B3', 'D4', 'G4']], 16, '1n', 0.75);
  return project(
    'Trance starter',
    138,
    0,
    [9, 17],
    [drums, bass, chords, arp, sfx],
    [
      clip(drums, 'Four to the floor', 1, 1, kit, 4),
      clip(drums, 'Snare roll', 5, 4, snareRoll),
      clip(drums, 'Four to the floor', 9, 1, kit, 8),
      clip(arp, 'Arp', 1, 4, arps, 4),
      clip(bass, 'Offbeat bass', 1, 4, offbeat),
      clip(bass, 'Offbeat bass', 9, 4, offbeat, 2),
      clip(chords, 'Supersaws', 9, 4, saws, 2),
      clip(sfx, 'Build-up', 5, 4, BUILD_UP),
      clip(sfx, 'Drop hit', 9, 2, DROP_HIT),
    ],
    [[1, 'Intro'], [5, 'Build'], [9, 'Drop']],
    master({ on: true, depth: 0.35 }, { on: true, amount: 1.3 })
  );
}

// ---------- Horror ----------

function horror(): ProjectSnapshot {
  const drone = track('Drone', 'goblins', { volume: -6, reverbSend: 0.5 });
  const trem = track('Tremolo', 'tremolo', { volume: -10, reverbSend: 0.5 });
  const box = track('Music box', 'musicBox', { volume: -2, reverbSend: 0.6, delaySend: 0.3 });
  const timp = track('Timpani', 'timpani', { volume: -2, reverbSend: 0.5 });
  const space = track('Swells', 'sciFi', { volume: -4, reverbSend: 0.6, pan: 0.3 });
  const dread: Step[] = [[0, ['C2', 'C3'], 0.7, '4m']];
  const cluster = progression([['C4', 'C#4'], ['C4', 'D4', 'D#4'], ['B3', 'C4'], ['C4', 'F#4']], 16, '1n', 0.55);
  // A lullaby in C minor, a little wrong
  const lullaby: Step[] = [
    [0, 'G5', 0.6, '4n'], [4, 'D#5', 0.55, '4n'], [8, 'C5', 0.6, '4n'], [12, 'D#5', 0.5, '4n'],
    [16, 'D5', 0.6, '4n'], [20, 'B4', 0.55, '4n'], [24, 'G4', 0.6, '2n'],
    [32, 'G#4', 0.6, '4n'], [36, 'C5', 0.55, '4n'], [40, 'D#5', 0.6, '4n'], [44, 'F#5', 0.5, '4n'],
    [48, 'G5', 0.6, '2n'], [56, 'C#5', 0.45, '2n'],
  ];
  const hits: Step[] = [[0, 'C2', 0.9, '2n'], [26, 'C2', 0.7, '4n'], [40, 'F#2', 0.85, '2n'], [58, 'C2', 0.6, '8n'], [60, 'C2', 0.7, '8n'], [62, 'C2', 0.8, '8n']];
  const chase = everyBar(1, (): Step[] => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 4 === 3 ? 'C#2' : 'C2', 0.6 + i * 0.04, '8n']));
  const swell: Step[] = [[0, ['C3', 'F#3'], 0.6, '2m'], [32, ['D#3', 'A3'], 0.6, '2m']];
  return project(
    'Horror starter',
    72,
    0,
    [5, 13],
    [drone, trem, box, timp, space],
    [
      clip(drone, 'Dread', 1, 4, dread, 4),
      clip(trem, 'Cluster', 1, 4, cluster, 4),
      clip(box, 'Lullaby', 5, 4, lullaby, 2),
      clip(timp, 'Hits', 5, 4, hits, 2),
      clip(space, 'Swells', 9, 4, swell),
      clip(timp, 'Chase', 13, 1, chase, 4),
    ],
    [[1, 'Dread'], [5, 'Lullaby'], [13, 'Chase']],
    master({ on: false }, { on: true, amount: 1.3 })
  );
}

// ---------- Celtic ----------

function celtic(): ProjectSnapshot {
  const fiddle = track('Fiddle', 'fiddle', { volume: -2, pan: -0.2, reverbSend: 0.3 });
  const whistle = track('Whistle', 'recorder', { volume: -3, pan: 0.25, reverbSend: 0.3 });
  const guitar = track('Guitar', 'guitar', { volume: -8, reverbSend: 0.2 });
  const bodhran = track('Bodhrán', 'bongos', { volume: 4, reverbSend: 0.2 });
  const pipes = track('Pipes', 'bagpipe', { volume: -8, reverbSend: 0.4, pan: 0.1 });
  // A reel in D: D - G - D - A, a bar each
  const strums = [['D3', 'A3', 'D4', 'F#4'], ['G2', 'D3', 'G3', 'B3', 'D4'], ['D3', 'A3', 'D4', 'F#4'], ['A2', 'E3', 'A3', 'C#4', 'E4']];
  const strum = everyBar(4, (b) => [0, 3, 4, 6, 8, 11, 12, 14].map((i, k): Step => [i, strums[b], k % 2 ? 0.5 : 0.75, '8n']));
  const reel: Step[] = [
    'F#5', 'A5', 'A5', 'F#5', 'D5', 'F#5', 'A5', 'F#5', 'G5', 'B5', 'B5', 'A5', 'G5', 'F#5', 'E5', 'D5',
    'F#5', 'A5', 'A5', 'F#5', 'D5', 'F#5', 'A5', 'D6', 'C#6', 'A5', 'E5', 'F#5', 'G5', 'E5', 'C#5', 'E5',
  ].map((n, i): Step => [i * 2, n, i % 4 === 0 ? 0.85 : 0.7, '8n']);
  const harmony = reel.map(([st, n, v, d]): Step => [st, n, v * 0.85, d]).filter((_, i) => i % 2 === 0);
  const drum = everyBar(1, (): Step[] => [[0, D.tomLow, 0.95], [3, D.tomMid, 0.5], [4, D.tomLow, 0.7], [6, D.tomHigh, 0.55], [8, D.tomLow, 0.9], [11, D.tomMid, 0.5], [12, D.tomLow, 0.7], [14, D.snare, 0.5]]);
  const drone: Step[] = [[0, ['D4', 'A4'], 0.6, '4m']];
  return project(
    'Celtic starter',
    112,
    0,
    [5, 17],
    [fiddle, whistle, guitar, bodhran, pipes],
    [
      clip(guitar, 'Strum', 1, 4, strum, 4),
      clip(bodhran, 'Bodhrán', 1, 1, drum, 16),
      clip(fiddle, 'Reel', 5, 4, reel, 3),
      clip(whistle, 'Whistle', 9, 4, harmony, 2),
      clip(pipes, 'Drone', 13, 4, drone),
    ],
    [[1, 'Intro'], [5, 'Reel'], [9, 'Whistle'], [13, 'Pipes']],
    master({ on: false }, { on: true, amount: 1.15 })
  );
}

// ---------- Latin (bossa nova) ----------

function latin(): ProjectSnapshot {
  const guitar = track('Guitar', 'nylonGuitar', { volume: -3, reverbSend: 0.2 });
  const bass = track('Bass', 'uprightBass', { volume: 0 });
  const perc = track('Percussion', 'bongos', { volume: -1 });
  const kit = track('Kit', 'acousticKit', { volume: -2 });
  const flute = track('Flute', 'flute', { volume: -4, reverbSend: 0.35, delaySend: 0.15 });
  // Dm9 - G13 - Cmaj9 - A7, a bar each
  const voicings = [['D3', 'F3', 'C4', 'E4'], ['G2', 'F3', 'B3', 'E4'], ['C3', 'E3', 'B3', 'D4'], ['A2', 'G3', 'C#4', 'F4']];
  const comp = everyBar(4, (b) => [0, 3, 6, 10, 12].map((i, k): Step => [i, voicings[b], k === 0 ? 0.7 : 0.55, '8n']));
  const bassLine = everyBar(4, (b): Step[] => { const r = ['D2', 'G1', 'C2', 'A1'][b]; const f = ['A2', 'D2', 'G2', 'E2'][b]; return [[0, r, 0.85, '4n.'], [6, f, 0.7, '8n'], [8, f, 0.75, '4n.'], [14, r, 0.65, '8n']]; });
  const shaker = everyBar(1, (): Step[] => [...Array.from({ length: 8 }, (_, i): Step => [i * 2, D.closedHat, i % 2 ? 0.35 : 0.5]), [0, D.tomHigh, 0.6], [6, D.tomHigh, 0.5], [10, D.tomMid, 0.55], [14, D.tomLow, 0.6]]);
  const rim: Step[] = [...[0, 6, 8, 14, 16, 22, 24, 30].map((i): Step => [i, D.kick, i % 8 === 0 ? 0.6 : 0.45]), ...[0, 3, 6, 10, 12, 19, 22, 26, 28].map((i): Step => [i, D.snare, 0.3])];
  const tune: Step[] = [
    [0, 'A5', 0.75, '4n.'], [6, 'G5', 0.65, '8n'], [8, 'F5', 0.7, '4n'], [12, 'E5', 0.65, '4n'],
    [16, 'F5', 0.75, '2n'], [24, 'D5', 0.65, '4n'], [28, 'E5', 0.65, '4n'],
    [32, 'E5', 0.75, '4n.'], [38, 'D5', 0.65, '8n'], [40, 'B4', 0.7, '2n'],
    [48, 'C#5', 0.75, '2n'], [56, 'E5', 0.65, '4n'], [60, 'G5', 0.65, '4n'],
  ];
  return project(
    'Latin starter',
    130,
    0,
    [5, 17],
    [guitar, bass, perc, kit, flute],
    [
      clip(guitar, 'Bossa comping', 1, 4, comp, 4),
      clip(perc, 'Shaker & bongos', 1, 1, shaker, 16),
      clip(bass, 'Bass', 5, 4, bassLine, 3),
      clip(kit, 'Rim & kick', 5, 2, rim, 6),
      clip(flute, 'Melody', 9, 4, tune, 2),
    ],
    [[1, 'Intro'], [5, 'Groove'], [9, 'Melody']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

// ---------- Fantasy Tavern ----------

function tavern(): ProjectSnapshot {
  const dulcimer = track('Dulcimer', 'dulcimer', { volume: -2, reverbSend: 0.3, pan: -0.2 });
  const lute = track('Lute', 'nylonGuitar', { volume: -3, reverbSend: 0.25, pan: 0.2 });
  const recorder = track('Recorder', 'recorder', { volume: -3, reverbSend: 0.35 });
  const drum = track('Hand drum', 'bongos', { volume: 4, reverbSend: 0.2 });
  const accordion = track('Accordion', 'accordion', { volume: -8, reverbSend: 0.3 });
  // D minor jig feel (triplet 8ths): Dm - C - Bb - A, a bar each
  const t = 16 / 6;
  const triads = [['D4', 'F4', 'A4'], ['C4', 'E4', 'G4'], ['A#3', 'D4', 'F4'], ['A3', 'C#4', 'E4']];
  const lutePart = everyBar(4, (b) => [0, 1, 2, 3, 4, 5].map((k): Step => [k * t, k === 0 ? triads[b][0].replace(/\d/, (o) => String(Number(o) - 1)) : triads[b][k % 2 ? 1 : 2], k % 3 === 0 ? 0.75 : 0.5, '8n']));
  const tune: Step[] = [
    ...['A4', 'D5', 'D5', 'E5', 'F5', 'E5'], ...['G5', 'E5', 'C5', 'E5', 'G5', 'E5'],
    ...['F5', 'D5', 'A#4', 'D5', 'F5', 'A5'], ...['E5', 'C#5', 'A4', 'C#5', 'E5', 'A4'],
  ].map((n, i): Step => [i * t, n, i % 3 === 0 ? 0.85 : 0.65, '8n']);
  const drumPart = everyBar(1, (): Step[] => [[0, D.tomLow, 0.9], [2 * t, D.tomHigh, 0.5], [3 * t, D.tomLow, 0.75], [5 * t, D.tomHigh, 0.55]]);
  const harmony = tune.filter((_, i) => i % 3 === 0).map(([st, n, v]): Step => [st, n, v * 0.8, '4n.']);
  const squeeze = progression(triads, 16, '1n', 0.55);
  return project(
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
      clip(recorder, 'Recorder', 13, 4, harmony),
    ],
    [[1, 'Intro'], [5, 'Tune'], [9, 'Full tavern']],
    master({ on: false }, { on: true, amount: 1.1 })
  );
}

// ---------- Eastern ----------

function eastern(): ProjectSnapshot {
  const koto = track('Koto', 'koto', { volume: -3, reverbSend: 0.4, pan: -0.2 });
  const flute = track('Shakuhachi', 'shakuhachi', { volume: -4, reverbSend: 0.5, delaySend: 0.15 });
  const taiko = track('Taiko', 'taiko', { volume: 2, reverbSend: 0.35 });
  const pad = track('Pad', 'glassPad', { volume: -12, reverbSend: 0.5 });
  const shamisen = track('Shamisen', 'shamisen', { volume: -1, pan: 0.25, reverbSend: 0.3 });
  // The in scale on D: D, Eb, G, A, Bb
  const pattern = ['D4', 'A4', 'D5', 'D#5', 'A4', 'D5', 'A#4', 'G4'];
  const kotoPart = everyBar(2, (b) => pattern.map((n, i): Step => [i * 2, b && i === 7 ? 'A4' : n, i % 4 === 0 ? 0.8 : 0.6, '4n']));
  const tune: Step[] = [
    [0, 'A5', 0.75, '2n'], [8, 'A#5', 0.65, '8n'], [10, 'A5', 0.7, '4n.'],
    [16, 'G5', 0.7, '4n'], [20, 'D#5', 0.65, '4n'], [24, 'D5', 0.75, '2n'],
    [32, 'D#5', 0.7, '4n.'], [38, 'G5', 0.65, '8n'], [40, 'A5', 0.75, '2n'],
    [48, 'D6', 0.7, '4n'], [52, 'A#5', 0.65, '4n'], [56, 'A5', 0.7, '2n'],
  ];
  const drums = everyBar(2, (b): Step[] => [[0, 'C2', 1, '4n'], [6, 'C2', 0.6, '8n'], [8, 'G2', 0.8, '4n'], ...(b ? [[12, 'C3', 0.7, '8n'] as Step, [13, 'C3', 0.75, '8n'] as Step, [14, 'C2', 0.9, '8n'] as Step] : [[12, 'C2', 0.7, '4n'] as Step])]);
  const drone: Step[] = [[0, ['D3', 'A3', 'D4'], 0.6, '4m']];
  const pluck = everyBar(1, (): Step[] => [[0, 'D4', 0.8, '8n'], [3, 'D4', 0.6, '16n'], [6, 'A4', 0.7, '8n'], [10, 'G4', 0.7, '8n'], [12, 'D#4', 0.65, '8n']]);
  return project(
    'Eastern starter',
    84,
    0,
    [5, 17],
    [koto, flute, taiko, pad, shamisen],
    [
      clip(pad, 'Drone', 1, 4, drone, 4),
      clip(koto, 'Koto', 1, 2, kotoPart, 8),
      clip(flute, 'Shakuhachi', 5, 4, tune, 3),
      clip(taiko, 'Taiko', 9, 2, drums, 4),
      clip(shamisen, 'Shamisen', 13, 1, pluck, 4),
    ],
    [[1, 'Garden'], [5, 'Flute'], [9, 'Drums'], [13, 'Shamisen']],
    master({ on: false }, { on: true, amount: 1.2 })
  );
}

// ---------- Funk ----------

function funk(): ProjectSnapshot {
  const drums = track('Drums', 'acousticKit', { volume: 1 });
  const bass = track('Bass', 'bass', { volume: 0 });
  const gtr = track('Guitar', 'mutedGuitar', { volume: -5, pan: -0.3 });
  const brass = track('Horns', 'brassSection', { volume: -1, reverbSend: 0.25, pan: 0.2 });
  const organ = track('Organ', 'drawbarOrgan', { volume: -9, reverbSend: 0.2 });
  // An E9 vamp
  const beat = everyBar(1, (): Step[] => [
    [0, D.kick, 1], [3, D.kick, 0.7], [10, D.kick, 0.85], [4, D.snare, 0.95], [12, D.snare, 0.95], [7, D.snare, 0.25], [9, D.snare, 0.2], [15, D.snare, 0.3],
    ...Array.from({ length: 16 }, (_, i): Step => [i, D.closedHat, i % 2 ? 0.3 : 0.5]),
  ]);
  const bassLine: Step[] = [[0, 'E1', 1, '8n'], [3, 'E2', 0.7, '16n'], [6, 'E1', 0.8, '16n'], [7, 'G1', 0.75, '16n'], [8, 'A1', 0.85, '8n'], [11, 'A#1', 0.7, '16n'], [12, 'B1', 0.85, '8n'], [14, 'D2', 0.7, '16n'], [15, 'E2', 0.75, '16n']];
  const scratch = everyBar(1, (): Step[] => Array.from({ length: 16 }, (_, i): Step => [i, ['G#3', 'D4', 'F#4'], i % 4 === 2 ? 0.8 : 0.35, '16n']));
  const hits: Step[] = [[6, ['G#4', 'D5', 'F#5'], 0.9, '16n'], [10, ['G#4', 'D5', 'F#5'], 0.85, '8n'], [22, ['A4', 'C#5', 'E5'], 0.9, '16n'], [24, ['B4', 'D5', 'F#5'], 0.95, '4n']];
  const pad = progression([['E3', 'G#3', 'D4', 'F#4']], 16, '1n', 0.6);
  return project(
    'Funk starter',
    104,
    0,
    [5, 17],
    [drums, bass, gtr, brass, organ],
    [
      clip(drums, 'Groove', 1, 1, beat, 16),
      clip(bass, 'Bass', 1, 1, bassLine, 16),
      clip(gtr, 'Scratch', 5, 1, scratch, 12),
      clip(organ, 'Organ', 5, 1, pad, 12),
      clip(brass, 'Horn hits', 9, 2, hits, 4),
    ],
    [[1, 'Groove'], [5, 'Band'], [9, 'Horns']],
    master({ on: true, depth: 0.2 }, { on: true, amount: 1.1 })
  );
}

const BUILDERS: Record<StarterId, () => ProjectSnapshot> = {
  dubstep, house, dnb, trap, cinematic, lofi, chiptune, hiphop,
  classical, angelic, epic, ambient, rock, metal, jazz, synthwave, pop, trance, horror, celtic, latin, tavern, eastern, funk,
};

/** A fresh copy of a starter (new ids each time). */
export function createStarter(id: StarterId): ProjectSnapshot {
  return BUILDERS[id]();
}
