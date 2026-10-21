import React, { useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, StepLane, StepTarget, Track } from '../../store/timelineTypes';
import { uid } from '../../store/timelineTypes';
import {
  DEFAULT_STEP_GRID,
  MAX_STEP_LANES,
  paintSteps,
  randomiseSteps,
  regridSteps,
  repeatSteps,
  rotateSteps,
  STEP_GRIDS,
  stepBars,
  stepValues,
} from '../../store/stepLanes';
import { defaultStepTarget, formatStepValue, heldBefore, STEP_BAR_H, STEP_LANE_H, stepTargetLabel, stepTargetOptions, useInstrumentParams } from './stepTargets';

/**
 * The piano roll's step lanes, under the notes (store/stepLanes.ts): a row of steps per lane on
 * its own grid (1/16, 1/32, triplets, 1/8), each holding a value for one of the track's settings
 * (a Fledge Synth macro, another of the plugin's parameters, the Filter's cutoff...). Drag across
 * the steps to paint their heights; right-drag (or Alt-drag) to clear them (a cleared step holds
 * the value before); the toolbar's tools randomise (seeded, within a range), repeat the first
 * steps, shift them round and turn on "per note" (the value changes at each note in a set step).
 * Each drag or tool is one undo step.
 */


interface Props {
  clip: Clip;
  track: Track | undefined;
  keyWidth: number;
  /** px per bar */
  barW: number;
  color: string;
  /** Shown with no lanes (the + Step lane button) */
  open: boolean;
  onClose: () => void;
}

let randomCount = 0;

export const StepLanes: React.FC<Props> = ({ clip, track, keyWidth, barW, color, open, onClose }) => {
  const lanes = useMemo(() => clip.stepLanes ?? [], [clip.stepLanes]);
  const params = useInstrumentParams(track);
  const options = useMemo(() => stepTargetOptions(track, params), [track, params]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = lanes.find((l) => l.id === focusId) ?? lanes[0];
  const [range, setRange] = useState<[number, number]>([0.2, 0.9]);
  const [repeatN, setRepeatN] = useState(16);
  const width = clip.lengthBars * barW;
  const store = () => useTimelineStore.getState();
  if (!lanes.length && !open) return null;

  const write = (next: StepLane[], record = true) => store().setClipStepLanes(clip.id, next, record);
  const replace = (lane: StepLane, record = true) => write(lanes.map((l) => (l.id === lane.id ? lane : l)), record);
  const addLane = () => {
    if (lanes.length >= MAX_STEP_LANES) return;
    const target = defaultStepTarget(track, params, new Set(lanes.map((l) => l.target)));
    const lane: StepLane = { id: uid('steps'), target, grid: DEFAULT_STEP_GRID, steps: [] };
    write([...lanes, lane]);
    setFocusId(lane.id);
  };
  const removeLane = (lane: StepLane) => {
    write(lanes.filter((l) => l.id !== lane.id));
    if (lanes.length <= 1) onClose();
  };
  const select = 'h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] font-mono text-forge-text focus:outline-none focus:border-cyan-500';
  const tool = 'h-6 px-1.5 rounded border border-forge-border text-[10px] font-mono text-forge-text hover:border-forge-borderLight disabled:opacity-40';

  return (
    <div className="flex flex-col bg-forge-panel border-t border-forge-border" style={{ width: keyWidth + width }} onPointerDown={(e) => e.stopPropagation()} data-step-lanes>
      {/* The focused lane's settings and tools */}
      <div className="sticky left-0 z-10 flex items-center gap-1.5 px-1.5 bg-forge-panel w-max max-w-[100vw]" style={{ height: STEP_BAR_H }}>
        <span className="text-[10px] font-mono text-forge-muted" title="Rows of steps that move one of the track's settings, a value per step: the sound changes on every step instead of wobbling">
          STEPS
        </span>
        {focus && (
          <>
            <select
              className={`${select} max-w-[180px]`}
              aria-label="What the step lane moves"
              value={focus.target}
              onChange={(e) => replace({ ...focus, target: e.target.value as StepTarget })}
              title="What this lane moves"
            >
              {!options.some((o) => o.target === focus.target) && <option value={focus.target}>{stepTargetLabel(focus.target, options)}</option>}
              {[...new Set(options.map((o) => o.group))].map((g) => (
                <optgroup key={g} label={g}>
                  {options
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <option key={o.target} value={o.target}>
                        {o.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <select className={select} aria-label="Step length" value={focus.grid} onChange={(e) => replace(regridSteps(focus, clip.lengthBars, Number(e.target.value)))} title="Step length">
              {STEP_GRIDS.map((g) => (
                <option key={g.units} value={g.units}>
                  {g.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[10px] font-mono text-forge-text cursor-pointer" title="Per note: the value changes at each note that starts in a set step (and holds until the next), so the sound changes with the notes rather than on the grid">
              <input type="checkbox" className="accent-cyan-500" checked={!!focus.perNote} onChange={(e) => replace({ ...focus, perNote: e.target.checked || undefined })} />
              per note
            </label>
            <span className="w-px h-4 bg-forge-border" />
            <button
              type="button"
              className={tool}
              title={`New random values on every step between ${Math.round(range[0] * 100)}% and ${Math.round(range[1] * 100)}% (each press another set; Undo brings the last back)`}
              onClick={() => replace(randomiseSteps(focus, clip.lengthBars, hashSeed(`${focus.id}:${++randomCount}`), range[0], range[1]))}
            >
              Random
            </button>
            <button
              type="button"
              className={tool}
              title="Random values on about half the steps (the others hold the one before)"
              onClick={() => replace(randomiseSteps(focus, clip.lengthBars, hashSeed(`${focus.id}:${++randomCount}`), range[0], range[1], 0.5))}
            >
              Some
            </button>
            <label className="flex items-center gap-0.5 text-[10px] font-mono text-forge-muted" title="The range random values fall in">
              <input type="number" min={0} max={100} step={5} value={Math.round(range[0] * 100)} onChange={(e) => setRange([Math.max(0, Math.min(100, Number(e.target.value))) / 100, range[1]])} className={`${select} w-11`} aria-label="Random from" />
              –
              <input type="number" min={0} max={100} step={5} value={Math.round(range[1] * 100)} onChange={(e) => setRange([range[0], Math.max(0, Math.min(100, Number(e.target.value))) / 100])} className={`${select} w-11`} aria-label="Random to" />
            </label>
            <span className="w-px h-4 bg-forge-border" />
            <button type="button" className={tool} title={`Copy the first ${repeatN} steps across the whole clip`} onClick={() => replace(repeatSteps(focus, clip.lengthBars, repeatN))}>
              Repeat
            </button>
            <select className={select} aria-label="Steps to repeat" value={repeatN} onChange={(e) => setRepeatN(Number(e.target.value))} title="How many steps Repeat copies">
              {[2, 3, 4, 6, 8, 12, 16, 24, 32].map((n) => (
                <option key={n} value={n}>
                  first {n}
                </option>
              ))}
            </select>
            <button type="button" className={tool} title="Shift the steps one step earlier (the first goes to the end)" onClick={() => replace(rotateSteps(focus, clip.lengthBars, -1))}>
              ←
            </button>
            <button type="button" className={tool} title="Shift the steps one step later (the last comes round to the start)" onClick={() => replace(rotateSteps(focus, clip.lengthBars, 1))}>
              →
            </button>
            <button type="button" className={tool} title="Clear every step" onClick={() => replace({ ...focus, steps: focus.steps.filter((s) => s.at < 0 || s.at >= clip.lengthBars) })}>
              Clear
            </button>
            <button type="button" className={tool} title="Remove this step lane" aria-label="Remove step lane" onClick={() => removeLane(focus)}>
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
        <button type="button" className={tool} onClick={addLane} disabled={lanes.length >= MAX_STEP_LANES} title="Add a step lane">
          <span className="flex items-center gap-0.5">
            <Plus className="w-3 h-3" /> Lane
          </span>
        </button>
        {!lanes.length && <span className="text-[10px] text-forge-muted">Add a lane, then drag across its steps</span>}
      </div>
      {lanes.map((lane) => (
        <LaneRow key={lane.id} clip={clip} lane={lane} label={stepTargetLabel(lane.target, options)} focused={lane === focus} onFocus={() => setFocusId(lane.id)} keyWidth={keyWidth} barW={barW} color={color} onWrite={replace} />
      ))}
    </div>
  );
};

/** A string's FNV-1a hash: the seed of a randomise. */
function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const PAD = 3;

const LaneRow: React.FC<{
  clip: Clip;
  lane: StepLane;
  label: string;
  focused: boolean;
  onFocus: () => void;
  keyWidth: number;
  barW: number;
  color: string;
  onWrite: (lane: StepLane, record: boolean) => void;
}> = ({ clip, lane, label, focused, onFocus, keyWidth, barW, color, onWrite }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const values = stepValues(lane, clip.lengthBars);
  const stepW = stepBars(lane) * barW;
  const h = STEP_LANE_H;
  const width = clip.lengthBars * barW;
  const inner = h - 2 * PAD;

  const at = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { i: Math.max(0, Math.min(values.length - 1, Math.floor((e.clientX - r.left) / stepW))), v: Math.max(0, Math.min(1, 1 - (e.clientY - r.top - PAD) / inner)) };
  };

  /** Paint (or clear) steps under the pointer until it's let go: one undo step. */
  const onDown = (e: React.PointerEvent) => {
    onFocus();
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    const clear = e.button === 2 || e.altKey;
    useTimelineStore.getState().checkpoint();
    let current = lane;
    let last = at(e);
    const paint = (from: { i: number; v: number }, to: { i: number; v: number }) => {
      // Every step between the last place and this one (a quick drag skips none), heights in a line
      const n = Math.abs(to.i - from.i);
      for (let k = 0; k <= n; k++) {
        const i = from.i + Math.sign(to.i - from.i) * k;
        const v = n ? from.v + ((to.v - from.v) * k) / n : to.v;
        current = paintSteps(current, clip.lengthBars, i, i, clear ? null : Math.round(v * 100) / 100);
      }
      onWrite(current, false);
    };
    paint(last, last);
    const move = (ev: PointerEvent) => {
      const p = at(ev);
      paint(last, p);
      last = p;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // A cleared step holds the value before it: drawn as a faint continuation
  const holds = heldBefore(values);
  return (
    <div className="flex border-t border-forge-border/60" style={{ height: h }}>
      <button
        type="button"
        onClick={onFocus}
        className={`sticky left-0 z-10 shrink-0 px-1 text-left text-[9px] font-mono leading-tight border-r border-forge-border bg-forge-panel ${focused ? 'text-cyan-200' : 'text-forge-muted hover:text-forge-text'}`}
        style={{ width: keyWidth }}
        title={`${label}${lane.perNote ? ' (per note)' : ''}: click to edit this lane's settings above`}
      >
        <span className="line-clamp-2">{label}</span>
        {lane.perNote && <span className="text-[9px] text-forge-muted">♪ per note</span>}
      </button>
      <svg
        ref={svgRef}
        width={width}
        height={h}
        className="block cursor-crosshair touch-none"
        onPointerDown={onDown}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={`${label} steps`}
      >
        {values.map((v, i) => {
          const x = i * stepW;
          const w = Math.max(1, Math.min(stepW, width - x) - 1);
          if (v === null) {
            const hold = holds[i];
            return (
              <g key={i}>
                <rect x={x} y={PAD} width={w} height={inner} fill="rgba(255,255,255,0.03)" />
                {hold !== null && <line x1={x} x2={x + w} y1={PAD + (1 - hold) * inner} y2={PAD + (1 - hold) * inner} stroke={color} strokeOpacity={0.45} strokeDasharray="2 2" />}
              </g>
            );
          }
          return (
            <g key={i}>
              <rect x={x} y={PAD} width={w} height={inner} fill="rgba(255,255,255,0.05)" />
              <rect x={x} y={PAD + (1 - v) * inner} width={w} height={Math.max(1.5, v * inner)} fill={color} fillOpacity={focused ? 0.85 : 0.6} rx={1}>
                <title>
                  Step {i + 1}: {formatStepValue(lane.target, v)}
                </title>
              </rect>
            </g>
          );
        })}
        {/* Beat lines */}
        {Array.from({ length: Math.ceil(clip.lengthBars * 4) + 1 }, (_, b) => (
          <line key={b} x1={(b * barW) / 4} x2={(b * barW) / 4} y1={0} y2={h} stroke={b % 4 === 0 ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)'} />
        ))}
      </svg>
    </div>
  );
};
