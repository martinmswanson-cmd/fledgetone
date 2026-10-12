import { create } from 'zustand';
import type { Clip, LauncherSlot, SlotClip, Track } from './timelineTypes';
import { TOTAL_BARS } from './timelineTypes';

/**
 * The clip launcher (see launcher.ts) as the live engine hears it. While it's in use, each track
 * it has taken over plays, from one bar to the next, either its arrangement, nothing, or one of
 * its slots looping. Those stretches are the track's segments, in song bars: a launch lands on a
 * bar line (the next one, while playing), so the segment it starts lies just ahead.
 *
 * The engine gets an arrangement with these applied: the track's own clips where it plays the
 * arrangement, and copies of the slot's clip end to end where a slot plays.
 */

const EPS = 1e-6;

export type Segment = { from: number; kind: 'arr' } | { from: number; kind: 'stop' } | { from: number; kind: 'slot'; scene: number };

export interface LauncherRuntime {
  /** Per track taken over: its segments, in order of `from` (before the first, the arrangement). */
  segments: Record<string, Segment[]>;
  /** The session that just ended (what Write to arrangement writes): its segments, from where to where it played. */
  last: { segments: Record<string, Segment[]>; start: number; end: number } | null;
  /** Where the current session started (the first launch's bar) */
  start: number | null;
  /** Launches land on a multiple of this many bars (1: the next bar line) */
  quantize: number;
}

export const useLauncher = create<LauncherRuntime>(() => ({ segments: {}, last: null, start: null, quantize: 1 }));

export const launcherActive = (segments: Record<string, Segment[]>) => Object.keys(segments).length > 0;

/** A track's slot in scene `scene`, if it has one. */
export const slotAt = (track: Pick<Track, 'slots'>, scene: number): LauncherSlot | undefined => track.slots?.find((s) => s.scene === scene);

/** The segment playing at `bar` (null: the arrangement, as before any segment). */
export function segmentAt(segments: readonly Segment[] | undefined, bar: number): Segment | null {
  let hit: Segment | null = null;
  for (const seg of segments ?? []) if (seg.from <= bar + EPS) hit = seg;
  return hit;
}

/** The segments still to come after `bar` (launches waiting for their bar line). */
export const queuedAfter = (segments: readonly Segment[] | undefined, bar: number) => (segments ?? []).filter((s) => s.from > bar + EPS);

/** Copies of a slot's clip end to end on `trackId` from `from` up to `to` (the last one cut short). */
export function slotCopies(trackId: string, slot: SlotClip, from: number, to: number, key: string): Clip[] {
  const out: Clip[] = [];
  const end = Math.min(to, TOTAL_BARS + 1);
  const length = Math.max(1 / 16, slot.lengthBars);
  let k = 0;
  for (let at = from; at < end - EPS; at += length, k++) {
    out.push({
      ...slot,
      id: `launch:${trackId}:${key}:${k}`,
      trackId,
      startBar: at,
      lengthBars: Math.min(length, end - at),
      isSelected: false,
    });
  }
  return out;
}

/**
 * A track's clips that play from `from` up to `to`: the ones that start in it (cut at `to`), and
 * a note clip already going at `from` with only its notes from there on (an audio clip already
 * going isn't picked up part-way: it waits for the next clip).
 */
export function arrangementWindow(own: readonly Clip[], from: number, to: number): Clip[] {
  const out: Clip[] = [];
  for (const c of own) {
    const end = c.startBar + c.lengthBars;
    if (end <= from + EPS || c.startBar >= to - EPS) continue;
    let clip = c;
    if (c.startBar < from - EPS) {
      if (c.audio) continue;
      const skip = from - c.startBar;
      clip = { ...c, id: `${c.id}@${from}`, notes: c.notes.filter((n) => n.startOffset >= skip - EPS) };
    }
    if (end > to + EPS) clip = { ...clip, id: `${clip.id}|${to}`, lengthBars: to - clip.startBar };
    out.push(clip);
  }
  return out;
}

let memo: { tracks: readonly Track[]; clips: readonly Clip[]; segments: Record<string, Segment[]>; out: Clip[] } | null = null;

/** The arrangement with the launcher's segments applied (the same array while nothing changes). */
export function launcherClips(tracks: readonly Track[], clips: Clip[], segments: Record<string, Segment[]>): Clip[] {
  if (!launcherActive(segments)) return clips;
  if (memo && memo.tracks === tracks && memo.clips === clips && memo.segments === segments) return memo.out;
  const taken = new Set(Object.keys(segments));
  const out = clips.filter((c) => !taken.has(c.trackId));
  for (const track of tracks) {
    const segs = segments[track.id];
    if (!segs?.length) continue;
    const own = clips.filter((c) => c.trackId === track.id);
    // Before the first segment, the arrangement
    out.push(...arrangementWindow(own, -Infinity, segs[0].from));
    segs.forEach((seg, i) => {
      const to = segs[i + 1]?.from ?? TOTAL_BARS + 1;
      if (to <= seg.from + EPS) return;
      if (seg.kind === 'arr') out.push(...arrangementWindow(own, seg.from, to));
      else if (seg.kind === 'slot') {
        const slot = slotAt(track, seg.scene);
        if (slot) out.push(...slotCopies(track.id, slot.clip, seg.from, to, `${i}@${seg.from}`));
      }
    });
  }
  memo = { tracks, clips, segments, out };
  return out;
}
