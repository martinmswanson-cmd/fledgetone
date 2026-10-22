/**
 * The Pump's duck shape: preset buttons (Smooth, Hard cut, Short tick, Long swell, Hole for
 * drums) and the curve over one duck, drawn as it plays. Drag a point to draw your own (the shape
 * becomes Drawn); click the curve to add a point, double-click a point to take it away. The first
 * and last points stay at full volume, so a duck never clicks. Each drag is one undo step.
 */
import React, { useRef } from 'react';
import { curveAt, MAX_DUCK_POINTS, normalizeDuckPoints, PUMP_SHAPE_INFO, PUMP_SHAPES, SHAPE_POINTS, type DuckPoint, type PumpShape } from '../../audio/effects/duckShape';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';

const W = 220;
const H = 64;
const PAD = 6;

/** The Smooth shape as points, for drawing (and as the start of a drawn one): a 4 ms dip, then the raised-cosine swell. */
function smoothPoints(releaseMs: number): DuckPoint[] {
  const a = Math.min(0.2, 4 / Math.max(10, releaseMs + 4));
  const pts: DuckPoint[] = [[0, 0], [a, 1]];
  for (let k = 1; k <= 8; k++) pts.push([a + ((1 - a) * k) / 8, 1 - (1 - Math.cos((Math.PI * k) / 8)) / 2]);
  return pts;
}

function pointsOf(pump: Track['fx']['pump']): DuckPoint[] {
  const shape = pump.shape ?? 'smooth';
  if (shape === 'drawn' && pump.points) return pump.points;
  if (shape !== 'smooth' && shape !== 'drawn') return SHAPE_POINTS[shape].map((p) => [...p] as DuckPoint);
  return smoothPoints(pump.release);
}

export const DuckShapeEditor: React.FC<{ track: Track; accent: string; disabled: boolean }> = ({ track, accent, disabled }) => {
  const pump = track.fx.pump;
  const shape: PumpShape = pump.shape === 'drawn' && !pump.points ? 'smooth' : (pump.shape ?? 'smooth');
  const points = pointsOf(pump);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; points: DuckPoint[] } | null>(null);
  const st = useTimelineStore.getState;
  const setPump = (patch: Partial<Track['fx']['pump']>, record = false) => st().setTrackFx(track.id, 'pump', patch, record);

  const toXY = ([x, y]: DuckPoint) => [PAD + x * (W - 2 * PAD), PAD + y * (H - 2 * PAD)] as const;
  const fromEvent = (e: React.PointerEvent | React.MouseEvent): DuckPoint => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    return [Math.max(0, Math.min(1, (x - PAD) / (W - 2 * PAD))), Math.max(0, Math.min(1, (y - PAD) / (H - 2 * PAD)))];
  };
  const drawn = (pts: DuckPoint[]) => {
    const clean = normalizeDuckPoints(pts);
    if (clean) setPump({ shape: 'drawn', points: clean });
  };

  // The curve as it plays: straight lines between the points (Smooth drawn finely)
  const line = Array.from({ length: 61 }, (_, i) => toXY([i / 60, curveAt(points, i / 60)]).join(',')).join(' ');
  const handles = shape === 'smooth' ? [] : points;

  return (
    <div className={`flex flex-col gap-1 ${disabled ? 'opacity-45 pointer-events-none' : ''}`} data-testid="duck-shape">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Duck shape">
        {PUMP_SHAPES.filter((s) => s !== 'drawn' || pump.points).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={shape === s}
            title={PUMP_SHAPE_INFO[s].about}
            // (A hole is short: its dip, hold and return fit in about 150 ms)
            onClick={() => setPump(s === 'smooth' ? { shape: undefined } : s === 'hole' && pump.release > 200 ? { shape: s, release: 150 } : { shape: s }, true)}
            className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${shape === s ? 'text-black' : 'bg-black/40 text-forge-muted border-forge-border hover:text-white'}`}
            style={shape === s ? { backgroundColor: accent, borderColor: accent } : undefined}
          >
            {PUMP_SHAPE_INFO[s].label}
          </button>
        ))}
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-16 rounded bg-black/40 border border-forge-border touch-none cursor-crosshair"
        role="img"
        aria-label={`Duck shape: ${PUMP_SHAPE_INFO[shape].label}. Drag a point to draw your own.`}
        onClick={(e) => {
          if (drag.current || e.detail > 1) return;
          // Click on the curve: a new point there
          const p = fromEvent(e);
          if (points.length >= MAX_DUCK_POINTS || p[0] <= 0 || p[0] >= 1) return;
          st().checkpoint();
          drawn([...points, p]);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const [x, y] = fromEvent(e);
          const pts = d.points.map((q) => [...q] as DuckPoint);
          const lo = pts[d.index - 1][0] + 0.005;
          const hi = pts[d.index + 1][0] - 0.005;
          pts[d.index] = [Math.max(lo, Math.min(hi, x)), y];
          d.points = pts;
          drawn(pts);
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          svg.current?.releasePointerCapture(e.pointerId);
          // (The click after the drag adds nothing)
          setTimeout(() => (drag.current = null), 0);
        }}
      >
        <line x1={PAD} x2={W - PAD} y1={PAD} y2={PAD} stroke="#ffffff22" />
        <line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke="#ffffff22" />
        <polyline points={line} fill="none" stroke={accent} strokeWidth={1.6} />
        {handles.map((p, i) => {
          if (i === 0 || i === handles.length - 1) return null;
          const [cx, cy] = toXY(p);
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={4}
              fill="#000"
              stroke={accent}
              strokeWidth={1.5}
              className="cursor-grab"
              onPointerDown={(e) => {
                e.stopPropagation();
                st().beginEdit();
                svg.current?.setPointerCapture(e.pointerId);
                drag.current = { index: i, points: handles.map((q) => [...q] as DuckPoint) };
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                st().checkpoint();
                drawn(handles.filter((_, j) => j !== i));
              }}
            />
          );
        })}
      </svg>
      <p className="text-[10px] text-forge-muted leading-snug">{PUMP_SHAPE_INFO[shape].about}</p>
    </div>
  );
};
