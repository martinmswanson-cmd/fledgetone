/**
 * The wiring of an exact sum: how three or more connections into one input (of a node or a
 * parameter) are added up in an order that never changes, so a song renders the same sample for
 * sample every time. Pure bookkeeping on handles, no Web Audio: exactSums.ts carries out the
 * connects and disconnects it returns.
 *
 * Why: Chromium adds up the connections into an input in the order of a hash of their memory
 * addresses, which differs from one render to the next. Floating-point addition isn't
 * associative, so with three or more connections the sum came out a rounding error different in
 * each export (about -130 dB, louder after a distortion), and no two exports of a song were the
 * same file. Two are always exact (a + b is b + a), so each node here takes at most two: the
 * first connection goes straight in, and each later one goes into a pass-through link (a gain of
 * 1) that also takes the next link's sum, so the input hears first + (second + (third + ...)).
 *
 * A connection let go leaves its link adding nothing (x + 0 is exactly x), so a disconnect, which
 * can happen at any moment of a render (when the browser reports a sound ended), changes no sum.
 * New connections always go at the end, never into a freed place, so the order never depends on
 * when anything was let go. `compact` takes the idle links out (wiring that again only adds the
 * same numbers in the same order), while the render is paused.
 */

/** The input being summed into, in the ops below. */
export const SUM_TARGET = 'target' as const;

/** One connection into the input: a source and, past the first, its link. */
export interface SumEntry<S, L> {
  /** The connection (null once let go) */
  source: S | null;
  /** The link it plays into (absent: straight into the target) */
  link: L | null;
}

/** A connect or disconnect for the caller to carry out, in order. */
export interface SumOp<S, L> {
  kind: 'connect' | 'disconnect';
  from: S | L;
  to: L | typeof SUM_TARGET;
}

/**
 * The connections into one input, in the order they're added up. Every node the ops wire has at
 * most two inputs: the target its first entry and the first link; each link its own source and
 * the next link.
 */
export class SumChain<S, L> {
  readonly entries: SumEntry<S, L>[] = [];

  private readonly makeLink: () => L;

  constructor(makeLink: () => L) {
    this.makeLink = makeLink;
  }

  /**
   * Where entry `i` (its link, or its source when it has none) plays into: the link before it, or
   * the target for the first entry and for the second when the first has no link.
   */
  private targetOf(i: number): L | typeof SUM_TARGET {
    return (i > 0 && this.entries[i - 1].link) || SUM_TARGET;
  }

  /** Whether `source` is connected here. */
  has(source: S): boolean {
    return this.entries.some((e) => e.source === source);
  }

  /** How many connections are live. */
  get live(): number {
    return this.entries.reduce((n, e) => n + (e.source === null ? 0 : 1), 0);
  }

  /** Connect `source`, after every other. */
  add(source: S): SumOp<S, L>[] {
    if (this.has(source)) return [];
    if (!this.entries.length) {
      this.entries.push({ source, link: null });
      return [{ kind: 'connect', from: source, to: SUM_TARGET }];
    }
    // The last entry's link has room for one more input (its own source and nothing after it);
    // the first entry without a link leaves the target room for one
    const link = this.makeLink();
    const last = this.entries[this.entries.length - 1];
    const into = last.link ?? SUM_TARGET;
    this.entries.push({ source, link });
    return [
      { kind: 'connect', from: link, to: into },
      { kind: 'connect', from: source, to: link },
    ];
  }

  /** Let `source` go (its link stays, adding nothing, until compact). */
  remove(source: S): SumOp<S, L>[] {
    const i = this.entries.findIndex((e) => e.source === source);
    if (i < 0) return [];
    const entry = this.entries[i];
    entry.source = null;
    return [{ kind: 'disconnect', from: source, to: entry.link ?? this.targetOf(i) }];
  }

  /**
   * Take out the links of connections let go, joining the next link to where the idle one played
   * into. The sum stays the same numbers added in the same order. With none live, everything goes
   * and the next connection starts afresh, straight into the target.
   */
  compact(): SumOp<S, L>[] {
    const ops: SumOp<S, L>[] = [];
    if (this.live === 0) {
      this.entries.forEach((e, i) => e.link && ops.push({ kind: 'disconnect', from: e.link, to: this.targetOf(i) }));
      this.entries.length = 0;
      return ops;
    }
    for (let i = 0; i < this.entries.length; ) {
      const entry = this.entries[i];
      if (entry.source !== null) {
        i++;
        continue;
      }
      const into = this.targetOf(i);
      const next = this.entries[i + 1];
      if (entry.link) {
        if (next) {
          ops.push({ kind: 'disconnect', from: next.link!, to: entry.link });
          ops.push({ kind: 'connect', from: next.link!, to: into });
        }
        ops.push({ kind: 'disconnect', from: entry.link, to: into });
      }
      // (An idle first entry without a link was straight into the target: the next one's link
      // already plays there)
      this.entries.splice(i, 1);
    }
    return ops;
  }
}
