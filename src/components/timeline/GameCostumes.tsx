/**
 * The Game tab's second tier: costumes (the song played other ways: each track on another
 * instrument or silent, maybe faster; see costumes.ts) and how each state plays in the game (as
 * written, or its pieces shuffled, with silences between plays). Heard in Audition like the game,
 * shipped in the game kit.
 */
import React, { useMemo, useState } from 'react';
import { Shirt, Shuffle, Trash2 } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { COSTUME_PRESETS, GAP_PRESETS, MAX_COSTUMES, SHUFFLE_BARS, type CostumePreset } from '../../store/costumes';
import { INSTRUMENTS, type InstrumentKey } from '../../audio/instrumentCatalog';
import { isMixTrack } from '../../store/buses';
import { meterAt } from '../../audio/tempoMap';

const control = 'h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text';
const TEMPOS = [0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.25, 1.5];

/** Every instrument a track could change to, by category (drum kits only for drum parts, and back). */
function useInstrumentGroups() {
  return useMemo(() => {
    const groups = new Map<string, Array<{ key: InstrumentKey; name: string; drums: boolean }>>();
    for (const def of Object.values(INSTRUMENTS)) {
      if (['bus', 'return', 'audio', 'plugin', 'sampler', 'drumRack', 'multiSampler', 'slicer', 'fx'].includes(def.key) || def.category === 'Your Sounds') continue;
      const list = groups.get(def.category) ?? [];
      list.push({ key: def.key as InstrumentKey, name: def.name, drums: def.kind === 'drums' });
      groups.set(def.category, list);
    }
    return [...groups.entries()];
  }, []);
}

export const CostumesPanel: React.FC = () => {
  const costumes = useTimelineStore((s) => s.costumes);
  const tracks = useTimelineStore((s) => s.tracks);
  const [preset, setPreset] = useState<CostumePreset>('eightBit');
  const groups = useInstrumentGroups();
  const parts = tracks.filter((t) => !isMixTrack(t));
  const st = useTimelineStore.getState;
  return (
    <div className="flex flex-col gap-1.5" data-game="costumes">
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-forge-muted uppercase">
        <Shirt className="w-3.5 h-3.5 text-violet-400" /> Costumes
      </div>
      <p className="text-[10px] text-forge-muted">The same music played another way. The game can swap costumes mid-loop and the tune carries on: an 8-bit version, a music box, night, a hurry-up.</p>
      <div className="flex items-center gap-1.5">
        <select className={`${control} flex-1 min-w-0`} value={preset} onChange={(e) => setPreset(e.target.value as CostumePreset)} aria-label="Costume preset" title={COSTUME_PRESETS.find((p) => p.id === preset)?.detail}>
          {COSTUME_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={costumes.length >= MAX_COSTUMES || !parts.length}
          onClick={() => st().addCostume(preset)}
          className="h-6 px-2 rounded border border-violet-400/60 text-violet-100 hover:bg-violet-500/15 disabled:opacity-40"
          title={costumes.length >= MAX_COSTUMES ? `Up to ${MAX_COSTUMES} costumes` : COSTUME_PRESETS.find((p) => p.id === preset)?.detail}
        >
          Add costume
        </button>
      </div>
      {costumes.map((c) => (
        <details key={c.id} className="rounded border border-forge-border px-2 py-1">
          <summary className="cursor-pointer flex items-center gap-1.5 text-forge-text">
            <span className="font-semibold truncate">{c.name}</span>
            <span className="text-[10px] text-forge-muted">
              {Object.keys(c.tracks).length} change{Object.keys(c.tracks).length === 1 ? '' : 's'}
              {c.tempo !== 1 ? ` · ${c.tempo > 1 ? '+' : ''}${Math.round((c.tempo - 1) * 100)}% tempo` : ''}
            </span>
          </summary>
          <div className="flex flex-col gap-1.5 pt-1.5">
            <div className="flex items-center gap-1.5">
              <input
                key={c.name}
                className={`${control} flex-1 min-w-0`}
                defaultValue={c.name}
                onBlur={(e) => st().updateCostume(c.id, { name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                aria-label="Costume name"
                title="Its name in the game: what setCostume() takes"
              />
              <select className={control} value={c.tempo} onChange={(e) => st().updateCostume(c.id, { tempo: Number(e.target.value) })} aria-label="Costume tempo" title="Faster or slower than the song (the pitch stays)">
                {[...new Set([...TEMPOS, c.tempo])].sort((a, b) => a - b).map((t) => (
                  <option key={t} value={t}>{t === 1 ? 'same tempo' : `${t > 1 ? '+' : ''}${Math.round((t - 1) * 100)}% tempo`}</option>
                ))}
              </select>
              <button type="button" onClick={() => st().deleteCostume(c.id)} className="h-6 w-6 flex items-center justify-center rounded text-forge-muted hover:text-red-300" aria-label={`Delete ${c.name}`} title="Delete this costume">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-x-2 gap-y-1 items-center">
              {parts.map((t) => {
                const swap = c.tracks[t.id];
                const drums = INSTRUMENTS[t.instrumentKey]?.kind === 'drums';
                const value = swap?.mute ? 'mute' : swap?.instrument ?? '';
                return (
                  <React.Fragment key={t.id}>
                    <span className="truncate text-forge-text" title={t.name}>{t.name}</span>
                    <select
                      className={control}
                      value={value}
                      aria-label={`${t.name} in ${c.name}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        st().setCostumeTrack(c.id, t.id, v === '' ? null : v === 'mute' ? { mute: true } : { instrument: v as InstrumentKey });
                      }}
                    >
                      <option value="">as it is ({INSTRUMENTS[t.instrumentKey]?.name ?? t.instrumentKey})</option>
                      <option value="mute">silent</option>
                      {groups.map(([category, list]) => {
                        const fits = list.filter((x) => x.drums === drums);
                        return fits.length ? (
                          <optgroup key={category} label={category}>
                            {fits.map((x) => (
                              <option key={x.key} value={x.key}>{x.name}</option>
                            ))}
                          </optgroup>
                        ) : null;
                      })}
                    </select>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </details>
      ))}
      {costumes.length > 0 && <p className="text-[10px] text-forge-muted">Hear them with Audition like the game. The game kit renders every state in every costume.</p>}
    </div>
  );
};

/** How each state plays in the game: as written or shuffled, and silences between plays. */
export const StateOptionsPanel: React.FC<{ states: ReadonlyArray<{ id: string; name: string; from: number; to: number }> }> = ({ states }) => {
  const options = useTimelineStore((s) => s.stateOptions);
  const meter = useTimelineStore((s) => s.meter);
  const meterPoints = useTimelineStore((s) => s.meterPoints);
  const set = useTimelineStore.getState().setStateOptions;
  if (!states.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-game="state-options">
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-forge-muted uppercase">
        <Shuffle className="w-3.5 h-3.5 text-emerald-400" /> How each state plays
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-1.5 gap-y-1 items-center">
        {states.map((sec) => {
          const o = options[sec.id] ?? {};
          // In bars of the state's own time signature (the players cut pieces on those)
          const m = meterAt(sec.from, { base: meter, points: meterPoints });
          const bars = Math.round((sec.to - sec.from) / (m.num / m.den));
          const gapId = GAP_PRESETS.find((g) => g.gap && o.gap && g.gap.min === o.gap.min && g.gap.max === o.gap.max)?.id ?? (o.gap ? 'custom' : 'none');
          return (
            <React.Fragment key={sec.id}>
              <span className="truncate text-forge-text" title={sec.name}>{sec.name}</span>
              <select
                className={control}
                value={o.shuffleBars ?? 0}
                aria-label={`${sec.name}: order`}
                title="Play the state's pieces in a shuffled order (never the same piece twice running), so a long stay never sounds the same"
                onChange={(e) => set(sec.id, { ...o, shuffleBars: Number(e.target.value) || undefined })}
              >
                <option value={0}>as written</option>
                {SHUFFLE_BARS.filter((n) => n < bars).map((n) => (
                  <option key={n} value={n}>shuffle {n}-bar pieces</option>
                ))}
              </select>
              <select
                className={control}
                value={gapId}
                aria-label={`${sec.name}: silence between plays`}
                title="Silence between plays, a different length each time: music that comes and goes, so it still means something when it returns"
                onChange={(e) => {
                  const g = GAP_PRESETS.find((x) => x.id === e.target.value);
                  if (g) set(sec.id, { ...o, gap: g.gap ?? undefined });
                }}
              >
                {GAP_PRESETS.map((g) => (
                  <option key={g.id} value={g.id}>silence: {g.name}</option>
                ))}
                {gapId === 'custom' && o.gap && <option value="custom">silence: {o.gap.min} to {o.gap.max} s</option>}
              </select>
            </React.Fragment>
          );
        })}
      </div>
      <p className="text-[10px] text-forge-muted">The game kit's players do this; the timeline plays the state as written.</p>
    </div>
  );
};
