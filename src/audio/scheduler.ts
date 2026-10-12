import * as Tone from 'tone';
import { liveTransport } from './liveContext';
import { applyTempoAt, barToTicks, getLiveTempo, scheduleTempo, setLiveTempo, swingDelay, swungNotes, ticksToBar } from './transport';
import type { Tempo } from './transport';
import { DRUM_NOTES, safely } from './instruments';
import type { PlayableNote, TrackInstrument } from './instruments';
import { getLiveClipBus, onClipBusRebuilt, getLiveInstrument, pumpOnKick, pumpOnTrack, releaseAllLiveVoices } from './liveTracks';
import { releaseAuditionSamplers } from './samplers/samplerManager';
import { liveMix } from './engine';
import { createAudioClipSchedule } from './audioClipSchedule';
import type { AudioClipSchedule } from './audioClipSchedule';
import type { Clip, LoopRegion, Track, TrackFx } from '../store/timelineTypes';
import { INSTRUMENTS } from './instrumentCatalog';
import { detuned, hashSeed, noteDrift } from './human';
import { pitchCents, pitchEvents, sustainNotes, type PitchEvent } from '../store/expression';

export { DRUM_NOTES } from './instruments';

/** Notes of one clip that start together with the same length (one chord / drum hit). */
interface NoteGroup {
  trackId: string;
  notes: PlayableNote[];
  /** A pitch bend / vibrato event of the clip's expression lanes instead of notes (see expression.ts) */
  pitch?: PitchEvent;
  /** Each note's Human seed (see human.ts), in step with `notes` */
  seeds: number[];
  /** Swing plays it late (see swungNotes). */
  swung: boolean;
}

/** A track's Human settings while they're on, and whether its notes can be detuned. */
interface HumanFeel {
  human: TrackFx['human'];
  pitched: boolean;
  /** Notes that start together stay together (one drift for the group) */
  together: boolean;
}

/**
 * Instruments whose notes are pitches. Drum kits, the FX hits and the slicer read a note name as
 * "which sound", so Human leaves their pitch alone (their timing and dynamics still drift).
 */
const PITCHED_KINDS = new Set(['synth', 'sampled', 'custom']);
/**
 * Instruments that play a group of notes as one thing: the one-note-at-a-time basses and leads
 * (the loudest note of a chord wins, and overlapping 808 notes slide) and the drum kits (an open
 * hat chokes the closed one). Pulling their notes apart would change what plays.
 */
const TOGETHER_KEYS = new Set(['bass', 'subBass', 'bass808', 'lead', 'wobbleBass', 'growlBass', 'reeseBass']);

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
  // Notes hidden by a trim don't play; the sustain pedal holds the ones let go while it's down
  const notes = sustainNotes(
    clip.notes.filter((note) => note.startOffset >= -1e-6 && note.startOffset < clip.lengthBars - 1e-6),
    clip.expression?.sustain,
    clip.lengthBars
  );
  const ticks = notes.map((note) => barToTicks(clip.startBar + note.startOffset));
  const swung = swungNotes(ticks, barToTicks(clip.startBar), liveTransport.PPQ);
  // Group notes by tick (and length) so chords trigger as one instrument call
  const groups = new Map<string, [number, NoteGroup]>();
  notes.forEach((note, i) => {
    const tick = ticks[i];
    const key = `${tick}|${note.duration}`;
    // The clip's wobble rate travels with each note to the instrument (the ones that wobble use it)
    const playable: PlayableNote = clip.wobble ? { ...note, wobble: clip.wobble } : note;
    const seed = hashSeed(`${clip.id}|${note.id}|${tick}`);
    const group = groups.get(key);
    if (group) {
      group[1].notes.push(playable);
      group[1].seeds.push(seed);
    } else groups.set(key, [tick, { trackId: clip.trackId, notes: [playable], seeds: [seed], swung: swung[i] }]);
  });
  // Pitch bend and vibrato, as events of their own (played before the notes of the same tick)
  const pitch: ClipEntry['groups'] = pitchEvents(clip).map((ev) => [barToTicks(clip.startBar + ev.at), { trackId: clip.trackId, notes: [], seeds: [], swung: false, pitch: ev }]);
  return [...pitch, ...groups.values()];
}

/** Can `prev`'s note groups be reused for `next`? (Selecting or renaming a clip doesn't move its notes.) */
const sameNotes = (prev: Clip, next: Clip) =>
  prev.notes === next.notes &&
  prev.startBar === next.startBar &&
  prev.lengthBars === next.lengthBars &&
  prev.trackId === next.trackId &&
  prev.wobble === next.wobble &&
  prev.expression === next.expression;

/**
 * Play the timeline's clips on `transport`, which picks up loop passes. Each note group goes to
 * its track's instrument, looked up when it plays (`instrumentFor` returns undefined for a track
 * that shouldn't sound). `onKick` hears of every kick drum note (C1) at the time it plays,
 * whether or not that track sounds, for the Pump inserts to follow. `swing` is read as each
 * tick plays and delays the notes swungNotes picks out; the Transport's own swing stays off.
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
  onKick?: (trackId: string, time: number) => void,
  swing: () => number = () => 0,
  /** Every note group of every track as it plays (Pumps that follow a track) */
  onNotes?: (trackId: string, time: number) => void
): ClipSchedule {
  let byTick = new Map<number, NoteGroup[]>();
  let entries = new Map<string, ClipEntry>();
  let feel = new Map<string, HumanFeel>();
  const events = new Map<number, number>();

  /**
   * Play one group, each note drifting on its own when the track's Human insert is on (a chord's
   * notes then land a hair apart, as fingers do).
   */
  const playGroup = (instrument: TrackInstrument, group: NoteGroup, time: number) => {
    const f = feel.get(group.trackId);
    if (!f) {
      instrument.play(group.notes, time);
      return;
    }
    const drifted = (n: PlayableNote, seed: number) => {
      const drift = noteDrift(seed, f.human);
      const note = f.pitched ? detuned(n.note, drift.cents, (name) => Tone.Frequency(name).toFrequency()) : n.note;
      return { note: { ...n, note, velocity: Math.max(0.05, Math.min(1, n.velocity * drift.gain)) }, late: drift.late };
    };
    if (f.together) {
      const first = drifted(group.notes[0], group.seeds[0]);
      const gain = first.note.velocity / group.notes[0].velocity;
      const notes = group.notes.map((n, i) => (i === 0 ? first.note : { ...drifted(n, group.seeds[0]).note, velocity: Math.max(0.05, Math.min(1, n.velocity * gain)) }));
      instrument.play(notes, time + first.late);
      return;
    }
    group.notes.forEach((n, i) => {
      const d = drifted(n, group.seeds[i]);
      instrument.play([d.note], time + d.late);
    });
  };

  const fire = (tick: number) => {
    // Tone's TickSource can hand the Transport the same tick twice when it lands exactly on
    // the boundary between two clock updates (floating-point rounding). The WAV export steps
    // its clock in 128-sample blocks, so at 140 BPM that's the downbeat of every 8th bar:
    // those notes played twice (flammed kicks, +6 dB samples). A repeat at the same time is
    // skipped; a loop pass comes back at a later time and plays as normal.
    let lastTime = -Infinity;
    return (tickTime: number) => {
      if (Math.abs(tickTime - lastTime) < 1e-4) return;
      lastTime = tickTime;
      const groups = byTick.get(tick);
      if (!groups) return;
      const late = swingDelay(swing(), transport.bpm.value, transport.PPQ);
      // Bends first, so notes starting on the same tick start bent; a clip's end before the
      // next clip's start, so the next clip's bend wins
      for (const ends of [true, false]) {
        for (const { trackId, pitch } of groups) {
          if (!pitch || !!pitch.end !== ends) continue;
          const instrument = instrumentFor(trackId);
          if (instrument?.bend) safely(() => instrument.bend!(pitchCents(pitch, tickTime), tickTime));
        }
      }
      for (const { trackId, notes, seeds, swung, pitch } of groups) {
        if (pitch) continue;
        const time = swung ? tickTime + late : tickTime;
        const instrument = instrumentFor(trackId);
        if (instrument) safely(() => playGroup(instrument, { trackId, notes, seeds, swung }, time));
      }

      if (onNotes) for (const group of groups) if (!group.pitch) onNotes(group.trackId, group.swung ? tickTime + late : tickTime);
      if (!onKick) return;
      for (const group of groups) {
        if (group.notes.some((n) => n.note === DRUM_NOTES.kick)) onKick(group.trackId, group.swung ? tickTime + late : tickTime);
      }
    };
  };

  return {
    update: (tracks, clips) => {
      const trackIds = new Set(tracks.map((t) => t.id));
      feel = new Map();
      for (const t of tracks) {
        if (!t.fx.human.on) continue;
        const kind = INSTRUMENTS[t.instrumentKey]?.kind;
        feel.set(t.id, { human: t.fx.human, pitched: PITCHED_KINDS.has(kind), together: kind !== 'sampled' && kind !== 'custom' && (kind !== 'synth' || TOGETHER_KEYS.has(t.instrumentKey)) });
      }
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
let liveAudioClips: AudioClipSchedule | null = null;
let liveSwing = 0;

/** Bring the live Transport's events in line with the timeline clips. */
export function rescheduleClips(tracks: Track[], clips: Clip[]): void {
  liveSchedule ??= createClipSchedule(Tone.getTransport(), getLiveInstrument, pumpOnKick, () => liveSwing, pumpOnTrack);
  liveSchedule.update(tracks, clips);
  // Audio clips play their sound files on the live mix's own Transport (the global one is the
  // export's while a WAV render sets up)
  liveAudioClips ??= createAudioClipSchedule(liveMix.bus.context.transport, getLiveClipBus, getLiveTempo);
  liveAudioClips.update(tracks, clips);
}

// An Audio track rebuilt while playing (its plugin effects changed) carries on on its new bus
onClipBusRebuilt((trackId) => liveAudioClips?.restartTrack(trackId));

let tempoEvents: number[] = [];

/**
 * Apply loop region and tempo (a steady one or a map) to liveTransport, and swing to the clips
 * played on it. The tempo map plays as Transport events at each change and at the loop's In
 * point (where a loop jumps back to), and the tempo is set now for wherever the Transport is.
 */
export function syncTransport(loop: LoopRegion, tempo: Tempo, swing: number): void {
  liveTransport.loopStart = `${barToTicks(loop.inBar)}i`;
  liveTransport.loopEnd = `${barToTicks(loop.outBar)}i`;
  liveTransport.loop = loop.enabled;
  for (const id of tempoEvents) liveTransport.clear(id);
  tempoEvents = scheduleTempo(liveTransport, tempo, loop.enabled ? loop.inBar : null);
  setLiveTempo(tempo);
  const now = Tone.now();
  applyTempoAt(liveTransport, tempo, ticksToBar(liveTransport.getTicksAtTime(now)), now);
  liveSwing = swing;
}

/** Release sustained voices (tracks and deck) so nothing hangs after Stop. */
export function releaseAllVoices(): void {
  releaseAllLiveVoices();
  releaseAuditionSamplers();
}
