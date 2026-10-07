import * as Tone from 'tone';

/**
 * Transport position helpers. Timeline positions are 1-based bars (4/4);
 * Tone.Transport works in ticks (PPQ per quarter note).
 */
export function ticksPerBar(): number {
  return Tone.Transport.PPQ * 4;
}

export function barToTicks(bar: number): number {
  return Math.max(0, Math.round((bar - 1) * ticksPerBar()));
}

export function ticksToBar(ticks: number): number {
  return ticks / ticksPerBar() + 1;
}

/**
 * Position the listener is actually hearing right now. Tone.Transport.ticks reports
 * the scheduling time (currentTime + lookAhead), which would make the playhead run
 * ~100ms ahead of the audio, so we query the clock at the raw context time instead.
 */
export function getAudiblePositionBar(): number {
  return ticksToBar(Tone.Transport.getTicksAtTime(Tone.immediate()));
}

export function startTransportAt(bar: number): void {
  Tone.Transport.start('+0.03', `${barToTicks(bar)}i`);
}

export function pauseTransport(): void {
  Tone.Transport.pause();
}

export function stopTransport(): void {
  Tone.Transport.stop();
}

export function seekTransport(bar: number): void {
  Tone.Transport.ticks = barToTicks(bar);
}

/** Format as Premiere-style Bar.Beat.Tick ("001.01.00"); ticks shown as hundredths of a beat. */
export function formatBarsBeats(bar: number): string {
  // Count in whole hundredths of a beat (with float slack) so a typed 17.3.07 reads back as 07, not 06
  const total = Math.floor(Math.max(0, (bar - 1) * 400) + 1e-6);
  const barNum = Math.floor(total / 400) + 1;
  const beatNum = Math.floor((total % 400) / 100) + 1;
  const hundredths = total % 100;
  return `${String(barNum).padStart(3, '0')}.${String(beatNum).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/** Seconds from the start of bar 1 to `bar` (4/4 at a constant tempo). */
export function barToSeconds(bar: number, bpm: number): number {
  return ((bar - 1) * 240) / bpm;
}

export function secondsToBar(seconds: number, bpm: number): number {
  return (seconds * bpm) / 240 + 1;
}

/** Whole frames elapsed by `seconds`. A position sitting exactly on a frame can land a hair below it in floating point, so allow for that. */
function framesAt(seconds: number, fps: number): number {
  return Math.floor(Math.max(0, seconds) * fps + 1e-6);
}

/** Format as SMPTE timecode HH:MM:SS:FF (non-drop-frame) at `fps`, assuming constant tempo. */
export function formatSmpte(bar: number, bpm: number, fps: number): string {
  const totalFrames = framesAt(barToSeconds(bar, bpm), fps);
  const ff = totalFrames % fps;
  const ss = Math.floor(totalFrames / fps) % 60;
  const mm = Math.floor(totalFrames / (fps * 60)) % 60;
  const hh = Math.floor(totalFrames / (fps * 3600));
  return [hh, mm, ss, ff].map((v) => String(v).padStart(2, '0')).join(':');
}

/**
 * Short ruler label "M:SS:FF". Always with frames, so a label typed into the timecode box
 * means the same place (two fields there are seconds and frames, not minutes and seconds).
 */
export function formatRulerTime(seconds: number, fps: number): string {
  const totalFrames = framesAt(seconds, fps);
  const totalSeconds = Math.floor(totalFrames / fps);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}:${String(totalFrames % fps).padStart(2, '0')}`;
}

/**
 * Read a typed timecode as seconds, or null if it isn't one. Fields run right to left as
 * frames, seconds, minutes, hours ("1:02:03:04", "2:03:04", "3:04"), separated by any of
 * : ; . or spaces. Digits alone are read in pairs from the right, as in video editors:
 * "1500" is 00:00:15:00 and "12" is 12 frames. Fields may overflow ("90:00" is 90 seconds).
 */
export function parseTimecode(text: string, fps: number): number | null {
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
  return hh * 3600 + mm * 60 + ss + ff / fps;
}

/** Read a typed position as Bar.Beat.Hundredths ("17", "17.3", "17.3.50") into a 1-based bar, or null. */
export function parseBarsBeats(text: string): number | null {
  const m = text.trim().match(/^(\d+)(?:[.:\s]+(\d+))?(?:[.:\s]+(\d+))?$/);
  if (!m) return null;
  const bar = Number(m[1]);
  const beat = m[2] === undefined ? 1 : Number(m[2]);
  const hundredths = m[3] === undefined ? 0 : Number(m[3]);
  if (bar < 1 || beat < 1 || beat > 4 || hundredths > 99) return null;
  return bar + (beat - 1) / 4 + hundredths / 400;
}
