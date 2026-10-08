import { create } from 'zustand';
import { initAudio } from '../audio/engine';
import { setBpm as engineSetBpm } from '../audio/engine';
import {
  getAudiblePositionBar,
  pauseTransport,
  seekTransport,
  startTransportAt,
  stopTransport,
} from '../audio/transport';
import { releaseAllVoices, rescheduleClips, syncTransport } from '../audio/scheduler';
import { holdAutomationAt, retimeAutomation, syncLiveTracks } from '../audio/liveTracks';
import { AUTOMATION, insertLaneBars, normalizePoints, removeLaneBars } from '../audio/automation';
import { liveMix } from '../audio/engine';
import { createDemoProject, createPatternClip, INITIAL_TRACKS } from './demoSong';
import { autosaveRemovedBy, preservePreviousSession, writeAutosave, type AutosaveFailure, type AutosaveResult, type ProjectSnapshot, type SavedSession } from './project';
import type { Clip, FrameRate, InstrumentKey, LoopRegion, NoteEvent, RulerUnits, SnapGrid, TimelineTool, Track, TrackEq } from './timelineTypes';
import type { DragPayload } from './dragSounds';
import { formatBarCount, minClipLength, snapBar, uid } from './timelineTypes';
import { canMoveClipBetween, compatibleInstruments, INSTRUMENTS } from '../audio/instrumentCatalog';
import { isSamplerKey, loadSamples } from '../audio/samplers/samplerManager';
import { DEFAULT_FRAME_RATE, DEFAULT_MASTER_FX, defaultTrackFx, isFrameRate, normalizeTrackFx } from './timelineTypes';
import type { AutomationParam, AutomationPoint, CustomSample, MasterFx, TrackFx, WobbleRate } from './timelineTypes';
import { DEFAULT_WOBBLE, TOTAL_BARS } from './timelineTypes';

// Defined with the data types (project parsing and the automation maths need it too); much of
// the app reads it from here
export { TOTAL_BARS };
export const MIN_ZOOM = 12;
/** Deep enough for frame-level work: a 30 fps frame is 21px wide at 120 BPM. */
export const MAX_ZOOM = 1280;
const EPS = 1e-6;
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
  movePoint: (bar: number) => number;
  moveLoop: (loop: LoopRegion) => LoopRegion;
  /** From after the edit back to before it (a position in bars that were removed comes back at the cut). */
  backPoint: (bar: number) => number;
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
}

/** Everything undo restores, read from the store now. */
const historyEntry = (s: TimelineState): HistoryEntry => ({ clips: s.clips, tracks: s.tracks, masterFx: masterFxOf(s) });

const withRipple = (entry: HistoryEntry, ripple: RippleMove | undefined): HistoryEntry => (ripple ? { ...entry, ripple } : entry);

/** History patch that records the current state as the one to return to on undo (and, for a ripple edit, what it moved). */
const pushPast = (s: TimelineState, ripple?: RippleMove) => ({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), withRipple(historyEntry(s), ripple)], future: [] });

/** Where undoing (or redoing) a ripple step puts the loop and the playhead: see RippleMove. */
function rippleSpot(s: TimelineState, move: RippleMove, undo: boolean): { loopRegion: LoopRegion; playhead: number } {
  const from = undo ? move.after : move.before;
  const to = undo ? move.before : move.after;
  const near = (a: number, b: number) => Math.abs(a - b) < EPS;
  const loop = s.loopRegion;
  let moved: LoopRegion;
  if (near(loop.inBar, from.inBar) && near(loop.outBar, from.outBar)) moved = { ...loop, inBar: to.inBar, outBar: to.outBar };
  else moved = undo ? { ...loop, inBar: move.backPoint(loop.inBar), outBar: move.backPoint(loop.outBar) } : move.moveLoop(loop);
  // (A loop that would shrink to nothing stays where it is)
  const loopRegion = moved.outBar - moved.inBar > EPS && (moved.inBar !== loop.inBar || moved.outBar !== loop.outBar) ? moved : loop;
  const playhead = near(s.playheadPosition, from.playhead) ? to.playhead : clampBar((undo ? move.backPoint : move.movePoint)(s.playheadPosition));
  return { loopRegion, playhead };
}

/**
 * The store patch that puts a history entry back. The track selection stays valid: a track that
 * comes back (undoing a delete) is selected, and a selected track that disappears hands over to
 * the first track.
 */
function restoreEntry(s: TimelineState, entry: HistoryEntry): Partial<TimelineState> {
  const { tracks, masterFx } = entry;
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
  return {
    clips,
    tracks,
    selectedTrackId,
    masterReverbDecay: masterFx.reverbDecay,
    masterDelayTime: masterFx.delayTime,
    masterDelayFeedback: masterFx.delayFeedback,
  };
}

interface TimelineState {
  tracks: Track[];
  clips: Clip[];
  /** 1-based bar position; updated every animation frame while playing. */
  playheadPosition: number;
  isPlaying: boolean;
  isRecording: boolean;
  bpm: number;
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

  // Transport
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  stop: () => void;
  seek: (bar: number) => void;
  toggleRecord: () => void;
  /** Set the tempo (40 to 240 BPM, to 0.01). */
  setBpm: (bpm: number) => void;
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

  // Tracks & Inspector
  selectedTrackId: string | null;
  isInspectorOpen: boolean;
  selectTrack: (trackId: string | null) => void;
  toggleInspector: (open?: boolean) => void;
  addTrack: (instrumentKey: InstrumentKey, name?: string) => string;
  deleteTrack: (trackId: string) => void;
  setTrackInstrument: (trackId: string, instrumentKey: InstrumentKey) => void;
  toggleMute: (trackId: string) => void;
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

  // Master Studio FX
  masterReverbDecay: number;
  masterDelayTime: string;
  masterDelayFeedback: number;
  setMasterReverbDecay: (decay: number) => void;
  setMasterDelayTime: (time: string) => void;
  setMasterDelayFeedback: (feedback: number) => void;

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

  // Clipboard
  /** Snapshot of copied clips; startBar is relative to the earliest copied clip (0 = paste point). */
  clipboard: Clip[];
  /** Instrument of the track the clipboard was copied from, or null if it came from several tracks. */
  clipboardInstrument: InstrumentKey | null;
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

  // History: clips, tracks and the mixer. Tempo, swing, loop, zoom, snap and frame rate are not undoable.
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Snapshot clips, tracks and mixer before an edit. Gestures (drags, slider moves) call this once at their start. */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;

  // Project
  /** The last autosave attempt (null until the first one this session). */
  autosaveStatus: AutosaveStatus | null;
  projectName: string;
  setProjectName: (name: string) => void;
  /** Replace the arrangement with a blank timeline or the demo song. Clears undo history. */
  newProject: (template: 'blank' | 'demo') => void;
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
 * half gets new ids and is unselected. Null if `atBar` isn't inside the clip.
 */
function splitClipAt(clip: Clip, atBar: number): [Clip, Clip] | null {
  const rel = atBar - clip.startBar;
  if (rel <= EPS || rel >= clip.lengthBars - EPS) return null;
  const left: Clip = {
    ...clip,
    lengthBars: rel,
    notes: clip.notes.filter((n) => n.startOffset < rel - EPS),
  };
  const right: Clip = {
    ...clip,
    id: uid('clip'),
    startBar: atBar,
    lengthBars: clip.lengthBars - rel,
    isSelected: false,
    notes: clip.notes
      .filter((n) => n.startOffset >= rel - EPS)
      .map((n) => ({ ...n, id: uid('note'), startOffset: n.startOffset - rel })),
  };
  return [left, right];
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
 * The previous session, set aside once at startup before autosave can overwrite it (this module
 * loads before anything can edit). The app always opens on an empty timeline; this is only
 * offered as "Restore last session". Null if there was nothing worth restoring (no clips).
 */
export const lastSession: SavedSession | null = preservePreviousSession();


const clampBar = (bar: number) => Math.max(1, Math.min(TOTAL_BARS + 1, bar));

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
  const applyMasterFx = () => liveMix.busFx.apply(masterFxOf(get()), get().bpm);

  const updateClip = (clipId: string, patch: (c: Clip) => Partial<Clip>) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...patch(c) } : c)) }));

  /**
   * Finish an insert / remove-bars edit: the new clips (one undo step), then everything else placed
   * on the timeline moved by the same rule, so it stays with the music: `movePoint` for a position,
   * `moveLoop` for the loop region, `moveLane` for an automation lane's points. Anything new that
   * sits at a song position belongs here too. `backPoint` undoes `movePoint` (for undo, see RippleMove).
   */
  const applyRipple = (
    clips: Clip[],
    movePoint: (bar: number) => number,
    moveLoop: (loop: LoopRegion) => LoopRegion,
    moveLane: (points: AutomationPoint[]) => AutomationPoint[],
    backPoint: (bar: number) => number
  ) => {
    const s = get();
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
    const playhead = clampBar(movePoint(s.playheadPosition));
    const ripple: RippleMove = {
      before: { inBar: s.loopRegion.inBar, outBar: s.loopRegion.outBar, playhead: s.playheadPosition },
      after: { inBar: loopRegion.inBar, outBar: loopRegion.outBar, playhead },
      movePoint,
      moveLoop,
      backPoint,
    };
    // One undo step for all of it, even when only the loop or the playhead moved
    set((st) => ({
      ...(clipsChanged || tracksChanged || loopChanged || playhead !== s.playheadPosition ? pushPast(st, ripple) : {}),
      ...(clipsChanged || tracksChanged ? { clips, tracks } : {}),
      ...(tracksChanged ? { automationSelection: null } : {}),
      ...(loopChanged ? { loopRegion } : {}),
    }));
    if (playhead !== s.playheadPosition) get().seek(playhead);
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
    swing: 0.2,
    zoom: 160,
    activeTool: 'select',
    snapGrid: '1/16',
    loopRegion: { inBar: 1, outBar: 5, enabled: true },
    fps: DEFAULT_FRAME_RATE,
    dropFrame: false,
    rulerUnits: 'bars',
    viewLeft: 0,
    viewWidth: 1200,
    projectName: 'Untitled',
    selectedTrackId: INITIAL_TRACKS[0]?.id ?? null,
    isInspectorOpen: false,
    masterReverbDecay: 2.4,
    masterDelayTime: '8n',
    masterDelayFeedback: 0.35,
    past: [],
    future: [],

    // ---------- Transport ----------
    play: async () => {
      await initAudio();
      if (get().isPlaying) return;
      startTransportAt(get().playheadPosition);
      set({ isPlaying: true });
      stopFrameLoop();
      rafId = requestAnimationFrame(frame);
    },

    pause: () => {
      if (!get().isPlaying) return;
      const pos = getAudiblePositionBar();
      pauseTransport();
      stopFrameLoop();
      releaseAllVoices();
      set({ isPlaying: false, playheadPosition: clampBar(pos) });
    },

    togglePlay: async () => {
      if (get().isPlaying) get().pause();
      else await get().play();
    },

    stop: () => {
      stopTransport();
      stopFrameLoop();
      releaseAllVoices();
      set({ isPlaying: false, isRecording: false, playheadPosition: get().loopRegion.inBar });
    },

    seek: (bar) => {
      const target = clampBar(bar);
      if (get().isPlaying) seekTransport(target);
      set({ playheadPosition: target });
    },

    toggleRecord: () => set((s) => ({ isRecording: !s.isRecording })),

    setBpm: (bpm) => {
      // Hundredths, so a tempo fitted to a video length lands within a frame or so
      const clamped = Math.max(40, Math.min(240, Math.round(bpm * 100) / 100));
      engineSetBpm(clamped);
      set({ bpm: clamped });
    },

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

    // ---------- Tracks & Inspector ----------
    selectTrack: (id) => set({ selectedTrackId: id }),
    toggleInspector: (open) => set((s) => ({ isInspectorOpen: open !== undefined ? open : !s.isInspectorOpen })),

    addTrack: (instrumentKey, name) => {
      const meta = INSTRUMENTS[instrumentKey];
      const count = get().tracks.filter((t) => t.instrumentKey === instrumentKey).length;
      const trackName = name || (count > 0 ? `${meta.name} ${count + 1}` : meta.name);
      const newTrack: Track = {
        id: uid('track'),
        name: trackName,
        color: meta.color,
        instrumentKey,
        isMuted: false,
        isSoloed: false,
        isArmed: false,
        volume: 0,
        pan: 0,
        eq: { low: 0, mid: 0, high: 0 },
        fx: defaultTrackFx(),
        reverbSend: 0.1,
        delaySend: 0,
      };
      set((s) => ({
        tracks: [...s.tracks, newTrack],
        selectedTrackId: newTrack.id,
        isInspectorOpen: true,
        ...pushPast(s),
      }));
      if (isSamplerKey(instrumentKey)) void loadSamples(instrumentKey).catch(() => {});
      return newTrack.id;
    },

    // Undoable: history entries carry the tracks, so Undo brings the track and its clips back together
    deleteTrack: (id) => {
      set((s) => {
        if (!s.tracks.some((t) => t.id === id)) return s;
        const nextTracks = s.tracks.filter((t) => t.id !== id);
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
      if (get().tracks.find((t) => t.id === id)?.instrumentKey === instrumentKey) return;
      const meta = INSTRUMENTS[instrumentKey];
      updateTrack(
        id,
        () => ({
          instrumentKey,
          name: meta.name,
          color: meta.color,
        }),
        true
      );
      if (isSamplerKey(instrumentKey)) void loadSamples(instrumentKey).catch(() => {});
    },

    toggleMute: (id) => updateTrack(id, (t) => ({ isMuted: !t.isMuted }), true),
    toggleSolo: (id) => updateTrack(id, (t) => ({ isSoloed: !t.isSoloed }), true),
    toggleArm: (id) => updateTrack(id, (t) => ({ isArmed: !t.isArmed }), true),
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

    setTrackFx: (id, effect, patch, record = false) => {
      updateTrack(id, (t) => ({ fx: normalizeTrackFx({ ...t.fx, [effect]: { ...t.fx[effect], ...patch } }) }), record);
    },

    setMasterReverbDecay: (decay) => {
      const clamped = Math.max(0.8, Math.min(6.0, decay));
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
      updateClip(clipId, (c) => ({ startBar: Math.max(1, Math.min(TOTAL_BARS + 1 - c.lengthBars, startBar)) })),

    trimClipStart: (clipId, newStartBar) =>
      updateClip(clipId, (c) => {
        const end = c.startBar + c.lengthBars;
        const start = Math.max(1, Math.min(end - 0.0625, newStartBar));
        const delta = start - c.startBar;
        // Notes keep their absolute song position; offsets shift so trimmed notes become hidden (recoverable)
        return {
          startBar: start,
          lengthBars: end - start,
          notes: c.notes.map((n) => ({ ...n, startOffset: n.startOffset - delta })),
        };
      }),

    trimClipEnd: (clipId, newLengthBars) =>
      updateClip(clipId, (c) => ({
        lengthBars: Math.max(0.0625, Math.min(TOTAL_BARS + 1 - c.startBar, newLengthBars)),
      })),

    splitClip: (clipId, atBar) =>
      set((s) => {
        const clip = s.clips.find((c) => c.id === clipId);
        const halves = clip && splitClipAt(clip, atBar);
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
        const halves = splitClipAt(c, at);
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
      // Positions move with the music after the insert point. A loop starting there moves; one ending there doesn't.
      const movePoint = (bar: number) => (bar >= at - EPS ? bar + bars : bar);
      applyRipple(clips, movePoint, (loop) => {
        const outBar = loop.outBar > at + EPS ? loop.outBar + bars : loop.outBar;
        const inBar = movePoint(loop.inBar);
        // Pushed off the end: pin Out to the end of the timeline. A loop that moved whole keeps its
        // length; one that started before the insert point keeps its In.
        if (outBar > TOTAL_BARS + 1) return { ...loop, outBar: TOTAL_BARS + 1, inBar: Math.min(inBar, TOTAL_BARS + 1 - (loop.outBar - loop.inBar)) };
        return { ...loop, inBar, outBar };
      }, (points) => insertLaneBars(points, at, bars), (bar) => (bar >= at + bars - EPS ? bar - bars : Math.min(bar, at)));
      return null;
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
          const left = splitClipAt(c, from)?.[0];
          const right = splitClipAt(c, to)?.[1];
          if (left) clips.push(left);
          if (right) clips.push({ ...right, id: left ? right.id : c.id, startBar: from, isSelected: c.isSelected });
        }
      }
      const movePoint = (bar: number) => (bar <= from ? bar : bar >= to ? bar - len : from);
      // Shortest loop the snap grid allows, as when dragging its brackets
      const minLoop = minClipLength(s.snapGrid, s);
      applyRipple(clips, movePoint, (loop) => {
        const inBar = movePoint(loop.inBar);
        const outBar = movePoint(loop.outBar);
        // A loop (nearly) all inside the removed bars, like "Delete bars In → Out", keeps its length, now over what came after
        if (outBar - inBar < minLoop - EPS) return { ...loop, inBar, outBar: Math.min(TOTAL_BARS + 1, inBar + loop.outBar - loop.inBar) };
        return { ...loop, inBar, outBar };
      }, (points) => removeLaneBars(points, from, to), (bar) => (bar > from + EPS ? bar + len : bar));
      return null;
    },

    // ---------- Clipboard ----------
    clipboard: [],
    clipboardInstrument: null,

    copySelectedClips: () => {
      const { clips, tracks } = get();
      const selected = clips.filter((c) => c.isSelected);
      if (selected.length === 0) return;
      const origin = Math.min(...selected.map((c) => c.startBar));
      const fromOneTrack = selected.every((c) => c.trackId === selected[0].trackId);
      set({
        clipboard: selected.map((c) => ({ ...c, startBar: c.startBar - origin, isSelected: false })),
        // Remembered now, so the clips can still be pasted onto a matching track after theirs is gone
        clipboardInstrument: fromOneTrack ? (tracks.find((t) => t.id === selected[0].trackId)?.instrumentKey ?? null) : null,
      });
    },

    cutSelectedClips: () => {
      get().copySelectedClips();
      get().deleteSelectedClips();
    },

    pasteClips: (atBar, ontoTrackId) => {
      const { clipboard, clipboardInstrument, tracks, playheadPosition, snapGrid, isPlaying } = get();
      if (clipboard.length === 0) return;
      const trackIds = new Set(tracks.map((t) => t.id));
      const at = clampBar(atBar ?? snapBar(playheadPosition, snapGrid, get()));
      const onto = ontoTrackId !== undefined ? tracks.find((t) => t.id === ontoTrackId) : undefined;
      const target = onto && clipboardInstrument && canMoveClipBetween(clipboardInstrument, onto.instrumentKey) ? onto.id : null;

      const pasted: Clip[] = clipboard
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
      if (spot && spot.playhead !== s.playheadPosition) get().seek(spot.playhead);
    },

    // ---------- Project ----------
    autosaveStatus: null,
    setProjectName: (name) => set({ projectName: name }),

    newProject: (template) => {
      // A new arrangement keeps the frame rate you're working in
      const { fps, dropFrame } = get();
      get().loadProject(
        template === 'demo'
          ? { ...createDemoProject(), fps, dropFrame }
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
      );
    },

    loadProject: (p: ProjectSnapshot) => {
      get().stop();
      const safeTracks: Track[] = p.tracks.map((t: Track) => ({
        ...t,
        eq: t.eq ?? { low: 0, mid: 0, high: 0 },
        reverbSend: typeof t.reverbSend === 'number' ? t.reverbSend : 0,
        delaySend: typeof t.delaySend === 'number' ? t.delaySend : 0,
        fx: normalizeTrackFx(t.fx),
      }));

      // Start downloading samples for any sampled instruments
      safeTracks.forEach((t: Track) => {
        if (isSamplerKey(t.instrumentKey)) void loadSamples(t.instrumentKey).catch(() => {});
      });
      const masterFx = p.masterFx ?? DEFAULT_MASTER_FX;

      set({
        projectName: p.name,
        bpm: p.bpm,
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
        fps: p.fps ?? DEFAULT_FRAME_RATE,
        dropFrame: p.dropFrame === true && p.fps === 29.97,
        automationView: {},
        automationSelection: null,
      });
      applyMasterFx();
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
      if (!track) return null;
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
        // A Filter lane only sounds while the Filter is on, so drawing its first points turns it on
        const filterOn = !!AUTOMATION[param].filter && lane.points.length > 0 && !old?.points.length && !track.fx.filter?.on;
        const fx = filterOn ? normalizeTrackFx({ ...track.fx, filter: { ...track.fx.filter, on: true } }) : track.fx;
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
export function currentProject(): ProjectSnapshot {
  const s = useTimelineStore.getState();
  return {
    name: s.projectName,
    bpm: s.bpm,
    swing: s.swing,
    loopRegion: s.loopRegion,
    tracks: s.tracks,
    clips: s.clips,
    masterFx: masterFxOf(s),
    fps: s.fps,
    dropFrame: s.dropFrame,
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
      state.swing === prev.swing &&
      state.loopRegion === prev.loopRegion &&
      state.projectName === prev.projectName &&
      state.masterReverbDecay === prev.masterReverbDecay &&
      state.masterDelayTime === prev.masterDelayTime &&
      state.masterDelayFeedback === prev.masterDelayFeedback &&
      state.fps === prev.fps &&
      state.dropFrame === prev.dropFrame
    ) {
      return;
    }
    pending = true;
    clearTimeout(timer);
    timer = window.setTimeout(flush, 500);
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
  };
}

/**
 * Bind the store to the audio engine: keep one live strip + instrument per track, reschedule
 * Transport events when clips change, and keep loop/tempo/swing and the delay time in sync.
 * Returns an unsubscribe function (safe under React StrictMode double-invoke).
 */
export function connectTimelineToAudio(): () => void {
  const s = useTimelineStore.getState();
  holdAutomationAt(s.playheadPosition);
  syncLiveTracks(s.tracks);
  rescheduleClips(s.tracks, s.clips);
  syncTransport(s.loopRegion, s.bpm, s.swing);
  liveMix.busFx.apply(masterFxOf(s), s.bpm);

  return useTimelineStore.subscribe((state, prev) => {
    // Stopped, automated settings sit at their lanes' values under the playhead (first, so lanes
    // that come with new tracks start there too)
    if (!state.isPlaying && (state.playheadPosition !== prev.playheadPosition || prev.isPlaying)) {
      holdAutomationAt(state.playheadPosition);
    }
    if (state.tracks !== prev.tracks) {
      syncLiveTracks(state.tracks);
    }
    const trackSetChanged =
      state.tracks.length !== prev.tracks.length || state.tracks.some((t, i) => t.id !== prev.tracks[i]?.id);
    if (state.clips !== prev.clips || trackSetChanged) {
      rescheduleClips(state.tracks, state.clips);
    }
    if (state.loopRegion !== prev.loopRegion || state.bpm !== prev.bpm || state.swing !== prev.swing) {
      syncTransport(state.loopRegion, state.bpm, state.swing);
      if (state.isPlaying && (state.loopRegion !== prev.loopRegion || state.bpm !== prev.bpm)) retimeAutomation();
    }
    if (state.bpm !== prev.bpm) {
      // Delay time is a tempo subdivision, so it follows the BPM
      liveMix.busFx.apply(masterFxOf(state), state.bpm);
    }
  });
}
