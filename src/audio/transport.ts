/**
 * Positions and time on a Transport: 1-based bars to Tone ticks and back, the song's meter and the
 * live tempo map, swing, and where playback is (what's been scheduled versus what the listener
 * hears now).
 */
import * as Tone from 'tone';
import { liveTransport } from './liveContext';
import { formatFrameRulerTime, formatFrameTimecode, framesToSeconds, parseFrameTimecode, secondsToFrames } from './timecode';
import { barToSeconds as mapBarToSeconds, FOUR_FOUR, fromMeasureBeat, secondsToBar as mapSecondsToBar, tempoChangeBars, tempoFrom, toMeasureBeat } from './tempoMap';
import type { MeterMap, Tempo } from './tempoMap';

export type { Tempo } from './tempoMap';

/**
 * The song's meter, for counting positions as measure.beat (the ruler, the position box, typed
 * positions). The store keeps it in step with the song (setSongMeter).
 */
let songMeter: MeterMap = { base: FOUR_FOUR, points: [] };
export function setSongMeter(map: MeterMap): void {
  songMeter = map;
}
export const getSongMeter = () => songMeter;

/**
 * The live Transport's tempo map. Tone ramps and jumps its tempo where the map says, as it plays
 * (see scheduleTempo); a start or a move sets the tempo of where it lands.
 */
let liveTempo: Tempo = 120;
export function setLiveTempo(tempo: Tempo): void {
  liveTempo = tempo;
}
export const getLiveTempo = () => liveTempo;

type TransportLike = ReturnType<typeof Tone.getTransport>;

/**
 * Set `transport`'s tempo to what `tempo` has at `bar`, from audio time `time`: the tempo there,
 * and the rest of a glide it's part way through.
 */
export function applyTempoAt(transport: TransportLike, tempo: Tempo, bar: number, time: number): void {
  const { bpm, glide } = tempoFrom(bar, tempo);
  const param = transport.bpm;
  // Hold, not cancel: a glide ending here is kept up to `time`. Cancelled, the Transport counted
  // the whole glide at its starting tempo and jumped ahead (a beat and more) where it ended
  param.cancelAndHoldAtTime(time);
  param.setValueAtTime(bpm, time);
  if (glide && glide.seconds > 0) param.linearRampToValueAtTime(glide.to, time + glide.seconds);
}

/**
 * Keep `transport`'s tempo following `tempo` as it plays: an event at every tempo change, and at
 * `loopIn` (a loop jumps back there, to whatever tempo the map has). Returns the event ids, for
 * clearing when the map or the loop changes.
 */
export function scheduleTempo(transport: TransportLike, tempo: Tempo, loopIn: number | null): number[] {
  const bars = tempoChangeBars(tempo);
  if (!bars.length) return [];
  if (loopIn !== null) bars.push(loopIn);
  return [...new Set(bars)].map((bar) => transport.schedule((time) => applyTempoAt(transport, tempo, bar, time), `${barToTicks(bar)}i`));
}

/**
 * Transport position helpers. Timeline positions are 1-based bars (4/4);
 * Tone.Transport works in ticks (PPQ per quarter note).
 */
export function ticksPerBar(): number {
  return liveTransport.PPQ * 4;
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
export function swingDelay(swing: number, bpm: number, ppq = 192, grid: 8 | 16 = 16): number {
  if (!(swing > 0)) return 0;
  const unit = grid === 8 ? ppq / 2 : ppq / 4;
  return (((2 * unit) / 3) / ppq) * (60 / bpm) * swing;
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
 * - Unless more of its notes sit on the song's grid: a clip split or start-trimmed off the grid
 *   keeps its notes where they were, so they go on swinging on the song's 16ths, not on a grid
 *   counted from the cut. Those two grids are the only ones considered. The notes themselves
 *   can't say which grid they were written on: a clip shifted by a third of a 16th looks exactly
 *   like a triplet pattern, and triplets must never swing. So a clip moved off the grid and then
 *   cut off the grid sits on neither grid and plays straight, which moves nothing.
 */
export function swungNotes(ticks: readonly number[], clipStartTick: number, ppq = 192, grid: 8 | 16 = 16): boolean[] {
  // (On an 8th grid the same rules run one level up: off-beat 8ths swing, a beat with 16ths in it plays straight)
  const sixteenth = grid === 8 ? ppq / 2 : ppq / 4;
  const eighth = 2 * sixteenth;
  const near = ppq / 24;
  const half = Math.floor(sixteenth / 2);
  /** How far `tick` sits after its nearest 16th line, -23 to 24 ticks at 192 PPQ. */
  const offsetOf = (tick: number) => ((((tick + half - 1) % sixteenth) + sixteenth) % sixteenth) - (half - 1);
  /** How many notes sit on (or near) a 16th line of the grid `shift` ticks after the song's. */
  const onGrid = (shift: number) => ticks.reduce((n, tick) => (Math.abs(offsetOf(tick - shift)) < near ? n + 1 : n), 0);
  // The clip's own grid, unless the song's fits its notes better
  let offset = offsetOf(clipStartTick);
  if (onGrid(0) > onGrid(offset)) offset = 0;
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
 * The audio time a Play is due to start the Transport, while that's still to come: a recording
 * count-in starts it a bar of clicks later than the press. Pausing or stopping before then cancels
 * the start (Tone would pause a Transport that hasn't started, and start it later anyway).
 */
let pendingStart: number | null = null;

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
  // What leaves the speakers now was rendered the output latency ago (larger with Stable playback)
  return ticksToBar(liveTransport.getTicksAtTime(Math.max(0, now - outputLatency())));
}

/**
 * Seconds from a sample leaving the graph to the listener hearing it, from the browser's own
 * context (Tone's wrapper doesn't pass these on; see latency.ts, which can't be imported here).
 */
function outputLatency(): number {
  const raw = Tone.getContext().rawContext as unknown as { _nativeAudioContext?: AudioContext };
  const native = (raw._nativeAudioContext ?? raw) as Partial<AudioContext>;
  return (native.baseLatency || 0) + (native.outputLatency || 0);
}

/** Where the Transport is scheduling (the look-ahead past what's heard): a seek shows here at once. */
export function getScheduledPositionBar(): number {
  return ticksToBar(liveTransport.ticks);
}

/** Start playing from `bar`, at audio time `at` (just ahead of now, or after a count-in). */
export function startTransportAt(bar: number, at = Tone.now() + 0.03): void {
  applyTempoAt(liveTransport, liveTempo, bar, at);
  liveTransport.start(at, `${barToTicks(bar)}i`);
  heading = { bar, at };
  pendingStart = at;
}

/** When the Transport is due to start, if it hasn't yet (a count-in is running); else null. */
export function transportStartsAt(): number | null {
  return pendingStart !== null && Tone.immediate() < pendingStart ? pendingStart : null;
}

/** Cancel a start that's still to come (see pendingStart). True if there was one. */
function cancelPendingStart(): boolean {
  const at = transportStartsAt();
  pendingStart = null;
  if (at === null) return false;
  // Stopping before the scheduled start removes it: the Transport never gets going
  liveTransport.stop(Tone.immediate());
  return true;
}

export function pauseTransport(): void {
  heading = null;
  if (cancelPendingStart()) return;
  liveTransport.pause();
}

export function stopTransport(): void {
  heading = null;
  if (cancelPendingStart()) return;
  liveTransport.stop();
}

export function seekTransport(bar: number): void {
  const playing = liveTransport.state === 'started';
  liveTransport.ticks = barToTicks(bar);
  const pending = transportStartsAt();
  // During a count-in the start that's coming moves to the new bar (Tone keeps its time)
  if (pending !== null) heading = { bar, at: pending };
  // Playing, Tone moves there at its look-ahead, on the next tick
  else if (playing) heading = { bar, at: Tone.now() + liveTransport.toSeconds('1i') };
  applyTempoAt(liveTransport, liveTempo, bar, heading && (pending !== null || playing) ? heading.at : Tone.now());
}

/** Format as Premiere-style Bar.Beat.Tick ("001.01.00"); ticks shown as hundredths of a beat. */
export function formatBarsBeats(bar: number): string {
  // Counted in the song's meter: measure, beat (a quarter in 4/4, an eighth in 6/8), hundredths
  const { measure, beat, hundredths } = toMeasureBeat(bar, songMeter);
  return `${String(measure).padStart(3, '0')}.${String(beat).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/** Seconds from the start of bar 1 to `bar`, at a steady tempo or along a tempo map. */
export function barToSeconds(bar: number, tempo: Tempo): number {
  return mapBarToSeconds(bar, tempo);
}

export function secondsToBar(seconds: number, tempo: Tempo): number {
  return mapSecondsToBar(seconds, tempo);
}

/**
 * Format as SMPTE timecode HH:MM:SS:FF at `fps`, along the tempo. Drop-frame (29.97 only)
 * is written HH:MM:SS;FF.
 */
export function formatSmpte(bar: number, tempo: Tempo, fps: number, dropFrame = false): string {
  return formatFrameTimecode(secondsToFrames(barToSeconds(bar, tempo), fps), fps, dropFrame);
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
  if (bar < 1) return null;
  // Counted in the song's meter, so a typed position means what the ruler shows
  return fromMeasureBeat(bar, beat, hundredths, songMeter);
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
