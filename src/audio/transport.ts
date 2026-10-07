import * as Tone from 'tone';
import { formatFrameRulerTime, formatFrameTimecode, framesToSeconds, parseFrameTimecode, secondsToFrames } from './timecode';

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

/**
 * Format as SMPTE timecode HH:MM:SS:FF at `fps`, assuming constant tempo. Drop-frame (29.97 only)
 * is written HH:MM:SS;FF.
 */
export function formatSmpte(bar: number, bpm: number, fps: number, dropFrame = false): string {
  return formatFrameTimecode(secondsToFrames(barToSeconds(bar, bpm), fps), fps, dropFrame);
}

/**
 * Short ruler label "M:SS:FF" ("M:SS;FF" in drop-frame). Always with frames, so a label typed into
 * the timecode box means the same place (two fields there are seconds and frames, not minutes and seconds).
 */
export function formatRulerTime(seconds: number, fps: number, dropFrame = false): string {
  return formatFrameRulerTime(secondsToFrames(seconds, fps), fps, dropFrame);
}

/**
 * Read a typed timecode as seconds, or null if it isn't one. Fields run right to left as
 * frames, seconds, minutes, hours ("1:02:03:04", "2:03:04", "3:04"), separated by any of
 * : ; . or spaces. Digits alone are read in pairs from the right, as in video editors:
 * "1500" is 00:00:15:00 and "12" is 12 frames. Fields may overflow ("90:00" is 90 seconds).
 * In drop-frame, a label that doesn't exist (;00 or ;01 at the start of most minutes) means the next frame.
 */
export function parseTimecode(text: string, fps: number, dropFrame = false): number | null {
  const frame = parseFrameTimecode(text, fps, dropFrame);
  return frame === null ? null : framesToSeconds(frame, fps);
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

/** A length as bars.beats.hundredths counted from zero: "4.0.00" is four bars, "2.2.00" two bars and two beats. */
export function formatBarsBeatsLength(bars: number): string {
  const total = Math.floor(Math.max(0, bars * 400) + 1e-6);
  return `${Math.floor(total / 400)}.${Math.floor((total % 400) / 100)}.${String(total % 100).padStart(2, '0')}`;
}

/** Read a typed length as bars ("8", "2.2" for two bars and two beats, "0.1.50"), or null. */
export function parseBarsBeatsLength(text: string): number | null {
  const m = text.trim().match(/^(\d+)(?:[.\s]+(\d+))?(?:[.\s]+(\d+))?$/);
  if (!m) return null;
  const beats = m[2] === undefined ? 0 : Number(m[2]);
  const hundredths = m[3] === undefined ? 0 : Number(m[3]);
  if (beats > 3 || hundredths > 99) return null;
  return Number(m[1]) + beats / 4 + hundredths / 400;
}
