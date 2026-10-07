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
import { syncLiveTracks } from '../audio/liveTracks';
import { liveMix } from '../audio/engine';
import { createDemoProject, createPatternClip, INITIAL_TRACKS } from './demoSong';
import { loadAutosave, writeAutosave, type ProjectSnapshot } from './project';
import type { Clip, FrameRate, InstrumentKey, LoopRegion, NoteEvent, RulerUnits, SnapGrid, TimelineTool, Track, TrackEq } from './timelineTypes';
import type { DragPayload } from './dragSounds';
import { formatBarCount, minClipLength, snapBar, uid } from './timelineTypes';
import { canMoveClipBetween, compatibleInstruments, INSTRUMENTS } from '../audio/instrumentCatalog';
import { isSamplerKey, loadSamples } from '../audio/samplers/samplerManager';
import { DEFAULT_FRAME_RATE, DEFAULT_MASTER_FX, defaultTrackFx, isFrameRate, normalizeTrackFx } from './timelineTypes';
import type { CustomSample, MasterFx, TrackFx } from './timelineTypes';

/** Song length limit: 400 bars is 5+ minutes even at 240 BPM (about 13 minutes at 120 BPM). */
export const TOTAL_BARS = 400;
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 320;
const EPS = 1e-6;
const HISTORY_LIMIT = 100;

/** History patch that records `clips` as the state to return to on undo. */
const pushPast = (s: { past: Clip[][]; clips: Clip[] }) => ({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.clips], future: [] });

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
  /** What the time ruler counts in (a view setting, not saved). */
  rulerUnits: RulerUnits;

  // Transport
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  stop: () => void;
  seek: (bar: number) => void;
  toggleRecord: () => void;
  setBpm: (bpm: number) => void;
  tapTempo: () => void;
  setSwing: (swing: number) => void;

  // View / tools
  setZoom: (zoom: number) => void;
  setTool: (tool: TimelineTool) => void;
  setSnapGrid: (grid: SnapGrid) => void;
  setFps: (fps: FrameRate) => void;
  setRulerUnits: (units: RulerUnits) => void;

  // Loop
  setLoopIn: (bar: number) => void;
  setLoopOut: (bar: number) => void;
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
  /** Change one insert effect (distortion / compressor / chorus) on a track. */
  setTrackFx: <K extends keyof TrackFx>(trackId: string, effect: K, patch: Partial<TrackFx[K]>) => void;
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

  // History (clip edits only; mixer and transport changes are not undoable)
  past: Clip[][];
  future: Clip[][];
  /** Snapshot the clips before an edit. Gestures (drags) call this once at their start. */
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;

  // Project
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

/** The selected clips as one block: where it starts and how long it is (first start to last end). */
function selectionBlock(clips: Clip[]): { selected: Clip[]; start: number; span: number } | null {
  const selected = clips.filter((c) => c.isSelected);
  if (selected.length === 0) return null;
  const start = Math.min(...selected.map((c) => c.startBar));
  const end = Math.max(...selected.map((c) => c.startBar + c.lengthBars));
  return { selected, start, span: end - start };
}

const pluralBars = (n: number) => `${formatBarCount(n)} bar${n === 1 ? '' : 's'}`;

/** The store's master reverb / delay settings as one object. */
function masterFxOf(s: { masterReverbDecay: number; masterDelayTime: string; masterDelayFeedback: number }): MasterFx {
  return { reverbDecay: s.masterReverbDecay, delayTime: s.masterDelayTime, delayFeedback: s.masterDelayFeedback };
}

let rafId = 0;
let tapTimes: number[] = [];

/**
 * The previous session's autosave, read once at startup before autosave can overwrite it.
 * The app always opens on an empty timeline; this is only offered as "Restore last session".
 * Null if there was nothing worth restoring (no clips).
 */
const autosaved = loadAutosave();
export const lastSession: ProjectSnapshot | null = autosaved && autosaved.clips.length > 0 ? autosaved : null;


const clampBar = (bar: number) => Math.max(1, Math.min(TOTAL_BARS + 1, bar));

export const useTimelineStore = create<TimelineState>((set, get) => {
  const updateTrack = (trackId: string, patch: (t: Track) => Partial<Track>) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...patch(t) } : t)) }));

  /** Push the master reverb / delay settings (and tempo, for the delay time) to the live mix. */
  const applyMasterFx = () => liveMix.busFx.apply(masterFxOf(get()), get().bpm);

  const updateClip = (clipId: string, patch: (c: Clip) => Partial<Clip>) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...patch(c) } : c)) }));

  /**
   * Finish an insert / remove-bars edit: the new clips (one undo step), then everything else placed
   * on the timeline moved by the same rule, so it stays with the music: `movePoint` for a position,
   * `moveLoop` for the loop region. Anything new that sits at a song position belongs here too.
   */
  const applyRipple = (clips: Clip[], movePoint: (bar: number) => number, moveLoop: (loop: LoopRegion) => LoopRegion) => {
    const s = get();
    const clipsChanged = clips.length !== s.clips.length || clips.some((c, i) => c !== s.clips[i]);
    const loopRegion = moveLoop(s.loopRegion);
    const loopChanged = loopRegion.inBar !== s.loopRegion.inBar || loopRegion.outBar !== s.loopRegion.outBar;
    set((st) => ({
      ...(clipsChanged ? { clips, ...pushPast(st) } : {}),
      ...(loopChanged ? { loopRegion } : {}),
    }));
    const playhead = movePoint(s.playheadPosition);
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
    rulerUnits: 'bars',
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
      const clamped = Math.max(40, Math.min(240, Math.round(bpm)));
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
        get().setBpm(60000 / avg); // setBpm clamps to 40-240
      }
    },

    setSwing: (swing) => set({ swing: Math.max(0, Math.min(0.5, swing)) }),

    // ---------- View / tools ----------
    setZoom: (zoom) => set({ zoom: Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))) }),
    setTool: (tool) => set({ activeTool: tool }),
    setSnapGrid: (grid) => set({ snapGrid: grid }),
    setFps: (fps) => {
      if (isFrameRate(fps)) set({ fps });
    },
    setRulerUnits: (units) => set({ rulerUnits: units }),

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
      }));
      if (isSamplerKey(instrumentKey)) void loadSamples(instrumentKey).catch(() => {});
      return newTrack.id;
    },

    deleteTrack: (id) => {
      set((s) => {
        const nextTracks = s.tracks.filter((t) => t.id !== id);
        const nextSelected = s.selectedTrackId === id ? nextTracks[0]?.id ?? null : s.selectedTrackId;
        // Also drop the track's clips from undo history, or Undo would bring them back with no
        // track to live on (invisible, and saved into the project file). Steps that only touched
        // this track then match their neighbour; drop those too, so no Undo press does nothing.
        const withoutTrack = (clips: Clip[]) => clips.filter((c) => c.trackId !== id);
        const same = (a: Clip[], b: Clip[]) => a.length === b.length && a.every((c, i) => c === b[i]);
        const clips = withoutTrack(s.clips);
        const past = s.past.map(withoutTrack);
        const future = s.future.map(withoutTrack);
        return {
          tracks: nextTracks,
          clips,
          past: past.filter((step, i) => !same(step, past[i + 1] ?? clips)),
          future: future.filter((step, i) => !same(step, i === 0 ? clips : future[i - 1])),
          selectedTrackId: nextSelected,
        };
      });
    },

    setTrackInstrument: (id, instrumentKey) => {
      const meta = INSTRUMENTS[instrumentKey];
      updateTrack(id, () => ({
        instrumentKey,
        name: meta.name,
        color: meta.color,
      }));
      if (isSamplerKey(instrumentKey)) void loadSamples(instrumentKey).catch(() => {});
    },

    toggleMute: (id) => updateTrack(id, (t) => ({ isMuted: !t.isMuted })),
    toggleSolo: (id) => updateTrack(id, (t) => ({ isSoloed: !t.isSoloed })),
    toggleArm: (id) => updateTrack(id, (t) => ({ isArmed: !t.isArmed })),
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
      updateTrack(id, () => ({
        eq: { low: 0, mid: 0, high: 0 },
      }));
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

    setTrackSample: (id, sample) => updateTrack(id, () => ({ sample })),

    setTrackFx: (id, effect, patch) => {
      updateTrack(id, (t) => ({ fx: normalizeTrackFx({ ...t.fx, [effect]: { ...t.fx[effect], ...patch } }) }));
    },

    setMasterReverbDecay: (decay) => {
      const clamped = Math.max(0.8, Math.min(6.0, decay));
      set({ masterReverbDecay: clamped });
      applyMasterFx();
    },

    setMasterDelayTime: (time) => {
      set({ masterDelayTime: time });
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
      const copies: Clip[] = [];
      for (let k = 1; block.start + k * block.span < out - EPS; k++) {
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
        // Pushed off the end: pin Out to the end of the timeline
        if (outBar > TOTAL_BARS + 1) return { ...loop, outBar: TOTAL_BARS + 1, inBar: Math.min(inBar, TOTAL_BARS + 1 - MIN_CLIP_BARS) };
        return { ...loop, inBar, outBar };
      });
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
      applyRipple(clips, movePoint, (loop) => {
        const inBar = movePoint(loop.inBar);
        const outBar = movePoint(loop.outBar);
        // A loop inside the removed bars (like "Delete bars In → Out") keeps its length, now over what came after
        if (outBar - inBar < MIN_CLIP_BARS - EPS) return { ...loop, inBar, outBar: Math.min(TOTAL_BARS + 1, inBar + loop.outBar - loop.inBar) };
        return { ...loop, inBar, outBar };
      });
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

    undo: () =>
      set((s) => {
        if (s.past.length === 0) return s;
        return {
          clips: s.past[s.past.length - 1],
          past: s.past.slice(0, -1),
          future: [s.clips, ...s.future].slice(0, HISTORY_LIMIT),
        };
      }),

    redo: () =>
      set((s) => {
        if (s.future.length === 0) return s;
        return {
          clips: s.future[0],
          future: s.future.slice(1),
          past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.clips],
        };
      }),

    // ---------- Project ----------
    setProjectName: (name) => set({ projectName: name }),

    newProject: (template) => {
      // A new arrangement keeps the frame rate you're working in
      const fps = get().fps;
      get().loadProject(
        template === 'demo'
          ? { ...createDemoProject(), fps }
          : {
              name: 'Untitled',
              bpm: 122,
              swing: 0.2,
              loopRegion: { inBar: 1, outBar: 5, enabled: true },
              tracks: INITIAL_TRACKS.map((t) => ({ ...t, fx: defaultTrackFx() })),
              clips: [],
              masterFx: DEFAULT_MASTER_FX,
              fps,
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
  };
}

/**
 * Save the arrangement to browser storage shortly after it changes, so a refresh
 * or closed tab doesn't lose work. Returns an unsubscribe function.
 */
export function connectAutosave(): () => void {
  let timer = 0;
  let pending = false;

  const flush = () => {
    if (!pending) return;
    pending = false;
    clearTimeout(timer);
    writeAutosave(currentProject());
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
      state.fps === prev.fps
    ) {
      return;
    }
    pending = true;
    clearTimeout(timer);
    timer = window.setTimeout(flush, 500);
  });

  // Don't lose an edit made in the last half-second before the tab closes
  window.addEventListener('pagehide', flush);
  return () => {
    flush();
    window.removeEventListener('pagehide', flush);
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
  syncLiveTracks(s.tracks);
  rescheduleClips(s.tracks, s.clips);
  syncTransport(s.loopRegion, s.bpm, s.swing);
  liveMix.busFx.apply(masterFxOf(s), s.bpm);

  return useTimelineStore.subscribe((state, prev) => {
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
    }
    if (state.bpm !== prev.bpm) {
      // Delay time is a tempo subdivision, so it follows the BPM
      liveMix.busFx.apply(masterFxOf(state), state.bpm);
    }
  });
}
