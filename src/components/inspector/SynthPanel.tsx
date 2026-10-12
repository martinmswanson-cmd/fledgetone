import React from 'react';
import { AudioWaveform } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import type { Envelope, OscSettings, SynthPatch } from '../../store/synthPatch';
import { defaultSynthPatch, LFO_SYNC, OSC_WAVES, presetPatch, SYNTH_PRESETS, withPatch } from '../../store/synthPatch';
import { FxSlider } from './InsertFx';

/**
 * The Synth Designer's controls in the Track Inspector. Knob drags are one undo step each (the
 * sliders checkpoint); picks from a list are one step too. Changes play from the next note.
 */

/** A slider over a range that's best felt in ratios (Hz, seconds): 0..1 on a log scale. */
const toLog = (v: number, lo: number, hi: number) => Math.log(v / lo) / Math.log(hi / lo);
const fromLog = (x: number, lo: number, hi: number) => lo * (hi / lo) ** x;
const secs = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);
const hz = (v: number) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

const select = 'h-6 bg-forge-bg border border-forge-border rounded px-1 text-[10px] text-forge-text focus:outline-none focus:border-cyan-500';
const ACCENT = '#22d3ee';

export const SynthPanel: React.FC<{ track: Track }> = ({ track }) => {
  const patch = track.synth ?? defaultSynthPatch();
  const set = (edit: Parameters<typeof withPatch>[1], record = false) => useTimelineStore.getState().setTrackSynth(track.id, withPatch(patch, edit), record);

  const slider = (label: string, value: number, min: number, max: number, step: number, format: (v: number) => string, onChange: (v: number) => void, reset: number, disabled = false) => (
    <FxSlider label={label} value={value} min={min} max={max} step={step} format={format} onChange={onChange} reset={reset} accent={ACCENT} disabled={disabled} />
  );
  const logSlider = (label: string, value: number, lo: number, hi: number, format: (v: number) => string, onChange: (v: number) => void, reset: number, disabled = false) =>
    slider(label, toLog(value, lo, hi), 0, 1, 0.001, (x) => format(fromLog(x, lo, hi)), (x) => onChange(+fromLog(x, lo, hi).toPrecision(4)), toLog(reset, lo, hi), disabled);

  const oscBlock = (key: 'osc1' | 'osc2', title: string) => {
    const o: OscSettings = patch[key];
    const d = defaultSynthPatch()[key];
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <label className="flex items-center gap-1.5 cursor-pointer font-bold text-forge-text">
            <input type="checkbox" checked={o.on} onChange={(e) => set({ [key]: { on: e.target.checked } }, true)} className="accent-cyan-500" />
            {title}
          </label>
          <select className={select} value={o.wave} aria-label={`${title} wave`} onChange={(e) => set({ [key]: { wave: e.target.value as OscSettings['wave'] } }, true)}>
            {OSC_WAVES.map((w) => (
              <option key={w} value={w}>{w === 'sawtooth' ? 'Saw' : w[0].toUpperCase() + w.slice(1)}</option>
            ))}
          </select>
        </div>
        {slider('Octave', o.octave, -3, 3, 1, (v) => (v > 0 ? `+${v}` : `${v}`), (v) => set({ [key]: { octave: v } }), d.octave, !o.on)}
        {slider('Semi', o.semi, -12, 12, 1, (v) => (v > 0 ? `+${v}` : `${v}`), (v) => set({ [key]: { semi: v } }), d.semi, !o.on)}
        {slider('Fine', o.fine, -100, 100, 1, (v) => `${v > 0 ? '+' : ''}${Math.round(v)} ct`, (v) => set({ [key]: { fine: v } }), d.fine, !o.on)}
        {slider('Level', o.level, 0, 1, 0.01, pct, (v) => set({ [key]: { level: v } }), d.level, !o.on)}
      </div>
    );
  };

  const envBlock = (key: 'amp' | 'filterEnv', title: string) => {
    const e: Envelope = patch[key];
    const d = defaultSynthPatch()[key];
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] font-mono font-bold text-forge-text">{title}</div>
        {logSlider('Attack', e.attack, 0.001, 10, secs, (v) => set({ [key]: { attack: v } }), d.attack)}
        {logSlider('Decay', e.decay, 0.001, 10, secs, (v) => set({ [key]: { decay: v } }), d.decay)}
        {slider('Sustain', e.sustain, 0, 1, 0.01, pct, (v) => set({ [key]: { sustain: v } }), d.sustain)}
        {logSlider('Release', e.release, 0.005, 10, secs, (v) => set({ [key]: { release: v } }), d.release)}
      </div>
    );
  };

  const d = defaultSynthPatch();
  return (
    <section className="flex flex-col gap-3 bg-forge-bg p-3 rounded-lg border border-forge-border" aria-label="Synth Designer">
      <div className="flex items-center gap-2">
        <AudioWaveform className="w-4 h-4 text-cyan-400" />
        <span className="text-xs font-semibold text-forge-text">Synth Designer</span>
        <select
          className={`${select} ml-auto`}
          aria-label="Preset"
          value=""
          onChange={(e) => e.target.value && useTimelineStore.getState().setTrackSynth(track.id, presetPatch(e.target.value), true)}
        >
          <option value="">Load preset…</option>
          {SYNTH_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {oscBlock('osc1', 'Osc 1')}
        {oscBlock('osc2', 'Osc 2')}
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-mono font-bold text-forge-text">Sub, noise and unison</div>
          {slider('Sub', patch.sub, 0, 1, 0.01, pct, (v) => set({ sub: v }), d.sub)}
          {slider('Noise', patch.noise, 0, 1, 0.01, pct, (v) => set({ noise: v }), d.noise)}
          {slider('Unison', patch.unison.voices, 1, 7, 1, (v) => `${v} voice${v === 1 ? '' : 's'}`, (v) => set({ unison: { voices: v } }), d.unison.voices)}
          {slider('Spread', patch.unison.spread, 0, 100, 1, (v) => `${Math.round(v)} ct`, (v) => set({ unison: { spread: v } }), d.unison.spread, patch.unison.voices === 1)}
          {slider('Width', patch.unison.width, 0, 1, 0.01, pct, (v) => set({ unison: { width: v } }), d.unison.width, patch.unison.voices === 1)}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-[10px] font-mono font-bold text-forge-text">
            Filter
            <select className={select} aria-label="Filter type" value={patch.filter.type} onChange={(e) => set({ filter: { type: e.target.value as SynthPatch['filter']['type'] } }, true)}>
              <option value="lowpass">Low-pass</option>
              <option value="highpass">High-pass</option>
              <option value="bandpass">Band-pass</option>
            </select>
          </div>
          {logSlider('Cutoff', patch.filter.cutoff, 20, 20000, hz, (v) => set({ filter: { cutoff: v } }), d.filter.cutoff)}
          {slider('Reso', patch.filter.resonance, 0.1, 20, 0.1, (v) => v.toFixed(1), (v) => set({ filter: { resonance: v } }), d.filter.resonance)}
          {slider('Env amt', patch.filter.envAmount, -6, 6, 0.1, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} oct`, (v) => set({ filter: { envAmount: v } }), d.filter.envAmount)}
          {slider('Key trk', patch.filter.keyTrack, 0, 1, 0.01, pct, (v) => set({ filter: { keyTrack: v } }), d.filter.keyTrack)}
          {slider('Drive', patch.drive, 0, 1, 0.01, pct, (v) => set({ drive: v }), d.drive)}
        </div>
        {envBlock('filterEnv', 'Filter envelope')}
        {envBlock('amp', 'Amp envelope')}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono font-bold text-forge-text">
            LFO
            <select className={select} aria-label="LFO target" value={patch.lfo.target} onChange={(e) => set({ lfo: { target: e.target.value as SynthPatch['lfo']['target'] } }, true)}>
              <option value="off">Off</option>
              <option value="filter">Filter (wobble)</option>
              <option value="pitch">Pitch (vibrato)</option>
              <option value="amp">Volume (tremolo)</option>
            </select>
            <select className={select} aria-label="LFO shape" value={patch.lfo.shape} onChange={(e) => set({ lfo: { shape: e.target.value as SynthPatch['lfo']['shape'] } }, true)}>
              <option value="sine">Sine</option>
              <option value="triangle">Triangle</option>
              <option value="square">Square</option>
              <option value="sawtooth">Saw</option>
            </select>
            <select className={select} aria-label="LFO rate" value={patch.lfo.sync} onChange={(e) => set({ lfo: { sync: e.target.value as SynthPatch['lfo']['sync'] } }, true)}>
              {LFO_SYNC.map((r) => (
                <option key={r} value={r}>{r === 'free' ? 'Free (Hz)' : r}</option>
              ))}
            </select>
          </div>
          {logSlider('Rate', patch.lfo.rate, 0.05, 30, (v) => `${v.toFixed(2)} Hz`, (v) => set({ lfo: { rate: v } }), d.lfo.rate, patch.lfo.sync !== 'free' || patch.lfo.target === 'off')}
          {slider('Depth', patch.lfo.depth, 0, 1, 0.01, pct, (v) => set({ lfo: { depth: v } }), d.lfo.depth, patch.lfo.target === 'off')}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 cursor-pointer text-[10px] font-mono font-bold text-forge-text">
            <input type="checkbox" checked={patch.mono} onChange={(e) => set({ mono: e.target.checked }, true)} className="accent-cyan-500" />
            Mono (one note at a time, sliding)
          </label>
          {logSlider('Glide', Math.max(0.001, patch.glide), 0.001, 2, secs, (v) => set({ glide: v }), d.glide, !patch.mono)}
          {slider('Level', patch.level, -24, 6, 0.5, (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`, (v) => set({ level: v }), d.level)}
        </div>
      </div>
    </section>
  );
};
