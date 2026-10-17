/**
 * The Master tab of the Inspector: the loudness meter, the glue, the OTT and stereo width inserts,
 * the Level and the clipper before the limiter, the reference track and the mix check, the playback buffering choice and the browser's audio delay, and the instruments kept for offline use (with whether the browser keeps this storage).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Download, Gauge, MoveHorizontal, RotateCcw, Scissors, Snowflake, Timer, Volume2 } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { defaultMasterSettings, GLUE_STYLE_IDS, LEVEL_MAX, LEVEL_MIN, OTT_GAIN_MAX, OTT_GAIN_MIN, WIDTH_MAX } from '../../store/timelineTypes';
import type { GlueStyle } from '../../store/timelineTypes';
import { GLUE_STYLES, onClipperReading } from '../../audio/effects/masterChain';
import { CLIPPER_CEILING_MIN, CLIPPER_DRIVE_MAX, defaultClipper } from '../../audio/effects/clipper';
import { ReferencePanel } from './ReferencePanel';
import { MixCheckPanel } from './MixCheckPanel';
import { formatDbtp, formatLufs, NORMALIZE_TARGET_LUFS } from '../../audio/loudness';

/** A reading, or a dash while there's nothing to measure. */
const show = (v: number, unit: (v: number) => string) => (Number.isFinite(v) ? unit(v) : `– ${unit(0).split(' ')[1]}`);
import { resetLoudness } from '../../audio/loudnessMeter';
import { useLoudness } from './useLoudness';
import { choosePlaybackMode, chosenPlaybackMode, PLAYBACK_MODE } from '../../audio/playbackMode';
import { outputLatencySeconds } from '../../audio/latency';
import type { PlaybackMode } from '../../audio/playbackMode';
import { AUTO_FREEZE_MIN_TRACKS, setAutoFreeze, useAutoFreeze } from '../../store/autoFreeze';
import { clearRecordings, downloadAll, keptRecordings, recordingCount, type DownloadProgress } from '../../audio/recordingStore';
import { FxSlider, InsertPanel } from './InsertFx';
import { StorageStatus } from './StorageStatus';

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

/** The master compressor's style: how hard and how fast it holds the whole mix together. */
export const GluePanel: React.FC = () => {
  const glue = useTimelineStore((s) => s.master.glue);
  return (
    <div className="rounded-md border border-forge-border bg-forge-panel/60 p-2 flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-[11px] font-semibold text-forge-text">
        <Gauge className="w-3.5 h-3.5 text-amber-300" />
        Glue
        <select
          value={glue}
          onChange={(e) => useTimelineStore.getState().setMasterGlue(e.target.value as GlueStyle)}
          className="ml-auto h-6 bg-forge-bg border border-forge-border rounded px-1 text-[11px] font-normal"
        >
          {GLUE_STYLE_IDS.map((id) => (
            <option key={id} value={id}>
              {GLUE_STYLES[id].name}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[10px] text-forge-muted">The master compressor. {GLUE_STYLES[glue].about}</p>
    </div>
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

/** The master Level: the whole mix up or down, after the OTT and width, just before the limiter. */
export const LevelPanel: React.FC = () => {
  const level = useTimelineStore((s) => s.master.level);
  const accent = '#34d399';
  return (
    <div data-search="master level" className="rounded-md border border-forge-border bg-forge-panel/60 p-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-forge-text">
        <Volume2 className="w-3.5 h-3.5" style={{ color: accent }} />
        Level
      </div>
      <FxSlider label="Level" value={level} min={LEVEL_MIN} max={LEVEL_MAX} step={0.5} format={db} onChange={(v) => useTimelineStore.getState().setMasterLevel(v)} reset={0} accent={accent} disabled={false} />
      <p className="text-[10px] text-forge-muted">Turns the whole mix up or down just before the limiter. Up makes the song louder, and the limiter holds the peaks down.</p>
    </div>
  );
};

/**
 * The master clipper: drive into a soft or hard clip just before the limiter, shaving the tallest
 * peaks so the song can be louder with less limiting. Its meter shows how much it's taking off.
 */
export const ClipperPanel: React.FC = () => {
  const clipper = useTimelineStore((s) => s.master.clipper) ?? defaultClipper();
  const d = defaultClipper();
  const set = useTimelineStore.getState().setMasterClipper;
  const accent = '#fb923c';
  const [heard, setReading] = useState<{ peakDb: number; share: number } | null>(null);
  useEffect(() => {
    if (!clipper.on) return;
    // The meter falls back slowly, so a peak can be read
    let held = { peakDb: 0, share: 0 };
    const stop = onClipperReading((r) => {
      held = { peakDb: Math.max(r.peakDb, held.peakDb - 0.4), share: held.share * 0.8 + r.share * 0.2 };
      setReading(held);
    });
    return () => {
      stop();
      setReading(null);
    };
  }, [clipper.on]);
  const reading = clipper.on ? heard : null;
  const dbAmount = reading?.peakDb ?? 0;
  return (
    <InsertPanel title="Clipper" icon={<Scissors className="w-3.5 h-3.5" style={{ color: accent }} />} on={clipper.on} onToggle={() => set({ on: !clipper.on })} accent={accent}>
      <p className="text-[10px] text-forge-muted">
        Shaves the tallest peaks (mostly drum hits) flat before the limiter, so the song gets louder with less squashing. Loud rap and electronic masters do this. Drive pushes more into it.
      </p>
      <FxSlider label="Drive" value={clipper.drive} min={0} max={CLIPPER_DRIVE_MAX} step={0.5} format={db} onChange={(v) => set({ drive: v })} reset={d.drive} accent={accent} disabled={!clipper.on} />
      <FxSlider
        label="Character"
        value={clipper.softness}
        min={0}
        max={1}
        step={0.01}
        format={(v) => (v < 0.15 ? 'Hard' : v > 0.85 ? 'Soft' : `${Math.round(v * 100)}% soft`)}
        onChange={(v) => set({ softness: v })}
        reset={d.softness}
        accent={accent}
        disabled={!clipper.on}
      />
      <FxSlider label="Ceiling" value={clipper.ceiling} min={CLIPPER_CEILING_MIN} max={0} step={0.1} format={(v) => `${v.toFixed(1)} dBFS`} onChange={(v) => set({ ceiling: v })} reset={d.ceiling} accent={accent} disabled={!clipper.on} />
      {clipper.on && (
        <div className="flex flex-col gap-1" data-testid="clipper-meter">
          <div className="h-1.5 rounded bg-black/40 overflow-hidden" title="How many dB the clipper is taking off the peaks">
            <div className="h-full transition-[width] duration-75" style={{ width: `${Math.min(100, (dbAmount / 8) * 100)}%`, background: dbAmount > 4 ? '#f87171' : accent }} />
          </div>
          <p className={`text-[10px] font-mono ${dbAmount > 4 ? 'text-red-300' : 'text-forge-muted'}`}>
            {reading && dbAmount > 0.05
              ? `Clipping up to ${dbAmount.toFixed(1)} dB, ${(reading.share * 100).toFixed(reading.share < 0.01 ? 1 : 0)}% of the time${dbAmount > 4 ? ': that much can sound crunchy' : ''}`
              : 'Not clipping. Play the song and raise the Drive.'}
          </p>
        </div>
      )}
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
      <AudioDelay />
      <AutoFreezeSetting />
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

/** The browser's own delay from sound made to sound heard (its buffer and the audio device), in ms; null where it doesn't say. */
function audioDelayMs(): number | null {
  const seconds = outputLatencySeconds();
  return seconds > 0 ? Math.round(seconds * 1000) : null;
}

/**
 * How long a key played live takes to be heard, as the browser measures it (it can change, as when
 * headphones are plugged in, so it's read again every second). Live keys play at once on the audio
 * clock, so this is all the delay there is.
 */
const AudioDelay: React.FC = () => {
  const [ms, setMs] = useState(audioDelayMs);
  useEffect(() => {
    const id = window.setInterval(() => setMs(audioDelayMs()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <p className="text-[10px] text-sky-200" data-testid="audio-delay">
      {ms === null ? "This browser doesn't say how long its sound takes to reach you." : `Delay from a key to sound: about ${ms} ms`}
    </p>
  );
};

/** Auto-freeze on or off (see autoFreeze.ts), with what it's doing now. */
const AutoFreezeSetting: React.FC = () => {
  const on = useAutoFreeze((s) => s.on);
  const count = useAutoFreeze((s) => Object.keys(s.frozen).length);
  const rendering = useAutoFreeze((s) => s.rendering !== null);
  const bytes = useAutoFreeze((s) => Object.values(s.frozen).reduce((n, e) => n + e.bytes, 0));
  return (
    <div className="flex flex-col gap-1 pt-1 border-t border-forge-border/60">
      <label
        className="flex items-center gap-2 text-[11px] text-white cursor-pointer"
        title="In a song with many tracks, the tracks you aren't working on are frozen by themselves while the song is stopped, so it plays without stutters. Change a track and it plays live again at once."
      >
        <input type="checkbox" checked={on} onChange={(e) => setAutoFreeze(e.target.checked)} className="accent-cyan-400" />
        <Snowflake className="w-3 h-3 text-cyan-300" />
        Auto-freeze big songs
      </label>
      <p className="text-[10px] text-forge-muted">
        {!on
          ? 'Off: every track plays live unless you freeze it.'
          : count || rendering
            ? `${count} track${count === 1 ? '' : 's'} frozen for you (${mb(bytes)} of memory)${rendering ? ', freezing another…' : ''}. Change one and it plays live again.`
            : `On: once a song has ${AUTO_FREEZE_MIN_TRACKS} or more instrument tracks, the ones you leave alone are frozen while it's stopped.`}
      </p>
    </div>
  );
};

const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;

/**
 * The instruments' recordings kept in this browser (see recordingStore.ts): how much is kept, a
 * button to download every instrument's ahead of time for offline use, and one to free the space.
 */
export const OfflinePanel: React.FC = () => {
  const [kept, setKept] = useState<{ count: number; bytes: number } | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [running, setRunning] = useState<AbortController | null>(null);
  const total = useMemo(() => recordingCount(), []);
  const refresh = () => void keptRecordings().then(setKept);
  useEffect(refresh, []);

  const start = async () => {
    const abort = new AbortController();
    setRunning(abort);
    const result = await downloadAll(setProgress, abort.signal);
    setRunning(null);
    setProgress(result);
    refresh();
  };
  const remove = async () => {
    if (!window.confirm('Remove the kept recordings? Instruments download them again when you next use them.')) return;
    await clearRecordings();
    setProgress(null);
    refresh();
  };
  const finished = progress && !running && progress.done === progress.total;

  return (
    <div data-search="offline download all instruments" className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-forge-border shadow-md">
      <div className="flex items-center gap-1.5">
        <Download className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Instruments offline</span>
      </div>
      <p className="text-[10px] text-forge-muted">
        Recordings are kept in this browser once an instrument has used them, so they load at once next time and work offline.{' '}
        {kept && (kept.count ? `${kept.count.toLocaleString()} of ${total.toLocaleString()} kept (${mb(kept.bytes)}).` : 'None kept yet.')}
      </p>
      {running && progress ? (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 rounded bg-black/40 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <div className="h-full bg-sky-400" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-forge-muted font-mono">
            <span>
              {progress.done.toLocaleString()} / {progress.total.toLocaleString()} · {mb(progress.bytes)} downloaded
            </span>
            <button type="button" onClick={() => running.abort()} className="px-2 py-0.5 rounded border border-forge-border hover:text-white">
              Stop
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void start()}
            title="Download every instrument's recordings and the built-in plugins now (about 280 MB), so they all work offline"
            className="flex-1 py-1 rounded border border-sky-400/60 bg-sky-500/15 text-sky-100 text-[11px] font-mono font-bold hover:bg-sky-500/25"
          >
            Download all
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={!kept?.count}
            title="Free the space: recordings download again when an instrument next uses them"
            className="px-2 py-1 rounded border border-forge-border text-forge-muted text-[11px] font-mono hover:text-white disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      )}
      {finished && (
        <p className={`text-[10px] ${progress.failed ? 'text-amber-200' : 'text-emerald-300'}`}>
          {progress.failed
            ? `${progress.failed.toLocaleString()} couldn't be downloaded (check the connection), the rest are kept. Download all again to retry them.`
            : 'Every instrument is kept: they all work offline now.'}
        </p>
      )}
      <StorageStatus refreshKey={kept} />
    </div>
  );
};

/** The master section's own effects, above the reverb and delay returns, the playback buffer, and offline use. */
export const MasterPanels: React.FC = () => (
  <div className="flex flex-col gap-3">
    <LoudnessPanel />
    <GluePanel />
    <OttPanel />
    <WidthPanel />
    <LevelPanel />
    <ClipperPanel />
    <ReferencePanel />
    <MixCheckPanel />
    <PlaybackPanel />
    <OfflinePanel />
  </div>
);
