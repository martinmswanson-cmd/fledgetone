/**
 * Pocket's own view state (which tab is open, which track and clip each editor shows, the key the
 * note grid uses), apart from the song (useTimelineStore), plus the helpers its screens share:
 * which tracks Pocket can edit and how, a track's clips in order, and the playhead while playing.
 */
import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { getAudiblePositionBar } from '../audio/transport';
import { useTimelineStore } from '../store/timelineStore';
import type { Clip, InstrumentKey, Track } from '../store/timelineTypes';
import type { SongKey } from '../store/songKey';

export type PocketTab = 'song' | 'beat' | 'notes' | 'mix' | 'share';

interface PocketState {
  tab: PocketTab;
  /** The drum track the Beat tab shows, and the clip it edits */
  beatTrackId: string | null;
  beatClipId: string | null;
  /** The pitched track the Notes tab shows, and the clip it edits */
  noteTrackId: string | null;
  noteClipId: string | null;
  /** The key the note grid's rows follow (null: the song's, as detected) */
  key: SongKey | null;
  setTab: (tab: PocketTab) => void;
  /** Open a clip in the editor its track uses (Beat for drums, Notes for the rest). */
  openClip: (clip: Clip, track: Track) => void;
  set: (patch: Partial<Omit<PocketState, 'setTab' | 'openClip' | 'set'>>) => void;
}

export const usePocket = create<PocketState>((set) => ({
  tab: 'song',
  beatTrackId: null,
  beatClipId: null,
  noteTrackId: null,
  noteClipId: null,
  key: null,
  setTab: (tab) => set({ tab }),
  openClip: (clip, track) => {
    const how = editorOf(track.instrumentKey);
    if (how === 'beat') set({ tab: 'beat', beatTrackId: track.id, beatClipId: clip.id });
    else if (how === 'notes') set({ tab: 'notes', noteTrackId: track.id, noteClipId: clip.id });
  },
  set: (patch) => set(patch),
}));

/** Which Pocket editor a track's clips open in, or null (edited on a computer: samplers, audio, plugins, buses). */
export function editorOf(key: InstrumentKey): 'beat' | 'notes' | null {
  const kind = INSTRUMENTS[key]?.kind;
  if (kind === 'drums') return 'beat';
  if (kind === undefined || ['custom', 'rack', 'multi', 'slicer', 'audio', 'plugin', 'return', 'bus', 'fx'].includes(kind)) return null;
  return 'notes';
}

/** A track's clips, earliest first (audio clips left out). */
export const clipsOf = (clips: readonly Clip[], trackId: string | null): Clip[] =>
  clips.filter((c) => c.trackId === trackId && !c.audio).sort((a, b) => a.startBar - b.startBar);

/** The clip to show for a track: the one asked for if it's still there, else the one under the playhead, else the first. */
export function pickClip(clips: readonly Clip[], wanted: string | null, playhead: number): Clip | null {
  return clips.find((c) => c.id === wanted) ?? clips.find((c) => playhead >= c.startBar && playhead < c.startBar + c.lengthBars) ?? clips[0] ?? null;
}

let idCount = 0;
/** A new note id. */
export const pocketNoteId = (): string => `pk${Date.now().toString(36)}${(idCount++).toString(36)}`;

/** Where the song is (bars, 1-based): moving while it plays, the playhead while stopped. */
export function usePlayPosition(): number {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const [live, setLive] = useState(playhead);
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      setLive(getAudiblePositionBar());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);
  return isPlaying ? live : playhead;
}
