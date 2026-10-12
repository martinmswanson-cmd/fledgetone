import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { safely } from '../instruments';
import { notLate } from './monotonic';
import { createBus, createDrive, createFilter, createNoise, createOsc, createVoiceSet, noteFrequency, releaseConstant, releaseTail } from './native';
import type { NativeVoice } from './native';
import { HELD_NOTE } from './edmSynths';
import type { Envelope, LfoSync, SynthPatch } from '../../store/synthPatch';
import { defaultSynthPatch } from '../../store/synthPatch';

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
}

export function createDesignedSynth(output: Tone.InputNode, initial: SynthPatch | undefined) {
  const { bus, raw, input } = createBus(output);
  // Noise-fed voices linger before disconnecting (see createVoiceSet)
  const voices = createVoiceSet(raw, 0.3);
  let patch = initial ?? defaultSynthPatch();
  let last: { voice: DesignerVoice; freq: number } | null = null;

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
    const mix = raw.createGain();
    nodes.push(mix);

    const addOsc = (wave: OscillatorType, hz: number, detune: number, level: number, pan: number) => {
      const o = createOsc(raw, wave, hz, start, detune);
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
      nodes.push(o, g);
    };

    const count = p.unison.voices;
    for (const o of [p.osc1, p.osc2]) {
      if (!o.on || o.level <= 0) continue;
      const hz = freq * 2 ** (o.octave + o.semi / 12);
      for (let i = 0; i < count; i++) {
        const position = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        addOsc(o.wave, hz, o.fine + position * p.unison.spread, (o.level * 0.35) / Math.sqrt(count), position * p.unison.width);
      }
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
    const tracked = p.filter.cutoff * (freq / 261.63) ** p.filter.keyTrack;
    const filter = createFilter(raw, p.filter.type, Math.min(20000, Math.max(20, tracked)), p.filter.resonance);
    if (p.filter.envAmount !== 0) envelope(filter.detune, start, 0, p.filter.envAmount * 1200, p.filterEnv);
    mix.connect(filter);
    nodes.push(filter);
    let tail: AudioNode = filter;
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
    if (p.filter.envAmount !== 0) releaseTo(filter.detune, end, 0, p.filterEnv.release);

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
        depth.connect(filter.detune);
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

    const voice: DesignerVoice = { start, stopAt: end + releaseTail(p.amp.release), sources, nodes, amp, patch: p, filters: [filter], oscs };
    voices.add(voice);
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
