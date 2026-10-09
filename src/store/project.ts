import type { CustomSample, EmbeddedSound, MasterFx, Clip, InstrumentKey, LoopRegion, Marker, NoteEvent, Track } from './timelineTypes';
import { DEFAULT_FRAME_RATE, DEFAULT_MASTER_FX, isFrameRate, isWobbleRate, normalizeTrackFx } from './timelineTypes';
import type { FrameRate } from './timelineTypes';
import { isInstrumentKey } from '../audio/instrumentCatalog';
import { parseAutomation } from '../audio/automation';
import { parseMarkers } from './markers';
import { normalizeClipAudio, normalizeSlicer, parseEmbeddedSounds } from './audioClips';

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
  /**
   * Timecode frame rate. Optional, so older versions of the app still open newer files (versions
   * that don't know 23.976 or 29.97 count those projects in 30 fps).
   */
  fps?: FrameRate;
  /** 29.97 timecode counted in drop-frame (optional; absent means non-drop). */
  dropFrame?: boolean;
  /** Named points on the timeline (optional; older files have none). */
  markers?: Marker[];
  /**
   * The sound files the audio clips, Slicer and Sampler tracks play, by content hash (optional).
   * Save embeds them so the file is complete; the browser autosave keeps only their ids (the
   * sounds themselves stay in the browser's sound library, see src/audio/soundLibrary.ts).
   */
  sounds?: EmbeddedSound[];
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
  /** Drop-frame timecode, only ever true at 29.97 (older projects don't have it). */
  dropFrame?: boolean;
  /** Markers, in position order (older projects don't have any). */
  markers?: Marker[];
  /** Embedded sound files (a saved file has them; autosaves and the store's own snapshot don't). */
  sounds?: EmbeddedSound[];
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
    dropFrame: p.dropFrame === true && p.fps === 29.97,
    markers: p.markers ?? [],
    ...(p.sounds?.length ? { sounds: p.sounds } : {}),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * The Sampler's own sound: a sound library id, or, from projects saved before the library, the
 * audio file itself as a data: URL (loadProject moves it into the library). Kept only if it has one.
 */
function parseSample(v: unknown): CustomSample | undefined {
  if (!isObj(v)) return undefined;
  const soundId = isStr(v.soundId) && v.soundId ? v.soundId : undefined;
  const dataUrl = !soundId && isStr(v.dataUrl) && v.dataUrl.startsWith('data:') ? v.dataUrl : undefined;
  if (!soundId && !dataUrl) return undefined;
  return { name: isStr(v.name) ? v.name : 'Sample', ...(soundId ? { soundId } : { dataUrl }), root: isStr(v.root) ? v.root : 'C4' };
}

function parseTrack(v: unknown): Track {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isInstrumentKey(v.instrumentKey)) {
    throw new Error('a track is missing its id, name or instrument');
  }
  const eqObj = isObj(v.eq) ? v.eq : {};
  const automation = parseAutomation(v.automation);
  const slicer = normalizeSlicer(v.slicer);
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
    // Optional: tracks from before automation (or without any) have none
    ...(automation ? { automation } : {}),
    // Optional: a Slicer track that has a sound loaded
    ...(slicer ? { slicer } : {}),
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
  const audio = normalizeClipAudio(v.audio);
  return {
    id: v.id,
    trackId: v.trackId,
    name: isStr(v.name) ? v.name : 'Clip',
    startBar: v.startBar,
    // No clip is shorter than a 16th; a zero or negative length (a hand-edited file) would break edits
    lengthBars: Math.max(0.0625, v.lengthBars),
    notes: v.notes.map(parseNote),
    isSelected: false,
    // Optional: a rate this version doesn't know plays at the default
    ...(isWobbleRate(v.wobble) ? { wobble: v.wobble } : {}),
    // Optional: an audio clip (on an Audio track) plays a sound file instead of notes
    ...(audio ? { audio } : {}),
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
  const fps = isFrameRate(raw.fps) ? raw.fps : DEFAULT_FRAME_RATE;
  const bpm = isNum(raw.bpm) ? Math.max(40, Math.min(240, raw.bpm)) : 122;
  const sounds = parseEmbeddedSounds(raw.sounds);
  return {
    name: isStr(raw.name) && raw.name.trim() ? raw.name : 'Untitled',
    bpm,
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
    fps,
    dropFrame: fps === 29.97 && raw.dropFrame === true,
    markers: parseMarkers(raw.markers, bpm),
    ...(sounds.length ? { sounds } : {}),
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

/**
 * Why an autosave failed: the project doesn't fit in browser storage ('too-big'), it fits only
 * without the set-aside last session this page offers ('full': Dismiss makes room), or the
 * browser blocks storage for the site ('blocked').
 */
export type AutosaveFailure = 'too-big' | 'full' | 'blocked';
export type AutosaveResult = { ok: true } | { ok: false; reason: AutosaveFailure };

/**
 * Whether a session has work in it worth offering to restore: clips, or markers (hit points
 * placed on a video before any music is written).
 */
export const hasWork = (p: Pick<ProjectSnapshot, 'clips' | 'markers'>): boolean => p.clips.length > 0 || (p.markers?.length ?? 0) > 0;

/** True once this page has written an autosave (so the stored one is no longer the previous session). */
let wroteAutosave = false;
/** True while this page's Restore banner offers the set-aside session (until Restore or Dismiss). */
let offeringPrevious = false;

/**
 * Save to browser storage. The autosave also records when it was written (`savedAt`, ignored
 * by project parsing), so a restored session can say how old it is.
 *
 * The set-aside session shares the browser's storage limit (about 5 MB). If the project only
 * fits without it and has work in it (see hasWork), the project takes its space: the next startup
 * would set this project aside in its place anyway, and this page's banner still offers the older
 * session.
 */
export function writeAutosave(p: ProjectSnapshot): AutosaveResult {
  const json = JSON.stringify({ ...serializeProject(p), savedAt: Date.now() });
  const failure = storeAutosave(json);
  if (failure !== 'too-big') return failure ? { ok: false, reason: failure } : { ok: true };

  const previous = readStored(PREVIOUS_SESSION_KEY);
  if (previous === null) return { ok: false, reason: 'too-big' };
  if (!hasWork(p)) {
    // An empty project wouldn't replace that session at the next startup, so it keeps its
    // space; the user can Dismiss it. Say so only when that certainly makes room: storage already
    // holds both, so a project no bigger than the two together fits without that session.
    const fitsAlone = json.length <= previous.length + (readStored(AUTOSAVE_KEY)?.length ?? 0);
    return { ok: false, reason: offeringPrevious && fitsAlone ? 'full' : 'too-big' };
  }
  try {
    localStorage.removeItem(PREVIOUS_SESSION_KEY);
  } catch {
    return { ok: false, reason: 'too-big' };
  }
  if (storeAutosave(json) === null) return { ok: true };
  // Too big even on its own: put the set-aside session back (its space is still free)
  try {
    localStorage.setItem(PREVIOUS_SESSION_KEY, previous);
  } catch {
    // Another tab took the space meanwhile; this page still offers the session until it closes
  }
  return { ok: false, reason: 'too-big' };
}

/** Write the autosave: null on success, or why it failed. */
function storeAutosave(json: string): 'too-big' | 'blocked' | null {
  try {
    localStorage.setItem(AUTOSAVE_KEY, json);
    wroteAutosave = true;
    return null;
  } catch (err) {
    // Full (a big Sampler sound), or blocked outright (some private modes, disabled site data)
    const full = err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return full ? 'too-big' : 'blocked';
  }
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A session the app can offer to restore: when it was autosaved, or, for an autosave from an
 * older version (which didn't record that), when it was set aside, so it was saved before then.
 */
export interface SavedSession {
  project: ProjectSnapshot;
  savedAt: number | null;
  keptAt: number | null;
}

function timeOf(raw: unknown, field: string): number | null {
  const v = isObj(raw) ? raw[field] : undefined;
  return isNum(v) ? v : null;
}

/**
 * Run once at startup, before autosave can write: if the autosave holds a session with work in
 * it (clips or markers), copy it to a second slot, which the Restore banner offers until the user
 * restores or dismisses it. A later startup replaces it only with a newer session with work in it,
 * so clearing the timeline (or starting a blank one) and reloading doesn't lose it. Returns the
 * session to offer, or null.
 *
 * If the copy doesn't fit in storage, the session is still offered for as long as this page is open.
 */
export function preservePreviousSession(): SavedSession | null {
  const session = setAsidePreviousSession();
  offeringPrevious = session !== null;
  return session;
}

function setAsidePreviousSession(): SavedSession | null {
  let fromAutosave: SavedSession | null = null;
  try {
    // Autosaves from before the rename (GrooveForge) are still picked up
    const json = [AUTOSAVE_KEY, ...LEGACY_AUTOSAVE_KEYS].map((k) => localStorage.getItem(k)).find((v) => v !== null);
    if (json) {
      const raw: unknown = JSON.parse(json);
      const project = parseProject(raw);
      if (hasWork(project)) {
        const savedAt = timeOf(raw, 'savedAt');
        // An autosave from an older version doesn't say when it was saved, only that it was before
        // the first startup that set it aside: keep that time through later reloads
        const earlier = savedAt === null ? readPreviousSlot() : null;
        const keptAt = (earlier?.savedAt === null ? earlier.keptAt : null) ?? Date.now();
        fromAutosave = { project, savedAt, keptAt };
        localStorage.setItem(PREVIOUS_SESSION_KEY, JSON.stringify({ savedAt, keptAt, project: raw }));
      }
    }
  } catch {
    // Unreadable autosave, blocked storage, or no room for the copy: fall through
  }
  if (fromAutosave) return fromAutosave;

  // An empty (or unreadable) autosave doesn't replace a session set aside earlier
  const slot = readPreviousSlot();
  if (!slot) return null;
  try {
    const project = parseProject(slot.project);
    return hasWork(project) ? { project, savedAt: slot.savedAt, keptAt: slot.keptAt } : null;
  } catch {
    return null;
  }
}

/** The set-aside session as stored (its project not yet validated), or null. */
function readPreviousSlot(): { project: unknown; savedAt: number | null; keptAt: number | null } | null {
  try {
    const json = localStorage.getItem(PREVIOUS_SESSION_KEY);
    const raw: unknown = json ? JSON.parse(json) : null;
    return isObj(raw) ? { project: raw.project, savedAt: timeOf(raw, 'savedAt'), keptAt: timeOf(raw, 'keptAt') } : null;
  } catch {
    return null;
  }
}

/**
 * Forget the set-aside session (after Restore or Dismiss). If this page hasn't autosaved yet, the
 * autosave still holds that same session; dismissing removes it too, or the next startup would
 * offer it again. (If another tab still has that session open, it writes it straight back: see
 * autosaveRemovedBy.)
 */
export function clearPreviousSession(dismissed: boolean): void {
  offeringPrevious = false;
  try {
    localStorage.removeItem(PREVIOUS_SESSION_KEY);
    if (dismissed && !wroteAutosave) [AUTOSAVE_KEY, ...LEGACY_AUTOSAVE_KEYS].forEach((k) => localStorage.removeItem(k));
  } catch {
    // Storage blocked: nothing was kept anyway
  }
}

/**
 * What another tab's storage change (a `storage` event) removed: the autosave ('autosave'), the
 * set-aside session ('previous', which frees space), or neither (null).
 */
export function autosaveRemovedBy(e: StorageEvent): 'autosave' | 'previous' | null {
  if (e.newValue !== null) return null;
  if (e.key === AUTOSAVE_KEY) return 'autosave';
  return e.key === PREVIOUS_SESSION_KEY ? 'previous' : null;
}

/** File-system-safe base name for downloads. */
export function safeFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'Untitled';
}
