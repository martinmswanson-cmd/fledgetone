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
import { svgPoint } from '../svgPoint';

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
  // A dot's drag: the points then, and where the pointer took hold (screen and drawing units). The
  // dot moves by as much as the pointer has, once it has moved 3 px: a click on a dot changes nothing
  const drag = useRef<{ index: number; points: DuckPoint[]; clientX: number; clientY: number; from: [number, number]; moved: boolean } | null>(null);
  const st = useTimelineStore.getState;
  const setPump = (patch: Partial<Track['fx']['pump']>, record = false) => st().setTrackFx(track.id, 'pump', patch, record);

  const toXY = ([x, y]: DuckPoint) => [PAD + x * (W - 2 * PAD), PAD + y * (H - 2 * PAD)] as const;
  const fromEvent = (e: React.PointerEvent | React.MouseEvent): DuckPoint => {
    const [x, y] = svgPoint(svg.current!, e.clientX, e.clientY, W, H);
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
            onClick={() => shape !== s && setPump(s === 'smooth' ? { shape: undefined } : s === 'hole' && pump.release > 200 ? { shape: s, release: 150 } : { shape: s }, true)}
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
          if (!d.moved && Math.abs(e.clientX - d.clientX) < 3 && Math.abs(e.clientY - d.clientY) < 3) return;
          d.moved = true;
          const [sx, sy] = svgPoint(svg.current!, e.clientX, e.clientY, W, H);
          const [x0, y0] = d.points[d.index];
          const x = x0 + (sx - d.from[0]) / (W - 2 * PAD);
          const y = Math.max(0, Math.min(1, y0 + (sy - d.from[1]) / (H - 2 * PAD)));
          const pts = d.points.map((q) => [...q] as DuckPoint);
          const lo = pts[d.index - 1][0] + 0.005;
          const hi = pts[d.index + 1][0] - 0.005;
          pts[d.index] = [Math.max(lo, Math.min(hi, x)), y];
          // (The points the drag started from stay its reference, so the dot follows the pointer)
          if (pts[d.index][0] === points[d.index]?.[0] && pts[d.index][1] === points[d.index]?.[1]) return;
          drawn(pts);
        }}
        onPointerUp={(e) => {
          if (!drag.current) return;
          svg.current?.releasePointerCapture(e.pointerId);
          // (A press that moved nothing leaves no undo step waiting)
          st().endEdit();
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
                drag.current = { index: i, points: handles.map((q) => [...q] as DuckPoint), clientX: e.clientX, clientY: e.clientY, from: svgPoint(svg.current!, e.clientX, e.clientY, W, H), moved: false };
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
