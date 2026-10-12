import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { safely } from '../instruments';
import { notLate } from './monotonic';
import { createBus, createFilter, createNoise, createOsc, createVoiceSet, noteFrequency, releaseConstant, releaseTail } from './native';
import { HELD_NOTE } from './edmSynths';

/**
 * Chiptune: the sound chips of 8-bit consoles, as plain Web Audio nodes (see native.ts).
 * - Chip Lead: a 25% pulse wave (the classic "NES lead"), a hard gate, and a vibrato that
 *   comes in after the note has sounded a moment.
 * - Chip Bass: the 4-bit stepped triangle those chips played bass lines on: no volume envelope
 *   (the real one had none), so it's gated on and off.
 * - Chip Drums: a pitch-swept kick, noise snare and hats, and a "metallic" periodic noise for
 *   the open hat and the cowbell, the way the chips' noise channel sounded in its short mode.
 */

/** A pulse wave of `duty` (0..1) as a band-limited PeriodicWave. */
function pulseWave(raw: BaseAudioContext, duty: number): PeriodicWave {
  const harmonics = 96;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  return raw.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** The chips' triangle: 32 steps up and down a 16-level staircase, as a PeriodicWave (its DFT). */
function steppedTriangle(raw: BaseAudioContext): PeriodicWave {
  const steps = 32;
  const levels = Array.from({ length: steps }, (_, i) => (i < 16 ? 15 - i : i - 16) / 7.5 - 1);
  const harmonics = 96;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  // Each step holds for 1/32 of the cycle: integrate cos/sin over each
  for (let n = 1; n < harmonics; n++) {
    let re = 0;
    let im = 0;
    for (let k = 0; k < steps; k++) {
      const a = (2 * Math.PI * n * k) / steps;
      const b = (2 * Math.PI * n * (k + 1)) / steps;
      re += levels[k] * (Math.sin(b) - Math.sin(a));
      im += levels[k] * (Math.cos(a) - Math.cos(b));
    }
    real[n] = re / (Math.PI * n);
    imag[n] = im / (Math.PI * n);
  }
  return raw.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** A gated tone instrument (lead or bass) with optional delayed vibrato. */
function createGatedSynth(output: Tone.InputNode, wave: (raw: BaseAudioContext) => PeriodicWave, opts: { level: number; vibratoCents: number; release: number; lowpass: number }) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  const shape = wave(raw);
  // The chips' DACs and the TV's speaker rounded the very top off
  const tone = createFilter(raw, 'lowpass', opts.lowpass, 0.5);
  tone.connect(input);

  const playNote = (n: PlayableNote, start: number) => {
    const length = bus.toSeconds(n.duration);
    const freq = noteFrequency(n.note);
    if (!Number.isFinite(length) || !(freq > 0)) return;
    const end = start + Math.max(0.01, length);
    const osc = createOsc(raw, shape, freq, start);
    const amp = raw.createGain();
    // Velocity in 16 steps, like the chips' 4-bit volume register
    const level = opts.level * Math.max(1 / 16, Math.ceil(n.velocity * 16) / 16);
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(level, start + 0.002);
    amp.gain.setTargetAtTime(0, end, releaseConstant(opts.release));
    const nodes: AudioNode[] = [osc, amp];
    const sources: AudioScheduledSourceNode[] = [osc];
    if (opts.vibratoCents > 0 && length > 0.25) {
      // Vibrato after a moment, at 6 Hz, as trackers did it
      const lfo = createOsc(raw, 'triangle', 6, start);
      const depth = raw.createGain();
      depth.gain.setValueAtTime(0, start);
      depth.gain.setValueAtTime(0, start + 0.18);
      depth.gain.linearRampToValueAtTime(opts.vibratoCents, start + 0.35);
      lfo.connect(depth);
      depth.connect(osc.detune);
      nodes.push(lfo, depth);
      sources.push(lfo);
    }
    osc.connect(amp);
    amp.connect(tone);
    const voice = { start, stopAt: end + releaseTail(opts.release), sources, nodes, amp };
    voices.add(voice);
    return voice;
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      const start = notLate(bus.context, time);
      for (const n of notes) safely(() => playNote(n, start));
    },
    hold: (note: PlayableNote, time: number) => {
      const voice = playNote({ ...note, duration: HELD_NOTE }, notLate(bus.context, time));
      return (at: number) => {
        if (voice) voices.release(voice, notLate(bus.context, at), opts.release);
      };
    },
    releaseAll: () => voices.releaseAll(raw.currentTime),
    dispose: () => {
      voices.stopAll();
      tone.disconnect();
      bus.dispose();
    },
  };
}

export const createChipLead = (output: Tone.InputNode) =>
  createGatedSynth(output, (raw) => pulseWave(raw, 0.25), { level: 0.28, vibratoCents: 25, release: 0.04, lowpass: 9000 });

export const createChipBass = (output: Tone.InputNode) =>
  createGatedSynth(output, steppedTriangle, { level: 0.5, vibratoCents: 0, release: 0.015, lowpass: 7000 });

/** A short buffer of random levels, looped: the noise channel's metallic "short mode". */
function metallicNoise(raw: BaseAudioContext, at: number, rate: number): AudioBufferSourceNode {
  const length = 93;
  const buffer = raw.createBuffer(1, length, raw.sampleRate);
  const data = buffer.getChannelData(0);
  let lfsr = 1;
  for (let i = 0; i < length; i++) {
    // A 15-bit shift register tapped at bit 6, as the chip did
    const bit = (lfsr ^ (lfsr >> 6)) & 1;
    lfsr = (lfsr >> 1) | (bit << 14);
    data[i] = lfsr & 1 ? 0.8 : -0.8;
  }
  const src = raw.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(at);
  return src;
}

/** The kit, with the same hits as the other drum kits (kick, snare, hats, cowbell). */
export function createChipDrums(output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);

  const hit = (sources: AudioScheduledSourceNode[], nodes: AudioNode[], amp: GainNode, start: number, seconds: number) => {
    voices.add({ start, stopAt: start + seconds, sources, nodes, amp });
  };

  const kick = (time: number, velocity: number) => {
    const t = notLate(bus.context, time);
    // A square sweeping down fast, then the triangle's thump
    const sq = createOsc(raw, 'square', 300, t);
    sq.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    const amp = raw.createGain();
    amp.gain.setValueAtTime(0.55 * velocity, t);
    amp.gain.setTargetAtTime(0, t + 0.02, 0.05);
    const lp = createFilter(raw, 'lowpass', 1800, 0.7);
    sq.connect(lp);
    lp.connect(amp);
    amp.connect(input);
    hit([sq], [sq, lp, amp], amp, t, 0.4);
  };

  const snare = (time: number, velocity: number) => {
    const t = notLate(bus.context, time);
    const noise = createNoise(raw, t);
    const hp = createFilter(raw, 'highpass', 1200, 0.7);
    const amp = raw.createGain();
    amp.gain.setValueAtTime(0.5 * velocity, t);
    amp.gain.setTargetAtTime(0, t + 0.01, 0.045);
    const tone = createOsc(raw, 'square', 220, t);
    tone.frequency.exponentialRampToValueAtTime(140, t + 0.05);
    const toneAmp = raw.createGain();
    toneAmp.gain.setValueAtTime(0.18 * velocity, t);
    toneAmp.gain.setTargetAtTime(0, t, 0.025);
    noise.connect(hp);
    hp.connect(amp);
    tone.connect(toneAmp);
    amp.connect(input);
    toneAmp.connect(input);
    hit([noise, tone], [noise, hp, amp, tone, toneAmp], amp, t, 0.35);
  };

  const hat = (open: boolean, time: number, velocity: number) => {
    const t = notLate(bus.context, time);
    const src = open ? metallicNoise(raw, t, 2.2) : createNoise(raw, t);
    const hp = createFilter(raw, 'highpass', open ? 5000 : 7500, 0.7);
    const amp = raw.createGain();
    amp.gain.setValueAtTime((open ? 0.22 : 0.3) * velocity, t);
    amp.gain.setTargetAtTime(0, t + 0.005, open ? 0.09 : 0.012);
    src.connect(hp);
    hp.connect(amp);
    amp.connect(input);
    hit([src], [src, hp, amp], amp, t, open ? 0.6 : 0.12);
  };

  const cowbell = (time: number, velocity: number) => {
    const t = notLate(bus.context, time);
    const src = metallicNoise(raw, t, 0.9);
    const bp = createFilter(raw, 'bandpass', 900, 3);
    const amp = raw.createGain();
    amp.gain.setValueAtTime(0.35 * velocity, t);
    amp.gain.setTargetAtTime(0, t + 0.01, 0.06);
    src.connect(bp);
    bp.connect(amp);
    amp.connect(input);
    hit([src], [src, bp, amp], amp, t, 0.4);
  };

  return {
    kick,
    snare,
    hat,
    cowbell,
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
  };
}
