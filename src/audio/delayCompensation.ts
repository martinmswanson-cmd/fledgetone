/**
 * Delay compensation: how much to hold back each track so every path through the mix reaches the
 * master at the same moment. A compressor (the Compressor insert, the multiband one, the guitar
 * amps' squeeze) looks ahead, so it holds back the sound passing through it by a few milliseconds;
 * a compressed kick then landed a few ms after the uncompressed bass, which smeared them together.
 * Pure (no Web Audio): the engine measures a compressor's delay and applies what this returns.
 *
 * The mix is a tree of strips: each plays into a bus or the master (its dry path) and may send to
 * returns. Every path from a strip's tap point (after its inserts, where its sends are taken) to the
 * master is made as long as its longest one, and every source track's sound as long as the slowest
 * source's. Three delays per strip do it:
 *   tail:  after its inserts, before the sends are taken (so the sends keep in line with the dry sound);
 *   dry:   after the sends are taken, on its way to its bus or the master;
 *   sends: on each send to a return.
 * A bus or a return has no tail: the tracks playing into it are already in line when they arrive.
 * When nothing has a delay, everything here is 0 and the engine adds nothing.
 */
import type { Track } from '../store/timelineTypes';
import { COMPRESSED_SHAPINGS, INSTRUMENTS } from './instrumentCatalog';
import { busOf, isBus, isReturn, liveSends } from '../store/buses';

/** One strip of the mix, for compensateDelays. */
export interface MixNode {
  id: string;
  /** What its own sound path delays the sound by (instrument and inserts), in frames. */
  own: number;
  /** A track's sound starts here; a bus or a return only passes on what reaches it. */
  source: boolean;
  /** The bus its dry path plays into (null: the master). */
  out: string | null;
  /** The returns it sends to. */
  sends: readonly string[];
}

/** The delays one strip needs, in frames (see the top of the file). */
export interface PathDelays {
  tail: number;
  dry: number;
  /** By return id: only the sends that need one. */
  sends: Record<string, number>;
}

export interface Compensation {
  /** How late every source's sound reaches the master (frames): the slowest path's own delay. */
  total: number;
  /** By strip id: only the strips that need a delay somewhere. */
  delays: Map<string, PathDelays>;
}

/**
 * The delays that line every path up (see the top of the file), for strips `nodes`. A bus or return
 * named but not among the nodes counts as the master; a loop (which the app never makes) is cut.
 */
export function compensateDelays(nodes: readonly MixNode[]): Compensation {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  /** From a strip's tap point to the master, along its longest path */
  const outMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const inLatency = (id: string | null): number => {
    const node = id === null ? undefined : byId.get(id);
    return node ? node.own + outLatency(node) : 0;
  };
  const outLatency = (node: MixNode): number => {
    const known = outMemo.get(node.id);
    if (known !== undefined) return known;
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    let longest = inLatency(node.out);
    for (const to of node.sends) longest = Math.max(longest, inLatency(to));
    visiting.delete(node.id);
    outMemo.set(node.id, longest);
    return longest;
  };
  let total = 0;
  for (const n of nodes) if (n.source) total = Math.max(total, n.own + outLatency(n));
  const delays = new Map<string, PathDelays>();
  for (const n of nodes) {
    const out = outLatency(n);
    const tail = n.source ? total - n.own - out : 0;
    const dry = out - inLatency(n.out);
    const sends: Record<string, number> = {};
    for (const to of n.sends) {
      const extra = out - inLatency(to);
      if (extra > 0) sends[to] = extra;
    }
    if (tail > 0 || dry > 0 || Object.keys(sends).length) delays.set(n.id, { tail, dry, sends });
  }
  return { total, delays };
}

/**
 * How many compressors a track's own sound passes through one after another: its Compressor insert,
 * its multiband compressor (three side by side, so one delay) and its instrument's amp.
 */
export function trackCompressors(track: Pick<Track, 'instrumentKey' | 'fx'>): number {
  let count = 0;
  if (track.fx.compressor?.on) count++;
  if (track.fx.mbc?.on) count++;
  const shaping = INSTRUMENTS[track.instrumentKey]?.shaping;
  if (shaping && COMPRESSED_SHAPINGS.has(shaping)) count++;
  return count;
}

/**
 * The mix as compensateDelays takes it, for a song's tracks, with a compressor delaying the sound
 * by `compressorFrames`. Every track counts, muted or not, so muting one doesn't move the others.
 */
export function mixNodes(tracks: readonly Track[], compressorFrames: number): MixNode[] {
  return tracks.map((track) => {
    const bus = busOf(track, tracks);
    return {
      id: track.id,
      own: trackCompressors(track) * compressorFrames,
      source: !isBus(track) && !isReturn(track),
      out: bus ? bus.id : null,
      sends: liveSends(track, tracks).map((s) => s.to),
    };
  });
}

/** compensateDelays for a song's tracks (see mixNodes). */
export const compensateTracks = (tracks: readonly Track[], compressorFrames: number): Compensation => compensateDelays(mixNodes(tracks, compressorFrames));
