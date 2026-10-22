/**
 * The Worker that runs an export's master section (masterAfter.ts) off the main thread: a
 * MasterJob in, progress messages ({ progress }) and then { stats, left, right } (the channels
 * worked on, handed back) or { error } out. Bundled inline (masterAfterRun.ts imports it with
 * ?worker&inline), so the one-file build needs no extra file.
 */
import { runMasterJob, type MasterJob } from './masterAfter';

// (The app's types are the page's; inside a Worker, `self` posts like a Worker does)
const scope = self as unknown as Worker;

scope.onmessage = (e: MessageEvent<MasterJob>) => {
  try {
    const job = e.data;
    const stats = runMasterJob(job, (progress) => scope.postMessage({ progress }));
    const buffers = [job.left.buffer, ...(job.right ? [job.right.buffer] : [])];
    scope.postMessage({ stats, left: job.left, right: job.right }, buffers);
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
