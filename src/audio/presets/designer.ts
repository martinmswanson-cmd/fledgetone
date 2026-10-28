import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { safely } from '../instruments';
import { notLate } from './monotonic';
import { builtinWave, createBus, createDrive, createFilter, createNoise, createOsc, createVoiceSet, noteFrequency, phasedSaw, releaseConstant, releaseTail, scaledWave } from './native';
import { noteJitter } from '../samplers/samplerManager';
import { noiseKey } from '../seededNoise';
import type { NativeVoice } from './native';
import { HELD_NOTE } from './edmSynths';
import type { Envelope, LfoSync, OscWave, SynthPatch } from '../../store/synthPatch';
import { defaultSynthPatch } from '../../store/synthPatch';

/** Harmonics (amplitude by number, from 1) of the table waves (see OscWave). */
const TABLES: Record<'pulse' | 'organ' | 'vowel', (k: number) => number> = {
  // A pulse 1/8 of the cycle wide: every harmonic but each eighth one, strongest low
  pulse: (k) => Math.abs(Math.sin((Math.PI * k) / 8)) / k,
  // Drawbars 8', 4', 2 2/3', 2', 1 3/5' and a touch of 1': harmonics 1, 2, 3, 4, 5, 8
  organ: (k) => ({ 1: 1, 2: 0.75, 3: 0.55, 4: 0.5, 5: 0.25, 8: 0.15 })[k] ?? 0,
  // A saw's harmonics through two formant bumps near 700 Hz and 1200 Hz (an "ah", at C4)
  vowel: (k) => {
    const f = 261.63 * k;
    const bump = (c: number, w: number) => Math.exp(-(((f - c) / w) ** 2));
    return (1 / k) * (0.15 + bump(700, 160) * 1.6 + bump(1200, 220) * 1.1 + bump(2600, 400) * 0.4);
  },
};
const tableWaves = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
/** A table wave's harmonics (see TABLES). */
function tableSeries(wave: 'pulse' | 'organ' | 'vowel'): { real: Float32Array; imag: Float32Array } {
  const n = 64;
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) imag[k] = TABLES[wave](k);
  return { real, imag };
}
/** The oscillator setting for a wave: a built-in type, or a table built once per context. */
function waveOf(raw: BaseAudioContext, wave: OscWave): OscillatorType | PeriodicWave {
  if (wave !== 'pulse' && wave !== 'organ' && wave !== 'vowel') return wave;
  let waves = tableWaves.get(raw);
  if (!waves) tableWaves.set(raw, (waves = new Map()));
  let w = waves.get(wave);
  if (!w) {
    const { real, imag } = tableSeries(wave);
    w = raw.createPeriodicWave(real, imag);
    waves.set(wave, w);
  }
  return w;
}
/**
 * A wave at `level`, for an oscillator with no gain node after it: exactly what waveOf's wave
 * through a gain of `level` sounds like (see scaledWave).
 */
function waveAt(raw: BaseAudioContext, wave: OscWave, level: number): PeriodicWave {
  if (wave !== 'pulse' && wave !== 'organ' && wave !== 'vowel') return builtinWave(raw, wave, level);
  return scaledWave(raw, `designer:${wave}`, () => tableSeries(wave), level);
}

/**
 * The Synth Designer: every note is built from the track's patch (see synthPatch.ts) out of plain
 * Web Audio nodes, like the other synths in this folder. A new patch applies from the next note;
 * notes already sounding keep the one they started with.
 */

/** Decay times (to 95%) a sustain-0 envelope takes to fall 80 dB. */
const FADED = Math.log(1e4) / 3;
/** Samples a WaveShaperNode delays what it shapes by, for each oversampling (as Chrome's do). */
const SHAPER_LATENCY: Record<OverSampleType, number> = { none: 0, '2x': 128, '4x': 192 };
/**
 * The ladder's warm drive is oversampled 2x, not 4x: it's gentle, so the harmonics it adds above
 * the top of hearing (which fold back down unless oversampled) are faint, and what 2x lets fold
 * back differs from 4x by about -90 dB. A 4x shaper was the most expensive node of a ladder note
 * (on a stereo note, as much as ten biquad filters); 2x costs a third of it.
 */
const WARM_OVERSAMPLE: OverSampleType = '2x';
/**
 * The patch's drive: 2x only while it's gentle (below DRIVE_4X), where what 2x lets fold back is
 * as faint as 4x's (about 88 dB under the note on a bright saw); past it, 4x. (At 2x a drive of
 * 0.5 folded fizz back 58 to 63 dB under a saw from C5 to C7, and 0.8 only 40 to 45 dB under;
 * at 4x they're 87 to 91 and 74 to 77 dB down.) An export always shapes at 4x: it has the time.
 */
const DRIVE_4X = 0.2;
function driveOversampling(drive: number, offline: boolean): OverSampleType {
  return offline || drive >= DRIVE_4X ? '4x' : '2x';
}

const SYNC_BEATS: Record<Exclude<LfoSync, 'free'>, number> = { '1/1': 4, '1/2': 2, '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6, '1/32': 0.125 };

/** Attack, decay to sustain (as a fraction of `peak`) from `from` at `at`. */
function envelope(param: AudioParam, at: number, from: number, peak: number, e: Envelope): void {
  param.setValueAtTime(from, at);
  param.setTargetAtTime(peak, at, Math.max(0.001, e.attack) / 3);
  param.setTargetAtTime(from + (peak - from) * e.sustain, at + e.attack, Math.max(0.001, e.decay) / 3);
}

/** From whatever the envelope has reached at `at`, back to `to` over the release. */
function releaseTo(param: AudioParam, at: number, to: number, seconds: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(at);
  else param.cancelScheduledValues(at);
  param.setTargetAtTime(to, at, releaseConstant(seconds));
}

interface DesignerVoice extends NativeVoice {
  /** The patch it started with, for its release */
  patch: SynthPatch;
  filters: BiquadFilterNode[];
  oscs: OscillatorNode[];
  /** Each oscillator's own detune (cents), before any bend */
  detunes: number[];
  /** Seconds its envelopes run ahead of its oscillators (see SHAPER_LATENCY) */
  early: number;
  /** The same for its filter envelope */
  filterEarly: number;
}

/** `seed`: the track's (see trackSeed), which with the note and its time picks the noise of each note. */
export function createDesignedSynth(output: Tone.InputNode, initial: SynthPatch | undefined, seed = 0) {
  const { bus, raw, input } = createBus(output);
  // Noise-fed voices linger before disconnecting (see createVoiceSet)
  const voices = createVoiceSet(raw, 0.3);
  // (An export renders in an OfflineAudioContext: see driveOversampling)
  const offline = typeof OfflineAudioContext !== 'undefined' && raw instanceof OfflineAudioContext;
  let patch = initial ?? defaultSynthPatch();
  let last: { voice: DesignerVoice; freq: number } | null = null;
  // Pitch bend (cents): the bend lane, vibrato and each note's own bend (scoops, slides) move every
  // sounding voice's oscillators; a voice starting later starts at the bend reached
  let bendCents = 0;
  const live = new Set<DesignerVoice>();

  // A synced rate follows the tempo of this context's Transport (the export's has its own)
  const lfoHz = (p: SynthPatch) => (p.lfo.sync === 'free' ? p.lfo.rate : 1 / (bus.toSeconds('4n') * SYNC_BEATS[p.lfo.sync]));

  const playNote = (n: PlayableNote, start: number): DesignerVoice | undefined => {
    const p = patch;
    const length = bus.toSeconds(n.duration);
    const freq = noteFrequency(n.note);
    if (!Number.isFinite(length) || !(freq > 0)) return;
    const end = start + Math.max(0.01, length);

    const ladder = p.filter.type === 'ladder';
    // A shaper oversampling 4x delays what passes through it by SHAPER_LATENCY['4x'] samples, and
    // the envelopes after it were voiced on that: where a shaper oversamples less (or not at all),
    // the envelopes, filter sweeps and LFOs after it start that much earlier instead, so the note
    // sounds the same, only that much sooner (no longer late by the shaper's delay). A note too
    // close to now for its envelopes to start earlier keeps 4x.
    const lessOf = (o: OverSampleType) => (SHAPER_LATENCY['4x'] - SHAPER_LATENCY[o]) / raw.sampleRate;
    const ahead = start - ((ladder ? lessOf(WARM_OVERSAMPLE) : 0) + (p.drive > 0 ? lessOf(driveOversampling(p.drive, offline)) : 0)) >= raw.currentTime;
    const warmOversample: OverSampleType = ladder && ahead ? WARM_OVERSAMPLE : '4x';
    const driveOversample: OverSampleType = p.drive > 0 && ahead ? driveOversampling(p.drive, offline) : '4x';
    // The filters come after the warm drive; the amp after both
    const filterEarly = ladder ? lessOf(warmOversample) : 0;
    const early = filterEarly + (p.drive > 0 ? lessOf(driveOversample) : 0);
    const from = start - early;
    const until = end - early;
    const filterFrom = start - filterEarly;
    const filterUntil = end - filterEarly;

    // Mono: the previous note gives way, and this one slides from its pitch
    let glideFrom: number | null = null;
    if (p.mono && last && last.voice.stopAt > start) {
      voices.release(last.voice, from, 0.015);
      if (p.glide > 0) glideFrom = last.freq;
    }

    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];
    const detunes: number[] = [];
    // What feeds the filter section (connected once it's built). Every node a sounding note has
    // costs the audio thread time in every block, so a note is built from as few as sound the
    // same: levels are built into the oscillators' waves (no gain node each), oscillators at the
    // same place in the stereo field share one panner, and they sum straight into the filter.
    const feeds: AudioNode[] = [];
    const panners = new Map<number, StereoPannerNode>();

    const addOsc = (wave: PeriodicWave, hz: number, detune: number, pan: number) => {
      const o = createOsc(raw, wave, hz, start, detune + bendCents);
      if (glideFrom !== null) {
        const ratio = hz / freq;
        o.frequency.setValueAtTime(glideFrom * ratio, start);
        o.frequency.exponentialRampToValueAtTime(hz, start + p.glide);
      }
      if (pan !== 0) {
        let panner = panners.get(pan);
        if (!panner) {
          panner = raw.createStereoPanner();
          panner.pan.value = pan;
          panners.set(pan, panner);
          feeds.push(panner);
          nodes.push(panner);
        }
        o.connect(panner);
      } else {
        feeds.push(o);
      }
      sources.push(o);
      oscs.push(o);
      detunes.push(detune);
      nodes.push(o);
    };

    const count = p.unison.voices;
    // Analog drift: this note's oscillators each a few cents off from each other, the same every time it plays
    const drift = p.drift ?? 0;
    const wander = (salt: number) => (drift > 0 ? drift * 7 * noteJitter(n.note, start, salt) : 0);
    // Unison saws start at spread points of their cycle, as analog oscillators do (all in step,
    // they sweep audibly as they drift apart)
    const phase = (i: number) => (i * 0.618) % 1;
    const osc1Index = oscs.length;
    let osc1Count = 0;
    for (const [which, o] of [[1, p.osc1], [2, p.osc2]] as const) {
      // Under FM, osc 2 can be silent and still bend osc 1 (below)
      if (!o.on || (o.level <= 0 && !(which === 2 && (p.fm ?? 0) > 0))) continue;
      if (o.level <= 0) continue;
      const hz = freq * 2 ** (o.octave + o.semi / 12);
      const level = (o.level * 0.35) / Math.sqrt(count);
      for (let i = 0; i < count; i++) {
        const position = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        const wave = count > 1 && o.wave === 'sawtooth' ? phasedSaw(raw, phase(i), level) : waveAt(raw, o.wave, level);
        addOsc(wave, hz, o.fine + position * p.unison.spread + wander(40 + which * 8 + i), position * p.unison.width);
        if (which === 1) osc1Count++;
      }
    }
    // FM: osc 2's wave bends osc 1's pitch at audio rate, by up to three times its frequency
    if ((p.fm ?? 0) > 0 && p.osc2.on && p.osc1.on && osc1Count > 0) {
      const hz2 = freq * 2 ** (p.osc2.octave + p.osc2.semi / 12);
      const hz1 = freq * 2 ** (p.osc1.octave + p.osc1.semi / 12);
      const mod = createOsc(raw, waveOf(raw, p.osc2.wave), hz2, start, p.osc2.fine + bendCents);
      const index = raw.createGain();
      index.gain.value = p.fm! * 3 * hz1;
      mod.connect(index);
      for (let i = osc1Index; i < osc1Index + osc1Count; i++) index.connect(oscs[i].frequency);
      sources.push(mod);
      oscs.push(mod);
      detunes.push(p.osc2.fine);
      nodes.push(mod, index);
    }
    if (p.sub > 0) addOsc(builtinWave(raw, 'sine', p.sub * 0.45), freq / 2, 0, 0);
    if (p.noise > 0) {
      const noise = createNoise(raw, start, noiseKey(seed, n.note));
      const g = raw.createGain();
      g.gain.value = p.noise * 0.25;
      noise.connect(g);
      feeds.push(g);
      sources.push(noise);
      nodes.push(noise, g);
    }
    if (!sources.length) return;

    // Filter: its cutoff follows the note (key tracking), its envelope moves it in cents
    const tracked = p.filter.cutoff * (freq / 261.63) ** p.filter.keyTrack * (drift > 0 ? 2 ** (drift * 0.2 * noteJitter(n.note, start, 71)) : 1);
    const cutoff = Math.min(20000, Math.max(20, tracked));
    // The ladder: two low-pass poles, the second resonant, with a little drive into them (an analog
    // filter's warmth); the others are one biquad
    const filters = ladder ? [createFilter(raw, 'lowpass', cutoff, 0.54), createFilter(raw, 'lowpass', cutoff, Math.max(0.5, p.filter.resonance * 1.3))] : [createFilter(raw, p.filter.type as BiquadFilterType, cutoff, p.filter.resonance)];
    if (p.filter.envAmount !== 0) filters.forEach((f) => envelope(f.detune, filterFrom, 0, p.filter.envAmount * 1200, p.filterEnv));
    let head: AudioNode = filters[0];
    if (ladder) {
      const warm = createDrive(raw, 1.4);
      warm.oversample = warmOversample;
      warm.connect(filters[0]).connect(filters[1]);
      nodes.push(warm);
      head = warm;
    }
    feeds.forEach((f) => f.connect(head));
    nodes.push(...filters);
    let tail: AudioNode = filters[filters.length - 1];
    if (p.drive > 0) {
      // The gains into and out of the drive are built into its curve
      const drive = createDrive(raw, 1 + p.drive * 5, 1 + p.drive * 3, 1 / (1 + p.drive * 1.5));
      drive.oversample = driveOversample;
      tail.connect(drive);
      nodes.push(drive);
      tail = drive;
    }

    const amp = raw.createGain();
    const peak = Tone.dbToGain(p.level) * (0.3 + 0.7 * n.velocity);
    envelope(amp.gain, from, 0, peak, p.amp);
    releaseTo(amp.gain, until, 0, p.amp.release);
    tail.connect(amp);
    nodes.push(amp);
    if (p.filter.envAmount !== 0) filters.forEach((f) => releaseTo(f.detune, filterUntil, 0, p.filterEnv.release));

    // LFO: its depth is built into its wave (no gain node)
    if (p.lfo.target !== 'off' && p.lfo.depth > 0) {
      const depth = p.lfo.target === 'pitch' ? p.lfo.depth * 100 : p.lfo.target === 'filter' ? p.lfo.depth * 3600 : p.lfo.depth / 2;
      // An LFO on what comes after a shaper runs that much ahead with its envelopes (see early):
      // the same start, a cycle that far on (started early, its first cycle could start differently)
      const rate = lfoHz(p);
      const lead = (p.lfo.target === 'filter' ? filterEarly : p.lfo.target === 'amp' ? early : 0) * rate;
      const lfo = createOsc(raw, builtinWave(raw, p.lfo.shape, depth, lead - Math.floor(lead)), rate, start);
      if (p.lfo.target === 'pitch') {
        // up to a semitone either way
        oscs.forEach((o) => lfo.connect(o.detune));
      } else if (p.lfo.target === 'filter') {
        // up to three octaves either way
        filters.forEach((f) => lfo.connect(f.detune));
      } else {
        const trem = raw.createGain();
        trem.gain.value = 1 - p.lfo.depth / 2;
        lfo.connect(trem.gain);
        amp.connect(trem);
        trem.connect(input);
        nodes.push(trem);
      }
      sources.push(lfo);
      nodes.push(lfo);
    }
    if (p.lfo.target !== 'amp' || p.lfo.depth <= 0) amp.connect(input);

    // A note that dies away on its own (sustain 0) stops once it's 80 dB down, however long it's held
    const stopAt = Math.min(end + releaseTail(p.amp.release), p.amp.sustain > 0 ? Infinity : from + p.amp.attack + Math.max(0.001, p.amp.decay) * FADED);
    const voice: DesignerVoice = { start, stopAt, sources, nodes, amp, patch: p, filters, oscs, detunes, early, filterEarly };
    voices.add(voice);
    for (const v of live) if (v.stopAt < raw.currentTime) live.delete(v);
    live.add(voice);
    last = { voice, freq };
    return voice;
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      const start = notLate(bus.context, time);
      if (patch.mono) {
        // One note at a time: the loudest of a chord
        const n = notes.reduce((a, b) => (b.velocity > a.velocity ? b : a));
        safely(() => playNote(n, start));
      } else {
        for (const n of notes) safely(() => playNote(n, start));
      }
    },
    hold: (note: PlayableNote, time: number) => {
      const voice = playNote({ ...note, duration: HELD_NOTE }, notLate(bus.context, time));
      return (at: number) => {
        if (!voice) return;
        const t = notLate(bus.context, at);
        voices.release(voice, Math.max(raw.currentTime, t - voice.early), voice.patch.amp.release);
        if (voice.patch.filter.envAmount !== 0) voice.filters.forEach((f) => releaseTo(f.detune, Math.max(raw.currentTime, t - voice.filterEarly), 0, voice.patch.filterEnv.release));
      };
    },
    bend: (cents: number, time: number) => {
      if (Math.abs(cents - bendCents) < 0.01) return;
      bendCents = cents;
      const t = notLate(bus.context, time);
      for (const v of live) {
        if (v.stopAt <= t) continue;
        v.oscs.forEach((o, i) => o.detune.setTargetAtTime(v.detunes[i] + cents, t, 0.006));
      }
    },
    setPatch: (next: SynthPatch | undefined) => {
      patch = next ?? defaultSynthPatch();
    },
    releaseAll: () => voices.releaseAll(raw.currentTime, 0.05),
    dispose: () => {
      voices.stopAll();
      bus.dispose();
    },
  };
}
