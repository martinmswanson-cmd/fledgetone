/**
 * Waveform overviews: a sound's peaks, worked out once and kept, and the SVG path that draws any
 * stretch of them at any width. No audio nodes here, so Node can unit-test it.
 */

/** Peak columns per second of sound: fine enough for one column per pixel at the usual zooms. */
export const PEAKS_PER_SECOND = 200;

/** The lowest and highest sample in each column of a sound (any channel), `perSecond` columns a second. */
export interface Peaks {
  perSecond: number;
  min: Float32Array;
  max: Float32Array;
}

export function createPeaks(seconds: number, perSecond = PEAKS_PER_SECOND): Peaks {
  const columns = Math.max(1, Math.ceil(seconds * perSecond));
  return { perSecond, min: new Float32Array(columns), max: new Float32Array(columns) };
}

/**
 * Fill columns [from, to) of `peaks` from the sound's channels. Done in stretches (an idle
 * callback at a time) so a long file doesn't stall the page.
 */
export function fillPeaks(peaks: Peaks, channels: ReadonlyArray<Float32Array>, sampleRate: number, from: number, to: number): void {
  const perColumn = sampleRate / peaks.perSecond;
  const end = Math.min(to, peaks.min.length);
  for (let c = from; c < end; c++) {
    const i0 = Math.floor(c * perColumn);
    const i1 = Math.min(Math.floor((c + 1) * perColumn), channels[0].length);
    let lo = 0;
    let hi = 0;
    for (const data of channels) {
      for (let i = i0; i < i1; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        else if (v > hi) hi = v;
      }
    }
    peaks.min[c] = lo;
    peaks.max[c] = hi;
  }
}

/** Most columns one path draws: past this, each column covers more than a pixel. */
const MAX_PATH_COLUMNS = 8192;

/**
 * The outline of the peaks between `fromSeconds` and `toSeconds` as an SVG path `width` px wide and
 * `height` px tall, centred: the top edge left to right, then the bottom edge back. Columns past
 * the end of the sound are flat. A line at least a pixel tall is drawn where the sound is silent,
 * so an empty stretch still shows as a clip.
 */
export function waveformPath(peaks: Peaks, fromSeconds: number, toSeconds: number, width: number, height: number, gain = 1): string {
  const w = Math.max(1, Math.floor(width));
  const columns = Math.min(w, MAX_PATH_COLUMNS);
  const step = w / columns;
  const mid = height / 2;
  const scale = (height / 2) * gain;
  const seconds = Math.max(toSeconds - fromSeconds, 1e-9);
  const top: string[] = [];
  const bottom: string[] = [];
  for (let k = 0; k < columns; k++) {
    const x0 = Math.round(k * step);
    const c0 = Math.floor((fromSeconds + (k * step * seconds) / w) * peaks.perSecond);
    const c1 = Math.max(c0 + 1, Math.ceil((fromSeconds + ((k + 1) * step * seconds) / w) * peaks.perSecond));
    let lo = 0;
    let hi = 0;
    for (let c = Math.max(0, c0); c < Math.min(c1, peaks.min.length); c++) {
      if (peaks.min[c] < lo) lo = peaks.min[c];
      if (peaks.max[c] > hi) hi = peaks.max[c];
    }
    // Clipped at the edges (a gain above 0 dB can push peaks past them)
    const yTop = Math.max(0, Math.min(mid - 0.5, mid - hi * scale));
    const yBottom = Math.min(height, Math.max(mid + 0.5, mid - lo * scale));
    top.push(`${k === 0 ? 'M' : 'L'}${x0} ${yTop.toFixed(1)}`);
    bottom.push(`L${x0} ${yBottom.toFixed(1)}`);
  }
  // Close the last column at the right edge
  const last = top[top.length - 1].slice(top[top.length - 1].indexOf(' ') + 1);
  const lastBottom = bottom[bottom.length - 1].slice(bottom[bottom.length - 1].indexOf(' ') + 1);
  return `${top.join('')}L${w} ${last}L${w} ${lastBottom}${bottom.reverse().join('')}z`;
}
