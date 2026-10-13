/**
 * One animation-frame loop for every readout that moves with the sound (the mixer's meters, the
 * spectrum), each called at the rate it asks for. A loop of their own each meant forty callbacks a
 * frame on a big song, every one writing to the page whether or not anything had changed, on the
 * same main thread that schedules the notes. The loop runs only while something is listening.
 */

type Listener = { fps: number; last: number; fn: (now: number) => void };

const listeners = new Set<Listener>();
let raf = 0;

const frame = (now: number) => {
  raf = listeners.size ? requestAnimationFrame(frame) : 0;
  for (const l of listeners) {
    // A frame's worth of slack, so 30 fps on a 60 Hz screen is every other frame, not every third
    if (now - l.last < 1000 / l.fps - 8) continue;
    l.last = now;
    l.fn(now);
  }
};

/** Call `fn` up to `fps` times a second, on animation frames, until the returned function is called. */
export function onFrame(fn: (now: number) => void, fps = 30): () => void {
  const listener: Listener = { fps, last: 0, fn };
  listeners.add(listener);
  if (!raf) raf = requestAnimationFrame(frame);
  return () => {
    listeners.delete(listener);
  };
}

/** Change how often a listener is called (a readout that has gone quiet can slow down). */
export function frameRate(fn: (now: number) => void, fps: number): void {
  for (const l of listeners) if (l.fn === fn) l.fps = fps;
}
