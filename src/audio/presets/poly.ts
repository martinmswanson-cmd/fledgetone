import * as Tone from 'tone';
import { notLate } from './monotonic';

/** Seconds a pool voice may sit silent before it's disposed. */
const IDLE_SECONDS = 3;

/** The parts of a monophonic Tone synth (Synth, FMSynth...) the pool drives. */
export interface PoolVoice {
  triggerAttackRelease: (note: Tone.Unit.Frequency, duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity?: number) => unknown;
  triggerRelease: (time?: Tone.Unit.Time) => unknown;
  envelope: { release: Tone.Unit.Time };
  connect: (destination: Tone.InputNode) => unknown;
  toSeconds: (time?: Tone.Unit.Time) => number;
  dispose: () => unknown;
}

export interface VoicePool {
  /** Play `notes` together at `time` (defaults to now). */
  trigger: (notes: string[], duration: Tone.Unit.Time, time?: Tone.Unit.Time, velocity?: number) => void;
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
 * note times alone, the same live and offline. When every voice is busy, the one that
 * finishes soonest is retriggered: an old tail is cut short instead of the new note lost.
 *
 * Voices are created as needed, up to `maxVoices`, by `makeVoice` in the context it's given
 * (the pool's, which isn't the global one while a WAV export renders), and disposed again
 * after IDLE_SECONDS of silence (live): a silent voice still costs CPU, because Chrome keeps
 * running every Tone signal (ConstantSourceNode) whether or not anything is connected or playing.
 */
export function createVoicePool(makeVoice: (context: Tone.BaseContext) => PoolVoice, maxVoices: number, output: Tone.InputNode): VoicePool {
  const out = new Tone.Gain(1).connect(output);
  let voices: { voice: PoolVoice; start: number; end: number }[] = [];

  const pick = (time: number) => {
    let free: (typeof voices)[number] | undefined;
    let soonest: (typeof voices)[number] | undefined;
    for (const v of voices) {
      if (v.end <= time) {
        // Reuse the most recently freed voice, so spare ones go idle long enough to be disposed
        if (!free || v.end > free.end) free = v;
      } else if (v.start < time && (!soonest || v.end < soonest.end)) {
        // (a voice already starting at `time` can't be retriggered at the same instant)
        soonest = v;
      }
    }
    if (free) return free;
    if (voices.length < maxVoices) {
      const v = { voice: makeVoice(out.context), start: -Infinity, end: -Infinity };
      v.voice.connect(out);
      voices.push(v);
      return v;
    }
    return soonest; // undefined only if one chord has more notes than there are voices
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
        } catch (err) {
          console.warn('Skipped a note:', err);
        }
      }
    },
    releaseAll: () => {
      const now = out.now();
      for (const v of voices) {
        if (v.end <= now) continue;
        v.voice.triggerRelease(now);
        v.end = Math.min(v.end, now + v.voice.toSeconds(v.voice.envelope.release));
      }
    },
    dispose: () => {
      out.context.clearInterval(gcInterval);
      voices.forEach((v) => v.voice.dispose());
      out.dispose();
    },
  };
}
