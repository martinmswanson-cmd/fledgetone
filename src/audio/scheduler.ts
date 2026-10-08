import * as Tone from 'tone';
import { barToTicks } from './transport';
import { DRUM_NOTES, safely } from './instruments';
import type { PlayableNote, TrackInstrument } from './instruments';
import { getLiveInstrument, pumpOnKick, releaseAllLiveVoices } from './liveTracks';
import { releaseAuditionSamplers } from './samplers/samplerManager';
import type { Clip, LoopRegion, Track } from '../store/timelineTypes';

export { DRUM_NOTES } from './instruments';

/** Notes of one clip that start together with the same length (one chord / drum hit). */
interface NoteGroup {
  trackId: string;
  notes: PlayableNote[];
}

/** A clip's note groups by absolute tick, worked out once per version of the clip. */
interface ClipEntry {
  clip: Clip;
  groups: Array<[tick: number, group: NoteGroup]>;
}

export interface ClipSchedule {
  /** Bring the Transport in line with the timeline. Cheap when little has changed. */
  update: (tracks: Track[], clips: Clip[]) => void;
  dispose: () => void;
}

function groupClipNotes(clip: Clip): ClipEntry['groups'] {
  // Group notes by tick (and length) so chords trigger as one instrument call
  const groups = new Map<string, [number, NoteGroup]>();
  for (const note of clip.notes) {
    // Notes hidden by a trim don't play
    if (note.startOffset < -1e-6 || note.startOffset >= clip.lengthBars - 1e-6) continue;
    const tick = barToTicks(clip.startBar + note.startOffset);
    const key = `${tick}|${note.duration}`;
    const group = groups.get(key);
    if (group) group[1].notes.push(note);
    else groups.set(key, [tick, { trackId: clip.trackId, notes: [note] }]);
  }
  return [...groups.values()];
}

/** Can `prev`'s note groups be reused for `next`? (Selecting or renaming a clip doesn't move its notes.) */
const sameNotes = (prev: Clip, next: Clip) =>
  prev.notes === next.notes && prev.startBar === next.startBar && prev.lengthBars === next.lengthBars && prev.trackId === next.trackId;

/**
 * Play the timeline's clips on `transport`, which picks up loop passes and swing. Each note
 * group goes to its track's instrument, looked up when it plays (`instrumentFor` returns
 * undefined for a track that shouldn't sound). `onKick` hears of every kick drum note (C1) at
 * the time it plays, whether or not that track sounds, for the Pump inserts to follow.
 *
 * There is one Transport event per tick that has notes, shared by every clip and track, and
 * it reads that tick's notes from a lookup table when it fires. An edit rebuilds the table
 * (reusing every unchanged clip's groups) and only adds or clears events for ticks that
 * gained their first note or lost their last. Tone's Transport.clear() is linear in the number
 * of events, so the old way, re-creating one event per note on every edit, took seconds on
 * big songs and stalled playback.
 */
export function createClipSchedule(
  transport: ReturnType<typeof Tone.getTransport>,
  instrumentFor: (trackId: string) => TrackInstrument | undefined,
  onKick?: (trackId: string, time: number) => void
): ClipSchedule {
  let byTick = new Map<number, NoteGroup[]>();
  let entries = new Map<string, ClipEntry>();
  const events = new Map<number, number>();

  const fire = (tick: number) => {
    // Tone's TickSource can hand the Transport the same tick twice when it lands exactly on
    // the boundary between two clock updates (floating-point rounding). The WAV export steps
    // its clock in 128-sample blocks, so at 140 BPM that's the downbeat of every 8th bar:
    // those notes played twice (flammed kicks, +6 dB samples). A repeat at the same time is
    // skipped; a loop pass comes back at a later time and plays as normal.
    let lastTime = -Infinity;
    return (time: number) => {
      if (Math.abs(time - lastTime) < 1e-4) return;
      lastTime = time;
      const groups = byTick.get(tick);
      if (!groups) return;
      for (const { trackId, notes } of groups) {
        const instrument = instrumentFor(trackId);
        if (instrument) safely(() => instrument.play(notes, time));
      }

      if (!onKick) return;
      for (const group of groups) {
        if (group.notes.some((n) => n.note === DRUM_NOTES.kick)) onKick(group.trackId, time);
      }
    };
  };

  return {
    update: (tracks, clips) => {
      const trackIds = new Set(tracks.map((t) => t.id));
      const nextEntries = new Map<string, ClipEntry>();
      const nextByTick = new Map<number, NoteGroup[]>();
      for (const clip of clips) {
        if (!trackIds.has(clip.trackId)) continue;
        const prev = entries.get(clip.id);
        const entry = prev && sameNotes(prev.clip, clip) ? prev : { clip, groups: groupClipNotes(clip) };
        nextEntries.set(clip.id, entry);
        for (const [tick, group] of entry.groups) {
          const list = nextByTick.get(tick);
          if (list) list.push(group);
          else nextByTick.set(tick, [group]);
        }
      }
      entries = nextEntries;
      byTick = nextByTick;

      for (const [tick, id] of events) {
        if (byTick.has(tick)) continue;
        transport.clear(id);
        events.delete(tick);
      }
      for (const tick of byTick.keys()) {
        if (!events.has(tick)) events.set(tick, transport.schedule(fire(tick), `${tick}i`));
      }
    },
    dispose: () => {
      events.forEach((id) => transport.clear(id));
      events.clear();
      byTick.clear();
      entries.clear();
    },
  };
}

let liveSchedule: ClipSchedule | null = null;

/** Bring the live Transport's events in line with the timeline clips. */
export function rescheduleClips(tracks: Track[], clips: Clip[]): void {
  liveSchedule ??= createClipSchedule(Tone.getTransport(), getLiveInstrument, pumpOnKick);
  liveSchedule.update(tracks, clips);
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
