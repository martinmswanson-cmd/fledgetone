/**
 * The most of each part a song opens with, and keeps while it's edited: tracks, clips, markers,
 * notes, lane points and the rest. Far above any real song (the app's own have a few tracks, a
 * few dozen clips, hundreds of notes), so only a damaged or made-up file or link meets them; what's
 * past them is left out when it opens (the first ones kept), and the song says so in plain words
 * (ProjectSnapshot.unread), rather than tens of thousands of tracks or clips stopping the studio.
 * An edit that would go past one isn't made (timelineStore's set, with editPastCaps).
 */
import { maxOf } from '../support/minMax';

/** The most notes in one clip (one take, one launcher slot, one stinger), and in the whole song. */
export const MAX_CLIP_NOTES = 20_000;
export const MAX_SONG_NOTES = 200_000;
/** The most points in one automation or expression lane, and in all of them together. */
export const MAX_LANE_POINTS = 50_000;
export const MAX_SONG_POINTS = 500_000;

/** The most of each of these in a song (takes: in one clip). */
export const SONG_CAPS = {
  tracks: 256,
  clips: 10_000,
  markers: 5_000,
  tempoPoints: 4_000,
  meterPoints: 400,
  takes: 256,
  stingers: 200,
  sounds: 4_096,
  transitions: 4_096,
  curves: 256,
} as const;

export type CapKind = keyof typeof SONG_CAPS | 'notes' | 'points';
/** How many of each were past its cap. */
export type OverCaps = Partial<Record<CapKind, number>>;

/** Each kind in words: one, many, and its cap. */
const WORDS: Record<CapKind, [one: string, many: string, cap: () => string]> = {
  tracks: ['track', 'tracks', () => `${n(SONG_CAPS.tracks)} tracks`],
  clips: ['clip', 'clips', () => `${n(SONG_CAPS.clips)} clips`],
  markers: ['marker', 'markers', () => `${n(SONG_CAPS.markers)} markers`],
  tempoPoints: ['tempo change', 'tempo changes', () => `${n(SONG_CAPS.tempoPoints)} tempo changes`],
  meterPoints: ['time signature change', 'time signature changes', () => `${n(SONG_CAPS.meterPoints)} time signature changes`],
  takes: ['take', 'takes', () => `${n(SONG_CAPS.takes)} takes in a clip`],
  stingers: ['stinger', 'stingers', () => `${n(SONG_CAPS.stingers)} stingers`],
  sounds: ['sound', 'sounds', () => `${n(SONG_CAPS.sounds)} sounds`],
  transitions: ['transition rule', 'transition rules', () => `${n(SONG_CAPS.transitions)} transition rules`],
  curves: ['intensity curve', 'intensity curves', () => `${n(SONG_CAPS.curves)} intensity curves`],
  notes: ['note', 'notes', () => `${n(MAX_CLIP_NOTES)} notes in a clip, ${n(MAX_SONG_NOTES)} in all`],
  points: ['lane point', 'lane points', () => `${n(MAX_LANE_POINTS)} points in a lane, ${n(MAX_SONG_POINTS)} in all`],
};
const ORDER = Object.keys(WORDS) as CapKind[];

const n = (count: number) => count.toLocaleString('en-US');
const counted = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`;
/** "a, b and c" */
const listed = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

/** The caps of these kinds, in words: "256 tracks, 10,000 clips". */
export const capsWords = (kinds: readonly CapKind[]): string =>
  ORDER.filter((k) => kinds.includes(k))
    .map((k) => WORDS[k][2]())
    .join(', ');

/** What was past the caps, in words: "1,244 tracks over the most a song opens with (256 tracks)"; '' when nothing was. */
export function overWords(over: OverCaps): string {
  const kinds = ORDER.filter((k) => (over[k] ?? 0) > 0);
  if (!kinds.length) return '';
  // (Notes alone, as it has always said: "180,000 notes over the most a song opens with (20,000 in a clip, 200,000 in all)")
  const caps = kinds.length === 1 && kinds[0] === 'notes' ? `${n(MAX_CLIP_NOTES)} in a clip, ${n(MAX_SONG_NOTES)} in all` : capsWords(kinds);
  return `${listed(kinds.map((k) => counted(over[k]!, WORDS[k][0], WORDS[k][1])))} over the most a song opens with (${caps})`;
}

/** What an edit that would go past the caps says (it isn't made). */
export const pastCapsWords = (kinds: readonly CapKind[]): string => `That would go past the most a song can have (${capsWords(kinds)}), so it wasn't done.`;

// ---------- Opening a file ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Cut a file's lists to the caps (in the file's own objects, before they're read), the first ones
 * kept: tracks, clips, markers, tempo and time signature changes, stingers, sounds, takes, game
 * transition rules and intensity curves, then notes and lane points. Returns how many of each were
 * left out. (A track left out takes its clips with it: those aren't counted again.)
 */
export function capSong(raw: Record<string, unknown> & { tracks: unknown[]; clips: unknown[] }): OverCaps {
  const over: OverCaps = {};
  const add = (kind: CapKind, count: number) => {
    if (count > 0) over[kind] = (over[kind] ?? 0) + count;
  };
  const cut = (owner: Record<string, unknown>, key: string, cap: number, kind: CapKind) => {
    const list = owner[key];
    if (!Array.isArray(list) || list.length <= cap) return;
    add(kind, list.length - cap);
    owner[key] = list.slice(0, cap);
  };
  const cutKeys = (owner: unknown, key: string, cap: number, kind: CapKind) => {
    if (!isObj(owner) || !isObj(owner[key]) || Array.isArray(owner[key])) return;
    const entries = Object.entries(owner[key] as Record<string, unknown>);
    if (entries.length <= cap) return;
    add(kind, entries.length - cap);
    const kept: Record<string, unknown> = {};
    // (as plain keys, whatever they are: a "__proto__" key stays data)
    for (const [k, v] of entries.slice(0, cap)) Object.defineProperty(kept, k, { value: v, enumerable: true, writable: true, configurable: true });
    owner[key] = kept;
  };
  cut(raw, 'tracks', SONG_CAPS.tracks, 'tracks');
  cut(raw, 'clips', SONG_CAPS.clips, 'clips');
  for (const key of ['markers', 'tempoPoints', 'meterPoints', 'stingers', 'sounds'] as const) cut(raw, key, SONG_CAPS[key], key);
  cutKeys(raw, 'transitions', SONG_CAPS.transitions, 'transitions');
  cutKeys(raw.intensity, 'curves', SONG_CAPS.curves, 'curves');
  const clips = clipsOf(raw);
  for (const c of clips) cut(c, 'takes', SONG_CAPS.takes, 'takes');
  add('notes', capNotes(raw, clips));
  add('points', capPoints(raw, clips));
  return over;
}

/** Every clip in a file: the timeline's and the launcher slots'. */
function clipsOf(raw: { tracks: unknown[]; clips: unknown[] }): Array<Record<string, unknown>> {
  const out = raw.clips.filter(isObj);
  for (const t of raw.tracks) if (isObj(t) && Array.isArray(t.slots)) for (const slot of t.slots) if (isObj(slot) && isObj(slot.clip)) out.push(slot.clip);
  return out;
}

/** Cut note lists to MAX_CLIP_NOTES each and MAX_SONG_NOTES in all (clips, their takes, launcher slots, stingers). Returns how many were left out. */
function capNotes(raw: Record<string, unknown>, clips: Array<Record<string, unknown>>): number {
  let left = MAX_SONG_NOTES;
  let dropped = 0;
  const cap = (owner: unknown) => {
    if (!isObj(owner) || !Array.isArray(owner.notes)) return;
    const notes: unknown[] = owner.notes;
    const keep = Math.max(0, Math.min(MAX_CLIP_NOTES, left));
    if (notes.length > keep) {
      dropped += notes.length - keep;
      owner.notes = notes.slice(0, keep);
    }
    left -= Math.min(notes.length, keep);
  };
  for (const clip of clips) {
    cap(clip);
    if (Array.isArray(clip.takes)) clip.takes.forEach(cap);
  }
  if (Array.isArray(raw.stingers)) raw.stingers.forEach(cap);
  return dropped;
}

/** Cut lane points to MAX_LANE_POINTS a lane and MAX_SONG_POINTS in all (tracks' automation, clips' and takes' expression). Returns how many were left out. */
function capPoints(raw: { tracks: unknown[] }, clips: Array<Record<string, unknown>>): number {
  let left = MAX_SONG_POINTS;
  let dropped = 0;
  const cap = (owner: Record<string, unknown>, key: string) => {
    const points = owner[key];
    if (!Array.isArray(points)) return;
    const keep = Math.max(0, Math.min(MAX_LANE_POINTS, left));
    if (points.length > keep) {
      dropped += points.length - keep;
      owner[key] = points.slice(0, keep);
    }
    left -= Math.min(points.length, keep);
  };
  for (const t of raw.tracks) if (isObj(t) && Array.isArray(t.automation)) for (const lane of t.automation) if (isObj(lane)) cap(lane, 'points');
  const lanes = (owner: unknown) => {
    if (!isObj(owner) || !isObj(owner.expression)) return;
    const expression = owner.expression;
    for (const key of Object.keys(expression)) cap(expression, key);
  };
  for (const clip of clips) {
    lanes(clip);
    if (Array.isArray(clip.takes)) clip.takes.forEach(lanes);
  }
  return dropped;
}

// ---------- While editing ----------

interface SizedClip {
  notes: readonly unknown[];
  takes?: ReadonlyArray<{ notes?: readonly unknown[]; expression?: object }>;
  expression?: object;
}
interface SizedSong {
  tracks: ReadonlyArray<{ slots?: ReadonlyArray<{ clip: SizedClip }>; automation?: ReadonlyArray<{ points: readonly unknown[] }> }>;
  clips: readonly SizedClip[];
  markers?: readonly unknown[];
  tempoPoints?: readonly unknown[];
  meterPoints?: readonly unknown[];
  stingers?: ReadonlyArray<{ notes: readonly unknown[] }>;
}

/** What a list of clips, or of tracks, or of stingers holds against the caps. */
interface Part {
  notes: number;
  /** The most notes in one clip, take or stinger */
  clipNotes: number;
  points: number;
  /** The most points in one lane */
  lanePoints: number;
  /** The most takes in one clip */
  takes: number;
}

/** Measured once for each list as the store holds it: an edit measures only the lists it changed. */
const parts = new WeakMap<object, Part>();

function partOf(list: readonly object[], measure: (part: Part, item: never) => void): Part {
  const known = parts.get(list);
  if (known) return known;
  const part: Part = { notes: 0, clipNotes: 0, points: 0, lanePoints: 0, takes: 0 };
  for (const item of list) measure(part, item as never);
  parts.set(list, part);
  return part;
}

const noteList = (part: Part, list: readonly unknown[] | undefined) => {
  const count = list?.length ?? 0;
  part.notes += count;
  if (count > part.clipNotes) part.clipNotes = count;
};
const lane = (part: Part, list: unknown) => {
  const count = Array.isArray(list) ? list.length : 0;
  part.points += count;
  if (count > part.lanePoints) part.lanePoints = count;
};
const expression = (part: Part, e: object | undefined) => {
  if (e) for (const v of Object.values(e)) lane(part, v);
};
const clip = (part: Part, c: SizedClip) => {
  noteList(part, c.notes);
  expression(part, c.expression);
  if (!c.takes) return;
  if (c.takes.length > part.takes) part.takes = c.takes.length;
  for (const t of c.takes) {
    noteList(part, t.notes);
    expression(part, t.expression);
  }
};
const track = (part: Part, t: SizedSong['tracks'][number]) => {
  t.slots?.forEach((s) => clip(part, s.clip));
  t.automation?.forEach((l) => lane(part, l.points));
};
const stinger = (part: Part, s: { notes: readonly unknown[] }) => noteList(part, s.notes);

/** How far past its cap a song is of one kind (0: not past it). */
function pastBy(song: SizedSong, kind: CapKind): number {
  const all = [partOf(song.clips, clip), partOf(song.tracks, track), partOf(song.stingers ?? [], stinger)];
  const most = (k: keyof Part) => maxOf(0, all.map((p) => p[k]));
  const sum = (k: keyof Part) => all.reduce((n, p) => n + p[k], 0);
  const over = (count: number, cap: number) => Math.max(0, count - cap);
  switch (kind) {
    case 'notes':
      return over(most('clipNotes'), MAX_CLIP_NOTES) + over(sum('notes'), MAX_SONG_NOTES);
    case 'points':
      return over(most('lanePoints'), MAX_LANE_POINTS) + over(sum('points'), MAX_SONG_POINTS);
    case 'takes':
      return over(most('takes'), SONG_CAPS.takes);
    case 'tracks':
    case 'clips':
    case 'markers':
    case 'tempoPoints':
    case 'meterPoints':
    case 'stingers':
      return over(song[kind]?.length ?? 0, SONG_CAPS[kind]);
    default:
      return 0;
  }
}

const EDIT_KINDS: CapKind[] = ['tracks', 'clips', 'markers', 'tempoPoints', 'meterPoints', 'takes', 'stingers', 'notes', 'points'];

/**
 * The caps an edit from `before` to `after` would go past, or an empty list. Only going further
 * past one counts: a song already past one (as an older version could keep) can still be edited
 * and made smaller.
 */
export function editPastCaps(before: SizedSong, after: SizedSong): CapKind[] {
  return EDIT_KINDS.filter((kind) => {
    const now = pastBy(after, kind);
    return now > 0 && now > pastBy(before, kind);
  });
}
