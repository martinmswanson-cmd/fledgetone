/**
 * Where a game's intro runs into its loop (Intro + loop exports, renderIntroLoop in exportWav.ts):
 * the intro's last few milliseconds crossfade into the loop's own last ones, so the intro's last
 * sample leads into the loop's first exactly as the loop's last one does.
 *
 * Why: the loop is seamless, so its start holds what rings on from its own end (the pass before),
 * not from the intro. Played straight after the intro, its first sample could be far from the
 * intro's last one (a bass note or a reverb tail that the intro doesn't have, or the other way
 * round): a step heard as a click every time a game starts the music. The seamless loop's own end
 * is crossfaded into the pass before in the same way (finishRender in exportWav.ts).
 * Pure, so Node can test it.
 */

/** Seconds of the intro's end crossfaded into the loop's end. */
export const INTRO_SEAM_SECONDS = 0.01;

/** Crossfade `intro`'s last frames (in place) into `loop`'s last ones, channel by channel (see above). */
export function leadIntoLoop(intro: Float32Array[], loop: Float32Array[], sampleRate: number): void {
  const n = intro[0]?.length ?? 0;
  const m = loop[0]?.length ?? 0;
  const fade = Math.min(Math.round(INTRO_SEAM_SECONDS * sampleRate), n, m);
  if (fade < 1) return;
  intro.forEach((ch, c) => {
    const end = loop[c] ?? loop[0];
    for (let k = 0; k < fade; k++) {
      const i = n - fade + k;
      const w = (k + 1) / fade;
      ch[i] += (end[m - fade + k] - ch[i]) * w;
    }
  });
}
