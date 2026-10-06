import React from 'react';
import { Flame, Gauge, Waves } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track, TrackFx } from '../../store/timelineTypes';
import { defaultTrackFx } from '../../store/timelineTypes';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  /** Value restored on double-click */
  reset: number;
  accent: string;
  disabled: boolean;
}

const FxSlider: React.FC<SliderProps> = ({ label, value, min, max, step, format, onChange, reset, accent, disabled }) => (
  <label className={`flex items-center gap-2 text-[10px] font-mono ${disabled ? 'opacity-45' : ''}`}>
    <span className="w-16 text-forge-muted uppercase">{label}</span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onDoubleClick={() => onChange(reset)}
      className="flex-1 min-w-0 cursor-pointer h-1.5"
      style={{ accentColor: accent }}
      aria-label={label}
    />
    <span className="w-14 text-right tabular-nums text-white font-semibold">{format(value)}</span>
  </label>
);

interface PanelProps {
  title: string;
  icon: React.ReactNode;
  on: boolean;
  onToggle: () => void;
  accent: string;
  children: React.ReactNode;
}

/** One insert effect: header with a bypass switch, then its controls (dimmed when bypassed). */
const InsertPanel: React.FC<PanelProps> = ({ title, icon, on, onToggle, accent, children }) => (
  <div
    className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border shadow-md transition-colors"
    style={{ borderColor: on ? `${accent}66` : undefined }}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">{title}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${title} ${on ? 'on' : 'off'}`}
        onClick={onToggle}
        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition ${
          on ? 'text-black' : 'text-forge-muted bg-forge-panel border-forge-border hover:text-white'
        }`}
        style={on ? { backgroundColor: accent, borderColor: accent } : undefined}
        title={on ? 'Bypass this effect' : 'Turn this effect on'}
      >
        {on ? 'ON' : 'OFF'}
      </button>
    </div>
    {children}
  </div>
);

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

/** Distortion (before the EQ in the chain). */
export const DistortionPanel: React.FC<{ track: Track }> = ({ track }) => {
  const fx = track.fx ?? defaultTrackFx();
  const d = defaultTrackFx().distortion;
  const set = (patch: Partial<TrackFx['distortion']>) => useTimelineStore.getState().setTrackFx(track.id, 'distortion', patch);
  const accent = '#f97316';
  return (
    <InsertPanel
      title="Distortion"
      icon={<Flame className="w-3.5 h-3.5" style={{ color: accent }} />}
      on={fx.distortion.on}
      onToggle={() => set({ on: !fx.distortion.on })}
      accent={accent}
    >
      <FxSlider label="Drive" value={fx.distortion.amount} min={0} max={1} step={0.01} format={pct} onChange={(amount) => set({ amount })} reset={d.amount} accent={accent} disabled={!fx.distortion.on} />
    </InsertPanel>
  );
};

/** Compressor and Chorus (after the EQ in the chain). */
export const DynamicsAndChorusPanels: React.FC<{ track: Track }> = ({ track }) => {
  const fx = track.fx ?? defaultTrackFx();
  const d = defaultTrackFx();
  const setComp = (patch: Partial<TrackFx['compressor']>) => useTimelineStore.getState().setTrackFx(track.id, 'compressor', patch);
  const setChorus = (patch: Partial<TrackFx['chorus']>) => useTimelineStore.getState().setTrackFx(track.id, 'chorus', patch);
  const compAccent = '#22c55e';
  const chorusAccent = '#a855f7';
  return (
    <>
      <InsertPanel
        title="Compressor"
        icon={<Gauge className="w-3.5 h-3.5" style={{ color: compAccent }} />}
        on={fx.compressor.on}
        onToggle={() => setComp({ on: !fx.compressor.on })}
        accent={compAccent}
      >
        <FxSlider label="Threshold" value={fx.compressor.threshold} min={-60} max={0} step={0.5} format={db} onChange={(threshold) => setComp({ threshold })} reset={d.compressor.threshold} accent={compAccent} disabled={!fx.compressor.on} />
        <FxSlider label="Ratio" value={fx.compressor.ratio} min={1} max={20} step={0.5} format={(v) => `${v.toFixed(1)}:1`} onChange={(ratio) => setComp({ ratio })} reset={d.compressor.ratio} accent={compAccent} disabled={!fx.compressor.on} />
        <FxSlider label="Makeup" value={fx.compressor.makeup} min={0} max={18} step={0.5} format={db} onChange={(makeup) => setComp({ makeup })} reset={d.compressor.makeup} accent={compAccent} disabled={!fx.compressor.on} />
      </InsertPanel>

      <InsertPanel
        title="Chorus"
        icon={<Waves className="w-3.5 h-3.5" style={{ color: chorusAccent }} />}
        on={fx.chorus.on}
        onToggle={() => setChorus({ on: !fx.chorus.on })}
        accent={chorusAccent}
      >
        <FxSlider label="Rate" value={fx.chorus.rate} min={0.1} max={8} step={0.1} format={(v) => `${v.toFixed(1)} Hz`} onChange={(rate) => setChorus({ rate })} reset={d.chorus.rate} accent={chorusAccent} disabled={!fx.chorus.on} />
        <FxSlider label="Depth" value={fx.chorus.depth} min={0} max={1} step={0.01} format={pct} onChange={(depth) => setChorus({ depth })} reset={d.chorus.depth} accent={chorusAccent} disabled={!fx.chorus.on} />
        <FxSlider label="Mix" value={fx.chorus.mix} min={0} max={1} step={0.01} format={pct} onChange={(mix) => setChorus({ mix })} reset={d.chorus.mix} accent={chorusAccent} disabled={!fx.chorus.on} />
      </InsertPanel>
    </>
  );
};
