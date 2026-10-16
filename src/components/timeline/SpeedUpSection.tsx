/**
 * The Arrange a beat dialog's "Speed up into the drop" section (Drops tab): pick a block of bars
 * (the loop, the selected clips, or typed), how much of its end speeds up and by how much, the
 * curve, and what happens on the drop; it shows the bars, beats and tempos before you press it.
 * The store side is speedUpActions.ts; the maths is speedUp.ts.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { showToast } from './toastStore';
import { songMeterOf, songTempo, useTimelineStore } from '../../store/timelineStore';
import { barBeat, describeBeats, speedUpPoints, SPEED_CURVES, SPEED_UP_DEFAULTS, type SpeedCurve } from '../../store/speedUp';
import { selectedSpan, speedUpIntoDrop, suggestBlock } from '../../store/speedUpActions';
import type { ArrangeRange } from './arrangeDialogStore';

const field = 'flex flex-col gap-1 text-[11px] text-forge-muted';
const control = 'bg-forge-bg border border-forge-border rounded px-2 py-1 text-xs text-forge-text';
const primary = 'px-3 py-1.5 rounded bg-cyan-500 text-black text-xs font-semibold hover:bg-cyan-400 disabled:opacity-40';
const small = 'px-2 py-1 rounded border border-forge-border text-[11px] text-forge-text hover:border-forge-borderLight disabled:opacity-40';

/** The choices made last, kept while the app is open (set outside render). */
const last = { ...SPEED_UP_DEFAULTS, roll: false };

const round16 = (bar: number) => Math.round(bar * 16) / 16;
const show = (bar: number) => `${Math.round(bar * 1000) / 1000}`;

/** Speed up into the drop: the controls and the button. `range` is the block it was opened for. */
export const SpeedUpSection: React.FC<{ range?: ArrangeRange; bar?: number }> = ({ range, bar }) => {
  const initial = useMemo(() => range ?? suggestBlock(bar), [range, bar]);
  const [from, setFrom] = useState(round16(initial.from));
  const [to, setTo] = useState(round16(initial.to));
  const [o, setO] = useState(last);
  const tempoPoints = useTimelineStore((s) => s.tempoPoints);
  const bpm = useTimelineStore((s) => s.bpm);
  const meterPoints = useTimelineStore((s) => s.meterPoints);
  const meter = useTimelineStore((s) => s.meter);
  const loop = useTimelineStore((s) => s.loopRegion);
  const hasSelection = useTimelineStore((s) => s.clips.some((c) => c.isSelected));
  const ref = useRef<HTMLElement>(null);
  // Opened for a block (Speed up into here): bring this section into view
  useEffect(() => {
    if (range) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [range]);
  const set = (patch: Partial<typeof o>) => setO((x) => {
    const next = { ...x, ...patch };
    Object.assign(last, next);
    return next;
  });
  const opts = { from, to, share: o.share, amount: o.amount, curve: o.curve, snapBack: o.snapBack };
  const plan = useMemo(() => {
    const st = { bpm, tempoPoints, meter, meterPoints };
    return speedUpPoints(tempoPoints, songTempo(st), songMeterOf(st), { from, to, share: o.share, amount: o.amount, curve: o.curve, snapBack: o.snapBack }, () => 'preview');
  }, [bpm, tempoPoints, meter, meterPoints, from, to, o.share, o.amount, o.curve, o.snapBack]);
  const meterMap = songMeterOf({ meter, meterPoints });
  const num = (v: string, min: number) => Math.max(min, round16(Number(v) || min));
  const preview =
    typeof plan === 'string'
      ? plan
      : `The last ${describeBeats(plan.beats, plan.start, meterMap)} (from ${barBeat(plan.start, meterMap)} to the drop at ${barBeat(plan.drop, meterMap)}): ${Math.round(plan.fromBpm * 10) / 10} → ${Math.round(plan.toBpm * 10) / 10} BPM${plan.capped ? ' (held at 240, the fastest)' : ''}, then ${o.snapBack ? `back to ${Math.round(plan.afterBpm * 10) / 10} on the drop` : 'staying there'}.${plan.replaced ? ` Replaces ${plan.replaced} tempo change${plan.replaced === 1 ? '' : 's'} in there.` : ''}`;
  const pickSpan = (span: { from: number; to: number } | null) => {
    if (!span) return;
    setFrom(round16(span.from));
    setTo(round16(span.to));
  };
  return (
    <section ref={ref} className="flex flex-col gap-2 border-t border-forge-border pt-3" aria-label="Speed up into the drop">
      <h4 className="text-xs font-semibold text-forge-text">Speed up into the drop</h4>
      <p className="text-[11px] text-forge-muted">The tempo rises over the end of a block of music, for the rush into a drop. It writes ordinary tempo glides, so playback, exports, the metronome and the grid all follow it.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className={field}>
          Block from bar
          <input type="number" min={1} step={1} className={`${control} w-20`} value={show(from)} onChange={(e) => setFrom(num(e.target.value, 1))} />
        </label>
        <label className={field}>
          to the drop at bar
          <input type="number" min={2} step={1} className={`${control} w-20`} value={show(to)} onChange={(e) => setTo(num(e.target.value, 1))} />
        </label>
        <button type="button" className={small} disabled={loop.outBar - loop.inBar <= 0} onClick={() => pickSpan({ from: loop.inBar, to: loop.outBar })} title="The loop's In to Out">Use the loop</button>
        <button type="button" className={small} disabled={!hasSelection} onClick={() => pickSpan(selectedSpan())} title="From the first selected clip's start to the last one's end">Use the selected clips</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className={field}>
          How much of the block: the last {Math.round(o.share * 100)}%
          <input type="range" min={0.1} max={1} step={0.05} value={o.share} onChange={(e) => set({ share: Number(e.target.value) })} className="accent-cyan-500" aria-label="How much of the block speeds up" />
        </label>
        <label className={field}>
          How much faster: +{Math.round(o.amount * 100)}%{o.amount >= 0.995 ? ' (double time)' : ''}
          <input type="range" min={0.05} max={1} step={0.05} value={o.amount} onChange={(e) => set({ amount: Number(e.target.value) })} className="accent-cyan-500" aria-label="How much faster" />
        </label>
        <label className={field}>
          Curve
          <select className={control} value={o.curve} onChange={(e) => set({ curve: e.target.value as SpeedCurve })}>
            {SPEED_CURVES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={field}>
          At the drop
          <select className={control} value={o.snapBack ? 'snap' : 'stay'} onChange={(e) => set({ snapBack: e.target.value === 'snap' })}>
            <option value="snap">snap back to the old tempo</option>
            <option value="stay">stay at the new speed</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-forge-text">
        <input type="checkbox" className="accent-cyan-500" checked={o.roll} onChange={(e) => set({ roll: e.target.checked })} />
        Roll the drums up: the snare (or clap) there becomes a roll, 8ths to 16ths to 32nds
      </label>
      <p className={`text-[11px] ${typeof plan === 'string' ? 'text-amber-300' : 'text-forge-muted'}`}>{preview}</p>
      <div className="flex justify-end">
        <button type="button" className={primary} disabled={typeof plan === 'string'} onClick={() => showToast(speedUpIntoDrop(opts, { roll: o.roll }))}>
          Speed up
        </button>
      </div>
    </section>
  );
};
