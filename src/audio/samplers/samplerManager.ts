import * as Tone from 'tone';
import { createLightChorus } from '../effects/lightFx';
import { INSTRUMENTS } from '../instrumentCatalog';
import type { InstrumentKey } from '../instrumentCatalog';
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

/** True for instruments that stream recordings (piano, sax, marimba...). */
export function isSamplerKey(key: InstrumentKey): boolean {
  return INSTRUMENTS[key].kind === 'sampled';
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
    Object.entries(source.samples).map(async ([note, file]) => [note, await Tone.ToneAudioBuffer.fromUrl(source.baseUrl + file)] as const)
  ).then(
    (entries) => {
      setStatus(key, 'ready');
      return Object.fromEntries(entries) as SampleSet;
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
  releaseAll: () => void;
  /** Resolves once samples are attached (rejects if they failed to download). */
  ready: Promise<void>;
  dispose: () => void;
}

/**
 * Character processing that turns a related recording into the instrument: the erhu's nasal
 * bowed tone with its wide expressive vibrato, the mandolin's doubled (paired) strings.
 */
function shapingChain(shape: 'erhu' | 'mandolin' | undefined, output: Tone.InputNode): { input: Tone.InputNode; nodes: { dispose: () => void }[] } {
  if (shape === 'erhu') {
    const vibrato = new Tone.Vibrato({ frequency: 5.8, depth: 0.18 });
    const nasal = new Tone.BiquadFilter({ type: 'peaking', frequency: 1400, Q: 2.2, gain: 7 });
    const thin = new Tone.BiquadFilter({ type: 'highpass', frequency: 280 });
    vibrato.chain(nasal, thin, output);
    return { input: vibrato, nodes: [vibrato, nasal, thin] };
  }
  if (shape === 'mandolin') {
    const courses = createLightChorus({ rate: 5, delayMs: 1.8, depth: 0.35, spread: 160, wet: 0.55 });
    const bright = new Tone.BiquadFilter({ type: 'highshelf', frequency: 2500, gain: 4 });
    courses.output.chain(bright, output);
    return { input: courses.input, nodes: [courses, bright] };
  }
  return { input: output, nodes: [] };
}

function samplerVoice(sampler: Tone.Sampler, attach: Promise<void>, extra: { dispose: () => void }[]): SamplerVoice {
  let loaded = false;
  const ready = attach.then(() => {
    loaded = true;
  });
  ready.catch(() => {}); // the loading badge / inspector reports failures
  return {
    play: (notes, duration, time, velocity) => {
      if (!loaded || notes.length === 0) return; // still downloading: skip rather than throw
      sampler.triggerAttackRelease(notes, duration, time ?? Tone.now(), velocity);
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
  const chain = shapingChain(def.shaping, output);
  const sampler = new Tone.Sampler({ release: def.samples?.release ?? 1 }).connect(chain.input);
  const attach = loadSamples(key).then((set) => {
    for (const [note, buffer] of Object.entries(set)) sampler.add(note as Tone.Unit.Note, buffer);
  });
  return samplerVoice(sampler, attach, chain.nodes);
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
    return { play: () => {}, releaseAll: () => {}, ready: Promise.resolve(), dispose: () => {} };
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

export function releaseAuditionSamplers(): void {
  Object.values(auditionVoices).forEach((v) => v?.releaseAll());
}
