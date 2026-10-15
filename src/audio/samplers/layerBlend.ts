/**
 * How a recorded instrument blends two of a note's loudnesses (near a loudness boundary, or under
 * the mod wheel): the softer recording's and the louder one's levels across the blend. Pure, so
 * Node can test it; samplerManager.ts uses it.
 *
 * Two recordings of one note aren't the same sound, and aren't wholly different either: lined up
 * (scripts/real-samples/convert.py aligns each note's recordings), they move together about half
 * the time. Equal-power blending (cos/sin) assumes they never do: blended in step, the middle came
 * out up to 3 dB louder than either end, so a velocity just past the boundary was quieter than one
 * just before it; a plain crossfade assumes they always do, and dips 3 dB when they don't. These
 * curves keep the level steady for recordings half alike (each at 1/sqrt(3) in the middle), and
 * within about a decibel either way for any two recordings that are lined up. Where how alike two
 * recordings are is known (their correlation over their start, see correlationOf), blendFor scales
 * the curves so the blend is exactly as loud as either end: some lined-up pairs still move against
 * each other (a held horn note's vibrato), and blended plainly came out up to 4 dB quieter.
 */

/** cos^K / sin^K: K puts both at 1/sqrt(3) in the middle (constant power for a correlation of 0.5) */
const K = Math.log(Math.sqrt(3)) / Math.log(Math.SQRT2);

/** The softer and the louder recording's levels at `x` (0: all the softer, 1: all the louder). */
export function layerBlend(x: number): [soft: number, loud: number] {
  const t = (Math.max(0, Math.min(1, x)) * Math.PI) / 2;
  return [Math.cos(t) ** K, Math.sin(t) ** K];
}

/** How much of two recordings' start is compared to tell how alike they are (seconds) */
export const CORRELATION_SECONDS = 0.3;

/**
 * How alike two recordings' starts are, -1 to 1 (1: the same sound): their correlation over the
 * first CORRELATION_SECONDS, channel by channel.
 */
export function correlationOf(a: Float32Array[], b: Float32Array[], sampleRate: number): number {
  const n = Math.min(a[0].length, b[0].length, Math.round(CORRELATION_SECONDS * sampleRate));
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let c = 0; c < Math.max(a.length, b.length); c++) {
    const x = a[Math.min(c, a.length - 1)];
    const y = b[Math.min(c, b.length - 1)];
    for (let i = 0; i < n; i++) {
      ab += x[i] * y[i];
      aa += x[i] * x[i];
      bb += y[i] * y[i];
    }
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * The softer and the louder recording's levels at `x` for two recordings `rho` alike (see
 * correlationOf): layerBlend's curves, scaled so two equally loud recordings blend exactly as loud
 * as either alone (at most twice as loud, where they nearly cancel).
 */
export function blendFor(x: number, rho: number): [soft: number, loud: number] {
  const [a, b] = layerBlend(x);
  const power = a * a + b * b + 2 * Math.max(-1, Math.min(1, rho)) * a * b;
  const k = Math.min(2, 1 / Math.sqrt(Math.max(0.25, power)));
  return [a * k, b * k];
}
