/**
 * Automation lanes played as Web Audio parameter automation: each lane is written a short stretch
 * ahead of the audio clock, so seeks, edits and loop wraps are heard almost at once without
 * clicks. Live and in exports, one schedule per Transport.
 */
import { isMixTrack } from '../store/buses';
import { barToSeconds, secondsToBar, type Tempo } from './tempoMap';
import type * as Tone from 'tone';
import type { AutomationParam, AutomationPoint, Track } from '../store/timelineTypes';
import { specOf, CURVE_STEP, isLinearMap, lanePieceFrom, laneValueAt, sampleStretch } from './automation';
import { clockMargin, type AutomationTarget } from './effects/paramWriter';
import type { TrackStrip } from './effects/trackStrip';
import { ticksToBar } from './transport';

type Transport = ReturnType<typeof Tone.getTransport>;

/**
 * Plays automation lanes as AudioParam automation on the audio clock, live and in the WAV export
 * (one per Transport, like createClipSchedule).
 *
 * Nothing goes on the Transport's event list. The schedule listens for the Transport starting
 * (play, or a seek while playing), stopping and wrapping round its loop, each of which comes with
 * the audio time it happens at. From there a lane is written ahead of the clock in short stretches:
 * each stretch is one curve per native param (two values when the param moves in a straight line
 * with the lane, else as many as its curve needs, up to one every 10 ms; the writer plays it as
 * straight ramps between them), never longer than WINDOW and never across a point, so corners land
 * exactly where they're drawn. A lane that holds still (before its first point, after its last,
 * along a flat line) writes nothing until it moves again. While playing, the context's clock tick
 * (20 a second live, every render block in the export) tops lanes up; it is listened to only while
 * the Transport runs and some lane exists, and does nothing between stretches.
 *
 * An edit to a lane drops only that lane's stretches that haven't started (see paramWriter.ts) and
 * writes it again from there; other lanes are left alone. The stretch already playing can't be cut
 * without a click, so stretches are short: a seek, an edit or an undo is heard at most WINDOW after
 * Tone's usual look-ahead. Where the value has to jump (a seek, a loop wrap, an edit, two points on
 * one bar) it glides there over 4 ms instead of clicking.
 *
 * Nothing here throws (see paramWriter.ts): these run inside Tone's clock, where an exception
 * would stop the notes due in that moment, and inside the store's actions.
 *
 * While stopped, each lane holds its value at the playhead (hold()), so the inspector and a
 * scrub show what will play.
 */
export interface AutomationSchedule {
  /**
   * Bring the lanes in line with the tracks (after their strips have applied them). Cheap when no
   * lane changed. `duck` is the gain curve every track but the proxies plays (see duck.ts), or null.
   */
  update: (tracks: Track[], duck?: AutomationPoint[] | null) => void;
  /** Stopped at `bar`: every lane holds its value there. */
  hold: (bar: number) => void;
  /** The tempo or loop changed while playing: work out where the Transport is and carry on from there. */
  retime: () => void;
  dispose: () => void;
}

/**
 * Longest stretch written at once while a lane moves (seconds): the most a seek or an edit waits
 * to be heard. Short is cheap: one native call per param per stretch, and none along flat lines.
 */
const WINDOW = 0.05;
/** How far ahead of the clock lanes are written (seconds). */
const LEAD = 0.3;
/** A jump in a lane's value glides over this long, so it doesn't click. */
const JUMP_GLIDE = 0.004;
/** Stopped, a lane moves to its value at the playhead over this long (live; the export sets it at once). */
const HOLD_GLIDE = 0.02;

interface LaneTarget extends AutomationTarget {
  /** Lane value (0..1) to the param's value */
  native: (n: number) => number;
  /** The param moves in a straight line with the lane: two values per stretch do */
  linear: boolean;
}

interface LaneState {
  points: AutomationPoint[];
  /** The strip's automationVersion when targets were read */
  version: number;
  targets: LaneTarget[];
  /** Written up to here (audio time) while playing */
  until: number;
}

/** Where the Transport runs: bar `bar0` at time `t0`, along `tempo`, up to `endBar` (the loop's Out, when looping). */
interface Run {
  t0: number;
  bar0: number;
  tempo: Tempo;
  /** Seconds from bar 1 to bar0 along the tempo */
  s0: number;
  endBar: number;
  endTime: number;
}

const barAt = (r: Run, t: number) => secondsToBar(r.s0 + (t - r.t0), r.tempo);
const timeAt = (r: Run, bar: number) => r.t0 + barToSeconds(bar, r.tempo) - r.s0;

let reported = false;
/**
 * Run one lane's (or one event's) work, so that a bug in it can't escape into Tone's clock or a
 * store action: it is reported once, in the console, and the rest carries on.
 */
function guarded(work: () => void): void {
  try {
    work();
  } catch (err) {
    if (reported) return;
    reported = true;
    console.error('Automation:', err);
  }
}

/** Two param values differ by more than float rounding. */
const differs = (a: number, b: number) => Math.abs(a - b) > 1e-4 * Math.max(Math.abs(a), Math.abs(b), 1e-3);

export function createAutomationSchedule(
  transport: Transport,
  stripFor: (trackId: string) => TrackStrip | undefined,
  opts: { holdGlide?: number; tempo?: () => Tempo } = {}
): AutomationSchedule {
  const context = transport.context;
  const raw = context.rawContext as unknown as BaseAudioContext;
  const holdGlide = opts.holdGlide ?? HOLD_GLIDE;
  // Never write closer than this to the audio clock (0 in the export, so a lane starts with the render)
  const margin = clockMargin(raw);
  const lanes = new Map<string, LaneState>();
  let run: Run | null = null;
  let heldBar = 1;
  let ticking = false;
  /** The earliest `until` of any lane: before the clock gets near it, a tick has nothing to do. */
  let nextDue = Infinity;

  const runFrom = (time: number, bar: number): Run => {
    // The song's tempo map, or (without one) the Transport's tempo now, held steady
    const tempo = opts.tempo?.() ?? transport.bpm.getValueAtTime(time);
    let endBar = Infinity;
    if (transport.loop) {
      const loopEnd = ticksToBar(Math.round(transport.toTicks(transport.loopEnd)));
      // Started at or past the loop's end, the Transport wraps at once (and says so)
      endBar = bar < loopEnd ? loopEnd : bar;
    }
    const r = { t0: time, bar0: bar, tempo, s0: barToSeconds(bar, tempo), endBar, endTime: Infinity };
    r.endTime = timeAt(r, endBar);
    return r;
  };

  /** Write a lane ahead up to `horizon` (or the end of the run). The caller updates nextDue. */
  const plan = (lane: LaneState, horizon: number) => {
    const r = run;
    if (!r) return;
    const { points, targets } = lane;
    const sample = 1 / raw.sampleRate;
    while (lane.until < horizon && lane.until < r.endTime) {
      const t = Math.max(lane.until, raw.currentTime + margin);
      const bar = barAt(r, t);
      const piece = lanePieceFrom(points, bar, r.endBar);
      const value = piece.from;
      // Each stretch starts a sample after the last one ends, so on a moving lane the param trails
      // the lane by a sample or two there. That's no jump: allow for two samples of the lane's motion
      const seconds = timeAt(r, piece.endBar) - timeAt(r, bar);
      const drift = seconds > 0 ? Math.abs(piece.to - piece.from) * Math.min(1, (2 * sample) / seconds) : 0;
      const away = (tg: LaneTarget) => {
        const playing = tg.writer.valueAt(t);
        const target = tg.native(value);
        if (!differs(playing, target)) return false;
        const slack = Math.max(Math.abs(tg.native(Math.min(1, value + drift)) - target), Math.abs(tg.native(Math.max(0, value - drift)) - target));
        return Math.abs(playing - target) > slack * 1.01;
      };
      if (targets.some(away)) {
        // Not where the lane is (a seek, a wrap, an edit, a jump): glide there
        const to = Math.min(t + JUMP_GLIDE, r.endTime);
        const arrive = laneValueAt(points, barAt(r, to))!;
        let end = to;
        for (const tg of targets) end = Math.max(end, tg.writer.curve(new Float32Array([tg.writer.valueAt(t), tg.native(arrive)]), t, to - t));
        lane.until = end;
        continue;
      }
      if (piece.from === piece.to) {
        // Flat until the next point (or for good): nothing to write
        lane.until = Math.max(timeAt(r, piece.endBar), t + 1e-6);
        continue;
      }
      const endBar = Math.min(piece.endBar, barAt(r, t + WINDOW));
      const end = timeAt(r, endBar);
      if (end - t < 1e-6) {
        lane.until = t + 1e-6;
        continue;
      }
      const to = endBar === piece.endBar ? piece.to : laneValueAt(points, endBar)!;
      let written = end;
      if (piece.curved) {
        // A bent line: the lane sampled along it (every CURVE_STEP), each through the setting's own scale
        const count = Math.max(2, Math.ceil((end - t) / CURVE_STEP) + 1);
        const lane = new Float32Array(count);
        for (let k = 0; k < count; k++) lane[k] = k === count - 1 ? to : laneValueAt(points, bar + ((endBar - bar) * k) / (count - 1))!;
        for (const tg of targets) written = Math.max(written, tg.writer.curve(lane.map(tg.native), t, end - t));
      } else for (const tg of targets) written = Math.max(written, tg.writer.curve(sampleStretch(piece.from, to, end - t, tg.native, tg.linear), t, end - t));
      lane.until = written;
    }
  };

  /** Drop what a lane has written past `time` and write it again from there. */
  const replan = (lane: LaneState, time: number) => {
    // A node just made (a Filter switched on mid-song) takes the lane's value before it sounds
    const fresh = lane.targets.filter((tg) => tg.writer.fresh);
    if (fresh.length && run) {
      const value = laneValueAt(lane.points, barAt(run, Math.max(time, raw.currentTime)))!;
      fresh.forEach((tg) => tg.writer.jump(tg.native(value), 0));
    }
    lane.until = Math.max(...lane.targets.map((tg) => tg.writer.cut(time)));
    plan(lane, context.currentTime + LEAD);
  };

  /** Stopped: move a lane to its value at the playhead. */
  const holdLane = (lane: LaneState) => {
    const value = laneValueAt(lane.points, heldBar)!;
    for (const tg of lane.targets) {
      const target = tg.native(value);
      // A node just made (a Filter switched on) takes the value before it sounds
      if (tg.writer.fresh) {
        tg.writer.jump(target, 0);
        continue;
      }
      const at = tg.writer.cut(context.now());
      const from = tg.writer.valueAt(at);
      if (!differs(from, target)) continue;
      if (holdGlide > 0) tg.writer.curve(new Float32Array([from, target]), at, holdGlide);
      else tg.writer.jump(target, at);
    }
  };

  /** Write each lane up to `horizon`; one that fails is tried again at the next tick. */
  const planAll = (horizon: number) => {
    for (const lane of lanes.values()) {
      guarded(() => plan(lane, horizon));
      nextDue = Math.min(nextDue, lane.until);
    }
  };

  /** From `time`, write each lane again (see replan). */
  const replanAll = (time: number) => {
    for (const lane of lanes.values()) {
      guarded(() => replan(lane, time));
      nextDue = Math.min(nextDue, lane.until);
    }
  };

  const onTick = () => {
    if (!run) return;
    const horizon = context.currentTime + LEAD;
    if (horizon < nextDue) return;
    nextDue = Infinity;
    planAll(horizon);
  };

  /** The clock tick is listened to only while playing with a lane to play. */
  const listen = () => {
    const want = run !== null && lanes.size > 0;
    if (want === ticking) return;
    ticking = want;
    if (want) context.on('tick', onTick);
    else context.off('tick', onTick);
  };

  const onStart = (time: number) => {
    guarded(() => {
      run = runFrom(time, ticksToBar(transport.getTicksAtTime(time)));
      nextDue = Infinity;
      replanAll(time);
    });
    listen();
  };

  // A seek while playing stops and restarts the Transport at the same moment
  const onStop = (time: number) => {
    if (!run) return; // already held at the playhead
    run = null;
    for (const lane of lanes.values()) guarded(() => lane.targets.forEach((tg) => tg.writer.cut(time)));
    listen();
  };

  const onLoop = (time: number) => {
    if (!run) return;
    guarded(() => {
      run = runFrom(time, ticksToBar(transport.getTicksAtTime(time)));
      nextDue = Infinity;
      replanAll(time);
    });
  };

  transport.on('start', onStart);
  transport.on('stop', onStop);
  transport.on('pause', onStop);
  transport.on('loop', onLoop);

  const readTargets = (strip: TrackStrip, param: AutomationParam): LaneTarget[] | null => {
    const targets = strip.automationTargets(param);
    if (!targets?.length) return null;
    const { toReal } = specOf(param);
    return targets.map((tg) => {
      const native = (n: number) => tg.map(toReal(n));
      return { ...tg, native, linear: isLinearMap(native) };
    });
  };

  return {
    update: (tracks, duck = null) => {
      const seen = new Set<string>();
      for (const track of tracks) {
        if (!track.automation?.length) continue;
        const strip = stripFor(track.id);
        if (!strip) continue;
        const version = strip.automationVersion();
        for (const { param, points } of track.automation) {
          if (points.length === 0) continue;
          const key = `${track.id}|${param}`;
          let lane = lanes.get(key);
          if (lane && lane.points === points && lane.version === version) {
            seen.add(key);
            continue;
          }
          const targets = lane && lane.version === version ? lane.targets : readTargets(strip, param);
          // A lane that can't sound now (its Filter is off) is left out until it can
          if (!targets) continue;
          seen.add(key);
          if (lane) Object.assign(lane, { points, version, targets });
          else lanes.set(key, (lane = { points, version, targets, until: -Infinity }));
          const changed = lane;
          if (run) {
            guarded(() => replan(changed, context.now()));
            nextDue = Math.min(nextDue, changed.until);
          } else {
            guarded(() => holdLane(changed));
          }
        }
      }
      // Ducking: one gain curve on every track except the proxies, written like a lane
      if (duck?.length) {
        for (const track of tracks) {
          // (Not a bus either: the tracks playing into it dip already)
          if (track.duckProxy || isMixTrack(track)) continue;
          const strip = stripFor(track.id);
          if (!strip) continue;
          const key = `${track.id}|duck`;
          seen.add(key);
          let lane = lanes.get(key);
          if (lane && lane.points === duck) continue;
          const tg = strip.duckTarget();
          const targets: LaneTarget[] = [{ ...tg, native: (n: number) => n, linear: true }];
          if (lane) Object.assign(lane, { points: duck, targets });
          else lanes.set(key, (lane = { points: duck, version: -1, targets, until: -Infinity }));
          const changed = lane;
          if (run) {
            guarded(() => replan(changed, context.now()));
            nextDue = Math.min(nextDue, changed.until);
          } else {
            guarded(() => holdLane(changed));
          }
        }
      }
      // A lane that's gone (or emptied) stops here; the strip puts the track's own setting back
      // (a duck lane's gain goes back to full level here)
      for (const [key, lane] of lanes) {
        if (seen.has(key)) continue;
        if (key.endsWith('|duck')) guarded(() => lane.targets.forEach((tg) => tg.writer.set(1, 0.03)));
        lanes.delete(key);
      }
      listen();
    },
    hold: (bar) => {
      heldBar = bar;
      // The store stops before the Transport says so: from now the playhead decides
      run = null;
      listen();
      for (const lane of lanes.values()) guarded(() => holdLane(lane));
    },
    retime: () => {
      if (!run) return;
      // After Tone's 50 ms tempo ramp, so the Transport's position there is settled
      const at = context.now() + 0.06;
      guarded(() => {
        run = runFrom(at, ticksToBar(transport.getTicksAtTime(at)));
        nextDue = Infinity;
        replanAll(at);
      });
    },
    dispose: () => {
      transport.off('start', onStart);
      transport.off('stop', onStop);
      transport.off('pause', onStop);
      transport.off('loop', onLoop);
      run = null;
      listen();
      lanes.clear();
    },
  };
}
