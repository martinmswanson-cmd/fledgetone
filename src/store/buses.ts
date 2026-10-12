import type { Track } from './timelineTypes';
import { INSTRUMENTS } from '../audio/instrumentCatalog';

/**
 * Group buses: a bus is a track with no clips of its own (instrument 'bus') whose strip the
 * tracks routed to it play through, so a group of tracks shares one fader, its inserts and its
 * sends. A track's `output` names its bus; a bus can play into another bus, but never round into
 * itself. Pure, so it's unit tested (scripts/buses.test.mjs).
 */

type RouteTrack = Pick<Track, 'id' | 'instrumentKey' | 'isMuted' | 'isSoloed' | 'output'>;

export const isBus = (t: Pick<Track, 'instrumentKey'>) => INSTRUMENTS[t.instrumentKey]?.kind === 'bus';

/** The bus `track` plays into, if it names one that exists (and isn't itself). */
export function busOf<T extends RouteTrack>(track: T, tracks: readonly T[]): T | undefined {
  if (!track.output || track.output === track.id) return undefined;
  const bus = tracks.find((t) => t.id === track.output);
  return bus && isBus(bus) ? bus : undefined;
}

/** The buses `track` plays through, nearest first (a loop, which can't be made, is cut short). */
export function busChain<T extends RouteTrack>(track: T, tracks: readonly T[]): T[] {
  const chain: T[] = [];
  const seen = new Set([track.id]);
  let bus = busOf(track, tracks);
  while (bus && !seen.has(bus.id)) {
    chain.push(bus);
    seen.add(bus.id);
    bus = busOf(bus, tracks);
  }
  return chain;
}

/** Would routing `trackId` into `busId` make a loop (the bus already plays through the track)? */
export function wouldLoop(trackId: string, busId: string, tracks: readonly RouteTrack[]): boolean {
  if (trackId === busId) return true;
  const bus = tracks.find((t) => t.id === busId);
  return !!bus && busChain(bus, tracks).some((b) => b.id === trackId);
}

/** The buses a track can be routed into: every bus that wouldn't make a loop. */
export const busTargets = <T extends RouteTrack>(track: T, tracks: readonly T[]): T[] => tracks.filter((t) => isBus(t) && !wouldLoop(track.id, t.id, tracks));

/**
 * Which tracks a solo lets through, when any track is soloed: a soloed track, everything routed
 * into a soloed bus (at any depth), and every bus a soloed track plays through (so it's heard).
 * Null when nothing is soloed.
 */
export function soloLit(tracks: readonly RouteTrack[]): Set<string> | null {
  const soloed = tracks.filter((t) => t.isSoloed);
  if (!soloed.length) return null;
  const lit = new Set<string>();
  for (const t of tracks) {
    const chain = busChain(t, tracks);
    if (t.isSoloed || chain.some((b) => b.isSoloed)) {
      lit.add(t.id);
      for (const b of chain) lit.add(b.id);
    }
  }
  return lit;
}

/**
 * Whether each track is heard: not muted, not in a muted bus, and let through by any solo.
 * (A bus is heard when it is; what plays through it depends on its tracks too.)
 */
export function audibleIds(tracks: readonly RouteTrack[]): Set<string> {
  const lit = soloLit(tracks);
  const out = new Set<string>();
  for (const t of tracks) {
    if (t.isMuted || busChain(t, tracks).some((b) => b.isMuted)) continue;
    if (lit && !lit.has(t.id)) continue;
    out.add(t.id);
  }
  return out;
}

/** Tracks ordered so every bus comes before the tracks (and buses) that play into it. */
export function busFirst<T extends RouteTrack>(tracks: readonly T[]): T[] {
  const depth = (t: T) => busChain(t, tracks).length;
  // Buses first, those playing straight into the master before the ones inside them
  return [...tracks].sort((a, b) => Number(isBus(b)) - Number(isBus(a)) || depth(a) - depth(b));
}

/** Drop routes to buses that are gone (or aren't buses, or would loop). The same array when nothing changes. */
export function tidyRoutes<T extends RouteTrack>(tracks: T[]): T[] {
  let changed = false;
  const out = tracks.map((t) => {
    if (!t.output) return t;
    const bus = busOf(t, tracks);
    if (bus && !busChain(bus, tracks).some((b) => b.id === t.id)) return t;
    changed = true;
    const { output: _drop, ...rest } = t;
    return rest as T;
  });
  return changed ? out : tracks;
}
