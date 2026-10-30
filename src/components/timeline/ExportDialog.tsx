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
import { formatDbtp, formatLufs, measureLoudness, sharedGainDb, truePeakOf } from '../../audio/loudness';
import { fileAgainstHeardDb, heardLoudness } from '../../audio/monitor';
import { exportCeilingDbtp, limitInPlace } from '../../audio/effects/limiter';
import { DEFAULT_TARGET, LOUDNESS_TARGETS, MAX_LIMITING_DB, reachTarget, targetById } from '../../audio/loudnessTarget';
import { LOUD_TARGETS, loudToKeep, type LoudMatch } from '../../audio/effects/loudMaster';
import type { MasterStats } from '../../audio/effects/masterAfter';
import { showToast } from './toastStore';
import type { BitDepth, ExportEnding, RenderOptions, SampleRate } from '../../audio/exportWav';
import { createZip } from '../../audio/zip';
import { renderMixdown, stemFileNames } from '../../audio/exportMix';
import { AUDIO_FORMATS, encodeAudio, encodeTogether, FORMAT_EXTENSION } from '../../audio/encoders';
import type { AudioFormat, HeldReport } from '../../audio/encoders';
import { isSkin, SPECTRUM_SKINS, type SkinId } from '../../audio/spectrumSkins';
import { canExportVideo, DEFAULT_VIDEO_MARKS, renderVideo, VIDEO_SIZES, type VideoFps, type VideoMarks, type VideoShape } from '../../audio/videoExport';
import type { ShowcaseHits, ShowcaseLayout } from '../../audio/showcaseDraw';
import { VERSION_LABELS, versionLeavesOut, versionTracks, type SongVersion } from '../../store/songVersions';
import { showcaseData } from '../../store/showcase';
import { barToSeconds, formatSmpte, type Tempo } from '../../audio/transport';
import { formatBarCount, formatBarRange, frameRateLabel } from '../../store/timelineTypes';
import { Modal } from './Modal';
import { captureWamStates } from '../../audio/wamHost';

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
  /** Video: frames a second (60: smooth scrolling notes) */
  fps: VideoFps;
  /** Video: which of the title, subtitle, section, time and waveform it shows */
  marks: VideoMarks;
  /** Showcase: the tracks on one roll or a lane each (Auto: lanes for a big arrangement), and what a hit note does */
  showcaseLayout: ShowcaseLayout;
  showcaseHits: ShowcaseHits;
  /** Mixdown: also the version without the lead melody, and the one without drums (songVersions.ts) */
  underscore: boolean;
  noDrums: boolean;
}

const DEFAULT_SETTINGS: ExportSettings = { range: 'song', what: 'mixdown', ending: 'ringOut', sampleRate: 44100, bitDepth: 24, bypassMaster: true, normalize: false, target: DEFAULT_TARGET, format: 'wav', loopFile: true, picture: 'showcase', shape: 'wide', fps: 60, marks: DEFAULT_VIDEO_MARKS, showcaseLayout: 'auto', showcaseHits: 'sparkles', underscore: false, noDrums: false };
const SETTINGS_KEY = 'bos-beat-box.export-settings';

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Saved video marks, each falling back to shown */
function readMarks(raw: unknown): VideoMarks {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const on = (k: keyof VideoMarks) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_VIDEO_MARKS[k]);
  return { title: on('title'), subtitle: on('subtitle'), sections: on('sections'), time: on('time'), waveform: on('waveform') };
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
      fps: oneOf(r.fps, [30, 60] as const, d.fps),
      marks: readMarks(r.marks),
      showcaseLayout: oneOf(r.showcaseLayout, ['auto', 'together', 'lanes'] as const, d.showcaseLayout),
      showcaseHits: oneOf(r.showcaseHits, ['sparkles', 'rings', 'glow'] as const, d.showcaseHits),
      underscore: typeof r.underscore === 'boolean' ? r.underscore : d.underscore,
      noDrums: typeof r.noDrums === 'boolean' ? r.noDrums : d.noDrums,
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

/**
 * How the file will sound against the song as it played in the app: the listening path matches
 * every song to about MONITOR_TARGET_LUFS (monitor.ts), a file plays at its own level, so a quiet
 * mix that sounded fine here can come out quieter than everything else in a player. With the one
 * click to the Streaming target when it would. Nothing until the song has played a few seconds.
 */
function HeardLevelNote({ normalize, target, onMatch }: { normalize: boolean; target: string; onMatch: () => void }) {
  // (What was heard before the dialog opened: nothing plays while it's open)
  const [heard] = useState(heardLoudness);
  if (!heard) return null;
  const diff = Math.round(fileAgainstHeardDb(heard, normalize ? targetById(target).lufs : heard.lufs));
  if (Math.abs(diff) < 1) return null;
  const turned = Math.round(heard.matchDb);
  return (
    <p className="pl-6 text-forge-muted" data-testid="heard-level">
      As it last played, the song measures about {formatLufs(heard.lufs)}
      {turned ? `, and the listening level turned it ${turned > 0 ? 'up' : 'down'} ${Math.abs(turned)} dB` : ''}: the file will sound about{' '}
      <span className={diff < 0 ? 'text-amber-300' : 'text-forge-text'}>
        {Math.abs(diff)} dB {diff < 0 ? 'quieter' : 'louder'}
      </span>{' '}
      than you heard it here.
      {!normalize && diff < 0 && (
        <>
          {' '}
          <button
            type="button"
            onClick={onMatch}
            className="ml-1 px-2 rounded border border-forge-border bg-forge-bg text-forge-text hover:border-cyan-400/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
          >
            Match Streaming (-14 LUFS)
          </button>
        </>
      )}
    </p>
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
  // A Loud master's export aims at its own target (Match a loudness target on), unless changed here
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings();
    const loud = useTimelineStore.getState().master.loud;
    return loud?.on ? { ...saved, normalize: true, target: loud.target } : saved;
  });
  const refVideo = useVideoStore((st) => st.video);
  const videoStart = useVideoStore((st) => st.start);
  const [useFootage, setUseFootage] = useState(true);
  const [keepVideoSound, setKeepVideoSound] = useState(false);
  // The video's title and the line under it, for this export (blank: the project's name, the tempo)
  const [videoTitle, setVideoTitle] = useState('');
  const [videoSubtitle, setVideoSubtitle] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  // A render still going when the dialog goes away is stopped
  useEffect(() => () => abortRef.current?.abort(), []);
  // Enter exports at once, but the dialog opens at its top (autoFocus would scroll down to the button)
  const exportButton = useRef<HTMLButtonElement>(null);
  useEffect(() => exportButton.current?.focus({ preventScroll: true }), []);

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
  // -1 dBTP whatever the format: a compressed file is held under it once decoded (encoders.ts), and
  // compressed stems and layers are turned down together, so they still add up to the mix
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
  // Versions of a mixdown: the full mix, and the others asked for that this song can make
  const leftOut = useMemo(() => versionLeavesOut(tracks, clips), [tracks, clips]);
  const mixdown = !game && !stemsOnly && !videoOut;
  const versions: SongVersion[] = mixdown ? ['full', ...(settings.underscore && leftOut.underscore.length ? (['underscore'] as const) : []), ...(settings.noDrums && leftOut.noDrums.length ? (['noDrums'] as const) : [])] : ['full'];
  const versionFile = (v: SongVersion) => (v === 'full' ? `${fileBase}.${ext}` : `${fileBase} (${VERSION_LABELS[v].toLowerCase()}).${ext}`);
  const fileName = game
    ? `${fileBase} ${stemsOnly ? 'layers' : 'game music'}.zip`
    : stemsOnly
      ? `${fileBase} stems.zip`
      : videoOut
        ? `${fileBase}.mp4`
        : versions.length > 1
          ? `${fileBase} versions.zip`
          : `${fileBase}.${ext}`;
  const introFrames = Math.round(barToSeconds(loop.inBar, tempo) * exportRate);
  const tail = ringOutSeconds(masterFx, tracks, bpm);

  // Counted as a render the whole way (encoding too), so the update notice waits for it (renderBusy.ts)
  const startExport = () => countedRender(async () => {
    // The plugins' latest settings first (they reach the tracks every few seconds otherwise)
    await captureWamStates();
    const s = useTimelineStore.getState();
    // The render swaps the global audio context while it sets up, so halt live playback first
    s.pause();
    saveSettings(settings);
    const controller = new AbortController();
    // A Cancel pressed while the file was being encoded or zipped: nothing is downloaded
    const deliver = (blob: Blob, name: string) => {
      controller.signal.throwIfAborted();
      downloadBlob(blob, name);
    };
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
    // What a compressed file was turned down after encoding, to keep its decoded peaks under the
    // ceiling, and its decoded true peak (what the toast tells: the file's own)
    let held: HeldReport = { trimDb: 0, peakDbtp: null };
    const encodeOpts = { bitDepth: settings.bitDepth, cues: exportCues(opts), signal: controller.signal, onHeld: (h: HeldReport) => (held = h) };
    const trimmedDb = () => held.trimDb;
    const trimNote = () => (held.trimDb > 0.05 ? `; turned down ${held.trimDb.toFixed(1)} dB after encoding, so it never passes ${ceilingDbtp} dBTP decoded` : '');
    /** The file's true peak: the decoded one for a compressed file that was measured, else `rendered`'s (dBTP). */
    const filePeak = (rendered: number) => (format !== 'wav' && held.peakDbtp !== null ? held.peakDbtp : rendered - held.trimDb);
    // A Loud master reaches the target itself: the push into its clipper and limiter is found
    // afresh as the render's master section runs (loudMaster.ts), and kept for live playback
    const loudMatch = !!s.master.loud?.on && settings.normalize;
    let loudFound: LoudMatch | undefined;
    const loudOpts = loudMatch ? { loudTargetLufs: targetById(settings.target).lufs, onMasterStats: (m: MasterStats) => (loudFound = m.loud ?? loudFound) } : {};
    // Stored for live playback only from the whole song's full mix (no solo on) at the Loud master's own target
    const keepPush = (fullMix: boolean) => {
      const live = useTimelineStore.getState().master.loud;
      const keep = live
        ? loudToKeep({ wholeSong: range === 'song', fullMix: fullMix && !useTimelineStore.getState().tracks.some((t) => t.isSoloed), exportTargetLufs: targetById(settings.target).lufs, loudTargetLufs: LOUD_TARGETS[live.target].lufs, found: loudFound, currentPush: live.push ?? 0, currentSplit: live.split, ceilingDbtp })
        : null;
      if (keep) useTimelineStore.getState().setMasterLoud(keep);
    };
    const loudNote = () =>
      loudFound
        ? ` (pushed ${loudFound.push.toFixed(1)} dB into the clipper and limiter${loudFound.shortDb > 0 ? `; ${loudFound.shortDb.toFixed(1)} dB short of the target: more would squash the drums` : ''})`
        : '';
    try {
      if (game) {
        const { parts, sampleRate } = await renderIntroLoop(opts, stemsOnly, (progress, detail) => setStatus({ kind: 'rendering', fileName, progress, detail }));
        controller.signal.throwIfAborted();
        // Loudness is the loop's (what the player hears for longest); normalizing moves intro and loop together
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Measuring loudness' });
        let reading = stemsOnly ? null : await measureLoudness(parts[0].loop, sampleRate, controller.signal);
        // The intro's own peak: one gain moves both files, so it must keep the louder of them under the ceiling
        const introPeakDbtp = reading ? 20 * Math.log10(truePeakOf(parts[0].intro)) : -Infinity;
        let peakDbtp = reading ? Math.max(reading.truePeakMax, introPeakDbtp) : -Infinity;
        let note = '';
        if (reading && settings.normalize) {
          // Gain only: a limiter would change the sound across the loop's seam
          const { gainDb, limited } = sharedGainDb(reading, [introPeakDbtp], targetById(settings.target).lufs, ceilingDbtp);
          const g = Math.pow(10, gainDb / 20);
          if (gainDb !== 0) for (const ch of [...parts[0].intro, ...parts[0].loop]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
          reading = { ...reading, integrated: reading.integrated + gainDb, truePeakMax: reading.truePeakMax + gainDb };
          peakDbtp += gainDb;
          note = limited ? ` (held under the target so peaks stay under ${ceilingDbtp} dBTP)` : '';
        }
        const files: Array<{ name: string; data: Blob }> = [];
        // Compressed: every intro and loop turned down together if at all, so an intro still runs into
        // its loop at its level and the layers still add up to the mix
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: `Encoding ${format.toUpperCase()}` });
        const compressed = format === 'wav' ? null : await encodeTogether(parts.flatMap((part) => [part.intro, part.loop]), sampleRate, format, encodeOpts);
        for (const [i, part] of parts.entries()) {
          const name = part.track ? stemFileNames(fileBase, parts.map((p) => p.track!), '')[i].replace(/\.$/, '') : fileBase;
          if (format === 'wav') setStatus({ kind: 'rendering', fileName, progress: 1, detail: `Encoding ${part.track ? part.track.name : 'the music'}` });
          // (Each stem its own dither, so the stems' dither doesn't add up in step when they're mixed)
          const ditherSeed = part.track ? ditherSeedOf(part.track.id) : 0;
          if (format === 'wav') {
            files.push({ name: `${name} intro.${ext}`, data: await encodeAudio(part.intro, sampleRate, format, { bitDepth: settings.bitDepth, ditherSeed }) });
            files.push({ name: `${name} loop.${ext}`, data: await encodeAudio(part.loop, sampleRate, format, { bitDepth: settings.bitDepth, ditherSeed }) });
          } else {
            files.push({ name: `${name} intro.${ext}`, data: compressed![2 * i] }, { name: `${name} loop.${ext}`, data: compressed![2 * i + 1] });
          }
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
        deliver(await createZip(files), fileName);
        showToast(`Exported ${fileName}${reading ? `: the loop is ${formatLufs(reading.integrated - trimmedDb())}, peak ${formatDbtp(filePeak(peakDbtp))}${note}${trimNote()}` : held.peakDbtp !== null ? `: the loudest layer peaks at ${formatDbtp(held.peakDbtp)}${trimNote()}` : ''}`);
      } else if (videoOut) {
        // 48 kHz: what video sound runs at (and Opus, the fallback codec, needs). A ring-out is
        // cut where its tails die away once it has its final level (see keepRingOut)
        const videoOpts = { ...opts, sampleRate: 48000 as const, keepRingOut: settings.normalize, ...loudOpts };
        let audio = await renderArrangement(videoOpts, (progress, stage) =>
          setStatus({ kind: 'rendering', fileName, progress: progress * 0.3, detail: stage === 'matching' ? 'Matching the loudness' : 'Rendering the sound' })
        );
        controller.signal.throwIfAborted();
        let reading = await measureLoudness(channelsOf(audio), audio.sampleRate, controller.signal);
        if (settings.normalize) {
          setStatus({ kind: 'rendering', fileName, progress: 0.3, detail: 'Matching the loudness' });
          if (!loudMatch) reading = (await reachTarget(channelsOf(audio), audio.sampleRate, reading, targetById(settings.target), controller.signal, ceilingDbtp)).reading;
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
          // The video's sound on top can push the peaks past the ceiling: hold them under it, and
          // tell the loudness of what's in the file
          limitInPlace(channels, audio.sampleRate, ceilingDbtp);
          reading = await measureLoudness(channels, audio.sampleRate, controller.signal);
        }
        // Showcase: the notes of the range, timed by the song's tempo map
        const showcase = !footage && settings.picture === 'showcase' ? showcaseData(tracks, clips, opts.startBar, opts.endBar, (bar) => barToSeconds(bar, tempo)) : undefined;
        const blob = await renderVideo({
          footage,
          skin: settings.picture === 'showcase' ? 'bars' : settings.picture,
          shape: settings.shape,
          fps: settings.fps,
          showcase,
          showcaseLook: { layout: settings.showcaseLayout, hits: settings.showcaseHits },
          channels,
          sampleRate: audio.sampleRate,
          title: videoTitle.trim() || projectName,
          subtitle: videoSubtitle.trim() || `${Math.round(opts.bpm * 100) / 100} BPM`,
          marks: settings.marks,
          sections,
          signal: controller.signal,
          ceilingDbtp,
          onHeld: (h) => (held = h),
          onProgress: (p) => setStatus({ kind: 'rendering', fileName, progress: 0.3 + 0.7 * p, detail: 'Drawing the video' }),
        });
        controller.signal.throwIfAborted();
        deliver(blob, fileName);
        if (loudMatch) keepPush(true);
        showToast(`Exported ${fileName}: ${formatLufs(reading.integrated - trimmedDb())}, peak ${formatDbtp(held.peakDbtp ?? reading.truePeakMax - held.trimDb)}${loudMatch ? loudNote() : ''}${trimNote()}`);
      } else if (stemsOnly) {
        const rendered = await renderStems(
          opts,
          settings.bitDepth,
          (progress, stem) => setStatus({ kind: 'rendering', fileName, progress, detail: `Stem ${stem.index + 1} of ${stem.count}: ${stem.track.name}` }),
          // Compressed: one gain for every stem, so they still add up to the mix
          format === 'wav' ? undefined : { together: (stems, sampleRate) => encodeTogether(stems, sampleRate, format, encodeOpts) }
        );
        const names = stemFileNames(fileBase, rendered.map((r) => r.track), ext);
        setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Packing the .zip' });
        const zip = await createZip(rendered.map((r, i) => ({ name: names[i], data: r.wav })));
        controller.signal.throwIfAborted();
        deliver(zip, fileName);
        if (format !== 'wav') showToast(`Exported ${fileName}${held.peakDbtp !== null ? `: the loudest stem peaks at ${formatDbtp(held.peakDbtp)}` : ''}${trimNote()}`);
      } else {
        // Each version (the full mix, and the underscore or no-drums ones asked for) rendered the same way
        const made: Array<{ name: string; data: Blob | null; label: string; reading: Awaited<ReturnType<typeof measureLoudness>>; note: string }> = [];
        // Compressed versions are encoded once every one is rendered, turned down together if at all, so
        // they keep their levels to each other (each parked in a Blob meanwhile, outside the page's memory)
        const toEncode: Array<() => Promise<Float32Array[]>> = [];
        let encodeRate: number = exportRate;
        for (const [vi, version] of versions.entries()) {
          const many = versions.length > 1;
          const label = VERSION_LABELS[version];
          const at = (f: number) => (vi + f) / versions.length;
          const detail = (what: string) => (many ? `${label}${what ? `: ${what}` : ''}` : what);
          // (the render, its loudness and the match to the target: exportMix.ts, as the command line renders too)
          const mixed = await renderMixdown(
            { ...opts, tracks: versionTracks(opts.tracks, opts.clips, version) ?? opts.tracks },
            { normalize: settings.normalize, target: targetById(settings.target), loudMaster: !!s.master.loud?.on, ceilingDbtp },
            (progress, stage) => setStatus({ kind: 'rendering', fileName, progress: at(progress * 0.95), detail: detail(stage === 'matching' ? 'Matching the loudness' : '') }),
            (step) => setStatus({ kind: 'rendering', fileName, progress: at(step === 'measuring' ? 0.95 : 0.97), detail: detail(step === 'measuring' ? 'Measuring loudness' : 'Matching the loudness') })
          );
          const { audio, reading } = mixed;
          loudFound = mixed.loudFound ?? loudFound;
          let note = '';
          if (settings.normalize && loudMatch) {
            note = loudNote();
            keepPush(version === 'full');
          } else if (settings.normalize && mixed.reached) {
            const reached = mixed.reached;
            if (reached.shortDb > 0.3 && reached.capped)
              note = `. That's ${reached.shortDb.toFixed(1)} dB under the target: getting there would take more than ${MAX_LIMITING_DB} dB of limiting, which squashes the music. To get louder, turn on the Loud master (Master tab)`;
            else if (reached.limitedDb > 0.3) note = ` (the limiter took ${reached.limitedDb.toFixed(1)} dB off the peaks to get there)`;
          }
          if (format === 'wav') made.push({ name: versionFile(version), data: encodeWav(audio, settings.bitDepth, exportCues(opts), wholeFileLoop(opts, audio.length)), label, reading, note });
          else {
            const channels = channelsOf(audio);
            encodeRate = audio.sampleRate;
            if (versions.length === 1) toEncode.push(async () => channels);
            else {
              const length = audio.length;
              const parked = new Blob(channels as Float32Array<ArrayBuffer>[]);
              toEncode.push(async () => {
                const samples = new Float32Array(await parked.arrayBuffer());
                return Array.from({ length: channels.length }, (_, c) => samples.subarray(c * length, (c + 1) * length));
              });
            }
            made.push({ name: versionFile(version), data: null, label, reading, note });
          }
        }
        if (format !== 'wav') {
          setStatus({ kind: 'rendering', fileName, progress: 0.99, detail: `Encoding ${format.toUpperCase()}` });
          const files = await encodeTogether(toEncode, encodeRate, format, encodeOpts);
          for (const [i, m] of made.entries()) {
            m.data = files[i];
            // (The decoded peak measured is the loudest version's: one file's own, when there's one)
            m.reading = { ...m.reading, integrated: m.reading.integrated - held.trimDb, truePeakMax: made.length === 1 ? filePeak(m.reading.truePeakMax) : m.reading.truePeakMax - held.trimDb };
            m.note += trimNote();
          }
        }
        if (made.length === 1) {
          const [m] = made;
          deliver(m.data!, fileName);
          showToast(`Exported ${fileName}: ${formatLufs(m.reading.integrated)}, peak ${formatDbtp(m.reading.truePeakMax)}${m.note}`);
        } else {
          setStatus({ kind: 'rendering', fileName, progress: 1, detail: 'Packing the .zip' });
          deliver(await createZip(made.map((m) => ({ name: m.name, data: m.data! }))), fileName);
          showToast(`Exported ${fileName}: ${made.map((m) => `${m.label.toLowerCase()} ${formatLufs(m.reading.integrated)}`).join(', ')}`);
        }
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
      <Modal title="Export audio / video" onClose={onClose}>
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

  const loopRange = formatBarRange(loop.inBar, loop.outBar);
  const rangeDetail = game
    ? `For games: an intro (${formatBarRange(1, loop.inBar)}, ${lengthLabel(1, loop.inBar, tempo)}) to play once, then the loop region (${loopRange}, ${lengthLabel(loop.inBar, loop.outBar, tempo)}) as a seamless loop to repeat. The intro leads straight into the loop.`
    : range === 'song'
      ? `Bar 1 to the end of the last clip: ${formatBarCount(songBars)} bars, ${lengthLabel(1, 1 + songBars, tempo)}.`
      : `${loopRange.charAt(0).toUpperCase()}${loopRange.slice(1)}: ${formatBarCount(loopBars)} bars, ${lengthLabel(loop.inBar, loop.outBar, tempo)}. Starts at ${formatSmpte(loop.inBar, tempo, fps, dropFrame)} (${frameRateLabel(fps, dropFrame)}).`;
  const endingDetail =
    ending === 'ringOut'
      ? `Plays the range once, then lets release, reverb and echo tails ring out: the file ends once they've died away (under -70 dBFS), at most ${formatBarCount(tail)} s after the range.`
      : ending === 'exact'
        ? `Exactly the range, ${frames.toLocaleString()} samples, with a 5 ms fade at the very end so it doesn't click.`
        : `Exactly one loop, ${frames.toLocaleString()} samples. Its start already holds what rings on from the pass before, so it repeats without a gap or click. (Renders ${passes} passes and keeps the last.)`;

  return (
    <Modal title="Export audio / video" onClose={onClose}>
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
            <Segmented<VideoFps>
              label="Frame rate"
              value={settings.fps}
              onChange={(value) => update({ fps: value })}
              options={[
                { value: 60, label: 'Smooth 60 fps', title: 'The notes and playhead move smoothly; the file is bigger and takes longer to make' },
                { value: 30, label: '30 fps', title: 'A smaller file, made faster' },
              ]}
            />
            {refVideo && useFootage ? (
              <p>
                An MP4 video ({VIDEO_SIZES[settings.shape].w}×{VIDEO_SIZES[settings.shape].h}, {settings.fps} fps): your video with the mix as its sound, where it sits on the timeline{settings.shape === 'tall' ? ', fitted into the tall frame' : ''}. It's drawn faster than real time.
              </p>
            ) : (
              <p>
                An MP4 video ({VIDEO_SIZES[settings.shape].w}×{VIDEO_SIZES[settings.shape].h}, {settings.fps} fps) of the mix: the project's name,{' '}
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
            {!(refVideo && useFootage) && (
              <div className="grid gap-1.5" role="group" aria-label="Title and marks">
                <span className="text-forge-text">Title and marks</span>
                {(
                  [
                    ['title', 'Title', videoTitle, setVideoTitle, projectName],
                    ['subtitle', 'Under it', videoSubtitle, setVideoSubtitle, `${Math.round(bpm * 100) / 100} BPM`],
                  ] as const
                ).map(([key, label, text, setText, placeholder]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.marks[key]}
                      onChange={(e) => update({ marks: { ...settings.marks, [key]: e.target.checked } })}
                      className="accent-cyan-400"
                      aria-label={`Show the ${label === 'Title' ? 'title' : 'line under the title'}`}
                    />
                    <span className="w-14 shrink-0">{label}</span>
                    <input
                      type="text"
                      value={text}
                      placeholder={placeholder}
                      disabled={!settings.marks[key]}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={80}
                      className="h-7 min-w-0 flex-1 bg-forge-bg border border-forge-border rounded px-1.5 disabled:opacity-50"
                    />
                  </label>
                ))}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(
                    [
                      ['sections', 'Section names', 'The section the playhead is in, from your markers'],
                      ['time', 'Time', 'The time played and the length'],
                      ['waveform', 'Waveform', "The whole song's waveform with a playhead"],
                    ] as const
                  ).map(([key, label, title]) => (
                    <label key={key} className="flex items-center gap-1.5 cursor-pointer" title={title}>
                      <input type="checkbox" checked={settings.marks[key]} onChange={(e) => update({ marks: { ...settings.marks, [key]: e.target.checked } })} className="accent-cyan-400" />
                      {label}
                    </label>
                  ))}
                </div>
                <span className="text-forge-muted">What you leave out gives its room to the picture. A small fledgetone.com mark stays at the bottom.</span>
              </div>
            )}
            {!(refVideo && useFootage) && settings.picture === 'showcase' && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-forge-text">
                <label className="flex items-center gap-2">
                  Tracks
                  <select
                    value={settings.showcaseLayout}
                    onChange={(e) => update({ showcaseLayout: e.target.value as ShowcaseLayout })}
                    className="h-7 bg-forge-bg border border-forge-border rounded px-1"
                    title="One roll: every track's notes together, like a piano roll. A lane per track: each track in its own band, so a big arrangement stays readable. Auto: lanes from 7 tracks."
                  >
                    <option value="auto">Auto</option>
                    <option value="together">One roll</option>
                    <option value="lanes">A lane per track</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  Hits
                  <select
                    value={settings.showcaseHits}
                    onChange={(e) => update({ showcaseHits: e.target.value as ShowcaseHits })}
                    className="h-7 bg-forge-bg border border-forge-border rounded px-1"
                    title="What a note does as the playhead reaches it, besides lighting up"
                  >
                    <option value="sparkles">Sparkles</option>
                    <option value="rings">Rings</option>
                    <option value="glow">Just the glow</option>
                  </select>
                </label>
              </div>
            )}
            <label className="flex items-start gap-2 cursor-pointer text-forge-text">
              <input type="checkbox" checked={settings.normalize} onChange={(e) => update({ normalize: e.target.checked })} className="mt-0.5 accent-cyan-400" />
              <span>
                Match a loudness target
                <span className="block text-forge-muted">YouTube plays at -14 LUFS: matching it means your video isn't turned down.</span>
              </span>
            </label>
            {settings.normalize && <TargetPicker value={settings.target} onChange={(target) => update({ target })} />}
            {!game && <HeardLevelNote normalize={settings.normalize} target={settings.target} onMatch={() => update({ normalize: true, target: DEFAULT_TARGET })} />}
          </>
        ) : (
          <>
            <p>
              {game ? 'An intro file and a loop file of everything that plays, in one .zip.' : `One stereo ${format.toUpperCase()} of everything that plays.`} When it's done, its loudness and true peak
              show at the bottom of the screen.
            </p>
            {!game && (
              <div className="flex flex-col gap-1.5">
                <label className={`flex items-start gap-2 text-forge-text ${leftOut.underscore.length ? 'cursor-pointer' : 'opacity-50'}`}>
                  <input
                    type="checkbox"
                    checked={settings.underscore && leftOut.underscore.length > 0}
                    disabled={!leftOut.underscore.length}
                    onChange={(e) => update({ underscore: e.target.checked })}
                    className="mt-0.5 accent-cyan-400"
                    data-testid="version-underscore"
                  />
                  <span>
                    Underscore version too
                    <span className="block text-forge-muted">
                      {leftOut.underscore.length
                        ? `Without ${leftOut.underscore.map((t) => t.name).join(', ')}: to sit under someone talking in a video or podcast.`
                        : 'No lead melody found to leave out (name a track "Lead" to choose one).'}
                    </span>
                  </span>
                </label>
                <label className={`flex items-start gap-2 text-forge-text ${leftOut.noDrums.length ? 'cursor-pointer' : 'opacity-50'}`}>
                  <input
                    type="checkbox"
                    checked={settings.noDrums && leftOut.noDrums.length > 0}
                    disabled={!leftOut.noDrums.length}
                    onChange={(e) => update({ noDrums: e.target.checked })}
                    className="mt-0.5 accent-cyan-400"
                    data-testid="version-no-drums"
                  />
                  <span>
                    No-drums version too
                    <span className="block text-forge-muted">
                      {leftOut.noDrums.length ? `Without ${leftOut.noDrums.map((t) => t.name).join(', ')}: for a calmer moment.` : 'This song has no drums to leave out.'}
                    </span>
                  </span>
                </label>
                {versions.length > 1 && <span className="text-forge-muted">The versions come in one .zip, each its own file.</span>}
              </div>
            )}
            <label className="flex items-start gap-2 cursor-pointer text-forge-text">
              <input type="checkbox" checked={settings.normalize} onChange={(e) => update({ normalize: e.target.checked })} className="mt-0.5 accent-cyan-400" />
              <span>
                Match a loudness target
                <span className="block text-forge-muted">
                  {settings.normalize
                    ? `${targetById(settings.target).about} ${game ? 'The intro and loop are turned up or down together (no limiting, which would change the loop\u2019s seam).' : master.loud?.on ? 'The Loud master gets there: it pushes the song into its clipper and limiter, measuring until it\u2019s on target.' : 'If the mix is too quiet to get there by turning it up, a look-ahead limiter holds the peaks down (up to ' + MAX_LIMITING_DB + ' dB). For Loud and Club, turn on the Loud master in the Master tab.'} Peaks never pass ${ceilingDbtp} dBTP.`
                    : 'The file keeps the level of the mix.'}
                </span>
              </span>
            </label>
            {settings.normalize && <TargetPicker value={settings.target} onChange={(target) => update({ target })} />}
            {!game && <HeardLevelNote normalize={settings.normalize} target={settings.target} onMatch={() => update({ normalize: true, target: DEFAULT_TARGET })} />}
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
          {format !== 'wav' &&
            ` MP3 and OGG are compressed: ${what === 'stems' ? 'small files' : 'a small file'} that sound${what === 'stems' ? '' : 's'} the same to most ears. Compressing nudges the peaks up a little, so ${what === 'stems' ? 'the files are played back once they\u2019re made and all turned down together' : 'the file is played back once it\u2019s made and turned down'} by anything over the ceiling (usually nothing or a few tenths of a dB${what === 'stems' ? ', and the stems still add up to the mix' : ''}). An MP3 plays to the exact sample, with no silence added at the start. An OGG does in game engines (Godot, Unity) and most players, but a web browser\u2019s audio decoding leaves about 10 ms of silence on its end: for a seamless loop in a web game, use the MP3 or a WAV.`}
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
          ref={exportButton}
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
