/**
 * The header's small "level-matched" mark: shown while listening is level-matched (monitor.ts),
 * with how far the listening gain is turning the song up or down. A click opens the Master tab's
 * Playback settings, where it can be switched off. Where the listening path couldn't start (no
 * AudioWorklet, as on a plain-http address) a plain warning instead: nothing is matched or limited.
 */
import React from 'react';
import { Ear } from 'lucide-react';
import { useListening } from './useListening';
import { useUiStore } from '../store/uiStore';
import { useTimelineStore } from '../store/timelineStore';

export const ListeningBadge: React.FC = () => {
  const { reading, matched, wanted, status } = useListening();
  const openPlayback = () => {
    useTimelineStore.getState().toggleInspector(true);
    useUiStore.getState().setInspectorTab('master');
  };
  if (status === 'off')
    return (
      <button
        type="button"
        onClick={openPlayback}
        className="flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-mono border border-amber-400/60 bg-forge-bg text-amber-200"
        title="This browser couldn't start level matching and the safety limiter (it needs a secure https address or localhost). You hear the master as it is: keep the volume down. The Loud master's push isn't heard here; exports aren't changed."
        aria-label="Not level-matched: keep the volume down"
        data-testid="listening-warning"
      >
        <Ear className="w-3.5 h-3.5 text-amber-400" />
        Not level-matched
      </button>
    );
  if (!matched || !wanted) return null;
  const db = reading ? `${reading.gainDb > 0 ? '+' : ''}${reading.gainDb.toFixed(0)} dB` : '';
  return (
    <button
      type="button"
      onClick={openPlayback}
      className="flex items-center gap-1 px-2 py-2 rounded-lg text-[10px] font-mono tabular-nums border border-forge-border bg-forge-bg text-emerald-200 hover:border-emerald-400/60"
      title="Listening level-matched: you hear the song at about -15 LUFS however loud the master is, so a loud master never blasts you (the export keeps its loudness). Switch it off in the Master tab, under Playback."
      aria-label="Listening level-matched"
      data-testid="listening-badge"
    >
      <Ear className="w-3.5 h-3.5 text-emerald-400" />
      Level-matched {db}
    </button>
  );
};
