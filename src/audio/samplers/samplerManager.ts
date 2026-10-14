import * as Tone from 'tone';
import { createLightChorus } from '../effects/lightFx';
import { INSTRUMENTS } from '../instrumentCatalog';
import type { AmpModel, InstrumentDef, InstrumentKey, SampleSource, Shaping } from '../instrumentCatalog';
import { auditionInput } from '../engine';
import { decodeSound } from '../soundLibrary';
import { recordingBytes } from '../recordingStore';
import { useAudioStore } from '../../store/audioStore';
import type { CustomSample } from '../../store/timelineTypes';
import { keepActive, nativeContextOf, nativeInputOf } from '../nativeNodes';

/**
 * Sampled instruments. Each instrument's recordings are downloaded and decoded once, then
 * shared by every sampler that plays it: each track's own sampler, the instrument browser's
 * audition sampler, and the offline export (AudioBuffers aren't tied to a context).
 */
type SampleSet = Record<string, Tone.ToneAudioBuffer>;

const sampleSets: Partial<Record<InstrumentKey, Promise<SampleSet>>> = {};
/** The sets that have finished loading (for counting what forgetting them frees). */
const loadedSets: Partial<Record<InstrumentKey, SampleSet>> = {};

/** True for instruments that stream recordings (piano, sax, marimba...). */
export function isSamplerKey(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'sampled';
}

/** True for instruments with recordings to download first: the sampled ones and the recorded drum kits. */
export function hasRecordings(key: InstrumentKey): boolean {
  return !!INSTRUMENTS[key].samples;
}

/**
 * Recordings decoded, by URL: instruments that play the same recordings through different amps
 * share them. The bytes come from this browser's kept copy, or are downloaded (from `baseUrl`, or
 * `fallbackUrl` when that can't serve them) and kept for next time: see recordingStore.ts.
 */
const recordings = new Map<string, Promise<Tone.ToneAudioBuffer>>();
function fetchRecording(source: SampleSource, file: string): Promise<Tone.ToneAudioBuffer> {
  const url = source.baseUrl + file;
  let p = recordings.get(url);
  if (!p) {
    p = recordingBytes(source, file)
      .then((bytes) => Tone.getContext().decodeAudioData(bytes))
      .then((audio) => new Tone.ToneAudioBuffer(audio));
    p.catch(() => recordings.delete(url));
    recordings.set(url, p);
  }
  return p;
}

/** Download + decode an instrument's samples (once). Updates the loading badge in audioStore. */
export function loadSamples(key: InstrumentKey): Promise<SampleSet> {
  const existing = sampleSets[key];
  if (existing) return existing;

  const source = INSTRUMENTS[key].samples;
  if (!source) return Promise.reject(new Error(`${key} has no samples`));
  const setStatus = useAudioStore.getState().setInstrumentStatus;
  setStatus(key, 'loading');

  const promise = Promise.all(
    Object.entries(source.samples).map(async ([note, file]) => {
      const loaded = await fetchRecording(source, file);
      const buffer = source.tune?.[note] ? retune(loaded, source.tune[note]) : loaded;
      const held = source.sustain ? extendSustain(buffer, source.sustain) : buffer;
      return [note, source.onset === undefined ? held : trimOnset(held, source.onset)] as const;
    })
  ).then(
    (entries) => {
      setStatus(key, 'ready');
      const set = Object.fromEntries(entries) as SampleSet;
      loadedSets[key] = set;
      return set;
    },
    (err) => {
      console.error(`Failed to load samples [${key}]:`, err);
      setStatus(key, 'error');
      delete sampleSets[key]; // allow a retry next time
      throw err;
    }
  );
  sampleSets[key] = promise;
  return promise;
}

/**
 * Re-pitch a recording by `cents` (an out-of-tune one: see sampleTuning.ts), by reading it a little
 * faster or slower with cubic interpolation. A few cents changes its length by a fraction of a
 * percent, which nobody hears.
 */
function retune(buffer: Tone.ToneAudioBuffer, cents: number): Tone.ToneAudioBuffer {
  const audio = buffer.get();
  if (!audio || !cents) return buffer;
  const rate = 2 ** (cents / 1200);
  const length = Math.max(1, Math.floor((audio.length - 3) / rate));
  const out = Tone.getContext().createBuffer(audio.numberOfChannels, length, audio.sampleRate);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const x = audio.getChannelData(c);
    const y = out.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const pos = i * rate;
      const k = Math.floor(pos);
      const t = pos - k;
      const p0 = x[k > 0 ? k - 1 : 0];
      const p1 = x[k];
      const p2 = x[k + 1];
      const p3 = x[k + 2];
      // Catmull-Rom
      y[i] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    }
  }
  return new Tone.ToneAudioBuffer(out);
}

/**
 * Cut a recording's slow start: it begins 30 ms before its level (20 ms RMS) first reaches
 * `onsetDb` under its peak, with a 15 ms fade so the cut itself is silent. A recording that is
 * there from the first window is returned as it is.
 */
function trimOnset(buffer: Tone.ToneAudioBuffer, onsetDb: number): Tone.ToneAudioBuffer {
  const audio = buffer.get();
  if (!audio) return buffer;
  const sr = audio.sampleRate;
  const window = Math.round(sr * 0.02);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  const levels: number[] = [];
  for (let i = 0; i + window <= audio.length; i += window) {
    let sum = 0;
    for (const data of channels) for (let k = i; k < i + window; k++) sum += data[k] * data[k];
    levels.push(sum);
  }
  const peak = Math.max(...levels);
  const first = levels.findIndex((l) => l >= peak * 10 ** (onsetDb / 10));
  const start = Math.max(0, first * window - Math.round(sr * 0.03));
  if (start <= 0) return buffer;
  const fade = Math.round(sr * 0.015);
  const trimmed = Tone.getContext().createBuffer(channels.length, audio.length - start, sr);
  channels.forEach((data, c) => {
    const out = trimmed.getChannelData(c);
    out.set(data.subarray(start));
    for (let k = 0; k < fade && k < out.length; k++) out[k] *= k / fade;
  });
  return new Tone.ToneAudioBuffer(trimmed);
}

/**
 * Lengthen a recording that stops dead by looping its steady part, crossfading 120 ms at each
 * join, until it is `hold` seconds long; the last 300 ms fade out. Two identical channels (a mono
 * recording saved as stereo) are folded to one, halving the memory it takes.
 */
function extendSustain(buffer: Tone.ToneAudioBuffer, { from, to, hold }: { from: number; to: number; hold: number }): Tone.ToneAudioBuffer {
  const audio = buffer.get();
  if (!audio) return buffer;
  const sr = audio.sampleRate;
  const end = Math.min(audio.length, Math.round(to * sr));
  const start = Math.round(from * sr);
  const xf = Math.round(0.12 * sr);
  if (end - start < xf * 3) return buffer;
  let channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  if (channels.length === 2) {
    const [l, r] = channels;
    let diff = 0, sum = 0;
    for (let i = 0; i < end; i += 7) { diff += (l[i] - r[i]) ** 2; sum += (l[i] + r[i]) ** 2; }
    if (diff < sum * 1e-4) channels = [l];
  }
  const length = Math.max(end, Math.round(hold * sr));
  const out = Tone.getContext().createBuffer(channels.length, length, sr);
  channels.forEach((data, c) => {
    const o = out.getChannelData(c);
    o.set(data.subarray(0, end));
    let pos = end;
    while (pos < length) {
      const at = pos - xf;
      for (let k = 0; k < end - start && at + k < length; k++) {
        const v = data[start + k];
        if (k < xf) {
          const t = (k / xf) * (Math.PI / 2);
          o[at + k] = o[at + k] * Math.cos(t) + v * Math.sin(t);
        } else o[at + k] = v;
      }
      pos = at + (end - start);
    }
    const fade = Math.min(length, Math.round(0.3 * sr));
    for (let k = 0; k < fade; k++) o[length - 1 - k] *= k / fade;
  });
  return new Tone.ToneAudioBuffer(out);
}

// ---------- the user's own sounds (Sampler instrument) ----------

const customSamples = new Map<string, Promise<Tone.ToneAudioBuffer>>();

/**
 * Decode a sound a project from before the sound library carries as a data: URL on its track
 * (loadProject moves it into the library; this plays it meanwhile). Cached per sound.
 */
export function loadCustomSample(dataUrl: string): Promise<Tone.ToneAudioBuffer> {
  let p = customSamples.get(dataUrl);
  if (!p) {
    p = fetch(dataUrl)
      .then((r) => r.arrayBuffer())
      .then((data) => Tone.getContext().decodeAudioData(data))
      .then((audio) => new Tone.ToneAudioBuffer(audio));
    p.catch(() => customSamples.delete(dataUrl));
    customSamples.set(dataUrl, p);
  }
  return p;
}

export interface SamplerVoice {
  play: (notes: string[], duration: string, time: number | undefined, velocity: number) => void;
  /** A key held on a MIDI keyboard: `note` sounds from `time` until released. */
  attack: (note: string, time: number, velocity: number) => void;
  release: (note: string, time: number) => void;
  /** Pitch bend in cents from `time`: every sounding note, and the notes after, play that far off. */
  bend: (cents: number, time: number) => void;
  releaseAll: () => void;
  /** Resolves once samples are attached (rejects if they failed to download). */
  ready: Promise<void>;
  dispose: () => void;
}

/** Where a sampler's notes go: the shaping's input, its nodes to dispose, and a hook for each note's start. */
interface ShapingChain {
  input: Tone.InputNode;
  nodes: { dispose: () => void }[];
  /** A note starts at `time` (audio clock): the erhu's vibrato swells in from there. */
  onNote?: (time: number) => void;
}

/** A soft clipper: `drive` times the input through tanh, scaled back so full scale stays full scale. */
function saturator(drive: number): WaveShaperNode {
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const shaper = raw.createWaveShaper();
  const curve = new Float32Array(2049);
  const norm = Math.tanh(drive);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(drive * ((i / (curve.length - 1)) * 2 - 1)) / norm;
  shaper.curve = curve;
  shaper.oversample = '2x';
  return shaper;
}

/** The erhu's vibrato: how far the delay swings, in seconds, once a note has settled (about ±20 cents at 5.5 Hz). */
const ERHU_VIBRATO = 0.00035;

/** A guitar amp's settings (played by shapingChain). */
interface AmpSettings {
  /** High-pass in front of the amp, Hz: higher keeps a driven amp's lows from turning to mud */
  tight: number;
  /** A compressor's threshold and ratio, as a clean amp and a picking hand even notes out */
  squeeze?: [threshold: number, ratio: number];
  /** EQ before the drive: [type, Hz, Q, dB] */
  pre: Array<[BiquadFilterType, number, number, number]>;
  /** Drive of each gain stage (more stages: more distortion, smoother) */
  stages: number[];
  /** Tone stack, dB: bass (120 Hz), mid (at midHz), treble (2.5 kHz) */
  bass: number;
  mid: number;
  midHz: number;
  treble: number;
  /** Where the speaker cabinet rolls the top off, Hz */
  cabTop: number;
}

/**
 * The real electric guitars are recorded straight from the pickup, as a guitarist records direct
 * to choose the amp later; each instrument is that recording through one of these amps. Pickup
 * signal → (compression) → preamp EQ → gain stages → tone stack → a 1×12 speaker cabinet (a low
 * resonance, the cone's upper-mid bite, a dip where cabinets honk, and a steep top roll-off: what
 * makes an amp sound like an amp rather than a fuzz box).
 */
const AMPS: Record<AmpModel, AmpSettings> = {
  // Bright and glassy, a touch of edge when picked hard
  cleanAmp: { tight: 70, squeeze: [-26, 3], pre: [['highshelf', 1500, 0.7, 4]], stages: [1.4], bass: 1, mid: -2, midHz: 600, treble: 3, cabTop: 6500 },
  // Warm and round: treble down, the neck pickup sound
  jazzAmp: { tight: 60, squeeze: [-30, 2], pre: [], stages: [1.2], bass: 2, mid: 0, midHz: 700, treble: -4, cabTop: 4200 },
  // An amp turned up until it breaks up: rock rhythm
  crunchAmp: { tight: 110, pre: [['peaking', 800, 0.8, 6], ['highshelf', 1800, 0.7, 4]], stages: [5], bass: 0, mid: 1, midHz: 700, treble: 2, cabTop: 5000 },
  // Two gain stages, scooped mids: riffs and leads
  leadAmp: { tight: 150, pre: [['peaking', 900, 0.8, 6], ['highshelf', 2000, 0.7, 3]], stages: [8, 4], bass: 3, mid: -4, midHz: 500, treble: 0, cabTop: 4200 },
};

/**
 * Character processing that turns a recording into the instrument.
 * - erhu: a solo violin through a nasal formant and a dark top (the snakeskin resonator), with a
 *   wide vibrato that swells in over the first half second of each note, as a player's does.
 * - amp: the electric guitar's recordings are a dull direct signal with almost nothing above
 *   2 kHz. An amp stage brightens it before a soft clip (which adds the upper harmonics a real
 *   amp does), then a speaker-like presence peak and top roll-off.
 * - acoustic: the steel-string recordings are dark too; brightened with a little edge.
 * - mandolin: doubled (paired) strings and a bright top.
 * - violin: what string players' engineers do to a close violin. Rumble cut below 120 Hz, two
 *   narrow 3 dB dips at 2.5 and 4 kHz (the bridge hill and the edge, right where hearing is most
 *   sensitive) and a gentle shelf down above 6 kHz: the bite that made high lines piercing goes,
 *   the bow and the body stay.
 */
function shapingChain(shape: Shaping | undefined, output: Tone.InputNode): ShapingChain {
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const biquad = (type: BiquadFilterType, frequency: number, Q: number, gain = 0) => {
    const f = raw.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    f.gain.value = gain;
    return f;
  };
  const chain = (nodes: AudioNode[]) => {
    for (let i = 0; i + 1 < nodes.length; i++) nodes[i].connect(nodes[i + 1]);
    Tone.connect(nodes[nodes.length - 1], output);
    return { input: nodes[0], nodes: nodes.map((n) => ({ dispose: () => n.disconnect() })) };
  };
  if (shape === 'erhu') {
    // Vibrato: a sine wobbles the delay line's time around 2.5 ms; `depth` is how far it swings
    const delay = raw.createDelay(0.01);
    delay.delayTime.value = 0.0025;
    const lfo = raw.createOscillator();
    lfo.frequency.value = 5.5;
    const depth = raw.createGain();
    depth.gain.value = ERHU_VIBRATO;
    lfo.connect(depth);
    depth.connect(delay.delayTime);
    lfo.start();
    const thin = biquad('highpass', 240, 0.7);
    const nasal = biquad('peaking', 1200, 1.6, 5);
    const edge = biquad('peaking', 3000, 2, 2);
    const dark = biquad('lowpass', 6500, 0.7);
    const built = chain([delay, thin, nasal, edge, dark]);
    built.nodes.push({ dispose: () => { lfo.stop(); lfo.disconnect(); depth.disconnect(); } });
    return {
      ...built,
      onNote: (time) => {
        const at = Math.max(time, raw.currentTime);
        depth.gain.cancelScheduledValues(at);
        depth.gain.setValueAtTime(ERHU_VIBRATO * 0.2, at);
        depth.gain.linearRampToValueAtTime(ERHU_VIBRATO, at + 0.45);
      },
    };
  }
  if (shape === 'amp') {
    // Tighten the lows, even the level out (an amp's sustain), brighten before the clip so the
    // harmonics land where a guitar's bite is, then the speaker: a bump in the lows, a scooped
    // low-mid, presence, and a steep top
    const tight = biquad('highpass', 80, 0.7);
    const sustain = raw.createDynamicsCompressor();
    sustain.threshold.value = -30;
    sustain.knee.value = 12;
    sustain.ratio.value = 3;
    sustain.attack.value = 0.004;
    sustain.release.value = 0.15;
    const pre = biquad('highshelf', 1200, 0.7, 9);
    const drive = saturator(3);
    const thump = biquad('peaking', 120, 1, 3);
    const scoop = biquad('peaking', 450, 1, -3);
    const presence = biquad('peaking', 2600, 1.2, 4);
    const cab = biquad('lowpass', 4800, 1.1);
    const trim = raw.createGain();
    trim.gain.value = Tone.dbToGain(-6);
    return chain([tight, sustain, pre, drive, thump, scoop, presence, cab, trim]);
  }
  if (shape && shape in AMPS) {
    const amp = AMPS[shape as AmpModel];
    const nodes: AudioNode[] = [biquad('highpass', amp.tight, 0.7)];
    if (amp.squeeze) {
      const squeeze = raw.createDynamicsCompressor();
      squeeze.threshold.value = amp.squeeze[0];
      squeeze.ratio.value = amp.squeeze[1];
      squeeze.knee.value = 10;
      squeeze.attack.value = 0.005;
      squeeze.release.value = 0.12;
      nodes.push(squeeze);
    }
    for (const [type, hz, q, db] of amp.pre) nodes.push(biquad(type, hz, q, db));
    amp.stages.forEach((drive, i) => {
      // Between stages: the coupling that keeps a high-gain amp's lows tight and its fizz down
      if (i > 0) nodes.push(biquad('highpass', 180, 0.7), biquad('lowpass', 4500, 0.7));
      nodes.push(saturator(drive));
    });
    nodes.push(
      biquad('lowshelf', 120, 0.7, amp.bass),
      biquad('peaking', amp.midHz, 0.7, amp.mid),
      biquad('highshelf', 2500, 0.7, amp.treble),
      // The cabinet
      biquad('highpass', 70, 0.8),
      biquad('peaking', 115, 1.2, 2.5),
      biquad('peaking', 400, 1, -2.5),
      biquad('peaking', 2200, 1, 2),
      biquad('peaking', 3800, 2.5, 3),
      biquad('lowpass', amp.cabTop, 0.7),
      biquad('lowpass', amp.cabTop * 1.15, 0.7)
    );
    return chain(nodes);
  }
  if (shape === 'acoustic') {
    const bright = biquad('highshelf', 1800, 0.7, 8);
    const sparkle = biquad('peaking', 3200, 1.2, 3);
    const edge = saturator(1.3);
    const trim = raw.createGain();
    trim.gain.value = Tone.dbToGain(-2);
    return chain([bright, sparkle, edge, trim]);
  }
  if (shape === 'violin') {
    const rumble = biquad('highpass', 120, 0.6);
    const bite = biquad('peaking', 2500, 2.2, -3);
    const edge = biquad('peaking', 4000, 2.2, -3);
    const air = biquad('highshelf', 6000, 0.7, -3);
    return chain([rumble, bite, edge, air]);
  }
  if (shape === 'mandolin') {
    const courses = createLightChorus({ rate: 5, delayMs: 1.8, depth: 0.35, spread: 160, wet: 0.55 });
    const bright = new Tone.BiquadFilter({ type: 'highshelf', frequency: 2500, gain: 4 });
    courses.output.chain(bright, output);
    return { input: courses.input, nodes: [courses, bright] };
  }
  return { input: output, nodes: [] };
}

/** The instrument's tone correction (InstrumentDef.tone) in front of its shaping chain. */
function toneChain(tone: InstrumentDef['tone'], next: ShapingChain): ShapingChain {
  if (!tone || (!tone.presence && !tone.mud)) return next;
  const raw = Tone.getContext().rawContext as unknown as BaseAudioContext;
  const presence = raw.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = tone.presenceHz ?? 2500;
  presence.Q.value = 0.8;
  presence.gain.value = tone.presence ?? 0;
  const mud = raw.createBiquadFilter();
  mud.type = 'peaking';
  mud.frequency.value = 300;
  mud.Q.value = 0.9;
  mud.gain.value = tone.mud ?? 0;
  presence.connect(mud);
  Tone.connect(mud, next.input);
  return { ...next, input: presence, nodes: [...next.nodes, { dispose: () => { presence.disconnect(); mud.disconnect(); } }] };
}

/** How much quieter `note` plays under an instrument's taper (1 = as it is). */
export function taperGain(taper: InstrumentDef['taper'], note: string): number {
  if (!taper) return 1;
  const octaves = (Tone.Frequency(note).toMidi() - taper[0]) / 12;
  return octaves > 0 ? Tone.dbToGain(-taper[1] * octaves) : 1;
}

/**
 * Expressive playing (a track's Expressive switch): a recording made at one loudness is played
 * the way a real instrument sounds at the velocity asked for.
 * - Brightness follows velocity: each note gets a low-pass of its own, open at full velocity and
 *   about `depth` octaves lower at the softest (never below a few harmonics of the note), so a
 *   soft note is darker, not just quieter, as with SFZ's fil_veltrack.
 * - Loudness follows a dB curve (`rangeDb` from the softest to full) instead of a straight line.
 * - No two hits are quite the same: each note is detuned up to ±3 cents and its level moved up
 *   to ±0.6 dB, seeded from the note and its time, so a repeated note doesn't machine-gun and an
 *   export comes out the same every time.
 */
export interface Expressive {
  depth: number;
  rangeDb: number;
}

const EXPRESSIVE_BY_CATEGORY: Partial<Record<InstrumentDef['category'], Expressive>> = {
  'Winds & Brass': { depth: 3.2, rangeDb: 20 },
  Orchestra: { depth: 3, rangeDb: 20 },
  'Keys & Synths': { depth: 2.5, rangeDb: 18 },
  'Guitars & Strings': { depth: 2.5, rangeDb: 18 },
  'Choir & Voices': { depth: 2, rangeDb: 16 },
  'Mallets & Bells': { depth: 2.2, rangeDb: 20 },
  'Pads & Atmospheres': { depth: 1.5, rangeDb: 12 },
  World: { depth: 2.5, rangeDb: 18 },
  Bass: { depth: 2, rangeDb: 14 },
  'Drums & Percussion': { depth: 1.6, rangeDb: 18 },
};

/** How an instrument plays expressively (null: as recorded, e.g. drum kits and sound effects). */
export function expressiveFor(def: InstrumentDef): Expressive | null {
  const base = EXPRESSIVE_BY_CATEGORY[def.category] ?? null;
  // Recorded at several loudnesses: a soft recording is already darker, so less filtering on top
  // (their levels are matched when converted, so velocity still sets the loudness)
  return base && (def.samples?.layers?.length ?? 0) > 1 ? { ...base, depth: base.depth * 0.4 } : base;
}

/** A note's level for `velocity` (0..1) on a dB curve `rangeDb` deep. */
export const expressiveGain = (velocity: number, rangeDb: number) => (velocity <= 0 ? 0 : 10 ** ((-rangeDb * (1 - Math.min(1, velocity))) / 20));

/**
 * A note's low-pass cutoff for `velocity`: at full velocity about the 48th harmonic of the note
 * (these recordings hold little above 11-15 kHz anyway), `depth` octaves lower at the softest,
 * and never below the 3rd harmonic.
 */
export const expressiveCutoff = (velocity: number, depth: number, noteHz: number) =>
  Math.min(20000, Math.max(noteHz * 3, Math.min(20000, noteHz * 48) * 2 ** (-depth * (1 - Math.min(1, Math.max(0, velocity))))));

/** A number from -1 to 1 for a note at a moment (the same every time). */
export function noteJitter(note: string, time: number, salt: number): number {
  let h = 0x811c9dc5 ^ salt;
  const text = `${note}@${Math.round(time * 1000)}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/** Recordings by MIDI note: what one sampler slot plays from (the nearest one, re-pitched). */
type Slot = Map<number, AudioBuffer>;

/**
 * The recordings a voice plays: one slot, or one per loudness and take (SampleSource.layers), and
 * which slot plays a note at a velocity.
 */
interface SlotBank {
  slots: Slot[];
  pick: (velocity: number) => Slot;
}

/** The recording nearest `midi` in `slot` and how many semitones it sits below (Tone.Sampler's search: the higher one on a tie). */
function nearest(slot: Slot, midi: number): { buffer: AudioBuffer; interval: number } | null {
  for (let i = 0; i < 96; i++) {
    const up = slot.get(midi + i);
    if (up) return { buffer: up, interval: -i };
    const down = slot.get(midi - i);
    if (down) return { buffer: down, interval: i };
  }
  return null;
}

/** A note's tail below this (about -90 dBFS, before velocity) is cut: nobody hears it, and it keeps a voice playing. */
const SILENT = 3e-5;
const audibleEnds = new WeakMap<AudioBuffer, number>();
/** Where `buffer` falls silent for good, in seconds (the end of its last sample above SILENT). */
function audibleEnd(buffer: AudioBuffer): number {
  let end = audibleEnds.get(buffer);
  if (end === undefined) {
    let last = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = data.length - 1; i > last; i--) if (Math.abs(data[i]) > SILENT) { last = i; break; }
    }
    end = Math.min(buffer.duration, (last + 1) / buffer.sampleRate + 0.01);
    audibleEnds.set(buffer, end);
  }
  return end;
}

/** At most this many notes of one pitch ring at once: a further repeat fades the oldest (as a re-struck string damps itself). */
const SAME_PITCH = 3;
/** At most this many notes of one instrument ring at once: past it, the oldest fades. */
const MAX_NOTES = 64;
/** A legato change on a bowed string: the new note starts this far in (past its attack) and the two crossfade over LEGATO_FADE seconds. */
const LEGATO_SKIP = 0.07;
const LEGATO_FADE = 0.05;
/** How fast a note let go for a newer one fades (time constant, s: gone in about 50 ms). */
const STEAL_TC = 0.01;

const midiOfNote = (note: string) => 69 + 12 * Math.log2(Tone.Frequency(note).toFrequency() / 440);

/**
 * Expressive cutoffs are shared a sixth of an octave apart: notes whose cutoffs round to the same
 * step play through one filter, instead of each note making its own (a biquad is the costliest
 * node a note had). A sixth of an octave is finer than the ear follows in a note's brightness.
 */
const CUTOFF_STEPS_PER_OCTAVE = 6;

/**
 * Plays recordings from plain Web Audio nodes: each note is an AudioBufferSourceNode and one
 * GainNode (its velocity, a short fade in, and its release), made on the browser's own context (see
 * nativeNodes.ts: Tone's wrapper added a gain to every buffer source and walked the graph on every
 * connect) when it starts, and let go when it has rung out, so nothing runs between notes. Tone.Sampler made two gains per note (and, played
 * expressively, a filter of its own), and on a repeat of a pitch still ringing it moved the earlier
 * note's end to the later one's, so fast repeats piled up as overlapping notes. Here a note lasts
 * what it says, plus its release.
 *
 * The envelope matches Tone.Sampler's: `attack` seconds in, and the release an exponential fall
 * whose last tenth is a straight line to silence (Tone's targetRampTo).
 */
function samplerVoice(
  bank: SlotBank,
  options: { attack: number; release: number },
  output: Tone.Gain,
  attach: Promise<void>,
  extra: { dispose: () => void }[],
  onNote?: (time: number) => void,
  taper?: InstrumentDef['taper'],
  expressive?: Expressive | null,
  bowed?: InstrumentDef['bowed']
): SamplerVoice {
  let loaded = false;
  const ready = attach.then(() => {
    loaded = true;
  });
  ready.catch(() => {}); // the loading badge / inspector reports failures
  const raw = nativeContextOf(output.context);
  const into = nativeInputOf(output);
  // Only native nodes feed `output`: keep Tone's wrapper from taking it out of the graph
  const letGo = keepActive(output);
  // (Read in the voice's own context: in an export, the render's tempo, not the live one)
  const release = options.release;
  /** The release's time constant and where its straight last tenth starts (as Tone's targetRampTo). */
  const releaseTc = Math.log(release + 1) / Math.log(200);
  /** How long a release really lasts: a long one is inaudible (below -70 dB) well before it ends, so it stops there. */
  const tail = Math.min(release, releaseTc * 8);
  /** Expressive filters, by cutoff step (see CUTOFF_STEPS_PER_OCTAVE). */
  const filters = new Map<number, BiquadFilterNode>();
  const filterFor = (cutoff: number): AudioNode => {
    const step = Math.round(Math.log2(cutoff) * CUTOFF_STEPS_PER_OCTAVE);
    let f = filters.get(step);
    if (!f) {
      f = raw.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 0.6;
      f.frequency.value = Math.min(raw.sampleRate / 2 - 1, 2 ** (step / CUTOFF_STEPS_PER_OCTAVE));
      f.connect(into);
      filters.set(step, f);
    }
    return f;
  };

  /**
   * A note sounding: `until` is when it has rung out (Infinity while its key is held). Pitch bend
   * scales every sounding note's rate, so each keeps its unbent rate (`base`) and how much of its
   * recording it has played (`played` by `last`, at `rate`), so a held note's end can be moved
   * when a bend changes its speed.
   */
  interface Sounding {
    src: AudioBufferSourceNode;
    gain: GainNode;
    note: string;
    level: number;
    start: number;
    until: number;
    base: number;
    played: number;
    last: number;
    rate: number;
    /** When it was let go (Infinity until then): a bowed note starting before this is a legato change */
    releasedAt: number;
  }
  const sounding: Sounding[] = [];
  let bendRatio = 1;
  const prune = (time: number) => {
    for (let i = sounding.length - 1; i >= 0; i--) if (sounding[i].until < time) sounding.splice(i, 1);
  };

  /** Fade `s` out quickly from `at` (its place taken by a newer note), and stop it. */
  const steal = (s: Sounding, at: number) => {
    const g = s.gain.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(0, at, STEAL_TC);
    const stop = at + STEAL_TC * 6;
    if (stop < s.until) {
      s.src.stop(stop);
      s.until = stop;
    }
  };

  /**
   * Before a note starts at `at`: if SAME_PITCH notes of its pitch, or MAX_NOTES in all, are still
   * ringing then, the oldest fade out. A fast repeat on a long-ringing note otherwise stacks up
   * dozens of copies of it, which cost a voice each and blur together.
   */
  const makeRoom = (note: string, at: number) => {
    let same: Sounding | null = null;
    let sameCount = 0;
    let oldest: Sounding | null = null;
    let count = 0;
    for (const x of sounding) {
      if (x.start >= at || x.until <= at) continue;
      count++;
      if (!oldest || x.start < oldest.start) oldest = x;
      if (x.note === note) {
        sameCount++;
        if (!same || x.start < same.start) same = x;
      }
    }
    if (same && sameCount >= SAME_PITCH) steal(same, at);
    else if (oldest && count >= MAX_NOTES) steal(oldest, at);
  };

  /** The velocity a note is triggered at: as given, or on the dB curve with a little variation. */
  const level = (note: string, velocity: number, at: number) =>
    expressive ? expressiveGain(velocity, expressive.rangeDb) * 10 ** ((0.6 * noteJitter(note, at, 7)) / 20) : velocity;

  /**
   * Start `note` at `at`; it plays to the end of its recording unless released. `offset` starts it
   * that far into its recording (past a bow's slow start), fading in over `fade` seconds.
   */
  const start = (note: string, at: number, velocity: number, offset = 0, fade = 0): Sounding | null => {
    const midiFloat = midiOfNote(note);
    const midi = Math.round(midiFloat);
    const found = nearest(bank.pick(velocity), midi);
    if (!found) return null;
    let base = 2 ** ((found.interval + midiFloat - midi) / 12);
    // Each hit a hair off the last: up to ±3 cents
    if (expressive) base *= 2 ** ((3 * noteJitter(note, at, 13)) / 1200);
    const when = Math.max(at, raw.currentTime);
    const src = raw.createBufferSource();
    src.buffer = found.buffer;
    src.playbackRate.value = base * bendRatio;
    const gain = raw.createGain();
    const v = level(note, velocity, at) * taperGain(taper, note);
    const rise = Math.max(options.attack, fade);
    if (rise > 0) {
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(v, when + rise);
    } else gain.gain.value = v;
    src.connect(gain);
    gain.connect(expressive ? filterFor(expressiveCutoff(velocity, expressive.depth, Tone.Frequency(note).toFrequency())) : into);
    const from = Math.min(offset, audibleEnd(found.buffer) / 2);
    src.start(when, from);
    // Let go once it has played (nodes made in an export are dropped with its context anyway)
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
    const end = when + (audibleEnd(found.buffer) - from) / (base * bendRatio);
    src.stop(end);
    makeRoom(note, when);
    const s: Sounding = { src, gain, note, level: v, start: when, until: end, base, played: from, last: when, rate: base * bendRatio, releasedAt: Infinity };
    sounding.push(s);
    return s;
  };

  /** Release `s` at `time`: its level falls away over the release, then it stops. */
  const releaseAt = (s: Sounding, time: number) => {
    const at = Math.max(time, s.start + options.attack);
    s.releasedAt = at;
    const g = s.gain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(s.level, at);
    g.setTargetAtTime(0, at, releaseTc);
    const late = at + tail * 0.9;
    g.setValueAtTime(s.level * Math.exp((-tail * 0.9) / releaseTc), late);
    g.linearRampToValueAtTime(0, at + tail);
    const stop = at + tail + 0.01;
    if (stop < s.until) {
      s.src.stop(stop);
      s.until = stop;
    }
  };

  return {
    play: (notes, duration, time, velocity) => {
      if (!loaded || notes.length === 0) return; // still downloading: skip rather than throw
      const at = time ?? output.now();
      onNote?.(at);
      const end = at + output.toSeconds(duration);
      prune(at);
      if (!bowed) {
        for (const note of notes) {
          const s = start(note, at, velocity);
          if (s) releaseAt(s, end);
        }
        return;
      }
      // A solo string plays two notes at most (a double stop): the outer two of a chord
      const list = bowed.solo && notes.length > 2 ? [...notes].sort((a, b) => midiOfNote(a) - midiOfNote(b)).filter((_, i, all) => i === 0 || i === all.length - 1) : notes;
      // Legato: a single note starting while the last one is still held changes note without a new
      // bow attack. It comes in past its own attack and the old one crossfades out under it.
      const from = list.length === 1 ? sounding.find((x) => x.start < at - 0.01 && x.releasedAt > at + 0.03 && x.until > at && x.note !== list[0]) : undefined;
      // A short note starts past the bow's slow start, so fast passages speak
      const short = end - at < 0.25;
      for (const note of list) {
        const s = from ? start(note, at, velocity, Math.max(bowed.skip, LEGATO_SKIP), LEGATO_FADE) : short ? start(note, at, velocity, bowed.skip, 0.008) : start(note, at, velocity);
        if (s) releaseAt(s, end);
      }
      if (from) {
        const g = from.gain.gain;
        g.cancelScheduledValues(at);
        // The old note fades slower than the new one comes in, so the change doesn't dip
        g.setTargetAtTime(0, at, LEGATO_FADE);
        const stop = at + LEGATO_FADE * 6;
        if (stop < from.until) {
          from.src.stop(stop);
          from.until = stop;
        }
        from.releasedAt = at;
      }
    },
    attack: (note, time, velocity) => {
      if (!loaded) return;
      onNote?.(time);
      prune(time);
      const s = start(note, time, velocity);
      if (s) s.until = Infinity;
    },
    bend: (cents, time) => {
      const next = 2 ** (cents / 1200);
      if (Math.abs(next - bendRatio) < 1e-6) return;
      prune(time);
      for (const s of sounding) {
        s.src.playbackRate.setTargetAtTime(s.base * next, time, 0.005);
        if (time > s.last) s.played += (time - s.last) * s.rate;
        s.last = Math.max(s.last, time);
        s.rate = s.base * next;
        // A held key rings until its recording runs out at the new speed
        if (s.until === Infinity && s.src.buffer) s.src.stop(time + Math.max(0, audibleEnd(s.src.buffer) - s.played) / s.rate);
      }
      bendRatio = next;
    },
    release: (note, time) => {
      if (!loaded) return;
      // The oldest key still held on that note
      const s = sounding.find((x) => x.note === note && x.until === Infinity);
      if (s) {
        s.until = Number.MAX_VALUE;
        releaseAt(s, time);
      }
    },
    releaseAll: () => {
      const now = raw.currentTime;
      for (const s of sounding) if (s.until > now) releaseAt(s, now);
    },
    ready,
    dispose: () => {
      for (const s of sounding) {
        s.src.onended = null;
        try {
          s.src.stop();
        } catch {
          // Not started
        }
        s.src.disconnect();
        s.gain.disconnect();
      }
      sounding.length = 0;
      filters.forEach((f) => f.disconnect());
      letGo();
      output.dispose();
      extra.forEach((n) => n.dispose());
    },
  };
}

/** A sampled instrument's voice in the current context, connected to `output`. */
export function createSamplerVoice(key: InstrumentKey, output: Tone.InputNode, expressive = false): SamplerVoice {
  const def = INSTRUMENTS[key];
  const shaped = shapingChain(def.shaping, output);
  const chain = toneChain(def.tone, shaped);
  const out = new Tone.Gain(1).connect(chain.input);
  // A few ms of attack: a recording stretched to another pitch doesn't always start at zero
  const options = { attack: 0.004, release: def.samples?.release ?? 1 };
  const layers = def.samples?.layers ?? [1];
  // One slot per loudness and take (layered names are note|layer|take): a note plays the slot for
  // its velocity, its takes in turn
  const bank: Slot[][] = layers.map(() => []);
  for (const name of Object.keys(def.samples?.samples ?? {})) {
    const [, l = '0', t = '0'] = name.split('|');
    while (bank[Number(l)].length <= Number(t)) bank[Number(l)].push(new Map());
  }
  if (!bank[0].length) bank[0].push(new Map());
  const turn = layers.map(() => 0);
  const pick = (velocity: number) => {
    const found = layers.findIndex((top) => velocity <= top + 1e-6);
    const l = found < 0 ? layers.length - 1 : found;
    return bank[l][turn[l]++ % bank[l].length];
  };
  const attach = loadSamples(key).then((set) => {
    for (const [name, buffer] of Object.entries(set)) {
      const [note, l = '0', t = '0'] = name.split('|');
      const audio = buffer.get();
      if (audio) bank[Number(l)][Number(t)].set(Math.round(midiOfNote(note)), audio);
    }
  });
  return samplerVoice({ slots: bank.flat(), pick }, options, out, attach, chain.nodes, chain.onNote, def.taper, expressive ? expressiveFor(def) : null, def.bowed);
}

/**
 * A sampler playing the user's own sound, tuned so `root` plays it at its original pitch. The
 * sound comes from the sound library (decoded once per sample rate and shared), or, for a project
 * not yet converted, from the data: URL it carries.
 */
export function createCustomSamplerVoice(sample: CustomSample | undefined, output: Tone.InputNode): SamplerVoice {
  const dataUrl = sample?.soundId ? undefined : sample?.dataUrl;
  if (!sample || (!sample.soundId && !dataUrl)) {
    // No sound loaded yet: ready straight away (so exports never wait on it) and silent
    return { play: () => {}, attack: () => {}, release: () => {}, bend: () => {}, releaseAll: () => {}, ready: Promise.resolve(), dispose: () => {} };
  }
  const out = new Tone.Gain(1).connect(output);
  const slot: Slot = new Map();
  const buffer = dataUrl ? loadCustomSample(dataUrl) : decodeSound(sample.soundId!, out.context.sampleRate).then((audio) => new Tone.ToneAudioBuffer(audio));
  const attach = buffer.then((b) => {
    const audio = b.get();
    if (audio) slot.set(Math.round(midiOfNote(sample.root)), audio);
  });
  return samplerVoice({ slots: [slot], pick: () => slot }, { attack: 0, release: 0.4 }, out, attach, []);
}

// ---------- instrument browser / deck audition ----------

const auditionVoices: Partial<Record<InstrumentKey, SamplerVoice>> = {};

/** Play a sampled instrument on a dry audition sampler (loads the samples on first use). */
export async function triggerAuditionSampler(key: InstrumentKey, notes: string[], duration: string, velocity = 0.85): Promise<void> {
  const voice = (auditionVoices[key] ??= createSamplerVoice(key, auditionInput));
  try {
    await voice.ready;
    voice.play(notes, duration, undefined, velocity);
  } catch {
    // Download failed (the badge shows the error). A failed voice stays silent, so replace it:
    // the next press builds a new one, which tries the download again
    if (auditionVoices[key] === voice) {
      delete auditionVoices[key];
      voice.dispose();
    }
  }
}

/**
 * Let go of downloaded recordings no track uses (`keep`), and the instrument browser's preview
 * players: they're downloaded or rebuilt again when next needed. Returns about how many bytes of
 * sound that frees.
 */
export function forgetUnusedSamples(keep: Set<InstrumentKey>): number {
  let bytes = 0;
  for (const key of Object.keys(auditionVoices) as InstrumentKey[]) {
    auditionVoices[key]?.dispose();
    delete auditionVoices[key];
  }
  for (const key of Object.keys(sampleSets) as InstrumentKey[]) {
    if (keep.has(key)) continue;
    delete sampleSets[key];
    for (const b of Object.values(loadedSets[key] ?? {})) bytes += b.length * b.numberOfChannels * 4;
    delete loadedSets[key];
    useAudioStore.getState().setInstrumentStatus(key, 'unloaded');
  }
  // (The sets kept hold their own recordings)
  recordings.clear();
  return bytes;
}

export function releaseAuditionSamplers(): void {
  Object.values(auditionVoices).forEach((v) => v?.releaseAll());
}
