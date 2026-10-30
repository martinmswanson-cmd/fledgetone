/**
 * Note clips to Transport events. createClipSchedule plays every note clip on a Transport (one
 * event per tick that has notes, shared by all clips and tracks, updated incrementally as clips
 * change), live and in exports; each note group goes to its track's instrument, looked up when it
 * plays. Also applies the loop region, tempo and swing to the live Transport (syncTransport).
 */
import { isDropTrack } from '../store/dropMoves';
import * as Tone from 'tone';
import { liveContext, liveTransport } from './liveContext';
import { applyTempoAt, barToTicks, getLiveTempo, getSongMeter, scheduleTempo, setLiveTempo, swingDelay, swungNotes, ticksToBar } from './transport';
import type { Tempo } from './transport';
import { safely } from './instruments';
import type { PlayableNote, TrackInstrument } from './instruments';
import { getLiveClipBus, onClipBusRebuilt, onTrackHeardAgain, onVoicesLetGo, pumpOnKick, pumpOnTrack, releaseAllLiveVoices, scheduledInstrument, trackActivity } from './liveTracks';
import { releaseAuditionSamplers } from './samplers/samplerManager';
import { liveMix } from './engine';
import { createAudioClipSchedule } from './audioClipSchedule';
import type { AudioClipSchedule } from './audioClipSchedule';
import type { Clip, ClipGroove, DrumHit, InstrumentKey, LoopRegion, NoteEvent, Track, TrackFx } from '../store/timelineTypes';
import { clipHasConditions, clipRuns, isConditional, notePlays, passOf, type ClipRun } from '../store/noteChance';
import { INSTRUMENTS, pumpHitOf } from './instrumentCatalog';
import { detuned, noteDrift, noteSeed } from './human';
import { pitchCents, pitchEvents, sustainNotes, type PitchEvent } from '../store/expression';
import { isExpressive, noteSteps } from '../store/noteExpression';
import { durationToBars } from '../store/timelineTypes';
import { feelVelocity } from '../store/drumGroove';
import { drumRoleOf, feelNote, feelOf, feelPos, melodicRoleOf, padRoleOf, type GrooveRole } from '../store/grooveFeels';
import { isPlainMeter, type MeterMap } from './tempoMap';
import { padOfNote } from '../store/sampleKits';
import { trackRole } from './mixCheck';
import { pumpKitsOf } from '../store/freeze';
import { clipCcEvents, heldCcAt, type CcEvent } from './ccHold';

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
  /** The part its feel plays it as (see grooveFeels.ts): 'drums' reads each note's row, 'rack:...' each pad's part */
  role?: FeelPart;
  /** The song's meter its feel was placed in (a feel's steps count from each measure's start) */
  meter?: MeterMap;
  groups: Array<[tick: number, group: NoteGroup]>;
  /** Its controller lanes' values, as they're sent (see ccHold.ts) */
  ccs: CcEvent[];
  /** Whether its expression lanes bend (not only the mod wheel's dynamics) */
  bends: boolean;
  /** Whether some of its notes have their own bend */
  noteBends: boolean;
}

/** A note with its own bend on an instrument that bends as a whole (see playExpressive). */
interface BentNote {
  trackId: string;
  instrument: TrackInstrument;
  start: number;
  /** Its end (or where it stopped holding its bend: its instrument's next note after a jump) */
  end: number;
  /** Its bend over its length (audio time, cents) */
  steps: Array<[number, number]>;
  /** Its bends still to send, in time order: cents, or null for the song's bend there */
  queue: Array<[number, number | null]>;
  /** Where the song jumped away while it sounded: its bend stays as it was there */
  cut?: number;
}

/** The part a clip's feel plays it as: one part, each drum row its own, or a Drum Rack's pads' parts (comma-separated, pad by pad). */
type FeelPart = GrooveRole | 'drums' | `rack:${string}`;

export interface ClipSchedule {
  /** Bring the Transport in line with the timeline. Cheap when little has changed. */
  update: (tracks: Track[], clips: Clip[]) => void;
  /** How far before its tick the earliest note pushed early (a feel, or a row's own shift) plays, in 16ths (0: none early) */
  earliest: () => number;
  /**
   * Set each track's controllers to their values at `bar` in a playback of the whole song (the
   * last value any of its clips sent before it, ended or not; at rest where none has: see
   * ccHold.ts), since a lane is sent only where its value changes. The schedule does this itself
   * whenever its Transport starts, moves or loops back; a render calls it too, before it starts,
   * so the plugins are set in time. Each track's bend too, as the song has it there (a note with
   * its own bend still sounding keeps it; else its clips' bend lane there, else centre), so a bend
   * from where the song was doesn't carry on where it plays now.
   */
  hold: (bar: number, time: number) => void;
  /**
   * The same for one track, where its Transport is at `time`, if it's playing: for a track heard
   * again (unmuted, its solo changed) or a plugin that has just loaded, which missed the values
   * sent meanwhile. A note with its own bend still sounding on it keeps that bend.
   */
  holdTrack: (trackId: string, time: number) => void;
  /** Every voice has been let go (Stop, Pause, Free memory): no note played so far sounds on, nor keeps its bend at a hold point. */
  letGo: () => void;
  dispose: () => void;
}

function groupClipNotes(clip: Clip, role?: FeelPart, meter?: MeterMap): ClipEntry['groups'] {
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
  // A measured feel: each note's part moves it and accents it at its step of the bar
  const measured = feelOf(clip.groove?.feel);
  const amount = measured ? clip.groove!.feel!.amount : 0;
  const partOf = (note: string): GrooveRole => {
    const r = clip.groove?.feel?.role ?? role ?? 'lead';
    if (r.startsWith('rack:')) return (r.slice(5).split(',')[padOfNote(note)] as GrooveRole | undefined) || 'perc';
    return r === 'drums' ? drumRoleOf(note) : (r as GrooveRole);
  };
  const sixteenth = liveTransport.PPQ / 4;
  // (In plain 4/4 from the bar line, in ticks; in another meter from the measure's start)
  const posOf = (tick: number) => (!meter || isPlainMeter(meter) ? (tick - barToTicks(Math.floor(ticksToBar(tick) + 1e-9))) / sixteenth : feelPos(ticksToBar(tick), meter));
  // Group notes by tick (and length) so chords trigger as one instrument call; a row with a feel
  // of its own plays apart from the rest (its swing and shift move it alone), as do notes the
  // measured feel moves apart
  const groups = new Map<string, [number, NoteGroup]>();
  notes.forEach((note, i) => {
    const tick = ticks[i];
    const feel = rows?.[note.note];
    // (where the note really begins: a note begun again part way through, by a render, keeps its own place's drift, chance and accent)
    const own = note.heldFrom !== undefined ? barToTicks(note.heldFrom) : tick;
    const fx = amount > 0 ? feelNote(measured, amount, partOf(note.note), posOf(own)) : null;
    const shift = (feel?.shift ?? 0) + (fx?.shift ?? 0);
    const key = `${tick}|${note.duration}${feel ? `|${note.note}` : ''}${fx?.shift ? `|${fx.shift}` : ''}`;
    // The clip's wobble rate travels with each note to the instrument (the ones that wobble use it)
    let playable: PlayableNote = clip.wobble ? { ...note, wobble: clip.wobble } : note;
    if (feel && (feel.vel !== undefined || feel.offbeat !== undefined)) playable = { ...playable, velocity: feelVelocity(feel, note.velocity, own, liveTransport.PPQ) };
    if (fx && fx.vel !== 1) playable = { ...playable, velocity: Math.max(0.05, Math.min(1, playable.velocity * fx.vel)) };
    const seed = noteSeed(clip.id, note.note, own);
    const cond = isConditional(note) ? { chance: note.chance, cond: note.cond } : null;
    const group = groups.get(key);
    if (group) {
      group[1].notes.push(playable);
      group[1].seeds.push(seed);
      if (cond || group[1].conds) (group[1].conds ??= group[1].notes.slice(0, -1).map(() => null)).push(cond);
    } else {
      const own = feel ? rowSwing.get(note.note) : undefined;
      groups.set(key, [tick, { trackId: clip.trackId, notes: [playable], seeds: [seed], swung: swung[i], ...(groove ? { groove } : {}), ...(own ? { rowSwing: own } : {}), ...(shift ? { shift } : {}), ...(cond ? { conds: [cond], clipId: clip.id } : {}) }]);
    }
  });
  if (clipHasConditions(clip)) for (const [, g] of groups.values()) g.clipId = clip.id;
  // Pitch bend and vibrato, as events of their own (played before the notes of the same tick)
  const pitch: ClipEntry['groups'] = pitchEvents(clip).map((ev) => [barToTicks(clip.startBar + ev.at), { trackId: clip.trackId, notes: [], seeds: [], swung: false, pitch: ev }]);
  // Controller lanes, every 64th where they move (from the clip's start)
  const cc: ClipEntry['groups'] = clipCcEvents(clip).map((ev) => [barToTicks(ev.at), { trackId: clip.trackId, notes: [], seeds: [], swung: false, cc: { cc: ev.cc, value: ev.value } }]);
  return [...pitch, ...cc, ...groups.values()];
}

function newEntry(clip: Clip, role: FeelPart | undefined, meter: MeterMap | undefined): ClipEntry {
  const groups = groupClipNotes(clip, role, meter);
  const ccs: CcEvent[] = [];
  let bends = false;
  for (const [tick, g] of groups) {
    if (g.cc) ccs.push({ at: tick, cc: g.cc.cc, value: g.cc.value });
    if (g.pitch?.pitch) bends = true;
  }
  return { clip, role, meter, groups, ccs, bends, noteBends: clip.notes.some((n) => !!n.expr?.bend?.length) };
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

/** The part a clip's measured feel plays it as: each drum row its own (a Drum Rack's pads by their names), else the bass, chords or lead. */
function feelRole(clip: Clip, track: Track | undefined, clips: readonly Clip[], memo: Map<string, string>): FeelPart | undefined {
  if (!clip.groove?.feel || !track) return undefined;
  let r = memo.get(track.id);
  if (r === undefined) {
    r = INSTRUMENTS[track.instrumentKey]?.kind === 'rack' ? `rack:${(track.rack?.pads ?? []).map((p) => (p.soundId ? padRoleOf(p.name) : 'perc')).join(',')}` : trackRole(track, clips);
    memo.set(track.id, r);
  }
  return r === 'drums' || r.startsWith('rack:') ? (r as FeelPart) : melodicRoleOf(r, clip.notes);
}

/**
 * Play the timeline's clips on `transport`, which picks up loop passes. Each note group goes to
 * its track's instrument, looked up when it plays (`instrumentFor` returns undefined for a track
 * that shouldn't sound). `onKick` hears of every kick drum note (C1), and every snare (D1) or clap (D#1) as a 'snare', at the time it plays,
 * on a drum kit whose rows really are those drums (pumpHitOf: not a percussion kit's conga),
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
  loopOf?: () => LoopRegion | null,
  /**
   * The song's meter, for the measured groove feels (their steps count from each measure's start).
   * Live playback reads the studio's (getSongMeter, kept in step with the song by the store); a
   * render passes its song's, so a render with no store (the command line's) plays the same.
   */
  meterOf: () => MeterMap = getSongMeter
): ClipSchedule {
  let byTick = new Map<number, NoteGroup[]>();
  /** Drop tracks: their notes play on the beat as written (no swing or shift), as an export reads them (dropMoves.ts) */
  let straight = new Set<string>();
  let entries = new Map<string, ClipEntry>();
  let feel = new Map<string, HumanFeel>();
  /** The drum kit each drum track plays (for the hits the Pumps hear). */
  let kitOf = new Map<string, InstrumentKey>();
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
  /** The controllers sent to each instrument since it was made: the ones that may be off their rest (see ccHold.ts). */
  const moved = new WeakMap<TrackInstrument, Set<number>>();
  /** The tracks some controller has been sent to. */
  const movedTracks = new Set<string>();
  const sendCc = (trackId: string, instrument: TrackInstrument, cc: number, value: number, time: number) => {
    let sent = moved.get(instrument);
    if (!sent) moved.set(instrument, (sent = new Set()));
    sent.add(cc);
    movedTracks.add(trackId);
    safely(() => instrument.cc!(cc, value, time));
  };
  /** Instruments the schedule has bent off centre (a clip's bend or vibrato, a note's own bend), and their tracks. */
  const bent = new WeakSet<TrackInstrument>();
  const bentTracks = new Set<string>();
  /**
   * Notes played with their own bend on an instrument that bends as a whole (see playExpressive),
   * kept while they may sound. Their bends are sent a moment before each is due (sendDue), in time
   * order with everything else the instrument is sent, as a wheel's would be: the instruments
   * follow a bend from when it's sent, and a jump or Stop leaves none of them to come.
   */
  const bentNotes = new Map<TrackInstrument, BentNote[]>();
  /** The latest time each instrument has been sent a note's bend for (Stop centres it after that). */
  const sentUntil = new Map<TrackInstrument, number>();
  /**
   * Instruments holding a bent note's bend where the song jumped away from it (a move of the
   * playhead, the loop going round), until their next note begins or that note ends: then the
   * song's own bend there.
   */
  const holding = new Map<TrackInstrument, number>();
  /** How often the notes' bends are sent, in ticks (a 256th note), while any are to come */
  const stepTicks = Math.max(1, Math.round(transport.PPQ / 64));
  const stepSeconds = () => (stepTicks * 60) / (transport.bpm.value * transport.PPQ);
  let stepper: number | null = null;
  /** Send a note's bends due before `limit` (a step's cents, or the song's bend there: see jumpAway). */
  const sendNote = (n: BentNote, limit: number) => {
    let i = 0;
    for (; i < n.queue.length && n.queue[i][0] < limit; i++) {
      const [t, c] = n.queue[i];
      if (c === null) holding.delete(n.instrument);
      sendBend(n.trackId, n.instrument, c ?? laneBendAt(n.trackId, Math.round(transport.getTicksAtTime(t)), t), t);
      sentUntil.set(n.instrument, Math.max(sentUntil.get(n.instrument) ?? -Infinity, t));
    }
    if (i) n.queue.splice(0, i);
  };
  const sendDue = (limit: number) => {
    for (const list of bentNotes.values()) for (const n of list) if (n.queue.length) sendNote(n, limit);
  };
  /**
   * The song jumps away at `time` (moved, or round the loop): a note with its own bend begun before
   * and still sounding keeps the bend it has now (none of its bends to come are sent) until its
   * instrument's next note or its own end, where the song's bend there takes over.
   */
  const jumpAway = (time: number) => {
    for (const [instrument, list] of bentNotes) {
      for (const n of list) {
        if (n.start >= time || n.end <= time) continue;
        n.cut ??= time;
        n.queue = [[n.end, null]];
        holding.set(instrument, time);
      }
    }
  };
  /**
   * The song's bend on `instrument` takes over from a held one at `time` (its next note, or a clip's
   * bend lane): the held note is forgotten. Returns when the song's bend is to be sent (not before
   * the held one was: a note on the jump's own tick can come out a hair earlier), or undefined if
   * it held none.
   */
  const endHolding = (instrument: TrackInstrument, time: number): number | undefined => {
    const heldAt = holding.get(instrument);
    if (heldAt === undefined) return undefined;
    holding.delete(instrument);
    for (const n of bentNotes.get(instrument) ?? []) {
      if (n.cut === undefined || n.end <= time) continue;
      n.end = time;
      n.queue = [];
    }
    return Math.max(time, heldAt);
  };
  /** Every note let go (Stop, Pause, Free memory): bends already sent for later go back to centre after the last of them. */
  const forgetNotes = () => {
    for (const [instrument, list] of bentNotes) {
      const until = sentUntil.get(instrument);
      if (until !== undefined && list.length) sendBend(list[0].trackId, instrument, 0, until + 0.001);
    }
    bentNotes.clear();
    sentUntil.clear();
    holding.clear();
  };
  const sendBend = (trackId: string, instrument: TrackInstrument, cents: number, time: number) => {
    if (cents !== 0) {
      bent.add(instrument);
      bentTracks.add(trackId);
    }
    safely(() => instrument.bend!(cents, time));
  };
  /** The bend of the latest-begun note with its own bend still sounding at `time` on `instrument` (undefined: none). */
  const noteBendAt = (instrument: TrackInstrument, time: number): number | undefined => {
    let best: BentNote | undefined;
    for (const n of bentNotes.get(instrument) ?? []) if (n.start <= time && time < n.end && (!best || n.start >= best.start)) best = n;
    if (!best) return undefined;
    // (Held where the song jumped away from it)
    const at = Math.min(time, best.cut ?? Infinity);
    let cents = best.steps[0]?.[1] ?? 0;
    for (const [t, c] of best.steps) if (t <= at) cents = c;
    return cents;
  };
  /**
   * The bend a track's clips have at `tick` in a playback of the whole song (cents, with the
   * vibrato's swing at `time`): the latest bend or vibrato event of its clips at or before it
   * (a clip's end puts it back to rest); 0 where none has bent it.
   */
  const laneBendAt = (trackId: string, tick: number, time: number): number => {
    let best: PitchEvent | undefined;
    let bestTick = -Infinity;
    for (const { clip, groups, bends } of entries.values()) {
      if (!bends || clip.trackId !== trackId) continue;
      // (Its bend events come first in its groups)
      for (const [at, g] of groups) {
        if (!g.pitch) break;
        if (at > tick) break;
        if (!g.pitch.pitch) continue;
        // (A clip's end before the next clip's start at the same tick, as they play)
        if (at > bestTick || (at === bestTick && best?.end && !g.pitch.end)) {
          best = g.pitch;
          bestTick = at;
        }
      }
    }
    return best ? pitchCents(best, time) : 0;
  };
  /**
   * Each track's bend (or only `only`'s) as the song has it at `tick`: a note with its own bend
   * still sounding keeps its bend, else its clips' bend there, else centre. Only for
   * the instruments the song bends, so a song without bends sends none. After the controllers'
   * reset (which centres a plugin's bend), at every hold point: a bend left by the place the song
   * came from (the loop's end, before a jump) doesn't carry on where it now plays.
   */
  const holdBends = (tick: number, time: number, only: string | undefined) => {
    const ids = new Set<string>();
    for (const id of bentTracks) if (!only || id === only) ids.add(id);
    for (const { clip, bends } of entries.values()) if (bends && (!only || clip.trackId === only)) ids.add(clip.trackId);
    for (const trackId of ids) {
      const instrument = instrumentFor(trackId);
      if (!instrument?.bend) continue;
      const cents = noteBendAt(instrument, time) ?? laneBendAt(trackId, tick, time);
      if (cents === 0 && !bent.has(instrument)) continue;
      onActivity?.(trackId, time, 0);
      sendBend(trackId, instrument, cents, time);
    }
  };
  /** Each track's controllers (or only `only`'s) at their values at `tick`, then its bend (see ClipSchedule.hold). */
  const holdLanes = (tick: number, time: number, only?: string) => {
    const byTrack = new Map<string, CcEvent[][]>();
    for (const id of movedTracks) if (!only || id === only) byTrack.set(id, []);
    for (const { clip, ccs } of entries.values()) {
      if (!ccs.length || (only && clip.trackId !== only)) continue;
      const lists = byTrack.get(clip.trackId);
      if (lists) lists.push(ccs);
      else byTrack.set(clip.trackId, [ccs]);
    }
    for (const [trackId, lists] of byTrack) {
      const instrument = instrumentFor(trackId);
      if (!instrument?.cc) continue;
      // Moved since it was fresh: Reset All Controllers (CC 121) first, so every controller no clip
      // has set by here is as the fresh plugin has it, then the held values. A plugin whose reset
      // doesn't do all of that also gets the rests MIDI defines (see ccHold.ts).
      const sent = moved.get(instrument);
      let reset = false;
      let fresh = false;
      if (sent?.size && instrument.resetControllers) {
        reset = true;
        safely(() => void (fresh = instrument.resetControllers!(time)));
      }
      if (fresh) sent!.clear();
      const sends = heldCcAt(lists, tick, fresh ? undefined : sent);
      if (!sends.length && !reset) continue;
      onActivity?.(trackId, time, 0);
      for (const [n, value] of sends) sendCc(trackId, instrument, n, value, time);
    }
    holdBends(tick, time, only);
  };
  const onLoop = (time: number) => {
    if (loopOf) {
      currentLoop();
      wraps++;
    }
    jumpAway(time);
    holdLanes(Math.round(transport.getTicksAtTime(time)), time);
  };
  // (Tone says "start" when the Transport starts and when it's moved while playing: then "stop"
  // and "start" at one time, the voices sounding on, so their notes' bends are kept. Started again
  // after a real stop or pause, every voice was let go meanwhile.)
  let stoppedAt: number | null = null;
  const onStart = (time: number) => {
    wraps = 0;
    if (stoppedAt !== null && stoppedAt !== time) {
      bentNotes.clear();
      sentUntil.clear();
      holding.clear();
    }
    stoppedAt = null;
    jumpAway(time);
    holdLanes(Math.round(transport.getTicksAtTime(time)), time);
  };
  const onStop = (time: number) => {
    wraps = 0;
    stoppedAt = time;
  };
  const onPause = (time: number) => {
    stoppedAt = time;
  };
  transport.on('loop', onLoop);
  transport.on('start', onStart);
  transport.on('stop', onStop);
  transport.on('pause', onPause);
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
  const playExpressive = (trackId: string, instrument: TrackInstrument, note: PlayableNote, time: number) => {
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
    if (instrument.bend && note.expr?.bend?.length && steps[0]?.cents) sendBend(trackId, instrument, steps[0].cents, time);
    instrument.play([note], time);
    if (!instrument.bend || !note.expr?.bend?.length) return;
    // Kept while it sounds, for a hold point to keep its bend (the ones long gone let go of); its
    // bends, then back to centre at its end, sent as each comes due
    const end = time + length * spb;
    const bends = steps.map((st): [number, number] => [time + st.at * spb, st.cents]);
    const n: BentNote = { trackId, instrument, start: time, end, steps: bends, queue: [...bends, [end, 0]] };
    const list = (bentNotes.get(instrument) ?? []).filter((x) => x.end > time - 1 || x.queue.length);
    list.push(n);
    bentNotes.set(instrument, list);
    sendNote(n, stepper === null ? Infinity : time + stepSeconds());
  };
  /** Play notes at `time`, the expressive ones each on its own. */
  const playNotes = (trackId: string, instrument: TrackInstrument, notes: PlayableNote[], time: number) => {
    const plain = notes.filter((n) => !isExpressive(n.expr));
    if (plain.length) instrument.play(plain, time);
    for (const n of notes) if (isExpressive(n.expr)) playExpressive(trackId, instrument, n, time);
  };

  const playGroup = (instrument: TrackInstrument, group: NoteGroup, time: number) => {
    const f = feel.get(group.trackId);
    if (!f) {
      playNotes(group.trackId, instrument, group.notes, time);
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
      playNotes(group.trackId, instrument, notes, time + first.late);
      return;
    }
    group.notes.forEach((n, i) => {
      const d = drifted(n, group.seeds[i]);
      playNotes(group.trackId, instrument, [d.note], time + d.late);
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
          if (pitch.pitch && instrument?.bend) {
            const at = (holding.size && endHolding(instrument, tickTime)) || tickTime;
            sendBend(trackId, instrument, pitchCents(pitch, tickTime), at);
          }
          if (instrument?.dynamics && (pitch.dyn !== undefined || pitch.end)) safely(() => instrument.dynamics!(pitch.end ? null : pitch.dyn!, tickTime));
        }
      }
      for (const { trackId, cc } of groups) {
        if (!cc) continue;
        const instrument = instrumentFor(trackId);
        if (instrument?.cc) sendCc(trackId, instrument, cc.cc, cc.value, tickTime);
      }
      for (const group of groups) {
        const { trackId, notes, seeds, swung, pitch, cc } = group;
        if (pitch || cc) continue;
        const time = tickTime + lateOf(group);
        const instrument = instrumentFor(trackId);
        if (!instrument) continue;
        // Its first note after a jump that left a bent note's bend held: the song's bend here first
        const reset = holding.size && instrument.bend ? endHolding(instrument, time) : undefined;
        if (reset !== undefined) sendBend(trackId, instrument, laneBendAt(trackId, tick, time), reset);
        safely(() => playGroup(instrument, { trackId, notes, seeds, swung }, time));
      }

      if (onActivity) {
        const spb = 240 / transport.bpm.value;
        for (const group of groups) onActivity(group.trackId, tickTime + lateOf(group), group.notes.reduce((most, n) => Math.max(most, durationToBars(n.duration) * spb), 0));
      }
      if (onNotes) for (const group of groups) if (!group.pitch && !group.cc) onNotes(group.trackId, tickTime + lateOf(group));
      if (!onKick) return;
      for (const group of groups) {
        const key = kitOf.get(group.trackId);
        if (!key) continue;
        if (group.notes.some((n) => pumpHitOf(key, n.note) === 'kick')) onKick(group.trackId, tickTime + lateOf(group), 'kick');
        if (group.notes.some((n) => pumpHitOf(key, n.note) === 'snare')) onKick(group.trackId, tickTime + lateOf(group), 'snare');
      }
    };
  };

  return {
    update: (tracks, clips) => {
      const trackIds = new Set(tracks.map((t) => t.id));
      // A frozen drum track (live view: an audio track) still sends its kicks, by the kit it was
      kitOf = pumpKitsOf(tracks);
      feel = new Map();
      straight = new Set(tracks.filter(isDropTrack).map((t) => t.id));
      for (const t of tracks) {
        if (!t.fx.human.on || straight.has(t.id)) continue;
        const kind = INSTRUMENTS[t.instrumentKey]?.kind;
        feel.set(t.id, { human: t.fx.human, pitched: PITCHED_KINDS.has(kind), together: kind !== 'sampled' && kind !== 'custom' && (kind !== 'synth' || TOGETHER_KEYS.has(t.instrumentKey)) });
      }
      const nextEntries = new Map<string, ClipEntry>();
      const nextByTick = new Map<number, NoteGroup[]>();
      const trackById = new Map(tracks.map((t) => [t.id, t]));
      const roleMemo = new Map<string, string>();
      for (const clip of clips) {
        if (!trackIds.has(clip.trackId)) continue;
        const prev = entries.get(clip.id);
        const role = feelRole(clip, trackById.get(clip.trackId), clips, roleMemo);
        const meter = role ? meterOf() : undefined;
        const entry = prev && prev.role === role && prev.meter === meter && sameNotes(prev.clip, clip) ? prev : newEntry(clip, role, meter);
        nextEntries.set(clip.id, entry);
        for (const [tick, group] of entry.groups) {
          const list = nextByTick.get(tick);
          if (list) list.push(group);
          else nextByTick.set(tick, [group]);
        }
      }
      entries = nextEntries;
      byTick = nextByTick;
      // Notes with their own bend: their bends are sent as they come due (see sendDue)
      if (stepper === null && [...entries.values()].some((e) => e.noteBends)) stepper = transport.scheduleRepeat((time) => sendDue(time + stepSeconds()), `${stepTicks}i`);
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
    earliest: () => {
      let most = 0;
      for (const e of entries.values()) if (!straight.has(e.clip.trackId)) for (const [, g] of e.groups) if (g.shift && -g.shift > most) most = -g.shift;
      return most;
    },
    hold: (bar, time) => holdLanes(barToTicks(bar), time),
    holdTrack: (trackId, time) => {
      if (transport.state !== 'started') return;
      const ticks = transport.getTicksAtTime(time);
      if (!Number.isFinite(ticks)) return;
      // (A note with its own bend that sounds on while the track was silent keeps it; one that
      // ended, or was let go, isn't kept: see noteBendAt and letGo)
      holdLanes(Math.round(ticks), time, trackId);
    },
    letGo: forgetNotes,
    dispose: () => {
      transport.off('loop', onLoop);
      transport.off('start', onStart);
      transport.off('stop', onStop);
      transport.off('pause', onPause);
      if (stepper !== null) transport.clear(stepper);
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
// A track heard again, or its plugin just loaded, while playing: its controllers where the song is
onTrackHeardAgain((trackId) => liveSchedule?.holdTrack(trackId, liveContext.now()));
// Stop, Pause or Free memory let every voice go: no note's own bend is kept at a hold point after
onVoicesLetGo(() => liveSchedule?.letGo());

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
