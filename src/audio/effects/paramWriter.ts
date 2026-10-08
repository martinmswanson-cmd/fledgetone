/**
 * Every change to one native AudioParam, written so that no change ever cuts another off midway.
 *
 * A track setting that automation can drive (pan, a send, the Filter's cutoff...) is written by
 * two parties: the track strip when the user moves its control, and the automation scheduler while
 * a lane owns it. Both go through one of these, so neither fights the other.
 *
 * Each change is a "piece": a jump (setValueAtTime) or a curve (setValueCurveAtTime; two values
 * make a straight ramp). Pieces are written in time order with a one-sample gap between them, and
 * a change of plan only drops pieces that haven't started yet, never one that is running:
 * cancelScheduledValues() inside a running curve throws the whole curve away, and the param snaps
 * back to the value it had before that curve began (a click). So a new plan starts once the piece
 * running at that moment has finished (pieces are short: at most a quarter of a second).
 */
export interface ParamWriter {
  /** The value written for time `t` (what the param holds then, as far as this writer knows). */
  valueAt: (t: number) => number;
  /** True until something has been written: a param of a node just made, which can be set outright. */
  readonly fresh: boolean;
  /**
   * Drop the pieces that start after `t`. Returns the first moment a new piece can start: `t`, or
   * later if a piece is running then.
   */
  cut: (t: number) => number;
  /** A curve from `start` (moved later if a piece is still running then). Returns when it ends. */
  curve: (values: Float32Array, start: number, duration: number) => number;
  /** Jump to `value` at `at` (or later, as for curve). Returns when it happens. */
  jump: (value: number, at: number) => number;
  /**
   * An ordinary change (a slider, a menu): drop what hasn't started and glide to `value` over
   * `ramp` seconds (0 = jump). A fresh param takes the value at once.
   */
  set: (value: number, ramp: number) => void;
}

/** A native param a lane drives, and how a value of the setting (dB, Hz, a pan...) becomes the param's value. */
export interface AutomationTarget {
  writer: ParamWriter;
  map: (real: number) => number;
}

interface Piece {
  start: number;
  end: number;
  values: ArrayLike<number>;
}

/** Pieces that ended this long before the latest write are forgotten (their last value is kept). */
const FORGET_AFTER = 1;

/**
 * `now`: when an ordinary change takes effect (the Tone context's now(): live, the audio clock
 * plus Tone's look-ahead, the same moment Tone's own params and the Transport act on).
 * `initial`: the param's value before anything is written.
 */
export function createParamWriter(param: AudioParam, opts: { now: () => number; sampleRate: number; initial: number }): ParamWriter {
  const gap = 1 / opts.sampleRate;
  let pieces: Piece[] = [];
  /** The value before the first remembered piece. */
  let before = opts.initial;
  let fresh = true;

  const free = () => (pieces.length ? pieces[pieces.length - 1].end + gap : -Infinity);

  const valueAt = (t: number) => {
    let i = pieces.length - 1;
    while (i >= 0 && pieces[i].start > t) i--;
    if (i < 0) return before;
    const { start, end, values } = pieces[i];
    const n = values.length;
    if (n === 1 || t >= end) return values[n - 1];
    // setValueCurveAtTime spreads the values evenly over the duration and draws straight lines between them
    const pos = ((t - start) / (end - start)) * (n - 1);
    const k = Math.floor(pos);
    return values[k] + (values[k + 1] - values[k]) * (pos - k);
  };

  const forget = (t: number) => {
    let drop = 0;
    while (drop < pieces.length - 1 && pieces[drop + 1].start < t - FORGET_AFTER) drop++;
    if (!drop) return;
    const last = pieces[drop - 1].values;
    before = last[last.length - 1];
    pieces = pieces.slice(drop);
  };

  const cut = (t: number) => {
    forget(t);
    let keep = pieces.length;
    while (keep > 0 && pieces[keep - 1].start > t) keep--;
    if (keep < pieces.length) {
      // Cancel in the gap after the piece that stays, so it plays out whole
      const kept = keep > 0 ? pieces[keep - 1].end : -Infinity;
      param.cancelScheduledValues((Math.max(t, kept) + pieces[keep].start) / 2);
      pieces.length = keep;
    }
    return Math.max(t, free());
  };

  const jump = (value: number, at: number) => {
    const start = Math.max(at, free());
    param.setValueAtTime(value, start);
    pieces.push({ start, end: start, values: [value] });
    fresh = false;
    return start;
  };

  const curve = (values: Float32Array, start: number, duration: number) => {
    if (values.length < 2 || duration <= 0) return jump(values[values.length - 1], start);
    const from = Math.max(start, free());
    param.setValueCurveAtTime(values, from, duration);
    pieces.push({ start: from, end: from + duration, values });
    fresh = false;
    return from + duration;
  };

  return {
    valueAt,
    get fresh() {
      return fresh;
    },
    cut,
    curve,
    jump,
    set: (value, ramp) => {
      // A node just made: set it before it makes a sound (time 0 is in the past, so at once)
      if (fresh) {
        jump(value, 0);
        return;
      }
      const at = cut(opts.now());
      const from = valueAt(at);
      if (Math.abs(from - value) <= 1e-6 * Math.max(1, Math.abs(value))) return;
      if (ramp > 0) curve(new Float32Array([from, value]), at, ramp);
      else jump(value, at);
    },
  };
}
