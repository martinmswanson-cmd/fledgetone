/**
 * Stopping a preview outside the song without a click: a sound cut off mid-waveform clicks, so a
 * preview stopped by another starting (exclusivePreview.ts) or by its own Stop fades out over
 * PREVIEW_FADE_SECONDS first. previewVoice puts a buffer source through a gain of its own for
 * that; fadeOut fades any gain down from wherever it is (mid fade-in included). Plain Web Audio,
 * no store.
 */

/** How long a stopped preview takes to fade out, seconds. */
export const PREVIEW_FADE_SECONDS = 0.04;

/**
 * Fade `gain` to silence over `seconds` from now, from its level now (a ramp under way is held
 * where it is, not dropped). Returns the context time the fade ends.
 */
export function fadeOut(gain: GainNode, seconds = PREVIEW_FADE_SECONDS): number {
  const param = gain.gain;
  const now = gain.context.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
  else {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
  }
  param.linearRampToValueAtTime(0, now + seconds);
  return now + seconds;
}

/** A source played through a fade of its own. */
export interface PreviewVoice {
  src: AudioScheduledSourceNode;
  fade: GainNode;
  /** Fade out (PREVIEW_FADE_SECONDS) and stop: never cut while it may still be heard. */
  stop: () => void;
}

/** `src` connected to `to` through a gain of its own, so it can be stopped with a fade. */
export function previewVoice(src: AudioScheduledSourceNode, to: AudioNode): PreviewVoice {
  const fade = src.context.createGain();
  src.connect(fade);
  fade.connect(to);
  src.addEventListener('ended', () => fade.disconnect());
  let stopped = false;
  return {
    src,
    fade,
    stop: () => {
      if (stopped) return;
      stopped = true;
      const end = fadeOut(fade);
      try {
        src.stop(end + 0.005);
      } catch {
        // Not started or already stopped
        fade.disconnect();
      }
    },
  };
}
