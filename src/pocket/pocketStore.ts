/**
 * Pocket's own view state, apart from the song (useTimelineStore): which track and section are
 * selected (the drawer edits that cell), which of its tools the drawer shows and how tall it is,
 * the mixer, Rec, the open sheet and the key the note editors use. Plus the helpers its screens
 * share: which editor a track opens in, the playhead while playing, and the drummer style each cell
 * was last written in (the dice roll in it).
 */
import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { INSTRUMENTS, isAudioKind } from '../audio/instrumentCatalog';
import { FLEDGE_PRESETS, FLEDGE_START_PRESET, FLEDGE_URL, isFledgeUrl } from '../audio/plugins/fledgeMacros';
import { getAudiblePositionBar } from '../audio/transport';
import { useTimelineStore } from '../store/timelineStore';
import type { InstrumentKey } from '../store/timelineTypes';
import type { DrumStyle } from '../store/smartTools';
import type { MySound } from '../store/mySounds';
import type { SongKey } from '../store/songKey';

/** The drawer's tools: play the instrument, draw its notes, change its sound, its mix; or sing (vocal tracks). */
export type PocketTool = 'play' | 'draw' | 'sound' | 'mix' | 'sing';
export type DrawerSize = 'low' | 'mid' | 'high';
export type PocketSheet = 'song' | 'share' | 'add' | 'section' | 'chords' | 'drummer' | 'fill' | 'versions' | 'feel' | null;

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
  /** The pad a Drum Rack track's Pads tool shows */
  rackPad: number;
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
  rackPad: 0,
  set: (patch) => set(patch),
}));

/**
 * Which drawer a track's cells open in: drums (a kit, or a Drum Rack's pads), notes, vocals
 * (recordings), the Drop pad, or null (edited on a computer: samplers, plugins). Fledge Synth, the
 * app's own synth, is a plugin played with notes, with its own Sound tool (PocketSynth.tsx):
 * `plugin` is the track's.
 */
export function editorOf(key: InstrumentKey, plugin?: { url: string }): 'beat' | 'notes' | 'vocals' | 'drop' | null {
  if (isAudioKind(key)) return 'vocals';
  const kind = INSTRUMENTS[key]?.kind;
  if (kind === 'drums' || kind === 'rack') return 'beat';
  if (kind === 'drop') return 'drop';
  if (kind === 'plugin' && isFledgeUrl(plugin?.url)) return 'notes';
  if (kind === undefined || ['custom', 'multi', 'slicer', 'audio', 'plugin', 'return', 'bus', 'fx'].includes(kind)) return null;
  return 'notes';
}

/** Whether a track plays a Drum Rack (its pads are its own sounds, see PocketRack.tsx). */
export const isRackKey = (key: InstrumentKey): boolean => INSTRUMENTS[key]?.kind === 'rack';

/** How a new Fledge Synth starts in Pocket: on its first bass preset. */
export const FLEDGE_START_STATE = { builtin: 1, program: FLEDGE_PRESETS.indexOf(FLEDGE_START_PRESET) };

/** Make a track play Fledge Synth (keeping its notes), or add one as a new track. Returns the track's id. */
export function playFledge(trackId: string | null): string {
  const s = useTimelineStore.getState();
  if (trackId) {
    s.setTrackPlugin(trackId, FLEDGE_URL, 'Fledge Synth', FLEDGE_START_STATE);
    return trackId;
  }
  return s.addPluginTrack(FLEDGE_URL, 'Fledge Synth', FLEDGE_START_STATE);
}

/** What a saved sound plays, by name ("Fledge Synth" for a plugin's sound, not "Plugin"). */
export const soundInstrumentName = (s: MySound): string => (s.settings.instrumentKey === 'plugin' && s.settings.plugin ? s.settings.plugin.name : INSTRUMENTS[s.settings.instrumentKey].name);

let idCount = 0;
/** A new note id. */
/** The drummer style each cell was last written in (`track@section start`), for the dice to roll in. */
export const cellDrumStyles = new Map<string, DrumStyle>();
export const cellKey = (trackId: string, from: number): string => `${trackId}@${from}`;

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
