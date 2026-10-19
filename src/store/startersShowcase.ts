import type { ProjectSnapshot } from './project';
import type { Step } from './demoSong';
import { D, master, project, track } from './starterKit';
import { KIT } from './startersPlaylist';
import { grouped } from './startersGame';
import { MORE_KIT } from './startersGameMore';

/**
 * Starters that show off the newer recordings: a cathedral of both choirs, organ, strings and
 * bells; a late-night ballad on brushes, grand piano, upright bass and tenor sax; a plaza groove on
 * the Latin percussion with nylon guitar and muted trumpet; and a morning in the garden on mbira,
 * balafon, folk harp, hand chimes and a didgeridoo drone. Every part plays a recorded instrument.
 */

const { melody, beat, stabs, lowCut, peq, EQ, human, drumBus, inSpace, ROOM, STUDIO, HALL, dur } = KIT;
const { clip, tr, measures, drumClip, held } = MORE_KIT;

/** Each chord's notes rising in 8ths, then the top falling back (a harp or guitar figure), a bar each. */
const arpeggio = (chords: string[][], vel = 0.5): Step[] =>
  measures(chords.length, 16, (m) => {
    const c = chords[m];
    const up = [...c, ...c.map((n) => tr(n, 12))].slice(0, 8);
    return up.map((n, i): Step => [i * 2, n, i === 0 ? vel + 0.1 : vel, dur(3)]);
  });

/** A quarter-note walking line: root, third, fifth, then a half step into the next root. */
const walking = (bars: Array<[string, string, string]>, vel = 0.65): Step[] =>
  measures(bars.length, 16, (m) => {
    const [r, t, f] = bars[m];
    const next = bars[(m + 1) % bars.length][0];
    return [[0, r, vel, dur(4)], [4, t, vel * 0.85, dur(4)], [8, f, vel * 0.9, dur(4)], [12, tr(next, 1), vel * 0.8, dur(4)]];
  });

// ---------- Cathedral: both choirs, organ and bells ----------

function cathedral(): ProjectSnapshot {
  const ooh = track('Choir "ooh"', 'realChoirOoh', { volume: -7, reverbSend: 0.5, fx: { peq: EQ.choir() } });
  const choir = grouped(track('Choir "aah"', 'realChoir', { volume: -6, reverbSend: 0.5, fx: { peq: EQ.choir() } }), 'Climax');
  const organ = track('Organ', 'realPipeOrgan', { volume: -14, reverbSend: 0.45, fx: { peq: peq(lowCut(40)) } });
  const harp = track('Harp', 'realHarp', { volume: -10, pan: -0.3, reverbSend: 0.4, fx: { human: human(0.2) } });
  const strings = grouped(track('Strings', 'realStrings', { volume: -13, pan: 0.15, reverbSend: 0.45, fx: { peq: EQ.pad(9000) } }), 'Tension');
  const timpani = grouped(track('Timpani', 'realTimpani', { volume: -10, reverbSend: 0.4 }), 'Percussion');
  const bells = grouped(track('Tubular bells', 'realTubularBells', { volume: -16, pan: 0.3, reverbSend: 0.5 }), 'Climax');

  // D minor: Dm - Bb - F - C, then Gm - Dm - Bbmaj7 - A (the Picardy turn home), a bar each
  const nave = [['D3', 'F3', 'A3', 'D4'], ['A#2', 'D3', 'F3', 'A#3'], ['A2', 'C3', 'F3', 'A3'], ['G2', 'C3', 'E3', 'G3']];
  const gloria = [['G2', 'D3', 'G3', 'A#3'], ['A2', 'D3', 'F3', 'A3'], ['A#2', 'D3', 'F3', 'A3'], ['A2', 'C#3', 'E3', 'A3']];
  const voices = (cs: string[][]) => cs.map((c) => [c[0], ...c.slice(1).map((n) => tr(n, 12))]);
  const hymn = melody([
    [0, 'A4', 8], [8, 'D5', 8], [16, 'D5', 6], [22, 'C5', 2], [24, 'A#4', 8], [32, 'A4', 8], [40, 'C5', 8], [48, 'G4', 16],
    [64, 'A#4', 8], [72, 'D5', 8], [80, 'A4', 12], [92, 'F4', 4], [96, 'F4', 8], [104, 'G4', 8], [112, 'E4', 16],
  ], 0.7);
  return inSpace(project(
    'Cathedral starter',
    72,
    0,
    [1, 17],
    [ooh, choir, organ, harp, strings, timpani, bells],
    [
      clip(organ, 'Nave', 1, 4, held(nave, 16, 0.45), 2),
      clip(ooh, 'Nave', 1, 4, held(voices(nave), 16, 0.45), 2),
      clip(harp, 'Nave', 5, 4, arpeggio(nave.map((c) => c.map((n) => tr(n, 12))), 0.45)),
      clip(organ, 'Gloria', 9, 8, held([...gloria, ...gloria], 16, 0.5)),
      clip(ooh, 'Gloria', 9, 8, held(voices([...gloria, ...gloria]), 16, 0.4)),
      clip(choir, 'Gloria', 9, 8, hymn),
      clip(strings, 'Gloria', 9, 8, held(voices([...gloria, ...gloria]), 16, 0.35)),
      clip(harp, 'Gloria', 9, 8, arpeggio([...gloria, ...gloria].map((c) => c.map((n) => tr(n, 12))), 0.4)),
      clip(timpani, 'Gloria', 9, 8, measures(8, 16, (m) => (m % 4 === 3 ? [[0, 'A2', 0.6, dur(4)], [8, 'A2', 0.45, dur(4)], [12, 'D3', 0.7, dur(4)]] : [[0, m % 2 ? 'A2' : 'D3', 0.55, dur(8)]]))),
      clip(bells, 'Gloria', 9, 8, measures(8, 16, (m) => (m % 2 === 0 ? [[0, ['D5', 'A4', 'D5', 'F5'][m / 2], 0.5, dur(16)]] : []))),
    ],
    [[1, 'Nave'], [9, 'Gloria']],
    master({ on: false }, { on: true, amount: 1.2 })
  ), HALL + 1);
}

// ---------- After Hours: a brushes ballad ----------

function afterHours(): ProjectSnapshot {
  // The sax (and Plaza's trumpet) were recorded close and dry, and stop within a quarter second of
  // being let go: Ring lets each note die away into the room with the piano and drums, and a little
  // distance puts it on the same stage, so the phrases don't stop dead in front of the band
  const piano = track('Grand piano', 'realStudioGrand', { volume: -6, pan: -0.1, reverbSend: 0.25, fx: { peq: EQ.piano(), human: human(0.25) } });
  const bass = track('Upright bass', 'realUprightBass', { volume: -8, fx: { peq: peq(lowCut(35)), human: human(0.25) } });
  const sax = grouped(track('Tenor sax', 'realTenorSax', { volume: -9, pan: 0.2, reverbSend: 0.55, distance: 0.3, ring: 2, fx: { human: human(0.3) } }), 'Climax');
  const kit = drumBus(-18);
  const drums = grouped(track('Brushes', 'brushKit', { volume: -9, output: kit.id, reverbSend: 0.2, fx: { peq: EQ.kit(), human: human(0.2) } }), 'Percussion');

  // F major: Fmaj7 - D7 - Gm7 - C7 (I - VI - ii - V), then Am7 - D7 - Gm7 - C7
  const comp = [['E3', 'A3', 'C4', 'F4'], ['F#3', 'C4', 'D4', 'A4'], ['F3', 'A#3', 'D4', 'G4'], ['E3', 'A#3', 'C4', 'G4']];
  const comp2 = [['E3', 'G3', 'C4', 'A4'], ...comp.slice(1)];
  const roots: Array<[string, string, string]> = [['F2', 'A2', 'C3'], ['D2', 'F#2', 'A2'], ['G2', 'A#2', 'D3'], ['C2', 'E2', 'G2']];
  const roots2: Array<[string, string, string]> = [['A1', 'C2', 'E2'], ...roots.slice(1)];
  // Chords on two and the and of three, as a ballad pianist leaves room
  const chords = (cs: string[][]) => stabs(cs, [4, 10], 4, 0.45);
  const tune = melody([
    [0, 'C5', 6], [6, 'A4', 2], [8, 'F4', 8], [16, 'A4', 4], [20, 'C5', 4], [24, 'D5', 8], [32, 'D5', 6], [38, 'C5', 2], [40, 'A#4', 8],
    [48, 'A4', 4], [52, 'G4', 4], [56, 'E4', 8], [64, 'G4', 6], [70, 'A4', 2], [72, 'C5', 8], [80, 'F#4', 4], [84, 'A4', 4], [88, 'D5', 8],
    [96, 'D5', 4], [100, 'C5', 4], [104, 'A#4', 8], [112, 'A4', 4], [116, 'G4', 4], [120, 'F4', 8],
  ], 0.65);
  return inSpace(project(
    'After Hours starter',
    84,
    0,
    [1, 17],
    [piano, bass, sax, kit, drums],
    [
      clip(piano, 'Ballad', 1, 4, chords(comp), 2),
      clip(bass, 'Ballad', 1, 4, walking(roots, 0.6), 2),
      drumClip(drums, 'Brushes', 1, 'brushes', 8, 0.35, 4, 3),
      clip(piano, 'Chorus', 9, 8, chords([...comp2, ...comp])),
      clip(bass, 'Chorus', 9, 8, walking([...roots2, ...roots], 0.65)),
      drumClip(drums, 'Brushes', 9, 'brushes', 8, 0.5, 4, 7),
      clip(sax, 'Theme', 9, 8, tune),
    ],
    [[1, 'Ballad'], [9, 'Theme']],
    master({ on: false }, { on: true, amount: 1.1 })
  ), ROOM + 0.3);
}

// ---------- Plaza: a Latin groove ----------

function plaza(): ProjectSnapshot {
  const guitar = track('Nylon guitar', 'realNylonGuitar', { volume: -7, pan: -0.25, reverbSend: 0.2, fx: { human: human(0.3) } });
  const bass = track('Upright bass', 'realUprightBass', { volume: -7, fx: { peq: peq(lowCut(35)), human: human(0.25) } });
  const trumpet = grouped(track('Muted trumpet', 'realMutedTrumpet', { volume: -9, pan: 0.2, reverbSend: 0.55, distance: 0.3, ring: 2, fx: { peq: EQ.brass(), human: human(0.3) } }), 'Climax');
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

export const SHOWCASE_BUILDERS = { cathedral, afterHours, plaza, mbiraMorning };
