import * as Tone from 'tone';
import { liveMix } from './engine';
import { bandsFromBins } from './spectrumSkins';

/**
 * The master spectrum: an analyser listening to what the speakers get (after the master volume),
 * for the spectrum readouts (spectrumSkins.ts). It's connected only while something shows it
 * (watchMasterSpectrum), so it costs nothing when hidden.
 */

let analyser: AnalyserNode | null = null;
let users = 0;
let bins: Float32Array<ArrayBuffer> | null = null;

const context = () => liveMix.bus.context;
const tap = () => context().destination.output!;

/** Start listening; call the returned function to stop. */
export function watchMasterSpectrum(): () => void {
  users++;
  if (!analyser) {
    const raw = context().rawContext as unknown as BaseAudioContext;
    analyser = raw.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.5;
    bins = new Float32Array(analyser.frequencyBinCount);
    Tone.connect(tap(), analyser);
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    users--;
    if (users === 0 && analyser) {
      try {
        Tone.disconnect(tap(), analyser);
      } catch {
        // Already gone
      }
      analyser = null;
      bins = null;
    }
  };
}

/** Fill `out` with the master's spectrum as bands (0 to 1, lows first); false when not watching. */
export function readMasterBands(out: Float32Array): boolean {
  if (!analyser || !bins) return false;
  analyser.getFloatFrequencyData(bins);
  bandsFromBins(bins, bins.length, analyser.context.sampleRate, out);
  return true;
}

/** The master's spectrum as the analyser has it (dB per bin) into `out`; the bin count, or 0 when not watching. */
export function readMasterBins(out: Float32Array): number {
  if (!analyser || out.length < analyser.frequencyBinCount) return 0;
  analyser.getFloatFrequencyData(out.subarray(0, analyser.frequencyBinCount) as Float32Array<ArrayBuffer>);
  return analyser.frequencyBinCount;
}

/** The master's sound now (its last samples) into `out`; how many, or 0 when not watching. */
export function readMasterWaveform(out: Float32Array): number {
  if (!analyser) return 0;
  const n = Math.min(out.length, analyser.fftSize);
  analyser.getFloatTimeDomainData(out.subarray(0, n) as Float32Array<ArrayBuffer>);
  return n;
}
