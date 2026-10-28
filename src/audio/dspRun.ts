/**
 * Running a heavy sound edit (dspJobs.ts) without stalling the page: in a Worker (dspWorker.ts),
 * the channels copied to it and the result moved back. A stretch of a long tonal recording is a
 * few seconds of work (the phase vocoder, phaseVocoder.ts), which would freeze the page and the
 * playhead. The Worker runs the very same code, so what comes back is what running it here gives,
 * sample for sample (an export is the same as the live sound). Where a Worker can't start (or
 * fails) it runs on this thread instead, after a pause for the page to paint.
 */
import { runDspJob, type DspJob } from './dspJobs';
import DspWorker from './dspWorker.ts?worker&inline';

/** Jobs at once (a song opening with many stretched clips asks for them all together): the rest wait their turn. */
const AT_ONCE = Math.max(1, Math.min(3, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));
let running = 0;
const waiting: Array<() => void> = [];

/** `job` done to `channels` (left as they are) at `sampleRate`, off the main thread where it can be. */
export async function runDsp(job: DspJob, channels: readonly Float32Array[], sampleRate: number): Promise<Float32Array[]> {
  if (running >= AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  running++;
  try {
    return await runOne(job, channels, sampleRate);
  } finally {
    running--;
    waiting.shift()?.();
  }
}

function runOne(job: DspJob, channels: readonly Float32Array[], sampleRate: number): Promise<Float32Array[]> {
  const inline = () =>
    new Promise<Float32Array[]>((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(runDspJob(job, channels.map((ch) => ch.slice()), sampleRate));
        } catch (err) {
          reject(err);
        }
      }, 30)
    );
  if (typeof Worker === 'undefined') return inline();
  return new Promise<Float32Array[]>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new DspWorker();
    } catch {
      resolve(inline());
      return;
    }
    let settled = false;
    worker.onmessage = (e: MessageEvent<{ channels?: Float32Array[]; error?: string }>) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      if (e.data.channels) resolve(e.data.channels);
      else reject(new Error(e.data.error ?? 'The sound edit failed'));
    };
    worker.onerror = (e) => {
      if (settled) return;
      // (A Worker that can't load its script runs here instead)
      e.preventDefault();
      settled = true;
      worker.terminate();
      resolve(inline());
    };
    const copies = channels.map((ch) => ch.slice());
    worker.postMessage({ job, channels: copies, sampleRate }, copies.map((ch) => ch.buffer));
  });
}
