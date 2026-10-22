/**
 * The header's small "level-matched" mark: shown while listening is level-matched (monitor.ts),
 * with how far the listening gain is turning the song up or down. A click opens the Master tab's
 * Playback settings, where it can be switched off.
 */
import React from 'react';
import { Ear } from 'lucide-react';
import { useListening } from './useListening';
import { useUiStore } from '../store/uiStore';
import { useTimelineStore } from '../store/timelineStore';

export const ListeningBadge: React.FC = () => {
  const { reading, matched } = useListening();
  if (!matched) return null;
  const db = reading ? `${reading.gainDb > 0 ? '+' : ''}${reading.gainDb.toFixed(0)} dB` : '';
  return (
    <button
      type="button"
      onClick={() => {
        useTimelineStore.getState().toggleInspector(true);
        useUiStore.getState().setInspectorTab('master');
      }}
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
