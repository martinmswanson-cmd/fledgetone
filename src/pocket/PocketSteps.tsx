/**
 * Pocket's step lane, pinned under its piano roll: one lane at a time, for one of the track's
 * Fledge Synth macros (the Filter's cutoff on other instruments), a column per step lined up with
 * the roll's 16ths. Drag a finger across the steps to set their heights; with the Erase pen it
 * clears them (a cleared step holds the value before). The name at the left picks the macro
 * shown. Each drag is one undo step. The studio's piano roll has every target, grid and tool
 * (store/stepLanes.ts).
 */
import React, { useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { uid, type StepLane, type StepTarget, type Track } from '../store/timelineTypes';
import { DEFAULT_STEP_GRID, instTarget, paintSteps, stepBars, stepValues } from '../store/stepLanes';
import { isFledgeUrl } from '../audio/plugins/fledgeMacros';
import { fledgeMacros, heldBefore, useInstrumentParams } from '../components/timeline/stepTargets';
import { cellClip } from './pocketSections';
import type { PocketSection } from './pocketSections';
import { STEPS_PER_WHOLE } from './pocketGrid';

export const POCKET_LANE_H = 58;

/** The macro (or setting) each track's lane shows, while the app is open. */
const shownTarget = new Map<string, StepTarget>();

export const PocketSteps: React.FC<{ track: Track; sec: PocketSection; rw: number; keyW: number; erase: boolean }> = ({ track, sec, rw, keyW, erase }) => {
  const params = useInstrumentParams(track);
  const fledge = !!track.plugin && isFledgeUrl(track.plugin.url);
  const choices = useMemo(() => {
    if (!fledge) return [{ target: 'filterCutoff' as StepTarget, label: 'Filter' }];
    const macros = fledgeMacros(track, params);
    const moving = macros.filter((m) => m.moves.length);
    return (moving.length ? moving : macros).map((m) => ({ target: instTarget(`Macro ${m.k}`), label: m.label }));
  }, [fledge, track, params]);
  const [, setTick] = useState(0);
  const target = choices.find((c) => c.target === shownTarget.get(track.id))?.target ?? choices[0].target;
  const label = choices.find((c) => c.target === target)?.label ?? 'Steps';
  const clips = useTimelineStore((s) => s.clips);
  const steps = Math.round((sec.to - sec.from) * STEPS_PER_WHOLE);
  // The cell's clip, when it's one clip spanning the section (as an edit makes it)
  const clip = clips.find((c) => c.trackId === track.id && !c.audio && Math.abs(c.startBar - sec.from) < 1e-6 && Math.abs(c.lengthBars - (sec.to - sec.from)) < 1e-6);
  const lane = clip?.stepLanes?.find((l) => l.target === target);
  const length = sec.to - sec.from;
  const values = lane ? stepValues(lane, length) : Array.from({ length: steps }, () => null);
  const stepW = (lane ? stepBars(lane) : 1 / STEPS_PER_WHOLE) * STEPS_PER_WHOLE * rw;
  const surf = useRef<HTMLDivElement>(null);
  const inner = POCKET_LANE_H - 10;

  const next = () => {
    const i = choices.findIndex((c) => c.target === target);
    shownTarget.set(track.id, choices[(i + 1) % choices.length].target);
    setTick((x) => x + 1);
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    surf.current?.setPointerCapture(e.pointerId);
    const id = cellClip(track.id, sec, true);
    if (!id) return;
    const s = useTimelineStore.getState();
    const c = s.clips.find((x) => x.id === id);
    if (!c) return;
    s.checkpoint();
    let current: StepLane = c.stepLanes?.find((l) => l.target === target) ?? { id: uid('steps'), target, grid: DEFAULT_STEP_GRID, steps: [] };
    const step = stepBars(current) * STEPS_PER_WHOLE * rw;
    const count = stepValues(current, c.lengthBars).length;
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = surf.current!.getBoundingClientRect();
      return { i: Math.max(0, Math.min(count - 1, Math.floor((ev.clientX - r.left) / step))), v: Math.max(0, Math.min(1, 1 - (ev.clientY - r.top - 5) / inner)) };
    };
    const paint = (p: { i: number; v: number }, from: { i: number; v: number }) => {
      const n = Math.abs(p.i - from.i);
      for (let k = 0; k <= n; k++) {
        const i = from.i + Math.sign(p.i - from.i) * k;
        current = paintSteps(current, c.lengthBars, i, i, erase ? null : Math.round((n ? from.v + ((p.v - from.v) * k) / n : p.v) * 100) / 100);
      }
      const st = useTimelineStore.getState();
      const live = st.clips.find((x) => x.id === id);
      if (!live) return;
      const others = (live.stepLanes ?? []).filter((l) => l.id !== current.id && l.target !== current.target);
      const mine = current;
      st.setClipStepLanes(id, current.steps.length ? [...others, mine] : others, false);
    };
    let last = at(e);
    paint(last, last);
    const el = surf.current!;
    const move = (ev: PointerEvent) => {
      const p = at(ev);
      paint(p, last);
      last = p;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const holds = heldBefore(values);
  return (
    <>
      <button type="button" className="pk-slabel" style={{ width: keyW, height: POCKET_LANE_H }} onClick={next} aria-label={`Step lane: ${label}. Tap for another`}>
        <small>STEPS</small>
        <span>{label}</span>
      </button>
      <div ref={surf} className="pk-ssurf" style={{ height: POCKET_LANE_H, width: steps * rw, ['--rw' as string]: `${rw}px` }} onPointerDown={down} aria-label={`${label} steps: drag a finger across them${erase ? ' to clear them' : ''}`}>
        {values.map((v, i) => {
          if (v === null) {
            const h = holds[i];
            return h === null ? null : <i key={i} className="pk-shold" style={{ left: i * stepW, width: stepW - 2, bottom: 5 + h * inner }} />;
          }
          return <i key={i} className="pk-sbar" style={{ left: i * stepW + 1, width: Math.max(2, stepW - 3), height: Math.max(2, v * inner) }} />;
        })}
      </div>
    </>
  );
};
