import type { ProjectSnapshot } from './project';
import type { Step } from './demoSong';
import { D, master, project, track } from './starterKit';
import { KIT } from './startersPlaylist';
import { gameReady, grouped } from './startersGame';
import { MORE_KIT } from './startersGameMore';
import { breathe } from './breathe';
import { uid } from './timelineTypes';

/**
 * Story starters: the sounds animated series, cartoons and story-driven games lean on, each as a
 * game-ready piece (two states, stem groups for Intensity, transitions, stingers). A city at night
 * on piano and strings, a farewell piano ballad, a sunset drive in city pop, a jazz caper, a
 * stylish acid-jazz infiltration, a lo-fi road, a meadow waltz, a hybrid orchestral showdown, a
 * wordless requiem in ruins and a ritual of drones and taiko. They lean on the extended chords
 * (maj7, add9, m9, 13sus), the brushes drummer and breathing tempo.
 */

const { melody, broken, stabs, pulse, beat, power, lowCut, highCut, peq, EQ, human, bits, drumBus, inSpace, ROOM, STUDIO, HALL, dur, roll32 } = KIT;
const { clip, tr, shift, measures, drumClip, swung, held, waltz, boost } = MORE_KIT;

/** Eight 8ths up and back through a four-note voicing (a pianist's broken chord). */
const eights = (v: string[]): string[] => [v[0], v[1], v[2], v[3], v[2], v[1], v[2], v[3]];
/** A rolling left hand: root, fifth, octave, tenth and back, over five notes. */
const rolling = (v: string[]): string[] => [v[0], v[1], v[2], v[3], v[4], v[3], v[2], v[1]];
/** Slap bass: the root, its octave popped, ghosted 16ths between. */
const slap = (root: string): Step[] => [
  [0, root, 0.85, dur(2)], [3, root, 0.5, dur(1)], [6, tr(root, 12), 0.75, dur(1)], [8, root, 0.8, dur(2)],
  [11, tr(root, 7), 0.55, dur(1)], [14, tr(root, 12), 0.7, dur(1)],
];
/** A quarter-note walking line: root, third, fifth, then a half step under the next root. */
const walk = (bars: Array<[root: string, third: string, fifth: string]>, vel = 0.7): Step[] =>
  measures(bars.length, 16, (m) => {
    const [r, t, f] = bars[m];
    const next = bars[(m + 1) % bars.length][0];
    return [[0, r, vel, dur(4)], [4, t, vel * 0.85, dur(4)], [8, f, vel * 0.9, dur(4)], [12, tr(next, -1), vel * 0.8, dur(4)]];
  });
/** Sixteenths over a three-note chord: low, top, middle, top (a string ostinato). */
const ostinato = (chords: string[][], vel = 0.6): Step[] =>
  measures(chords.length, 16, (m) => Array.from({ length: 16 }, (_, i): Step => [i, chords[m][[0, 2, 1, 2][i % 4]], i % 4 === 0 ? vel + 0.15 : vel, dur(1)]));
/** A breathing tempo over bars `from` to `to` (see breathe.ts). */
const breathing = (p: ProjectSnapshot, from: number, to: number, phrase: number, amount: number): ProjectSnapshot => {
  const pts = breathe([], p.bpm, { base: { num: 4, den: 4 }, points: [] }, { from, to, phrase, amount }, () => uid('tempo'));
  return typeof pts === 'string' ? p : { ...p, tempoPoints: pts };
};

// ---------- Starlit city: piano at night, strings on the second pass ----------

function starlitCity(): ProjectSnapshot {
  const piano = track('Grand piano', 'realGrandPiano', { volume: -7, reverbSend: 0.45, fx: { peq: EQ.piano(), human: human(0.3, 0.05) } });
  const violin = grouped(track('Violin', 'realViolin', { volume: -13, pan: 0.25, reverbSend: 0.45, fx: { human: human(0.3) } }), 'Tension');
  const strings = grouped(track('Strings', 'slowStrings', { volume: -17, pan: -0.15, reverbSend: 0.5, fx: { peq: EQ.pad(8000) } }), 'Ambient');
  const bass = track('Upright bass', 'realUprightBass', { volume: -9, reverbSend: 0.2, fx: { peq: peq(lowCut(35)), human: human(0.25) } });
  const kit = drumBus(-20);
  const brushes = grouped(track('Brushes', 'acousticKit', { volume: -13, output: kit.id, reverbSend: 0.3, fx: { peq: EQ.kit(), human: human(0.25) } }), 'Percussion');

  // D: Imaj7 - iii7 - vi9 - IVmaj7 | IVmaj7 - iv6 (the borrowed, bittersweet turn) - Imaj7 - V7sus
  const voicings = [['D3', 'A3', 'C#4', 'F#4'], ['F#3', 'C#4', 'E4', 'A4'], ['B2', 'F#3', 'A3', 'C#4'], ['G2', 'D3', 'F#3', 'B3'], ['G2', 'D3', 'F#3', 'B3'], ['G2', 'D3', 'E3', 'A#3'], ['D3', 'A3', 'C#4', 'F#4'], ['A2', 'E3', 'G3', 'D4']];
  const roots = ['D2', 'F#2', 'B1', 'G2', 'G2', 'G2', 'D2', 'A1'];
  const tune = melody([
    [0, 'F#5', 6], [6, 'E5', 2], [8, 'A5', 8], [16, 'E5', 8], [24, 'C#5', 4], [28, 'A4', 4],
    [32, 'B4', 4], [36, 'C#5', 4], [40, 'D5', 4], [44, 'F#5', 4], [48, 'E5', 12], [60, 'D5', 4],
    [64, 'B4', 6], [70, 'D5', 2], [72, 'F#5', 8], [80, 'E5', 6], [86, 'D5', 2], [88, 'A#4', 8],
    [96, 'A4', 4], [100, 'C#5', 4], [104, 'F#5', 8], [112, 'E5', 12], [124, 'D5', 4],
  ], 0.62);
  const counter = melody([[4, 'D5', 12], [20, 'C#5', 12], [36, 'D5', 8], [44, 'E5', 4], [52, 'B4', 12], [68, 'D5', 12], [84, 'A#4', 12], [100, 'A4', 12], [116, 'G4', 12]], 0.5);
  const left = broken(voicings.map(eights), 2, 3, 0.42);
  return gameReady(
    inSpace(
      breathing(
        boost(project(
          'Starlit City starter',
          84,
          0,
          [1, 9],
          [piano, violin, strings, bass, kit, brushes],
          [
            clip(piano, 'Theme', 1, 8, [...tune, ...left]),
            clip(bass, 'Theme', 1, 8, pulse(roots, [0, 8], 7, 0.5)),
            // The second pass: the same theme re-voiced bigger (octaves), the violin answering, strings and brushes in
            clip(piano, 'Theme, fuller', 9, 8, [...KIT.octaves(tune, -1), ...left]),
            clip(violin, 'Answer', 9, 8, counter),
            clip(strings, 'Pad', 9, 8, held(voicings.map((v) => v.map((n) => tr(n, 12)).slice(1)), 16, 0.36)),
            clip(bass, 'Second pass', 9, 8, pulse(roots, [0, 8], 7, 0.58)),
            drumClip(brushes, 'Brushes', 9, 'brushes', 8, 0.45, 4, 3),
          ],
          [[1, 'Theme'], [9, 'Second pass']],
          master({ on: false }, { on: true, amount: 1.2 })
        ), 6),
        1, 9, 4, 0.06
      ),
      HALL
    ),
    {
      key: [2, 'major'],
      rules: [
        ['Theme', 'Second pass', { kind: 'crossfade', quantize: 'phrase', phraseBars: 4, beats: 4 }],
        ['Second pass', 'Theme', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['item', 'checkpoint'],
    }
  );
}

// ---------- Farewell piano: a bittersweet ballad, no drums ----------

function farewellPiano(): ProjectSnapshot {
  const piano = track('Felt piano', 'realUprightPiano', { volume: -3, reverbSend: 0.5, fx: { peq: peq(lowCut(70), highCut(5000)), human: human(0.45, 0.05) } });
  const violin = grouped(track('Solo violin', 'realViolin', { volume: -12, pan: 0.2, reverbSend: 0.5, fx: { human: human(0.35) } }), 'Climax');
  const cello = grouped(track('Cello', 'realCello', { volume: -12, pan: -0.2, reverbSend: 0.45, fx: { peq: peq(lowCut(40)), human: human(0.3) } }), 'Tension');
  const strings = grouped(track('Strings', 'slowStrings', { volume: -18, reverbSend: 0.55, fx: { peq: EQ.pad(7000) } }), 'Ambient');

  // A minor to C: Am - F - C - G | Am - F - Dm7 - E (a 4-3 suspension over the E)
  const v = [['A2', 'E3', 'A3', 'C4', 'E4'], ['F2', 'C3', 'F3', 'A3', 'C4'], ['C3', 'G3', 'C4', 'E4', 'G4'], ['G2', 'D3', 'G3', 'B3', 'D4'], ['A2', 'E3', 'A3', 'C4', 'E4'], ['F2', 'C3', 'F3', 'A3', 'C4'], ['D3', 'A3', 'C4', 'F4', 'A4'], ['E2', 'B2', 'E3', 'G#3', 'B3']];
  const tune = melody([
    [0, 'E5', 6], [6, 'D5', 2], [8, 'C5', 4], [12, 'B4', 4], [16, 'A4', 8], [24, 'C5', 4], [28, 'F5', 4],
    [32, 'E5', 8], [40, 'G5', 4], [44, 'E5', 4], [48, 'D5', 12], [60, 'B4', 4],
    [64, 'C5', 6], [70, 'B4', 2], [72, 'A4', 4], [76, 'E5', 4], [80, 'F5', 8], [88, 'E5', 4], [92, 'D5', 4],
    [96, 'C5', 4], [100, 'D5', 4], [104, 'F5', 4], [108, 'E5', 4], [112, 'A4', 8], [120, 'G#4', 8],
  ], 0.55);
  const arps = broken(v.map(rolling), 2, 4, 0.38);
  return gameReady(
    inSpace(
      breathing(
        boost(project(
          'Farewell Piano starter',
          68,
          0,
          [1, 9],
          [piano, violin, cello, strings],
          [
            clip(piano, 'Memory', 1, 8, [...tune, ...arps]),
            clip(piano, 'Farewell', 9, 8, arps),
            clip(violin, 'Farewell', 9, 8, tune),
            clip(cello, 'Farewell', 9, 8, measures(8, 16, (m) => [[0, tr(v[m][0], v[m][0].endsWith('3') ? -12 : 0), 0.45, dur(16)]])),
            // The strings swell into the eighth bar
            clip(strings, 'Swell', 9, 8, measures(8, 16, (m) => [[0, v[m].slice(2).map((n) => tr(n, 12)), 0.22 + m * 0.04, dur(16)]])),
          ],
          [[1, 'Memory'], [9, 'Farewell']],
          master({ on: false }, { on: true, amount: 1.25 })
        ), 7),
        1, 17, 8, 0.07
      ),
      HALL + 1
    ),
    {
      key: [9, 'minor'],
      rules: [
        ['Memory', 'Farewell', { kind: 'crossfade', quantize: 'phrase', phraseBars: 4, beats: 8 }],
        ['Farewell', 'Memory', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['checkpoint', 'gameOver'],
    }
  );
}

// ---------- Sunset drive: city pop at dusk ----------

function sunsetDrive(): ProjectSnapshot {
  const lead = track('FM piano', 'fmPiano', { volume: -8, pan: 0.1, reverbSend: 0.3, delaySend: 0.12, fx: { chorus: { on: true, rate: 0.6, depth: 0.4, mix: 0.25 }, human: human(0.2) } });
  const guitar = grouped(track('Chorus guitar', 'cleanGuitar', { volume: -13, pan: -0.35, reverbSend: 0.2, fx: { chorus: { on: true, rate: 1.2, depth: 0.5, mix: 0.4 }, peq: EQ.guitar() } }), 'Tension');
  const brass = grouped(track('Synth brass', 'synthBrass', { volume: -17, pan: 0.3, reverbSend: 0.3, fx: { peq: EQ.pad(7000) } }), 'Ambient');
  const bass = track('Slap bass', 'slappedBass', { volume: -8, fx: { peq: peq(lowCut(35)), human: human(0.15) } });
  const kit = drumBus(-16);
  const drums = grouped(track('Drum machine', 'linnDrum', { volume: -8, output: kit.id, reverbSend: 0.25, fx: { peq: EQ.kit() } }), 'Percussion');

  // F: the Royal Road (IVmaj7 - V7 - iii7 - vi7), then IVmaj7 - III7 - vi7 - I7 for the shop at dusk
  const road = [['A3', 'D4', 'F4', 'A4'], ['A#3', 'E4', 'G4', 'C5'], ['A3', 'C4', 'E4', 'G4'], ['A3', 'C4', 'D4', 'F4']];
  const roadRoots = ['A#1', 'C2', 'A1', 'D2'];
  const dusk = [['A3', 'D4', 'F4', 'A4'], ['A3', 'C#4', 'E4', 'G4'], ['A3', 'C4', 'D4', 'F4'], ['A3', 'C4', 'D#4', 'F4']];
  const duskRoots = ['A#1', 'A1', 'D2', 'F1'];
  const tune = melody([
    [0, 'A5', 3], [3, 'G5', 3], [6, 'F5', 2], [8, 'D5', 4], [12, 'F5', 4], [16, 'E5', 6], [22, 'G5', 2], [24, 'A#5', 4], [28, 'A5', 4],
    [32, 'G5', 3], [35, 'E5', 3], [38, 'C5', 2], [40, 'E5', 8], [48, 'D5', 4], [52, 'F5', 4], [56, 'A5', 8],
    [64, 'A5', 3], [67, 'G5', 3], [70, 'F5', 2], [72, 'D5', 4], [76, 'F5', 4], [80, 'E5', 4], [84, 'G5', 4], [88, 'C6', 8],
    [96, 'A5', 6], [102, 'G5', 2], [104, 'E5', 8], [112, 'F5', 16],
  ], 0.72);
  const groove = beat([[D.kick, 'X...X...X...X...'], [D.snare, '....X.......X...'], [D.closedHat, 'x.xox.xox.xox.xo'], [D.openHat, '..............x.']]);
  const soft = beat([[D.snare, '....o.......o...'], [D.closedHat, 'x.o.x.o.x.o.x.o.']]);
  return gameReady(
    inSpace(
      boost(project(
        'Sunset Drive starter',
        112,
        0,
        [1, 9],
        [lead, guitar, brass, bass, kit, drums],
        [
          clip(lead, 'Cruise', 1, 8, tune),
          clip(guitar, 'Cruise', 1, 8, stabs([...road, ...road].map((c) => c.slice(1)), [2, 6, 10, 14], 1, 0.5)),
          clip(brass, 'Cruise', 1, 8, held([...road, ...road], 16, 0.32)),
          clip(bass, 'Cruise', 1, 8, measures(8, 16, (m) => slap(roadRoots[m % 4]))),
          clip(drums, 'Cruise', 1, 1, groove, 8),
          clip(lead, 'Dusk', 9, 8, stabs([...dusk, ...dusk], [0, 6, 10], 3, 0.42)),
          clip(guitar, 'Dusk', 9, 8, stabs([...dusk, ...dusk].map((c) => c.slice(1)), [6, 14], 1, 0.35)),
          clip(bass, 'Dusk', 9, 8, measures(8, 16, (m) => [[0, duskRoots[m % 4], 0.7, dur(6)], [10, tr(duskRoots[m % 4], 7), 0.5, dur(2)], [14, tr(duskRoots[m % 4], 12), 0.55, dur(2)]])),
          clip(drums, 'Dusk', 9, 1, soft, 8),
        ],
        [[1, 'Cruise'], [9, 'Dusk']],
        master({ on: true, depth: 0.15 }, { on: true, amount: 1.3 })
      ), 5),
      STUDIO
    ),
    {
      key: [5, 'major'],
      rules: [
        ['Cruise', 'Dusk', { kind: 'fill', quantize: 'bar' }],
        ['Dusk', 'Cruise', { kind: 'riser', quantize: 'bar' }],
      ],
      stingers: ['item', 'levelUp'],
    }
  );
}

// ---------- Midnight caper: swinging jazz for a heist ----------

function midnightCaper(): ProjectSnapshot {
  const trumpet = track('Muted trumpet', 'mutedTrumpet', { volume: -8, pan: 0.15, reverbSend: 0.25, fx: { peq: EQ.brass(), human: human(0.3) } });
  const sax = grouped(track('Tenor sax', 'tenorSax', { volume: -11, pan: -0.25, reverbSend: 0.25, fx: { human: human(0.3) } }), 'Tension');
  const organ = grouped(track('Organ', 'drawbarOrgan', { volume: -16, pan: -0.1, reverbSend: 0.2 }), 'Ambient');
  const horns = grouped(track('Brass hits', 'brassSection', { volume: -12, pan: 0.3, reverbSend: 0.3, fx: { peq: EQ.brass() } }), 'Climax');
  const bass = track('Upright bass', 'realUprightBass', { volume: -8, fx: { peq: peq(lowCut(35)), human: human(0.25) } });
  const kit = drumBus(-18);
  const drums = grouped(track('Jazz kit', 'acousticKit', { volume: -10, output: kit.id, reverbSend: 0.2, fx: { peq: EQ.kit(), human: human(0.2) } }), 'Percussion');

  // D Dorian: a Dm7 - G7 vamp to prowl; then iiø7 - V7 - i7 turnarounds for the chase, with a stop-time break
  const vamp = [['F3', 'A3', 'C4', 'E4'], ['F3', 'B3', 'D4', 'G4']];
  const turn = [['E3', 'G3', 'A#3', 'D4'], ['G3', 'C#4', 'E4', 'A4'], ['F3', 'A3', 'C4', 'E4'], ['F3', 'A3', 'C4', 'E4']];
  const theme = melody([
    [0, 'A4', 3], [3, 'C5', 3], [6, 'D5', 2], [8, 'F5', 4], [14, 'E5', 2], [16, 'D5', 6], [22, 'B4', 2], [24, 'G4', 8],
    [32, 'F4', 2], [34, 'A4', 2], [36, 'C5', 2], [38, 'D5', 2], [40, 'E5', 4], [44, 'F5', 4], [48, 'G5', 8], [56, 'F5', 4], [60, 'D5', 4],
  ], 0.75);
  const chase = melody([
    [0, 'D5', 2], [2, 'E5', 2], [4, 'F5', 2], [6, 'G5', 4], [10, 'A#5', 2], [12, 'A5', 4], [16, 'G5', 2], [18, 'E5', 2], [20, 'C#5', 2], [22, 'A4', 6], [28, 'E5', 4],
    [32, 'F5', 4], [36, 'E5', 2], [38, 'D5', 2], [40, 'C5', 4], [44, 'A4', 4], [48, 'D5', 8],
  ], 0.8);
  const swingKit = drumClip(drums, 'Swing', 1, 'swing', 8, 0.5, 4, 5);
  // The chase: seven bars of swing, then the band stops dead on beat one of bar 8
  const chaseKit = drumClip(drums, 'Swing, stop-time', 9, 'swing', 8, 0.85, 4, 9);
  const stopped = { ...chaseKit, notes: [...chaseKit.notes.filter((n) => n.startOffset < 7), { id: uid('note'), note: D.kick, startOffset: 7, duration: '8n', velocity: 0.9 }, { id: uid('note'), note: D.crash, startOffset: 7, duration: '8n', velocity: 0.8 }] };
  return gameReady(
    inSpace(
      boost(project(
        'Midnight Caper starter',
        160,
        0,
        [1, 9],
        [trumpet, sax, organ, horns, bass, kit, drums],
        [
          clip(trumpet, 'Prowl', 1, 4, theme, 2),
          clip(sax, 'Prowl', 1, 4, melody([[0, 'F4', 8], [8, 'E4', 8], [16, 'B3', 16], [32, 'C4', 16], [48, 'B3', 8], [56, 'D4', 8]], 0.55), 2),
          clip(organ, 'Prowl', 1, 8, stabs([0, 1, 0, 1, 0, 1, 0, 1].map((i) => vamp[i]), [6, 14], 2, 0.5)),
          clip(bass, 'Prowl', 1, 8, walk([0, 1, 0, 1, 0, 1, 0, 1].map((i) => (i ? ['G2', 'B2', 'D3'] : ['D2', 'F2', 'A2']) as [string, string, string]))),
          swingKit,
          clip(trumpet, 'Chase', 9, 4, chase, 2),
          clip(organ, 'Chase', 9, 8, stabs([...turn, ...turn], [6, 14], 2, 0.6)),
          // Brass on the "and" of four, pushing each bar into the next
          clip(horns, 'Chase', 9, 7, stabs([...turn, ...turn].slice(0, 7).map((c) => c.map((n) => tr(n, 12)).slice(1)), [14], 2, 0.75)),
          clip(bass, 'Chase', 9, 7, walk([['E2', 'G2', 'A#2'], ['A1', 'C#2', 'E2'], ['D2', 'F2', 'A2'], ['D2', 'F2', 'A2'], ['E2', 'G2', 'A#2'], ['A1', 'C#2', 'E2'], ['D2', 'F2', 'A2']])),
          stopped,
        ],
        [[1, 'Prowl'], [9, 'Chase']],
        master({ on: false }, { on: true, amount: 1.15 })
      ), 5),
      ROOM + 0.4
    ),
    {
      key: [2, 'minor'],
      rules: [
        ['Prowl', 'Chase', { kind: 'fill', quantize: 'bar' }],
        ['Chase', 'Prowl', { kind: 'cut', quantize: 'end' }],
      ],
      stingers: ['item', 'danger', 'victory'],
    }
  );
}

// ---------- Velvet infiltration: acid jazz for stylish stealth ----------

function velvetInfiltration(): ProjectSnapshot {
  const rhodes = track('Electric piano', 'rhodes', { volume: -8, pan: -0.1, reverbSend: 0.25, fx: { chorus: { on: true, rate: 0.8, depth: 0.4, mix: 0.25 }, human: human(0.2) } });
  const guitar = grouped(track('Wah guitar', 'mutedGuitar', { volume: -14, pan: 0.35, reverbSend: 0.15, fx: { filter: { on: true, type: 'bandpass', cutoff: 1200, resonance: 4 }, human: human(0.2) } }), 'Tension');
  const strings = grouped(track('Synth strings', 'synthStrings', { volume: -19, reverbSend: 0.4, fx: { peq: EQ.pad(7000) } }), 'Climax');
  const bass = track('Slap bass', 'slappedBass', { volume: -8, fx: { peq: peq(lowCut(35)), human: human(0.15) } });
  const kit = drumBus(-16);
  const drums = grouped(track('Funk kit', 'acousticKit', { volume: -9, output: kit.id, reverbSend: 0.15, fx: { peq: EQ.kit(), human: human(0.2) } }), 'Percussion');

  // A Dorian: Am9 - D9 vamp; the Vault lifts to Gmaj7 - Fmaj7 (bVII - bVI)
  const am9 = ['G3', 'B3', 'C4', 'E4'];
  const d9 = ['F#3', 'C4', 'E4', 'A4'];
  const lift = [['F#3', 'B3', 'D4', 'G4'], ['E3', 'A3', 'C4', 'F4']];
  const octs = (root: string): Step[] => [0, 2, 3, 6, 8, 10, 11, 14].map((s, i): Step => [s, i % 2 ? tr(root, 12) : root, i % 2 ? 0.55 : 0.8, dur(1)]);
  const lead = melody([
    [0, 'E5', 2], [2, 'G5', 2], [4, 'A5', 4], [10, 'G5', 2], [12, 'E5', 4], [16, 'F#5', 6], [22, 'E5', 2], [24, 'D5', 4], [28, 'C5', 4],
    [32, 'B4', 2], [34, 'C5', 2], [36, 'D5', 2], [38, 'E5', 6], [44, 'G5', 4], [48, 'A5', 12], [60, 'G5', 4],
  ], 0.7);
  const scratch = (n: string): Step[] => [2, 5, 7, 10, 13, 15].map((s): Step => [s, n, s % 4 === 2 ? 0.55 : 0.35, dur(1)]);
  return gameReady(
    inSpace(
      boost(project(
        'Velvet Infiltration starter',
        126,
        0,
        [1, 9],
        [rhodes, guitar, strings, bass, kit, drums],
        [
          clip(rhodes, 'Lobby', 1, 8, stabs([am9, d9, am9, d9, am9, d9, am9, d9], [0, 6, 10], 2, 0.5)),
          clip(guitar, 'Lobby', 1, 8, measures(8, 16, () => scratch('E4'))),
          clip(bass, 'Lobby', 1, 8, measures(8, 16, (m) => octs(m % 2 ? 'D2' : 'A1'))),
          drumClip(drums, 'Funk', 1, 'funk', 8, 0.45, 4, 2),
          clip(rhodes, 'Vault', 9, 4, [...lead, ...stabs([am9, d9, ...lift], [6, 14], 1, 0.35)], 2),
          clip(guitar, 'Vault', 9, 8, measures(8, 16, (m) => scratch(m % 4 < 2 ? 'E4' : 'D4'))),
          clip(strings, 'Vault', 9, 8, held([am9, d9, ...lift, am9, d9, ...lift].map((c) => c.map((n) => tr(n, 12))), 16, 0.3)),
          clip(bass, 'Vault', 9, 8, measures(8, 16, (m) => octs(['A1', 'D2', 'G1', 'F1'][m % 4]))),
          drumClip(drums, 'Funk, busy', 9, 'funk', 8, 0.8, 4, 6),
        ],
        [[1, 'Lobby'], [9, 'Vault']],
        master({ on: true, depth: 0.15 }, { on: true, amount: 1.2 })
      ), 5),
      STUDIO
    ),
    {
      key: [9, 'minor'],
      rules: [
        ['Lobby', 'Vault', { kind: 'fill', quantize: 'bar' }],
        ['Vault', 'Lobby', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['item', 'danger'],
    }
  );
}

// ---------- Wanderer's road: lo-fi beats for resting and travel ----------

function wanderersRoad(): ProjectSnapshot {
  const flute = track('Shakuhachi', 'shakuhachi', { volume: -9, pan: 0.15, reverbSend: 0.45, delaySend: 0.15, fx: { human: human(0.35, 0.08) } });
  const piano = track('Dusty piano', 'realUprightPiano', { volume: -10, pan: -0.15, reverbSend: 0.3, fx: { lofi: { on: true, crush: bits(10), mix: 0.5 }, peq: peq(lowCut(120), highCut(4500)), human: human(0.35) } });
  const pad = grouped(track('Warm pad', 'warmPad', { volume: -20, reverbSend: 0.4, fx: { peq: EQ.pad(5000) } }), 'Ambient');
  const bass = track('Upright bass', 'realUprightBass', { volume: -9, fx: { peq: peq(lowCut(35), highCut(3000)), human: human(0.3) } });
  const kit = drumBus(-18);
  const drums = grouped(track('Dusty break', 'breakbeatKit', { volume: -9, output: kit.id, fx: { lofi: { on: true, crush: bits(9), mix: 0.4 }, peq: peq(lowCut(40), highCut(7000)) } }), 'Percussion');

  // F: ii9 - V13sus - Imaj9 - Imaj9, voiced close and low
  const chords = [['F3', 'A#3', 'D4', 'A4'], ['A#3', 'D4', 'F4', 'A4'], ['E3', 'G3', 'A3', 'C4'], ['E3', 'G3', 'A3', 'C4']];
  const roots = ['G1', 'C2', 'F1', 'F1'];
  const tune = melody([[0, 'D5', 6], [6, 'C5', 2], [8, 'A4', 8], [16, 'G4', 4], [20, 'A4', 4], [24, 'C5', 8], [32, 'A4', 12], [44, 'G4', 4], [48, 'F4', 16]], 0.62);
  const keys = stabs(chords, [0, 7, 10], 3, 0.42);
  const bassLine = measures(4, 16, (m) => [[0, roots[m], 0.7, dur(5)], [6, tr(roots[m], 7), 0.5, dur(2)], [10, roots[m], 0.6, dur(4)]]);
  // Boom bap: the kick on one and the "and" of two, the snare a hair late
  const boomBap = swung(clip(drums, 'Boom bap', 9, 1, beat([[D.kick, 'X.....X...x.....'], [D.snare, '.....X.......X..'], [D.closedHat, 'x.x.x.x.x.x.x.x.']]), 8), 0.35, 16);
  return gameReady(
    inSpace(
      boost(project(
        "Wanderer's Road starter",
        88,
        0,
        [1, 9],
        [flute, piano, pad, bass, kit, drums],
        [
          swung(clip(piano, 'Rest', 1, 4, keys, 2), 0.3, 16),
          clip(pad, 'Rest', 1, 4, held(chords, 16, 0.3), 2),
          swung(clip(bass, 'Rest', 1, 4, bassLine, 2), 0.3, 16),
          swung(clip(piano, 'Road', 9, 4, keys, 2), 0.3, 16),
          clip(flute, 'Road', 9, 4, tune, 2),
          clip(pad, 'Road', 9, 4, held(chords, 16, 0.26), 2),
          swung(clip(bass, 'Road', 9, 4, bassLine, 2), 0.3, 16),
          boomBap,
        ],
        [[1, 'Rest'], [9, 'Road']],
        master({ on: false }, { on: true, amount: 1.1 })
      ), 5),
      ROOM + 0.6
    ),
    {
      key: [5, 'major'],
      rules: [
        ['Rest', 'Road', { kind: 'cut', quantize: 'bar' }],
        ['Road', 'Rest', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['item', 'checkpoint'],
    }
  );
}

// ---------- Meadow wind waltz: fields and sky in 3/4 ----------

function meadowWaltz(): ProjectSnapshot {
  const flute = track('Flute', 'realFlute', { volume: -8, pan: 0.15, reverbSend: 0.4, fx: { human: human(0.3, 0.05) } });
  const accordion = grouped(track('Accordion', 'accordion', { volume: -14, pan: -0.3, reverbSend: 0.3, fx: { human: human(0.25) } }), 'Tension');
  const strings = grouped(track('Strings', 'slowStrings', { volume: -17, reverbSend: 0.45, fx: { peq: EQ.pad(8000) } }), 'Ambient');
  const pizz = track('Pizzicato', 'realPizzicato', { volume: -10, reverbSend: 0.35, fx: { human: human(0.25) } });
  const harp = grouped(track('Harp', 'realHarp', { volume: -11, pan: 0.3, reverbSend: 0.45 }), 'Ambient');
  const timp = grouped(track('Timpani', 'timpani', { volume: -15, reverbSend: 0.45 }), 'Percussion');
  const bell = grouped(track('Triangle bell', 'tinkleBell', { volume: -22, pan: 0.4, reverbSend: 0.5 }), 'Percussion');

  // G, 3/4: G - Bm - C - D - Em - C - A (the Lydian II) - D
  const chords = [['B3', 'D4', 'G4'], ['B3', 'D4', 'F#4'], ['C4', 'E4', 'G4'], ['A3', 'D4', 'F#4'], ['B3', 'E4', 'G4'], ['C4', 'E4', 'G4'], ['A3', 'C#4', 'E4'], ['A3', 'D4', 'F#4']];
  const roots = ['G2', 'B2', 'C3', 'D3', 'E2', 'C3', 'A2', 'D3'];
  const w = waltz(roots, chords, 0.55);
  const tune: Step[] = melody([
    [0, 'D5', 8], [8, 'B4', 4], [12, 'D5', 4], [16, 'F#5', 4], [20, 'B5', 4], [24, 'A5', 8], [32, 'G5', 4], [36, 'F#5', 12],
    [48, 'G5', 4], [52, 'B5', 4], [56, 'E5', 4], [60, 'E5', 8], [68, 'G5', 4], [72, 'E5', 4], [76, 'C#5', 4], [80, 'A4', 4], [84, 'A4', 12],
  ], 0.65);
  const counter = melody([[4, 'G4', 8], [16, 'F#4', 8], [28, 'E4', 8], [40, 'F#4', 8], [52, 'G4', 8], [64, 'E4', 8], [76, 'E4', 8], [88, 'F#4', 8]], 0.45);
  // A harp glissando up into each eight-measure phrase
  const glissUp: Step[] = ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'D5', 'E5'].map((n, i): Step => [84 + 4 + i, n, 0.35 + i * 0.05, dur(4)]);
  const sky = (steps: Step[]) => shift(steps, 2);
  const part = (start: number, s: (x: Step[]) => Step[], second: boolean) => [
    clip(flute, second ? 'Sky' : 'Meadow', start, 6, s(tune)),
    clip(pizz, second ? 'Sky' : 'Meadow', start, 6, s([...w.bass, ...w.chords])),
    clip(strings, second ? 'Sky' : 'Meadow', start, 6, s(held(chords, 12, 0.28))),
    clip(harp, 'Gliss', start, 6, s(glissUp)),
    clip(bell, second ? 'Sky' : 'Meadow', start, 6, measures(8, 12, () => [[4, 'C6', 0.4, dur(2)]])),
    ...(second
      ? [clip(accordion, 'Sky', start, 6, s(counter)), clip(timp, 'Sky', start, 6, s(measures(8, 12, (m) => (m % 2 ? [] : [[0, roots[m].replace(/\d/, '2'), 0.5, dur(6)] as Step]))))]
      : []),
  ];
  return gameReady(
    inSpace(
      boost(
        MORE_KIT.inMeter(
          project(
            'Meadow Waltz starter',
            152,
            0,
            [1, 7],
            [flute, accordion, strings, pizz, harp, timp, bell],
            [...part(1, (x) => x, false), ...part(7, sky, true)],
            [[1, 'Meadow'], [7, 'Sky']],
            master({ on: false }, { on: true, amount: 1.3 })
          ),
          3,
          4
        ),
        0
      ),
      HALL
    ),
    {
      key: [7, 'major'],
      rules: [
        ['Meadow', 'Sky', { kind: 'crossfade', quantize: 'bar', beats: 6 }],
        ['Sky', 'Meadow', { kind: 'crossfade', quantize: 'bar', beats: 6 }],
      ],
      stingers: ['item', 'levelUp', 'checkpoint'],
    }
  );
}

// ---------- Champion's showdown: orchestra, choir, guitars and kit ----------

function championShowdown(): ProjectSnapshot {
  const choir = track('Choir "ah"', 'choir', { volume: -9, reverbSend: 0.45, fx: { peq: EQ.choir() } });
  const spicc = grouped(track('Violins short', 'realViolinsShort', { volume: -11, pan: -0.25, reverbSend: 0.3, fx: { human: human(0.15) } }), 'Tension');
  const guitar = grouped(track('Power chords', 'realCrunchGuitar', { volume: -13, pan: 0.3, fx: { peq: EQ.guitar() } }), 'Climax');
  const hit = grouped(track('Choir hit', 'orchestraHit', { volume: -15, reverbSend: 0.5 }), 'Climax');
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub() } });
  const kit = drumBus(-14);
  const drums = grouped(track('Rock kit', 'acousticKit', { volume: -8, output: kit.id, reverbSend: 0.2, fx: { peq: EQ.kit() } }), 'Percussion');
  const taiko = grouped(track('Taiko', 'taiko', { volume: -7, output: kit.id, reverbSend: 0.3 }), 'Percussion');

  // E minor over a tonic pedal: i - bVI - bIII - bVII, V at the phrase's end
  const chords = [['E4', 'G4', 'B4'], ['E4', 'G4', 'C5'], ['D4', 'G4', 'B4'], ['D4', 'F#4', 'A4'], ['E4', 'G4', 'B4'], ['E4', 'G4', 'C5'], ['D4', 'G4', 'B4'], ['D#4', 'F#4', 'B4']];
  const roots = ['E2', 'C3', 'G2', 'D3', 'E2', 'C3', 'G2', 'B2'];
  const anthem = melody([[0, 'B4', 16], [16, 'C5', 8], [24, 'B4', 8], [32, 'D5', 16], [48, 'A4', 16], [64, 'E5', 16], [80, 'G5', 8], [88, 'F#5', 8], [96, 'D5', 16], [112, 'D#5', 16]], 0.8);
  const taikoBeat: Step[] = [[0, 'C2', 0.9, '4n'], [6, 'G2', 0.6, '8n'], [8, 'C2', 0.8, '4n'], [12, 'G2', 0.55, '8n'], [14, 'G2', 0.65, '8n']];
  return gameReady(
    inSpace(
      boost(project(
        "Champion's Showdown starter",
        150,
        0,
        [1, 9],
        [choir, spicc, guitar, hit, sub, kit, drums, taiko],
        [
          clip(spicc, 'Standoff', 1, 8, ostinato(chords, 0.45)),
          clip(choir, 'Standoff', 1, 8, held(chords.map((c) => c.map((n) => tr(n, -12))), 16, 0.35)),
          clip(sub, 'Standoff', 1, 8, measures(8, 16, () => [[0, 'E1', 0.7, dur(16)]])),
          clip(taiko, 'Standoff', 1, 1, taikoBeat.slice(0, 2), 8),
          clip(spicc, 'Clash', 9, 8, ostinato(chords, 0.6)),
          clip(choir, 'Clash', 9, 8, anthem),
          clip(guitar, 'Clash', 9, 8, measures(8, 16, (m) => Array.from({ length: 8 }, (_, i): Step => [i * 2, power(roots[m]), i % 4 === 0 ? 0.8 : 0.6, dur(2)]))),
          clip(hit, 'Clash', 9, 8, measures(8, 16, (m) => [[0, chords[m], 0.7, dur(4)]])),
          clip(sub, 'Clash', 9, 8, measures(8, 16, (m) => [[0, roots[m].replace(/\d/, '1'), 0.75, dur(16)]])),
          drumClip(drums, 'Half time', 9, 'halftime', 8, 0.9, 4, 4),
          clip(taiko, 'Clash', 9, 1, taikoBeat, 8),
        ],
        [[1, 'Standoff'], [9, 'Clash']],
        master({ on: true, depth: 0.25 }, { on: true, amount: 1.2 })
      ), 4),
      HALL
    ),
    {
      key: [4, 'minor'],
      rules: [
        ['Standoff', 'Clash', { kind: 'riser', quantize: 'bar' }],
        ['Clash', 'Standoff', { kind: 'impact', quantize: 'bar' }],
      ],
      stingers: ['danger', 'victory', 'gameOver'],
    }
  );
}

// ---------- Ruin requiem: wordless voices, layering every eight bars ----------

function ruinRequiem(): ProjectSnapshot {
  const voices = grouped(track('Voices "oo"', 'voiceOohs', { volume: -9, reverbSend: 0.55, fx: { peq: EQ.choir() } }), 'Climax');
  const piano = track('Piano ostinato', 'realGrandPiano', { volume: -6, reverbSend: 0.45, fx: { peq: EQ.piano(), human: human(0.2) } });
  const strings = grouped(track('Strings', 'realViolins', { volume: -15, pan: -0.2, reverbSend: 0.5, fx: { peq: EQ.pad(8000) } }), 'Tension');
  const cello = track('Cellos', 'realCello', { volume: -11, pan: 0.2, reverbSend: 0.4, fx: { peq: peq(lowCut(40)), human: human(0.25) } });
  const taiko = grouped(track('Low drum', 'taiko', { volume: -10, reverbSend: 0.5 }), 'Percussion');

  // D minor: i - v - bVI - bIII, two bars each
  const chords = [['D4', 'F4', 'A4'], ['D4', 'F4', 'A4'], ['C4', 'E4', 'A4'], ['C4', 'E4', 'A4'], ['D4', 'F4', 'A#4'], ['D4', 'F4', 'A#4'], ['C4', 'F4', 'A4'], ['C4', 'F4', 'A4']];
  const roots = ['D2', 'D2', 'A1', 'A1', 'A#1', 'A#1', 'F2', 'F2'];
  const ost = measures(8, 16, (m) => {
    const r = tr(roots[m], 12);
    const line = [r, tr(r, 7), tr(r, 12), tr(r, 7)];
    return Array.from({ length: 8 }, (_, i): Step => [i * 2, line[i % 4], i % 4 === 0 ? 0.55 : 0.4, dur(2)]);
  });
  const hymn = melody([[0, 'A4', 16], [16, 'D5', 8], [24, 'C5', 8], [32, 'E5', 16], [48, 'C5', 16], [64, 'D5', 12], [76, 'F5', 4], [80, 'D5', 16], [96, 'C5', 16], [112, 'A4', 16]], 0.6);
  return gameReady(
    inSpace(
      boost(project(
        'Ruin Requiem starter',
        84,
        0,
        [1, 9],
        [voices, piano, strings, cello, taiko],
        [
          clip(piano, 'Ruins', 1, 8, ost),
          clip(cello, 'Ruins', 1, 8, measures(8, 16, (m) => [[0, roots[m], 0.4, dur(16)]])),
          clip(taiko, 'Ruins', 1, 1, [[0, 'C2', 0.55, '2n']], 8),
          clip(piano, 'Requiem', 9, 8, ost),
          clip(voices, 'Requiem', 9, 8, hymn),
          clip(strings, 'Requiem', 9, 8, held(chords, 16, 0.32)),
          clip(cello, 'Requiem', 9, 8, measures(8, 16, (m) => [[0, roots[m], 0.5, dur(8)], [8, tr(roots[m], 7), 0.42, dur(8)]])),
          clip(taiko, 'Requiem', 9, 1, [[0, 'C2', 0.75, '2n'], [12, 'G2', 0.45, '8n']], 8),
        ],
        [[1, 'Ruins'], [9, 'Requiem']],
        master({ on: false }, { on: true, amount: 1.25 })
      ), 6),
      HALL + 1.5
    ),
    {
      key: [2, 'minor'],
      rules: [
        ['Ruins', 'Requiem', { kind: 'crossfade', quantize: 'phrase', phraseBars: 4, beats: 8 }],
        ['Requiem', 'Ruins', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['checkpoint', 'victory'],
    }
  );
}

// ---------- Neon ritual: Phrygian drones, glitch and taiko ----------

function neonRitual(): ProjectSnapshot {
  const choir = track('Synth choir', 'synthChoir', { volume: -10, reverbSend: 0.5, fx: { chorus: { on: true, rate: 0.3, depth: 0.7, mix: 0.4 }, peq: EQ.choir() } });
  const arp = grouped(track('Glitch arp', 'pluck', { volume: -13, pan: 0.25, delaySend: 0.25, fx: { gate: { on: true, rate: '1/16', depth: 0.8, length: 0.5 } } }), 'Tension');
  const drone = grouped(track('Drone', 'metallicPad', { volume: -19, reverbSend: 0.5, fx: { peq: EQ.pad(5000) } }), 'Ambient');
  const stab = grouped(track('bII stabs', 'synthBrass', { volume: -14, pan: -0.25, reverbSend: 0.4 }), 'Climax');
  const sub = track('Sub', 'subBass', { volume: -10, fx: { peq: EQ.sub() } });
  const kit = drumBus(-14);
  const drums = grouped(track('Processed kick', 'technoKit', { volume: -8, output: kit.id, fx: { distortion: { on: true, amount: 0.25 }, peq: EQ.kit() } }), 'Percussion');
  const taiko = grouped(track('Taiko', 'taiko', { volume: -8, output: kit.id, reverbSend: 0.35 }), 'Percussion');

  // E Phrygian: a drone on E, the bII (F) stabbing in, a tritone (A#) now and then
  const cell = (r: string, t: string, f: string, top: string): Step[] =>
    [r, f, tr(r, 12), top, f, tr(t, 12), tr(r, 12), f, r, f, tr(r, 12), top, f, tr(t, 12), tr(f, 12), f].map((n, i): Step => [i, n, i % 4 === 0 ? 0.6 : 0.42, dur(1)]);
  const arps = [cell('E4', 'G4', 'B4', 'G5'), cell('F4', 'A4', 'C5', 'A5'), cell('E4', 'G4', 'B4', 'G5'), cell('E4', 'G4', 'A#4', 'G5')];
  const chant = melody([[0, 'E5', 8], [8, 'F5', 8], [16, 'E5', 16], [32, 'G5', 8], [40, 'F5', 8], [48, 'E5', 12], [60, 'D5', 4]], 0.6);
  const groove = beat([[D.kick, 'X..x..X...X..x..'], [D.snare, '....X.......X...'], [D.closedHat, '..x...x...x...x.']]);
  const taikoBeat: Step[] = [[0, 'C2', 0.85, '4n'], [3, 'G2', 0.5, '8n'], [6, 'C2', 0.7, '8n'], [10, 'G2', 0.55, '8n'], [12, 'C2', 0.75, '4n']];
  return gameReady(
    inSpace(
      boost(project(
        'Neon Ritual starter',
        98,
        0,
        [1, 9],
        [choir, arp, drone, stab, sub, kit, drums, taiko],
        [
          clip(drone, 'Trance', 1, 8, measures(8, 16, () => [[0, ['E3', 'B3', 'E4'], 0.4, dur(16)]])),
          clip(arp, 'Trance', 1, 4, arps.flatMap((a, m) => a.map(([s, n, v, d]): Step => [s + m * 16, n, v, d])), 1),
          clip(arp, 'Trance', 5, 3, arps.slice(0, 3).flatMap((a, m) => a.map(([s, n, v, d]): Step => [s + m * 16, n, v, d])), 1),
          clip(choir, 'Trance', 1, 4, chant, 1),
          clip(sub, 'Trance', 1, 7, measures(7, 16, () => [[0, 'E1', 0.6, dur(16)]])),
          clip(taiko, 'Trance', 1, 1, taikoBeat.slice(0, 2), 7),
          // Bar 8: silence before the drop, a stutter on the hats into it
          clip(drums, 'Stutter', 8, 1, roll32(D.closedHat, 12, 16, 0.3, 0.8)),
          clip(drone, 'Drop', 9, 8, measures(8, 16, () => [[0, ['E3', 'B3', 'E4'], 0.45, dur(16)]])),
          clip(arp, 'Drop', 9, 4, arps.flatMap((a, m) => a.map(([s, n, v, d]): Step => [s + m * 16, n, v, d])), 2),
          clip(choir, 'Drop', 9, 4, chant, 2),
          clip(stab, 'Drop', 9, 4, [[16, ['F4', 'A4', 'C5'], 0.75, dur(3)], [56, ['F4', 'A4', 'C5'], 0.7, dur(3)], [60, ['A#3', 'E4', 'G4'], 0.6, dur(3)]], 2),
          clip(sub, 'Drop', 9, 1, [[0, 'E1', 0.8, dur(6)], [6, 'E1', 0.6, dur(4)], [10, 'E1', 0.7, dur(6)]], 8),
          clip(drums, 'Drop', 9, 1, groove, 8),
          clip(taiko, 'Drop', 9, 1, taikoBeat, 8),
        ],
        [[1, 'Trance'], [9, 'Drop']],
        master({ on: true, depth: 0.25 }, { on: true, amount: 1.3 })
      ), 4),
      STUDIO + 0.6
    ),
    {
      key: [4, 'minor'],
      rules: [
        ['Trance', 'Drop', { kind: 'cut', quantize: 'end' }],
        ['Drop', 'Trance', { kind: 'impact', quantize: 'bar' }],
      ],
      stingers: ['danger', 'gameOver'],
    }
  );
}

export const STORY_BUILDERS = {
  starlitCity,
  farewellPiano,
  sunsetDrive,
  midnightCaper,
  velvetInfiltration,
  wanderersRoad,
  meadowWaltz,
  championShowdown,
  ruinRequiem,
  neonRitual,
};
