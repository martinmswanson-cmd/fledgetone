/**
 * Kick and 808 clashes: where the kick drum and a bass's notes hit at the same moment, the bass's
 * low end piles onto the kick's and hides its punch. This finds those hits for one bass track (for
 * the warning in the 808 designer), and gives the one-click fix: the track's Pump set to duck the
 * bass under every kick, the standard sidechain trick. Pure, so Node tests it.
 */
import type { Clip, Track, TrackFx } from './timelineTypes';
import { durationToBars } from './timelineTypes';
import { isDrumKind } from '../audio/instrumentCatalog';
import { midiOf } from './noteTools';

/** The kick on the drum kits' note map (as the Pump follows it). */
const KICK_NOTE = 'C1';
/** Hits closer than this (bars: a 96th of a bar, about 18 ms at 140 BPM) count as together. */
const TOGETHER = 1 / 96;
/** Notes at or below A2 (110 Hz) sit in the kick's range and mask it. */
const LOW_MIDI = 45;

export interface KickClash {
  /** Kicks that play (on drum kits that aren't muted) */
  kicks: number;
  /** Kicks that land on the start of a low bass note: the clash */
  together: number;
  /** Kicks that land while a low bass note rings on from before (softer masking) */
  under: number;
  /** The bass track already ducks under the kick (its Pump follows the kick) */
  ducked: boolean;
}

/** Where every note of `clips` on `trackIds` plays, in bars, with its length and pitch. */
function hits(clips: readonly Clip[], trackIds: ReadonlySet<string>, only?: string) {
  const out: Array<{ at: number; end: number; midi: number }> = [];
  for (const c of clips) {
    if (!trackIds.has(c.trackId) || c.audio) continue;
    for (const n of c.notes) {
      if (n.startOffset >= c.lengthBars || (only && n.note !== only)) continue;
      const at = c.startBar + n.startOffset;
      out.push({ at, end: at + Math.min(durationToBars(n.duration) || 0, c.lengthBars - n.startOffset), midi: midiOf(n.note) });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** How the kicks of the song's drum kits line up with bass track `bassId`'s notes. */
export function findKickClash(tracks: readonly Track[], clips: readonly Clip[], bassId: string): KickClash {
  const bass = tracks.find((t) => t.id === bassId);
  const drums = new Set(tracks.filter((t) => isDrumKind(t.instrumentKey) && !t.isMuted).map((t) => t.id));
  const kicks = hits(clips, drums, KICK_NOTE);
  const notes = hits(clips, new Set([bassId]))
    .filter((n) => Number.isFinite(n.midi) && n.midi <= LOW_MIDI);
  let together = 0;
  let under = 0;
  for (const k of kicks) {
    if (notes.some((n) => Math.abs(n.at - k.at) < TOGETHER)) together++;
    else if (notes.some((n) => n.at < k.at && n.end > k.at)) under++;
  }
  const pump = bass?.fx.pump;
  return { kicks: kicks.length, together, under, ducked: !!pump?.on && pump.trigger === 'kick' };
}

/** The Pump settings that duck a bass under the kick: deep and quick, back before the next 16th. */
export const KICK_DUCK: Partial<TrackFx['pump']> = { on: true, trigger: 'kick', depth: 0.8, release: 150 };
