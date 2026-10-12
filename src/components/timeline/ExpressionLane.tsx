import React, { useRef, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, ExprPoint } from '../../store/timelineTypes';
import { EXPR_LANES, exprSpec, exprValueAt, type ExprLane } from '../../store/expression';

/**
 * The piano roll's controller lane under the notes: pitch bend, mod wheel (vibrato) or sustain
 * pedal, as a MIDI keyboard's wheels and pedal would play them. Bend and mod: click to add a point,
 * drag one to move it, right-click (or double-click) one to remove it; the lane glides between
 * points. Sustain: drag along the lane to hold the pedal down there, click a held stretch to lift it.
 */

export const EXPRESSION_LANE_H = 76;
const PAD = 6;

interface Props {
  clip: Clip;
  /** Width of the keyboard column on the left */
  keyWidth: number;
  /** px per bar in the piano roll */
  barW: number;
  /** Snap a position (bars from the clip's start) to the piano roll's grid; Shift skips it */
  snap: (at: number) => number;
}

export const ExpressionLane: React.FC<Props> = ({ clip, keyWidth, barW, snap }) => {
  const [lane, setLane] = useState<ExprLane>('bend');
  const [bendRange, setBendRange] = useState(2);
  const svgRef = useRef<SVGSVGElement>(null);
  const spec = exprSpec(lane);
  const points = clip.expression?.[lane] ?? [];
  const width = clip.lengthBars * barW;
  const h = EXPRESSION_LANE_H;
  const lo = lane === 'bend' ? -bendRange : spec.min;
  const hi = lane === 'bend' ? bendRange : spec.max;
  const yOf = (v: number) => PAD + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (h - 2 * PAD);
  const valueOf = (y: number) => lo + (1 - (y - PAD) / (h - 2 * PAD)) * (hi - lo);
  const xOf = (at: number) => at * barW;
  const store = () => useTimelineStore.getState();
  const write = (next: ExprPoint[], record: boolean) => store().setClipExpression(clip.id, lane, next, record);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const atOf = (x: number, shift: boolean) => Math.max(0, Math.min(clip.lengthBars, shift ? x / barW : snap(x / barW)));
  const round = (v: number) => (lane === 'bend' ? Math.round(v * 4) / 4 : Math.round(v * 100) / 100);

  /** Drag a point (or a new one) with the pointer. */
  const dragPoint = (e: React.PointerEvent, index: number, start: ExprPoint[]) => {
    e.preventDefault();
    e.stopPropagation();
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const { x, y } = local(ev);
      if (!moved) {
        moved = true;
        store().checkpoint();
      }
      const next = start.map((p, i) => (i === index ? { at: atOf(x, ev.shiftKey), value: round(valueOf(y)) } : p));
      write(next, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (spec.step) {
      // Sustain: a click in a held stretch lifts the pedal there; a drag holds it from here to there
      const at = atOf(x, e.shiftKey);
      if (exprValueAt(points, at, true) >= 0.5) {
        const downIndex = points.reduce((k, p, i) => (p.at <= at + 1e-9 && p.value >= 0.5 ? i : k), -1);
        const upIndex = points.findIndex((p, i) => i > downIndex && p.value < 0.5);
        write(points.filter((_, i) => i !== downIndex && i !== upIndex), true);
        return;
      }
      e.preventDefault();
      store().checkpoint();
      const from = at;
      const paint = (to: number) => {
        const a = Math.min(from, to);
        const b = Math.max(from, to, a + 1 / 16);
        const kept = points.filter((p) => p.at < a - 1e-9 || p.at > b + 1e-9);
        write([...kept, { at: a, value: 1 }, ...(b < clip.lengthBars - 1e-9 ? [{ at: b, value: 0 }] : [])], false);
      };
      paint(from);
      const onMove = (ev: PointerEvent) => paint(atOf(local(ev).x, ev.shiftKey));
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
    // Bend / mod: a new point, then dragged as long as the button's held
    const point = { at: atOf(x, e.shiftKey), value: round(valueOf(y)) };
    const next = [...points.filter((p) => Math.abs(p.at - point.at) > 1e-9), point].sort((a, b) => a.at - b.at);
    store().checkpoint();
    write(next, false);
    dragPoint(e, next.indexOf(point), next);
  };

  // The lane's line: resting before the first point, between points, held after the last
  let path = '';
  if (!spec.step) {
    const pts: Array<[number, number]> = [[0, yOf(exprValueAt(points, 0))]];
    for (const p of points) if (p.at > 0) pts.push([xOf(p.at), yOf(p.value)]);
    pts.push([width, yOf(exprValueAt(points, clip.lengthBars))]);
    path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  }
  const held: Array<[number, number]> = [];
  if (spec.step) {
    let downAt: number | null = null;
    for (const p of points) {
      if (p.value >= 0.5 && downAt === null) downAt = p.at;
      else if (p.value < 0.5 && downAt !== null) {
        held.push([downAt, p.at]);
        downAt = null;
      }
    }
    if (downAt !== null) held.push([downAt, clip.lengthBars]);
  }

  return (
    <div className="sticky bottom-0 z-20 flex border-t border-forge-border bg-forge-panel" style={{ height: h, width: keyWidth + width }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sticky left-0 z-10 shrink-0 flex flex-col gap-0.5 p-1 bg-forge-panel border-r border-forge-border" style={{ width: keyWidth }}>
        {EXPR_LANES.map((l) => (
          <button
            key={l.lane}
            type="button"
            onClick={() => setLane(l.lane)}
            className={`h-[18px] rounded text-[9px] font-mono leading-none ${lane === l.lane ? 'bg-cyan-500/25 text-cyan-100' : 'text-forge-muted hover:text-forge-text'} ${
              clip.expression?.[l.lane]?.some((p) => p.value !== 0) ? 'underline decoration-cyan-400/70' : ''
            }`}
            title={l.lane === 'bend' ? 'Pitch bend: every note bends together' : l.lane === 'mod' ? 'Mod wheel: vibrato, deeper as it goes up' : 'Sustain pedal: notes let go while it\'s down ring on'}
            aria-pressed={lane === l.lane}
          >
            {l.label}
          </button>
        ))}
        {lane === 'bend' && (
          <button type="button" className="h-[14px] text-[8px] font-mono text-forge-muted hover:text-forge-text" onClick={() => setBendRange((r) => (r === 2 ? 12 : 2))} title="The range shown (bends go up to 12 semitones)">
            ±{bendRange} st
          </button>
        )}
      </div>
      <svg ref={svgRef} width={width} height={h} className="block cursor-crosshair" onPointerDown={onBackgroundDown} aria-label={`${spec.label} lane`}>
        {/* Rest line (no bend / wheel down) */}
        <line x1={0} x2={width} y1={yOf(lane === 'bend' ? 0 : lo)} y2={yOf(lane === 'bend' ? 0 : lo)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
        {/* Bar lines */}
        {Array.from({ length: Math.ceil(clip.lengthBars) + 1 }, (_, b) => (
          <line key={b} x1={xOf(b)} x2={xOf(b)} y1={0} y2={h} stroke="rgba(255,255,255,0.08)" />
        ))}
        {held.map(([a, b]) => (
          <rect key={a} x={xOf(a)} y={PAD + 8} width={Math.max(2, xOf(b) - xOf(a))} height={h - 2 * PAD - 16} rx={3} fill="rgba(34,211,238,0.35)" stroke="rgba(34,211,238,0.8)" />
        ))}
        {path && <path d={path} fill="none" stroke="rgb(34,211,238)" strokeWidth={1.5} />}
        {!spec.step &&
          points.map((p, i) => (
            <circle
              key={`${p.at}-${i}`}
              cx={xOf(p.at)}
              cy={yOf(p.value)}
              r={4}
              fill="rgb(34,211,238)"
              stroke="#0c0c0e"
              className="cursor-grab"
              onPointerDown={(e) => (e.button === 0 ? dragPoint(e, i, points) : undefined)}
              onDoubleClick={() => write(points.filter((_, k) => k !== i), true)}
              onContextMenu={(e) => {
                e.preventDefault();
                write(points.filter((_, k) => k !== i), true);
              }}
            >
              <title>{lane === 'bend' ? `${p.value > 0 ? '+' : ''}${p.value} semitones` : `${Math.round(p.value * 100)}%`} (right-click to remove)</title>
            </circle>
          ))}
      </svg>
    </div>
  );
};
