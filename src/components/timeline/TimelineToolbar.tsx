import React, { useState } from 'react';
import { MicButton } from './MicButton';
import {
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
import { MAX_ZOOM, MIN_ZOOM, TOTAL_BARS, useSongTempo, useTimelineStore } from '../../store/timelineStore';
import { frameRateLabel, TIMECODE_FORMATS } from '../../store/timelineTypes';
import type { SnapGrid } from '../../store/timelineTypes';
import { formatBarsBeats, formatSmpte, parseBarsBeats, parseTimecode, secondsToBar } from '../../audio/transport';
import { LoopRangeButton } from './LoopRangePopover';
import { MarkersButton } from './MarkerList';
import { MetronomeButton, MidiButton, RecordButton } from './RecordControls';

interface PositionFieldProps {
  value: string;
  /** Typed text to a 1-based bar, or null if it can't be read. */
  parse: (text: string) => number | null;
  label: string;
  hint: string;
  className: string;
}

/** A position readout: click it, type a position, Enter jumps the playhead there (Esc cancels). */
const PositionField: React.FC<PositionFieldProps> = ({ value, parse, label, hint, className }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const close = () => {
    setDraft(null);
    setInvalid(false);
  };

  if (draft === null) {
    return (
      <button
        type="button"
        className={`font-mono text-lg leading-none tabular-nums text-left rounded-sm hover:bg-white/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${className}`}
        onClick={() => setDraft(value)}
        title={`Click to type a ${label} and jump there (${hint})`}
        aria-label={`${label} ${value}, click to go to a position`}
      >
        {value}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        setInvalid(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
        if (e.key !== 'Enter') return;
        const bar = parse(draft);
        if (bar === null) {
          setInvalid(true);
          return;
        }
        useTimelineStore.getState().seek(bar, true);
        close();
      }}
      onBlur={close}
      className={`w-full font-mono text-lg leading-none tabular-nums bg-black/60 rounded-sm px-0.5 border focus:outline-none ${
        invalid ? 'border-red-500 text-red-300' : 'border-cyan-500 text-white'
      }`}
      aria-label={`Go to ${label} (${hint})`}
      aria-invalid={invalid}
      title={invalid ? `Not a ${label}. ${hint}` : hint}
    />
  );
};

/**
 * The zoom slider is logarithmic, so every part of its travel changes zoom by the same ratio
 * (12 to 1280 px per bar is over a hundredfold). Each of its steps is about 5%.
 */
const ZOOM_SLIDER_STEPS = 100;
const ZOOM_SPAN = Math.log(MAX_ZOOM / MIN_ZOOM);
const zoomToSlider = (zoom: number) => (Math.log(zoom / MIN_ZOOM) / ZOOM_SPAN) * ZOOM_SLIDER_STEPS;
const sliderToZoom = (value: number) => MIN_ZOOM * Math.exp((value / ZOOM_SLIDER_STEPS) * ZOOM_SPAN);

/** A typed position, or null if it's past the end of the timeline. */
const inSong = (bar: number | null) => (bar !== null && bar <= TOTAL_BARS + 1 ? bar : null);

const TimecodeDisplay: React.FC = () => {
  const position = useTimelineStore((s) => s.playheadPosition);
  const bpm = useSongTempo();
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const rate = frameRateLabel(fps, dropFrame);

  return (
    <div className="flex items-stretch gap-px rounded-md overflow-hidden border border-forge-border bg-forge-border">
      <div className="bg-black/60 px-3 py-1 flex flex-col justify-center w-[134px]">
        <span className="text-[9px] uppercase tracking-widest text-forge-muted font-mono leading-none mb-0.5">Bar.Beat.Tick</span>
        <PositionField
          value={formatBarsBeats(position)}
          parse={(text) => inSong(parseBarsBeats(text))}
          label="bar position"
          hint={`bar, bar.beat or bar.beat.hundredths, e.g. 17 or 17.3 (up to bar ${TOTAL_BARS + 1})`}
          className={isPlaying ? 'text-amber-300' : 'text-white'}
        />
      </div>
      <div className="bg-black/60 px-3 py-1 flex flex-col justify-center w-[152px]">
        <span className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-forge-muted font-mono leading-none mb-0.5">
          Timecode
          <select
            value={`${fps}${dropFrame ? ' DF' : ''}`}
            onChange={(e) => {
              const choice = TIMECODE_FORMATS.find((f) => `${f.fps}${f.dropFrame ? ' DF' : ''}` === e.target.value);
              if (choice) useTimelineStore.getState().setFps(choice.fps, choice.dropFrame);
            }}
            className="bg-transparent text-[9px] uppercase tracking-widest text-cyan-300 font-mono leading-none cursor-pointer hover:text-cyan-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 rounded-sm"
            title="Timecode frame rate (saved with the project)"
            aria-label="Timecode frame rate"
          >
            {TIMECODE_FORMATS.map((f) => (
              <option key={`${f.fps}${f.dropFrame}`} value={`${f.fps}${f.dropFrame ? ' DF' : ''}`} className="bg-forge-panel text-forge-text">
                {frameRateLabel(f.fps, f.dropFrame)}
              </option>
            ))}
          </select>
        </span>
        <PositionField
          value={formatSmpte(position, bpm, fps, dropFrame)}
          parse={(text) => {
            const seconds = parseTimecode(text, fps, dropFrame);
            return seconds === null ? null : inSong(secondsToBar(seconds, bpm));
          }}
          label="timecode"
          hint={`HH:MM:SS:FF, MM:SS:FF or SS:FF at ${rate}; digits alone fill from the frames, so 1500 is 15 seconds`}
          className="text-cyan-300"
        />
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
  const loopEnabled = useTimelineStore((s) => s.loopRegion.enabled);
  const activeTool = useTimelineStore((s) => s.activeTool);
  const snapGrid = useTimelineStore((s) => s.snapGrid);
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const zoom = useTimelineStore((s) => s.zoom);
  const canUndo = useTimelineStore((s) => s.past.length > 0);
  const canRedo = useTimelineStore((s) => s.future.length > 0);
  const isInspectorOpen = useTimelineStore((s) => s.isInspectorOpen);
  const sliderValue = Math.round(zoomToSlider(zoom));
  const {
    togglePlay,
    stop,
    seek,
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
        <ToolButton id="btn-goto-in" title="Go to In point (Home)" onClick={() => seek(useTimelineStore.getState().loopRegion.inBar, true)}>
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
        <RecordButton />
        <div className="relative flex items-center">
          <ToolButton
            id="btn-loop"
            title="Loop In→Out (L)"
            active={loopEnabled}
            activeClass="bg-amber-500/15 border-amber-400/70 text-amber-300"
            onClick={toggleLoop}
          >
            <Repeat className="w-4 h-4" />
          </ToolButton>
          <LoopRangeButton />
        </div>
        <MarkersButton />
        <MetronomeButton />
        <MidiButton />
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
        <ToolButton id="btn-undo" title="Undo clip, track, mixer and marker changes (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
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
          <option value="frame">Frame ({frameRateLabel(fps, dropFrame)})</option>
          <option value="off">Off</option>
        </select>
      </label>

      <MicButton />

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
        <button type="button" title="Zoom out (-)" onClick={() => setZoom(zoom / 1.25)} className="hover:text-forge-text">
          <ZoomOut className="w-4 h-4" />
        </button>
        <input
          id="zoom-slider"
          type="range"
          min={0}
          max={ZOOM_SLIDER_STEPS}
          step={1}
          // A whole step, as the slider would round it anyway (React would otherwise see the rounded value as a change)
          value={sliderValue}
          onChange={(e) => {
            const value = Number(e.target.value);
            const next = Math.round(sliderToZoom(value));
            // Zoom is whole px per bar, so at the low end two slider steps can round to the same zoom
            // (and the thumb snaps back): step 1px per bar the way the slider moved instead
            setZoom(next !== zoom ? next : zoom + Math.sign(value - sliderValue));
          }}
          className="w-28 accent-cyan-400 cursor-pointer"
          aria-label="Timeline zoom"
          aria-valuetext={`${zoom} pixels per bar`}
        />
        <button type="button" title="Zoom in (+)" onClick={() => setZoom(zoom * 1.25)} className="hover:text-forge-text">
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="font-mono text-[11px] w-[4.5rem] text-right tabular-nums">{zoom}px/bar</span>
      </div>
    </div>
  );
};
