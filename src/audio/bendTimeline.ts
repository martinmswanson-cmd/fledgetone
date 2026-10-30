/**
 * The pitch bends an instrument that bends as a whole has been sent, by when each takes effect.
 *
 * The scheduler sends a note's own bend (a slide, a dive, a scoop) in full when the note starts,
 * on the audio clock, so a busy page can't hold a slide up. An instrument that started its later
 * notes at the bend it was sent last would then start a note under a bend still to come: these
 * instruments start each note at the bend in force when it starts (`at`), and move it with every
 * bend sent for later (`after`). A jump or Stop drops the bends still to come (`cut`), any sent
 * for that very time with them (a slide's last step can land on a loop's end).
 */
export interface BendTimeline {
  /** A bend from `time` (cents). `cut`: the bends sent for `time` and after are dropped first. */
  set: (cents: number, time: number, cut?: boolean) => void;
  /** The bend in force at `time` (cents; 0 before any). */
  at: (time: number) => number;
  /** The bends sent for after `time`, in time order. */
  after: (time: number) => ReadonlyArray<readonly [time: number, cents: number]>;
  /** Whether it has ever been sent a bend off centre (until then a note's pitch is untouched). */
  moved: () => boolean;
}

/** Seconds of bends kept behind the latest one sent (the one in force then is always kept). */
const KEEP_SECONDS = 30;

export function createBendTimeline(): BendTimeline {
  const points: Array<[number, number]> = [];
  let moved = false;
  /** The index of the last point at or before `time` (-1: none). */
  const lastAt = (time: number) => firstAfter(time) - 1;
  /** The index of the first point after `time` (`from`: at or after). */
  const firstAfter = (time: number, from = false) => {
    let lo = 0;
    let hi = points.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (from ? points[mid][0] < time : points[mid][0] <= time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    set: (cents, time, cut) => {
      if (cents !== 0) moved = true;
      if (cut) points.splice(firstAfter(time, true));
      // (After any sent for the same time: the later sent wins, as before)
      points.splice(lastAt(time) + 1, 0, [time, cents]);
      const old = lastAt(time - KEEP_SECONDS);
      if (old > 0) points.splice(0, old);
    },
    at: (time) => {
      const i = lastAt(time);
      return i < 0 ? 0 : points[i][1];
    },
    after: (time) => points.slice(lastAt(time) + 1),
    moved: () => moved,
  };
}
