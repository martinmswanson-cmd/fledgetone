import React, { useEffect, useRef } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { useAudioStore } from '../../store/audioStore';
import type { Track } from '../../store/timelineTypes';
import { liveTrackPeaks } from '../../audio/liveTracks';
import { UndoableRange } from '../UndoableRange';
import { Modal } from './Modal';

/**
 * Every track side by side as a mixing-desk strip: a level meter, a fader, pan, the reverb and
 * delay sends, mute and solo, and which inserts are on. The same settings as the track headers and
 * the Inspector, so a change here is a change there (and one undo step per drag).
 */

const vertical: React.CSSProperties = { writingMode: 'vertical-lr', direction: 'rtl' };
const db = (v: number) => (v <= -60 ? '-∞' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`);

/** A meter that reads the live peaks itself, each frame, without re-rendering the dialog. */
const Meter: React.FC<{ trackId: string | null }> = ({ trackId }) => {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let held = 0;
    const tick = () => {
      const peaks = trackId ? liveTrackPeaks() : null;
      const p = trackId ? peaks?.get(trackId) ?? 0 : 0;
      // Falls back at about 20 dB a second
      held = Math.max(p, held * 0.92);
      const dbfs = held > 0 ? 20 * Math.log10(held) : -90;
      const h = Math.max(0, Math.min(1, (dbfs + 60) / 60));
      if (bar.current) {
        bar.current.style.height = `${h * 100}%`;
        bar.current.style.background = dbfs > -1 ? '#ef4444' : dbfs > -9 ? '#f59e0b' : '#22c55e';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trackId]);
  return (
    <div className="relative w-2 h-36 rounded-sm bg-black/60 overflow-hidden" aria-hidden>
      <div ref={bar} className="absolute bottom-0 left-0 right-0" style={{ height: 0 }} />
    </div>
  );
};

const Strip: React.FC<{ track: Track }> = ({ track }) => {
  const s = useTimelineStore.getState();
  const inserts = (['human', 'distortion', 'compressor', 'chorus', 'lofi', 'filter', 'gate', 'pump'] as const).filter((k) => track.fx[k].on);
  return (
    <div className="flex flex-col items-center gap-2 w-24 shrink-0 rounded-lg border border-forge-border bg-forge-bg p-2" aria-label={`${track.name} channel`}>
      <div className="w-full h-1 rounded" style={{ background: track.color }} />
      <button
        type="button"
        onClick={() => {
          s.selectTrack(track.id);
          s.toggleInspector(true);
        }}
        className="w-full truncate text-[11px] font-semibold text-forge-text hover:text-cyan-300"
        title={`${track.name}: open in the Inspector`}
      >
        {track.name}
      </button>
      <div className="min-h-[28px] flex flex-wrap justify-center gap-0.5">
        {inserts.length ? inserts.map((k) => (
          <span key={k} className="px-1 rounded bg-cyan-500/15 text-[8px] font-mono uppercase text-cyan-200">{k.slice(0, 4)}</span>
        )) : <span className="text-[8px] font-mono text-forge-muted">no inserts</span>}
      </div>
      <label className="w-full flex flex-col gap-0.5 text-[9px] font-mono text-forge-muted">
        REV {Math.round(track.reverbSend * 100)}%
        <UndoableRange min={0} max={1} step={0.01} value={track.reverbSend} onValue={(v) => s.setTrackReverbSend(track.id, v)} resetValue={0} className="w-full h-1 accent-cyan-400" aria-label={`${track.name} reverb send`} />
      </label>
      <label className="w-full flex flex-col gap-0.5 text-[9px] font-mono text-forge-muted">
        DLY {Math.round(track.delaySend * 100)}%
        <UndoableRange min={0} max={1} step={0.01} value={track.delaySend} onValue={(v) => s.setTrackDelaySend(track.id, v)} resetValue={0} className="w-full h-1 accent-violet-400" aria-label={`${track.name} delay send`} />
      </label>
      <label className="w-full flex flex-col gap-0.5 text-[9px] font-mono text-forge-muted">
        PAN {track.pan === 0 ? 'C' : `${track.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(track.pan) * 100)}`}
        <UndoableRange min={-1} max={1} step={0.01} value={track.pan} onValue={(v) => s.setTrackPan(track.id, v)} resetValue={0} className="w-full h-1 accent-amber-400" aria-label={`${track.name} pan`} />
      </label>
      <div className="flex items-end gap-2">
        <Meter trackId={track.id} />
        <UndoableRange
          min={-60}
          max={6}
          step={0.5}
          value={track.volume}
          onValue={(v) => s.setTrackVolume(track.id, v)}
          resetValue={0}
          className="h-36 w-4 cursor-pointer"
          style={{ ...vertical, accentColor: track.color }}
          aria-label={`${track.name} volume`}
        />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-forge-text">{db(track.volume)} dB</span>
      <div className="flex gap-1">
        <button
          type="button"
          aria-pressed={track.isMuted}
          onClick={() => s.toggleMute(track.id)}
          className={`w-7 h-6 rounded text-[10px] font-bold border ${track.isMuted ? 'bg-amber-500/30 border-amber-400 text-amber-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
          title="Mute"
        >
          M
        </button>
        <button
          type="button"
          aria-pressed={track.isSoloed}
          onClick={() => s.toggleSolo(track.id)}
          className={`w-7 h-6 rounded text-[10px] font-bold border ${track.isSoloed ? 'bg-emerald-500/30 border-emerald-400 text-emerald-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
          title="Solo"
        >
          S
        </button>
      </div>
    </div>
  );
};

export const MixerDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const tracks = useTimelineStore((st) => st.tracks);
  const masterVolume = useAudioStore((st) => st.masterVolume);
  return (
    <Modal title="Mixer" onClose={onClose} wide>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {tracks.map((t) => (
          <Strip key={t.id} track={t} />
        ))}
        <div className="flex flex-col items-center gap-2 w-24 shrink-0 rounded-lg border border-cyan-500/50 bg-cyan-950/20 p-2" aria-label="Master channel">
          <div className="w-full h-1 rounded bg-cyan-400" />
          <span className="text-[11px] font-bold text-cyan-200">MASTER</span>
          <div className="flex-1" />
          <UndoableRange
            min={-40}
            max={6}
            step={0.5}
            value={masterVolume}
            onValue={(v) => useAudioStore.getState().setMasterVolume(v)}
            resetValue={0}
            undoable={false}
            className="h-36 w-4 cursor-pointer accent-cyan-400"
            style={vertical}
            aria-label="Master volume"
          />
          <span className="text-[10px] font-mono tabular-nums text-forge-text">{db(masterVolume)} dB</span>
        </div>
      </div>
      <p className="text-[11px]">Double-click a fader or knob to reset it. Each drag is one undo step. Click a track's name to open it in the Inspector (inserts, EQ, automation).</p>
    </Modal>
  );
};
