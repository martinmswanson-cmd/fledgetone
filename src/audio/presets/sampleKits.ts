import * as Tone from 'tone';
import type { DrumRack, MultiSample, RackPad } from '../../store/timelineTypes';
import { RACK_PADS } from '../../store/timelineTypes';
import { padOfNote, zoneFor, noteMidi } from '../../store/sampleKits';
import { decodeSound } from '../soundLibrary';
import { alwaysStereo } from '../nativeNodes';
import type { NoteOff, PlayableNote, TrackInstrument, VoiceControl } from '../instruments';

/**
 * The Drum Rack and the Multi Sampler: the user's own sounds played from buffers, each hit or note
 * a buffer source and a gain made when it starts and let go when it ends (nothing runs between
 * them). Live and in the WAV export alike; `ready` waits for every sound to be decoded.
 */

type Raw = BaseAudioContext;

/** A note name as MIDI (NaN for a name that isn't one). */
const midiOf = (note: string) => noteMidi(note);

/** A soft clipping curve for a pad's Drive (0: none). */
function driveCurve(amount: number): Float32Array<ArrayBuffer> | null {
  if (amount <= 0.001) return null;
  const k = 1 + amount * 24;
  const curve = new Float32Array(2049);
  const norm = Math.tanh(k);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/** A copy of `buffer` played backwards. */
function reversed(raw: Raw, buffer: AudioBuffer): AudioBuffer {
  const out = raw.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).slice().reverse(), c);
  return out;
}

const dbGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

interface Hit {
  source: AudioBufferSourceNode;
  env: GainNode;
  pad: number;
  stopAt: number;
}

/** A pad's own effects, in order: drive, high-pass, low-pass, pan, level. Made on its first hit. */
interface PadChain {
  input: GainNode;
  shaper: WaveShaperNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  pan: StereoPannerNode;
  level: GainNode;
  drive: number;
}

export function createRackInstrument(output: Tone.InputNode, initial: DrumRack | undefined): TrackInstrument & { setRack: (rack: DrumRack | undefined) => void } {
  const out = new Tone.Gain(1).connect(output);
  // Two channels from here on, whatever mix of one- and two-channel sounds it plays (see alwaysStereo)
  alwaysStereo(out);
  const raw = out.context.rawContext as unknown as Raw;
  const into = out.input as unknown as AudioNode;
  let rack = initial;
  const chains = new Map<number, PadChain>();
  /** Each pad's sound as it plays (reversed if the pad is), by pad */
  const buffers = new Map<number, AudioBuffer>();
  /** What each pad's buffer was made from, so a change of sound or direction reloads it */
  const loadedAs = new Map<number, string>();
  const hits = new Set<Hit>();
  let disposed = false;

  const applyChain = (chain: PadChain, pad: RackPad) => {
    const now = raw.currentTime;
    chain.level.gain.setTargetAtTime(dbGain(pad.gain), now, 0.01);
    chain.pan.pan.setTargetAtTime(pad.pan, now, 0.01);
    chain.lowpass.frequency.setTargetAtTime(pad.lowpass, now, 0.01);
    chain.highpass.frequency.setTargetAtTime(pad.highpass, now, 0.01);
    if (chain.drive !== pad.drive) {
      const was = chain.drive > 0.001;
      const now = pad.drive > 0.001;
      chain.drive = pad.drive;
      if (now) chain.shaper.curve = driveCurve(pad.drive);
      if (was !== now) {
        // Patched in or out
        chain.input.disconnect();
        chain.shaper.disconnect();
        if (now) {
          chain.input.connect(chain.shaper);
          chain.shaper.connect(chain.highpass);
        } else chain.input.connect(chain.highpass);
      }
    }
  };
  const chainFor = (i: number, pad: RackPad): PadChain => {
    let chain = chains.get(i);
    if (chain) return chain;
    const input = raw.createGain();
    const shaper = raw.createWaveShaper();
    // (oversampled, so the drive's clipping doesn't fold back as fizz)
    shaper.oversample = '4x';
    const highpass = raw.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.Q.value = 0.7;
    const lowpass = raw.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 0.7;
    const pan = raw.createStereoPanner();
    const level = raw.createGain();
    // The drive's shaper is in the chain only while it drives (a shaper with no curve was silent live)
    if (pad.drive > 0.001) {
      input.connect(shaper);
      shaper.connect(highpass);
    } else input.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(pan);
    pan.connect(level);
    level.connect(into);
    // Its first settings at once (a hit follows straight away)
    level.gain.value = dbGain(pad.gain);
    pan.pan.value = pad.pan;
    lowpass.frequency.value = pad.lowpass;
    highpass.frequency.value = pad.highpass;
    if (pad.drive > 0.001) shaper.curve = driveCurve(pad.drive);
    chain = { input, shaper, highpass, lowpass, pan, level, drive: pad.drive };
    chains.set(i, chain);
    return chain;
  };

  /** Decode the pads' sounds that changed. Resolves when they're all in. */
  const load = (next: DrumRack | undefined): Promise<unknown> => {
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < RACK_PADS; i++) {
      const pad = next?.pads[i];
      const key = pad?.soundId ? `${pad.soundId}${pad.reverse ? '~' : ''}` : '';
      if (loadedAs.get(i) === key) continue;
      loadedAs.set(i, key);
      if (!pad?.soundId) {
        buffers.delete(i);
        continue;
      }
      const reverse = !!pad.reverse;
      jobs.push(
        decodeSound(pad.soundId, raw.sampleRate).then((b) => {
          if (disposed || loadedAs.get(i) !== key) return;
          buffers.set(i, reverse ? reversed(raw, b) : b);
        })
      );
    }
    return Promise.all(jobs);
  };
  const ready = load(rack);

  /** Fade out and stop a hit at `time` (a choke, or all notes off). */
  const cut = (hit: Hit, time: number) => {
    if (hit.stopAt <= time) return;
    const at = Math.max(time, raw.currentTime);
    hit.env.gain.cancelScheduledValues(at);
    hit.env.gain.setTargetAtTime(0, at, 0.002);
    hit.source.stop(at + 0.015);
    hit.stopAt = at + 0.015;
  };

  const hit = (i: number, time: number, velocity: number) => {
    const pad = rack?.pads[i];
    const buffer = buffers.get(i);
    if (!pad || !buffer) return;
    const at = Math.max(time, raw.currentTime);
    // A pad in a choke group cuts the others in it (and itself, retriggered)
    if (pad.choke) for (const h of hits) if (rack?.pads[h.pad]?.choke === pad.choke) cut(h, at);
    const chain = chainFor(i, pad);
    const source = raw.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.pow(2, pad.pitch / 12);
    const env = raw.createGain();
    const level = Math.max(0, Math.min(1, velocity)) ** 1.2;
    env.gain.setValueAtTime(level, at);
    const length = buffer.duration / source.playbackRate.value;
    let stopAt = at + length;
    if (pad.decay > 0 && pad.decay < length) {
      // Holds a moment, then dies away to about -60 dB by `decay`
      env.gain.setValueAtTime(level, at + pad.decay * 0.25);
      env.gain.setTargetAtTime(0, at + pad.decay * 0.25, (pad.decay * 0.75) / 6.9);
      stopAt = at + pad.decay + 0.02;
    }
    source.connect(env);
    env.connect(chain.input);
    source.start(at);
    source.stop(stopAt);
    const h: Hit = { source, env, pad: i, stopAt };
    hits.add(h);
    source.onended = () => {
      hits.delete(h);
      source.disconnect();
      env.disconnect();
    };
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      for (const n of notes) {
        const i = padOfNote(n.note);
        if (i >= 0) hit(i, time, n.velocity);
      }
    },
    noteOn: (note: PlayableNote, time: number): NoteOff => {
      const i = padOfNote(note.note);
      if (i >= 0) hit(i, time, note.velocity);
      // One-shots: a pad rings out whatever the key does
      return () => {};
    },
    releaseAll: () => {
      for (const h of hits) cut(h, raw.currentTime);
    },
    ready,
    setRack: (next) => {
      rack = next;
      void load(next);
      next?.pads.forEach((pad, i) => {
        const chain = chains.get(i);
        if (chain) applyChain(chain, pad);
      });
    },
    dispose: () => {
      disposed = true;
      for (const h of hits) {
        h.source.onended = null;
        try {
          h.source.stop();
        } catch {
          // Already stopped
        }
        h.source.disconnect();
        h.env.disconnect();
      }
      hits.clear();
      for (const c of chains.values()) [c.input, c.shaper, c.highpass, c.lowpass, c.pan, c.level].forEach((n) => n.disconnect());
      chains.clear();
      out.dispose();
    },
  };
}

interface Voice {
  source: AudioBufferSourceNode;
  env: GainNode;
  /** The note's offset from its sound's root, in semitones (the bend adds to it) */
  semis: number;
  stopAt: number;
  released: boolean;
}

export function createMultiInstrument(output: Tone.InputNode, initial: MultiSample | undefined): TrackInstrument & { setMulti: (multi: MultiSample | undefined) => void } {
  const out = new Tone.Gain(1).connect(output);
  // Two channels from here on, whatever mix of one- and two-channel sounds it plays (see alwaysStereo)
  alwaysStereo(out);
  const raw = out.context.rawContext as unknown as Raw;
  const into = out.input as unknown as AudioNode;
  let multi = initial;
  const buffers = new Map<string, AudioBuffer>();
  const voices = new Set<Voice>();
  let bendCents = 0;
  let disposed = false;

  const load = (next: MultiSample | undefined): Promise<unknown> =>
    Promise.all(
      [...new Set((next?.zones ?? []).map((z) => z.soundId))]
        .filter((id) => !buffers.has(id))
        .map((id) =>
          decodeSound(id, raw.sampleRate).then((b) => {
            if (!disposed) buffers.set(id, b);
          })
        )
    );
  const ready = load(multi);

  const rateOf = (semis: number) => Math.pow(2, (semis + bendCents / 100) / 12);

  /** Let a voice go: its release from `time`. */
  const release = (v: Voice, time: number) => {
    if (v.released) return;
    v.released = true;
    const at = Math.max(time, raw.currentTime);
    const r = Math.max(0.005, multi?.release ?? 0.3);
    v.env.gain.cancelScheduledValues(at);
    v.env.gain.setTargetAtTime(0, at, r / 5);
    const end = Math.min(v.stopAt, at + r + 0.05);
    v.source.stop(end);
    v.stopAt = end;
  };

  /** Start a note at `time`; returns its voice (or null when nothing plays it). */
  const start = (note: string, velocity: number, time: number): Voice | null => {
    const midi = midiOf(note);
    if (!multi || !Number.isFinite(midi)) return null;
    const zone = zoneFor(multi.zones, midi, velocity);
    const buffer = zone && buffers.get(zone.soundId);
    if (!zone || !buffer) return null;
    const at = Math.max(time, raw.currentTime);
    const semis = midi - zone.root;
    const source = raw.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(rateOf(semis), at);
    const env = raw.createGain();
    const level = Math.max(0, Math.min(1, velocity));
    const attack = Math.max(0.001, multi.attack);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + attack);
    source.connect(env);
    env.connect(into);
    source.start(at);
    const stopAt = at + buffer.duration / source.playbackRate.value;
    source.stop(stopAt);
    const v: Voice = { source, env, semis, stopAt, released: false };
    voices.add(v);
    source.onended = () => {
      voices.delete(v);
      source.disconnect();
      env.disconnect();
    };
    return v;
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      for (const n of notes) {
        const v = start(n.note, n.velocity, time);
        // (In the render's own context: an export's tempo, not the live one)
        if (v) release(v, time + out.toSeconds(n.duration));
      }
    },
    noteOn: (note: PlayableNote, time: number): NoteOff => {
      const v = start(note.note, note.velocity, time);
      return (at: number) => {
        if (v) release(v, at);
      };
    },
    noteVoice: (note: PlayableNote, time: number): VoiceControl | null => {
      const v = start(note.note, note.velocity, time);
      if (!v) return null;
      const level = Math.max(0, Math.min(1, note.velocity));
      const settled = Math.max(time, raw.currentTime) + Math.max(0.001, multi?.attack ?? 0.002);
      let cents = 0;
      return {
        bend: (c, t) => {
          cents = c;
          v.source.playbackRate.linearRampToValueAtTime(rateOf(v.semis + cents / 100), Math.max(t, raw.currentTime));
        },
        pressure: (p, t) => {
          if (v.released) return;
          v.env.gain.linearRampToValueAtTime(level * Math.max(0, Math.min(1, p)), Math.max(t, settled));
        },
        off: (t) => release(v, t),
      };
    },
    bend: (cents: number, time: number) => {
      bendCents = cents;
      const at = Math.max(time, raw.currentTime);
      for (const v of voices) v.source.playbackRate.setTargetAtTime(rateOf(v.semis), at, 0.005);
    },
    releaseAll: () => {
      for (const v of voices) release(v, raw.currentTime);
      bendCents = 0;
    },
    ready,
    setMulti: (next) => {
      multi = next;
      void load(next);
    },
    dispose: () => {
      disposed = true;
      for (const v of voices) {
        v.source.onended = null;
        try {
          v.source.stop();
        } catch {
          // Already stopped
        }
        v.source.disconnect();
        v.env.disconnect();
      }
      voices.clear();
      out.dispose();
    },
  };
}
