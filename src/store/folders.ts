import type { Track, TrackFolder } from './timelineTypes';

/**
 * Track folders: a group of tracks shown together under a folder row that names and colours them,
 * folds them away, and mutes or solos them in one click. Each member carries the folder (so undo,
 * saving and the autosave keep it with no more machinery), and a folder's members always sit
 * together in the track list. No store or audio here, so Node can unit-test it.
 */

/** The folders in track order, each once, with how many tracks it has. */
export function foldersOf(tracks: readonly Track[]): Array<TrackFolder & { count: number }> {
  const out: Array<TrackFolder & { count: number }> = [];
  for (const t of tracks) {
    if (!t.folder) continue;
    const f = out.find((x) => x.id === t.folder!.id);
    if (f) f.count++;
    else out.push({ ...t.folder, count: 1 });
  }
  return out;
}

/**
 * The tracks with every folder's members together, where its first member is (the rest keep their
 * order), and every member carrying the same settings as the first. The same array if it already is.
 */
export function tidyFolders(tracks: Track[]): Track[] {
  if (!tracks.some((t) => t.folder)) return tracks;
  const seen = new Map<string, TrackFolder>();
  const out: Track[] = [];
  const placed = new Set<string>();
  for (const t of tracks) {
    if (placed.has(t.id)) continue;
    if (!t.folder) {
      out.push(t);
      continue;
    }
    const id = t.folder.id;
    if (seen.has(id)) continue;
    seen.set(id, t.folder);
    for (const m of tracks) {
      if (m.folder?.id !== id) continue;
      placed.add(m.id);
      out.push(m.folder === t.folder ? m : { ...m, folder: t.folder });
    }
  }
  const same = out.length === tracks.length && out.every((t, i) => t === tracks[i]);
  return same ? tracks : out;
}

/** Put `ids` in a new folder (where the first of them is). */
export function groupTracks(tracks: Track[], ids: ReadonlySet<string>, folder: TrackFolder): Track[] {
  const first = tracks.findIndex((t) => ids.has(t.id));
  if (first < 0) return tracks;
  const members = tracks.filter((t) => ids.has(t.id)).map((t) => ({ ...t, folder }));
  const rest = tracks.filter((t) => !ids.has(t.id));
  // Where the first member was, counted among the tracks that stay
  const at = tracks.slice(0, first).filter((t) => !ids.has(t.id)).length;
  return tidyFolders([...rest.slice(0, at), ...members, ...rest.slice(at)]);
}

/** Take every track out of folder `id` (the tracks stay where they are). */
export function ungroup(tracks: Track[], id: string): Track[] {
  if (!tracks.some((t) => t.folder?.id === id)) return tracks;
  return tracks.map((t) => {
    if (t.folder?.id !== id) return t;
    const { folder: _folder, ...rest } = t;
    return rest;
  });
}

/** Change a folder's name, colour or folding (every member). `recolor` gives the members its colour too. */
export function updateFolder(tracks: Track[], id: string, patch: Partial<Omit<TrackFolder, 'id'>>, recolor = false): Track[] {
  const current = tracks.find((t) => t.folder?.id === id)?.folder;
  if (!current) return tracks;
  const folder: TrackFolder = { ...current, ...patch };
  if (!folder.collapsed) delete folder.collapsed;
  return tracks.map((t) => (t.folder?.id === id ? { ...t, folder, ...(recolor && patch.color ? { color: patch.color } : {}) } : t));
}

/** Put a track in folder `id` (at the end of it), or take it out with null (it goes just after the folder). */
export function moveToFolder(tracks: Track[], trackId: string, id: string | null): Track[] {
  const track = tracks.find((t) => t.id === trackId);
  if (!track || (track.folder?.id ?? null) === id) return tracks;
  const rest = tracks.filter((t) => t.id !== trackId);
  if (id === null) {
    const { folder: _folder, ...plain } = track;
    const lastMember = rest.map((t) => t.folder?.id).lastIndexOf(track.folder!.id);
    return [...rest.slice(0, lastMember + 1), plain, ...rest.slice(lastMember + 1)];
  }
  const folder = tracks.find((t) => t.folder?.id === id)?.folder;
  if (!folder) return tracks;
  const lastMember = rest.map((t) => t.folder?.id).lastIndexOf(id);
  return tidyFolders([...rest.slice(0, lastMember + 1), { ...track, folder }, ...rest.slice(lastMember + 1)]);
}

/**
 * Move a track one row up (-1) or down (1). Inside a folder it swaps with its neighbour there; at
 * the folder's edge it steps out of the folder; outside folders it hops over a whole folder.
 */
export function moveTrack(tracks: Track[], trackId: string, direction: -1 | 1): Track[] {
  const i = tracks.findIndex((t) => t.id === trackId);
  if (i < 0) return tracks;
  const t = tracks[i];
  const j = i + direction;
  const neighbour = tracks[j];
  if (t.folder) {
    if (neighbour?.folder?.id === t.folder.id) {
      const out = [...tracks];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    }
    // At the folder's edge: out of the folder, staying put (above it when going up)
    const { folder: _folder, ...plain } = t;
    const rest = tracks.filter((x) => x.id !== trackId);
    const ids = rest.map((x) => x.folder?.id);
    const at = direction < 0 ? ids.indexOf(t.folder.id) : ids.lastIndexOf(t.folder.id) + 1;
    return [...rest.slice(0, at), plain, ...rest.slice(at)];
  }
  if (!neighbour) return tracks;
  // Over the neighbour, or over the whole folder it's in
  let k = j;
  if (neighbour.folder) while (tracks[k + direction]?.folder?.id === neighbour.folder.id) k += direction;
  const rest = tracks.filter((x) => x.id !== trackId);
  const at = rest.findIndex((x) => x.id === tracks[k].id) + (direction > 0 ? 1 : 0);
  return [...rest.slice(0, at), t, ...rest.slice(at)];
}

/** Rows as the timeline shows them: a folder row before its members, members hidden when it's folded. */
export type TrackRow = { kind: 'folder'; folder: TrackFolder; members: Track[] } | { kind: 'track'; track: Track };

export function trackRows(tracks: readonly Track[]): TrackRow[] {
  const rows: TrackRow[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.folder && tracks[i - 1]?.folder?.id !== t.folder.id) {
      const members: Track[] = [];
      for (let k = i; k < tracks.length && tracks[k].folder?.id === t.folder.id; k++) members.push(tracks[k]);
      rows.push({ kind: 'folder', folder: t.folder, members });
    }
    if (!t.folder?.collapsed) rows.push({ kind: 'track', track: t });
  }
  return rows;
}
