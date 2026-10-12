import React from 'react';
import { useUiStore } from '../../store/uiStore';
import { useTimelineStore } from '../../store/timelineStore';
import { useAudioStore } from '../../store/audioStore';
import type { AutomationParam, Track } from '../../store/timelineTypes';
import { AUTOMATION_PARAMS, snapBar } from '../../store/timelineTypes';
import { Plug, Plus, Sliders, Loader2, Spline } from 'lucide-react';
import type { ContextMenuState } from './ClipContextMenu';
import { HEADER_WIDTH, TRACK_HEIGHT } from './layout';
import type { TrackMenuState } from './TrackMenu';
import { UndoableRange } from '../UndoableRange';
import { INSTRUMENTS, isAudioKind } from '../../audio/instrumentCatalog';
import { audibleIds, isBus, isMixTrack, isReturn } from '../../store/buses';
import { retryInstrumentDownload } from '../../audio/liveTracks';
import { activeLanes, AUTOMATION, formatPan, laneOf } from '../../audio/automation';
import { AUTOMATED_TIP, useAutomatedValue } from './automationHooks';
import { AutoBadge } from './AutoBadge';
import { FreezeButton } from './FreezeButton';

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
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={`w-5 h-5 shrink-0 rounded text-[10px] font-mono font-bold border transition-colors ${
      active ? activeClass : 'bg-forge-bg border-forge-border text-forge-muted hover:text-forge-text hover:border-forge-borderLight'
    }`}
  >
    {label}
  </button>
);

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** The VOL row: the fader, or while a Volume lane owns the level, the lane's value at the playhead. */
const VolumeRow: React.FC<{ track: Track }> = ({ track }) => {
  const automated = useAutomatedValue(track, 'volume');
  const volume = automated ?? track.volume;
  return (
    <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted" onClick={stop} title={automated !== null ? AUTOMATED_TIP : undefined}>
      <span className="w-6">VOL</span>
      <UndoableRange
        min={-60}
        max={6}
        step={0.5}
        value={Math.max(-60, volume)}
        onValue={(v) => useTimelineStore.getState().setTrackVolume(track.id, v)}
        resetValue={0}
        disabled={automated !== null}
        className="flex-1 min-w-0 cursor-pointer disabled:cursor-default"
        style={{ accentColor: automated !== null ? '#f59e0b' : track.color }}
        aria-label={`${track.name} volume`}
      />
      {automated !== null && <AutoBadge trackId={track.id} param="volume" />}
      <span className={`w-10 text-right tabular-nums ${automated !== null ? 'text-amber-200' : 'text-forge-text'}`}>
        {volume <= -60 ? '-inf' : `${volume > 0 ? '+' : ''}${volume.toFixed(1)}`}
      </span>
    </label>
  );
};

/** The PAN row, following a Pan lane like VolumeRow. */
const PanRow: React.FC<{ track: Track }> = ({ track }) => {
  const automated = useAutomatedValue(track, 'pan');
  const pan = automated ?? track.pan;
  return (
    <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted" onClick={stop} title={automated !== null ? AUTOMATED_TIP : undefined}>
      <span className="w-6">PAN</span>
      <UndoableRange
        min={-1}
        max={1}
        step={0.01}
        value={pan}
        onValue={(v) => useTimelineStore.getState().setTrackPan(track.id, v)}
        resetValue={0}
        disabled={automated !== null}
        className="flex-1 min-w-0 cursor-pointer disabled:cursor-default"
        style={{ accentColor: automated !== null ? '#f59e0b' : track.color }}
        aria-label={`${track.name} pan`}
      />
      {automated !== null && <AutoBadge trackId={track.id} param="pan" />}
      <span className={`w-10 text-right tabular-nums ${automated !== null ? 'text-amber-200' : 'text-forge-text'}`}>{formatPan(pan)}</span>
    </label>
  );
};

/** The lane's value at the playhead (or the track's own, with no points): the only part that follows playback. */
const AutomationReadout: React.FC<{ track: Track; param: AutomationParam }> = ({ track, param }) => {
  const automated = useAutomatedValue(track, param);
  const spec = AUTOMATION[param];
  return (
    <span
      className={`shrink-0 text-right tabular-nums ${automated !== null ? 'text-amber-200' : 'text-forge-text'}`}
      title={automated !== null ? 'The lane\'s value at the playhead' : 'No points: the track\'s own setting plays'}
    >
      {spec.format(automated ?? spec.trackValue(track))}
    </span>
  );
};

/** In automation view, the rows under the name pick the lane shown and read its value at the playhead. */
const AutomationRows: React.FC<{ track: Track; param: AutomationParam }> = ({ track, param }) => {
  const spec = AUTOMATION[param];
  const count = laneOf(track, param)?.points.length ?? 0;
  const filterOff = !!spec.filter && !track.fx.filter?.on;
  const withPoints = new Set(activeLanes(track).map((l) => l.param));
  return (
    <>
      <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted" onClick={stop}>
        <span className="w-6">LANE</span>
        <select
          value={param}
          onChange={(e) => useTimelineStore.getState().showAutomation(track.id, true, e.target.value as AutomationParam)}
          className="flex-1 min-w-0 h-5 bg-forge-bg border border-forge-border rounded px-1 text-[10px] font-mono text-forge-text cursor-pointer focus:border-amber-400 focus:outline-none"
          aria-label={`${track.name} automation lane`}
          title="The setting this lane automates (● has points)"
        >
          {AUTOMATION_PARAMS.map((p) => (
            <option key={p} value={p}>
              {withPoints.has(p) ? '● ' : ''}
              {AUTOMATION[p].label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2 text-[10px] font-mono text-forge-muted" onClick={stop}>
        <span className="flex-1 min-w-0 truncate" title={filterOff ? 'Filter lanes only sound while the Filter insert is on' : undefined}>
          {filterOff ? 'Filter is off' : count ? `${count} point${count === 1 ? '' : 's'}` : 'No points yet'}
        </span>
        <AutomationReadout track={track} param={param} />
      </div>
    </>
  );
};

/**
 * Sticky left-hand track header: name, + (add clip), M / S / R toggles, volume fader and pan.
 * Double-click a fader to reset it. Click header to select track & open FX Inspector.
 */
export const TrackHeader: React.FC<{ track: Track; onOpenMenu: (menu: ContextMenuState) => void; onTrackMenu?: (menu: TrackMenuState) => void }> = ({
  track,
  onOpenMenu,
  onTrackMenu,
}) => {
  const { toggleMute, toggleSolo, toggleArm, selectTrack, toggleInspector } = useTimelineStore.getState();
  const selectedTrackId = useTimelineStore((s) => s.selectedTrackId);
  const isSelected = selectedTrackId === track.id;
  // Muted, or silenced by a solo or a muted bus (see buses.ts)
  const silenced = useTimelineStore((s) => !audibleIds(s.tracks).has(track.id));
  const bus = isBus(track);
  const busName = useTimelineStore((s) => (track.output ? s.tracks.find((t) => t.id === track.output && isBus(t))?.name : undefined));
  const ret = isReturn(track);
  const mixTrack = isMixTrack(track);
  const inputs = useTimelineStore((s) =>
    bus ? s.tracks.filter((t) => t.output === track.id).length : ret ? s.tracks.filter((t) => t.sends?.some((x) => x.to === track.id)).length : 0
  );

  const automationOpen = useTimelineStore((s) => s.automationView[track.id]?.open ?? false);
  const automationParam = useTimelineStore((s) => s.automationView[track.id]?.param ?? 'volume');
  const hasLanes = activeLanes(track).length > 0;

  const instrumentStatus = useAudioStore((s) => s.instrumentStatus[track.instrumentKey] ?? 'ready');
  const isLoading = instrumentStatus === 'loading';
  const downloadFailed = instrumentStatus === 'error';

  const handleSelectTrack = () => {
    selectTrack(track.id);
  };

  return (
    <div
      data-tour="track-header"
      onClick={handleSelectTrack}
      onContextMenu={(e) => {
        if (!onTrackMenu || (e.target as HTMLElement).closest('input, select, textarea')) return;
        e.preventDefault();
        selectTrack(track.id);
        onTrackMenu({ x: e.clientX, y: e.clientY, trackId: track.id });
      }}
      className={`sticky left-0 z-20 shrink-0 flex bg-forge-panel border-r border-b transition-colors cursor-pointer ${
        isSelected ? 'border-cyan-400/80 bg-forge-panel/90 shadow-md ring-1 ring-cyan-500/30' : 'border-forge-border'
      }`}
      style={{ width: HEADER_WIDTH, height: TRACK_HEIGHT }}
    >
      {track.folder && <div className="w-1 shrink-0" style={{ backgroundColor: track.folder.color, opacity: 0.5 }} title={`In the folder ${track.folder.name}`} />}
      <div
        className="w-1.5 shrink-0 transition-opacity"
        style={{ backgroundColor: track.color, opacity: silenced ? 0.35 : 1 }}
      />
      <div className="flex-1 min-w-0 px-2.5 py-2 flex flex-col justify-between">
        <div className="flex items-center gap-1">
          {/* Loading Indicator, Download Error (click to retry) or Selected Glow */}
          {isLoading ? (
            <span title="Downloading acoustic samples from CDN..." className="text-cyan-400 animate-spin shrink-0">
              <Loader2 className="w-3 h-3" />
            </span>
          ) : downloadFailed ? (
            <button
              type="button"
              title={`Couldn't download ${INSTRUMENTS[track.instrumentKey].name} sounds. Click to retry`}
              aria-label={`Retry downloading ${INSTRUMENTS[track.instrumentKey].name} sounds`}
              onClick={(e) => {
                e.stopPropagation();
                void retryInstrumentDownload(track.instrumentKey).catch(() => {});
              }}
              className="w-3.5 h-3.5 shrink-0 rounded-full bg-red-500 hover:bg-red-400 text-white text-[9px] font-bold leading-none flex items-center justify-center"
            >
              !
            </button>
          ) : (
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                backgroundColor: track.color,
                boxShadow: isSelected ? `0 0 6px ${track.color}` : 'none',
              }}
            />
          )}

          <span
            className={`flex-1 truncate text-xs font-semibold ${silenced ? 'text-forge-muted' : 'text-forge-text'} ${
              isSelected ? 'text-cyan-200 font-bold' : ''
            }`}
            title={`${track.name} (Click to open Inspector)`}
          >
            {track.name}
          </span>
          {bus && (
            <span className="shrink-0 px-1 rounded bg-slate-400/20 text-[8px] font-mono uppercase text-slate-200" title={`A bus: ${inputs} track${inputs === 1 ? '' : 's'} play${inputs === 1 ? 's' : ''} into it. Right-click a track to route it here.`}>
              bus · {inputs}
            </span>
          )}
          {ret && (
            <span className="shrink-0 px-1 rounded bg-sky-400/20 text-[8px] font-mono uppercase text-sky-200" title={`A return: ${inputs} track${inputs === 1 ? '' : 's'} send${inputs === 1 ? 's' : ''} to it. Put effects on it in the Inspector, then turn up sends in the mixer or a track's Inspector.`}>
              return · {inputs}
            </span>
          )}
          {(track.plugin || track.pluginFx?.length) && (
            <button
              type="button"
              className="shrink-0 p-0.5 rounded bg-fuchsia-400/20 text-fuchsia-100 hover:bg-fuchsia-400/35"
              title={`Plugins: ${[track.plugin, ...(track.pluginFx ?? [])].filter(Boolean).map((p) => p!.name).join(', ')}. Click to open ${(track.plugin ?? track.pluginFx![0]).name}; right-click the track for the rest.`}
              onClick={(e) => {
                e.stopPropagation();
                useUiStore.getState().setPluginWindow({ trackId: track.id, pluginId: (track.plugin ?? track.pluginFx![0]).id });
              }}
            >
              <Plug className="w-2.5 h-2.5" />
              <span className="sr-only">Open plugin</span>
            </button>
          )}
          {busName && (
            <span className="shrink-0 max-w-[64px] truncate px-1 rounded bg-slate-400/15 text-[8px] font-mono text-slate-300" title={`Plays into the bus ${busName}`}>
              → {busName}
            </span>
          )}

          {/* Quick Inspector Toggle Button */}
          <button
            type="button"
            title="Open Track Inspector / EQ Rack"
            onClick={(e) => {
              e.stopPropagation();
              selectTrack(track.id);
              toggleInspector(true);
            }}
            className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center transition ${
              isSelected
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                : 'border-forge-border bg-forge-bg text-forge-muted hover:text-forge-text hover:border-cyan-500/70'
            }`}
          >
            <Sliders className="w-3 h-3" />
          </button>

          {!mixTrack && (
          <button
            type="button"
            title="Add a clip at the playhead (empty or a pattern)"
            aria-label={`Add clip to ${track.name}`}
            onClick={(e) => {
              e.stopPropagation();
              const r = e.currentTarget.getBoundingClientRect();
              const s = useTimelineStore.getState();
              onOpenMenu({
                x: r.left,
                y: r.bottom + 4,
                bar: snapBar(s.playheadPosition, s.snapGrid, s),
                trackId: track.id,
                clipId: null,
              });
            }}
            className="w-5 h-5 shrink-0 rounded border border-forge-border bg-forge-bg text-forge-muted hover:text-forge-text hover:border-cyan-500/70 flex items-center justify-center"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          )}
          <button
            type="button"
            title={automationOpen ? 'Hide automation' : hasLanes ? 'Show automation (this track has some)' : 'Show automation'}
            aria-label={`${automationOpen ? 'Hide' : 'Show'} automation for ${track.name}`}
            aria-pressed={automationOpen}
            onClick={(e) => {
              e.stopPropagation();
              useTimelineStore.getState().showAutomation(track.id);
            }}
            className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center transition ${
              automationOpen
                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                : hasLanes
                  ? 'border-amber-500/50 bg-forge-bg text-amber-300/90 hover:border-amber-400'
                  : 'border-forge-border bg-forge-bg text-forge-muted hover:text-forge-text hover:border-amber-500/70'
            }`}
          >
            <Spline className="w-3.5 h-3.5" />
          </button>
          {!isAudioKind(track.instrumentKey) && !mixTrack && <FreezeButton track={track} />}
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
          {!mixTrack && <Toggle
            label="R"
            title={isAudioKind(track.instrumentKey) ? 'Audio tracks hold sound files, not MIDI takes: arm an instrument track to record' : 'Record arm: takes go on this track (one track at a time)'}
            active={track.isArmed}
            onClick={() => toggleArm(track.id)}
            activeClass="bg-red-500/25 border-red-500 text-red-300"
          />}
        </div>

        {automationOpen ? (
          <AutomationRows track={track} param={automationParam} />
        ) : (
          <>
            <VolumeRow track={track} />
            <PanRow track={track} />
          </>
        )}
      </div>
    </div>
  );
};
