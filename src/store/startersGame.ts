import type { ProjectSnapshot } from './project';
import { everyBar } from './demoSong';
import type { Step } from './demoSong';
import { clip, D, master, progression, project, track } from './starterKit';
import { KIT } from './startersPlaylist';
import { createStinger } from './stingers';
import { keyOf } from './songKey';
import { ANY_STATE, transitionKey } from './transitions';
import type { StingerKind, Track, TransitionRule } from './timelineTypes';
import { FX_NOTES } from '../audio/instrumentCatalog';

/**
 * Game starters: music made the way a game uses it, ready to wire up. Each section is a game
 * state (Explore and Danger, Sneak and Spotted, Phase 1 and Phase 2...) that loops on its own;
 * tracks sit in stem groups (Ambient, Percussion, Tension, Climax) so the Intensity slider builds
 * the music up and down; transitions say how one state hands over to the next; and stingers in
 * the song's key are ready for wins, items and game overs. Steps are 16th notes, as in the other
 * starters.
 */

const { beat, melody, broken, stabs, pulse, power, lowCut, highCut, peq, EQ, human, glue, drumBus, inSpace, ROOM, STUDIO, HALL, dur } = KIT;

export type Group = 'Ambient' | 'Percussion' | 'Tension' | 'Climax';
/** A track in a stem group */
export const grouped = (t: Track, stemGroup: Group): Track => ({ ...t, stemGroup });

export interface GameSetup {
  /** The song's key (for the stingers): root 0 = C */
  key: [root: number, mode: 'major' | 'minor'];
  /** Transition rules between states by section name ('*': from any state, or into each other state) */
  rules?: Array<[from: string, to: string, rule: TransitionRule]>;
  stingers: StingerKind[];
}

/** The starter with its game parts: stingers in its key, and transitions between its sections. */
export function gameReady(p: ProjectSnapshot, setup: GameSetup): ProjectSnapshot {
  const key = keyOf(...setup.key);
  const stingers = setup.stingers.reduce<NonNullable<ProjectSnapshot['stingers']>>((all, kind) => [...all, createStinger(kind, key, all)], []);
  const idOf = (name: string) => (name === '*' ? ANY_STATE : p.markers?.find((m) => m.name === name)?.id);
  const transitions: Record<string, TransitionRule> = {};
  // A rule into any state ('*' as the target) is a rule into each of the others
  const expanded = (setup.rules ?? []).flatMap(([from, to, rule]): Array<[string, string, TransitionRule]> =>
    to === '*' ? (p.markers ?? []).filter((m) => m.name !== from).map((m): [string, string, TransitionRule] => [from, m.name, rule]) : [[from, to, rule]]
  );
  for (const [from, to, rule] of expanded) {
    const a = idOf(from);
    const b = idOf(to);
    if (!a || !b) throw new Error(`no section ${a ? to : from}`);
    // A stinger rule names the first stinger of its kind (given as the rule's stingerId)
    const stingerId = rule.kind === 'stinger' ? stingers.find((s) => s.kind === rule.stingerId)?.id : undefined;
    transitions[transitionKey(a, b)] = { ...rule, ...(stingerId ? { stingerId } : {}) };
  }
  return { ...p, stingers, transitions, intensity: { value: 1, curves: {} } };
}

/** Root, fifth and octave as a pulse of 8ths, one root per bar */
const eights = (roots: string[], vel = 0.6): Step[] => pulse(roots, [0, 2, 4, 6, 8, 10, 12, 14], 2, vel);

// ---------- Overworld adventure ----------

function overworld(): ProjectSnapshot {
  const harp = grouped(track('Harp', 'harp', { volume: -9, pan: -0.25, reverbSend: 0.35, fx: { human: human(0.2) } }), 'Ambient');
  const strings = grouped(track('Strings', 'strings', { volume: -12, reverbSend: 0.4, fx: { peq: EQ.pad(9000) } }), 'Ambient');
  const flute = track('Flute', 'flute', { volume: -7, pan: 0.15, reverbSend: 0.35, fx: { human: human(0.3, 0.1) } });
  const horn = grouped(track('French horn', 'frenchHorn', { volume: -6, pan: -0.1, reverbSend: 0.4, fx: { peq: EQ.brass(), human: human(0.3, 0.15) } }), 'Climax');
  const pizz = grouped(track('Pizzicato', 'pizzicato', { volume: -12, pan: 0.35, reverbSend: 0.3, fx: { human: human(0.3) } }), 'Tension');
  const cello = track('Cello', 'cello', { volume: -9, pan: 0.2, reverbSend: 0.3, fx: { peq: peq(lowCut(40)), human: human(0.3) } });
  const kit = drumBus();
  const drums = grouped(track('Drums', 'acousticKit', { volume: -6, output: kit.id, reverbSend: 0.15, fx: { peq: EQ.kit(), human: human(0.2) } }), 'Percussion');
  const timpani = grouped(track('Timpani', 'timpani', { volume: -10, reverbSend: 0.4 }), 'Percussion');

  // Explore: C - Bb - F - C | Am - F - G - G (a Mixolydian lift: open, sunny)
  const explore = [['C3', 'G3', 'C4', 'E4', 'G4', 'E4', 'C4', 'G3'], ['A#2', 'F3', 'A#3', 'D4', 'F4', 'D4', 'A#3', 'F3'], ['F2', 'C3', 'F3', 'A3', 'C4', 'A3', 'F3', 'C3'], ['C3', 'G3', 'C4', 'E4', 'G4', 'E4', 'C4', 'G3'], ['A2', 'E3', 'A3', 'C4', 'E4', 'C4', 'A3', 'E3'], ['F2', 'C3', 'F3', 'A3', 'C4', 'A3', 'F3', 'C3'], ['G2', 'D3', 'G3', 'B3', 'D4', 'B3', 'G3', 'D3'], ['G2', 'D3', 'G3', 'B3', 'D4', 'B3', 'G3', 'D3']];
  const pads = [['C4', 'E4', 'G4'], ['A#3', 'D4', 'F4'], ['A3', 'C4', 'F4'], ['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['A3', 'C4', 'F4'], ['B3', 'D4', 'G4'], ['B3', 'D4', 'G4']];
  const tune = melody([[0, 'E5', 4], [4, 'G5', 4], [8, 'C6', 6], [14, 'B5', 2], [16, 'A#5', 4], [20, 'A5', 2], [22, 'G5', 2], [24, 'F5', 8], [32, 'A5', 4], [36, 'C6', 4], [40, 'F5', 4], [44, 'A5', 4], [48, 'G5', 12], [60, 'E5', 4], [64, 'E5', 4], [68, 'A5', 4], [72, 'C6', 4], [76, 'B5', 4], [80, 'A5', 6], [86, 'G5', 2], [88, 'F5', 8], [96, 'G5', 4], [100, 'B5', 4], [104, 'D6', 4], [108, 'B5', 4], [112, 'G5', 16]], 0.7);
  // Danger: Am - F - G - E, the horn taking the theme in minor
  const danger = [['A3', 'C4', 'E4'], ['A3', 'C4', 'F4'], ['B3', 'D4', 'G4'], ['G#3', 'B3', 'E4']];
  const dangerRoots = ['A1', 'F1', 'G1', 'E1'];
  const hero = melody([[0, 'A4', 6], [6, 'E5', 2], [8, 'D5', 4], [12, 'C5', 4], [16, 'F4', 8], [24, 'A4', 4], [28, 'C5', 4], [32, 'D5', 6], [38, 'C5', 2], [40, 'B4', 4], [44, 'G4', 4], [48, 'E5', 12], [60, 'G#4', 4], [64, 'A4', 4], [68, 'C5', 4], [72, 'E5', 4], [76, 'A5', 4], [80, 'F5', 8], [88, 'E5', 4], [92, 'D5', 4], [96, 'D5', 4], [100, 'E5', 4], [104, 'F5', 4], [108, 'D5', 4], [112, 'E5', 16]], 0.8);
  const ostinato = everyBar(4, (b) => {
    const [r, , fifth] = danger[b];
    return [0, 2, 4, 6, 8, 10, 12, 14].map((s, i): Step => [s, i % 2 ? fifth : r, i % 4 === 0 ? 0.7 : 0.5, '8n']);
  });
  const march = beat([[D.kick, 'X.......X.....x.'], [D.snare, '....X..g....X.gg'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8);
  const light = beat([[D.kick, 'X.......X.......'], [D.closedHat, '..x...x...x...x.']], 0.6);
  return gameReady(
    inSpace(
      project(
        'Overworld Adventure starter',
        116,
        0,
        [1, 9],
        [harp, strings, flute, horn, pizz, cello, drums, timpani, kit],
        [
          clip(harp, 'Explore', 1, 8, broken(explore, 2, 2, 0.5)),
          clip(strings, 'Explore', 1, 8, progression(pads, 16, '1n', 0.5)),
          clip(flute, 'Theme', 1, 8, tune),
          clip(horn, 'Theme (high ground)', 5, 4, tune.filter(([s]) => s >= 64).map(([s, n, v, d]): Step => [s - 64, n, v, d]).map(([s, n, v, d]): Step => [s, (n as string).replace(/\d/, (o) => String(Number(o) - 1)), v, d])),
          clip(cello, 'Explore', 1, 8, progression(['C3', 'A#2', 'F2', 'C3', 'A2', 'F2', 'G2', 'G2'], 16, '1n', 0.55)),
          clip(drums, 'Explore', 5, 4, everyBar(4, () => light)),
          clip(strings, 'Danger', 9, 4, progression(danger, 16, '1n', 0.6), 2),
          clip(horn, 'Hero theme', 9, 8, hero),
          clip(pizz, 'Ostinato', 9, 4, ostinato, 2),
          clip(cello, 'Danger', 9, 4, eights(dangerRoots.map((r) => r.replace('1', '2')), 0.6), 2),
          clip(harp, 'Danger', 9, 4, broken(danger.map((c) => [...c, ...c.map((n) => n.replace(/\d/, (o) => String(Number(o) + 1)))]), 2, 2, 0.45), 2),
          clip(drums, 'Danger', 9, 4, [...everyBar(4, () => march), [0, D.crash, 0.6]], 2),
          clip(timpani, 'Danger', 9, 4, progression(dangerRoots.map((r) => r.replace('1', '2')), 16, '2n', 0.65), 2),
        ],
        [[1, 'Explore'], [9, 'Danger']],
        master({ on: true, depth: 0.08 }, { on: true, amount: 1.2 })
      ),
      HALL
    ),
    {
      key: [0, 'major'],
      rules: [
        ['Explore', 'Danger', { kind: 'fill', quantize: 'bar' }],
        ['Danger', 'Explore', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['item', 'levelUp', 'victory', 'gameOver'],
    }
  );
}

// ---------- Dungeon crawl ----------

function dungeon(): ProjectSnapshot {
  const air = grouped(track('Atmosphere', 'atmosphere', { volume: -14, reverbSend: 0.5, fx: { peq: EQ.pad(6000) } }), 'Ambient');
  const box = grouped(track('Music box', 'musicBox', { volume: -10, pan: 0.3, reverbSend: 0.55, fx: { peq: EQ.bells() } }), 'Ambient');
  const cello = track('Cello', 'cello', { volume: -8, pan: -0.2, reverbSend: 0.35, fx: { peq: peq(lowCut(40)), human: human(0.3) } });
  const contra = track('Contrabass', 'contrabass', { volume: -9, reverbSend: 0.3, fx: { human: human(0.25) } });
  const pizz = grouped(track('Pizzicato', 'pizzicato', { volume: -12, pan: 0.3, reverbSend: 0.35, fx: { human: human(0.3) } }), 'Tension');
  const trem = grouped(track('Tremolo strings', 'tremolo', { volume: -12, reverbSend: 0.4, fx: { peq: EQ.pad(8000) } }), 'Tension');
  const taiko = grouped(track('Taiko', 'taiko', { volume: -6, reverbSend: 0.4 }), 'Percussion');
  const choir = grouped(track('Choir', 'choir', { volume: -12, reverbSend: 0.5, fx: { peq: EQ.choir() } }), 'Climax');
  const bones = grouped(track('Trombones', 'trombone', { volume: -11, pan: 0.2, reverbSend: 0.45, fx: { peq: EQ.brass() } }), 'Climax');

  // D minor: Dm - Bb - Gm - A, the music box limping over it
  const chords = [['D4', 'F4', 'A4'], ['D4', 'F4', 'A#4'], ['D4', 'G4', 'A#4'], ['C#4', 'E4', 'A4']];
  const roots = ['D2', 'A#1', 'G1', 'A1'];
  const motif = everyBar(4, (b): Step[] => {
    const top = [['A5', 'F5', 'E5', 'D5'], ['A#5', 'F5', 'E5', 'D5'], ['A#5', 'G5', 'F5', 'D5'], ['A5', 'G5', 'E5', 'C#5']][b];
    return [[0, top[0], 0.6, '4n'], [4, top[1], 0.45, '8n'], [6, top[2], 0.45, '8n'], [8, top[3], 0.55, '2n']];
  });
  const creep = everyBar(4, (b): Step[] => [[0, roots[b].replace('1', '2').replace('2', '3'), 0.55, '8n'], [6, chords[b][1].replace('4', '3'), 0.4, '8n'], [10, chords[b][2].replace('4', '3'), 0.45, '8n']]);
  const ambushBeat = everyBar(4, (b): Step[] => [[0, 'D2', 0.85], [3, 'D2', 0.5], [6, 'D2', 0.6], [8, b === 3 ? 'A2' : 'D2', 0.8], [12, 'G1', 0.6], [14, 'D2', 0.55]]);
  const cellos = everyBar(4, (b): Step[] => Array.from({ length: 8 }, (_, i): Step => [i * 2, i % 2 ? roots[b].replace('1', '3').replace('2', '3') : roots[b].replace('1', '2'), i === 0 ? 0.8 : 0.55, '8n']));
  return gameReady(
    inSpace(
      project(
        'Dungeon Crawl starter',
        84,
        0,
        [1, 9],
        [air, box, cello, contra, pizz, trem, taiko, choir, bones],
        [
          clip(air, 'Drone', 1, 8, [[0, ['D3', 'A3'], 0.5, '1n'], [32, ['D3', 'A3'], 0.5, '1n'], [64, ['D3', 'A#3'], 0.5, '1n'], [96, ['C#3', 'A3'], 0.5, '1n']].map(([s, n, v]): Step => [s as number, n as string[], v as number, dur(32)])),
          clip(box, 'Lullaby', 1, 4, motif, 2),
          clip(cello, 'Drone', 1, 4, progression(roots.map((r) => r.replace('1', '2')), 16, '1n', 0.45), 2),
          clip(pizz, 'Creep', 5, 4, creep),
          clip(air, 'Ambush', 9, 4, progression(chords, 16, '1n', 0.5), 2),
          clip(cello, 'Ambush', 9, 4, cellos, 2),
          clip(contra, 'Ambush', 9, 4, progression(roots, 16, '1n', 0.7), 2),
          clip(trem, 'Ambush', 9, 4, progression(chords, 16, '1n', 0.6), 2),
          clip(pizz, 'Ambush', 9, 4, creep, 2),
          clip(taiko, 'Ambush', 9, 4, ambushBeat, 2),
          clip(choir, 'Ambush', 13, 4, progression(chords, 16, '1n', 0.6)),
          clip(bones, 'Ambush', 13, 4, stabs(roots.map((r) => power(r.replace('1', '2').replace('2', '3'))), [0, 6, 12], 3, 0.7)),
        ],
        [[1, 'Explore'], [9, 'Ambush']],
        master({ on: true, depth: 0.08 }, { on: true, amount: 1.25 })
      ),
      HALL
    ),
    {
      key: [2, 'minor'],
      rules: [
        ['Explore', 'Ambush', { kind: 'impact', quantize: 'beat' }],
        ['Ambush', 'Explore', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['danger', 'item', 'gameOver'],
    }
  );
}

// ---------- Cozy village ----------

function village(): ProjectSnapshot {
  const guitar = track('Guitar', 'nylonGuitar', { volume: -9, pan: -0.3, reverbSend: 0.25, fx: { human: human(0.3) } });
  const accordion = track('Accordion', 'accordion', { volume: -10, pan: 0.2, reverbSend: 0.25, fx: { human: human(0.3, 0.1) } });
  const ocarina = track('Ocarina', 'ocarina', { volume: -8, pan: 0.1, reverbSend: 0.35, fx: { human: human(0.3, 0.1) } });
  const bass = track('Upright bass', 'uprightBass', { volume: -8, fx: { peq: peq(lowCut(35)), human: human(0.25) } });
  const glock = grouped(track('Glockenspiel', 'glockenspiel', { volume: -15, pan: 0.35, reverbSend: 0.3, fx: { peq: EQ.bells() } }), 'Climax');
  const pad = grouped(track('Strings', 'slowStrings', { volume: -14, reverbSend: 0.4, fx: { peq: EQ.pad(8000) } }), 'Ambient');
  const perc = grouped(track('Hand drum', 'bongos', { volume: -12, pan: -0.2, reverbSend: 0.15, fx: { human: human(0.3) } }), 'Percussion');
  const block = grouped(track('Woodblock', 'woodblock', { volume: -18, pan: 0.4, fx: { human: human(0.3) } }), 'Percussion');

  // F major: F - C/E - Dm - Bb | F - C - Bb - C
  const day = [['F3', 'A3', 'C4'], ['E3', 'G3', 'C4'], ['D3', 'F3', 'A3'], ['D3', 'F3', 'A#3'], ['F3', 'A3', 'C4'], ['E3', 'G3', 'C4'], ['D3', 'F3', 'A#3'], ['E3', 'G3', 'C4']];
  const dayRoots = ['F2', 'E2', 'D2', 'A#1', 'F2', 'C2', 'A#1', 'C2'];
  const strum = everyBar(8, (b): Step[] => [[0, day[b], 0.7, '8n'], [4, day[b], 0.5, '16n'], [6, day[b], 0.55, '8n'], [10, day[b], 0.5, '16n'], [12, day[b], 0.6, '8n']]);
  const walk = everyBar(8, (b): Step[] => [[0, dayRoots[b], 0.75, '4n'], [8, dayRoots[b].replace(/\d/, (o) => String(Number(o) + 1)), 0.55, '4n']]);
  const tune = melody([[0, 'C5', 4], [4, 'A4', 2], [6, 'C5', 2], [8, 'F5', 6], [14, 'E5', 2], [16, 'E5', 4], [20, 'D5', 2], [22, 'C5', 2], [24, 'G4', 8], [32, 'A4', 4], [36, 'D5', 4], [40, 'C5', 4], [44, 'A4', 4], [48, 'A#4', 8], [56, 'C5', 8], [64, 'C5', 4], [68, 'A4', 2], [70, 'C5', 2], [72, 'F5', 6], [78, 'G5', 2], [80, 'E5', 8], [88, 'C5', 8], [96, 'D5', 4], [100, 'A#4', 4], [104, 'D5', 4], [108, 'E5', 4], [112, 'F5', 16]], 0.7);
  // Evening: Dm - Bb - F - C, quieter, the ocarina alone over guitar and strings
  const eve = [['D3', 'F3', 'A3'], ['D3', 'F3', 'A#3'], ['C3', 'F3', 'A3'], ['C3', 'E3', 'G3']];
  const eveRoots = ['D2', 'A#1', 'F2', 'C2'];
  const lullaby = melody([[0, 'A4', 6], [6, 'G4', 2], [8, 'F4', 8], [16, 'F4', 4], [20, 'D4', 4], [24, 'F4', 8], [32, 'C5', 6], [38, 'A#4', 2], [40, 'A4', 8], [48, 'G4', 16]], 0.6);
  const handDrum = beat([['C3', 'X..x..x.X..x.x..'], ['D3', '....x.......x...']], 0.6);
  return gameReady(
    inSpace(
      project(
        'Cozy Village starter',
        100,
        0.25,
        [1, 9],
        [guitar, accordion, ocarina, bass, glock, pad, perc, block],
        [
          clip(guitar, 'Day', 1, 8, strum),
          clip(bass, 'Day', 1, 8, walk),
          clip(accordion, 'Theme', 1, 8, tune),
          clip(glock, 'Sparkle', 5, 4, tune.filter(([s]) => s >= 64 && s % 8 === 0).map(([s, n, v, d]): Step => [s - 64, (n as string).replace(/\d/, (o) => String(Number(o) + 1)), v * 0.8, d])),
          clip(pad, 'Day', 5, 4, progression(day.slice(4), 16, '1n', 0.45)),
          clip(perc, 'Day', 1, 1, handDrum, 8),
          clip(block, 'Day', 5, 1, beat([['C4', '..x...x...x...x.']], 0.5), 4),
          clip(guitar, 'Evening', 9, 4, broken(eve.map((c) => [...c, c[1].replace(/\d/, (o) => String(Number(o) + 1)), c[2], c[1]]), 2, 4, 0.5), 2),
          clip(bass, 'Evening', 9, 4, progression(eveRoots, 16, '2n', 0.6), 2),
          clip(pad, 'Evening', 9, 4, progression(eve.map((c) => c.map((n) => n.replace(/\d/, (o) => String(Number(o) + 1)))), 16, '1n', 0.45), 2),
          clip(ocarina, 'Lullaby', 9, 4, lullaby, 2),
        ],
        [[1, 'Day'], [9, 'Evening']],
        master({ on: false }, { on: true, amount: 1.15 })
      ),
      STUDIO
    ),
    {
      key: [5, 'major'],
      rules: [
        ['Day', 'Evening', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
        ['Evening', 'Day', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['item', 'levelUp', 'checkpoint'],
    }
  );
}

// ---------- Space station ----------

function spaceStation(): ProjectSnapshot {
  const pad = grouped(track('Pad', 'warmPad', { volume: -9, reverbSend: 0.4, fx: { peq: EQ.pad(7000), chorus: { on: true } } }), 'Ambient');
  const air = grouped(track('Station air', 'sciFi', { volume: -14, reverbSend: 0.5, fx: { peq: EQ.pad(6000) } }), 'Ambient');
  const arp = track('Arp', 'pluck', { volume: -8, pan: 0.2, delaySend: 0.3, reverbSend: 0.25, fx: { peq: peq(lowCut(250)) } });
  const sub = track('Sub', 'subBass', { volume: -7, fx: { peq: EQ.sub(140) } });
  const drums = grouped(track('Drums', 'linnDrum', { volume: -5, reverbSend: 0.15, fx: { compressor: glue(-20) } }), 'Percussion');
  const lead = grouped(track('Lead', 'sawLead', { volume: -9, pan: -0.15, delaySend: 0.25, reverbSend: 0.3, fx: { peq: EQ.lead(7000) } }), 'Climax');
  const brass = grouped(track('Alert brass', 'synthBrass', { volume: -9, reverbSend: 0.3, fx: { peq: EQ.brass() } }), 'Tension');

  // E minor: Em9 - Cmaj7 - Am9 - B7sus, then the alert: Em - F (Phrygian) - Em - D
  const calm = [['E3', 'G3', 'B3', 'D4', 'F#4'], ['C3', 'E3', 'G3', 'B3'], ['A2', 'C3', 'E3', 'G3', 'B3'], ['B2', 'E3', 'F#3', 'A3']];
  const calmRoots = ['E1', 'C1', 'A0', 'B0'];
  const arpLine = everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => {
    const c = calm[b];
    const n = c[[0, 2, 3, 4, 3, 2, 1, 2][i % 8] % c.length];
    return [i, n.replace(/\d/, (o) => String(Number(o) + 1)), i % 4 === 0 ? 0.6 : 0.42, '16n'];
  }));
  const alert = [['E3', 'G3', 'B3'], ['F3', 'A3', 'C4'], ['E3', 'G3', 'B3'], ['D3', 'F#3', 'A3']];
  const alertRoots = ['E1', 'F1', 'E1', 'D1'];
  const pulseBeat = beat([[D.kick, 'X.......X.......'], [D.snare, '....X.......X...'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.75);
  const alarmBeat = beat([[D.kick, 'X..x..X.X..x..X.'], [D.snare, '....X.......X..x'], [D.closedHat, 'xxxxxxxxxxxxxxxx']], 0.85);
  const leadLine = melody([[0, 'B4', 6], [6, 'A4', 2], [8, 'G4', 8], [16, 'G4', 4], [20, 'A4', 4], [24, 'B4', 8], [32, 'C5', 6], [38, 'B4', 2], [40, 'A4', 8], [48, 'F#4', 16]], 0.7);
  return gameReady(
    inSpace(
      project(
        'Space Station starter',
        105,
        0,
        [1, 9],
        [pad, air, arp, sub, drums, lead, brass],
        [
          clip(air, 'Hum', 1, 8, [[0, ['E3', 'B3'], 0.5, dur(128)]]),
          clip(pad, 'Explore', 1, 4, progression(calm, 16, '1n', 0.5), 2),
          clip(arp, 'Explore', 1, 4, arpLine, 2),
          clip(sub, 'Explore', 1, 4, progression(calmRoots.map((r) => r.replace('0', '1')), 16, '1n', 0.7), 2),
          clip(drums, 'Explore', 5, 1, pulseBeat, 4),
          clip(lead, 'Theme', 5, 4, leadLine),
          clip(pad, 'Alert', 9, 4, progression(alert, 16, '1n', 0.55), 2),
          clip(brass, 'Alert', 9, 4, stabs(alert, [0, 3, 6, 10, 12], 2, 0.7), 2),
          clip(sub, 'Alert', 9, 4, eights(alertRoots, 0.7), 2),
          clip(arp, 'Alert', 9, 4, everyBar(4, (b) => Array.from({ length: 16 }, (_, i): Step => [i, alert[b][i % 3].replace(/\d/, (o) => String(Number(o) + 1)), i % 4 === 0 ? 0.65 : 0.45, '16n'])), 2),
          clip(drums, 'Alert', 9, 1, alarmBeat, 8),
          clip(lead, 'Alert', 13, 4, melody([[0, 'E5', 4], [4, 'F5', 4], [8, 'G5', 8], [16, 'F5', 4], [20, 'E5', 4], [24, 'C5', 8], [32, 'E5', 4], [36, 'F5', 4], [40, 'G5', 4], [44, 'B5', 4], [48, 'A5', 16]], 0.75)),
        ],
        [[1, 'Explore'], [9, 'Alert']],
        master({ on: true, depth: 0.12 }, { on: true, amount: 1.3 })
      ),
      STUDIO
    ),
    {
      key: [4, 'minor'],
      rules: [
        ['Explore', 'Alert', { kind: 'riser', quantize: 'bar' }],
        ['Alert', 'Explore', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['danger', 'checkpoint', 'item'],
    }
  );
}

// ---------- Racing ----------

function racing(): ProjectSnapshot {
  const kit = drumBus(-16);
  const drums = grouped(track('Drums', 'acousticKit', { volume: -4, output: kit.id, reverbSend: 0.1, fx: { peq: EQ.kit() } }), 'Percussion');
  const bass = track('Bass', 'reeseBass', { volume: -9, fx: { peq: peq(lowCut(35), highCut(6000)) } });
  const gtr = grouped(track('Guitar', 'overdriveGuitar', { volume: -12, pan: 0.45, fx: { peq: EQ.guitar() } }), 'Tension');
  const saws = grouped(track('Supersaw', 'supersaw', { volume: -14, pan: -0.2, reverbSend: 0.25, fx: { peq: EQ.pad(9000) } }), 'Climax');
  const lead = track('Lead', 'sawLead', { volume: -10, delaySend: 0.2, reverbSend: 0.2, fx: { peq: EQ.lead(8000) } });
  const fx = track('FX', 'fx', { volume: -14 });

  // E minor: Em - C - G - D; the final lap goes up a semitone (F minor), the oldest trick in racing games
  const chords = (shift: number) => [['E3', 'G3', 'B3'], ['C3', 'E3', 'G3'], ['D3', 'G3', 'B3'], ['D3', 'F#3', 'A3']].map((c) => c.map((n) => transpose(n, shift)));
  const roots = (shift: number) => ['E1', 'C1', 'G1', 'D1'].map((n) => transpose(n, shift));
  const drive = beat([[D.kick, 'X.....X...X.....'], [D.snare, '....X.......X...'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.85);
  const lap = beat([[D.kick, 'X.X...X.X.X...X.'], [D.snare, '....X.......X.X.'], [D.closedHat, 'xxxxxxxxxxxxxxxx']], 0.9);
  const hook = (shift: number) =>
    melody([[0, 'B4', 3], [3, 'E5', 3], [6, 'G5', 2], [8, 'F#5', 4], [12, 'E5', 4], [16, 'E5', 3], [19, 'G5', 3], [22, 'C6', 2], [24, 'B5', 8], [32, 'B4', 3], [35, 'D5', 3], [38, 'G5', 2], [40, 'F#5', 4], [44, 'D5', 4], [48, 'A5', 8], [56, 'F#5', 8]], 0.8).map(([s, n, v, d]): Step => [s, transpose(n as string, shift), v, d]);
  const part = (start: number, shift: number, label: string, beatSteps: Step[]) => [
    clip(drums, label, start, 1, beatSteps, 8),
    clip(bass, label, start, 4, eights(roots(shift).map((r) => transpose(r, 12)), 0.75), 2),
    clip(gtr, label, start, 4, stabs(roots(shift).map((r) => power(transpose(r, 24))), [0, 3, 6, 10, 12], 2, 0.75), 2),
    clip(saws, label, start, 4, stabs(chords(shift).map((c) => c.map((n) => transpose(n, 12))), [0, 6, 12], 2, 0.6), 2),
    clip(lead, label, start + 4, 4, hook(shift)),
  ];
  return gameReady(
    inSpace(
      project(
        'Racing starter',
        150,
        0,
        [1, 9],
        [drums, bass, gtr, saws, lead, fx, kit],
        [
          ...part(1, 0, 'Race', drive),
          clip(fx, 'Last bar', 8, 1, [[0, FX_NOTES.riser, 0.5, '1n']]),
          ...part(9, 1, 'Final lap', lap),
          clip(fx, 'Final lap', 9, 1, [[0, FX_NOTES.impact, 0.6]]),
        ],
        [[1, 'Race'], [9, 'Final Lap']],
        master({ on: true, depth: 0.15 }, { on: true, amount: 1.3 })
      ),
      ROOM
    ),
    {
      key: [4, 'minor'],
      rules: [['Race', 'Final Lap', { kind: 'riser', quantize: 'bar' }]],
      stingers: ['checkpoint', 'victory', 'gameOver'],
    }
  );
}

/** A note name moved by semitones. */
function transpose(note: string, semitones: number): string {
  if (!semitones) return note;
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const m = /^([A-G]#?)(-?\d)$/.exec(note);
  if (!m) return note;
  const midi = names.indexOf(m[1]) + 12 * (Number(m[2]) + 1) + semitones;
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
const octave = (n: string, by: number) => transpose(n, 12 * by);

// ---------- Platformer ----------

function platformer(): ProjectSnapshot {
  const lead = track('Lead', 'chipLead', { volume: -5, pan: 0.1, delaySend: 0.15 });
  const harmony = grouped(track('Harmony', 'squareLead', { volume: -11, pan: -0.3, fx: { peq: EQ.lead(6000) } }), 'Climax');
  const bass = track('Bass', 'chipBass', { volume: -4 });
  const drums = grouped(track('Drums', 'chipDrums', { volume: -4 }), 'Percussion');
  const glock = grouped(track('Sparkle', 'glockenspiel', { volume: -11, pan: 0.35, reverbSend: 0.3 }), 'Ambient');
  const marimba = grouped(track('Marimba', 'marimba', { volume: -7, pan: -0.2, reverbSend: 0.2 }), 'Tension');

  // C major, bouncing: C - Am - F - G
  const roots = ['C2', 'A1', 'F1', 'G1'];
  const bounce = everyBar(4, (b): Step[] => [0, 4, 6, 8, 12, 14].map((s, i): Step => [s, i % 2 ? octave(roots[b], 1) : roots[b], i === 0 ? 0.8 : 0.6, '16n']));
  const tune = melody([[0, 'E5', 2], [2, 'G5', 2], [4, 'C6', 4], [8, 'B5', 2], [10, 'G5', 2], [12, 'E5', 4], [16, 'A5', 2], [18, 'C6', 2], [20, 'E6', 4], [24, 'D6', 4], [28, 'C6', 4], [32, 'F5', 2], [34, 'A5', 2], [36, 'C6', 4], [40, 'A5', 4], [44, 'F5', 4], [48, 'G5', 4], [52, 'B5', 4], [56, 'D6', 4], [60, 'G5', 4]], 0.75);
  const thirds = tune.map(([s, n, v, d]): Step => [s, transpose(n as string, -4), v * 0.8, d]);
  const chip = beat([[D.kick, 'X.......X.x.....'], [D.snare, '....X.......X...'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.8);
  const comp = stabs([['C4', 'E4', 'G4'], ['A3', 'C4', 'E4'], ['A3', 'C4', 'F4'], ['B3', 'D4', 'G4']], [2, 6, 10, 14], 1, 0.55);
  // Underground: A minor, slow and echoing
  const under = ['A1', 'A1', 'F1', 'E1'];
  const caveTune = melody([[0, 'A4', 4], [6, 'C5', 2], [8, 'E5', 8], [16, 'D5', 4], [22, 'C5', 2], [24, 'A4', 8], [32, 'F4', 4], [38, 'A4', 2], [40, 'C5', 8], [48, 'B4', 8], [56, 'G#4', 8]], 0.65);
  return gameReady(
    project(
      'Platformer starter',
      140,
      0,
      [1, 9],
      [lead, harmony, bass, drums, glock, marimba],
      [
        clip(lead, 'Level theme', 1, 4, tune, 2),
        clip(harmony, 'Level theme', 5, 4, thirds),
        clip(bass, 'Level', 1, 4, bounce, 2),
        clip(drums, 'Level', 1, 1, chip, 8),
        clip(marimba, 'Level', 1, 4, comp, 2),
        clip(glock, 'Level', 5, 4, tune.filter(([s]) => s % 16 === 0).map(([s, n, v]): Step => [s, octave(n as string, 1), v * 0.7, '4n'])),
        clip(lead, 'Underground', 9, 4, caveTune, 2),
        clip(bass, 'Underground', 9, 4, pulse(under, [0, 6, 12], 4, 0.65), 2),
        clip(drums, 'Underground', 9, 1, beat([[D.kick, 'X.........X.....'], [D.closedHat, '....x.......x...']], 0.6), 8),
      ],
      [[1, 'Level'], [9, 'Underground']],
      master({ on: false }, { on: false })
    ),
    {
      key: [0, 'major'],
      rules: [
        ['Level', 'Underground', { kind: 'cut', quantize: 'bar' }],
        ['Underground', 'Level', { kind: 'cut', quantize: 'bar' }],
      ],
      stingers: ['item', 'levelUp', 'checkpoint', 'victory', 'gameOver'],
    }
  );
}

// ---------- Boss fight ----------

function bossFight(): ProjectSnapshot {
  const kit = drumBus(-16);
  const drums = grouped(track('Drums', 'acousticKit', { volume: -5, output: kit.id, reverbSend: 0.15, fx: { peq: EQ.kit() } }), 'Percussion');
  const taiko = grouped(track('Taiko', 'taiko', { volume: -6, output: kit.id, reverbSend: 0.35 }), 'Percussion');
  const timpani = track('Timpani', 'timpani', { volume: -9, reverbSend: 0.4 });
  const brass = track('Brass', 'brassSection', { volume: -6, reverbSend: 0.4, fx: { peq: EQ.brass(), human: human(0.25) } });
  const strings = grouped(track('Strings', 'tremolo', { volume: -10, reverbSend: 0.4, fx: { peq: EQ.pad(9000) } }), 'Tension');
  const contra = track('Low strings', 'contrabass', { volume: -7, reverbSend: 0.3, fx: { human: human(0.25) } });
  const gtr = grouped(track('Guitar', 'distortionGuitar', { volume: -12, pan: 0.45, fx: { peq: EQ.guitar() } }), 'Tension');
  const organ = grouped(track('Organ', 'pipeOrgan', { volume: -12, reverbSend: 0.5 }), 'Climax');
  const choir = grouped(track('Choir', 'choir', { volume: -9, reverbSend: 0.5, fx: { peq: EQ.choir() } }), 'Climax');
  const fx = track('FX', 'fx', { volume: -12 });

  // C minor: Cm - Ab - Bb - G; Phase 2 the same, with choir and organ, the drums doubled
  const chords = [['C4', 'D#4', 'G4'], ['C4', 'D#4', 'G#4'], ['D4', 'F4', 'A#4'], ['B3', 'D4', 'G4']];
  const roots = ['C2', 'G#1', 'A#1', 'G1'];
  const riff = melody([[0, 'C5', 2], [2, 'D#5', 2], [4, 'G5', 4], [8, 'F5', 2], [10, 'D#5', 2], [12, 'D5', 4], [16, 'C5', 2], [18, 'D#5', 2], [20, 'G#5', 4], [24, 'G5', 4], [28, 'D#5', 4], [32, 'D5', 2], [34, 'F5', 2], [36, 'A#5', 4], [40, 'G#5', 2], [42, 'G5', 2], [44, 'F5', 4], [48, 'G5', 8], [56, 'B4', 8]], 0.85);
  const chug = everyBar(4, (b): Step[] => [0, 2, 3, 6, 8, 10, 11, 14].map((s, i): Step => [s, power(octave(roots[b], 1)), i % 4 === 0 ? 0.85 : 0.65, '16n']));
  const p1 = beat([[D.kick, 'X.....X...X.....'], [D.snare, '....X.......X...'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.85);
  const p2 = beat([[D.kick, 'X.X.X.X.X.X.X.X.'], [D.snare, '....X.......X.xx'], [D.ride, 'x.x.x.x.x.x.x.x.']], 0.9);
  const taikoHits = everyBar(4, (): Step[] => [[0, 'D2', 0.8], [6, 'D2', 0.55], [8, 'G1', 0.7], [12, 'D2', 0.6], [14, 'D2', 0.65]]);
  return gameReady(
    inSpace(
      project(
        'Boss Fight starter',
        150,
        0,
        [1, 9],
        [drums, taiko, timpani, brass, strings, contra, gtr, organ, choir, fx, kit],
        [
          clip(brass, 'Boss theme', 1, 4, riff, 4),
          clip(contra, 'Phase 1', 1, 4, eights(roots, 0.75), 4),
          clip(strings, 'Phase 1', 1, 4, progression(chords, 16, '1n', 0.6), 4),
          clip(gtr, 'Riff', 1, 4, chug, 4),
          clip(drums, 'Phase 1', 1, 1, p1, 8),
          clip(timpani, 'Downbeats', 1, 4, progression(roots.map((r) => r.replace('1', '2')), 16, '2n', 0.7), 4),
          clip(taiko, 'Phase 1', 5, 4, taikoHits),
          clip(fx, 'Into phase 2', 8, 1, [[0, FX_NOTES.riser, 0.55, '1n']]),
          clip(fx, 'Phase 2', 9, 1, [[0, FX_NOTES.impact, 0.65]]),
          clip(drums, 'Phase 2', 9, 1, p2, 8),
          clip(taiko, 'Phase 2', 9, 4, taikoHits, 2),
          clip(organ, 'Phase 2', 9, 4, progression(chords.map((c) => [octave(c[0], -1), ...c]), 16, '1n', 0.6), 2),
          clip(choir, 'Phase 2', 9, 4, progression(chords, 16, '1n', 0.7), 2),
          // Defeated: the riff's last chord resolves to Eb major and holds
          clip(brass, 'Defeated', 17, 2, [[0, ['D#4', 'G4', 'A#4'], 0.8, '1n'], [16, ['D#4', 'G4', 'A#4', 'D#5'], 0.7, '1n']]),
          clip(strings, 'Defeated', 17, 2, [[0, ['D#3', 'A#3', 'G4'], 0.55, dur(32)]]),
          clip(choir, 'Defeated', 17, 2, [[0, ['D#4', 'G4', 'A#4'], 0.6, dur(32)]]),
          clip(timpani, 'Defeated', 17, 1, [[0, 'D#2', 0.75, '2n']]),
        ],
        [[1, 'Phase 1'], [9, 'Phase 2'], [17, 'Defeated']],
        master({ on: true, depth: 0.12 }, { on: true, amount: 1.25 })
      ),
      HALL
    ),
    {
      key: [0, 'minor'],
      rules: [
        ['Phase 1', 'Phase 2', { kind: 'riser', quantize: 'bar' }],
        ['*', 'Defeated', { kind: 'stinger', quantize: 'beat', stingerId: 'victory' }],
      ],
      stingers: ['victory', 'danger', 'gameOver'],
    }
  );
}

// ---------- Stealth ----------

function stealth(): ProjectSnapshot {
  const pulseBass = track('Pulse', 'synthBass2', { volume: -11, fx: { peq: peq(lowCut(35), highCut(2500)) } });
  const pizz = grouped(track('Pizzicato', 'pizzicato', { volume: -12, pan: -0.3, reverbSend: 0.35, fx: { human: human(0.3) } }), 'Ambient');
  const ticks = grouped(track('Ticks', 'drumMachine', { volume: -16, pan: 0.3 }), 'Ambient');
  const pad = grouped(track('Dark pad', 'atmosphere', { volume: -16, reverbSend: 0.5, fx: { peq: EQ.pad(5000) } }), 'Ambient');
  const kit = drumBus(-18);
  const drums = grouped(track('Drums', 'acousticKit', { volume: -5, output: kit.id, reverbSend: 0.15, fx: { peq: EQ.kit() } }), 'Percussion');
  const strings = grouped(track('Strings', 'tremolo', { volume: -11, reverbSend: 0.4, fx: { peq: EQ.pad(9000) } }), 'Tension');
  const brass = grouped(track('Brass', 'brassSection', { volume: -8, reverbSend: 0.35, fx: { peq: EQ.brass() } }), 'Climax');
  const fx = track('FX', 'fx', { volume: -12 });

  // B minor: Bm - G - Em - F#, a ticking clock and creeping pizzicato, then caught
  const roots = ['B1', 'G1', 'E1', 'F#1'];
  const chords = [['B3', 'D4', 'F#4'], ['B3', 'D4', 'G4'], ['B3', 'E4', 'G4'], ['A#3', 'C#4', 'F#4']];
  const creep = everyBar(4, (b): Step[] => [[0, octave(roots[b], 2), 0.5, '16n'], [3, chords[b][1].replace('4', '3'), 0.35, '16n'], [6, chords[b][0].replace('3', '4').replace('A#4', 'A#3'), 0.4, '16n'], [11, chords[b][2], 0.38, '16n'], [14, chords[b][1], 0.35, '16n']]);
  const tick = beat([[D.closedHat, 'x.xxx.xxx.xxx.xx'], [D.tomHigh, '....x.......x...']], 0.4);
  const caught = beat([[D.kick, 'X..X..X.X..X..X.'], [D.snare, '....X.......X...'], [D.closedHat, 'x.x.x.x.x.x.x.x.']], 0.85);
  return gameReady(
    inSpace(
      project(
        'Stealth starter',
        96,
        0,
        [1, 9],
        [pulseBass, pizz, ticks, pad, drums, strings, brass, fx, kit],
        [
          clip(pulseBass, 'Pulse', 1, 4, eights(roots.map((r) => octave(r, 1)), 0.45), 4),
          clip(pad, 'Sneak', 1, 8, [[0, ['B2', 'F#3'], 0.45, dur(128)]]),
          clip(ticks, 'Clock', 1, 1, tick, 8),
          clip(pizz, 'Creep', 1, 4, creep, 2),
          clip(fx, 'Caught', 9, 1, [[0, FX_NOTES.impact, 0.6]]),
          clip(drums, 'Spotted', 9, 1, caught, 8),
          clip(strings, 'Spotted', 9, 4, progression(chords, 16, '1n', 0.65), 2),
          clip(brass, 'Spotted', 9, 4, stabs(chords.map((c) => [octave(c[0], -1), ...c]), [0, 3, 8, 11], 2, 0.75), 2),
          clip(pizz, 'Spotted', 9, 4, creep, 2),
        ],
        [[1, 'Sneak'], [9, 'Spotted']],
        master({ on: true, depth: 0.1 }, { on: true, amount: 1.2 })
      ),
      STUDIO
    ),
    {
      key: [11, 'minor'],
      rules: [
        ['Sneak', 'Spotted', { kind: 'impact', quantize: 'beat' }],
        ['Spotted', 'Sneak', { kind: 'crossfade', quantize: 'bar', beats: 8 }],
      ],
      stingers: ['danger', 'checkpoint', 'gameOver'],
    }
  );
}

// ---------- Title screen ----------

function titleScreen(): ProjectSnapshot {
  const piano = track('Piano', 'piano', { volume: -8, reverbSend: 0.35, fx: { peq: EQ.piano(), human: human(0.25) } });
  const strings = grouped(track('Strings', 'strings', { volume: -12, reverbSend: 0.45, fx: { peq: EQ.pad(9000) } }), 'Ambient');
  const choir = grouped(track('Choir pad', 'choirPad', { volume: -16, reverbSend: 0.5 }), 'Ambient');
  const harp = grouped(track('Harp', 'harp', { volume: -12, pan: 0.3, reverbSend: 0.4 }), 'Tension');
  const horn = grouped(track('French horn', 'frenchHorn', { volume: -8, pan: -0.15, reverbSend: 0.45, fx: { peq: EQ.brass(), human: human(0.3) } }), 'Climax');
  const cello = track('Cello', 'cello', { volume: -10, reverbSend: 0.35, fx: { peq: peq(lowCut(40)) } });
  const timpani = grouped(track('Timpani', 'timpani', { volume: -14, reverbSend: 0.45 }), 'Percussion');

  // D major: D - A/C# - Bm - G | D/F# - G - Em - A: a broad theme that loops for as long as the menu is open
  const chords = [['D3', 'A3', 'F#4'], ['C#3', 'A3', 'E4'], ['B2', 'F#3', 'D4'], ['G2', 'D3', 'B3'], ['F#2', 'D3', 'A3'], ['G2', 'D3', 'B3'], ['E2', 'B2', 'G3'], ['A2', 'E3', 'C#4']];
  const bassNotes = ['D2', 'C#2', 'B1', 'G1', 'F#1', 'G1', 'E1', 'A1'];
  const arps = everyBar(8, (b) => {
    const [r, f, t] = chords[b];
    return [r, f, t, octave(f, 1), octave(t, 1), octave(f, 1), t, f].map((n, i): Step => [i * 2, n, i === 0 ? 0.6 : 0.45, '8n']);
  });
  const theme = melody([[0, 'F#4', 6], [6, 'E4', 2], [8, 'D4', 4], [12, 'A4', 4], [16, 'A4', 8], [24, 'G4', 4], [28, 'E4', 4], [32, 'F#4', 6], [38, 'G4', 2], [40, 'A4', 4], [44, 'D5', 4], [48, 'B4', 12], [60, 'A4', 4], [64, 'A4', 6], [70, 'B4', 2], [72, 'A4', 4], [76, 'F#4', 4], [80, 'G4', 8], [88, 'B4', 8], [96, 'G4', 6], [102, 'F#4', 2], [104, 'E4', 4], [108, 'G4', 4], [112, 'A4', 16]], 0.75);
  return gameReady(
    inSpace(
      project(
        'Title Screen starter',
        76,
        0,
        [1, 9],
        [piano, strings, choir, harp, horn, cello, timpani],
        [
          clip(piano, 'Title', 1, 8, arps),
          clip(cello, 'Title', 1, 8, progression(bassNotes.map((n) => octave(n, 1)), 16, '1n', 0.5)),
          clip(strings, 'Title', 1, 8, progression(chords.map((c) => c.map((n) => octave(n, 1))), 16, '1n', 0.45)),
          clip(choir, 'Title', 5, 4, progression(chords.slice(4).map((c) => c.map((n) => octave(n, 1))), 16, '1n', 0.4)),
          clip(horn, 'Theme', 1, 8, theme),
          clip(harp, 'Title', 5, 4, broken(chords.slice(4).map((c) => [...c, ...c.map((n) => octave(n, 1))]), 2, 2, 0.45)),
          clip(timpani, 'Swell', 8, 1, [[0, 'A1', 0.4, '8n'], [8, 'A1', 0.55, '8n'], [12, 'A1', 0.7, '8n']]),
          // Menu: the same chords, quieter, for screens behind the title
          clip(piano, 'Menu', 9, 8, arps.map(([s, n, v, d]): Step => [s, n, v * 0.75, d])),
          clip(strings, 'Menu', 9, 8, progression(chords.map((c) => c.map((n) => octave(n, 1))), 16, '1n', 0.35)),
        ],
        [[1, 'Title'], [9, 'Menu']],
        master({ on: false }, { on: true, amount: 1.2 })
      ),
      HALL
    ),
    {
      key: [2, 'major'],
      rules: [
        ['Title', 'Menu', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
        ['Menu', 'Title', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['checkpoint', 'levelUp'],
    }
  );
}

// ---------- Puzzle ----------

function puzzle(): ProjectSnapshot {
  const marimba = track('Marimba', 'marimba', { volume: -8, pan: -0.2, reverbSend: 0.25, fx: { human: human(0.25) } });
  const pizz = grouped(track('Pizzicato', 'pizzicato', { volume: -12, pan: 0.3, reverbSend: 0.3, fx: { human: human(0.3) } }), 'Ambient');
  const bassoon = track('Bassoon', 'bassoon', { volume: -10, reverbSend: 0.25, fx: { human: human(0.3) } });
  const clarinet = grouped(track('Clarinet', 'clarinet', { volume: -11, pan: 0.2, reverbSend: 0.3, fx: { human: human(0.3, 0.1) } }), 'Tension');
  const kalimba = grouped(track('Kalimba', 'kalimba', { volume: -14, pan: 0.4, reverbSend: 0.35 }), 'Climax');
  const block = grouped(track('Woodblock', 'woodblock', { volume: -16, pan: -0.4, fx: { human: human(0.3) } }), 'Percussion');
  const shaker = grouped(track('Hand drum', 'bongos', { volume: -15, pan: 0.2, fx: { human: human(0.3) } }), 'Percussion');

  // F major, curious: F - Dm - Gm7 - C7 | Bb - F/A - Gm - C
  const chords = [['F3', 'A3', 'C4'], ['D3', 'F3', 'A3'], ['F3', 'A#3', 'D4'], ['E3', 'A#3', 'C4'], ['D3', 'F3', 'A#3'], ['C3', 'F3', 'A3'], ['D3', 'G3', 'A#3'], ['E3', 'G3', 'C4']];
  const bassLine = ['F2', 'D2', 'G2', 'C2', 'A#1', 'A1', 'G1', 'C2'];
  const tune = melody([[0, 'C5', 2], [3, 'A4', 1], [4, 'F4', 2], [8, 'G4', 2], [10, 'A4', 2], [12, 'C5', 4], [16, 'D5', 2], [19, 'C5', 1], [20, 'A4', 4], [24, 'F4', 4], [28, 'A4', 4], [32, 'A#4', 2], [35, 'A4', 1], [36, 'G4', 2], [40, 'D5', 4], [44, 'A#4', 4], [48, 'C5', 2], [51, 'A#4', 1], [52, 'G4', 4], [56, 'E4', 8], [64, 'D5', 2], [67, 'C5', 1], [68, 'A#4', 4], [72, 'D5', 4], [76, 'F5', 4], [80, 'C5', 8], [88, 'A4', 8], [96, 'A#4', 4], [100, 'D5', 4], [104, 'G4', 4], [108, 'A#4', 4], [112, 'C5', 8], [120, 'E5', 8]], 0.7);
  const counter = melody([[0, 'A4', 8], [8, 'G4', 8], [16, 'F4', 16], [32, 'D4', 8], [40, 'F4', 8], [48, 'E4', 16]], 0.6);
  return gameReady(
    inSpace(
      project(
        'Puzzle starter',
        100,
        0.2,
        [1, 9],
        [marimba, pizz, bassoon, clarinet, kalimba, block, shaker],
        [
          clip(marimba, 'Theme', 1, 8, tune, 2),
          clip(pizz, 'Thinking', 1, 8, stabs(chords, [4, 12], 2, 0.5), 2),
          clip(bassoon, 'Bass', 1, 8, everyBar(8, (b): Step[] => [[0, bassLine[b], 0.65, '8n'], [6, octave(bassLine[b], 1), 0.45, '16n'], [8, transpose(bassLine[b], 7), 0.55, '8n']]), 2),
          clip(block, 'Tick', 1, 1, beat([['C4', 'x...x...x...x...']], 0.4), 16),
          clip(clarinet, 'Almost there', 9, 4, counter, 2),
          clip(kalimba, 'Almost there', 13, 4, tune.filter(([s]) => s % 4 === 0 && s < 64).map(([s, n, v]): Step => [s, octave(n as string, 1), v * 0.7, '8n'])),
          clip(shaker, 'Almost there', 9, 1, beat([['C3', 'x..x..x.x..x..x.'], ['D3', '....x.......x...']], 0.45), 8),
        ],
        [[1, 'Thinking'], [9, 'Almost There']],
        master({ on: false }, { on: true, amount: 1.1 })
      ),
      ROOM
    ),
    {
      key: [5, 'major'],
      rules: [
        ['Thinking', 'Almost There', { kind: 'cut', quantize: 'bar' }],
        ['Almost There', 'Thinking', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['levelUp', 'item', 'victory'],
    }
  );
}

// ---------- Shop ----------

function shop(): ProjectSnapshot {
  const vibes = track('Vibraphone', 'vibraphone', { volume: -8, pan: 0.15, reverbSend: 0.3, fx: { human: human(0.3) } });
  const keys = track('Electric piano', 'rhodes', { volume: -10, pan: -0.25, reverbSend: 0.25, fx: { peq: EQ.piano(), human: human(0.3) } });
  const bass = track('Upright bass', 'uprightBass', { volume: -7, fx: { peq: peq(lowCut(35)), human: human(0.25) } });
  const drums = grouped(track('Drums', 'acousticKit', { volume: -12, reverbSend: 0.15, fx: { compressor: glue(-22), human: human(0.25) } }), 'Percussion');
  const steel = grouped(track('Steel drums', 'steelDrums', { volume: -11, pan: 0.3, reverbSend: 0.3 }), 'Climax');
  const flute = grouped(track('Flute', 'flute', { volume: -12, pan: -0.1, reverbSend: 0.35 }), 'Tension');

  // G major, a ii-V-I shuffle: Gmaj7 - Em7 - Am7 - D7
  const chords = [['F#3', 'B3', 'D4'], ['D3', 'G3', 'B3'], ['C4', 'E4', 'G4'], ['C4', 'F#4', 'A4']];
  const walk = [['G2', 'B2', 'D3', 'F#2'], ['E2', 'G2', 'B2', 'D2'], ['A2', 'C3', 'E3', 'G2'], ['D2', 'F#2', 'A2', 'C3']];
  const walking = everyBar(4, (b) => walk[b].map((n, i): Step => [i * 4, n, i === 0 ? 0.75 : 0.6, '4n']));
  const comp = stabs(chords, [0, 6, 10], 2, 0.5);
  const swing = beat([[D.ride, 'x...x.x.x...x.x.'], [D.closedHat, '....x.......x...'], [D.kick, 'x.......x.......']], 0.5);
  const tune = melody([[0, 'D5', 3], [3, 'B4', 1], [4, 'G4', 4], [8, 'A4', 2], [10, 'B4', 2], [12, 'D5', 4], [16, 'E5', 4], [20, 'D5', 2], [22, 'B4', 2], [24, 'G4', 8], [32, 'C5', 3], [35, 'B4', 1], [36, 'A4', 4], [40, 'E5', 4], [44, 'C5', 4], [48, 'D5', 6], [54, 'C5', 2], [56, 'A4', 8]], 0.7);
  return gameReady(
    inSpace(
      project(
        'Shop starter',
        112,
        0.35,
        [1, 5],
        [vibes, keys, bass, drums, steel, flute],
        [
          clip(vibes, 'Theme', 1, 4, tune, 2),
          clip(keys, 'Comping', 1, 4, comp, 4),
          clip(bass, 'Walk', 1, 4, walking, 4),
          clip(drums, 'Shuffle', 1, 1, swing, 16),
          clip(flute, 'Counter', 5, 4, melody([[0, 'B4', 8], [8, 'G4', 8], [16, 'C5', 8], [24, 'A4', 8], [32, 'B4', 4], [36, 'D5', 4], [40, 'C5', 8], [48, 'A4', 16]], 0.55)),
          clip(steel, 'Bargain', 9, 4, tune.map(([s, n, v, d]): Step => [s, n, v * 0.9, d]), 2),
        ],
        [[1, 'Browse'], [9, 'Bargain']],
        master({ on: false }, { on: true, amount: 1.1 })
      ),
      ROOM
    ),
    {
      key: [7, 'major'],
      rules: [
        ['Browse', 'Bargain', { kind: 'cut', quantize: 'bar' }],
        ['Bargain', 'Browse', { kind: 'crossfade', quantize: 'bar', beats: 4 }],
      ],
      stingers: ['item', 'checkpoint'],
    }
  );
}

export const GAME_BUILDERS = {
  overworld,
  dungeon,
  village,
  spacestation: spaceStation,
  racing,
  platformer,
  boss: bossFight,
  stealth,
  title: titleScreen,
  puzzle,
  shop,
};
