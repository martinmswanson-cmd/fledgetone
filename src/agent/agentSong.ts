/**
 * The song as an agent reads it (AgentSong, schema "fledgetone.agent-song/1"): a compact summary
 * of a project with every id an op needs (tracks, clips, markers, tempo changes), the mix in
 * plain units (dB, -1 to 1 pan), each track's inserts that are on with only the settings that
 * differ from their defaults, automation lanes, the sections and the key. Never sounds, video or
 * plugin state. Kept under AGENT_SONG_MAX_BYTES: the detail goes first (insert settings, then
 * automation points), and what was left out is listed in `omitted`.
 *
 * Notes and automation points come separately and in full from agentNotes (at most
 * MAX_NOTES_PER_CALL at a time, with a cursor) and agentAutomation. Plain logic, used by the
 * command line, the agent tools and the studio.
 */
import { PROJECT_VERSION, type ProjectSnapshot } from '../store/project';
import { songEnd, songSections } from '../store/cutToLength';
import { detectKey } from '../store/songKey';
import { partKind } from '../store/partKind';
import { midiOf, nameOf } from '../store/noteTools';
import { presetPatch, SYNTH_PRESETS, type SynthPatch } from '../store/synthPatch';
import { defaultMasterSettings, durationToBars, normalizeMasterSettings, type Clip, type Track } from '../store/timelineTypes';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { specOf } from '../audio/automation';
import { barToSeconds, formatMeter, FOUR_FOUR, type TempoMap } from '../audio/tempoMap';
import { INSERT_NAMES, insertDefaults } from './ops';
import { stableJson } from './fingerprint';

export const AGENT_SONG_SCHEMA = 'fledgetone.agent-song/1';
/** The most an AgentSong may weigh as JSON. */
export const AGENT_SONG_MAX_BYTES = 30_000;
/** The most notes one agentNotes call gives. */
export const MAX_NOTES_PER_CALL = 2000;

export interface AgentTrack {
  id: string;
  name: string;
  instrument: { key: string; name: string; category: string };
  /** What part it plays: drums, bass, pad, lead, fx or other (from its instrument). */
  role: string;
  volumeDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  reverbSend: number;
  delaySend: number;
  distance?: number;
  eq?: { low: number; mid: number; high: number };
  /** The bus it plays into (absent: the master). */
  output?: string;
  /** Sends to return tracks. */
  sends?: Array<{ to: string; level: number }>;
  /** The inserts that are on, with the settings that differ from their defaults (dropped when the song is too big: names only). */
  inserts: Array<{ insert: string; settings?: Record<string, unknown> }>;
  automation: Array<{ param: string; label: string; fromBar: number; toBar: number; pointCount: number; points?: Array<{ bar: number; value: number; curve?: number }> }>;
  /** Its synth preset, when it's a Synth Designer track playing one unchanged. */
  synthPreset?: string;
  folder?: string;
  stemGroup?: string;
  /** A bus or a return: holds no clips. */
  mixTrack?: 'bus' | 'return';
}

export interface AgentClip {
  id: string;
  trackId: string;
  name: string;
  startBar: number;
  lengthBars: number;
  /** notes; audio (plays a sound file: ops can't change it); takes (a take folder: ops can't change it). */
  kind: 'notes' | 'audio' | 'takes';
  notes: number;
  /** The lowest and highest pitch, as "C2-G3" (pitched instruments), or the drum rows played. */
  range?: string;
  /** The pattern it shares notes with: every clip with the same linkedTo plays the same notes. */
  linkedTo?: string;
}

export interface AgentSong {
  schema: typeof AGENT_SONG_SCHEMA;
  /** Counts edits in the studio (0 for a file): a suggestion made at one revision is checked against the next. */
  revision: number;
  app: { version: string; projectVersion: number };
  songId?: string;
  name: string;
  tempo: { bpm: number; changes: Array<{ id: string; bar: number; bpm: number; ramp: boolean }> };
  meter: { base: string; changes: Array<{ bar: number; meter: string }> };
  key: string | null;
  lengthBars: number;
  lengthSeconds: number;
  loop: { inBar: number; outBar: number; on: boolean };
  markers: Array<{ id: string; name: string; bar: number; seconds: number; heldTo: 'bar' | 'time' }>;
  sections: Array<{ name: string; fromBar: number; toBar: number }>;
  tracks: AgentTrack[];
  clips: AgentClip[];
  master: { levelDb: number; glue: string; ott: Record<string, unknown>; width: Record<string, unknown>; loud?: Record<string, unknown>; clipper?: Record<string, unknown>; monoLow: boolean };
  /** What was left out to keep it small, in plain words (get_notes and get_automation give everything). */
  omitted: string[];
}

const r = (v: number, places = 4) => Math.round(v * 10 ** places) / 10 ** places;
const tempoOf = (p: ProjectSnapshot): TempoMap => ({ bpm: p.bpm, points: p.tempoPoints ?? [] });

/** The settings of an insert that differ from how it starts. */
function changedSettings(insert: string, settings: Record<string, unknown>): Record<string, unknown> {
  const d = insertDefaults(insert as (typeof INSERT_NAMES)[number]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) if (k !== 'on' && stableJson(v) !== stableJson(d[k])) out[k] = typeof v === 'number' ? r(v) : v;
  return out;
}

function agentTrack(t: Track, tracks: readonly Track[]): AgentTrack {
  const meta = INSTRUMENTS[t.instrumentKey];
  const kind = meta?.kind;
  const fx = t.fx as unknown as Record<string, { on?: boolean } & Record<string, unknown>>;
  return {
    id: t.id,
    name: t.name,
    instrument: { key: t.instrumentKey, name: meta?.name ?? t.instrumentKey, category: meta?.category ?? '' },
    role: partKind(t.instrumentKey),
    volumeDb: r(t.volume, 2),
    pan: r(t.pan, 3),
    mute: t.isMuted,
    solo: t.isSoloed,
    reverbSend: r(t.reverbSend, 3),
    delaySend: r(t.delaySend, 3),
    ...(t.distance ? { distance: r(t.distance, 3) } : {}),
    ...(t.eq.low || t.eq.mid || t.eq.high ? { eq: { ...t.eq } } : {}),
    ...(t.output ? { output: t.output } : {}),
    ...(t.sends?.length ? { sends: t.sends.map((s) => ({ to: s.to, level: r(s.level, 3) })) } : {}),
    inserts: (INSERT_NAMES as readonly string[]).filter((k) => fx[k]?.on).map((k) => ({ insert: k, settings: changedSettings(k, fx[k]) })),
    automation: (t.automation ?? [])
      .filter((l) => l.points.length)
      .map((l) => ({
        param: l.param,
        label: specOf(l.param, t, tracks).label,
        fromBar: r(l.points[0].bar),
        toBar: r(l.points[l.points.length - 1].bar),
        pointCount: l.points.length,
        points: l.points.map((p) => ({ bar: r(p.bar), value: r(p.value), ...(p.curve ? { curve: r(p.curve) } : {}) })),
      })),
    ...(t.instrumentKey === 'synthDesigner' && t.synth ? presetOf(t.synth) : {}),
    ...(t.folder ? { folder: t.folder.name } : {}),
    ...(t.stemGroup ? { stemGroup: t.stemGroup } : {}),
    ...(kind === 'bus' || kind === 'return' ? { mixTrack: kind } : {}),
  };
}

/** The preset a Synth Designer patch is, unchanged, if it is one. */
function presetOf(patch: SynthPatch): { synthPreset?: string } {
  const text = stableJson(patch);
  const hit = SYNTH_PRESETS.find((x) => stableJson(presetPatch(x.name)) === text);
  return hit ? { synthPreset: hit.name } : {};
}

/** "C2-G3" for pitched notes, the drum rows ("kick, snare, closedHat") for a kit. */
function noteRange(c: Clip, t: Track | undefined): string | undefined {
  if (!c.notes.length) return undefined;
  const kind = t ? INSTRUMENTS[t.instrumentKey]?.kind : undefined;
  if (kind === 'drums' || kind === 'fx' || kind === 'drop' || kind === 'rack') {
    const names = [...new Set(c.notes.map((n) => n.note))];
    return names.slice(0, 8).join(', ') + (names.length > 8 ? ', ...' : '');
  }
  const midis = c.notes.map((n) => midiOf(n.note)).filter(Number.isFinite);
  if (!midis.length) return undefined;
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  return lo === hi ? nameOf(lo) : `${nameOf(lo)}-${nameOf(hi)}`;
}

/** The song as an agent reads it. `revision` counts the studio's edits (0 for a file). */
export function toAgentSong(p: ProjectSnapshot, opts: { revision?: number; appVersion?: string; maxBytes?: number } = {}): AgentSong {
  const tempo = tempoOf(p);
  const meterMap = { base: p.meter ?? FOUR_FOUR, points: p.meterPoints ?? [] };
  const end = songEnd(p.clips, meterMap);
  const key = detectKey(p.clips, p.tracks);
  const master = normalizeMasterSettings(p.master ?? defaultMasterSettings());
  const byId = new Map(p.tracks.map((t) => [t.id, t]));
  const song: AgentSong = {
    schema: AGENT_SONG_SCHEMA,
    revision: opts.revision ?? 0,
    app: { version: opts.appVersion ?? 'unknown', projectVersion: PROJECT_VERSION },
    ...(p.songId ? { songId: p.songId } : {}),
    name: p.name.slice(0, 200),
    tempo: { bpm: p.bpm, changes: (p.tempoPoints ?? []).map((t) => ({ id: t.id, bar: r(t.bar), bpm: t.bpm, ramp: t.ramp === true })) },
    meter: { base: formatMeter(meterMap.base), changes: meterMap.points.map((m) => ({ bar: r(m.bar), meter: formatMeter(m) })) },
    key: key?.name ?? null,
    lengthBars: r(end - 1),
    lengthSeconds: r(barToSeconds(end, tempo), 2),
    loop: { inBar: r(p.loopRegion.inBar), outBar: r(p.loopRegion.outBar), on: p.loopRegion.enabled },
    markers: (p.markers ?? []).map((m) => ({ id: m.id, name: m.name, bar: r(m.bar), seconds: r(m.seconds, 3), heldTo: m.anchor })),
    sections: songSections(p.clips, p.markers ?? [], meterMap).map((s) => ({ name: s.name, fromBar: r(s.from), toBar: r(s.to) })),
    tracks: p.tracks.map((t) => agentTrack(t, p.tracks)),
    clips: p.clips.map((c) => {
      const range = noteRange(c, byId.get(c.trackId));
      return {
        id: c.id,
        trackId: c.trackId,
        name: c.name,
        startBar: r(c.startBar),
        lengthBars: r(c.lengthBars),
        kind: c.audio ? 'audio' : c.takes?.length ? 'takes' : 'notes',
        notes: c.notes.length,
        ...(range ? { range } : {}),
        ...(c.pattern ? { linkedTo: c.pattern } : {}),
      };
    }),
    master: {
      levelDb: master.level,
      glue: master.glue,
      ott: { ...master.ott },
      width: { ...master.width },
      ...(master.loud ? { loud: { ...master.loud } } : {}),
      ...(master.clipper ? { clipper: { ...master.clipper } } : {}),
      monoLow: master.monoLow === true,
    },
    omitted: [],
  };
  return fitSize(song, opts.maxBytes ?? AGENT_SONG_MAX_BYTES);
}

const size = (s: AgentSong) => new TextEncoder().encode(JSON.stringify(s)).length;

/** The longest prefix of `list` for which `build(prefix)` fits in `max` bytes. */
function fitPrefix<T>(list: readonly T[], build: (part: T[]) => AgentSong, max: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (size(build(list.slice(0, mid))) <= max) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Leave out detail, least useful first, until the song fits in `max` bytes: tempo and time
 * signature changes past the room the rest leaves them, the inserts'
 * settings, the automation points, the clips' ranges, the tracks' inserts and automation; then,
 * if lists are still too long, the markers and sections past a share of the room, the tracks past
 * theirs, and the clips (of the tracks kept, in song order) past what's left. It always fits.
 */
function fitSize(song: AgentSong, max: number): AgentSong {
  if (size(song) <= max) return song;
  const omit = (s: AgentSong, what: string): AgentSong => ({ ...s, omitted: [...s.omitted, what] });
  let s = song;
  // Tempo and time signature changes: the room the rest leaves, at least a tenth, the first ones kept
  for (const key of ['tempo', 'meter'] as const) {
    const all = s[key].changes as Array<{ bar: number }>;
    const part = (list: Array<{ bar: number }>): AgentSong => ({ ...s, [key]: { ...s[key], changes: list } });
    const without = size(part([]));
    // (all the room the rest doesn't take, and at least a tenth)
    const room = Math.max(max * 0.1, max - without - 240);
    if (size(part(all)) - without <= room) continue;
    const keep = fitPrefix(all, part, without + room);
    s = omit(part(all.slice(0, keep)), `${all.length - keep} of ${all.length} ${key === 'tempo' ? 'tempo' : 'time signature'} changes, from bar ${all[keep].bar} on`);
  }
  if (size(s) <= max) return s;

  s = omit({ ...s, tracks: s.tracks.map((t) => ({ ...t, inserts: t.inserts.map((i) => ({ insert: i.insert })) })) }, "inserts' settings (only their names are listed)");
  if (size(s) <= max) return s;
  s = omit({ ...s, tracks: s.tracks.map((t) => ({ ...t, automation: t.automation.map(({ points: _p, ...rest }) => rest) })) }, 'automation points (get_automation has them)');
  if (size(s) <= max) return s;
  s = omit({ ...s, clips: s.clips.map(({ range: _r, ...rest }) => rest) }, "clips' note ranges");
  if (size(s) <= max) return s;
  s = omit({ ...s, tracks: s.tracks.map((t) => ({ ...t, inserts: [], automation: [] })) }, "the tracks' inserts and automation (get_automation has the automation)");
  if (size(s) <= max) return s;

  // The lists themselves. Their room: what's left after everything else
  const bare: AgentSong = { ...s, markers: [], sections: [], tracks: [], clips: [], omitted: [...s.omitted, 'x'.repeat(240)] };
  const room = Math.max(0, max - size(bare));
  const bytes = (patch: Partial<AgentSong>) => size({ ...bare, ...patch }) - size(bare);
  const restBytes = bytes({ tracks: s.tracks, clips: s.clips });
  // Markers and sections get what the tracks and clips don't need, and at least a share of the room
  const markerRoom = Math.max(room * 0.15, room - restBytes - bytes({ sections: s.sections }));
  const markers = s.markers.slice(0, bytes({ markers: s.markers }) > markerRoom ? fitPrefix(s.markers, (x) => ({ ...bare, markers: x }), size(bare) + markerRoom) : s.markers.length);
  const sectionRoom = Math.max(room * 0.05, room - restBytes - bytes({ markers }));
  const sections = s.sections.slice(0, bytes({ sections: s.sections }) > sectionRoom ? fitPrefix(s.sections, (x) => ({ ...bare, sections: x }), size(bare) + sectionRoom) : s.sections.length);
  const lists: AgentSong = { ...bare, omitted: s.omitted, markers, sections };
  // Tracks get up to half of what's left, unless the clips need less
  // (as many as fit with all their clips, or half the room for the tracks alone, whichever is more)
  const clipsOf = (t: AgentTrack[]) => {
    const ids = new Set(t.map((x) => x.id));
    return s.clips.filter((c) => ids.has(c.trackId));
  };
  const whole = fitPrefix(s.tracks, (t) => ({ ...lists, tracks: t, clips: clipsOf(t) }), max - 240);
  const half = fitPrefix(s.tracks, (t) => ({ ...lists, tracks: t }), size(lists) + (max - size(lists)) * 0.5);
  const tracks = s.tracks.slice(0, Math.max(whole, half));
  const kept = new Set(tracks.map((t) => t.id));
  const clips = s.clips.filter((c) => kept.has(c.trackId)).sort((a, b) => a.startBar - b.startBar);
  const withTracks: AgentSong = { ...lists, tracks };
  const nClips = fitPrefix(clips, (c) => ({ ...withTracks, clips: c }), max - 240);
  let out: AgentSong = { ...withTracks, clips: clips.slice(0, nClips) };
  if (markers.length < s.markers.length) out = omit(out, `${s.markers.length - markers.length} of ${s.markers.length} markers, from bar ${s.markers[markers.length].bar} on`);
  if (sections.length < s.sections.length) out = omit(out, `${s.sections.length - sections.length} of ${s.sections.length} sections, from bar ${s.sections[sections.length].fromBar} on`);
  if (tracks.length < s.tracks.length) out = omit(out, `${s.tracks.length - tracks.length} of ${s.tracks.length} tracks, from "${s.tracks[tracks.length].name}" on, and their clips (get_notes with a trackId reads a track's notes, with their clips' ids)`);
  const clipCount = s.clips.filter((c) => kept.has(c.trackId)).length;
  if (nClips < clipCount)
    out = omit(out, nClips === 0 ? `all ${clipCount} clips (get_notes reads the notes, with their clips' ids)` : `${clipCount - nClips} of ${clipCount} clips, those after bar ${clips[nClips - 1].startBar} (get_notes reads the notes, with their clips' ids)`);
  // The omitted list was given room above; should a pathological song still not fit, the lists go,
  // one after another, each said
  const last: Array<[string, (x: AgentSong) => AgentSong]> = [
    ['the markers and sections', (x) => ({ ...x, markers: [], sections: [] })],
    ['the clips', (x) => ({ ...x, clips: [] })],
    ['the tempo and time signature changes', (x) => ({ ...x, tempo: { ...x.tempo, changes: [] }, meter: { ...x.meter, changes: [] } })],
    ['the tracks', (x) => ({ ...x, tracks: [] })],
    ['what was left out', (x) => ({ ...x, omitted: ['most of the song: it is too big to summarize (get_notes and get_automation read it)'] })],
  ];
  for (const [what, cut] of last) {
    if (size(out) <= max) break;
    out = omit(cut(out), `${what} (the song is too big to summarize whole)`);
  }
  return out;
}

/** One note as an agent reads it: its id, clip, pitch, where it starts (in the clip and in the song) and how long it is, in bars. */
export interface AgentNote {
  id: string;
  clipId: string;
  trackId: string;
  pitch: string;
  start: number;
  bar: number;
  length: number;
  velocity: number;
}

/**
 * The song's notes, in song order: all, or one track's, one clip's or those starting in a range
 * of song bars (toBar not included). At most `limit` (MAX_NOTES_PER_CALL) at a time: pass the
 * returned `next` as `cursor` for the rest.
 */
export function agentNotes(
  p: ProjectSnapshot,
  q: { trackId?: string; clipId?: string; fromBar?: number; toBar?: number; cursor?: string; limit?: number } = {}
): { notes: AgentNote[]; total: number; next?: string } {
  const limit = Number.isFinite(q.limit) ? Math.max(1, Math.min(MAX_NOTES_PER_CALL, Math.floor(q.limit!))) : MAX_NOTES_PER_CALL;
  const all: AgentNote[] = [];
  for (const c of p.clips) {
    if (q.clipId && c.id !== q.clipId) continue;
    if (q.trackId && c.trackId !== q.trackId) continue;
    for (const n of c.notes) {
      // A note past the clip's end (after a trim) doesn't play: it's left out
      if (n.startOffset < -1e-9 || n.startOffset >= c.lengthBars - 1e-9) continue;
      const bar = c.startBar + n.startOffset;
      if (q.fromBar !== undefined && bar < q.fromBar - 1e-9) continue;
      if (q.toBar !== undefined && bar >= q.toBar - 1e-9) continue;
      all.push({ id: n.id, clipId: c.id, trackId: c.trackId, pitch: n.note, start: r(n.startOffset, 6), bar: r(bar, 6), length: r(durationToBars(n.duration), 6), velocity: r(n.velocity, 3) });
    }
  }
  all.sort((a, b) => a.bar - b.bar || a.trackId.localeCompare(b.trackId) || a.pitch.localeCompare(b.pitch));
  if (q.cursor && !/^\d{1,9}$/.test(q.cursor)) throw new Error('cursor is the "next" a previous get_notes gave (a whole number)');
  const from = q.cursor ? Number(q.cursor) : 0;
  const notes = all.slice(from, from + limit);
  return { notes, total: all.length, ...(from + limit < all.length ? { next: String(from + limit) } : {}) };
}

/** Every automation lane (or one track's, or one setting's), with all its points. */
export function agentAutomation(p: ProjectSnapshot, q: { trackId?: string; param?: string } = {}) {
  return p.tracks
    .filter((t) => !q.trackId || t.id === q.trackId)
    .flatMap((t) =>
      (t.automation ?? [])
        .filter((l) => !q.param || l.param === q.param)
        .map((l) => ({ trackId: t.id, track: t.name, param: l.param, label: specOf(l.param, t, p.tracks).label, points: l.points.map((x) => ({ ...x })) }))
    );
}
