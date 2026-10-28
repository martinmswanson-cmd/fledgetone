/**
 * The re-pitched copies of recordings kept for playing (see pitchedCopies.ts): by the recording
 * they were made from (held weakly: a copy goes with its recording) and a key for what they are
 * (the ratio, the rate, a slice), least recently used first out once they take more than a cap.
 * A copy something holds on to (`pin`: an export that planned it) isn't let go until it's
 * unpinned. Plain logic over any objects, so Node can test it.
 */

interface Entry<S extends object, C> {
  source: WeakRef<S>;
  key: string;
  copy: C;
  bytes: number;
  pins: number;
}

export class CopyCache<S extends object, C> {
  private bySource = new WeakMap<S, Map<string, Entry<S, C>>>();
  /** Every entry, least recently used first (a Map keeps the order things were put in) */
  private order = new Map<Entry<S, C>, true>();
  private total = 0;
  /** How many bytes it keeps of copies nothing pins */
  cap: number;

  constructor(cap: number) {
    this.cap = cap;
  }

  /** The bytes every copy kept takes. */
  get bytes(): number {
    return this.total;
  }

  /** How many copies are kept. */
  get size(): number {
    return this.order.size;
  }

  /** The copy of `source` under `key`, if there is one (and it becomes the most recently used). */
  get(source: S, key: string): C | undefined {
    const e = this.bySource.get(source)?.get(key);
    if (!e) return undefined;
    this.order.delete(e);
    this.order.set(e, true);
    return e.copy;
  }

  /** Whether there's a copy of `source` under `key` (without touching its place in the order). */
  has(source: S, key: string): boolean {
    return !!this.bySource.get(source)?.has(key);
  }

  /** The keys of `source`'s copies. */
  keys(source: S): string[] {
    return [...(this.bySource.get(source)?.keys() ?? [])];
  }

  /** Keep `copy` of `source` under `key` (`bytes` big), pinned `pins` times; older copies go if the cache is over its cap. */
  set(source: S, key: string, copy: C, bytes: number, pins = 0): void {
    const old = this.bySource.get(source)?.get(key);
    if (old) this.drop(old);
    let row = this.bySource.get(source);
    if (!row) this.bySource.set(source, (row = new Map()));
    const e: Entry<S, C> = { source: new WeakRef(source), key, copy, bytes, pins };
    row.set(key, e);
    this.order.set(e, true);
    this.total += bytes;
    this.trim();
  }

  /** Hold `source`'s copy under `key` until as many unpins: it isn't let go however full the cache is. */
  pin(source: S, key: string): boolean {
    const e = this.bySource.get(source)?.get(key);
    if (!e) return false;
    e.pins++;
    return true;
  }

  /** Let go of a pin (see pin); the cache trims back to its cap. */
  unpin(source: S, key: string): void {
    const e = this.bySource.get(source)?.get(key);
    if (e && e.pins > 0) e.pins--;
    this.trim();
  }

  /** Let go of the least recently used copies that aren't pinned, until the rest fit in the cap. */
  trim(cap = this.cap): void {
    if (this.total <= cap) return;
    // (copies of recordings since let go first: nothing can play them any more)
    for (const e of [...this.order.keys()]) if (!e.source.deref()) this.drop(e);
    for (const e of [...this.order.keys()]) {
      if (this.total <= cap) break;
      if (e.pins > 0) continue;
      this.drop(e);
    }
  }

  /** Let go of `source`'s copy under `key`, unless something pins it; whether it went. */
  delete(source: S, key: string): boolean {
    const e = this.bySource.get(source)?.get(key);
    if (!e || e.pins > 0) return false;
    this.drop(e);
    return true;
  }

  /** Let go of every copy that isn't pinned. */
  clear(): number {
    const before = this.total;
    this.trim(0);
    return before - this.total;
  }

  private drop(e: Entry<S, C>): void {
    this.order.delete(e);
    this.total -= e.bytes;
    const s = e.source.deref();
    const row = s && this.bySource.get(s);
    if (row?.get(e.key) === e) {
      row.delete(e.key);
      if (!row.size && s) this.bySource.delete(s);
    }
  }
}
