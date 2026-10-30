/**
 * How long effects keep sounding after what goes into them stops, seconds: a track's own Delay and
 * Reverb inserts, and the master reverb and delay its sends feed. Plain arithmetic (no audio),
 * shared by the export's ring-out (exportWav.ts ringOutSeconds) and by where a suggestion's changes
 * are heard (agent/songDiff.ts).
 */
import type { MasterFx, TrackFx } from '../store/timelineTypes';
import { ECHO_BEATS, ECHO_FEEDBACK_MAX } from '../store/timelineTypes';
import { INSERT_ROOM, roomSeconds } from './effects/roomIR';

/** Longest recorded room kept (seconds): a longer tail is faded out there */
export const ROOM_MAX_SECONDS = 12;
/** The decay a designed room is built with, for the reverb's `decay` setting (seconds). */
export const designedDecay = (decay: number) => Math.max(0.8, Math.min(12, decay));

const BEATS: Record<string, number> = { '4n': 1, '8n.': 0.75, '8n': 0.5, '16n': 0.25 };

/** Delay subdivision in seconds at a tempo (computed here so tempo changes stay in sync). */
export function delaySeconds(subdivision: string, bpm: number): number {
  return ((BEATS[subdivision] ?? 0.5) * 60) / bpm;
}

/** How many repeats an echo fed back by `feedback` takes to fall 60 dB (at least one). */
export const echoRepeats = (feedback: number): number => (feedback > 0.001 ? Math.max(1, Math.log(0.001) / Math.log(Math.min(0.999, feedback))) : 1);

/**
 * How long a track's own Delay and Reverb keep sounding after its last note (seconds), at most
 * `max` (an export's ring-out stops at 60 s). `varies`: the settings an automation or step lane
 * moves (as "echo.feedback", "echo.mix"), taken at their longest (the feedback at its highest, a mix
 * that may open).
 */
export function insertTailSeconds(fx: Partial<TrackFx>, bpm: number, max = 60, varies: ReadonlySet<string> = new Set()): number {
  let tail = 0;
  if (fx.reverb?.on && (fx.reverb.mix > 0 || varies.has('reverb.mix'))) tail = Math.max(tail, roomSeconds(INSERT_ROOM, fx.reverb.decay) + (varies.has('reverb.preDelay') ? 0.2 : fx.reverb.preDelay / 1000));
  if (fx.echo?.on && (fx.echo.mix > 0 || varies.has('echo.mix'))) {
    const step = (ECHO_BEATS[fx.echo.time] ?? 0.5) * (60 / Math.max(1, bpm));
    const fb = Math.min(ECHO_FEEDBACK_MAX, varies.has('echo.feedback') ? ECHO_FEEDBACK_MAX : fx.echo.feedback);
    // Repeats until they've fallen 60 dB (ping-pong takes two steps a round trip, but each repeat still falls by fb)
    tail = Math.max(tail, Math.min(max, (echoRepeats(fb) + 1) * step));
  }
  return tail;
}

/**
 * How long the master reverb rings (seconds): a recorded room's recording (`roomSeconds`, when its
 * length is known; else as long as one is kept), or the designed room's, whose lows ring longer
 * than its decay (see roomIR.ts roomSeconds).
 */
export function masterReverbSeconds(fx: Pick<MasterFx, 'reverbDecay' | 'room' | 'roomStyle'>, recordedSeconds?: number): number {
  if (fx.room) return Math.min(ROOM_MAX_SECONDS, recordedSeconds ?? ROOM_MAX_SECONDS);
  return roomSeconds(fx.roomStyle ?? 'hall', designedDecay(fx.reverbDecay));
}

/** How long the master delay's repeats last until they've fallen 60 dB (seconds), at most `max`. */
export function masterDelaySeconds(fx: Pick<MasterFx, 'delayTime' | 'delayFeedback'>, bpm: number, max = 60): number {
  if (!(fx.delayFeedback > 0)) return delaySeconds(fx.delayTime, bpm);
  return Math.min(max, (echoRepeats(Math.min(0.8, fx.delayFeedback)) + 1) * delaySeconds(fx.delayTime, bpm));
}
