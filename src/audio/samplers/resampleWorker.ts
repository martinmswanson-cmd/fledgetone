/**
 * The Worker that makes re-pitched copies of recordings (resampler.ts) off the main thread, so
 * live playback never waits on one: a job ({ id, channels, plan, kernel shape }) in, { id,
 * channels } (handed back, not copied) or { id, error } out. Bundled inline (pitchedCopies.ts
 * imports it with ?worker&inline), so the one-file build needs no extra file.
 */
import { copyKernel, resample, type ReadPlan } from './resampler';

export interface ResampleJob {
  id: number;
  channels: Float32Array[];
  plan: ReadPlan;
  ratio: number;
  inRate: number;
  outRate: number;
  playRate: number;
  band: number;
}

const scope = self as unknown as Worker;

scope.onmessage = (e: MessageEvent<ResampleJob>) => {
  const job = e.data;
  try {
    const out = resample(job.channels, job.plan, copyKernel(job.ratio, job.inRate, job.outRate, job.playRate, job.band));
    scope.postMessage({ id: job.id, channels: out }, out.map((c) => c.buffer));
  } catch (err) {
    scope.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
};
