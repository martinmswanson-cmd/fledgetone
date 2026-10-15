import * as Tone from 'tone';
import type { BassDriveFx } from '../../store/bassTools';
import { driveCurveFor, driveMakeup } from '../driveCurves';
import { smoothSet } from './smoothParam';
import { writeTime, type LightInsert } from './lightFx';
import { BASS_DRIVE_FRAMES } from '../delayCompensation';

/**
 * The Bass Drive insert: the standard heavy-bass trick of distorting a bass's mids and highs while
 * its sub stays clean. The sound is split at the crossover by a Linkwitz-Riley pair (two
 * Butterworth low-passes against two high-passes: put back together they sum flat). Below it: folded
 * to mono and passed through untouched. Above it: distorted (4x oversampled, so the harmonics the
 * clipping makes above hearing don't fold back down as fizz), darkened by a tone low-pass, cut
 * below the crossover again (distortion's difference tones would land in the sub), and mixed with
 * the clean highs.
 *
 * The oversampled shaper delays the distorted part by BASS_DRIVE_FRAMES, so the sub and the clean
 * highs are held back by exactly as much (or the bands would comb against each other where they
 * meet, and the dry/wet mix with them). The track's delay compensation counts the same delay.
 */

export interface BassDriveUnit extends LightInsert {
  set: (settings: BassDriveFx, ramp?: number) => void;
}

/**
 * One Butterworth stage of a crossover. A low- or high-pass BiquadFilterNode reads its Q in dB (a
 * resonance), not as a plain Q: a Butterworth's Q of 1/sqrt(2) is -3.01 dB there. (Set to 0.707,
 * the two bands overlapped by 2 dB to 6 dB around the crossover.)
 */
const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);
const lr = (raw: BaseAudioContext, type: BiquadFilterType, hz: number) => {
  const f = raw.createBiquadFilter();
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = BUTTERWORTH_Q_DB;
  return f;
};

export function createBassDrive(initial: BassDriveFx): BassDriveUnit {
  const input = new Tone.Gain(1);
  const output = new Tone.Gain(1);
  const raw = input.context.rawContext as unknown as BaseAudioContext;
  const into = input.input as unknown as AudioNode;
  const out = output.input as unknown as AudioNode;
  const lag = BASS_DRIVE_FRAMES / raw.sampleRate;

  // Below the crossover: clean and mono
  const lp1 = lr(raw, 'lowpass', initial.crossover);
  const lp2 = lr(raw, 'lowpass', initial.crossover);
  const mono = raw.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  const lowLag = raw.createDelay(0.05);
  lowLag.delayTime.value = lag;
  // Above it: clean and distorted, mixed
  const hp1 = lr(raw, 'highpass', initial.crossover);
  const hp2 = lr(raw, 'highpass', initial.crossover);
  const dryLag = raw.createDelay(0.05);
  dryLag.delayTime.value = lag;
  const dry = raw.createGain();
  const shaper = raw.createWaveShaper();
  shaper.oversample = '4x';
  const tone = raw.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = BUTTERWORTH_Q_DB;
  // Distorting a chord of detuned saws makes difference tones below the crossover too (their
  // beating, as a rumble): cut again after the shaper, so the sub really stays clean
  const clean = lr(raw, 'highpass', initial.crossover);
  const wet = raw.createGain();

  into.connect(lp1);
  lp1.connect(lp2).connect(mono).connect(lowLag).connect(out);
  into.connect(hp1);
  hp1.connect(hp2);
  hp2.connect(dryLag).connect(dry).connect(out);
  hp2.connect(shaper).connect(tone).connect(clean).connect(wet).connect(out);

  let applied: BassDriveFx | null = null;
  const set = (s: BassDriveFx, ramp = 0.02) => {
    const first = applied === null;
    const now = writeTime(raw);
    const glide = (param: AudioParam, value: number) => {
      if (first) param.value = value;
      else smoothSet(param, value, now, ramp / 3);
    };
    if (first || s.drive !== applied!.drive || s.character !== applied!.character) {
      // Made up for a sine of 0.3 (set by measuring reese and sub basses): the sub stays where it
      // was and the mids come up about 6 dB, a little louder overall, much louder on a phone
      shaper.curve = driveCurveFor(s.character, s.drive, driveMakeup(s.character, s.drive, 0.3));
    }
    for (const f of [lp1, lp2, hp1, hp2, clean]) glide(f.frequency, s.crossover);
    glide(tone.frequency, s.tone);
    glide(dry.gain, 1 - s.mix);
    glide(wet.gain, s.mix);
    applied = { ...s };
  };
  set(initial);

  return {
    input,
    output,
    set,
    dispose: () => {
      [lp1, lp2, mono, lowLag, hp1, hp2, dryLag, dry, shaper, tone, clean, wet].forEach((n) => n.disconnect());
      input.dispose();
      output.dispose();
    },
  };
}
