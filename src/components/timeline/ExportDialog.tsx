/**
 * The Export dialog: what to render (song, loop, stems, the intro plus loop for games, a video),
 * its ending, format (WAV, MP3, Ogg, MP4), sample rate and bit depth, loudness normalizing, and
 * the render with progress and cancel.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { countedRender } from '../../audio/renderBusy';
import { useVideoStore } from '../../store/videoStore';
import { Download, Loader2 } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { safeFileName } from '../../store/project';
import {
  audibleTracks,
  BIT_DEPTHS,
  downloadBlob,
  wholeFileLoop,
  encodeWav,
  exportCues,
  exportFrames,
  renderArrangement,
  renderIntroLoop,
  renderStems,
  ditherSeedOf,
  ringOutSeconds,
  SAMPLE_RATES,
  lossyRate,
  channelsOf,
  cutRingOut,
  stemTracks,
} from '../../audio/exportWav';
import { formatDbtp, formatLufs, measureLoudness, normalizeGainDb } from '../../audio/loudness';
import { exportCeilingDbtp } from '../../audio/effects/limiter';
import { DEFAULT_TARGET, LOUDNESS_TARGETS, MAX_LIMITING_DB, reachTarget, targetById } from '../../audio/loudnessTarget';
import { showToast } from './toastStore';
import type { BitDepth, ExportEnding, RenderOptions, SampleRate } from '../../audio/exportWav';
import { createZip } from '../../audio/zip';
import { AUDIO_FORMATS, encodeAudio, FORMAT_EXTENSION } from '../../audio/encoders';
import type { AudioFormat } from '../../audio/encoders';
import { isSkin, SPECTRUM_SKINS, type SkinId } from '../../audio/spectrumSkins';
import { canExportVideo, renderVideo, VIDEO_FPS, VIDEO_SIZES, type VideoShape } from '../../audio/videoExport';
import { showcaseData } from '../../store/showcase';
import { barToSeconds, formatSmpte, type Tempo } from '../../audio/transport';
import { formatBarCount, frameRateLabel } from '../../store/timelineTypes';
import type { Track } from '../../store/timelineTypes';
import { Modal } from './Modal';

/** 'game': an intro (bar 1 to the loop's In) and the loop region as a seamless loop, for games. */
type Range = 'song' | 'loop' | 'game';
type What = 'mixdown' | 'stems' | 'video';

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
  /** How loud to make it (see loudnessTarget.ts) */
  target: string;
  format: AudioFormat;
  /** Intro + loop as WAV: also one file holding both, with the loop marked in it (Godot, samplers). */
  loopFile: boolean;
  /** Video: the picture (Showcase, the notes on a piano roll, or a spectrum style) and its shape */
  picture: 'showcase' | SkinId;
  shape: VideoShape;
}

const DEFAULT_SETTINGS: ExportSettings = { range: 'song', what: 'mixdown', ending: 'ringOut', sampleRate: 44100, bitDepth: 24, bypassMaster: true, normalize: false, target: DEFAULT_TARGET, format: 'wav', loopFile: true, picture: 'showcase', shape: 'wide' };
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
      what: oneOf(r.what, ['mixdown', 'stems', 'video'] as const, d.what),
      ending: oneOf(r.ending, ['ringOut', 'exact', 'seamless'] as const, d.ending),
      sampleRate: oneOf(r.sampleRate, SAMPLE_RATES, d.sampleRate),
      bitDepth: oneOf(r.bitDepth, BIT_DEPTHS, d.bitDepth),
      bypassMaster: typeof r.bypassMaster === 'boolean' ? r.bypassMaster : d.bypassMaster,
      normalize: typeof r.normalize === 'boolean' ? r.normalize : d.normalize,
      target: oneOf(r.target, LOUDNESS_TARGETS.map((t) => t.id), d.target),
      format: oneOf(r.format, AUDIO_FORMATS, d.format),
      loopFile: typeof r.loopFile === 'boolean' ? r.loopFile : d.loopFile,
      picture: r.picture === 'showcase' || isSkin(r.picture) ? r.picture : d.picture,
      shape: oneOf(r.shape, ['wide', 'tall'] as const, d.shape),
    };
  } catch {
    return d;
  }
}

/**
 * Open Export set up for a Showcase video (the notes playing on a piano roll), of the whole song,
 * in the shape asked for: what File › Showcase video… and the search do. Other settings are kept.
 */
export function presetShowcaseExport(shape: VideoShape = 'wide'): void {
  const s = loadSettings();
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...s, range: 'song', what: 'video', picture: 'showcase', shape }));
  } catch {
    // Storage blocked: the dialog opens with its usual settings
  }
}

/** Where the file is going, which sets its loudness. */
function TargetPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <label className="flex items-center gap-2 pl-6 text-forge-text">
      For
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-7 bg-forge-bg border border-forge-border rounded px-1">
        {LOUDNESS_TARGETS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function saveSettings(settings: ExportSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked or full (private mode): the options just aren't remembered
  }
}

/** Duration label for a bar range at the current tempo, e.g. "0:16". */
function lengthLabel(from: number, to: number, tempo: Tempo): string {
  const seconds = Math.floor(barToSeconds(to, tempo) - barToSeconds(from, tempo) + 1e-6);
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
/**
 * Mix a video file's own sound into `channels` (at `sampleRate`), `offset` seconds of the video
 * at the start, 6 dB down so the music leads. A video without sound (or one the browser can't
 * decode) leaves them as they are.
 */
async function mixVideoSound(file: File, channels: Float32Array[], sampleRate: number, offset: number): Promise<void> {
  let decoded: AudioBuffer;
  try {
    decoded = await new OfflineAudioContext(2, 1, sampleRate).decodeAudioData(await file.arrayBuffer());
  } catch {
    showToast("The video's sound couldn't be read, so the video has the music only");
    return;
  }
  const gain = 0.5;
  const shift = Math.round(offset * sampleRate);
  for (let c = 0; c < channels.length; c++) {
    const src = decoded.getChannelData(Math.min(c, decoded.numberOfChannels - 1));
    const out = channels[c];
    const from = Math.max(0, -shift);
    const to = Math.min(out.length, src.length - shift);
    for (let i = from; i < to; i++) out[i] += src[i + shift] * gain;
  }
}

export const ExportDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const bpm = useTimelineStore((s) => s.bpm);
  const tempoPoints = useTimelineStore((s) => s.tempoPoints);
  const tempo: Tempo = useMemo(() => ({ bpm, points: tempoPoints }), [bpm, tempoPoints]);
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
  const refVideo = useVideoStore((st) => st.video);
  const videoStart = useVideoStore((st) => st.start);
  const [useFootage, setUseFootage] = useState(true);
  const [keepVideoSound, setKeepVideoSound] = useState(false);
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
  const videoOk = canExportVideo();
  // A video is of the song or the loop; an intro + loop is audio for a game
  const what: What = settings.what === 'video' && (!videoOk || range === 'game') ? 'mixdown' : settings.what;
  const videoOut = what === 'video';
  const game = range === 'game';
  const ending: ExportEnding = game ? 'seamless' : range === 'song' && settings.ending === 'seamless' ? 'ringOut' : settings.ending;
  const format = settings.format;
  // (MP3 stops at 48 kHz: a hi-res rate is a WAV's; compressed files get its base rate)
  const exportRate = format === 'wav' ? settings.sampleRate : lossyRate(settings.sampleRate);
  const ext = FORMAT_EXTENSION[format];
  // MP3, Ogg and a video's sound keep their peaks a little lower: encoding overshoots them
  const ceilingDbtp = exportCeilingDbtp(videoOut ? 'mp4' : format);
  const room = useTimelineStore((s) => s.masterReverbRoom);
  const roomStyle = useTimelineStore((s) => s.masterRoomStyle);
  const masterFx = { reverbDecay, delayTime, delayFeedback, ...(room ? { room } : {}), ...(roomStyle !== 'hall' ? { roomStyle } : {}) };
  const planned: RenderOptions = {
    tracks,
    clips,
    bpm,
    tempoPoints,
    swing: 0,
    startBar: range === 'song' ? 1 : loop.inBar,
    endBar: range === 'song' ? songEnd : loop.outBar,
    masterFx,
    master,
    ending,
    sampleRate: exportRate,
    markers,
  };
  const { frames, passes } = exportFrames(planned);
  const cueCount = exportCues(planned).length;
  const stems = stemTracks(planned);
  const stemsOnly = what === 'stems';
  const canExport = stemsOnly ? stems.length > 0 : range === 'loop' || songBars > 0;

  const suffix = range === 'song' || game ? '' : ending === 'seamless' ? ' (seamless loop)' : ' (loop)';
  const fileBase = `${safeFileName(projectName)}${suffix}`;
  const fileName = game ? `${fileBase} ${stemsOnly ? 'layers' : 'game music'}.zip` : stemsOnly ? `${fileBase} stems.zip` : videoOut ? `${fileBase}.mp4` : `${fileBase}.${ext}`;
  const introFrames = Math.round(barToSeconds(loop.inBar, tempo) * exportRate);
  const tail = ringOutSeconds(masterFx, tracks, bpm);

  // Counted as a render the whole way (encoding too), so the update notice waits for it (renderBusy.ts)
  const startExport = () => countedRender(async () => {
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
      // The mix plays at the Intensity you hear; stems and layers stay at full level for the game to mix
      ...(stemsOnly ? {} : { intensity: { value: s.intensity, curves: s.intensityCurves } }),
      peakCeilingDbtp: ceilingDbtp,
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
          // Gain only: a limiter would change the sound across the loop's seam
          const { gainDb, limited } = normalizeGainDb(reading, targetById(settings.target).lufs, ceilingDbtp);
          const g = Math.pow(10, gainDb / 20);
          if (gainDb !== 0) for (const ch of [...parts[0].intro, ...parts[0].loop]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
          reading = { ...reading, integrated: reading.integrated + gainDb, truePeakMax: reading.truePeakMax + gainDb };
          note = limited ? ` (held under the target so peaks stay under ${ceilingDbtp} dBTP)` : '';
        }
        const files: Array<{ name: string; data: Blob }> = [];
        for (const [i, part] of parts.entries()) {
          const name = part.track ? stemFileNames(fileBase, parts.map((p) => p.track!), '')[i].replace(/\.$/, '') : fileBase;
          setStatus({ kind: 'rendering', fileName, progress: 1, detail: `Encoding ${part.track ? part.track.name : 'the music'}` });
          // (Each stem its own dither, so the stems' dither doesn't add up in step when they're mixed)
          const ditherSeed = part.track ? ditherSeedOf(part.track.id) : 0;
          files.push({ name: `${name} intro.${ext}`, data: await encodeAudio(part.intro, sampleRate, format, { bitDepth: settings.bitDepth, ditherSeed }) });
          files.push({ name: `${name} loop.${ext}`, data: await encodeAudio(part.loop, sampleRate, format, { bitDepth: settings.bitDepth, ditherSeed }) });
          if (format === 'wav' && settings.loopFile) {
            const whole = part.intro.map((ch, c) => {
              const out = new Float32Array(ch.length + part.loop[c].length);
              out.set(ch);
              out.set(part.loop[c], ch.length);
              return out;
            });
            const start = part.intro[0].length;
            files.push({ name: `${name} intro+loop (loop points).wav`, data: await encodeAudio(whole, sampleRate, 'wav', { bitDepth: settings.bitDepth, loop: { start, end: start + part.loop[0].length }, ditherSeed }) });
          }
          controller.signal.throwIfAborted();
        }
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Packing the .zip' });
        downloadBlob(await createZip(files), fileName);
        showToast(`Exported ${fileName}${reading ? `: the loop is ${formatLufs(reading.integrated)}, peak ${formatDbtp(reading.truePeakMax)}${note}` : ''}`);
      } else if (videoOut) {
        // 48 kHz: what video sound runs at (and Opus, the fallback codec, needs). A ring-out is
        // cut where its tails die away once it has its final level (see keepRingOut)
        const videoOpts = { ...opts, sampleRate: 48000 as const, keepRingOut: settings.normalize };
        let audio = await renderArrangement(videoOpts, (progress) =>
          setStatus({ kind: 'rendering', fileName, progress: progress * 0.3, detail: 'Rendering the sound' })
        );
        controller.signal.throwIfAborted();
        let reading = await measureLoudness(channelsOf(audio), audio.sampleRate, controller.signal);
        if (settings.normalize) {
          setStatus({ kind: 'rendering', fileName, progress: 0.3, detail: 'Matching the loudness' });
          reading = (await reachTarget(channelsOf(audio), audio.sampleRate, reading, targetById(settings.target), controller.signal, ceilingDbtp)).reading;
          audio = cutRingOut(audio, videoOpts);
        }
        const startSeconds = barToSeconds(opts.startBar, tempo);
        const sections = (opts.markers ?? [])
          .filter((m) => m.bar >= opts.startBar && m.bar < opts.endBar)
          .map((m) => ({ at: barToSeconds(m.bar, tempo) - startSeconds, name: m.name }));
        // On the reference video, if one is loaded and chosen: where it is at the export's start
        const footage = refVideo && useFootage ? { url: refVideo.url, offset: startSeconds - videoStart } : undefined;
        const channels = channelsOf(audio);
        if (footage && keepVideoSound) {
          setStatus({ kind: 'rendering', fileName, progress: 0.3, detail: "Reading the video's sound" });
          await mixVideoSound(refVideo!.file, channels, audio.sampleRate, footage.offset);
        }
        // Showcase: the notes of the range, timed by the song's tempo map
        const showcase = !footage && settings.picture === 'showcase' ? showcaseData(tracks, clips, opts.startBar, opts.endBar, (bar) => barToSeconds(bar, tempo)) : undefined;
        const blob = await renderVideo({
          footage,
          skin: settings.picture === 'showcase' ? 'bars' : settings.picture,
          shape: settings.shape,
          showcase,
          channels,
          sampleRate: audio.sampleRate,
          title: projectName,
          subtitle: `${Math.round(opts.bpm * 100) / 100} BPM · made with Fledgetone`,
          sections,
          signal: controller.signal,
          onProgress: (p) => setStatus({ kind: 'rendering', fileName, progress: 0.3 + 0.7 * p, detail: 'Drawing the video' }),
        });
        controller.signal.throwIfAborted();
        downloadBlob(blob, fileName);
        showToast(`Exported ${fileName}: ${formatLufs(reading.integrated)}, peak ${formatDbtp(reading.truePeakMax)}`);
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
        // A ring-out is cut where its tails die away once it has its final level (see keepRingOut)
        const mixOpts = { ...opts, keepRingOut: settings.normalize };
        let audio = await renderArrangement(mixOpts, (progress) => setStatus({ kind: 'rendering', fileName, progress, detail: '' }));
        controller.signal.throwIfAborted();
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Measuring loudness' });
        let reading = await measureLoudness(channelsOf(audio), audio.sampleRate, controller.signal);
        let note = '';
        if (settings.normalize) {
          setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Matching the loudness' });
          const reached = await reachTarget(channelsOf(audio), audio.sampleRate, reading, targetById(settings.target), controller.signal, ceilingDbtp);
          reading = reached.reading;
          audio = cutRingOut(audio, mixOpts);
          if (reached.shortDb > 0.3 && reached.capped)
            note = `. That's ${reached.shortDb.toFixed(1)} dB under the target: getting there would take more than ${MAX_LIMITING_DB} dB of limiting, which squashes the music. To get louder, turn on the master OTT and raise its Out gain`;
          else if (reached.limitedDb > 0.3) note = ` (the limiter took ${reached.limitedDb.toFixed(1)} dB off the peaks to get there)`;
        }
        if (format !== 'wav') setStatus({ kind: 'rendering', fileName, progress: 1, detail: `Encoding ${format.toUpperCase()}` });
        downloadBlob(format === 'wav' ? encodeWav(audio, settings.bitDepth, exportCues(opts), wholeFileLoop(opts, audio.length)) : await encodeAudio(channelsOf(audio), audio.sampleRate, format, encodeOpts), fileName);
        showToast(`Exported ${fileName}: ${formatLufs(reading.integrated)}, peak ${formatDbtp(reading.truePeakMax)}${note}`);
      }
      onClose();
    } catch (err) {
      if (controller.signal.aborted) setStatus({ kind: 'idle', note: 'Export cancelled.' });
      else setStatus({ kind: 'idle', error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  });

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
    ? `For games: an intro (bars 1 to ${formatBarCount(loop.inBar)}, ${lengthLabel(1, loop.inBar, tempo)}) to play once, then the loop region (bars ${formatBarCount(loop.inBar)} to ${formatBarCount(loop.outBar)}, ${lengthLabel(loop.inBar, loop.outBar, tempo)}) as a seamless loop to repeat. The intro leads straight into the loop.`
    : range === 'song'
      ? `Bar 1 to the end of the last clip: ${formatBarCount(songBars)} bars, ${lengthLabel(1, 1 + songBars, tempo)}.`
      : `Bars ${formatBarCount(loop.inBar)} to ${formatBarCount(loop.outBar)}: ${formatBarCount(loopBars)} bars, ${lengthLabel(loop.inBar, loop.outBar, tempo)}. Starts at ${formatSmpte(loop.inBar, tempo, fps, dropFrame)} (${frameRateLabel(fps, dropFrame)}).`;
  const endingDetail =
    ending === 'ringOut'
      ? `Plays the range once, then lets release, reverb and echo tails ring out: the file ends once they've died away (under -70 dBFS), at most ${formatBarCount(tail)} s after the range.`
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
          value={what}
          onChange={(value) => update({ what: value })}
          options={[
            { value: 'mixdown', label: 'Mixdown', title: 'One stereo file of the whole mix' },
            { value: 'stems', label: game ? 'Layers' : 'Stems', title: game ? 'An intro and a loop per track, for adaptive music' : 'One file per track, in a .zip' },
            {
              value: 'video',
              label: 'Video (MP4)',
              disabled: !videoOk || game,
              title: !videoOk ? "This browser can't make videos: use Chrome or Edge" : game ? 'Choose Whole song or Loop region for a video' : 'The song with a visualizer, for YouTube and socials',
            },
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
        ) : videoOut ? (
          <>
            {refVideo && (
              <div className="flex flex-col gap-1.5 rounded-md border border-amber-400/40 bg-amber-500/5 p-2">
                <label className="flex items-start gap-2 cursor-pointer text-forge-text">
                  <input type="checkbox" checked={useFootage} onChange={(e) => setUseFootage(e.target.checked)} className="mt-0.5 accent-amber-400" />
                  <span>
                    Put the music on {refVideo.name}
                    <span className="block text-forge-muted">The picture is your video, where it sits on the timeline (black before and after it), instead of the visualizer.</span>
                  </span>
                </label>
                {useFootage && (
                  <label className="flex items-start gap-2 cursor-pointer text-forge-text">
                    <input type="checkbox" checked={keepVideoSound} onChange={(e) => setKeepVideoSound(e.target.checked)} className="mt-0.5 accent-amber-400" />
                    <span>
                      Keep the video's own sound too
                      <span className="block text-forge-muted">Mixed under the music (sound effects, dialogue). Off: the music only.</span>
                    </span>
                  </label>
                )}
              </div>
            )}
            <Segmented<VideoShape>
              label="Shape"
              value={settings.shape}
              onChange={(value) => update({ shape: value })}
              options={[
                { value: 'wide', label: 'Widescreen 16:9', title: '1920×1080: YouTube, a game trailer, a website' },
                { value: 'tall', label: 'Portrait 9:16', title: '1080×1920: TikTok, YouTube Shorts, Instagram Reels' },
              ]}
            />
            {refVideo && useFootage ? (
              <p>
                An MP4 video ({VIDEO_SIZES[settings.shape].w}×{VIDEO_SIZES[settings.shape].h}, {VIDEO_FPS} fps): your video with the mix as its sound, where it sits on the timeline{settings.shape === 'tall' ? ', fitted into the tall frame' : ''}. It's drawn faster than real time.
              </p>
            ) : (
              <p>
                An MP4 video ({VIDEO_SIZES[settings.shape].w}×{VIDEO_SIZES[settings.shape].h}, {VIDEO_FPS} fps) of the mix: the project's name,{' '}
                {settings.picture === 'showcase'
                  ? 'the notes of every track on a piano roll that scrolls past the playhead, each lighting up as it plays, the tracks playing'
                  : 'a spectrum that moves with the music'}
                , the whole song's waveform with a playhead, the section from your markers, and the time. Ready for {settings.shape === 'tall' ? 'TikTok, Shorts and Reels' : 'YouTube, socials or a game\'s trailer'}. It's drawn faster than real time.
              </p>
            )}
            {!(refVideo && useFootage) && (
              <label className="flex items-center gap-2 text-forge-text">
                Picture
                <select
                  value={settings.picture}
                  onChange={(e) => update({ picture: e.target.value as ExportSettings['picture'] })}
                  className="h-7 bg-forge-bg border border-forge-border rounded px-1"
                  title={settings.picture === 'showcase' ? 'The notes of every track on a piano roll, lighting up as the playhead plays them' : SPECTRUM_SKINS.find((k) => k.id === settings.picture)?.blurb}
                >
                  <option value="showcase">Showcase: the notes playing</option>
                  {SPECTRUM_SKINS.map((k) => (
                    <option key={k.id} value={k.id}>
                      Spectrum: {k.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex items-start gap-2 cursor-pointer text-forge-text">
              <input type="checkbox" checked={settings.normalize} onChange={(e) => update({ normalize: e.target.checked })} className="mt-0.5 accent-cyan-400" />
              <span>
                Match a loudness target
                <span className="block text-forge-muted">YouTube plays at -14 LUFS: matching it means your video isn't turned down.</span>
              </span>
            </label>
            {settings.normalize && <TargetPicker value={settings.target} onChange={(target) => update({ target })} />}
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
                Match a loudness target
                <span className="block text-forge-muted">
                  {settings.normalize
                    ? `${targetById(settings.target).about} ${game ? 'The intro and loop are turned up or down together (no limiting, which would change the loop\u2019s seam).' : 'If the mix is too quiet to get there by turning it up, a look-ahead limiter holds the peaks down (up to ' + MAX_LIMITING_DB + ' dB).'} Peaks never pass ${ceilingDbtp} dBTP.`
                    : 'The file keeps the level of the mix.'}
                </span>
              </span>
            </label>
            {settings.normalize && <TargetPicker value={settings.target} onChange={(target) => update({ target })} />}
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

      {!videoOut && <Section title="Format">
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
            value={exportRate}
            onChange={(value) => update({ sampleRate: value })}
            options={[
              { value: 44100, label: '44.1 kHz' },
              { value: 48000, label: '48 kHz' },
              ...(format === 'wav'
                ? ([
                    { value: 88200, label: '88.2', title: '88.2 kHz: for mastering or video work at high rates (a bigger file and a slower export)' },
                    { value: 96000, label: '96', title: '96 kHz: for mastering or video work at high rates (a bigger file and a slower export)' },
                  ] as const)
                : []),
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
          Stereo. True peaks are kept under {ceilingDbtp} dBTP (between samples too), so nothing clips.
          {format !== 'wav' && ' MP3 and OGG are compressed: a small file that sounds the same to most ears. Compressing nudges the peaks up a little, which is why they start half a dB lower than a WAV\u2019s. An MP3 can have a few milliseconds of silence added at its start, so for seamless loops in games use OGG or WAV.'}
          {format === 'wav' && !game && cueCount > 0 &&
            ` ${cueCount === 1 ? 'The marker in the range goes' : `The ${cueCount} markers in the range go`} into ${
              stemsOnly ? 'every file' : 'the file'
            } as ${cueCount === 1 ? 'a cue point, which DAWs and game audio tools show as a marker' : 'cue points, which DAWs and game audio tools show as markers'}.`}
        </p>
      </Section>}

      {status.error && <p className="text-red-400">Export failed: {status.error}</p>}
      {videoOut && <p>Video sound is 48 kHz. Where the browser has them (Chrome and Edge on Windows and Mac), the video is H.264 with AAC sound, which plays everywhere; otherwise VP9 or AV1 with Opus, which browsers, VLC and YouTube play.</p>}
      {status.note && <p className="text-amber-300">{status.note}</p>}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-3 border-t border-forge-border">
        <span className="min-w-0 break-words text-forge-text">
          {fileName}
          <span className="text-forge-muted">
            {' · '}
            {game ? `intro ${durationLabel(introFrames / exportRate)} + loop ${durationLabel(frames / exportRate)}` : `${ending === 'ringOut' ? 'up to ' : ''}${durationLabel(frames / exportRate)}`}
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
