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
  renderIntroLoop,
  renderStems,
  ringOutSeconds,
  SAMPLE_RATES,
  channelsOf,
  scaleAudio,
  stemTracks,
} from '../../audio/exportWav';
import { formatDbtp, formatLufs, measureLoudness, normalizeGainDb, NORMALIZE_CEILING_DBTP, NORMALIZE_TARGET_LUFS } from '../../audio/loudness';
import { showToast } from './toastStore';
import type { BitDepth, ExportEnding, RenderOptions, SampleRate } from '../../audio/exportWav';
import { createZip } from '../../audio/zip';
import { AUDIO_FORMATS, encodeAudio, FORMAT_EXTENSION } from '../../audio/encoders';
import type { AudioFormat } from '../../audio/encoders';
import { barToSeconds, formatSmpte } from '../../audio/transport';
import { formatBarCount, frameRateLabel } from '../../store/timelineTypes';
import type { Track } from '../../store/timelineTypes';
import { Modal } from './Modal';

/** 'game': an intro (bar 1 to the loop's In) and the loop region as a seamless loop, for games. */
type Range = 'song' | 'loop' | 'game';
type What = 'mixdown' | 'stems';

interface ExportSettings {
  range: Range;
  what: What;
  ending: ExportEnding;
  sampleRate: SampleRate;
  bitDepth: BitDepth;
  /** Stems only: leave out the master compressor and limiter so the stems add up to the mix. */
  bypassMaster: boolean;
  /** Mixdown only: turn the file up or down to the loudness streaming services play at. */
  normalize: boolean;
  format: AudioFormat;
  /** Intro + loop as WAV: also one file holding both, with the loop marked in it (Godot, samplers). */
  loopFile: boolean;
}

const DEFAULT_SETTINGS: ExportSettings = { range: 'song', what: 'mixdown', ending: 'ringOut', sampleRate: 44100, bitDepth: 16, bypassMaster: true, normalize: false, format: 'wav', loopFile: true };
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
      range: oneOf(r.range, ['song', 'loop', 'game'] as const, d.range),
      what: oneOf(r.what, ['mixdown', 'stems'] as const, d.what),
      ending: oneOf(r.ending, ['ringOut', 'exact', 'seamless'] as const, d.ending),
      sampleRate: oneOf(r.sampleRate, SAMPLE_RATES, d.sampleRate),
      bitDepth: oneOf(r.bitDepth, BIT_DEPTHS, d.bitDepth),
      bypassMaster: typeof r.bypassMaster === 'boolean' ? r.bypassMaster : d.bypassMaster,
      normalize: typeof r.normalize === 'boolean' ? r.normalize : d.normalize,
      format: oneOf(r.format, AUDIO_FORMATS, d.format),
      loopFile: typeof r.loopFile === 'boolean' ? r.loopFile : d.loopFile,
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

/** "<base> - <track>.<ext>" per stem, numbered " 2", " 3"... where names repeat (ignoring case, as most file systems do). */
function stemFileNames(base: string, tracks: Track[], ext = 'wav'): string[] {
  const used = new Set<string>();
  return tracks.map((track) => {
    // Cleaned apart, so a long project name can't cut the track name off
    const stem = `${base} - ${safeFileName(track.name)}`;
    let name = stem;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem} ${n}`;
    used.add(name.toLowerCase());
    return `${name}.${ext}`;
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
  const master = useTimelineStore((s) => s.master);
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

  // The choices in effect: an empty song can't be exported, only the loop region can be a seamless
  // loop, and an intro + loop needs an intro (the loop starting after bar 1)
  const hasIntro = loop.inBar > 1;
  const range: Range = settings.range === 'game' && hasIntro ? 'game' : settings.range === 'song' && songBars > 0 ? 'song' : 'loop';
  const game = range === 'game';
  const ending: ExportEnding = game ? 'seamless' : range === 'song' && settings.ending === 'seamless' ? 'ringOut' : settings.ending;
  const format = settings.format;
  const ext = FORMAT_EXTENSION[format];
  const masterFx = { reverbDecay, delayTime, delayFeedback };
  const planned: RenderOptions = {
    tracks,
    clips,
    bpm,
    swing: 0,
    startBar: range === 'song' ? 1 : loop.inBar,
    endBar: range === 'song' ? songEnd : loop.outBar,
    masterFx,
    master,
    ending,
    sampleRate: settings.sampleRate,
    markers,
  };
  const { frames, passes } = exportFrames(planned);
  const cueCount = exportCues(planned).length;
  const stems = stemTracks(planned);
  const stemsOnly = settings.what === 'stems';
  const canExport = stemsOnly ? stems.length > 0 : range === 'loop' || songBars > 0;

  const suffix = range === 'song' || game ? '' : ending === 'seamless' ? ' (seamless loop)' : ' (loop)';
  const fileBase = `${safeFileName(projectName)}${suffix}`;
  const fileName = game ? `${fileBase} ${stemsOnly ? 'layers' : 'game music'}.zip` : stemsOnly ? `${fileBase} stems.zip` : `${fileBase}.${ext}`;
  const introFrames = Math.round(((loop.inBar - 1) * 240 * settings.sampleRate) / bpm);
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
      master: s.master,
      bypassMaster: stemsOnly && settings.bypassMaster,
      signal: controller.signal,
    };
    const encodeOpts = { bitDepth: settings.bitDepth, cues: exportCues(opts) };
    try {
      if (game) {
        const { parts, sampleRate } = await renderIntroLoop(opts, stemsOnly, (progress, detail) => setStatus({ kind: 'rendering', fileName, progress, detail }));
        controller.signal.throwIfAborted();
        // Loudness is the loop's (what the player hears for longest); normalizing moves intro and loop together
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Measuring loudness' });
        let reading = stemsOnly ? null : await measureLoudness(parts[0].loop, sampleRate, controller.signal);
        let note = '';
        if (reading && settings.normalize) {
          const { gainDb, limited } = normalizeGainDb(reading);
          const g = Math.pow(10, gainDb / 20);
          if (gainDb !== 0) for (const ch of [...parts[0].intro, ...parts[0].loop]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
          reading = { ...reading, integrated: reading.integrated + gainDb, truePeakMax: reading.truePeakMax + gainDb };
          note = limited ? ` (held under the target so peaks stay under ${NORMALIZE_CEILING_DBTP} dBTP)` : '';
        }
        const files: Array<{ name: string; data: Blob }> = [];
        for (const [i, part] of parts.entries()) {
          const name = part.track ? stemFileNames(fileBase, parts.map((p) => p.track!), '')[i].replace(/\.$/, '') : fileBase;
          setStatus({ kind: 'rendering', fileName, progress: 1, detail: `Encoding ${part.track ? part.track.name : 'the music'}` });
          files.push({ name: `${name} intro.${ext}`, data: await encodeAudio(part.intro, sampleRate, format, { bitDepth: settings.bitDepth }) });
          files.push({ name: `${name} loop.${ext}`, data: await encodeAudio(part.loop, sampleRate, format, { bitDepth: settings.bitDepth }) });
          if (format === 'wav' && settings.loopFile) {
            const whole = part.intro.map((ch, c) => {
              const out = new Float32Array(ch.length + part.loop[c].length);
              out.set(ch);
              out.set(part.loop[c], ch.length);
              return out;
            });
            const start = part.intro[0].length;
            files.push({ name: `${name} intro+loop (loop points).wav`, data: await encodeAudio(whole, sampleRate, 'wav', { bitDepth: settings.bitDepth, loop: { start, end: start + part.loop[0].length } }) });
          }
          controller.signal.throwIfAborted();
        }
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Packing the .zip' });
        downloadBlob(await createZip(files), fileName);
        showToast(`Exported ${fileName}${reading ? `: the loop is ${formatLufs(reading.integrated)}, peak ${formatDbtp(reading.truePeakMax)}${note}` : ''}`);
      } else if (stemsOnly) {
        const rendered = await renderStems(
          opts,
          settings.bitDepth,
          (progress, stem) => setStatus({ kind: 'rendering', fileName, progress, detail: `Stem ${stem.index + 1} of ${stem.count}: ${stem.track.name}` }),
          format === 'wav' ? undefined : (channels, sampleRate) => encodeAudio(channels, sampleRate, format, encodeOpts)
        );
        const names = stemFileNames(fileBase, rendered.map((r) => r.track), ext);
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Packing the .zip' });
        const zip = await createZip(rendered.map((r, i) => ({ name: names[i], data: r.wav })));
        controller.signal.throwIfAborted();
        downloadBlob(zip, fileName);
      } else {
        const audio = await renderArrangement(opts, (progress) => setStatus({ kind: 'rendering', fileName, progress, detail: '' }));
        controller.signal.throwIfAborted();
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Measuring loudness' });
        let reading = await measureLoudness(channelsOf(audio), audio.sampleRate, controller.signal);
        let note = '';
        if (settings.normalize) {
          const { gainDb, limited } = normalizeGainDb(reading);
          if (gainDb !== 0) scaleAudio(audio, gainDb);
          reading = { ...reading, integrated: reading.integrated + gainDb, truePeakMax: reading.truePeakMax + gainDb };
          note = limited ? `. That's ${(NORMALIZE_TARGET_LUFS - reading.integrated).toFixed(1)} dB under the target, so peaks stay under ${NORMALIZE_CEILING_DBTP} dBTP. To get louder, turn on the master OTT and raise its Out gain` : '';
        }
        if (format !== 'wav') setStatus({ kind: 'rendering', fileName, progress: 1, detail: `Encoding ${format.toUpperCase()}` });
        downloadBlob(format === 'wav' ? encodeWav(audio, settings.bitDepth, exportCues(opts)) : await encodeAudio(channelsOf(audio), audio.sampleRate, format, encodeOpts), fileName);
        showToast(`Exported ${fileName}: ${formatLufs(reading.integrated)}, peak ${formatDbtp(reading.truePeakMax)}${note}`);
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
      <Modal title="Export audio" onClose={onClose}>
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

  const rangeDetail = game
    ? `For games: an intro (bars 1 to ${formatBarCount(loop.inBar)}, ${lengthLabel(loop.inBar - 1, bpm)}) to play once, then the loop region (bars ${formatBarCount(loop.inBar)} to ${formatBarCount(loop.outBar)}, ${lengthLabel(loopBars, bpm)}) as a seamless loop to repeat. The intro leads straight into the loop.`
    : range === 'song'
      ? `Bar 1 to the end of the last clip: ${formatBarCount(songBars)} bars, ${lengthLabel(songBars, bpm)}.`
      : `Bars ${formatBarCount(loop.inBar)} to ${formatBarCount(loop.outBar)}: ${formatBarCount(loopBars)} bars, ${lengthLabel(loopBars, bpm)}. Starts at ${formatSmpte(loop.inBar, bpm, fps, dropFrame)} (${frameRateLabel(fps, dropFrame)}).`;
  const endingDetail =
    ending === 'ringOut'
      ? `Plays the range once, then ${formatBarCount(tail)} s more so release, reverb and echo tails ring out.`
      : ending === 'exact'
        ? `Exactly the range, ${frames.toLocaleString()} samples, with a 5 ms fade at the very end so it doesn't click.`
        : `Exactly one loop, ${frames.toLocaleString()} samples. Its start already holds what rings on from the pass before, so it repeats without a gap or click. (Renders ${passes} passes and keeps the last.)`;

  return (
    <Modal title="Export audio" onClose={onClose}>
      <p>Renders the current mix (volume, pan, mute, solo, every effect and the master volume) faster than real time. Muted and un-soloed tracks are left out.</p>

      <Section title="Range">
        <Segmented<Range>
          label="Range"
          value={range}
          onChange={(value) => update({ range: value })}
          options={[
            { value: 'song', label: 'Whole song', disabled: songBars <= 0, title: songBars <= 0 ? 'No audible track has clips' : 'Bar 1 to the end of the last clip' },
            { value: 'loop', label: 'Loop region', title: 'Loop In to Out' },
            { value: 'game', label: 'Intro + loop', disabled: !hasIntro, title: hasIntro ? 'For games: an intro, then a seamless loop' : 'Move the loop In past bar 1: everything before it is the intro' },
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
            { value: 'mixdown', label: 'Mixdown', title: 'One stereo file of the whole mix' },
            { value: 'stems', label: game ? 'Layers' : 'Stems', title: game ? 'An intro and a loop per track, for adaptive music' : 'One file per track, in a .zip' },
          ]}
        />
        {stemsOnly ? (
          <>
            <p>
              {stems.length
                ? game
                  ? `An intro and a loop file for each of ${stems.length} track${stems.length === 1 ? '' : 's'} (${stems.map((t) => t.name).join(', ')}), in one .zip. They all line up, so a game can play them together and fade layers in and out as the action changes.`
                  : `${stems.length} ${format.toUpperCase()} file${stems.length === 1 ? '' : 's'} in one .zip, one per audible track with clips in the range (${stems.map((t) => t.name).join(', ')}). All start at the range start and have the same length.`
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
          <>
            <p>
              {game ? 'An intro file and a loop file of everything that plays, in one .zip.' : `One stereo ${format.toUpperCase()} of everything that plays.`} When it's done, its loudness and true peak
              show at the bottom of the screen.
            </p>
            <label className="flex items-start gap-2 cursor-pointer text-forge-text">
              <input type="checkbox" checked={settings.normalize} onChange={(e) => update({ normalize: e.target.checked })} className="mt-0.5 accent-cyan-400" />
              <span>
                Normalize to {NORMALIZE_TARGET_LUFS} LUFS
                <span className="block text-forge-muted">
                  {settings.normalize
                    ? `Turns the whole file up or down to the loudness Spotify, YouTube and Apple Music play at, so it won't be turned down or sound quiet next to other tracks. Never pushes peaks over ${NORMALIZE_CEILING_DBTP} dBTP.`
                    : 'The file keeps the level of the mix.'}
                </span>
              </span>
            </label>
          </>
        )}
      </Section>

      {!game && <Section title="Ending">
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
      </Section>}

      <Section title="Format">
        <Segmented<AudioFormat>
          label="File type"
          value={format}
          onChange={(value) => update({ format: value })}
          options={[
            { value: 'wav', label: 'WAV', title: 'Uncompressed, exact. Holds markers and loop points' },
            { value: 'mp3', label: 'MP3', title: '320 kb/s: small, plays everywhere' },
            { value: 'ogg', label: 'OGG', title: 'Ogg Vorbis, about 256 kb/s: small, and what Godot and Unity loop best' },
          ]}
        />
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
          {format === 'wav' && <Segmented<BitDepth>
            label="Bit depth"
            value={settings.bitDepth}
            onChange={(value) => update({ bitDepth: value })}
            options={[
              { value: 16, label: '16-bit' },
              { value: 24, label: '24-bit' },
              { value: 32, label: '32-bit float' },
            ]}
          />}
        </div>
        {game && format === 'wav' && (
          <label className="flex items-start gap-2 cursor-pointer text-forge-text">
            <input type="checkbox" checked={settings.loopFile} onChange={(e) => update({ loopFile: e.target.checked })} className="mt-0.5 accent-cyan-400" />
            <span>
              Also one file with loop points
              <span className="block text-forge-muted">The intro and the loop in one WAV, with the loop marked in it: Godot and most samplers then play the intro once and loop the rest on their own.</span>
            </span>
          </label>
        )}
        <p>
          Stereo. Peaks are kept just under full scale, so nothing clips.
          {format !== 'wav' && ' MP3 and OGG are compressed: a small file that sounds the same to most ears. An MP3 can have a few milliseconds of silence added at its start, so for seamless loops in games use OGG or WAV.'}
          {format === 'wav' && !game && cueCount > 0 &&
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
            {game ? `intro ${durationLabel(introFrames / settings.sampleRate)} + loop ${durationLabel(frames / settings.sampleRate)}` : durationLabel(frames / settings.sampleRate)}
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
