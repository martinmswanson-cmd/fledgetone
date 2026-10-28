/**
 * The Worker that runs the heavy sound edits (dspJobs.ts: stretches, warps, re-pitches, mangles,
 * tunes) off the main thread: { job, channels, sampleRate } in, { channels } (or { error }) out,
 * the channels' buffers moved, not copied. Bundled inline (dspRun.ts imports it with
 * ?worker&inline), so the one-file build needs no extra file.
 */
import { runDspJob, type DspJob } from './dspJobs';

const scope = self as unknown as Worker;

scope.onmessage = (e: MessageEvent<{ job: DspJob; channels: Float32Array[]; sampleRate: number }>) => {
  try {
    const out = runDspJob(e.data.job, e.data.channels, e.data.sampleRate);
    scope.postMessage({ channels: out }, out.map((ch) => ch.buffer));
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
