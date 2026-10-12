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
      const loaded = await Tone.ToneAudioBuffer.fromUrl(source.baseUrl + file);
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
  return EXPRESSIVE_BY_CATEGORY[def.category] ?? null;
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

function samplerVoice(sampler: Tone.Sampler, attach: Promise<void>, extra: { dispose: () => void }[], onNote?: (time: number) => void, taper?: InstrumentDef['taper'], expressive?: Expressive | null): SamplerVoice {
  let loaded = false;
  const ready = attach.then(() => {
    loaded = true;
  });
  ready.catch(() => {}); // the loading badge / inspector reports failures
  // Pitch bend: Tone.Sampler plays each note on a buffer source of its own, at the playback rate
  // that tunes the nearest recording to it. A bend scales the rate of every source still sounding,
  // and a note started while bent starts scaled. Tone forgets a source as soon as its release is
  // scheduled, so the sources are kept here, each until it has rung out.
  let bendRatio = 1;
  type Source = { playbackRate: Tone.Param<'positive'>; buffer: { duration: number }; stop: (time: number) => unknown };
  const active = () => (sampler as unknown as { _activeSources: Map<number, Source[]> })._activeSources;
  const allSources = () => [...active().values()].flat();
  /**
   * `played`: seconds of the recording played by `last` (at `rate`), so a held note's end can be
   * moved when a bend changes its speed (Tone stops a source where the recording would run out at
   * the rate it started with, so bent down it would stop early).
   */
  const sounding: Array<{ src: Source; note: string; until: number; base: number; played: number; last: number; rate: number }> = [];
  // (Read in the sampler's own context: in an export, the render's tempo, not the live one)
  const releaseSeconds = () => sampler.toSeconds(sampler.release);
  /** Expressive: a note's own low-pass for its velocity, between its source and the sampler's output (gone when it ends). */
  const voiceFilter = (src: Source, note: string, velocity: number) => {
    if (!expressive) return;
    const tsrc = src as unknown as Tone.ToneBufferSource;
    const raw = sampler.context.rawContext as unknown as BaseAudioContext;
    const filter = raw.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.6;
    filter.frequency.value = expressiveCutoff(velocity, expressive.depth, Tone.Frequency(note).toFrequency());
    tsrc.disconnect();
    Tone.connect(tsrc, filter);
    Tone.connect(filter, sampler.output);
    const ended = tsrc.onended;
    tsrc.onended = (s) => {
      ended(s);
      filter.disconnect();
    };
  };
  /** The velocity a note is triggered at: as given, or on the dB curve with a little variation. */
  const level = (note: string, velocity: number, at: number) =>
    expressive ? expressiveGain(velocity, expressive.rangeDb) * 10 ** ((0.6 * noteJitter(note, at, 7)) / 20) : velocity;
  /** Start `trigger`'s notes, keep their sources (bent by the bend now) until `until`. */
  const started = (notes: string[], until: number, trigger: () => void, at: number, velocity = 1) => {
    const before = new Set(allSources());
    trigger();
    const fresh = allSources().filter((src) => !before.has(src));
    fresh.forEach((src, i) => {
      const note = notes[Math.min(i, notes.length - 1)];
      if (expressive) {
        voiceFilter(src, note, velocity);
        // Each hit a hair off the last: up to ±3 cents
        src.playbackRate.value *= 2 ** ((3 * noteJitter(note, at, 13)) / 1200);
      }
      // Its rate unbent, which every bend scales (reading the rate back mid-glide would drift)
      const base = src.playbackRate.value;
      if (bendRatio !== 1) src.playbackRate.value = base * bendRatio;
      sounding.push({ src, note: notes[Math.min(i, notes.length - 1)], until, base, played: 0, last: at, rate: base * bendRatio });
    });
  };
  const prune = (time: number) => {
    for (let i = sounding.length - 1; i >= 0; i--) if (sounding[i].until < time) sounding.splice(i, 1);
  };
  return {
    play: (notes, duration, time, velocity) => {
      if (!loaded || notes.length === 0) return; // still downloading: skip rather than throw
      const at = time ?? Tone.now();
      onNote?.(at);
      const end = at + sampler.toSeconds(duration);
      prune(at);
      // Attack and release apart (what triggerAttackRelease does), so the sources can be kept
      started(
        notes,
        end + releaseSeconds() + 0.1,
        () => {
          if (!taper && !expressive) sampler.triggerAttack(notes, at, velocity);
          else for (const note of notes) sampler.triggerAttack(note, at, level(note, velocity, at) * taperGain(taper, note));
        },
        at,
        velocity
      );
      sampler.triggerRelease(notes, end);
    },
    attack: (note, time, velocity) => {
      if (!loaded) return;
      onNote?.(time);
      prune(time);
      started([note], Infinity, () => sampler.triggerAttack(note, time, level(note, velocity, time) * taperGain(taper, note)), time, velocity);
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
        if (s.until === Infinity) {
          try {
            s.src.stop(time + Math.max(0, s.src.buffer.duration - s.played) / s.rate);
          } catch {
            // Already stopped
          }
        }
      }
      bendRatio = next;
    },
    release: (note, time) => {
      if (!loaded) return;
      sampler.triggerRelease(note, time);
      for (const s of sounding) if (s.note === note && s.until === Infinity) s.until = time + releaseSeconds() + 0.1;
    },
    releaseAll: () => {
      sampler.releaseAll();
      const until = sampler.context.currentTime + releaseSeconds() + 0.1;
      for (const s of sounding) s.until = Math.min(s.until, until);
    },
    ready,
    dispose: () => {
      sampler.dispose();
      extra.forEach((n) => n.dispose());
    },
  };
}

/** A Tone.Sampler for a sampled instrument in the current context, connected to `output`. */
export function createSamplerVoice(key: InstrumentKey, output: Tone.InputNode, expressive = false): SamplerVoice {
  const def = INSTRUMENTS[key];
  const shaped = shapingChain(def.shaping, output);
  const chain = toneChain(def.tone, shaped);
  // A few ms of attack: a recording stretched to another pitch doesn't always start at zero
  const sampler = new Tone.Sampler({ attack: 0.004, release: def.samples?.release ?? 1 }).connect(chain.input);
  const attach = loadSamples(key).then((set) => {
    for (const [note, buffer] of Object.entries(set)) sampler.add(note as Tone.Unit.Note, buffer);
  });
  return samplerVoice(sampler, attach, chain.nodes, chain.onNote, def.taper, expressive ? expressiveFor(def) : null);
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
