import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Maximize2, Plus, Trash2 } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import type { PeqBand, PeqType, Track } from '../../store/timelineTypes';
import { defaultPeqBands, defaultTrackFx, PEQ_GAIN_MAX, PEQ_MAX_BANDS, PEQ_Q_MAX, PEQ_Q_MIN, PEQ_TYPES } from '../../store/timelineTypes';
import { bandDb, hasGain, hasQ, logFrequencies, peqDb } from '../../audio/peq';
import { liveTrackSpectrum } from '../../audio/liveTracks';
import { liveMix } from '../../audio/engine';
import { InsertPanel } from './InsertFx';

/**
 * The parametric EQ, drawn: the curve the bands make (exactly what the filters do), the track's
 * sound behind it while it plays, and a dot per band to drag. Drag a dot sideways for its
 * frequency and up or down for its gain; the mouse wheel over it changes its width (Q). Click empty
 * space to add a band there, right-click a dot to remove it.
 */

const F_LO = 20;
const F_HI = 20000;
const DB_RANGE = 24;
const TYPE_LABEL: Record<PeqType, string> = { lowcut: 'Low cut', lowshelf: 'Low shelf', bell: 'Bell', notch: 'Notch', highshelf: 'High shelf', highcut: 'High cut' };
const BAND_COLORS = ['#f43f5e', '#f59e0b', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899'];

const fmtHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 1 : 2)} kHz` : `${Math.round(hz)} Hz`);
const fmtDb = (db: number) => `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;

export const PeqEditor: React.FC<{ track: Track; height?: number; big?: boolean }> = ({ track, height = 150, big = false }) => {
  const peq = track.fx.peq ?? defaultTrackFx().peq;
  const bands = peq.bands;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(300);
  const [selected, setSelected] = useState(2);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const sel = bands[selected] ? selected : bands.length - 1;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xOf = (hz: number) => (Math.log(hz / F_LO) / Math.log(F_HI / F_LO)) * width;
  const hzOf = (x: number) => Math.max(F_LO, Math.min(F_HI, F_LO * (F_HI / F_LO) ** (x / width)));
  const yOf = (db: number) => height / 2 - (Math.max(-DB_RANGE, Math.min(DB_RANGE, db)) / DB_RANGE) * (height / 2 - 6);
  const dbOf = (y: number) => Math.max(-DB_RANGE, Math.min(DB_RANGE, ((height / 2 - y) / (height / 2 - 6)) * DB_RANGE));

  const set = (next: PeqBand[]) => useTimelineStore.getState().setTrackFx(track.id, 'peq', { bands: next });
  const update = (i: number, patch: Partial<PeqBand>) => set(bands.map((b, k) => (k === i ? { ...b, ...patch } : b)));

  // The total curve and the selected band's own shape
  const freqs = useMemo(() => logFrequencies(Math.max(60, Math.round(width / 3))), [width]);
  const curve = useMemo(() => freqs.map((f, i) => `${i ? 'L' : 'M'}${xOf(f).toFixed(1)},${yOf(peqDb(bands, f)).toFixed(1)}`).join(''), [freqs, bands, width, height]);
  const own = useMemo(() => {
    const b = bands[sel];
    if (!b?.on) return '';
    return `${freqs.map((f, i) => `${i ? 'L' : 'M'}${xOf(f).toFixed(1)},${yOf(bandDb(b, f)).toFixed(1)}`).join('')}L${width},${height / 2}L0,${height / 2}Z`;
  }, [freqs, bands, sel, width, height]);

  // The live spectrum behind the curve (only while playing and the EQ is on)
  useEffect(() => {
    const c = canvas.current;
    if (!c || !isPlaying) {
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      return;
    }
    const data = new Float32Array(4096);
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ctx = c.getContext('2d');
      const bins = liveTrackSpectrum(track.id, data);
      if (!ctx || !bins) return;
      const rate = liveMix.bus.context.sampleRate;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.beginPath();
      ctx.moveTo(0, c.height);
      for (let x = 0; x <= c.width; x += 2) {
        const hz = hzOf(x);
        const bin = Math.min(bins - 1, Math.round((hz / (rate / 2)) * bins));
        // -100 dBFS at the bottom to -20 at the top
        const level = Math.max(0, Math.min(1, (data[bin] + 100) / 80));
        ctx.lineTo(x, c.height * (1 - level));
      }
      ctx.lineTo(c.width, c.height);
      ctx.closePath();
      ctx.fillStyle = `${track.color}38`;
      ctx.fill();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, track.id, track.color, width, height]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const nodeY = (b: PeqBand) => (hasGain(b.type) ? yOf(b.gain) : yOf(peqDb(bands, b.freq)));

  const drag = (e: React.PointerEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(i);
    const b0 = bands[i];
    const start = local(e);
    const x0 = xOf(b0.freq);
    const y0 = hasGain(b0.type) ? yOf(b0.gain) : 0;
    let committed = false;
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      const fine = ev.shiftKey ? 0.2 : 1;
      if (!committed) {
        committed = true;
        useTimelineStore.getState().checkpoint();
      }
      const freq = Math.round(hzOf(x0 + (p.x - start.x) * fine));
      const patch: Partial<PeqBand> = { freq, on: true };
      if (hasGain(b0.type)) patch.gain = Math.round(dbOf(y0 + (p.y - start.y) * fine) * 10) / 10;
      const now = useTimelineStore.getState().tracks.find((t) => t.id === track.id)?.fx.peq.bands ?? bands;
      useTimelineStore.getState().setTrackFx(track.id, 'peq', { bands: now.map((b, k) => (k === i ? { ...b, ...patch } : b)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addAt = (e: React.MouseEvent) => {
    if (bands.length >= PEQ_MAX_BANDS) {
      // Full: reuse a band that's off
      const free = bands.findIndex((b) => !b.on);
      if (free < 0) return;
      const p = local(e);
      useTimelineStore.getState().checkpoint();
      update(free, { on: true, type: 'bell', freq: Math.round(hzOf(p.x)), gain: Math.round(dbOf(p.y) * 10) / 10, q: 1 });
      setSelected(free);
      return;
    }
    const p = local(e);
    useTimelineStore.getState().checkpoint();
    set([...bands, { on: true, type: 'bell', freq: Math.round(hzOf(p.x)), gain: Math.round(dbOf(p.y) * 10) / 10, q: 1 }]);
    setSelected(bands.length);
  };

  const remove = (i: number) => {
    useTimelineStore.getState().checkpoint();
    set(bands.filter((_, k) => k !== i));
    setSelected(Math.max(0, i - 1));
  };

  const b = bands[sel];
  const grid = [50, 100, 200, 500, 1000, 2000, 5000, 10000];

  return (
    <div className={`flex flex-col gap-2 ${peq.on ? '' : 'opacity-60'}`}>
      <div
        ref={wrap}
        className="relative rounded-md overflow-hidden bg-black/60 border border-forge-border cursor-crosshair select-none"
        style={{ height }}
        onDoubleClick={addAt}
        onWheel={(e) => {
          if (!b || !hasQ(b.type)) return;
          e.preventDefault();
          update(sel, { q: Math.max(PEQ_Q_MIN, Math.min(PEQ_Q_MAX, Math.round(b.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12) * 100) / 100)) });
        }}
        title="Drag a dot: frequency and gain (Shift: fine). Wheel: width. Double-click: add a band. Right-click a dot: remove it."
        aria-label="Parametric EQ curve"
      >
        <canvas ref={canvas} width={width} height={height} className="absolute inset-0" />
        <svg width={width} height={height} className="absolute inset-0">
          {grid.map((f) => (
            <g key={f}>
              <line x1={xOf(f)} x2={xOf(f)} y1={0} y2={height} stroke="white" strokeOpacity={0.07} />
              <text x={xOf(f) + 2} y={height - 3} fontSize={9} fill="white" fillOpacity={0.35}>
                {f >= 1000 ? `${f / 1000}k` : f}
              </text>
            </g>
          ))}
          {[-18, -12, -6, 6, 12, 18].map((d) => (
            <line key={d} x1={0} x2={width} y1={yOf(d)} y2={yOf(d)} stroke="white" strokeOpacity={0.05} />
          ))}
          <line x1={0} x2={width} y1={height / 2} y2={height / 2} stroke="white" strokeOpacity={0.18} />
          {own && <path d={own} fill={BAND_COLORS[sel % BAND_COLORS.length]} fillOpacity={0.18} />}
          <path d={curve} fill="none" stroke={track.color} strokeWidth={2} />
          {bands.map((band, i) => (
            <g key={i}>
              <circle
                cx={xOf(band.freq)}
                cy={nodeY(band)}
                r={i === sel ? 7 : 5.5}
                fill={band.on ? BAND_COLORS[i % BAND_COLORS.length] : '#3f3f46'}
                stroke={i === sel ? 'white' : '#0b0f14'}
                strokeWidth={1.5}
                className="cursor-grab"
                onPointerDown={(e) => drag(e, i)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  update(i, { on: !band.on });
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  remove(i);
                }}
              >
                <title>{`${TYPE_LABEL[band.type]} ${fmtHz(band.freq)}${hasGain(band.type) ? ` ${fmtDb(band.gain)}` : ''}${band.on ? '' : ' (off)'}`}</title>
              </circle>
              <text x={xOf(band.freq)} y={nodeY(band) + 3} fontSize={8} textAnchor="middle" fill="black" pointerEvents="none">
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {b && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] font-mono text-forge-muted" aria-label="Selected EQ band">
          <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] text-black font-bold" style={{ background: BAND_COLORS[sel % BAND_COLORS.length] }}>
            {sel + 1}
          </span>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={b.on} onChange={(e) => update(sel, { on: e.target.checked })} aria-label={`Band ${sel + 1} on`} />
          </label>
          <select value={b.type} onChange={(e) => update(sel, { type: e.target.value as PeqType })} className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-forge-text" aria-label="Band shape">
            {PEQ_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1">
            FREQ
            <input type="range" min={0} max={1000} value={Math.round((xOf(b.freq) / width) * 1000)} onChange={(e) => update(sel, { freq: Math.round(hzOf((Number(e.target.value) / 1000) * width)) })} className={big ? 'w-40' : 'w-20'} aria-label="Band frequency" />
            <span className="w-14 text-forge-text tabular-nums">{fmtHz(b.freq)}</span>
          </label>
          {hasGain(b.type) && (
            <label className="flex items-center gap-1">
              GAIN
              <input type="range" min={-PEQ_GAIN_MAX} max={PEQ_GAIN_MAX} step={0.1} value={b.gain} onChange={(e) => update(sel, { gain: Number(e.target.value) })} onDoubleClick={() => update(sel, { gain: 0 })} className={big ? 'w-32' : 'w-16'} aria-label="Band gain" />
              <span className="w-14 text-forge-text tabular-nums">{fmtDb(b.gain)}</span>
            </label>
          )}
          {hasQ(b.type) && (
            <label className="flex items-center gap-1">
              Q
              <input type="range" min={Math.log(PEQ_Q_MIN)} max={Math.log(PEQ_Q_MAX)} step={0.01} value={Math.log(b.q)} onChange={(e) => update(sel, { q: Math.round(Math.exp(Number(e.target.value)) * 100) / 100 })} className={big ? 'w-28' : 'w-14'} aria-label="Band width (Q)" />
              <span className="w-8 text-forge-text tabular-nums">{b.q.toFixed(2)}</span>
            </label>
          )}
          <button type="button" onClick={() => remove(sel)} className="text-forge-muted hover:text-red-300" title="Remove this band" aria-label="Remove band">
            <Trash2 className="w-3 h-3" />
          </button>
          {bands.length < PEQ_MAX_BANDS && (
            <button
              type="button"
              onClick={() => {
                useTimelineStore.getState().checkpoint();
                set([...bands, { on: true, type: 'bell', freq: 1000, gain: 0, q: 1 }]);
                setSelected(bands.length);
              }}
              className="flex items-center gap-0.5 text-forge-muted hover:text-forge-text"
              title="Add a band"
            >
              <Plus className="w-3 h-3" /> Band
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              useTimelineStore.getState().checkpoint();
              set(defaultPeqBands());
            }}
            className="ml-auto text-forge-muted hover:text-forge-text"
            title="Back to the starting bands, all flat"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
};

/** The EQ in the Inspector: a small graph, and a button to work on it big in the bottom panel. */
export const PeqPanel: React.FC<{ track: Track }> = ({ track }) => {
  const on = !!track.fx.peq?.on;
  const accent = '#22d3ee';
  return (
    <InsertPanel
      title="Pro EQ"
      icon={<AudioLines className="w-3.5 h-3.5" style={{ color: accent }} />}
      on={on}
      onToggle={() => useTimelineStore.getState().setTrackFx(track.id, 'peq', { on: !on })}
      accent={accent}
    >
      <PeqEditor track={track} height={120} />
      <button
        type="button"
        onClick={() => {
          useTimelineStore.getState().selectTrack(track.id);
          useUiStore.getState().openDock('eq');
        }}
        className="self-start flex items-center gap-1 text-[10px] font-mono text-forge-muted hover:text-forge-text"
        title="Open the EQ big, in the bottom panel"
      >
        <Maximize2 className="w-3 h-3" /> Open big
      </button>
    </InsertPanel>
  );
};
