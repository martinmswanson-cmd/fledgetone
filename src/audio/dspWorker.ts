/**
 * The Worker that runs the heavy sound edits (dspJobs.ts: stretches, warps, re-pitches, mangles,
 * tunes) off the main thread: { id, job, channels, sampleRate } in, { id, channels, frames,
 * shift } (or { id, error }) out, the channels' buffers moved, not copied. It stays up between
 * jobs, so how a sound was heard is kept for its next speed. Bundled inline (dspRun.ts imports it
 * with ?worker&inline), so the one-file build needs no extra file.
 */
import { runDspJob, type DspJob } from './dspJobs';

const scope = self as unknown as Worker;

scope.onmessage = (e: MessageEvent<{ id: number; job: DspJob; channels: Float32Array[]; sampleRate: number }>) => {
  const { id } = e.data;
  try {
    const out = runDspJob(e.data.job, e.data.channels, e.data.sampleRate);
    scope.postMessage({ id, ...out }, out.channels.map((ch) => ch.buffer));
  } catch (err) {
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
