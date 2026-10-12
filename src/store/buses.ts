import type { Track, TrackSend } from './timelineTypes';
import { INSTRUMENTS } from '../audio/instrumentCatalog';

/**
 * Group buses: a bus is a track with no clips of its own (instrument 'bus') whose strip the
 * tracks routed to it play through, so a group of tracks shares one fader, its inserts and its
 * sends. A track's `output` names its bus; a bus can play into another bus, but never round into
 * itself.
 *
 * Returns: a return is a track with no clips of its own (instrument 'return') that other tracks
 * send to (`Track.sends`), each at its own level, before or after their fader: its inserts are the
 * effect (a long reverb, a parallel compressor) and its fader how much of it comes back. A return
 * plays into the master, or a bus; it sends nowhere itself. A solo doesn't silence returns (else
 * a soloed track would lose its reverb). Pure, so it's unit tested (scripts/buses.test.mjs).
 */

type RouteTrack = Pick<Track, 'id' | 'instrumentKey' | 'isMuted' | 'isSoloed' | 'output'>;

export const isBus = (t: Pick<Track, 'instrumentKey'>) => INSTRUMENTS[t.instrumentKey]?.kind === 'bus';
export const isReturn = (t: Pick<Track, 'instrumentKey'>) => INSTRUMENTS[t.instrumentKey]?.kind === 'return';
/** A bus or a return: no clips, no recording, no freezing. */
export const isMixTrack = (t: Pick<Track, 'instrumentKey'>) => isBus(t) || isReturn(t);

/** The returns a track can send to (a return sends nowhere). */
export const sendTargets = <T extends RouteTrack>(track: T, tracks: readonly T[]): T[] => (isReturn(track) ? [] : tracks.filter((t) => isReturn(t) && t.id !== track.id));

/** A track's sends that reach a return that's there, each once (what plays). */
export function liveSends<T extends RouteTrack & Pick<Track, 'sends'>>(track: T, tracks: readonly T[]): TrackSend[] {
  if (!track.sends?.length || isReturn(track)) return [];
  const returns = new Set(tracks.filter(isReturn).map((t) => t.id));
  return track.sends.filter((s, i, all) => returns.has(s.to) && s.to !== track.id && all.findIndex((o) => o.to === s.to) === i);
}

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
    // Returns stay on through a solo (unless soloing them is the point), with the buses they play into
    if (t.isSoloed || chain.some((b) => b.isSoloed) || isReturn(t)) {
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

/** Tracks ordered so every bus comes before the tracks (and buses) that play into it, and every return before the tracks that send to it. */
export function busFirst<T extends RouteTrack>(tracks: readonly T[]): T[] {
  const depth = (t: T) => busChain(t, tracks).length;
  const rank = (t: T) => (isBus(t) ? 0 : isReturn(t) ? 1 : 2);
  // Buses first, those playing straight into the master before the ones inside them; then returns
  return [...tracks].sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b));
}

/**
 * Drop sends to returns that are gone (and a return's own), and the automation lanes of those
 * sends. The same array when nothing changes.
 */
export function tidySends<T extends RouteTrack & Pick<Track, 'sends' | 'automation'>>(tracks: T[]): T[] {
  let changed = false;
  const returns = new Set(tracks.filter(isReturn).map((t) => t.id));
  const out = tracks.map((t) => {
    let next = t;
    const lanes = t.automation?.filter((l) => !l.param.startsWith('send:') || (returns.has(l.param.slice(5)) && l.param.slice(5) !== t.id));
    if (lanes && lanes.length !== t.automation!.length) {
      next = { ...next, automation: lanes };
      if (!lanes.length) delete next.automation;
    }
    if (t.sends) {
      const kept = liveSends(t, tracks);
      if (kept.length !== t.sends.length || !t.sends.length) {
        if (kept.length) next = { ...next, sends: kept };
        else {
          const { sends: _drop, ...rest } = next;
          next = rest as T;
        }
      }
    }
    if (next !== t) changed = true;
    return next;
  });
  return changed ? out : tracks;
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
