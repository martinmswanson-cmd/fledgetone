import React, { useRef, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, ExprPoint, NoteEvent } from '../../store/timelineTypes';
import { durationToBars } from '../../store/timelineTypes';
import { ccLabel, ccLane, EXPR_LANES, exprSpec, exprValueAt, laneCc, lanesOf, type ExprLane } from '../../store/expression';
import { NOTE_LANES, noteLaneSpec, noteValueAt, type NoteLane } from '../../store/noteExpression';
import { ccTarget } from '../../store/ccLanes';
import { specOf } from '../../audio/automation';

/**
 * The piano roll's controller lane under the notes. The clip's lanes: pitch bend, mod wheel
 * (vibrato), sustain pedal, and any MIDI controller by number (CC lanes move the setting the
 * controller is mapped to, and plugins get them as MIDI). And, with one note selected, that note's
 * own bend and pressure (per-note expression). Curves: click to add a point, drag one to move it,
 * right-click (or double-click) one to remove it; the lane glides between points. Sustain: drag
 * along the lane to hold the pedal down there, click a held stretch to lift it.
 */

export const EXPRESSION_LANE_H = 76;
const PAD = 6;

type Mode = { kind: 'clip'; lane: ExprLane } | { kind: 'note'; lane: NoteLane };

interface Props {
  clip: Clip;
  /** Width of the keyboard column on the left */
  keyWidth: number;
  /** px per bar in the piano roll */
  barW: number;
  /** Snap a position (bars from the clip's start) to the piano roll's grid; Shift skips it */
  snap: (at: number) => number;
  /** The one note selected (its own expression can be drawn), if any */
  note?: NoteEvent;
}

export const ExpressionLane: React.FC<Props> = ({ clip, keyWidth, barW, snap, note }) => {
  const [chosen, setMode] = useState<Mode>({ kind: 'clip', lane: 'bend' });
  const [bendRange, setBendRange] = useState(2);
  const svgRef = useRef<SVGSVGElement>(null);
  // A note lane with no note selected shows the clip's bend
  const mode: Mode = chosen.kind === 'note' && !note ? { kind: 'clip', lane: 'bend' } : chosen;
  const track = useTimelineStore((s) => s.tracks.find((t) => t.id === clip.trackId));
  const store = () => useTimelineStore.getState();
  const width = clip.lengthBars * barW;
  const h = EXPRESSION_LANE_H;

  // The stretch the lane covers (bars into the clip), and its points in clip time
  const span: [number, number] = mode.kind === 'note' && note ? [note.startOffset, Math.min(clip.lengthBars, note.startOffset + durationToBars(note.duration))] : [0, clip.lengthBars];
  const offset = mode.kind === 'note' ? span[0] : 0;
  const raw: ExprPoint[] = mode.kind === 'note' ? (note?.expr?.[mode.lane] ?? []) : (clip.expression?.[mode.lane] ?? []);
  const points = raw.map((p) => ({ at: p.at + offset, value: p.value }));
  const isBend = mode.lane === 'bend';
  const step = mode.kind === 'clip' && exprSpec(mode.lane).step;
  const [min, max] = mode.kind === 'note' ? [noteLaneSpec(mode.lane).min, noteLaneSpec(mode.lane).max] : [exprSpec(mode.lane).min, exprSpec(mode.lane).max];
  const lo = isBend ? -bendRange : min;
  const hi = isBend ? bendRange : max;
  const valueAt = (at: number) => (mode.kind === 'note' ? noteValueAt(raw, at - offset, mode.lane) : laneCc(mode.lane) !== null && raw.length && at <= raw[0].at ? raw[0].value : exprValueAt(raw, at, step));
  const rest = mode.kind === 'note' ? noteLaneSpec(mode.lane).rest : isBend ? 0 : lo;
  const yOf = (v: number) => PAD + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (h - 2 * PAD);
  const valueOf = (y: number) => lo + (1 - (y - PAD) / (h - 2 * PAD)) * (hi - lo);
  const xOf = (at: number) => at * barW;
  const write = (next: ExprPoint[], record: boolean) => {
    const local = next.map((p) => ({ at: p.at - offset, value: p.value }));
    if (mode.kind === 'note') store().setNoteExpression(clip.id, note!.id, mode.lane, local, record);
    else store().setClipExpression(clip.id, mode.lane, local, record);
  };

  const pointer = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const atOf = (x: number, shift: boolean) => Math.max(span[0], Math.min(span[1], shift ? x / barW : snap(x / barW)));
  const round = (v: number) => (isBend ? Math.round(v * 4) / 4 : Math.round(v * 100) / 100);

  /** Drag a point (or a new one) with the pointer. */
  const dragPoint = (e: React.PointerEvent, index: number, start: ExprPoint[]) => {
    e.preventDefault();
    e.stopPropagation();
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const { x, y } = pointer(ev);
      if (!moved) {
        moved = true;
        store().checkpoint();
      }
      write(start.map((p, i) => (i === index ? { at: atOf(x, ev.shiftKey), value: round(valueOf(y)) } : p)), false);
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
    const { x, y } = pointer(e);
    if (x < xOf(span[0]) - 2 || x > xOf(span[1]) + 2) return;
    if (step) {
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
      const onMove = (ev: PointerEvent) => paint(atOf(pointer(ev).x, ev.shiftKey));
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
    // A curve: a new point, then dragged as long as the button's held
    const point = { at: atOf(x, e.shiftKey), value: round(valueOf(y)) };
    const next = [...points.filter((p) => Math.abs(p.at - point.at) > 1e-9), point].sort((a, b) => a.at - b.at);
    store().checkpoint();
    write(next, false);
    dragPoint(e, next.indexOf(point), next);
  };

  // The lane's line over its span: resting (or held at its first point) before it, between points, held after the last
  let path = '';
  if (!step) {
    const pts: Array<[number, number]> = [[xOf(span[0]), yOf(valueAt(span[0]))]];
    for (const p of points) if (p.at > span[0] && p.at < span[1]) pts.push([xOf(p.at), yOf(p.value)]);
    pts.push([xOf(span[1]), yOf(valueAt(span[1]))]);
    path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  }
  const held: Array<[number, number]> = [];
  if (step) {
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

  const ccLanes = lanesOf(clip.expression).filter((l) => laneCc(l) !== null);
  const currentCc = mode.kind === 'clip' ? laneCc(mode.lane) : null;
  if (currentCc !== null && !ccLanes.includes(mode.lane as ExprLane)) ccLanes.push(mode.lane as ExprLane);
  const target = currentCc !== null && track ? ccTarget(track, currentCc) : undefined;
  const label = (v: number) =>
    mode.kind === 'note' ? (mode.lane === 'bend' ? `${v > 0 ? '+' : ''}${v} semitones` : `${Math.round(v * 100)}% pressure`) : isBend ? `${v > 0 ? '+' : ''}${v} semitones` : currentCc !== null ? `${Math.round(v * 127)} (${Math.round(v * 100)}%)` : `${Math.round(v * 100)}%`;

  return (
    <div className="sticky bottom-0 z-20 flex border-t border-forge-border bg-forge-panel" style={{ height: h, width: keyWidth + width }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sticky left-0 z-10 shrink-0 flex flex-col gap-1 p-1 bg-forge-panel border-r border-forge-border" style={{ width: keyWidth }}>
        <select
          value={mode.kind === 'note' ? `note:${mode.lane}` : `clip:${mode.lane}`}
          onChange={(e) => {
            const [kind, lane] = e.target.value.split(':');
            setMode(kind === 'note' ? { kind: 'note', lane: lane as NoteLane } : { kind: 'clip', lane: lane as ExprLane });
          }}
          className="w-full h-6 bg-forge-bg border border-forge-border rounded text-[10px] font-mono text-forge-text"
          aria-label="Controller lane"
          title="The lane drawn here: the clip's wheels and pedal, a MIDI controller (CC) lane, or the selected note's own bend and pressure"
        >
          <optgroup label="Clip">
            {EXPR_LANES.map((l) => (
              <option key={l.lane} value={`clip:${l.lane}`}>
                {clip.expression?.[l.lane]?.some((p) => p.value !== 0) ? '● ' : ''}
                {l.label}
              </option>
            ))}
            {ccLanes.map((l) => (
              <option key={l} value={`clip:${l}`}>
                {clip.expression?.[l]?.length ? '● ' : ''}
                {ccLabel(laneCc(l)!)}
              </option>
            ))}
          </optgroup>
          <optgroup label={note ? 'Selected note' : 'Selected note (select one)'}>
            {NOTE_LANES.map((l) => (
              <option key={l.lane} value={`note:${l.lane}`} disabled={!note}>
                {note?.expr?.[l.lane]?.length ? '● ' : ''}
                {l.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Add a controller lane">
            {Array.from({ length: 120 }, (_, n) => n)
              .filter((n) => n !== 1 && n !== 64 && !ccLanes.includes(ccLane(n)))
              .map((n) => (
                <option key={n} value={`clip:${ccLane(n)}`}>
                  {ccLabel(n)}
                </option>
              ))}
          </optgroup>
        </select>
        <span className="text-[9px] font-mono leading-tight text-forge-muted line-clamp-2" title={currentCc !== null ? (target ? `Moves ${specOf(target, track, useTimelineStore.getState().tracks).label}` : 'Plugins get it as MIDI; map it with MIDI learn to move a setting') : undefined}>
          {mode.kind === 'note' ? 'this note only' : currentCc !== null ? (target ? `→ ${specOf(target, track, useTimelineStore.getState().tracks).label}` : '→ plugins (MIDI)') : mode.lane === 'bend' ? 'all notes' : ''}
        </span>
        {isBend && (
          <button type="button" className="self-start h-[14px] text-[9px] font-mono text-forge-muted hover:text-forge-text" onClick={() => setBendRange((r) => (r === 2 ? 12 : r === 12 ? 24 : 2))} title="The range shown">
            ±{bendRange} st
          </button>
        )}
      </div>
      <svg ref={svgRef} width={width} height={h} className="block cursor-crosshair" onPointerDown={onBackgroundDown} aria-label={`${mode.kind === 'note' ? noteLaneSpec(mode.lane).label : exprSpec(mode.lane).label} lane`}>
        {mode.kind === 'note' && <rect x={xOf(span[0])} y={0} width={Math.max(1, xOf(span[1]) - xOf(span[0]))} height={h} fill="rgba(34,211,238,0.08)" />}
        {/* Rest line (no bend, wheel down, full pressure) */}
        <line x1={0} x2={width} y1={yOf(rest)} y2={yOf(rest)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
        {Array.from({ length: Math.ceil(clip.lengthBars) + 1 }, (_, b) => (
          <line key={b} x1={xOf(b)} x2={xOf(b)} y1={0} y2={h} stroke="rgba(255,255,255,0.08)" />
        ))}
        {held.map(([a, b]) => (
          <rect key={a} x={xOf(a)} y={PAD + 8} width={Math.max(2, xOf(b) - xOf(a))} height={h - 2 * PAD - 16} rx={3} fill="rgba(34,211,238,0.35)" stroke="rgba(34,211,238,0.8)" />
        ))}
        {path && <path d={path} fill="none" stroke={mode.kind === 'note' ? 'rgb(250,204,21)' : 'rgb(34,211,238)'} strokeWidth={1.5} />}
        {!step &&
          points.map((p, i) => (
            <circle
              key={`${p.at}-${i}`}
              cx={xOf(p.at)}
              cy={yOf(p.value)}
              r={4}
              fill={mode.kind === 'note' ? 'rgb(250,204,21)' : 'rgb(34,211,238)'}
              stroke="#0c0c0e"
              className="cursor-grab"
              onPointerDown={(e) => (e.button === 0 ? dragPoint(e, i, points) : undefined)}
              onDoubleClick={() => write(points.filter((_, k) => k !== i), true)}
              onContextMenu={(e) => {
                e.preventDefault();
                write(points.filter((_, k) => k !== i), true);
              }}
            >
              <title>{label(p.value)} (right-click to remove)</title>
            </circle>
          ))}
        {currentCc !== null && !points.length && (
          <text x={8} y={h / 2} className="fill-forge-muted text-[10px] font-mono">
            {ccLabel(currentCc)}: click to draw{target ? ` (moves ${specOf(target, track, useTimelineStore.getState().tracks).label})` : ' (plugins get it as MIDI; map it with MIDI learn)'}
          </text>
        )}
      </svg>
    </div>
  );
};
