/**
 * Moving a parameter that is sounding without a click: every control the user turns while the music
 * plays (a mix, a drive, a band of the EQ, a mute, a solo) goes to its new value through smoothSet,
 * a short glide that starts from wherever the param is at that moment.
 *
 * Why not the obvious ways. Setting `.value`, or setValueAtTime, jumps: a step in a gain or a
 * filter's frequency is heard as a click, and a knob dragged through many small steps as a buzz
 * ("zipper noise"). cancelScheduledValues() before a new ramp is no better: it throws away a ramp
 * still under way, and the param snaps back to where that ramp began before the new one starts.
 * cancelAndHoldAtTime() keeps the value the ramp has reached, and setTargetAtTime() glides on from
 * there; a new call halfway through a glide holds it where it is and turns towards the new value.
 *
 * Automation lanes don't come through here: they are written ahead of the clock by ParamWriter
 * (paramWriter.ts), which never cuts a piece that is playing.
 */

/** What smoothSet needs of a param: a native AudioParam or a Tone.Param (which keeps its own timeline in step). */
export interface SmoothableParam {
  readonly value: number;
  cancelScheduledValues(time: number): unknown;
  setValueAtTime(value: number, time: number): unknown;
  setTargetAtTime(value: number, time: number, timeConstant: number): unknown;
  cancelAndHoldAtTime?(time: number): unknown;
}

/**
 * The time constant of an ordinary glide (seconds): 95% of the way in 30 ms. Short enough to feel
 * instant on a control, long enough that a full-scale step has no click in it.
 */
export const SMOOTH_TC = 0.01;

/**
 * Glide `param` to `value` from `time` with time constant `tc` (0: jump, for a node that isn't
 * sounding yet), starting from the value it has then, whatever was under way. Never throws: a
 * refused change is skipped (these run inside the store's actions and Tone's clock).
 */
export function smoothSet(param: SmoothableParam, value: number, time: number, tc = SMOOTH_TC): void {
  if (!Number.isFinite(value)) return;
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(time);
    else {
      // Firefox has no cancelAndHoldAtTime: its .value is what the param rendered last, close enough
      const now = param.value;
      param.cancelScheduledValues(time);
      param.setValueAtTime(now, time);
    }
    if (tc > 0) param.setTargetAtTime(value, time, tc);
    else param.setValueAtTime(value, time);
  } catch {
    // A time already past or a value out of range: leave the param as it is
  }
}

/**
 * smoothSet for an effect's settings, with the shape the effects call it with: `ramp` is about how
 * long the glide takes (seconds; 0 sets the value at once), and it acts at `timeOf()` (the audio
 * clock, or the moment an automation control applies it for).
 */
export function paramSetter(timeOf: () => number): (param: AudioParam, value: number, ramp: number) => void {
  return (param, value, ramp) => smoothSet(param, value, timeOf(), ramp > 0 ? ramp / 3 : 0);
}

/**
 * Fade `param` to 0 from `time` (time constant `tc`), from the level it has reached then: a fade in
 * or out still under way is held where it is, not dropped (cancelScheduledValues() alone would leave
 * the param at the last value set before `time`: full level in a fade-out, silence in a fade-in).
 * Where the browser has no cancelAndHoldAtTime, what was scheduled from `time` is dropped.
 */
export function fadeOutFrom(param: SmoothableParam, time: number, tc: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(time);
  else param.cancelScheduledValues(time);
  param.setTargetAtTime(0, time, tc);
}
