/**
 * Pocket: Fledgetone on a phone, on one screen, after the studio: the song as a grid at the top
 * (its sections and tracks: PocketGrid), the transport, and a drawer at the bottom that becomes the
 * selected track's instrument (PocketDrawer). Turning the phone turns the grid into the studio's
 * timeline, with the drawer beside it. What's done now and then opens over it (PocketSheets).
 * It connects the song to the engine and the autosave as the studio's timeline does, so a song
 * started here opens on a computer and back.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Disc3, Pause, Play, Redo2, Share2, Undo2 } from 'lucide-react';
import { connectAutosave, connectTimelineToAudio, currentProject, useTimelineStore } from '../store/timelineStore';
import { recoverFailedDownloads } from '../audio/liveTracks';
import { installLiveInput } from '../audio/liveInput';
import { hasWork } from '../store/project';
import { reopenLastSong, useWakeWhilePlaying, buzz } from './pocketSession';
import { PocketNotice } from './PocketNotice';
import { SharedLinkOpener } from '../components/SharedLinkOpener';
import { UpdateNotice } from '../components/UpdateNotice';
import { Toast } from '../components/timeline/Toast';
import { showToast } from '../components/timeline/toastStore';
import { editorOf, usePlayPosition, usePocket } from './pocketStore';
import { useSelection } from './pocketCell';
import { PocketGrid } from './PocketGrid';
import { DRAWER_SIZES, PocketDrawer, setTool } from './PocketDrawer';
import { PocketSheets, StartScreen } from './PocketSheets';
import { startErrorLog } from '../support/problemReport';
import './pocket.css';

const EPS = 1e-6;

/** A phone on its side (a laptop's wide window isn't one). */
function useLandscape(): boolean {
  const query = '(orientation: landscape) and (max-height: 520px)';
  const [land, setLand] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setLand(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return land;
}

/** The song's name, tempo and key, and where it's playing (tap: the song's settings); Share. */
const TopBar: React.FC = () => {
  const name = useTimelineStore((s) => s.projectName);
  const bpm = useTimelineStore((s) => s.bpm);
  const { sections } = useSelection();
  const bar = usePlayPosition();
  const at = sections.find((x) => bar >= x.from - EPS && bar < x.to - EPS);
  const beat = Math.floor(((bar % 1) + 1) % 1 * 4) + 1;
  const open = (sheet: 'song' | 'share') => usePocket.getState().set({ sheet });
  return (
    <header className="pk-top shrink-0 flex items-center gap-2.5 px-[var(--gx)] pt-[max(8px,env(safe-area-inset-top))] pb-2 border-b border-forge-border">
      <button type="button" aria-label="Your songs: a new one, or a starter" className="w-11 h-11 rounded-[14px] border border-forge-border bg-forge-panel grid place-items-center shrink-0" onClick={() => usePocket.getState().set({ starting: true })}>
        <Disc3 className="w-5 h-5" />
      </button>
      <button type="button" className="flex-1 min-w-0 text-left" aria-label="The song: name, tempo, key" onClick={() => open('song')}>
        <div className="font-semibold text-[17px] truncate">{name}</div>
        <div className="font-mono text-[11px] text-forge-muted flex gap-2 tracking-wide">
          <span>{Math.round(bpm)} BPM</span>
          <span className="text-cyan-300 tabular-nums">
            {at?.letter ?? '–'} · {Math.max(1, Math.floor(bar - (at?.from ?? 1)) + 1)}.{beat}
          </span>
        </div>
      </button>
      <button type="button" aria-label="Share" className="w-11 h-11 rounded-[14px] border border-forge-border bg-forge-panel grid place-items-center shrink-0" onClick={() => open('share')}>
        <Share2 className="w-5 h-5" />
      </button>
    </header>
  );
};

/** Undo, Rec (for the selected track), Play (the loop or the song, as it says) and Redo. */
const Transport: React.FC = () => {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const loop = useTimelineStore((s) => s.loopRegion);
  const canUndo = useTimelineStore((s) => s.past.length > 0);
  const canRedo = useTimelineStore((s) => s.future.length > 0);
  const rec = usePocket((p) => p.rec);
  const { track, sec } = useSelection();
  const s = useTimelineStore.getState;
  const vocal = track && editorOf(track.instrumentKey) === 'vocals';
  const btn = 'h-12 rounded-[14px] border border-forge-border bg-forge-panelLight flex items-center justify-center active:scale-95 transition-transform disabled:opacity-35';
  const play = () => {
    buzz();
    const st = s();
    if (st.isPlaying) return st.pause();
    if (st.loopRegion.enabled) {
      // The loop is the selected section
      if (sec && (Math.abs(st.loopRegion.inBar - sec.from) > EPS || Math.abs(st.loopRegion.outBar - sec.to) > EPS)) st.setLoopRange(sec.from, sec.to);
      if (sec && (st.playheadPosition < sec.from - EPS || st.playheadPosition >= sec.to - EPS)) st.seek(sec.from);
    } else if (st.playheadPosition >= songEndBar() - EPS) st.seek(1);
    void st.play();
  };
  return (
    <div className="pk-tport">
      <button type="button" aria-label="Undo" className={btn} disabled={!canUndo} onClick={() => s().undo()}>
        <Undo2 className="w-5 h-5" />
      </button>
      <button
        type="button"
        aria-pressed={rec}
        className={`${btn} px-3 gap-1.5 text-[12.5px] font-medium max-w-[38vw] ${rec ? '!border-red-400 !bg-red-500/20 text-red-100' : ''}`}
        disabled={!track || editorOf(track.instrumentKey) === null}
        onClick={() => {
          buzz();
          if (!track) return;
          if (vocal) {
            const p = usePocket.getState();
            p.set({ mixAll: false, singRequest: p.singRequest + 1 });
            setTool('sing', track, document.querySelector('.pk-app.land') !== null);
            return;
          }
          const on = !usePocket.getState().rec;
          usePocket.getState().set({ rec: on, ...(on ? { mixAll: false } : {}) });
          if (on) setTool('play', track, document.querySelector('.pk-app.land') !== null);
          if (on && !s().isPlaying) play();
          showToast(on ? `Recording ${track.name}: what you play lands in ${sec?.letter}, in time` : 'Rec off');
        }}
      >
        <span className="w-3.5 h-3.5 rounded-full bg-red-500 shrink-0" />
        <span className="pk-rec-label truncate">Rec {track ? (vocal ? 'vocal' : track.name.toLowerCase()) : ''}</span>
      </button>
      <button type="button" aria-label={isPlaying ? 'Stop' : loop.enabled ? 'Play the loop' : 'Play the song'} className={`${btn} !h-[52px] gap-2 !bg-cyan-500 !border-cyan-300 text-black font-semibold shadow-[0_0_20px_rgba(6,182,212,.3)]`} onClick={play}>
        {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current" />}
        <span className="whitespace-nowrap">{loop.enabled ? `Loop ${sec?.letter ?? ''}` : 'Song'}</span>
      </button>
      <button type="button" aria-label="Redo" className={btn} disabled={!canRedo} onClick={() => s().redo()}>
        <Redo2 className="w-5 h-5" />
      </button>
    </div>
  );
};

/** Where the song ends (bars), for playing it from the top when it's already there. */
function songEndBar(): number {
  return useTimelineStore.getState().clips.reduce((e, c) => Math.max(e, c.startBar + c.lengthBars), 1);
}

export const PocketApp: React.FC = () => {
  const land = useLandscape();
  const drawer = usePocket((p) => p.drawer);
  const starting = usePocket((p) => p.starting);
  const app = useRef<HTMLDivElement>(null);
  useEffect(() => connectTimelineToAudio(), []);
  useEffect(() => connectAutosave(), []);
  useEffect(() => recoverFailedDownloads(), []);
  // The metronome (and a MIDI keyboard plugged into the phone)
  useEffect(() => installLiveInput(), []);
  // The last song opens again by itself; with none, the starters. The loop on, on the first
  // section: Pocket plays a section until Song is chosen. (Once, before the first render)
  useState(() => {
    reopenLastSong();
    if (!hasWork(currentProject())) usePocket.getState().set({ starting: true });
    const s = useTimelineStore.getState();
    if (!s.loopRegion.enabled && hasWork(currentProject())) s.toggleLoop();
    return true;
  });
  useWakeWhilePlaying();
  useEffect(() => {
    document.title = 'Fledgetone Pocket';
  }, []);
  // Rec goes off when the song stops
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  useEffect(() => {
    if (!isPlaying && usePocket.getState().rec) usePocket.getState().set({ rec: false });
  }, [isPlaying]);
  return (
    <div ref={app} className={`pk-app font-sans select-none ${land ? 'land' : ''}`} style={{ ['--dh' as string]: `${Math.round(DRAWER_SIZES[drawer] * 100)}%` }}>
      <TopBar />
      <PocketGrid land={land} />
      <Transport />
      <PocketDrawer land={land} appRef={app} />
      <SharedLinkOpener />
      <UpdateNotice />
      <PocketNotice />
      <PocketSheets />
      {starting && <StartScreen canGoBack={hasWork(currentProject())} />}
      <Toast top />
    </div>
  );
};

export default PocketApp;

startErrorLog();
