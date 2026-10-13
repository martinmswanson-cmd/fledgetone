import React from 'react';
import { Loader2, Snowflake } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import { freezeFingerprint, freezeIsCurrent } from '../../store/freeze';
import { useAutoFreeze } from '../../store/autoFreeze';
import { freezeTrack, unfreezeTrack, useFreezing } from '../../store/freezeActions';
import { useSoundLibrary } from '../../audio/soundLibrary';
import { showToast } from './toastStore';

/**
 * Freeze / unfreeze a track. Lit while its freeze plays; amber when the freeze is out of date
 * (something it was rendered from changed, so the track plays live) and a click freezes it again.
 * A faint ring marks a track auto-freeze is playing as audio (autoFreeze.ts).
 */
export const FreezeButton: React.FC<{ track: Track }> = ({ track }) => {
  const progress = useFreezing((s) => s[track.id]);
  // Only frozen tracks need the arrangement to tell whether their freeze still matches
  const current = useTimelineStore((s) =>
    track.frozen ? freezeIsCurrent(track, s, (id) => ['missing', 'error'].includes(useSoundLibrary.getState().status[id] ?? '')) : false
  );
  const soundGone = useSoundLibrary((s) => (track.frozen ? ['missing', 'error'].includes(s.status[track.frozen.soundId] ?? '') : false));
  const auto = useAutoFreeze((s) => s.frozen[track.id]);
  const autoCurrent = useTimelineStore((s) => (auto && !track.frozen && !track.isArmed ? freezeFingerprint(track, s) === auto.fingerprint : false));
  const frozen = !!track.frozen;
  const busy = progress !== undefined;

  const freeze = () =>
    freezeTrack(track.id).then(
      () => showToast(`Froze ${track.name}: it plays as audio now`),
      (err) => showToast(`Couldn't freeze ${track.name}: ${err instanceof Error ? err.message : String(err)}`)
    );

  const title = busy
    ? `Freezing… ${Math.round(progress * 100)}%`
    : !frozen && autoCurrent
      ? 'Auto-frozen: plays as audio while you leave it alone (change it and it plays live). Click to freeze it for good'
      : !frozen
      ? 'Freeze: render this track to audio so it costs almost no CPU (its volume, pan and sends stay live)'
      : current
        ? 'Frozen: plays as audio. Click to play it live again'
        : track.isArmed
          ? 'Frozen, but armed: it plays live so you hear what you play. Click to freeze it again'
          : soundGone
            ? "Frozen, but its sound isn't in this browser: it plays live. Click to freeze it again"
            : 'Frozen, but out of date (something changed): it plays live. Click to freeze it again';

  return (
    <button
      type="button"
      title={title}
      aria-label={`${frozen && current ? 'Unfreeze' : 'Freeze'} ${track.name}`}
      aria-pressed={frozen && current}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        if (frozen && current) unfreezeTrack(track.id);
        else void freeze();
      }}
      className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center transition ${
        busy
          ? 'border-cyan-400/60 bg-forge-bg text-cyan-300'
          : frozen && current
            ? 'bg-cyan-500/25 border-cyan-300 text-cyan-100'
            : frozen
              ? 'border-amber-400/70 bg-forge-bg text-amber-300'
              : autoCurrent
                ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-300/80 hover:text-cyan-100'
                : 'border-forge-border bg-forge-bg text-forge-muted hover:text-forge-text hover:border-cyan-500/70'
      }`}
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Snowflake className="w-3.5 h-3.5" />}
    </button>
  );
};
