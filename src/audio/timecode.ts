/**
 * Timecode arithmetic on whole frames, independent of tempo and Tone.js (so Node can unit-test it).
 *
 * A timecode label counts frames at a whole "nominal" rate: 24, 25, 30 or 60 labels per second.
 * The video rates 23.976 and 29.97 count like 24 and 30 but run 0.1% slower, so each frame lasts
 * 1001/24000 or 1001/30000 of a second. Drop-frame (29.97 only) keeps the label close to the clock
 * on the wall by skipping the frame numbers 00 and 01 at the start of every minute, except every
 * tenth minute. Nothing else is skipped: frames themselves stay evenly spaced.
 */

/** Labels per second: 24 for 23.976, 30 for 29.97, otherwise the rate itself. */
export function nominalFps(fps: number): number {
  return Math.round(fps);
}

const isFractional = (fps: number) => nominalFps(fps) !== fps;

/** Drop-frame only exists for 29.97 (a 30 fps count). */
export function isDropFrame(fps: number, dropFrame: boolean): boolean {
  return dropFrame && isFractional(fps) && nominalFps(fps) === 30;
}

/** Real length of one frame, in seconds. */
export function frameSeconds(fps: number): number {
  const n = nominalFps(fps);
  return isFractional(fps) ? 1001 / (n * 1000) : 1 / n;
}

/** Start of `frame`, in seconds. */
export function framesToSeconds(frame: number, fps: number): number {
  const n = nominalFps(fps);
  return isFractional(fps) ? (frame * 1001) / (n * 1000) : frame / n;
}

/**
 * Whole frames elapsed by `seconds`. A position sitting exactly on a frame can land a hair
 * below it in floating point, so allow for that.
 */
export function secondsToFrames(seconds: number, fps: number): number {
  const n = nominalFps(fps);
  const exact = isFractional(fps) ? (Math.max(0, seconds) * n * 1000) / 1001 : Math.max(0, seconds) * n;
  return Math.floor(exact + 1e-6);
}

// Drop-frame at 29.97: two labels skipped a minute, nine times every ten minutes
const DF_DROP = 2;
const DF_FRAMES_PER_MINUTE = 30 * 60 - DF_DROP; // 1798
const DF_FRAMES_PER_TEN_MINUTES = 10 * 30 * 60 - 9 * DF_DROP; // 17982

/**
 * The label count for a frame: how many frames the label reads as if none were skipped
 * (hours, minutes, seconds and frames all come from this at the nominal rate).
 */
export function frameToLabelCount(frame: number, fps: number, dropFrame: boolean): number {
  if (!isDropFrame(fps, dropFrame)) return frame;
  const tens = Math.floor(frame / DF_FRAMES_PER_TEN_MINUTES);
  const rest = frame % DF_FRAMES_PER_TEN_MINUTES;
  // The first minute of each ten keeps all its labels; each later minute skips two
  const minutesSkipping = rest < DF_DROP ? 0 : Math.floor((rest - DF_DROP) / DF_FRAMES_PER_MINUTE);
  return frame + 9 * DF_DROP * tens + DF_DROP * minutesSkipping;
}

/**
 * The frame a label count stands for. In drop-frame, the labels that don't exist
 * (`;00` and `;01` at the start of most minutes) mean the next real frame (`;02`).
 */
export function labelCountToFrame(label: number, fps: number, dropFrame: boolean): number {
  if (!isDropFrame(fps, dropFrame)) return label;
  const perMinute = 30 * 60;
  const minutes = Math.floor(label / perMinute);
  const intoMinute = label % perMinute;
  const valid = minutes % 10 !== 0 && intoMinute < DF_DROP ? label + DF_DROP - intoMinute : label;
  return valid - DF_DROP * (minutes - Math.floor(minutes / 10));
}

const pad2 = (v: number) => String(v).padStart(2, '0');

/** Hours, minutes, seconds and frames of a frame's label. */
function labelFields(frame: number, fps: number, dropFrame: boolean) {
  const n = nominalFps(fps);
  const label = frameToLabelCount(frame, fps, dropFrame);
  return {
    hours: Math.floor(label / (n * 3600)),
    minutes: Math.floor(label / (n * 60)) % 60,
    seconds: Math.floor(label / n) % 60,
    frames: label % n,
    // Drop-frame timecode is written with ; before the frames
    sep: isDropFrame(fps, dropFrame) ? ';' : ':',
  };
}

/** "HH:MM:SS:FF" for a frame ("HH:MM:SS;FF" in drop-frame). */
export function formatFrameTimecode(frame: number, fps: number, dropFrame: boolean): string {
  const f = labelFields(Math.max(0, frame), fps, dropFrame);
  return `${pad2(f.hours)}:${pad2(f.minutes)}:${pad2(f.seconds)}${f.sep}${pad2(f.frames)}`;
}

/** Short "M:SS:FF" for the ruler (minutes keep counting past 59; "M:SS;FF" in drop-frame). */
export function formatFrameRulerTime(frame: number, fps: number, dropFrame: boolean): string {
  const f = labelFields(Math.max(0, frame), fps, dropFrame);
  return `${f.hours * 60 + f.minutes}:${pad2(f.seconds)}${f.sep}${pad2(f.frames)}`;
}

/**
 * Read a typed timecode as a frame number, or null if it isn't one. Fields run right to left as
 * frames, seconds, minutes, hours ("1:02:03:04", "2:03:04", "3:04"), separated by any of
 * : ; . or spaces. Digits alone are read in pairs from the right, as in video editors:
 * "1500" is 00:00:15:00 and "12" is 12 frames. Fields may overflow ("90:00" is 90 seconds).
 */
export function parseFrameTimecode(text: string, fps: number, dropFrame: boolean): number | null {
  const t = text.trim();
  let fields: number[];
  if (/^\d{1,8}$/.test(t)) {
    fields = (t.length % 2 ? `0${t}` : t).match(/\d\d/g)!.map(Number);
  } else if (/^\d+([:;.\s]+\d+){1,3}$/.test(t)) {
    fields = t.split(/[:;.\s]+/).map(Number);
  } else {
    return null;
  }
  const [ff = 0, ss = 0, mm = 0, hh = 0] = fields.reverse();
  const n = nominalFps(fps);
  return labelCountToFrame(((hh * 60 + mm) * 60 + ss) * n + ff, fps, dropFrame);
}
