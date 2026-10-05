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
import { applyTrackMix, releaseAllVoices, rescheduleClips, syncTransport } from '../audio/scheduler';
import { createDemoProject, createPatternClip, INITIAL_TRACKS } from './demoSong';
import { loadAutosave, writeAutosave } from './project';
import type { ProjectSnapshot } from './project';
import type { Clip, InstrumentKey, LoopRegion, NoteEvent, SnapGrid, TimelineTool, Track } from './timelineTypes';
import type { DragPayload } from './dragSounds';
import { minClipLength, snapBar, uid } from './timelineTypes';

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

  // Loop
  setLoopIn: (bar: number) => void;
  setLoopOut: (bar: number) => void;
  toggleLoop: () => void;

  // Tracks
  toggleMute: (trackId: string) => void;
  toggleSolo: (trackId: string) => void;
  toggleArm: (trackId: string) => void;
  setTrackVolume: (trackId: string, db: number) => void;
  setTrackPan: (trackId: string, pan: number) => void;

  // Clips
  selectClip: (clipId: string, additive: boolean) => void;
  clearSelection: () => void;
  moveClip: (clipId: string, startBar: number) => void;
  trimClipStart: (clipId: string, newStartBar: number) => void;
  trimClipEnd: (clipId: string, newLengthBars: number) => void;
  splitClip: (clipId: string, atBar: number) => void;
  duplicateClip: (clipId: string) => string | null;
  deleteSelectedClips: () => void;

  // Clipboard
  /** Snapshot of copied clips; startBar is relative to the earliest copied clip (0 = paste point). */
  clipboard: Clip[];
  copySelectedClips: () => void;
  cutSelectedClips: () => void;
  /** Paste onto each clip's original track at `atBar` (defaults to the playhead, snapped). */
  pasteClips: (atBar?: number) => void;

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

  const updateClip = (clipId: string, patch: (c: Clip) => Partial<Clip>) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...patch(c) } : c)) }));

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
    projectName: 'Untitled',
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
        get().setBpm(Math.max(60, Math.min(200, 60000 / avg)));
      }
    },

    setSwing: (swing) => set({ swing: Math.max(0, Math.min(0.5, swing)) }),

    // ---------- View / tools ----------
    setZoom: (zoom) => set({ zoom: Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))) }),
    setTool: (tool) => set({ activeTool: tool }),
    setSnapGrid: (grid) => set({ snapGrid: grid }),

    // ---------- Loop ----------
    setLoopIn: (bar) =>
      set((s) => {
        const inBar = clampBar(snapBar(bar, s.snapGrid));
        const minLen = minClipLength(s.snapGrid);
        const outBar = s.loopRegion.outBar - inBar < minLen ? clampBar(inBar + 1) : s.loopRegion.outBar;
        return { loopRegion: { ...s.loopRegion, inBar: Math.min(inBar, outBar - minLen), outBar } };
      }),

    setLoopOut: (bar) =>
      set((s) => {
        const outBar = clampBar(snapBar(bar, s.snapGrid));
        const minLen = minClipLength(s.snapGrid);
        const inBar = outBar - s.loopRegion.inBar < minLen ? Math.max(1, outBar - 1) : s.loopRegion.inBar;
        return { loopRegion: { ...s.loopRegion, outBar: Math.max(outBar, inBar + minLen), inBar } };
      }),

    toggleLoop: () => set((s) => ({ loopRegion: { ...s.loopRegion, enabled: !s.loopRegion.enabled } })),

    // ---------- Tracks ----------
    toggleMute: (id) => updateTrack(id, (t) => ({ isMuted: !t.isMuted })),
    toggleSolo: (id) => updateTrack(id, (t) => ({ isSoloed: !t.isSoloed })),
    toggleArm: (id) => updateTrack(id, (t) => ({ isArmed: !t.isArmed })),
    setTrackVolume: (id, db) => updateTrack(id, () => ({ volume: Math.max(-60, Math.min(6, db)) })),
    setTrackPan: (id, pan) => updateTrack(id, () => ({ pan: Math.max(-1, Math.min(1, pan)) })),

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
        if (!clip) return s;
        const rel = atBar - clip.startBar;
        if (rel <= EPS || rel >= clip.lengthBars - EPS) return s;

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
        const idx = s.clips.indexOf(clip);
        const clips = [...s.clips];
        clips.splice(idx, 1, left, right);
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

    // ---------- Clipboard ----------
    clipboard: [],

    copySelectedClips: () => {
      const selected = get().clips.filter((c) => c.isSelected);
      if (selected.length === 0) return;
      const origin = Math.min(...selected.map((c) => c.startBar));
      set({
        clipboard: selected.map((c) => ({ ...c, startBar: c.startBar - origin, isSelected: false })),
      });
    },

    cutSelectedClips: () => {
      get().copySelectedClips();
      get().deleteSelectedClips();
    },

    pasteClips: (atBar) => {
      const { clipboard, tracks, playheadPosition, snapGrid, isPlaying } = get();
      if (clipboard.length === 0) return;
      const trackIds = new Set(tracks.map((t) => t.id));
      const at = clampBar(atBar ?? snapBar(playheadPosition, snapGrid));

      const pasted: Clip[] = clipboard
        .filter((c) => trackIds.has(c.trackId))
        .map((c) => ({
          ...c,
          id: uid('clip'),
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
      get().loadProject(
        template === 'demo'
          ? createDemoProject()
          : {
              name: 'Untitled',
              bpm: 122,
              swing: 0.2,
              loopRegion: { inBar: 1, outBar: 5, enabled: true },
              tracks: INITIAL_TRACKS.map((t) => ({ ...t })),
              clips: [],
            }
      );
    },

    loadProject: (p) => {
      get().stop();
      set({
        projectName: p.name,
        bpm: p.bpm,
        swing: p.swing,
        loopRegion: p.loopRegion,
        tracks: p.tracks,
        clips: p.clips,
        playheadPosition: p.loopRegion.inBar,
        past: [],
        future: [],
        editingClipId: null,
      });
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
      if (!track || track.instrumentKey !== payload.instrument) return;

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
  };
});

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
    const s = useTimelineStore.getState();
    writeAutosave({
      name: s.projectName,
      bpm: s.bpm,
      swing: s.swing,
      loopRegion: s.loopRegion,
      tracks: s.tracks,
      clips: s.clips,
    });
  };

  const unsubscribe = useTimelineStore.subscribe((state, prev) => {
    if (
      state.clips === prev.clips &&
      state.tracks === prev.tracks &&
      state.bpm === prev.bpm &&
      state.swing === prev.swing &&
      state.loopRegion === prev.loopRegion &&
      state.projectName === prev.projectName
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
 * Bind the store to the audio engine: reschedule Transport events when clips/tracks
 * change, push mixer state to channels, and keep loop/tempo/swing in sync.
 * Returns an unsubscribe function (safe under React StrictMode double-invoke).
 */
export function connectTimelineToAudio(): () => void {
  const s = useTimelineStore.getState();
  rescheduleClips(s.tracks, s.clips);
  applyTrackMix(s.tracks);
  syncTransport(s.loopRegion, s.bpm, s.swing);

  return useTimelineStore.subscribe((state, prev) => {
    if (state.clips !== prev.clips) {
      rescheduleClips(state.tracks, state.clips);
    }
    if (state.tracks !== prev.tracks) {
      applyTrackMix(state.tracks);
    }
    if (state.loopRegion !== prev.loopRegion || state.bpm !== prev.bpm || state.swing !== prev.swing) {
      syncTransport(state.loopRegion, state.bpm, state.swing);
    }
  });
}
