import * as Tone from 'tone';
import { INSTRUMENTS } from '../instrumentCatalog';
import type { InstrumentKey } from '../instrumentCatalog';
import { loadSamplesAt, noteJitter, recordedDuration } from '../samplers/samplerManager';
import { notLate } from './monotonic';
import { createBus, createVoiceSet } from './native';
import { alwaysStereo } from '../nativeNodes';

/**
 * A recorded drum kit: the recordings of each drum row (see the catalog's `samples`, keyed by the
 * rows' note names), played as they are, never pitched. A kit recorded at several loudnesses and
 * takes ("<note>|<layer>|<take>", see SampleSource.layers) plays the recording for each hit's
 * velocity, its takes in turn, as a drummer never hits the same way twice. Rows the kit has no
 * recording of are left to the synthesized extras (kitExtras.ts).
 *
 * The velocity sets a hit's level (velocity squared, as below) and the loudness picks its tone, so
 * each row's loudnesses are played back at one level: their recordings' own levels vary (a soft
 * kick was converted louder than a hard one: matched by an A-weighted level, which hardly hears
 * a kick's boom), and as they were a harder hit could come out quieter than a softer one.
 */
/** The start of a hit whose energy sets its level against the row's other loudnesses (seconds) */
const LEVEL_WINDOW = 0.3;

/**
 * Each loudness's gain that brings its recordings' level to the loudest's (1 for the loudest):
 * by their energy over the first LEVEL_WINDOW seconds and by their peak, the lower of the two, so
 * a softer hit never measures louder than a harder one either way.
 */
function layerGains(row: AudioBuffer[][]): number[] {
  const level = row.map((takes) => {
    const all = (takes ?? []).filter(Boolean);
    if (!all.length) return { energy: 0, peak: 0 };
    let sum = 0;
    let peak = 0;
    for (const b of all) {
      const n = Math.min(b.length, Math.round(LEVEL_WINDOW * b.sampleRate));
      // (energy per second: the same whatever rate a recording was decoded at)
      for (let c = 0; c < b.numberOfChannels; c++) {
        const d = b.getChannelData(c);
        for (let i = 0; i < n; i++) {
          sum += (d[i] * d[i]) / b.sampleRate;
          peak = Math.max(peak, Math.abs(d[i]));
        }
      }
    }
    return { energy: sum / all.length, peak };
  });
  const top = level[level.length - 1];
  // (at most 12 dB either way: a recording far off is better left than turned to a whisper or a roar)
  return level.map((l) => (l.energy > 0 && top.energy > 0 ? Math.min(4, Math.max(0.25, Math.min(Math.sqrt(top.energy / l.energy), top.peak / l.peak))) : 1));
}

export function createSampledKit(key: InstrumentKey, output: Tone.InputNode) {
  const { bus, raw, input } = createBus(output);
  // Two channels from here on, whether a hit's recording has one or two (see alwaysStereo)
  alwaysStereo(bus);
  const voices = createVoiceSet(raw);
  /** Each row's recordings: by loudness, then take */
  let buffers: Record<string, AudioBuffer[][]> = {};
  /** Each row's gain per loudness (see layerGains) */
  let gains: Record<string, number[]> = {};
  const tops = INSTRUMENTS[key].samples?.layers ?? [1];
  const turns = new Map<string, number>();
  let loaded = false;
  // (at the rate of the context it plays in: an export at another rate has recordings of its own)
  const ready = loadSamplesAt(key, raw.sampleRate).then((set) => {
    const rows: Record<string, AudioBuffer[][]> = {};
    for (const [name, b] of Object.entries(set)) {
      const audio = b.get();
      if (!audio) continue;
      const [note, l = '0', t = '0'] = name.split('|');
      const row = (rows[note] ??= []);
      (row[Number(l)] ??= [])[Number(t)] = audio;
    }
    buffers = rows;
    gains = Object.fromEntries(Object.entries(rows).map(([note, row]) => [note, layerGains(row)]));
    loaded = true;
  });
  ready.catch(() => {}); // the loading badge reports it

  /** The recording for a hit on `note` at `velocity`: its loudness's, the next take of it, and its gain. */
  const pick = (note: string, velocity: number): { buffer: AudioBuffer; gain: number } | undefined => {
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
    return { buffer: takes[turn % takes.length], gain: gains[note]?.[l] ?? 1 };
  };

  /** Play the row's recording; false if the kit has none. */
  const hit = (note: string, time: number, velocity: number, opts: { seconds?: number; rate?: number } = {}): boolean => {
    const picked = pick(note, velocity);
    if (!picked) return false;
    const { buffer } = picked;
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
    amp.gain.value = picked.gain * velocity * velocity * 10 ** ((0.8 * noteJitter(note, time, 37)) / 20);
    // (Its length as recorded: a silent tail cut when it loaded doesn't move a shortened hit's fade)
    const length = Math.min(opts.seconds ?? Infinity, recordedDuration(buffer) / (opts.rate ?? 1));
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
