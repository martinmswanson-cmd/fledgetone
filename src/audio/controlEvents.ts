/**
 * A plugin parameter's automation as timed events: the value a lane's writer holds, read on a
 * fixed grid of the audio clock (every CONTROL_GRID samples, Fledge Synth's own control rate) and
 * sent ahead as the plugin's timed parameter events, one where the value has moved. Live and in an
 * export the same lane gives the same events (to within a grid step of where the song started on
 * the clock), so a step lane's changes land on the sample, smoothed as its points say, whichever
 * way it plays. Pure, so Node can test it (scripts/stepLanes.test.mjs).
 */

/** The grid the events sit on, in samples. */
export const CONTROL_GRID = 16;
/** A move smaller than this (of the 0..1 range) waits for more, unless the value has settled there. */
const STEP = 1e-3;

/** How far one parameter's events have been sent. */
export interface ControlRun {
  /** The next grid frame to read (frames of the audio clock) */
  frame: number;
  /** The value sent last (null: none yet) */
  last: number | null;
}

export const controlRun = (): ControlRun => ({ frame: -Infinity, last: null });

/**
 * The events from where `run` got to (or `now`, if that's later: frames gone by are skipped) up to
 * `until` (seconds), reading `valueAt` on the grid. Moves `run` on. `send` is given each
 * event's time and value; when it says the plugin isn't there (false), nothing is taken as sent.
 */
export function planControlEvents(
  run: ControlRun,
  valueAt: (t: number) => number,
  now: number,
  until: number,
  sampleRate: number,
  send: (time: number, value: number) => boolean
): void {
  const grid = CONTROL_GRID;
  const nowFrame = Math.ceil((now * sampleRate) / grid - 1e-9) * grid + 0;
  let frame = Math.max(run.frame, nowFrame);
  const end = Math.floor((until * sampleRate) / grid + 1e-9) * grid;
  let last = run.last;
  for (; frame <= end; frame += grid) {
    const t = frame / sampleRate;
    const v = valueAt(t);
    if (last !== null) {
      const moved = Math.abs(v - last);
      if (moved <= 1e-7) continue;
      // A small move goes once the value stops there (the end of a ramp), or once it adds up
      if (moved < STEP && Math.abs(valueAt((frame + grid) / sampleRate) - v) > 1e-7) continue;
    }
    if (!send(t, v)) break;
    last = v;
  }
  run.frame = frame;
  run.last = last;
}
