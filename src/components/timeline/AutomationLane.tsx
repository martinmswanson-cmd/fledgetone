/**
 * The automation lane editor drawn over a track's lane in automation view: the envelope, its
 * points and curves, and clicking, dragging and deleting them.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { AutomationParam, AutomationPoint, Track } from '../../store/timelineTypes';
import { snapBar, TOTAL_BARS } from '../../store/timelineTypes';
import { specOf, CURVE_MAX, insertPoint, lanePieceFrom, laneOf, laneValueAt, movePoints, shiftRange } from '../../audio/automation';
import { formatBarsBeats } from '../../audio/transport';
import { AutomationMenu } from './AutomationMenu';
import type { AutomationMenuState } from './AutomationMenu';
import { HEADER_WIDTH, TRACK_HEIGHT } from './layout';

/** Room above the lane's top value and below its bottom one (px). */
const PAD = 8;
const RANGE = TRACK_HEIGHT - 2 * PAD;
const yOf = (value: number) => PAD + (1 - value) * RANGE;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const valueOfY = (y: number) => clamp01(1 - (y - PAD) / RANGE);
/** How close (px) the pointer must be to grab a point, or the line. */
const POINT_HIT = 7;
const LINE_HIT = 5;
/** Pointer travel (px) that turns a click into a drag. */
const DRAG_START = 3;
/** Drawn this far (px) past each side of the view, so scrolling a little shows no gap. */
const DRAW_MARGIN = 120;
/**
 * The drawn stretch moves in steps this wide (px), so scrolling redraws the envelope once a step
 * rather than on every scroll event (with lanes open on many tracks, that added up).
 */
const DRAW_STEP = 512;
/** A double-click whose first click added the point doesn't delete it. */
const DOUBLE_CLICK_MS = 600;

const NO_POINTS: AutomationPoint[] = [];

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The lane's points as the store has them now (gestures read this rather than a render's props). */
function lanePoints(trackId: string, param: AutomationParam): AutomationPoint[] {
  const track = useTimelineStore.getState().tracks.find((t) => t.id === trackId);
  return (track && laneOf(track, param)?.points) || NO_POINTS;
}

/** Point handles as one path of circles (one SVG element for a lane with hundreds of points). */
function handlesPath(points: readonly AutomationPoint[], zoom: number, x0: number, r: number): string {
  let d = '';
  for (const p of points) {
    const x = (p.bar - 1) * zoom - x0 - r;
    d += `M${x.toFixed(1)},${yOf(p.value).toFixed(1)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`;
  }
  return d;
}

/** Index of the point within POINT_HIT px of (x, y), the nearest one (later on a tie), or -1. */
function pointAt(points: readonly AutomationPoint[], zoom: number, x: number, y: number): number {
  let best = -1;
  let bestDistance = POINT_HIT;
  points.forEach((p, i) => {
    const px = (p.bar - 1) * zoom;
    if (Math.abs(px - x) > POINT_HIT) return;
    const d = Math.hypot(px - x, yOf(p.value) - y);
    if (d <= bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/**
 * A track lane in automation view: its clips dimmed underneath, the chosen setting's envelope on
 * top (line, filled area, point handles) with its scale at the left edge of the view.
 *
 * Gestures (Selection tool): click empty space to add a point (snapped in time, Shift = free),
 * drag a point to move it (and the other selected points), Alt+drag to copy, drag the line to move
 * both its points up or down, drag a box on empty space to select points (Shift/Ctrl adds),
 * double-click or right-click a point to delete it, right-click elsewhere for the lane's menu.
 * Each gesture is one undo step.
 */
/** The time now (ms), read in event handlers. */
const clock = () => performance.now();

export const AutomationLane: React.FC<{ track: Track; param: AutomationParam }> = ({ track, param }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  // Scrolled out of sight (above or below the view), a lane draws nothing and doesn't follow
  // horizontal scrolling (drawFrom -1); it's drawn again just before it comes back into view
  const [onScreen, setOnScreen] = useState(true);
  const drawFrom = useTimelineStore((s) => (onScreen ? Math.floor(s.viewLeft / DRAW_STEP) * DRAW_STEP : -1));
  const hidden = drawFrom < 0;
  const viewWidth = useTimelineStore((s) => s.viewWidth);
  const selected = useTimelineStore((s) =>
    s.automationSelection?.trackId === track.id && s.automationSelection.param === param ? s.automationSelection.points : null
  );
  const overlayRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [menu, setMenu] = useState<AutomationMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const lastAdded = useRef<{ point: AutomationPoint; at: number } | null>(null);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const watch = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting), {
      root: el.closest('[data-timeline-scroll]'),
      rootMargin: `${TRACK_HEIGHT * 2}px 0px`,
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  // (A send's return is named from the tracks as they are: the lane re-renders with its track)
  const spec = specOf(param, track, useTimelineStore.getState().tracks);
  const points = laneOf(track, param)?.points ?? NO_POINTS;
  // A lane of an effect's setting while the effect is off is kept, but silent
  const silent = !!spec.insert && !(track.fx[spec.insert] as { on?: boolean } | undefined)?.on;

  // ---------- Drawing (only around the stretch on screen: the lane can be 500,000 px wide) ----------
  const x0 = Math.max(0, drawFrom - DRAW_MARGIN);
  const x1 = Math.min(TOTAL_BARS * zoom, drawFrom + DRAW_STEP + viewWidth + DRAW_MARGIN);
  const barL = x0 / zoom + 1;
  const barR = x1 / zoom + 1;
  const ownValue = spec.toNorm(spec.trackValue(track));
  // Built only when what's drawn changes (not on a drag's tooltip, the box, or a menu)
  const envelope = useMemo(() => {
    if (hidden || !points.length) return null;
    const visible = points.filter((p) => p.bar >= barL && p.bar <= barR);
    const corners: Array<[number, number]> = [[x0, laneValueAt(points, barL)!], ...visible.map((p): [number, number] => [(p.bar - 1) * zoom, p.value]), [x1, laneValueAt(points, barR)!]];
    // A bent line is drawn as short straight steps along it (about every 4 px)
    const traced: Array<[number, number]> = [];
    corners.forEach(([x, v], i) => {
      const prev = corners[i - 1];
      if (prev && x - prev[0] > 8) {
        const barA = prev[0] / zoom + 1;
        if (lanePieceFrom(points, barA, Infinity).curved) {
          const steps = Math.ceil((x - prev[0]) / 4);
          for (let k = 1; k < steps; k++) {
            const xk = prev[0] + ((x - prev[0]) * k) / steps;
            traced.push([xk, laneValueAt(points, xk / zoom + 1)!]);
          }
        }
      }
      traced.push([x, v]);
    });
    const line = traced.map(([x, v], i) => `${i ? 'L' : 'M'}${(x - x0).toFixed(1)},${yOf(v).toFixed(1)}`).join('');
    const chosen = selected ? visible.filter((p) => selected.has(p)) : [];
    const others = chosen.length ? visible.filter((p) => !selected!.has(p)) : visible;
    return (
      <>
        <path d={`${line}L${(x1 - x0).toFixed(1)},${TRACK_HEIGHT}L0,${TRACK_HEIGHT}Z`} fill={track.color} fillOpacity={0.16} />
        <path d={line} fill="none" stroke={track.color} strokeWidth={2} strokeLinejoin="round" />
        <path d={handlesPath(others, zoom, x0, 3.5)} fill={track.color} stroke="#0b0f14" strokeWidth={1.5} />
        {chosen.length > 0 && <path d={handlesPath(chosen, zoom, x0, 4.5)} fill="#ffffff" stroke={track.color} strokeWidth={1.5} />}
      </>
    );
  }, [hidden, points, selected, zoom, x0, x1, barL, barR, track.color]);

  // ---------- Gestures ----------
  const local = (e: { clientX: number; clientY: number }) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const store = useTimelineStore.getState;
  const describe = (p: AutomationPoint) => `${spec.format(spec.toReal(p.value))} · ${formatBarsBeats(p.bar)}`;

  /** Run a drag: `move` on each pointer move past the drag threshold, `click` if it never got there. */
  const follow = (e: React.PointerEvent, move: (ev: PointerEvent, from: { x: number; y: number }) => void, click?: (ev: PointerEvent) => void) => {
    const from = local(e);
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      // The lane closed mid-gesture (its view toggled off): stop here
      if (!overlayRef.current) return onUp(ev);
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_START) return;
      moved = true;
      move(ev, from);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setTip(null);
      setBox(null);
      if (!moved && ev.type === 'pointerup' && overlayRef.current) click?.(ev);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Drag the selected points (the grabbed one leads the snap): one undo step, taken at the first change. */
  const dragPoints = (e: React.PointerEvent, pts: AutomationPoint[], chosen: ReadonlySet<AutomationPoint>, grabbed: number) => {
    const indices = new Set(pts.flatMap((p, i) => (chosen.has(p) ? [i] : [])));
    const [minBars, maxBars] = shiftRange(pts, indices);
    const values = [...indices].map((i) => pts[i].value);
    const minValue = -Math.min(...values);
    const maxValue = 1 - Math.max(...values);
    const grab = pts[grabbed];
    const copy = e.altKey;
    let followTime = false;
    let applied = '0|0';
    let committed = false;
    follow(e, (ev, from) => {
      const s = store();
      const at = local(ev);
      if (Math.abs(at.x - from.x) >= DRAG_START) followTime = true;
      // Time follows only once the pointer has gone sideways, so a drag straight up keeps it in place
      let bars = 0;
      if (followTime) {
        const target = grab.bar + (at.x - from.x) / s.zoom;
        bars = (ev.shiftKey ? target : snapBar(target, s.snapGrid, s)) - grab.bar;
      }
      bars = Math.max(minBars, Math.min(maxBars, bars));
      const value = Math.max(minValue, Math.min(maxValue, valueOfY(at.y) - valueOfY(from.y)));
      const key = `${bars}|${value}`;
      if (key === applied) return;
      applied = key;
      if (!committed) {
        committed = true;
        s.checkpoint();
      }
      const result = movePoints(pts, indices, bars, value, copy);
      s.setAutomationPoints(track.id, param, result.points, false, result.moved);
      const lead = { bar: Math.max(1, grab.bar + bars), value: clamp01(grab.value + value) };
      setTip({ x: (lead.bar - 1) * s.zoom, y: yOf(lead.value), text: describe(lead) });
    });
  };

  /**
   * Alt-drag the line between two points to bend it: up or down pulls its middle that way (a build
   * that starts slow and rushes in, or a fade that drops away then settles). One undo step.
   */
  const bendLine = (e: React.PointerEvent, pts: AutomationPoint[], bar: number) => {
    const after = pts.findIndex((p) => p.bar > bar);
    if (after <= 0) return false;
    const left = after - 1;
    const a = pts[left];
    const b = pts[after];
    if (a.value === b.value) return false;
    const start = a.curve ?? 0;
    const direction = Math.sign(b.value - a.value);
    let applied = start;
    let committed = false;
    follow(e, (ev, from) => {
      const dy = local(ev).y - from.y;
      const curve = Math.round(Math.max(-CURVE_MAX, Math.min(CURVE_MAX, start + (direction * dy) / 60)) * 100) / 100;
      if (curve === applied) return;
      applied = curve;
      const s = store();
      if (!committed) {
        committed = true;
        s.checkpoint();
      }
      const bent: AutomationPoint = curve ? { ...a, curve } : { bar: a.bar, value: a.value };
      const next = pts.map((p, i) => (i === left ? bent : p));
      s.setAutomationPoints(track.id, param, next, false);
      const mid = (a.bar + b.bar) / 2;
      setTip({ x: (mid - 1) * s.zoom, y: yOf(laneValueAt(next, mid)!), text: curve ? `Bend ${curve > 0 ? '+' : ''}${Math.round(curve * 100)}%` : 'Straight' });
    });
    return true;
  };

  /** Drag the line between two points (or the flat run before the first / after the last) up or down. */
  const dragLine = (e: React.PointerEvent, pts: AutomationPoint[], bar: number) => {
    const after = pts.findIndex((p) => p.bar > bar);
    const indices = after === 0 ? [0] : after === -1 ? [pts.length - 1] : [after - 1, after];
    const minValue = -Math.min(...indices.map((i) => pts[i].value));
    const maxValue = 1 - Math.max(...indices.map((i) => pts[i].value));
    let applied = 0;
    let committed = false;
    follow(
      e,
      (ev, from) => {
        const value = Math.max(minValue, Math.min(maxValue, valueOfY(local(ev).y) - valueOfY(from.y)));
        if (value === applied) return;
        applied = value;
        const s = store();
        if (!committed) {
          committed = true;
          s.checkpoint();
        }
        const result = movePoints(pts, new Set(indices), 0, value, false);
        s.setAutomationPoints(track.id, param, result.points, false, result.moved);
        const at = local(ev);
        setTip({ x: at.x, y: yOf(laneValueAt(result.points, bar)!), text: spec.format(spec.toReal(laneValueAt(result.points, bar)!)) });
      },
      // A click on the line adds a point on it
      (ev) => addPoint(ev, true)
    );
  };

  /** Add a point under the pointer (on the line itself with `onLine`), selected. One undo step. */
  const addPoint = (ev: { clientX: number; clientY: number; shiftKey: boolean }, onLine = false) => {
    const s = store();
    const { x, y } = local(ev);
    const raw = x / s.zoom + 1;
    const bar = Math.max(1, Math.min(TOTAL_BARS + 1, ev.shiftKey ? raw : snapBar(raw, s.snapGrid, s)));
    const pts = lanePoints(track.id, param);
    const value = onLine && pts.length ? laneValueAt(pts, bar)! : valueOfY(y);
    const point = { bar, value };
    s.setAutomationPoints(track.id, param, insertPoint(pts, point).points, true, new Set([point]));
    lastAdded.current = { point, at: clock() };
  };

  /** Box-select points; Shift/Ctrl adds to the selection. A click on empty space adds a point instead. */
  const boxSelect = (e: React.PointerEvent, additive: boolean) => {
    const base = additive && selected ? [...selected] : [];
    follow(
      e,
      (ev, from) => {
        const at = local(ev);
        const b = { x0: Math.min(from.x, at.x), y0: Math.min(from.y, at.y), x1: Math.max(from.x, at.x), y1: Math.max(from.y, at.y) };
        setBox(b);
        const s = store();
        const inside = lanePoints(track.id, param).filter((p) => {
          const px = (p.bar - 1) * s.zoom;
          const py = yOf(p.value);
          return px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1;
        });
        s.selectAutomationPoints({ trackId: track.id, param, points: new Set([...base, ...inside]) });
      },
      (ev) => addPoint(ev)
    );
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Not a clip marquee or a playhead scrub
    e.stopPropagation();
    e.preventDefault();
    const s = store();
    const pts = lanePoints(track.id, param);
    const { x, y } = local(e);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const hit = pointAt(pts, s.zoom, x, y);
    if (hit >= 0) {
      const point = pts[hit];
      const current = selected ?? new Set<AutomationPoint>();
      if (additive) {
        const next = new Set(current);
        if (next.has(point)) next.delete(point);
        else next.add(point);
        s.selectAutomationPoints({ trackId: track.id, param, points: next });
        return;
      }
      const chosen = current.has(point) ? current : new Set([point]);
      if (chosen !== current) s.selectAutomationPoints({ trackId: track.id, param, points: chosen });
      dragPoints(e, pts, chosen, hit);
      return;
    }
    const bar = x / s.zoom + 1;
    if (pts.length && !additive && Math.abs(yOf(laneValueAt(pts, bar)!) - y) <= LINE_HIT) {
      // Alt bends the line; otherwise it moves up or down
      if (e.altKey && bendLine(e, pts, bar)) return;
      dragLine(e, pts, bar);
      return;
    }
    boxSelect(e, additive);
  };

  /** Delete the point under the pointer (one undo step). False if there's none. */
  const deletePointAt = (e: React.MouseEvent) => {
    const s = store();
    const pts = lanePoints(track.id, param);
    const { x, y } = local(e);
    const hit = pointAt(pts, s.zoom, x, y);
    if (hit < 0) return false;
    s.setAutomationPoints(track.id, param, pts.filter((_, i) => i !== hit), true);
    return true;
  };

  return (
    <>
      {/* Dims the clips, under the playhead's needle */}
      <div className="absolute inset-0 z-[12] bg-forge-bg/60 pointer-events-none" />
      {/* The editor: above the playhead's grab zone, so a point under the playhead can still be grabbed */}
      <div
        ref={overlayRef}
        data-automation-lane={param}
        className="absolute inset-0 z-[16] cursor-crosshair touch-none select-none"
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          // The double-click that added a point (by its first click) leaves it be
          const added = lastAdded.current;
          const pts = lanePoints(track.id, param);
          const s = store();
          const { x, y } = local(e);
          const hit = pointAt(pts, s.zoom, x, y);
          if (hit >= 0 && added?.point === pts[hit] && clock() - added.at < DOUBLE_CLICK_MS) return;
          deletePointAt(e);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!deletePointAt(e)) setMenu({ x: e.clientX, y: e.clientY, trackId: track.id, param, bar: local(e).x / store().zoom + 1 });
        }}
      >
        <svg
          className={`absolute top-0 pointer-events-none ${silent ? 'opacity-40' : ''}`}
          style={{ left: x0, width: Math.max(0, x1 - x0), height: TRACK_HEIGHT }}
          aria-hidden="true"
        >
          {spec.scale.map(({ value }) => (
            <line key={value} x1={0} x2={x1 - x0} y1={yOf(spec.toNorm(value))} y2={yOf(spec.toNorm(value))} stroke="rgba(255,255,255,0.08)" strokeDasharray="2 4" />
          ))}
          {hidden ? null : envelope ?? (
            // No points yet: the setting stays at the track's own value
            <line x1={0} x2={x1 - x0} y1={yOf(ownValue)} y2={yOf(ownValue)} stroke={track.color} strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="6 4" />
          )}
        </svg>

        {/* Scale and notes, held at the left edge of the view as it scrolls */}
        <div className="sticky h-full w-0 pointer-events-none" style={{ left: HEADER_WIDTH }}>
          {spec.scale.map(({ value, label }) => (
            <span
              key={value}
              className="absolute left-1 -translate-y-1/2 px-0.5 rounded-sm bg-forge-bg/75 text-[9px] leading-none font-mono text-forge-muted whitespace-nowrap"
              style={{ top: yOf(spec.toNorm(value)) }}
            >
              {label}
            </span>
          ))}
          {silent ? (
            <div className="absolute left-12 top-1.5 flex items-center gap-1.5 whitespace-nowrap text-[10px] font-mono text-amber-200 bg-forge-panel/90 border border-amber-500/40 rounded px-1.5 py-0.5 pointer-events-auto">
              <button
                type="button"
                className="px-1.5 rounded border border-amber-400/70 text-amber-100 hover:bg-amber-500/25"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  useTimelineStore.getState().setTrackFx(track.id, 'filter', { on: true }, true);
                }}
              >
                Turn filter on
              </button>
              The Filter is off: this lane is silent
            </div>
          ) : (
            points.length === 0 && (
              // Bottom right, clear of the clip names along the top
              <span className="absolute right-2 bottom-1 whitespace-nowrap text-[10px] font-mono text-forge-muted pointer-events-none">
                {spec.label}: click to add a point, drag a box to select
              </span>
            )
          )}
        </div>

        {box && (
          <div
            className="absolute pointer-events-none border border-cyan-300/90 bg-cyan-400/15 rounded-sm"
            style={{ left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0 }}
          />
        )}
        {tip && (
          <div
            className="absolute z-10 pointer-events-none -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/85 border border-forge-borderLight text-[10px] font-mono text-white whitespace-nowrap tabular-nums"
            style={{ left: tip.x, top: Math.max(0, tip.y - 24) }}
          >
            {tip.text}
          </div>
        )}
      </div>
      {menu && <AutomationMenu menu={menu} onClose={closeMenu} />}
    </>
  );
};
