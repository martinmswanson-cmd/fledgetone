/**
 * The stereo picture of a sound for the hearing report: how alike the two channels are, which is
 * louder, what mono would lose, and how much of each region sits in the sides rather than the middle.
 * Plain maths on samples, no Web Audio, so Node can test it.
 */
import { levelBetween, REGIONS, type BandSpectrum } from '../mixAnalysis';
import { db } from './frames';
import type { Stereo } from './types';

const round1 = (x: number) => Math.round(x * 10) / 10;
const WIDTH_FLOOR_DB = -60;
/** A band spectrum level under this is silence (the spectrum reads empty bands as -200). */
const SILENT_DB = -150;

/** The sides' level over the middle's across `lo` to `hi` Hz, dB, floored; the floor when both are silent. */
function sideOverMid(spectrum: BandSpectrum, lo: number, hi: number): number {
  const mid = levelBetween(spectrum, spectrum.mid, lo, hi);
  const side = levelBetween(spectrum, spectrum.side, lo, hi);
  if (!Number.isFinite(mid) || !Number.isFinite(side) || (mid < SILENT_DB && side < SILENT_DB)) return WIDTH_FLOOR_DB;
  return round1(Math.max(WIDTH_FLOOR_DB, side - mid));
}

/** The stereo picture of a pair of channels; null for one channel. `spectrum` is the sound's band spectrum. */
export function stereoOf(channels: readonly Float32Array[], _sampleRate: number, spectrum: BandSpectrum): Stereo | null {
  if (channels.length < 2) return null;
  const [l, r] = channels;
  const n = Math.min(l.length, r.length);
  let sl = 0;
  let sr = 0;
  let sll = 0;
  let srr = 0;
  let slr = 0;
  let smm = 0;
  for (let i = 0; i < n; i++) {
    const a = l[i];
    const b = r[i];
    sl += a;
    sr += b;
    sll += a * a;
    srr += b * b;
    slr += a * b;
    smm += ((a + b) / 2) ** 2;
  }
  let correlation = 1;
  if (n > 0) {
    const cov = slr - (sl * sr) / n;
    const vl = sll - (sl * sl) / n;
    const vr = srr - (sr * sr) / n;
    if (vl > 1e-20 && vr > 1e-20) correlation = Math.max(-1, Math.min(1, cov / Math.sqrt(vl * vr)));
  }
  const balanceDb = n > 0 ? db(sll / n) - db(srr / n) : 0;
  const meanPower = (sll + srr) / 2 / Math.max(1, n);
  const monoLossDb = meanPower > 0 ? Math.max(-60, Math.min(0, db(smm / Math.max(1, n)) - db(meanPower))) : 0;
  return {
    correlation: Math.round(correlation * 100) / 100,
    balanceDb: round1(balanceDb),
    monoLossDb: round1(monoLossDb),
    width: REGIONS.map((x) => ({ name: x.name, db: sideOverMid(spectrum, x.lo, x.hi) })),
    lowSideDb: sideOverMid(spectrum, 20, 120),
  };
}
