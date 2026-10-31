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

/** The bend of `c` at `time`: its last step at or before it, its first before any (0: none). */
export function curveAt(c: BendCurve, time: number): number {
  const i = lastStepAt(c, time);
  return i >= 0 ? c.pts[i][1] : (c.pts[0]?.[1] ?? 0);
}

/** Times from `lo` to `hi` (`lo` itself only if not `loOpen`, `hi` itself only if not `hiOpen`). */
interface Span {
  lo: number;
  loOpen: boolean;
  hi: number;
  hiOpen: boolean;
}
const inSpan = (s: Span, t: number) => (s.loOpen ? t > s.lo : t >= s.lo) && (s.hiOpen ? t < s.hi : t <= s.hi);

/** `spans` without the times strictly between `a` and `b`. */
function withoutBetween(spans: Span[], a: number, b: number): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (s.hi <= a || s.lo >= b) {
      out.push(s);
      continue;
    }
    if (s.lo < a || (s.lo === a && !s.loOpen)) out.push({ lo: s.lo, loOpen: s.loOpen, hi: a, hiOpen: false });
    if (s.hi > b || (s.hi === b && !s.hiOpen)) out.push({ lo: b, loOpen: false, hi: s.hi, hiOpen: s.hiOpen });
  }
  return out;
}

/** One bend sent (its value worked out when it's given, for a curve's step far ahead). */
interface Point {
  time: number;
  order: number;
  value: number | (() => number);
  cut: boolean;
}
/**
 * Bends sent all at once, at the times of the steps of `times`: a note's own steps (`value` the
 * same curve), or, where a later note's bend takes over from one sounding, a bend at each of the
 * earlier one's steps of the later one's bend there (`value` the later one's curve).
 */
interface Stream {
  order: number;
  times: BendCurve;
  value: BendCurve;
  /** Where it has its steps still in force (those elsewhere were sent again over by a later stream) */
  spans: Span[];
  /** From here on its steps were dropped (a cut sent after it) */
  dropFrom: number;
}
interface Due {
  time: number;
  order: number;
  value: () => number;
  cut: boolean;
  /** A later note's bend sent again over an earlier one's step (see Stream): left out where it changes nothing */
  again: boolean;
}

export interface BendWindow {
  /** A bend from `time` (cents, or a curve's worked out when it's due). `cut`: the bends sent before for `time` and after are dropped first. */
  send: (value: number | (() => number), time: number, cut?: boolean) => void;
  /** Every step of a note's curve, as sent one by one at once (none for after `from` earlier than its start). */
  steps: (curve: BendCurve) => void;
  /** At each step of `under` strictly between `from` and `to`, the bend `over` has there (a later note taking over). */
  over: (over: BendCurve, under: BendCurve, from: number, to: number) => void;
  /**
   * Send what `fn` sends (no cut among it) as one: the bends it changes up to where the
   * instrument has been given them go to it at once, the one now in force at each of their times.
   * `again`: it sends bends again over earlier notes' steps (see `over`).
   */
  batch: (from: number, fn: () => void, again?: boolean) => void;
  /** Give the instrument the bends due up to FEED_AHEAD from now. */
  feed: () => void;
  /** Whether it still has bends for now or later. */
  alive: () => boolean;
}

/**
 * The bends sent to an instrument that bends as a whole, kept as sent (a note's whole curve, the
 * later notes' bends sent again over an earlier one's steps, each later sent for a time winning
 * at it, cuts dropping those sent before for their time and after), given to `give` at most
 * FEED_AHEAD ahead in time order as `feed` is called: the one in force at each time, the ones
 * sent again that change nothing left out. A long note's curve is worked out only as far as it's
 * given: so the work is what plays meanwhile, not how many long notes sound over each other. The
 * instrument has the same bend at every time as when every one was sent to it at once.
 */
/**
 * Seconds ahead the bends are given at least (see ensure), and at first: a note begun, the timer
 * then gives them further each time round, up to FEED_AHEAD (see nextFeedTo), so many notes begun
 * at once don't each give a couple of seconds' worth in one go.
 */
export const FEED_START = 2 * FEED_EVERY;

/** How far ahead the timer gives bends at `now`, given up to `fedTo` so far: FEED_AHEAD, getting there FEED_START at a time. */
export const nextFeedTo = (fedTo: number, now: number): number => Math.max(now + FEED_START, Math.min(now + FEED_AHEAD, Math.max(fedTo, now) + FEED_START));

export function createBendWindow(clock: { readonly currentTime: number }, give: (cents: number, time: number, cut: boolean) => void): BendWindow {
  let order = 0;
  /** The bends up to here have been given */
  let fedTo = -Infinity;
  /** The instrument's bend at fedTo, as given (undefined: not known) */
  let tail: number | undefined;
  /** By time, then as sent */
  let points: Point[] = [];
  let streams: Stream[] = [];
  let batching = false;

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
  const pointDue = (p: Point): Due => {
    const v = p.value;
    return { time: p.time, order: p.order, value: typeof v === 'function' ? v : () => v, cut: p.cut, again: false };
  };
  const streamDue = (s: Stream, i: number): Due => {
    const [t, cents] = s.times.pts[i];
    return { time: t, order: s.order, value: s.value === s.times ? () => cents : () => curveAt(s.value, t), cut: false, again: s.value !== s.times };
  };

  /** The bend sent last for each time some bend was sent for, from `lo` (itself too unless `loOpen`) to `hi`, in time order. */
  const inForce = (lo: number, loOpen: boolean, hi: number): Due[] => {
    // (By time, the one sent last: each made into a Due only once it's known to be in force)
    const best = new Map<number, { order: number; cut: boolean; p?: Point; s?: Stream; i: number }>();
    const take = (time: number, ord: number, cut: boolean, p: Point | undefined, st: Stream | undefined, i: number) => {
      const had = best.get(time);
      if (!had) best.set(time, { order: ord, cut, p, s: st, i });
      else if (ord > had.order) best.set(time, { order: ord, cut: cut || had.cut, p, s: st, i });
      else if (cut) had.cut = true;
    };
    const win: Span = { lo, loOpen, hi, hiOpen: false };
    for (let i = pointFrom(lo, loOpen); i < points.length && points[i].time <= hi; i++) take(points[i].time, points[i].order, points[i].cut, points[i], undefined, 0);
    for (const s of streams) {
      for (const sp of s.spans) {
        const from = Math.max(lo, sp.lo);
        const to = Math.min(hi, sp.hi, s.dropFrom);
        // (not worked out past the window)
        if (to < from) continue;
        const i0 = Math.max(0, lastStepAt(s.times, from));
        s.times.reach(to);
        const pts = s.times.pts;
        for (let i = i0; i < pts.length && pts[i][0] <= to; i++) {
          const t = pts[i][0];
          if (inSpan(win, t) && inSpan(sp, t) && t < s.dropFrom) take(t, s.order, false, undefined, s, i);
        }
      }
    }
    const times = [...best.keys()].sort((a, b) => a - b);
    return times.map((t) => {
      const b = best.get(t)!;
      const d = b.p ? pointDue(b.p) : streamDue(b.s!, b.i);
      d.cut = b.cut;
      return d;
    });
  };

  /** The bend sent last for the first time after `time` some bend was sent for, up to fedTo (undefined: none). */
  const firstAfter = (time: number): Due | undefined => {
    let best: Due | undefined;
    const take = (d: Due) => {
      if (d.time > fedTo) return;
      if (!best || d.time < best.time || (d.time === best.time && d.order > best.order)) best = d;
    };
    const at = pointFrom(time, true);
    for (let i = at; i < points.length && points[i].time === points[at].time; i++) take(pointDue(points[i]));
    for (const s of streams) {
      for (const sp of s.spans) {
        if (sp.hi < time || sp.lo > fedTo) continue;
        let i = lastStepAt(s.times, Math.max(time, sp.lo)) + 1;
        const pts = s.times.pts;
        // (the span's own start, where it's in it)
        if (i > 0 && pts[i - 1][0] > time && inSpan(sp, pts[i - 1][0])) i--;
        s.times.reach(Math.min(fedTo, sp.hi));
        for (; i < pts.length && pts[i][0] <= fedTo; i++) {
          const t = pts[i][0];
          if (!(t > time) || !inSpan(sp, t)) continue;
          if (t < s.dropFrom) take(streamDue(s, i));
          break;
        }
      }
    }
    return best;
  };

  /** Bends sent before now for `time` and after are dropped (a cut). */
  const dropFrom = (time: number) => {
    points = points.slice(0, pointFrom(time, false));
    for (const s of streams) s.dropFrom = Math.min(s.dropFrom, time);
  };

  /** Forget what's long gone. */
  const prune = () => {
    const before = clock.currentTime - 1;
    const old = pointFrom(before, false);
    if (old) points = points.slice(old);
    streams = streams.filter((s) => {
      let end = Math.min(s.dropFrom, s.times.last() ?? Infinity);
      let spanEnd = -Infinity;
      for (const sp of s.spans) spanEnd = Math.max(spanEnd, sp.hi);
      end = Math.min(end, spanEnd);
      return end >= before && s.spans.length > 0;
    });
  };

  /** Give `due` in time order, the ones sent again that change nothing left out; `cut` with the first. */
  const giveAll = (due: Due[], cut = false) => {
    for (const d of due) {
      const v = d.value();
      if (d.again && v === tail && !cut) continue;
      give(v, d.time, cut || d.cut);
      cut = false;
      tail = v;
    }
  };

  const feed = () => {
    if (batching) return;
    const to = nextFeedTo(fedTo, clock.currentTime);
    if (!(to > fedTo)) return;
    const due = fedTo === -Infinity ? inForce(-Infinity, false, to) : inForce(fedTo, true, to);
    fedTo = to;
    giveAll(due);
    prune();
  };

  /**
   * The instrument has its bends at least FEED_START ahead (the timer gives it them FEED_AHEAD
   * ahead): a bend sent goes to it at once where it has them, else waits.
   */
  const ensure = () => {
    if (!(fedTo >= clock.currentTime + FEED_START)) feed();
  };

  const addStream = (s: Stream) => {
    if (s.spans.length) streams.push(s);
  };

  return {
    send: (value, time, cut = false) => {
      ensure();
      order++;
      if (cut) dropFrom(time);
      points.splice(pointFrom(time, true), 0, { time, order, value, cut });
      if (batching || time > fedTo) return;
      const v = typeof value === 'function' ? value() : value;
      give(v, time, cut);
      // The next one sent for after it may have been left out (the same as the one before it, now
      // this one): given again
      const next = cut ? undefined : firstAfter(time);
      if (!next) tail = v;
      else give(next.value(), next.time, false);
    },
    steps: (curve) => {
      order++;
      addStream({ order, times: curve, value: curve, spans: [{ lo: -Infinity, loOpen: false, hi: Infinity, hiOpen: false }], dropFrom: Infinity });
    },
    over: (over, under, from, to) => {
      if (!(to > from)) return;
      order++;
      // (Sent again over at every one of them: the earlier ones' steps there are in force no more)
      for (const s of streams) if (s.times === under) s.spans = withoutBetween(s.spans, from, to);
      streams = streams.filter((s) => s.spans.length);
      addStream({ order, times: under, value: over, spans: [{ lo: from, loOpen: true, hi: to, hiOpen: true }], dropFrom: Infinity });
    },
    batch: (from, fn, again = false) => {
      ensure();
      const run = () => {
        batching = true;
        try {
          fn();
        } finally {
          batching = false;
        }
      };
      if (from > fedTo) {
        run();
        return;
      }
      if (again) {
        // An earlier note's steps it sounds over are each sent again over: rather than give each
        // of those again where the instrument has them, everything from here again, what it has
        // from here dropped first, and only FEED_START ahead (the timer gives it the rest: many
        // notes begun at once under each other don't each give a couple of seconds' worth again)
        run();
        const near = Math.max(from, Math.min(fedTo, clock.currentTime + FEED_START));
        const all = inForce(from, false, near);
        if (all[0]?.time === from) {
          giveAll(all, true);
          fedTo = near;
          return;
        }
        // (none for `from` itself: what it has before it would go too; given where it changes, below)
      }
      const was = again ? undefined : inForce(from, false, fedTo);
      if (!again) run();
      const now = inForce(from, false, fedTo);
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
        give(v, d.time, false);
        has = v;
        sure = true;
        given = true;
      }
      if (now.length) tail = now[now.length - 1].value();
    },
    feed,
    alive: () => {
      prune();
      return points.length > 0 || streams.length > 0;
    },
  };
}
