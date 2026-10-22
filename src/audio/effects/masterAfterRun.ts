/**
 * Running an export's master section (masterAfter.ts) without stalling the page: in a Worker
 * (masterAfterWorker.ts), the channels copied to it and its results copied back in place. A Loud
 * master's match (loudMaster.ts) runs the clipper and limiter over a long song several times, many
 * seconds of work that froze the page (no progress, "page unresponsive" on phones). The Worker
 * runs the very same code, so what comes back is what running it here gives, sample for sample.
 * Where a Worker can't start (or fails) it runs on this thread instead, after a pause for the page
 * to paint.
 */
import { runMasterJob, type MasterJob, type MasterStats } from './masterAfter';
import MasterWorker from './masterAfterWorker.ts?worker&inline';

interface Reply {
  progress?: number;
  stats?: MasterStats;
  left?: Float32Array;
  right?: Float32Array;
  error?: string;
}

/**
 * masterAfter over `job`'s channels, in place, off the main thread where it can be. Rejects with
 * the signal's reason if aborted (the channels are then left as they were).
 */
export function masterAfterOffThread(job: MasterJob, signal?: AbortSignal, onProgress?: (fraction: number) => void): Promise<MasterStats> {
  signal?.throwIfAborted();
  const inline = () =>
    new Promise<MasterStats>((resolve, reject) =>
      setTimeout(() => {
        try {
          signal?.throwIfAborted();
          resolve(runMasterJob(job, onProgress));
        } catch (err) {
          reject(err);
        }
      }, 30)
    );
  if (typeof Worker === 'undefined') return inline();
  return new Promise<MasterStats>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new MasterWorker();
    } catch {
      resolve(inline());
      return;
    }
    let settled = false;
    const finish = () => {
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      if (settled) return;
      const r = e.data;
      if (r.progress !== undefined) onProgress?.(r.progress);
      else if (r.stats && r.left) {
        finish();
        job.left.set(r.left);
        if (job.right && r.right) job.right.set(r.right);
        resolve(r.stats);
      } else {
        finish();
        reject(new Error(r.error ?? 'The master section failed'));
      }
    };
    worker.onerror = (e) => {
      if (settled) return;
      // (A Worker that can't load its script runs here instead; the channels are still as they were)
      e.preventDefault();
      finish();
      resolve(inline());
    };
    const left = job.left.slice();
    const right = job.right?.slice();
    worker.postMessage({ ...job, left, right }, [left.buffer, ...(right ? [right.buffer] : [])]);
  });
}
