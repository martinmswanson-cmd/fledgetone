import type { CustomSample, MasterFx, Clip, InstrumentKey, LoopRegion, NoteEvent, Track } from './timelineTypes';
import { DEFAULT_MASTER_FX, normalizeTrackFx } from './timelineTypes';
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

function parseClip(v: unknown, trackIds: Set<string>): Clip {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.trackId) || !isNum(v.startBar) || !isNum(v.lengthBars) || !Array.isArray(v.notes)) {
    throw new Error('a clip is malformed');
  }
  if (!trackIds.has(v.trackId)) throw new Error(`clip "${String(v.name)}" points at a missing track`);
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
    clips: raw.clips.map((c) => parseClip(c, trackIds)),
    masterFx: parseMasterFx(raw.masterFx),
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

export function loadAutosave(): ProjectSnapshot | null {
  try {
    const json = [AUTOSAVE_KEY, ...LEGACY_AUTOSAVE_KEYS].map((k) => localStorage.getItem(k)).find((v) => v !== null);
    return json ? parseProject(JSON.parse(json)) : null;
  } catch {
    return null;
  }
}

export function writeAutosave(p: ProjectSnapshot): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeProject(p)));
  } catch {
    // Storage full or blocked (private mode): autosave is best-effort
  }
}

/** File-system-safe base name for downloads. */
export function safeFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'Untitled';
}
