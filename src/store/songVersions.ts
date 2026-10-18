/**
 * Versions of a song for videos, streams and podcasts: the same mix with some parts left out.
 * - Underscore: without the lead melody (and any voices), to sit under someone talking.
 * - No drums: without the drums and percussion, for a calmer moment.
 * The lead: the parts named "lead", else the loudest part playing one line at a time (the melody
 * is what a mix puts on top), its pitch breaking near ties; an arpeggio, a pad, chords or stabs
 * never count, so a song without a tune has no underscore. Only parts you hear count: a muted
 * track stays muted in every version. Plain data in and out, so Node can test it; the export
 * renders each version.
 */
import { trackRole } from '../audio/mixCheck';
import { audibleIds, isMixTrack } from './buses';
import { isEffect } from './glueMix';
import { midiOf } from './noteTools';
import type { Clip, Track } from './timelineTypes';

export type SongVersion = 'full' | 'underscore' | 'noDrums';

export const VERSION_LABELS: Record<SongVersion, string> = { full: 'Full', underscore: 'Underscore', noDrums: 'No drums' };

/** Parts that accompany, whatever they play */
const BACKING = /\b(arp|arps|arpeggio|pad|pads|chords?|stabs?|atmos|fx|drone|keys comp)\b/i;

function leadOf(parts: Track[], clips: readonly Clip[]): Set<string> {
  const named = parts.filter((t) => /\blead\b/i.test(t.name));
  if (named.length) return new Set(named.map((t) => t.id));
  let best: { id: string; score: number } | undefined;
  for (const t of parts) {
    if (BACKING.test(t.name)) continue;
    const notes = clips.filter((c) => c.trackId === t.id && !c.audio).flatMap((c) => c.notes);
    if (notes.length < 8) continue;
    // One line at a time: few notes start together
    const starts = new Map<string, number>();
    for (const c of clips) if (c.trackId === t.id) for (const n of c.notes) starts.set(`${c.startBar + n.startOffset}`, (starts.get(`${c.startBar + n.startOffset}`) ?? 0) + 1);
    if ([...starts.values()].filter((v) => v > 1).length >= notes.length * 0.15) continue;
    const midis = notes.map((n) => midiOf(n.note)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!midis.length) continue;
    // Loudness first; a fifth higher is worth about a dB
    const score = t.volume + (midis[Math.floor(midis.length / 2)] - 60) / 7;
    if (!best || score > best.score) best = { id: t.id, score };
  }
  return new Set(best ? [best.id] : []);
}

/** What each version leaves out: the tracks (empty: the version can't be made from this song). */
export function versionLeavesOut(tracks: Track[], clips: readonly Clip[]): Record<Exclude<SongVersion, 'full'>, Track[]> {
  const heard = audibleIds(tracks);
  const withNotes = new Set(clips.map((c) => c.trackId));
  const parts = tracks.filter((t) => heard.has(t.id) && withNotes.has(t.id) && !isMixTrack(t) && !isEffect(t));
  const role = new Map(parts.map((t) => [t.id, trackRole(t, clips)]));
  const leads = leadOf(
    parts.filter((t) => role.get(t.id) === 'music'),
    clips
  );
  return {
    underscore: parts.filter((t) => leads.has(t.id) || role.get(t.id) === 'vocal'),
    noDrums: parts.filter((t) => role.get(t.id) === 'drums'),
  };
}

/** The tracks for a version: the parts it leaves out muted. Null: this song has nothing to leave out for it. */
export function versionTracks(tracks: Track[], clips: readonly Clip[], version: SongVersion): Track[] | null {
  if (version === 'full') return tracks;
  const out = new Set(versionLeavesOut(tracks, clips)[version].map((t) => t.id));
  if (!out.size) return null;
  return tracks.map((t) => (out.has(t.id) ? { ...t, isMuted: true } : t));
}
