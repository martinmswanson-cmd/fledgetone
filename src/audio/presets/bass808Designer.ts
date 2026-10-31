import * as Tone from 'tone';
import type { PlayableNote } from '../instruments';
import { notLate } from './monotonic';
import { createBus, createFilter, createOsc, createVoiceSet, noteFrequency } from './native';
import type { NativeVoice } from './native';
import { HELD_NOTE } from './edmSynths';
import { driveCurveFor, driveMakeup, type DriveCharacter } from '../driveCurves';
import type { Bass808Settings } from '../../store/bass808';
import { defaultBass808, tuneNote } from '../../store/bass808';
import { createBendTimeline } from '../bendTimeline';

/**
 * The designed 808 (an 808 Bass track with Track.bass808 set; see bass808.ts): a sine with a
 * pitch-drop punch, a decay, slides between overlapping notes, distortion with a tone control after
 * it, and a top layer of harmonics for small speakers. Plain Web Audio nodes per note (see
 * native.ts), so nothing runs between notes. A new setting plays from the next note.
 *
 * Per note: sine -> envelope -> distortion (4x oversampled) -> tone low-pass -> level, and, for the
 * top layer, the same envelope -> a hard saturation -> 200 Hz high-pass -> low-pass -> level. Both
 * are mono: the 808 stays centred however it's mixed. The envelope sits before the distortion, so
 * a hit is at its dirtiest at the start and cleans up as it dies away, as a driven 808 does.
 *
 * A 4x oversampled shaper delays what passes through it by SHAPER_FRAMES; both paths go through
 * one, so they stay in line, and the whole note starts that much earlier instead (when it isn't
 * too close to now), so it lands on the beat.
 */

/** Samples a WaveShaperNode oversampling 4x delays its sound by (measured in Chrome; Firefox's is similar). */
export const SHAPER_FRAMES = 192;
/** Seconds the start of each hit takes to rise: quick enough to hit, slow enough not to click. */
const ATTACK = 0.002;
/** Seconds the end of a note takes to fall 40 dB. */
const RELEASE = 0.05;
/** Envelope peak at full velocity: under 1, so the clean path's shaper never clips it. */
const PEAK = 0.9;
/** The level the 808 plays at, matched by ear and meter to the original 808 at "Clean deep". */
const OUT = 0.72;
/** The top layer's level at full: about as loud as the sub on a phone speaker. */
const TOP = 0.32;

/** A note dies away by 60 dB in `seconds`: the time constant of that fall. */
const decayConstant = (seconds: number) => seconds / Math.log(1000);
const releaseConstant = RELEASE / Math.log(100);
/** A flat (Butterworth) low- or high-pass: their BiquadFilterNode reads Q in dB, so 1/sqrt(2) is -3.01 dB. */
const FLAT_Q = 20 * Math.log10(Math.SQRT1_2);

interface Voice808 extends NativeVoice {
  /** The envelope before the distortion (the voice set's `amp` is the level after it) */
  env: GainNode;
  osc: OscillatorNode;
  /** When the note (or the last note slid into) ends */
  end: number;
  /** Seconds its sound runs early to make up for the shaper's delay */
  lead: number;
  settings: Bass808Settings;
}

const curves = new Map<string, Float32Array<ArrayBuffer>>();
/** A shared curve (the shaper copies it), the most recent few kept. */
function curveOf(character: DriveCharacter | 'linear', drive: number, post: number): Float32Array<ArrayBuffer> {
  const key = `${character}|${drive}|${post}`;
  let curve = curves.get(key);
  if (!curve) {
    curve = character === 'linear' ? new Float32Array([-post, post]) : driveCurveFor(character, drive, post);
    if (curves.size >= 24) curves.delete(curves.keys().next().value!);
    curves.set(key, curve);
  }
  return curve;
}

function shaper(raw: BaseAudioContext, curve: Float32Array<ArrayBuffer>): WaveShaperNode {
  const node = raw.createWaveShaper();
  node.curve = curve;
  node.oversample = '4x';
  return node;
}

export function createBass808Designer(output: Tone.InputNode, initial: Bass808Settings | undefined) {
  const { bus, raw, input } = createBus(output);
  const voices = createVoiceSet(raw);
  let settings = initial ?? defaultBass808();
  let current: Voice808 | null = null;
  /** The pitch bend (cents) by time: a note starts at the one in force then and follows the ones sent for later (see bendTimeline.ts) */
  const bends = createBendTimeline(() => raw.currentTime);

  /**
   * The bends sent for later on `v`, from `from` (its own time, ahead by its lead) while it sounds:
   * a long note's vibrato, sent whole when it starts, is thousands of points.
   */
  const follow = (v: Voice808, from: number) => {
    for (const [t, cents] of bends.after(from + v.lead, v.stopAt + v.lead)) v.osc.detune.setTargetAtTime(cents, Math.max(raw.currentTime, t - v.lead), 0.006);
  };

  const playNote = (n: PlayableNote, time: number): Voice808 | undefined => {
    const s = settings;
    const note = tuneNote(n.note, s);
    const freq = noteFrequency(note);
    const length = bus.toSeconds(n.duration);
    if (!Number.isFinite(length) || !(freq > 0)) return;
    const start = notLate(bus.context, time);
    const end = start + Math.max(0.01, length);

    // A note starting before the sounding one ends doesn't hit again: the sounding one slides to
    // its pitch and carries on, dying away as it was, to this note's end (the "808 slide")
    const v = current;
    if (v && v.end > start + 0.001 && v.stopAt > start) {
      const at = Math.max(raw.currentTime, start - v.lead);
      const until = end - v.lead;
      const f = v.osc.frequency;
      f.cancelAndHoldAtTime(at);
      f.exponentialRampToValueAtTime(freq, at + v.settings.glide);
      const g = v.env.gain;
      g.cancelAndHoldAtTime(at);
      g.setTargetAtTime(0, at, decayConstant(v.settings.decay));
      g.setTargetAtTime(0, until, releaseConstant);
      // Its old stop (and the silence there) moves to the new end
      v.amp.gain.cancelScheduledValues(at);
      const followed = v.stopAt;
      voices.extend(v, Math.min(until + RELEASE * 1.5, Math.max(at, v.start) + v.settings.decay * 1.05 + 0.01));
      v.end = end;
      // (It rings on longer: the bends sent for then too)
      follow(v, followed - 1e-9);
      return v;
    }

    const shaped = s.drive > 0 || s.top > 0;
    const wanted = shaped ? SHAPER_FRAMES / raw.sampleRate : 0;
    const lead = start - wanted >= raw.currentTime ? wanted : 0;
    const from = start - lead;
    const until = end - lead;
    // The previous note (ringing on after its end) gives way quickly: one 808 at a time
    if (current && current.stopAt > from) voices.release(current, from, 0.015);

    const osc = createOsc(raw, 'sine', s.punch > 0 ? freq * 2 ** (s.punch / 12) : freq, from, bends.at(start));
    if (s.punch > 0) osc.frequency.exponentialRampToValueAtTime(freq, from + s.punchTime);
    const env = raw.createGain();
    const peak = PEAK * (0.35 + 0.65 * n.velocity);
    env.gain.setValueAtTime(0, from);
    env.gain.linearRampToValueAtTime(peak, from + ATTACK);
    env.gain.setTargetAtTime(0, from + ATTACK, decayConstant(s.decay));
    env.gain.setTargetAtTime(0, until, releaseConstant);
    osc.connect(env);
    const amp = raw.createGain();
    amp.gain.value = Tone.dbToGain(s.level) * OUT;
    const nodes: AudioNode[] = [osc, env, amp];

    if (!shaped) {
      env.connect(amp);
    } else {
      // The clean path: the drive's curve (or a straight line, to keep in step with the top layer)
      const drive = shaper(raw, s.drive > 0 ? curveOf(s.character, s.drive, driveMakeup(s.character, s.drive)) : curveOf('linear', 0, 1));
      env.connect(drive);
      nodes.push(drive);
      let tail: AudioNode = drive;
      if (s.drive > 0 && s.tone < 16000) {
        const tone = createFilter(raw, 'lowpass', s.tone, FLAT_Q);
        drive.connect(tone);
        nodes.push(tone);
        tail = tone;
      }
      tail.connect(amp);
      if (s.top > 0) {
        // The top layer: harmonics only (the fundamental and the sub filtered out), darkened with the tone
        const grit = shaper(raw, curveOf('tube', 1, s.top * TOP));
        const low = createFilter(raw, 'highpass', 200, FLAT_Q);
        const high = createFilter(raw, 'lowpass', Math.min(4000, Math.max(900, s.tone)), FLAT_Q);
        env.connect(grit);
        grit.connect(low).connect(high).connect(amp);
        nodes.push(grit, low, high);
      }
    }
    amp.connect(input);
    // Silent (60 dB down) once it has died away or been let go, whichever is first
    const stopAt = Math.min(until + RELEASE * 1.5, from + ATTACK + s.decay * 1.05 + 0.01);
    const voice: Voice808 = { start: from, stopAt, sources: [osc], nodes, amp, env, osc, end, lead, settings: s };
    follow(voice, from);
    voices.add(voice);
    current = voice;
    return voice;
  };

  return {
    play: (notes: PlayableNote[], time: number) => {
      // One note at a time: the loudest of a chord
      const n = notes.reduce((a, b) => (b.velocity > a.velocity ? b : a));
      try {
        playNote(n, time);
      } catch (err) {
        console.warn('Skipped a note:', err);
      }
    },
    /** A key held on a MIDI keyboard: it sounds until let go (or has died away). */
    hold: (note: PlayableNote, time: number) => {
      const voice = playNote({ ...note, duration: HELD_NOTE }, time);
      return (at: number) => {
        if (!voice || current !== voice) return;
        const t = Math.max(raw.currentTime, notLate(bus.context, at) - voice.lead);
        voices.release(voice, t, RELEASE);
        voice.end = t;
      };
    },
    bend: (cents: number, time: number, _live?: boolean, cut?: boolean) => {
      const t = notLate(bus.context, time);
      if (cut) current?.osc.detune.cancelScheduledValues(Math.max(raw.currentTime, t - current.lead));
      else if (Math.abs(cents - bends.at(t)) < 0.01) return;
      bends.set(cents, t, cut);
      if (current && current.stopAt > t) current.osc.detune.setTargetAtTime(cents, Math.max(raw.currentTime, t - current.lead), 0.006);
    },
    setSettings: (next: Bass808Settings | undefined) => {
      settings = next ?? defaultBass808();
    },
    releaseAll: () => {
      voices.releaseAll(raw.currentTime, 0.03);
      current = null;
    },
    dispose: () => {
      voices.stopAll();
      current = null;
      bus.dispose();
    },
  };
}
