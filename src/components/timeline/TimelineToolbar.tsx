import React from 'react';
import {
  Circle,
  Magnet,
  MousePointer2,
  Pause,
  Play,
  Redo2,
  Repeat,
  Scissors,
  SkipBack,
  Sliders,
  Square,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { MAX_ZOOM, MIN_ZOOM, useTimelineStore } from '../../store/timelineStore';
import type { SnapGrid } from '../../store/timelineTypes';
import { formatBarsBeats, formatSmpte } from '../../audio/transport';

const TimecodeDisplay: React.FC = () => {
  const position = useTimelineStore((s) => s.playheadPosition);
  const bpm = useTimelineStore((s) => s.bpm);
  const isPlaying = useTimelineStore((s) => s.isPlaying);

  return (
    <div className="flex items-stretch gap-px rounded-md overflow-hidden border border-forge-border bg-forge-border">
      <div className="bg-black/60 px-3 py-1 flex flex-col justify-center min-w-[118px]">
        <span className="text-[9px] uppercase tracking-widest text-forge-muted font-mono leading-none mb-0.5">Bar.Beat.Tick</span>
        <span className={`font-mono text-lg leading-none tabular-nums ${isPlaying ? 'text-amber-300' : 'text-white'}`}>
          {formatBarsBeats(position)}
        </span>
      </div>
      <div className="bg-black/60 px-3 py-1 flex flex-col justify-center min-w-[128px]">
        <span className="text-[9px] uppercase tracking-widest text-forge-muted font-mono leading-none mb-0.5">Timecode 30fps</span>
        <span className="font-mono text-lg leading-none tabular-nums text-cyan-300">{formatSmpte(position, bpm)}</span>
      </div>
    </div>
  );
};

interface ToolButtonProps {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  activeClass?: string;
  id?: string;
  disabled?: boolean;
}

const ToolButton: React.FC<ToolButtonProps> = ({ active, onClick, title, children, activeClass, id, disabled }) => (
  <button
    id={id}
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={`h-8 min-w-8 px-2 flex items-center justify-center gap-1.5 rounded-md border text-xs font-mono transition-colors disabled:opacity-35 disabled:pointer-events-none ${
      active
        ? activeClass ?? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-200'
        : 'bg-forge-bg border-forge-border text-forge-muted hover:text-forge-text hover:border-forge-borderLight'
    }`}
  >
    {children}
  </button>
);

export const TimelineToolbar: React.FC = () => {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const isRecording = useTimelineStore((s) => s.isRecording);
  const loopEnabled = useTimelineStore((s) => s.loopRegion.enabled);
  const activeTool = useTimelineStore((s) => s.activeTool);
  const snapGrid = useTimelineStore((s) => s.snapGrid);
  const zoom = useTimelineStore((s) => s.zoom);
  const canUndo = useTimelineStore((s) => s.past.length > 0);
  const canRedo = useTimelineStore((s) => s.future.length > 0);
  const isInspectorOpen = useTimelineStore((s) => s.isInspectorOpen);
  const {
    togglePlay,
    stop,
    seek,
    toggleRecord,
    toggleLoop,
    setTool,
    setSnapGrid,
    setZoom,
    undo,
    redo,
    toggleInspector,
  } = useTimelineStore.getState();

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2 bg-forge-panel border-b border-forge-border">
      {/* Transport */}
      <div className="flex items-center gap-1.5" role="group" aria-label="Transport">
        <ToolButton id="btn-goto-in" title="Go to In point (Home)" onClick={() => seek(useTimelineStore.getState().loopRegion.inBar)}>
          <SkipBack className="w-4 h-4" />
        </ToolButton>
        <button
          id="btn-play"
          type="button"
          title="Play / Pause (Space)"
          onClick={() => void togglePlay()}
          className={`h-8 w-11 flex items-center justify-center rounded-md border transition-colors ${
            isPlaying
              ? 'bg-amber-500 border-amber-300 text-black shadow-glow-brass'
              : 'bg-emerald-600 border-emerald-400/80 text-white hover:bg-emerald-500'
          }`}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
        </button>
        <ToolButton id="btn-stop" title="Stop (return to In point)" onClick={stop}>
          <Square className="w-3.5 h-3.5 fill-current" />
        </ToolButton>
        <ToolButton
          id="btn-record"
          title="Record arm (visual only in this phase)"
          active={isRecording}
          activeClass="bg-red-500/20 border-red-500 text-red-400 animate-pulse"
          onClick={toggleRecord}
        >
          <Circle className={`w-3.5 h-3.5 ${isRecording ? 'fill-red-500' : 'fill-red-500/60 text-red-500/60'}`} />
        </ToolButton>
        <ToolButton
          id="btn-loop"
          title="Loop In→Out (L)"
          active={loopEnabled}
          activeClass="bg-amber-500/15 border-amber-400/70 text-amber-300"
          onClick={toggleLoop}
        >
          <Repeat className="w-4 h-4" />
        </ToolButton>
      </div>

      {/* Timecode */}
      <TimecodeDisplay />

      {/* Tools */}
      <div className="flex items-center gap-1.5" role="group" aria-label="Edit tools">
        <ToolButton id="tool-select" title="Selection tool (V)" active={activeTool === 'select'} onClick={() => setTool('select')}>
          <MousePointer2 className="w-4 h-4" />
          <span className="text-[10px] opacity-70">V</span>
        </ToolButton>
        <ToolButton
          id="tool-razor"
          title="Razor / Blade tool (C)"
          active={activeTool === 'razor'}
          activeClass="bg-red-500/15 border-red-400/70 text-red-300"
          onClick={() => setTool('razor')}
        >
          <Scissors className="w-4 h-4" />
          <span className="text-[10px] opacity-70">C</span>
        </ToolButton>
      </div>

      {/* History */}
      <div className="flex items-center gap-1.5" role="group" aria-label="History">
        <ToolButton id="btn-undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
          <Undo2 className="w-4 h-4" />
        </ToolButton>
        <ToolButton id="btn-redo" title="Redo (Ctrl+Shift+Z / Ctrl+Y)" onClick={redo} disabled={!canRedo}>
          <Redo2 className="w-4 h-4" />
        </ToolButton>
      </div>

      {/* Snap */}
      <label className="flex items-center gap-2 text-xs font-mono text-forge-muted" htmlFor="snap-grid">
        <Magnet className={`w-4 h-4 ${snapGrid === 'off' ? '' : 'text-cyan-400'}`} />
        <span>SNAP</span>
        <select
          id="snap-grid"
          value={snapGrid}
          onChange={(e) => setSnapGrid(e.target.value as SnapGrid)}
          className="h-8 bg-forge-bg border border-forge-border rounded-md px-2 text-forge-text focus:outline-none focus:border-cyan-500"
        >
          <option value="1/4">1/4</option>
          <option value="1/8">1/8</option>
          <option value="1/16">1/16</option>
          <option value="off">Off</option>
        </select>
      </label>

      {/* Inspector / Studio FX Rack Toggle */}
      <ToolButton
        id="btn-inspector-toggle"
        title="Toggle Track Inspector & FX Rack"
        active={isInspectorOpen}
        activeClass="bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.25)] font-bold"
        onClick={() => toggleInspector()}
      >
        <Sliders className="w-4 h-4" />
        <span className="text-[11px] font-bold">FX Rack</span>
      </ToolButton>

      {/* Zoom */}
      <div className="flex items-center gap-2 ml-auto text-forge-muted">
        <button type="button" title="Zoom out" onClick={() => setZoom(zoom / 1.25)} className="hover:text-forge-text">
          <ZoomOut className="w-4 h-4" />
        </button>
        <input
          id="zoom-slider"
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-28 accent-cyan-400 cursor-pointer"
          aria-label="Timeline zoom (pixels per bar)"
        />
        <button type="button" title="Zoom in" onClick={() => setZoom(zoom * 1.25)} className="hover:text-forge-text">
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="font-mono text-[11px] w-16 text-right tabular-nums">{zoom}px/bar</span>
      </div>
    </div>
  );
};
