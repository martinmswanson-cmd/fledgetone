import * as Tone from 'tone';
import type { InstrumentKey } from '../instrumentCatalog';
import { loadSamples, noteJitter } from '../samplers/samplerManager';
import { notLate } from './monotonic';
import { createBus, createVoiceSet } from './native';

/**
 * A recorded drum kit: one recording per drum row (see the catalog's `samples`, keyed by the
 * rows' note names), played as it is, never pitched. Rows the kit has no recording of are
 * left to the synthesized extras (kitExtras.ts).
 */
export function createSampledKit(key: InstrumentKey, output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  let buffers: Record<string, AudioBuffer> = {};
  let loaded = false;
  const ready = loadSamples(key).then((set) => {
    buffers = Object.fromEntries(Object.entries(set).map(([note, b]) => [note, b.get() as AudioBuffer]));
    loaded = true;
  });
  ready.catch(() => {}); // the loading badge reports it

  /** Play the row's recording; false if the kit has none. */
  const hit = (note: string, time: number, velocity: number, opts: { seconds?: number; rate?: number } = {}): boolean => {
    const buffer = buffers[note];
    if (!buffer) return false;
    const t = notLate(bus.context, time);
    const src = raw.createBufferSource();
    src.buffer = buffer;
    // No two hits quite alike, as a drummer never strikes the same spot twice: up to ±15 cents
    // and ±0.8 dB, the same for the same hit every time it plays (a kit with one recording per
    // drum otherwise sounds like a machine on repeated notes)
    const tune = 2 ** ((15 * noteJitter(note, time, 31)) / 1200);
    src.playbackRate.value = (opts.rate ?? 1) * tune;
    const amp = raw.createGain();
    // Softer hits are quieter, as on the kits' own velocity curve (about -24 dB at the bottom)
    amp.gain.value = velocity * velocity * 10 ** ((0.8 * noteJitter(note, time, 37)) / 20);
    const length = Math.min(opts.seconds ?? Infinity, buffer.duration / (opts.rate ?? 1));
    if (opts.seconds) amp.gain.setTargetAtTime(0, t + length * 0.6, length * 0.15);
    src.connect(amp);
    amp.connect(input);
    src.start(t);
    voices.add({ start: t, stopAt: t + length + 0.01, sources: [src], nodes: [src, amp], amp });
    return true;
  };

  return {
    ready,
    hit,
    has: (note: string) => note in buffers,
    loaded: () => loaded,
    releaseAll: () => voices.releaseAll(raw.currentTime),
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
  };
}
