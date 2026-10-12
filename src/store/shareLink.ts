import { parseProject, serializeProject } from './project';
import type { ProjectSnapshot } from './project';

/**
 * A song inside a link: the project (without its sound files) as JSON, deflated and written in
 * base64url after "#song=" on the app's own address. The part after # never reaches a server, so
 * the song travels only in the link. Opening the link opens the song (see SharedLinkOpener).
 */
export const SHARE_PREFIX = '#song=';

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

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/**
 * The project with short ids. Every note, clip, track and marker has a random id, and random text
 * doesn't compress: on a typical song the ids were most of the link. Ids only need to be unique
 * within the song, and the app's own ids ("note-…") never look like these.
 */
function shortIds(project: ProjectSnapshot): ProjectSnapshot {
  let n = 0;
  const next = () => (n++).toString(36);
  const trackIds = new Map(project.tracks.map((t) => [t.id, `t${next()}`]));
  const renamed: ProjectSnapshot = {
    ...project,
    clips: project.clips.map((c) => ({ ...c, id: `c${next()}` })),
    markers: project.markers?.map((m) => ({ ...m, id: `m${next()}` })),
  };
  if (!trackIds.size) return renamed;
  // Track ids are pointed at from all over (clips, bus outputs, sends, a Pump's source, "send:" lanes,
  // MIDI mappings, the game's rules...): rename them everywhere at once
  const escape = (id: string) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const any = new RegExp([...trackIds.keys()].sort((a, b) => b.length - a.length).map(escape).join('|'), 'g');
  return JSON.parse(JSON.stringify(renamed).replace(any, (id) => trackIds.get(id)!)) as ProjectSnapshot;
}

/** Ticks per bar in a link's note positions (192 per quarter): every grid line, triplets included, is a whole number. */
const LINK_TICKS = 768;

type PackedNote = [note: string, ticks: number, duration: string, velocity: number];

/** Notes as short lists, positions in whole ticks and velocities in hundredths: about half the size, compressed. */
function packNotes(data: ReturnType<typeof serializeProject>): unknown {
  return {
    ...data,
    clips: data.clips.map((c) => ({ ...c, notes: undefined, n: c.notes.map((n): PackedNote => [n.note, Math.round(n.startOffset * LINK_TICKS), n.duration, Math.round(n.velocity * 100)]) })),
  };
}

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

/** The link to `project` at `base` (this page's address without its #). */
export async function songLink(project: ProjectSnapshot, base: string): Promise<string> {
  // Sound files stay out: they'd make the link megabytes long (Save carries them)
  // Frozen tracks' sounds can't come either: the receiver's copy plays them live
  const compact = shortIds({ ...project, tracks: project.tracks.map((t) => (t.frozen ? { ...t, frozen: undefined } : t)) });
  const data = serializeProject({ ...compact, sounds: undefined });
  const json = new TextEncoder().encode(JSON.stringify(packNotes(data)));
  return `${base}${SHARE_PREFIX}${toBase64Url(await pipe(json, new CompressionStream('deflate-raw')))}`;
}

/** The project in a link's hash ("#song=..."), or null if it has none. Throws if it's there but unreadable. */
export async function projectFromHash(hash: string): Promise<ProjectSnapshot | null> {
  if (!hash.startsWith(SHARE_PREFIX)) return null;
  const bytes = await pipe(fromBase64Url(hash.slice(SHARE_PREFIX.length)), new DecompressionStream('deflate-raw'));
  return parseProject(unpackNotes(JSON.parse(new TextDecoder().decode(bytes))));
}

/** Tracks whose sound comes from a file (audio clips, the Sampler, the Slicer, Drum Rack and Multi Sampler sounds): a link can't carry those. */
export function tracksNeedingFiles(project: ProjectSnapshot): string[] {
  const names = new Set<string>();
  for (const t of project.tracks) if (t.sample || t.slicer || t.rack?.pads.some((p) => p.soundId) || t.multi?.zones.length) names.add(t.name);
  for (const c of project.clips) if (c.audio) names.add(project.tracks.find((t) => t.id === c.trackId)?.name ?? 'Audio');
  return [...names];
}
