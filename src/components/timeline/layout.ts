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

/** Room a timecode ruler label needs ("40:00:00" plus its 4px inset). */
export const TIMECODE_LABEL_PX = 56;

/** Ruler spacing in timecode mode, in seconds: whole frames under a second, then whole seconds. */
export interface TimecodeRulerSteps {
  /** Seconds between labels */
  label: number;
  /** Seconds between the small ticks under the labels (equal to `label` when there's no room) */
  tick: number;
}

const SECOND_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/** Label and tick spacing for a timecode ruler, so labels stay ~64px apart at any zoom and tempo. */
export function timecodeRulerSteps(pxPerSecond: number, fps: number): TimecodeRulerSteps {
  // Frame steps under a second that divide two seconds evenly, so labels still land on every
  // other second (25 fps: 1, 2, 5, 10 frames; 30 fps: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20), then seconds
  const frameSteps = Array.from({ length: fps - 1 }, (_, i) => i + 1).filter((f) => (2 * fps) % f === 0).map((f) => f / fps);
  const steps = [...frameSteps, ...SECOND_STEPS];
  const label = steps.find((s) => s * pxPerSecond >= 64) ?? 1200;
  // Smallest step at least 6px wide that divides the label step evenly
  const tick = steps.find((s) => s * pxPerSecond >= 6 && Math.abs(label / s - Math.round(label / s)) < 1e-9) ?? label;
  return { label, tick };
}
