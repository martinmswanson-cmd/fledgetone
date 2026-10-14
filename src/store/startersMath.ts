import type { ProjectSnapshot } from './project';
import { D, master, project, track } from './starterKit';
import { presetPatch } from './synthPatch';
import { barsToDuration, uid } from './timelineTypes';
import type { Clip, NoteEvent, Track } from './timelineTypes';
import { endlessRiser, fibonacciGroove, fifthsWalk, pascalHarp, pendulumWave, scoop, springBounce, stutterBuild, tritoneSlide } from './mathPatterns';
import { transpose } from './noteTools';

/**
 * Formula Rush: the Math patterns all at once (see mathPatterns.ts). Pendulum bells drift and
 * line up from the start; Pascal's harp and the endless riser build over a stutter that doubles
 * every bar; then the drop: an 808 that bounces like a spring and slides up a tritone, a rave
 * hoover scooping into a fifths walk, a Fibonacci pluck groove, cowbell and claps on 2 and 4.
 */

const A_MINOR = { root: 9, steps: [0, 2, 3, 5, 7, 8, 10] };
const BPM = 150;
const BAR_SECONDS = 240 / BPM;
const id = () => uid('note');

const hit = (row: string, at: number, velocity: number, bars = 1 / 16): NoteEvent => ({ id: id(), note: row, startOffset: at, duration: barsToDuration(bars), velocity });
const clipOf = (t: Track, name: string, startBar: number, lengthBars: number, notes: NoteEvent[]): Clip => ({ id: uid('clip'), trackId: t.id, name, startBar, lengthBars, notes, isSelected: false });

/** Four bars of drums: `kick` on every beat, claps on 2 and 4 (from `clapsFrom`), off-beat hats and the cowbell's figure. */
function drums(bars: number, opts: { claps: boolean; cowbell: boolean; snareEnd: boolean }): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (let b = 0; b < bars; b++) {
    for (let beat = 0; beat < 4; beat++) {
      out.push(hit(D.kick, b + beat / 4, beat === 0 ? 0.9 : 0.8));
      out.push(hit(D.closedHat, b + beat / 4 + 1 / 8, 0.45));
      if (opts.claps && beat % 2 === 1) out.push(hit(D.clap, b + beat / 4, 0.78));
    }
    if (opts.cowbell) for (const s of [0, 3, 6, 10, 12]) out.push(hit(D.cowbell, b + s / 16, s === 0 ? 0.5 : 0.36));
    // The snare on the bar's last beat (the stutter build retriggers it)
    if (opts.snareEnd) out.push(hit(D.snare, b + 0.75, 0.8, 1 / 4));
  }
  return out;
}

/** The 808: the root each bar, bouncing like a spring; every fourth bar's last note slides up a tritone. */
function eightOhEight(bars: number): NoteEvent[] {
  const roots = ['A1', 'A1', 'F1', 'G1'];
  const out: NoteEvent[] = [];
  for (let b = 0; b < bars; b++) {
    const r = roots[b % 4];
    const first = springBounce([{ id: id(), note: r, startOffset: b, duration: barsToDuration(3 / 8), velocity: 0.85 }], BAR_SECONDS);
    const second = { id: id(), note: r, startOffset: b + 0.5, duration: barsToDuration(b % 4 === 3 ? 1 / 2 : 3 / 8), velocity: 0.75 };
    out.push(...first, ...(b % 4 === 3 ? tritoneSlide([second], BAR_SECONDS) : springBounce([second], BAR_SECONDS)));
  }
  return out;
}

export function formulaRush(): ProjectSnapshot {
  const bells = track('Pendulum bells', 'celesta', { volume: -7, reverbSend: 0.35, delaySend: 0.12 });
  const harp = track("Pascal's harp", 'harp', { volume: -10, reverbSend: 0.35 });
  const riser = track('Endless riser', 'synthDesigner', { volume: -16, reverbSend: 0.4, synth: presetPatch('Supersaw lead') });
  const hoover = track('Hoover', 'synthDesigner', { volume: -12, reverbSend: 0.25, synth: presetPatch('Rave hoover'), fx: { distortion: { on: true, amount: 0.08 } } });
  const pluck = track('Fibonacci pluck', 'pluck', { volume: -12, delaySend: 0.18, reverbSend: 0.2 });
  const bass = track('808', 'bass808', { volume: -9 });
  const kit = track('Drums', 'drumMachine', { volume: -6 });

  // The hoover walks the circle of fifths an octave up, half notes, scooping into each
  const walk = fifthsWalk(A_MINOR, 8, id).filter((_, i) => i % 2 === 0).map((n) => ({ ...n, duration: barsToDuration(1 / 2), velocity: 0.8 }));
  const hooverNotes = scoop(transpose(walk, 12, 0, 127), BAR_SECONDS);

  const clips: Clip[] = [
    clipOf(bells, 'Pendulum wave', 1, 16, pendulumWave(A_MINOR, 16, id)),
    clipOf(harp, "Pascal's harp", 5, 4, pascalHarp(A_MINOR, 4, id)),
    clipOf(harp, "Pascal's harp", 13, 4, pascalHarp(A_MINOR, 4, id)),
    clipOf(riser, 'Endless riser', 5, 4, endlessRiser(A_MINOR, 4, id)),
    clipOf(kit, 'Stutter build', 5, 4, stutterBuild(drums(4, { claps: false, cowbell: false, snareEnd: true }), id)),
    clipOf(kit, 'Drop', 9, 8, drums(8, { claps: true, cowbell: true, snareEnd: false })),
    clipOf(bass, '808 springs', 9, 8, eightOhEight(8)),
    clipOf(hoover, 'Fifths walk', 9, 8, hooverNotes),
    clipOf(pluck, 'Fibonacci groove', 9, 8, fibonacciGroove(A_MINOR, 8, id)),
  ];
  return project('Formula Rush starter', BPM, 0, [1, 17], [bells, harp, riser, hoover, pluck, bass, kit], clips, [[1, 'Intro: pendulums'], [5, 'Build: stutter + riser'], [9, 'Drop: all together']], master({}, {}));
}

export const MATH_BUILDERS = { formulaRush };
