import React from 'react';
import { TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import { formatRulerTime } from '../../audio/transport';
import { barFromClientX, Playhead } from './Playhead';
import { barLabelStep, RULER_HEIGHT, TIMECODE_LABEL_PX, timecodeRulerSteps } from './layout';
import { snapBar } from '../../store/timelineTypes';
import type { RulerMenuState } from './RulerContextMenu';

interface TimeRulerProps {
  originRef: React.RefObject<HTMLDivElement | null>;
  onScrubStart: (e: React.PointerEvent) => void;
  /** Right-click: open the ruler's menu at the (snapped) bar under the pointer. */
  onOpenMenu?: (menu: RulerMenuState) => void;
}

/**
 * Top ruler: bar/beat markings (or timecode at the project frame rate), the In/Out loop region
 * with draggable brackets, click-to-scrub, and the playhead grab handle.
 */
export const TimeRuler: React.FC<TimeRulerProps> = ({ originRef, onScrubStart, onOpenMenu }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const inBar = useTimelineStore((s) => s.loopRegion.inBar);
  const outBar = useTimelineStore((s) => s.loopRegion.outBar);
  const loopEnabled = useTimelineStore((s) => s.loopRegion.enabled);
  const units = useTimelineStore((s) => s.rulerUnits);
  const bpm = useTimelineStore((s) => s.bpm);
  const fps = useTimelineStore((s) => s.fps);
  const totalWidth = TOTAL_BARS * zoom;
  const showBeatLabels = zoom >= 200;
  const showBeatTicks = zoom >= 48;
  const labelStep = barLabelStep(zoom);
  // Timecode mode: bar 1 is 0:00, at the project tempo
  const pxPerSecond = (zoom * bpm) / 240;
  const tc = timecodeRulerSteps(pxPerSecond, fps);
  const ticks =
    units === 'timecode'
      ? `${tc.label * pxPerSecond}px 35%, ${tc.tick * pxPerSecond}px 18%`
      : showBeatTicks
        ? `${zoom / 4}px 35%, ${zoom / 16}px 18%`
        : `${zoom}px 35%, ${zoom}px 0%`;

  const startBracketDrag = (which: 'in' | 'out') => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const onMove = (ev: PointerEvent) => {
      const bar = barFromClientX(ev.clientX, originRef.current);
      const { setLoopIn, setLoopOut } = useTimelineStore.getState();
      if (which === 'in') setLoopIn(bar);
      else setLoopOut(bar);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    document.body.style.cursor = 'ew-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const loopLeft = (inBar - 1) * zoom;
  const loopWidth = (outBar - inBar) * zoom;
  const accent = loopEnabled ? 'amber' : 'zinc';

  return (
    <div
      ref={originRef}
      className="relative bg-forge-panel border-b border-forge-border select-none cursor-text"
      style={{
        width: totalWidth,
        height: RULER_HEIGHT,
        // beat ticks (bottom 35%) and 16th ticks (bottom 18%), just bar ticks when zoomed far out;
        // in timecode mode, label ticks and frame / second ticks
        backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.22) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px)`,
        backgroundSize: ticks,
        backgroundPosition: 'left bottom, left bottom',
        backgroundRepeat: 'repeat-x',
      }}
      onPointerDown={onScrubStart}
      onContextMenu={(e) => {
        e.preventDefault();
        const s = useTimelineStore.getState();
        const raw = barFromClientX(e.clientX, originRef.current);
        onOpenMenu?.({ x: e.clientX, y: e.clientY, bar: e.shiftKey ? raw : snapBar(raw, s.snapGrid, s) });
      }}
    >
      {/* Loop region (In → Out) */}
      <div
        className={`absolute top-0 bottom-0 pointer-events-none ${
          loopEnabled ? 'bg-amber-400/15' : 'bg-zinc-400/10'
        }`}
        style={{ left: loopLeft, width: loopWidth }}
      >
        <div className={`absolute inset-x-0 top-0 h-[3px] ${loopEnabled ? 'bg-amber-400' : 'bg-zinc-500'}`} />
      </div>

      {/* In bracket */}
      <div
        className="absolute top-0 bottom-0 z-20 w-3 cursor-ew-resize group"
        style={{ left: loopLeft - 1 }}
        onPointerDown={startBracketDrag('in')}
        title="Drag In point (I)"
      >
        <div className={`absolute left-0 top-0 bottom-0 w-[3px] ${accent === 'amber' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
        <div className={`absolute left-0 top-0 w-3 h-[3px] ${accent === 'amber' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
        <div className={`absolute left-0 bottom-0 w-3 h-[3px] ${accent === 'amber' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
        <span className="absolute left-1.5 top-[5px] text-[8px] font-mono font-bold text-amber-300 opacity-80 group-hover:opacity-100">
          IN
        </span>
      </div>

      {/* Out bracket */}
      <div
        className="absolute top-0 bottom-0 z-20 w-3 cursor-ew-resize group"
        style={{ left: loopLeft + loopWidth - 11 }}
        onPointerDown={startBracketDrag('out')}
        title="Drag Out point (O)"
      >
        <div className={`absolute right-0 top-0 bottom-0 w-[3px] ${accent === 'amber' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
        <div className={`absolute right-0 top-0 w-3 h-[3px] ${accent === 'amber' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
        <div className={`absolute right-0 bottom-0 w-3 h-[3px] ${accent === 'amber' ? 'bg-amber-400' : 'bg-zinc-500'}`} />
        <span className="absolute right-1.5 top-[5px] text-[8px] font-mono font-bold text-amber-300 opacity-80 group-hover:opacity-100">
          OUT
        </span>
      </div>

      {/* Timecode labels */}
      {units === 'timecode' &&
        // Only labels whose text fits before the end of the timeline
        Array.from({ length: Math.floor((totalWidth - TIMECODE_LABEL_PX) / (tc.label * pxPerSecond)) + 1 }, (_, k) => {
          const x = k * tc.label * pxPerSecond;
          return (
            <React.Fragment key={k}>
              <div className="absolute top-0 bottom-0 w-px bg-white/30 pointer-events-none" style={{ left: x }} />
              <span className="absolute top-[6px] text-[10px] font-mono text-cyan-200/90 pointer-events-none tabular-nums" style={{ left: x + 4 }}>
                {formatRulerTime(k * tc.label, fps)}
              </span>
            </React.Fragment>
          );
        })}

      {/* Bar + beat labels (every Nth bar when zoomed out so labels never overlap) */}
      {units === 'bars' && Array.from({ length: Math.ceil(TOTAL_BARS / labelStep) }, (_, k) => {
        const i = k * labelStep;
        const bar = i + 1;
        return (
          <React.Fragment key={bar}>
            <div className="absolute top-0 bottom-0 w-px bg-white/30 pointer-events-none" style={{ left: i * zoom }} />
            <span
              className="absolute top-[6px] text-[10px] font-mono text-forge-text/90 pointer-events-none tabular-nums"
              style={{ left: i * zoom + 4 }}
            >
              {bar}.1
            </span>
            {showBeatLabels &&
              [2, 3, 4].map((beat) => (
                <span
                  key={beat}
                  className="absolute top-[8px] text-[9px] font-mono text-forge-muted/70 pointer-events-none tabular-nums"
                  style={{ left: i * zoom + ((beat - 1) * zoom) / 4 + 3 }}
                >
                  {bar}.{beat}
                </span>
              ))}
          </React.Fragment>
        );
      })}

      <Playhead variant="head" onScrubStart={onScrubStart} />
    </div>
  );
};
