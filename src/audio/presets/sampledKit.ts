import * as Tone from 'tone';
import { INSTRUMENTS } from '../instrumentCatalog';
import type { InstrumentKey } from '../instrumentCatalog';
import { loadSamples, noteJitter } from '../samplers/samplerManager';
import { notLate } from './monotonic';
import { createBus, createVoiceSet } from './native';

/**
 * A recorded drum kit: the recordings of each drum row (see the catalog's `samples`, keyed by the
 * rows' note names), played as they are, never pitched. A kit recorded at several loudnesses and
 * takes ("<note>|<layer>|<take>", see SampleSource.layers) plays the recording for each hit's
 * velocity, its takes in turn, as a drummer never hits the same way twice. Rows the kit has no
 * recording of are left to the synthesized extras (kitExtras.ts).
 */
export function createSampledKit(key: InstrumentKey, output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  /** Each row's recordings: by loudness, then take */
  let buffers: Record<string, AudioBuffer[][]> = {};
  const tops = INSTRUMENTS[key].samples?.layers ?? [1];
  const turns = new Map<string, number>();
  let loaded = false;
  const ready = loadSamples(key).then((set) => {
    const rows: Record<string, AudioBuffer[][]> = {};
    for (const [name, b] of Object.entries(set)) {
      const audio = b.get();
      if (!audio) continue;
      const [note, l = '0', t = '0'] = name.split('|');
      const row = (rows[note] ??= []);
      (row[Number(l)] ??= [])[Number(t)] = audio;
    }
    buffers = rows;
    loaded = true;
  });
  ready.catch(() => {}); // the loading badge reports it

  /** Play the row's recording; false if the kit has none. */
  /** The recording for a hit on `note` at `velocity`: its loudness's, the next take of it. */
  const pick = (note: string, velocity: number): AudioBuffer | undefined => {
    const row = buffers[note];
    if (!row) return undefined;
    let l = tops.findIndex((top) => velocity <= top + 1e-6);
    if (l < 0 || !row[l]) l = row.length - 1;
    while (l > 0 && !row[l]) l--;
    const takes = (row[l] ?? []).filter(Boolean);
    if (!takes.length) return undefined;
    const k = `${note}|${l}`;
    const turn = turns.get(k) ?? 0;
    turns.set(k, turn + 1);
    return takes[turn % takes.length];
  };

  const hit = (note: string, time: number, velocity: number, opts: { seconds?: number; rate?: number } = {}): boolean => {
    const buffer = pick(note, velocity);
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
