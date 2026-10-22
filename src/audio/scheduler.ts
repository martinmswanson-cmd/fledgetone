/**
 * Note clips to Transport events. createClipSchedule plays every note clip on a Transport (one
 * event per tick that has notes, shared by all clips and tracks, updated incrementally as clips
 * change), live and in exports; each note group goes to its track's instrument, looked up when it
 * plays. Also applies the loop region, tempo and swing to the live Transport (syncTransport).
 */
import { isDropTrack } from '../store/dropMoves';
import * as Tone from 'tone';
import { liveContext, liveTransport } from './liveContext';
import { applyTempoAt, barToTicks, getLiveTempo, scheduleTempo, setLiveTempo, swingDelay, swungNotes, ticksToBar } from './transport';
import type { Tempo } from './transport';
import { DRUM_NOTES, safely } from './instruments';
import type { PlayableNote, TrackInstrument } from './instruments';
import { getLiveClipBus, onClipBusRebuilt, pumpOnKick, pumpOnTrack, releaseAllLiveVoices, scheduledInstrument, trackActivity } from './liveTracks';
import { releaseAuditionSamplers } from './samplers/samplerManager';
import { liveMix } from './engine';
import { createAudioClipSchedule } from './audioClipSchedule';
import type { AudioClipSchedule } from './audioClipSchedule';
import type { Clip, ClipGroove, DrumHit, LoopRegion, NoteEvent, Track, TrackFx } from '../store/timelineTypes';
import { clipHasConditions, clipRuns, isConditional, notePlays, passOf, type ClipRun } from '../store/noteChance';
import { INSTRUMENTS } from './instrumentCatalog';
import { detuned, noteDrift, noteSeed } from './human';
import { exprValueAt, laneCc, lanesOf, pitchCents, pitchEvents, sustainNotes, type PitchEvent } from '../store/expression';
import { isExpressive, noteSteps } from '../store/noteExpression';
import { durationToBars } from '../store/timelineTypes';
import { feelVelocity } from '../store/drumGroove';

export { DRUM_NOTES } from './instruments';

/** Notes of one clip that start together with the same length (one chord / drum hit). */
interface NoteGroup {
  trackId: string;
  notes: PlayableNote[];
  /** A pitch bend / vibrato event of the clip's expression lanes instead of notes (see expression.ts) */
  pitch?: PitchEvent;
  /** A controller lane's value instead of notes (plugins get it as MIDI) */
  cc?: { cc: number; value: number };
  /** Each note's Human seed (see human.ts), in step with `notes` */
  seeds: number[];
  /** Swing plays it late (see swungNotes). */
  swung: boolean;
  /** The clip's own swing, in place of the song's */
  groove?: ClipGroove;
  /** Its row's own swing, in place of the clip's and the song's (see drumGroove.ts) */
  rowSwing?: { swing: number; grid: 8 | 16 };
  /** Its row plays early (negative) or late by this share of a 16th */
  shift?: number;
  /**
   * Notes that play only some of the time (see noteChance.ts): each note's chance and condition,
   * in step with `notes` (absent when every note always plays), and its clip, for the pass
   */
  conds?: Array<Pick<NoteEvent, 'chance' | 'cond'> | null>;
  clipId?: string;
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

/** How often a note's own bend and pressure are sent while they move (seconds). */
const NOTE_STEP_SECONDS = 0.004;

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
  const groove = clip.groove && clip.groove.swing > 0 ? clip.groove : undefined;
  const clipStart = barToTicks(clip.startBar);
  const swung = clip.groove && !groove ? ticks.map(() => false) : swungNotes(ticks, clipStart, liveTransport.PPQ, groove?.grid ?? 16);
  // Rows with a swing of their own swing by their own notes (a roll on the hats keeps only the hats' 8th straight)
  const rows = clip.groove?.rows;
  const rowSwing = new Map<string, { swing: number; grid: 8 | 16 }>();
  if (rows) {
    for (const [row, feel] of Object.entries(rows)) {
      if (feel.swing === undefined) continue;
      const own = { swing: feel.swing, grid: feel.grid ?? clip.groove?.grid ?? 16 };
      rowSwing.set(row, own);
      const mine = notes.flatMap((n, i) => (n.note === row ? [i] : []));
      const flags = own.swing > 0 ? swungNotes(mine.map((i) => ticks[i]), clipStart, liveTransport.PPQ, own.grid) : mine.map(() => false);
      mine.forEach((i, k) => (swung[i] = flags[k]));
    }
  }
  // Group notes by tick (and length) so chords trigger as one instrument call; a row with a feel
  // of its own plays apart from the rest (its swing and shift move it alone)
  const groups = new Map<string, [number, NoteGroup]>();
  notes.forEach((note, i) => {
    const tick = ticks[i];
    const feel = rows?.[note.note];
    const key = `${tick}|${note.duration}${feel ? `|${note.note}` : ''}`;
    // The clip's wobble rate travels with each note to the instrument (the ones that wobble use it)
    let playable: PlayableNote = clip.wobble ? { ...note, wobble: clip.wobble } : note;
    if (feel && (feel.vel !== undefined || feel.offbeat !== undefined)) playable = { ...playable, velocity: feelVelocity(feel, note.velocity, tick, liveTransport.PPQ) };
    const seed = noteSeed(clip.id, note.note, tick);
    const cond = isConditional(note) ? { chance: note.chance, cond: note.cond } : null;
    const group = groups.get(key);
    if (group) {
      group[1].notes.push(playable);
      group[1].seeds.push(seed);
      if (cond || group[1].conds) (group[1].conds ??= group[1].notes.slice(0, -1).map(() => null)).push(cond);
    } else {
      const own = feel ? rowSwing.get(note.note) : undefined;
      groups.set(key, [tick, { trackId: clip.trackId, notes: [playable], seeds: [seed], swung: swung[i], ...(groove ? { groove } : {}), ...(own ? { rowSwing: own } : {}), ...(feel?.shift ? { shift: feel.shift } : {}), ...(cond ? { conds: [cond], clipId: clip.id } : {}) }]);
    }
  });
  if (clipHasConditions(clip)) for (const [, g] of groups.values()) g.clipId = clip.id;
  // Pitch bend and vibrato, as events of their own (played before the notes of the same tick)
  const pitch: ClipEntry['groups'] = pitchEvents(clip).map((ev) => [barToTicks(clip.startBar + ev.at), { trackId: clip.trackId, notes: [], seeds: [], swung: false, pitch: ev }]);
  // Controller lanes, every 64th where they move (from the clip's start)
  const cc: ClipEntry['groups'] = [];
  for (const lane of lanesOf(clip.expression)) {
    const n = laneCc(lane);
    const points = clip.expression?.[lane];
    if (n === null || !points?.length) continue;
    let last = -1;
    for (let at = 0; at < clip.lengthBars - 1e-9; at += 1 / 64) {
      const value = at <= points[0].at ? points[0].value : exprValueAt(points, at);
      const midi = Math.round(value * 127);
      if (midi === last) continue;
      last = midi;
      cc.push([barToTicks(clip.startBar + at), { trackId: clip.trackId, notes: [], seeds: [], swung: false, cc: { cc: n, value } }]);
    }
  }
  return [...pitch, ...cc, ...groups.values()];
}

/** Can `prev`'s note groups be reused for `next`? (Selecting or renaming a clip doesn't move its notes.) */
const sameNotes = (prev: Clip, next: Clip) =>
  prev.notes === next.notes &&
  prev.startBar === next.startBar &&
  prev.lengthBars === next.lengthBars &&
  prev.trackId === next.trackId &&
  prev.wobble === next.wobble &&
  prev.groove === next.groove &&
  prev.expression === next.expression;

/**
 * Play the timeline's clips on `transport`, which picks up loop passes. Each note group goes to
 * its track's instrument, looked up when it plays (`instrumentFor` returns undefined for a track
 * that shouldn't sound). `onKick` hears of every kick drum note (C1), and every snare (D1) or clap (D#1) as a 'snare', at the time it plays,
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
  onKick?: (trackId: string, time: number, hit: DrumHit) => void,
  swing: () => number = () => 0,
  /** Every note group of every track as it plays (Pumps that follow a track) */
  onNotes?: (trackId: string, time: number) => void,
  /**
   * Everything a track plays (notes, bends, controllers), at `time` for `seconds` (its longest
   * note; 0 for the rest): the live mix wakes a sleeping track's channel for it (see sleep in
   * liveTracks.ts)
   */
  onActivity?: (trackId: string, time: number, seconds: number) => void,
  /**
   * The live loop (null while it's off), for the notes that play on some passes only: each time
   * round the loop counts as a further pass (see noteChance.ts). Exports leave it out: they count
   * a clip's copies only, so a seamless loop file plays the same every time round.
   */
  loopOf?: () => LoopRegion | null
): ClipSchedule {
  let byTick = new Map<number, NoteGroup[]>();
  /** Drop tracks: their notes play on the beat as written (no swing or shift), as an export reads them (dropMoves.ts) */
  let straight = new Set<string>();
  let entries = new Map<string, ClipEntry>();
  let feel = new Map<string, HumanFeel>();
  let runs = new Map<string, ClipRun>();
  const events = new Map<number, number>();
  // Times round the loop since playback started (or the loop moved)
  let wraps = 0;
  let wrapsFor = '';
  /** The live loop, the count starting again when it moves. */
  const currentLoop = () => {
    const loop = loopOf?.() ?? null;
    const at = `${loop?.inBar}|${loop?.outBar}`;
    if (at !== wrapsFor) {
      wrapsFor = at;
      wraps = 0;
    }
    return loop;
  };
  const onLoop = () => {
    currentLoop();
    wraps++;
  };
  const onStart = () => void (wraps = 0);
  if (loopOf) {
    transport.on('loop', onLoop);
    transport.on('start', onStart);
    transport.on('stop', onStart);
  }
  /** The group with only the notes that play this time round (null: none of them). */
  const gate = (group: NoteGroup, tick: number): NoteGroup | null => {
    const conds = group.conds;
    if (!conds) return group;
    const loop = currentLoop();
    // (A loop that has come round but this tick is outside it: the loop was switched off)
    const inLoop = !!loop && tick >= barToTicks(loop.inBar) && tick < barToTicks(loop.outBar);
    const pass = passOf(group.clipId ? runs.get(group.clipId) : undefined, inLoop ? wraps : 0, loop);
    const keep = conds.map((c, i) => !c || notePlays(c, group.seeds[i], pass));
    if (keep.every(Boolean)) return group;
    if (!keep.some(Boolean)) return null;
    return { ...group, notes: group.notes.filter((_, i) => keep[i]), seeds: group.seeds.filter((_, i) => keep[i]) };
  };

  /**
   * Play one group, each note drifting on its own when the track's Human insert is on (a chord's
   * notes then land a hair apart, as fingers do).
   */
  /**
   * One note with its own bend and pressure: on a voice of its own where the instrument has them,
   * else played as usual with the instrument bending as a whole.
   */
  const playExpressive = (instrument: TrackInstrument, note: PlayableNote, time: number) => {
    const spb = 240 / transport.bpm.value;
    const length = durationToBars(note.duration);
    // Every 4 ms where it moves (no coarser than a 64th), so a slide or a dive glides rather than steps
    const steps = noteSteps(note.expr!, length, Math.min(1 / 64, NOTE_STEP_SECONDS / spb));
    const voice = instrument.noteVoice?.(note, time);
    if (voice) {
      for (const st of steps) {
        voice.bend(st.cents, time + st.at * spb);
        voice.pressure(st.pressure, time + st.at * spb);
      }
      voice.off(time + length * spb);
      return;
    }
    // (Bent from its start, a dive: the bend goes first, so the note starts on it)
    if (instrument.bend && note.expr?.bend?.length && steps[0]?.cents) instrument.bend(steps[0].cents, time);
    instrument.play([note], time);
    if (!instrument.bend || !note.expr?.bend?.length) return;
    for (const st of steps) instrument.bend(st.cents, time + st.at * spb);
    instrument.bend(0, time + length * spb);
  };
  /** Play notes at `time`, the expressive ones each on its own. */
  const playNotes = (instrument: TrackInstrument, notes: PlayableNote[], time: number) => {
    const plain = notes.filter((n) => !isExpressive(n.expr));
    if (plain.length) instrument.play(plain, time);
    for (const n of notes) if (isExpressive(n.expr)) playExpressive(instrument, n, time);
  };

  const playGroup = (instrument: TrackInstrument, group: NoteGroup, time: number) => {
    const f = feel.get(group.trackId);
    if (!f) {
      playNotes(instrument, group.notes, time);
      return;
    }
    const drifted = (n: PlayableNote, seed: number) => {
      const drift = noteDrift(seed, f.human);
      const note = f.pitched ? detuned(n.note, drift.cents, (name) => Tone.Frequency(name).toFrequency()) : n.note;
      return { note: { ...n, note, velocity: Math.max(0.05, Math.min(1, n.velocity * drift.gain)) }, late: drift.late };
    };
    if (f.together) {
      const first = drifted(group.notes[0], group.seeds[0]);
      // (A silent first note: the others keep their own velocities)
      const gain = group.notes[0].velocity > 0 ? first.note.velocity / group.notes[0].velocity : 1;
      const notes = group.notes.map((n, i) => (i === 0 ? first.note : { ...drifted(n, group.seeds[0]).note, velocity: Math.max(0.05, Math.min(1, n.velocity * gain)) }));
      playNotes(instrument, notes, time + first.late);
      return;
    }
    group.notes.forEach((n, i) => {
      const d = drifted(n, group.seeds[i]);
      playNotes(instrument, [d.note], time + d.late);
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
      const all = byTick.get(tick);
      if (!all) return;
      // Notes that sit this pass out don't play, wake their track or pump anything
      const groups = all.some((g) => g.conds) ? all.map((g) => gate(g, tick)).filter((g): g is NoteGroup => !!g) : all;
      const songLate = swingDelay(swing(), transport.bpm.value, transport.PPQ);
      const bpm = transport.bpm.value;
      const swingOf = (g: NoteGroup) => (!g.swung ? 0 : g.rowSwing ? swingDelay(g.rowSwing.swing, bpm, transport.PPQ, g.rowSwing.grid) : g.groove ? swingDelay(g.groove.swing, bpm, transport.PPQ, g.groove.grid) : songLate);
      const lateOf = (g: NoteGroup) => (straight.has(g.trackId) ? 0 : swingOf(g) + (g.shift ? (g.shift * 15) / bpm : 0));
      // Bends first, so notes starting on the same tick start bent; a clip's end before the
      // next clip's start, so the next clip's bend wins
      for (const ends of [true, false]) {
        for (const { trackId, pitch } of groups) {
          if (!pitch || !!pitch.end !== ends) continue;
          const instrument = instrumentFor(trackId);
          // Bend and vibrato; the mod wheel is dynamics (handed back to velocity at the clip's end)
          if (pitch.pitch && instrument?.bend) safely(() => instrument.bend!(pitchCents(pitch, tickTime), tickTime));
          if (instrument?.dynamics && (pitch.dyn !== undefined || pitch.end)) safely(() => instrument.dynamics!(pitch.end ? null : pitch.dyn!, tickTime));
        }
      }
      for (const { trackId, cc } of groups) {
        if (!cc) continue;
        const instrument = instrumentFor(trackId);
        if (instrument?.cc) safely(() => instrument.cc!(cc.cc, cc.value, tickTime));
      }
      for (const group of groups) {
        const { trackId, notes, seeds, swung, pitch, cc } = group;
        if (pitch || cc) continue;
        const time = tickTime + lateOf(group);
        const instrument = instrumentFor(trackId);
        if (instrument) safely(() => playGroup(instrument, { trackId, notes, seeds, swung }, time));
      }

      if (onActivity) {
        const spb = 240 / transport.bpm.value;
        for (const group of groups) onActivity(group.trackId, tickTime + lateOf(group), group.notes.reduce((most, n) => Math.max(most, durationToBars(n.duration) * spb), 0));
      }
      if (onNotes) for (const group of groups) if (!group.pitch && !group.cc) onNotes(group.trackId, tickTime + lateOf(group));
      if (!onKick) return;
      for (const group of groups) {
        if (group.notes.some((n) => n.note === DRUM_NOTES.kick)) onKick(group.trackId, tickTime + lateOf(group), 'kick');
        if (group.notes.some((n) => n.note === DRUM_NOTES.snare || n.note === DRUM_NOTES.clap)) onKick(group.trackId, tickTime + lateOf(group), 'snare');
      }
    };
  };

  return {
    update: (tracks, clips) => {
      const trackIds = new Set(tracks.map((t) => t.id));
      feel = new Map();
      straight = new Set(tracks.filter(isDropTrack).map((t) => t.id));
      for (const t of tracks) {
        if (!t.fx.human.on || straight.has(t.id)) continue;
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
      runs = clipRuns(clips);

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
      if (loopOf) {
        transport.off('loop', onLoop);
        transport.off('start', onStart);
        transport.off('stop', onStart);
      }
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
let liveLoop: LoopRegion | null = null;

/** Bring the live Transport's events in line with the timeline clips. */
export function rescheduleClips(tracks: Track[], clips: Clip[]): void {
  liveSchedule ??= createClipSchedule(liveTransport, scheduledInstrument, pumpOnKick, () => liveSwing, pumpOnTrack, trackActivity, () => liveLoop);
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
  liveLoop = loop.enabled ? { ...loop } : null;
  for (const id of tempoEvents) liveTransport.clear(id);
  tempoEvents = scheduleTempo(liveTransport, tempo, loop.enabled ? loop.inBar : null);
  setLiveTempo(tempo);
  const now = liveContext.now();
  applyTempoAt(liveTransport, tempo, ticksToBar(liveTransport.getTicksAtTime(now)), now);
  liveSwing = swing;
}

/** Release sustained voices (tracks and deck) so nothing hangs after Stop. */
export function releaseAllVoices(): void {
  releaseAllLiveVoices();
  releaseAuditionSamplers();
}
