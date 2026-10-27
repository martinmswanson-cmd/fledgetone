/**
 * The Worker that runs Groove from audio (grooveExtract.ts) off the main thread: a mono recording,
 * its sample rate and the grid guess in, progress messages ({ progress }) and then { roles, grid,
 * bars } (or { error }) out. Bundled inline (grooveFromAudio.ts imports it with ?worker&inline).
 */
import { extractGroove, type Grid } from './grooveExtract';

const scope = self as unknown as Worker;

scope.onmessage = (e: MessageEvent<{ x: Float32Array; sr: number; guess: Grid }>) => {
  try {
    const m = extractGroove(e.data.x, e.data.sr, e.data.guess, { progress: (progress) => scope.postMessage({ progress }) });
    scope.postMessage({ result: { roles: m.roles, grid: m.grid, bars: m.bars } });
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
