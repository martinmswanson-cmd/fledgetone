import * as Tone from 'tone';
import { liveMix } from './engine';
import { LOUDNESS_PROCESSOR, LOUDNESS_WORKLET_SOURCE } from './loudness';
import type { LoudnessReading } from './loudness';
import { createWorkletNode, loadWorklet } from './worklets';
import { useTimelineStore } from '../store/timelineStore';

/**
 * The live loudness meter: an AudioWorklet (loudness.ts) listening to what the speakers get
 * (after the master volume), posting ten readings a second. It exists only while something
 * shows it (subscribeLoudness), so it costs nothing when hidden. The integrated loudness counts
 * from the last Play (or Reset).
 */
type Listener = (reading: LoudnessReading | null) => void;

const listeners = new Set<Listener>();
let node: AudioWorkletNode | null = null;
let starting: Promise<void> | null = null;
let last: LoudnessReading | null = null;
let unwatchPlay: (() => void) | null = null;

/** The live Tone context (a WAV export makes its offline one the global one for a moment). */
const context = () => liveMix.bus.context;
/** Where the meter listens: the master output, master volume included. */
const tap = () => context().destination.output!;

async function start(): Promise<void> {
  await loadWorklet(context(), LOUDNESS_PROCESSOR, LOUDNESS_WORKLET_SOURCE);
  if (listeners.size === 0) return;
  const meter = createWorkletNode(context(), LOUDNESS_PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
  meter.port.onmessage = (e: MessageEvent<LoudnessReading>) => {
    last = e.data;
    listeners.forEach((l) => l(last));
  };
  Tone.connect(tap(), meter);
  node = meter;
  // Integrated loudness is "since play": every Play starts it afresh
  unwatchPlay = useTimelineStore.subscribe((state, prev) => {
    if (state.isPlaying && !prev.isPlaying) resetLoudness();
  });
}

function stop(): void {
  unwatchPlay?.();
  unwatchPlay = null;
  if (node) {
    try {
      Tone.disconnect(tap(), node);
    } catch {
      // Already gone
    }
    node.port.postMessage('dispose');
    node.disconnect();
    node = null;
  }
  last = null;
}

/**
 * Show the meter: `listener` gets each reading (and null when the meter stops). The meter runs
 * while anything subscribes. Returns an unsubscribe function.
 */
export function subscribeLoudness(listener: Listener): () => void {
  listeners.add(listener);
  if (last) listener(last);
  if (!node && !starting) {
    starting = start()
      .catch((err) => console.warn('The loudness meter could not start:', err))
      .finally(() => {
        starting = null;
        if (listeners.size === 0) stop();
      });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && !starting) stop();
  };
}

/** Start the integrated loudness and the true peak hold over. */
export function resetLoudness(): void {
  node?.port.postMessage('reset');
  last = null;
  listeners.forEach((l) => l(null));
}
