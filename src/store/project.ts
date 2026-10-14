import { normalizeExpression } from './expression';
import { normalizeNoteExpression } from './noteExpression';
import { compSegments, normalizeTakes } from './takes';
import { TOTAL_BARS, isAutomationParam } from './timelineTypes';
import { clampBpm, parseMeter, sortedPoints, type Meter, type MeterPoint, type TempoPoint } from '../audio/tempoMap';
import type { AutomationParam, CustomSample, EmbeddedSound, FrozenTrack, MasterFx, MasterSettings, Clip, CompSegment, InstrumentKey, LauncherSlot, LoopRegion, Marker, NoteEvent, Stinger, Track, TransitionRule, ProjectVideo, WamPlugin } from './timelineTypes';
import { normalizeSynthPatch } from './synthPatch';
import { normalizeMulti, normalizeRack } from './sampleKits';
import { DEFAULT_FRAME_RATE, DEFAULT_MASTER_FX, isFrameRate, isWobbleRate, MAX_CLIP_SWING, normalizeMasterSettings, normalizeTrackFx } from './timelineTypes';
import type { FrameRate } from './timelineTypes';
import { isInstrumentKey } from '../audio/instrumentCatalog';
import { parseAutomation } from '../audio/automation';
import { parseMarkers } from './markers';
import { parseStingers } from './stingers';
import { parseGameSfx, type GameSfx } from './gameSfx';
import { parseCostumes, parseStateOptions, type Costume, type StateOptions } from './costumes';
import { parseGameParams, type GameParam } from './gameParams';
import { parseTransitions } from './transitions';
import { parseCurves, type IntensityCurve } from './intensity';
import { normalizeClipAudio, normalizeSlicer, parseEmbeddedSounds } from './audioClips';

/**
 * Project file format (.fledgetone.json) and browser autosave.
 * Selection state is not saved; everything else needed to rebuild the arrangement is.
 * Files and autosaves from before the rename (GrooveForge) still load.
 */
export const PROJECT_FORMAT = 'fledgetone-project';
/** Earlier names of the format, still opened */
const LEGACY_FORMATS = ['bos-beat-box-project', 'grooveforge-project'];
export const PROJECT_VERSION = 1;
const AUTOSAVE_KEY = 'bos-beat-box.autosave.v1';
const LEGACY_AUTOSAVE_KEYS = ['grooveforge.autosave.v1'];
/** The previous session, set aside at startup (see preservePreviousSession). */
const PREVIOUS_SESSION_KEY = 'bos-beat-box.autosave.previous';
/** An autosave that couldn't be read at startup, kept as it was rather than overwritten */
const UNREADABLE_KEY = 'bos-beat-box.autosave.unreadable';

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
  /**
   * What clips' mod wheel lanes are: 'dynamics' (soft to loud) in files saved since it became so.
   * In older files it was vibrato, and opening them moves those lanes to the Vibrato lane.
   */
  modWheel?: 'dynamics';
  /** Named points on the timeline (optional; older files have none). */
  markers?: Marker[];
  /**
   * The sound files the audio clips, Slicer and Sampler tracks play, by content hash (optional).
   * Save embeds them so the file is complete; the browser autosave keeps only their ids (the
   * sounds themselves stay in the browser's sound library, see src/audio/soundLibrary.ts).
   */
  sounds?: EmbeddedSound[];
  /** The master section's OTT and stereo width (optional; older files have them off). */
  master?: MasterSettings;
  /** Game stingers (optional; older files have none). */
  stingers?: Stinger[];
  /** Game sound effects for the game kit (optional; older files have none). */
  sfx?: GameSfx[];
  /** Game costumes: the song played other ways (optional; older files have none). */
  costumes?: Costume[];
  /** Game parameters: named values the game sets, each moving several things (optional). */
  gameParams?: GameParam[];
  /** How each game state plays (shuffled pieces, silences), by section marker id (optional). */
  stateOptions?: Record<string, StateOptions>;
  /** Transitions into game states, by section marker id (optional; absent means straight cuts). */
  transitions?: Record<string, TransitionRule>;
  /** Intensity: the level now (0 to 1) and each stem group's curve (optional). */
  intensity?: { value: number; curves: Record<string, IntensityCurve> };
  /** The reference video (optional) */
  video?: ProjectVideo;
  /** Tempo changes after bar 1 (optional; absent means one tempo throughout) */
  tempoPoints?: TempoPoint[];
  /** The time signature from bar 1 (optional; absent means 4/4) */
  meter?: Meter;
  /** Time signature changes (optional) */
  meterPoints?: MeterPoint[];
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
  /** The master section's inserts (older projects don't have them: both off). */
  master?: MasterSettings;
  /** Game stingers (older projects don't have any). */
  stingers?: Stinger[];
  /** Game sound effects (older projects don't have any). */
  sfx?: GameSfx[];
  /** Game costumes (older projects don't have any). */
  costumes?: Costume[];
  /** Game parameters (older projects don't have any). */
  gameParams?: GameParam[];
  /** How each game state plays, by section marker id. */
  stateOptions?: Record<string, StateOptions>;
  /** Transitions into game states, by section marker id. */
  transitions?: Record<string, TransitionRule>;
  /** Intensity: the level now and each stem group's curve. */
  intensity?: { value: number; curves: Record<string, IntensityCurve> };
  /** The reference video, if one is loaded */
  video?: ProjectVideo;
  /** Tempo changes (older projects don't have any) */
  tempoPoints?: TempoPoint[];
  /** The time signature from bar 1 (older projects are 4/4) */
  meter?: Meter;
  /** Time signature changes */
  meterPoints?: MeterPoint[];
}


export function serializeProject(p: ProjectSnapshot): ProjectData {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    modWheel: 'dynamics',
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
    master: normalizeMasterSettings(p.master),
    ...(p.stingers?.length ? { stingers: p.stingers } : {}),
    ...(p.sfx?.length ? { sfx: p.sfx } : {}),
    ...(p.costumes?.length ? { costumes: p.costumes } : {}),
    ...(p.gameParams?.length ? { gameParams: p.gameParams } : {}),
    ...(p.stateOptions && Object.keys(p.stateOptions).length ? { stateOptions: p.stateOptions } : {}),
    ...(p.transitions && Object.keys(p.transitions).length ? { transitions: p.transitions } : {}),
    ...(p.intensity && (Object.keys(p.intensity.curves).length || p.intensity.value !== 1) ? { intensity: p.intensity } : {}),
    ...(p.video ? { video: p.video } : {}),
    ...(p.tempoPoints?.length ? { tempoPoints: p.tempoPoints } : {}),
    ...(p.meter && (p.meter.num !== 4 || p.meter.den !== 4) ? { meter: p.meter } : {}),
    ...(p.meterPoints?.length ? { meterPoints: p.meterPoints } : {}),
  };
}

/** Tempo changes from a file: each needs a position after bar 1 and a tempo (clamped to range). */
function parseTempoPoints(raw: unknown): TempoPoint[] {
  if (!Array.isArray(raw)) return [];
  const points = raw
    .filter((v): v is Record<string, unknown> => isObj(v) && isNum(v.bar) && isNum(v.bpm))
    .map((v, i) => ({ id: isStr(v.id) && v.id ? v.id : `tempo-${i}`, bar: Math.min(TOTAL_BARS, v.bar as number), bpm: clampBpm(v.bpm as number), ramp: v.ramp === true }));
  return sortedPoints(points);
}

function parseMeterValue(v: unknown): Meter | null {
  if (!isObj(v) || !isNum(v.num) || !isNum(v.den)) return null;
  return parseMeter(`${Math.round(v.num)}/${Math.round(v.den)}`);
}

function parseMeterPoints(raw: unknown): MeterPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: MeterPoint[] = [];
  raw.forEach((v, i) => {
    const m = parseMeterValue(v);
    if (m && isObj(v) && isNum(v.bar) && v.bar > 1) out.push({ id: isStr(v.id) && v.id ? v.id : `meter-${i}`, bar: v.bar, ...m });
  });
  return sortedPoints(out);
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

/** A frozen track's freeze (its sound isn't in the file: elsewhere the track plays live until frozen again). */
function parseFrozen(v: unknown): FrozenTrack | undefined {
  if (!isObj(v) || !isStr(v.soundId) || !isNum(v.startBar) || !isNum(v.seconds) || !isStr(v.fingerprint)) return undefined;
  return { soundId: v.soundId, startBar: v.startBar, seconds: v.seconds, gainDb: isNum(v.gainDb) ? v.gainDb : 0, fingerprint: v.fingerprint };
}

/** A track's launcher slots: one per scene (the first kept), each a clip without a place in the song. */
function parseSlots(raw: unknown, trackId: string): LauncherSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: LauncherSlot[] = [];
  for (const x of raw.slice(0, 256)) {
    if (!isObj(x) || !isNum(x.scene) || x.scene < 0 || x.scene >= 64 || !isObj(x.clip)) continue;
    const scene = Math.floor(x.scene);
    if (out.some((o) => o.scene === scene)) continue;
    try {
      const c = parseClip({ ...x.clip, id: 'slot', trackId, startBar: 1 });
      out.push({
        scene,
        clip: {
          name: c.name,
          lengthBars: c.lengthBars,
          notes: c.notes,
          ...(c.wobble ? { wobble: c.wobble } : {}),
          ...(c.groove ? { groove: c.groove } : {}),
          ...(c.audio ? { audio: c.audio } : {}),
          ...(c.expression ? { expression: c.expression } : {}),
        },
      });
    } catch {
      // A slot this version can't read is left empty
    }
  }
  return out.sort((a, b) => a.scene - b.scene);
}

function parseTrack(v: unknown): Track {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isInstrumentKey(v.instrumentKey)) {
    throw new Error('a track is missing its id, name or instrument');
  }
  const eqObj = isObj(v.eq) ? v.eq : {};
  const automation = parseAutomation(v.automation);
  const slicer = normalizeSlicer(v.slicer);
  const synth = normalizeSynthPatch(v.synth);
  const frozen = parseFrozen(v.frozen);
  return {
    id: v.id,
    name: v.name,
    color: isStr(v.color) ? v.color : '#9ca3af',
    instrumentKey: v.instrumentKey as InstrumentKey,
    isMuted: v.isMuted === true,
    isSoloed: v.isSoloed === true,
    isArmed: v.isArmed === true,
    // In range, whatever the file says (an out-of-range level throws in the audio engine)
    volume: isNum(v.volume) ? Math.max(-60, Math.min(6, v.volume)) : 0,
    pan: isNum(v.pan) ? Math.max(-1, Math.min(1, v.pan)) : 0,
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
    // Optional: a Synth Designer track's patch
    ...(synth ? { synth } : {}),
    // Optional: a Drum Rack's pads, a Multi Sampler's sounds
    ...(normalizeRack(v.rack) ? { rack: normalizeRack(v.rack)! } : {}),
    ...(normalizeMulti(v.multi) ? { multi: normalizeMulti(v.multi)! } : {}),
    // Optional: a frozen track
    ...(frozen ? { frozen } : {}),
    // Optional: the bus it plays into (checked against the other tracks after they're read)
    ...(isStr(v.output) && v.output ? { output: v.output } : {}),
    // Optional: sends to return tracks (those to returns that aren't there are dropped on load)
    ...(Array.isArray(v.sends) && v.sends.some((x) => isObj(x) && isStr(x.to) && isNum(x.level))
      ? {
          sends: v.sends
            .filter((x): x is Record<string, unknown> => isObj(x) && isStr(x.to) && isNum(x.level))
            .slice(0, 32)
            .map((x) => ({ to: x.to as string, level: Math.max(0, Math.min(1, x.level as number)), ...(x.pre === true ? { pre: true } : {}) })),
        }
      : {}),
    // Optional: MIDI controller knobs mapped to its settings
    ...(Array.isArray(v.midiMap) && v.midiMap.some((x) => isObj(x) && isNum(x.cc) && isAutomationParam(x.param))
      ? {
          midiMap: v.midiMap
            .filter((x): x is Record<string, unknown> => isObj(x) && isNum(x.cc) && x.cc >= 0 && x.cc < 128 && isAutomationParam(x.param))
            .slice(0, 128)
            .map((x) => ({ cc: Math.round(x.cc as number), param: x.param as AutomationParam })),
        }
      : {}),
    // Optional: expressive playing (absent in projects from before it: they keep their sound)
    ...(v.expressive === true ? { expressive: true } : {}),
    // Optional: its clips in the clip launcher
    ...(parseSlots(v.slots, v.id).length ? { slots: parseSlots(v.slots, v.id) } : {}),
    // Optional: Web Audio Module plugins (the instrument of a Plugin track, and plugin effects)
    ...(parsePlugin(v.plugin) ? { plugin: parsePlugin(v.plugin)! } : {}),
    ...(Array.isArray(v.pluginFx) && v.pluginFx.some((p) => parsePlugin(p))
      ? { pluginFx: v.pluginFx.map(parsePlugin).filter((p): p is WamPlugin => !!p).slice(0, 16) }
      : {}),
    // Optional: its stem group for Intensity
    ...(isStr(v.stemGroup) && v.stemGroup.trim() ? { stemGroup: v.stemGroup.trim().slice(0, 40) } : {}),
    // Optional: the folder it's in
    ...(isObj(v.folder) && isStr(v.folder.id) && v.folder.id
      ? {
          folder: {
            id: v.folder.id,
            name: isStr(v.folder.name) && v.folder.name.trim() ? v.folder.name.slice(0, 60) : 'Folder',
            color: isStr(v.folder.color) ? v.folder.color : '#9ca3af',
            ...(v.folder.collapsed === true ? { collapsed: true } : {}),
          },
        }
      : {}),
    // Optional: a dialogue / SFX proxy the other tracks duck under
    ...(isObj(v.duckProxy) && isNum(v.duckProxy.depth) ? { duckProxy: { depth: Math.max(1, Math.min(30, v.duckProxy.depth)) } } : {}),
  };
}

/** A plugin on a track, or null if it's unreadable. */
function parsePlugin(v: unknown): WamPlugin | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.url) || !/^(https?:\/\/|builtin:)/.test(v.url)) return null;
  return {
    id: v.id,
    url: v.url,
    name: isStr(v.name) && v.name ? v.name.slice(0, 40) : 'Plugin',
    ...(v.state !== undefined && v.state !== null ? { state: v.state } : {}),
    ...(v.bypass === true ? { bypass: true } : {}),
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
    // A length the app can't read plays as a 16th rather than breaking playback
    duration: /^(\d+(\.\d+)?m|\d+:\d+(\.\d+)?(:\d+(\.\d+)?)?|\d+[nt]\.?|\d+i)$/.test(v.duration) ? v.duration : '16n',
    velocity: isNum(v.velocity) ? Math.max(0, Math.min(1, v.velocity)) : 0.8,
    ...(() => {
      const expr = normalizeNoteExpression(v.expr);
      return expr ? { expr } : {};
    })(),
  };
}

function parseClip(v: unknown): Clip {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.trackId) || !isNum(v.startBar) || !isNum(v.lengthBars) || !Array.isArray(v.notes)) {
    throw new Error('a clip is malformed');
  }
  const audio = normalizeClipAudio(v.audio);
  const expression = normalizeExpression(v.expression);
  const takes = normalizeTakes(v.takes, (n) => {
    try {
      return parseNote(n);
    } catch {
      return null;
    }
  });
  // On the timeline, whatever the file says
  const startBar = Math.max(1, Math.min(TOTAL_BARS, v.startBar));
  const lengthBars = Math.max(0.0625, Math.min(TOTAL_BARS + 1 - startBar, v.lengthBars));
  const comp = takes && Array.isArray(v.comp) ? v.comp.filter((s): s is CompSegment => isObj(s) && isNum(s.at) && isNum(s.take)) : [];
  return {
    id: v.id,
    trackId: v.trackId,
    name: isStr(v.name) ? v.name : 'Clip',
    startBar,
    // No clip is shorter than a 16th; a zero or negative length (a hand-edited file) would break edits
    lengthBars,
    // A note that can't be read is left out, not the whole clip
    notes: v.notes.flatMap((n) => {
      try {
        return [parseNote(n)];
      } catch {
        return [];
      }
    }),
    isSelected: false,
    // Optional: a rate this version doesn't know plays at the default
    ...(isWobbleRate(v.wobble) ? { wobble: v.wobble } : {}),
    // Optional: the clip's own swing
    ...(isObj(v.groove) && isNum(v.groove.swing) && (v.groove.grid === 8 || v.groove.grid === 16)
      ? { groove: { swing: Math.max(0, Math.min(MAX_CLIP_SWING, v.groove.swing)), grid: v.groove.grid } }
      : {}),
    // Optional: an audio clip (on an Audio track) plays a sound file instead of notes
    ...(audio ? { audio } : {}),
    // Optional: pitch bend, mod wheel and sustain pedal lanes
    ...(expression ? { expression } : {}),
    // Optional: a take folder (its takes, and which plays where)
    ...(takes ? { takes, comp: compSegments({ takes, comp, lengthBars }) } : {}),
  };
}

/**
 * A file saved while the mod wheel lane was vibrato: every expression (clips', launcher slots',
 * takes') gets its mod wheel lane moved to the Vibrato lane, so the song sounds as it did.
 */
function modWheelWasVibrato(raw: unknown, depth = 0): void {
  if (depth > 8 || typeof raw !== 'object' || raw === null) return;
  if (Array.isArray(raw)) {
    for (const v of raw) modWheelWasVibrato(v, depth + 1);
    return;
  }
  const o = raw as Record<string, unknown>;
  const e = o.expression as Record<string, unknown> | undefined;
  if (e && typeof e === 'object' && 'mod' in e && !('vibrato' in e)) {
    const { mod, ...rest } = e;
    o.expression = { ...rest, vibrato: mod };
  }
  for (const [k, v] of Object.entries(o)) if (k !== 'expression' && k !== 'notes' && typeof v === 'object') modWheelWasVibrato(v, depth + 1);
}

/** Validate untrusted JSON (a file or autosave) into a snapshot. Throws with a readable reason. */
export function parseProject(raw: unknown): ProjectSnapshot {
  if (!isObj(raw) || !(raw.format === PROJECT_FORMAT || LEGACY_FORMATS.includes(raw.format as string))) {
    throw new Error("this is not a Fledgetone project file");
  }
  if (!isNum(raw.version) || raw.version > PROJECT_VERSION) {
    throw new Error("this project was saved by a newer version of Fledgetone");
  }
  if (!Array.isArray(raw.tracks) || !Array.isArray(raw.clips)) throw new Error('tracks or clips are missing');
  // (The file's own objects are changed: it was parsed for this)
  if (raw.modWheel !== 'dynamics') modWheelWasVibrato([raw.clips, raw.tracks, raw.launcher]);

  // One of each id (a hand-edited or merged file can repeat one): the first is kept
  // A track or clip that can't be read (an instrument from a newer version, a damaged entry) is
  // left out, rather than the whole song: the rest still opens
  const tolerant = <T,>(items: unknown[], parse: (v: unknown) => T): T[] =>
    items.flatMap((v) => {
      try {
        return [parse(v)];
      } catch {
        return [];
      }
    });
  const parsedTracks = tolerant(raw.tracks, parseTrack);
  if (raw.tracks.length && !parsedTracks.length) parseTrack(raw.tracks[0]); // nothing readable: say why
  const tracks = parsedTracks.filter((t, i, all) => all.findIndex((o) => o.id === t.id) === i);
  const trackIds = new Set(tracks.map((t) => t.id));
  const loop = isObj(raw.loopRegion) ? raw.loopRegion : {};
  const fps = isFrameRate(raw.fps) ? raw.fps : DEFAULT_FRAME_RATE;
  const bpm = isNum(raw.bpm) ? Math.max(40, Math.min(240, raw.bpm)) : 122;
  const tempoPoints = parseTempoPoints(raw.tempoPoints);
  const tempo = { bpm, points: tempoPoints };
  const meter = parseMeterValue(raw.meter);
  const meterPoints = parseMeterPoints(raw.meterPoints);
  const sounds = parseEmbeddedSounds(raw.sounds);
  const markers = parseMarkers(raw.markers, tempo);
  return {
    name: isStr(raw.name) && raw.name.trim() ? raw.name : 'Untitled',
    bpm,
    swing: isNum(raw.swing) ? Math.max(0, Math.min(0.5, raw.swing)) : 0.2,
    // In order and on the timeline (an Out before the In would hold playback at the In)
    loopRegion: (() => {
      const inBar = isNum(loop.inBar) ? Math.max(1, Math.min(TOTAL_BARS, loop.inBar)) : 1;
      const outBar = isNum(loop.outBar) ? Math.min(TOTAL_BARS + 1, loop.outBar) : 5;
      return { inBar, outBar: outBar > inBar + 1 / 64 ? outBar : Math.min(TOTAL_BARS + 1, inBar + 4), enabled: loop.enabled !== false };
    })(),
    tracks,
    // A clip whose track is gone can't play or be seen. Older versions could save these (undo
    // after deleting a track), so skip them rather than refuse the whole file.
    clips: tolerant(raw.clips, parseClip)
      .filter((c, i, all) => trackIds.has(c.trackId) && all.findIndex((o) => o.id === c.id) === i),
    masterFx: parseMasterFx(raw.masterFx),
    fps,
    dropFrame: fps === 29.97 && raw.dropFrame === true,
    markers,
    ...(tempoPoints.length ? { tempoPoints } : {}),
    ...(meter ? { meter } : {}),
    ...(meterPoints.length ? { meterPoints } : {}),
    ...(sounds.length ? { sounds } : {}),
    master: normalizeMasterSettings(raw.master),
    stingers: parseStingers(raw.stingers, isInstrumentKey),
    sfx: parseGameSfx(raw.sfx),
    costumes: parseCostumes(raw.costumes, new Set(tracks.map((t) => t.id)), isInstrumentKey),
    gameParams: parseGameParams(raw.gameParams),
    stateOptions: parseStateOptions(raw.stateOptions, new Set(markers.map((m) => m.id))),
    transitions: parseTransitions(raw.transitions),
    intensity: {
      value: isObj(raw.intensity) && isNum(raw.intensity.value) ? Math.max(0, Math.min(1, raw.intensity.value)) : 1,
      curves: parseCurves(isObj(raw.intensity) ? raw.intensity.curves : undefined),
    },
    ...(isObj(raw.video) && isStr(raw.video.key) && isStr(raw.video.name)
      ? {
          video: {
            key: raw.video.key,
            name: raw.video.name,
            type: isStr(raw.video.type) ? raw.video.type : 'video/mp4',
            start: isNum(raw.video.start) ? raw.video.start : 0,
            ...(isStr(raw.video.data) && raw.video.data.startsWith('data:') ? { data: raw.video.data } : {}),
          },
        }
      : {}),
  };
}

function parseMasterFx(v: unknown): MasterFx {
  if (!isObj(v)) return DEFAULT_MASTER_FX;
  const d = DEFAULT_MASTER_FX;
  return {
    reverbDecay: isNum(v.reverbDecay) ? Math.max(0.8, Math.min(12, v.reverbDecay)) : d.reverbDecay,
    delayTime: isStr(v.delayTime) && ['4n', '8n', '8n.', '16n'].includes(v.delayTime) ? v.delayTime : d.delayTime,
    delayFeedback: isNum(v.delayFeedback) ? Math.max(0, Math.min(0.8, v.delayFeedback)) : d.delayFeedback,
    ...(isStr(v.room) && v.room ? { room: v.room } : {}),
  };
}


/**
 * Projects in browser storage write each note as a short list ([note, startOffset, duration,
 * velocity, expr?]) instead of an object with its id: about a third of the size, exactly the same
 * notes. (Browser storage holds about 5 MB, and a big song is mostly notes.) Notes get new ids
 * when read back.
 */
function packForStorage<T extends { clips: Array<{ notes: NoteEvent[] }> }>(data: T): unknown {
  return {
    ...data,
    clips: data.clips.map((c) => {
      if (!c.notes.length) return c;
      const { notes, ...rest } = c;
      return { ...rest, N: notes.map((n) => (n.expr ? [n.note, n.startOffset, n.duration, n.velocity, n.expr] : [n.note, n.startOffset, n.duration, n.velocity])) };
    }),
  };
}

/** A stored project with its notes as objects again (one in the older, unpacked form passes through). */
function unpackStored(raw: unknown): unknown {
  if (!isObj(raw) || !Array.isArray(raw.clips)) return raw;
  let id = 0;
  return {
    ...raw,
    clips: raw.clips.map((c) => {
      if (!isObj(c) || !Array.isArray(c.N)) return c;
      const { N, ...rest } = c;
      const notes = (N as unknown[]).filter(Array.isArray).map((n) => ({
        id: `s${(id++).toString(36)}`,
        note: n[0],
        startOffset: n[1],
        duration: n[2],
        velocity: n[3],
        ...(n[4] ? { expr: n[4] } : {}),
      }));
      return { ...rest, notes };
    }),
  };
}

/** True when the startup autosave couldn't be read (it was kept aside, not overwritten). */
export let autosaveUnreadable = false;
/** True while the session the banner offers couldn't be copied aside (no room): autosave mustn't overwrite its only stored copy. */
let previousOnlyInAutosave = false;

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
  // The session the banner offers is stored only in the autosave: keep it until Restore or Dismiss
  if (offeringPrevious && previousOnlyInAutosave) return { ok: false, reason: 'full' };
  const json = JSON.stringify(packForStorage({ ...serializeProject(p), savedAt: Date.now() }));
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
  /** Set aside this time round, by New, Open or a link replacing it (not found at startup) */
  replaced?: boolean;
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
      let raw: unknown;
      let project: ProjectSnapshot;
      try {
        raw = JSON.parse(json);
        project = parseProject(unpackStored(raw));
      } catch {
        // Damaged, or from a newer version: keep it as it is, rather than let the first edit overwrite it
        autosaveUnreadable = true;
        try {
          localStorage.setItem(UNREADABLE_KEY, json);
        } catch {
          // No room for a copy
        }
        throw new Error('unreadable autosave');
      }
      if (hasWork(project)) {
        const savedAt = timeOf(raw, 'savedAt');
        // An autosave from an older version doesn't say when it was saved, only that it was before
        // the first startup that set it aside: keep that time through later reloads
        const earlier = savedAt === null ? readPreviousSlot() : null;
        const keptAt = (earlier?.savedAt === null ? earlier.keptAt : null) ?? Date.now();
        fromAutosave = { project, savedAt, keptAt };
        // If the copy doesn't fit, the autosave is its only stored copy: autosave leaves it be
        previousOnlyInAutosave = true;
        localStorage.setItem(PREVIOUS_SESSION_KEY, JSON.stringify({ savedAt, keptAt, project: raw }));
        previousOnlyInAutosave = false;
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
    const project = parseProject(unpackStored(slot.project));
    return hasWork(project) ? { project, savedAt: slot.savedAt, keptAt: slot.keptAt } : null;
  } catch {
    return null;
  }
}

/**
 * Set the current song aside as the session the Restore banner offers, before something replaces
 * it (New, Open, a shared link): so nothing is lost without a way back. Returns the session.
 */
export function setAsideSession(p: ProjectSnapshot): SavedSession {
  const now = Date.now();
  offeringPrevious = true;
  try {
    localStorage.setItem(PREVIOUS_SESSION_KEY, JSON.stringify({ savedAt: now, keptAt: now, project: packForStorage(serializeProject(p)) }));
    previousOnlyInAutosave = false;
  } catch {
    // No room or storage blocked: it's still offered while this page is open, and the autosave
    // (which may be its only stored copy) is left alone until Restore or Dismiss
    previousOnlyInAutosave = true;
  }
  return { project: p, savedAt: now, keptAt: now, replaced: true };
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
  previousOnlyInAutosave = false;
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
