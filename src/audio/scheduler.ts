import * as Tone from 'tone';
import { barToTicks } from './transport';
import { safely } from './instruments';
import type { TrackInstrument } from './instruments';
import { getLiveInstrument, releaseAllLiveVoices } from './liveTracks';
import { releaseAuditionSamplers } from './samplers/samplerManager';
import type { Clip, LoopRegion, NoteEvent, Track } from '../store/timelineTypes';

export { DRUM_NOTES } from './instruments';

/**
 * Schedule every visible note of every clip on `transport` at absolute ticks, so events
 * re-fire on each loop pass and pick up the Transport's swing. Notes hidden by a trim are
 * skipped. Each note group is handed to its track's instrument, looked up when it plays.
 * Returns the event ids.
 */
export function scheduleClips(
  transport: ReturnType<typeof Tone.getTransport>,
  tracks: Track[],
  clips: Clip[],
  instrumentFor: (trackId: string) => TrackInstrument | undefined
): number[] {
  const ids: number[] = [];
  const trackIds = new Set(tracks.map((t) => t.id));

  for (const clip of clips) {
    if (!trackIds.has(clip.trackId)) continue;

    // Group notes by tick (and length) so chords trigger as one PolySynth / Sampler call
    const groups = new Map<string, { tick: number; notes: NoteEvent[] }>();
    for (const note of clip.notes) {
      if (note.startOffset < -1e-6 || note.startOffset >= clip.lengthBars - 1e-6) continue;
      const tick = barToTicks(clip.startBar + note.startOffset);
      const key = `${tick}|${note.duration}`;
      const group = groups.get(key);
      if (group) group.notes.push(note);
      else groups.set(key, { tick, notes: [note] });
    }

    const trackId = clip.trackId;
    groups.forEach(({ tick, notes }) => {
      ids.push(
        transport.schedule((time) => {
          const instrument = instrumentFor(trackId);
          if (instrument) safely(() => instrument.play(notes, time));
        }, `${tick}i`)
      );
    });
  }
  return ids;
}

let scheduledIds: number[] = [];

/** Rebuild every live Transport event from the timeline clips. */
export function rescheduleClips(tracks: Track[], clips: Clip[]): void {
  scheduledIds.forEach((id) => Tone.Transport.clear(id));
  scheduledIds = scheduleClips(Tone.getTransport(), tracks, clips, getLiveInstrument);
}

/** Apply loop region, tempo and swing to Tone.Transport. */
export function syncTransport(loop: LoopRegion, bpm: number, swing: number): void {
  Tone.Transport.loopStart = `${barToTicks(loop.inBar)}i`;
  Tone.Transport.loopEnd = `${barToTicks(loop.outBar)}i`;
  Tone.Transport.loop = loop.enabled;
  Tone.Transport.bpm.value = bpm;
  Tone.Transport.swing = swing;
  Tone.Transport.swingSubdivision = '16n';
}

/** Release sustained voices (tracks and deck) so nothing hangs after Stop. */
export function releaseAllVoices(): void {
  releaseAllLiveVoices();
  releaseAuditionSamplers();
}
