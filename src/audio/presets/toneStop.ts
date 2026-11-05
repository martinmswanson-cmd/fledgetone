/**
 * Stop and Pause for instruments built from Tone's synths. Notes are handed to an instrument a
 * little ahead of their time (the Transport's look-ahead), so when Stop is pressed some may still
 * be to come: a Tone envelope released before its attack has arrived does nothing (its value is
 * still 0), and the note would then play whole after Stop. These call them off, on the audio clock
 * as it is now (Tone's own now() adds the look-ahead).
 */
import type * as Tone from 'tone';

/**
 * Pause keeps the place being heard, which is the output latency behind the audio clock, so a hit
 * that has started on the clock but not been heard yet would ring on through the pause and then
 * play again, whole, on Play. Such a hit fades out over this long instead (a fade, not a cut).
 */
export const UNHEARD_FADE = 0.005;

/** An envelope's level signal (Tone keeps it to itself). */
export const envelopeSignal = (env: Tone.Envelope) => (env as unknown as { _sig: Tone.Signal<'normalRange'> })._sig;

/** The parts of a Tone synth (Synth, MonoSynth, FMSynth, MembraneSynth, NoiseSynth, MetalSynth) Stop works on. */
export interface ToneVoice {
  envelope: Tone.Envelope;
  filterEnvelope?: Tone.Envelope;
  modulationEnvelope?: Tone.Envelope;
  frequency?: { cancelAndHoldAtTime: (time: number) => unknown; cancelScheduledValues: (time: number) => unknown };
  triggerRelease: (time?: Tone.Unit.Time) => unknown;
}

const envelopesOf = (synth: ToneVoice) => [synth.envelope, synth.filterEnvelope, synth.modulationEnvelope].filter((e): e is Tone.Envelope => !!e);

/**
 * Let a Tone synth go at `now` (the audio clock as it is: Stop, Pause): what it's sounding falls
 * away with its own release from the level it has reached, and whatever was handed to it for
 * later (a note's attack, a legato change of pitch) never comes.
 */
export function letGoToneSynth(synth: ToneVoice, now: number): void {
  // Held where they are now, with everything after dropped (a note to come; a swell in progress keeps its level)
  for (const env of envelopesOf(synth)) envelopeSignal(env).cancelAndHoldAtTime(now);
  synth.frequency?.cancelAndHoldAtTime(now);
  synth.triggerRelease(now);
}

/**
 * The hits a drum kit's Tone synths have been handed for later (drum hits ring out on their own,
 * so Stop leaves a sounding one alone). `callOff(now)` cancels each synth's hits from the first one
 * still to come: the hit before it, if it's still ringing, is let go where that hit would have
 * cut it. `callOff(now, heard)` (Pause, `heard` the time being heard now) also fades out the hit
 * a synth started at or after `heard`, which hasn't been heard yet and will play again on Play.
 */
export function createComingHits(clock: () => number) {
  const coming = new Map<ToneVoice, number[]>();
  return {
    /** `synth` is to start a hit at `at` (times only go up: see monotonicTime). */
    add(synth: ToneVoice, at: number): void {
      const now = clock();
      const list = coming.get(synth);
      if (!list) coming.set(synth, [at]);
      else {
        // (the last one begun is kept: a pause may come before it's heard)
        while (list.length > 1 && list[1] <= now) list.shift();
        list.push(at);
      }
    },
    callOff(now: number, heard?: number): void {
      for (const [synth, list] of coming) {
        const first = list.find((t) => t >= now);
        const begun = list.filter((t) => t < now).pop();
        const fade = heard !== undefined && begun !== undefined && begun >= heard;
        if (fade) {
          // Its loudness falls to 0 from where it is, the rest held (a hit to come never starts)
          for (const env of envelopesOf(synth)) envelopeSignal(env).cancelAndHoldAtTime(now);
          envelopeSignal(synth.envelope).linearRampToValueAtTime(0, now + UNHEARD_FADE);
        } else {
          if (first === undefined) continue;
          for (const env of envelopesOf(synth)) envelopeSignal(env).cancelScheduledValues(first);
        }
        if (first === undefined) continue;
        // (its pitch sweep too: the last hit's tail keeps its pitch)
        synth.frequency?.cancelScheduledValues(first);
        // (once faded: a release begun during the fade would fall from there more slowly)
        synth.triggerRelease(fade ? Math.max(first, now + UNHEARD_FADE) : first);
      }
      coming.clear();
    },
  };
}
