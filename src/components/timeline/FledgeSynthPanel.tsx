import React, { useRef, useSyncExternalStore } from 'react';
import type { BuiltinControls, BuiltinParam } from '../../audio/plugins/builtinHost';
import { choiceIndex, choiceValue, FLEDGE, FLEDGE_SECTIONS, lfoControls, oscControls, type FledgeControl } from '../../audio/plugins/fledgeLayout';

/**
 * Fledge Synth's own window (the synth in engine/fledge-synth): its controls in sections, as a
 * synth's panel lays them out, instead of the list of sliders other built-in plugins get. Knobs
 * drag up and down (Shift for fine steps), take the arrow keys, and double-click back to where
 * they started.
 */

type Params = BuiltinParam[];

const Knob: React.FC<{ c: Extract<FledgeControl, { kind: 'knob' }>; p: BuiltinParam | undefined; set: (v: number) => void }> = ({ c, p, set }) => {
  const drag = useRef<{ y: number; v: number } | null>(null);
  if (!p) return null;
  const v = p.value;
  // A 270° arc: from the bottom left round to the bottom right (from the top for bipolar ones)
  const angle = (x: number) => (-135 + 270 * x) * (Math.PI / 180);
  const point = (x: number) => [18 + 13 * Math.sin(angle(x)), 18 - 13 * Math.cos(angle(x))];
  const arc = (from: number, to: number) => {
    const [x0, y0] = point(from);
    const [x1, y1] = point(to);
    return `M ${x0} ${y0} A 13 13 0 ${Math.abs(to - from) * 270 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const start = c.bipolar ? 0.5 : 0;
  const [from, to] = v >= start ? [start, v] : [v, start];
  const [hx, hy] = point(v);
  const nudge = (d: number) => set(Math.max(0, Math.min(1, v + d)));
  return (
    <div className="flex flex-col items-center w-[52px] select-none" title={`${p.name}: ${p.text}. Drag up or down (Shift: fine); double-click to put it back`}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={p.name}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(v.toFixed(3))}
        aria-valuetext={p.text}
        className="cursor-ns-resize rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-fuchsia-300 touch-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const per = e.shiftKey ? 1000 : 180;
          set(Math.max(0, Math.min(1, drag.current.v + (drag.current.y - e.clientY) / per)));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => set(p.defaultValue)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.002 : 0.01;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(step);
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(-step);
          else if (e.key === 'PageUp') nudge(0.1);
          else if (e.key === 'PageDown') nudge(-0.1);
          else if (e.key === 'Home') set(0);
          else if (e.key === 'End') set(1);
          else return;
          e.preventDefault();
        }}
      >
        <svg width={36} height={36} viewBox="0 0 36 36" aria-hidden>
          <path d={arc(0, 1)} fill="none" stroke="currentColor" strokeWidth={3} className="text-forge-border" strokeLinecap="round" />
          {to - from > 0.002 && <path d={arc(from, to)} fill="none" stroke="currentColor" strokeWidth={3} className="text-fuchsia-400" strokeLinecap="round" />}
          <circle cx={18} cy={18} r={8} className="fill-forge-bg" />
          <line x1={18} y1={18} x2={hx} y2={hy} stroke="currentColor" strokeWidth={2} className="text-forge-text" strokeLinecap="round" />
        </svg>
      </div>
      <span className="text-[10px] leading-tight text-forge-text truncate max-w-full">{c.label}</span>
      <span className="text-[9px] leading-tight font-mono text-forge-muted truncate max-w-full">{p.text}</span>
    </div>
  );
};

const Choice: React.FC<{ c: Extract<FledgeControl, { kind: 'choice' }>; p: BuiltinParam | undefined; set: (v: number) => void; wide?: boolean }> = ({ c, p, set, wide }) => {
  if (!p) return null;
  const n = c.options.length;
  return (
    <label className={`flex flex-col gap-0.5 ${wide ? 'flex-1 min-w-0' : ''}`}>
      <span className="text-[10px] text-forge-muted">{c.label}</span>
      <select
        value={choiceIndex(p.value, n)}
        onChange={(e) => set(choiceValue(Number(e.target.value), n))}
        aria-label={p.name}
        className="h-6 bg-forge-bg border border-forge-border rounded px-1 text-[11px] text-forge-text"
      >
        {c.options.map((o, k) => (
          <option key={k} value={k}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
};

const Toggle: React.FC<{ c: Extract<FledgeControl, { kind: 'toggle' }>; p: BuiltinParam | undefined; set: (v: number) => void }> = ({ c, p, set }) => {
  if (!p) return null;
  const on = p.value >= 0.5;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={p.name}
      onClick={() => set(on ? 0 : 1)}
      className={`h-6 px-2 rounded border text-[10px] font-mono ${on ? 'border-fuchsia-400/70 bg-fuchsia-500/15 text-fuchsia-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
    >
      {c.label}
    </button>
  );
};

const Section: React.FC<{ title: string; dim?: boolean; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, dim, right, children, className = '' }) => (
  <section className={`rounded-md border border-forge-border bg-forge-bg/40 p-2 flex flex-col gap-2 ${className}`}>
    <header className="flex items-center gap-2 min-h-6">
      <h3 className="text-[11px] font-semibold tracking-wide uppercase text-fuchsia-200">{title}</h3>
      <div className="ml-auto flex items-center gap-1.5">{right}</div>
    </header>
    <div className={`flex flex-col gap-2 ${dim ? 'opacity-40' : ''}`}>{children}</div>
  </section>
);

export const FledgeSynthPanel: React.FC<{ controls: BuiltinControls }> = ({ controls }) => {
  const params: Params = useSyncExternalStore(controls.subscribe, controls.params);
  const set = (i: number) => (v: number) => controls.set(i, v);
  const ctl = (c: FledgeControl, wide?: boolean) =>
    c.kind === 'knob' ? (
      <Knob key={c.i} c={c} p={params[c.i]} set={set(c.i)} />
    ) : c.kind === 'choice' ? (
      <Choice key={c.i} c={c} p={params[c.i]} set={set(c.i)} wide={wide} />
    ) : (
      <Toggle key={c.i} c={c} p={params[c.i]} set={set(c.i)} />
    );
  const row = (list: FledgeControl[]) => <div className="flex flex-wrap gap-x-1 gap-y-2">{list.map((c) => ctl(c))}</div>;
  const isOn = (i: number) => (params[i]?.value ?? 1) >= 0.5;
  const S = FLEDGE_SECTIONS;

  const osc = (name: string, at: number) => {
    const o = oscControls(at);
    return (
      <Section title={`Oscillator ${name}`} dim={!isOn(at)} right={ctl(o.on)}>
        <div className="flex">{ctl(o.table, true)}</div>
        {row(o.knobs)}
      </Section>
    );
  };
  const lfo = (name: string, at: number) => {
    const l = lfoControls(at);
    const synced = isOn(at + 1);
    return (
      <Section title={name} right={[ctl(l.sync), ctl(l.restart)]}>
        <div className="flex gap-2">
          {ctl(l.shape, true)}
          {synced ? ctl(l.division, true) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {!synced && ctl(l.hz)}
          {l.targets.map((t) => (
            <div key={t.target.i} className="flex items-end gap-1">
              <div className="w-[92px]">{ctl(t.target, true)}</div>
              {ctl(t.amount)}
            </div>
          ))}
        </div>
      </Section>
    );
  };

  if (params.length < FLEDGE.COUNT) return <p className="p-4 text-xs text-forge-muted">Loading the synth…</p>;
  return (
    <div className="w-[760px] max-w-[94vw] p-3 flex flex-col gap-2 text-xs text-forge-text">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 flex-1 min-w-[220px]">
          <span className="text-forge-muted">Preset</span>
          <select
            value={controls.program()}
            onChange={(e) => void controls.setProgram(Number(e.target.value))}
            aria-label="Preset"
            className="flex-1 h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
          >
            {controls.program() < 0 && <option value={-1}>(your own sound)</option>}
            {controls.programs.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[10px] text-forge-muted">Drag a knob up or down; double-click it to put it back.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {osc('A', FLEDGE.A)}
        {osc('B', FLEDGE.B)}
        <Section title="Filter" right={null}>
          <div className="flex">{ctl(S.filter.type, true)}</div>
          {row(S.filter.knobs)}
        </Section>
        <Section title="Sub, noise and FM">{row(S.sources)}</Section>
        <Section title="Envelopes">
          <div className="flex flex-wrap gap-3">
            <div>
              <p className="text-[10px] text-forge-muted mb-1">Volume</p>
              {row(S.ampEnv)}
            </div>
            <div>
              <p className="text-[10px] text-forge-muted mb-1">Filter</p>
              {row(S.filterEnv)}
            </div>
            <div>
              <p className="text-[10px] text-forge-muted mb-1">Pitch drop</p>
              {row(S.pitchEnv)}
            </div>
          </div>
        </Section>
        <Section title="Drive">
          <div className="flex">{ctl(S.drive.type, true)}</div>
          {row(S.drive.knobs)}
        </Section>
        {lfo('LFO 1 (wobble)', FLEDGE.LFO_1)}
        {lfo('LFO 2', FLEDGE.LFO_2)}
        <Section title="Playing">
          <div className="flex items-end gap-2">
            <div className="w-[92px]">{ctl(S.play.mode, true)}</div>
            {S.play.knobs.map((c) => ctl(c))}
          </div>
          <div className="flex items-end gap-1">
            <div className="w-[92px]">{ctl(S.modWheel.target, true)}</div>
            {ctl(S.modWheel.amount)}
            <span className="text-[10px] text-forge-muted pb-1">mod wheel</span>
          </div>
        </Section>
        <Section title="Output">{row(S.output)}</Section>
      </div>
    </div>
  );
};
