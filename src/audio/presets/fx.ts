import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { safely } from '../instruments';
import { FX_NOTES } from '../instrumentCatalog';
import { notLate } from './monotonic';
import { createBus, createDrive, createFilter, createNoise, createOsc, createVoiceSet } from './native';
import type { NativeVoice } from './native';

/**
 * The FX instrument: one transition effect per row (FX_ROWS). Risers, sweeps, the reverse crash,
 * the sub drop and the downlifter stretch to the length of the note (draw a 4-bar note for a
 * 4-bar riser); Impact is a one-shot whatever its length. Each hit is plain Web Audio nodes built
 * for that note (see native.ts), its sweeps scheduled with it.
 */

/** Fade at the end of a sweep that stops dead, so it doesn't click. */
const END_FADE = 0.02;

/** Shortest sweep: a tiny note still makes an audible gesture. */
const MIN_LENGTH = 0.1;

/** How long an Impact rings, whatever the note's length. */
const IMPACT_SECONDS = 3.5;

/** Hits are fed by noise: let go of their nodes a moment after they end (see createVoiceSet). */
const LINGER_SECONDS = 0.5;

type Hit = (raw: BaseAudioContext, start: number, length: number, level: number) => Omit<NativeVoice, 'start'>;

/** A gain with `level` from now on (no automation). */
function gain(raw: BaseAudioContext, level: number): GainNode {
  const g = raw.createGain();
  g.gain.value = level;
  return g;
}

const HITS: Record<string, Hit> = {
  // Noise and a pair of saws rising three octaves, through a low-pass that opens, swelling up to the end
  [FX_NOTES.riser]: (raw, start, length, level) => {
    const end = start + length;
    const noise = createNoise(raw, start);
    const saws = [-12, 12].map((cents) => createOsc(raw, 'sawtooth', 160, start, cents));
    saws.forEach((s) => s.frequency.exponentialRampToValueAtTime(1280, end));
    const sawLevel = gain(raw, 0.22);
    const filter = createFilter(raw, 'lowpass', 400, 5);
    filter.frequency.setValueAtTime(400, start);
    filter.frequency.exponentialRampToValueAtTime(10000, end);
    const amp = raw.createGain();
    const peak = level * 0.75;
    amp.gain.setValueAtTime(peak * 0.02, start);
    amp.gain.exponentialRampToValueAtTime(peak, end);
    amp.gain.linearRampToValueAtTime(0, end + END_FADE);
    noise.connect(filter);
    saws.forEach((s) => s.connect(sawLevel));
    sawLevel.connect(filter);
    filter.connect(amp);
    return { stopAt: end + END_FADE, sources: [noise, ...saws], nodes: [noise, ...saws, sawLevel, filter, amp], amp };
  },

  // White noise through a band-pass sweeping up from 150 Hz to 12 kHz, faded in and out
  [FX_NOTES.noiseSweep]: (raw, start, length, level) => {
    const end = start + length;
    const noise = createNoise(raw, start);
    const filter = createFilter(raw, 'bandpass', 150, 2.5);
    filter.frequency.setValueAtTime(150, start);
    filter.frequency.exponentialRampToValueAtTime(12000, end);
    const amp = raw.createGain();
    // A band-pass passes a sliver of the noise: lift it back up
    const peak = level * 1.25;
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(peak, start + length * 0.4);
    amp.gain.setValueAtTime(peak, start + length * 0.85);
    amp.gain.linearRampToValueAtTime(0, end);
    noise.connect(filter);
    filter.connect(amp);
    return { stopAt: end, sources: [noise], nodes: [noise, filter, amp], amp };
  },

  // A cymbal played backwards: noise swelling in (a reversed exponential decay), brightening, cut at the end
  [FX_NOTES.reverseCrash]: (raw, start, length, level) => {
    const end = start + length;
    const noise = createNoise(raw, start);
    const highpass = createFilter(raw, 'highpass', 600, 0);
    const lowpass = createFilter(raw, 'lowpass', 3000, 0);
    lowpass.frequency.setValueAtTime(3000, start);
    lowpass.frequency.exponentialRampToValueAtTime(16000, end);
    const amp = raw.createGain();
    const peak = level * 0.6;
    amp.gain.setValueAtTime(peak * 0.02, start);
    amp.gain.exponentialRampToValueAtTime(peak, end);
    amp.gain.linearRampToValueAtTime(0, end + END_FADE);
    noise.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(amp);
    return { stopAt: end + END_FADE, sources: [noise], nodes: [noise, highpass, lowpass, amp], amp };
  },

  // Boom (a sine dropping from 140 to 38 Hz, lightly driven) over a burst of noise with a long, darkening tail
  [FX_NOTES.impact]: (raw, start, _length, level) => {
    const end = start + IMPACT_SECONDS;
    const boom = createOsc(raw, 'sine', 140, start);
    boom.frequency.exponentialRampToValueAtTime(38, start + 0.4);
    const boomAmp = raw.createGain();
    boomAmp.gain.setValueAtTime(0, start);
    boomAmp.gain.linearRampToValueAtTime(1, start + 0.004);
    boomAmp.gain.setTargetAtTime(0, start + 0.01, 0.45);
    const drive = createDrive(raw, 2);
    const noise = createNoise(raw, start);
    const noiseFilter = createFilter(raw, 'lowpass', 7000, 0);
    noiseFilter.frequency.setValueAtTime(7000, start);
    noiseFilter.frequency.exponentialRampToValueAtTime(300, start + 1.8);
    const noiseAmp = raw.createGain();
    noiseAmp.gain.setValueAtTime(0, start);
    noiseAmp.gain.linearRampToValueAtTime(0.8, start + 0.002);
    noiseAmp.gain.setTargetAtTime(0, start + 0.004, 0.35);
    const amp = gain(raw, level * 0.55);
    boom.connect(boomAmp);
    boomAmp.connect(drive);
    drive.connect(amp);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseAmp);
    noiseAmp.connect(amp);
    return { stopAt: end, sources: [boom, noise], nodes: [boom, boomAmp, drive, noise, noiseFilter, noiseAmp, amp], amp };
  },

  // A sine falling from 60 to 30 Hz over the note, saturated a little so it reaches small speakers, fading out over its last third
  [FX_NOTES.subDrop]: (raw, start, length, level) => {
    const end = start + length;
    const sine = createOsc(raw, 'sine', 60, start);
    sine.frequency.exponentialRampToValueAtTime(30, end);
    const drive = createDrive(raw, 1.5);
    const amp = raw.createGain();
    // A sustained sub is all energy: kept below the others' peaks so it doesn't swamp the mix
    const peak = level * 0.6;
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(peak, start + 0.01);
    amp.gain.setValueAtTime(peak, start + length * 0.66);
    amp.gain.linearRampToValueAtTime(0, end);
    sine.connect(drive);
    drive.connect(amp);
    return { stopAt: end, sources: [sine], nodes: [sine, drive, amp], amp };
  },

  // The riser in reverse: noise and saws falling, the low-pass closing, fading away over the note
  [FX_NOTES.downlifter]: (raw, start, length, level) => {
    const end = start + length;
    const noise = createNoise(raw, start);
    const saws = [-12, 12].map((cents) => createOsc(raw, 'sawtooth', 1000, start, cents));
    saws.forEach((s) => s.frequency.exponentialRampToValueAtTime(70, end));
    const sawLevel = gain(raw, 0.22);
    const filter = createFilter(raw, 'lowpass', 12000, 5);
    filter.frequency.setValueAtTime(12000, start);
    filter.frequency.exponentialRampToValueAtTime(150, end);
    const amp = raw.createGain();
    const peak = level * 0.5;
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(peak, start + 0.01);
    amp.gain.exponentialRampToValueAtTime(peak * 0.01, end);
    amp.gain.linearRampToValueAtTime(0, end + END_FADE);
    noise.connect(filter);
    saws.forEach((s) => s.connect(sawLevel));
    sawLevel.connect(filter);
    filter.connect(amp);
    return { stopAt: end + END_FADE, sources: [noise, ...saws], nodes: [noise, ...saws, sawLevel, filter, amp], amp };
  },
};

export function createFx(output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw, LINGER_SECONDS);

  const playNote = (n: PlayableNote, start: number) => {
    // Not one of the rows: a note from another instrument (the track's instrument was changed)
    if (!Object.hasOwn(HITS, n.note)) return;
    const hit = HITS[n.note];
    const length = bus.toSeconds(n.duration);
    if (!Number.isFinite(length)) return; // garbled by hand-editing: skip it
    // Above zero: the swells are exponential ramps, which can't start or end at 0
    const voice = hit(raw, start, Math.max(MIN_LENGTH, length), Math.max(0.01, n.velocity));
    voice.amp.connect(input);
    voices.add({ ...voice, start });
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      const start = notLate(bus.context, time);
      for (const n of notes) safely(() => playNote(n, start));
    },
    releaseAll: () => voices.releaseAll(raw.currentTime, 0.1),
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
  };
}
