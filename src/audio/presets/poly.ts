/**
 * A polyphonic synth made from a pool of monophonic Tone voices (createVoicePool), used instead of
 * Tone.PolySynth: voices are added as needed instead of notes being dropped, and silent ones are
 * freed.
 */
import * as Tone from 'tone';
import { notLate } from './monotonic';
import { chooseNoteToSteal } from '../samplers/noteStealing';

/** Seconds a pool voice may sit silent before it's disposed. */
const IDLE_SECONDS = 3;

/** The parts of a monophonic Tone synth (Synth, FMSynth...) the pool drives. */
export interface PoolVoice {
  triggerAttackRelease: (note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerAttack: (note: Tone.Unit.Frequency, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerRelease: (time?: Tone.Unit.Time) => unknown;
  envelope: { release: Tone.Unit.Time };
  /** Its pitch offset in cents (a MIDI pitch bend moves it). */
  detune: { setTargetAtTime: (value: number, time: Tone.Unit.Time, constant: number) => unknown };
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
  /** Bend every sounding voice (and the ones to come) by `cents`. */
  bend: (cents: number, time: number) => void;
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
  let voices: { voice: PoolVoice; start: number; end: number; serial: number; velocity: number; releasedAt: number }[] = [];
  /** The current pitch bend in cents, applied to every voice as it's taken. */
  let bendCents = 0;

  const pick = (time: number) => {
    let free: (typeof voices)[number] | undefined;
    const busy: typeof voices = [];
    for (const v of voices) {
      if (v.end <= time) {
        // Reuse the most recently freed voice, so spare ones go idle long enough to be disposed
        if (!free || v.end > free.end) free = v;
      } else if (v.start < time) {
        // (a voice already starting at `time` can't be retriggered at the same instant)
        busy.push(v);
      }
    }
    if (free) return free;
    if (voices.length < maxVoices) {
      const v = { voice: makeVoice(out.context), start: -Infinity, end: -Infinity, serial: 0, velocity: 0, releasedAt: -Infinity };
      v.voice.connect(out);
      if (bendCents) v.voice.detune.setTargetAtTime(bendCents, time, 0.001);
      voices.push(v);
      return v;
    }
    // About how loud each is now: its velocity, falling through its release (40 dB over it)
    const level = (v: (typeof voices)[number]) => (time > v.releasedAt ? v.velocity * Math.exp((-(time - v.releasedAt) * Math.log(100)) / Math.max(1e-3, v.end - v.releasedAt)) : v.velocity);
    // (none only if one chord has more notes than there are voices)
    return busy[chooseNoteToSteal(busy.map((v) => ({ start: v.start, level: level(v), held: !(time >= v.releasedAt) })), time)];
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
      const t = notLate(out.context, time);
      const length = out.toSeconds(duration);
      for (const note of notes) {
        const v = pick(t);
        if (!v) return;
        try {
          v.voice.triggerAttackRelease(note, length, t, velocity);
          v.start = t;
          v.end = t + length + v.voice.toSeconds(v.voice.envelope.release);
          v.velocity = velocity;
          v.releasedAt = t + length;
          v.serial++;
        } catch (err) {
          console.warn('Skipped a note:', err);
        }
      }
    },
    attack: (note, time, velocity) => {
      const t = notLate(out.context, time);
      const v = pick(t);
      if (!v) return { release: () => {} };
      v.voice.triggerAttack(note, t, velocity);
      v.start = t;
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
    bend: (cents, time) => {
      bendCents = cents;
      const t = notLate(out.context, time);
      // Sounding voices glide over a few ms (a bend wheel moves in small steps); idle ones pick it up when taken
      for (const v of voices) if (v.end > t) v.voice.detune.setTargetAtTime(cents, t, 0.005);
    },
    releaseAll: () => {
      const now = out.now();
      for (const v of voices) {
        if (v.end <= now) continue;
        v.voice.triggerRelease(now);
        v.end = Math.min(v.end, now + v.voice.toSeconds(v.voice.envelope.release));
        v.releasedAt = Math.min(v.releasedAt, now);
      }
    },
    dispose: () => {
      out.context.clearInterval(gcInterval);
      voices.forEach((v) => v.voice.dispose());
      out.dispose();
    },
  };
}
