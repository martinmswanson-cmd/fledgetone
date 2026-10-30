/**
 * Hearing a stretch of a sound straight away, outside the song (a chop in the Chop sample dialog,
 * before it has a track): one buffer source through the master, gone when it ends.
 */
import { initAudio, liveMix } from './engine';
import { decodeSound } from './soundLibrary';
import { nativeInputOf } from './nativeNodes';
import { claimPreview, registerPreview } from './exclusivePreview';

let playing: { source: AudioBufferSourceNode; amp: GainNode } | null = null;

/** Play `start` to `end` seconds of the sound (stopping the last one heard), with short fades. */
export async function auditionPart(soundId: string, start: number, end: number): Promise<void> {
  await initAudio();
  const into = nativeInputOf(liveMix.bus);
  const raw = into.context;
  const buffer = await decodeSound(soundId, raw.sampleRate);
  stopAudition();
  const from = Math.max(0, Math.min(buffer.duration, start));
  const seconds = Math.max(0.01, Math.min(buffer.duration, end) - from);
  const source = raw.createBufferSource();
  source.buffer = buffer;
  const amp = raw.createGain();
  const at = raw.currentTime + 0.01;
  const fade = Math.min(0.005, seconds / 2);
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(0.9, at + fade);
  amp.gain.setValueAtTime(0.9, at + seconds - fade);
  amp.gain.linearRampToValueAtTime(0, at + seconds);
  source.connect(amp);
  amp.connect(into);
  claimPreview('chop');
  source.start(at, from, seconds);
  source.stop(at + seconds + 0.01);
  const mine = { source, amp };
  playing = mine;
  source.onended = () => {
    source.disconnect();
    amp.disconnect();
    if (playing === mine) playing = null;
  };
}

/** Stop what auditionPart is playing. */
export function stopAudition(): void {
  if (!playing) return;
  const { source, amp } = playing;
  playing = null;
  try {
    source.stop();
  } catch {
    // Already stopped
  }
  source.disconnect();
  amp.disconnect();
}

// Another preview starting stops this one (one at a time, see exclusivePreview.ts)
registerPreview('chop', stopAudition);
