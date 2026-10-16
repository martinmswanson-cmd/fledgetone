/**
 * Pocket: Fledgetone on a phone. A simpler interface over the same engine and song as the studio
 * (see pocketMode.ts for which one opens): the transport across the top, one screen at a time
 * below it (Song, Beat, Notes, Vocals, Mix, Share), and the tabs along the bottom within reach of a thumb.
 * It connects the song to the engine and the autosave as the studio's timeline does, so a song
 * started here opens on a computer and back.
 */
import React, { useEffect } from 'react';
import { Disc3, Drum, Mic, Music, Pause, Play, Repeat, Share2, SlidersHorizontal, Square, Timer, Undo2, Redo2 } from 'lucide-react';
import { connectAutosave, connectTimelineToAudio, useTimelineStore } from '../store/timelineStore';
import { recoverFailedDownloads } from '../audio/liveTracks';
import { installLiveInput } from '../audio/liveInput';
import { reopenLastSong, useWakeWhilePlaying } from './pocketSession';
import { PocketVocals } from './PocketVocals';
import { SharedLinkOpener } from '../components/SharedLinkOpener';
import { UpdateNotice } from '../components/UpdateNotice';
import { Toast } from '../components/timeline/Toast';
import { usePlayPosition, usePocket, type PocketTab } from './pocketStore';
import { PocketSong } from './PocketSong';
import { PocketBeat } from './PocketBeat';
import { PocketNotes } from './PocketNotes';
import { PocketMix } from './PocketMix';
import { PocketShare } from './PocketShare';
import { startErrorLog } from '../support/problemReport';

const TABS: Array<{ id: PocketTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'song', label: 'Song', icon: Disc3 },
  { id: 'beat', label: 'Beat', icon: Drum },
  { id: 'notes', label: 'Notes', icon: Music },
  { id: 'vocals', label: 'Vocals', icon: Mic },
  { id: 'mix', label: 'Mix', icon: SlidersHorizontal },
  { id: 'share', label: 'Share', icon: Share2 },
];

/** Play, stop, the loop, the metronome, where the song is, the tempo, and undo. */
const Transport: React.FC = () => {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const bpm = useTimelineStore((s) => s.bpm);
  const loop = useTimelineStore((s) => s.loopRegion);
  const canUndo = useTimelineStore((s) => s.past.length > 0);
  const canRedo = useTimelineStore((s) => s.future.length > 0);
  const click = useTimelineStore((s) => s.recordOptions.metronome);
  const bar = usePlayPosition();
  const s = useTimelineStore.getState;
  const btn = 'h-11 min-w-10 px-1.5 rounded-xl flex items-center justify-center border border-forge-border bg-forge-panel active:scale-95 transition-transform disabled:opacity-35';
  return (
    <header className="sticky top-0 z-30 bg-forge-bg/95 backdrop-blur border-b border-forge-border px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
      <div className="flex items-center gap-2">
        <button type="button" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={() => void s().togglePlay()} className={`${btn} !w-14 !bg-cyan-500 !border-cyan-400 text-black`}>
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
        </button>
        <button type="button" aria-label="Stop and go back to the start" onClick={() => s().stop()} className={btn}>
          <Square className="w-5 h-5" />
        </button>
        <button
          type="button"
          aria-label="Loop"
          aria-pressed={loop.enabled}
          onClick={() => s().toggleLoop()}
          className={`${btn} ${loop.enabled ? '!border-amber-400 text-amber-300' : 'text-forge-muted'}`}
        >
          <Repeat className="w-5 h-5" />
        </button>
        <button
          type="button"
          aria-label="Metronome"
          aria-pressed={click}
          onClick={() => s().setRecordOptions({ metronome: !click })}
          className={`${btn} ${click ? '!border-cyan-400 text-cyan-300' : 'text-forge-muted'}`}
        >
          <Timer className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0 text-center font-mono leading-tight">
          <div className="text-lg text-forge-text tabular-nums">{Math.max(1, Math.floor(bar))}.{Math.floor(((bar % 1) + 1) % 1 * 4) + 1}</div>
          <div className="text-[11px] text-forge-muted">{Math.round(bpm)} BPM</div>
        </div>
        <button type="button" aria-label="Undo" disabled={!canUndo} onClick={() => s().undo()} className={btn}>
          <Undo2 className="w-5 h-5" />
        </button>
        <button type="button" aria-label="Redo" disabled={!canRedo} onClick={() => s().redo()} className={btn}>
          <Redo2 className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
};

export const PocketApp: React.FC = () => {
  const tab = usePocket((p) => p.tab);
  useEffect(() => connectTimelineToAudio(), []);
  useEffect(() => connectAutosave(), []);
  useEffect(() => recoverFailedDownloads(), []);
  // The metronome (and a MIDI keyboard plugged into the phone)
  useEffect(() => installLiveInput(), []);
  useEffect(() => {
    reopenLastSong();
  }, []);
  useWakeWhilePlaying();
  useEffect(() => {
    document.title = 'Fledgetone Pocket';
  }, []);
  return (
    <div className="min-h-[100dvh] bg-forge-bg text-forge-text font-sans flex flex-col select-none">
      <Transport />
      <SharedLinkOpener />
      <UpdateNotice />
      <main className="flex-1 px-3 pt-3 pb-24">
        {tab === 'song' && <PocketSong />}
        {tab === 'beat' && <PocketBeat />}
        {tab === 'notes' && <PocketNotes />}
        {tab === 'vocals' && <PocketVocals />}
        {tab === 'mix' && <PocketMix />}
        {tab === 'share' && <PocketShare />}
      </main>
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-forge-panel/95 backdrop-blur border-t border-forge-border grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => usePocket.getState().setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`h-16 flex flex-col items-center justify-center gap-1 text-[10px] ${tab === id ? 'text-cyan-300' : 'text-forge-muted'}`}
          >
            <Icon className="w-6 h-6" />
            {label}
          </button>
        ))}
      </nav>
      <Toast />
    </div>
  );
};

export default PocketApp;

startErrorLog();
