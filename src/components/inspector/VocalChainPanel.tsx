/**
 * An Audio track's vocal chain presets (vocalChains.ts): one click puts a ready rap vocal chain on
 * the track's inserts, one undo step. Also the Ad-lib track helper: a new Audio track with the
 * Ad-lib chain, selected so the mic records onto it.
 */
import React from 'react';
import { Mic2, Plus } from 'lucide-react';
import type { Track } from '../../store/timelineTypes';
import { matchingVocalChain, VOCAL_CHAINS } from '../../store/vocalChains';
import { addAdlibTrack, applyVocalChain } from '../../store/vocalActions';
import { showToast } from '../timeline/toastStore';

export const VocalChainPanel: React.FC<{ track: Track }> = ({ track }) => {
  const on = matchingVocalChain(track);
  return (
    <div data-search="vocal chain" className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-pink-500/40 shadow-md">
      <div className="flex items-center gap-1.5">
        <Mic2 className="w-3.5 h-3.5 text-pink-400" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Vocal chain</span>
        <span className="ml-auto text-[10px] font-mono text-forge-muted">replaces the inserts</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {VOCAL_CHAINS.map((chain) => (
          <button
            key={chain.id}
            type="button"
            title={chain.description}
            onClick={() => {
              applyVocalChain(track.id, chain.id);
              showToast(`${chain.name} is on "${track.name}". Undo puts its inserts back.`);
            }}
            className={`h-7 px-2 rounded-md border text-[11px] font-mono text-left truncate ${on === chain.id ? 'border-pink-400/70 bg-pink-500/20 text-pink-100' : 'border-forge-border hover:text-forge-text hover:border-pink-500/50'}`}
          >
            {chain.name}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => addAdlibTrack(track.id)}
        title="A new Audio track under this one with the Ad-lib chain on, selected so the mic records onto it"
        className="h-7 flex items-center justify-center gap-1.5 rounded-md border border-pink-500/40 text-pink-200 text-[11px] font-mono hover:bg-pink-500/15"
      >
        <Plus className="w-3.5 h-3.5" /> Ad-lib track
      </button>
    </div>
  );
};
