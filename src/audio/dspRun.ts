/**
 * Running a heavy sound edit (dspJobs.ts) without stalling the page: in a Worker (dspWorker.ts),
 * the channels copied to it and the result moved back. A stretch of a long tonal recording is a
 * few seconds of work (the phase vocoder, phaseVocoder.ts), which would freeze the page and the
 * playhead. The Worker runs the very same code, so what comes back is what running it here gives,
 * sample for sample (an export is the same as the live sound). Where a Worker can't start (or
 * fails) it runs on this thread instead, after a pause for the page to paint.
 *
 * A few Workers at most (one on a device with little memory), kept up while there's work and a
 * little after, each keeping how its sounds were heard: a job naming a sound goes to the Worker
 * that heard it. A job that may be dropped (`wanted`) is dropped while it waits once nothing wants
 * it any more (a tempo dragged on past it), and stopped if it's running and still not wanted a
 * moment later.
 */
import { runDspJob, type DspJob, type DspResult } from './dspJobs';
import DspWorker from './dspWorker.ts?worker&inline';

/** A job dropped because nothing wanted its result any more. */
export class DspDropped extends Error {}

export interface DspOptions {
  /** Whether the result is still wanted: asked before the job starts and while it runs */
  wanted?: () => boolean;
}

const lowMemory = () => typeof navigator !== 'undefined' && ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
const AT_ONCE = Math.max(1, Math.min(lowMemory() ? 1 : 2, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));
/** A Worker with nothing to do is let go after this long (its memory and what it heard with it). */
const IDLE_MS = 60000;

interface Slot {
  worker: Worker | null;
  busy: boolean;
  /** The sounds it has heard (job keys) */
  keys: Set<string>;
  idle: number;
}
const slots: Slot[] = Array.from({ length: AT_ONCE }, () => ({ worker: null, busy: false, keys: new Set<string>(), idle: 0 }));
const waiting: Array<{ key?: string; go: (slot: Slot) => void; drop: () => boolean }> = [];
let nextId = 1;
let workersFail = typeof Worker === 'undefined';

const keyOf = (job: DspJob) => ('key' in job ? job.key : undefined);

function release(slot: Slot): void {
  slot.busy = false;
  // The next job that still matters, preferring one for a sound this Worker has heard
  for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].drop()) waiting.splice(i, 1);
  let pick = waiting.findIndex((w) => w.key !== undefined && slot.keys.has(w.key));
  if (pick < 0) pick = 0;
  const next = waiting.splice(pick, 1)[0];
  if (next) {
    slot.busy = true;
    next.go(slot);
    return;
  }
  clearTimeout(slot.idle);
  slot.idle = window.setTimeout(() => {
    if (slot.busy) return;
    slot.worker?.terminate();
    slot.worker = null;
    slot.keys.clear();
  }, IDLE_MS);
}

function acquire(key: string | undefined, drop: () => boolean): Promise<Slot> {
  const free = slots.filter((s) => !s.busy);
  const slot = free.find((s) => key !== undefined && s.keys.has(key)) ?? free[0];
  if (slot) {
    slot.busy = true;
    clearTimeout(slot.idle);
    return Promise.resolve(slot);
  }
  return new Promise((resolve, reject) =>
    waiting.push({
      key,
      go: (s) => {
        clearTimeout(s.idle);
        resolve(s);
      },
      drop: () => {
        if (!drop()) return false;
        reject(new DspDropped('No longer wanted'));
        return true;
      },
    })
  );
}

const inline = (job: DspJob, channels: readonly Float32Array[], sampleRate: number) =>
  new Promise<DspResult>((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(runDspJob(job, channels.map((ch) => ch.slice()), sampleRate));
      } catch (err) {
        reject(err);
      }
    }, 30)
  );

/** `job` done to `channels` (left as they are) at `sampleRate`, off the main thread where it can be: everything it gives. */
export async function runDspFull(job: DspJob, channels: readonly Float32Array[], sampleRate: number, options: DspOptions = {}): Promise<DspResult> {
  const unwanted = () => !!options.wanted && !options.wanted();
  if (unwanted()) throw new DspDropped('No longer wanted');
  const key = keyOf(job);
  const slot = await acquire(key, unwanted);
  try {
    if (workersFail) return await inline(job, channels, sampleRate);
    if (!slot.worker) {
      try {
        slot.worker = new DspWorker();
      } catch {
        workersFail = true;
        return await inline(job, channels, sampleRate);
      }
    }
    const worker = slot.worker;
    const id = nextId++;
    const result = await new Promise<DspResult | 'failed'>((resolve, reject) => {
      let check = 0;
      const done = () => {
        window.clearInterval(check);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const onMessage = (e: MessageEvent<DspResult & { id: number; error?: string }>) => {
        if (e.data.id !== id) return;
        done();
        if (e.data.channels) resolve(e.data);
        else reject(new Error(e.data.error ?? 'The sound edit failed'));
      };
      const onError = (e: ErrorEvent) => {
        // (A Worker that can't load its script: this and later jobs run here instead)
        e.preventDefault();
        done();
        resolve('failed');
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      // Stopped if nothing wants it any more (the Worker goes with it: a new one starts next time)
      if (options.wanted) {
        let strikes = 0;
        check = window.setInterval(() => {
          strikes = unwanted() ? strikes + 1 : 0;
          if (strikes < 2) return;
          done();
          worker.terminate();
          slot.worker = null;
          slot.keys.clear();
          reject(new DspDropped('No longer wanted'));
        }, 500);
      }
      const copies = channels.map((ch) => ch.slice());
      worker.postMessage({ id, job, channels: copies, sampleRate }, copies.map((ch) => ch.buffer));
    });
    if (result === 'failed') {
      worker.terminate();
      slot.worker = null;
      workersFail = true;
      return await inline(job, channels, sampleRate);
    }
    if (key && slot.worker) slot.keys.add(key);
    return result;
  } finally {
    release(slot);
  }
}

/** `job` done to `channels` (left as they are) at `sampleRate`, off the main thread where it can be: the new channels. */
export async function runDsp(job: DspJob, channels: readonly Float32Array[], sampleRate: number, options?: DspOptions): Promise<Float32Array[]> {
  return (await runDspFull(job, channels, sampleRate, options)).channels;
}
