import * as Tone from 'tone';
import type { DrumRack, MultiSample, RackPad } from '../../store/timelineTypes';
import { RACK_PADS } from '../../store/timelineTypes';
import { chopSpan, padOfNote, zoneFor, noteMidi } from '../../store/sampleKits';
import { decodeSound } from '../soundLibrary';
import { alwaysStereo } from '../nativeNodes';
import { copySetFor, decodePitchedSound } from '../samplers/samplerManager';
import type { NoteOff, PlayableNote, TrackInstrument, VoiceControl } from '../instruments';
import type { TrackPlan } from '../samplers/songSamples';
import { createBendTimeline } from '../bendTimeline';
import { fadeOutFrom } from '../effects/smoothParam';

/**
 * The Drum Rack and the Multi Sampler: the user's own sounds played from buffers, each hit or note
 * a buffer source and a gain made when it starts and let go when it ends (nothing runs between
 * them). Live and in the WAV export alike; `ready` waits for every sound to be decoded. A pad
 * tuned away from its sound's pitch, or a key away from its sound's root, plays a copy made at
 * that pitch (pitchedCopies.ts), at a rate of exactly 1, rather than the sound stretched by the
 * browser as it plays (a bend moves the rate from there).
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

/**
 * A pad's own effects, in order: drive, high-pass, low-pass, pan, level. Made on its first hit.
 * The drive and the filters are in the chain only while they do something (`route`): a pad at its
 * neutral settings plays its sound as it is (a bounce from the song sounds as the song did, not
 * with a filter's phase shift and top-end lift on it).
 */
interface PadChain {
  input: GainNode;
  shaper: WaveShaperNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  pan: StereoPannerNode;
  level: GainNode;
  drive: number;
  /** Which of drive, high-pass and low-pass are patched in, as a key ("d-l") */
  route: string;
}

/** The stages a pad's settings need: drive, high-pass, low-pass. */
const stagesOf = (pad: RackPad) => ({ drive: pad.drive > 0.001, highpass: pad.highpass > 20.5, lowpass: pad.lowpass < 19999 });
const routeKey = (st: ReturnType<typeof stagesOf>) => `${st.drive ? 'd' : ''}-${st.highpass ? 'h' : ''}-${st.lowpass ? 'l' : ''}`;

/** Connect a chain's input to its pan through the stages `pad` needs (and only those). */
function routeChain(chain: PadChain, pad: RackPad): void {
  const st = stagesOf(pad);
  const key = routeKey(st);
  if (chain.route === key) return;
  for (const node of [chain.input, chain.shaper, chain.highpass, chain.lowpass]) node.disconnect();
  const stages: AudioNode[] = [chain.input, ...(st.drive ? [chain.shaper] : []), ...(st.highpass ? [chain.highpass] : []), ...(st.lowpass ? [chain.lowpass] : []), chain.pan];
  for (let k = 0; k + 1 < stages.length; k++) stages[k].connect(stages[k + 1]);
  chain.route = key;
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
  const copies = copySetFor(raw);
  /** A pad's copy at its tuning (made in the background live, as soon as its sound or tuning is known) */
  const wishOf = (pad: RackPad) => ({ ratio: Math.pow(2, pad.pitch / 12), playRate: raw.sampleRate });
  const warm = (i: number) => {
    const pad = rack?.pads[i];
    const buffer = buffers.get(i);
    return pad && buffer && pad.pitch ? copies.warm(buffer, wishOf(pad)) : Promise.resolve();
  };

  const applyChain = (chain: PadChain, pad: RackPad) => {
    const now = raw.currentTime;
    chain.level.gain.setTargetAtTime(dbGain(pad.gain), now, 0.01);
    chain.pan.pan.setTargetAtTime(pad.pan, now, 0.01);
    chain.lowpass.frequency.setTargetAtTime(pad.lowpass, now, 0.01);
    chain.highpass.frequency.setTargetAtTime(pad.highpass, now, 0.01);
    if (chain.drive !== pad.drive) {
      chain.drive = pad.drive;
      if (pad.drive > 0.001) chain.shaper.curve = driveCurve(pad.drive);
    }
    // Stages patched in or out as they start or stop doing something
    routeChain(chain, pad);
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
    pan.connect(level);
    level.connect(into);
    // Its first settings at once (a hit follows straight away)
    level.gain.value = dbGain(pad.gain);
    pan.pan.value = pad.pan;
    lowpass.frequency.value = pad.lowpass;
    highpass.frequency.value = pad.highpass;
    if (pad.drive > 0.001) shaper.curve = driveCurve(pad.drive);
    chain = { input, shaper, highpass, lowpass, pan, level, drive: pad.drive, route: '' };
    // The drive's shaper is in the chain only while it drives (a shaper with no curve was silent live)
    routeChain(chain, pad);
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
          // (live: its copy at its tuning, ahead of its first hit)
          if (!(raw instanceof OfflineAudioContext)) void warm(i);
        })
      );
    }
    return Promise.all(jobs);
  };
  const ready = load(rack);

  /**
   * Fade out and stop a hit at `time` (a choke, or all notes off), from the level it has reached
   * then: a pad in its fade-in or fade-out is cut from where that fade is, never jumping back to
   * full level first nor staying silent (see fadeOutFrom).
   */
  const cut = (hit: Hit, time: number) => {
    if (hit.stopAt <= time) return;
    const at = Math.max(time, raw.currentTime);
    fadeOutFrom(hit.env.gain, at, 0.002);
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
    const ratio = Math.pow(2, pad.pitch / 12);
    // Tuned: its copy at that pitch, read at a rate of 1, where it's made
    const copy = pad.pitch ? copies.find(buffer, wishOf(pad)) : undefined;
    const playing = copy?.buffer ?? buffer;
    const k = copy?.ratio ?? 1;
    source.buffer = playing;
    source.playbackRate.value = copy ? 1 : ratio;
    const env = raw.createGain();
    const level = Math.max(0, Math.min(1, velocity)) ** 1.2;
    // A chop plays its stretch of the sound (mirrored when reversed: the buffer is the reversed copy),
    // from a whole frame (a source read between two frames is interpolated, which blurs its top)
    const chop = chopSpan(pad, buffer.duration);
    const offset = Math.round((chop.offset / k) * playing.sampleRate) / playing.sampleRate;
    const length = chop.seconds / ratio;
    if (!(length > 0)) return;
    const fade = Math.min(pad.fade ?? 0, length / 2);
    if (fade > 0) {
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(level, at + fade);
    } else env.gain.setValueAtTime(level, at);
    let stopAt = at + length;
    if (pad.decay > 0 && pad.decay < length) {
      // Holds a moment, then dies away to about -60 dB by `decay`
      env.gain.setValueAtTime(level, Math.max(at + fade, at + pad.decay * 0.25));
      env.gain.setTargetAtTime(0, Math.max(at + fade, at + pad.decay * 0.25), (pad.decay * 0.75) / 6.9);
      stopAt = at + pad.decay + 0.02;
    } else if (fade > 0) {
      // Out at the chop's end as it came in, so a cut mid-note doesn't click
      env.gain.setValueAtTime(level, stopAt - fade);
      env.gain.linearRampToValueAtTime(0, stopAt);
    }
    source.connect(env);
    env.connect(chain.input);
    source.start(at, offset, chop.seconds / k);
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
    // (every tuned pad's copy: a render's notes don't change what a pad plays)
    prepare: () => ready.then(() => Promise.all(Array.from({ length: RACK_PADS }, (_, i) => warm(i)))),
    setRack: (next) => {
      const before = rack;
      rack = next;
      void load(next);
      // A pad tuned anew: its copy at the new pitch, ahead of its next hit
      next?.pads.forEach((pad, i) => {
        if (pad.pitch !== before?.pads[i]?.pitch) void warm(i);
      });
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
      copies.dispose();
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
  /** How many times as fast as its sound the buffer it plays is (its copy at `semis`: see pitchedCopies.ts), 1 for the sound itself */
  k: number;
  /** When it's been told to stop (Infinity: not yet; it ends by itself at its sound's end, whatever bends do to its speed) */
  stopAt: number;
  released: boolean;
  /** Its own bend (an expressive or MPE note's, see noteVoice) by time, [time, cents] in time order: it adds to the instrument's */
  own: [number, number][];
  /** Till when it follows the instrument's bends (its end and release, Infinity when not known) */
  until: number;
}

/** A voice's own bend at `time` (cents): the latest of its own points at or before it, else 0 */
const ownAt = (v: Pick<Voice, 'own'>, time: number): number => {
  let lo = 0;
  let hi = v.own.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v.own[mid][0] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? v.own[lo - 1][1] : 0;
};

export function createMultiInstrument(output: Tone.InputNode, initial: MultiSample | undefined): TrackInstrument & { setMulti: (multi: MultiSample | undefined) => void } {
  const out = new Tone.Gain(1).connect(output);
  // Two channels from here on, whatever mix of one- and two-channel sounds it plays (see alwaysStereo)
  alwaysStereo(out);
  const raw = out.context.rawContext as unknown as Raw;
  const into = out.input as unknown as AudioNode;
  let multi = initial;
  const buffers = new Map<string, AudioBuffer>();
  const voices = new Set<Voice>();
  /** The pitch bend (cents) by time: a note starts at the one in force then and follows the ones sent for later (see bendTimeline.ts) */
  const bends = createBendTimeline(() => raw.currentTime);
  let disposed = false;
  const copies = copySetFor(raw);
  /** Whether its copies keep its sounds' rate (twice the context's): a render's track whose notes bend (see prepare) */
  let wide = false;
  /** A copy of a sound `semis` from its root: at the context's rate for notes that hold their pitch, else at the sound's (see wishOf in samplerManager.ts) */
  const wishFor = (semis: number) => ({ ratio: Math.pow(2, semis / 12), playRate: raw.sampleRate, ...(wide ? {} : { outRate: raw.sampleRate }) });

  const load = (next: MultiSample | undefined): Promise<unknown> =>
    Promise.all(
      [...new Set((next?.zones ?? []).map((z) => z.soundId))]
        .filter((id) => !buffers.has(id))
        .map((id) =>
          // (at twice the rate: its zones play at other pitches)
          decodePitchedSound(id, out.context).then((b) => {
            if (!disposed) buffers.set(id, b);
          })
        )
    );
  const ready = load(multi);

  const rateOf = (semis: number, cents: number) => Math.pow(2, (semis + cents / 100) / 12);
  /** The rate a voice plays its buffer at for `semis` under a bend of `cents`: over its copy's own ratio, exactly 1 for the copy's pitch */
  const rateFor = (v: Pick<Voice, 'k'>, semis: number, cents: number) => {
    const r = rateOf(semis, cents) / v.k;
    return Math.abs(r - 1) < 1e-12 ? 1 : r;
  };

  const releaseSeconds = () => Math.max(0.005, multi?.release ?? 0.3);
  /** Let a voice go: its release from `time`. */
  const release = (v: Voice, time: number) => {
    if (v.released) return;
    v.released = true;
    const at = Math.max(time, raw.currentTime);
    const r = releaseSeconds();
    // Hold the level the attack has reached (cancelScheduledValues would drop an unfinished
    // attack ramp and fall back to 0, silencing a note shorter than its attack)
    const g = v.env.gain as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(at);
    else g.cancelScheduledValues(at);
    v.env.gain.setTargetAtTime(0, at, r / 5);
    const end = Math.min(v.stopAt, at + r + 0.05);
    v.source.stop(end);
    v.stopAt = end;
  };

  /** Start a note at `time`; returns its voice (or null when nothing plays it). */
  const start = (note: string, velocity: number, time: number, until = Infinity): Voice | null => {
    const midi = midiOf(note);
    if (!multi || !Number.isFinite(midi)) return null;
    const zone = zoneFor(multi.zones, midi, velocity);
    const buffer = zone && buffers.get(zone.soundId);
    if (!zone || !buffer) return null;
    const at = Math.max(time, raw.currentTime);
    const semis = midi - zone.root;
    const source = raw.createBufferSource();
    // Away from its root: its copy at that pitch where it's made (a bend moves the rate from there;
    // under a bend already, a copy at the context's rate would be read between its frames: the sound)
    const cents = bends.at(at);
    const copy = semis && (wide || cents === 0) ? copies.find(buffer, wishFor(semis)) : undefined;
    source.buffer = copy?.buffer ?? buffer;
    const k = copy?.ratio ?? 1;
    // (its rate from the first block it sounds in: the rate is read once a block, and set only at
    // `at` the block it starts in played at 1, up to 128 frames at the wrong speed)
    source.playbackRate.value = rateFor({ k }, semis, cents);
    source.playbackRate.setValueAtTime(rateFor({ k }, semis, cents), at);
    // (While it sounds: a long note's vibrato, sent whole when it starts, is thousands of points)
    for (const [t, c] of bends.after(at, until)) source.playbackRate.setTargetAtTime(rateFor({ k }, semis, c), t, 0.005);
    const env = raw.createGain();
    const level = Math.max(0, Math.min(1, velocity));
    const attack = Math.max(0.001, multi.attack);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + attack);
    source.connect(env);
    env.connect(into);
    source.start(at);
    // No stop at the sound's end worked out from the rate now: a bend down afterwards slows it,
    // and the note was cut before its end. Not looping, it ends by itself when the sound does.
    const v: Voice = { source, env, semis, k, stopAt: Infinity, released: false, own: [], until };
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
        // (In the render's own context: an export's tempo, not the live one)
        const end = time + out.toSeconds(n.duration);
        const v = start(n.note, n.velocity, time, Math.max(end, raw.currentTime) + releaseSeconds() + 0.05);
        if (v) release(v, end);
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
          const at = Math.max(t, raw.currentTime);
          // Its own bend adds to the instrument's (a clip's bend lane, the master wheel), as an MPE
          // note's per-note bend does to its master channel's: the instrument's bends already set
          // for after this were worked out on its bend before, so they're set again on this one
          // (only those already sent: a few, the look-ahead's; later ones read it, see `bend`)
          const later = bends.after(at, Math.min(v.until, v.stopAt));
          if (later.length) v.source.playbackRate.cancelScheduledValues(at + 1e-7);
          v.own.push([at, cents]);
          v.source.playbackRate.linearRampToValueAtTime(rateFor(v, v.semis + cents / 100, bends.at(at)), at);
          for (const [lt, lc] of later) if (lt > at + 1e-7) v.source.playbackRate.setTargetAtTime(rateFor(v, v.semis + cents / 100, lc), lt, 0.005);
        },
        pressure: (p, t) => {
          if (v.released) return;
          v.env.gain.linearRampToValueAtTime(level * Math.max(0, Math.min(1, p)), Math.max(t, settled));
        },
        off: (t) => release(v, t),
      };
    },
    bend: (cents: number, time: number, _live?: boolean, cut?: boolean) => {
      const at = Math.max(time, raw.currentTime);
      if (cut) for (const v of voices) v.source.playbackRate.cancelScheduledValues(at);
      bends.set(cents, at, cut);
      for (const v of voices) {
        if (v.stopAt <= at) continue;
        // (on top of the voice's own bend there: see noteVoice)
        v.source.playbackRate.setTargetAtTime(rateFor(v, v.semis + ownAt(v, at) / 100, cents), at, 0.005);
        // (a cut dropped its own bends still to come too: set again)
        if (cut) for (const [t, c] of v.own) if (t > at) v.source.playbackRate.linearRampToValueAtTime(rateFor(v, v.semis + c / 100, bends.at(t)), t);
      }
    },
    releaseAll: () => {
      // Every voice still to end goes now, those already given their end too (a note played from
      // the song has its release set when it starts: Stop mustn't leave it sounding to its end)
      const now = raw.currentTime;
      for (const v of voices) {
        if (v.stopAt <= now) continue;
        v.released = false;
        release(v, now);
      }
      bends.set(0, now, true);
    },
    ready,
    prepare: (plan: TrackPlan) =>
      ready.then(() => {
        if (plan.bends) wide = true;
        const jobs: Promise<void>[] = [];
        for (const n of plan.notes) {
          const midi = midiOf(n.note);
          if (!multi || !Number.isFinite(midi)) continue;
          // (its velocity can drift either way: the zones it can reach)
          for (const vel of new Set([n.velocity, n.velocity * (1 - n.drift), Math.min(1, n.velocity * (1 + n.drift))])) {
            const zone = zoneFor(multi.zones, midi, vel);
            const buffer = zone && buffers.get(zone.soundId);
            if (zone && buffer && midi !== zone.root) jobs.push(copies.prepare(buffer, wishFor(midi - zone.root)));
          }
        }
        return Promise.all(jobs);
      }),
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
      copies.dispose();
      out.dispose();
    },
  };
}
