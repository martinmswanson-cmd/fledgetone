/**
 * The piano roll's GROOVE panel for drum clips: a groove template in one click (straight, light
 * or heavy swing on the hats, lazy, pushed), then each row's own swing, push or drag in time,
 * velocity and off-beat velocity, so the hats swing while the kick and snare stay straight. The
 * groove is the clip's (Clip.groove); the clip schedule plays it, live and in exports alike.
 */
import React, { useRef, useState } from 'react';
import { Popover } from '../Popover';
import { FxSlider } from '../inspector/InsertFx';
import { useTimelineStore } from '../../store/timelineStore';
import { GROOVE_TEMPLATES, grooveTemplate, MAX_ROW_SHIFT, ROW_VEL_RANGE, withRowFeel } from '../../store/drumGroove';
import { MAX_CLIP_SWING } from '../../store/timelineTypes';
import type { Clip, ClipGroove, RowFeel } from '../../store/timelineTypes';

const ACCENT = '#22d3ee';
const pct = (v: number) => `${Math.round(v * 100)}%`;

interface Props {
  clip: Clip;
  /** The drum rows to offer (top to bottom), each a note and its name */
  rows: ReadonlyArray<{ note: string; label: string }>;
}

export const DrumGroovePanel: React.FC<Props> = ({ clip, rows }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const used = new Set(clip.notes.map((n) => n.note));
  const shown = rows.filter((r) => used.has(r.note));
  // A clip on the song's swing starts from it (16ths), so rows changed first keep the rest as they were
  const base = (): ClipGroove => clip.groove ?? { swing: useTimelineStore.getState().swing, grid: 16 };
  const setFeel = (note: string, edit: Partial<RowFeel>) => {
    const g = base();
    useTimelineStore.getState().setClipGroove(clip.id, withRowFeel(g, note, { ...g.rows?.[note], ...edit }), false);
  };
  const template = clip.groove?.template;
  return (
    <div className="relative">
      <button
        ref={anchor}
        type="button"
        data-search="groove swing per drum hats swing template lazy pushed"
        onClick={() => setOpen((o) => !o)}
        className={`h-6 px-1.5 rounded border text-[10px] font-mono ${open ? 'border-cyan-500 text-white' : clip.groove?.rows ? 'border-cyan-700 text-cyan-300' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
        title="Swing per drum: groove templates, and each row's own swing, timing and velocity (swing the hats, keep the kick and snare straight)"
      >
        GROOVE…
      </button>
      {open && (
        <Popover label="Drum groove" onClose={() => setOpen(false)} anchorRef={anchor} className="left-0 w-[min(24rem,calc(100vw-2rem))]">
          <div className="flex flex-col gap-2 text-[10px] font-mono">
            <div className="grid grid-cols-2 gap-1" role="group" aria-label="Groove templates">
              {GROOVE_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  title={t.about}
                  onClick={() => useTimelineStore.getState().setClipGroove(clip.id, grooveTemplate(t.id)!)}
                  className={`h-6 rounded border ${template === t.id ? 'border-cyan-400 text-white bg-cyan-500/20' : 'border-forge-border text-forge-muted hover:text-forge-text'}`}
                >
                  {t.name}
                </button>
              ))}
            </div>
            {!shown.length && <p className="text-forge-muted">Add some hits: each row in use gets its own controls here.</p>}
            {shown.map((r) => {
              const feel = clip.groove?.rows?.[r.note];
              const swing = feel?.swing ?? clip.groove?.swing ?? useTimelineStore.getState().swing;
              return (
                <div key={r.note} className="flex flex-col gap-1 border-t border-forge-border pt-1.5">
                  <div className="flex items-center gap-2 text-forge-text font-bold">
                    {r.label}
                    {feel?.swing === undefined && <span className="font-normal text-forge-muted">(clip's swing)</span>}
                  </div>
                  <FxSlider label="Swing" value={swing} min={0} max={MAX_CLIP_SWING} step={0.01} format={pct} onChange={(v) => setFeel(r.note, { swing: v })} reset={0} accent={ACCENT} disabled={false} />
                  <FxSlider label="Timing" value={feel?.shift ?? 0} min={-MAX_ROW_SHIFT} max={MAX_ROW_SHIFT} step={0.01} format={(v) => (Math.abs(v) < 0.005 ? 'on grid' : `${v > 0 ? 'late' : 'early'} ${Math.round(Math.abs(v) * 100)}%`)} onChange={(v) => setFeel(r.note, { shift: v })} reset={0} accent={ACCENT} disabled={false} />
                  <FxSlider label="Velocity" value={feel?.vel ?? 1} min={ROW_VEL_RANGE[0]} max={ROW_VEL_RANGE[1]} step={0.01} format={pct} onChange={(v) => setFeel(r.note, { vel: v })} reset={1} accent={ACCENT} disabled={false} />
                  <FxSlider label="Off-beats" value={feel?.offbeat ?? 1} min={ROW_VEL_RANGE[0]} max={ROW_VEL_RANGE[1]} step={0.01} format={pct} onChange={(v) => setFeel(r.note, { offbeat: v })} reset={1} accent={ACCENT} disabled={false} />
                </div>
              );
            })}
            <p className="text-forge-muted">Timing is a share of a 16th note. Swing moves the off-beat 16ths; a 1/32 roll or a triplet run stays even.</p>
          </div>
        </Popover>
      )}
    </div>
  );
};
