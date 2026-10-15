/**
 * The group-bus panels of the Track Inspector: the bus presets (one click sets up a drum, 808 /
 * bass, vocal or music bus, see busPresets.ts), and the Saturation and Mono bass inserts they use
 * (busInserts.ts), which any track can switch on too.
 */
import React from 'react';
import { Flame, Layers, Merge } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track, TrackFx } from '../../store/timelineTypes';
import { DEFAULT_MONO_LOW, DEFAULT_SATURATE } from '../../store/timelineTypes';
import { BUS_PRESETS } from '../../store/busPresets';
import { isBus } from '../../store/buses';
import { FxSlider, InsertPanel } from './InsertFx';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Saturation: warm, full-range soft clipping (keeps the lows, unlike the Distortion). */
export const SaturationPanel: React.FC<{ track: Track }> = ({ track }) => {
  const s = track.fx.saturate ?? DEFAULT_SATURATE;
  const set = (patch: Partial<NonNullable<TrackFx['saturate']>>) => useTimelineStore.getState().setTrackFx(track.id, 'saturate', { ...s, ...patch });
  const accent = '#f59e0b';
  return (
    <InsertPanel title="Saturation" icon={<Flame className="w-3.5 h-3.5" style={{ color: accent }} />} on={s.on} onToggle={() => set({ on: !s.on })} accent={accent}>
      <p className="text-[10px] text-forge-muted">Rounds off the peaks like tape or a warm desk: thicker, glued, and the lows keep their weight.</p>
      <FxSlider label="Drive" value={s.amount} min={0} max={1} step={0.01} format={pct} onChange={(amount) => set({ amount })} reset={DEFAULT_SATURATE.amount} accent={accent} disabled={!s.on} />
      <FxSlider label="Mix" value={s.mix} min={0} max={1} step={0.01} format={pct} onChange={(mix) => set({ mix })} reset={DEFAULT_SATURATE.mix} accent={accent} disabled={!s.on} />
    </InsertPanel>
  );
};

/** Mono bass: everything under the crossover in the middle. */
export const MonoBassPanel: React.FC<{ track: Track }> = ({ track }) => {
  const m = track.fx.monoLow ?? DEFAULT_MONO_LOW;
  const set = (patch: Partial<NonNullable<TrackFx['monoLow']>>) => useTimelineStore.getState().setTrackFx(track.id, 'monoLow', { ...m, ...patch });
  const accent = '#38bdf8';
  return (
    <InsertPanel title="Mono bass" icon={<Merge className="w-3.5 h-3.5" style={{ color: accent }} />} on={m.on} onToggle={() => set({ on: !m.on })} accent={accent}>
      <p className="text-[10px] text-forge-muted">Puts everything under the crossover in the middle, so the low end stays solid on club systems and doesn't vanish on phones.</p>
      <FxSlider label="Crossover" value={m.freq} min={40} max={300} step={5} format={(v) => `${Math.round(v)} Hz`} onChange={(freq) => set({ freq })} reset={DEFAULT_MONO_LOW.freq} accent={accent} disabled={!m.on} />
    </InsertPanel>
  );
};

/** One-click bus setups, on a bus track. */
export const BusPresetPanel: React.FC<{ track: Track }> = ({ track }) => {
  if (!isBus(track)) return null;
  return (
    <div data-search="bus preset drum bus vocal bus" className="flex flex-col gap-1.5 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
      <div className="flex items-center gap-1.5">
        <Layers className="w-3.5 h-3.5 text-violet-300" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Bus preset</span>
      </div>
      <div className="grid grid-cols-2 gap-1">
        {BUS_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.about}
            onClick={() => useTimelineStore.getState().applyBusPreset(p.id, track.id)}
            className="py-1 rounded border border-forge-border bg-black/30 text-[11px] text-forge-text hover:border-violet-400/70 hover:text-white"
          >
            {p.name}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-forge-muted">Sets this bus's effects for the job (you can change them after). Track menu › Bus presets also groups the right tracks into a new bus.</p>
    </div>
  );
};

/** The bus panels in the inspector: the presets (buses only), then the two inserts, shown on buses and wherever they're on. */
export const BusFxPanels: React.FC<{ track: Track }> = ({ track }) => {
  const show = isBus(track) || track.fx.saturate?.on || track.fx.monoLow?.on;
  if (!show) return null;
  return (
    <>
      <SaturationPanel track={track} />
      <MonoBassPanel track={track} />
    </>
  );
};
