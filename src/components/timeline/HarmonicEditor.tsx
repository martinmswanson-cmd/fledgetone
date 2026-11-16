/**
 * Drawing a wavetable as harmonics, in Fledge Synth's window (harmonicTable.ts): a bar for each
 * harmonic's level, up to four drawings that the oscillator's Position morphs through, shapes to
 * start from and tools for a whole drawing. Dragging shows the wave at once; the synth takes the
 * table when the drag ends (one undo step).
 */
import React, { useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  applyHarmonicTool,
  DRAWINGS_MAX,
  HARMONIC_COUNTS,
  HARMONIC_PHASES,
  HARMONIC_RANGE_DB,
  HARMONIC_SHAPES,
  harmonicCycle,
  harmonicShape,
  heightToGain,
  resizeDrawing,
  type HarmonicPhase,
  type Harmonics,
  type HarmonicTool,
} from '../../audio/plugins/harmonicTable';

const W = 384;
const H = 96;

const TOOLS: ReadonlyArray<{ tool: HarmonicTool; label: string; title: string }> = [
  { tool: 'odd', label: 'Odd', title: 'Keep only the odd harmonics (1, 3, 5...): hollow, like a square wave' },
  { tool: 'even', label: 'Even', title: 'Keep the 1st and the even harmonics (2, 4, 6...): nasal, an octave shining through' },
  { tool: 'darker', label: 'Darker', title: 'Turn the high harmonics down: 3 dB more for each octave up' },
  { tool: 'brighter', label: 'Brighter', title: 'Turn the high harmonics up: 3 dB more for each octave up' },
  { tool: 'clear', label: 'Clear', title: 'Silence every harmonic of this drawing' },
];

/** A bar's level in words, for screen readers and the readout. */
const levelText = (h: number) => (h > 0 ? `${((h - 1) * HARMONIC_RANGE_DB).toFixed(0)} dB` : 'silent');

export const HarmonicEditor: React.FC<{
  value: Harmonics;
  /** What it replaces if it isn't a drawing yet (a table made from a sound) */
  replaces?: string;
  /** The drawing as it changes (`done`: the change is finished, so the synth takes it) */
  onChange: (next: Harmonics, done: boolean) => void;
  onClose: () => void;
}> = ({ value, replaces, onChange, onClose }) => {
  const [at, setAt] = useState(0);
  const [sel, setSel] = useState(0);
  const index = Math.min(at, value.drawings.length - 1);
  const drawing = value.drawings[index];
  const count = drawing.length;
  const svg = useRef<SVGSVGElement>(null);
  /** The drawing as the drag has it so far, and the bar it was last on (bars between are filled in) */
  const stroke = useRef<{ heights: number[]; last: number } | null>(null);
  const wave = useMemo(() => harmonicCycle(drawing, value.phase, 256), [drawing, value.phase]);
  const wavePath = useMemo(() => {
    let d = '';
    for (let i = 0; i <= 256; i++) d += `${i ? 'L' : 'M'}${((i / 256) * 120).toFixed(1)} ${(24 - wave[i % 256] * 20).toFixed(1)}`;
    return d;
  }, [wave]);

  const withDrawing = (heights: number[], phase: HarmonicPhase = value.phase): Harmonics => ({ v: 1, phase, drawings: value.drawings.map((d, i) => (i === index ? heights : d)) });
  const barAt = (e: { clientX: number; clientY: number }) => {
    const box = svg.current!.getBoundingClientRect();
    const k = Math.max(0, Math.min(count - 1, Math.floor(((e.clientX - box.left) / box.width) * count)));
    const raw = 1 - (e.clientY - box.top) / box.height;
    // (The bottom twentieth is silence, so a harmonic can be taken right out)
    const h = raw < 0.05 ? 0 : Math.round(Math.min(1, raw) * 100) / 100;
    return { k, h };
  };
  const paint = (e: React.PointerEvent) => {
    const s = stroke.current;
    if (!s) return;
    const { k, h } = barAt(e);
    // A fast drag skips bars: the ones between take the levels in between
    const [from, to] = [Math.min(s.last, k), Math.max(s.last, k)];
    const start = s.heights[s.last];
    for (let i = from; i <= to; i++) s.heights[i] = to === from || i === k ? h : Math.round((start + ((h - start) * Math.abs(i - s.last)) / (to - from)) * 100) / 100;
    s.last = k;
    setSel(k);
    onChange(withDrawing(s.heights.slice()), false);
  };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current = { heights: drawing.slice(), last: barAt(e).k };
    paint(e);
  };
  const up = () => {
    const s = stroke.current;
    stroke.current = null;
    if (s) onChange(withDrawing(s.heights), true);
  };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === 'ArrowLeft') setSel((k) => Math.max(0, k - 1));
    else if (e.key === 'ArrowRight') setSel((k) => Math.min(count - 1, k + 1));
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Home' || e.key === 'End') {
      const k = Math.min(sel, count - 1);
      const now = drawing[k];
      const h = e.key === 'ArrowUp' ? Math.min(1, Math.max(0.05, now) + (now > 0 ? step : 0)) : e.key === 'ArrowDown' ? (now - step < 0.05 ? 0 : now - step) : e.key === 'End' ? 1 : 0;
      onChange(withDrawing(drawing.map((x, i) => (i === k ? Math.round(h * 100) / 100 : x))), true);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const bar = W / count;
  const button = 'h-6 px-2 rounded border border-forge-border text-forge-muted hover:text-forge-text hover:border-fuchsia-400 disabled:opacity-40';
  const chosen = Math.min(sel, count - 1);

  return (
    <div className="rounded border border-fuchsia-400/40 bg-black/30 p-2 flex flex-col gap-2 text-[10px] font-mono text-forge-muted min-w-0 max-w-[402px]" role="group" aria-label="Harmonics drawing" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="uppercase text-fuchsia-200">Harmonics</span>
        <span title="Each drawing is one end of the table, or a stop along it: the oscillator's Position morphs from the first to the last">Drawing</span>
        {value.drawings.map((_, i) => (
          <button key={i} type="button" onClick={() => setAt(i)} aria-pressed={i === index} className={`h-6 w-6 rounded border ${i === index ? 'border-fuchsia-400 text-forge-text bg-fuchsia-500/20' : 'border-forge-border hover:text-forge-text'}`} title={`Drawing ${i + 1} of ${value.drawings.length}: Position ${value.drawings.length === 1 ? 'anywhere' : `${Math.round((i / (value.drawings.length - 1)) * 100)} %`}`}>
            {i + 1}
          </button>
        ))}
        <button
          type="button"
          disabled={value.drawings.length >= DRAWINGS_MAX}
          onClick={() => {
            onChange({ ...value, drawings: [...value.drawings.slice(0, index + 1), drawing.slice(), ...value.drawings.slice(index + 1)] }, true);
            setAt(index + 1);
          }}
          className={`${button} px-1`}
          title="Add a drawing after this one (a copy of it to change): Position then morphs through them all"
          aria-label="Add a drawing"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        {value.drawings.length > 1 && (
          <button
            type="button"
            onClick={() => {
              onChange({ ...value, drawings: value.drawings.filter((_, i) => i !== index) }, true);
              setAt(Math.max(0, index - 1));
            }}
            className={button}
            title="Take this drawing out of the table"
          >
            Remove drawing
          </button>
        )}
        <button type="button" onClick={onClose} className="ml-auto h-6 w-6 flex items-center justify-center hover:text-forge-text" title="Close the drawing (the table stays)" aria-label="Close the harmonics drawing">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <svg
        ref={svg}
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ maxWidth: W }}
        className="rounded bg-black/40 cursor-crosshair touch-none outline-none focus-visible:ring-1 focus-visible:ring-fuchsia-400"
        tabIndex={0}
        role="slider"
        aria-label={`Harmonic ${chosen + 1} of ${count}, drawing ${index + 1}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={drawing[chosen]}
        aria-valuetext={levelText(drawing[chosen])}
        onPointerDown={down}
        onPointerMove={paint}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <title>Drag across to draw each harmonic's level (the bottom edge is silence). With the keyboard: left and right choose a harmonic, up and down set it, Delete silences it.</title>
        {[0.25, 0.5, 0.75].map((y) => (
          <line key={y} x1={0} x2={W} y1={H * y} y2={H * y} className="stroke-forge-border" strokeWidth={0.5} />
        ))}
        {drawing.map((h, k) => (
          <rect key={k} x={k * bar + 0.5} y={H - h * H} width={Math.max(1, bar - 1)} height={h * H} className={k === chosen ? 'fill-fuchsia-200' : k % 2 ? 'fill-fuchsia-400/80' : 'fill-fuchsia-400'} />
        ))}
        {/* The octaves: harmonics 1, 2, 4, 8... are the note in higher octaves */}
        {Array.from({ length: Math.floor(Math.log2(count)) + 1 }, (_, o) => 2 ** o).map((k) => (
          <text key={k} x={(k - 0.5) * bar} y={9} textAnchor="middle" className="fill-forge-muted" fontSize={8}>
            {k}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-1.5">
        <svg width={120} height={48} viewBox="0 0 120 48" className="rounded bg-black/40 shrink-0" role="img" aria-label="The wave this drawing makes">
          <line x1={0} y1={24} x2={120} y2={24} className="stroke-forge-border" strokeWidth={1} />
          <path d={wavePath} fill="none" className="stroke-fuchsia-300" strokeWidth={1.5} strokeLinejoin="round" />
        </svg>
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <select
              value=""
              onChange={(e) => e.target.value && onChange(withDrawing(harmonicShape(e.target.value, count)), true)}
              className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
              aria-label="Start this drawing from a shape"
              title="Replace this drawing with a shape to start from"
            >
              <option value="">Start from…</option>
              {HARMONIC_SHAPES.map((s) => (
                <option key={s.name} value={s.name} title={s.title}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={count}
              onChange={(e) => onChange({ ...value, drawings: value.drawings.map((d) => resizeDrawing(d, Number(e.target.value))) }, true)}
              className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
              aria-label="How many harmonics"
              title="How many harmonics each drawing has: more reach higher (brighter sounds), fewer are easier to draw"
            >
              {HARMONIC_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} harmonics
                </option>
              ))}
            </select>
            <select
              value={value.phase}
              onChange={(e) => onChange({ ...value, phase: e.target.value as HarmonicPhase }, true)}
              className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
              aria-label="How the harmonics line up"
              title={HARMONIC_PHASES.find((p) => p.value === value.phase)?.title}
            >
              {HARMONIC_PHASES.map((p) => (
                <option key={p.value} value={p.value} title={p.title}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {TOOLS.map((t) => (
              <button key={t.tool} type="button" onClick={() => onChange(withDrawing(applyHarmonicTool(drawing, t.tool)), true)} className={button} title={t.title}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="max-w-[384px] font-sans text-forge-muted leading-snug">
        Harmonic {chosen + 1}: {levelText(drawing[chosen])}
        {heightToGain(drawing[chosen]) > 0 && chosen > 0 ? ` (${chosen + 1} times the note's pitch)` : ''}. {replaces ? `Drawing replaces "${replaces}" as the table (Undo brings it back). ` : ''}
        {value.drawings.length > 1 ? 'Position morphs from drawing 1 to the last.' : 'Add a drawing and Position morphs between them.'}
      </p>
    </div>
  );
};
