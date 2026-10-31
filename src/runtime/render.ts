/**
 * Fledgetone's renderer for the command line (`fledgetone render`, `fledgetone listen` and the
 * agent helper's render_file and listen with a file): a saved song rendered and measured in a
 * browser page with no studio open, by the app's own export path. Built separately
 * (vite.render.config.ts) into dist-runtime/fledgetone-render.js, which the command line serves to
 * a headless browser on 127.0.0.1 (tools/cli/src/browserRender.ts).
 *
 *   renderSong(projectJson, opts)  the mixdown (or its stems) as Export makes it: renderMixdown
 *                                  (exportMix.ts) or renderStems, then a WAV (16, 24 or 32-bit
 *                                  float) or an MP3 (encoders.ts)
 *   listen(projectJson, opts)      bars rendered as the studio's listen renders them (listen.ts:
 *                                  the run-in, held notes) and measured: a ListenReport
 *   compare(projectJson, opts)     the same bars before and after a suggestion's ops, and the
 *                                  difference bar by bar
 *
 * The files stay in the page until the command line reads them (take, release). No store here
 * (the build refuses timelineStore), as in the game runtime (player.ts). Recorded instruments
 * download their recordings from the app's own site, as the app does, unless the page is served
 * them from a folder; plugins load from fledgetone-plugins/ next to this file.
 */
import { parseProject, safeFileName, type ProjectSnapshot } from '../store/project';
import { importEmbeddedSounds, withLibrarySamples } from '../audio/soundLibrary';
import { DEFAULT_MASTER_FX, defaultMasterSettings, normalizeTrackFx } from '../store/timelineTypes';
import { pluginFamilies } from '../audio/plugins/pluginSources';
import { preloadFamily } from '../audio/plugins/builtinHost';
import { songPlugins } from '../audio/runtimePlugins';
import { audibleTracks, channelsOf, encodeWav, exportCues, lossyRate, renderStems, wholeFileLoop, type BitDepth, type ExportEnding, type RenderOptions, type SampleRate } from '../audio/exportWav';
import { renderMixdown, stemFileNames } from '../audio/exportMix';
import { encodeTogether, type HeldReport } from '../audio/encoders';
import { exportCeilingDbtp } from '../audio/effects/limiter';
import { DEFAULT_TARGET, LOUDNESS_TARGETS, targetById } from '../audio/loudnessTarget';
import { createLoudnessAnalyser, pairedLoudnessDiff } from '../audio/loudness';
import { measureRender, renderRange, renderRangeStems, type RenderMeasure } from '../audio/listen';
import { sharedRunIn } from '../audio/auditionMath';
import { bandEnvelope, bandSpectrum } from '../audio/mixAnalysis';
import { checkMix, duckedToKick, trackRole, type TrackMeasure } from '../audio/mixCheck';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { barToSeconds, FOUR_FOUR, type MeterMap } from '../audio/tempoMap';
import type { MasterStats } from '../audio/effects/masterAfter';
import { listenSnapshot } from '../agent/listenSnapshot';
import { agentIdOf } from '../agent/agentText';
import { applyOps, OPS_VERSION } from '../agent/ops';
import { allFindings, barDifferences, compareListens, listenMix, MIX_ONLY_CHECKS, mixFindings, tenth, type ListenComparison, type ListenReport, type ListenTrack } from '../agent/listenReport';

export type { ListenReport, ListenComparison } from '../agent/listenReport';

/** Told how far a render has got (0 to 1) and what it's doing. */
export type Progress = (fraction: number, what: string) => void;

export interface RenderSongOptions {
  /** Song bars [fromBar, toBar) (default: bar 1 to the end of the last clip, as Export's whole song). */
  fromBar?: number;
  toBar?: number;
  format?: 'wav' | 'mp3';
  /** 44100 (default) or 48000; 88200 and 96000 for WAV only. */
  sampleRate?: SampleRate;
  /** WAV: 16, 24 (default) or 32 (float). */
  bitDepth?: BitDepth;
  /** Default 'ringOut' (Export's default). */
  ending?: ExportEnding;
  /**
   * A loudness target to match (an id of LOUDNESS_TARGETS: streaming, loud, club, game, podcast,
   * broadcast), or false for none. Default as Export: the Loud master's own target when it's on,
   * else none.
   */
  target?: string | false;
  /** One file per track (Export's stems, without the master section unless `stemsThroughMaster`). */
  stems?: boolean;
  stemsThroughMaster?: boolean;
  onProgress?: Progress;
}

export interface RenderedFile {
  /** A file name made from the song's (and the track's) name. */
  name: string;
  /** Where to read it from (take). */
  id: string;
  bytes: number;
  track?: { id: string; name: string };
}

export interface RenderSongResult {
  song: string;
  range: { fromBar: number; toBar: number };
  format: 'wav' | 'mp3';
  sampleRate: number;
  bitDepth: BitDepth | null;
  ending: ExportEnding;
  /** The target matched (null: none, and always for stems, which are never matched). */
  target: { id: string; lufs: number } | null;
  seconds: number;
  /** The file's loudness and true peak (the mixdown; stems: the loudest stem's peak). */
  lufs: number | null;
  truePeakDbtp: number | null;
  files: RenderedFile[];
  notes: string[];
}

/** Files waiting for the command line to read them. */
const kept = new Map<string, Blob>();
let made = 0;
const keep = (blob: Blob) => {
  const id = `f${++made}`;
  kept.set(id, blob);
  return id;
};

/** Bytes [start, end) of a kept file, as base64 (the command line reads a file a few megabytes at a time). */
export async function take(id: string, start: number, end: number): Promise<string> {
  const blob = kept.get(id);
  if (!blob) throw new Error(`no file ${id}`);
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob.slice(start, end));
  });
  return url.slice(url.indexOf(',') + 1);
}

/** Let go of a kept file. */
export function release(id: string): void {
  kept.delete(id);
}

/** The song from its JSON, with its plugins loaded and its sounds in place. */
async function prepare(projectJson: unknown): Promise<ProjectSnapshot> {
  const raw = typeof projectJson === 'string' ? (JSON.parse(projectJson) as unknown) : projectJson;
  const p = parseProject(raw);
  const project: ProjectSnapshot = { ...p, tracks: p.tracks.map((t) => ({ ...t, fx: normalizeTrackFx(t.fx) })) };
  // Plugins from other sites (by their address) aren't run here: refused, rather than rendered silent
  const outside = outsidePlugins(project.tracks);
  if (outside.length) throw new Error(outsidePluginsMessage(outside));
  // The plugins it plays, loaded first: one that can't be would leave its part silent
  const plugins = songPlugins(project.tracks, pluginFamilies());
  if (plugins.missing.length) throw new Error(`This renderer can't play ${plugins.missing.join(', ')}`);
  for (const f of plugins.families) {
    await preloadFamily(f).catch((err: unknown) => {
      throw new Error(`Couldn't load the ${f.label} plugins (fledgetone-plugins/${f.file}): ${err instanceof Error ? err.message : String(err)}`);
    });
  }
  if (project.sounds?.length) await importEmbeddedSounds(project.sounds);
  // A Sampler's sound kept the old way (a data: URL) goes into the library, as opening the file in the app moves it
  return { ...project, tracks: await withLibrarySamples(project.tracks) };
}

/** The plugins the tracks that sound play from other sites (not Fledgetone's built-in ones; a bypassed one plays no part). */
export function outsidePlugins(tracks: ProjectSnapshot['tracks']): Array<{ track: string; plugin: string; url: string }> {
  return audibleTracks(tracks).flatMap((t) =>
    [t.plugin, ...(t.pluginFx ?? [])].filter((x) => !!x && !x.bypass && !x.url.startsWith('builtin:')).map((x) => ({ track: t.name, plugin: x!.name || 'a plugin', url: x!.url }))
  );
}

/** Why a song with such plugins isn't rendered, and what to do instead. */
export function outsidePluginsMessage(list: ReturnType<typeof outsidePlugins>): string {
  const named = list.map((x) => `"${x.track}" plays ${x.plugin} (from ${x.url.slice(0, 120)})`).join('; ');
  return `This song uses plugins from other sites, which rendering on the command line doesn't run (it runs only Fledgetone's own): ${named}. Export it from the studio instead (File › Export audio / video…), where you chose to load them, or take them off those tracks (or mute them) to render the rest.`;
}

/** Where the music ends, as Export's whole song: the end of the last clip of a track that sounds (bar 1: nothing). */
function songEnd(p: ProjectSnapshot): number {
  const ids = new Set(audibleTracks(p.tracks).map((t) => t.id));
  return Math.max(1, ...p.clips.filter((c) => ids.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
}

const tempoOf = (p: Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>) => ({ bpm: p.bpm, points: p.tempoPoints ?? [] });
/** The song's meter: its groove feels count from its measures (there's no store here to keep the studio's). */
const meterOf = (p: Pick<ProjectSnapshot, 'meter' | 'meterPoints'>): MeterMap => ({ base: p.meter ?? FOUR_FOUR, points: p.meterPoints ?? [] });

/** Render a song (its JSON as saved) as Export makes it, keeping the files for take. */
export async function renderSong(projectJson: unknown, opts: RenderSongOptions = {}): Promise<RenderSongResult> {
  const progress = opts.onProgress ?? (() => {});
  progress(0, 'Loading the song');
  const p = await prepare(projectJson);
  const end = songEnd(p);
  const fromBar = opts.fromBar ?? 1;
  const toBar = opts.toBar ?? end;
  if (!(toBar > fromBar)) throw new Error(end <= 1 ? 'The song has no clips on a track that sounds: there is nothing to render.' : `Bars ${fromBar} to ${toBar}: the range ends before it starts.`);
  const format = opts.format ?? 'wav';
  const sampleRate = format === 'wav' ? (opts.sampleRate ?? 44100) : lossyRate(opts.sampleRate ?? 44100);
  const bitDepth: BitDepth = opts.bitDepth ?? 24;
  const ending: ExportEnding = opts.ending ?? 'ringOut';
  const master = p.master ?? defaultMasterSettings();
  const loudOn = !!master.loud?.on;
  const targetId = opts.target === undefined ? (loudOn ? master.loud!.target : null) : opts.target || null;
  if (targetId && !LOUDNESS_TARGETS.some((t) => t.id === targetId)) throw new Error(`There's no loudness target "${targetId}": ${LOUDNESS_TARGETS.map((t) => t.id).join(', ')}`);
  const target = targetById(targetId ?? DEFAULT_TARGET);
  const ceilingDbtp = exportCeilingDbtp(format);
  const render: RenderOptions = {
    tracks: p.tracks,
    clips: p.clips,
    bpm: p.bpm,
    tempoPoints: p.tempoPoints,
    meter: meterOf(p),
    swing: p.swing,
    startBar: fromBar,
    endBar: toBar,
    masterFx: p.masterFx ?? DEFAULT_MASTER_FX,
    master,
    ending,
    sampleRate,
    markers: p.markers ?? [],
    peakCeilingDbtp: ceilingDbtp,
  };
  const base = safeFileName(p.name);
  const notes: string[] = [];
  let held: HeldReport = { trimDb: 0, peakDbtp: null };
  const encodeOpts = { ceilingDbtp, onHeld: (h: HeldReport) => (held = h) };
  const trimNote = () => {
    if (held.trimDb > 0.05) notes.push(`Turned down ${held.trimDb.toFixed(1)} dB after encoding, so it never passes ${ceilingDbtp} dBTP decoded.`);
  };
  const result = (files: RenderedFile[], seconds: number, lufs: number | null, truePeakDbtp: number | null, matched = true): RenderSongResult => ({
    song: p.name,
    range: { fromBar, toBar },
    format,
    sampleRate,
    bitDepth: format === 'wav' ? bitDepth : null,
    ending,
    target: matched && targetId ? { id: target.id, lufs: target.lufs } : null,
    seconds: Math.round(seconds * 1000) / 1000,
    lufs: tenth(lufs),
    truePeakDbtp: tenth(truePeakDbtp),
    files,
    notes,
  });

  if (opts.stems) {
    // Stems stay at full level (no Intensity), for mixing elsewhere
    const rendered = await renderStems(
      { ...render, bypassMaster: !opts.stemsThroughMaster },
      bitDepth,
      (f, stem) => progress(f * 0.95, `Stem ${stem.index + 1} of ${stem.count}: ${stem.track.name}`),
      // Compressed: one gain for every stem, so they still add up to the mix
      format === 'wav' ? undefined : { together: (stems, rate) => encodeTogether(stems, rate, format, encodeOpts) }
    );
    const names = stemFileNames(base, rendered.map((r) => r.track), format);
    trimNote();
    // (stems are never matched to a loudness target, as Export's aren't: they add up to the mix as it plays)
    if (opts.target) notes.push(`Stems aren't matched to a loudness target (${target.id} applies to the mixdown only): they're at the mix's own level.`);
    // (the frames rendered, the ring-out included: an MP3's own length is a few frames of padding more)
    const seconds = rendered[0].frames / sampleRate;
    progress(1, 'Done');
    return result(
      rendered.map((r, i) => ({ name: names[i], id: keep(r.wav), bytes: r.wav.size, track: { id: r.track.id, name: r.track.name } })),
      seconds,
      null,
      held.peakDbtp,
      false
    );
  }

  const mixed = await renderMixdown(
    { ...render, intensity: { value: p.intensity?.value ?? 1, curves: p.intensity?.curves ?? {} } },
    { normalize: !!targetId, target, loudMaster: loudOn, ceilingDbtp },
    (f, stage) => progress(f * 0.9, stage === 'matching' ? 'Matching the loudness' : 'Rendering'),
    (step) => progress(0.92, step === 'measuring' ? 'Measuring loudness' : 'Matching the loudness')
  );
  const { audio, reading } = mixed;
  if (mixed.loudFound) notes.push(`The Loud master pushed ${mixed.loudFound.push.toFixed(1)} dB into its clipper and limiter${mixed.loudFound.shortDb > 0 ? `, ${mixed.loudFound.shortDb.toFixed(1)} dB short of the target: more would squash the drums` : ''}.`);
  if (mixed.reached?.capped && mixed.reached.shortDb > 0.3) notes.push(`It is ${mixed.reached.shortDb.toFixed(1)} dB under the target: getting there would take more limiting than squashes the music. The Loud master gets louder.`);
  else if (mixed.reached && mixed.reached.limitedDb > 0.3) notes.push(`The limiter took ${mixed.reached.limitedDb.toFixed(1)} dB off the peaks to reach the target.`);
  progress(0.95, `Encoding ${format.toUpperCase()}`);
  let blob: Blob;
  if (format === 'wav') blob = encodeWav(audio, bitDepth, exportCues(render), wholeFileLoop(render, audio.length));
  else {
    [blob] = await encodeTogether([channelsOf(audio)], audio.sampleRate, format, encodeOpts);
    trimNote();
  }
  progress(1, 'Done');
  const peak = format !== 'wav' && held.peakDbtp !== null ? held.peakDbtp : reading.truePeakMax - held.trimDb;
  return result([{ name: `${base}.${format}`, id: keep(blob), bytes: blob.size }], audio.length / audio.sampleRate, reading.integrated - held.trimDb, peak);
}

export interface ListenOptions {
  fromBar: number;
  toBar: number;
  /** Each track's loudness, peak and balance too (and the Mix check's findings that name tracks). */
  perTrack?: boolean;
  /** A suggestion's ops: listen to the song as they would make it. */
  ops?: unknown[];
  /** The id base the ops are applied with (a suggestion file's: see suggestionIdBase). */
  idBase?: string;
  onProgress?: Progress;
}

/** What a song's listen rendered: the report and the mix's samples. */
interface Heard {
  report: ListenReport;
  channels: Float32Array[];
  sampleRate: number;
  /** The mix's gating blocks (RenderMeasure.blocks), for the before-and-after's loudness change; each track's too (by its id as the agent reads it). */
  blocks: number[];
  trackBlocks: Map<string, number[]>;
}

/** The song with `ops` applied, or a plain error. */
function withOps(p: ProjectSnapshot, ops: unknown[], idBase = 'listen'): ProjectSnapshot {
  const out = applyOps(p, { opsVersion: OPS_VERSION, ops }, { idBase });
  if (!out.ok) throw new Error(`The ops can't be applied: ${out.errors.map((e) => `op ${e.op}${e.path ? ` (${e.path})` : ''}: ${e.message}`).join('; ')}`);
  return { ...out.song, sounds: p.sounds };
}

/** The bars of [from, to) as [bar, start, end) in seconds from `from`, cut at whole bars. */
function barSpans(p: ProjectSnapshot, from: number, to: number): Array<{ bar: number; start: number; end: number }> {
  const tempo = tempoOf(p);
  const t0 = barToSeconds(from, tempo);
  const spans: Array<{ bar: number; start: number; end: number }> = [];
  for (let bar = from; bar < to; bar = Math.floor(bar) + 1) {
    const next = Math.min(to, Math.floor(bar) + 1);
    spans.push({ bar, start: barToSeconds(bar, tempo) - t0, end: barToSeconds(next, tempo) - t0 });
  }
  return spans;
}

/** Integrated loudness of frames [a, b) of `channels` (LUFS, -Infinity for silence or under 0.4 s). */
function loudnessOf(channels: Float32Array[], sampleRate: number, a: number, b: number): number {
  const analyser = createLoudnessAnalyser(sampleRate);
  const left = channels[0].subarray(a, b);
  analyser.feed(left, (channels[1] ?? channels[0]).subarray(a, b), left.length);
  return analyser.read().integrated;
}

/** `start`: the run-in to render from (one shared by a before-and-after's two versions: see compare), else its own. */
async function hear(p: ProjectSnapshot, opts: ListenOptions, heard: string, progress: Progress, share: [number, number], start?: number): Promise<Heard> {
  const { fromBar, toBar } = opts;
  const at = (f: number) => share[0] + f * (share[1] - share[0]);
  const song = listenSnapshot(p);
  let stats: MasterStats | undefined;
  const audio = await renderRange(song, fromBar, toBar, { start, onMasterStats: (s) => (stats = s), progress: (f) => progress(at(f * (opts.perTrack ? 0.4 : 0.9)), `Rendering ${heard}`) });
  const m: RenderMeasure = await measureRender(audio);
  const channels = channelsOf(audio);
  const rate = audio.sampleRate;
  const bars = barSpans(p, fromBar, toBar).map((s) => ({ bar: s.bar, lufs: tenth(loudnessOf(channels, rate, Math.round(s.start * rate), Math.min(channels[0].length, Math.round(s.end * rate)))) }));
  const spectrum = bandSpectrum(channels.slice(0, 2), rate);
  const mixMeasure = { lufs: m.lufs, truePeakDb: m.truePeakDbtp, spectrum, stats };
  let tracks: ListenTrack[] | undefined;
  const trackBlocks = new Map<string, number[]>();
  const measures: TrackMeasure[] = [];
  // Track ids as the agent reads them everywhere else (hidden ones as their aliases)
  const idOf = agentIdOf(song.tracks);
  if (opts.perTrack) {
    tracks = [];
    await renderRangeStems(
      song,
      fromBar,
      toBar,
      async (track, ch, sampleRate) => {
        const t = await measureRender(bufferOf(ch, sampleRate));
        trackBlocks.set(idOf(track.id), t.blocks);
        tracks!.push({ id: idOf(track.id), name: track.name, lufs: tenth(t.lufs), truePeakDbtp: tenth(t.truePeakDbtp), crestDb: tenth(t.crestDb), regions: t.regions });
        measures.push({
          id: track.id,
          name: track.name,
          role: trackRole(track, song.clips),
          spectrum: bandSpectrum(ch, sampleRate),
          lowEnv: bandEnvelope(ch, sampleRate, 40, 140),
          env: bandEnvelope(ch, sampleRate, 0, sampleRate / 2),
          ducked: duckedToKick(track, song.tracks),
          category: INSTRUMENTS[track.instrumentKey]?.category,
        });
      },
      { start, progress: (f, track) => progress(at(0.4 + f * 0.55), `Rendering ${track.name} alone`) }
    );
  }
  const streaming = targetById(DEFAULT_TARGET);
  const checks = checkMix(mixMeasure, measures, { lufs: streaming.lufs, name: `the streaming target (${streaming.lufs} LUFS)` })
    .filter((f) => opts.perTrack || MIX_ONLY_CHECKS.includes(f.id))
    .map((f) => ({ id: f.id, level: f.level, title: f.title, detail: f.detail, trackIds: f.trackIds?.map(idOf) }));
  const report: ListenReport = {
    range: { fromBar, toBar },
    seconds: Math.round((channels[0].length / rate) * 1000) / 1000,
    heard,
    renderMode: 'playback',
    mix: listenMix(m, stats),
    bars,
    ...(tracks ? { tracks } : {}),
    checks,
    findings: allFindings(mixFindings(m, stats), checks),
  };
  return { report, channels, sampleRate: rate, blocks: m.blocks, trackBlocks };
}

/** Channels in an AudioBuffer (for measureRender). */
function bufferOf(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: channels.length, length: Math.max(1, channels[0].length), sampleRate });
  channels.forEach((c, i) => out.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return out;
}

/** Listen to bars [fromBar, toBar) of a song (with a suggestion's ops, if given), as the studio's listen does. */
export async function listen(projectJson: unknown, opts: ListenOptions): Promise<ListenReport> {
  const progress = opts.onProgress ?? (() => {});
  progress(0, 'Loading the song');
  let p = await prepare(projectJson);
  if (opts.ops) p = withOps(p, opts.ops, opts.idBase);
  return (await hear(p, opts, opts.ops ? 'the song with those ops' : 'the song as it is', progress, [0, 1])).report;
}

/** The same bars before and after a suggestion's ops, and the difference between them bar by bar. */
export async function compare(projectJson: unknown, opts: ListenOptions & { ops: unknown[] }): Promise<ListenComparison> {
  const progress = opts.onProgress ?? (() => {});
  progress(0, 'Loading the song');
  const before = await prepare(projectJson);
  const after = withOps(before, opts.ops, opts.idBase);
  // Both from one run-in, so they line up sample for sample and only what changed differs (see sharedRunIn)
  const start = sharedRunIn([listenSnapshot(before), listenSnapshot(after)], opts.fromBar);
  const a = await hear(before, opts, 'the song as it is', progress, [0, 0.5], start);
  const b = await hear(after, opts, 'the song with the suggestion', progress, [0.5, 1], start);
  // (bar by bar, each where it lies in each render: one the tempo moved can't be lined up, and counts as changed)
  const diffs = barDifferences(a.channels, b.channels, a.sampleRate, barSpans(before, opts.fromBar, opts.toBar), barSpans(after, opts.fromBar, opts.toBar));
  progress(1, 'Done');
  // (the mix's loudness change over the same moments of both: pairedLoudnessDiff)
  const trackPaired = new Map([...b.trackBlocks].flatMap(([id, after]) => {
    const before = a.trackBlocks.get(id);
    return before ? [[id, pairedLoudnessDiff(before, after)] as const] : [];
  }));
  return compareListens(a.report, b.report, diffs, pairedLoudnessDiff(a.blocks, b.blocks), trackPaired);
}
