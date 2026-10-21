/**
 * The Worker that runs the "Does it hit?" measurements (hitCheck.ts) off the main thread: a
 * HitCheckInput in, progress messages ({ progress }) and then { report } (or { error }) out.
 * Bundled inline (hitCheckRun.ts imports it with ?worker&inline), so the one-file build needs no
 * extra file.
 */
import { hitCheck, type HitCheckInput } from './hitCheck';

// (The app's types are the page's; inside a Worker, `self` posts like a Worker does)
const scope = self as unknown as Worker;

scope.onmessage = (e: MessageEvent<HitCheckInput>) => {
  try {
    const report = hitCheck(e.data, (progress) => scope.postMessage({ progress }));
    scope.postMessage({ report });
  } catch (err) {
    scope.postMessage({
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
