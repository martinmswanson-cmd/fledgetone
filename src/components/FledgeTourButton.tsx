import React, { useEffect, useSyncExternalStore } from 'react';
import { Play, Square } from 'lucide-react';
import { fledgePreviewState, stopFledgePreview, subscribeFledgePreview, toggleFledgeTour } from '../audio/fledgePreview';

/**
 * The ▶ beside "Fledge Synth" where it's offered as a new track (Add Track, the plugin browser,
 * Pocket's lists): hear a bass, a lead and chords from it without adding anything (fledgePreview.ts).
 * Press again to stop; it stops too when its list closes.
 */
export const FledgeTourButton: React.FC<{ className?: string; size?: 'small' | 'large' }> = ({ className = '', size = 'small' }) => {
  const s = useSyncExternalStore(subscribeFledgePreview, fledgePreviewState);
  const on = s?.kind === 'tour';
  const loading = on && s.loading;
  // (Closing the list stops it)
  useEffect(() => () => void (fledgePreviewState()?.kind === 'tour' && stopFledgePreview()), []);
  const box = size === 'large' ? 'w-11 h-11' : 'w-6 h-6';
  const icon = size === 'large' ? 'w-4 h-4' : 'w-3 h-3';
  return (
    <button
      type="button"
      tabIndex={size === 'large' ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        void toggleFledgeTour();
      }}
      aria-label={on ? 'Stop hearing Fledge Synth' : 'Hear Fledge Synth'}
      aria-pressed={on}
      title={on ? 'Stop' : 'Hear Fledge Synth first: a bass, a lead and chords from its presets'}
      className={`shrink-0 ${box} rounded-full flex items-center justify-center border transition-colors ${on ? 'border-fuchsia-400 text-fuchsia-200 bg-fuchsia-500/15' : 'border-forge-border text-forge-muted hover:text-fuchsia-200 hover:border-fuchsia-400/60'} ${className}`}
    >
      {on && !loading ? <Square className={`${icon} fill-current`} /> : <Play className={`${icon} ${loading ? 'animate-pulse fill-current' : ''}`} />}
    </button>
  );
};
