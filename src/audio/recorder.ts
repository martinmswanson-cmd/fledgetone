import type { Tempo } from './tempoMap';
import { liveMix } from './engine';
import { ticksToBar } from './transport';
import type { MidiMessage } from './midi';
import { midiNoteName } from './midi';
import { createTake } from '../store/recording';
import type { FinishOptions, Take, TakeClip } from '../store/recording';

/**
 * The take being recorded, if any: the live side of src/store/recording.ts. The store starts
 * and ends takes with the Transport; the live input hands over what's played, with the audio
 * time at which the listener heard it (see heardTime in latency.ts). Each note's song position
 * is the live Transport's position at that time, so notes land where they were heard against the
 * music, loop passes included.
 */
interface ActiveTake {
  trackId: string;
  take: Take;
  /** Audio time the Transport starts (notes heard before it, during a count-in, aren't kept). */
  startAudio: number;
  stopListening: () => void;
}

let active: ActiveTake | null = null;

/** The live Transport (the global one is swapped out while a WAV export sets up). */
const transport = () => liveMix.bus.context.transport;

/** Song position (1-based bar) the live Transport was at, at `audioTime`. */
export function transportBarAt(audioTime: number): number {
  return ticksToBar(transport().getTicksAtTime(audioTime));
}

/**
 * Start a take on `trackId` from `startBar`, where the Transport starts (or is) at `startAudio`.
 * `loop` says what the loop region is whenever the Transport comes round it, so the take's clip
 * covers the whole loop once a pass has.
 */
export function beginTake(trackId: string, startBar: number, startAudio: number, loop: () => { inBar: number; outBar: number }): void {
  discardTake();
  const take = createTake(startBar);
  const onLoop = () => {
    const { inBar, outBar } = loop();
    take.cover(inBar, outBar);
  };
  transport().on('loop', onLoop);
  active = { trackId, take, startAudio, stopListening: () => transport().off('loop', onLoop) };
}

/** What's being recorded, for the lane's recording marker; null between takes. */
export function activeTake(): { trackId: string; startBar: number; notes: number } | null {
  return active ? { trackId: active.trackId, startBar: active.take.startBar, notes: active.take.count() } : null;
}

/** A message played at `heard` (audio time the listener heard it) goes into the take, if one is running. */
export function recordMidi(message: MidiMessage, heard: number): void {
  if (!active) return;
  const { take, startAudio } = active;
  switch (message.kind) {
    case 'noteOn':
      // Played during the count-in: before the music, so nowhere to put it
      if (heard < startAudio) return;
      take.noteOn(message.note, message.name ?? midiNoteName(message.note), message.velocity, transportBarAt(heard), heard);
      break;
    case 'noteOff':
      take.noteOff(message.note, Math.max(heard, startAudio));
      break;
    case 'sustain':
      take.sustain(message.down, Math.max(heard, startAudio));
      break;
    case 'pitchBend':
      if (heard >= startAudio) take.control('bend', message.cents / 100, transportBarAt(heard));
      break;
    case 'mod':
      if (heard >= startAudio) take.control('mod', message.value, transportBarAt(heard));
      break;
    case 'allNotesOff':
      break;
  }
}

/**
 * End the take at `heard` (the audio time the listener was hearing when they stopped): notes
 * still held end there, and the clip runs to the bar there. Stopped during the count-in, the
 * take ends where it would have started. Returns the clip to add to its track, or null if
 * nothing was played (see Take.finish for the options: a take per loop pass, a punch range).
 */
export function finishTake(heard: number, tempo: Tempo, options?: FinishOptions): { trackId: string; clip: TakeClip } | null {
  if (!active) return null;
  const { trackId, take, startAudio, stopListening } = active;
  active = null;
  stopListening();
  const seconds = Math.max(heard, startAudio);
  const bar = heard < startAudio ? take.startBar : transportBarAt(heard);
  const clip = take.finish(bar, seconds, tempo, options);
  return clip ? { trackId, clip } : null;
}

/** Forget the take in progress (a project is being replaced). */
export function discardTake(): void {
  active?.stopListening();
  active = null;
}
