import * as Tone from 'tone';
import { liveMix } from './engine';
import type { InstrumentKey } from './engine';
import { createTrackStrip } from './effects/trackStrip';
import type { TrackStrip } from './effects/trackStrip';
import { createInstrument, safely } from './instruments';
import type { PlayableNote, TrackInstrument } from './instruments';
import type { Track } from '../store/timelineTypes';

/**
 * Live playback graph: one effects strip + one instrument per timeline track, kept in step
 * with the store by syncLiveTracks(). The scheduler looks instruments up by track id at the
 * moment a note plays, so swapping an instrument never needs a reschedule.
 */
interface LiveTrack {
  instrumentKey: InstrumentKey;
  /** The Sampler's sound + root note, so changing either rebuilds the instrument */
  sampleUrl: string | undefined;
  strip: TrackStrip;
  instrument: TrackInstrument;
}

const live = new Map<string, LiveTrack>();

const sampleKey = (track: Track) => (track.sample ? `${track.sample.root}|${track.sample.dataUrl}` : undefined);

export function syncLiveTracks(tracks: Track[]): void {
  const keep = new Set(tracks.map((t) => t.id));
  for (const [id, lt] of live) {
    if (!keep.has(id)) {
      lt.instrument.dispose();
      lt.strip.dispose();
      live.delete(id);
    }
  }

  for (const track of tracks) {
    let lt = live.get(track.id);
    if (!lt) {
      const strip = createTrackStrip(liveMix.bus, liveMix.busFx);
      lt = {
        instrumentKey: track.instrumentKey,
        sampleUrl: sampleKey(track),
        strip,
        instrument: createInstrument(track.instrumentKey, strip.input, { sample: track.sample }),
      };
      live.set(track.id, lt);
    } else if (lt.instrumentKey !== track.instrumentKey || lt.sampleUrl !== sampleKey(track)) {
      lt.instrument.releaseAll();
      lt.instrument.dispose();
      lt.instrument = createInstrument(track.instrumentKey, lt.strip.input, { sample: track.sample });
      lt.instrumentKey = track.instrumentKey;
      lt.sampleUrl = sampleKey(track);
    }
    lt.strip.apply(track);
  }
}

export function getLiveInstrument(trackId: string): TrackInstrument | undefined {
  return live.get(trackId)?.instrument;
}

/** Release sustained voices so nothing hangs after Stop. */
export function releaseAllLiveVoices(): void {
  for (const lt of live.values()) safely(() => lt.instrument.releaseAll());
}

/** Play notes right now through a track's instrument and effects (piano-roll previews). */
export function previewTrackNotes(trackId: string, notes: PlayableNote[]): void {
  const instrument = getLiveInstrument(trackId);
  if (instrument && notes.length) safely(() => instrument.play(notes, Tone.now()));
}
