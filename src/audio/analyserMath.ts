/**
 * The spectrum analyser's maths: an analyser's bins (level in dB at evenly spaced frequencies)
 * laid out along a logarithmic frequency axis, a column a pixel, as hearing spaces pitches. Down
 * low a bin is many pixels wide (the level between two bins is drawn as a line between them); up
 * high a pixel holds many bins (the loudest of them is drawn, so a narrow peak never falls between
 * pixels). Plain maths, so Node can unit-test it.
 */

export const ANALYSER_LOW_HZ = 20;
export const ANALYSER_HIGH_HZ = 20000;
/** The quietest and loudest levels drawn, dBFS */
export const ANALYSER_FLOOR_DB = -96;
export const ANALYSER_TOP_DB = 0;

/** Where `hz` sits along an axis `width` wide. */
export const analyserX = (hz: number, width: number): number => (Math.log(hz / ANALYSER_LOW_HZ) / Math.log(ANALYSER_HIGH_HZ / ANALYSER_LOW_HZ)) * width;
/** The frequency at `x` along an axis `width` wide. */
export const analyserHz = (x: number, width: number): number => ANALYSER_LOW_HZ * (ANALYSER_HIGH_HZ / ANALYSER_LOW_HZ) ** (x / width);
/** Where a level sits on an axis `height` tall (0 at the top). */
export const analyserY = (db: number, height: number): number => height * (1 - (Math.max(ANALYSER_FLOOR_DB, Math.min(ANALYSER_TOP_DB, db)) - ANALYSER_FLOOR_DB) / (ANALYSER_TOP_DB - ANALYSER_FLOOR_DB));

/**
 * `bins` (the first `count`: dB at 0 Hz up to just under half of `rate`) as a level for each of
 * `out.length` columns. A level that isn't a number (a track asleep reads minus infinity) is the floor.
 */
export function spectrumColumns(bins: ArrayLike<number>, count: number, rate: number, out: Float32Array): void {
  const width = out.length;
  const perBin = rate / 2 / count;
  const at = (k: number) => {
    const v = bins[Math.max(0, Math.min(count - 1, k))];
    return Number.isFinite(v) ? Math.max(ANALYSER_FLOOR_DB, v) : ANALYSER_FLOOR_DB;
  };
  for (let x = 0; x < width; x++) {
    const from = analyserHz(x, width) / perBin;
    const to = analyserHz(x + 1, width) / perBin;
    const first = Math.ceil(from);
    const last = Math.floor(to);
    if (last >= first) {
      let top = ANALYSER_FLOOR_DB;
      for (let k = first; k <= last && k < count; k++) top = Math.max(top, at(k));
      out[x] = top;
    } else {
      // Between two bins: a line from one to the other
      const mid = (from + to) / 2;
      const lower = Math.floor(mid);
      out[x] = at(lower) + (at(lower + 1) - at(lower)) * (mid - lower);
    }
  }
}

/** The loudest column and its frequency (the middle of the column), or null if nothing is above the floor. */
export function loudestColumn(columns: ArrayLike<number>): { hz: number; db: number } | null {
  let best = -1;
  for (let x = 0; x < columns.length; x++) if (columns[x] > ANALYSER_FLOOR_DB + 6 && (best < 0 || columns[x] > columns[best])) best = x;
  return best < 0 ? null : { hz: analyserHz(best + 0.5, columns.length), db: columns[best] };
}

/** "440 Hz", "1.25 kHz", "12.5 kHz" */
export const hzText = (hz: number): string => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`);
