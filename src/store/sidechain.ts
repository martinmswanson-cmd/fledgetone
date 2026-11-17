/**
 * Sidechains: a plugin effect on one track listening to another track's sound (WamPlugin.sidechain,
 * the other track's id). A compressor then ducks its own track under the other: the bass under
 * the kick, the music under a voice. Only a plugin that listens to one does anything with it
 * (BuiltinPluginInfo.sidechain; Fledge Compressor).
 *
 * The other track is heard as it leaves its own effects and pan, before its fader: its volume
 * doesn't change what the compressor hears, so a kick turned right down still ducks the bass. A
 * muted or soloed-out track is silent there too, so it ducks nothing.
 *
 * A sidechain that would feed a track's sound back into itself is not one: the track can't listen
 * to itself, to anything its own sound goes into (its bus, a return it sends to) or to a track
 * that already listens to it. Pure (no audio), so Node can test it; the live graph, the export and
 * the freezes all ask here which sidechains are in effect.
 */
import type { Track, WamPlugin } from './timelineTypes';
import { busOf, liveSends } from './buses';

type SidechainTrack = Pick<Track, 'id' | 'instrumentKey' | 'isMuted' | 'isSoloed' | 'output' | 'sends' | 'pluginFx'>;

/** Where each track's sound goes: its bus, the returns it sends to, and the tracks that listen to it (but for `except`'s own sidechain). */
function feeds(tracks: readonly SidechainTrack[], except?: string): Map<string, string[]> {
  const ids = new Set(tracks.map((t) => t.id));
  const into = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = into.get(from);
    if (list) list.push(to);
    else into.set(from, [to]);
  };
  for (const t of tracks) {
    const bus = busOf(t, tracks);
    if (bus) add(t.id, bus.id);
    for (const send of liveSends(t, tracks)) add(t.id, send.to);
    for (const p of t.pluginFx ?? []) if (p.sidechain && p.id !== except && !p.bypass && p.sidechain !== t.id && ids.has(p.sidechain)) add(p.sidechain, t.id);
  }
  return into;
}

function reaches(from: string, to: string, into: Map<string, string[]>): boolean {
  const seen = new Set<string>([from]);
  const todo = [from];
  while (todo.length) {
    for (const next of into.get(todo.pop()!) ?? []) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        todo.push(next);
      }
    }
  }
  return false;
}

/** Whether `track`'s plugin `pluginId` may listen to the track `sourceId`: another track, there, that this one's sound doesn't reach. */
export function canSidechain(track: SidechainTrack, pluginId: string, sourceId: string, tracks: readonly SidechainTrack[]): boolean {
  if (sourceId === track.id || !tracks.some((t) => t.id === sourceId)) return false;
  return !reaches(track.id, sourceId, feeds(tracks, pluginId));
}

/** The tracks `track`'s plugin `pluginId` may listen to, in the song's order. */
export function sidechainChoices<T extends SidechainTrack>(track: SidechainTrack, pluginId: string, tracks: readonly T[]): T[] {
  const into = feeds(tracks, pluginId);
  return tracks.filter((t) => t.id !== track.id && !reaches(track.id, t.id, into));
}

/** The track a plugin listens to, if its sidechain is in effect (not bypassed, the track there, no loop). */
export function sidechainOf(plugin: WamPlugin, track: SidechainTrack, tracks: readonly SidechainTrack[]): string | null {
  if (!plugin.sidechain || plugin.bypass) return null;
  return canSidechain(track, plugin.id, plugin.sidechain, tracks) ? plugin.sidechain : null;
}

/** The tracks `track`'s plugins listen to (each once). */
export function sidechainSources(track: SidechainTrack, tracks: readonly SidechainTrack[]): string[] {
  const out: string[] = [];
  for (const p of track.pluginFx ?? []) {
    const id = sidechainOf(p, track, tracks);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The tracks with only the sidechains in effect left on their plugins (one that isn't is taken
 * off), for building the sound from. The same tracks, and the same array, where nothing changes.
 */
export function withSidechains<T extends SidechainTrack>(tracks: T[]): T[] {
  if (!tracks.some((t) => t.pluginFx?.some((p) => p.sidechain))) return tracks;
  let changed = false;
  const out = tracks.map((t) => {
    if (!t.pluginFx?.some((p) => p.sidechain && sidechainOf(p, t, tracks) === null)) return t;
    changed = true;
    return {
      ...t,
      pluginFx: t.pluginFx.map((p) => {
        if (!p.sidechain || sidechainOf(p, t, tracks) !== null) return p;
        const { sidechain: _off, ...rest } = p;
        return rest;
      }),
    };
  });
  return changed ? out : tracks;
}
