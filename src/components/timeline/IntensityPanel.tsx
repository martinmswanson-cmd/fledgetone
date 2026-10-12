import React, { useRef, useState } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import { INSTRUMENTS, isDrumKind, isFxKind } from '../../audio/instrumentCatalog';
import { curveLevel, defaultCurve, groupsInUse, STEM_GROUP_PRESETS, type IntensityCurve } from '../../store/intensity';

/**
 * Intensity in the Game preview: the slider (the same one as in the header), each track's stem
 * group and its on/off switch, and a curve per group in use: how loud its tracks play at each
 * intensity. On a curve, drag a point to move it, click empty space to add one, double-click a
 * point to remove it. A line marks the intensity now.
 */

const W = 260;
const H = 70;
const PAD = 6;
const GROUP_COLORS = ['#34d399', '#f59e0b', '#f472b6', '#60a5fa', '#a78bfa', '#f87171'];

const CurveEditor: React.FC<{ group: string; curve: IntensityCurve; color: string; intensity: number }> = ({ group, curve, color, intensity }) => {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const toX = (x: number) => PAD + x * (W - 2 * PAD);
  const toY = (y: number) => H - PAD - y * (H - 2 * PAD);
  const fromEvent = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    return [Math.max(0, Math.min(1, (x - PAD) / (W - 2 * PAD))), Math.max(0, Math.min(1, (H - PAD - y) / (H - 2 * PAD)))];
  };
  const save = (c: IntensityCurve) => useTimelineStore.getState().setIntensityCurve(group, [...c].sort((a, b) => a[0] - b[0]));
  const near = (e: React.PointerEvent) => {
    const [x, y] = fromEvent(e);
    return curve.findIndex(([px, py]) => Math.abs(toX(px) - toX(x)) < 8 && Math.abs(toY(py) - toY(y)) < 8);
  };
  const path = curve.map(([x, y], i) => `${i ? 'L' : 'M'}${toX(x).toFixed(1)},${toY(y).toFixed(1)}`).join('');
  const level = curveLevel(curve, intensity);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[10px] font-mono">
        <span style={{ color }}>{group}</span>
        <span className="text-forge-muted">{Math.round(level * 100)}% now</span>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-16 rounded bg-black/40 touch-none cursor-crosshair"
        role="img"
        aria-label={`${group} intensity curve`}
        onPointerDown={(e) => {
          const i = near(e);
          if (i >= 0) {
            setDrag(i);
          } else {
            const p = fromEvent(e);
            const next = [...curve, p].sort((a, b) => a[0] - b[0]) as IntensityCurve;
            save(next);
            setDrag(next.indexOf(p));
          }
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag === null) return;
          const p = fromEvent(e);
          const next = curve.map((q, k) => (k === drag ? p : q)) as IntensityCurve;
          // Keep the order while dragging (a point can't pass its neighbours)
          const lo = drag > 0 ? next[drag - 1][0] : 0;
          const hi = drag < next.length - 1 ? next[drag + 1][0] : 1;
          next[drag] = [Math.max(lo, Math.min(hi, p[0])), p[1]];
          useTimelineStore.getState().setIntensityCurve(group, next);
        }}
        onPointerUp={() => setDrag(null)}
        onDoubleClick={(e) => {
          const i = near(e as unknown as React.PointerEvent);
          if (i >= 0 && curve.length > 1) save(curve.filter((_, k) => k !== i));
        }}
      >
        <line x1={toX(intensity)} x2={toX(intensity)} y1={0} y2={H} stroke="#ffffff55" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {curve.map(([x, y], i) => (
          <circle key={i} cx={toX(x)} cy={toY(y)} r={4} fill={drag === i ? '#fff' : color} />
        ))}
      </svg>
    </div>
  );
};

export const IntensityPanel: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const intensity = useTimelineStore((s) => s.intensity);
  const curves = useTimelineStore((s) => s.intensityCurves);
  const groups = groupsInUse(tracks);
  const st = useTimelineStore.getState;
  const colorOf = (g: string) => GROUP_COLORS[Math.max(0, groups.indexOf(g)) % GROUP_COLORS.length];

  const autoAssign = () => {
    // By what each track plays: drums are Percussion, effects Tension, leads Climax, the rest Ambient
    tracks.forEach((t) => {
      const def = INSTRUMENTS[t.instrumentKey];
      const group = isDrumKind(t.instrumentKey) || def.category === 'Drums & Percussion'
        ? 'Percussion'
        : isFxKind(t.instrumentKey) || def.category === 'Sound Effects'
          ? 'Tension'
          : /lead|supersaw|brass|choir/i.test(t.instrumentKey) || /lead/i.test(t.name)
            ? 'Climax'
            : 'Ambient';
      st().setTrackStemGroup(t.id, group);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted uppercase">
        Intensity
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={intensity}
          onChange={(e) => st().setIntensity(Number(e.target.value))}
          className="flex-1 accent-emerald-400"
          aria-label="Intensity (Game preview)"
        />
        <span className="w-10 text-right text-forge-text tabular-nums">{Math.round(intensity * 100)}%</span>
      </label>
      {groups.length === 0 && (
        <div className="flex items-center gap-2">
          <p className="text-forge-muted flex-1">Give tracks a stem group below and Intensity crossfades them.</p>
          <button type="button" onClick={autoAssign} className="h-7 px-2 rounded-md border border-emerald-400/60 text-emerald-200 text-[11px] hover:bg-emerald-500/15 shrink-0" title="By what each track plays: drums Percussion, effects Tension, leads Climax, everything else Ambient">
            Auto-assign
          </button>
        </div>
      )}
      <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
        {tracks.map((t) => (
          <div key={t.id} className="flex items-center gap-2 text-forge-text">
            <input type="checkbox" checked={!t.isMuted} onChange={(e) => st().setTrackMuted(t.id, !e.target.checked)} className="accent-emerald-400" aria-label={`${t.name} on`} />
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
            <span className="truncate flex-1 min-w-0">{t.name}</span>
            <select
              value={t.stemGroup ?? ''}
              onChange={(e) => {
                let v = e.target.value;
                if (v === '__custom') v = window.prompt('Stem group name', t.stemGroup ?? '') ?? (t.stemGroup ?? '');
                st().setTrackStemGroup(t.id, v);
              }}
              className="h-6 w-24 bg-forge-bg border border-forge-border rounded px-1 text-[10px]"
              style={t.stemGroup ? { color: colorOf(t.stemGroup) } : undefined}
              aria-label={`${t.name}: stem group`}
            >
              <option value="">No group</option>
              {[...new Set([...STEM_GROUP_PRESETS, ...groups])].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              <option value="__custom">Other…</option>
            </select>
          </div>
        ))}
      </div>
      {groups.map((g) => (
        <CurveEditor key={g} group={g} curve={curves[g] ?? defaultCurve(g)} color={colorOf(g)} intensity={intensity} />
      ))}
      {groups.length > 0 && <p className="text-[10px] text-forge-muted">Curves: how loud each group plays (up) at each intensity (across). Drag a point, click to add one, double-click to remove.</p>}
    </div>
  );
};
