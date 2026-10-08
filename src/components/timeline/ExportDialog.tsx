import React, { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { safeFileName } from '../../store/project';
import {
  audibleTracks,
  BIT_DEPTHS,
  downloadBlob,
  encodeWav,
  exportCues,
  exportFrames,
  renderArrangement,
  renderStems,
  ringOutSeconds,
  SAMPLE_RATES,
  stemTracks,
} from '../../audio/exportWav';
import type { BitDepth, ExportEnding, RenderOptions, SampleRate } from '../../audio/exportWav';
import { createZip } from '../../audio/zip';
import { barToSeconds, formatSmpte } from '../../audio/transport';
import { formatBarCount, frameRateLabel } from '../../store/timelineTypes';
import type { Track } from '../../store/timelineTypes';
import { Modal } from './Modal';

type Range = 'song' | 'loop';
type What = 'mixdown' | 'stems';

interface ExportSettings {
  range: Range;
  what: What;
  ending: ExportEnding;
  sampleRate: SampleRate;
  bitDepth: BitDepth;
  /** Stems only: leave out the master compressor and limiter so the stems add up to the mix. */
  bypassMaster: boolean;
}

const DEFAULT_SETTINGS: ExportSettings = { range: 'song', what: 'mixdown', ending: 'ringOut', sampleRate: 44100, bitDepth: 16, bypassMaster: true };
const SETTINGS_KEY = 'bos-beat-box.export-settings';

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** The options of the last export in this browser (a per-browser convenience, not part of the project). */
function loadSettings(): ExportSettings {
  const d = DEFAULT_SETTINGS;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return d;
    const r = raw as Record<string, unknown>;
    return {
      range: oneOf(r.range, ['song', 'loop'] as const, d.range),
      what: oneOf(r.what, ['mixdown', 'stems'] as const, d.what),
      ending: oneOf(r.ending, ['ringOut', 'exact', 'seamless'] as const, d.ending),
      sampleRate: oneOf(r.sampleRate, SAMPLE_RATES, d.sampleRate),
      bitDepth: oneOf(r.bitDepth, BIT_DEPTHS, d.bitDepth),
      bypassMaster: typeof r.bypassMaster === 'boolean' ? r.bypassMaster : d.bypassMaster,
    };
  } catch {
    return d;
  }
}

function saveSettings(settings: ExportSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked or full (private mode): the options just aren't remembered
  }
}

/** Duration label for a bar range at the current tempo, e.g. "0:16". */
function lengthLabel(bars: number, bpm: number): string {
  const seconds = Math.floor(barToSeconds(bars + 1, bpm) + 1e-6);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A file's duration to the millisecond, e.g. "0:08.000". */
function durationLabel(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

/** "<base> - <track>.wav" per stem, numbered " 2", " 3"... where names repeat (ignoring case, as most file systems do). */
function stemFileNames(base: string, tracks: Track[]): string[] {
  const used = new Set<string>();
  return tracks.map((track) => {
    // Cleaned apart, so a long project name can't cut the track name off
    const stem = `${base} - ${safeFileName(track.name)}`;
    let name = stem;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} ${n}`;
    used.add(name.toLowerCase());
    return `${name}.wav`;
  });
}

interface SegmentOption<T> {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

/** A row of mutually exclusive buttons (the selected one lit), sharing the width equally. */
function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: SegmentOption<T>[]; onChange: (value: T) => void }) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          disabled={o.disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          // Disabled options still take the pointer, so their tooltip can say why
          className={`min-h-8 px-1.5 py-1 rounded-md border text-xs leading-tight transition-colors disabled:opacity-35 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
            value === o.value
              ? 'bg-cyan-500/20 border-cyan-400/70 text-cyan-100'
              : 'bg-forge-bg border-forge-border text-forge-muted enabled:hover:text-forge-text enabled:hover:border-forge-borderLight'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-1.5">
    <h4 className="text-[9px] uppercase tracking-widest text-forge-muted font-mono">{title}</h4>
    {children}
  </section>
);

type Status =
  | { kind: 'idle'; note?: string; error?: string }
  | { kind: 'rendering'; fileName: string; progress: number; detail: string };

/**
 * Export dialog: what to render (the song or the loop region, the mix or one stem per track),
 * how the file ends, and its sample format. Renders offline, then downloads a WAV (or a .zip
 * of stem WAVs). Closing the dialog, or Cancel, stops a render.
 */
export const ExportDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const bpm = useTimelineStore((s) => s.bpm);
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const loop = useTimelineStore((s) => s.loopRegion);
  const projectName = useTimelineStore((s) => s.projectName);
  const reverbDecay = useTimelineStore((s) => s.masterReverbDecay);
  const delayTime = useTimelineStore((s) => s.masterDelayTime);
  const delayFeedback = useTimelineStore((s) => s.masterDelayFeedback);
  const markers = useTimelineStore((s) => s.markers);
  const [settings, setSettings] = useState(loadSettings);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  // A render still going when the dialog goes away is stopped
  useEffect(() => () => abortRef.current?.abort(), []);

  const update = (patch: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...patch }));

  const audibleIds = new Set(audibleTracks(tracks).map((t) => t.id));
  const songEnd = Math.max(1, ...clips.filter((c) => audibleIds.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
  const songBars = songEnd - 1;
  const loopBars = loop.outBar - loop.inBar;

  // The choices in effect: an empty song can't be exported, and only the loop region can be a seamless loop
  const range: Range = settings.range === 'song' && songBars > 0 ? 'song' : 'loop';
  const ending: ExportEnding = range === 'song' && settings.ending === 'seamless' ? 'ringOut' : settings.ending;
  const masterFx = { reverbDecay, delayTime, delayFeedback };
  const planned: RenderOptions = {
    tracks,
    clips,
    bpm,
    swing: 0,
    startBar: range === 'song' ? 1 : loop.inBar,
    endBar: range === 'song' ? songEnd : loop.outBar,
    masterFx,
    ending,
    sampleRate: settings.sampleRate,
    markers,
  };
  const { frames, passes } = exportFrames(planned);
  const cueCount = exportCues(planned).length;
  const stems = stemTracks(planned);
  const stemsOnly = settings.what === 'stems';
  const canExport = stemsOnly ? stems.length > 0 : range === 'loop' || songBars > 0;

  const suffix = range === 'song' ? '' : ending === 'seamless' ? ' (seamless loop)' : ' (loop)';
  const fileBase = `${safeFileName(projectName)}${suffix}`;
  const fileName = stemsOnly ? `${fileBase} stems.zip` : `${fileBase}.wav`;
  const tail = ringOutSeconds(masterFx);

  const startExport = async () => {
    const s = useTimelineStore.getState();
    // The render swaps the global audio context while it sets up, so halt live playback first
    s.pause();
    saveSettings(settings);
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: 'rendering', fileName, progress: 0, detail: '' });
    const opts: RenderOptions = {
      ...planned,
      tracks: s.tracks,
      clips: s.clips,
      swing: s.swing,
      markers: s.markers,
      bypassMaster: stemsOnly && settings.bypassMaster,
      signal: controller.signal,
    };
    try {
      if (stemsOnly) {
        const rendered = await renderStems(opts, settings.bitDepth, (progress, stem) =>
          setStatus({ kind: 'rendering', fileName, progress, detail: `Stem ${stem.index + 1} of ${stem.count}: ${stem.track.name}` })
        );
        const names = stemFileNames(fileBase, rendered.map((r) => r.track));
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Packing the .zip' });
        const zip = await createZip(rendered.map((r, i) => ({ name: names[i], data: r.wav })));
        controller.signal.throwIfAborted();
        downloadBlob(zip, fileName);
      } else {
        const audio = await renderArrangement(opts, (progress) => setStatus({ kind: 'rendering', fileName, progress, detail: '' }));
        controller.signal.throwIfAborted();
        downloadBlob(encodeWav(audio, settings.bitDepth, exportCues(opts)), fileName);
      }
      onClose();
    } catch (err) {
      if (controller.signal.aborted) setStatus({ kind: 'idle', note: 'Export cancelled.' });
      else setStatus({ kind: 'idle', error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  if (status.kind === 'rendering') {
    const percent = Math.round(status.progress * 100);
    // Closing the dialog stops the render (see the effect above); Cancel keeps it open to try again
    return (
      <Modal title="Export audio (WAV)" onClose={onClose}>
        <div className="flex items-center gap-2 text-forge-text">
          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-cyan-400" />
          <span className="min-w-0 break-words">Rendering {status.fileName}…</span>
        </div>
        <div
          className="h-1.5 rounded-full bg-forge-bg border border-forge-border overflow-hidden"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Export progress"
        >
          <div className="h-full bg-cyan-400 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate tabular-nums">
            {status.detail ? `${status.detail} · ` : ''}
            {percent}%
          </span>
          <button
            type="button"
            autoFocus
            onClick={() => abortRef.current?.abort()}
            className="h-8 px-3 shrink-0 rounded-md border border-forge-border bg-forge-bg text-xs font-mono text-forge-text hover:border-red-400/70 hover:text-red-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
          >
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  const rangeDetail =
    range === 'song'
      ? `Bar 1 to the end of the last clip: ${formatBarCount(songBars)} bars, ${lengthLabel(songBars, bpm)}.`
      : `Bars ${formatBarCount(loop.inBar)} to ${formatBarCount(loop.outBar)}: ${formatBarCount(loopBars)} bars, ${lengthLabel(loopBars, bpm)}. Starts at ${formatSmpte(loop.inBar, bpm, fps, dropFrame)} (${frameRateLabel(fps, dropFrame)}).`;
  const endingDetail =
    ending === 'ringOut'
      ? `Plays the range once, then ${formatBarCount(tail)} s more so release, reverb and echo tails ring out.`
      : ending === 'exact'
        ? `Exactly the range, ${frames.toLocaleString()} samples, with a 5 ms fade at the very end so it doesn't click.`
        : `Exactly one loop, ${frames.toLocaleString()} samples. Its start already holds what rings on from the pass before, so it repeats without a gap or click. (Renders ${passes} passes and keeps the last.)`;

  return (
    <Modal title="Export audio (WAV)" onClose={onClose}>
      <p>Renders the current mix (volume, pan, mute, solo, every effect and the master volume) faster than real time. Muted and un-soloed tracks are left out.</p>

      <Section title="Range">
        <Segmented<Range>
          label="Range"
          value={range}
          onChange={(value) => update({ range: value })}
          options={[
            { value: 'song', label: 'Whole song', disabled: songBars <= 0, title: songBars <= 0 ? 'No audible track has clips' : 'Bar 1 to the end of the last clip' },
            { value: 'loop', label: 'Loop region', title: 'Loop In to Out' },
          ]}
        />
        <p>{rangeDetail}</p>
      </Section>

      <Section title="Export">
        <Segmented<What>
          label="What to export"
          value={settings.what}
          onChange={(value) => update({ what: value })}
          options={[
            { value: 'mixdown', label: 'Mixdown', title: 'One stereo WAV of the whole mix' },
            { value: 'stems', label: 'Stems', title: 'One WAV per track, in a .zip' },
          ]}
        />
        {stemsOnly ? (
          <>
            <p>
              {stems.length
                ? `${stems.length} WAV file${stems.length === 1 ? '' : 's'} in one .zip, one per audible track with clips in the range (${stems.map((t) => t.name).join(', ')}). All start at the range start and have the same length.`
                : 'No audible track has clips in this range.'}
            </p>
            <label className="flex items-start gap-2 cursor-pointer text-forge-text">
              <input
                type="checkbox"
                checked={settings.bypassMaster}
                onChange={(e) => update({ bypassMaster: e.target.checked })}
                className="mt-0.5 accent-cyan-400"
              />
              <span>
                Bypass master compressor &amp; limiter
                <span className="block text-forge-muted">
                  {settings.bypassMaster
                    ? 'The stems add up to the mix as it is before the master compressor and limiter.'
                    : 'Each stem goes through its own master compressor and limiter, so together they won’t add up to the mix exactly.'}
                </span>
              </span>
            </label>
          </>
        ) : (
          <p>One stereo WAV of everything that plays.</p>
        )}
      </Section>

      <Section title="Ending">
        <Segmented<ExportEnding>
          label="Ending"
          value={ending}
          onChange={(value) => update({ ending: value })}
          options={[
            { value: 'ringOut', label: 'Ring out', title: 'Let tails ring out after the end' },
            { value: 'exact', label: 'Exact length', title: 'Exactly the range, no tail' },
            {
              value: 'seamless',
              label: 'Seamless loop',
              disabled: range !== 'loop',
              title: range === 'loop' ? 'One loop that repeats without a gap or click' : 'Choose Loop region to make a seamless loop',
            },
          ]}
        />
        <p>{endingDetail}</p>
      </Section>

      <Section title="Format">
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr] gap-1.5">
          <Segmented<SampleRate>
            label="Sample rate"
            value={settings.sampleRate}
            onChange={(value) => update({ sampleRate: value })}
            options={[
              { value: 44100, label: '44.1 kHz' },
              { value: 48000, label: '48 kHz' },
            ]}
          />
          <Segmented<BitDepth>
            label="Bit depth"
            value={settings.bitDepth}
            onChange={(value) => update({ bitDepth: value })}
            options={[
              { value: 16, label: '16-bit' },
              { value: 24, label: '24-bit' },
              { value: 32, label: '32-bit float' },
            ]}
          />
        </div>
        <p>
          Stereo. Peaks are kept just under full scale, so nothing clips.
          {cueCount > 0 &&
            ` ${cueCount === 1 ? 'The marker in the range goes' : `The ${cueCount} markers in the range go`} into ${
              stemsOnly ? 'every file' : 'the file'
            } as ${cueCount === 1 ? 'a cue point, which DAWs and game audio tools show as a marker' : 'cue points, which DAWs and game audio tools show as markers'}.`}
        </p>
      </Section>

      {status.error && <p className="text-red-400">Export failed: {status.error}</p>}
      {status.note && <p className="text-amber-300">{status.note}</p>}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-3 border-t border-forge-border">
        <span className="min-w-0 break-words text-forge-text">
          {fileName}
          <span className="text-forge-muted">
            {' · '}
            {durationLabel(frames / settings.sampleRate)}
          </span>
        </span>
        <button
          type="button"
          autoFocus
          disabled={!canExport}
          onClick={() => void startExport()}
          className="h-8 px-3 ml-auto flex items-center gap-1.5 rounded-md border border-emerald-500/60 bg-emerald-500/10 text-xs font-mono text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        >
          <Download className="w-3.5 h-3.5" />
          Export
        </button>
      </div>
    </Modal>
  );
};
