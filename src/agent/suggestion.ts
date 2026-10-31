/**
 * Suggestions kept for later: the suggestion file (format "fledgetone-suggestion", version 1)
 * that `fledgetone apply` reads and the agent's file mode writes, and the check that tells,
 * when a suggestion is accepted, whether the song moved on since it was made.
 *
 * When a suggestion is made, each existing thing its ops touch (a clip, a track, a marker, the
 * tempo, the master) gets a fingerprint (touchedHashes). At Accept: the same revision means
 * nothing changed ('unchanged': apply it); a later revision whose touched things all still match
 * means only other parts changed ('reapply': apply the ops again to the song as it is now, with
 * the same id base, and let the musician listen again); a touched thing that changed or went
 * means the suggestion no longer fits ('out_of_date': Accept is off). Plain logic.
 */
import type { ProjectSnapshot } from '../store/project';
import type { Clip, Track } from '../store/timelineTypes';
import { normalizeMasterSettings } from '../store/timelineTypes';
import { checkOpsShape, OPS_VERSION, type Op } from './ops';
import { fingerprint } from './fingerprint';
import { fromAgent } from './protocol';
import { agentLine, byAgentId } from './agentText';
import { textName } from './names';

export const SUGGESTION_FORMAT = 'fledgetone-suggestion';
export const SUGGESTION_VERSION = 1;

export interface SuggestionFile {
  format: typeof SUGGESTION_FORMAT;
  version: typeof SUGGESTION_VERSION;
  /** The song it was made for (absent when the song had no id). */
  songId?: string;
  /** Fingerprints of what the ops touch, as they were (see touchedHashes). */
  touchedHashes: Record<string, string>;
  /** Their names then, to say which one went if one is deleted (see touchedNames). */
  touchedNames?: Record<string, string>;
  title: string;
  explanation: string;
  opsVersion: typeof OPS_VERSION;
  ops: Op[];
}

/** Whether a suggestion still fits the song: see the file's comment. */
export type Freshness = 'unchanged' | 'reapply' | 'out_of_date';

const fileClip = ({ isSelected: _s, ...rest }: Clip) => rest;
/**
 * A track as it sounds and holds clips, as far as a suggestion's ops build on it. What only the
 * screen or the moment holds doesn't count: armed to record, its folder folded or not, its MIDI
 * knobs, a freeze (it sounds the same frozen). Nor do its mute and solo (pressed to listen, and
 * kept as they are when the ops go in again on the song as it is), its name or its colour: none
 * of the ops builds on them, so a suggestion stays good when they change.
 */
const trackPart = ({ isMuted: _mu, isSoloed: _so, name: _n, color: _c, ...rest }: Track) => listedTrack(rest as Track);
/** A track as earlier versions fingerprinted it (mute, solo, name and colour in): their suggestion files still fit. */
const listedTrack = ({ isArmed: _a, freezing: _f, frozen: _z, midiMap: _m, folder, ...rest }: Track) => {
  if (!folder) return rest;
  const { collapsed: _c, ...open } = folder;
  return { ...rest, folder: open };
};

/** The ids an op names that are existing things (not "$ref"s to things earlier ops make). */
function keysOf(op: Op): string[] {
  const own = (id: unknown) => typeof id === 'string' && !id.startsWith('$');
  const keys: string[] = [];
  const o = op as unknown as Record<string, unknown>;
  switch (op.op) {
    case 'add_notes':
    case 'change_notes':
    case 'remove_notes':
    case 'transpose_notes':
    case 'resize_clip':
    case 'remove_clip':
      if (own(o.clipId)) keys.push(`clip:${o.clipId}`);
      break;
    case 'move_clip':
    case 'duplicate_clip':
      if (own(o.clipId)) keys.push(`clip:${o.clipId}`);
      if (own(o.trackId)) keys.push(`kind:${o.trackId}`);
      break;
    case 'add_clip':
      if (own(o.trackId)) keys.push(`kind:${o.trackId}`);
      break;
    case 'set_track':
      if (own(o.trackId)) keys.push(`track:${o.trackId}`);
      if (own(o.output)) keys.push(`kind:${o.output}`);
      break;
    case 'set_eq':
    case 'set_insert':
    case 'set_instrument':
    case 'set_synth_preset':
    case 'set_automation':
    case 'remove_automation':
      if (own(o.trackId)) keys.push(`track:${o.trackId}`);
      break;
    case 'set_tempo':
    case 'add_tempo_change':
    case 'remove_tempo_change':
      keys.push('tempo');
      break;
    case 'move_marker':
    case 'rename_marker':
    case 'remove_marker':
      if (own(o.markerId)) keys.push(`marker:${o.markerId}`);
      break;
    case 'add_marker':
      keys.push('markers');
      break;
    case 'set_master':
      keys.push('master');
      break;
    case 'add_track':
      break;
  }
  return keys;
}

/** What a touched key stands for in a song, as it is (undefined: it isn't there). */
function partOf(song: ProjectSnapshot, key: string): unknown {
  const [kind, id] = [key.slice(0, key.indexOf(':') < 0 ? key.length : key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  switch (kind) {
    case 'clip': {
      const c = byAgentId(song.clips, id);
      return c && fileClip(c);
    }
    case 'track': {
      const t = byAgentId(song.tracks, id);
      return t && trackPart(t);
    }
    case 'kind':
      return byAgentId(song.tracks, id)?.instrumentKey;
    case 'marker':
      return byAgentId(song.markers ?? [], id);
    case 'markers':
      // Where the markers sit (a new one can't go where one already is)
      return (song.markers ?? []).map((m) => Math.round(m.bar * 1e6));
    case 'tempo':
      return { bpm: song.bpm, points: song.tempoPoints ?? [] };
    case 'master':
      return normalizeMasterSettings(song.master);
  }
  return undefined;
}

/** Whether `hash` is a track's fingerprint as earlier versions took it (listedTrack), and still fits. */
function legacyMatch(song: ProjectSnapshot, key: string, hash: string): boolean {
  if (!key.startsWith('track:')) return false;
  const t = byAgentId(song.tracks, key.slice(6));
  return !!t && fingerprint(listedTrack(t)) === hash;
}

/** Fingerprints of everything `ops` touch in `song` (missing things are left out: an op naming one fails anyway). */
export function touchedHashes(song: ProjectSnapshot, ops: readonly Op[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const op of ops) {
    for (const key of keysOf(op)) {
      if (Object.hasOwn(out, key)) continue;
      const part = partOf(song, key);
      if (part !== undefined) out[key] = fingerprint(part);
    }
  }
  return out;
}

/** The names of what `ops` touch in `song`, by touched key, kept with the fingerprints so a deleted one can still be named. */
export function touchedNames(song: ProjectSnapshot, ops: readonly Op[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(touchedHashes(song, ops))) {
    const name = nameOf(song, key);
    if (name) out[key] = name;
  }
  return out;
}

function nameOf(song: ProjectSnapshot, key: string): string | undefined {
  const id = key.slice(key.indexOf(':') + 1);
  if (key.startsWith('clip:')) return byAgentId(song.clips, id)?.name;
  if (key.startsWith('track:') || key.startsWith('kind:')) return byAgentId(song.tracks, id)?.name;
  if (key.startsWith('marker:')) return byAgentId(song.markers ?? [], id)?.name;
  return undefined;
}

/** What a touched key is, in plain words, for saying why a suggestion is out of date. */
function describeKey(song: ProjectSnapshot, key: string, names: Record<string, string> = {}): string {
  // (a name from the song, as plainly as the agent's summary has it: this reaches the agent)
  const raw = nameOf(song, key) ?? names[key];
  const name = raw === undefined ? undefined : agentLine(raw, 64);
  const what = key.startsWith('clip:') ? 'clip' : key.startsWith('marker:') ? 'marker' : 'track';
  if (key.startsWith('clip:') || key.startsWith('track:') || key.startsWith('kind:') || key.startsWith('marker:')) return name ? `the ${what} "${textName(name)}"` : `a ${what} it changes`;
  if (key === 'markers') return 'the markers';
  if (key === 'tempo') return 'the tempo';
  if (key === 'master') return 'the master';
  return key;
}

/**
 * Whether a suggestion made at `made.revision` with `made.touchedHashes` still fits `now`. For a
 * file (no revisions), only the fingerprints count: 'unchanged' when they all match. `changed`
 * names what moved on, in plain words.
 */
export function classifySuggestion(
  made: { revision?: number; touchedHashes: Record<string, string>; touchedNames?: Record<string, string> },
  now: { revision?: number; song: ProjectSnapshot }
): { status: Freshness; changed: string[] } {
  if (made.revision !== undefined && made.revision === now.revision) return { status: 'unchanged', changed: [] };
  const changed: string[] = [];
  for (const [key, hash] of Object.entries(made.touchedHashes)) {
    const part = partOf(now.song, key);
    if (part === undefined) changed.push(`${describeKey(now.song, key, made.touchedNames)} is gone`);
    else if (fingerprint(part) !== hash && !legacyMatch(now.song, key, hash)) changed.push(`${describeKey(now.song, key, made.touchedNames)} changed`);
  }
  if (changed.length) return { status: 'out_of_date', changed };
  return { status: made.revision === undefined ? 'unchanged' : 'reapply', changed: [] };
}

/** A suggestion's title as it's kept and shown: the agent's words made plain (fromAgent), on one line. */
const titleOf = (text: string) => fromAgent(text, 80).replace(/\s+/g, ' ').trim();

/** A suggestion file for `ops` on `song`. */
export function makeSuggestionFile(song: ProjectSnapshot, s: { title: string; explanation: string; ops: Op[] }): SuggestionFile {
  return {
    format: SUGGESTION_FORMAT,
    version: SUGGESTION_VERSION,
    ...(song.songId ? { songId: song.songId } : {}),
    touchedHashes: touchedHashes(song, s.ops),
    touchedNames: touchedNames(song, s.ops),
    // (the agent's words as the studio shows them: plain text, no controls or hidden characters)
    title: titleOf(s.title),
    explanation: fromAgent(s.explanation, 2000),
    opsVersion: OPS_VERSION,
    ops: s.ops,
  };
}

/** A suggestion file from untrusted JSON. Throws with a readable reason. */
export function parseSuggestionFile(raw: unknown): SuggestionFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('this is not a Fledgetone suggestion file');
  const o = raw as Record<string, unknown>;
  if (o.format !== SUGGESTION_FORMAT) throw new Error('this is not a Fledgetone suggestion file');
  if (typeof o.version !== 'number' || o.version > SUGGESTION_VERSION) throw new Error('this suggestion was made by a newer version of Fledgetone');
  const shape = checkOpsShape({ opsVersion: o.opsVersion, ops: o.ops });
  if (shape.length) throw new Error(`its ops can't be read: ${shape.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  const hashes = typeof o.touchedHashes === 'object' && o.touchedHashes !== null ? (o.touchedHashes as Record<string, unknown>) : {};
  return {
    format: SUGGESTION_FORMAT,
    version: SUGGESTION_VERSION,
    ...(typeof o.songId === 'string' && o.songId ? { songId: o.songId } : {}),
    touchedHashes: Object.fromEntries(Object.entries(hashes).filter((e): e is [string, string] => typeof e[1] === 'string')),
    ...(typeof o.touchedNames === 'object' && o.touchedNames !== null
      ? { touchedNames: Object.fromEntries(Object.entries(o.touchedNames as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string').map(([k, v]) => [k, agentLine(v, 64)])) }
      : {}),
    // (a file can be written by anyone: its words as plain as an agent's on the panel)
    title: (typeof o.title === 'string' && titleOf(o.title)) || 'Suggestion',
    explanation: typeof o.explanation === 'string' ? fromAgent(o.explanation, 2000) : '',
    opsVersion: OPS_VERSION,
    ops: o.ops as Op[],
  };
}
