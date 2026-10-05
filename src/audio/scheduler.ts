import * as Tone from 'tone';
import { trackChannels } from './engine';
import type { InstrumentKey } from './engine';
import { triggerBass, bassSynth } from './presets/bass';
import { triggerKeys, keysSynth } from './presets/keys';
import { triggerBrass, brassSynth } from './presets/brass';
import { triggerKick, triggerSnare, triggerHat, triggerCowbell } from './presets/drums';
import { barToTicks } from './transport';
import type { Clip, LoopRegion, NoteEvent, Track } from '../store/timelineTypes';

/**
 * Drum note map (GM-style). Drum clips store one note name per voice.
 */
export const DRUM_NOTES = {
  kick: 'C1',
  snare: 'D1',
  closedHat: 'F#1',
  openHat: 'A#1',
  cowbell: 'G#2',
} as const;

/** Trigger functions for one set of instruments (live, or an offline render's copies). */
export interface InstrumentVoices {
  kick: (time: number, velocity: number) => void;
  snare: (time: number, velocity: number) => void;
  hat: (open: boolean, time: number, velocity: number) => void;
  cowbell: (time: number, velocity: number) => void;
  bass: (note: string, duration: string, time: number, velocity: number) => void;
  keys: (notes: string[], duration: string, time: number, velocity: number) => void;
  brass: (notes: string[], duration: string, time: number, velocity: number) => void;
}

const liveVoices: InstrumentVoices = {
  kick: triggerKick,
  snare: triggerSnare,
  hat: triggerHat,
  cowbell: triggerCowbell,
  bass: triggerBass,
  keys: triggerKeys,
  brass: triggerBrass,
};

/**
 * Trigger one voice, skipping just that hit if Tone rejects it. An exception escaping a
 * Transport callback would also cancel the other events due in the same clock tick.
 */
function safely(trigger: () => void): void {
  try {
    trigger();
  } catch (err) {
    console.warn('Skipped a note:', err);
  }
}

function playNotes(voices: InstrumentVoices, instrument: InstrumentKey, notes: NoteEvent[], time: number): void {
  if (notes.length === 0) return;
  const maxVelocity = Math.max(...notes.map((n) => n.velocity));

  switch (instrument) {
    case 'drums': {
      // One hi-hat voice: an open hat on the same tick replaces the closed one
      const openHat = notes.some((n) => n.note === DRUM_NOTES.openHat);
      for (const n of notes) {
        if (n.note === DRUM_NOTES.kick) safely(() => voices.kick(time, n.velocity));
        else if (n.note === DRUM_NOTES.snare) safely(() => voices.snare(time, n.velocity));
        else if (n.note === DRUM_NOTES.closedHat && !openHat) safely(() => voices.hat(false, time, n.velocity));
        else if (n.note === DRUM_NOTES.openHat) safely(() => voices.hat(true, time, n.velocity));
        else if (n.note === DRUM_NOTES.cowbell) safely(() => voices.cowbell(time, n.velocity));
      }
      break;
    }
    case 'bass': {
      // Monophonic: the loudest note at this tick wins
      const n = notes.reduce((a, b) => (b.velocity > a.velocity ? b : a));
      safely(() => voices.bass(n.note, n.duration, time, n.velocity));
      break;
    }
    case 'keys':
      safely(() => voices.keys(notes.map((n) => n.note), notes[0].duration, time, maxVelocity));
      break;
    case 'brass':
      safely(() => voices.brass(notes.map((n) => n.note), notes[0].duration, time, maxVelocity));
      break;
  }
}

/**
 * Schedule every visible note of every clip on `transport` at absolute ticks, so events
 * re-fire on each loop pass and pick up the Transport's swing. Notes hidden by a trim are
 * skipped. Returns the event ids.
 */
export function scheduleClips(
  transport: ReturnType<typeof Tone.getTransport>,
  tracks: Track[],
  clips: Clip[],
  voices: InstrumentVoices
): number[] {
  const ids: number[] = [];
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  for (const clip of clips) {
    const track = trackById.get(clip.trackId);
    if (!track) continue;

    // Group notes by tick (and length) so chords trigger as one PolySynth call (and one brass swell)
    const groups = new Map<string, { tick: number; notes: NoteEvent[] }>();
    for (const note of clip.notes) {
      if (note.startOffset < -1e-6 || note.startOffset >= clip.lengthBars - 1e-6) continue;
      const tick = barToTicks(clip.startBar + note.startOffset);
      const key = `${tick}|${note.duration}`;
      const group = groups.get(key);
      if (group) group.notes.push(note);
      else groups.set(key, { tick, notes: [note] });
    }

    groups.forEach(({ tick, notes }) => {
      const instrument = track.instrumentKey;
      ids.push(transport.schedule((time) => playNotes(voices, instrument, notes, time), `${tick}i`));
    });
  }
  return ids;
}

let scheduledIds: number[] = [];

/** Rebuild every live Transport event from the timeline clips. */
export function rescheduleClips(tracks: Track[], clips: Clip[]): void {
  scheduledIds.forEach((id) => Tone.Transport.clear(id));
  scheduledIds = scheduleClips(Tone.getTransport(), tracks, clips, liveVoices);
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

/** Push track mixer state onto the per-track Tone.Channel strips. */
export function applyTrackMix(tracks: Track[]): void {
  for (const track of tracks) {
    const channel = trackChannels[track.instrumentKey];
    channel.volume.rampTo(track.volume <= -60 ? -Infinity : track.volume, 0.03);
    channel.pan.rampTo(track.pan, 0.03);
    channel.mute = track.isMuted;
    channel.solo = track.isSoloed;
  }
}

/** Play notes right now on the live instruments (piano-roll and drag previews). */
export function previewNotes(instrument: InstrumentKey, notes: Pick<NoteEvent, 'note' | 'duration' | 'velocity'>[]): void {
  playNotes(liveVoices, instrument, notes.map((n, i) => ({ ...n, id: `preview-${i}`, startOffset: 0 })), Tone.now());
}

/** Release sustained voices so nothing hangs after Stop. */
export function releaseAllVoices(): void {
  keysSynth.releaseAll();
  brassSynth.releaseAll();
  bassSynth.triggerRelease();
}
