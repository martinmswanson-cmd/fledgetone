import React from 'react';
import { Filter, Flame, Gauge, HeartPulse, Waves } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { FilterSlope, FilterType, PumpTrigger, Track, TrackFx } from '../../store/timelineTypes';
import {
  defaultTrackFx,
  FILTER_CUTOFF_MAX,
  FILTER_CUTOFF_MIN,
  FILTER_RESONANCE_MAX,
  FILTER_RESONANCE_MIN,
  PUMP_RELEASE_MAX,
  PUMP_RELEASE_MIN,
} from '../../store/timelineTypes';
import { UndoableRange } from '../UndoableRange';
import { AutoBadge, Automatable } from '../timeline/AutoBadge';
import { AUTOMATED_TIP } from '../timeline/automationHooks';
import { formatHz } from '../../audio/automation';

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
  /** Set while an automation lane drives this setting: an AUTO badge, and the slider follows the lane and can't be moved. */
  automated?: React.ReactNode;
}

export const FxSlider: React.FC<SliderProps> = ({ label, value, min, max, step, format, onChange, reset, accent, disabled, automated }) => (
  <label className={`flex items-center gap-2 text-[10px] font-mono ${disabled ? 'opacity-45' : ''}`} title={automated ? AUTOMATED_TIP : undefined}>
    <span className="w-16 text-forge-muted uppercase">{label}</span>
    <UndoableRange
      min={min}
      max={max}
      step={step}
      value={value}
      onValue={onChange}
      resetValue={reset}
      disabled={!!automated}
      className="flex-1 min-w-0 cursor-pointer disabled:cursor-default h-1.5"
      style={{ accentColor: automated ? '#f59e0b' : accent }}
      aria-label={label}
    />
    {automated}
    <span className={`w-14 text-right tabular-nums font-semibold ${automated ? 'text-amber-200' : 'text-white'}`}>{format(value)}</span>
  </label>
);

interface ChoiceProps<T extends string | number> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title: string }>;
  /** Called only for a different choice (each one is an undo step) */
  onChange: (v: T) => void;
  accent: string;
  disabled: boolean;
}

/** A row of buttons picking one of a few settings (a filter type, a trigger). */
function FxChoice<T extends string | number>({ label, value, options, onChange, accent, disabled }: ChoiceProps<T>) {
  return (
    <div className={`flex items-center gap-2 text-[10px] font-mono ${disabled ? 'opacity-45' : ''}`} role="group" aria-label={label}>
      <span className="w-16 shrink-0 text-forge-muted uppercase">{label}</span>
      <div className="flex-1 min-w-0 grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={active}
              title={o.title}
              onClick={() => !active && onChange(o.value)}
              className={`py-0.5 rounded border font-bold whitespace-nowrap tracking-tight transition ${
                active ? 'text-black' : 'bg-black/40 text-forge-muted border-forge-border hover:text-white'
              }`}
              style={active ? { backgroundColor: accent, borderColor: accent } : undefined}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface PanelProps {
  title: string;
  icon: React.ReactNode;
  on: boolean;
  onToggle: () => void;
  accent: string;
  children: React.ReactNode;
}

/** One insert effect: header with a bypass switch, then its controls (dimmed when bypassed). */
export const InsertPanel: React.FC<PanelProps> = ({ title, icon, on, onToggle, accent, children }) => (
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
        onClick={() => {
          // Switching an effect on or off is one undo step (its sliders record per gesture)
          useTimelineStore.getState().checkpoint();
          onToggle();
        }}
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

/** A logarithmic slider scale: positions 0 to 1000 map onto lo..hi (each step the same ratio). */
const logScale = (lo: number, hi: number) => ({
  toPos: (v: number) => (1000 * Math.log(v / lo)) / Math.log(hi / lo),
  fromPos: (pos: number) => lo * Math.pow(hi / lo, pos / 1000),
});
const cutoffScale = logScale(FILTER_CUTOFF_MIN, FILTER_CUTOFF_MAX);
const resonanceScale = logScale(FILTER_RESONANCE_MIN, FILTER_RESONANCE_MAX);


const FILTER_TYPE_OPTIONS: ReadonlyArray<{ value: FilterType; label: string; title: string }> = [
  { value: 'lowpass', label: 'Low-pass', title: 'Low-pass: keep what is below the cutoff' },
  { value: 'highpass', label: 'High-pass', title: 'High-pass: keep what is above the cutoff' },
  { value: 'bandpass', label: 'Band-pass', title: 'Band-pass: keep a band around the cutoff' },
];
const FILTER_SLOPE_OPTIONS: ReadonlyArray<{ value: FilterSlope; label: string; title: string }> = [
  { value: 12, label: '12 dB', title: 'Gentle: 12 dB per octave' },
  { value: 24, label: '24 dB', title: 'Steep: 24 dB per octave' },
];
const PUMP_TRIGGER_OPTIONS: ReadonlyArray<{ value: PumpTrigger; label: string; title: string }> = [
  { value: 'kick', label: 'Kick drum', title: 'Duck on every kick (C1) of a drum kit that is playing (not muted or silenced by solo)' },
  { value: 'beat', label: 'Every beat', title: 'Duck on every quarter note' },
  { value: 'eighth', label: 'Every 1/8', title: 'Duck on every 8th note' },
  { value: 'track', label: 'A track', title: "Duck on every note of a track you choose (a sidechain from any part: a bass, a lead, a vocal chop)" },
];

/** Filter and Pump (last in the chain, after the Chorus). */
export const FilterAndPumpPanels: React.FC<{ track: Track }> = ({ track }) => {
  const fx = { ...defaultTrackFx(), ...track.fx };
  const d = defaultTrackFx();
  const setFilter = (patch: Partial<TrackFx['filter']>, record = false) =>
    useTimelineStore.getState().setTrackFx(track.id, 'filter', patch, record);
  const otherTracks = useTimelineStore((s) => s.tracks).filter((t) => t.id !== track.id);
  const setPump = (patch: Partial<TrackFx['pump']>, record = false) => useTimelineStore.getState().setTrackFx(track.id, 'pump', patch, record);
  const filterAccent = '#ec4899';
  const pumpAccent = '#facc15';
  return (
    <>
      <InsertPanel
        title="Filter"
        icon={<Filter className="w-3.5 h-3.5" style={{ color: filterAccent }} />}
        on={fx.filter.on}
        onToggle={() => setFilter({ on: !fx.filter.on })}
        accent={filterAccent}
      >
        <FxChoice label="Type" value={fx.filter.type} options={FILTER_TYPE_OPTIONS} onChange={(type) => setFilter({ type }, true)} accent={filterAccent} disabled={!fx.filter.on} />
        <Automatable track={track} param="filterCutoff">
          {(auto) => (
            <FxSlider
              label="Cutoff"
              value={cutoffScale.toPos(auto ?? fx.filter.cutoff)}
              min={0}
              max={1000}
              step={1}
              format={(pos) => formatHz(cutoffScale.fromPos(pos))}
              onChange={(pos) => setFilter({ cutoff: Number(cutoffScale.fromPos(pos).toPrecision(4)) })}
              reset={cutoffScale.toPos(d.filter.cutoff)}
              accent={filterAccent}
              disabled={!fx.filter.on}
              automated={auto !== null && <AutoBadge trackId={track.id} param="filterCutoff" />}
            />
          )}
        </Automatable>
        <Automatable track={track} param="filterResonance">
          {(auto) => (
            <FxSlider
              label="Resonance"
              value={resonanceScale.toPos(auto ?? fx.filter.resonance)}
              min={0}
              max={1000}
              step={1}
              format={(pos) => `Q ${resonanceScale.fromPos(pos).toFixed(2)}`}
              onChange={(pos) => setFilter({ resonance: Number(resonanceScale.fromPos(pos).toPrecision(3)) })}
              reset={resonanceScale.toPos(d.filter.resonance)}
              accent={filterAccent}
              disabled={!fx.filter.on}
              automated={auto !== null && <AutoBadge trackId={track.id} param="filterResonance" />}
            />
          )}
        </Automatable>
        <FxChoice label="Slope" value={fx.filter.slope} options={FILTER_SLOPE_OPTIONS} onChange={(slope) => setFilter({ slope }, true)} accent={filterAccent} disabled={!fx.filter.on} />
      </InsertPanel>

      <InsertPanel
        title="Pump"
        icon={<HeartPulse className="w-3.5 h-3.5" style={{ color: pumpAccent }} />}
        on={fx.pump.on}
        onToggle={() => setPump({ on: !fx.pump.on })}
        accent={pumpAccent}
      >
        <FxChoice
          label="Trigger"
          value={fx.pump.trigger}
          options={PUMP_TRIGGER_OPTIONS}
          // Following a track: start with the first other track, unless one was picked before
          onChange={(trigger) => setPump(trigger === 'track' && !fx.pump.source ? { trigger, source: otherTracks[0]?.id } : { trigger }, true)}
          accent={pumpAccent}
          disabled={!fx.pump.on}
        />
        {fx.pump.trigger === 'track' && (
          <label className={`flex items-center gap-2 text-[10px] font-mono ${fx.pump.on ? '' : 'opacity-45'}`}>
            <span className="w-16 shrink-0 text-forge-muted uppercase">Follows</span>
            <select
              className="flex-1 min-w-0 h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text"
              value={fx.pump.source ?? ''}
              disabled={!fx.pump.on}
              onChange={(e) => setPump({ source: e.target.value }, true)}
              aria-label="Pump follows track"
            >
              {!otherTracks.some((t) => t.id === fx.pump.source) && <option value="">Choose a track…</option>}
              {otherTracks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
        )}
        <FxSlider label="Depth" value={fx.pump.depth} min={0} max={1} step={0.01} format={pct} onChange={(depth) => setPump({ depth })} reset={d.pump.depth} accent={pumpAccent} disabled={!fx.pump.on} />
        <FxSlider
          label="Release"
          value={fx.pump.release}
          min={PUMP_RELEASE_MIN}
          max={PUMP_RELEASE_MAX}
          step={10}
          format={(v) => `${Math.round(v)} ms`}
          onChange={(release) => setPump({ release })}
          reset={d.pump.release}
          accent={pumpAccent}
          disabled={!fx.pump.on}
        />
      </InsertPanel>
    </>
  );
};
