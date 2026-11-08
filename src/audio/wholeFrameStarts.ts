/**
 * Every sound played from a buffer (a noise burst, a drum hit, a recording) starts on a whole
 * frame, so it plays its samples as they are, live and exported alike.
 *
 * Chromium starts a buffer asked to start between two frames on the next frame, and reads it
 * between its samples from there to its end: each sample it plays mixes two of the buffer's, a
 * gentle lowpass that takes 2.4 dB off white noise started 0.3 of a frame past one (3 dB at half a
 * frame) and dulls a hat or a cymbal. Every note of an export falls 0.3 of a frame past one (see
 * planRender in exportWav.ts), while a note played by hand starts on one (attackRoom in
 * soundLead.ts): the Groove Drum Kit's snare was 1.1 dB quieter exported than heard (its noise
 * 2.4 dB), every noise burst, clap, cymbal and recorded hit was duller, and live, the timeline's
 * hits at a tempo whose notes fall between frames came out unevenly loud. Started on that next
 * frame instead, a buffer begins where it did and plays the same samples wherever its note falls.
 * (The players that already start their buffers on a frame are unchanged.)
 *
 * Installed on AudioBufferSourceNode itself, so it covers every player: Tone's (its noise and
 * samples, through standardized-audio-context) and the app's own. engine.ts and instruments.ts
 * import it before any sound is made.
 */

/** A start this close to a frame (in frames) is on it: Chromium plays it from that frame as it is. */
const ON_FRAME = 1 / 2048;

/** When a buffer asked to start at `time` (seconds) plays from at `sampleRate`: `time` itself when that's on a frame, else the next frame. */
export function bufferStartTime(time: number, sampleRate: number): number {
  const frames = time * sampleRate;
  if (Math.abs(frames - Math.round(frames)) <= ON_FRAME) return time;
  return Math.ceil(frames) / sampleRate;
}

type Start = AudioBufferSourceNode['start'] & { onFrames?: boolean };
const proto = typeof AudioBufferSourceNode === 'undefined' ? null : (AudioBufferSourceNode.prototype as { start: Start });
if (proto && !proto.start.onFrames) {
  const start = proto.start;
  const onFrames: Start = function (this: AudioBufferSourceNode, ...args: Parameters<Start>) {
    const when = args[0];
    if (typeof when === 'number' && when > 0 && Number.isFinite(when)) args[0] = bufferStartTime(when, this.context.sampleRate);
    return start.apply(this, args);
  };
  onFrames.onFrames = true;
  proto.start = onFrames;
}
