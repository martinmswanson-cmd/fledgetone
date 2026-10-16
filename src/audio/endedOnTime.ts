import { endedDue } from './endedDue';

/**
 * "Ended" on time in an export: in an OfflineAudioContext marked with `endedOnTimeIn`, a sound
 * source's ended handlers (onended and 'ended' listeners) run while the render is suspended, at
 * the first suspend at or after the time the source was told to stop, not whenever the browser
 * gets round to reporting it. The export calls `deliverEnded` at each of its suspends.
 *
 * Why: those handlers let a note's nodes go. The browser reports an end once the render has
 * passed it, at a moment that varies from one render to the next, and whether a node was still
 * connected then changes what Chromium does with the nodes after it: a filter whose input has
 * gone keeps ringing out for its tail time from when it went, and is then cut to exact silence.
 * So two exports of a song differed in the last of the filters' ringing (-130 to -175 dB) and,
 * through a compressor or a distortion, more. On the render's own clock, every export lets go of
 * the same nodes at the same moment.
 *
 * A source with no stop time (one left to play its buffer out) still waits for the browser's
 * report, then runs at the next suspend; the app's own sources all have one.
 */

type Listener = EventListenerOrEventListenerObject;
interface Tracked {
  /** When it was told to stop (seconds), or null if it hasn't been */
  stopAt: number | null;
  /** The browser has reported its end (for one with no stop time) */
  ended: boolean;
  onended: ((this: AudioScheduledSourceNode, ev: Event) => unknown) | null;
  listeners: Array<{ listener: Listener; once: boolean }>;
}
interface Marked {
  /** The sources with ended handlers waiting, in the order they were first given one */
  waiting: Map<AudioScheduledSourceNode, Tracked>;
}

const marked = new WeakMap<BaseAudioContext, Marked>();
/** Every source of a marked context (its stop time is needed if a handler comes later) */
const tracked = new WeakMap<AudioScheduledSourceNode, Tracked>();

const proto = typeof AudioScheduledSourceNode === 'undefined' ? null : AudioScheduledSourceNode.prototype;

function trackedOf(node: AudioScheduledSourceNode): Tracked {
  let t = tracked.get(node);
  if (!t) tracked.set(node, (t = { stopAt: null, ended: false, onended: null, listeners: [] }));
  return t;
}

if (proto) {
  const nativeStop = proto.stop;
  const handler = Object.getOwnPropertyDescriptor(proto, 'onended')!;
  const addListener = EventTarget.prototype.addEventListener;
  const removeListener = EventTarget.prototype.removeEventListener;
  /** Hear the browser's own report once, for a source with no stop time */
  const hooked = new WeakSet<AudioScheduledSourceNode>();
  const wait = (node: AudioScheduledSourceNode, m: Marked, t: Tracked) => {
    m.waiting.set(node, t);
    if (!hooked.has(node)) {
      hooked.add(node);
      addListener.call(node, 'ended', () => (t.ended = true));
    }
  };

  proto.stop = function (this: AudioScheduledSourceNode, when?: number) {
    nativeStop.call(this, when);
    // (A time already past stops it at once, at the render's current time)
    if (marked.has(this.context)) trackedOf(this).stopAt = Math.max(when ?? 0, this.context.currentTime);
  };

  Object.defineProperty(proto, 'onended', {
    configurable: true,
    enumerable: handler.enumerable,
    get(this: AudioScheduledSourceNode) {
      return marked.has(this.context) ? trackedOf(this).onended : handler.get!.call(this);
    },
    set(this: AudioScheduledSourceNode, value: Tracked['onended']) {
      const m = marked.get(this.context);
      if (!m) return handler.set!.call(this, value);
      const t = trackedOf(this);
      t.onended = typeof value === 'function' ? value : null;
      wait(this, m, t);
    },
  });

  proto.addEventListener = function (this: AudioScheduledSourceNode, type: string, listener: Listener | null, options?: boolean | AddEventListenerOptions) {
    const m = marked.get(this.context);
    if (!m || type !== 'ended' || !listener) return addListener.call(this, type, listener, options);
    const t = trackedOf(this);
    if (!t.listeners.some((l) => l.listener === listener)) t.listeners.push({ listener, once: typeof options === 'object' && !!options.once });
    wait(this, m, t);
  } as typeof proto.addEventListener;

  proto.removeEventListener = function (this: AudioScheduledSourceNode, type: string, listener: Listener | null, options?: boolean | EventListenerOptions) {
    if (!marked.has(this.context) || type !== 'ended' || !listener) return removeListener.call(this, type, listener, options);
    const t = trackedOf(this);
    t.listeners = t.listeners.filter((l) => l.listener !== listener);
  } as typeof proto.removeEventListener;
}

/** Run ended handlers on the render's clock in `context` from now on (call before building anything in it). */
export function endedOnTimeIn(context: BaseAudioContext): void {
  if (proto && !marked.has(context)) marked.set(context, { waiting: new Map() });
}

/**
 * Run the ended handlers of `context`'s sources that have stopped by `time` (seconds): the render
 * is suspended there, or done. In the order endedDue gives.
 */
export function deliverEnded(context: BaseAudioContext, time: number): void {
  const m = marked.get(context);
  if (!m) return;
  const waiting = [...m.waiting];
  const due = endedDue(waiting.map(([, t]) => t), time).map((i) => waiting[i]);
  for (const [node, t] of due) {
    m.waiting.delete(node);
    const event = new Event('ended');
    const call = (fn: Listener) => {
      try {
        if (typeof fn === 'function') fn.call(node, event);
        else fn.handleEvent(event);
      } catch (err) {
        // (As an event handler's error would be: reported, and the others still run)
        console.error(err);
      }
    };
    if (t.onended) call(t.onended as Listener);
    for (const l of t.listeners) call(l.listener);
    t.listeners = t.listeners.filter((l) => !l.once);
  }
}
