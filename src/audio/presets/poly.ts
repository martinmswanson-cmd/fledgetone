/**
 * A polyphonic synth made from a pool of monophonic Tone voices (createVoicePool), used instead of
 * Tone.PolySynth: voices are added as needed instead of notes being dropped, and silent ones are
 * freed.
 */
import * as Tone from 'tone';
import { notLate } from './monotonic';
import { createBendTimeline } from '../bendTimeline';
import { chooseNoteToSteal } from '../samplers/noteStealing';
import { letGoToneSynth, type ToneVoice } from './toneStop';

/** Seconds a pool voice may sit silent before it's disposed. */
const IDLE_SECONDS = 3;

/** The parts of a monophonic Tone synth (Synth, FMSynth...) the pool drives. */
export interface PoolVoice {
  triggerAttackRelease: (note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerAttack: (note: Tone.Unit.Frequency, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerRelease: (time?: Tone.Unit.Time) => unknown;
  envelope: ToneVoice['envelope'];
  modulationEnvelope?: ToneVoice['envelope'];
  frequency?: ToneVoice['frequency'];
  /** Its pitch offset in cents (a MIDI pitch bend moves it). */
  detune: { setTargetAtTime: (value: number, time: Tone.Unit.Time, constant: number) => unknown; cancelScheduledValues: (time: Tone.Unit.Time) => unknown };
  connect: (destination: Tone.InputNode) => unknown;
  toSeconds: (time?: Tone.Unit.Time) => number;
  dispose: () => unknown;
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
  /** Bend every sounding voice (and the ones to come) by `cents` from `time` (`cut`: see TrackInstrument.bend). */
  bend: (cents: number, time: number, live?: boolean, cut?: boolean) => void;
  releaseAll: () => void;
  dispose: () => void;
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
  /** Each voice, its note's start and end, its velocity, and when its note was let go (Infinity while held) */
  let voices: { voice: PoolVoice; start: number; end: number; serial: number; velocity: number; releasedAt: number; fedTo: number }[] = [];
  /**
   * The pitch bend in cents, by time: a voice taken starts at the bend then, and follows the ones
   * sent for later while its note sounds (to its end and release: a long note's vibrato, sent
   * whole when it starts, is thousands of points, and every short note under it would otherwise
   * be given every one of them).
   */
  const bends = createBendTimeline(() => out.context.currentTime);
  type Slot = (typeof voices)[number];
  /**
   * Live, a voice is given the bends at most FEED_AHEAD seconds ahead, and the rest as the clock
   * gets to them (every FEED_EVERY): each bend given to a Tone voice is checked against every one
   * it already has (standardized-audio-context keeps them in a list), so a long note's thousands
   * at once froze the page for seconds. A stall shorter than FEED_AHEAD - FEED_EVERY isn't heard.
   * An export gives them all at once (its clock doesn't run while the song is set up).
   */
  const FEED_AHEAD = 2;
  const FEED_EVERY = 0.25;
  const offline = out.context.isOffline;
  /** Give `v` the bends sent for after the ones it has, while it sounds and up to FEED_AHEAD from now. */
  const feed = (v: Slot) => {
    const to = Math.min(v.end, offline ? Infinity : out.context.currentTime + FEED_AHEAD);
    if (!(to > v.fedTo)) return;
    for (const [t, cents] of bends.after(v.fedTo, to === Infinity ? undefined : to + 1e-9)) v.voice.detune.setTargetAtTime(cents, t, 0.005);
    v.fedTo = to;
  };
  /** A note started on `v` at `time`: the bends sent for after then (see feed). */
  const follow = (v: Slot, time: number) => {
    v.fedTo = time;
    feed(v);
  };
  /**
   * A voice taken at `time` starts from the bend then (bend() only moves the sounding ones). One
   * taken from a sounding note first drops the bends it was given for that note.
   */
  const takeUp = (v: Slot, time: number, how: 'free' | 'new' | 'stolen') => {
    const cents = bends.at(time);
    if (how === 'stolen') {
      if (!bends.moved()) return;
      v.voice.detune.cancelScheduledValues(time);
    } else if (how === 'new' && !cents) return;
    v.voice.detune.setTargetAtTime(cents, time, 0.001);
  };

  /** A voice for a note at `time`, and how it was found. */
  const pick = (time: number): { slot: Slot; how: 'free' | 'new' | 'stolen' } | undefined => {
    let free: Slot | undefined;
    const busy: Slot[] = [];
    for (const v of voices) {
      if (v.end <= time) {
        // Reuse the most recently freed voice, so spare ones go idle long enough to be disposed
        if (!free || v.end > free.end) free = v;
      } else if (v.start < time) {
        // (a voice already starting at `time` can't be retriggered at the same instant)
        busy.push(v);
      }
    }
    if (free) return { slot: free, how: 'free' };
    if (voices.length < maxVoices) {
      const v = { voice: makeVoice(out.context), start: -Infinity, end: -Infinity, serial: 0, velocity: 0, releasedAt: -Infinity, fedTo: -Infinity };
      v.voice.connect(out);
      voices.push(v);
      return { slot: v, how: 'new' };
    }
    // About how loud each is now: its velocity, falling through its release (40 dB over it)
    const level = (v: Slot) => (time > v.releasedAt ? v.velocity * Math.exp((-(time - v.releasedAt) * Math.log(100)) / Math.max(1e-3, v.end - v.releasedAt)) : v.velocity);
    // (none only if one chord has more notes than there are voices)
    const slot = busy[chooseNoteToSteal(busy.map((v) => ({ start: v.start, level: level(v), held: !(time >= v.releasedAt) })), time)];
    return slot && { slot, how: 'stolen' };
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
  const feedInterval = offline
    ? -1
    : out.context.setInterval(() => {
        const now = out.context.currentTime;
        for (const v of voices) if (v.end > now) feed(v);
      }, FEED_EVERY);

  return {
    trigger: (notes, duration, time, velocity = 1) => {
      const t = notLate(out.context, time);
      const length = out.toSeconds(duration);
      for (const note of notes) {
        const picked = pick(t);
        if (!picked) return;
        const v = picked.slot;
        try {
          takeUp(v, t, picked.how);
          v.voice.triggerAttackRelease(note, length, t, velocity);
          v.start = t;
          v.end = t + length + v.voice.toSeconds(v.voice.envelope.release);
          v.velocity = velocity;
          v.releasedAt = t + length;
          v.serial++;
          follow(v, t);
        } catch (err) {
          console.warn('Skipped a note:', err);
        }
      }
    },
    attack: (note, time, velocity) => {
      const t = notLate(out.context, time);
      const picked = pick(t);
      if (!picked) return { release: () => {} };
      const v = picked.slot;
      takeUp(v, t, picked.how);
      v.voice.triggerAttack(note, t, velocity);
      v.start = t;
      v.end = Infinity;
      v.velocity = velocity ?? 1;
      v.releasedAt = Infinity;
      const serial = ++v.serial;
      follow(v, t);
      return {
        release: (at) => {
          if (v.serial !== serial || v.end !== Infinity) return;
          const releaseAt = notLate(out.context, at);
          v.voice.triggerRelease(releaseAt);
          v.end = releaseAt + v.voice.toSeconds(v.voice.envelope.release);
          v.releasedAt = releaseAt;
          // (Held, it followed every bend sent for later: none past its tail)
          v.voice.detune.cancelScheduledValues(v.end);
        },
      };
    },
    bend: (cents, time, _live, cut) => {
      const t = notLate(out.context, time);
      bends.set(cents, t, cut);
      // (The bends set for later on every voice go: the ones each voice was given since it was taken)
      if (cut) for (const v of voices) v.voice.detune.cancelScheduledValues(t);
      // Sounding voices glide over a few ms (a bend wheel moves in small steps); idle ones pick it up
      // when taken, and one given the bends only to sooner gets it when it's fed (see feed)
      for (const v of voices) if (v.end > t && t <= v.fedTo) v.voice.detune.setTargetAtTime(cents, t, 0.005);
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
      out.context.clearInterval(feedInterval);
      voices.forEach((v) => v.voice.dispose());
      out.dispose();
    },
  };
}
