import type { CustomSample, MasterFx, Clip, InstrumentKey, LoopRegion, NoteEvent, Track } from './timelineTypes';
import { DEFAULT_FRAME_RATE, DEFAULT_MASTER_FX, isFrameRate, normalizeTrackFx } from './timelineTypes';
import type { FrameRate } from './timelineTypes';
import { isInstrumentKey } from '../audio/instrumentCatalog';

/**
 * Project file format (.beatbox.json) and browser autosave.
 * Selection state is not saved; everything else needed to rebuild the arrangement is.
 * Files and autosaves from before the rename (GrooveForge) still load.
 */
export const PROJECT_FORMAT = 'bos-beat-box-project';
const LEGACY_FORMATS = ['grooveforge-project'];
export const PROJECT_VERSION = 1;
const AUTOSAVE_KEY = 'bos-beat-box.autosave.v1';
const LEGACY_AUTOSAVE_KEYS = ['grooveforge.autosave.v1'];
/** The previous session, set aside at startup (see preservePreviousSession). */
const PREVIOUS_SESSION_KEY = 'bos-beat-box.autosave.previous';

export interface ProjectData {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  bpm: number;
  swing: number;
  loopRegion: LoopRegion;
  tracks: Track[];
  clips: Omit<Clip, 'isSelected'>[];
  masterFx: MasterFx;
  /** Timecode frame rate. Optional, so older versions of the app still open newer files. */
  fps?: FrameRate;
}

export interface ProjectSnapshot {
  name: string;
  bpm: number;
  swing: number;
  loopRegion: LoopRegion;
  tracks: Track[];
  clips: Clip[];
  /** Shared reverb / delay settings (older projects don't have them). */
  masterFx?: MasterFx;
  /** Timecode frame rate (older projects don't have it: they counted in 30 fps). */
  fps?: FrameRate;
}


export function serializeProject(p: ProjectSnapshot): ProjectData {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: p.name,
    bpm: p.bpm,
    swing: p.swing,
    loopRegion: p.loopRegion,
    tracks: p.tracks,
    clips: p.clips.map(({ isSelected: _isSelected, ...rest }) => rest),
    masterFx: p.masterFx ?? DEFAULT_MASTER_FX,
    fps: p.fps ?? DEFAULT_FRAME_RATE,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** The Sampler's own sound: kept only if it looks like an embedded audio file. */
function parseSample(v: unknown): CustomSample | undefined {
  if (!isObj(v) || !isStr(v.dataUrl) || !v.dataUrl.startsWith('data:')) return undefined;
  return { name: isStr(v.name) ? v.name : 'Sample', dataUrl: v.dataUrl, root: isStr(v.root) ? v.root : 'C4' };
}

function parseTrack(v: unknown): Track {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isInstrumentKey(v.instrumentKey)) {
    throw new Error('a track is missing its id, name or instrument');
  }
  const eqObj = isObj(v.eq) ? v.eq : {};
  return {
    id: v.id,
    name: v.name,
    color: isStr(v.color) ? v.color : '#9ca3af',
    instrumentKey: v.instrumentKey as InstrumentKey,
    isMuted: v.isMuted === true,
    isSoloed: v.isSoloed === true,
    isArmed: v.isArmed === true,
    volume: isNum(v.volume) ? v.volume : 0,
    pan: isNum(v.pan) ? v.pan : 0,
    eq: {
      low: isNum(eqObj.low) ? eqObj.low : 0,
      mid: isNum(eqObj.mid) ? eqObj.mid : 0,
      high: isNum(eqObj.high) ? eqObj.high : 0,
    },
    reverbSend: isNum(v.reverbSend) ? Math.max(0, Math.min(1, v.reverbSend)) : 0,
    delaySend: isNum(v.delaySend) ? Math.max(0, Math.min(1, v.delaySend)) : 0,
    fx: normalizeTrackFx(v.fx),
    sample: parseSample(v.sample),
  };
}

function parseNote(v: unknown): NoteEvent {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.note) || !isNum(v.startOffset) || !isStr(v.duration)) {
    throw new Error('a note is malformed');
  }
  return {
    id: v.id,
    note: v.note,
    startOffset: v.startOffset,
    duration: v.duration,
    velocity: isNum(v.velocity) ? v.velocity : 0.8,
  };
}

function parseClip(v: unknown): Clip {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.trackId) || !isNum(v.startBar) || !isNum(v.lengthBars) || !Array.isArray(v.notes)) {
    throw new Error('a clip is malformed');
  }
  return {
    id: v.id,
    trackId: v.trackId,
    name: isStr(v.name) ? v.name : 'Clip',
    startBar: v.startBar,
    lengthBars: v.lengthBars,
    notes: v.notes.map(parseNote),
    isSelected: false,
  };
}

/** Validate untrusted JSON (a file or autosave) into a snapshot. Throws with a readable reason. */
export function parseProject(raw: unknown): ProjectSnapshot {
  if (!isObj(raw) || !(raw.format === PROJECT_FORMAT || LEGACY_FORMATS.includes(raw.format as string))) {
    throw new Error("this is not a Bo's Beatbox project file");
  }
  if (!isNum(raw.version) || raw.version > PROJECT_VERSION) {
    throw new Error("this project was saved by a newer version of Bo's Beatbox");
  }
  if (!Array.isArray(raw.tracks) || !Array.isArray(raw.clips)) throw new Error('tracks or clips are missing');

  const tracks = raw.tracks.map(parseTrack);
  const trackIds = new Set(tracks.map((t) => t.id));
  const loop = isObj(raw.loopRegion) ? raw.loopRegion : {};
  return {
    name: isStr(raw.name) && raw.name.trim() ? raw.name : 'Untitled',
    bpm: isNum(raw.bpm) ? Math.max(40, Math.min(240, raw.bpm)) : 122,
    swing: isNum(raw.swing) ? Math.max(0, Math.min(0.5, raw.swing)) : 0.2,
    loopRegion: {
      inBar: isNum(loop.inBar) ? loop.inBar : 1,
      outBar: isNum(loop.outBar) ? loop.outBar : 5,
      enabled: loop.enabled !== false,
    },
    tracks,
    // A clip whose track is gone can't play or be seen. Older versions could save these (undo
    // after deleting a track), so skip them rather than refuse the whole file.
    clips: raw.clips.map(parseClip).filter((c) => trackIds.has(c.trackId)),
    masterFx: parseMasterFx(raw.masterFx),
    fps: isFrameRate(raw.fps) ? raw.fps : DEFAULT_FRAME_RATE,
  };
}

function parseMasterFx(v: unknown): MasterFx {
  if (!isObj(v)) return DEFAULT_MASTER_FX;
  const d = DEFAULT_MASTER_FX;
  return {
    reverbDecay: isNum(v.reverbDecay) ? Math.max(0.8, Math.min(6, v.reverbDecay)) : d.reverbDecay,
    delayTime: isStr(v.delayTime) && ['4n', '8n', '8n.', '16n'].includes(v.delayTime) ? v.delayTime : d.delayTime,
    delayFeedback: isNum(v.delayFeedback) ? Math.max(0, Math.min(0.8, v.delayFeedback)) : d.delayFeedback,
  };
}

export type AutosaveResult = { ok: true } | { ok: false; reason: 'too-big' | 'blocked' };

/** True once this page has written an autosave (so the stored one is no longer the previous session). */
let wroteAutosave = false;

/**
 * Save to browser storage. The autosave also records when it was written (`savedAt`, ignored
 * by project parsing), so a restored session can say how old it is.
 */
export function writeAutosave(p: ProjectSnapshot): AutosaveResult {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...serializeProject(p), savedAt: Date.now() }));
    wroteAutosave = true;
    return { ok: true };
  } catch (err) {
    // Full (a big Sampler sound), or blocked outright (some private modes, disabled site data)
    const full = err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return { ok: false, reason: full ? 'too-big' : 'blocked' };
  }
}

/** A session the app can offer to restore, and when it was autosaved (null if unknown). */
export interface SavedSession {
  project: ProjectSnapshot;
  savedAt: number | null;
}

const savedAtOf = (raw: unknown): number | null => (isObj(raw) && isNum(raw.savedAt) ? raw.savedAt : null);

/**
 * Run once at startup, before autosave can write: if the autosave holds a session with clips,
 * copy it to a second slot, which the Restore banner offers until the user restores or
 * dismisses it. A later startup replaces it only with a newer session that has clips, so
 * clearing the timeline (or starting a blank one) and reloading doesn't lose it. Returns the
 * session to offer, or null.
 *
 * If the copy doesn't fit in storage, the session is still offered for as long as this page is open.
 */
export function preservePreviousSession(): SavedSession | null {
  let fromAutosave: SavedSession | null = null;
  try {
    // Autosaves from before the rename (GrooveForge) are still picked up
    const json = [AUTOSAVE_KEY, ...LEGACY_AUTOSAVE_KEYS].map((k) => localStorage.getItem(k)).find((v) => v !== null);
    if (json) {
      const raw: unknown = JSON.parse(json);
      const project = parseProject(raw);
      if (project.clips.length > 0) {
        fromAutosave = { project, savedAt: savedAtOf(raw) };
        localStorage.setItem(PREVIOUS_SESSION_KEY, JSON.stringify({ savedAt: fromAutosave.savedAt, project: raw }));
      }
    }
  } catch {
    // Unreadable autosave, blocked storage, or no room for the copy: fall through
  }
  if (fromAutosave) return fromAutosave;

  // An empty (or unreadable) autosave doesn't replace a session set aside earlier
  try {
    const json = localStorage.getItem(PREVIOUS_SESSION_KEY);
    if (!json) return null;
    const raw: unknown = JSON.parse(json);
    if (!isObj(raw)) return null;
    const project = parseProject(raw.project);
    return project.clips.length > 0 ? { project, savedAt: savedAtOf(raw) } : null;
  } catch {
    return null;
  }
}

/**
 * Forget the set-aside session (after Restore or Dismiss). If this page hasn't autosaved yet, the
 * autosave still holds that same session; dismissing removes it too, or the next startup would
 * offer it again.
 */
export function clearPreviousSession(dismissed: boolean): void {
  try {
    localStorage.removeItem(PREVIOUS_SESSION_KEY);
    if (dismissed && !wroteAutosave) [AUTOSAVE_KEY, ...LEGACY_AUTOSAVE_KEYS].forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage blocked: nothing was kept anyway
  }
}

/** File-system-safe base name for downloads. */
export function safeFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'Untitled';
}
