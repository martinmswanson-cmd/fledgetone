import * as Tone from 'tone';
import { createLightChorus } from '../effects/lightFx';
import { INSTRUMENTS } from '../instrumentCatalog';
import type { InstrumentDef, InstrumentKey, Shaping } from '../instrumentCatalog';
import { auditionInput } from '../engine';
import { decodeSound } from '../soundLibrary';
import { useAudioStore } from '../../store/audioStore';
import type { CustomSample } from '../../store/timelineTypes';

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
      const buffer = await Tone.ToneAudioBuffer.fromUrl(source.baseUrl + file);
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

/**
 * Character processing that turns a recording into the instrument.
 * - erhu: a solo violin through a nasal formant and a dark top (the snakeskin resonator), with a
 *   wide vibrato that swells in over the first half second of each note, as a player's does.
 * - amp: the electric guitar's recordings are a dull direct signal with almost nothing above
 *   2 kHz. An amp stage brightens it before a soft clip (which adds the upper harmonics a real
 *   amp does), then a speaker-like presence peak and top roll-off.
 * - acoustic: the steel-string recordings are dark too; brightened with a little edge.
 * - mandolin: doubled (paired) strings and a bright top.
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
  if (shape === 'acoustic') {
    const bright = biquad('highshelf', 1800, 0.7, 8);
    const sparkle = biquad('peaking', 3200, 1.2, 3);
    const edge = saturator(1.3);
    const trim = raw.createGain();
    trim.gain.value = Tone.dbToGain(-2);
    return chain([bright, sparkle, edge, trim]);
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

function samplerVoice(sampler: Tone.Sampler, attach: Promise<void>, extra: { dispose: () => void }[], onNote?: (time: number) => void, taper?: InstrumentDef['taper']): SamplerVoice {
  let loaded = false;
  const ready = attach.then(() => {
    loaded = true;
  });
  ready.catch(() => {}); // the loading badge / inspector reports failures
  return {
    play: (notes, duration, time, velocity) => {
      if (!loaded || notes.length === 0) return; // still downloading: skip rather than throw
      const at = time ?? Tone.now();
      onNote?.(at);
      if (!taper) sampler.triggerAttackRelease(notes, duration, at, velocity);
      else for (const note of notes) sampler.triggerAttackRelease(note, duration, at, velocity * taperGain(taper, note));
    },
    attack: (note, time, velocity) => {
      if (!loaded) return;
      onNote?.(time);
      sampler.triggerAttack(note, time, velocity * taperGain(taper, note));
    },
    release: (note, time) => {
      if (loaded) sampler.triggerRelease(note, time);
    },
    releaseAll: () => sampler.releaseAll(),
    ready,
    dispose: () => {
      sampler.dispose();
      extra.forEach((n) => n.dispose());
    },
  };
}

/** A Tone.Sampler for a sampled instrument in the current context, connected to `output`. */
export function createSamplerVoice(key: InstrumentKey, output: Tone.InputNode): SamplerVoice {
  const def = INSTRUMENTS[key];
  const shaped = shapingChain(def.shaping, output);
  const chain = toneChain(def.tone, shaped);
  // A few ms of attack: a recording stretched to another pitch doesn't always start at zero
  const sampler = new Tone.Sampler({ attack: 0.004, release: def.samples?.release ?? 1 }).connect(chain.input);
  const attach = loadSamples(key).then((set) => {
    for (const [note, buffer] of Object.entries(set)) sampler.add(note as Tone.Unit.Note, buffer);
  });
  return samplerVoice(sampler, attach, chain.nodes, chain.onNote, def.taper);
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
    return { play: () => {}, attack: () => {}, release: () => {}, releaseAll: () => {}, ready: Promise.resolve(), dispose: () => {} };
  }
  const sampler = new Tone.Sampler({ release: 0.4 }).connect(output);
  const buffer = dataUrl ? loadCustomSample(dataUrl) : decodeSound(sample.soundId!, sampler.context.sampleRate).then((audio) => new Tone.ToneAudioBuffer(audio));
  const attach = buffer.then((b) => {
    sampler.add(sample.root as Tone.Unit.Note, b);
  });
  return samplerVoice(sampler, attach, []);
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
  return bytes;
}

export function releaseAuditionSamplers(): void {
  Object.values(auditionVoices).forEach((v) => v?.releaseAll());
}
