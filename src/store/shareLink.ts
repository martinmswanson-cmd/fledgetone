import { parseProject, PROJECT_FORMAT, serializeProject } from './project';
import type { ProjectSnapshot } from './project';
import { defaultTrackFx } from './timelineTypes';

/**
 * A song inside a link: the project (without its sound files), packed tight, deflated and written
 * in base64url after "#s=" on the app's own address. The part after # never reaches a server, so
 * the song travels only in the link. Opening the link opens the song (see SharedLinkOpener).
 *
 * The packing: the project as JSON, less every setting still at its default (most of a track's
 * effects are), and the notes as bytes after it, a few per note. Links made before it ("#song=",
 * the project as JSON with notes as short lists) still open.
 */
export const SHARE_PREFIX = '#s=';
/** Links made before the tighter packing */
const OLD_PREFIX = '#song=';

/** Whether `hash` (location.hash) holds a song. */
export const isShareHash = (hash: string) => hash.startsWith(SHARE_PREFIX) || hash.startsWith(OLD_PREFIX);

/** Links past this many characters don't fit in a Discord message (and some other chat apps cut them off). */
export const LONG_LINK = 2000;

const toBase64Url = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
};

/** The most a link may unpack to: far more than any song, but a made-up link can't fill the memory */
const MAX_UNPACKED = 32 * 1024 * 1024;

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_UNPACKED) {
      await reader.cancel();
      throw new Error('the link holds more than a song would');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The project with short ids. Every note, clip, track and marker has a random id, and random text
 * doesn't compress: on a typical song the ids were most of the link. Ids only need to be unique
 * within the song, and the app's own ids ("note-…") never look like these.
 */
function shortIds(project: ProjectSnapshot): ProjectSnapshot {
  let n = 0;
  const next = () => (n++).toString(36);
  const renamed: ProjectSnapshot = {
    ...project,
    clips: project.clips.map((c) => ({ ...c, id: `c${next()}` })),
    stingers: project.stingers?.map((s) => ({ ...s, notes: s.notes.map((note) => ({ ...note, id: '' })) })),
  };
  // Track ids are pointed at from all over (clips, bus outputs, sends, a Pump's source, "send:" lanes,
  // MIDI mappings, the game's rules and costumes...), a stinger's from transitions, a marker's (a
  // game state's) from the transition rules ("from>to") and the state options: rename these
  // everywhere at once
  const ids = new Map<string, string>();
  for (const [list, letter] of [
    [project.tracks, 't'],
    [project.markers, 'm'],
    [project.stingers, 's'],
    [project.sfx, 'x'],
    [project.costumes, 'o'],
    [project.gameParams, 'p'],
  ] as const)
    for (const item of list ?? []) if (item.id && !ids.has(item.id)) ids.set(item.id, `${letter}${next()}`);
  if (!ids.size) return renamed;
  const escape = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole ids only (an id inside a name, like 't1' in 'Beat1', stays): not next to a letter, digit, '_' or '-'
  const any = new RegExp('(?<![\\w-])(?:' + [...ids.keys()].sort((a, b) => b.length - a.length).map(escape).join('|') + ')(?![\\w-])', 'g');
  return JSON.parse(JSON.stringify(renamed).replace(any, (id) => ids.get(id)!)) as ProjectSnapshot;
}

/** Ticks per bar in a link's note positions (192 per quarter): every grid line, triplets included, is a whole number. */
const LINK_TICKS = 768;

/** A note in an old link ("#song="): [note, ticks, duration, velocity in hundredths] */
type PackedNote = [note: string, ticks: number, duration: string, velocity: number];

function unpackNotes(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { clips?: unknown }).clips)) return raw;
  const r = raw as { clips: Array<Record<string, unknown>> };
  let id = 0;
  return {
    ...r,
    clips: r.clips.map((c) =>
      Array.isArray(c.n)
        ? { ...c, n: undefined, notes: (c.n as PackedNote[]).map(([note, ticks, duration, velocity]) => ({ id: `n${(id++).toString(36)}`, note, startOffset: ticks / LINK_TICKS, duration, velocity: velocity / 100 })) }
        : c
    ),
  };
}

/**
 * Settings left out of a link while they're at these values, and put back when it's opened. Old
 * links rely on them: change a value here and the songs in links made before play differently.
 * (A track's effects are left out against defaultTrackFx() the same way.)
 */
const TRACK_DEFAULTS = { isMuted: false, isSoloed: false, isArmed: false, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0 };

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** `value` less whatever matches `fallback` (key by key, all the way down); undefined if all of it does. */
function lessDefaults(value: unknown, fallback: unknown): unknown {
  if (same(value, fallback)) return undefined;
  if (!isPlain(value) || !isPlain(fallback)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const left = k in fallback ? lessDefaults(v, fallback[k]) : v;
    if (left !== undefined) out[k] = left;
  }
  return out;
}

/** What lessDefaults left out, put back. */
function withDefaults(value: unknown, fallback: unknown): unknown {
  if (value === undefined) return fallback;
  if (!isPlain(value) || !isPlain(fallback)) return value;
  const out: Record<string, unknown> = { ...fallback };
  for (const [k, v] of Object.entries(value)) out[k] = k in fallback ? withDefaults(v, fallback[k]) : v;
  return out;
}

/** Whole numbers as bytes, seven bits to a byte (most of a song's numbers fit in one). */
class Bytes {
  out: number[] = [];
  uint(n: number) {
    let v = Math.max(0, Math.round(n));
    while (v >= 0x80) {
      this.out.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    this.out.push(v);
  }
  /** A number that may be below zero */
  int(n: number) {
    const v = Math.round(n);
    this.uint(v < 0 ? -2 * v - 1 : 2 * v);
  }
}

class Reader {
  at = 0;
  bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  uint(): number {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (this.at >= this.bytes.length) throw new Error('The link is cut short');
      const b = this.bytes[this.at++];
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 0x80;
    }
  }
  int(): number {
    const v = this.uint();
    return v % 2 ? -(v + 1) / 2 : v / 2;
  }
}

type Data = ReturnType<typeof serializeProject>;
type Note = Data['clips'][number]['notes'][number];
/** A clip or stinger as a link carries it: its notes in the bytes, their expression (by place) here */
type WithoutNotes<T> = Omit<T, 'notes'> & { notes?: undefined; x?: Array<[number, unknown]>; y?: Array<[number, unknown]> };

/**
 * The song as a link carries it: settings at their defaults left out, notes as bytes. Each clip's
 * (then each stinger's) notes in time order, four numbers each: how far after the one before (in
 * ticks), which pitch and which length (from the song's lists of them), and the velocity in
 * hundredths. A note's own expression stays in the JSON, by the note's place in that order, and
 * so does its chance and condition (`y`: { chance?, cond? }; see noteChance.ts).
 */
function pack(data: Data): Uint8Array<ArrayBuffer> {
  const pitches: string[] = [];
  const lengths: string[] = [];
  const indexIn = (list: string[], v: string) => {
    const i = list.indexOf(v);
    return i >= 0 ? i : list.push(v) - 1;
  };
  const bytes = new Bytes();
  const lessNotes = <T extends { notes: Note[] }>(owner: T): WithoutNotes<T> => {
    const notes = owner.notes.map((n) => ({ n, ticks: Math.round(n.startOffset * LINK_TICKS) })).sort((a, b) => a.ticks - b.ticks || a.n.note.localeCompare(b.n.note));
    bytes.uint(notes.length);
    let last = 0;
    const expr: Array<[number, unknown]> = [];
    const when: Array<[number, unknown]> = [];
    notes.forEach(({ n, ticks }, i) => {
      bytes.int(ticks - last);
      last = ticks;
      bytes.uint(indexIn(pitches, n.note));
      bytes.uint(indexIn(lengths, n.duration));
      bytes.uint(n.velocity * 100);
      if (n.expr) expr.push([i, n.expr]);
      if (n.chance !== undefined || n.cond) when.push([i, { ...(n.chance !== undefined ? { chance: n.chance } : {}), ...(n.cond ? { cond: n.cond } : {}) }]);
    });
    return { ...owner, notes: undefined, ...(expr.length ? { x: expr } : {}), ...(when.length ? { y: when } : {}) };
  };
  const clips = data.clips.map(lessNotes);
  const stingers = data.stingers?.map(lessNotes);
  const fx = defaultTrackFx();
  const tracks = data.tracks.map((t) => ({ ...(lessDefaults({ ...t, fx: undefined }, TRACK_DEFAULTS) as object), ...(t.fx ? { fx: lessDefaults(t.fx, fx) ?? {} } : {}) }));
  const json = new TextEncoder().encode(JSON.stringify({ ...data, format: undefined, tracks, clips, stingers, p: pitches, l: lengths }));
  const head = new Bytes();
  head.uint(json.length);
  const out = new Uint8Array(head.out.length + json.length + bytes.out.length);
  out.set(head.out, 0);
  out.set(json, head.out.length);
  out.set(bytes.out, head.out.length + json.length);
  return out;
}

function unpack(bytes: Uint8Array): unknown {
  const read = new Reader(bytes);
  const size = read.uint();
  const raw = JSON.parse(new TextDecoder().decode(bytes.subarray(read.at, read.at + size))) as Record<string, unknown>;
  read.at += size;
  const pitches = Array.isArray(raw.p) ? (raw.p as string[]) : [];
  const lengths = Array.isArray(raw.l) ? (raw.l as string[]) : [];
  let id = 0;
  const withNotes = (owner: WithoutNotes<{ notes: Note[] }>) => {
    const count = read.uint();
    let ticks = 0;
    const notes = Array.from({ length: count }, (): Note => {
      ticks += read.int();
      const note = pitches[read.uint()] ?? 'C4';
      const duration = lengths[read.uint()] ?? '8n';
      return { id: `n${(id++).toString(36)}`, note, startOffset: ticks / LINK_TICKS, duration, velocity: read.uint() / 100 };
    });
    for (const [i, expr] of Array.isArray(owner.x) ? owner.x : []) if (notes[i]) notes[i].expr = expr as Note['expr'];
    for (const [i, when] of Array.isArray(owner.y) ? owner.y : []) if (notes[i] && when && typeof when === 'object') Object.assign(notes[i], { chance: (when as Note).chance, cond: (when as Note).cond });
    return { ...owner, x: undefined, y: undefined, notes };
  };
  const list = (v: unknown) => (Array.isArray(v) ? (v as Array<WithoutNotes<{ notes: Note[] }>>) : []);
  const clips = list(raw.clips).map(withNotes);
  const stingers = list(raw.stingers).map(withNotes);
  const fx = defaultTrackFx();
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).map((t) => {
    const track = withDefaults(t, TRACK_DEFAULTS) as Record<string, unknown>;
    return 'fx' in track ? { ...track, fx: withDefaults(track.fx, fx) } : track;
  });
  return { ...raw, format: PROJECT_FORMAT, p: undefined, l: undefined, tracks, clips, stingers };
}

/** The link to `project` at `base` (this page's address without its #). */
export async function songLink(project: ProjectSnapshot, base: string): Promise<string> {
  // Sound files stay out: they'd make the link megabytes long (Save carries them)
  // Frozen tracks' sounds can't come either: the receiver's copy plays them live
  // and a recorded room for the reverb stays out too (the receiver hears the generated hall)
  const masterFx = project.masterFx?.room ? { ...project.masterFx, room: undefined } : project.masterFx;
  const compact = shortIds({ ...project, masterFx, tracks: project.tracks.map((t) => (t.frozen ? { ...t, frozen: undefined } : t)) });
  // (The receiver's copy is a song of their own: it gets its own id when it opens)
  const data = serializeProject({ ...compact, sounds: undefined, songId: undefined });
  return `${base}${SHARE_PREFIX}${toBase64Url(await pipe(pack(data), new CompressionStream('deflate-raw')))}`;
}

/** The project in a link's hash ("#s=..." or an older "#song=..."), or null if it has none. Throws if it's there but unreadable. */
export async function projectFromHash(hash: string): Promise<ProjectSnapshot | null> {
  if (hash.startsWith(SHARE_PREFIX)) return parseProject(unpack(await pipe(fromBase64Url(hash.slice(SHARE_PREFIX.length)), new DecompressionStream('deflate-raw'))));
  if (!hash.startsWith(OLD_PREFIX)) return null;
  const bytes = await pipe(fromBase64Url(hash.slice(OLD_PREFIX.length)), new DecompressionStream('deflate-raw'));
  return parseProject(unpackNotes(JSON.parse(new TextDecoder().decode(bytes))));
}

/** Tracks whose sound comes from a file (audio clips, the Sampler, the Slicer, Drum Rack and Multi Sampler sounds): a link can't carry those. */
export function tracksNeedingFiles(project: ProjectSnapshot): string[] {
  const names = new Set<string>();
  for (const t of project.tracks) if (t.sample || t.slicer || t.rack?.pads.some((p) => p.soundId) || t.multi?.zones.length) names.add(t.name);
  for (const c of project.clips) if (c.audio) names.add(project.tracks.find((t) => t.id === c.trackId)?.name ?? 'Audio');
  return [...names];
}
