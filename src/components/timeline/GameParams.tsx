/**
 * The Game tab's parameters: named values the game sets (danger, health, depth...), each moving
 * several things in the music at once (see gameParams.ts). Heard with Audition, shipped in the
 * game kit.
 */
import React, { useState } from 'react';
import { Gauge, Plus, Trash2 } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { MAX_GAME_PARAMS, MAX_PARAM_TARGETS, OPEN_FILTER, PARAM_KINDS, PARAM_PRESETS, TARGET_SPECS, type ParamPreset, type ParamTarget, type ParamTargetKind } from '../../store/gameParams';
import { groupsInUse } from '../../store/intensity';

const control = 'h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text';
const pct = (x: number) => Math.round(x * 100);

/** A number typed in, kept when the field is left or Enter is pressed (one undo step, not one per key). */
const NumberField: React.FC<{ value: number; min: number; max: number; step?: number; label: string; title?: string; onCommit: (v: number) => void }> = ({ value, min, max, step = 1, label, title, onCommit }) => (
  <input
    key={value}
    type="number"
    min={min}
    max={max}
    step={step}
    defaultValue={value}
    onBlur={(e) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v) && v !== value) onCommit(Math.max(min, Math.min(max, v)));
      else e.target.value = String(value);
    }}
    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    className={`${control} w-14`}
    aria-label={label}
    title={title}
  />
);

/** One thing a parameter moves: what, over which part of the parameter, from what to what. */
const TargetRow: React.FC<{ paramId: string; paramName: string; index: number; target: ParamTarget; groups: string[] }> = ({ paramId, paramName, index, target: t, groups }) => {
  const set = (patch: Partial<ParamTarget>) => useTimelineStore.getState().setParamTarget(paramId, index, { ...t, ...patch });
  const filter = t.kind === 'filter';
  // A filter in Hz; the rest in percent
  const shown = (x: number) => (filter ? Math.round(x) : pct(x));
  const stored = (x: number) => (filter ? x : x / 100);
  const range = filter ? { min: 60, max: OPEN_FILTER, step: 10 } : { min: 0, max: 100, step: 1 };
  return (
    <div className="flex flex-col gap-1 rounded border border-forge-border/60 px-1.5 py-1 text-[10px] text-forge-muted">
      <div className="flex items-center gap-1">
        <select
          className={control}
          value={t.kind}
          aria-label={`${paramName}: what it moves`}
          title={TARGET_SPECS[t.kind].detail}
          onChange={(e) => {
            const kind = e.target.value as ParamTargetKind;
            if (kind === 'layer' && !groups.length) return;
            set({ kind, start: TARGET_SPECS[kind].start, end: TARGET_SPECS[kind].end, group: kind === 'layer' ? groups[0] : undefined });
          }}
        >
          {PARAM_KINDS.map((k) => (
            <option key={k} value={k} disabled={k === 'layer' && !groups.length}>
              {TARGET_SPECS[k].name}
            </option>
          ))}
        </select>
        {t.kind === 'layer' && (
          <select className={control} value={t.group ?? ''} onChange={(e) => set({ group: e.target.value })} aria-label={`${paramName}: which stem group`}>
            {[...new Set([...groups, ...(t.group ? [t.group] : [])])].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
        <span className="truncate">{TARGET_SPECS[t.kind].detail}</span>
        <button type="button" onClick={() => useTimelineStore.getState().setParamTarget(paramId, index, null)} className="ml-auto h-6 w-6 shrink-0 flex items-center justify-center rounded hover:text-red-300" aria-label={`Remove this from ${paramName}`} title="Remove this">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span>goes from</span>
        <NumberField value={shown(t.start)} {...range} label={`${paramName}: ${TARGET_SPECS[t.kind].name} at the start`} onCommit={(v) => set({ start: stored(v) })} />
        <span>to</span>
        <NumberField value={shown(t.end)} {...range} label={`${paramName}: ${TARGET_SPECS[t.kind].name} at the end`} onCommit={(v) => set({ end: stored(v) })} />
        <span>{filter ? 'Hz' : '%'} as</span>
        <span className="font-mono text-violet-200">{paramName}</span>
        <span>goes from</span>
        <NumberField value={pct(t.from)} min={0} max={100} label={`${paramName}: where this starts moving`} onCommit={(v) => set({ from: v / 100 })} />
        <span>to</span>
        <NumberField value={pct(t.to)} min={0} max={100} label={`${paramName}: where this stops moving`} onCommit={(v) => set({ to: v / 100 })} />
        <span>%</span>
      </div>
    </div>
  );
};

export const GameParamsPanel: React.FC = () => {
  const params = useTimelineStore((s) => s.gameParams);
  const tracks = useTimelineStore((s) => s.tracks);
  const [preset, setPreset] = useState<ParamPreset>('danger');
  const groups = groupsInUse(tracks);
  const st = useTimelineStore.getState;
  return (
    <div className="flex flex-col gap-1.5" data-game="parameters">
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-forge-muted uppercase">
        <Gauge className="w-3.5 h-3.5 text-violet-400" /> Parameters
      </div>
      <p className="text-[10px] text-forge-muted">
        Numbers the game sets, 0 to 1, each moving several things at once: danger raising the intensity, health muffling the music as it runs out. The game just calls setParameter("danger", 0.7).
      </p>
      <div className="flex items-center gap-1.5">
        <select className={`${control} flex-1 min-w-0`} value={preset} onChange={(e) => setPreset(e.target.value as ParamPreset)} aria-label="Parameter preset" title={PARAM_PRESETS.find((p) => p.id === preset)?.detail}>
          {PARAM_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === 'empty' ? 'your own' : p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={params.length >= MAX_GAME_PARAMS}
          onClick={() => st().addGameParam(preset)}
          className="h-6 px-2 rounded border border-violet-400/60 text-violet-100 hover:bg-violet-500/15 disabled:opacity-40"
          title={params.length >= MAX_GAME_PARAMS ? `Up to ${MAX_GAME_PARAMS} parameters` : PARAM_PRESETS.find((p) => p.id === preset)?.detail}
        >
          Add parameter
        </button>
      </div>
      {params.map((p) => (
        <details key={p.id} className="rounded border border-forge-border px-2 py-1" open={!p.targets.length}>
          <summary className="cursor-pointer flex items-center gap-1.5 text-forge-text">
            <span className="font-semibold truncate font-mono">{p.name}</span>
            <span className="text-[10px] text-forge-muted">
              moves {p.targets.length ? [...new Set(p.targets.map((t) => (t.kind === 'layer' ? t.group : TARGET_SPECS[t.kind].name.toLowerCase())))].join(', ') : 'nothing yet'}
            </span>
          </summary>
          <div className="flex flex-col gap-1.5 pt-1.5">
            <div className="flex items-center gap-1.5">
              <input
                key={p.name}
                className={`${control} w-28 font-mono`}
                defaultValue={p.name}
                onBlur={(e) => st().renameGameParam(p.id, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                aria-label="Parameter name"
                title="Its name in the game: what setParameter() takes"
              />
              <label className="flex flex-1 items-center gap-1 text-[10px] text-forge-muted" title="Where it is when the game starts">
                starts at
                <input type="range" min={0} max={1} step={0.01} value={p.value} onChange={(e) => st().setGameParamValue(p.id, Number(e.target.value))} className="flex-1 accent-violet-400" aria-label={`${p.name} starts at`} />
                <span className="w-8 text-right text-forge-text">{pct(p.value)}%</span>
              </label>
              <button type="button" onClick={() => st().deleteGameParam(p.id)} className="h-6 w-6 flex items-center justify-center rounded text-forge-muted hover:text-red-300" aria-label={`Delete ${p.name}`} title="Delete this parameter">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {p.targets.map((t, i) => (
              <TargetRow key={i} paramId={p.id} paramName={p.name} index={i} target={t} groups={groups} />
            ))}
            {p.targets.length < MAX_PARAM_TARGETS && (
              <label className="flex items-center gap-1 text-[10px] text-forge-muted">
                <Plus className="w-3 h-3" />
                <select
                  className={control}
                  value=""
                  onChange={(e) => e.target.value && st().addParamTarget(p.id, e.target.value as ParamTargetKind)}
                  aria-label={`Add something for ${p.name} to move`}
                >
                  <option value="">move something else…</option>
                  {PARAM_KINDS.map((k) => (
                    <option key={k} value={k} disabled={k === 'layer' && !groups.length} title={TARGET_SPECS[k].detail}>
                      {TARGET_SPECS[k].name}
                      {k === 'layer' && !groups.length ? ' (put tracks in stem groups first)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </details>
      ))}
      {params.length > 0 && <p className="text-[10px] text-forge-muted">Move them in Audition like the game. Where several move the same thing, the strongest wins: the highest intensity and reverb, the lowest filter; volumes multiply.</p>}
    </div>
  );
};
