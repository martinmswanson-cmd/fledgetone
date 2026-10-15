import { liveMix } from './engine';

/**
 * When the listener hears what the live context renders. The clock (currentTime) says what the
 * graph is rendering now; the sound card plays that an output latency later. A note played in
 * time with the music belongs where the music was heard, so live input and recording work in
 * heard time (see heardTime).
 */

/** The live context's clock: the global context is the export's while a WAV export sets up. */
const liveContext = () => liveMix.bus.context;

/**
 * standardized-audio-context's AudioContext (Tone's rawContext live) doesn't pass on
 * outputLatency or getOutputTimestamp; the browser's own context behind it does.
 */
function nativeContext(): AudioContext {
  const raw = liveContext().rawContext as unknown as { _nativeAudioContext?: AudioContext };
  return raw._nativeAudioContext ?? (raw as unknown as AudioContext);
}

/**
 * How long the live mix holds every track back (seconds): its delay compensation (see
 * delayCompensation.ts), set by liveTracks.ts. The music heard now was scheduled this much earlier.
 */
let mixDelay = 0;
export function setMixDelay(seconds: number): void {
  mixDelay = seconds;
}
export const mixDelaySeconds = (): number => mixDelay;

/** Seconds from a sample leaving the graph to the listener hearing it, as the browser reports it. */
export function outputLatencySeconds(): number {
  const native = nativeContext();
  return (native.baseLatency || 0) + (native.outputLatency || 0);
}

/**
 * The audio time of what the listener was hearing when an input event happened at `eventTime`
 * (performance.now() ms, the event's timeStamp; now by default). The music heard at that moment
 * left the graph an output latency earlier, so a note played in time with it belongs there, not
 * at the clock's current time. Chrome says exactly which sample is playing now
 * (getOutputTimestamp); failing that, the latencies the context reports are taken off the clock.
 */
export function heardTime(eventTime: number = performance.now()): number {
  const now = performance.now();
  // A stale or future timestamp (a synthetic event) counts as now
  const ago = Math.max(0, Math.min(0.5, (now - eventTime) / 1000));
  const native = nativeContext();
  const stamp = typeof native.getOutputTimestamp === 'function' ? native.getOutputTimestamp() : undefined;
  if (stamp && stamp.contextTime !== undefined && stamp.performanceTime !== undefined && stamp.performanceTime > 0 && Math.abs(now - stamp.performanceTime) < 2000) {
    return stamp.contextTime + (now - stamp.performanceTime) / 1000 - ago - mixDelay;
  }
  return liveContext().rawContext.currentTime - ago - outputLatencySeconds() - mixDelay;
}
