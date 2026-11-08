/**
 * The browser's oversampling WaveShaperNode holds its sound back a fixed number of samples
 * (Chromium: 192 at 4x, 128 at 2x), so a different time at each sample rate: 4.35 ms at 44.1 kHz,
 * 4.0 at 48, 2.0 at 96. Where a driven part plays beside a clean part of the same sound (the 808
 * Bass's dry and driven halves, its Expressive voice's clean sub; Wobble and Growl Bass's clean
 * sub under their driven saws; the Sub enhancer's sine under a driven bass), the two meet a
 * little apart, and their low notes add or cancel by how far: the 808 was 3.4 dB louder (6 dB on
 * its attack) at 96 kHz than at 44.1 kHz, and 0.7 dB on a 48 kHz computer, where a song plays live.
 *
 * The sounds were voiced at 44.1 kHz, the default export: at every rate the driven part is kept as
 * late against the clean one as it is there. Above 44.1 kHz the driven part is held back the
 * difference (the clean part, the note's start, untouched, so nothing starts at another moment);
 * below it (a computer can play at 32 kHz; no export does) the clean part is held back instead.
 * Pure (no Web Audio), so Node can test it.
 */

/** Samples a WaveShaperNode oversampling 4x holds its sound back (Chromium; Firefox's is about the same). */
export const SHAPER_4X_FRAMES = 192;

/** The rate the sounds were voiced at (the default export's): every rate keeps the driven part as late as here. */
export const VOICED_RATE = 44100;

/**
 * Seconds to hold back a driven part (`driven`) and its clean part (`clean`) at `rate`, where the
 * driven part goes through shapers holding it back `frames` samples in all: one of them 0.
 */
export function shaperLag(frames: number, rate: number): { driven: number; clean: number } {
  const voiced = frames / VOICED_RATE;
  const here = frames / rate;
  return here <= voiced ? { driven: voiced - here, clean: 0 } : { driven: 0, clean: here - voiced };
}
