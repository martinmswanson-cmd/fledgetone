/**
 * The agent's edit vocabulary (ops, version 1) and applyOps, which turns a list of ops into a new
 * song. An agent suggests a change as `{ opsVersion: 1, ops: [...] }`; applyOps checks every op's
 * shape (errors name the op's index and the field's path), applies them in order to a copy of the
 * song with the same rules the store's actions follow, and returns the new song with plain-words
 * changes, warnings and the bars to listen to. The song passed in is never changed.
 *
 * Units are the store's: song positions in bars from 1, note start and length in bars inside the
 * clip (lengths are written "<n>m"), levels in dB, sends and automation values 0 to 1. An op that
 * makes something (a track, a clip, a marker, a tempo change) can name it with `ref`; later ops
 * point at it as "$name" wherever an id goes.
 *
 * The result goes through the project file's own check (parse of serialize), so a suggestion can
 * never hold what a saved file couldn't; anything that check brought into range is a warning.
 * Ids come from withStableIds(idBase), so the same ops on the same song give the same song, ids
 * and all: what's heard before Accept is what Accept applies (the Human insert's drift follows the
 * ids). Plain logic: no store, no Web Audio, so it runs in Node and in the agent tools.
 */
import { parseProject, serializeProject, type ProjectSnapshot } from '../store/project';
import { makeTrack } from '../store/trackFactory';
import { syncPatterns, unlinked } from '../store/patterns';
import { retimeAudioClips } from '../store/audioClips';
import { cleanMarkerName, createMarker, MARKER_NAME_MAX, nextMarkerName, placeMarker, retimeMarkers } from '../store/markers';
import { isBus, isMixTrack, isReturn, tidyRoutes, tidySends, wouldLoop } from '../store/buses';
import { DRUM_NOTES } from '../store/drumNotes';
import { midiOf, nameOf } from '../store/noteTools';
import { presetPatch, SYNTH_PRESETS } from '../store/synthPatch';
import { designedKitStart } from '../store/synthKits';
import { followTracks } from '../store/drumFollow';
import {
  defaultLoud,
  defaultTrackFx,
  DEFAULT_MONO_LOW,
  DEFAULT_SATURATE,
  isAutomationParam,
  normalizeMasterSettings,
  normalizeTrackFx,
  REVERB_SEND_MAX,
  TOTAL_BARS,
  uid,
  withStableIds,
  type AutomationParam,
  type AutomationPoint,
  type Clip,
  type InstrumentKey,
  type Marker,
  type MasterSettings,
  type NoteEvent,
  type Track,
  type TrackFx,
} from '../store/timelineTypes';
import { INSTRUMENTS, canMoveClipBetween, isAudioKind, isDropKind, isDrumKind, isFxKind, isInstrumentKey } from '../audio/instrumentCatalog';
import { normalizePoints, specOf } from '../audio/automation';
import { clampBpm, sortedPoints, type TempoMap, type TempoPoint } from '../audio/tempoMap';
import { defaultClipper } from '../audio/effects/clipper';
import { diffSongs, type SongDiff } from './songDiff';
import { checkSafety } from './safety';
import { firstDifference, stableJson } from './fingerprint';
import { agentLabel, LIMITS } from './protocol';
import { byAgentId } from './agentText';


/** The version of the op vocabulary this file reads. */
export const OPS_VERSION = 1;
/** Most ops in one suggestion. */
export const MAX_OPS = LIMITS.maxOps;
/** Most notes one suggestion may add. */
export const MAX_ADDED_NOTES = LIMITS.maxAddedNotes;
/** Most automation points in one lane. */
export const MAX_LANE_POINTS = 2000;
/** The shortest note or clip, in bars (a 16th note in 4/4). */
export const MIN_LENGTH = 1 / 16;

/** A note as an op writes it: a pitch ("C#3", or a drum row like "kick" on a drum track), where it starts and how long it is in bars inside its clip, and how hard it's played (0 to 1). */
export interface OpNote {
  pitch: string;
  start: number;
  length: number;
  velocity?: number;
}

/** A change to one note, found by its id: only the fields given change. */
export interface OpNoteChange {
  id: string;
  pitch?: string;
  start?: number;
  length?: number;
  velocity?: number;
}

/** Every op of version 1. Ids may be "$ref" names given by earlier ops. */
export type Op =
  | { op: 'add_notes'; clipId: string; notes: OpNote[] }
  | { op: 'change_notes'; clipId: string; notes: OpNoteChange[] }
  | { op: 'remove_notes'; clipId: string; noteIds?: string[]; all?: boolean; fromBar?: number; toBar?: number }
  | { op: 'transpose_notes'; clipId: string; semitones: number; noteIds?: string[] }
  | { op: 'add_clip'; trackId: string; startBar: number; lengthBars: number; name?: string; notes?: OpNote[]; ref?: string }
  | { op: 'move_clip'; clipId: string; toBar?: number; trackId?: string }
  | { op: 'resize_clip'; clipId: string; lengthBars: number }
  | { op: 'remove_clip'; clipId: string }
  | { op: 'duplicate_clip'; clipId: string; toBar: number; trackId?: string; linked?: boolean; ref?: string }
  | { op: 'add_track'; instrument: string; name?: string; ref?: string }
  | {
      op: 'set_track';
      trackId: string;
      volumeDb?: number;
      pan?: number;
      mute?: boolean;
      solo?: boolean;
      name?: string;
      reverbSend?: number;
      delaySend?: number;
      distance?: number;
      output?: string | null;
    }
  | { op: 'set_eq'; trackId: string; low?: number; mid?: number; high?: number }
  | { op: 'set_insert'; trackId: string; insert: string; settings: Record<string, unknown> }
  | { op: 'set_instrument'; trackId: string; instrument: string }
  | { op: 'set_synth_preset'; trackId: string; preset: string }
  | { op: 'set_automation'; trackId: string; param: string; points: Array<{ bar: number; value: number; curve?: number }> }
  | { op: 'remove_automation'; trackId: string; param: string }
  | { op: 'set_tempo'; bpm: number }
  | { op: 'add_tempo_change'; bar: number; bpm: number; ramp?: boolean; ref?: string }
  | { op: 'remove_tempo_change'; id: string }
  | { op: 'add_marker'; bar: number; name?: string; ref?: string }
  | { op: 'move_marker'; markerId: string; bar: number }
  | { op: 'rename_marker'; markerId: string; name: string }
  | { op: 'remove_marker'; markerId: string }
  | {
      op: 'set_master';
      levelDb?: number;
      glue?: string;
      ott?: Record<string, unknown>;
      width?: Record<string, unknown>;
      loud?: Record<string, unknown>;
      clipper?: Record<string, unknown>;
    };

export type OpName = Op['op'];

/** A suggestion's ops, as an agent sends them. */
export interface OpsDocument {
  opsVersion: number;
  ops: Op[];
}

/** Why an op can't be applied: which op (0-based), the field (`ops[2].notes[0].pitch`) and why, in plain words. */
export interface OpError {
  op: number;
  path: string;
  message: string;
}

/** What applyOps made. */
export interface ApplyResult {
  ok: true;
  /** The song with the ops applied (objects the ops didn't touch are the same objects as the song passed in). */
  song: ProjectSnapshot;
  /** Plain-words cautions: values brought into range, big level jumps, notes out of an instrument's range. */
  warnings: string[];
  /** Plain-words things worth knowing that need no care (a quiet track unmuted): shown, not in amber. */
  notes: string[];
  /** What changed, in plain words, with the tracks, clips and bars it touches (see songDiff.ts). */
  diff: SongDiff;
  /** The ids the ops' `ref` names stand for. */
  refs: Record<string, string>;
  /**
   * The id base the new ids were made from: the one asked for, or, when the song already holds ids
   * made from it (the same suggestion applied before), the first free one after it ("<base>~2"...).
   */
  idBase: string;
  /** How many ops ran, and how many notes they added. */
  stats: { ops: number; addedNotes: number };
}

export type ApplyOutcome = ApplyResult | { ok: false; errors: OpError[] };

type FieldType = 'string' | 'number' | 'boolean' | 'id' | 'ids' | 'array' | 'object' | 'idOrNull';
type Spec = Record<string, [FieldType, boolean]>;

/** Each op's fields: their type and whether they're required. */
const OP_SPECS: Record<OpName, Spec> = {
  add_notes: { clipId: ['id', true], notes: ['array', true] },
  change_notes: { clipId: ['id', true], notes: ['array', true] },
  remove_notes: { clipId: ['id', true], noteIds: ['ids', false], all: ['boolean', false], fromBar: ['number', false], toBar: ['number', false] },
  transpose_notes: { clipId: ['id', true], semitones: ['number', true], noteIds: ['ids', false] },
  add_clip: { trackId: ['id', true], startBar: ['number', true], lengthBars: ['number', true], name: ['string', false], notes: ['array', false], ref: ['string', false] },
  move_clip: { clipId: ['id', true], toBar: ['number', false], trackId: ['id', false] },
  resize_clip: { clipId: ['id', true], lengthBars: ['number', true] },
  remove_clip: { clipId: ['id', true] },
  duplicate_clip: { clipId: ['id', true], toBar: ['number', true], trackId: ['id', false], linked: ['boolean', false], ref: ['string', false] },
  add_track: { instrument: ['string', true], name: ['string', false], ref: ['string', false] },
  set_track: {
    trackId: ['id', true],
    volumeDb: ['number', false],
    pan: ['number', false],
    mute: ['boolean', false],
    solo: ['boolean', false],
    name: ['string', false],
    reverbSend: ['number', false],
    delaySend: ['number', false],
    distance: ['number', false],
    output: ['idOrNull', false],
  },
  set_eq: { trackId: ['id', true], low: ['number', false], mid: ['number', false], high: ['number', false] },
  set_insert: { trackId: ['id', true], insert: ['string', true], settings: ['object', true] },
  set_instrument: { trackId: ['id', true], instrument: ['string', true] },
  set_synth_preset: { trackId: ['id', true], preset: ['string', true] },
  set_automation: { trackId: ['id', true], param: ['string', true], points: ['array', true] },
  remove_automation: { trackId: ['id', true], param: ['string', true] },
  set_tempo: { bpm: ['number', true] },
  add_tempo_change: { bar: ['number', true], bpm: ['number', true], ramp: ['boolean', false], ref: ['string', false] },
  remove_tempo_change: { id: ['id', true] },
  add_marker: { bar: ['number', true], name: ['string', false], ref: ['string', false] },
  move_marker: { markerId: ['id', true], bar: ['number', true] },
  rename_marker: { markerId: ['id', true], name: ['string', true] },
  remove_marker: { markerId: ['id', true] },
  set_master: { levelDb: ['number', false], glue: ['string', false], ott: ['object', false], width: ['object', false], loud: ['object', false], clipper: ['object', false] },
};

/** The op names of version 1, in the order the docs list them. */
export const OP_NAMES = Object.keys(OP_SPECS) as OpName[];

/** The inserts set_insert can change (the Bass Drive and plugins aren't in version 1). */
export const INSERT_NAMES = ['distortion', 'compressor', 'chorus', 'filter', 'pump', 'lofi', 'gate', 'echo', 'reverb', 'human', 'peq', 'mbc', 'saturate', 'monoLow'] as const;
export type InsertName = (typeof INSERT_NAMES)[number];

/** An insert's settings as they start (what set_insert merges onto when a track never had it). */
export function insertDefaults(insert: InsertName): Record<string, unknown> {
  if (insert === 'saturate') return { ...DEFAULT_SATURATE };
  if (insert === 'monoLow') return { ...DEFAULT_MONO_LOW };
  return { ...(defaultTrackFx()[insert] as unknown as Record<string, unknown>) };
}

/** Instruments a suggestion can't add or switch to: they play sound files or a plugin, which an agent can't give. */
const NEEDS_FILES = new Set(['custom', 'slicer', 'audio', 'plugin', 'rack', 'multi']);
/** Whether a suggestion may add or switch to this instrument. */
export const opInstrumentAllowed = (key: InstrumentKey): boolean => !NEEDS_FILES.has(INSTRUMENTS[key].kind);

const EPS = 1e-9;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number, places = 6) => Math.round(v * 10 ** places) / 10 ** places;
/** A length in bars as a note duration ("0.25m"). */
const lengthText = (bars: number) => `${round(bars)}m`;

/** Thrown inside applyOps to stop at the first op that can't be applied. */
class OpFail extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(message);
    this.path = path;
  }
}

/** The shape checks: every op known, every field of the right type, nothing unknown. Errors for all of them, at most 50. */
export function checkOpsShape(doc: unknown): OpError[] {
  const errors: OpError[] = [];
  const fail = (op: number, path: string, message: string) => {
    if (errors.length < 50) errors.push({ op, path, message });
  };
  if (!isObj(doc)) return [{ op: -1, path: '', message: 'expected an object { "opsVersion": 1, "ops": [...] }' }];
  if (doc.opsVersion !== OPS_VERSION) fail(-1, 'opsVersion', `this is ops version ${OPS_VERSION}: set "opsVersion": ${OPS_VERSION}`);
  if (!Array.isArray(doc.ops)) {
    fail(-1, 'ops', 'expected a list of ops');
    return errors;
  }
  if (!doc.ops.length) fail(-1, 'ops', 'there are no ops: a suggestion changes at least one thing');
  if (doc.ops.length > MAX_OPS) fail(-1, 'ops', `${doc.ops.length} ops is too many: at most ${MAX_OPS} in one suggestion`);
  const refs = new Set<string>();
  doc.ops.slice(0, MAX_OPS).forEach((raw, i) => {
    const at = `ops[${i}]`;
    if (!isObj(raw)) return fail(i, at, 'expected an object with an "op" field');
    const name = raw.op;
    if (typeof name !== 'string' || !(name in OP_SPECS)) return fail(i, `${at}.op`, `unknown op ${JSON.stringify(name)}: the ops are ${OP_NAMES.join(', ')}`);
    const spec = OP_SPECS[name as OpName];
    for (const key of Object.keys(raw)) if (key !== 'op' && !(key in spec)) fail(i, `${at}.${key}`, `${name} has no field "${key}" (it has ${Object.keys(spec).join(', ')})`);
    for (const [key, [type, required]] of Object.entries(spec)) {
      const v = raw[key];
      const path = `${at}.${key}`;
      if (v === undefined) {
        if (required) fail(i, path, `${name} needs "${key}"`);
        continue;
      }
      const bad = (what: string) => fail(i, path, `expected ${what}`);
      switch (type) {
        case 'string':
          if (typeof v !== 'string') bad('text');
          else if (v.length > 2000) bad('at most 2000 characters');
          break;
        case 'number':
          if (!isNum(v)) bad('a number');
          break;
        case 'boolean':
          if (typeof v !== 'boolean') bad('true or false');
          break;
        case 'id':
          if (typeof v !== 'string' || !v || v.length > 120) bad('an id (or a "$name" an earlier op gave with ref)');
          break;
        case 'idOrNull':
          if (v !== null && (typeof v !== 'string' || !v || v.length > 120)) bad('an id, or null');
          break;
        case 'ids':
          if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) bad('a list of ids');
          break;
        case 'array':
          if (!Array.isArray(v)) bad('a list');
          break;
        case 'object':
          if (!isObj(v)) bad('an object');
          break;
      }
    }
    if (typeof raw.ref === 'string') {
      if (!/^[A-Za-z][\w-]{0,39}$/.test(raw.ref)) fail(i, `${at}.ref`, 'a ref is a name of letters, digits, - and _ (starting with a letter), at most 40 characters');
      else if (refs.has(raw.ref)) fail(i, `${at}.ref`, `ref "${raw.ref}" is already used by an earlier op`);
      refs.add(raw.ref);
    }
  });
  return errors;
}

/** The song as ops change it: the snapshot's parts the vocabulary reaches. */
interface Work {
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  bpm: number;
  tempoPoints: TempoPoint[];
  master: MasterSettings;
}

const tempoOf = (w: Pick<Work, 'bpm' | 'tempoPoints'>): TempoMap => ({ bpm: w.bpm, points: w.tempoPoints });

/**
 * Apply `doc` (`{ opsVersion: 1, ops }`) to `base`. Never changes `base`. `idBase` makes the new
 * objects' ids: the studio gives each suggestion one of its own, unique to it ("sg-<random id>"),
 * and uses it again at Accept, so what was heard is what's applied. If `base` already holds ids
 * made from it, the next free one is used ("<idBase>~2"; the result's `idBase` says which), so no
 * id is ever given twice. Errors (shape, or the first op that can't be applied) come back with the
 * op's index.
 */
export function applyOps(base: ProjectSnapshot, doc: unknown, opts: { idBase: string }): ApplyOutcome {
  const shape = checkOpsShape(doc);
  if (shape.length) return { ok: false, errors: shape };
  const ops = (doc as OpsDocument).ops;
  const warnings: string[] = [];
  const warn = (text: string) => {
    if (!warnings.includes(text) && warnings.length < 100) warnings.push(text);
  };
  const refs = new Map<string, { kind: 'track' | 'clip' | 'marker' | 'tempo'; id: string }>();
  let addedNotes = 0;
  const w: Work = {
    tracks: base.tracks,
    clips: base.clips,
    markers: base.markers ?? [],
    bpm: base.bpm,
    tempoPoints: base.tempoPoints ?? [],
    // (the same object unless set_master changes it)
    master: base.master ?? normalizeMasterSettings(undefined),
  };

  const idBase = freeIdBase(base, opts.idBase);
  const notesBefore = base.clips.reduce((n, c) => n + c.notes.length, 0);
  let index = 0;
  try {
    withStableIds(idBase, () => {
      for (; index < ops.length; index++) {
        const before = w.clips;
        applyOne(ops[index], `ops[${index}]`);
        // Linked clips follow an edit of one of them, as the store's every change does
        if (w.clips !== before) w.clips = syncPatterns(before, w.clips) ?? w.clips;
      }
    });
  } catch (err) {
    if (err instanceof OpFail) return { ok: false, errors: [{ op: index, path: err.path, message: err.message }] };
    throw err;
  }

  // ---------- The ops ----------

  function applyOne(op: Op, at: string): void {
    switch (op.op) {
      case 'add_notes': {
        const clip = noteClip(op.clipId, `${at}.clipId`);
        const track = trackById(clip.trackId);
        const notes = readNotes(op.notes, `${at}.notes`, clip, track);
        replaceClip(clip, { ...clip, notes: [...clip.notes, ...notes] });
        return;
      }
      case 'change_notes': {
        const clip = noteClip(op.clipId, `${at}.clipId`);
        const track = trackById(clip.trackId);
        const byId = new Map<string, NoteEvent>();
        op.notes.forEach((raw, i) => {
          const path = `${at}.notes[${i}]`;
          if (!isObj(raw) || typeof raw.id !== 'string') throw new OpFail(path, 'expected { "id": "<note id>", ...the fields to change }');
          for (const k of Object.keys(raw)) if (!['id', 'pitch', 'start', 'length', 'velocity'].includes(k)) throw new OpFail(`${path}.${k}`, `a note change has id, pitch, start, length and velocity, not "${k}"`);
          const note = byAgentId(clip.notes, raw.id);
          if (!note) throw new OpFail(`${path}.id`, `clip "${clip.name}" has no note ${JSON.stringify(raw.id)} (get_notes lists them)`);
          const pitch = raw.pitch === undefined ? note.note : readPitch(raw.pitch, `${path}.pitch`, track);
          const start = raw.start === undefined ? note.startOffset : readStart(raw.start, `${path}.start`, clip);
          const length = raw.length === undefined ? undefined : readLength(raw.length, `${path}.length`);
          const velocity = raw.velocity === undefined ? note.velocity : readVelocity(raw.velocity, `${path}.velocity`);
          byId.set(note.id, { ...note, note: pitch, startOffset: start, ...(length !== undefined ? { duration: lengthText(length) } : {}), velocity });
        });
        replaceClip(clip, { ...clip, notes: clip.notes.map((n) => byId.get(n.id) ?? n) });
        return;
      }
      case 'remove_notes': {
        const clip = noteClip(op.clipId, `${at}.clipId`);
        const ways = [op.noteIds !== undefined, op.all === true, op.fromBar !== undefined || op.toBar !== undefined].filter(Boolean).length;
        if (ways !== 1) throw new OpFail(at, 'remove_notes takes one of: "noteIds", "all": true, or "fromBar" and "toBar" (song bars)');
        let keep: (n: NoteEvent) => boolean;
        if (op.noteIds) {
          const ids = new Set<string>();
          op.noteIds.forEach((id, i) => {
            const note = byAgentId(clip.notes, id);
            if (!note) throw new OpFail(`${at}.noteIds[${i}]`, `clip "${clip.name}" has no note ${JSON.stringify(id)}`);
            ids.add(note.id);
          });
          keep = (n) => !ids.has(n.id);
        } else if (op.all) keep = () => false;
        else {
          if (!isNum(op.fromBar) || !isNum(op.toBar) || op.toBar <= op.fromBar) throw new OpFail(`${at}.toBar`, 'give both fromBar and toBar, toBar after fromBar (song bars, toBar not included)');
          const from = op.fromBar - clip.startBar;
          const to = op.toBar - clip.startBar;
          keep = (n) => n.startOffset < from - EPS || n.startOffset >= to - EPS;
        }
        const notes = clip.notes.filter(keep);
        if (notes.length === clip.notes.length) warn(`remove_notes (op ${index}) found no notes to remove in "${clip.name}".`);
        else replaceClip(clip, { ...clip, notes });
        return;
      }
      case 'transpose_notes': {
        const clip = noteClip(op.clipId, `${at}.clipId`);
        const track = trackById(clip.trackId);
        if (isDrumKind(track.instrumentKey) || isFxKind(track.instrumentKey) || isDropKind(track.instrumentKey))
          throw new OpFail(`${at}.clipId`, `"${track.name}" plays a drum, effect or move on each note, not a pitch: change the notes' pitch with change_notes instead`);
        if (!Number.isInteger(op.semitones) || Math.abs(op.semitones) > 48) throw new OpFail(`${at}.semitones`, 'expected a whole number of semitones, -48 to 48');
        const ids = op.noteIds ? new Set(op.noteIds.map((id) => byAgentId(clip.notes, id)?.id ?? id)) : null;
        const [lo, hi] = INSTRUMENTS[track.instrumentKey].range;
        let held = 0;
        const notes = clip.notes.map((n) => {
          if (ids && !ids.has(n.id)) return n;
          const m = midiOf(n.note) + op.semitones;
          if (!Number.isFinite(m) || m < lo || m > hi) {
            held++;
            return n;
          }
          return { ...n, note: nameOf(m) };
        });
        if (held) warn(`${held} note${held === 1 ? '' : 's'} in "${clip.name}" would leave ${INSTRUMENTS[track.instrumentKey].name}'s range (${nameOf(lo)} to ${nameOf(hi)}) and stayed where they were.`);
        replaceClip(clip, { ...clip, notes });
        return;
      }
      case 'add_clip': {
        const track = trackRef(op.trackId, `${at}.trackId`);
        clipHolder(track, `${at}.trackId`);
        const lengthBars = readClipLength(op.lengthBars, `${at}.lengthBars`);
        const startBar = readBar(op.startBar, `${at}.startBar`, TOTAL_BARS + 1 - lengthBars);
        const count = w.clips.filter((c) => c.trackId === track.id).length + 1;
        const clip: Clip = {
          id: uid('clip'),
          trackId: track.id,
          name: cleanName(op.name, `${at}.name`) ?? `${track.name} ${count}`,
          startBar,
          lengthBars,
          notes: [],
          isSelected: false,
        };
        const notes = op.notes ? readNotes(op.notes, `${at}.notes`, clip, track) : [];
        w.clips = [...w.clips, { ...clip, notes }];
        remember(op.ref, 'clip', clip.id);
        return;
      }
      case 'move_clip': {
        const clip = editableClip(op.clipId, `${at}.clipId`);
        if (op.toBar === undefined && op.trackId === undefined) throw new OpFail(at, 'move_clip needs "toBar", "trackId" or both');
        let trackId = clip.trackId;
        if (op.trackId !== undefined) {
          const to = trackRef(op.trackId, `${at}.trackId`);
          const from = trackById(clip.trackId);
          if (!canMoveClipBetween(from.instrumentKey, to.instrumentKey)) throw new OpFail(`${at}.trackId`, `a clip of "${from.name}" (${INSTRUMENTS[from.instrumentKey].name}) can't play on "${to.name}" (${INSTRUMENTS[to.instrumentKey].name})`);
          trackId = to.id;
        }
        const startBar = op.toBar === undefined ? clip.startBar : readBar(op.toBar, `${at}.toBar`, TOTAL_BARS + 1 - clip.lengthBars);
        replaceClip(clip, { ...clip, startBar, trackId });
        return;
      }
      case 'resize_clip': {
        const clip = editableClip(op.clipId, `${at}.clipId`);
        const lengthBars = readClipLength(op.lengthBars, `${at}.lengthBars`, TOTAL_BARS + 1 - clip.startBar);
        const hidden = clip.notes.filter((n) => n.startOffset >= lengthBars - EPS).length;
        if (hidden) warn(`"${clip.name}" gets shorter than ${hidden} of its notes: they stay in the clip but don't play.`);
        replaceClip(clip, { ...clip, lengthBars });
        return;
      }
      case 'remove_clip': {
        const clip = clipRef(op.clipId, `${at}.clipId`);
        w.clips = w.clips.filter((c) => c !== clip);
        return;
      }
      case 'duplicate_clip': {
        const clip = editableClip(op.clipId, `${at}.clipId`);
        let trackId = clip.trackId;
        if (op.trackId !== undefined) {
          const to = trackRef(op.trackId, `${at}.trackId`);
          const from = trackById(clip.trackId);
          if (!canMoveClipBetween(from.instrumentKey, to.instrumentKey)) throw new OpFail(`${at}.trackId`, `a clip of "${from.name}" can't play on "${to.name}"`);
          trackId = to.id;
        }
        const startBar = readBar(op.toBar, `${at}.toBar`, TOTAL_BARS + 1 - clip.lengthBars);
        let copy: Clip;
        if (op.linked) {
          // As "Duplicate linked": the original joins a pattern (its own, or a new one) and the copy shares its content
          const pattern = clip.pattern ?? uid('pattern');
          const original = clip.pattern ? clip : { ...clip, pattern };
          replaceClip(clip, original);
          copy = { ...original, id: uid('clip'), trackId, startBar, isSelected: false, pattern };
        } else {
          copy = { ...unlinked(clip), id: uid('clip'), trackId, startBar, isSelected: false, notes: clip.notes.map((n) => ({ ...n, id: uid('note') })) };
        }
        // A copy's notes are notes the suggestion adds (a linked copy plays them too)
        countNotes(clip.notes.length, `${at}.clipId`);
        w.clips = [...w.clips, copy];
        remember(op.ref, 'clip', copy.id);
        return;
      }
      case 'add_track': {
        const key = readInstrument(op.instrument, `${at}.instrument`);
        const made = makeTrack(key, w.tracks, cleanName(op.name, `${at}.name`) ?? undefined);
        // A bus or a return sends nothing to the reverb itself unless asked (as the store's addTrack)
        const track = isMixTrack(made) ? { ...made, reverbSend: 0, delaySend: 0 } : made;
        w.tracks = [...w.tracks, track];
        remember(op.ref, 'track', track.id);
        return;
      }
      case 'set_track': {
        const track = trackRef(op.trackId, `${at}.trackId`);
        const next: Track = { ...track };
        if (op.volumeDb !== undefined) next.volume = clamped(op.volumeDb, -60, 6, `"${track.name}" volume`, 'dB');
        if (op.pan !== undefined) next.pan = clamped(op.pan, -1, 1, `"${track.name}" pan`);
        if (op.mute !== undefined) next.isMuted = op.mute;
        if (op.solo !== undefined) next.isSoloed = op.solo;
        if (op.name !== undefined) next.name = cleanName(op.name, `${at}.name`, 'a track name needs at least one letter')!;
        if (op.reverbSend !== undefined) next.reverbSend = clamped(op.reverbSend, 0, REVERB_SEND_MAX, `"${track.name}" reverb send`);
        if (op.delaySend !== undefined) next.delaySend = clamped(op.delaySend, 0, 1, `"${track.name}" delay send`);
        if (op.distance !== undefined) next.distance = clamped(op.distance, 0, 1, `"${track.name}" distance`);
        if (op.output !== undefined) {
          if (op.output === null) delete next.output;
          else {
            const bus = trackRef(op.output, `${at}.output`);
            if (!isBus(bus)) throw new OpFail(`${at}.output`, `"${bus.name}" isn't a bus: a track plays into a bus, or the master (null)`);
            if (bus.id === track.id || wouldLoop(track.id, bus.id, w.tracks)) throw new OpFail(`${at}.output`, `"${track.name}" can't play into "${bus.name}": the sound would go round in a loop`);
            next.output = bus.id;
          }
        }
        replaceTrack(track, next);
        return;
      }
      case 'set_eq': {
        const track = trackRef(op.trackId, `${at}.trackId`);
        const eq = { ...track.eq };
        for (const band of ['low', 'mid', 'high'] as const) if (op[band] !== undefined) eq[band] = clamped(op[band]!, -24, 12, `"${track.name}" EQ ${band}`, 'dB');
        replaceTrack(track, { ...track, eq });
        return;
      }
      case 'set_insert': {
        const track = trackRef(op.trackId, `${at}.trackId`);
        if (!(INSERT_NAMES as readonly string[]).includes(op.insert)) throw new OpFail(`${at}.insert`, `unknown insert ${JSON.stringify(op.insert)}: the inserts are ${INSERT_NAMES.join(', ')}`);
        const insert = op.insert as InsertName;
        const defaults = insertDefaults(insert);
        for (const [k, v] of Object.entries(op.settings)) {
          if (!Object.hasOwn(defaults, k) && !(insert === 'pump' && ['source', 'shape', 'points'].includes(k))) throw new OpFail(`${at}.settings.${k}`, `the ${insert} insert has no setting "${k}" (it has ${Object.keys(defaults).join(', ')})`);
          const want = defaults[k];
          if (want !== undefined && typeof v !== typeof want && !(Array.isArray(want) && Array.isArray(v))) throw new OpFail(`${at}.settings.${k}`, `expected ${typeof want === 'number' ? 'a number' : typeof want === 'boolean' ? 'true or false' : Array.isArray(want) ? 'a list' : 'text'}`);
        }
        const settings = { ...op.settings };
        if (insert === 'pump' && settings.source !== undefined) {
          if (typeof settings.source !== 'string') throw new OpFail(`${at}.settings.source`, 'expected the id of the track the Pump ducks to');
          const source = trackRef(settings.source, `${at}.settings.source`);
          if (source.id === track.id) throw new OpFail(`${at}.settings.source`, `"${track.name}" can't duck to itself: give another track`);
          // The id itself, never the "$ref" it was given as
          settings.source = source.id;
        }
        const current = (track.fx[insert] as unknown as Record<string, unknown> | undefined) ?? defaults;
        const merged = { ...current, ...settings };
        const fx = normalizeTrackFx({ ...track.fx, [insert]: merged });
        const out = fx[insert] as unknown as Record<string, unknown>;
        for (const [k, v] of Object.entries(settings)) {
          if (typeof v === 'number' && typeof out[k] === 'number' && Math.abs((out[k] as number) - v) > 1e-9) warn(`"${track.name}" ${insert} ${k} ${v} is out of range: set to ${round(out[k] as number, 4)}.`);
          if (typeof v === 'string' && out[k] !== v) warn(`"${track.name}" ${insert} ${k} ${JSON.stringify(v)} isn't one of its choices: ${out[k] === undefined ? 'left as it was' : `kept ${JSON.stringify(out[k])}`}.`);
        }
        replaceTrack(track, { ...track, fx: fx as TrackFx });
        return;
      }
      case 'set_instrument': {
        const track = trackRef(op.trackId, `${at}.trackId`);
        const key = readInstrument(op.instrument, `${at}.instrument`);
        if (key === track.instrumentKey) {
          warn(`"${track.name}" already plays ${INSTRUMENTS[key].name}.`);
          return;
        }
        // The store's rules (setTrackInstrument): a bus or return is made as one, and the Drop pad's notes are moves, not notes
        if (isMixTrack({ instrumentKey: key })) throw new OpFail(`${at}.instrument`, 'a bus or a return is added with add_track, not switched to');
        if (isAudioKind(track.instrumentKey)) throw new OpFail(`${at}.trackId`, `"${track.name}" plays sound files: its instrument can't change`);
        if (isDropKind(key) !== isDropKind(track.instrumentKey) && w.clips.some((c) => c.trackId === track.id))
          throw new OpFail(`${at}.instrument`, `"${track.name}" has clips: they can't switch between the Drop pad and an instrument`);
        const meta = INSTRUMENTS[key];
        const next: Track = { ...track, instrumentKey: key, name: meta.name, color: meta.color, ...(key === 'designedKit' ? designedKitStart(track) : {}) };
        delete next.plugin;
        w.tracks = w.tracks.map((t) => (t === track ? next : t));
        if (isMixTrack(track)) w.tracks = tidySends(tidyRoutes(w.tracks));
        return;
      }
      case 'set_synth_preset': {
        const track = trackRef(op.trackId, `${at}.trackId`);
        if (track.instrumentKey !== 'synthDesigner') throw new OpFail(`${at}.trackId`, `"${track.name}" isn't a Synth Designer track (set_instrument to "synthDesigner" first)`);
        if (!SYNTH_PRESETS.some((p) => p.name === op.preset)) throw new OpFail(`${at}.preset`, `unknown preset ${JSON.stringify(op.preset)} (list_presets lists them)`);
        replaceTrack(track, { ...track, synth: presetPatch(op.preset) });
        return;
      }
      case 'set_automation': {
        const track = trackRef(op.trackId, `${at}.trackId`);
        const param = readParam(op.param, `${at}.param`, track);
        if (op.points.length > MAX_LANE_POINTS) throw new OpFail(`${at}.points`, `at most ${MAX_LANE_POINTS} points in a lane`);
        const points: AutomationPoint[] = op.points.map((raw, i) => {
          const path = `${at}.points[${i}]`;
          if (!isObj(raw) || !isNum(raw.bar) || !isNum(raw.value)) throw new OpFail(path, 'expected { "bar": <song bar>, "value": 0 to 1, "curve"?: -1 to 1 }');
          if (raw.curve !== undefined && !isNum(raw.curve)) throw new OpFail(`${path}.curve`, 'expected a number, -1 to 1');
          const bar = clamped(raw.bar, 1, TOTAL_BARS + 1, `${track.name} automation point ${i} bar`);
          const value = clamped(raw.value, 0, 1, `${track.name} automation point ${i} value`);
          const curve = raw.curve === undefined ? undefined : clamped(raw.curve, -1, 1, `${track.name} automation point ${i} curve`);
          return curve ? { bar, value, curve } : { bar, value };
        });
        const lanes = track.automation ?? [];
        const old = lanes.find((l) => l.param === param);
        const lane = { param, points: normalizePoints(points) };
        const automation = old ? lanes.map((l) => (l === old ? lane : l)) : [...lanes, lane];
        // A lane of an effect's setting only sounds while the effect is on, so drawing its first points turns it on (as the store does)
        const insert = specOf(param).insert;
        const switchOn = !!insert && lane.points.length > 0 && !old?.points.length && !(track.fx[insert] as { on?: boolean } | undefined)?.on;
        const fx = switchOn ? normalizeTrackFx({ ...track.fx, [insert]: { ...track.fx[insert], on: true } }) : track.fx;
        replaceTrack(track, { ...track, automation, fx });
        return;
      }
      case 'remove_automation': {
        const track = trackRef(op.trackId, `${at}.trackId`);
        // (a send's lane by its return's id as the agent reads it)
        const param = op.param.startsWith('send:') ? `send:${byAgentId(w.tracks, op.param.slice(5))?.id ?? op.param.slice(5)}` : op.param;
        if (!track.automation?.some((l) => l.param === param)) throw new OpFail(`${at}.param`, `"${track.name}" has no ${op.param} automation`);
        const automation = track.automation.filter((l) => l.param !== param);
        const next: Track = { ...track, automation };
        if (!automation.length) delete next.automation;
        replaceTrack(track, next);
        return;
      }
      case 'set_tempo': {
        const bpm = clampBpm(op.bpm);
        if (Math.abs(bpm - op.bpm) > 0.005) warn(`A tempo of ${op.bpm} BPM is out of range: set to ${bpm} (40 to 240).`);
        // A new tempo-change list too, so undoing the Accept brings the old tempo back (the store's
        // undo restores the starting tempo only along with a changed list)
        retempo(bpm, [...w.tempoPoints]);
        return;
      }
      case 'add_tempo_change': {
        const at1 = clamp(op.bar, 1 + 1 / 16, TOTAL_BARS);
        if (Math.abs(at1 - op.bar) > EPS) warn(`A tempo change at bar ${op.bar} is off the timeline: put at bar ${round(at1, 4)}.`);
        const bpm = clampBpm(op.bpm);
        if (Math.abs(bpm - op.bpm) > 0.005) warn(`A tempo of ${op.bpm} BPM is out of range: set to ${bpm} (40 to 240).`);
        const id = uid('tempo');
        retempo(w.bpm, sortedPoints([...w.tempoPoints.filter((p) => Math.abs(p.bar - at1) > 1e-6), { id, bar: at1, bpm, ramp: op.ramp === true }]));
        remember(op.ref, 'tempo', id);
        return;
      }
      case 'remove_tempo_change': {
        const id = resolveId(op.id, `${at}.id`, 'tempo');
        if (!w.tempoPoints.some((p) => p.id === id)) throw new OpFail(`${at}.id`, `no tempo change ${JSON.stringify(op.id)}`);
        retempo(w.bpm, w.tempoPoints.filter((p) => p.id !== id));
        return;
      }
      case 'add_marker': {
        const bar = readBar(op.bar, `${at}.bar`, TOTAL_BARS + 1);
        const name = op.name === undefined ? nextMarkerName(w.markers) : cleanMarkerName(agentLabel(op.name, MARKER_NAME_MAX));
        if (!name) throw new OpFail(`${at}.name`, 'a marker name needs at least one letter');
        const marker = createMarker(bar, tempoOf(w), name);
        const there = w.markers.find((m) => Math.abs(m.bar - marker.bar) < 1e-6);
        if (there) throw new OpFail(`${at}.bar`, `"${there.name}" is already at bar ${round(there.bar, 4)}`);
        w.markers = retimeMarkers([...w.markers, marker], tempoOf(w));
        remember(op.ref, 'marker', marker.id);
        return;
      }
      case 'move_marker': {
        const marker = markerRef(op.markerId, `${at}.markerId`);
        const bar = readBar(op.bar, `${at}.bar`, TOTAL_BARS + 1);
        const there = w.markers.find((m) => m !== marker && Math.abs(m.bar - bar) < 1e-6);
        if (there) throw new OpFail(`${at}.bar`, `"${there.name}" is already at bar ${round(there.bar, 4)}`);
        w.markers = retimeMarkers(
          w.markers.map((m) => (m === marker ? placeMarker(m, bar, tempoOf(w)) : m)),
          tempoOf(w)
        );
        return;
      }
      case 'rename_marker': {
        const marker = markerRef(op.markerId, `${at}.markerId`);
        const name = cleanMarkerName(agentLabel(op.name, MARKER_NAME_MAX));
        if (!name) throw new OpFail(`${at}.name`, 'a marker name needs at least one letter');
        w.markers = w.markers.map((m) => (m === marker ? { ...m, name } : m));
        return;
      }
      case 'remove_marker': {
        const marker = markerRef(op.markerId, `${at}.markerId`);
        w.markers = w.markers.filter((m) => m !== marker);
        return;
      }
      case 'set_master': {
        const m = normalizeMasterSettings(w.master);
        const next: Record<string, unknown> = { ...m };
        if (op.levelDb !== undefined) next.level = clamped(op.levelDb, -24, 12, 'The master Level', 'dB');
        if (op.glue !== undefined) {
          if (!['standard', 'gentle', 'punchy', 'tight', 'off'].includes(op.glue)) throw new OpFail(`${at}.glue`, 'expected one of standard, gentle, punchy, tight, off');
          next.glue = op.glue;
        }
        const part = (key: 'ott' | 'width' | 'loud' | 'clipper', start: Record<string, unknown>) => {
          const given = op[key];
          if (!given) return;
          for (const [k, v] of Object.entries(given)) {
            if (!Object.hasOwn(start, k)) throw new OpFail(`${at}.${key}.${k}`, `the master ${key} has no setting "${k}" (it has ${Object.keys(start).join(', ')})`);
            if (typeof v !== typeof start[k]) throw new OpFail(`${at}.${key}.${k}`, `expected ${typeof start[k] === 'number' ? 'a number' : typeof start[k] === 'boolean' ? 'true or false' : 'text'}`);
          }
          next[key] = { ...start, ...given };
        };
        part('ott', m.ott as unknown as Record<string, unknown>);
        part('width', m.width as unknown as Record<string, unknown>);
        part('loud', { crunch: 0, split: false, ...(m.loud ?? defaultLoud()) } as unknown as Record<string, unknown>);
        part('clipper', (m.clipper ?? defaultClipper()) as unknown as Record<string, unknown>);
        const out = normalizeMasterSettings(next);
        for (const key of ['ott', 'width', 'loud', 'clipper'] as const) {
          const given = op[key];
          const got = out[key] as unknown as Record<string, unknown> | undefined;
          if (!given || !got) continue;
          for (const [k, v] of Object.entries(given)) {
            if (typeof v === 'number' && typeof got[k] === 'number' && Math.abs((got[k] as number) - v) > 1e-9) warn(`The master ${key} ${k} ${v} is out of range: set to ${round(got[k] as number, 4)}.`);
            if (typeof v === 'string' && got[k] !== v) warn(`The master ${key} ${k} ${JSON.stringify(v)} isn't one of its choices: kept ${JSON.stringify(got[k])}.`);
          }
        }
        w.master = out;
        return;
      }
    }
  }

  // ---------- Reading an op's values ----------

  function remember(ref: string | undefined, kind: 'track' | 'clip' | 'marker' | 'tempo', id: string) {
    if (ref) refs.set(ref, { kind, id });
  }

  /**
   * The id of the thing an agent names: as given, or the one it reads so (the agent reads ids as
   * agentIds gives them: a file's id with hidden text in it is named without it, or by an alias
   * of its own when that would read as another's). As given when none or several do.
   */
  function realId(value: string, kind: 'track' | 'clip' | 'marker' | 'tempo'): string {
    const list: ReadonlyArray<{ id: string }> = kind === 'track' ? w.tracks : kind === 'clip' ? w.clips : kind === 'marker' ? w.markers : w.tempoPoints;
    return byAgentId(list, value)?.id ?? value;
  }

  function resolveId(value: string, path: string, kind: 'track' | 'clip' | 'marker' | 'tempo'): string {
    if (!value.startsWith('$')) return realId(value, kind);
    const ref = refs.get(value.slice(1));
    if (!ref) throw new OpFail(path, `no earlier op made ${JSON.stringify(value)} (give ref: "${value.slice(1)}" on the op that adds it)`);
    if (ref.kind !== kind) throw new OpFail(path, `${value} is a ${ref.kind}, not a ${kind}`);
    return ref.id;
  }

  function trackRef(value: string, path: string): Track {
    const id = resolveId(value, path, 'track');
    const t = w.tracks.find((x) => x.id === id);
    if (!t) throw new OpFail(path, `no track ${JSON.stringify(value)} (get_song lists the tracks' ids)`);
    return t;
  }

  function trackById(id: string): Track {
    return w.tracks.find((t) => t.id === id)!;
  }

  function clipRef(value: string, path: string): Clip {
    const id = resolveId(value, path, 'clip');
    const c = w.clips.find((x) => x.id === id);
    if (!c) throw new OpFail(path, `no clip ${JSON.stringify(value)} (get_song lists the clips' ids)`);
    return c;
  }

  /** A clip whose notes and frame an op may change: not an audio clip or a take folder (they play recordings). */
  function editableClip(value: string, path: string): Clip {
    const c = clipRef(value, path);
    if (c.audio) throw new OpFail(path, `"${c.name}" is an audio clip: suggestions can't change audio clips yet`);
    if (c.takes?.length) throw new OpFail(path, `"${c.name}" is a take folder: suggestions can't change recorded takes`);
    return c;
  }

  function noteClip(value: string, path: string): Clip {
    return editableClip(value, path);
  }

  function markerRef(value: string, path: string): Marker {
    const id = resolveId(value, path, 'marker');
    const m = w.markers.find((x) => x.id === id);
    if (!m) throw new OpFail(path, `no marker ${JSON.stringify(value)}`);
    return m;
  }

  function clipHolder(track: Track, path: string) {
    if (isAudioKind(track.instrumentKey)) throw new OpFail(path, `"${track.name}" plays sound files: suggestions can't add audio clips`);
    if (isMixTrack(track)) throw new OpFail(path, `"${track.name}" is a ${isReturn(track) ? 'return' : 'bus'}: it holds no clips`);
  }

  function readInstrument(value: string, path: string): InstrumentKey {
    if (!isInstrumentKey(value)) throw new OpFail(path, `unknown instrument ${JSON.stringify(value)} (list_instruments lists their keys)`);
    if (!opInstrumentAllowed(value)) throw new OpFail(path, `${INSTRUMENTS[value].name} plays sound files or a plugin, which a suggestion can't give it`);
    return value;
  }

  function readParam(value: string, path: string, track: Track): AutomationParam {
    if (!isAutomationParam(value)) throw new OpFail(path, `unknown setting ${JSON.stringify(value)} (list_params lists them)`);
    if (value.startsWith('plugin:')) throw new OpFail(path, 'plugin settings are not in this version of the ops');
    if (value.startsWith('send:')) {
      const to = byAgentId(w.tracks, value.slice(5));
      if (!to || !isReturn(to) || to.id === track.id) throw new OpFail(path, `${value}: there's no return track with that id`);
      return `send:${to.id}` as AutomationParam;
    }
    return value;
  }

  function readPitch(value: unknown, path: string, track: Track): string {
    if (typeof value !== 'string') throw new OpFail(path, 'expected a pitch like "C#3" (or a drum row like "kick" on a drum track)');
    if (isDrumKind(track.instrumentKey) && Object.hasOwn(DRUM_NOTES, value)) return DRUM_NOTES[value as keyof typeof DRUM_NOTES];
    const m = midiOf(value);
    if (!Number.isFinite(m) || m < 0 || m > 127) throw new OpFail(path, `${JSON.stringify(value)} isn't a pitch: write it as a note name and octave, like "C4" (middle C), "F#2" or "Bb3"`);
    const [lo, hi] = INSTRUMENTS[track.instrumentKey].range;
    if (!isDrumKind(track.instrumentKey) && !isFxKind(track.instrumentKey) && !isDropKind(track.instrumentKey) && (m < lo || m > hi))
      warn(`${nameOf(m)} is outside ${INSTRUMENTS[track.instrumentKey].name}'s range (${nameOf(lo)} to ${nameOf(hi)}) on "${track.name}": it may not sound.`);
    return nameOf(m);
  }

  function readStart(value: unknown, path: string, clip: Pick<Clip, 'lengthBars' | 'name'>): number {
    if (!isNum(value)) throw new OpFail(path, 'expected a number of bars from the start of the clip');
    if (value < -EPS || value >= clip.lengthBars - EPS) throw new OpFail(path, `${value} is outside the clip: a note starts from 0 to under ${round(clip.lengthBars, 4)} bars into "${clip.name}"`);
    return round(Math.max(0, value), 9);
  }

  function readLength(value: unknown, path: string): number {
    if (!isNum(value) || value <= 0) throw new OpFail(path, 'expected a length in bars, more than 0 (0.25 is a quarter note in 4/4)');
    if (value < MIN_LENGTH - EPS) {
      warn(`A note length of ${value} bars is shorter than the shortest (1/16 bar): made 1/16.`);
      return MIN_LENGTH;
    }
    if (value > TOTAL_BARS) throw new OpFail(path, `at most ${TOTAL_BARS} bars`);
    return value;
  }

  function readVelocity(value: unknown, path: string): number {
    if (!isNum(value) || value < 0 || value > 1) throw new OpFail(path, 'expected a velocity from 0 (silent) to 1 (hardest)');
    return value;
  }

  function readNotes(list: unknown[], path: string, clip: Pick<Clip, 'lengthBars' | 'name'>, track: Track): NoteEvent[] {
    if (isDropKind(track.instrumentKey) || isAudioKind(track.instrumentKey) || isMixTrack(track)) throw new OpFail(path, `"${track.name}" doesn't play notes a suggestion can add`);
    countNotes(list.length, path);
    return list.map((raw, i) => {
      const at = `${path}[${i}]`;
      if (!isObj(raw)) throw new OpFail(at, 'expected { "pitch": "C4", "start": 0, "length": 0.25, "velocity": 0.8 }');
      for (const k of Object.keys(raw)) if (!['pitch', 'start', 'length', 'velocity'].includes(k)) throw new OpFail(`${at}.${k}`, `a note has pitch, start, length and velocity, not "${k}"`);
      if (raw.length === undefined) throw new OpFail(`${at}.length`, 'a note needs a length in bars');
      return {
        id: uid('note'),
        note: readPitch(raw.pitch, `${at}.pitch`, track),
        startOffset: readStart(raw.start, `${at}.start`, clip),
        duration: lengthText(readLength(raw.length, `${at}.length`)),
        velocity: raw.velocity === undefined ? 0.8 : readVelocity(raw.velocity, `${at}.velocity`),
      };
    });
  }

  function countNotes(n: number, path: string) {
    addedNotes += n;
    if (addedNotes > MAX_ADDED_NOTES) throw new OpFail(path, `too many notes: at most ${MAX_ADDED_NOTES} added by one suggestion (copies of clips count)`);
  }

  function readClipLength(value: number, path: string, max = TOTAL_BARS): number {
    if (value <= 0) throw new OpFail(path, 'expected a length in bars, more than 0');
    if (value < MIN_LENGTH - EPS) {
      warn(`A clip length of ${value} bars is shorter than the shortest (1/16 bar): made 1/16.`);
      return MIN_LENGTH;
    }
    if (value > max + EPS) {
      warn(`A clip ${value} bars long would run past the end of the timeline (bar ${TOTAL_BARS + 1}): made ${round(max, 4)} bars.`);
      return max;
    }
    return value;
  }

  function readBar(value: number, path: string, max: number): number {
    if (value < 1 - EPS) throw new OpFail(path, 'song positions start at bar 1');
    if (value > max + EPS) {
      warn(`Bar ${value} is past the end of the timeline: put at bar ${round(max, 4)}.`);
      return max;
    }
    return value;
  }

  /** A name the agent gives, as the song keeps it: agentLabel's (nothing hidden, one line), at most `max` characters. */
  function cleanName(value: string | undefined, path: string, empty = 'a name needs at least one letter', max = 40): string | null {
    if (value === undefined) return null;
    const name = agentLabel(value, max);
    if (!name) throw new OpFail(path, empty);
    return name;
  }

  function clamped(value: number, lo: number, hi: number, what: string, unit = ''): number {
    const v = clamp(value, lo, hi);
    if (v !== value) warn(`${what} ${value}${unit ? ` ${unit}` : ''} is out of range: set to ${v}${unit ? ` ${unit}` : ''} (${lo} to ${hi}).`);
    return v;
  }

  function replaceClip(clip: Clip, next: Clip) {
    w.clips = w.clips.map((c) => (c === clip ? next : c));
  }

  function replaceTrack(track: Track, next: Track) {
    w.tracks = w.tracks.map((t) => (t === track ? next : t));
  }

  /** A new tempo map: markers held to their time and audio clips at their own speed keep their seconds (as the store's setBpm and retempo). */
  function retempo(bpm: number, tempoPoints: TempoPoint[]) {
    const from = tempoOf(w);
    const to: TempoMap = { bpm, points: tempoPoints };
    w.clips = retimeAudioClips(w.clips, from, to);
    w.markers = retimeMarkers(w.markers, to);
    w.bpm = bpm;
    w.tempoPoints = tempoPoints;
  }

  // Designed Kits that follow the song's key or tempo follow it here too, as the store does after
  // every change (drumFollow.ts): what's heard is what the song will play once accepted
  const followed = followTracks(w.tracks, w.clips, w.bpm, w.tempoPoints);
  if (followed) w.tracks = followed;

  // ---------- The file check ----------

  let song: ProjectSnapshot = {
    ...base,
    tracks: w.tracks,
    clips: w.clips,
    markers: w.markers,
    bpm: w.bpm,
    master: w.master,
    // (a new list after any tempo op: the studio's undo restores the tempo along with a changed list)
    tempoPoints: w.tempoPoints,
  };
  let gated: ProjectSnapshot;
  try {
    gated = parseProject(JSON.parse(JSON.stringify(serializeProject({ ...song, sounds: undefined }))));
  } catch (err) {
    return { ok: false, errors: [{ op: -1, path: '', message: `the result isn't a song that could be saved: ${(err as Error).message}` }] };
  }
  if (gated.unread) return { ok: false, errors: [{ op: -1, path: '', message: `the result has ${gated.unread.tracks} tracks and ${gated.unread.clips} clips a saved file couldn't keep` }] };
  // A saved file keeps the first of repeated ids and drops the rest quietly: nothing may be lost that way
  const lost = idTrouble(base, song);
  if (lost) return { ok: false, errors: [{ op: -1, path: '', message: `the result can't be saved as it is: ${lost}` }] };
  const notesAfter = song.clips.reduce((n, c) => n + c.notes.length, 0);
  if (notesAfter - notesBefore > MAX_ADDED_NOTES) return { ok: false, errors: [{ op: -1, path: '', message: `the result has ${notesAfter - notesBefore} more notes: at most ${MAX_ADDED_NOTES} more in one suggestion` }] };
  song = withFileValues(base, song, gated, warn);

  const notes: string[] = [];
  for (const text of checkSafety(base, song, notes)) warn(text);
  const diff = diffSongs(base, song);
  return {
    ok: true,
    song,
    warnings,
    notes,
    diff,
    refs: Object.fromEntries([...refs].map(([k, v]) => [k, v.id])),
    idBase,
    stats: { ops: ops.length, addedNotes },
  };
}

/** A clip as a saved file has it (selection isn't saved). */
const fileClip = ({ isSelected: _s, ...rest }: Clip) => rest;

/**
 * Objects the ops changed, where the file check holds them differently (a value it brought into
 * range): the checked version, with a warning naming what changed. Untouched objects stay the
 * very objects of `base`.
 */
function withFileValues(base: ProjectSnapshot, song: ProjectSnapshot, gated: ProjectSnapshot, warn: (text: string) => void): ProjectSnapshot {
  const baseTracks = new Set(base.tracks);
  const baseClips = new Set(base.clips);
  const gatedTracks = new Map(gated.tracks.map((t) => [t.id, t]));
  const gatedClips = new Map(gated.clips.map((c) => [c.id, c]));
  const tracks = song.tracks.map((t) => {
    if (baseTracks.has(t)) return t;
    const g = gatedTracks.get(t.id);
    if (!g || stableJson(g) === stableJson(t)) return t;
    warn(`Something in "${t.name}" was out of what a saved song can hold and was brought into range (${firstDifference(t, g)}).`);
    return g;
  });
  const clips = song.clips.map((c) => {
    if (baseClips.has(c)) return c;
    const g = gatedClips.get(c.id);
    if (!g || stableJson(fileClip(g)) === stableJson(fileClip(c))) return c;
    warn(`Something in clip "${c.name}" was out of what a saved song can hold and was brought into range (${firstDifference(fileClip(c), fileClip(g))}).`);
    return { ...g, isSelected: c.isSelected };
  });
  const markers = song.markers === base.markers || stableJson(gated.markers) === stableJson(song.markers) ? song.markers : gated.markers;
  return { ...song, tracks, clips, markers };
}

/** Every id in a song: tracks, clips, notes, markers, tempo and meter changes, patterns. */
function songIds(p: ProjectSnapshot): string[] {
  const out: string[] = [];
  for (const t of p.tracks) out.push(t.id);
  for (const c of p.clips) {
    out.push(c.id);
    if (c.pattern) out.push(c.pattern);
    for (const n of c.notes) out.push(n.id);
  }
  for (const m of p.markers ?? []) out.push(m.id);
  for (const t of p.tempoPoints ?? []) out.push(t.id);
  for (const m of p.meterPoints ?? []) out.push(m.id);
  return out;
}

/**
 * `wanted`, or the first of "<wanted>~2", "~3"... that no id in the song was made from. Applying a
 * suggestion to a song it was applied to before would otherwise make the same ids again.
 */
export function freeIdBase(song: ProjectSnapshot, wanted: string): string {
  const ids = songIds(song);
  const taken = (b: string) => ids.some((id) => id.includes(`-${b}-`));
  if (!taken(wanted)) return wanted;
  for (let i = 2; ; i++) if (!taken(`${wanted}~${i}`)) return `${wanted}~${i}`;
}

/**
 * Why a song would lose something to ids the suggestion repeated (null: it wouldn't). Repeats the
 * song already had (a saved file keeps repeated notes, markers and tempo changes) don't count:
 * only more of them than `base` had.
 */
function idTrouble(base: ProjectSnapshot, song: ProjectSnapshot): string | null {
  const repeats = (ids: string[]) => ids.length - new Set(ids).size;
  const more = (a: Array<{ id: string }> | undefined, b: Array<{ id: string }> | undefined) => repeats((b ?? []).map((x) => x.id)) - repeats((a ?? []).map((x) => x.id));
  if (more(base.tracks, song.tracks) > 0) return 'two tracks share an id';
  if (more(base.clips, song.clips) > 0) return 'two clips share an id';
  if (more(base.markers, song.markers) > 0) return 'two markers share an id';
  if (more(base.tempoPoints, song.tempoPoints) > 0) return 'two tempo changes share an id';
  const before = new Map(base.clips.map((c) => [c.id, c]));
  const clip = song.clips.find((c) => more(before.get(c.id)?.notes, c.notes) > 0);
  if (clip) return `two notes in "${clip.name}" share an id`;
  return null;
}
