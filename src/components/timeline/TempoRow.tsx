import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { TOTAL_BARS, useSongTempo, useTimelineStore } from '../../store/timelineStore';
import { formatBpm, snapBar } from '../../store/timelineTypes';
import { formatMeter, MAX_BPM, MIN_BPM, nearestMeasureStart, tempoAt } from '../../audio/tempoMap';
import type { Meter } from '../../audio/tempoMap';
import { barFromClientX } from './Playhead';
import { useDrawnStretch } from './drawnStretch';
import { menuClass, useKeepOnScreen, useMenuDismiss } from './menuHooks';
import { TEMPO_ROW } from './layout';

/**
 * The ruler's top row: the song's tempo and time signature, and their changes along the way.
 * A faint line traces the tempo (glides show as slopes). Click a flag to edit it, drag one to move
 * it (a tempo change snaps to the grid, a time signature to measure starts), double-click the row
 * to add a tempo change there. The ruler's right-click menu adds either.
 */

type Editing = { kind: 'tempo' | 'meter'; id: string | null; x: number; y: number };

const DENOMINATORS = [2, 4, 8, 16];

export const TempoRow = React.memo(function TempoRow({ originRef }: { originRef: React.RefObject<HTMLElement | null> }) {
  const zoom = useTimelineStore((s) => s.zoom);
  const bpm = useTimelineStore((s) => s.bpm);
  const tempoPoints = useTimelineStore((s) => s.tempoPoints);
  const meter = useTimelineStore((s) => s.meter);
  const meterPoints = useTimelineStore((s) => s.meterPoints);
  const tempo = useSongTempo();
  const totalWidth = TOTAL_BARS * zoom;
  const { drawFrom, drawTo } = useDrawnStretch(totalWidth);
  const [editing, setEditing] = useState<Editing | null>(null);
  const close = useCallback(() => setEditing(null), []);

  // The tempo line, scaled between the slowest and fastest tempos in the song
  const all = [bpm, ...tempoPoints.map((p) => p.bpm)];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const changes = tempoPoints.length > 0;
  const yOf = (b: number) => (hi - lo < 0.01 ? TEMPO_ROW / 2 : TEMPO_ROW - 3 - ((b - lo) / (hi - lo)) * (TEMPO_ROW - 6));
  let line = '';
  if (changes) {
    const step = 6;
    for (let x = drawFrom; x <= drawTo; x += step) line += `${line ? 'L' : 'M'}${x} ${yOf(tempoAt(x / zoom + 1, tempo)).toFixed(1)}`;
  }

  const startDrag = (e: React.PointerEvent, kind: 'tempo' | 'meter', id: string | null, bar: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const origin = originRef.current;
    const grab = barFromClientX(e.clientX, origin) - bar;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (id === null) return; // the song's own tempo and meter stay at bar 1
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      const s = useTimelineStore.getState();
      if (!moved) {
        moved = true;
        s.checkpoint();
        document.body.style.cursor = 'grabbing';
      }
      const raw = barFromClientX(ev.clientX, origin) - grab;
      if (kind === 'tempo') s.updateTempoChange(id, { bar: ev.shiftKey ? raw : snapBar(raw, s.snapGrid, s) }, false);
      else s.updateMeterChange(id, { bar: nearestMeasureStart(raw, { base: s.meter, points: s.meterPoints.filter((p) => p.id !== id) }) }, false);
    };
    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) setEditing({ kind, id, x: startX, y: startY + 12 });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // One flag group per position: a tempo flag, then a time signature flag
  const groups = new Map<number, Array<{ kind: 'tempo' | 'meter'; id: string | null; bar: number; label: string; title: string }>>();
  const add = (bar: number, f: { kind: 'tempo' | 'meter'; id: string | null; bar: number; label: string; title: string }) => {
    const key = Math.round(bar * 1e6);
    const g = groups.get(key) ?? [];
    g.push(f);
    groups.set(key, g);
  };
  add(1, { kind: 'tempo', id: null, bar: 1, label: `♩${formatBpm(bpm)}`, title: `The song's tempo: ${formatBpm(bpm)} BPM. Click to change it.` });
  for (const p of tempoPoints) {
    add(p.bar, {
      kind: 'tempo',
      id: p.id,
      bar: p.bar,
      label: `${p.ramp ? '↗' : '♩'}${formatBpm(p.bpm)}`,
      title: `${p.ramp ? 'Glides to' : 'Changes to'} ${formatBpm(p.bpm)} BPM here. Click to edit, drag to move.`,
    });
  }
  add(1, { kind: 'meter', id: null, bar: 1, label: formatMeter(meter), title: `The song's time signature: ${formatMeter(meter)}. Click to change it.` });
  for (const p of meterPoints) add(p.bar, { kind: 'meter', id: p.id, bar: p.bar, label: formatMeter(p), title: `${formatMeter(p)} from here. Click to edit, drag to move.` });

  return (
    <div
      className="absolute left-0 right-0 top-0 border-b border-forge-border/60 bg-black/20"
      style={{ height: TEMPO_ROW }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const s = useTimelineStore.getState();
        const bar = snapBar(barFromClientX(e.clientX, originRef.current), s.snapGrid, s);
        if (bar <= 1) return;
        const id = s.addTempoChange(bar, tempoAt(bar, tempo));
        setEditing({ kind: 'tempo', id, x: e.clientX, y: e.clientY + 12 });
      }}
      title="Tempo and time signature. Double-click to add a tempo change."
    >
      {changes && (
        <svg className="absolute top-0 pointer-events-none" style={{ left: drawFrom, width: Math.max(0, drawTo - drawFrom), height: TEMPO_ROW }} viewBox={`${drawFrom} 0 ${Math.max(1, drawTo - drawFrom)} ${TEMPO_ROW}`} preserveAspectRatio="none" aria-hidden>
          <path d={line} fill="none" stroke="rgba(34,211,238,0.45)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {[...groups.values()].map((flags) => {
        const x = Math.round((flags[0].bar - 1) * zoom);
        if (x < drawFrom - 200 || x > drawTo) return null;
        return (
          <div key={`${flags[0].bar}`} className="absolute top-0 flex items-center gap-px" style={{ left: x, height: TEMPO_ROW }}>
            <div className="w-px h-full bg-cyan-300/60" />
            {flags.map((f) => (
              <button
                key={`${f.kind}-${f.id ?? 'base'}`}
                type="button"
                className={`h-[12px] px-1 rounded-sm text-[9px] leading-none font-mono tabular-nums whitespace-nowrap ${
                  f.kind === 'tempo' ? 'bg-cyan-500/25 text-cyan-100 hover:bg-cyan-500/45' : 'bg-violet-500/25 text-violet-100 hover:bg-violet-500/45'
                } ${f.id ? 'cursor-grab' : 'cursor-pointer'}`}
                title={f.title}
                aria-label={f.title}
                onPointerDown={(e) => startDrag(e, f.kind, f.id, f.bar)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditing({ kind: f.kind, id: f.id, x: e.clientX, y: e.clientY + 12 });
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        );
      })}
      {editing && createPortal(<TempoEditor editing={editing} onClose={close} />, document.body)}
    </div>
  );
});

/** The little editor for a tempo or time signature flag. */
function TempoEditor({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(ref, onClose);
  useKeepOnScreen(ref, editing.x, editing.y);
  const bpm = useTimelineStore((st) => st.bpm);
  const meter = useTimelineStore((st) => st.meter);
  const point = useTimelineStore((st) => (editing.kind === 'tempo' ? st.tempoPoints.find((p) => p.id === editing.id) : undefined));
  const meterPoint = useTimelineStore((st) => (editing.kind === 'meter' ? st.meterPoints.find((p) => p.id === editing.id) : undefined));
  const s = useTimelineStore.getState();
  if (editing.id !== null && !point && !meterPoint) return null;

  if (editing.kind === 'tempo') {
    const value = point ? point.bpm : bpm;
    const setTempo = (v: number) => {
      if (!(v >= MIN_BPM && v <= MAX_BPM)) return;
      if (point) s.updateTempoChange(point.id, { bpm: v });
      else s.setBpm(v);
    };
    return (
      <div ref={ref} className={`${menuClass} !w-56 px-3 py-2 flex flex-col gap-2`} role="dialog" aria-label={point ? 'Tempo change' : 'Song tempo'}>
        <div className="text-[10px] uppercase tracking-wider text-forge-muted">{point ? 'Tempo change' : 'Song tempo (from bar 1)'}</div>
        <label className="flex items-center gap-2 text-forge-text">
          BPM
          <input
            type="number"
            min={MIN_BPM}
            max={MAX_BPM}
            step={0.01}
            defaultValue={formatBpm(value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setTempo(Number((e.target as HTMLInputElement).value));
                onClose();
              }
            }}
            onBlur={(e) => setTempo(Number(e.target.value))}
            className="w-20 h-6 bg-forge-bg border border-forge-border rounded px-1"
            aria-label="Tempo in BPM"
          />
        </label>
        {point && (
          <>
            <label className="flex items-center gap-2 text-forge-text cursor-pointer">
              <input type="checkbox" checked={point.ramp} onChange={(e) => s.updateTempoChange(point.id, { ramp: e.target.checked })} className="accent-cyan-400" />
              Glide from the tempo before
            </label>
            <button
              type="button"
              className="h-7 flex items-center justify-center gap-1.5 rounded border border-forge-border hover:border-red-400/60 text-forge-text"
              onClick={() => {
                s.removeTempoChange(point.id);
                onClose();
              }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          </>
        )}
      </div>
    );
  }

  const current: Meter = meterPoint ?? meter;
  const setMeter = (m: Meter) => {
    if (meterPoint) s.updateMeterChange(meterPoint.id, { num: m.num, den: m.den });
    else s.setMeter(m);
  };
  return (
    <div ref={ref} className={`${menuClass} !w-56 px-3 py-2 flex flex-col gap-2`} role="dialog" aria-label={meterPoint ? 'Time signature change' : 'Time signature'}>
      <div className="text-[10px] uppercase tracking-wider text-forge-muted">{meterPoint ? 'Time signature change' : 'Time signature (from bar 1)'}</div>
      <div className="flex items-center gap-1 text-forge-text">
        <select value={current.num} onChange={(e) => setMeter({ num: Number(e.target.value), den: current.den })} className="h-6 bg-forge-bg border border-forge-border rounded px-1" aria-label="Beats per measure">
          {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        /
        <select value={current.den} onChange={(e) => setMeter({ num: current.num, den: Number(e.target.value) })} className="h-6 bg-forge-bg border border-forge-border rounded px-1" aria-label="Beat note value">
          {DENOMINATORS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>
      <div className="text-[10px] text-forge-muted">Changing the time signature moves no notes: it changes where the measure lines and the metronome's accents fall.</div>
      {meterPoint && (
        <button
          type="button"
          className="h-7 flex items-center justify-center gap-1.5 rounded border border-forge-border hover:border-red-400/60 text-forge-text"
          onClick={() => {
            s.removeMeterChange(meterPoint.id);
            onClose();
          }}
        >
          <Trash2 className="w-3.5 h-3.5" /> Remove
        </button>
      )}
    </div>
  );
}
