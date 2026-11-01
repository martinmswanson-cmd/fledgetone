/**
 * The song's bends on an instrument that bends as a whole, given to it as they come due while
 * playing (the scheduler's, live; an export sends each as it always did). See createBendWindow.
 */
import { FEED_AHEAD, FEED_EVERY } from './bendFeed';
import type { NoteStepper } from '../store/noteExpression';

/** A note's bend steps by audio time ([time, cents], in time order), worked out as far as they're needed. */
export interface BendCurve {
  /** The steps worked out so far */
  readonly pts: ReadonlyArray<readonly [time: number, cents: number]>;
  /** Work out every step up to `time` (and the first, at least) */
  reach: (time: number) => void;
  /** The time of its last step once every one is worked out (-Infinity: none), else undefined */
  last: () => number | undefined;
}

/** A curve whose every step is known. */
export function fixedCurve(pts: Array<[number, number]>): BendCurve {
  return { pts, reach: () => undefined, last: () => (pts.length ? pts[pts.length - 1][0] : -Infinity) };
}

/**
 * A note's curve from `stepper` (bars into the note), the note starting at `start` with `spb`
 * seconds a bar: each step at `start + at * spb`, as the note's steps worked out at once have it.
 */
export function steppedCurve(stepper: NoteStepper, start: number, spb: number): BendCurve {
  const pts: Array<[number, number]> = [];
  const take = () => {
    for (let i = pts.length; i < stepper.steps.length; i++) pts.push([start + stepper.steps[i].at * spb, stepper.steps[i].cents]);
  };
  return {
    pts,
    reach: (time) => {
      // (a hair past: every step at or before `time` is worked out, whatever the rounding)
      stepper.upTo(time === Infinity ? Infinity : Math.max(0, (time - start) / spb) + 1e-6);
      take();
    },
    last: () => {
      if (!stepper.done) return undefined;
      take();
      return pts.length ? pts[pts.length - 1][0] : -Infinity;
    },
  };
}

/** The index of the last step of `c` at or before `time` (-1: none), every step up to it worked out. */
const lastStepAt = (c: BendCurve, time: number) => {
  c.reach(time);
  const pts = c.pts;
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
};

/** The index of the first step of `c` after `time` (its count: none), every step up to it worked out. */
export const stepAfter = (c: BendCurve, time: number): number => lastStepAt(c, time) + 1;

/** The bend of `c` at `time`: its last step at or before it, its first before any (0: none). */
export function curveAt(c: BendCurve, time: number): number {
  const i = lastStepAt(c, time);
  return i >= 0 ? c.pts[i][1] : (c.pts[0]?.[1] ?? 0);
}
/** One bend sent (its value worked out when it's given, for a curve's step far ahead). */
interface Point {
  time: number;
  order: number;
  value: number | (() => number);
  cut: boolean;
  /** When it was sent (see bendStamp) */
  sent: number;
}
/** A note's own steps, sent all at once: the note begun at `start`, sounding to `end`. */
interface Stream {
  order: number;
  curve: BendCurve;
  start: number;
  end: number;
  /** From here on its steps were dropped (a cut sent after it) */
  dropFrom: number;
  sent: number;
}
/**
 * A bend sent again at each step strictly between `from` and `to` of every note sounding at `from`
 * (begun by then, ending after it) and sent before it, and at each song's bend after the release
 * of a note begun by `from` (see Back) strictly between `backLo` and `backTo`: `value` there (a
 * later note's bend taking over from the ones it sounds over; or the song's, where one is let go).
 * Not over `not`'s own.
 */
interface Layer {
  order: number;
  value: (time: number) => number;
  not: BendCurve | undefined;
  from: number;
  to: number;
  backLo: number;
  backTo: number;
  dropFrom: number;
  sent: number;
}
/**
 * Where a note (`curve`'s, begun at `start`) sent the song's bend after its release: a later
 * note's bend is sent again there (see Layer), by the ones sent while it's still where it is
 * (before `valid`).
 */
interface Back {
  time: number;
  curve: BendCurve;
  start: number;
  end: number;
  /** The note's order (see Stream) */
  order: number;
  valid: number;
}
interface Due {
  time: number;
  order: number;
  value: () => number;
  cut: boolean;
  /** A later note's bend sent again over an earlier one's step (see Layer): left out where it changes nothing */
  again: boolean;
  sent: number;
}

let stamps = 0;
/**
 * A count that goes up with every bend sent: when a bend given to an instrument later was sent
 * (the player's wheel moved since, a note's later steps don't take it over, see liveTracks.ts).
 */
export const bendStamp = (): number => ++stamps;

export interface BendWindow {
  /**
   * A bend from `time` (cents, or a curve's worked out when it's due). `cut`: the bends sent before
   * for `time` and after are dropped first. `now`: given at once where the instrument has its
   * bends, also in a batch (a note's bend at its start: the note starts on it).
   */
  send: (value: number | (() => number), time: number, cut?: boolean, now?: boolean) => void;
  /** Every step of a note's curve (the note begun at `start`, sounding to `end`), as sent one by one at once. */
  steps: (curve: BendCurve, start: number, end: number) => void;
  /**
   * At each step strictly between `from` and `to` of every note sounding at `from` sent before,
   * and at each song's bend after the release of a note begun by `from` strictly between `from`
   * and `backTo` (see back), the bend `over` has there (a later note taking over).
   */
  over: (over: BendCurve, from: number, to: number, backTo?: number) => void;
  /**
   * At each song's bend after the release of a note (but `not`'s) begun by `begun`, sent while it's
   * still there, strictly between `lo` and `hi`: `value` there (worked out when it's given).
   */
  overBacks: (value: (time: number) => number, begun: number, lo: number, hi: number, not?: BendCurve) => void;
  /** The note of `curve` (begun at `start`, ending at `end`) sent the song's bend after its release for `time` (undefined: it has none now). */
  back: (curve: BendCurve, start: number, end: number, time: number | undefined) => void;
  /** The notes begun before `time` and ended by it have no song's bend after their release now (see back). */
  unbackEnded: (time: number) => void;
  /** The note of `curve` ends at `end` (sooner than it was sent with: its instrument's next note after a jump). */
  endAt: (curve: BendCurve, end: number) => void;
  /** The note of `curve` is forgotten (after a jump, one begun past it): no later note sends its bend again over its steps. */
  forget: (curve: BendCurve) => void;
  /**
   * Send what `fn` sends (no cut among it) as one: the bends it changes up to where the
   * instrument has been given them go to it at once, the one now in force at each of their times.
   * `again`: it sends bends again over earlier notes' steps (see `over`). One sent inside
   * another is part of it.
   */
  batch: (from: number, fn: () => void, again?: boolean) => void;
  /** Give the instrument the bends due up to FEED_AHEAD from now (see GIVE_RATE). */
  feed: () => void;
  /** Whether it still has bends for now or later. */
  alive: () => boolean;
}

/**
 * Seconds ahead the instrument has its bends at least while as many may be given as there are
 * (see GIVE_RATE): the timer gives it them FEED_AHEAD ahead.
 */
export const FEED_START = 2 * FEED_EVERY;
/** Seconds ahead it has them at least once more than that have been given (a little past the scheduler's look-ahead). */
export const FEED_LEAST = 0.15;
/**
 * Bends given at most a second, over FEED_START ahead, and at most this many at once
 * (GIVE_BURST): each given costs the more the more the instrument has, so a crafted song of
 * thousands of bent notes over each other gives them only as far ahead as that allows. A song's
 * own (a few notes sliding at once) are always given the whole FEED_AHEAD, so a stall shorter
 * than FEED_AHEAD - FEED_EVERY isn't heard.
 */
export const GIVE_RATE = 8000;
export const GIVE_BURST = 8000;

/** How many may be given now (see GIVE_RATE), by `clock`: `take` counts those given. */
export function createAllowance(clock: { readonly currentTime: number }) {
  let left = GIVE_BURST;
  let at = -Infinity;
  return {
    left: () => {
      const now = clock.currentTime;
      if (now > at) left = Math.min(GIVE_BURST, left + (at === -Infinity ? GIVE_BURST : (now - at) * GIVE_RATE));
      at = Math.max(at, now);
      return left;
    },
    take: (n: number) => {
      left = Math.max(-GIVE_BURST, left - n);
    },
  };
}

/**
 * The bends sent to an instrument that bends as a whole, kept as sent (a note's whole curve, the
 * later notes' bends sent again over the steps of the ones they sound over, each later sent for a
 * time winning at it, cuts dropping those sent before for their time and after), given to `give`
 * at most FEED_AHEAD ahead in time order as `feed` is called: the one in force at each time, the
 * ones sent again that change nothing left out. A long note's curve is worked out only as far as
 * it's given: so the work is what plays meanwhile, not how many long notes sound over each other.
 * The instrument has the same bend at every time as when every one was sent to it at once.
 * `give` is told when each was sent (see bendStamp).
 */
export function createBendWindow(clock: { readonly currentTime: number }, give: (cents: number, time: number, cut: boolean, sent: number) => void): BendWindow {
  let order = 0;
  /** The bends up to here have been given */
  let fedTo = -Infinity;
  /** The instrument's bend at fedTo, as given (undefined: not known) */
  let tail: number | undefined;
  /** By time, one a time (the one sent last for it, see addPoint) */
  let points: Point[] = [];
  let streams: Stream[] = [];
  /** In the order sent */
  let layers: Layer[] = [];
  /** By time */
  let backs: Back[] = [];
  /** Each note's own steps, and where its song's bend after its release is now */
  const streamOf = new Map<BendCurve, Stream>();
  const backOf = new Map<BendCurve, Back>();
  /** Each note's order (see Stream), long after its steps have played */
  const orderOf = new WeakMap<BendCurve, number>();
  let layersSent = 0;
  let batching = false;
  let batchFrom = Infinity;
  let batchAgain = false;
  /** A bend given at once in this batch (see send) */
  let givenInBatch = false;
  let lastGiven: [number, number] = [NaN, NaN];
  const allowance = createAllowance(clock);
  /** How far ahead the instrument has its bends at least (see FEED_LEAST): FEED_START while as many may be given as a song's own take */
  const least = () => clock.currentTime + (allowance.left() >= GIVE_RATE * FEED_START ? FEED_START : FEED_LEAST);

  /** The first point at or after `time` (`after`: after it) */
  const pointFrom = (time: number, after: boolean) => {
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (after ? points[mid].time <= time : points[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** Sent for a time one was sent for already: in its place (the later one wins there, a cut still a cut) */
  const addPoint = (p: Point) => {
    const at = pointFrom(p.time, true);
    if (at > 0 && points[at - 1].time === p.time) {
      p.cut = p.cut || points[at - 1].cut;
      points[at - 1] = p;
    } else if (at === points.length) points.push(p);
    else points.splice(at, 0, p);
  };
  const pointDue = (p: Point): Due => {
    const v = p.value;
    return { time: p.time, order: p.order, value: typeof v === 'function' ? v : () => v, cut: p.cut, again: false, sent: p.sent };
  };
  /** The first of backs at or after `time` (`after`: after it) */
  const backFrom = (time: number, after: boolean) => {
    let lo = 0;
    let hi = backs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (after ? backs[mid].time <= time : backs[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** The latest of `cands` that sends its bend again at `b` (undefined: none). */
  const backHolder = (b: Back, cands: Layer[]): Layer | undefined => {
    for (let j = cands.length - 1; j >= 0; j--) {
      const l = cands[j];
      if (l.order <= b.order) break;
      if (l.order < b.valid && b.time > l.backLo && b.time < l.backTo && b.time < l.dropFrom && l.not !== b.curve && b.start <= l.from) return l;
    }
    return undefined;
  };
  const backDue = (b: Back, l: Layer): Due => ({ time: b.time, order: l.order, value: () => l.value(b.time), cut: false, again: true, sent: l.sent });
  /**
   * What has the step of `s` at `t` in force: the latest of `cands` sent after it that takes it
   * over, else its own (null) unless it was dropped (undefined).
   */
  const holder = (s: Stream, t: number, cands: Layer[]): Layer | null | undefined => {
    for (let j = cands.length - 1; j >= 0; j--) {
      const l = cands[j];
      if (l.order <= s.order) break;
      if (t > l.from && t < l.to && t < l.dropFrom && l.not !== s.curve && s.start <= l.from && s.end > l.from) return l;
    }
    return t < s.dropFrom ? null : undefined;
  };
  const stepDue = (s: Stream, i: number, l: Layer | null): Due => {
    const [t, cents] = s.curve.pts[i];
    return l ? { time: t, order: l.order, value: () => l.value(t), cut: false, again: true, sent: l.sent } : { time: t, order: s.order, value: () => cents, cut: false, again: false, sent: s.sent };
  };

  /** The bend in force for each time some bend was sent for, from `lo` (itself too unless `loOpen`) to `hi`, in time order. */
  const inForce = (lo: number, loOpen: boolean, hi: number): Due[] => {
    // (By time, the one sent last: each made into a Due only once it's known to be in force)
    const best = new Map<number, { order: number; cut: boolean; p?: Point; s?: Stream; bk?: Back; l?: Layer | null; i: number }>();
    for (let i = pointFrom(lo, loOpen); i < points.length && points[i].time <= hi; i++) best.set(points[i].time, { order: points[i].order, cut: points[i].cut, p: points[i], i });
    const cands = layers;
    for (const s of streams) {
      // (its steps are all from its start to its end)
      if (s.start > hi || s.end < lo) continue;
      const last = s.curve.last();
      if (last !== undefined && last < lo) continue;
      let i = lastStepAt(s.curve, lo);
      const pts = s.curve.pts;
      if (i < 0) i = 0;
      else if (loOpen || pts[i][0] < lo) i++;
      s.curve.reach(hi);
      for (; i < pts.length && pts[i][0] <= hi; i++) {
        const t = pts[i][0];
        const l = holder(s, t, cands);
        if (l === undefined) continue;
        const ord = l ? l.order : s.order;
        const had = best.get(t);
        if (!had) best.set(t, { order: ord, cut: false, s, l, i });
        else if (ord > had.order) best.set(t, { order: ord, cut: had.cut, s, l, i });
      }
    }
    for (let i = backFrom(lo, loOpen); i < backs.length && backs[i].time <= hi; i++) {
      const bk = backs[i];
      const l = backHolder(bk, cands);
      if (!l) continue;
      const had = best.get(bk.time);
      if (!had) best.set(bk.time, { order: l.order, cut: false, bk, l, i });
      else if (l.order > had.order) best.set(bk.time, { order: l.order, cut: had.cut, bk, l, i });
    }
    const times = [...best.keys()].sort((a, b) => a - b);
    return times.map((t) => {
      const b = best.get(t)!;
      const d = b.p ? pointDue(b.p) : b.bk ? backDue(b.bk, b.l!) : stepDue(b.s!, b.i, b.l!);
      d.cut = b.cut;
      return d;
    });
  };

  /** The bend in force for the first time after `time` some bend was sent for, up to fedTo (undefined: none). */
  const firstAfter = (time: number): Due | undefined => {
    let first = Infinity;
    const at = pointFrom(time, true);
    if (at < points.length) first = points[at].time;
    const cands = layers;
    for (const s of streams) {
      if (s.start > Math.min(fedTo, first) || s.end <= time) continue;
      const pts = s.curve.pts;
      let i = lastStepAt(s.curve, time) + 1;
      s.curve.reach(Math.min(fedTo, first));
      for (; i < pts.length && pts[i][0] <= Math.min(fedTo, first); i++) {
        if (holder(s, pts[i][0], cands) === undefined) continue;
        first = pts[i][0];
        break;
      }
    }
    for (let i = backFrom(time, true); i < backs.length && backs[i].time < first && backs[i].time <= fedTo; i++) {
      if (!backHolder(backs[i], cands)) continue;
      first = backs[i].time;
      break;
    }
    return first <= fedTo ? inForce(first, false, first)[0] : undefined;
  };

  /** The bend in force for the last time before `time` some bend was sent for (undefined: none). */
  const lastBefore = (time: number): Due | undefined => {
    let last = -Infinity;
    const at = pointFrom(time, false) - 1;
    if (at >= 0) last = points[at].time;
    for (const s of streams) {
      if (s.start >= time) continue;
      const pts = s.curve.pts;
      let i = lastStepAt(s.curve, time);
      if (i >= 0 && pts[i][0] >= time) i--;
      for (; i >= 0 && pts[i][0] > last; i--) {
        if (holder(s, pts[i][0], layers) === undefined) continue;
        last = pts[i][0];
        break;
      }
    }
    for (let i = backFrom(time, false) - 1; i >= 0 && backs[i].time > last; i--) {
      if (!backHolder(backs[i], layers)) continue;
      last = backs[i].time;
      break;
    }
    return last > -Infinity ? inForce(last, false, last)[0] : undefined;
  };

  /** Bends sent before now for `time` and after are dropped (a cut). */
  const dropFrom = (time: number) => {
    points = points.slice(0, pointFrom(time, false));
    for (const s of streams) s.dropFrom = Math.min(s.dropFrom, time);
    for (const l of layers) l.dropFrom = Math.min(l.dropFrom, time);
  };

  /** Forget what's long gone. */
  const prune = () => {
    const before = clock.currentTime - 1;
    const old = pointFrom(before, false);
    if (old) points = points.slice(old);
    layers = layers.filter((l) => Math.min(Math.max(l.to, l.backTo), l.dropFrom) >= before);
    const gone = backFrom(before, false);
    if (gone) {
      for (let i = 0; i < gone; i++) if (backOf.get(backs[i].curve) === backs[i]) backOf.delete(backs[i].curve);
      backs = backs.slice(gone);
    }
    streams = streams.filter((s) => {
      // (Dropped: still where a later note's bend is sent again)
      const keep = !(s.end < before || (s.curve.last() ?? Infinity) < before) && (s.dropFrom >= before || layers.some((l) => l.order > s.order));
      if (!keep) streamOf.delete(s.curve);
      return keep;
    });
  };

  /** Give `due` in time order, the ones sent again that change nothing left out; `cut` with the first. */
  const giveAll = (due: Due[], cut = false) => {
    let n = 0;
    for (const d of due) {
      const v = d.value();
      if (d.again && v === tail && !cut) continue;
      give(v, d.time, cut || d.cut, d.sent);
      cut = false;
      tail = v;
      n++;
    }
    allowance.take(n);
  };

  /**
   * The bends in force from `lo` to `hi` (see inForce), worked out a little at a time: those up to
   * `must` at least, then no further than the time where there are `most`. Returns them and where
   * they end.
   */
  const gather = (lo: number, loOpen: boolean, hi: number, most: number, must: number) => {
    const due: Due[] = [];
    let at = lo;
    let open = loOpen;
    if (at === -Infinity) {
      at = Math.min(hi, clock.currentTime);
      for (const d of inForce(-Infinity, false, at)) due.push(d);
      open = true;
    }
    while (at < hi && (due.length < most || at < must)) {
      // (Those up to `must` at once, then a little at a time)
      const next = Math.min(hi, at < must ? must : at + FEED_EVERY / 5);
      for (const d of inForce(at, open, next)) due.push(d);
      at = next;
      open = true;
    }
    return { due, to: at };
  };

  const feed = () => {
    if (batching) return;
    const now = clock.currentTime;
    const to = now + FEED_AHEAD;
    if (!(to > fedTo)) return;
    const { due, to: upTo } = gather(fedTo, fedTo !== -Infinity, to, allowance.left(), least());
    if (!(upTo > fedTo)) return;
    fedTo = upTo;
    giveAll(due);
    prune();
  };

  /** The instrument has its bends at least FEED_START ahead: a bend sent goes to it at once where it has them, else waits. */
  const ensure = () => {
    if (!(fedTo >= least())) feed();
  };

  return {
    send: (value, time, cut = false, now = false) => {
      ensure();
      order++;
      if (cut) dropFrom(time);
      addPoint({ time, order, value, cut, sent: bendStamp() });
      if ((batching && !now) || time > fedTo) return;
      const v = typeof value === 'function' ? value() : value;
      // (In a batch, what follows it is given again at its end, see batch: a chord's notes each
      // begun on the same bend give it once)
      if (batching) {
        if (givenInBatch && lastGiven[0] === time && lastGiven[1] === v && !cut) return;
        give(v, time, cut, stamps);
        givenInBatch = true;
        lastGiven = [time, v];
        return;
      }
      give(v, time, cut, stamps);
      // The next one sent for after it may have been left out (the same as the one before it, now
      // this one): given again
      const next = cut ? undefined : firstAfter(time);
      if (!next) tail = v;
      else give(next.value(), next.time, false, next.sent);
    },
    steps: (curve, start, end) => {
      order++;
      const st: Stream = { order, curve, start, end, dropFrom: Infinity, sent: bendStamp() };
      streams.push(st);
      streamOf.set(curve, st);
      orderOf.set(curve, order);
    },
    over: (over, from, to, backTo = -Infinity) => {
      if (!(to > from) && !(backTo > from)) return;
      order++;
      layersSent++;
      layers.push({ order, value: (t) => curveAt(over, t), not: over, from, to, backLo: from, backTo, dropFrom: Infinity, sent: bendStamp() });
    },
    overBacks: (value, begun, lo, hi, not) => {
      if (!(hi > lo)) return;
      order++;
      layersSent++;
      layers.push({ order, value, not, from: begun, to: -Infinity, backLo: lo, backTo: hi, dropFrom: Infinity, sent: bendStamp() });
    },
    back: (curve, start, end, time) => {
      order++;
      const was = backOf.get(curve);
      if (was) {
        was.valid = order;
        backOf.delete(curve);
      }
      const of = orderOf.get(curve);
      if (time === undefined || of === undefined) return;
      const b: Back = { time, curve, start, end, order: of, valid: Infinity };
      backOf.set(curve, b);
      const at = backFrom(time, true);
      if (at === backs.length) backs.push(b);
      else backs.splice(at, 0, b);
    },
    endAt: (curve, end) => {
      const st = streamOf.get(curve);
      if (st) st.end = Math.min(st.end, end);
      const b = backOf.get(curve);
      if (b) b.end = Math.min(b.end, end);
    },
    unbackEnded: (time) => {
      order++;
      for (const [curve, b] of backOf) {
        if (!(b.end <= time + 1e-9 && b.start < time)) continue;
        b.valid = order;
        backOf.delete(curve);
      }
    },
    forget: (curve) => {
      streams = streams.filter((s) => s.curve !== curve);
      streamOf.delete(curve);
      backs = backs.filter((b) => b.curve !== curve);
      backOf.delete(curve);
    },
    batch: (from, fn, again = false) => {
      if (batching) {
        batchFrom = Math.min(batchFrom, from);
        batchAgain = batchAgain || again;
        fn();
        return;
      }
      ensure();
      batchFrom = from;
      batchAgain = again;
      givenInBatch = false;
      const sentBefore = layersSent;
      const was = again || from > fedTo ? undefined : inForce(from, false, fedTo);
      batching = true;
      try {
        fn();
      } finally {
        batching = false;
      }
      // (Begun late, the page held up: what's played already is played)
      const lo = Math.max(batchFrom, clock.currentTime);
      if (lo > fedTo) return;
      if (batchAgain || layersSent !== sentBefore || !was || lo !== from || givenInBatch) {
        // Earlier notes' steps it sounds over are each sent again over: rather than give each of
        // those again where the instrument has them, everything from here again (what it has from
        // here dropped first), as far as it had them (see GIVE_RATE: many notes begun at once
        // under each other don't each give a couple of seconds' worth again)
        const head = inForce(lo, false, lo)[0] ?? lastBefore(lo);
        const { due, to } = gather(lo, true, fedTo, allowance.left(), Math.min(fedTo, least()));
        if (head) {
          giveAll([{ ...head, time: lo, again: false }, ...due], true);
          fedTo = Math.max(lo, to);
          return;
        }
        // (None in force before it: from the first there is)
        if (due.length) {
          giveAll(due, true);
          fedTo = to;
          return;
        }
      }
      const now = inForce(lo, false, fedTo);
      // What changes where the instrument has been given its bends: each one now in force that
      // isn't what it has there (not every one sent was given, see giveAll: where one given here
      // is followed by one that may not have been, what the instrument has there isn't known)
      let has: number | undefined;
      let sure = false;
      let given = false;
      let w = 0;
      for (const d of now) {
        for (; was && w < was.length && was[w].time <= d.time; w++) {
          const v = was[w].value();
          if (!given) {
            has = v;
            sure = true;
          } else if (v !== has) sure = false;
        }
        const v = d.value();
        if (sure && v === has) continue;
        give(v, d.time, false, d.sent);
        has = v;
        sure = true;
        given = true;
      }
      if (now.length) tail = now[now.length - 1].value();
    },
    feed,
    alive: () => {
      prune();
      return points.length > 0 || streams.length > 0 || layers.length > 0 || backs.length > 0;
    },
  };
}
