/**
 * A polyphonic synth made from a pool of monophonic Tone voices (createVoicePool), used instead of
 * Tone.PolySynth: voices are added as needed instead of notes being dropped, and silent ones are
 * freed.
 */
import * as Tone from 'tone';
import { notLate } from './monotonic';
import { createBendFeed } from '../bendFeed';
import { chooseNoteToSteal } from '../samplers/noteStealing';
import { letGoToneSynth, type ToneVoice } from './toneStop';
import { attackAhead, type NoteSynth } from './toneStart';
import { ifUndone, inStrike, strikeWhole } from '../soundLead';
import { RENDER_BLOCK } from './native';

/** Seconds a pool voice may sit silent before it's disposed. */
const IDLE_SECONDS = 3;

/** The parts of a monophonic Tone synth (Synth, FMSynth...) the pool drives. */
export interface PoolVoice {
  triggerAttackRelease: (note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerAttack: (note: Tone.Unit.Frequency, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerRelease: (time?: Tone.Unit.Time) => unknown;
  envelope: ToneVoice['envelope'];
  modulationEnvelope?: ToneVoice['envelope'];
  frequency?: Tone.Signal<'frequency'>;
  /** Its level (dB): a voice gliding between chords follows a softer chord with it (see VoicePool.glide) */
  volume?: Tone.Param<'decibels'>;
  /** Its pitch offset in cents (a pitch bend moves it: the pool's bend is connected to it). */
  detune: Tone.Signal<'cents'>;
  connect: (destination: Tone.InputNode) => unknown;
  toSeconds: (time?: Tone.Unit.Time) => number;
  dispose: () => unknown;
}

/** A note held in the pool whose pitch and level then move on their own: a voice gliding between chords (see VoicePool.glide). */
export interface GlidingVoice {
  /** Its pitch `cents` from its note's from `time` (a step of its glide: the steps come every few ms while it moves) */
  bend: (cents: number, time: number) => void;
  /** Its level (0 to 1, of its velocity) from `time` */
  pressure: (value: number, time: number) => void;
  /** Let it go at `time`, with the voice's own release */
  off: (time: number) => void;
  /** Let it go at `time` from where it is then, sooner than its `off` (playback moved or stopped) */
  cut: (time: number) => void;
}

/** A note held in the pool (a key held on a MIDI keyboard) until `release`. */
export interface HeldVoice {
  /** Let the note go at `time`, with the voice's own release. */
  release: (time: number) => void;
}

export interface VoicePool {
  /** Play `notes` together at `time` (defaults to now). */
  trigger: (notes: string[], duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity?: number) => void;
  /** Start one note at `time` and hold it until the returned handle releases it. */
  attack: (note: string, time: number, velocity: number) => HeldVoice;
  /**
   * Start one note at `time` on a voice of its own whose pitch then glides on its own (on its
   * frequency: the pool's bend, on every voice's detune, adds to it) and whose level follows a
   * softer chord (see chordGlide.ts). null when no voice can be had.
   */
  glide: (note: string, time: number, velocity: number) => GlidingVoice | null;
  /** Bend every sounding voice (and the ones to come) by `cents` from `time` (`cut`: see TrackInstrument.bend). */
  bend: (cents: number, time: number, live?: boolean, cut?: boolean) => void;
  releaseAll: () => void;
  dispose: () => void;
}

/** What the pool knows of each voice's last note (see createVoicePool). */
export interface PoolSlot {
  start: number;
  end: number;
  velocity: number;
  releasedAt: number;
}

/**
 * Which voice plays a note at `time`: one whose last note ended at least `rest` before (the most
 * recently freed, so spare ones go idle long enough to be disposed); else 'new', while there are
 * fewer than `maxVoices`; else one that has just ended (it plays, only without the early start);
 * else the busy one quietest now (see noteStealing.ts). undefined only if one chord has more
 * notes than there are voices.
 */
export function choosePoolVoice<S extends PoolSlot>(voices: S[], time: number, rest: number, maxVoices: number): S | 'new' | undefined {
  let free: S | undefined;
  let ended: S | undefined;
  const busy: S[] = [];
  for (const v of voices) {
    if (v.end + rest <= time) {
      if (!free || v.end > free.end) free = v;
    } else if (v.end <= time) {
      // (the one longest ended: the nearest to free)
      if (!ended || v.end < ended.end) ended = v;
    } else if (v.start < time) {
      // (a voice already starting at `time` can't be retriggered at the same instant)
      busy.push(v);
    }
  }
  if (free) return free;
  if (voices.length < maxVoices) return 'new';
  if (ended) return ended;
  // About how loud each is now: its velocity, falling through its release (40 dB over it)
  const level = (v: S) => (time > v.releasedAt ? v.velocity * Math.exp((-(time - v.releasedAt) * Math.log(100)) / Math.max(1e-3, v.end - v.releasedAt)) : v.velocity);
  return busy[chooseNoteToSteal(busy.map((v) => ({ start: v.start, level: level(v), held: !(time >= v.releasedAt) })), time)];
}

/**
 * A polyphonic synth built from a pool of monophonic voices, used instead of Tone.PolySynth.
 *
 * PolySynth drops any note that arrives while maxPolyphony voices are still sounding ("Max
 * polyphony exceeded. Note dropped."), and only frees a voice when a timer fires after its
 * release, which runs late whenever the page is busy. Dense chords and long releases lost
 * notes, live and in the WAV export. Here each voice records when its note stops ringing
 * (known as soon as it's scheduled: start + length + release), so a free voice is found from
 * note times alone, the same live and offline. When every voice is busy, the one quietest now
 * is retriggered (see noteStealing.ts: a note already let go before a held one, and never one
 * just started if there's another): a fading tail is cut short instead of the new note lost.
 *
 * Voices are created as needed, up to `maxVoices`, by `makeVoice` in the context it's given
 * (the pool's, which isn't the global one while a WAV export renders), and disposed again
 * after IDLE_SECONDS of silence (live): a silent voice still costs CPU, because Chrome keeps
 * running every Tone signal (ConstantSourceNode) whether or not anything is connected or playing.
 *
 * A held note (attack) has no end until it's released, so its voice is never free; when every
 * voice is held, the softest played is taken for the new note (the one held longest of equals). Each trigger bumps the voice's
 * serial, so a release that arrives after its voice was taken for another note does nothing.
 */
export function createVoicePool(makeVoice: (context: Tone.BaseContext) => PoolVoice, maxVoices: number, output: Tone.InputNode): VoicePool {
  const out = new Tone.Gain(1).connect(output);
  /**
   * Every voice's pitch signal feeds this muted gain, so the browser keeps working it out between
   * notes. Between notes nothing else listens to it (its oscillator is stopped) and Chrome leaves
   * it as it was, so a voice taken again could start its note with one sample at the last note's
   * pitch, even with the pitch set a block early (toneStart.ts attackAhead): in the export, where
   * the render waits each second for notes to be handed out, 3 Brass notes in 40 did, and differed
   * from the others and from what was heard. Gain 0 sends out nothing at all (no sound, no
   * offset); the cost is one constant worked out per voice, about a hundredth of a percent of
   * the CPU each. (A mono synth played the same way never did, so they have none.)
   */
  const pull = new Tone.Gain({ context: out.context, gain: 0 }).connect(out);
  /**
   * Each voice, its note's start and end, its velocity, and when its note was let go (Infinity
   * while held); `own`: it last glided between chords (its pitch and level set on their own, see
   * glide), so they're put back before its next note
   */
  let voices: { voice: PoolVoice; start: number; end: number; serial: number; velocity: number; releasedAt: number; own?: { db: number } }[] = [];
  type Slot = (typeof voices)[number];
  /**
   * The pitch bend in cents, one signal connected to every voice's detune, made with the first
   * bend off centre (until then a voice's pitch is untouched): the pool bends as a whole, so a
   * voice taken plays at the bend then and follows it. Given the bends as they come due (see
   * bendFeed.ts). Once each voice followed the bends on its own detune: every bend went to every
   * sounding voice, so overlapping long notes under a fast-moving bend (each step of a slide is
   * one) froze the page for seconds.
   */
  let bend: { signal: Tone.Signal<'cents'>; feed: ReturnType<typeof createBendFeed> } | undefined;
  const bendOf = () => {
    if (!bend) {
      const signal = new Tone.Signal({ context: out.context, value: 0, units: 'cents' });
      bend = { signal, feed: createBendFeed(out.context, signal) };
      for (const v of voices) signal.connect(v.voice.detune);
    }
    return bend;
  };

  /**
   * How long a voice rests after its note before it's taken for the next: two render blocks, so its
   * note can start early silent (toneStart.ts attackAhead). Taken sooner, the new note starts from
   * where in the block it lands, so it sounded different live and in the export.
   */
  const rest = (2 * RENDER_BLOCK) / out.context.sampleRate;

  /**
   * A voice that last glided between chords, taken for a note at `time`: what it had set on its own
   * from then on (its glide's later steps, should it be taken while still sounding) taken away, its
   * level back where it was made. A voice that never glided is left exactly as it was.
   */
  const putBack = (v: Slot, time: number) => {
    const own = v.own;
    if (!own) return;
    v.own = undefined;
    v.voice.frequency?.cancelScheduledValues(time);
    if (v.voice.volume) {
      v.voice.volume.cancelScheduledValues(time);
      v.voice.volume.setValueAtTime(own.db, time);
    }
  };

  /** A voice for a note at `time`. */
  const pick = (time: number): Slot | undefined => {
    const choice = choosePoolVoice(voices, time, rest, maxVoices);
    if (choice !== 'new') {
      if (choice?.own) putBack(choice, time);
      return choice;
    }
    const v = { voice: makeVoice(out.context), start: -Infinity, end: -Infinity, serial: 0, velocity: 0, releasedAt: -Infinity };
    v.voice.connect(out);
    v.voice.frequency?.connect(pull);
    bend?.signal.connect(v.voice.detune);
    voices.push(v);
    return v;
  };

  const disposeIdleVoices = () => {
    const now = out.now();
    voices = voices.filter((v) => {
      if (v.end > now - IDLE_SECONDS) return true;
      v.voice.dispose();
      return false;
    });
  };
  // Live only: an export can schedule the whole song before rendering any of it, so there a
  // voice that's "idle" on the scheduling clock may not have been heard yet
  const gcInterval = out.context.isOffline ? -1 : out.context.setInterval(disposeIdleVoices, 1);

  return {
    trigger: (notes, duration, time, velocity = 1) => {
      const length = out.toSeconds(duration);
      // (A chord struck as one, live: see soundLead.ts strikeWhole)
      try {
        strikeWhole(out.context, notLate(out.context, time), (t) => {
        for (const note of notes) {
          const v = pick(t);
          if (!v) return;
          try {
            // (A free voice still has the last note's pitch: this one's is set before it starts)
            const was = { start: v.start, end: v.end, velocity: v.velocity, releasedAt: v.releasedAt, serial: v.serial };
            const at = attackAhead(v.voice as unknown as NoteSynth, note, t, (when) => v.voice.triggerAttackRelease(note, length, when, velocity));
            ifUndone(() => Object.assign(v, was));
            v.start = at;
            v.end = at + length + v.voice.toSeconds(v.voice.envelope.release);
            v.velocity = velocity;
            v.releasedAt = at + length;
            v.serial++;
          } catch (err) {
            if (inStrike()) throw err;
            console.warn('Skipped a note:', err);
          }
        }
        });
      } catch (err) {
        console.warn('Skipped a chord:', err);
      }
    },
    attack: (note, time, velocity) => {
      const t = notLate(out.context, time);
      const v = pick(t);
      if (!v) return { release: () => {} };
      // (Inside a strike, struck again: this voice is free again)
      const was = { start: v.start, end: v.end, velocity: v.velocity, releasedAt: v.releasedAt, serial: v.serial };
      ifUndone(() => Object.assign(v, was));
      v.start = attackAhead(v.voice as unknown as NoteSynth, note, t, (at) => v.voice.triggerAttack(note, at, velocity));
      v.end = Infinity;
      v.velocity = velocity ?? 1;
      v.releasedAt = Infinity;
      const serial = ++v.serial;
      return {
        release: (at) => {
          if (v.serial !== serial || v.end !== Infinity) return;
          const releaseAt = notLate(out.context, at);
          v.voice.triggerRelease(releaseAt);
          v.end = releaseAt + v.voice.toSeconds(v.voice.envelope.release);
          v.releasedAt = releaseAt;
        },
      };
    },
    glide: (note, time, velocity) => {
      const t = notLate(out.context, time);
      const v = pick(t);
      if (!v) return null;
      const db = v.voice.volume?.getValueAtTime(t) ?? 0;
      v.start = attackAhead(v.voice as unknown as NoteSynth, note, t, (at) => v.voice.triggerAttack(note, at, velocity));
      v.end = Infinity;
      v.velocity = velocity;
      v.releasedAt = Infinity;
      v.own = { db };
      const serial = ++v.serial;
      const hz = Tone.Frequency(note).toFrequency();
      // The last step given, its time and value: a step after a while with no change (the glide's
      // first, a held stretch's) is ramped to from one step (4 ms) before it, not from the last
      const STEP = 0.004;
      let pitch = { at: v.start, value: hz };
      let level = { at: v.start, value: 1 };
      const mine = () => v.serial === serial;
      return {
        bend: (cents, at) => {
          const f = v.voice.frequency;
          if (!mine() || !f) return;
          const when = Math.max(at, v.start);
          const value = hz * 2 ** (cents / 1200);
          if (value === pitch.value && when > pitch.at) return;
          if (when - pitch.at > 1.5 * STEP) f.setValueAtTime(pitch.value, when - STEP);
          f.linearRampToValueAtTime(value, when);
          pitch = { at: when, value };
        },
        pressure: (p, at) => {
          const vol = v.voice.volume;
          if (!mine() || !vol) return;
          const value = Math.max(1e-4, Math.min(1, p));
          if (value === level.value) return;
          const when = Math.max(at, v.start);
          // (At its start: its level set before it sounds)
          if (when <= v.start) vol.setValueAtTime(db + Tone.gainToDb(value), when);
          else {
            if (when - level.at > 1.5 * STEP) vol.setValueAtTime(db + Tone.gainToDb(level.value), when - STEP);
            vol.linearRampToValueAtTime(db + Tone.gainToDb(value), when);
          }
          level = { at: when, value };
        },
        off: (at) => {
          if (!mine() || v.end !== Infinity) return;
          const releaseAt = Math.max(notLate(out.context, at), v.start);
          v.voice.triggerRelease(releaseAt);
          v.end = releaseAt + v.voice.toSeconds(v.voice.envelope.release);
          v.releasedAt = releaseAt;
        },
        cut: (at) => {
          // (as Stop lets a voice go: from where it is then, its own release, nothing given it for later)
          const t = Math.max(at, out.context.currentTime);
          if (!mine() || !(v.releasedAt > t)) return;
          letGoToneSynth(v.voice, t);
          v.voice.volume?.cancelAndHoldAtTime(t);
          v.end = v.start >= t ? t : t + v.voice.toSeconds(v.voice.envelope.release);
          v.releasedAt = t;
        },
      };
    },
    bend: (cents, time, _live, cut) => {
      // (Centre, before any bend: where every voice is)
      if (!bend && cents === 0) return;
      // A glide over a few ms (a bend wheel moves in small steps)
      bendOf().feed.bend(cents, notLate(out.context, time), cut);
    },
    releaseAll: () => {
      // On the audio clock as it is now (out.now() adds the look-ahead: notes handed out for
      // sooner than that would still sound)
      const now = out.context.currentTime;
      for (const v of voices) {
        if (v.end <= now) continue;
        // What it's sounding falls away from where it is; a note that hasn't started never does
        letGoToneSynth(v.voice, now);
        v.end = v.start >= now ? now : Math.min(v.end, now + v.voice.toSeconds(v.voice.envelope.release));
        v.releasedAt = Math.min(v.releasedAt, now);
      }
    },
    dispose: () => {
      out.context.clearInterval(gcInterval);
      bend?.feed.dispose();
      bend?.signal.dispose();
      voices.forEach((v) => v.voice.dispose());
      pull.dispose();
      out.dispose();
    },
  };
}
