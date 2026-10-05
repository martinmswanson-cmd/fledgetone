import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import { snapBar } from '../../store/timelineTypes';
import { Plus } from 'lucide-react';
import type { ContextMenuState } from './ClipContextMenu';
import { HEADER_WIDTH, TRACK_HEIGHT } from './layout';

interface ToggleProps {
  active: boolean;
  onClick: () => void;
  title: string;
  label: string;
  activeClass: string;
}

const Toggle: React.FC<ToggleProps> = ({ active, onClick, title, label, activeClass }) => (
  <button
    type="button"
    title={title}
    aria-pressed={active}
    onClick={onClick}
    className={`w-6 h-6 rounded text-[10px] font-mono font-bold border transition-colors ${
      active ? activeClass : 'bg-forge-bg border-forge-border text-forge-muted hover:text-forge-text hover:border-forge-borderLight'
    }`}
  >
    {label}
  </button>
);

function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.005) return 'C';
  return `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`;
}

/**
 * Sticky left-hand track header: name, + (add clip), M / S / R toggles, volume fader and pan.
 * Double-click a fader to reset it.
 */
export const TrackHeader: React.FC<{ track: Track; onOpenMenu: (menu: ContextMenuState) => void }> = ({ track, onOpenMenu }) => {
  const { toggleMute, toggleSolo, toggleArm, setTrackVolume, setTrackPan } = useTimelineStore.getState();
  const anySoloed = useTimelineStore((s) => s.tracks.some((t) => t.isSoloed));
  const silenced = track.isMuted || (anySoloed && !track.isSoloed);

  return (
    <div
      className="sticky left-0 z-20 shrink-0 flex bg-forge-panel border-r border-b border-forge-border"
      style={{ width: HEADER_WIDTH, height: TRACK_HEIGHT }}
    >
      <div className="w-1.5 shrink-0" style={{ backgroundColor: track.color, opacity: silenced ? 0.35 : 1 }} />
      <div className="flex-1 min-w-0 px-2.5 py-2 flex flex-col justify-between">
        <div className="flex items-center gap-1.5">
          <span
            className={`flex-1 truncate text-xs font-semibold ${silenced ? 'text-forge-muted' : 'text-forge-text'}`}
            title={track.name}
          >
            {track.name}
          </span>
          <button
            type="button"
            title="Add a clip at the playhead (empty or a pattern)"
            aria-label={`Add clip to ${track.name}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const { playheadPosition, snapGrid } = useTimelineStore.getState();
              onOpenMenu({ x: r.left, y: r.bottom + 4, bar: snapBar(playheadPosition, snapGrid), trackId: track.id, clipId: null });
            }}
            className="w-6 h-6 rounded border border-forge-border bg-forge-bg text-forge-muted hover:text-forge-text hover:border-cyan-500/70 flex items-center justify-center"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <Toggle
            label="M"
            title="Mute"
            active={track.isMuted}
            onClick={() => toggleMute(track.id)}
            activeClass="bg-sky-500/25 border-sky-400 text-sky-200"
          />
          <Toggle
            label="S"
            title="Solo"
            active={track.isSoloed}
            onClick={() => toggleSolo(track.id)}
            activeClass="bg-amber-500/25 border-amber-400 text-amber-200"
          />
          <Toggle
            label="R"
            title="Record arm (visual only in this phase)"
            active={track.isArmed}
            onClick={() => toggleArm(track.id)}
            activeClass="bg-red-500/25 border-red-500 text-red-300"
          />
        </div>

        <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted">
          <span className="w-6">VOL</span>
          <input
            type="range"
            min={-60}
            max={6}
            step={0.5}
            value={track.volume}
            onChange={(e) => setTrackVolume(track.id, Number(e.target.value))}
            onDoubleClick={() => setTrackVolume(track.id, 0)}
            className="flex-1 min-w-0 cursor-pointer"
            style={{ accentColor: track.color }}
            aria-label={`${track.name} volume`}
          />
          <span className="w-12 text-right tabular-nums text-forge-text">
            {track.volume <= -60 ? '-inf' : `${track.volume > 0 ? '+' : ''}${track.volume.toFixed(1)}`}
          </span>
        </label>

        <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted">
          <span className="w-6">PAN</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={track.pan}
            onChange={(e) => setTrackPan(track.id, Number(e.target.value))}
            onDoubleClick={() => setTrackPan(track.id, 0)}
            className="flex-1 min-w-0 cursor-pointer"
            style={{ accentColor: track.color }}
            aria-label={`${track.name} pan`}
          />
          <span className="w-12 text-right tabular-nums text-forge-text">{formatPan(track.pan)}</span>
        </label>
      </div>
    </div>
  );
};
