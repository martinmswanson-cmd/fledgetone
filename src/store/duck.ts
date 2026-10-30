import type { AutomationPoint, Clip, Track } from './timelineTypes';
import { durationToBars } from './timelineTypes';

/**
 * Ducking under a proxy track: mark a track as the game's dialogue or sound effects (a "proxy":
 * its clips stand in for what the game will play) and every other track dips wherever it sounds,
 * the way video editors duck music under a voiceover. The dip starts a moment before the proxy
 * does (look-ahead, so the first syllable isn't masked), holds while it sounds, and comes back
 * after; short gaps are bridged. The result is a gain curve (1 = full level) the engine plays on
 * every other track, live and in exports, and it follows the proxy's clips as you edit them. No
 * audio or store here, so Node can unit-test it.
 */

export const DUCK_LOOKAHEAD = 0.12;
export const DUCK_RELEASE = 0.4;
/** Gaps shorter than this (seconds) don't let the music back up */
export const DUCK_BRIDGE = 0.35;

/** Where the proxy tracks sound, in bars: each note (its whole length, as the scheduler plays it), and each audio clip, merged. */
export function proxySpans(tracks: readonly Track[], clips: readonly Clip[], bpm: number): Array<{ from: number; to: number }> {
  const proxies = new Set(tracks.filter((t) => t.duckProxy && !t.isMuted).map((t) => t.id));
  if (!proxies.size) return [];
  const spans: Array<{ from: number; to: number }> = [];
  for (const c of clips) {
    if (!proxies.has(c.trackId)) continue;
    const end = c.startBar + c.lengthBars;
    if (c.audio) {
      spans.push({ from: c.startBar, to: end });
      continue;
    }
    for (const n of c.notes) {
      if (n.startOffset < 0 || n.startOffset >= c.lengthBars) continue;
      const from = c.startBar + n.startOffset;
      // (its whole length, past its clip's end too, as it plays)
      spans.push({ from, to: from + durationToBars(n.duration) });
    }
  }
  spans.sort((a, b) => a.from - b.from);
  const bridge = (DUCK_BRIDGE * bpm) / 240;
  const merged: Array<{ from: number; to: number }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.from - last.to < bridge) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  return merged;
}

/** The deepest dip any proxy asks for, in dB (0 with none). */
export const duckDepth = (tracks: readonly Track[]) => tracks.reduce((d, t) => (t.duckProxy && !t.isMuted ? Math.max(d, t.duckProxy.depth) : d), 0);

/** The gain curve the other tracks play (null: nothing to duck under). */
export function duckPoints(tracks: readonly Track[], clips: readonly Clip[], bpm: number): AutomationPoint[] | null {
  const spans = proxySpans(tracks, clips, bpm);
  const depth = duckDepth(tracks);
  if (!spans.length || depth <= 0) return null;
  const low = 10 ** (-depth / 20);
  const ahead = (DUCK_LOOKAHEAD * bpm) / 240;
  const back = (DUCK_RELEASE * bpm) / 240;
  const points: AutomationPoint[] = [];
  let lastEnd = -Infinity;
  for (const s of spans) {
    const a = Math.max(1, s.from - ahead);
    // A dip that starts before the last one has come back up joins it
    if (a > lastEnd) points.push({ bar: a, value: 1 });
    else points.pop();
    points.push({ bar: Math.max(a, s.from), value: low }, { bar: s.to, value: low }, { bar: s.to + back, value: 1 });
    lastEnd = s.to + back;
  }
  return points;
}
