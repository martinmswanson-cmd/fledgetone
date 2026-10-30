/**
 * What a plugin's controllers hold at a point of the song. A clip's controller lane (CC 1, 74...)
 * reaches a plugin as MIDI, sent only where its value changes, and a controller keeps its value
 * after the clip ends, as a knob turned stays turned: for the rest of the song, until another
 * clip of the track moves it. So wherever playback starts (Play from a bar, a seek, a loop going
 * round, a render of some bars, a game kit's loop, a track heard again after a mute), each of a
 * track's controllers is set to what it would be there in a playback of the whole song from the
 * start: the last value sent before that point by any clip of the track, ended or not. One that no
 * clip has sent by then sits at rest (restingCc), as at the start of the song; it's sent only
 * when the plugin may have been moved from rest (a fresh plugin, as every render's is, is there
 * already). Stop resets each plugin's controllers too (MIDI's Reset All Controllers, in
 * wamPlugin.ts). Plain data, so Node tests it; the scheduler applies it.
 */

import type { Clip } from '../store/timelineTypes';
import { exprValueAt, laneCc, lanesOf } from '../store/expression';

/** One controller value a clip's lane sends, at its place in the song (the scheduler's are in Transport ticks, these in bars). */
export interface CcEvent {
  at: number;
  cc: number;
  /** 0 to 1 */
  value: number;
}

/**
 * The values a clip's controller lanes send, in bars from the song's start: every 64th of the clip
 * where a lane's value (as MIDI, 0 to 127) changes, from its first point's value at the clip's
 * start; lane by lane, each in order. Nothing past the clip's end.
 */
export function clipCcEvents(clip: Pick<Clip, 'startBar' | 'lengthBars' | 'expression'>): CcEvent[] {
  const out: CcEvent[] = [];
  for (const lane of lanesOf(clip.expression)) {
    const n = laneCc(lane);
    const points = clip.expression?.[lane];
    if (n === null || !points?.length) continue;
    let last = -1;
    for (let at = 0; at < clip.lengthBars - 1e-9; at += 1 / 64) {
      const value = at <= points[0].at ? points[0].value : exprValueAt(points, at);
      const midi = Math.round(value * 127);
      if (midi === last) continue;
      last = midi;
      out.push({ at: clip.startBar + at, cc: n, value });
    }
  }
  return out;
}

/**
 * Where a controller rests (0 to 1): what MIDI's Reset All Controllers sets (the mod wheel, the
 * pedals and the rest at 0, expression at full) and General MIDI's power-on values for the ones it
 * leaves alone (volume 100, balance and pan centred, the sound controllers at their middle).
 */
export function restingCc(cc: number): number {
  if (cc === 7) return 100 / 127;
  if (cc === 8 || cc === 10 || (cc >= 70 && cc <= 79)) return 64 / 127;
  if (cc === 11) return 1;
  return 0;
}

/**
 * The value of each of a track's controllers at `at`, from its clips' lane events (the clips in the
 * order the schedule plays them: at one place a later clip's value wins, as it's sent after).
 * Events at `at` itself are left out (they play there anyway). A controller no event has set
 * before `at` is given its resting value if it's in `moved` (sent
 * to the plugin since it was fresh), else left out. Sorted by controller number.
 */
export function heldCcAt(clipEvents: Iterable<readonly CcEvent[]>, at: number, moved?: ReadonlySet<number>): Array<[cc: number, value: number]> {
  const best = new Map<number, CcEvent>();
  const lanes = new Set<number>(moved ?? []);
  for (const events of clipEvents) {
    for (const ev of events) {
      lanes.add(ev.cc);
      if (ev.at >= at) continue;
      const was = best.get(ev.cc);
      if (!was || ev.at >= was.at) best.set(ev.cc, ev);
    }
  }
  const out: Array<[number, number]> = [];
  for (const cc of [...lanes].sort((a, b) => a - b)) {
    const held = best.get(cc);
    if (held) out.push([cc, held.value]);
    else if (moved?.has(cc)) out.push([cc, restingCc(cc)]);
  }
  return out;
}
