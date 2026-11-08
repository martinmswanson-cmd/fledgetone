/**
 * Every shaper in the app as late at every sample rate as at 44.1 kHz. The browser's oversampling
 * WaveShaperNode holds its sound back a fixed number of samples (Chromium: 192 at 4x, 128 at 2x,
 * none without), so a different time at each rate: a 4x shaper is 4.35 ms late at 44.1 kHz, 4.0 at
 * 48, 2.0 at 96 and 6.0 at 32. The sounds and inserts were voiced at 44.1 kHz (the default
 * export), so elsewhere a driven part met a clean part of the same sound a little apart (the 808
 * Bass's dry and driven halves, Wobble and Growl's clean subs, the Sub enhancer's sine under any
 * driven bass or Synth Designer patch, an FX impact's noise burst), and their low notes added or
 * cancelled by how far: the 808 was 6 dB louder on its attack at 96 kHz, a driven Synth Designer ladder
 * bass with the Sub enhancer 11 dB. And every track with a shaper (a Distortion or Saturation
 * insert, a guitar amp, a Drum Rack pad's drive) reached the mix at another moment against the
 * others: a guitar through its amp 2.4 ms sooner at 96 kHz.
 *
 * heldShaper says how to make a shaper as late at `rate` as at 44.1 kHz: from 44.1 kHz up (every
 * export), its own oversampling and a delay line after it making up the difference, in whole
 * samples. Below 44.1 kHz (a computer can play at 32 kHz; no export does) the same oversampling
 * would be later: there it takes the most oversampling that's no later (4x becomes 2x at 32 kHz)
 * and a delay line making up the rest, but no less than its `floor`, and under 32 kHz no less than
 * 2x. Oversampling less lets more of what a hard drive makes above the top of hearing fold back
 * down as fizz: at 32 kHz nothing heard on a bass, a guitar or the inserts, but on a bright,
 * hard-driven Synth Designer note from C4 up 9 to 14 dB more, and with none at all at 22 kHz,
 * 14 to 20 dB more on a bright bass. So the basses (the 808s, Slap, Wobble, Growl, Reese, the FX's
 * low hits) and the Synth Designer's notes up to C3 may drop to none; the inserts, the amps and a
 * Drum Rack pad to 2x; the Synth Designer's notes above C3 keep their own. Where its floor is later
 * than at 44.1 kHz, a shaper is that much later (`late`: 1.7 ms a 4x shaper at 32 kHz). Nothing
 * that isn't shaped is ever held back, so no note starts at another moment. At 44.1 kHz nothing is
 * added or changed, so a 44.1 kHz export is the same, sample for sample. No audio engine here (the
 * nodes are made on the context given), so Node can test it.
 */

export type Oversampling = 'none' | '2x' | '4x';

/** Samples a WaveShaperNode holds its sound back, by oversampling (Chromium's; Firefox's are about the same). */
export const SHAPER_FRAMES: Record<Oversampling, number> = { none: 0, '2x': 128, '4x': 192 };

/** The rate the sounds were voiced at (the default export's): every rate keeps each shaper as late as here. */
export const VOICED_RATE = 44100;

/** From most oversampling to least. */
const LESS: readonly Oversampling[] = ['4x', '2x', 'none'];

/** Under this rate no shaper oversamples less than 2x (see the top): a sound's top is too near the context's. */
const NONE_FROM_RATE = 32000;

/** How a shaper plays at a rate (see heldShaper). */
export interface HeldShaper {
  /** Its oversampling there */
  oversample: Oversampling;
  /** Whole samples to hold its sound back after it (0: nothing to add) */
  frames: number;
  /** The same in seconds */
  seconds: number;
  /** Seconds later than at 44.1 kHz (only below it, where its floor is later there: else 0) */
  late: number;
}

/**
 * How `count` shapers one after another, each voiced at 44.1 kHz with `voiced` oversampling, play at
 * `rate` so they're as late in all as at 44.1 kHz: each one's oversampling there, and the whole
 * samples to hold the sound back after them (nearest the exact time: within half a sample).
 * `late`: samples each is to be late at 44.1 kHz, its own delay unless the sound was voiced on
 * another (a guitar amp's 2x stages are held back as 4x ones would be: see samplerManager.ts).
 * `floor`: the least oversampling it may take below 44.1 kHz (see the top; under 32 kHz, at least
 * 2x); where even that is later there, it takes that, and is late by the rest.
 */
export function heldShaper(voiced: Oversampling, rate: number, count = 1, late = SHAPER_FRAMES[voiced], floor: Oversampling = '2x'): HeldShaper {
  // Samples each is to be late here
  const target = (late * rate) / VOICED_RATE;
  const from = LESS.indexOf(voiced);
  const least = floor === 'none' && rate < NONE_FROM_RATE ? '2x' : floor;
  const allowed = LESS.slice(from, Math.max(from, LESS.indexOf(least)) + 1);
  const oversample = allowed.find((o) => SHAPER_FRAMES[o] <= target + 1e-9) ?? allowed[allowed.length - 1];
  const frames = Math.max(0, Math.round(count * target) - count * SHAPER_FRAMES[oversample]);
  const behind = (count * SHAPER_FRAMES[oversample] + frames) / rate - (count * late) / VOICED_RATE;
  return { oversample, frames, seconds: frames / rate, late: behind > 0.5 / rate ? behind : 0 };
}

/** Seconds `count` shapers voiced with `voiced` oversampling (each late by `late` samples there) hold the sound back at every rate: as at 44.1 kHz. */
export const shaperSeconds = (voiced: Oversampling, count = 1, late = SHAPER_FRAMES[voiced]): number => (count * late) / VOICED_RATE;

/** A shaper and what follows it to hold its sound back (see holdShaper): play into `input`, take the sound from `output`; every node made, to let go with it. */
export interface HeldNodes {
  input: AudioNode;
  output: AudioNode;
  nodes: AudioNode[];
  /** Seconds later than at 44.1 kHz (see HeldShaper) */
  late: number;
}

/**
 * `shaper`, voiced at 44.1 kHz with `voiced` oversampling, made as late at its context's rate as
 * there (see heldShaper, and its `floor`): its oversampling here, and a delay line after it making
 * up the rest. At 44.1 kHz just the shaper, as it was.
 */
export function holdShaper(raw: BaseAudioContext, shaper: WaveShaperNode, voiced: Oversampling, floor: Oversampling = '2x'): HeldNodes {
  const { oversample, seconds, late } = heldShaper(voiced, raw.sampleRate, 1, undefined, floor);
  shaper.oversample = oversample;
  if (!(seconds > 0)) return { input: shaper, output: shaper, nodes: [shaper], late };
  const hold = fixedLate(raw, seconds);
  shaper.connect(hold);
  return { input: shaper, output: hold, nodes: [shaper, hold], late };
}

/** A delay line holding its sound back `seconds`. */
export function fixedLate(raw: BaseAudioContext, seconds: number): DelayNode {
  const late = raw.createDelay(Math.max(0.01, seconds));
  late.delayTime.value = seconds;
  return late;
}
