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
 *
 * Outputs and sends together are one graph, and it never has a loop: a return playing into a bus
 * that sends to it would feed its own sound back into itself, louder each time round, and keep
 * sounding after Stop. Every route that would close a loop is refused (wouldLoop, sendWouldLoop),
 * and a song that has one anyway (an old file, a hand-edited one) drops the send that closes it
 * (loopSends: in track order, outputs kept), on load and in what plays and exports.
 */

type RouteTrack = Pick<Track, 'id' | 'instrumentKey' | 'isMuted' | 'isSoloed' | 'output'>;

export const isBus = (t: Pick<Track, 'instrumentKey'>) => INSTRUMENTS[t.instrumentKey]?.kind === 'bus';
export const isReturn = (t: Pick<Track, 'instrumentKey'>) => INSTRUMENTS[t.instrumentKey]?.kind === 'return';
/** A bus or a return: no clips, no recording, no freezing. */
export const isMixTrack = (t: Pick<Track, 'instrumentKey'>) => isBus(t) || isReturn(t);

type GraphTrack = RouteTrack & Pick<Track, 'sends'>;

/** The returns a track can send to: every return but itself that wouldn't make a loop (a return sends nowhere). */
export const sendTargets = <T extends GraphTrack>(track: T, tracks: readonly T[]): T[] => (isReturn(track) ? [] : tracks.filter((t) => isReturn(t) && t.id !== track.id && !sendWouldLoop(track.id, t.id, tracks)));

/** A track's sends that reach a return that's there, each once, and close no loop (what plays). */
export function liveSends<T extends GraphTrack>(track: T, tracks: readonly T[]): TrackSend[] {
  if (!track.sends?.length || isReturn(track)) return [];
  const returns = new Set(tracks.filter(isReturn).map((t) => t.id));
  const cut = loopSends(tracks);
  return track.sends.filter((s, i, all) => returns.has(s.to) && s.to !== track.id && all.findIndex((o) => o.to === s.to) === i && !cut.has(sendKey(track.id, s.to)));
}

const sendKey = (from: string, to: string) => `${from}\u0000${to}`;

/** The output a track plays into, if it's a bus that's there and isn't a loop of outputs (as tidyRoutes keeps). */
function outputEdge<T extends RouteTrack>(t: T, tracks: readonly T[]): T | undefined {
  const bus = busOf(t, tracks);
  return bus && !busChain(bus, tracks).some((b) => b.id === t.id) ? bus : undefined;
}

/**
 * The sends that would close a loop through outputs and sends (as "from\0to" keys): with every
 * output kept, each track's sends are taken in track order, then in their own order, and one is
 * left out when its return already plays back round to the sender. Empty for any song made in
 * the app (it never lets a loop be made); memoised per track list.
 */
export function loopSends(tracks: readonly GraphTrack[]): ReadonlySet<string> {
  const hit = loopMemo.get(tracks);
  if (hit) return hit;
  const cut = new Set<string>();
  if (tracks.some((t) => t.sends?.length)) {
    const returns = new Set(tracks.filter(isReturn).map((t) => t.id));
    const edges = new Map<string, string[]>();
    for (const t of tracks) {
      const bus = outputEdge(t, tracks);
      if (bus) edges.set(t.id, [bus.id]);
    }
    const reaches = (from: string, to: string) => {
      const seen = new Set([from]);
      const stack = [from];
      while (stack.length) {
        const at = stack.pop()!;
        if (at === to) return true;
        for (const next of edges.get(at) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          stack.push(next);
        }
      }
      return false;
    };
    for (const t of tracks) {
      if (!t.sends?.length || isReturn(t)) continue;
      const done = new Set<string>();
      for (const s of t.sends) {
        if (!returns.has(s.to) || s.to === t.id || done.has(s.to)) continue;
        done.add(s.to);
        if (reaches(s.to, t.id)) cut.add(sendKey(t.id, s.to));
        else edges.set(t.id, [...(edges.get(t.id) ?? []), s.to]);
      }
    }
  }
  loopMemo.set(tracks, cut);
  return cut;
}
const loopMemo = new WeakMap<readonly GraphTrack[], ReadonlySet<string>>();

/** Where a track's sound goes next: its bus and the returns it sends to (as they play). */
function routesOut<T extends GraphTrack>(t: T, tracks: readonly T[]): string[] {
  const bus = outputEdge(t, tracks);
  return [...(bus ? [bus.id] : []), ...liveSends(t, tracks).map((s) => s.to)];
}

/** Whether `fromId`'s sound reaches `toId`, through outputs and sends at any depth. */
export function routeReaches(fromId: string, toId: string, tracks: readonly GraphTrack[]): boolean {
  const seen = new Set([fromId]);
  const stack = [fromId];
  while (stack.length) {
    const at = stack.pop()!;
    if (at === toId) return true;
    const t = tracks.find((o) => o.id === at);
    if (!t) continue;
    for (const next of routesOut(t, tracks)) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}

/** Would `trackId` sending to `returnId` make a loop (the return already plays back round to the track)? */
export const sendWouldLoop = (trackId: string, returnId: string, tracks: readonly GraphTrack[]): boolean => trackId === returnId || routeReaches(returnId, trackId, tracks);

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

/** Would routing `trackId` into `busId` make a loop (the bus already plays back round to the track, through outputs or sends)? */
export function wouldLoop(trackId: string, busId: string, tracks: readonly GraphTrack[]): boolean {
  if (trackId === busId) return true;
  const bus = tracks.find((t) => t.id === busId);
  return !!bus && (busChain(bus, tracks).some((b) => b.id === trackId) || routeReaches(busId, trackId, tracks));
}

/** The buses a track can be routed into: every bus that wouldn't make a loop. */
export const busTargets = <T extends GraphTrack>(track: T, tracks: readonly T[]): T[] => tracks.filter((t) => isBus(t) && !wouldLoop(track.id, t.id, tracks));

/** The buses a track can't be routed into because the sound would go round in a loop (shown greyed, with why). */
export const loopingBuses = <T extends GraphTrack>(track: T, tracks: readonly T[]): T[] => tracks.filter((t) => isBus(t) && t.id !== track.id && wouldLoop(track.id, t.id, tracks));

/** The returns a track can't send to because the sound would go round in a loop. */
export const loopingReturns = <T extends GraphTrack>(track: T, tracks: readonly T[]): T[] => (isReturn(track) ? [] : tracks.filter((t) => isReturn(t) && t.id !== track.id && sendWouldLoop(track.id, t.id, tracks)));

/**
 * A song's tracks with no route loop: an output that loops through outputs alone is dropped (as
 * tidyRoutes), then each send that closes a loop (loopSends), with its lane and MIDI knob. The same
 * array when there's none (any song made in the app).
 */
export function breakLoops<T extends RouteTrack & Pick<Track, 'sends' | 'automation' | 'midiMap'>>(tracks: T[]): T[] {
  let out = tracks;
  if (tracks.some((t) => t.output && busOf(t, tracks) && !outputEdge(t, tracks))) {
    out = tracks.map((t) => {
      if (!t.output || !busOf(t, tracks) || outputEdge(t, tracks)) return t;
      const { output: _drop, ...rest } = t;
      return rest as T;
    });
  }
  const cut = loopSends(out);
  if (!cut.size) return out;
  return out.map((t) => {
    const gone = (to: string) => cut.has(sendKey(t.id, to));
    if (!t.sends?.some((s) => gone(s.to))) return t;
    const next = { ...t };
    const sends = t.sends.filter((s) => !gone(s.to));
    if (sends.length) next.sends = sends;
    else delete next.sends;
    const lanes = t.automation?.filter((l) => !(l.param.startsWith('send:') && gone(l.param.slice(5))));
    if (lanes && lanes.length !== t.automation!.length) {
      if (lanes.length) next.automation = lanes;
      else delete next.automation;
    }
    const maps = t.midiMap?.filter((m) => !(m.param.startsWith('send:') && gone(m.param.slice(5))));
    if (maps && maps.length !== t.midiMap!.length) {
      if (maps.length) next.midiMap = maps;
      else delete next.midiMap;
    }
    return next;
  });
}

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
  // Every track header asks, on every store change (the playhead's included): once per track list
  const hit = audibleMemo.get(tracks);
  if (hit) return hit;
  const out = computeAudible(tracks);
  audibleMemo.set(tracks, out);
  return out;
}
const audibleMemo = new WeakMap<readonly RouteTrack[], Set<string>>();

function computeAudible(tracks: readonly RouteTrack[]): Set<string> {
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
export function tidySends<T extends RouteTrack & Pick<Track, 'sends' | 'automation' | 'midiMap'>>(tracks: T[]): T[] {
  let changed = false;
  const returns = new Set(tracks.filter(isReturn).map((t) => t.id));
  const out = tracks.map((t) => {
    let next = t;
    const lanes = t.automation?.filter((l) => !l.param.startsWith('send:') || (returns.has(l.param.slice(5)) && l.param.slice(5) !== t.id));
    if (lanes && lanes.length !== t.automation!.length) {
      next = { ...next, automation: lanes };
      if (!lanes.length) delete next.automation;
    }
    // A MIDI knob mapped to a send to a return that's gone maps nothing
    const maps = t.midiMap?.filter((m) => !m.param.startsWith('send:') || (returns.has(m.param.slice(5)) && m.param.slice(5) !== t.id));
    if (maps && maps.length !== t.midiMap!.length) {
      next = { ...next, midiMap: maps };
      if (!maps.length) delete next.midiMap;
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
