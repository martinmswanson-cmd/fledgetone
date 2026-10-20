/**
 * The piano roll's ROLL painter: turns the selected notes (a hat note, or a long note drawn over a
 * span) into a roll at 1/16, 1/16 triplet, 1/32, 1/32 triplet or 1/64, or a stutter of so many
 * hits, with its velocity rising, falling or swelling and its pitch rising or falling as it goes
 * (the drill hat roll). The notes themselves come from roll() in noteTools.ts; this is the panel.
 */
import React, { useRef, useState } from 'react';
import { Popover } from '../Popover';
import { roll, ROLL_RATES } from '../../store/noteTools';
import type { RollRateId, RollVelocity } from '../../store/noteTools';
import type { NoteEvent } from '../../store/timelineTypes';

const select = 'h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text focus:outline-none focus:border-cyan-500';

const VELOCITIES: ReadonlyArray<{ id: RollVelocity; label: string }> = [
  { id: 'up', label: 'Rising' },
  { id: 'down', label: 'Falling' },
  { id: 'swell', label: 'Swell (up and down)' },
  { id: 'flat', label: 'Even' },
];
const PITCHES = [0, 2, 3, 5, 7, 12, -5, -12];
const STUTTERS = [2, 3, 4, 5, 6, 8, 12, 16];

/** The last roll's settings, kept while the page is open */
let remembered: { rate: RollRateId | 'stutter'; count: number; velocity: RollVelocity; pitch: number } = { rate: '1/32', count: 4, velocity: 'up', pitch: 0 };

interface Props {
  /** Drum rows (pitch as each hit's bend) rather than notes (pitch as semitones) */
  drums: boolean;
  /** The instrument's range, for pitch moves on notes */
  range: [number, number];
  /** How many notes are selected (0: the whole clip) */
  selected: number;
  /** Replace the target notes with what `make` returns (one undo step) */
  onApply: (make: (target: NoteEvent[], newId: () => string) => NoteEvent[]) => void;
}

export const RollPainter: React.FC<Props> = ({ drums, range, selected, onApply }) => {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState(remembered);
  const anchor = useRef<HTMLButtonElement>(null);
  const update = (edit: Partial<typeof s>) => {
    const next = { ...s, ...edit };
    remembered = next;
    setS(next);
  };
  const apply = () => {
    const rate = ROLL_RATES.find((r) => r.id === s.rate)?.bars ?? 1 / 32;
    onApply((target, newId) =>
      roll(target, rate, newId, { velocity: s.velocity, from: 0.35, pitch: s.pitch, pitchBy: drums ? 'bend' : 'notes', lo: range[0], hi: range[1], ...(s.rate === 'stutter' ? { count: s.count } : {}) })
    );
    setOpen(false);
  };
  return (
    <div className="relative">
      <button
        ref={anchor}
        type="button"
        data-search="roll hat roll ratchet stutter triplet drill trap"
        onClick={() => setOpen((o) => !o)}
        className={`h-6 px-1.5 rounded border text-[10px] font-mono ${open ? 'border-cyan-500 text-white' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
        title="Hat roll painter: turn the selected notes (or a long note over a span) into a roll, with its velocity and pitch moving"
      >
        ROLL…
      </button>
      {open && (
        <Popover label="Roll painter" onClose={() => setOpen(false)} anchorRef={anchor} className="left-0">
          <div className="flex flex-col gap-2 text-[10px] font-mono text-forge-muted">
            <p className="text-forge-text">{selected ? `${selected} selected note${selected === 1 ? '' : 's'}` : 'Every note in the clip'}: each becomes a roll over its own length.</p>
            <label className="flex items-center justify-between gap-2">
              RATE
              <select className={select} value={s.rate} data-autofocus onChange={(e) => update({ rate: e.target.value as RollRateId | 'stutter' })}>
                {ROLL_RATES.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
                <option value="stutter">Stutter (so many hits)</option>
              </select>
            </label>
            {s.rate === 'stutter' && (
              <label className="flex items-center justify-between gap-2">
                HITS
                <select className={select} value={s.count} onChange={(e) => update({ count: Number(e.target.value) })}>
                  {STUTTERS.map((n) => (
                    <option key={n} value={n}>{n} per note</option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-center justify-between gap-2">
              VELOCITY
              <select className={select} value={s.velocity} onChange={(e) => update({ velocity: e.target.value as RollVelocity })}>
                {VELOCITIES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-between gap-2" title={drums ? 'Each hit plays higher or lower than the last (hats that climb)' : 'Each hit moves up or down by semitones'}>
              PITCH
              <select className={select} value={s.pitch} onChange={(e) => update({ pitch: Number(e.target.value) })}>
                {PITCHES.map((p) => (
                  <option key={p} value={p}>{p === 0 ? 'Even' : p > 0 ? `Rising +${p} st` : `Falling ${p} st`}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={apply} className="h-6 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-bold">
              MAKE THE ROLL
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
};
