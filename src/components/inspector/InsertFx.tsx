import React from 'react';
import { Disc3, Repeat, Sparkle, Filter, Flame, Gauge, Hand, HeartPulse, MessageSquareText, Scissors, Waves } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { EchoTime, FilterSlope, FilterType, GateRate, PumpTrigger, Track, TrackFx } from '../../store/timelineTypes';
import {
  defaultTrackFx,
  FILTER_CUTOFF_MAX,
  FILTER_CUTOFF_MIN,
  FILTER_RESONANCE_MAX,
  FILTER_RESONANCE_MIN,
  ECHO_FEEDBACK_MAX,
  ECHO_TIMES,
  ECHO_TONE_MAX,
  ECHO_TONE_MIN,
  GATE_RATES,
  REVERB_DECAY_MAX,
  REVERB_DECAY_MIN,
  REVERB_PREDELAY_MAX,
  LOFI_TONE_MAX,
  LOFI_TONE_MIN,
  PUMP_RELEASE_MAX,
  PUMP_RELEASE_MIN,
} from '../../store/timelineTypes';
import { UndoableRange } from '../UndoableRange';
import { AutoBadge, Automatable } from '../timeline/AutoBadge';
import { AUTOMATED_TIP } from '../timeline/automationHooks';
import { formatHz } from '../../audio/automation';
import { lofiBits } from '../../audio/effects/lightFx';
import { HUMAN_MAX_CENTS, HUMAN_MAX_DYNAMICS, HUMAN_MAX_LATE } from '../../audio/human';
import { INSTRUMENTS } from '../../audio/instrumentCatalog';
import { isReturn } from '../../store/buses';

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
    data-search={title}
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

/**
 * Human: each note played a little differently, as a player would (a little early or late, softer
 * or harder, a hair sharp or flat). It works on the notes before they reach the instrument, so it
 * sits ahead of the effects. Pitch only moves pitched instruments.
 */
export const HumanPanel: React.FC<{ track: Track }> = ({ track }) => {
  const fx = track.fx ?? defaultTrackFx();
  const d = defaultTrackFx().human;
  const set = (patch: Partial<TrackFx['human']>) => useTimelineStore.getState().setTrackFx(track.id, 'human', patch);
  const accent = '#facc15';
  const off = !fx.human.on;
  const pitched = ['synth', 'sampled', 'custom'].includes(INSTRUMENTS[track.instrumentKey].kind);
  const ms = (v: number) => `±${Math.round(v * HUMAN_MAX_LATE * 500)} ms`;
  const cents = (v: number) => `±${Math.round(v * HUMAN_MAX_CENTS)} ¢`;
  const level = (v: number) => `±${Math.round(v * HUMAN_MAX_DYNAMICS * 100)}%`;
  return (
    <InsertPanel title="Human" icon={<Hand className="w-3.5 h-3.5" style={{ color: accent }} />} on={fx.human.on} onToggle={() => set({ on: !fx.human.on })} accent={accent}>
      <p className={`text-[10px] text-forge-muted leading-snug ${off ? 'opacity-45' : ''}`}>No two notes played quite alike, the way a real player sounds.</p>
      <FxSlider label="Timing" value={fx.human.timing} min={0} max={1} step={0.01} format={ms} onChange={(timing) => set({ timing })} reset={d.timing} accent={accent} disabled={off} />
      <FxSlider label="Dynamics" value={fx.human.dynamics} min={0} max={1} step={0.01} format={level} onChange={(dynamics) => set({ dynamics })} reset={d.dynamics} accent={accent} disabled={off} />
      {pitched && <FxSlider label="Pitch" value={fx.human.pitch} min={0} max={1} step={0.01} format={cents} onChange={(pitch) => set({ pitch })} reset={d.pitch} accent={accent} disabled={off} />}
    </InsertPanel>
  );
};

/**
 * Dialogue / SFX proxy: this track stands in for the game's dialogue or sound effects, and every
 * other track dips under it wherever it sounds (see duck.ts), live and in exports.
 */
export const DuckProxyPanel: React.FC<{ track: Track }> = ({ track }) => {
  const accent = '#38bdf8';
  const on = !!track.duckProxy;
  const depth = track.duckProxy?.depth ?? 8;
  const st = useTimelineStore.getState;
  return (
    <InsertPanel title="Duck others under this" icon={<MessageSquareText className="w-3.5 h-3.5" style={{ color: accent }} />} on={on} onToggle={() => st().setTrackDuckProxy(track.id, on ? null : depth)} accent={accent}>
      <p className={`text-[10px] text-forge-muted leading-snug ${on ? '' : 'opacity-45'}`}>
        For a track standing in for the game's dialogue or sound effects: every other track dips a moment before it sounds and comes back after.
      </p>
      <FxSlider
        label="Dip"
        value={depth}
        min={2}
        max={24}
        step={1}
        format={(v) => `-${v} dB`}
        onChange={(v) => st().setTrackDuckProxy(track.id, v, false)}
        reset={8}
        accent={accent}
        disabled={!on}
      />
    </InsertPanel>
  );
};

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

const GATE_RATE_OPTIONS = GATE_RATES.map((r) => ({ value: r, label: r, title: r.endsWith('T') ? `${r.slice(0, -1)} triplets` : `${r} notes` })) as ReadonlyArray<{ value: GateRate; label: string; title: string }>;

/** Lo-fi (after the Chorus): crush, tone, tape wow. */
const LofiPanel: React.FC<{ track: Track }> = ({ track }) => {
  const fx = { ...defaultTrackFx(), ...track.fx };
  const d = defaultTrackFx();
  const set = (patch: Partial<TrackFx['lofi']>, record = false) => useTimelineStore.getState().setTrackFx(track.id, 'lofi', patch, record);
  const accent = '#a3a3a3';
  const toneLog = (v: number) => Math.log(v / LOFI_TONE_MIN) / Math.log(LOFI_TONE_MAX / LOFI_TONE_MIN);
  const toneHz = (x: number) => LOFI_TONE_MIN * (LOFI_TONE_MAX / LOFI_TONE_MIN) ** x;
  return (
    <InsertPanel title="Lo-fi" icon={<Disc3 className="w-3.5 h-3.5" style={{ color: accent }} />} on={fx.lofi.on} onToggle={() => set({ on: !fx.lofi.on })} accent={accent}>
      <FxSlider label="Crush" value={fx.lofi.crush} min={0} max={1} step={0.01} format={(v) => `${lofiBits(v)}-bit`} onChange={(crush) => set({ crush })} reset={d.lofi.crush} accent={accent} disabled={!fx.lofi.on} />
      <FxSlider label="Tone" value={toneLog(fx.lofi.tone)} min={0} max={1} step={0.001} format={(x) => formatHz(toneHz(x))} onChange={(x) => set({ tone: Math.round(toneHz(x)) })} reset={toneLog(d.lofi.tone)} accent={accent} disabled={!fx.lofi.on} />
      <FxSlider label="Wow" value={fx.lofi.wow} min={0} max={1} step={0.01} format={pct} onChange={(wow) => set({ wow })} reset={d.lofi.wow} accent={accent} disabled={!fx.lofi.on} />
      <FxSlider label="Mix" value={fx.lofi.mix} min={0} max={1} step={0.01} format={pct} onChange={(mix) => set({ mix })} reset={d.lofi.mix} accent={accent} disabled={!fx.lofi.on} />
    </InsertPanel>
  );
};

const toneLog = (v: number) => Math.log(v / ECHO_TONE_MIN) / Math.log(ECHO_TONE_MAX / ECHO_TONE_MIN);
const toneHz = (x: number) => ECHO_TONE_MIN * (ECHO_TONE_MAX / ECHO_TONE_MIN) ** x;
const ECHO_TIME_TITLES: Record<string, string> = { d: 'dotted', t: 'triplet' };
const echoTimeLabel = (t: EchoTime) => (/[dt]$/.test(t) ? `${t.slice(0, -1)} ${ECHO_TIME_TITLES[t.slice(-1)]}` : t);

/**
 * Switching an effect on: on a return track it starts fully wet (the dry sound already plays
 * from the tracks that send to it), elsewhere at its usual mix.
 */
const switchOn = (track: Track, mix: number, fallback: number) => (isReturn(track) && mix === fallback ? { on: true, mix: 1 } : { on: true });

/** Delay (after the Filter): echoes in time with the song. */
const EchoPanel: React.FC<{ track: Track }> = ({ track }) => {
  const fx = { ...defaultTrackFx(), ...track.fx };
  const d = defaultTrackFx();
  const e = fx.echo;
  const set = (patch: Partial<TrackFx['echo']>, record = false) => useTimelineStore.getState().setTrackFx(track.id, 'echo', patch, record);
  const accent = '#f59e0b';
  return (
    <InsertPanel title="Delay" icon={<Repeat className="w-3.5 h-3.5" style={{ color: accent }} />} on={e.on} onToggle={() => set(e.on ? { on: false } : switchOn(track, e.mix, d.echo.mix), true)} accent={accent}>
      <div className={`flex items-center gap-2 text-[10px] font-mono ${e.on ? '' : 'opacity-45'}`}>
        <span className="w-16 text-forge-muted uppercase">Time</span>
        <select value={e.time} onChange={(ev) => set({ time: ev.target.value as EchoTime }, true)} className="flex-1 h-6 bg-forge-bg border border-forge-border rounded px-1 text-forge-text" aria-label="Delay time">
          {ECHO_TIMES.map((t) => (
            <option key={t} value={t}>
              {echoTimeLabel(t)} note
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-forge-muted" title="Ping-pong: the echoes bounce between left and right">
          <input type="checkbox" checked={e.pingPong} onChange={(ev) => set({ pingPong: ev.target.checked }, true)} aria-label="Ping-pong" />
          ping-pong
        </label>
      </div>
      <FxSlider label="Feedback" value={e.feedback} min={0} max={ECHO_FEEDBACK_MAX} step={0.01} format={pct} onChange={(feedback) => set({ feedback })} reset={d.echo.feedback} accent={accent} disabled={!e.on} />
      <FxSlider label="Tone" value={toneLog(e.tone)} min={0} max={1} step={0.001} format={(x) => formatHz(toneHz(x))} onChange={(x) => set({ tone: Math.round(toneHz(x)) })} reset={toneLog(d.echo.tone)} accent={accent} disabled={!e.on} />
      <FxSlider label="Mix" value={e.mix} min={0} max={1} step={0.01} format={pct} onChange={(mix) => set({ mix })} reset={d.echo.mix} accent={accent} disabled={!e.on} />
    </InsertPanel>
  );
};

/** Reverb (after the Delay): a room of the track's own. */
const ReverbPanel: React.FC<{ track: Track }> = ({ track }) => {
  const fx = { ...defaultTrackFx(), ...track.fx };
  const d = defaultTrackFx();
  const r = fx.reverb;
  const set = (patch: Partial<TrackFx['reverb']>, record = false) => useTimelineStore.getState().setTrackFx(track.id, 'reverb', patch, record);
  const accent = '#22d3ee';
  // Decay on a log scale: as much travel for 0.3 to 2 s as for 2 to 12 s
  const decayPos = (v: number) => Math.log(v / REVERB_DECAY_MIN) / Math.log(REVERB_DECAY_MAX / REVERB_DECAY_MIN);
  const decayS = (x: number) => Math.round(REVERB_DECAY_MIN * (REVERB_DECAY_MAX / REVERB_DECAY_MIN) ** x * 20) / 20;
  return (
    <InsertPanel title="Reverb" icon={<Sparkle className="w-3.5 h-3.5" style={{ color: accent }} />} on={r.on} onToggle={() => set(r.on ? { on: false } : switchOn(track, r.mix, d.reverb.mix), true)} accent={accent}>
      <FxSlider label="Decay" value={decayPos(r.decay)} min={0} max={1} step={0.001} format={(x) => `${decayS(x).toFixed(2)} s`} onChange={(x) => set({ decay: decayS(x) })} reset={decayPos(d.reverb.decay)} accent={accent} disabled={!r.on} />
      <FxSlider label="Pre-delay" value={r.preDelay} min={0} max={REVERB_PREDELAY_MAX} step={1} format={(v) => `${Math.round(v)} ms`} onChange={(preDelay) => set({ preDelay })} reset={d.reverb.preDelay} accent={accent} disabled={!r.on} />
      <FxSlider label="Tone" value={toneLog(r.tone)} min={0} max={1} step={0.001} format={(x) => formatHz(toneHz(x))} onChange={(x) => set({ tone: Math.round(toneHz(x)) })} reset={toneLog(d.reverb.tone)} accent={accent} disabled={!r.on} />
      <FxSlider label="Mix" value={r.mix} min={0} max={1} step={0.01} format={pct} onChange={(mix) => set({ mix })} reset={d.reverb.mix} accent={accent} disabled={!r.on} />
    </InsertPanel>
  );
};

/** Gate (after the Filter): the volume chopped in time with the song. */
const GatePanel: React.FC<{ track: Track }> = ({ track }) => {
  const fx = { ...defaultTrackFx(), ...track.fx };
  const d = defaultTrackFx();
  const set = (patch: Partial<TrackFx['gate']>, record = false) => useTimelineStore.getState().setTrackFx(track.id, 'gate', patch, record);
  const accent = '#38bdf8';
  return (
    <InsertPanel title="Gate" icon={<Scissors className="w-3.5 h-3.5" style={{ color: accent }} />} on={fx.gate.on} onToggle={() => set({ on: !fx.gate.on })} accent={accent}>
      <FxChoice label="Rate" value={fx.gate.rate} options={GATE_RATE_OPTIONS} onChange={(rate) => set({ rate }, true)} accent={accent} disabled={!fx.gate.on} />
      <FxSlider label="Depth" value={fx.gate.depth} min={0} max={1} step={0.01} format={pct} onChange={(depth) => set({ depth })} reset={d.gate.depth} accent={accent} disabled={!fx.gate.on} />
      <FxSlider label="Length" value={fx.gate.length} min={0.1} max={0.95} step={0.01} format={pct} onChange={(length) => set({ length })} reset={d.gate.length} accent={accent} disabled={!fx.gate.on} />
    </InsertPanel>
  );
};

/** Lo-fi, Filter, Gate and Pump (last in the chain, after the Chorus). */
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
      <LofiPanel track={track} />
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

      <EchoPanel track={track} />
      <ReverbPanel track={track} />
      <GatePanel track={track} />

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
