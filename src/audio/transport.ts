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
  const totalBeats = Math.max(0, (bar - 1) * 4);
  const barNum = Math.floor(totalBeats / 4) + 1;
  const beatNum = Math.floor(totalBeats % 4) + 1;
  const hundredths = Math.floor((totalBeats % 1) * 100);
  return `${String(barNum).padStart(3, '0')}.${String(beatNum).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/** Format as SMPTE timecode HH:MM:SS:FF at 30 fps, assuming constant tempo. */
export function formatSmpte(bar: number, bpm: number, fps = 30): string {
  const seconds = Math.max(0, ((bar - 1) * 4 * 60) / bpm);
  const totalFrames = Math.floor(seconds * fps);
  const ff = totalFrames % fps;
  const ss = Math.floor(totalFrames / fps) % 60;
  const mm = Math.floor(totalFrames / (fps * 60)) % 60;
  const hh = Math.floor(totalFrames / (fps * 3600));
  return [hh, mm, ss, ff].map((v) => String(v).padStart(2, '0')).join(':');
}
