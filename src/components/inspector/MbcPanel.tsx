import React, { useEffect, useRef } from 'react';
import { Layers } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { MbcBand, Track, TrackFx } from '../../store/timelineTypes';
import { defaultTrackFx } from '../../store/timelineTypes';
import { liveMbcReduction } from '../../audio/liveTracks';
import { FxSlider, InsertPanel } from './InsertFx';

/**
 * The multiband compressor: where the low, mid and high bands split, how hard each is squeezed,
 * and each band's gain after; a meter per band shows how much it's turning down right now.
 */

const BAND_NAMES = ['Low', 'Mid', 'High'] as const;
const BAND_COLORS = ['#f59e0b', '#22c55e', '#06b6d4'];
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

/** The gain reduction meters, read each frame without re-rendering the panel. */
const Reduction: React.FC<{ trackId: string }> = ({ trackId }) => {
  const bars = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const r = liveMbcReduction(trackId);
      bars.current.forEach((el, i) => {
        if (el) el.style.height = `${Math.min(100, (-(r?.[i] ?? 0) / 24) * 100)}%`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [trackId]);
  return (
    <div className="flex gap-1 h-12 items-start" title="How much each band is being turned down (up to 24 dB)">
      {BAND_NAMES.map((_, i) => (
        <div key={i} className="relative w-2 h-full rounded-sm bg-black/60 overflow-hidden">
          <div
            ref={(el) => {
              bars.current[i] = el;
            }}
            className="absolute top-0 left-0 right-0"
            style={{ height: 0, background: BAND_COLORS[i] }}
          />
        </div>
      ))}
    </div>
  );
};

export const MbcControls: React.FC<{ track: Track; wide?: boolean }> = ({ track, wide = false }) => {
  const m = track.fx.mbc ?? defaultTrackFx().mbc;
  const d = defaultTrackFx().mbc;
  const set = (patch: Partial<TrackFx['mbc']>) => useTimelineStore.getState().setTrackFx(track.id, 'mbc', patch);
  const setBand = (i: number, patch: Partial<MbcBand>) => set({ bands: m.bands.map((b, k) => (k === i ? { ...b, ...patch } : b)) as TrackFx['mbc']['bands'] });
  const accent = '#a78bfa';
  const off = !m.on;
  return (
    <div className="flex flex-col gap-2">
      <div className={`grid gap-2 ${wide ? 'grid-cols-[repeat(3,minmax(0,1fr))_auto]' : 'grid-cols-1'}`}>
        {m.bands.map((b, i) => (
          <div key={i} className="flex flex-col gap-1 rounded border border-forge-border/70 p-1.5" style={{ borderLeft: `3px solid ${BAND_COLORS[i]}` }}>
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="font-bold" style={{ color: BAND_COLORS[i] }}>
                {BAND_NAMES[i].toUpperCase()}
                <span className="ml-1 font-normal text-forge-muted">{i === 0 ? `< ${hz(m.lowFreq)}` : i === 1 ? `${hz(m.lowFreq)}–${hz(m.highFreq)}` : `> ${hz(m.highFreq)}`}</span>
              </span>
              <label className="flex items-center gap-1 text-forge-muted" title="Let this band through uncompressed">
                <input type="checkbox" checked={!!b.bypass} onChange={(e) => {
                    useTimelineStore.getState().checkpoint();
                    setBand(i, { bypass: e.target.checked || undefined });
                  }} disabled={off} />
                bypass
              </label>
            </div>
            <FxSlider label="Threshold" value={b.threshold} min={-60} max={0} step={0.5} format={db} onChange={(threshold) => setBand(i, { threshold })} reset={d.bands[i].threshold} accent={BAND_COLORS[i]} disabled={off || !!b.bypass} />
            <FxSlider label="Ratio" value={b.ratio} min={1} max={20} step={0.1} format={(v) => `${v.toFixed(1)}:1`} onChange={(ratio) => setBand(i, { ratio })} reset={d.bands[i].ratio} accent={BAND_COLORS[i]} disabled={off || !!b.bypass} />
            <FxSlider label="Gain" value={b.gain} min={-12} max={18} step={0.5} format={db} onChange={(gain) => setBand(i, { gain })} reset={d.bands[i].gain} accent={BAND_COLORS[i]} disabled={off || !!b.bypass} />
          </div>
        ))}
        {wide && <Reduction trackId={track.id} />}
      </div>
      <FxSlider label="Low / mid" value={Math.log(m.lowFreq)} min={Math.log(40)} max={Math.log(1000)} step={0.01} format={(v) => hz(Math.exp(v))} onChange={(v) => set({ lowFreq: Math.round(Math.exp(v)) })} reset={Math.log(d.lowFreq)} accent={accent} disabled={off} />
      <FxSlider label="Mid / high" value={Math.log(m.highFreq)} min={Math.log(1000)} max={Math.log(12000)} step={0.01} format={(v) => hz(Math.exp(v))} onChange={(v) => set({ highFreq: Math.round(Math.exp(v)) })} reset={Math.log(d.highFreq)} accent={accent} disabled={off} />
      <FxSlider label="Attack" value={m.attack * 1000} min={1} max={200} step={1} format={(v) => `${Math.round(v)} ms`} onChange={(v) => set({ attack: v / 1000 })} reset={d.attack * 1000} accent={accent} disabled={off} />
      <FxSlider label="Release" value={m.release * 1000} min={20} max={1000} step={5} format={(v) => `${Math.round(v)} ms`} onChange={(v) => set({ release: v / 1000 })} reset={d.release * 1000} accent={accent} disabled={off} />
      {!wide && m.on && <Reduction trackId={track.id} />}
    </div>
  );
};

export const MbcPanel: React.FC<{ track: Track }> = ({ track }) => {
  const on = !!track.fx.mbc?.on;
  const accent = '#a78bfa';
  return (
    <InsertPanel title="Multiband" icon={<Layers className="w-3.5 h-3.5" style={{ color: accent }} />} on={on} onToggle={() => useTimelineStore.getState().setTrackFx(track.id, 'mbc', { on: !on })} accent={accent}>
      <MbcControls track={track} />
    </InsertPanel>
  );
};
