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
 * How late swing plays a swung note, in seconds: `swing` (0 to 0.5) times a third of an 8th, so
 * at 50% an off-beat 16th lands on the 1/8-triplet line (a full shuffle). Written as Tone works
 * out its own swing, so a swung 16th lands on exactly the same sample as it always has.
 */
export function swingDelay(swing: number, bpm: number, ppq = 192): number {
  if (!(swing > 0)) return 0;
  return (((2 * (ppq / 4)) / 3) / ppq) * (60 / bpm) * swing;
}

/**
 * Which of a clip's notes swing, given their Transport ticks and the tick the clip starts on.
 * Swing moves the off-beat 16ths, the second 16th of every 8th, and leaves every other position
 * where it is: downbeats, 8ths, triplets and 1/32 notes. (Tone's own swing bent every position
 * inside an 8th along a curve, so triplets and 1/32 rolls came out uneven.) Beyond that:
 * - A note nudged off an off-beat 16th still swings while it's nearer to it than to any triplet
 *   line (less than a 1/48 note, 8 ticks, away).
 * - An 8th in which the clip has notes between the 16ths (a 1/32 roll, a triplet run, a 1/32
 *   pickup) plays straight, its off-beat 16th included, so the run stays even.
 * - The grid is the clip's own: a clip placed off the 16th grid (Shift-dragged, frame-snapped,
 *   typed as a time) swings as if it sat on the nearest 16th line (the earlier one on a tie).
 * - Unless its notes sit better on another: a clip split or start-trimmed off the grid keeps its
 *   notes where they were, so they go on swinging on the grid they were written on (the song's,
 *   or a moved clip's), not on one counted from the cut.
 */
export function swungNotes(ticks: readonly number[], clipStartTick: number, ppq = 192): boolean[] {
  const sixteenth = ppq / 4;
  const eighth = 2 * sixteenth;
  const near = ppq / 24;
  const half = Math.floor(sixteenth / 2);
  /** How far `tick` sits after its nearest 16th line, -23 to 24 ticks at 192 PPQ. */
  const offsetOf = (tick: number) => ((((tick + half - 1) % sixteenth) + sixteenth) % sixteenth) - (half - 1);
  /** How many notes sit on (or near) a 16th line of the grid `shift` ticks after the song's. */
  const onGrid = (shift: number) => ticks.reduce((n, tick) => (Math.abs(offsetOf(tick - shift)) < near ? n + 1 : n), 0);
  // The grids to choose from, preferred in this order: the clip's, the song's, and the one most
  // of its notes sit exactly on (if that's more than one note: a lone note says nothing)
  const counts = new Map<number, number>();
  for (const tick of ticks) counts.set(offsetOf(tick), (counts.get(offsetOf(tick)) ?? 0) + 1);
  let common: number | null = null;
  for (const [shift, n] of counts) if (n >= 2 && (common === null || n > counts.get(common)!)) common = shift;
  let offset = offsetOf(clipStartTick);
  let best = onGrid(offset);
  for (const shift of common === null ? [0] : [0, common]) {
    const n = onGrid(shift);
    if (n > best) [offset, best] = [shift, n];
  }
  const inEighth = (g: number) => ((g % eighth) + eighth) % eighth;
  const runs = new Set<number>();
  for (const tick of ticks) {
    const g = tick - offset;
    const fromSixteenth = inEighth(g) % sixteenth;
    if (Math.min(fromSixteenth, sixteenth - fromSixteenth) >= near) runs.add(Math.floor(g / eighth));
  }
  return ticks.map((tick) => {
    const g = tick - offset;
    return Math.abs(inEighth(g) - sixteenth) < near && !runs.has(Math.floor(g / eighth));
  });
}

/**
 * Where the Transport was last sent (started or moved while playing) and the audio time it gets
 * there. Tone acts on both a look-ahead after the call, and until then reports its old position:
 * bar 1 for a Transport that was stopped, so the playhead (and the view following it) flashed back
 * to the start of the song for a tenth of a second each time playback started, and a click on the
 * ruler while playing showed the playhead jump back before it went there.
 */
let heading: { bar: number; at: number } | null = null;

/**
 * Position the listener is actually hearing right now. Tone.Transport.ticks reports
 * the scheduling time (currentTime + lookAhead), which would make the playhead run
 * ~100ms ahead of the audio, so we query the clock at the raw context time instead.
 * Until a start or a move is heard, that's where it's going.
 */
export function getAudiblePositionBar(): number {
  const now = Tone.immediate();
  if (heading && now < heading.at) return heading.bar;
  heading = null;
  return ticksToBar(Tone.Transport.getTicksAtTime(now));
}

/** Where the Transport is scheduling (the look-ahead past what's heard): a seek shows here at once. */
export function getScheduledPositionBar(): number {
  return ticksToBar(Tone.Transport.ticks);
}

export function startTransportAt(bar: number): void {
  const at = Tone.now() + 0.03;
  Tone.Transport.start(at, `${barToTicks(bar)}i`);
  heading = { bar, at };
}

export function pauseTransport(): void {
  heading = null;
  Tone.Transport.pause();
}

export function stopTransport(): void {
  heading = null;
  Tone.Transport.stop();
}

export function seekTransport(bar: number): void {
  const playing = Tone.Transport.state === 'started';
  Tone.Transport.ticks = barToTicks(bar);
  // Playing, Tone moves there at its look-ahead, on the next tick
  if (playing) heading = { bar, at: Tone.now() + Tone.Transport.toSeconds('1i') };
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
