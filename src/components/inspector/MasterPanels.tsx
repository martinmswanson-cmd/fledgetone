/**
 * The Master tab of the Inspector: the loudness meter, the OTT and stereo width inserts, and the
 * playback buffering choice.
 */
import React, { useState } from 'react';
import { Activity, Gauge, MoveHorizontal, RotateCcw, Timer } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { defaultMasterSettings, OTT_GAIN_MAX, OTT_GAIN_MIN, WIDTH_MAX } from '../../store/timelineTypes';
import { formatDbtp, formatLufs, NORMALIZE_TARGET_LUFS } from '../../audio/loudness';

/** A reading, or a dash while there's nothing to measure. */
const show = (v: number, unit: (v: number) => string) => (Number.isFinite(v) ? unit(v) : `– ${unit(0).split(' ')[1]}`);
import { resetLoudness } from '../../audio/loudnessMeter';
import { useLoudness } from './useLoudness';
import { choosePlaybackMode, chosenPlaybackMode, PLAYBACK_MODE } from '../../audio/playbackMode';
import type { PlaybackMode } from '../../audio/playbackMode';
import { FxSlider, InsertPanel } from './InsertFx';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const db = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;

/** Where a short-term loudness sits: quiet, about streaming level, or club loud. */
function loudnessHint(lufs: number): string {
  if (!Number.isFinite(lufs)) return 'Play the song to measure it.';
  if (lufs < NORMALIZE_TARGET_LUFS - 4) return 'Quiet. Streaming services would turn it up.';
  if (lufs <= NORMALIZE_TARGET_LUFS + 2) return 'About the level streaming services play at.';
  if (lufs <= -7) return 'Loud, like a club master.';
  return 'Very loud. Expect it to sound squashed.';
}

/**
 * The master section's loudness meter: loudness over the last 3 s, the whole play so far, and
 * the highest true peak. Measures what the speakers get, so it starts afresh on every Play.
 */
export const LoudnessPanel: React.FC = () => {
  const reading = useLoudness();
  const peakHot = reading !== null && reading.truePeakMax > -1;
  return (
    <div data-search="loudness" className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Loudness</span>
        </div>
        <button
          type="button"
          onClick={resetLoudness}
          title="Start measuring again"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border border-forge-border text-forge-muted hover:text-white"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center font-mono">
        {[
          { label: 'Now (3 s)', value: show(reading?.shortTerm ?? -Infinity, formatLufs) },
          { label: 'Since Play', value: show(reading?.integrated ?? -Infinity, formatLufs) },
          { label: 'Peak', value: show(reading?.truePeakMax ?? -Infinity, formatDbtp), hot: peakHot },
        ].map((m) => (
          <div key={m.label} className="bg-black/40 rounded border border-forge-border px-1 py-1.5">
            <div className="text-[9px] uppercase text-forge-muted">{m.label}</div>
            <div className={`text-[11px] font-bold tabular-nums ${m.hot ? 'text-red-400' : 'text-emerald-200'}`}>{m.value}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-forge-muted">
        {loudnessHint(reading?.shortTerm ?? -Infinity)}
        {peakHot && ' The peak is over -1 dBTP, which can distort after streaming services convert it.'}
      </p>
    </div>
  );
};

/** OTT: three-band upward and downward compression, the "make it loud and in your face" EDM master effect. */
export const OttPanel: React.FC = () => {
  const ott = useTimelineStore((s) => s.master.ott);
  const d = defaultMasterSettings().ott;
  const set = useTimelineStore.getState().setMasterOtt;
  const accent = '#e879f9';
  return (
    <InsertPanel title="OTT" icon={<Gauge className="w-3.5 h-3.5" style={{ color: accent }} />} on={ott.on} onToggle={() => set({ on: !ott.on })} accent={accent}>
      <p className="text-[10px] text-forge-muted">Squashes the lows, mids and highs separately and lifts their quiet detail: the loud, upfront sound of EDM. Start low; a little goes a long way.</p>
      <FxSlider label="Depth" value={ott.depth} min={0} max={1} step={0.01} format={pct} onChange={(v) => set({ depth: v })} reset={d.depth} accent={accent} disabled={!ott.on} />
      <FxSlider label="Time" value={ott.time} min={0} max={1} step={0.01} format={(v) => (v < 0.34 ? 'Snappy' : v < 0.67 ? 'Medium' : 'Slow')} onChange={(v) => set({ time: v })} reset={d.time} accent={accent} disabled={!ott.on} />
      <FxSlider label="In gain" value={ott.inGain} min={OTT_GAIN_MIN} max={OTT_GAIN_MAX} step={0.5} format={db} onChange={(v) => set({ inGain: v })} reset={d.inGain} accent={accent} disabled={!ott.on} />
      <FxSlider label="Out gain" value={ott.outGain} min={OTT_GAIN_MIN} max={OTT_GAIN_MAX} step={0.5} format={db} onChange={(v) => set({ outGain: v })} reset={d.outGain} accent={accent} disabled={!ott.on} />
    </InsertPanel>
  );
};

/** Stereo width by mid/side, with the bass kept in the middle. */
export const WidthPanel: React.FC = () => {
  const width = useTimelineStore((s) => s.master.width);
  const d = defaultMasterSettings().width;
  const set = useTimelineStore.getState().setMasterWidth;
  const accent = '#38bdf8';
  return (
    <InsertPanel title="Stereo Width" icon={<MoveHorizontal className="w-3.5 h-3.5" style={{ color: accent }} />} on={width.on} onToggle={() => set({ on: !width.on })} accent={accent}>
      <FxSlider
        label="Width"
        value={width.amount}
        min={0}
        max={WIDTH_MAX}
        step={0.01}
        format={(v) => (v === 0 ? 'Mono' : pct(v))}
        onChange={(v) => set({ amount: v })}
        reset={d.amount}
        accent={accent}
        disabled={!width.on}
      />
      <label className={`flex items-center gap-2 text-[10px] font-mono text-forge-muted ${width.on ? '' : 'opacity-45'}`}>
        <input
          type="checkbox"
          checked={width.monoBass}
          onChange={(e) => {
            useTimelineStore.getState().checkpoint();
            set({ monoBass: e.target.checked });
          }}
          className="accent-sky-400"
        />
        <span>Keep the bass in the middle (below 120 Hz), so it stays strong on club systems and phones</span>
      </label>
    </InsertPanel>
  );
};

const MODES: Array<{ mode: PlaybackMode; label: string; detail: string }> = [
  { mode: 'responsive', label: 'Responsive', detail: 'The least delay between a key you play and its sound.' },
  { mode: 'stable', label: 'Stable', detail: 'A bigger audio buffer and more time to schedule notes: busy moments in big songs play through instead of crackling. Play starts about a quarter of a second later, and live playing has a few hundredths of a second more delay.' },
];

/** How this browser buffers playback (not saved with the project). Applies after a reload. */
export const PlaybackPanel: React.FC = () => {
  const [chosen, setChosen] = useState(chosenPlaybackMode);
  return (
    <div data-search="playback" className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
      <div className="flex items-center gap-1.5">
        <Timer className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Playback</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Playback buffer">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            aria-pressed={chosen === m.mode}
            title={m.detail}
            onClick={() => {
              choosePlaybackMode(m.mode);
              setChosen(m.mode);
            }}
            className={`py-1 rounded border text-[11px] font-mono font-bold transition ${
              chosen === m.mode ? 'bg-sky-500/25 border-sky-400 text-sky-100' : 'bg-black/40 text-forge-muted border-forge-border hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-forge-muted">{MODES.find((m) => m.mode === chosen)!.detail}</p>
      {chosen !== PLAYBACK_MODE && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-amber-200">
          <span>Takes effect after a reload. Your work is kept: click Restore after it.</span>
          <button type="button" onClick={() => window.location.reload()} className="shrink-0 px-2 py-0.5 rounded border border-amber-400/60 font-mono hover:bg-amber-500/15">
            Reload
          </button>
        </div>
      )}
    </div>
  );
};

/** The master section's own effects, above the reverb and delay returns, and the playback buffer. */
export const MasterPanels: React.FC = () => (
  <div className="flex flex-col gap-3">
    <LoudnessPanel />
    <OttPanel />
    <WidthPanel />
    <PlaybackPanel />
  </div>
);
