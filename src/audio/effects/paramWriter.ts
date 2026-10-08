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
 * back to the value it had before that curve began (a click). Chrome's cancelAndHoldAtTime() is no
 * way out: it restarts the cut curve from its first value. So a new plan starts once the piece
 * running at that moment has finished, which is why the automation scheduler keeps pieces short.
 *
 * Nothing here ever throws: writes happen inside Tone's clock callbacks and the store's actions,
 * where an exception would stop notes or an edit. The one refusal to expect is Chrome's: a piece
 * whose start has already passed when the audio thread gets it (the page stalled under load) is
 * moved to that moment, keeping its length, so it ends later than written, and the next piece
 * would overlap it ("setValueCurveAtTime overlaps"). A refused write is retried after the latest
 * any moved piece can end; the param holds its value for that moment.
 */
export interface ParamWriter {
  /** The value written for time `t` (what the param holds then, as far as this writer knows). */
  valueAt: (t: number) => number;
  /** True until something has been written: a param of a node just made, which can be set outright. */
  readonly fresh: boolean;
  /**
   * Drop the pieces that start after `t`. Returns the first moment a new piece can start: `t`, or
   * later if a piece is running then (or `t` is too close to the audio clock).
   */
  cut: (t: number) => number;
  /** A curve from `start` (moved later if a piece is still running then). Returns when it ends. */
  curve: (values: Float32Array, start: number, duration: number) => number;
  /**
   * Jump to `value` at `at` (or later, as for curve). Returns when it happens. On a fresh param,
   * `at` 0 means at once.
   */
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
/** Live, a write never starts closer than this to the audio clock (seconds). */
const LIVE_CLOCK_MARGIN = 0.02;

/**
 * How close to the audio clock a change can be written. Live, the audio thread renders a little
 * ahead of the time the page reads; the WAV export's render waits while the page writes, so there
 * the clock's own time is fine (and a lane starts exactly with the render).
 */
export function clockMargin(raw: BaseAudioContext): number {
  return typeof OfflineAudioContext !== 'undefined' && raw instanceof OfflineAudioContext ? 0 : LIVE_CLOCK_MARGIN;
}

let reported = false;
/** A write refused twice is dropped: say so once (in the console), never to the caller. */
function report(err: unknown): void {
  if (reported) return;
  reported = true;
  console.warn('Automation: a parameter change was refused and skipped', err);
}

/**
 * `raw`: the param's audio context. `now`: when an ordinary change takes effect (the Tone context's
 * now(): live, the audio clock plus Tone's look-ahead, the same moment Tone's own params and the
 * Transport act on). `initial`: the param's value before anything is written.
 */
export function createParamWriter(param: AudioParam, opts: { raw: BaseAudioContext; now: () => number; initial: number }): ParamWriter {
  const { raw } = opts;
  const gap = 1 / raw.sampleRate;
  const margin = clockMargin(raw);
  let pieces: Piece[] = [];
  /** The value before the first remembered piece. */
  let before = opts.initial;
  let fresh = true;
  /** After a refused write: nothing starts before this (where a piece Chrome moved may still run). */
  let barrier = -Infinity;

  const free = () => Math.max(barrier, pieces.length ? pieces[pieces.length - 1].end + gap : -Infinity);
  /** Where a piece asked for at `at` can start: after the last one, and not too close to the clock. */
  const place = (at: number) => Math.max(at, free(), raw.currentTime + margin);

  /**
   * A write was refused, so a piece has been moved later than written. A moved piece starts at
   * most where the audio thread is now (a render quantum or two past the time the page reads), so
   * new pieces wait until each remembered piece would have ended from there.
   */
  const recover = () => {
    const latest = raw.currentTime + 256 / raw.sampleRate;
    for (const p of pieces) if (p.start < latest) barrier = Math.max(barrier, latest + (p.end - p.start) + gap);
  };

  /** Make a native call at `at`; if it's refused, once more where it surely fits. Returns where it went, or null. */
  const write = (at: number, call: (t: number) => void): number | null => {
    try {
      call(at);
      return at;
    } catch {
      recover();
    }
    const retry = place(at);
    try {
      call(retry);
      return retry;
    } catch (err) {
      report(err);
      return null;
    }
  };

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
    // What has started (or is about to) plays on
    const from = Math.max(t, raw.currentTime + margin);
    forget(from);
    let keep = pieces.length;
    while (keep > 0 && pieces[keep - 1].start > from) keep--;
    if (keep < pieces.length) {
      // Cancel in the gap after the piece that stays, so it plays out whole
      const kept = keep > 0 ? pieces[keep - 1].end : -Infinity;
      try {
        param.cancelScheduledValues((Math.max(from, kept) + pieces[keep].start) / 2);
      } catch (err) {
        report(err);
      }
      pieces.length = keep;
    }
    return place(from);
  };

  const jump = (value: number, at: number) => {
    // A param of a node just made has nothing written to overlap: at 0 (in the past) it takes the value at once
    const asked = fresh && at <= 0 ? 0 : place(at);
    const start = write(asked, (t) => param.setValueAtTime(value, t));
    if (start === null) return asked;
    pieces.push({ start, end: start, values: [value] });
    fresh = false;
    return start;
  };

  const curve = (values: Float32Array, start: number, duration: number) => {
    if (values.length < 2 || duration <= 0) return jump(values[values.length - 1], start);
    const asked = place(start);
    const from = write(asked, (t) => param.setValueCurveAtTime(values, t, duration));
    if (from === null) return asked + duration;
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
      // A node just made: set it before it makes a sound
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
