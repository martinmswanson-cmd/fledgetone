import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { safely } from '../instruments';
import { notLate } from './monotonic';
import { createBus, createDrive, createFilter, createNoise, createOsc, createVoiceSet, noteFrequency, phasedSaws, releaseConstant, releaseTail } from './native';
import { noteJitter } from '../samplers/samplerManager';
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
/** The oscillator setting for a wave: a built-in type, or a table built once per context. */
function waveOf(raw: BaseAudioContext, wave: OscWave): OscillatorType | PeriodicWave {
  if (wave !== 'pulse' && wave !== 'organ' && wave !== 'vowel') return wave;
  let waves = tableWaves.get(raw);
  if (!waves) tableWaves.set(raw, (waves = new Map()));
  let w = waves.get(wave);
  if (!w) {
    const n = 64;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let k = 1; k <= n; k++) imag[k] = TABLES[wave](k);
    w = raw.createPeriodicWave(real, imag);
    waves.set(wave, w);
  }
  return w;
}

/**
 * The Synth Designer: every note is built from the track's patch (see synthPatch.ts) out of plain
 * Web Audio nodes, like the other synths in this folder. A new patch applies from the next note;
 * notes already sounding keep the one they started with.
 */

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
}

export function createDesignedSynth(output: Tone.InputNode, initial: SynthPatch | undefined) {
  const { bus, raw, input } = createBus(output);
  // Noise-fed voices linger before disconnecting (see createVoiceSet)
  const voices = createVoiceSet(raw, 0.3);
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

    // Mono: the previous note gives way, and this one slides from its pitch
    let glideFrom: number | null = null;
    if (p.mono && last && last.voice.stopAt > start) {
      voices.release(last.voice, start, 0.015);
      if (p.glide > 0) glideFrom = last.freq;
    }

    const sources: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    const oscs: OscillatorNode[] = [];
    const detunes: number[] = [];
    const mix = raw.createGain();
    nodes.push(mix);

    const addOsc = (wave: OscillatorType | PeriodicWave, hz: number, detune: number, level: number, pan: number) => {
      const o = createOsc(raw, wave, hz, start, detune + bendCents);
      if (glideFrom !== null) {
        const ratio = hz / freq;
        o.frequency.setValueAtTime(glideFrom * ratio, start);
        o.frequency.exponentialRampToValueAtTime(hz, start + p.glide);
      }
      const g = raw.createGain();
      g.gain.value = level;
      o.connect(g);
      if (pan !== 0) {
        const panner = raw.createStereoPanner();
        panner.pan.value = pan;
        g.connect(panner);
        panner.connect(mix);
        nodes.push(panner);
      } else {
        g.connect(mix);
      }
      sources.push(o);
      oscs.push(o);
      detunes.push(detune);
      nodes.push(o, g);
    };

    const count = p.unison.voices;
    // Analog drift: this note's oscillators each a few cents off, the same every time it plays
    const drift = p.drift ?? 0;
    const wander = (salt: number) => (drift > 0 ? drift * 7 * noteJitter(n.note, start, salt) : 0);
    // Unison saws start at spread points of their cycle, as analog oscillators do (all in step,
    // they sweep audibly as they drift apart)
    const saws = count > 1 ? phasedSaws(raw, Array.from({ length: count }, (_, i) => ((i * 0.618) % 1))) : null;
    const osc1Index = oscs.length;
    let osc1Count = 0;
    for (const [which, o] of [[1, p.osc1], [2, p.osc2]] as const) {
      // Under FM, osc 2 can be silent and still bend osc 1 (below)
      if (!o.on || (o.level <= 0 && !(which === 2 && (p.fm ?? 0) > 0))) continue;
      if (o.level <= 0) continue;
      const hz = freq * 2 ** (o.octave + o.semi / 12);
      for (let i = 0; i < count; i++) {
        const position = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        const wave = saws && o.wave === 'sawtooth' ? saws[i] : waveOf(raw, o.wave);
        addOsc(wave, hz, o.fine + position * p.unison.spread + wander(40 + which * 8 + i), (o.level * 0.35) / Math.sqrt(count), position * p.unison.width);
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
    if (p.sub > 0) addOsc('sine', freq / 2, 0, p.sub * 0.45, 0);
    if (p.noise > 0) {
      const noise = createNoise(raw, start);
      const g = raw.createGain();
      g.gain.value = p.noise * 0.25;
      noise.connect(g);
      g.connect(mix);
      sources.push(noise);
      nodes.push(noise, g);
    }
    if (!sources.length) return;

    // Filter: its cutoff follows the note (key tracking), its envelope moves it in cents
    const tracked = p.filter.cutoff * (freq / 261.63) ** p.filter.keyTrack * (drift > 0 ? 2 ** (drift * 0.2 * noteJitter(n.note, start, 71)) : 1);
    const cutoff = Math.min(20000, Math.max(20, tracked));
    // The ladder: two low-pass poles, the second resonant, with a little drive into them (an analog
    // filter's warmth); the others are one biquad
    const ladder = p.filter.type === 'ladder';
    const filters = ladder ? [createFilter(raw, 'lowpass', cutoff, 0.54), createFilter(raw, 'lowpass', cutoff, Math.max(0.5, p.filter.resonance * 1.3))] : [createFilter(raw, p.filter.type as BiquadFilterType, cutoff, p.filter.resonance)];
    const filter = filters[0];
    if (p.filter.envAmount !== 0) filters.forEach((f) => envelope(f.detune, start, 0, p.filter.envAmount * 1200, p.filterEnv));
    if (ladder) {
      const warm = createDrive(raw, 1.4);
      mix.connect(warm).connect(filters[0]).connect(filters[1]);
      nodes.push(warm);
    } else mix.connect(filter);
    nodes.push(...filters);
    let tail: AudioNode = filters[filters.length - 1];
    if (p.drive > 0) {
      const drive = createDrive(raw, 1 + p.drive * 5);
      const pre = raw.createGain();
      pre.gain.value = 1 + p.drive * 3;
      const post = raw.createGain();
      post.gain.value = 1 / (1 + p.drive * 1.5);
      tail.connect(pre);
      pre.connect(drive);
      drive.connect(post);
      nodes.push(pre, drive, post);
      tail = post;
    }

    const amp = raw.createGain();
    const peak = Tone.dbToGain(p.level) * (0.3 + 0.7 * n.velocity);
    envelope(amp.gain, start, 0, peak, p.amp);
    releaseTo(amp.gain, end, 0, p.amp.release);
    tail.connect(amp);
    nodes.push(amp);
    if (p.filter.envAmount !== 0) filters.forEach((f) => releaseTo(f.detune, end, 0, p.filterEnv.release));

    // LFO
    if (p.lfo.target !== 'off' && p.lfo.depth > 0) {
      const lfo = createOsc(raw, p.lfo.shape, lfoHz(p), start);
      const depth = raw.createGain();
      lfo.connect(depth);
      if (p.lfo.target === 'pitch') {
        depth.gain.value = p.lfo.depth * 100; // up to a semitone either way
        oscs.forEach((o) => depth.connect(o.detune));
      } else if (p.lfo.target === 'filter') {
        depth.gain.value = p.lfo.depth * 3600; // up to three octaves either way
        filters.forEach((f) => depth.connect(f.detune));
      } else {
        const trem = raw.createGain();
        trem.gain.value = 1 - p.lfo.depth / 2;
        depth.gain.value = p.lfo.depth / 2;
        depth.connect(trem.gain);
        amp.disconnect();
        amp.connect(trem);
        trem.connect(input);
        nodes.push(trem);
      }
      sources.push(lfo);
      nodes.push(lfo, depth);
    }
    if (p.lfo.target !== 'amp' || p.lfo.depth <= 0) amp.connect(input);

    const voice: DesignerVoice = { start, stopAt: end + releaseTail(p.amp.release), sources, nodes, amp, patch: p, filters, oscs, detunes };
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
        voices.release(voice, t, voice.patch.amp.release);
        if (voice.patch.filter.envAmount !== 0) voice.filters.forEach((f) => releaseTo(f.detune, t, 0, voice.patch.filterEnv.release));
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
