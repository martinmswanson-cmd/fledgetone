import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { BuiltinControls, BuiltinParam } from '../../audio/plugins/builtinHost';
import {
  bipolarOf,
  bipolarValue,
  choiceIndex,
  choiceValue,
  drawnPoint,
  FLEDGE_SECTIONS,
  FLEDGE_SYNC_BEATS,
  lfoControls,
  lfoPoint,
  oscControls,
  shapeControls,
  SLOT_NUMBERS,
  slotControls,
  type FledgeControl,
} from '../../audio/plugins/fledgeLayout';
import { fledgeWave, type FledgeWave } from '../../audio/plugins/fledgeWave';
import { macroLabel, macroTargets, wobbleOf } from '../../audio/plugins/fledgeMacros';
import { editPluginParam, editPluginProgram } from '../../store/pluginEdits';

/**
 * Fledge Synth's own window (the synth in engine/fledge-synth): its controls in sections across
 * three tabs (Sound, Modulation, Effects), as a synth's panel lays them out, with the macros and
 * presets always in view, a picture of each oscillator's wave, each LFO's shape, the envelopes,
 * and an editor for the two drawn shapes. The drive has its three places (before the filters,
 * after them, and on the mids and highs after the voices); the LFOs their trigger modes, delay,
 * rise, smooth and key tracking; the 16-slot matrix a curve and a "via" per slot (slots 9 to 16
 * open on request, or when one is used). Knobs drag up and down (Shift for fine steps), take the
 * arrow keys, and double-click back to where they started. Controls find their parameter by its
 * name (see fledgeLayout.ts).
 */

type Ctl<K extends FledgeControl['kind']> = Extract<FledgeControl, { kind: K }>;
type Get = (name: string) => { i: number; p: BuiltinParam } | undefined;
type Set = (name: string, v: number) => void;

/** What a control held by an automation lane says (it follows the lane until the lane goes). */
const HELD_TITLE = 'automated by a lane: delete the lane to set it here';

const TAB_KEY = 'bosBeatbox.fledgeTab';
const TABS = ['Sound', 'Modulation', 'Effects'] as const;
type Tab = (typeof TABS)[number];

const Knob: React.FC<{ c: Ctl<'knob'>; get: Get; set: Set; size?: number }> = ({ c, get, set, size = 36 }) => {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const hit = get(c.p);
  if (!hit) return null;
  const { p } = hit;
  const v = p.value;
  const r = size * 0.36;
  const mid = size / 2;
  // A 270° arc: from the bottom left round to the bottom right (from the top for bipolar ones)
  const angle = (x: number) => (-135 + 270 * x) * (Math.PI / 180);
  const point = (x: number) => [mid + r * Math.sin(angle(x)), mid - r * Math.cos(angle(x))];
  const arc = (from: number, to: number) => {
    const [x0, y0] = point(from);
    const [x1, y1] = point(to);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${Math.abs(to - from) * 270 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const start = c.bipolar ? 0.5 : 0;
  const [from, to] = v >= start ? [start, v] : [v, start];
  const [hx, hy] = point(v);
  const put = (x: number) => set(c.p, Math.max(0, Math.min(1, x)));
  return (
    <div
      className={`flex flex-col items-center w-[50px] select-none ${p.held ? 'opacity-70' : ''}`}
      title={p.held ? `${p.name}: ${p.text}, ${HELD_TITLE}` : `${p.name}: ${p.text}. Drag up or down (Shift: fine); double-click to put it back`}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={p.name}
        aria-readonly={p.held || undefined}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(v.toFixed(3))}
        aria-valuetext={p.text}
        className={`${p.held ? 'cursor-not-allowed outline outline-1 outline-dashed outline-amber-300/60' : 'cursor-ns-resize'} rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-fuchsia-300 touch-none`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          // Each move adds its own step at the scale held now (Shift mid-drag doesn't jump)
          const next = Math.max(0, Math.min(1, drag.current.v + (drag.current.y - e.clientY) / (e.shiftKey ? 1000 : 180)));
          drag.current = { y: e.clientY, v: next };
          put(next);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => set(c.p, p.defaultValue)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.002 : 0.01;
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') put(v + step);
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') put(v - step);
          else if (e.key === 'PageUp') put(v + 0.1);
          else if (e.key === 'PageDown') put(v - 0.1);
          else if (e.key === 'Home') put(0);
          else if (e.key === 'End') put(1);
          else return;
          e.preventDefault();
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
          <path d={arc(0, 1)} fill="none" stroke="currentColor" strokeWidth={3} className="text-forge-border" strokeLinecap="round" />
          {to - from > 0.002 && <path d={arc(from, to)} fill="none" stroke="currentColor" strokeWidth={3} className="text-fuchsia-400" strokeLinecap="round" />}
          <circle cx={mid} cy={mid} r={r * 0.6} className="fill-forge-bg" />
          <line x1={mid} y1={mid} x2={hx} y2={hy} stroke="currentColor" strokeWidth={2} className="text-forge-text" strokeLinecap="round" />
        </svg>
      </div>
      <span className="text-[10px] leading-tight text-forge-text truncate max-w-full">{c.label}</span>
      <span className="text-[9px] leading-tight font-mono text-forge-muted truncate max-w-full">{p.text}</span>
    </div>
  );
};

/** The tempo divisions shortest-last by length (the list itself keeps the engine's order) */
const SYNC_ORDER = FLEDGE_SYNC_BEATS.map((b, i) => [b, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);

const Choice: React.FC<{ c: Ctl<'choice'>; get: Get; set: Set; w?: string; bare?: boolean; order?: number[] }> = ({ c, get, set, w = 'w-[112px]', bare, order }) => {
  const hit = get(c.p);
  if (!hit) return null;
  const select = (
    <select
      value={choiceIndex(hit.p.value, c.options.length, c.cap)}
      onChange={(e) => set(c.p, choiceValue(Number(e.target.value), c.cap))}
      aria-label={hit.p.name}
      disabled={hit.p.held}
      title={hit.p.held ? `${hit.p.name}: ${HELD_TITLE}` : undefined}
      className="h-6 w-full bg-forge-bg border border-forge-border rounded px-1 text-[11px] text-forge-text"
    >
      {(order ?? c.options.map((_, k) => k)).map((k) => (
        <option key={k} value={k}>
          {c.options[k]}
        </option>
      ))}
    </select>
  );
  if (bare) return <div className={w}>{select}</div>;
  return (
    <label className={`flex flex-col gap-0.5 ${w}`}>
      <span className="text-[10px] text-forge-muted">{c.label}</span>
      {select}
    </label>
  );
};

const Toggle: React.FC<{ c: Ctl<'toggle'>; get: Get; set: Set }> = ({ c, get, set }) => {
  const hit = get(c.p);
  if (!hit) return null;
  const on = hit.p.value >= 0.5;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={hit.p.name}
      disabled={hit.p.held}
      title={hit.p.held ? `${hit.p.name}: ${HELD_TITLE}` : undefined}
      onClick={() => set(c.p, on ? 0 : 1)}
      className={`h-6 px-2 rounded border text-[10px] font-mono whitespace-nowrap ${on ? 'border-fuchsia-400/70 bg-fuchsia-500/15 text-fuchsia-100' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
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

/** A small picture: a path over a faint centre line. */
const Picture: React.FC<{ d: string; w?: number; h?: number; label: string }> = ({ d, w = 140, h = 44, label }) => (
  <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="rounded bg-black/30 shrink-0" role="img" aria-label={label}>
    <line x1={0} y1={h / 2} x2={w} y2={h / 2} className="stroke-forge-border" strokeWidth={1} />
    <path d={d} fill="none" className="stroke-fuchsia-300" strokeWidth={1.5} strokeLinejoin="round" />
  </svg>
);

const pathOf = (ys: ArrayLike<number>, w: number, h: number) => {
  let d = '';
  for (let i = 0; i < ys.length; i++) {
    const x = (i / (ys.length - 1)) * w;
    const y = h / 2 - Math.max(-1, Math.min(1, ys[i])) * (h / 2 - 3);
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
};

/** An ADSR's shape from its 0..1 knob values (attack, decay and release as widths on the knobs' curves). */
const adsrPath = (a: number, dcy: number, s: number, rel: number, w: number, h: number) => {
  const unit = w / 3.4;
  const x1 = a * unit;
  const x2 = x1 + dcy * unit;
  const x3 = x2 + 0.5 * unit;
  const x4 = Math.min(w, x3 + rel * unit);
  const y = (v: number) => h - 3 - v * (h - 6);
  return `M0 ${y(0)}L${x1} ${y(1)}L${x2} ${y(s)}L${x3} ${y(s)}L${x4} ${y(0)}`;
};

/**
 * Drag across the 16 bars to draw a shape; or focus it and use Left / Right to pick a step and
 * Up / Down to set it (Shift: finer), Home / End for the ends.
 */
const ShapeEditor: React.FC<{ n: number; get: Get; set: Set }> = ({ n, get, set }) => {
  const { steps, smooth } = shapeControls(n);
  const box = useRef<SVGSVGElement>(null);
  const down = useRef(false);
  const [focus, setFocus] = useState(0);
  const [focused, setFocused] = useState(false);
  const W = 320;
  const H = 96;
  const values = steps.map((c) => bipolarOf(get(c.p)?.p.value ?? 0.5));
  // (Steps an automation lane holds follow the lane, and can't be drawn until it goes)
  const held = steps.map((c) => !!get(c.p)?.p.held);
  const sm = get(smooth.p)?.p.value ?? 0;
  // Steps of 0.05 (easy to hit zero and the ends)
  const put = (i: number, v: number) => !held[i] && set(steps[i].p, bipolarValue(Math.round(Math.max(-1, Math.min(1, v)) * 20) / 20));
  const paint = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const i = Math.max(0, Math.min(15, Math.floor(((e.clientX - r.left) / r.width) * 16)));
    setFocus(i);
    put(i, 1 - 2 * Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
  };
  const curve = Array.from({ length: 161 }, (_, k) => drawnPoint(values, sm, k / 160));
  return (
    <div className="flex items-end gap-3">
      <svg
        ref={box}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="rounded bg-black/30 cursor-crosshair touch-none shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-fuchsia-300"
        role="slider"
        tabIndex={0}
        aria-label={`Shape ${n}, step ${focus + 1} of 16 (Left and Right pick a step, Up and Down set it)`}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={values[focus]}
        aria-valuetext={`Step ${focus + 1}: ${Math.round(values[focus] * 100)}%${held[focus] ? `, ${HELD_TITLE}` : ''}`}
        aria-readonly={held[focus] || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.05 : 0.1;
          if (e.key === 'ArrowLeft') setFocus((f) => (f + 15) % 16);
          else if (e.key === 'ArrowRight') setFocus((f) => (f + 1) % 16);
          else if (e.key === 'ArrowUp') put(focus, values[focus] + step);
          else if (e.key === 'ArrowDown') put(focus, values[focus] - step);
          else if (e.key === 'Home') put(focus, -1);
          else if (e.key === 'End') put(focus, 1);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          down.current = true;
          paint(e);
        }}
        onPointerMove={(e) => down.current && paint(e)}
        onPointerUp={() => (down.current = false)}
        onPointerCancel={() => (down.current = false)}
      >
        {held.some(Boolean) && <title>{`Steps ${held.flatMap((h, i) => (h ? [i + 1] : [])).join(', ')}: ${HELD_TITLE}`}</title>}
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} className="stroke-forge-border" />
        {values.map((v, i) => {
          const x = (i * W) / 16;
          const y = H / 2 - v * (H / 2 - 2);
          const fill = held[i] ? 'fill-amber-300/25 stroke-amber-300/60' : focused && i === focus ? 'fill-fuchsia-400/60' : 'fill-fuchsia-500/30';
          return <rect key={i} x={x + 1} width={W / 16 - 2} y={Math.min(y, H / 2)} height={Math.abs(H / 2 - y)} className={fill} strokeDasharray={held[i] ? '2 2' : undefined} />;
        })}
        <path d={pathOf(curve, W, H)} fill="none" className="stroke-fuchsia-200" strokeWidth={1.5} />
      </svg>
      <Knob c={smooth as Ctl<'knob'>} get={get} set={set} />
    </div>
  );
};

/** The preset list, grouped by the category before the "/" in each name. */
function grouped(names: string[]): Array<[string, Array<{ name: string; i: number }>]> {
  const groups = new Map<string, Array<{ name: string; i: number }>>();
  names.forEach((full, i) => {
    const cut = full.indexOf('/');
    const group = cut > 0 ? full.slice(0, cut) : '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ name: cut > 0 ? full.slice(cut + 1) : full, i });
  });
  return [...groups];
}

export const FledgeSynthPanel: React.FC<{ controls: BuiltinControls }> = ({ controls }) => {
  const params = useSyncExternalStore(controls.subscribe, controls.params);
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as Tab | null;
      return t && TABS.includes(t) ? t : 'Sound';
    } catch {
      return 'Sound';
    }
  });
  const [wave, setWave] = useState<FledgeWave | null>(null);
  // Matrix slots 9 to 16, shown on request (or while one is used)
  const [moreSlots, setMoreSlots] = useState(false);
  useEffect(() => {
    let live = true;
    void fledgeWave(controls.ref.family).then((w) => live && setWave(() => w));
    return () => {
      live = false;
    };
  }, [controls.ref.family]);

  // Parameters by name (the names don't change; the values do)
  const names = params.map((p) => p.name).join('\n');
  const index = useMemo(() => new Map(names.split('\n').map((n, i) => [n, i])), [names]);
  const get: Get = (name) => {
    const i = index.get(name);
    return i === undefined || !params[i] ? undefined : { i, p: params[i] };
  };
  // (A turn of a knob is an undo step, as Pocket's sliders are: see pluginEdits.ts)
  const set: Set = (name, v) => {
    const i = index.get(name);
    // (A drawn shape's steps, drawn in one drag, are one step)
    if (i !== undefined) editPluginParam(controls, i, v, undefined, name.replace(/ step \d+$/, ''));
  };
  const val = (name: string) => get(name)?.p.value ?? 0;
  const isOn = (name: string) => val(name) >= 0.5;
  const pick = (c: FledgeControl) => (c.kind === 'choice' ? choiceIndex(val(c.p), c.options.length, c.cap) : 0);

  const ctl = (c: FledgeControl, key?: React.Key) =>
    c.kind === 'knob' ? <Knob key={key ?? c.p} c={c} get={get} set={set} /> : c.kind === 'choice' ? <Choice key={key ?? c.p} c={c} get={get} set={set} /> : <Toggle key={key ?? c.p} c={c} get={get} set={set} />;
  const row = (list: FledgeControl[]) => <div className="flex flex-wrap gap-x-0.5 gap-y-2">{list.map((c) => ctl(c))}</div>;
  const S = FLEDGE_SECTIONS;

  if (params.length < 200 || !index.has('Level')) return <p className="p-4 text-xs text-forge-muted">Loading the synth…</p>;

  const drawn: [number[], number][] = [1, 2].map((n) => {
    const s = shapeControls(n);
    return [s.steps.map((c) => bipolarOf(val(c.p))), val(s.smooth.p)];
  });

  // What each macro moves (the matrix slots that read it), and its name (the preset's for it)
  const macroRoutes = (k: number) => macroTargets(val, k).join(', ') || 'nothing yet';
  const presetName = controls.programs[controls.program()];
  // The wobble's rate in time with the song, beside the macros (as Pocket has it)
  const wobble = wobbleOf(val);
  // Slots 9 to 16 show when asked for, or while any of them is used
  const showMore = moreSlots || SLOT_NUMBERS.some((n) => n > 8 && pick(slotControls(n).source) > 0 && pick(slotControls(n).target) > 0);

  const osc = (o: 'A' | 'B') => {
    const c = oscControls(o);
    const ys = wave ? wave(pick(c.table), val(c.tone[0].p), pick(c.warp), val(c.warpKnobs[0].p)) : null;
    return (
      <Section title={`Oscillator ${o}`} dim={!isOn(c.on.p)} right={[<Choice key="r" c={c.route as Ctl<'choice'>} get={get} set={set} w="w-[104px]" bare />, ctl(c.on, 'on')]}>
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1.5">
            <Choice c={c.table as Ctl<'choice'>} get={get} set={set} w="w-[176px]" />
            <div className="flex gap-1.5">
              <Choice c={c.warp as Ctl<'choice'>} get={get} set={set} w="w-[74px]" />
              <Choice c={c.stack as Ctl<'choice'>} get={get} set={set} w="w-[96px]" />
            </div>
          </div>
          <Picture d={ys ? pathOf(ys, 140, 52) : ''} h={52} label={`Oscillator ${o}'s wave`} />
        </div>
        {row(c.tone)}
        <div className="flex flex-wrap gap-x-0.5">
          {c.unison.map((k) => ctl(k))}
          {c.warpKnobs.map((k) => ctl(k))}
        </div>
      </Section>
    );
  };

  const lfo = (n: number) => {
    const l = lfoControls(n);
    const synced = isOn(l.sync.p);
    const shape = pick(l.shape);
    const mode = pick(l.mode);
    const ys = Array.from({ length: 141 }, (_, k) => lfoPoint(shape, k / 140 + val(l.knobs[0].p), drawn));
    // (Free LFOs follow the song, shared by every note: no retrigger, no key tracking)
    const [phase, delay, rise, smooth, keytrack] = l.knobs;
    return (
      <Section key={n} title={n === 1 ? 'LFO 1' : `LFO ${n}`} right={ctl(l.sync, 'sync')}>
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex gap-1.5">
              <Choice c={l.shape as Ctl<'choice'>} get={get} set={set} w="w-[84px]" />
              {synced ? <Choice c={l.division as Ctl<'choice'>} get={get} set={set} w="w-[64px]" order={SYNC_ORDER} /> : null}
            </div>
            <div className="flex gap-1.5">
              <Choice c={l.mode as Ctl<'choice'>} get={get} set={set} w="w-[84px]" />
              {mode > 0 ? <Choice c={l.retrig as Ctl<'choice'>} get={get} set={set} w="w-[104px]" /> : null}
            </div>
          </div>
          <Picture d={pathOf(ys, 120, 44)} w={120} label={`LFO ${n}'s shape`} />
        </div>
        <div className="flex flex-wrap items-end gap-x-0.5 gap-y-2">
          {!synced && ctl(l.hz)}
          {[phase, delay, rise, smooth].map((k) => ctl(k))}
          {mode > 0 && ctl(keytrack)}
          {mode === 3 && ctl(l.sustain)}
        </div>
        {l.targets.map((t) => (
          <div key={t.target.p} className="flex items-end gap-1">
            <Choice c={t.target as Ctl<'choice'>} get={get} set={set} w="w-[120px]" />
            {ctl(t.amount)}
          </div>
        ))}
      </Section>
    );
  };

  const env = (title: string, list: FledgeControl[]) => {
    const [a, dcy, s, r] = list.map((c) => val(c.p));
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-forge-muted w-[64px]">{title}</p>
          <Picture d={adsrPath(a, dcy, s, r, 120, 30)} w={120} h={30} label={`${title} envelope`} />
        </div>
        {row(list)}
      </div>
    );
  };

  const fx = (title: string, on: FledgeControl, body: React.ReactNode) => (
    <Section title={title} dim={!isOn(on.p)} right={ctl(on, 'on')}>
      {body}
    </Section>
  );

  const program = controls.program();
  const step = (d: number) => {
    const n = controls.programs.length;
    if (n) void editPluginProgram(controls, (((program < 0 ? (d > 0 ? -1 : 0) : program) + d) % n + n) % n);
  };

  return (
    <div className="w-[820px] max-w-[94vw] p-3 flex flex-col gap-2 text-xs text-forge-text">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 flex-1 min-w-[260px]">
          <span className="text-forge-muted mr-1">Preset</span>
          <button type="button" onClick={() => step(-1)} className="h-7 w-7 flex items-center justify-center rounded border border-forge-border text-forge-muted hover:text-forge-text" aria-label="Previous preset">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <select
            value={program}
            onChange={(e) => void editPluginProgram(controls, Number(e.target.value))}
            aria-label="Preset"
            className="flex-1 h-7 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
          >
            {program < 0 && <option value={-1}>(your own sound)</option>}
            {grouped(controls.programs).map(([group, list]) =>
              group ? (
                <optgroup key={group} label={group}>
                  {list.map(({ name, i }) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ) : (
                list.map(({ name, i }) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))
              )
            )}
          </select>
          <button type="button" onClick={() => step(1)} className="h-7 w-7 flex items-center justify-center rounded border border-forge-border text-forge-muted hover:text-forge-text" aria-label="Next preset">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-end gap-1 rounded-md border border-forge-border bg-forge-bg/40 px-2 py-1">
          {S.macros.map((m, k) => (
            <div key={m.p} className="flex flex-col items-center" title={`${m.label} moves: ${macroRoutes(k + 1)}`}>
              <Knob c={{ ...(m as Ctl<'knob'>), label: macroLabel(presetName, k + 1, macroTargets(val, k + 1)) }} get={get} set={set} size={32} />
              <span className="text-[9px] text-fuchsia-200/80 max-w-[50px] truncate">{macroRoutes(k + 1)}</span>
            </div>
          ))}
          {wobble && (
            <div className="self-center" title={`LFO ${wobble.lfo}'s rate, in time with the song (its other settings are under Modulation)`}>
              <Choice c={{ ...(lfoControls(wobble.lfo).division as Ctl<'choice'>), label: wobble.label }} get={get} set={set} w="w-[72px]" order={SYNC_ORDER} />
            </div>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Fledge Synth sections" className="flex gap-1 border-b border-forge-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              try {
                localStorage.setItem(TAB_KEY, t);
              } catch {
                // Storage blocked: remembered for this visit only
              }
            }}
            className={`h-7 px-3 -mb-px rounded-t border text-[11px] ${tab === t ? 'border-forge-border border-b-forge-panel bg-forge-panel text-fuchsia-100' : 'border-transparent text-forge-muted hover:text-forge-text'}`}
          >
            {t}
          </button>
        ))}
        <p className="ml-auto self-center text-[10px] text-forge-muted">Drag a knob up or down; double-click it to put it back.</p>
      </div>

      {tab === 'Sound' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {osc('A')}
          {osc('B')}
          <Section title="Filter 1">
            <div className="flex">{ctl(S.filter1.type)}</div>
            {row(S.filter1.knobs)}
          </Section>
          <Section title="Filter 2" right={ctl(S.filter2.serial, 'serial')}>
            <div className="flex">{ctl(S.filter2.type)}</div>
            {row(S.filter2.knobs)}
          </Section>
          <Section title="Sub, noise and FM" right={<Choice c={S.subPath as Ctl<'choice'>} get={get} set={set} w="w-[140px]" bare />}>
            {row(S.sources)}
            <p className="text-[10px] text-forge-muted -mt-1">
              {pick(S.subPath) === 1 ? 'The sub is mixed in clean and mono after the drive, OTT and effects.' : 'The sub goes through the drive, OTT and effects with the rest (as older sounds had it).'}
            </p>
          </Section>
          <Section title="Drive" className="md:col-span-2">
            <p className="text-[10px] text-forge-muted -mt-1">Up to three places, each levelled so turning it up adds grit, not volume. Bitcrush and Downsample use Crush for bits and rate.</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(
                [
                  ['Before the filters', S.preDrive, []],
                  ['After the filters', S.drive, []],
                  ['Mids and highs (lows stay clean)', S.bandDrive, S.bandDrive.split],
                ] as Array<[string, { type: FledgeControl; knobs: FledgeControl[] }, FledgeControl[]]>
              ).map(([title, d, extra]) => {
                const kind = pick(d.type);
                const crushing = kind === 7 || kind === 8;
                return (
                  <div key={title} className={`flex flex-col gap-1.5 ${kind === 0 ? 'opacity-60' : ''}`}>
                    <p className="text-[10px] text-fuchsia-200/80">{title}</p>
                    <div className="flex">{ctl(d.type)}</div>
                    <div className="flex flex-wrap gap-x-0.5 gap-y-2">
                      {d.knobs.filter((k) => crushing || !k.p.endsWith(' crush')).map((k) => ctl(k))}
                      {extra.map((k) => ctl(k))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
          <Section title="Envelopes" className="md:col-span-2">
            <div className="flex flex-wrap gap-4">
              {env('Volume', S.ampEnv)}
              {env('Filter', S.filterEnv)}
              <div className="flex flex-col gap-1">
                <p className="text-[10px] text-forge-muted">Pitch drop (a dive into each note)</p>
                <div className="flex items-end gap-1">
                  {row(S.pitchEnv)}
                  <Choice c={S.pitchCurve as Ctl<'choice'>} get={get} set={set} w="w-[96px]" />
                </div>
              </div>
            </div>
          </Section>
          <Section title="Playing" className="md:col-span-2">
            <div className="flex flex-wrap items-end gap-2">
              {ctl(S.play.mode)}
              {S.play.knobs.map((c) => ctl(c))}
              {S.glide.map((c) => (
                <Choice key={c.p} c={c as Ctl<'choice'>} get={get} set={set} w="w-[108px]" />
              ))}
            </div>
          </Section>
        </div>
      )}

      {tab === 'Modulation' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {[1, 2, 3, 4].map(lfo)}
          <Section title="Mod envelope">{env('Mod env', S.modEnv)}</Section>
          <Section title="Chaos and random">
            <p className="text-[10px] text-forge-muted -mt-1">
              Chaos steps to a new random level at its rate; Note random picks one per note. Both follow the song, so they play the same each time, and repeat as set.
            </p>
            <div className="flex flex-wrap items-end gap-1.5">
              <Choice c={S.chaos.rate as Ctl<'choice'>} get={get} set={set} w="w-[72px]" order={SYNC_ORDER} />
              {ctl(S.chaos.smooth)}
              <Choice c={S.chaos.cycle as Ctl<'choice'>} get={get} set={set} w="w-[96px]" />
            </div>
          </Section>
          <Section
            title="Matrix"
            className="md:col-span-2"
            right={
              <button
                type="button"
                onClick={() => setMoreSlots((m) => !m)}
                aria-expanded={showMore}
                className="h-6 px-2 rounded border border-forge-border text-[10px] text-forge-muted hover:text-forge-text"
              >
                {showMore ? 'Slots 1 to 8' : 'Slots 9 to 16'}
              </button>
            }
          >
            <p className="text-[10px] text-forge-muted -mt-1">
              Any source moves any target, by its amount (either way), bent by its curve; a Via source scales the amount (velocity, a macro, note random…). The macros use slots 5 to 8 in the presets.
            </p>
            <div className="flex items-end gap-1 text-[10px] text-forge-muted" aria-hidden>
              <span className="w-4" />
              <span className="w-[110px]">Source</span>
              <span className="w-[14px]" />
              <span className="w-[110px]">Target</span>
              <span className="w-[50px] text-center">Amount</span>
              <span className="w-[96px]">Curve</span>
              <span className="w-[110px]">Via</span>
            </div>
            {SLOT_NUMBERS.filter((n) => n <= 8 || showMore).map((n) => {
              const s = slotControls(n);
              const used = pick(s.source) > 0 && pick(s.target) > 0;
              return (
                <div key={n} className={`flex flex-wrap items-center gap-1 ${used ? '' : 'opacity-70'}`}>
                  <span className="text-[10px] text-forge-muted w-4 text-right">{n}</span>
                  <Choice c={s.source as Ctl<'choice'>} get={get} set={set} w="w-[110px]" bare />
                  <span className="text-forge-muted w-[14px] text-center">→</span>
                  <Choice c={s.target as Ctl<'choice'>} get={get} set={set} w="w-[110px]" bare />
                  <Knob c={{ ...(s.amount as Ctl<'knob'>), label: '' }} get={get} set={set} size={28} />
                  <Choice c={s.curve as Ctl<'choice'>} get={get} set={set} w="w-[96px]" bare />
                  <Choice c={s.via as Ctl<'choice'>} get={get} set={set} w="w-[110px]" bare />
                </div>
              );
            })}
          </Section>
          <Section title="Drawn shapes (LFO shapes Drawn 1 and 2)">
            {[1, 2].map((n) => (
              <div key={n} className="flex flex-col gap-1">
                <p className="text-[10px] text-forge-muted">Shape {n}: drag across the bars to draw it (or use the arrow keys); Smooth slides each step into the next</p>
                <ShapeEditor n={n} get={get} set={set} />
              </div>
            ))}
          </Section>
        </div>
      )}

      {tab === 'Effects' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {fx('EQ', S.eq.on, row(S.eq.knobs))}
          {fx(
            'Chorus',
            S.chorus.on,
            row(S.chorus.knobs)
          )}
          {fx(
            'Phaser',
            S.phaser.on,
            <>
              <div className="flex">{ctl(S.phaser.mode)}</div>
              {row(S.phaser.knobs)}
            </>
          )}
          {fx(
            'Delay',
            S.delay.on,
            <>
              <div className="flex items-end gap-1.5">
                {ctl(S.delay.sync)}
                {ctl(S.delay.pingpong)}
              </div>
              <div className="flex flex-wrap items-end gap-x-0.5 gap-y-2">
                {isOn(S.delay.sync.p) ? <Choice c={S.delay.division as Ctl<'choice'>} get={get} set={set} w="w-[72px]" /> : ctl(S.delay.ms)}
                {S.delay.knobs.map((c) => ctl(c))}
              </div>
            </>
          )}
          {fx('Reverb', S.reverb.on, row(S.reverb.knobs))}
          <Section title="Output">
            <p className="text-[10px] text-forge-muted -mt-1">Below 120 Hz the sound stays mono, and nothing passes −1 dB.</p>
            {row(S.output)}
          </Section>
        </div>
      )}
    </div>
  );
};
