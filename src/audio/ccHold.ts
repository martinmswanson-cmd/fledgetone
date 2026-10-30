/**
 * What a plugin's controllers hold at a point of the song. A clip's controller lane (CC 1, 74...)
 * reaches a plugin as MIDI, sent only where its value changes, and a controller keeps its value
 * after the clip ends, as a knob turned stays turned: for the rest of the song, until another
 * clip of the track moves it. So wherever playback starts (Play from a bar, a seek, a loop going
 * round, a render of some bars, a game kit's loop, a track heard again after a mute), each of a
 * track's controllers is set to what it would be there in a playback of the whole song from the
 * start: the last value sent before that point by any clip of the track, ended or not. One that no
 * clip has sent by then is as the fresh plugin has it, as at the start of the song: a plugin moved
 * since it was fresh (a fresh one, as every render's is, is there already) gets MIDI's Reset All
 * Controllers (CC 121) first, which the built-in families take to mean exactly that, each with its
 * own starting values (resetsFresh); any other plugin also gets the rests MIDI defines (restingCc:
 * the mod wheel, the pedals, expression; one like 74 is left to its reset). Stop resets each
 * plugin's controllers too (in wamPlugin.ts). Plain data, so Node tests it; the scheduler applies it.
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
 * Where a controller rests (0 to 1), for the ones MIDI's Reset All Controllers defines: the mod
 * wheel, breath and foot controllers and the pedals (64 to 69) at 0, expression at full. Null for
 * the rest (volume, pan, the sound controllers 70 to 79...): a plugin's own starting value for
 * those is its own (the JX10's filter and resonance aren't at their middle), so they're left as
 * they are rather than set to a guess.
 */
export function restingCc(cc: number): number | null {
  if (cc === 11) return 1;
  if (cc === 1 || cc === 2 || cc === 4 || (cc >= 64 && cc <= 69)) return 0;
  return null;
}

/**
 * The value of each of a track's controllers at `at`, from its clips' lane events (the clips in the
 * order the schedule plays them: at one place a later clip's value wins, as it's sent after).
 * Events at `at` itself are left out (they play there anyway). A controller no event has set
 * before `at` is given its resting value if it's in `moved` (sent to the plugin since it was
 * fresh) and has one (restingCc), else left out. Sorted by controller number.
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
    else if (moved?.has(cc)) {
      const rest = restingCc(cc);
      if (rest !== null) out.push([cc, rest]);
    }
  }
  return out;
}

/**
 * The built-in plugin families whose Reset All Controllers (CC 121) puts every controller back
 * where a fresh plugin of theirs has it (with its preset's and settings' own values: the organ's
 * speaker at its Rotary speed, a Surge patch's macros at theirs): Fledge Synth, mda, Faust,
 * setBfree and Surge XT. Mutable Instruments and Open303 ignore it, and their only controller is
 * the sustain pedal (Braids, Plaits), which the rests put back; another plugin may do anything.
 * (Surge XT can't put back a setting a patch of its own has learned to a controller.)
 */
export const FRESH_RESET_FAMILIES: readonly string[] = ['fledge', 'mda', 'faust', 'setbfree', 'surge'];
/** Whether the plugin at `url` takes Reset All Controllers to mean its fresh controllers (see FRESH_RESET_FAMILIES). */
export function resetsFresh(url: string): boolean {
  const m = /^builtin:([^/]+)\//.exec(url);
  return !!m && FRESH_RESET_FAMILIES.includes(m[1]);
}
