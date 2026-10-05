/** Shared timeline layout metrics (px). */
export const HEADER_WIDTH = 240;
export const TRACK_HEIGHT = 84;
export const RULER_HEIGHT = 34;
/** Pixel width of the grab zone on each clip edge used for trimming. */
export const TRIM_HANDLE_PX = 7;

/** Bars between ruler labels / major grid lines, so they stay ~44px apart at any zoom. */
export function barLabelStep(zoom: number): number {
  return [1, 2, 4, 8, 16, 32].find((s) => s * zoom >= 44) ?? 64;
}
