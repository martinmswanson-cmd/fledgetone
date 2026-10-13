/**
 * The song and everything that changes it: one zustand store (useTimelineStore) holding the
 * tracks, clips, tempo and meter maps, markers, loop, master settings and the view and transport
 * state, with every action the UI calls, and undo. Plus the two bridges out of it: to the audio
 * engine (connectTimelineToAudio) and to the browser autosave (connectAutosave).
 *
 * How it's laid out, top to bottom (search for the names):
 *
 * 1. Undo: historyEntry, pushPast and restoreEntry. An undo step is a snapshot of the song's data
 * (HistoryEntry, below), up to HISTORY_LIMIT of them; actions call checkpoint() (or
 * pushPast) before changing anything they want undoable. Ripple edits also carry their RippleMove
 * so undo puts the loop and playhead back.
 *
 * 2. TimelineState: the state's fields, then its actions grouped by area, each with a comment:
 * Transport, View / tools, Loop, Markers, Tracks & Inspector, Audio clips and the Slicer, Master
 * Studio FX, Clips, Ripple edits, Clipboard, Selection, Project, Creating and editing clips, Piano
 * roll, Recording, Automation, and the rest after.
 *
 * 3. Helpers the actions share: splitClipAt, makeTrack, copyClip, selectionBlock, viewShowing,
 * tidyMeters, and onProjectReplaced (listeners told when New, Open, a link or Restore replaces the
 * song).
 *
 * 4. useTimelineStore = create(...): the actions' implementations, in the same order as
 * TimelineState. Pure logic lives in the store's sibling files (markers.ts, takes.ts, buses.ts,
 * folders.ts, audioClips.ts, launcher.ts...) and the actions call it, so most of this is applying
 * their results with set().
 *
 * 5. currentProject (the song as a ProjectSnapshot, for saving and exports), retryAutosave and
 * connectAutosave (writes the song to the browser a moment after each change, see project.ts).
 *
 * 6. connectTimelineToAudio: subscribes to the store and keeps the live engine in step. On every
 * change it works out what the engine should play (frozen tracks as audio, clip launcher slots,
 * controller lanes as automation), then updates only what changed: the live tracks
 * (liveTracks.ts), the clip schedule (scheduler.ts), the Transport's loop, tempo and swing, the
 * master inserts and returns, ducking and intensity.
 */
import { createStarter, isStarterId } from './starters';
import type { StarterId } from './starters';
import { create } from 'zustand';
import { initAudio } from '../audio/engine';
import {
  formatBarsBeats,
  getAudiblePositionBar,
  getScheduledPositionBar,
  pauseTransport,
  secondsToBar,
  seekTransport,
  startTransportAt,
  stopTransport,
  transportStartsAt,
} from '../audio/transport';
import { releaseAllVoices, rescheduleClips, syncTransport } from '../audio/scheduler';
import { holdAutomationAt, retimeAutomation, syncLiveTracks, applyLiveIntensity, setLiveDuck, setLiveStripTempo } from '../audio/liveTracks';
import { beginTake, discardTake, finishTake } from '../audio/recorder';
import { heardTime } from '../audio/latency';
import { countInClicks } from '../audio/metronome';
import { quantizeTakeClip, readRecordOptions, writeRecordOptions } from './recording';
import type { RecordOptions, TakeClip } from './recording';
import { clipSecondsAt, sourceAt } from './warp';
import { controllerMemo, withControllerLanes } from './ccLanes';
import { specOf, insertLaneBars, laneValueAt, normalizePoints, removeLaneBars } from '../audio/automation';
import { liveMix } from '../audio/engine';
import { createDemoProject, createPatternClip, INITIAL_TRACKS, toNotes } from './demoSong';
import { keyChange } from './keyChange';
import { songSections } from './cutToLength';
import { dipLane, type DipShape } from './dialogue';
import { duckPoints } from './duck';
import { createStinger, fitNotesToRange } from './stingers';
import { projectVideo, useVideoStore } from './videoStore';
import { foldersOf, groupTracks, moveToFolder, moveTrack, tidyFolders, ungroup, updateFolder } from './folders';
import { ANY_STATE, transitionKey } from './transitions';
import { defaultCurve, type IntensityCurve } from './intensity';
import { detectKey, keyOf } from './songKey';
import { BUILD_BARS, buildUpSteps, dropHitSteps, HIT_BARS, partClip, snareRollSteps } from './buildDrop';
import { autosaveRemovedBy, hasWork, preservePreviousSession, setAsideSession, writeAutosave, type AutosaveFailure, type AutosaveResult, type ProjectSnapshot, type SavedSession } from './project';
import type { DrumRack, MultiSample, Clip, ClipAudio, ExprPoint, FrameRate, InstrumentKey, LoopRegion, NoteEvent, RulerUnits, SlicerSettings, SnapGrid, SoundMeta, TimelineTool, Track, TrackEq, TrackFolder, WamPlugin } from './timelineTypes';
import { liveStates, onWamStates, resetWamSession } from '../audio/wamHost';
import type { DragPayload } from './dragSounds';
import type { SynthPatch } from './synthPatch';
import { durationToBars, formatBarCount, minClipLength, snapBar, uid } from './timelineTypes';
import { canMoveClipBetween, compatibleInstruments, INSTRUMENTS, isAudioKind, isDrumKind, isFxKind } from '../audio/instrumentCatalog';
import { hasRecordings, loadSamples } from '../audio/samplers/samplerManager';
import { ensureSound, importDataUrl, importEmbeddedSounds, soundSeconds, useSoundLibrary } from '../audio/soundLibrary';
import { liveView } from './freeze';
import { sliceNotes } from '../audio/slicing';
import {
  audioLengthLimit,
  audioTrimStartLimit,
  clipNameFromFile,
  normalizeClipAudio,
  referencedSoundIds,
  retimeAudioClips,
  secondsPerBar,
  splitAudio,
  audioShift,
  trimAudioStart,
  stretchRatio,
} from './audioClips';
import { DEFAULT_FRAME_RATE, DEFAULT_MASTER_FX, defaultTrackFx, isFrameRate, normalizeTrackFx } from './timelineTypes';
import type { AutomationParam, AutomationPoint, CustomSample, Marker, MarkerAnchor, MasterFx, MasterSettings, Stinger, StingerKind, TrackFx, TransitionRule, WobbleRate } from './timelineTypes';
import { DEFAULT_WOBBLE, TOTAL_BARS, defaultMasterSettings, normalizeMasterSettings, sameMasterSettings } from './timelineTypes';
import {
  adjacentMarker,
  anchorMarker,
  cleanMarkerName,
  createMarker,
  insertMarkerBars,
  markerPushedPastEnd,
  nextMarkerName,
  placeMarker,
  removeMarkerBars,
  retimeMarkers,
} from './markers';
import { rippleRules, type RippleEdit } from './ripple';
import { isBus, isMixTrack, isReturn, tidyRoutes, tidySends, wouldLoop } from './buses';
import { moveExpression, shiftExpression, tidyLane, type ExprLane } from './expression';
import { tidyNoteLane, type NoteLane } from './noteExpression';
import { launcherActive, launcherClips, useLauncher } from './launcherView';
import { addTake, applyComp, flattenTakes, keepNoteEdits, removeTake, setCompRange, splitTakes, trimTakes } from './takes';
import { clampBpm, meterAt, nearestMeasureStart, shiftTempoPoints, sortedPoints, FOUR_FOUR, tempoAt, tempoFrom } from '../audio/tempoMap';
import type { Meter, MeterMap, MeterPoint, Tempo, TempoMap, TempoPoint } from '../audio/tempoMap';
import { setSongMeter } from '../audio/transport';

// Defined with the data types (project parsing and the automation maths need it too); much of
// the app reads it from here
export { TOTAL_BARS };
export const MIN_ZOOM = 12;
/** Deep enough for frame-level work: a 30 fps frame is 21px wide at 120 BPM. */
export const MAX_ZOOM = 1280;
const EPS = 1e-6;

/**
 * An undo or redo brings back the tracks as they were, plugin settings included, but the plugins
 * play on as they are now (they aren't rebuilt): keep their current settings on the tracks.
 */
function keepLivePluginStates(): void {
  const states = liveStates();
  if (states.size) useTimelineStore.getState().setPluginStates(states);
}
const HISTORY_LIMIT = 100;

/** Where the loop and the playhead are. */
interface RippleSpot {
  inBar: number;
  outBar: number;
  playhead: number;
}

/**
 * What an insert / delete bars did to the loop and the playhead, kept with its undo step so that
 * undo takes them back with the music and redo moves them again. One that hasn't moved since goes
 * exactly back to where it was (or to where the edit put it). One that has (the playhead while
 * playing, a loop dragged since) is moved by the edit's rule, or back by its inverse, so it stays
 * on the same music.
 */
interface RippleMove {
  before: RippleSpot;
  after: RippleSpot;
  /** The edit itself, in plain numbers (see RippleEdit). */
  edit: RippleEdit;
}

/**
 * One undo step: the arrangement and mixer as they were. Every field is an immutable reference
 * the store already holds (edits replace objects rather than change them), so taking one is cheap.
 */
interface HistoryEntry {
  /** An insert / delete bars step: how it moved the loop and the playhead. */
  ripple?: RippleMove;
  clips: Clip[];
  tracks: Track[];
  masterFx: MasterFx;
  /** The master section (OTT, stereo width). */
  master: MasterSettings;
  markers: Marker[];
  /** The tempo then: audio clips keep their length in seconds, so restored at another tempo their bars are retimed (the song's tempo isn't undone). */
  bpm: number;
  /** The tempo changes and time signatures (these are undone) */
  tempoPoints: TempoPoint[];
  meter: Meter;
  meterPoints: MeterPoint[];
}

/** Everything undo restores, read from the store now. */
const historyEntry = (s: TimelineState): HistoryEntry => ({
  clips: s.clips,
  tracks: s.tracks,
  masterFx: masterFxOf(s),
  master: s.master,
  markers: s.markers,
  bpm: s.bpm,
  tempoPoints: s.tempoPoints,
  meter: s.meter,
  meterPoints: s.meterPoints,
});

let tempoMemo: { bpm: number; points: TempoPoint[]; map: TempoMap } | null = null;
/** The song's tempo map (the same object while the tempo doesn't change). */
export function songTempo(s: { bpm: number; tempoPoints: TempoPoint[] }): TempoMap {
  if (tempoMemo && tempoMemo.bpm === s.bpm && tempoMemo.points === s.tempoPoints) return tempoMemo.map;
  const map: TempoMap = { bpm: s.bpm, points: s.tempoPoints };
  tempoMemo = { bpm: s.bpm, points: s.tempoPoints, map };
  return map;
}

/** The song's tempo map, for components (re-renders only when it changes). */
export const useSongTempo = () => useTimelineStore((s) => songTempo(s));
/** The song's meter map, for components. */
export const useSongMeter = () => useTimelineStore((s) => songMeterOf(s));

let meterMemo: { meter: Meter; points: MeterPoint[]; map: MeterMap } | null = null;
/** The song's meter map (the same object while the time signatures don't change). */
export function songMeterOf(s: { meter: Meter; meterPoints: MeterPoint[] }): MeterMap {
  if (meterMemo && meterMemo.meter === s.meter && meterMemo.points === s.meterPoints) return meterMemo.map;
  const map: MeterMap = { base: s.meter, points: s.meterPoints };
  meterMemo = { meter: s.meter, points: s.meterPoints, map };
  return map;
}

const withRipple = (entry: HistoryEntry, ripple: RippleMove | undefined): HistoryEntry => (ripple ? { ...entry, ripple } : entry);

/** History patch that records the current state as the one to return to on undo (and, for a ripple edit, what it moved). */
const pushPast = (s: TimelineState, ripple?: RippleMove) => ({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), withRipple(historyEntry(s), ripple)], future: [] });

/** Where undoing (or redoing) a ripple step puts the loop and the playhead: see RippleMove. */
function rippleSpot(s: TimelineState, move: RippleMove, undo: boolean): { loopRegion: LoopRegion; playhead: number } {
  const from = undo ? move.after : move.before;
  const to = undo ? move.before : move.after;
  const near = (a: number, b: number) => Math.abs(a - b) < EPS;
  const rules = rippleRules(move.edit);
  const loop = s.loopRegion;
  let moved: LoopRegion;
  if (near(loop.inBar, from.inBar) && near(loop.outBar, from.outBar)) moved = { ...loop, inBar: to.inBar, outBar: to.outBar };
  else moved = undo ? { ...loop, inBar: rules.backPoint(loop.inBar), outBar: rules.backPoint(loop.outBar) } : rules.moveLoop(loop);
  // (A loop that would shrink to nothing stays where it is)
  const loopRegion = moved.outBar - moved.inBar > EPS && (moved.inBar !== loop.inBar || moved.outBar !== loop.outBar) ? moved : loop;
  const playhead = near(s.playheadPosition, from.playhead) ? to.playhead : clampBar((undo ? rules.backPoint : rules.movePoint)(s.playheadPosition));
  return { loopRegion, playhead };
}

/**
 * The store patch that puts a history entry back. The track selection stays valid: a track that
 * comes back (undoing a delete) is selected, and a selected track that disappears hands over to
 * the first track.
 */
function restoreEntry(s: TimelineState, entry: HistoryEntry): Partial<TimelineState> {
  const { tracks, masterFx, master } = entry;
  const ids = new Set(tracks.map((t) => t.id));
  // Entries are taken whole, so clips always match their tracks; filter anyway so an orphan can
  // never reach the scheduler or a saved file
  const clips = entry.clips.every((c) => ids.has(c.trackId)) ? entry.clips : entry.clips.filter((c) => ids.has(c.trackId));
  const current = new Set(s.tracks.map((t) => t.id));
  const returning = tracks.find((t) => !current.has(t.id));
  const selectedTrackId = returning
    ? returning.id
    : s.selectedTrackId && ids.has(s.selectedTrackId)
      ? s.selectedTrackId
      : tracks[0]?.id ?? null;
  // The starting tempo isn't undone on its own, but an edit that changed the tempo changes (cut to
  // length) set it too: then the whole map comes back as it was
  const bpm = entry.tempoPoints !== s.tempoPoints ? entry.bpm : s.bpm;
  const then = { bpm: entry.bpm, points: entry.tempoPoints };
  const now = songTempo({ bpm, tempoPoints: entry.tempoPoints });
  return {
    // Audio clips are as long in seconds as they were, at today's tempo
    clips: retimeAudioClips(clips, then, now),
    ...(bpm !== s.bpm ? { bpm } : {}),
    tempoPoints: entry.tempoPoints,
    meter: entry.meter,
    meterPoints: entry.meterPoints,
    tracks,
    selectedTrackId,
    masterReverbDecay: masterFx.reverbDecay,
    masterDelayTime: masterFx.delayTime,
    masterDelayFeedback: masterFx.delayFeedback,
    master,
    // The song's tempo isn't undone, so markers held to their time are placed at today's tempo
    markers: retimeMarkers(entry.markers, now),
  };
}

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  /** 1-based bar position; updated every animation frame while playing. */
  playheadPosition: number;
  isPlaying: boolean;
  /** Record mode (the toolbar's Record button): with a track armed, playing records a take onto it. */
  isRecording: boolean;
  /** The tempo at bar 1 (the whole song's, unless there are tempo changes) */
  bpm: number;
  /** Tempo changes after bar 1: jumps, or glides from the tempo before (see tempoMap.ts) */
  tempoPoints: TempoPoint[];
  /** The time signature from bar 1 */
  meter: Meter;
  /** Time signature changes, each at the start of a measure */
  meterPoints: MeterPoint[];
  swing: number;
  zoom: number;
  activeTool: TimelineTool;
  snapGrid: SnapGrid;
  loopRegion: LoopRegion;
  /** Timecode frame rate (saved with the project); also the step of the Frame snap grid. */
  fps: FrameRate;
  /** Count 29.97 timecode in drop-frame (saved with the project; always false at other rates). */
  dropFrame: boolean;
  /** What the time ruler counts in (a view setting, not saved). */
  rulerUnits: RulerUnits;
  /**
   * The lanes' visible stretch in px from bar 1 (scroll position and width), kept up to date by the
   * timeline so the ruler can draw only what's on screen and zoom can keep its anchor in place.
   */
  viewLeft: number;
  viewWidth: number;
  /** Bumped when the lanes should scroll to viewLeft (the timeline does the scrolling): see seek and loadProject. */
  viewJumps: number;

  // Transport
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  stop: () => void;
  /**
   * Move the playhead. `reveal` (a jump: to a marker, to In, to a typed position) also scrolls the
   * lanes to it if it's off screen, as they follow it while playing.
   */
  seek: (bar: number, reveal?: boolean) => void;
  /** Record mode on or off. Playing with a track armed, on starts a take at once and off ends it. */
  toggleRecord: () => void;
  /** Set the tempo (40 to 240 BPM, to 0.01). */
  setBpm: (bpm: number) => void;
  /** Every tempo (the song's and its changes) times `factor`, as one undo step. A message if one would leave 40 to 240 BPM. */
  scaleTempo: (factor: number) => string | null;
  /** Add a tempo change at `bar` (a jump, or a glide from the tempo before). Returns its id. */
  addTempoChange: (bar: number, bpm: number, ramp?: boolean) => string;
  /** `record`: its own undo step (a drag checkpoint()s once and passes false). */
  updateTempoChange: (id: string, patch: Partial<Pick<TempoPoint, 'bar' | 'bpm' | 'ramp'>>, record?: boolean) => void;
  removeTempoChange: (id: string) => void;
  /** The time signature from bar 1. */
  setMeter: (meter: Meter) => void;
  /** Change the time signature from the measure nearest `bar`. Returns its id (null if that's bar 1: setMeter). */
  addMeterChange: (bar: number, meter: Meter) => string | null;
  updateMeterChange: (id: string, patch: Partial<Pick<MeterPoint, 'bar' | 'num' | 'den'>>, record?: boolean) => void;
  removeMeterChange: (id: string) => void;
  tapTempo: () => void;
  setSwing: (swing: number) => void;

  // View / tools
  /**
   * Zoom (px per bar), keeping one bar still on screen: `anchorBar` if given, else the playhead
   * if it's in view, else the middle of the view.
   */
  setZoom: (zoom: number, anchorBar?: number) => void;
  setTool: (tool: TimelineTool) => void;
  setSnapGrid: (grid: SnapGrid) => void;
  /** Timecode rate; drop-frame applies only to 29.97. */
  setFps: (fps: FrameRate, dropFrame?: boolean) => void;
  setRulerUnits: (units: RulerUnits) => void;
  setView: (left: number, width: number) => void;

  // Loop
  setLoopIn: (bar: number) => void;
  setLoopOut: (bar: number) => void;
  /** Set In and Out exactly as typed (no snapping). False if they don't make a loop of at least a 16th. */
  setLoopRange: (inBar: number, outBar: number) => boolean;
  toggleLoop: () => void;

  // Markers: named points on the timeline, in position order (saved with the project; edits are undoable)
  markers: Marker[];
  /**
   * Drop a marker at `bar` (default: the playhead), named "Marker N". Returns a message for the
   * user if one is already there, else null.
   */
  addMarker: (bar?: number) => string | null;
  /** A hit point at the playhead: a marker named "Hit N", locked to time (see tempoFinder.ts) */
  addHit: () => string | null;
  /** Hit points at song times (seconds), named `${prefix} N`, skipping any within a frame of a marker; one undo step. Returns how many were added. */
  addHitsAt: (seconds: number[], prefix: string) => number;
  /** Move a marker (no history: drags checkpoint() once). */
  moveMarker: (id: string, bar: number) => void;
  /**
   * Rename a marker (a blank name changes nothing). `record` makes it its own undo step; typing in
   * the markers list checkpoint()s once instead.
   */
  renameMarker: (id: string, name: string, record?: boolean) => void;
  /** Hold a marker to its bar or its time when the tempo changes (undoable). */
  setMarkerAnchor: (id: string, anchor: MarkerAnchor) => void;
  deleteMarker: (id: string) => void;
  /** Move the playhead to the previous (-1) or next (1) marker. False if there's none that way. */
  jumpToMarker: (direction: -1 | 1) => boolean;

  // Tracks & Inspector
  selectedTrackId: string | null;
  isInspectorOpen: boolean;
  selectTrack: (trackId: string | null) => void;
  toggleInspector: (open?: boolean) => void;
  addTrack: (instrumentKey: InstrumentKey, name?: string) => string;
  deleteTrack: (trackId: string) => void;
  /**
   * Play a track into a bus track (its group channel), or straight to the master with null (one
   * undo step). Refused (false) where it would make a loop.
   */
  setTrackOutput: (trackId: string, busId: string | null) => boolean;
  /**
   * A track's send to a return: its level (0 to 1), or null to take it away. `record`: its own undo
   * step (a slider checkpoint()s once and passes false).
   */
  setTrackSend: (trackId: string, returnId: string, level: number | null, record?: boolean) => void;
  /** A send taken before the fader (true) or after it (one undo step). */
  setTrackSendPre: (trackId: string, returnId: string, pre: boolean) => void;
  /** MIDI learn: CC `cc` moves `param` of the track (and nothing else any more) (one undo step). */
  mapMidi: (trackId: string, cc: number, param: AutomationParam) => void;
  /** Forget a track's MIDI mapping of CC `cc` (one undo step). */
  unmapMidi: (trackId: string, cc: number) => void;
  /** A new return, and `trackId` (if given) sending to it at half level (one undo step). Returns its id. */
  addReturn: (trackId?: string, name?: string) => string;
  /** A new Plugin track playing the WAM at `url` (one undo step). Returns its id. */
  addPluginTrack: (url: string, name: string) => string;
  /** Add a WAM effect to a track, after its other plugin effects (one undo step). Returns the plugin's id. */
  addTrackPluginFx: (trackId: string, url: string, name: string) => string | null;
  /** Take a plugin effect off a track (one undo step). */
  removeTrackPluginFx: (trackId: string, pluginId: string) => void;
  /** Bypass a plugin effect, or put it back in (one undo step). */
  setPluginBypass: (trackId: string, pluginId: string, bypass: boolean) => void;
  /** Plugins' settings as read from them (not an undo step: they're the plugins' own). */
  setPluginStates: (states: ReadonlyMap<string, unknown>) => void;
  /**
   * Set a clip's expression lane (pitch bend, mod wheel or sustain pedal) to `points` (empty: none).
   * `record`: its own undo step (a drag checkpoint()s once and passes false).
   */
  setClipExpression: (clipId: string, lane: ExprLane, points: ExprPoint[], record?: boolean) => void;
  /** A note's own bend or pressure curve (points `at` bars from the note's start; empty: none). */
  setNoteExpression: (clipId: string, noteId: string, lane: NoteLane, points: ExprPoint[], record?: boolean) => void;
  /** A take folder: take `take` plays from `from` to `to` (bars into the clip) (one undo step). */
  setTakeComp: (clipId: string, from: number, to: number, take: number) => void;
  /** A take folder: delete one take (the last one left flattens it into a plain clip) (one undo step). */
  deleteTake: (clipId: string, take: number) => void;
  /** A take folder becomes a plain clip of what its comp plays; the other takes go (one undo step). */
  flattenClipTakes: (clipId: string) => void;
  /** Mic takes recorded over `startBar` to `startBar + lengthBars` on an Audio track: a take folder (joining a clip of that span if takes are on). */
  addAudioTakes: (trackId: string | null, startBar: number, lengthBars: number, takes: Array<{ audio: ClipAudio; name?: string }>, clipName: string) => string | null;
  /** A new bus with these tracks playing into it, placed after the last of them (one undo step). Returns its id. */
  groupIntoBus: (trackIds: readonly string[], name?: string) => string | null;
  /** Put tracks in a new folder (one undo step). Returns its id. */
  groupIntoFolder: (trackIds: readonly string[], name?: string) => string | null;
  /** Take every track out of a folder (one undo step). */
  ungroupFolder: (folderId: string) => void;
  /** Rename, recolour (`recolor`: its tracks too) or fold a folder. Folding isn't an undo step. */
  setFolder: (folderId: string, patch: Partial<Omit<TrackFolder, 'id'>>, recolor?: boolean) => void;
  /** Put a track in a folder, or take it out with null (one undo step). */
  setTrackFolder: (trackId: string, folderId: string | null) => void;
  /** Move a track a row up or down (see folders.ts moveTrack; one undo step). */
  moveTrackRow: (trackId: string, direction: -1 | 1) => void;
  setTrackColor: (trackId: string, color: string) => void;
  /** Mute (or, if all are muted, unmute) a folder's tracks; the same for solo. One undo step. */
  toggleFolderMute: (folderId: string) => void;
  toggleFolderSolo: (folderId: string) => void;
  setTrackInstrument: (trackId: string, instrumentKey: InstrumentKey) => void;
  toggleMute: (trackId: string) => void;
  /** Mute or unmute without an undo step (the game preview switching layers while it plays). */
  setTrackMuted: (trackId: string, muted: boolean) => void;
  toggleSolo: (trackId: string) => void;
  toggleArm: (trackId: string) => void;
  setTrackVolume: (trackId: string, db: number) => void;
  setTrackPan: (trackId: string, pan: number) => void;
  setTrackEq: (trackId: string, eq: Partial<TrackEq>) => void;
  resetTrackEq: (trackId: string) => void;
  setTrackReverbSend: (trackId: string, send: number) => void;
  setTrackDelaySend: (trackId: string, send: number) => void;
  /**
   * Change one insert effect (distortion / compressor / chorus / filter / pump) on a track.
   * `record` makes it its own undo step (menus); sliders checkpoint once per gesture instead.
   */
  setTrackFx: <K extends keyof TrackFx>(trackId: string, effect: K, patch: Partial<TrackFx[K]>, record?: boolean) => void;
  /** Give a Sampler track its sound (or clear it with undefined). */
  setTrackSample: (trackId: string, sample: CustomSample | undefined) => void;
  /** Expressive playing on or off (undoable) */
  setTrackExpressive: (trackId: string, on: boolean) => void;

  // Audio clips and the Slicer (the maths is in audioClips.ts, the sound files in soundLibrary.ts)
  /**
   * Put sound files on an Audio track (null: a new one, made in the same step) as clips, end to
   * end from `atBar`, each as long as its sound (undoable, the clips selected). Returns a message
   * for the user if none fitted, else null.
   */
  addAudioClips: (trackId: string | null, atBar: number, sounds: SoundMeta[]) => string | null;
  /** Change an audio clip's gain, fades or offset. `record` makes it its own undo step; sliders and handle drags checkpoint() once instead. */
  setClipAudio: (clipId: string, patch: Partial<ClipAudio>, record?: boolean) => void;
  /**
   * Make an audio clip follow the song's tempo, recorded at `stretchBpm` (or play as recorded again,
   * with undefined). It keeps playing the same part of its sound, so its length in bars changes
   * with the stretch. One undo step.
   */
  setClipStretch: (clipId: string, stretchBpm: number | undefined) => void;
  /** Give a Slicer track its sound and slices (or clear them with undefined). `record` as above. */
  setTrackSlicer: (trackId: string, slicer: SlicerSettings | undefined, record?: boolean) => void;
  /** A Drum Rack's pads (`record`: one undo step; a slider checkpoints and passes false). */
  setTrackRack: (trackId: string, rack: DrumRack | undefined, record?: boolean) => void;
  /** A Multi Sampler's sounds and shape. */
  setTrackMulti: (trackId: string, multi: MultiSample | undefined, record?: boolean) => void;
  /** Change a Synth Designer track's patch (`record` false while a knob is dragged: checkpoint() first). */
  setTrackSynth: (trackId: string, synth: SynthPatch, record?: boolean) => void;
  /**
   * "Chop to Slicer": a Slicer track playing `slicer`, right after the audio clip's track, with a
   * clip at the audio clip's place that plays the slices in order (one undo step). Returns the
   * new track's id.
   */
  chopClipToSlicer: (clipId: string, slicer: SlicerSettings) => string | null;

  // Master Studio FX
  masterReverbDecay: number;
  masterDelayTime: string;
  masterDelayFeedback: number;
  setMasterReverbDecay: (decay: number) => void;
  setMasterDelayTime: (time: string) => void;
  setMasterDelayFeedback: (feedback: number) => void;

  // Master section: the OTT and stereo width inserts between the master compressor and the limiter (saved, undoable)
  master: MasterSettings;
  /** Change the OTT. `record` makes it its own undo step (menus); switches checkpoint() first and sliders once per gesture. */
  setMasterOtt: (patch: Partial<MasterSettings['ott']>, record?: boolean) => void;
  /** Change the stereo width, recorded like setMasterOtt. */
  setMasterWidth: (patch: Partial<MasterSettings['width']>, record?: boolean) => void;

  // Clips
  selectClip: (clipId: string, additive: boolean) => void;
  clearSelection: () => void;
  moveClip: (clipId: string, startBar: number) => void;
  trimClipStart: (clipId: string, newStartBar: number) => void;
  trimClipEnd: (clipId: string, newLengthBars: number) => void;
  splitClip: (clipId: string, atBar: number) => void;
  duplicateClip: (clipId: string) => string | null;
  deleteSelectedClips: () => void;
  /** Move several clips at once, optionally onto other tracks (no history: drags checkpoint() once). */
  moveClips: (moves: ReadonlyArray<ClipMove>) => void;

  // Copies of the selection. The selected clips count as one block from the first start to the
  // last end, so copies of a section across several tracks stay lined up. Each is one undo step and
  // selects the copies. They return a message for the user when there's no room, else null.
  /** One copy of the block right after it (Ctrl+D). Copies nothing if it would pass the end of the timeline. */
  duplicateSelection: () => string | null;
  /** `times` copies of the block end to end. Copies nothing if they wouldn't all fit. */
  repeatSelection: (times: number) => string | null;
  /** Copies of the block end to end up to the loop's Out; the last one is cut short at Out. */
  fillSelectionToLoopOut: () => string | null;

  // Ripple edits: add or remove time across every track
  /** Insert `bars` empty bars at `atBar`: later clips move right, clips across it are split. */
  insertBars: (atBar: number, bars: number) => string | null;
  /** Remove the bars from `fromBar` to `toBar`: clips inside go, later clips move left. */
  removeBars: (fromBar: number, toBar: number) => string | null;
  /**
   * A build-up into a drop at `dropBar` (one undo step): riser and snare roll over the bars
   * before it, an impact on it, and markers. Returns a message when it can't.
   */
  addBuildAndDrop: (dropBar: number) => string | null;
  /** Move every pitched note from `fromBar` on by `semitones` (a key change), one undo step. A message back means nothing moved. */
  keyChangeFrom: (fromBar: number, semitones: number) => string | null;
  /**
   * Rebuild the song from its sections (see cutToLength.ts) in `order`, a repeat playing twice, as
   * one undo step; `bpm`, when given, is the tempo that makes it last exactly the length asked.
   */
  cutToLength: (order: number[], bpm: number | null) => string | null;
  /** Dip every track's volume where `spans` (song seconds) have dialogue, as automation (one undo step). Returns how many tracks. */
  dipUnderDialogue: (spans: Array<{ start: number; end: number }>, shape: DipShape) => number;

  /** Game stingers (see stingers.ts): saved with the project, not undo steps */
  stingers: Stinger[];
  addStinger: (kind: StingerKind) => Stinger;
  updateStinger: (id: string, patch: Partial<Omit<Stinger, 'id'>>) => void;
  deleteStinger: (id: string) => void;
  /** Intensity, 0 to 1 (see intensity.ts), and each stem group's curve */
  intensity: number;
  intensityCurves: Record<string, IntensityCurve>;
  setIntensity: (value: number) => void;
  setIntensityCurve: (group: string, curve: IntensityCurve) => void;
  /** Make a track a dialogue / SFX proxy the others duck under by `depth` dB, or not (null); one undo step */
  setTrackDuckProxy: (trackId: string, depth: number | null, record?: boolean) => void;
  /** Put a track in a stem group (or none, with an empty name); one undo step */
  setTrackStemGroup: (trackId: string, group: string) => void;
  /** Transitions into game states, by section marker id ('cut' is left out) */
  transitions: Record<string, TransitionRule>;
  /** Set the rule from one state to another (marker ids; ANY_STATE as `from` for any), or remove it with null */
  setTransitionRule: (from: string, to: string, rule: TransitionRule | null) => void;
  /** Put a stinger on the timeline at `bar`, on a new track of its instrument (one undo step) */
  placeStinger: (id: string, bar: number) => string | null;

  // Clipboard
  /** Snapshot of copied clips; startBar is relative to the earliest copied clip (0 = paste point). */
  clipboard: Clip[];
  /** Instrument of the track the clipboard was copied from, or null if it came from several tracks. */
  clipboardInstrument: InstrumentKey | null;
  /** The tempo at the copy: audio clips pasted at another tempo keep their length in seconds. */
  clipboardBpm: number;
  copySelectedClips: () => void;
  cutSelectedClips: () => void;
  /**
   * Paste onto each clip's original track at `atBar` (defaults to the playhead, snapped). With
   * `ontoTrackId`, clips copied from one track go onto that track instead, if its instrument fits.
   */
  pasteClips: (atBar?: number, ontoTrackId?: string) => void;

  // Selection
  /** Replace the selection with exactly these clip ids (marquee / select all). */
  setSelection: (clipIds: Set<string>) => void;
  selectAll: () => void;

  // History: clips, tracks, the mixer and markers. Tempo, swing, loop, zoom, snap and frame rate are not undoable.
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Snapshot clips, tracks, mixer and markers before an edit. Gestures (drags, slider moves) call this once at their start. */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;

  // Project
  /** The last autosave attempt (null until the first one this session). */
  autosaveStatus: AutosaveStatus | null;
  projectName: string;
  setProjectName: (name: string) => void;
  /** Replace the arrangement with a blank timeline or the demo song. Clears undo history. */
  /** Replace the arrangement with a blank one, the demo song or a genre starter (see starters.ts). */
  newProject: (template: 'blank' | 'demo' | StarterId) => void;
  /** Replace the arrangement with a loaded project. Clears undo history. */
  loadProject: (project: ProjectSnapshot) => void;
  /** Drop one of the instrument's stock patterns onto a track (undoable). */
  insertPatternClip: (trackId: string, patternId: string, atBar: number) => void;

  // Creating and editing clips
  /** Add an empty clip (undoable) and return its id. */
  createEmptyClip: (trackId: string, atBar: number, lengthBars: number) => string | null;
  /** Drop a deck sound or pattern on a track: into the clip under `bar`, else as a new clip (undoable). */
  dropOnTrack: (trackId: string, bar: number, payload: DragPayload) => void;
  renameClip: (clipId: string, name: string) => void;
  /** Set how fast a Wobble / Growl Bass clip wobbles (undoable). */
  setClipWobble: (clipId: string, wobble: WobbleRate) => void;
  /** Add notes to a clip (undoable). Returns the new note ids. */
  addNotes: (clipId: string, notes: Omit<NoteEvent, 'id'>[]) => string[];
  /** Replace a clip's notes without recording history (drag gestures checkpoint() once first). */
  setClipNotes: (clipId: string, notes: NoteEvent[]) => void;
  deleteNotes: (clipId: string, noteIds: Set<string>) => void;

  // Piano roll
  editingClipId: string | null;
  openEditor: (clipId: string) => void;
  closeEditor: () => void;

  // Recording (MIDI takes). A take is what's played between record start and stop (or between
  // the record mode or the arm switching on and off while playing), placed as one clip on the
  // armed track, from the first whole bar it started or played in to the bar line nearest where
  // it stopped (or the end of its last note). Notes sit where they were heard against the music;
  // with the loop on, every pass adds to the same take. The take is one undo step; quantize,
  // applied on stop, is a second one. Pause and Stop end the take and switch Record off, so
  // Play then plays it back.
  /** Count-in, quantize and metronome settings, kept per browser (not in the project). */
  recordOptions: RecordOptions;
  setRecordOptions: (patch: Partial<RecordOptions>) => void;
  /** The take being recorded (the lane marks it), null between takes. */
  take: { trackId: string; startBar: number } | null;
  /**
   * Punch in/out: while it's on, a recording keeps only what's played from `inBar` to `outBar`
   * (the music plays from wherever it's started), and its clip is exactly that span.
   */
  punch: { enabled: boolean; inBar: number; outBar: number };
  setPunch: (patch: Partial<{ enabled: boolean; inBar: number; outBar: number }>) => void;

  /** Instrument currently being dragged from the sound deck (lanes highlight to match). */
  draggingInstrument: InstrumentKey | null;
  setDraggingInstrument: (instrument: InstrumentKey | null) => void;
  /** Tracks the clips being dragged could move to (those lanes highlight), null when not dragging clips. */
  clipDragTargets: ReadonlySet<string> | null;
  setClipDragTargets: (trackIds: ReadonlySet<string> | null) => void;

  // Automation (the lanes live on the tracks, so undo covers them)
  /** Which tracks' lanes show automation, and the setting shown (a view setting: not saved or undone). */
  automationView: Record<string, AutomationViewState>;
  /** Show or hide a track's automation (toggles without `open`), optionally switching the setting shown. */
  showAutomation: (trackId: string, open?: boolean, param?: AutomationParam) => void;
  /**
   * Replace a lane's points (making the lane if needed). `record` makes it its own undo step
   * (clicks, menus); drags checkpoint() once and leave it false. A Filter lane's first points
   * switch the Filter on, in the same step. `selection` becomes the selected points.
   */
  setAutomationPoints: (trackId: string, param: AutomationParam, points: AutomationPoint[], record: boolean, selection?: ReadonlySet<AutomationPoint>) => void;
  /** Delete a lane, points and all (undoable). */
  removeAutomationLane: (trackId: string, param: AutomationParam) => void;
  /** Selected points (in one lane), for Delete; null when none. */
  automationSelection: AutomationSelection | null;
  selectAutomationPoints: (selection: AutomationSelection | null) => void;
  /** Delete the selected points (undoable). False if none were selected. */
  deleteSelectedAutomationPoints: () => boolean;
}

export interface AutomationViewState {
  open: boolean;
  param: AutomationParam;
}

export interface AutomationSelection {
  trackId: string;
  param: AutomationParam;
  /** The selected point objects (edits replace moved points, and the selection with them) */
  points: ReadonlySet<AutomationPoint>;
}

/** Where one clip goes in moveClips. */
export interface ClipMove {
  clipId: string;
  startBar: number;
  /** Omit to keep the clip on its track. */
  trackId?: string;
}

/** Shortest clip the edits make: the store's floor for trims, a 16th. */
const MIN_CLIP_BARS = 0.0625;

/**
 * Cut a clip in two at `atBar` (a song position). Notes go to the side they start on; the right
 * half gets new ids and is unselected; an audio clip's right half plays on from where the cut
 * falls in its sound (at `bpm`). Null if `atBar` isn't inside the clip.
 */
export function splitClipAt(clip: Clip, atBar: number, tempo: Tempo): [Clip, Clip] | null {
  const local = tempoAt(clip.startBar, tempo);
  const rel = atBar - clip.startBar;
  if (rel <= EPS || rel >= clip.lengthBars - EPS) return null;
  const left: Clip = {
    ...clip,
    lengthBars: rel,
    notes: clip.notes.filter((n) => n.startOffset < rel - EPS),
  };
  // Expression lanes split with the notes: the right half starts where the lanes were at the cut
  const leftExpr = shiftExpression(clip.expression, 0, rel);
  const rightExpr = shiftExpression(clip.expression, -rel, clip.lengthBars - rel);
  if (leftExpr) left.expression = leftExpr;
  else delete left.expression;
  const right: Clip = {
    ...clip,
    id: uid('clip'),
    startBar: atBar,
    lengthBars: clip.lengthBars - rel,
    isSelected: false,
    notes: clip.notes
      .filter((n) => n.startOffset >= rel - EPS)
      .map((n) => ({ ...n, id: uid('note'), startOffset: n.startOffset - rel })),
    ...(clip.audio ? { audio: splitAudio(clip.audio, audioShift(clip.audio, rel, local)) } : {}),
  };
  if (rightExpr) right.expression = rightExpr;
  else delete right.expression;
  // A take folder's takes split with it
  const takes = splitTakes(clip, rel, clip.audio ? audioShift(clip.audio, rel, local) : 0, () => uid('note'));
  if (takes) return [{ ...left, ...takes[0] }, { ...right, ...takes[1] }];
  return [left, right];
}

/** A track for `instrumentKey` with the usual starting settings, named after it (numbered after those already there). */
function makeTrack(instrumentKey: InstrumentKey, existing: Track[], name?: string): Track {
  const meta = INSTRUMENTS[instrumentKey];
  const count = existing.filter((t) => t.instrumentKey === instrumentKey).length;
  return {
    id: uid('track'),
    name: name || (count > 0 ? `${meta.name} ${count + 1}` : meta.name),
    color: meta.color,
    instrumentKey,
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    volume: 0,
    pan: 0,
    eq: { low: 0, mid: 0, high: 0 },
    fx: instrumentKey === 'return' ? returnFx() : defaultTrackFx(),
    reverbSend: 0.1,
    delaySend: 0,
    expressive: true,
  };
}

/** A return's effects start fully wet (the dry sound plays from the tracks that send to it), so its Delay and Reverb show the mix they'll use. */
function returnFx(): Track['fx'] {
  const fx = defaultTrackFx();
  return { ...fx, echo: { ...fx.echo, mix: 1 }, reverb: { ...fx.reverb, mix: 1 } };
}

/** A selected copy of a clip `offset` bars later, with fresh clip and note ids. */
function copyClip(clip: Clip, offset: number): Clip {
  return {
    ...clip,
    id: uid('clip'),
    startBar: clip.startBar + offset,
    isSelected: true,
    notes: clip.notes.map((n) => ({ ...n, id: uid('note') })),
  };
}

/**
 * The selected clips as one block: where it starts and how long it is (first start to last end).
 * Null if nothing is selected, or if the block is shorter than any clip can be (only a damaged
 * project file could give one), since copies of it would never get anywhere.
 */
function selectionBlock(clips: Clip[]): { selected: Clip[]; start: number; span: number } | null {
  const selected = clips.filter((c) => c.isSelected);
  if (selected.length === 0) return null;
  const start = Math.min(...selected.map((c) => c.startBar));
  const end = Math.max(...selected.map((c) => c.startBar + c.lengthBars));
  return end - start >= MIN_CLIP_BARS - EPS ? { selected, start, span: end - start } : null;
}

/**
 * Most clips one Fill may add. Fill's number of copies comes from the block's length, not from the
 * user, so a tiny block could make thousands; past this the timeline takes seconds to redraw.
 */
const MAX_FILL_CLIPS = 2000;

const countOf = (n: number) => n.toLocaleString('en-US');

const pluralBars = (n: number) => `${formatBarCount(n)} bar${n === 1 ? '' : 's'}`;

export interface AutosaveStatus {
  ok: boolean;
  /** When it was attempted (ms since epoch) */
  at: number;
  /** Why it failed (see AutosaveFailure) */
  reason?: AutosaveFailure;
}

/** The store's master reverb / delay settings as one object. */
function masterFxOf(s: { masterReverbDecay: number; masterDelayTime: string; masterDelayFeedback: number }): MasterFx {
  return { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback };
}

let rafId = 0;
let tapTimes: number[] = [];
/**
 * The last jump to a marker while playing (where, and when by performance.now()). For a moment
 * after a seek the playhead still shows the place before it (that audio is already scheduled), so
 * a quick second press of , or . counts from here rather than land on the same marker again.
 */
let lastJump: { bar: number; at: number } | null = null;

/**
 * The previous session, set aside once at startup before autosave can overwrite it (this module
 * loads before anything can edit). The app always opens on an empty timeline; this is only
 * offered as "Restore last session". Null if there was nothing worth restoring (no clips).
 */
/** Called whenever another song replaces the open one (New, Open, a link, Restore). */
const replacedListeners = new Set<() => void>();
export function onProjectReplaced(listener: () => void): () => void {
  replacedListeners.add(listener);
  return () => replacedListeners.delete(listener);
}

/** The session the Restore banner offers: the last one at startup, or the song that New, Open or a link replaced. */
export const useLastSession = create<{ session: SavedSession | null }>(() => ({ session: preservePreviousSession() }));


const clampBar = (bar: number) => Math.max(1, Math.min(TOTAL_BARS + 1, bar));

/**
 * The view patch that brings `bar` on screen, page-turn style as the view follows the playhead
 * while playing (`fromStart`: at the very start if it fits there), or nothing if it's on screen.
 */
function viewShowing(s: TimelineState, bar: number, fromStart = false): Partial<TimelineState> {
  const x = (bar - 1) * s.zoom;
  const room = s.viewWidth - 24;
  if (!fromStart && x >= s.viewLeft && x <= s.viewLeft + room) return {};
  const left = fromStart && x <= room ? 0 : x - 24;
  return { viewLeft: Math.max(0, Math.min(TOTAL_BARS * s.zoom - s.viewWidth, left)), viewJumps: s.viewJumps + 1 };
}

/**
 * Time signature changes in order, each on a measure start of the meter before it, dropping any
 * that change nothing.
 */
function tidyMeters(points: MeterPoint[], base: Meter): MeterPoint[] {
  const out: MeterPoint[] = [];
  let current = base;
  for (const p of sortedPoints(points)) {
    const bar = nearestMeasureStart(p.bar, { base, points: out });
    if (bar <= 1 + 1e-6 || out.some((o) => Math.abs(o.bar - bar) < 1e-6)) continue;
    if (p.num === current.num && p.den === current.den) continue;
    out.push({ ...p, bar });
    current = p;
  }
  return out;
}

export const useTimelineStore = create<TimelineState>((set, get) => {
  /**
   * Change one track. `record` makes it its own undo step (clicks, menus); continuous controls
   * (sliders) leave it false because their gesture checkpoint()s once at its start.
   */
  const updateTrack = (trackId: string, patch: (t: Track) => Partial<Track>, record = false) =>
    set((s) => {
      if (!s.tracks.some((t) => t.id === trackId)) return s;
      return {
        tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...patch(t) } : t)),
        ...(record ? pushPast(s) : {}),
      };
    });

  /** Push the master reverb / delay settings (and tempo, for the delay time) to the live mix. */
  /**
   * Change the tempo points (one undo step): audio clips keep their seconds and markers held to
   * their time keep their timecode, so both are retimed along the new map.
   */
  const retempo = (edit: (points: TempoPoint[]) => TempoPoint[], record = true) =>
    set((s) => {
      const tempoPoints = sortedPoints(edit(s.tempoPoints));
      const to = songTempo({ bpm: s.bpm, tempoPoints });
      return { tempoPoints, clips: retimeAudioClips(s.clips, songTempo(s), to), markers: retimeMarkers(s.markers, to), ...(record ? pushPast(s) : {}) };
    });

  const applyMasterFx = () => {
    liveMix.busFx.apply(masterFxOf(get()), get().bpm);
    setLiveStripTempo(get().bpm);
  };
  /** Push the master section's settings (OTT, width) to the live mix. */
  const applyMaster = () => liveMix.inserts.apply(get().master);
  const setMaster = (next: (m: MasterSettings) => MasterSettings, record: boolean) => {
    set((s) => {
      const master = normalizeMasterSettings(next(s.master));
      if (sameMasterSettings(master, s.master)) return s;
      return { master, ...(record ? pushPast(s) : {}) };
    });
    applyMaster();
  };

  /** Silences the clicks of a count-in still running (Pause or Stop during it). */
  let stopCountIn: (() => void) | null = null;

  /** Begin recording onto `trackId` from `startBar`, the Transport starting (or being) at audio time `startAudio`. */
  const startTake = (trackId: string, startBar: number, startAudio: number) => {
    beginTake(trackId, startBar, startAudio, () => get().loopRegion);
    set({ take: { trackId, startBar } });
  };

  /** Where a take begun while playing starts: at the Transport's start if a count-in is still running, else now (as heard). */
  const takeStartAudio = () => transportStartsAt() ?? heardTime();

  /**
   * End the take where the listener is now (heard time) and put it on its track as a clip,
   * selected, named "Take N" (one undo step), then quantized if that's on (a second step, so
   * Ctrl+Z puts the notes back where they were played). Nothing is added for a take with no
   * notes, or whose track has gone.
   */
  const endTake = () => {
    stopCountIn?.();
    stopCountIn = null;
    const s = get();
    const options = s.recordOptions;
    const punch = s.punch.enabled ? { inBar: s.punch.inBar, outBar: s.punch.outBar } : null;
    const result = finishTake(heardTime(), songTempo(s), { passes: options.takes, punch });
    if (s.take) set({ take: null });
    if (!result) return;
    const { trackId } = result;
    if (!s.tracks.some((t) => t.id === trackId)) return;
    const takeClip: TakeClip = result.clip;
    const grid = options.quantize;
    const withIds = (notes: TakeClip['notes']) => notes.map((n) => ({ ...n, id: uid('note') }));
    const played = (takeClip.takes ?? [takeClip]).map((t) => ({ notes: withIds(t.notes), ...(t.expression ? { expression: t.expression } : {}) }));
    // With takes on, recording over a clip of the same span adds to it as more takes
    const same = options.takes
      ? s.clips.find((c) => c.trackId === trackId && !c.audio && Math.abs(c.startBar - takeClip.startBar) < EPS && Math.abs(c.lengthBars - takeClip.lengthBars) < EPS)
      : undefined;
    if (same || played.length > 1) {
      // A take folder: quantized as it's made (one undo step), each take as it was played otherwise
      const q = (notes: NoteEvent[]) => (grid === 'off' ? notes : quantizeTakeClip({ ...(same ?? ({} as Clip)), startBar: takeClip.startBar, lengthBars: takeClip.lengthBars, notes } as Clip, grid).notes);
      let folder: Clip = same ?? {
        id: uid('clip'),
        trackId,
        name: `Take ${Math.max(0, ...s.clips.filter((c) => c.trackId === trackId).map((c) => Number(/^Take (\d+)$/.exec(c.name)?.[1] ?? 0))) + 1}`,
        startBar: takeClip.startBar,
        lengthBars: takeClip.lengthBars,
        notes: q(played[0].notes),
        isSelected: true,
        ...(played[0].expression ? { expression: played[0].expression } : {}),
      };
      for (const [i, t] of played.entries()) {
        if (!same && i === 0) {
          folder = { ...folder, takes: [{ id: uid('take'), name: 'Take 1', notes: folder.notes, ...(t.expression ? { expression: t.expression } : {}) }] };
          continue;
        }
        folder = addTake(folder, { id: uid('take'), name: `Take ${(folder.takes?.length ?? 1) + 1}`, notes: q(t.notes), ...(t.expression ? { expression: t.expression } : {}) });
      }
      folder = { ...applyComp(folder, () => uid('note')), isSelected: true };
      set((st) => ({
        clips: same
          ? st.clips.map((c) => (c.id === same.id ? folder : c.isSelected ? { ...c, isSelected: false } : c))
          : [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), folder],
        ...pushPast(st),
      }));
      return;
    }
    // One past the highest "Take N" already on the track
    const taken = s.clips.filter((c) => c.trackId === trackId).map((c) => Number(/^Take (\d+)$/.exec(c.name)?.[1] ?? 0));
    const clip: Clip = {
      id: uid('clip'),
      trackId,
      name: `Take ${Math.max(0, ...taken) + 1}`,
      startBar: takeClip.startBar,
      lengthBars: takeClip.lengthBars,
      notes: played[0].notes,
      isSelected: true,
      ...(takeClip.expression ? { expression: takeClip.expression } : {}),
    };
    set((st) => ({
      clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), clip],
      ...pushPast(st),
    }));
    if (grid === 'off') return;
    const quantized = quantizeTakeClip(clip, grid);
    set((st) => ({ clips: st.clips.map((c) => (c.id === clip.id ? quantized : c)), ...pushPast(st) }));
  };

  const updateClip = (clipId: string, patch: (c: Clip) => Partial<Clip>) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...patch(c) } : c)) }));

  /**
   * Finish an insert / remove-bars edit: the new clips (one undo step), then everything else placed
   * on the timeline moved by the same rule, so it stays with the music: the edit's rules (see
   * rippleRules) for a position and the loop region, `moveLane` for an automation lane's points,
   * `moveMarkers` for the markers. Anything new that sits at a song position belongs here too.
   */
  const applyRipple = (
    clips: Clip[],
    edit: RippleEdit,
    moveLane: (points: AutomationPoint[]) => AutomationPoint[],
    moveMarkers: (markers: Marker[], tempo: TempoMap) => Marker[]
  ) => {
    const { movePoint, moveLoop } = rippleRules(edit);
    const s = get();
    // Tempo and time signature changes move with the music after the edit (and go with removed bars)
    const shift = <P extends { bar: number }>(points: P[]): P[] =>
      edit.kind === 'insert'
        ? points.map((p) => (p.bar >= edit.at - EPS ? { ...p, bar: p.bar + edit.bars } : p))
        : shiftTempoPoints(points.filter((p) => !(p.bar >= edit.from - EPS && p.bar < edit.to - EPS)), edit.from, -(edit.to - edit.from));
    let tempoPoints = s.tempoPoints.length ? sortedPoints(shift(s.tempoPoints)) : s.tempoPoints;
    // Deleting bars that held tempo changes: the music after them keeps the tempo it had
    if (edit.kind !== 'insert' && edit.from > 1 + 1e-6 && s.tempoPoints.some((p) => p.bar >= edit.from - EPS && p.bar < edit.to - EPS)) {
      const keep = tempoAt(edit.to, songTempo(s));
      if (Math.abs(tempoAt(edit.from - 1e-6, songTempo({ bpm: s.bpm, tempoPoints })) - keep) > 1e-6 && !tempoPoints.some((p) => Math.abs(p.bar - edit.from) < 1e-6)) {
        tempoPoints = sortedPoints([...tempoPoints, { id: uid('tempo'), bar: edit.from, bpm: keep, ramp: false }]);
      }
    }
    const meterPoints = s.meterPoints.length ? tidyMeters(shift(s.meterPoints), s.meter) : s.meterPoints;
    const tempoChanged = tempoPoints.some((p, i) => p.bar !== s.tempoPoints[i]?.bar) || tempoPoints.length !== s.tempoPoints.length;
    const meterChanged = meterPoints.some((p, i) => p.bar !== s.meterPoints[i]?.bar) || meterPoints.length !== s.meterPoints.length;
    const clipsChanged = clips.length !== s.clips.length || clips.some((c, i) => c !== s.clips[i]);
    const tracks = s.tracks.map((t) => {
      if (!t.automation) return t;
      const automation = t.automation.map((lane) => {
        const points = moveLane(lane.points);
        return points === lane.points ? lane : { ...lane, points };
      });
      return automation.some((lane, i) => lane !== t.automation![i]) ? { ...t, automation } : t;
    });
    const tracksChanged = tracks.some((t, i) => t !== s.tracks[i]);
    const loopRegion = moveLoop(s.loopRegion);
    const loopChanged = loopRegion.inBar !== s.loopRegion.inBar || loopRegion.outBar !== s.loopRegion.outBar;
    const markers = moveMarkers(s.markers, songTempo({ bpm: s.bpm, tempoPoints }));
    const markersChanged = markers !== s.markers;
    const playhead = clampBar(movePoint(s.playheadPosition));
    const ripple: RippleMove = {
      before: { inBar: s.loopRegion.inBar, outBar: s.loopRegion.outBar, playhead: s.playheadPosition },
      after: { inBar: loopRegion.inBar, outBar: loopRegion.outBar, playhead },
      edit,
    };
    // One undo step for all of it, even when only the loop or the playhead moved
    set((st) => ({
      ...(clipsChanged || tracksChanged || markersChanged || loopChanged || tempoChanged || meterChanged || playhead !== s.playheadPosition ? pushPast(st, ripple) : {}),
      ...(clipsChanged || tracksChanged || markersChanged ? { clips, tracks, markers } : {}),
      ...(tempoChanged ? { tempoPoints } : {}),
      ...(meterChanged ? { meterPoints } : {}),
      ...(tracksChanged ? { automationSelection: null } : {}),
      ...(loopChanged ? { loopRegion } : {}),
    }));
    if (playhead !== s.playheadPosition) get().seek(playhead);
  };

  /**
   * Get an opened project's sounds ready: the ones a saved file embeds go into the sound library,
   * every sound it refers to is decoded, and a Sampler from before the library (its sound carried as
   * a data: URL on the track) is moved into the library and the track pointed at it instead, so
   * the autosave stops carrying the file. Nothing here is an edit of the user's, so no history.
   */
  const prepareSounds = (p: ProjectSnapshot) => {
    // Sounds carried in the file go into the library first, then everything is loaded from there
    const ensureAll = () => {
      for (const id of referencedSoundIds(p)) ensureSound(id);
    };
    if (p.sounds?.length) void importEmbeddedSounds(p.sounds).then(ensureAll, ensureAll);
    else ensureAll();
    for (const t of p.tracks) {
      const sample = t.sample;
      if (!sample?.dataUrl || sample.soundId) continue;
      importDataUrl(sample.dataUrl, sample.name).then(
        (meta) =>
          set((s) => {
            // Only if it's still that track with that sound (another project may have been opened meanwhile)
            const track = s.tracks.find((tr) => tr.id === t.id && tr.sample === sample);
            if (!track) return s;
            return { tracks: s.tracks.map((tr) => (tr === track ? { ...tr, sample: { name: sample.name, soundId: meta.id, root: sample.root } } : tr)) };
          }),
        () => {} // unreadable, or storage blocked: it goes on playing (and being saved) as a data: URL
      );
    }
  };

  const frame = () => {
    const pos = getAudiblePositionBar();
    const { loopRegion } = get();
    if (!loopRegion.enabled && pos >= TOTAL_BARS + 1) {
      get().stop();
      return;
    }
    set({ playheadPosition: Math.max(1, pos) });
    rafId = requestAnimationFrame(frame);
  };

  const stopFrameLoop = () => {
    cancelAnimationFrame(rafId);
    rafId = 0;
  };

  return {
    tracks: INITIAL_TRACKS.map((t) => ({ ...t })),
    clips: [],
    playheadPosition: 1,
    isPlaying: false,
    isRecording: false,
    bpm: 122,
    tempoPoints: [],
    meter: FOUR_FOUR,
    meterPoints: [],
    swing: 0.2,
    zoom: 160,
    activeTool: 'select',
    snapGrid: '1/16',
    loopRegion: { inBar: 1, outBar: 5, enabled: true },
    markers: [],
    fps: DEFAULT_FRAME_RATE,
    dropFrame: false,
    rulerUnits: 'bars',
    viewLeft: 0,
    viewWidth: 1200,
    viewJumps: 0,
    projectName: 'Untitled',
    selectedTrackId: INITIAL_TRACKS[0]?.id ?? null,
    isInspectorOpen: false,
    masterReverbDecay: 2.4,
    masterDelayTime: '8n',
    masterDelayFeedback: 0.35,
    master: defaultMasterSettings(),
    past: [],
    future: [],

    // ---------- Transport ----------
    play: async () => {
      await initAudio();
      if (get().isPlaying) return;
      const s = get();
      const armed = s.isRecording ? s.tracks.find((t) => t.isArmed) : undefined;
      // A count-in: a bar of clicks first, the Transport (and the take) starting after them
      // A measure of the time signature there, at the tempo there
      const countMeter = meterAt(s.playheadPosition, songMeterOf(s));
      const beat = 240 / tempoAt(s.playheadPosition, songTempo(s)) / countMeter.den;
      const countIn = armed && s.recordOptions.countIn ? countMeter.num : 0;
      const at = liveMix.bus.context.now() + 0.03 + countIn * beat;
      startTransportAt(s.playheadPosition, at);
      if (countIn) stopCountIn = countInClicks(at, countIn, beat);
      if (armed) startTake(armed.id, s.playheadPosition, at);
      set({ isPlaying: true });
      stopFrameLoop();
      rafId = requestAnimationFrame(frame);
    },

    pause: () => {
      if (!get().isPlaying) return;
      const pos = getAudiblePositionBar();
      endTake();
      pauseTransport();
      stopFrameLoop();
      releaseAllVoices();
      set({ isPlaying: false, isRecording: false, playheadPosition: clampBar(pos) });
    },

    togglePlay: async () => {
      if (get().isPlaying) get().pause();
      else await get().play();
    },

    stop: () => {
      if (get().isPlaying) endTake();
      stopTransport();
      stopFrameLoop();
      releaseAllVoices();
      set({ isPlaying: false, isRecording: false, playheadPosition: get().loopRegion.inBar });
    },

    seek: (bar, reveal = false) => {
      const target = clampBar(bar);
      if (get().isPlaying) {
        seekTransport(target);
        // Moved during the count-in: the take starts where the music now will
        const pending = transportStartsAt();
        const take = get().take;
        if (pending !== null && take) startTake(take.trackId, target, pending);
      }
      set((s) => ({ playheadPosition: target, ...(reveal ? viewShowing(s, target) : {}) }));
    },

    toggleRecord: () => {
      const s = get();
      if (s.isRecording) {
        // Off while playing: the take ends here and playback goes on
        if (s.isPlaying) endTake();
        set({ isRecording: false });
        return;
      }
      set({ isRecording: true });
      // On while playing: a take starts here (a punch-in), no count-in
      const armed = s.tracks.find((t) => t.isArmed);
      if (s.isPlaying && armed) startTake(armed.id, getAudiblePositionBar(), takeStartAudio());
    },

    setBpm: (bpm) => {
      // Hundredths, so a tempo fitted to a video length lands within a frame or so
      const clamped = clampBpm(bpm);
      // Markers held to their time stay at the same timecode, so their bars move; audio clips keep
      // their length in seconds, so their bars change too
      set((s) => {
        const to = songTempo({ bpm: clamped, tempoPoints: s.tempoPoints });
        return { bpm: clamped, markers: retimeMarkers(s.markers, to), clips: retimeAudioClips(s.clips, songTempo(s), to) };
      });
    },

    scaleTempo: (factor) => {
      const s = get();
      const all = [s.bpm, ...s.tempoPoints.map((p) => p.bpm)].map((b) => Math.round(b * factor * 100) / 100);
      if (all.some((b) => b < 40 || b > 240)) return 'That would take a tempo outside 40 to 240 BPM.';
      const bpm = all[0];
      const tempoPoints = s.tempoPoints.map((p, i) => ({ ...p, bpm: all[i + 1] }));
      const to = songTempo({ bpm, tempoPoints });
      set({ bpm, tempoPoints, markers: retimeMarkers(s.markers, to), clips: retimeAudioClips(s.clips, songTempo(s), to), ...pushPast(s) });
      return null;
    },

    addTempoChange: (bar, bpm, ramp = false) => {
      const id = uid('tempo');
      const at = Math.max(1 + 1 / 16, Math.min(TOTAL_BARS, bar));
      retempo((pts) => [...pts.filter((p) => Math.abs(p.bar - at) > 1e-6), { id, bar: at, bpm: clampBpm(bpm), ramp }]);
      return id;
    },
    updateTempoChange: (id, patch, record = true) =>
      retempo((pts) =>
        pts.map((p) => {
          if (p.id !== id) return p;
          // Onto another change's bar it doesn't go (one of the two would be lost): it stays put
          const bar = patch.bar === undefined ? p.bar : Math.max(1 + 1 / 16, Math.min(TOTAL_BARS, patch.bar));
          const free = !pts.some((o) => o.id !== id && Math.abs(o.bar - bar) < 1e-6);
          return {
                ...p,
                ...(free ? { bar } : {}),
                ...(patch.bpm !== undefined ? { bpm: clampBpm(patch.bpm) } : {}),
                ...(patch.ramp !== undefined ? { ramp: patch.ramp } : {}),
              };
        }),
        record
      ),
    removeTempoChange: (id) => retempo((pts) => pts.filter((p) => p.id !== id)),

    setMeter: (meter) => set((s) => ({ meter: { num: meter.num, den: meter.den }, meterPoints: tidyMeters(s.meterPoints, meter), ...pushPast(s) })),
    addMeterChange: (bar, meter) => {
      const s = get();
      const at = nearestMeasureStart(bar, songMeterOf(s));
      if (at <= 1 + 1e-6) {
        get().setMeter(meter);
        return null;
      }
      const id = uid('meter');
      set((st) => ({ meterPoints: tidyMeters([...st.meterPoints.filter((p) => Math.abs(p.bar - at) > 1e-6), { id, bar: at, num: meter.num, den: meter.den }], st.meter), ...pushPast(st) }));
      return id;
    },
    updateMeterChange: (id, patch, record = true) =>
      set((s) => {
        const others = { base: s.meter, points: s.meterPoints.filter((p) => p.id !== id) };
        const self = s.meterPoints.find((p) => p.id === id);
        let bar = self?.bar ?? 1;
        if (self && patch.bar !== undefined) {
          // Moved only between its neighbours, and not onto bar 1: passing one would swallow it
          const sorted = sortedPoints(s.meterPoints);
          const i = sorted.findIndex((p) => p.id === id);
          const lo = sorted[i - 1]?.bar ?? 1;
          const hi = sorted[i + 1]?.bar ?? Infinity;
          const next = nearestMeasureStart(patch.bar, others);
          if (next > lo + 1e-6 && next < hi - 1e-6) bar = next;
        }
        const points = s.meterPoints.map((p) => (p.id === id ? { ...p, ...patch, bar } : p));
        return { meterPoints: tidyMeters(points, s.meter), ...(record ? pushPast(s) : {}) };
      }),
    removeMeterChange: (id) => set((s) => ({ meterPoints: tidyMeters(s.meterPoints.filter((p) => p.id !== id), s.meter), ...pushPast(s) })),

    tapTempo: () => {
      const now = performance.now();
      if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2500) tapTimes = [];
      tapTimes.push(now);
      if (tapTimes.length > 5) tapTimes.shift();
      if (tapTimes.length >= 2) {
        const intervals = tapTimes.slice(1).map((t, i) => t - tapTimes[i]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        // Whole BPM: tapping isn't precise enough for decimals to mean anything
        get().setBpm(Math.round(60000 / avg)); // setBpm clamps to 40-240
      }
    },

    setSwing: (swing) => set({ swing: Math.max(0, Math.min(0.5, swing)) }),

    // ---------- View / tools ----------
    setZoom: (zoom, anchorBar) =>
      set((s) => {
        const next = Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)));
        if (next === s.zoom) return s;
        const playheadX = (s.playheadPosition - 1) * s.zoom - s.viewLeft;
        const anchor =
          anchorBar ??
          (playheadX >= 0 && playheadX <= s.viewWidth ? s.playheadPosition : (s.viewLeft + s.viewWidth / 2) / s.zoom + 1);
        // Where the anchor sits on screen now; the timeline scrolls to viewLeft after it re-lays out
        const anchorX = (anchor - 1) * s.zoom - s.viewLeft;
        const maxLeft = Math.max(0, TOTAL_BARS * next - s.viewWidth);
        return { zoom: next, viewLeft: Math.max(0, Math.min(maxLeft, (anchor - 1) * next - anchorX)) };
      }),
    setTool: (tool) => set({ activeTool: tool }),
    setSnapGrid: (grid) => set({ snapGrid: grid }),
    setFps: (fps, dropFrame = false) => {
      if (isFrameRate(fps)) set({ fps, dropFrame: dropFrame && fps === 29.97 });
    },
    setRulerUnits: (units) => set({ rulerUnits: units }),
    setView: (left, width) => set((s) => (s.viewLeft === left && s.viewWidth === width ? s : { viewLeft: left, viewWidth: width })),

    // ---------- Loop ----------
    setLoopIn: (bar) =>
      set((s) => {
        const inBar = clampBar(snapBar(bar, s.snapGrid, s));
        const minLen = minClipLength(s.snapGrid, s);
        const outBar = s.loopRegion.outBar - inBar < minLen ? clampBar(snapBar(inBar + 1, s.snapGrid, s)) : s.loopRegion.outBar;
        return { loopRegion: { ...s.loopRegion, inBar: Math.min(inBar, outBar - minLen), outBar } };
      }),

    setLoopOut: (bar) =>
      set((s) => {
        const outBar = clampBar(snapBar(bar, s.snapGrid, s));
        const minLen = minClipLength(s.snapGrid, s);
        const inBar = outBar - s.loopRegion.inBar < minLen ? Math.max(1, snapBar(outBar - 1, s.snapGrid, s)) : s.loopRegion.inBar;
        return { loopRegion: { ...s.loopRegion, outBar: Math.max(outBar, inBar + minLen), inBar } };
      }),

    setLoopRange: (inBar, outBar) => {
      const a = clampBar(inBar);
      const b = clampBar(outBar);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b - a < 0.0625 - EPS) return false;
      set((s) => ({ loopRegion: { ...s.loopRegion, inBar: a, outBar: b } }));
      return true;
    },

    toggleLoop: () => set((s) => ({ loopRegion: { ...s.loopRegion, enabled: !s.loopRegion.enabled } })),

    // ---------- Markers ----------
    addMarker: (bar) => {
      const s = get();
      const marker = createMarker(bar ?? s.playheadPosition, songTempo(s), nextMarkerName(s.markers));
      // Pressing M twice (or holding it) shouldn't stack markers on one spot
      const there = s.markers.find((m) => Math.abs(m.bar - marker.bar) < EPS);
      if (there) return `"${there.name}" is already at ${formatBarsBeats(there.bar)}.`;
      set((st) => ({ markers: retimeMarkers([...st.markers, marker], songTempo(st)), ...pushPast(st) }));
      return null;
    },

    addHit: () => {
      const s = get();
      let highest = 0;
      for (const m of s.markers) {
        const n = /^Hit (\d+)$/.exec(m.name);
        if (n) highest = Math.max(highest, Number(n[1]));
      }
      const marker = anchorMarker(createMarker(s.playheadPosition, songTempo(s), `Hit ${highest + 1}`), 'time');
      const there = s.markers.find((m) => Math.abs(m.bar - marker.bar) < EPS);
      if (there) return `"${there.name}" is already at ${formatBarsBeats(there.bar)}.`;
      set((st) => ({ markers: retimeMarkers([...st.markers, marker], songTempo(st)), ...pushPast(st) }));
      return null;
    },

    addHitsAt: (seconds, prefix) => {
      const s = get();
      const frame = 1 / s.fps;
      let highest = 0;
      const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
      for (const m of s.markers) {
        const n = re.exec(m.name);
        if (n) highest = Math.max(highest, Number(n[1]));
      }
      const added: Marker[] = [];
      for (const t of [...seconds].sort((a, b) => a - b)) {
        const bar = secondsToBar(t, songTempo(s));
        if (t < 0 || bar > TOTAL_BARS + 1) continue;
        if ([...s.markers, ...added].some((m) => Math.abs(m.seconds - t) < frame)) continue;
        added.push(anchorMarker(createMarker(bar, songTempo(s), `${prefix} ${++highest}`), 'time'));
      }
      if (added.length) set((st) => ({ markers: retimeMarkers([...st.markers, ...added], songTempo(st)), ...pushPast(st) }));
      return added.length;
    },

    moveMarker: (id, bar) =>
      set((s) => {
        const marker = s.markers.find((m) => m.id === id);
        const moved = marker && placeMarker(marker, bar, songTempo(s));
        if (!marker || !moved || moved.bar === marker.bar) return s;
        return { markers: retimeMarkers(s.markers.map((m) => (m === marker ? moved : m)), songTempo(s)) };
      }),

    renameMarker: (id, name, record = false) =>
      set((s) => {
        const marker = s.markers.find((m) => m.id === id);
        const clean = cleanMarkerName(name);
        if (!marker || !clean || clean === marker.name) return s;
        return { markers: s.markers.map((m) => (m === marker ? { ...m, name: clean } : m)), ...(record ? pushPast(s) : {}) };
      }),

    setMarkerAnchor: (id, anchor) =>
      set((s) => {
        const marker = s.markers.find((m) => m.id === id);
        if (!marker || marker.anchor === anchor) return s;
        return { markers: s.markers.map((m) => (m === marker ? anchorMarker(m, anchor) : m)), ...pushPast(s) };
      }),

    deleteMarker: (id) =>
      set((s) => (s.markers.some((m) => m.id === id) ? { markers: s.markers.filter((m) => m.id !== id), ...pushPast(s) } : s)),

    jumpToMarker: (direction) => {
      const s = get();
      const now = performance.now();
      const halfSecond = (0.5 * tempoAt(s.playheadPosition, songTempo(s))) / 240;
      // Pressed again within half a second of a jump while the Transport is still on from that
      // marker (not moved since by a click on the ruler or round the loop): count from the marker
      const sinceJump = lastJump && now - lastJump.at < 500 ? getScheduledPositionBar() - lastJump.bar : NaN;
      const fromJump = s.isPlaying && lastJump && sinceJump > -0.01 && sinceJump < 2 * halfSecond ? lastJump.bar : null;
      // Otherwise, playing, the playhead is a little past a marker it has just reached: going back
      // skips one passed less than half a second ago, so pressing , again keeps going back
      const gap = s.isPlaying && fromJump === null ? halfSecond : 0;
      const marker = adjacentMarker(s.markers, fromJump ?? s.playheadPosition, direction, gap);
      if (!marker) return false;
      s.seek(marker.bar, true);
      lastJump = s.isPlaying ? { bar: marker.bar, at: now } : null;
      return true;
    },

    // ---------- Tracks & Inspector ----------
    selectTrack: (id) => set({ selectedTrackId: id }),
    toggleInspector: (open) => set((s) => ({ isInspectorOpen: open !== undefined ? open : !s.isInspectorOpen })),

    addTrack: (instrumentKey, name) => {
      const made = makeTrack(instrumentKey, get().tracks, name);
      // A bus or a return sends nothing to the reverb itself unless asked: its tracks have their own sends
      const newTrack = isMixTrack(made) ? { ...made, reverbSend: 0, delaySend: 0 } : made;
      set((s) => ({
        tracks: [...s.tracks, newTrack],
        selectedTrackId: newTrack.id,
        isInspectorOpen: true,
        ...pushPast(s),
      }));
      if (hasRecordings(instrumentKey)) void loadSamples(instrumentKey).catch(() => {});
      return newTrack.id;
    },

    addPluginTrack: (url, name) => {
      const made = makeTrack('plugin', get().tracks, name);
      const track: Track = { ...made, plugin: { id: uid('plugin'), url, name } };
      set((s) => ({ tracks: [...s.tracks, track], selectedTrackId: track.id, isInspectorOpen: true, ...pushPast(s) }));
      return track.id;
    },

    addTrackPluginFx: (trackId, url, name) => {
      const id = uid('plugin');
      const s = get();
      // (Not on a bus: its tracks' plugins play through it, and a bus plays no instrument to put one after)
      if (!s.tracks.some((t) => t.id === trackId && !isBus(t))) return null;
      set((st) => ({
        tracks: st.tracks.map((t) => (t.id === trackId ? { ...t, pluginFx: [...(t.pluginFx ?? []), { id, url, name }] } : t)),
        ...pushPast(st),
      }));
      return id;
    },

    removeTrackPluginFx: (trackId, pluginId) =>
      set((s) => ({
        tracks: s.tracks.map((t) => {
          if (t.id !== trackId || !t.pluginFx) return t;
          const left = t.pluginFx.filter((p) => p.id !== pluginId);
          const { pluginFx: _gone, ...rest } = t;
          return left.length ? { ...t, pluginFx: left } : rest;
        }),
        ...pushPast(s),
      })),

    setPluginBypass: (trackId, pluginId, bypass) =>
      set((s) => ({
        tracks: s.tracks.map((t) =>
          t.id === trackId && t.pluginFx ? { ...t, pluginFx: t.pluginFx.map((p) => (p.id === pluginId ? { ...p, bypass } : p)) } : t
        ),
        ...pushPast(s),
      })),

    setPluginStates: (states) =>
      set((s) => {
        let changed = false;
        const withState = (p: WamPlugin) => {
          if (!states.has(p.id) || JSON.stringify(p.state) === JSON.stringify(states.get(p.id))) return p;
          changed = true;
          return { ...p, state: states.get(p.id) };
        };
        const tracks = s.tracks.map((t) => {
          if (!(t.plugin && states.has(t.plugin.id)) && !t.pluginFx?.some((p) => states.has(p.id))) return t;
          const plugin = t.plugin && withState(t.plugin);
          const pluginFx = t.pluginFx?.map(withState);
          if (plugin === t.plugin && (pluginFx ?? []).every((p, i) => p === t.pluginFx![i])) return t;
          return { ...t, ...(plugin ? { plugin } : {}), ...(pluginFx ? { pluginFx } : {}) };
        });
        return changed ? { tracks } : s;
      }),

    setTrackSend: (trackId, returnId, level, record = true) =>
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId);
        const ret = s.tracks.find((t) => t.id === returnId);
        if (!track || !ret || !isReturn(ret) || isReturn(track)) return s;
        const rest = (track.sends ?? []).filter((x) => x.to !== returnId);
        const had = track.sends?.find((x) => x.to === returnId);
        if (level === null ? !had : had?.level === level) return s;
        const sends = level === null ? rest : [...(track.sends ?? []).map((x) => (x.to === returnId ? { ...x, level: Math.max(0, Math.min(1, level)) } : x)), ...(had ? [] : [{ to: returnId, level: Math.max(0, Math.min(1, level)) }])];
        const next: Track = { ...track };
        if (sends.length) next.sends = sends;
        else delete next.sends;
        return { tracks: s.tracks.map((t) => (t === track ? next : t)), ...(record ? pushPast(s) : {}) };
      }),

    mapMidi: (trackId, cc, param) =>
      set((s) => {
        if (!s.tracks.some((t) => t.id === trackId)) return s;
        const tracks = s.tracks.map((t) => {
          const kept = (t.midiMap ?? []).filter((m) => m.cc !== cc && !(t.id === trackId && m.param === param));
          const midiMap = t.id === trackId ? [...kept, { cc, param }] : kept;
          if (midiMap.length === (t.midiMap?.length ?? 0) && midiMap.every((m, i) => m === t.midiMap![i])) return t;
          const next: Track = { ...t, midiMap };
          if (!midiMap.length) delete next.midiMap;
          return next;
        });
        return { tracks, ...pushPast(s) };
      }),

    unmapMidi: (trackId, cc) =>
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId);
        if (!track?.midiMap?.some((m) => m.cc === cc)) return s;
        const midiMap = track.midiMap.filter((m) => m.cc !== cc);
        const next: Track = { ...track, midiMap };
        if (!midiMap.length) delete next.midiMap;
        return { tracks: s.tracks.map((t) => (t === track ? next : t)), ...pushPast(s) };
      }),

    setTrackSendPre: (trackId, returnId, pre) =>
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId);
        const send = track?.sends?.find((x) => x.to === returnId);
        if (!track || !send || !!send.pre === pre) return s;
        const sends = track.sends!.map((x) => (x.to === returnId ? (pre ? { ...x, pre: true } : (({ pre: _p, ...rest }) => rest)(x)) : x));
        return { tracks: s.tracks.map((t) => (t === track ? { ...t, sends } : t)), ...pushPast(s) };
      }),

    addReturn: (trackId, name) => {
      const s = get();
      const count = s.tracks.filter(isReturn).length;
      const made = makeTrack('return', s.tracks, name?.trim() || `Return ${count + 1}`);
      const ret: Track = { ...made, reverbSend: 0, delaySend: 0 };
      set((st) => ({
        tracks: [
          ...st.tracks.map((t) => (t.id === trackId && !isMixTrack(t) ? { ...t, sends: [...(t.sends ?? []).filter((x) => x.to !== ret.id), { to: ret.id, level: 0.5 }] } : t)),
          ret,
        ],
        selectedTrackId: ret.id,
        isInspectorOpen: true,
        ...pushPast(st),
      }));
      return ret.id;
    },

    setTrackOutput: (trackId, busId) => {
      const s = get();
      const track = s.tracks.find((t) => t.id === trackId);
      if (!track) return false;
      if (busId !== null && (wouldLoop(trackId, busId, s.tracks) || !s.tracks.some((t) => t.id === busId && isBus(t)))) return false;
      if ((track.output ?? null) === busId) return true;
      set((st) => ({
        tracks: st.tracks.map((t) => {
          if (t.id !== trackId) return t;
          if (busId) return { ...t, output: busId };
          const { output: _gone, ...rest } = t;
          return rest;
        }),
        ...pushPast(st),
      }));
      return true;
    },

    setTakeComp: (clipId, from, to, take) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        if (!clip?.takes?.length) return s;
        const kept = keepNoteEdits(clip);
        const next = applyComp({ ...kept, comp: setCompRange(kept, from, to, take) }, () => uid('note'));
        return { clips: s.clips.map((c) => (c === clip ? next : c)), ...pushPast(s) };
      }),

    deleteTake: (clipId, take) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        if (!clip?.takes?.length) return s;
        const left = removeTake(keepNoteEdits(clip), take);
        const next = left ? applyComp(left, () => uid('note')) : null;
        const flat = next && next.takes!.length > 1 ? next : flattenTakes(next ?? clip);
        return { clips: s.clips.map((c) => (c === clip ? flat : c)), ...pushPast(s) };
      }),

    flattenClipTakes: (clipId) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        if (!clip?.takes?.length) return s;
        // A mic folder comped across takes can't be one sound: it stays the take its comp starts with
        // What it plays now, edits included
        return { clips: s.clips.map((c) => (c === clip ? flattenTakes(clip) : c)), ...pushPast(s) };
      }),

    addAudioTakes: (trackId, startBar, lengthBars, recorded, clipName) => {
      const s = get();
      const existing = trackId === null ? null : s.tracks.find((t) => t.id === trackId);
      if (!recorded.length || (trackId !== null && (!existing || !isAudioKind(existing.instrumentKey)))) return null;
      const track = existing ?? makeTrack('audio', s.tracks);
      recorded.forEach((r) => ensureSound(r.audio.soundId));
      const same = s.recordOptions.takes
        ? s.clips.find((c) => c.trackId === track.id && c.audio && Math.abs(c.startBar - startBar) < EPS && Math.abs(c.lengthBars - lengthBars) < EPS)
        : undefined;
      let clip: Clip = same ?? { id: uid('clip'), trackId: track.id, name: clipName, startBar, lengthBars, notes: [], isSelected: true, audio: recorded[0].audio };
      for (const [i, r] of recorded.entries()) {
        if (!same && i === 0) continue;
        clip = addTake(clip, { id: uid('take'), name: r.name ?? `Take ${(clip.takes?.length ?? 1) + 1}`, audio: r.audio });
      }
      if (clip.takes) clip = { ...applyComp(clip, () => uid('note')), takes: clip.takes.map((t, i) => (i === 0 && !same ? { ...t, name: recorded[0].name ?? t.name } : t)) };
      const done = { ...clip, isSelected: true };
      set((st) => ({
        ...(existing ? {} : { tracks: [...st.tracks, track], selectedTrackId: track.id }),
        clips: same ? st.clips.map((c) => (c.id === same.id ? done : c.isSelected ? { ...c, isSelected: false } : c)) : [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), done],
        ...pushPast(st),
      }));
      return done.id;
    },

    setClipExpression: (clipId, lane, points, record = true) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        if (!clip || clip.audio) return s;
        const tidy = tidyLane(points, lane);
        const expression = { ...clip.expression };
        if (tidy.length) expression[lane] = tidy;
        else delete expression[lane];
        const next: Clip = { ...clip };
        if (Object.keys(expression).length) next.expression = expression;
        else delete next.expression;
        return { clips: s.clips.map((c) => (c === clip ? next : c)), ...(record ? pushPast(s) : {}) };
      }),

    setNoteExpression: (clipId, noteId, lane, points, record = true) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        const note = clip?.notes.find((n) => n.id === noteId);
        if (!clip || !note) return s;
        const tidy = tidyNoteLane(points, lane, durationToBars(note.duration));
        const expr = { ...note.expr };
        if (tidy.length) expr[lane] = tidy;
        else delete expr[lane];
        const next: NoteEvent = { ...note };
        if (Object.keys(expr).length) next.expr = expr;
        else delete next.expr;
        return { clips: s.clips.map((c) => (c === clip ? { ...c, notes: c.notes.map((n) => (n === note ? next : n)) } : c)), ...(record ? pushPast(s) : {}) };
      }),

    groupIntoBus: (trackIds, name) => {
      const s = get();
      const ids = new Set(trackIds.filter((id) => s.tracks.some((t) => t.id === id && !isBus(t))));
      if (!ids.size) return null;
      const members = s.tracks.filter((t) => ids.has(t.id));
      const busCount = s.tracks.filter(isBus).length;
      const bus: Track = { ...makeTrack('bus', s.tracks, name?.trim() || `Bus ${busCount + 1}`), reverbSend: 0, color: members[0].color };
      // A bus the tracks already shared, the new one plays into
      const shared = members.every((t) => t.output && t.output === members[0].output) ? members[0].output : undefined;
      if (shared) bus.output = shared;
      const lastIndex = Math.max(...members.map((t) => s.tracks.indexOf(t)));
      const last = s.tracks[lastIndex];
      // Into the members' folder if they share one; else after the last member's folder, not inside it
      const sameFolder = last.folder && members.every((t) => t.folder?.id === last.folder!.id) ? last.folder : undefined;
      if (sameFolder) bus.folder = sameFolder;
      let at = lastIndex + 1;
      if (last.folder && !sameFolder) while (at < s.tracks.length && s.tracks[at].folder?.id === last.folder.id) at++;
      const tracks = s.tracks.map((t) => (ids.has(t.id) ? { ...t, output: bus.id } : t));
      tracks.splice(at, 0, bus);
      set({ tracks, selectedTrackId: bus.id, ...pushPast(s) });
      return bus.id;
    },

    // Undoable: history entries carry the tracks, so Undo brings the track and its clips back together
    groupIntoFolder: (trackIds, name) => {
      const s = get();
      const ids = new Set(trackIds.filter((id) => s.tracks.some((t) => t.id === id)));
      if (!ids.size) return null;
      const first = s.tracks.find((t) => ids.has(t.id))!;
      const folder: TrackFolder = { id: uid('folder'), name: name?.trim() || `Folder ${foldersOf(s.tracks).length + 1}`, color: first.color };
      set({ tracks: groupTracks(s.tracks, ids, folder), ...pushPast(s) });
      return folder.id;
    },

    ungroupFolder: (folderId) =>
      set((s) => {
        const tracks = ungroup(s.tracks, folderId);
        return tracks === s.tracks ? s : { tracks, ...pushPast(s) };
      }),

    setFolder: (folderId, patch, recolor = false) =>
      set((s) => {
        const tracks = updateFolder(s.tracks, folderId, patch, recolor);
        if (tracks === s.tracks) return s;
        // Folding is a view: no undo step
        const viewOnly = Object.keys(patch).every((k) => k === 'collapsed');
        return { tracks, ...(viewOnly ? {} : pushPast(s)) };
      }),

    setTrackFolder: (trackId, folderId) =>
      set((s) => {
        const tracks = moveToFolder(s.tracks, trackId, folderId);
        return tracks === s.tracks ? s : { tracks, ...pushPast(s) };
      }),

    moveTrackRow: (trackId, direction) =>
      set((s) => {
        const tracks = moveTrack(s.tracks, trackId, direction);
        return tracks === s.tracks ? s : { tracks, ...pushPast(s) };
      }),

    setTrackColor: (trackId, color) => updateTrack(trackId, () => ({ color }), true),

    toggleFolderMute: (folderId) =>
      set((s) => {
        const members = s.tracks.filter((t) => t.folder?.id === folderId);
        if (!members.length) return s;
        const mute = !members.every((t) => t.isMuted);
        return { tracks: s.tracks.map((t) => (t.folder?.id === folderId ? { ...t, isMuted: mute } : t)), ...pushPast(s) };
      }),

    toggleFolderSolo: (folderId) =>
      set((s) => {
        const members = s.tracks.filter((t) => t.folder?.id === folderId);
        if (!members.length) return s;
        const solo = !members.every((t) => t.isSoloed);
        return { tracks: s.tracks.map((t) => (t.folder?.id === folderId ? { ...t, isSoloed: solo } : t)), ...pushPast(s) };
      }),

    deleteTrack: (id) => {
      // A take being recorded onto it lands first (its own undo step), so Ctrl+Z brings both back
      if (get().take?.trackId === id) endTake();
      set((s) => {
        if (!s.tracks.some((t) => t.id === id)) return s;
        // Tracks that played into it (a bus) play to the master again
        const nextTracks = tidySends(tidyRoutes(s.tracks.filter((t) => t.id !== id)));
        const nextSelected = s.selectedTrackId === id ? nextTracks[0]?.id ?? null : s.selectedTrackId;
        return {
          tracks: nextTracks,
          clips: s.clips.some((c) => c.trackId === id) ? s.clips.filter((c) => c.trackId !== id) : s.clips,
          selectedTrackId: nextSelected,
          ...pushPast(s),
        };
      });
    },

    setTrackInstrument: (id, instrumentKey) => {
      const current = get().tracks.find((t) => t.id === id);
      if (!current || current.instrumentKey === instrumentKey) return;
      // A bus or a Plugin track is made as one (Add Track), not by switching an instrument: a bus
      // can't hold the clips a track has, and a Plugin track needs its plugin
      if (isMixTrack({ instrumentKey }) || instrumentKey === 'plugin') return;
      const meta = INSTRUMENTS[instrumentKey];
      updateTrack(
        id,
        () => ({
          instrumentKey,
          name: meta.name,
          color: meta.color,
          // A Plugin track's plugin goes with its instrument (its effects stay)
          plugin: undefined,
        }),
        true
      );
      // A bus that becomes an instrument: the tracks that played into it go back to the master
      if (isMixTrack(current)) set((s) => ({ tracks: tidySends(tidyRoutes(s.tracks)) }));
      if (hasRecordings(instrumentKey)) void loadSamples(instrumentKey).catch(() => {});
    },

    toggleMute: (id) => updateTrack(id, (t) => ({ isMuted: !t.isMuted }), true),
    setTrackMuted: (id, muted) => {
      if (get().tracks.find((t) => t.id === id)?.isMuted !== muted) updateTrack(id, () => ({ isMuted: muted }));
    },
    toggleSolo: (id) => updateTrack(id, (t) => ({ isSoloed: !t.isSoloed }), true),

    // One track records at a time: arming one disarms the others, and selects it, so what's played
    // sounds on the track it's going to. Playing in record mode, the take moves to it at once.
    toggleArm: (id) => {
      const s = get();
      const track = s.tracks.find((t) => t.id === id);
      // Takes are note clips, which an Audio track can't hold
      if (!track || (!track.isArmed && (isAudioKind(track.instrumentKey) || isMixTrack(track)))) return;
      const arming = !track.isArmed;
      if (s.isPlaying && s.isRecording) endTake();
      set((st) => ({
        tracks: st.tracks.map((t) => (t.id === id ? { ...t, isArmed: arming } : t.isArmed ? { ...t, isArmed: false } : t)),
        ...(arming ? { selectedTrackId: id } : {}),
        ...pushPast(st),
      }));
      if (arming && s.isPlaying && s.isRecording) startTake(id, getAudiblePositionBar(), takeStartAudio());
    },
    setTrackVolume: (id, db) => updateTrack(id, () => ({ volume: Math.max(-60, Math.min(6, db)) })),
    setTrackPan: (id, pan) => updateTrack(id, () => ({ pan: Math.max(-1, Math.min(1, pan)) })),

    setTrackEq: (id, eqPatch) => {
      updateTrack(id, (t) => ({
        eq: {
          low: eqPatch.low !== undefined ? Math.max(-24, Math.min(12, eqPatch.low)) : t.eq.low,
          mid: eqPatch.mid !== undefined ? Math.max(-24, Math.min(12, eqPatch.mid)) : t.eq.mid,
          high: eqPatch.high !== undefined ? Math.max(-24, Math.min(12, eqPatch.high)) : t.eq.high,
        },
      }));
    },

    resetTrackEq: (id) => {
      const { eq } = get().tracks.find((t) => t.id === id) ?? {};
      if (!eq || (eq.low === 0 && eq.mid === 0 && eq.high === 0)) return;
      updateTrack(id, () => ({ eq: { low: 0, mid: 0, high: 0 } }), true);
    },

    setTrackReverbSend: (id, send) => {
      updateTrack(id, () => ({
        reverbSend: Math.max(0, Math.min(1, send)),
      }));
    },

    setTrackDelaySend: (id, send) => {
      updateTrack(id, () => ({
        delaySend: Math.max(0, Math.min(1, send)),
      }));
    },

    setTrackSample: (id, sample) => updateTrack(id, () => ({ sample }), true),

    setTrackExpressive: (id, on) => updateTrack(id, () => ({ expressive: on }), true),

    // ---------- Audio clips and the Slicer ----------
    addAudioClips: (trackId, atBar, sounds) => {
      const s = get();
      const existing = trackId === null ? null : s.tracks.find((t) => t.id === trackId);
      if (trackId !== null && (!existing || !isAudioKind(existing.instrumentKey))) return null;
      const track = existing ?? makeTrack('audio', s.tracks);
      const clips: Clip[] = [];
      let at = clampBar(atBar);
      // End to end, each as long as its sound (the last ones cut short at the end of the timeline)
      for (const sound of sounds) {
        const room = TOTAL_BARS + 1 - at;
        if (room < MIN_CLIP_BARS - EPS) break;
        ensureSound(sound.id);
        const lengthBars = Math.max(MIN_CLIP_BARS, Math.min(sound.seconds / secondsPerBar(tempoAt(at, songTempo(s))), room));
        clips.push({
          id: uid('clip'),
          trackId: track.id,
          name: clipNameFromFile(sound.name),
          startBar: at,
          lengthBars,
          notes: [],
          isSelected: true,
          audio: { soundId: sound.id, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 },
        });
        at += lengthBars;
      }
      if (!clips.length) return `No room for a clip at bar ${formatBarCount(at)}: the timeline ends at bar ${TOTAL_BARS + 1}.`;
      set((st) => ({
        ...(existing ? {} : { tracks: [...st.tracks, track], selectedTrackId: track.id }),
        clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), ...clips],
        ...pushPast(st),
      }));
      return null;
    },

    setClipAudio: (clipId, patch, record = false) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        const audio = clip?.audio && normalizeClipAudio({ ...clip.audio, ...patch });
        if (!clip?.audio || !audio) return s;
        if (patch.tunedFrom === undefined && 'tunedFrom' in patch) delete audio.tunedFrom;
        const same =
          (['soundId', 'offset', 'gain', 'fadeIn', 'fadeOut', 'tunedFrom', 'reversedFrom'] as const).every((k) => audio[k] === clip.audio![k]) &&
          JSON.stringify(audio.warp ?? []) === JSON.stringify(clip.audio.warp ?? []) &&
          JSON.stringify(audio.envelope ?? []) === JSON.stringify(clip.audio.envelope ?? []);
        if (same) return s;
        // (Unchanged markers and envelope keep their arrays, so nothing downstream sees a change)
        if (audio.warp && JSON.stringify(audio.warp) === JSON.stringify(clip.audio.warp ?? [])) audio.warp = clip.audio.warp;
        if (audio.envelope && JSON.stringify(audio.envelope) === JSON.stringify(clip.audio.envelope ?? [])) audio.envelope = clip.audio.envelope;
        return { clips: s.clips.map((c) => (c === clip ? { ...c, audio } : c)), ...(record ? pushPast(s) : {}) };
      }),

    setClipStretch: (clipId, stretchBpm) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        if (!clip?.audio) return s;
        const audio = normalizeClipAudio({ ...clip.audio, stretchBpm });
        if (!audio || audio.stretchBpm === clip.audio.stretchBpm) return s;
        if (stretchBpm === undefined) delete audio.stretchBpm;
        // Warp markers keep their places in the sound's beats as its tempo changes
        if (audio.warp && clip.audio.stretchBpm && audio.stretchBpm) audio.warp = audio.warp.map((m) => ({ src: m.src, beat: (m.beat * audio.stretchBpm!) / clip.audio!.stretchBpm! }));
        // The same stretch of the sound, played at the new speed
        const local = tempoAt(clip.startBar, songTempo(s));
        const seconds = clip.lengthBars * secondsPerBar(local);
        const scale = clipSecondsAt(audio, sourceAt(clip.audio, seconds, local), local) / seconds;
        const lengthBars = Math.max(0.0625, Math.min(TOTAL_BARS + 1 - clip.startBar, clip.lengthBars * scale));
        // A take folder's comp keeps its place in the sound
        const comp = clip.comp?.map((seg) => ({ ...seg, at: seg.at * scale }));
        return { clips: s.clips.map((c) => (c === clip ? { ...c, lengthBars, audio, ...(comp ? { comp } : {}) } : c)), ...pushPast(s) };
      }),

    setTrackSynth: (trackId, synth, record = true) => updateTrack(trackId, () => ({ synth }), record),

    setTrackRack: (trackId, rack, record = true) => {
      for (const pad of rack?.pads ?? []) if (pad.soundId) ensureSound(pad.soundId);
      updateTrack(trackId, () => ({ rack }), record);
    },

    setTrackMulti: (trackId, multi, record = true) => {
      for (const zone of multi?.zones ?? []) ensureSound(zone.soundId);
      updateTrack(trackId, () => ({ multi }), record);
    },

    setTrackSlicer: (trackId, slicer, record = true) => {
      if (slicer) ensureSound(slicer.soundId);
      updateTrack(trackId, () => ({ slicer }), record);
    },

    chopClipToSlicer: (clipId, slicer) => {
      const s = get();
      const clip = s.clips.find((c) => c.id === clipId);
      const index = clip ? s.tracks.findIndex((t) => t.id === clip.trackId) : -1;
      if (!clip?.audio || index < 0) return null;
      ensureSound(slicer.soundId);
      // Next to the clip's track, in its folder if it's in one (so the folder stays in one piece)
      const source = s.tracks[index];
      const track: Track = { ...makeTrack('slicer', s.tracks), slicer, ...(source.folder ? { folder: source.folder } : {}) };
      const chopped: Clip = {
        id: uid('clip'),
        trackId: track.id,
        name: `${clip.name} chops`,
        startBar: clip.startBar,
        lengthBars: clip.lengthBars,
        notes: sliceNotes(slicer.slices, slicer.start, slicer.end, tempoAt(clip.startBar, songTempo(s))).map((n) => ({ ...n, id: uid('note') })),
        isSelected: true,
      };
      set((st) => ({
        tracks: [...st.tracks.slice(0, index + 1), track, ...st.tracks.slice(index + 1)],
        clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), chopped],
        selectedTrackId: track.id,
        isInspectorOpen: true,
        ...pushPast(st),
      }));
      return track.id;
    },

    setTrackFx: (id, effect, patch, record = false) => {
      updateTrack(id, (t) => ({ fx: normalizeTrackFx({ ...t.fx, [effect]: { ...t.fx[effect], ...patch } }) }), record);
    },

    setMasterReverbDecay: (decay) => {
      const clamped = Math.max(0.8, Math.min(12, decay));
      set({ masterReverbDecay: clamped });
      applyMasterFx();
    },

    setMasterDelayTime: (time) => {
      if (time === get().masterDelayTime) return;
      // A click on a subdivision is its own undo step (the sliders checkpoint per gesture)
      set((s) => ({ masterDelayTime: time, ...pushPast(s) }));
      applyMasterFx();
    },

    setMasterDelayFeedback: (feedback) => {
      const clamped = Math.max(0, Math.min(0.8, feedback));
      set({ masterDelayFeedback: clamped });
      applyMasterFx();
    },

    setMasterOtt: (patch, record = false) => setMaster((m) => ({ ...m, ott: { ...m.ott, ...patch } }), record),
    setMasterWidth: (patch, record = false) => setMaster((m) => ({ ...m, width: { ...m.width, ...patch } }), record),

    // ---------- Clips ----------
    selectClip: (clipId, additive) =>
      set((s) => ({
        clips: s.clips.map((c) =>
          c.id === clipId
            ? { ...c, isSelected: additive ? !c.isSelected : true }
            : additive
              ? c
              : c.isSelected
                ? { ...c, isSelected: false }
                : c
        ),
      })),

    clearSelection: () =>
      set((s) =>
        s.clips.some((c) => c.isSelected) ? { clips: s.clips.map((c) => ({ ...c, isSelected: false })) } : s
      ),

    // move / trim are called every pointermove during a drag, so they don't record history themselves
    moveClip: (clipId, startBar) =>
      updateClip(clipId, (c) => {
        const start = Math.max(1, Math.min(TOTAL_BARS + 1 - c.lengthBars, startBar));
        // An audio clip keeps its length in seconds: moved to where the tempo differs, its bars change
        if (!c.audio || c.audio.stretchBpm || !get().tempoPoints.length) return { startBar: start };
        const tempo = songTempo(get());
        const lengthBars = Math.min(TOTAL_BARS + 1 - start, (c.lengthBars * tempoAt(start, tempo)) / tempoAt(c.startBar, tempo));
        return { startBar: start, lengthBars };
      }),

    trimClipStart: (clipId, newStartBar) =>
      updateClip(clipId, (c) => {
        const bpm = tempoAt(c.startBar, songTempo(get()));
        const end = c.startBar + c.lengthBars;
        // An audio clip's left edge can go back no further than the start of its sound
        // (a take folder's: no earlier than the start of the sound of whichever take starts latest in it)
        const earliest = c.audio ? Math.max(1, ...[c.audio, ...(c.takes ?? []).map((t) => t.audio)].map((a) => (a ? audioTrimStartLimit({ ...c, audio: a }, bpm) : 1))) : 1;
        const start = Math.max(earliest, Math.min(end - 0.0625, newStartBar));
        const delta = start - c.startBar;
        // Notes keep their absolute song position; offsets shift so trimmed notes become hidden
        // (recoverable); an audio clip plays from further into (or back towards the start of) its sound
        return {
          startBar: start,
          lengthBars: end - start,
          notes: c.notes.map((n) => ({ ...n, startOffset: n.startOffset - delta })),
          ...(c.expression ? { expression: moveExpression(c.expression, -delta) } : {}),
          ...(c.audio ? { audio: trimAudioStart(c.audio, audioShift(c.audio, delta, bpm)) } : {}),
          ...trimTakes(c, delta, c.audio ? delta * secondsPerBar(bpm) * stretchRatio(c.audio, bpm) : 0),
        };
      }),

    trimClipEnd: (clipId, newLengthBars) =>
      updateClip(clipId, (c) => {
        // An audio clip ends where its sound does, at the latest
        const longest = c.audio ? audioLengthLimit(c.audio, soundSeconds(c.audio.soundId), tempoAt(c.startBar, songTempo(get()))) : Infinity;
        return { lengthBars: Math.max(0.0625, Math.min(TOTAL_BARS + 1 - c.startBar, longest, newLengthBars)) };
      }),

    splitClip: (clipId, atBar) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        const halves = clip && splitClipAt(clip, atBar, songTempo(s));
        if (!clip || !halves) return s;
        const idx = s.clips.indexOf(clip);
        const clips = [...s.clips];
        clips.splice(idx, 1, ...halves);
        return { clips, ...pushPast(s) };
      }),

    // Low-level: no history entry; callers checkpoint() once per gesture
    duplicateClip: (clipId) => {
      const clip = get().clips.find((c) => c.id === clipId);
      if (!clip) return null;
      const copy: Clip = {
        ...clip,
        id: uid('clip'),
        isSelected: false,
        notes: clip.notes.map((n) => ({ ...n, id: uid('note') })),
      };
      set((s) => ({ clips: [...s.clips, copy] }));
      return copy.id;
    },

    deleteSelectedClips: () =>
      set((s) => (s.clips.some((c) => c.isSelected) ? { clips: s.clips.filter((c) => !c.isSelected), ...pushPast(s) } : s)),

    moveClips: (moves) =>
      set((s) => {
        const byId = new Map(moves.map((m) => [m.clipId, m]));
        const trackIds = new Set(s.tracks.map((t) => t.id));
        let changed = false;
        const clips = s.clips.map((c) => {
          const m = byId.get(c.id);
          if (!m) return c;
          const startBar = Math.max(1, Math.min(TOTAL_BARS + 1 - c.lengthBars, m.startBar));
          const trackId = m.trackId !== undefined && trackIds.has(m.trackId) ? m.trackId : c.trackId;
          // Keep untouched clips identical so their (memoized) views don't re-render on every pointer move
          if (startBar === c.startBar && trackId === c.trackId) return c;
          changed = true;
          // An audio clip playing at its own speed keeps its length in seconds at the tempo it lands in
          if (c.audio && !c.audio.stretchBpm && s.tempoPoints.length && startBar !== c.startBar) {
            const tempo = songTempo(s);
            const ratio = tempoAt(startBar, tempo) / tempoAt(c.startBar, tempo);
            if (Math.abs(ratio - 1) > EPS) {
              return { ...c, startBar, trackId, lengthBars: c.lengthBars * ratio, ...(c.comp ? { comp: c.comp.map((seg) => ({ ...seg, at: seg.at * ratio })) } : {}) };
            }
          }
          return { ...c, startBar, trackId };
        });
        return changed ? { clips } : s;
      }),

    // ---------- Copies of the selection ----------
    duplicateSelection: () => get().repeatSelection(1),

    repeatSelection: (times) => {
      const block = selectionBlock(get().clips);
      const count = Math.floor(times);
      if (!block || !(count >= 1)) return null;
      // Whole copies of the block that fit before the end of the timeline
      const room = Math.floor((TOTAL_BARS + 1 - block.start - block.span) / block.span + EPS);
      if (room < count) {
        const end = `the end of the timeline (bar ${TOTAL_BARS + 1})`;
        return room <= 0 ? `No room for a copy before ${end}.` : `Only ${room} ${room === 1 ? 'copy fits' : 'copies fit'} before ${end}.`;
      }
      const copies = Array.from({ length: count }, (_, i) => block.selected.map((c) => copyClip(c, (i + 1) * block.span))).flat();
      set((s) => ({
        clips: [...s.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), ...copies],
        ...pushPast(s),
      }));
      return null;
    },

    fillSelectionToLoopOut: () => {
      const s = get();
      const block = selectionBlock(s.clips);
      if (!block) return null;
      const out = s.loopRegion.outBar;
      // Copies that start before Out (the last one may be cut short), counted before making any
      const passes = Math.max(0, Math.ceil((out - EPS - block.start) / block.span) - 1);
      if (passes * block.selected.length > MAX_FILL_CLIPS) {
        return `Filling to bar ${formatBarCount(out)} would make ${countOf(passes * block.selected.length)} clips; Fill makes at most ${countOf(MAX_FILL_CLIPS)} at a time. Move Out earlier, or fill with longer clips.`;
      }
      const copies: Clip[] = [];
      for (let k = 1; k <= passes; k++) {
        for (const c of block.selected) {
          const copy = copyClip(c, k * block.span);
          // The last pass is cut off at Out. Notes past the cut stay in the clip, hidden, as after a trim.
          const length = Math.min(c.lengthBars, out - copy.startBar);
          if (length >= MIN_CLIP_BARS - EPS) copies.push(length < c.lengthBars ? { ...copy, lengthBars: length } : copy);
        }
      }
      if (copies.length === 0) {
        return `Nothing fits between the selection and the loop's Out (bar ${formatBarCount(out)}). Move Out later first.`;
      }
      set((st) => ({
        clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), ...copies],
        ...pushPast(st),
      }));
      return null;
    },

    // ---------- Ripple edits ----------
    insertBars: (atBar, bars) => {
      const s = get();
      const at = clampBar(atBar);
      if (!(bars > 0)) return null;
      const clips: Clip[] = [];
      for (const c of s.clips) {
        const halves = splitClipAt(c, at, songTempo(s));
        if (halves) {
          // Across the insert point: split it there and move the right half
          const [left, right] = halves;
          clips.push(left, { ...right, startBar: right.startBar + bars, isSelected: c.isSelected });
        } else {
          clips.push(c.startBar >= at - EPS ? { ...c, startBar: c.startBar + bars } : c);
        }
      }
      if (clips.some((c) => c.startBar + c.lengthBars > TOTAL_BARS + 1 + EPS)) {
        return `Can't insert ${pluralBars(bars)}: clips would be pushed past the end of the timeline (bar ${TOTAL_BARS + 1}).`;
      }
      const pushedMarker = markerPushedPastEnd(s.markers, at, bars);
      if (pushedMarker) {
        return `Can't insert ${pluralBars(bars)}: the marker "${pushedMarker.name}" would be pushed past the end of the timeline (bar ${TOTAL_BARS + 1}).`;
      }
      applyRipple(
        clips,
        { kind: 'insert', at, bars },
        (points) => insertLaneBars(points, at, bars),
        (markers, tempo) => insertMarkerBars(markers, at, bars, tempo)
      );
      return null;
    },

    addBuildAndDrop: (dropBar) => {
      const s = get();
      const drop = Math.round(dropBar);
      const bars = Math.min(BUILD_BARS, drop - 1);
      if (bars < 1) return 'Pick a later bar: the build-up needs at least one bar before the drop.';
      if (drop + HIT_BARS > TOTAL_BARS + 1) return `Too close to the end of the timeline (bar ${TOTAL_BARS + 1}) for the drop hit.`;
      const from = drop - bars;
      const isFree = (t: Track, a: number, b: number) =>
        !s.clips.some((c) => c.trackId === t.id && c.startBar < b - EPS && c.startBar + c.lengthBars > a + EPS);
      // Onto an FX track and a drum track with room there, or new ones next to them
      const tracks = [...s.tracks];
      const fxTrack = tracks.find((t) => isFxKind(t.instrumentKey) && isFree(t, from, drop + HIT_BARS)) ?? makeTrack('fx', tracks, tracks.some((t) => isFxKind(t.instrumentKey)) ? 'Build FX' : undefined);
      if (!tracks.includes(fxTrack)) tracks.push(fxTrack);
      const kits = tracks.filter((t) => isDrumKind(t.instrumentKey));
      const rollTrack = kits.find((t) => isFree(t, from, drop)) ?? makeTrack(kits[0]?.instrumentKey ?? 'drumMachine', tracks, 'Snare Roll');
      if (!tracks.includes(rollTrack)) tracks.push(rollTrack);
      const parts = [
        partClip(fxTrack.id, 'Build-up', from, bars, toNotes(buildUpSteps(bars))),
        partClip(rollTrack.id, 'Snare roll', from, bars, toNotes(snareRollSteps(bars))),
        partClip(fxTrack.id, 'Drop hit', drop, HIT_BARS, toNotes(dropHitSteps())),
      ];
      const markers = [...s.markers];
      for (const [bar, name] of [[from, 'Build'], [drop, 'Drop']] as const) {
        if (!markers.some((m) => Math.abs(m.bar - bar) < EPS)) markers.push(createMarker(bar, songTempo(s), name));
      }
      set((st) => ({
        tracks,
        clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), ...parts],
        markers: retimeMarkers(markers, songTempo(st)),
        ...pushPast(st),
      }));
      return null;
    },

    intensity: 1,
    intensityCurves: {},
    setIntensity: (value) => set({ intensity: Math.max(0, Math.min(1, value)) }),
    setIntensityCurve: (group, curve) => set((s) => ({ intensityCurves: { ...s.intensityCurves, [group]: curve } })),
    setTrackDuckProxy: (trackId, depth, record = true) =>
      updateTrack(trackId, () => ({ duckProxy: depth === null ? undefined : { depth: Math.max(1, Math.min(30, depth)) } }), record),
    setTrackStemGroup: (trackId, group) => {
      const name = group.trim().slice(0, 40);
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track || (track.stemGroup ?? '') === name) return;
      updateTrack(
        trackId,
        (t) => {
          const { stemGroup: _old, ...rest } = t;
          return name ? { ...rest, stemGroup: name } : { ...rest, stemGroup: undefined };
        },
        true
      );
      // A new group starts from its default curve, kept with the project so it can be shaped
      if (name && !get().intensityCurves[name]) set((s) => ({ intensityCurves: { ...s.intensityCurves, [name]: defaultCurve(name) } }));
    },
    transitions: {},
    setTransitionRule: (from, to, rule) =>
      set((s) => {
        const next = { ...s.transitions };
        const key = transitionKey(from, to);
        if (!rule || (rule.kind === 'cut' && !rule.quantize && from === ANY_STATE)) delete next[key];
        else next[key] = rule;
        return { transitions: next };
      }),
    stingers: [],
    addStinger: (kind) => {
      const s = get();
      const stinger = createStinger(kind, detectKey(s.clips, s.tracks) ?? keyOf(0, 'major'), s.stingers);
      set({ stingers: [...s.stingers, stinger] });
      return stinger;
    },
    updateStinger: (id, patch) => set((s) => ({ stingers: s.stingers.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    deleteStinger: (id) => set((s) => ({ stingers: s.stingers.filter((x) => x.id !== id) })),
    placeStinger: (id, bar) => {
      const s = get();
      const stinger = s.stingers.find((x) => x.id === id);
      if (!stinger) return null;
      const at = clampBar(bar);
      if (at + stinger.lengthBars > TOTAL_BARS + 1 + EPS) return `Too close to the end of the timeline (bar ${TOTAL_BARS + 1}).`;
      const track = makeTrack(stinger.instrumentKey, s.tracks, stinger.name);
      const clip: Clip = {
        id: uid('clip'),
        trackId: track.id,
        name: stinger.name,
        startBar: at,
        lengthBars: stinger.lengthBars,
        isSelected: true,
        notes: fitNotesToRange(stinger.notes, INSTRUMENTS[stinger.instrumentKey].range).map((n) => ({ ...n, id: uid('note') })),
      };
      if (hasRecordings(track.instrumentKey)) void loadSamples(track.instrumentKey).catch(() => {});
      set((st) => ({
        tracks: [...st.tracks, track],
        clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), clip],
        ...pushPast(st),
      }));
      return null;
    },

    dipUnderDialogue: (spans, shape) => {
      const s = get();
      const dips = spans.map((sp) => ({ from: secondsToBar(sp.start, songTempo(s)), to: secondsToBar(sp.end, songTempo(s)) })).filter((d) => d.to > 1 && d.from < TOTAL_BARS + 1);
      if (!dips.length) return 0;
      const secondsPerBarNow = 240 / tempoAt(dips[0].from, songTempo(s));
      let changed = 0;
      const tracks = s.tracks.map((t) => {
        if (isAudioKind(t.instrumentKey) && !s.clips.some((c) => c.trackId === t.id)) return t;
        const lanes = t.automation ?? [];
        const old = lanes.find((l) => l.param === 'volume');
        const points = dipLane(old?.points ?? [], t.volume, dips, shape, secondsPerBarNow);
        changed++;
        const lane = { param: 'volume' as const, points };
        return { ...t, automation: old ? lanes.map((l) => (l === old ? lane : l)) : [...lanes, lane] };
      });
      set((st) => ({ tracks, ...pushPast(st) }));
      return changed;
    },

    cutToLength: (order, newBpm) => {
      const s = get();
      const sections = songSections(s.clips, s.markers, songMeterOf(s));
      if (!order.length || order.some((i) => !sections[i])) return 'Nothing to cut: the song has no sections.';
      // Each section's clips, cut at its edges, laid end to end
      const slice = (c: Clip, from: number, to: number): Clip | null => {
        let part: Clip | null = c;
        if (part.startBar < from - EPS) part = splitClipAt(part, from, songTempo(s))?.[1] ?? null;
        if (part && part.startBar + part.lengthBars > to + EPS) part = splitClipAt(part, to, songTempo(s))?.[0] ?? null;
        return part && part.startBar >= from - EPS && part.startBar + part.lengthBars <= to + EPS ? part : null;
      };
      const clips: Clip[] = [];
      const placed: Array<{ from: number; to: number; at: number; name: string }> = [];
      let cursor = 1;
      for (const i of order) {
        const sec = sections[i];
        for (const c of s.clips) {
          if (c.startBar >= sec.to - EPS || c.startBar + c.lengthBars <= sec.from + EPS) continue;
          const part = slice(c, sec.from, sec.to);
          if (part) clips.push({ ...copyClip(part, cursor - sec.from), isSelected: false });
        }
        placed.push({ from: sec.from, to: sec.to, at: cursor, name: sec.name });
        cursor += sec.to - sec.from;
      }
      if (cursor > TOTAL_BARS + 1) return `That would run past the end of the timeline (bar ${TOTAL_BARS + 1}).`;
      // Automation follows its section: the value at each edge, and the points in between
      const tracks = s.tracks.map((t) => {
        if (!t.automation?.length) return t;
        const automation = t.automation.map((lane) => {
          if (!lane.points.length) return lane;
          const points: AutomationPoint[] = [];
          for (const p of placed) {
            const shift = p.at - p.from;
            points.push({ bar: p.at, value: laneValueAt(lane.points, p.from)! });
            for (const q of lane.points) if (q.bar > p.from + EPS && q.bar < p.to - EPS) points.push({ bar: q.bar + shift, value: q.value });
            points.push({ bar: p.at + (p.to - p.from) - 1e-3, value: laneValueAt(lane.points, p.to - 1e-3)! });
          }
          return { ...lane, points: normalizePoints(points) };
        });
        return { ...t, automation };
      });
      const bpm = newBpm ? clampBpm(newBpm) : s.bpm;
      // Tempo changes follow their sections too: the tempo at each section's start, and the
      // changes inside it (scaled with the song's tempo when the length was fitted)
      const scale = bpm / s.bpm;
      const oldTempo = songTempo(s);
      const tempoPoints: TempoPoint[] = s.tempoPoints.length
        ? sortedPoints(
            placed.flatMap((p) => [
              ...(p.at > 1 + EPS ? [{ id: uid('tempo'), bar: p.at, bpm: clampBpm(tempoAt(p.from, oldTempo) * scale), ramp: false }] : []),
              ...s.tempoPoints.filter((q) => q.bar > p.from + EPS && q.bar < p.to - EPS).map((q) => ({ ...q, id: uid('tempo'), bar: q.bar + p.at - p.from, bpm: clampBpm(q.bpm * scale) })),
              // A glide still under way at the section's end goes as far as it got there
              ...(tempoFrom(p.to - 1e-3, oldTempo).glide
                ? [{ id: uid('tempo'), bar: p.at + (p.to - p.from) - 1e-3, bpm: clampBpm(tempoAt(p.to - 1e-3, oldTempo) * scale), ramp: true }]
                : []),
            ])
          )
        : // (A new array either way, so Undo knows the tempo changed with it: see restoreEntry)
          [...s.tempoPoints];
      const firstBpm = s.tempoPoints.length && placed.length ? clampBpm(tempoAt(placed[0].from, oldTempo) * scale) : bpm;
      // Time signatures follow their sections too
      const oldMeter = songMeterOf(s);
      const meter = placed.length ? meterAt(placed[0].from, oldMeter) : s.meter;
      const meterPoints = s.meterPoints.length
        ? tidyMeters(
            placed.flatMap((p) => [
              { id: uid('meter'), bar: p.at, ...meterAt(p.from, oldMeter) },
              ...s.meterPoints.filter((q) => q.bar > p.from + EPS && q.bar < p.to - EPS).map((q) => ({ ...q, id: uid('meter'), bar: q.bar + p.at - p.from })),
            ]),
            meter
          )
        : s.meterPoints;
      const newTempo = songTempo({ bpm: firstBpm, tempoPoints });
      // Section flags where each section now starts; hit points locked to time stay with the picture
      const named = placed.filter((p) => !/^(Start|Bars \d+-\d+)$/.test(p.name));
      const markers = [
        ...s.markers.filter((m) => m.anchor === 'time'),
        ...named.filter((p, k) => named.findIndex((o) => o.at === p.at) === k).map((p) => createMarker(p.at, newTempo, p.name)),
      ];
      set((st) => ({
        // Every section keeps its own tempo (scaled when fitted), so audio clips scale with it
        clips: retimeAudioClips(clips, st.bpm, bpm),
        tracks,
        bpm: firstBpm,
        tempoPoints,
        meter,
        meterPoints,
        markers: retimeMarkers(markers, newTempo),
        loopRegion: { ...st.loopRegion, inBar: 1, outBar: cursor },
        ...pushPast(st),
      }));
      get().seek(1);
      return null;
    },

    keyChangeFrom: (fromBar, semitones) => {
      const s = get();
      const { clips, moved, outOfRange } = keyChange(s.clips, s.tracks, fromBar, semitones);
      if (!moved) return outOfRange ? "Nothing moved: those notes would leave their instruments' range." : 'No pitched notes from here on to move.';
      set((st) => ({ clips, ...pushPast(st) }));
      return outOfRange ? `Moved ${moved} notes; ${outOfRange} stayed put (outside their instrument's range).` : null;
    },

    removeBars: (fromBar, toBar) => {
      const s = get();
      const from = clampBar(Math.min(fromBar, toBar));
      const to = clampBar(Math.max(fromBar, toBar));
      const len = to - from;
      if (len < EPS) return null;
      const clips: Clip[] = [];
      for (const c of s.clips) {
        const end = c.startBar + c.lengthBars;
        if (end <= from + EPS) {
          clips.push(c);
        } else if (c.startBar >= to - EPS) {
          clips.push({ ...c, startBar: c.startBar - len });
        } else {
          // Keep only the parts outside the removed bars (a clip entirely inside them goes)
          const left = splitClipAt(c, from, songTempo(s))?.[0];
          const right = splitClipAt(c, to, songTempo(s))?.[1];
          if (left) clips.push(left);
          if (right) clips.push({ ...right, id: left ? right.id : c.id, startBar: from, isSelected: c.isSelected });
        }
      }
      applyRipple(
        clips,
        // Shortest loop the snap grid allows, as when dragging its brackets
        { kind: 'remove', from, to, minLoop: minClipLength(s.snapGrid, s) },
        (points) => removeLaneBars(points, from, to),
        (markers, tempo) => removeMarkerBars(markers, from, to, tempo)
      );
      return null;
    },

    // ---------- Clipboard ----------
    clipboard: [],
    clipboardInstrument: null,
    clipboardBpm: 122,

    copySelectedClips: () => {
      const { clips, tracks, bpm } = get();
      const selected = clips.filter((c) => c.isSelected);
      if (selected.length === 0) return;
      const origin = Math.min(...selected.map((c) => c.startBar));
      const fromOneTrack = selected.every((c) => c.trackId === selected[0].trackId);
      set({
        clipboard: selected.map((c) => ({ ...c, startBar: c.startBar - origin, isSelected: false })),
        // Remembered now, so the clips can still be pasted onto a matching track after theirs is gone
        clipboardInstrument: fromOneTrack ? (tracks.find((t) => t.id === selected[0].trackId)?.instrumentKey ?? null) : null,
        clipboardBpm: bpm,
      });
    },

    cutSelectedClips: () => {
      get().copySelectedClips();
      get().deleteSelectedClips();
    },

    pasteClips: (atBar, ontoTrackId) => {
      const { clipboard, clipboardInstrument, clipboardBpm, tracks, playheadPosition, snapGrid, isPlaying, bpm } = get();
      if (clipboard.length === 0) return;
      const trackIds = new Set(tracks.map((t) => t.id));
      const at = clampBar(atBar ?? snapBar(playheadPosition, snapGrid, get()));
      const onto = ontoTrackId !== undefined ? tracks.find((t) => t.id === ontoTrackId) : undefined;
      const target = onto && clipboardInstrument && canMoveClipBetween(clipboardInstrument, onto.instrumentKey) ? onto.id : null;

      // Audio clips copied at another tempo are as long in seconds as they were
      const pasted: Clip[] = retimeAudioClips(clipboard, clipboardBpm, bpm)
        .filter((c) => target !== null || trackIds.has(c.trackId))
        .map((c) => ({
          ...c,
          id: uid('clip'),
          trackId: target ?? c.trackId,
          startBar: Math.max(1, Math.min(TOTAL_BARS + 1 - c.lengthBars, at + c.startBar)),
          isSelected: true,
          notes: c.notes.map((n) => ({ ...n, id: uid('note') })),
        }));
      if (pasted.length === 0) return;

      // Select the pasted clips and park the playhead after them so repeated pastes chain end-to-end
      const end = Math.max(...pasted.map((c) => c.startBar + c.lengthBars));
      set((s) => ({
        clips: [...s.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), ...pasted],
        ...pushPast(s),
        ...(isPlaying ? {} : { playheadPosition: clampBar(end) }),
      }));
    },

    // ---------- Selection ----------
    setSelection: (clipIds) =>
      set((s) =>
        s.clips.some((c) => c.isSelected !== clipIds.has(c.id))
          ? { clips: s.clips.map((c) => (c.isSelected === clipIds.has(c.id) ? c : { ...c, isSelected: !c.isSelected })) }
          : s
      ),

    selectAll: () => get().setSelection(new Set(get().clips.map((c) => c.id))),

    // ---------- History ----------
    checkpoint: () => set((s) => pushPast(s)),

    // The live engine follows tracks and clips on its own (connectTimelineToAudio); the master
    // returns are pushed here, as their setters do
    undo: () => {
      const s = get();
      if (s.past.length === 0) return;
      const entry = s.past[s.past.length - 1];
      // An insert / delete bars takes the loop and the playhead back with it (and its redo moves them again)
      const spot = entry.ripple && rippleSpot(s, entry.ripple, true);
      set({
        ...restoreEntry(s, entry),
        past: s.past.slice(0, -1),
        future: [withRipple(historyEntry(s), entry.ripple), ...s.future].slice(0, HISTORY_LIMIT),
        automationSelection: null,
        ...(spot ? { loopRegion: spot.loopRegion } : {}),
      });
      applyMasterFx();
      applyMaster();
      keepLivePluginStates();
      if (spot && spot.playhead !== s.playheadPosition) get().seek(spot.playhead);
    },

    redo: () => {
      const s = get();
      if (s.future.length === 0) return;
      const entry = s.future[0];
      const spot = entry.ripple && rippleSpot(s, entry.ripple, false);
      set({
        ...restoreEntry(s, entry),
        future: s.future.slice(1),
        past: [...s.past.slice(-(HISTORY_LIMIT - 1)), withRipple(historyEntry(s), entry.ripple)],
        automationSelection: null,
        ...(spot ? { loopRegion: spot.loopRegion } : {}),
      });
      applyMasterFx();
      applyMaster();
      keepLivePluginStates();
      if (spot && spot.playhead !== s.playheadPosition) get().seek(spot.playhead);
    },

    // ---------- Project ----------
    autosaveStatus: null,
    setProjectName: (name) => set({ projectName: name }),

    newProject: (template) => {
      // A new arrangement keeps the frame rate you're working in
      const { fps, dropFrame } = get();
      // A new song plays expressively (older projects opened later keep their sound)
      const expressive = (p: ProjectSnapshot): ProjectSnapshot => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, expressive: true })) });
      get().loadProject(expressive(
        template === 'demo'
          ? { ...createDemoProject(), fps, dropFrame }
          : isStarterId(template)
            ? { ...createStarter(template), fps, dropFrame }
            : {
              name: 'Untitled',
              bpm: 122,
              swing: 0.2,
              loopRegion: { inBar: 1, outBar: 5, enabled: true },
              tracks: INITIAL_TRACKS.map((t) => ({ ...t, fx: defaultTrackFx() })),
              clips: [],
              masterFx: DEFAULT_MASTER_FX,
              fps,
              dropFrame,
            }
      ));
    },

    loadProject: (p: ProjectSnapshot) => {
      // The song being replaced is kept for the Restore banner, so New, Open or a link never loses work
      const replaced = currentProject();
      if (hasWork(replaced)) useLastSession.setState({ session: setAsideSession(replaced) });
      replacedListeners.forEach((l) => l());
      // A take in progress belongs to the arrangement being replaced
      discardTake();
      // Plugins start from the settings the new project saved
      resetWamSession();
      set({ take: null });
      get().stop();
      // One track records at a time: a file with several armed keeps the first
      const armedId = p.tracks.find((t) => t.isArmed)?.id;
      const safeTracks: Track[] = tidyFolders(tidySends(tidyRoutes(p.tracks))).map((t: Track) => ({
        ...t,
        eq: t.eq ?? { low: 0, mid: 0, high: 0 },
        reverbSend: typeof t.reverbSend === 'number' ? t.reverbSend : 0,
        delaySend: typeof t.delaySend === 'number' ? t.delaySend : 0,
        fx: normalizeTrackFx(t.fx),
        isArmed: t.id === armedId,
      }));

      // Start downloading samples for any sampled instruments
      safeTracks.forEach((t: Track) => {
        if (hasRecordings(t.instrumentKey)) void loadSamples(t.instrumentKey).catch(() => {});
      });
      const masterFx = p.masterFx ?? DEFAULT_MASTER_FX;

      set({
        projectName: p.name,
        bpm: p.bpm,
        tempoPoints: p.tempoPoints ?? [],
        meter: p.meter ?? FOUR_FOUR,
        // On measure lines, as editing keeps them (a file may say otherwise)
        meterPoints: tidyMeters(p.meterPoints ?? [], p.meter ?? FOUR_FOUR),
        swing: p.swing,
        loopRegion: p.loopRegion,
        tracks: safeTracks,
        clips: p.clips,
        selectedTrackId: safeTracks[0]?.id ?? null,
        playheadPosition: p.loopRegion.inBar,
        past: [],
        future: [],
        editingClipId: null,
        masterReverbDecay: masterFx.reverbDecay,
        masterDelayTime: masterFx.delayTime,
        masterDelayFeedback: masterFx.delayFeedback,
        master: p.master ?? defaultMasterSettings(),
        fps: p.fps ?? DEFAULT_FRAME_RATE,
        dropFrame: p.dropFrame === true && p.fps === 29.97,
        markers: retimeMarkers(p.markers ?? [], songTempo({ bpm: p.bpm, tempoPoints: p.tempoPoints ?? [] })),
        stingers: p.stingers ?? [],
        transitions: p.transitions ?? {},
        intensity: p.intensity?.value ?? 1,
        intensityCurves: p.intensity?.curves ?? {},
        automationView: {},
        automationSelection: null,
        // A project opens at its start (or wherever its playhead is), not where the last one was scrolled to
        ...viewShowing(get(), p.loopRegion.inBar, true),
      });
      applyMasterFx();
      prepareSounds(p);
      applyMaster();
      // Its reference video, from this browser or from the file itself
      if (p.video) void useVideoStore.getState().restore(p.video);
    },

    insertPatternClip: (trackId, patternId, atBar) => {
      const track = get().tracks.find((t) => t.id === trackId);
      if (!track) return;
      const clip = createPatternClip(track, patternId, 1);
      if (!clip) return;
      clip.startBar = Math.max(1, Math.min(TOTAL_BARS + 1 - clip.lengthBars, atBar));
      clip.isSelected = true;
      set((s) => ({
        clips: [...s.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), clip],
        ...pushPast(s),
      }));
    },

    // ---------- Creating and editing clips ----------
    createEmptyClip: (trackId, atBar, lengthBars) => {
      const s = get();
      const track = s.tracks.find((t) => t.id === trackId);
      // An Audio track's clips come from sound files (addAudioClips), never empty; a bus or a return holds none
      if (!track || isAudioKind(track.instrumentKey) || isMixTrack(track)) return null;
      const count = s.clips.filter((c) => c.trackId === trackId).length + 1;
      const clip: Clip = {
        id: uid('clip'),
        trackId,
        name: `${track.name} ${count}`,
        startBar: Math.max(1, Math.min(TOTAL_BARS + 1 - lengthBars, atBar)),
        lengthBars,
        notes: [],
        isSelected: true,
      };
      set((st) => ({
        clips: [...st.clips.map((c) => (c.isSelected ? { ...c, isSelected: false } : c)), clip],
        ...pushPast(st),
      }));
      return clip.id;
    },

    dropOnTrack: (trackId, bar, payload) => {
      const s = get();
      const track = s.tracks.find((t) => t.id === trackId);
      if (!track || !compatibleInstruments(payload.instrument, track.instrumentKey)) return;

      if (payload.kind === 'pattern') {
        s.insertPatternClip(trackId, payload.patternId, bar);
        return;
      }

      const notes = payload.notes.map((note) => ({ note, duration: payload.duration, velocity: payload.velocity }));
      const host = s.clips.find(
        (c) => c.trackId === trackId && bar >= c.startBar - EPS && bar < c.startBar + c.lengthBars - EPS
      );
      if (host) {
        const offset = bar - host.startBar;
        s.addNotes(host.id, notes.map((n) => ({ ...n, startOffset: offset })));
        s.selectClip(host.id, false);
        return;
      }
      // Empty space: a new one-bar clip starting at the drop point, so later drops land inside it
      const clipId = s.createEmptyClip(trackId, bar, 1);
      if (!clipId) return;
      set((st) => ({
        clips: st.clips.map((c) =>
          c.id === clipId
            ? { ...c, name: payload.label, notes: notes.map((n) => ({ ...n, id: uid('note'), startOffset: 0 })) }
            : c
        ),
      }));
    },

    // Low-level, as typed: the name field checkpoint()s once when it's focused
    renameClip: (clipId, name) => updateClip(clipId, () => ({ name })),

    setClipWobble: (clipId, wobble) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        if (!clip || (clip.wobble ?? DEFAULT_WOBBLE) === wobble) return s;
        return { clips: s.clips.map((c) => (c === clip ? { ...c, wobble } : c)), ...pushPast(s) };
      }),

    addNotes: (clipId, notes) => {
      const created = notes.map((n) => ({ ...n, id: uid('note') }));
      set((s) => ({
        clips: s.clips.map((c) => (c.id === clipId ? { ...c, notes: [...c.notes, ...created] } : c)),
        ...pushPast(s),
      }));
      return created.map((n) => n.id);
    },

    setClipNotes: (clipId, notes) => updateClip(clipId, () => ({ notes })),

    deleteNotes: (clipId, noteIds) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        if (!clip || !clip.notes.some((n) => noteIds.has(n.id))) return s;
        return {
          clips: s.clips.map((c) => (c.id === clipId ? { ...c, notes: c.notes.filter((n) => !noteIds.has(n.id)) } : c)),
          ...pushPast(s),
        };
      }),

    // ---------- Piano roll ----------
    editingClipId: null,
    openEditor: (clipId) => set({ editingClipId: clipId }),
    closeEditor: () => set({ editingClipId: null }),

    // ---------- Recording ----------
    recordOptions: readRecordOptions(),
    setRecordOptions: (patch) => {
      const recordOptions = { ...get().recordOptions, ...patch };
      set({ recordOptions });
      writeRecordOptions(recordOptions);
    },
    take: null,
    punch: { enabled: false, inBar: 1, outBar: 3 },
    setPunch: (patch) =>
      set((s) => {
        const next = { ...s.punch, ...patch };
        const inBar = Math.max(1, Math.min(TOTAL_BARS, next.inBar));
        const outBar = Math.max(inBar + 1 / 16, Math.min(TOTAL_BARS + 1, next.outBar));
        return { punch: { enabled: next.enabled, inBar, outBar } };
      }),

    draggingInstrument: null,
    setDraggingInstrument: (instrument) => set({ draggingInstrument: instrument }),
    clipDragTargets: null,
    setClipDragTargets: (trackIds) => set({ clipDragTargets: trackIds }),

    // ---------- Automation ----------
    automationView: {},
    showAutomation: (trackId, open, param) =>
      set((s) => {
        const current = s.automationView[trackId];
        const track = s.tracks.find((t) => t.id === trackId);
        // Opened for the first time: the first setting that has a lane, else Volume
        const shown = param ?? current?.param ?? track?.automation?.find((l) => l.points.length)?.param ?? 'volume';
        const next = { open: open ?? !current?.open, param: shown };
        if (current && current.open === next.open && current.param === next.param) return s;
        const selection = s.automationSelection;
        const keepSelection = selection && (selection.trackId !== trackId || (next.open && selection.param === next.param));
        return { automationView: { ...s.automationView, [trackId]: next }, ...(keepSelection ? {} : { automationSelection: null }) };
      }),

    setAutomationPoints: (trackId, param, points, record, selection) =>
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId);
        if (!track) return s;
        const lanes = track.automation ?? [];
        const old = lanes.find((l) => l.param === param);
        const lane = { param, points: normalizePoints(points) };
        const automation = old ? lanes.map((l) => (l === old ? lane : l)) : [...lanes, lane];
        // A lane of an effect's setting only sounds while the effect is on, so drawing its first points turns it on
        const insert = specOf(param).insert;
        const switchOn = !!insert && lane.points.length > 0 && !old?.points.length && !(track.fx[insert] as { on?: boolean } | undefined)?.on;
        const fx = switchOn ? normalizeTrackFx({ ...track.fx, [insert]: { ...track.fx[insert], on: true } }) : track.fx;
        return {
          tracks: s.tracks.map((t) => (t === track ? { ...t, automation, fx } : t)),
          automationSelection: selection?.size ? { trackId, param, points: selection } : null,
          ...(record ? pushPast(s) : {}),
        };
      }),

    removeAutomationLane: (trackId, param) =>
      set((s) => {
        const track = s.tracks.find((t) => t.id === trackId);
        if (!track?.automation?.some((l) => l.param === param)) return s;
        const automation = track.automation.filter((l) => l.param !== param);
        const { automation: _gone, ...rest } = track;
        return {
          tracks: s.tracks.map((t) => (t === track ? (automation.length ? { ...t, automation } : rest) : t)),
          automationSelection: s.automationSelection?.trackId === trackId ? null : s.automationSelection,
          ...pushPast(s),
        };
      }),

    automationSelection: null,
    selectAutomationPoints: (selection) => set({ automationSelection: selection?.points.size ? selection : null }),

    deleteSelectedAutomationPoints: () => {
      const sel = get().automationSelection;
      const lane = sel && get().tracks.find((t) => t.id === sel.trackId)?.automation?.find((l) => l.param === sel.param);
      if (!sel || !lane || !lane.points.some((p) => sel.points.has(p))) return false;
      get().setAutomationPoints(sel.trackId, sel.param, lane.points.filter((p) => !sel.points.has(p)), true);
      return true;
    },
  };
});

/** Everything a project file or autosave stores, read from the store now. */
// Positions are counted (and typed) in the song's time signatures
setSongMeter(songMeterOf(useTimelineStore.getState()));
// Plugins' settings, read from them every few seconds, are kept on their tracks (and so saved)
onWamStates((states) => useTimelineStore.getState().setPluginStates(states));
useTimelineStore.subscribe((state, prev) => {
  if (state.meter !== prev.meter || state.meterPoints !== prev.meterPoints) setSongMeter(songMeterOf(state));
});

export function currentProject(): ProjectSnapshot {
  const s = useTimelineStore.getState();
  return {
    name: s.projectName,
    bpm: s.bpm,
    tempoPoints: s.tempoPoints,
    meter: s.meter,
    meterPoints: s.meterPoints,
    swing: s.swing,
    loopRegion: s.loopRegion,
    tracks: s.tracks,
    clips: s.clips,
    masterFx: masterFxOf(s),
    master: s.master,
    fps: s.fps,
    dropFrame: s.dropFrame,
    markers: s.markers,
    stingers: s.stingers,
    transitions: s.transitions,
    intensity: { value: s.intensity, curves: s.intensityCurves },
    video: projectVideo(),
  };
}

/** Autosave right away (set while connectAutosave is connected). */
let autosaveNow: (() => void) | null = null;

/** Try a failing autosave again now, e.g. once Restore or Dismiss frees the set-aside session's space. */
export function retryAutosave(): void {
  if (useTimelineStore.getState().autosaveStatus?.ok === false) autosaveNow?.();
}

/**
 * Save the arrangement to browser storage shortly after it changes, so a refresh
 * or closed tab doesn't lose work. Each attempt's outcome goes to `autosaveStatus` (shown in
 * the project bar); while autosave is failing, closing the tab asks first.
 * Returns an unsubscribe function.
 */
export function connectAutosave(): () => void {
  let timer = 0;
  let pending = false;
  let guarding = false;
  const saveNow = () => {
    pending = true;
    flush();
  };
  autosaveNow = saveNow;

  // Another tab's Dismiss removes the autosave when that tab hasn't autosaved yet, but the session
  // it dismissed may be this tab's open work: write it straight back. A removed set-aside
  // session frees space, so a failing autosave tries again.
  const onStorage = (e: StorageEvent) => {
    const removed = autosaveRemovedBy(e);
    const status = useTimelineStore.getState().autosaveStatus;
    if (!removed || !status) return; // no edits here yet: nothing of this tab's to keep
    if (removed === 'autosave' || !status.ok) saveNow();
  };

  // Only registered while autosave is failing: the browser's "Leave site?" prompt is the last
  // chance to use Save
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    flush();
    if (useTimelineStore.getState().autosaveStatus?.ok !== false) return;
    e.preventDefault();
    e.returnValue = ''; // older browsers only prompt when this is set
  };
  const guard = (on: boolean) => {
    if (on === guarding) return;
    guarding = on;
    if (on) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
  };

  /** When the oldest unsaved edit was made: a steady stream of edits is still saved every few seconds */
  let since = 0;
  const later = () => {
    const now = Date.now();
    if (!pending) since = now;
    pending = true;
    clearTimeout(timer);
    timer = window.setTimeout(flush, Math.max(0, Math.min(500, since + 3000 - now)));
  };
  const flush = () => {
    if (!pending) return;
    pending = false;
    clearTimeout(timer);
    const result: AutosaveResult = writeAutosave(currentProject());
    useTimelineStore.setState({
      autosaveStatus: result.ok ? { ok: true, at: Date.now() } : { ok: false, at: Date.now(), reason: result.reason },
    });
    guard(!result.ok);
  };

  const unsubscribe = useTimelineStore.subscribe((state, prev) => {
    if (
      state.clips === prev.clips &&
      state.tracks === prev.tracks &&
      state.bpm === prev.bpm &&
      state.tempoPoints === prev.tempoPoints &&
      state.meter === prev.meter &&
      state.meterPoints === prev.meterPoints &&
      state.swing === prev.swing &&
      state.loopRegion === prev.loopRegion &&
      state.projectName === prev.projectName &&
      state.masterReverbDecay === prev.masterReverbDecay &&
      state.masterDelayTime === prev.masterDelayTime &&
      state.masterDelayFeedback === prev.masterDelayFeedback &&
      state.master === prev.master &&
      state.fps === prev.fps &&
      state.dropFrame === prev.dropFrame &&
      state.markers === prev.markers &&
      state.stingers === prev.stingers &&
      state.transitions === prev.transitions &&
      state.intensity === prev.intensity &&
      state.intensityCurves === prev.intensityCurves
    ) {
      return;
    }
    later();
  });

  // The reference video (which one, and where it starts) is saved with the project too
  const unwatchVideo = useVideoStore.subscribe((v, prev) => {
    if (v.key === prev.key && v.start === prev.start) return;
    later();
  });

  // Don't lose an edit made in the last half-second before the tab closes
  window.addEventListener('pagehide', flush);
  window.addEventListener('storage', onStorage);
  return () => {
    flush();
    guard(false);
    window.removeEventListener('pagehide', flush);
    window.removeEventListener('storage', onStorage);
    if (autosaveNow === saveNow) autosaveNow = null;
    unsubscribe();
    unwatchVideo();
  };
}

/**
 * Bind the store to the audio engine: keep one live strip + instrument per track, reschedule
 * Transport events when clips change, and keep loop/tempo/swing and the delay time in sync.
 * Returns an unsubscribe function (safe under React StrictMode double-invoke).
 */
/** A frozen track's sound can't be played (deleted from this browser, or unreadable): it plays live. */
const soundMissing = (id: string) => {
  const status = useSoundLibrary.getState().status[id];
  return status === 'missing' || status === 'error';
};

export function connectTimelineToAudio(): () => void {
  const s = useTimelineStore.getState();
  holdAutomationAt(s.playheadPosition);
  // The clip launcher's tracks play their slots (see launcherView.ts), and while it's in use the song doesn't loop
  const launched = (state: TimelineState) => {
    const segments = useLauncher.getState().segments;
    return launcherActive(segments) ? { ...state, clips: launcherClips(state.tracks, state.clips, segments) } : state;
  };
  const loopOf = (state: TimelineState) => (launcherActive(useLauncher.getState().segments) && state.loopRegion.enabled ? { ...state.loopRegion, enabled: false } : state.loopRegion);
  // The engine plays frozen tracks as audio (see freeze.ts)
  let view = liveView(launched(s), soundMissing);
  for (const t of s.tracks) if (t.frozen) ensureSound(t.frozen.soundId);
  // Clips' controller lanes play as their tracks' automation (see ccLanes.ts)
  const ccMemo = controllerMemo();
  let playing = withControllerLanes(view.tracks, view.clips, ccMemo);
  syncLiveTracks(playing);
  applyLiveIntensity(view.tracks, s.intensityCurves, s.intensity, 0);
  rescheduleClips(view.tracks, view.clips);
  const refresh = (state: TimelineState, retimed = false) => {
    const next = liveView(launched(state), soundMissing, view);
    const nextPlaying = withControllerLanes(next.tracks, next.clips, ccMemo);
    if (nextPlaying !== playing) syncLiveTracks(nextPlaying);
    playing = nextPlaying;
    applyLiveIntensity(next.tracks, state.intensityCurves, state.intensity);
    const trackSetChanged = next.tracks.length !== view.tracks.length || next.tracks.some((t, i) => t.id !== view.tracks[i]?.id);
    // The Human insert works in the scheduler, so turning it or its amounts changes what plays
    const feelChanged = next.tracks.some((t, i) => t.fx.human !== view.tracks[i]?.fx.human || t.instrumentKey !== view.tracks[i]?.instrumentKey);
    if (next.clips !== view.clips || trackSetChanged || feelChanged || retimed) rescheduleClips(next.tracks, next.clips);
    view = next;
  };
  // A frozen sound found missing (or back again) changes what plays
  const unwatchSounds = useSoundLibrary.subscribe((lib, prevLib) => {
    if (lib.status === prevLib.status) return;
    const state = useTimelineStore.getState();
    if (state.tracks.some((t) => t.frozen && lib.status[t.frozen.soundId] !== prevLib.status[t.frozen.soundId])) refresh(state);
  });
  syncTransport(loopOf(s), songTempo(s), s.swing);
  liveMix.busFx.apply(masterFxOf(s), s.bpm);
  setLiveStripTempo(s.bpm);
  liveMix.inserts.apply(s.master);

  // Ducking under dialogue / SFX proxies: the curve, kept as the same array while it doesn't change
  let duckKey = '';
  let duck: AutomationPoint[] | null = null;
  const refreshDuck = (state: TimelineState) => {
    const next = duckPoints(state.tracks, state.clips, state.bpm);
    const key = next ? JSON.stringify(next) : '';
    if (key === duckKey) return;
    duckKey = key;
    duck = next;
    setLiveDuck(duck);
  };
  refreshDuck(s);
  const unsubscribe = useTimelineStore.subscribe((state, prev) => {
    if (state.tracks !== prev.tracks || state.clips !== prev.clips || state.bpm !== prev.bpm) refreshDuck(state);
    // Intensity crossfades the stem groups (see intensity.ts)
    if (state.intensity !== prev.intensity || state.intensityCurves !== prev.intensityCurves) applyLiveIntensity(view.tracks, state.intensityCurves, state.intensity);
    // Stopped, automated settings sit at their lanes' values under the playhead (first, so lanes
    // that come with new tracks start there too)
    if (!state.isPlaying && (state.playheadPosition !== prev.playheadPosition || prev.isPlaying)) {
      holdAutomationAt(state.playheadPosition);
    }
    // The Transport takes the new tempo first, so clips rescheduled below are timed at it
    const tempoChanged = state.bpm !== prev.bpm || state.tempoPoints !== prev.tempoPoints;
    if (state.loopRegion !== prev.loopRegion || tempoChanged || state.swing !== prev.swing) {
      syncTransport(loopOf(state), songTempo(state), state.swing);
      if (state.isPlaying && (state.loopRegion !== prev.loopRegion || tempoChanged)) retimeAutomation();
    }
    if (state.tracks !== prev.tracks || state.clips !== prev.clips || tempoChanged || state.swing !== prev.swing) {
      for (const t of state.tracks) if (t.frozen && t.frozen !== prev.tracks.find((p) => p.id === t.id)?.frozen) ensureSound(t.frozen.soundId);
      // Clips that follow the tempo are stretched anew at another tempo, though they haven't changed
      refresh(state, tempoChanged && state.clips.some((c) => c.audio?.stretchBpm));
    }
    if (state.bpm !== prev.bpm) {
      // Delay time is a tempo subdivision, so it follows the BPM
      liveMix.busFx.apply(masterFxOf(state), state.bpm);
      setLiveStripTempo(state.bpm);
    }
  });
  const unwatchLauncher = useLauncher.subscribe((l, p) => {
    if (l.segments === p.segments) return;
    const state = useTimelineStore.getState();
    if (launcherActive(l.segments) !== launcherActive(p.segments)) syncTransport(loopOf(state), songTempo(state), state.swing);
    refresh(state);
  });
  return () => {
    unsubscribe();
    unwatchSounds();
    unwatchLauncher();
  };
}
