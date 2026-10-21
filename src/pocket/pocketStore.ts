/**
 * Pocket's own view state, apart from the song (useTimelineStore): which track and section are
 * selected (the drawer edits that cell), which of its tools the drawer shows and how tall it is,
 * the mixer, Rec, the open sheet and the key the note editors use. Plus the helpers its screens
 * share: which editor a track opens in, and the playhead while playing.
 */
import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { INSTRUMENTS, isAudioKind } from '../audio/instrumentCatalog';
import { getAudiblePositionBar } from '../audio/transport';
import { useTimelineStore } from '../store/timelineStore';
import type { InstrumentKey } from '../store/timelineTypes';
import type { SongKey } from '../store/songKey';

/** The drawer's tools: play the instrument, draw its notes, change its sound, its mix; or sing (vocal tracks). */
export type PocketTool = 'play' | 'draw' | 'sound' | 'mix' | 'sing';
export type DrawerSize = 'low' | 'mid' | 'high';
export type PocketSheet = 'song' | 'share' | 'add' | 'section' | 'chords' | 'drummer' | 'fill' | 'versions' | null;

interface PocketState {
  /** The selected track (the drawer is its instrument), and the section, by its place in the song */
  trackId: string | null;
  section: number;
  tool: PocketTool;
  drawer: DrawerSize;
  /** The size the drawer had before the piano roll opened it full (put back when it closes) */
  sizeBeforeRoll: DrawerSize | null;
  /** The drawer shows the mixer for every track */
  mixAll: boolean;
  /** Pads and keys played while the song plays are written in */
  rec: boolean;
  /** Bumped to ask the vocal recorder to start or stop (the transport's Rec on a vocal track) */
  singRequest: number;
  sheet: PocketSheet;
  /** The section a section sheet is about */
  sheetSection: number;
  /** The key the note editors follow (null: the song's, as detected) */
  key: SongKey | null;
  /** Whether the starters screen is open (on top of the song) */
  starting: boolean;
  set: (patch: Partial<Omit<PocketState, 'set'>>) => void;
}

export const usePocket = create<PocketState>((set) => ({
  trackId: null,
  section: 0,
  tool: 'play',
  drawer: 'mid',
  sizeBeforeRoll: null,
  mixAll: false,
  rec: false,
  singRequest: 0,
  sheet: null,
  sheetSection: 0,
  key: null,
  starting: false,
  set: (patch) => set(patch),
}));

/** Which drawer a track's cells open in: drums, notes, vocals (recordings), or null (edited on a computer: samplers, plugins). */
export function editorOf(key: InstrumentKey): 'beat' | 'notes' | 'vocals' | null {
  if (isAudioKind(key)) return 'vocals';
  const kind = INSTRUMENTS[key]?.kind;
  if (kind === 'drums') return 'beat';
  if (kind === undefined || ['custom', 'rack', 'multi', 'slicer', 'audio', 'plugin', 'return', 'bus', 'fx'].includes(kind)) return null;
  return 'notes';
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
