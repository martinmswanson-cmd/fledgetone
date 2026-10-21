/**
 * Running the "Does it hit?" measurements (hitCheck.ts) on rendered audio without stalling the
 * page: in a Worker (hitCheckWorker.ts), the channels copied to it. Where a Worker can't start it
 * measures on this thread instead, after a pause for the page to paint.
 */
import { hitCheck, type HitCheckInput, type HitReport } from './hitCheck';
import HitWorker from './hitCheckWorker.ts?worker&inline';

export function measureHits(input: HitCheckInput, signal?: AbortSignal, onProgress?: (fraction: number) => void): Promise<HitReport> {
  signal?.throwIfAborted();
  const inline = () => new Promise<HitReport>((resolve) => setTimeout(() => resolve(hitCheck(input, onProgress)), 30));
  if (typeof Worker === 'undefined') return inline();
  return new Promise<HitReport>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new HitWorker();
    } catch {
      resolve(inline());
      return;
    }
    const finish = () => {
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (
      e: MessageEvent<{
        progress?: number;
        report?: HitReport;
        error?: string;
      }>,
    ) => {
      if (e.data.progress !== undefined) onProgress?.(e.data.progress);
      else if (e.data.report) {
        finish();
        resolve(e.data.report);
      } else {
        finish();
        reject(new Error(e.data.error ?? 'The measurement failed'));
      }
    };
    worker.onerror = () => {
      finish();
      resolve(inline());
    };
    const channels = input.channels.map((c) => c.slice());
    const bassChannels = input.bassChannels?.map((c) => c.slice());
    worker.postMessage({ ...input, channels, bassChannels }, [...channels, ...(bassChannels ?? [])].map((c) => c.buffer));
  });
}
