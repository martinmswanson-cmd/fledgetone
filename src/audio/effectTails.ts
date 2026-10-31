/**
 * How long effects keep sounding after what goes into them stops, seconds: a track's own Delay and
 * Reverb inserts, and the master reverb and delay its sends feed. Plain arithmetic (no audio),
 * shared by the export's ring-out (exportWav.ts ringOutSeconds) and by where a suggestion's changes
 * are heard (agent/songDiff.ts). Both read the tracks as they play (playedTracks): every way a
 * setting can move over the song (the track's automation, its clips' controller lanes, by the
 * usual meaning of a controller or the track's MIDI learn mappings, and its clips' step lanes) is
 * then one automation lane, so one reading covers them all.
 */
import type { Clip, MasterFx, Track, TrackFx } from '../store/timelineTypes';
import { ECHO_BEATS, ECHO_FEEDBACK_MAX, isAutomationParam } from '../store/timelineTypes';
import { withControllerLanes } from '../store/ccLanes';
import { withStepLanes } from '../store/stepLanes';
import { busOf, liveSends } from '../store/buses';
import { INSERT_ROOM, roomSeconds } from './effects/roomIR';
import type { Tempo } from './tempoMap';
import { minOf } from '../support/minMax';

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

/**
 * The tracks as they play: their clips' controller lanes and step lanes added to their automation
 * (the same merge a render plays: exportWav.ts, and the live engine: timelineStore.ts).
 */
export function playedTracks(tracks: Track[], clips: readonly Clip[], tempo: Tempo): Track[] {
  return withStepLanes(withControllerLanes(tracks, clips), clips, tempo);
}

/** The slowest tempo of these, BPM (an echo's repeats are furthest apart there). */
export function slowestBpm(tempos: ReadonlyArray<Tempo>): number {
  const all = tempos.flatMap((t) => (typeof t === 'number' ? [t] : [t.bpm, ...(t.points ?? []).map((p) => p.bpm)]));
  return Math.max(1, minOf(all.filter((b) => Number.isFinite(b) && b > 0)));
}

/** Whether a played track (playedTracks) has a lane for `param`. */
const hasLane = (t: Pick<Track, 'automation'>, param: string) => !!t.automation?.some((l) => l.param === param);

/** The settings of a played track's inserts its lanes move ("echo.feedback"), for insertTailSeconds' `varies`. */
export function movingFx(t: Pick<Track, 'automation'>): Set<string> {
  const out = new Set<string>();
  for (const l of t.automation ?? []) if (l.param.startsWith('fx:')) out.add(l.param.slice(3));
  return out;
}

/** A played track's own Delay and Reverb tail (seconds, at most `max`), its lane-moved settings at their longest. */
export const ownInsertTail = (t: Pick<Track, 'fx' | 'automation'>, bpm: number, max = 60): number => insertTailSeconds(t.fx ?? {}, bpm, max, movingFx(t));

/** Whether a played track can reach the master reverb: a send, a distance, or a send lane. */
export const feedsMasterReverb = (t: Pick<Track, 'reverbSend' | 'distance' | 'automation'>): boolean => t.reverbSend > 0 || (t.distance ?? 0) > 0 || hasLane(t, 'reverbSend');

/** Whether a played track can reach the master delay: a send or a send lane. */
export const feedsMasterDelay = (t: Pick<Track, 'delaySend' | 'automation'>): boolean => t.delaySend > 0 || hasLane(t, 'delaySend');

/**
 * Whether every lane of a played track moves something these tails know about: a setting they
 * read at its longest (the sends, an insert's mix, feedback or pre-delay), one that doesn't make
 * anything ring longer (the level, pan, filter, EQ, a send to a return, the other insert
 * settings), or a plugin's parameter (a plugin's tail is never known: see songDiff.ts). A lane for
 * anything else isn't known here.
 */
export const lanesKnown = (t: Pick<Track, 'automation'>): boolean => (t.automation ?? []).every((l) => isAutomationParam(l.param));

/** A tail and whether all of it is known. */
export interface Tail {
  seconds: number;
  sure: boolean;
}

/**
 * How long what `t` plays rings on through everything after it (seconds), the longest way out:
 * its own stage (`stage`: its inserts), then the longest of the bus it plays into and the returns
 * it sends to (each the same way, on), and of the master effects it feeds (`master`), one after
 * another. Shared by where a suggestion is heard (songDiff.ts trackTails) and an export's ring-out
 * (exportWav.ts ringOutSeconds), each with its own stage and master; `tracks` as they play
 * (playedTracks). Sure only if every stage on the way is.
 */
export function chainTail(t: Track, tracks: readonly Track[], stage: (t: Track) => Tail, master: (t: Track) => number, seen: ReadonlySet<string> = new Set([t.id])): Tail {
  const own = stage(t);
  let rest = master(t);
  let sure = own.sure;
  for (const d of [busOf(t, tracks), ...liveSends(t, tracks).map((x) => tracks.find((o) => o.id === x.to))]) {
    if (!d || seen.has(d.id)) continue;
    const next = chainTail(d, tracks, stage, master, new Set([...seen, d.id]));
    rest = Math.max(rest, next.seconds);
    sure &&= next.sure;
  }
  return { seconds: own.seconds + rest, sure };
}
