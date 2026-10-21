/**
 * Line up recording, once per setup (Pocket's vocal tool, the studio's recording settings): a few
 * soft clicks are played through the speaker while the microphone records, and how late they
 * arrive (lineUp.ts) is kept for this setup (micRecorder.ts). Takes recorded on it from then on are
 * moved back by that measured delay instead of the browser's estimate.
 *
 * The clicks go straight to the output (not through the mix), at about -16 dB.
 */
import { initAudio, liveMix } from './engine';
import { savedRoundTrip, saveRoundTrip, setupKey, startMic } from './micRecorder';
import { CLICK_TIMES, MAX_ROUND_TRIP, clickTrain, findRoundTrip } from './lineUp';

function nativeContext(): AudioContext {
  const raw = liveMix.bus.context.rawContext as unknown as { _nativeAudioContext?: AudioContext };
  return raw._nativeAudioContext ?? (raw as unknown as AudioContext);
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export type LineUpResult = { ok: true; seconds: number; estimate: number } | { ok: false; reason: string };

/** The measured delay for the setup used last (seconds), or null when it isn't lined up. */
export const linedUpDelay = (): number | null => savedRoundTrip(setupKey());

/** Forget this setup's measurement (takes go back to the estimate). */
export const forgetLineUp = (): void => saveRoundTrip(setupKey(), null);

/**
 * Measure and keep the round trip. The song must be stopped. Throws when the microphone can't be
 * opened (as startMic does: a NotAllowedError when it isn't allowed).
 */
export async function lineUpRecording(): Promise<LineUpResult> {
  await initAudio();
  const ctx = nativeContext();
  const session = await startMic();
  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  try {
    // (Again: the phone's microphone question may have sent the app to the background meanwhile)
    await initAudio();
    // A moment for the microphone to settle (some open with a thump)
    await wait(400);
    const train = clickTrain(ctx.sampleRate);
    const buffer = ctx.createBuffer(1, train.length, ctx.sampleRate);
    buffer.copyToChannel(train, 0);
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const at = ctx.currentTime + 0.15;
    source.start(at);
    await wait((0.15 + CLICK_TIMES[CLICK_TIMES.length - 1] + MAX_ROUND_TRIP + 0.4) * 1000);
    stopped = true;
    const estimate = session.estimate();
    const take = await session.stop();
    if (!take) return { ok: false, reason: 'Nothing came from the microphone. Check that no other app is using it, and try again.' };
    const startOffset = Math.round((at - take.capturedAt) * take.sampleRate);
    if (startOffset < 0) return { ok: false, reason: 'The microphone started too late. Try again.' };
    // Both channels together (a stereo microphone's sides hear the same clicks)
    const mono = new Float32Array(take.channels[0].length);
    for (const ch of take.channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / take.channels.length;
    const trip = findRoundTrip(mono, take.sampleRate, startOffset, train);
    if (!trip) return { ok: false, reason: "Couldn't hear the clicks clearly. Take headphones off, turn the volume up a little, and try again somewhere quiet." };
    saveRoundTrip(setupKey(session.inputLabel), trip.seconds);
    return { ok: true, seconds: trip.seconds, estimate };
  } finally {
    source?.disconnect();
    if (!stopped) session.cancel();
  }
}

/** What a line-up found, in a sentence. */
export function lineUpMessage(result: LineUpResult): string {
  if (!result.ok) return result.reason;
  const ms = Math.round(result.seconds * 1000);
  const guess = Math.round(result.estimate * 1000);
  return `Lined up: takes arrive ${ms} ms late here and are moved back by that much${Math.abs(ms - guess) >= 10 ? ` (the estimate was ${guess} ms)` : ''}`;
}
