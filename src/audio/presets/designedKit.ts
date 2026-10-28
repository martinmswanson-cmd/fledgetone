import * as Tone from 'tone';
import { notLate } from './monotonic';
import { createBus, createVoiceSet } from './native';
import type { NativeVoice } from './native';
import { renderDrumSound, renderDrumStereo } from '../drumSynth';
import { noiseKey } from '../seededNoise';
import { soundForRow } from '../../store/drumDesign';
import type { DesignRow, DrumDesign } from '../../store/drumDesign';

/**
 * The Designed Kit: every drum row plays the sound designed for it in the Drum Designer
 * (Track.drumDesign, or the row's default preset). Each row's sound is rendered once, in plain
 * maths (drumSynth.ts), at the rate of the context it plays in, and kept; a hit is one buffer
 * source and one gain, so a dense hat roll costs next to nothing, and the same buffer plays live
 * and in an export, so the two sound exactly alike. Changing a sound renders that row again at its
 * next hit (the others are kept).
 *
 * The closed and open hats are one hi-hat, as on a real kit and the synthesized kits: a hat hit
 * chokes the open hat still ringing.
 *
 * The hats, cymbals and shakers play in stereo (renderDrumStereo: their noise a little different
 * on each side, the mono sound unchanged), everything else in mono. The track strip keeps that
 * width only above its crossover (see trackStrip.ts), so the kit's lows and mids stay in the middle.
 */

/** How long a choked hat takes to fall silent, seconds */
const CHOKE = 0.012;

/** A rendered sound: one channel, or the left and right of a stereo one. */
type Rendered = Float32Array[];
/** Rendered sounds, by rate, seed, row and settings: shared by every Designed Kit (and an export at the same rate reuses the live ones). */
const rendered = new Map<string, Rendered>();
/** Rendered sounds kept at most (the oldest go first) */
const MAX_RENDERED = 96;

function samplesFor(row: DesignRow, design: DrumDesign | undefined, sampleRate: number, seed: number): Rendered {
  const sound = soundForRow(design, row);
  const key = `${sampleRate}|${seed}|${row}|${JSON.stringify(sound.layers)}|${sound.level}`;
  let x = rendered.get(key);
  if (!x) {
    const noise = noiseKey(seed, `designed-${row}`);
    const stereo = renderDrumStereo(sound, row, sampleRate, noise);
    x = stereo ? [stereo.left, stereo.right] : [renderDrumSound(sound, row, sampleRate, noise)];
    if (rendered.size >= MAX_RENDERED) rendered.delete(rendered.keys().next().value!);
    rendered.set(key, x);
  }
  return x;
}

/** `seed`: the track's (see trackSeed), which picks each row's noise. */
export function createDesignedKit(output: Tone.InputNode, design: DrumDesign | undefined, seed = 0) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  let current = design;
  /** Each row's buffer for the current design (dropped when its sound changes) */
  const buffers = new Map<DesignRow, { samples: Rendered; buffer: AudioBuffer }>();
  /** The hats still ringing, for the choke */
  let hats: NativeVoice[] = [];

  const bufferFor = (row: DesignRow): AudioBuffer => {
    const samples = samplesFor(row, current, raw.sampleRate, seed);
    const had = buffers.get(row);
    if (had?.samples === samples) return had.buffer;
    const buffer = raw.createBuffer(samples.length, samples[0].length, raw.sampleRate);
    samples.forEach((x, c) => buffer.copyToChannel(x as Float32Array<ArrayBuffer>, c));
    buffers.set(row, { samples, buffer });
    return buffer;
  };

  /** Play `row` at `time`: `velocity` 0 to 1, `ratio` its pitch as a playback rate (1: as designed). */
  const hit = (row: DesignRow, time: number, velocity: number, ratio = 1) => {
    // On a whole sample: Chrome starts a buffer between samples by interpolating it, which dulls a
    // hat or a snare's noise by several dB (and a hit would differ with where it fell)
    const t = Math.round(notLate(bus.context, time) * raw.sampleRate) / raw.sampleRate;
    const buffer = bufferFor(row);
    if (row === 'closedHat' || row === 'openHat') {
      for (const v of hats) if (v.stopAt > t) voices.release(v, t, CHOKE);
      hats = hats.filter((v) => v.stopAt > t);
    }
    const src = raw.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = Math.max(0.25, Math.min(4, ratio));
    const amp = raw.createGain();
    // Softer hits are quieter, a little more than in proportion (between the synthesized kits' and the recorded ones')
    amp.gain.value = Math.max(0, Math.min(1, velocity)) ** 1.5;
    src.connect(amp);
    amp.connect(input);
    src.start(t);
    const voice: NativeVoice = { start: t, stopAt: t + buffer.duration / src.playbackRate.value + 0.005, sources: [src], nodes: [src, amp], amp };
    voices.add(voice);
    if (row === 'openHat' || row === 'closedHat') hats.push(voice);
  };

  // Live, render the kit's sounds in the moments the page is idle, so the first hits don't wait for them
  let warm = 0;
  const warmUp = () => {
    if (typeof window === 'undefined' || raw instanceof OfflineAudioContext) return;
    window.clearTimeout(warm);
    const rows: DesignRow[] = ['kick', 'snare', 'clap', 'closedHat', 'openHat', 'cowbell', 'tomLow', 'tomMid', 'tomHigh', 'crash', 'ride'];
    const next = () => {
      const row = rows.shift();
      if (!row) return;
      bufferFor(row);
      warm = window.setTimeout(next, 30);
    };
    warm = window.setTimeout(next, 30);
  };
  warmUp();

  return {
    hit,
    setDesign: (next: DrumDesign | undefined) => {
      if (next === current) return;
      current = next;
      warmUp();
    },
    releaseAll: () => voices.releaseAll(raw.currentTime),
    dispose: () => {
      if (warm) window.clearTimeout(warm);
      voices.stopAll();
      bus.dispose();
    },
  };
}
export type DesignedKit = ReturnType<typeof createDesignedKit>;
