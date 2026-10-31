/**
 * `fledgetone render` and `fledgetone listen`: a song file rendered to WAV or MP3 (or its stems),
 * or bars of it rendered and measured (a listen report, or a before-and-after with a suggestion),
 * in a headless browser by the app's own export path (browserRender.ts, src/runtime/render.ts).
 * The agent helper's render_file and listen with a file use the same functions (renderSongFile,
 * listenSongFile). Arguments are checked before any browser starts (renderPlan, listenPlan).
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { ProjectSnapshot } from '../../../src/store/project';
import { audibleIds } from '../../../src/store/buses';
import { barToSeconds } from '../../../src/audio/tempoMap';
import { classifySuggestion, parseSuggestionFile } from '../../../src/agent/suggestion';
import { applyOps, checkOpsShape, OPS_VERSION } from '../../../src/agent/ops';
import type { ListenComparison, ListenReport } from '../../../src/agent/listenReport';
import { readJson, readSong, sameFile, writeFileSafe } from './files';
import { withRenderer, type BrowserOptions } from './browserRender';
import { printErr, printOut, safeText } from './print';
import { barRange, loudnessText, suggestionIdBase, UsageError, type Flags } from './commands';
import { maxOf } from '../../../src/support/minMax';

const say = printOut;
const r1 = (v: number | null) => (v === null ? '-' : (Math.round(v * 10) / 10).toFixed(1));
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
/** Song bars [from, to) as a person counts them: "bars 9 to 16" (the end included), or with the end said where it isn't a whole bar. */
export const barsText = (from: number, to: number) =>
  Number.isInteger(from) && Number.isInteger(to) ? (to - from === 1 ? `Bar ${from}` : `Bars ${from} to ${to - 1}`) : `Bars ${from} to ${to} (${to} not included)`;
const signed = (v: number | null) => (v === null ? '-' : `${v > 0 ? '+' : ''}${r1(v)}`);

/** The rates and bit depths offered (as Export: 88.2 and 96 kHz for WAV only). */
export const RATES = [44100, 48000, 88200, 96000] as const;
export const BITS = { '16': 16, '24': 24, '32': 32, '32f': 32 } as const;

/** What a render file holds, by its extension. */
export function audioFormatOf(path: string): 'wav' | 'mp3' | null {
  const ext = extname(path).toLowerCase();
  return ext === '.wav' ? 'wav' : ext === '.mp3' ? 'mp3' : null;
}

/** Where the music ends: the end of the last clip on a track that sounds (bar 1: nothing). */
export function songEndBar(song: Pick<ProjectSnapshot, 'tracks' | 'clips'>): number {
  const ids = audibleIds(song.tracks);
  return maxOf(1, song.clips.filter((c) => ids.has(c.trackId)).map((c) => c.startBar + c.lengthBars));
}

/** Seconds from bar `from` to bar `to` of a song. */
export const secondsBetween = (song: Pick<ProjectSnapshot, 'bpm' | 'tempoPoints'>, from: number, to: number) => {
  const tempo = { bpm: song.bpm, points: song.tempoPoints ?? [] };
  return barToSeconds(to, tempo) - barToSeconds(from, tempo);
};

export interface RenderPlan {
  song: string;
  /** The mixdown's file and format (none: stems only). */
  out?: { path: string; format: 'wav' | 'mp3' };
  /** The stems' folder and format. */
  stems?: { dir: string; format: 'wav' | 'mp3' };
  fromBar?: number;
  toBar?: number;
  sampleRate: (typeof RATES)[number];
  bitDepth: 16 | 24 | 32;
  /** A loudness target, false for none, undefined for the song's own (as Export). */
  target?: string | false;
  overwrite: boolean;
}

/** `render`'s arguments, checked (nothing is rendered or written here). */
export function renderPlan(args: string[], flags: Flags): RenderPlan {
  const song = args[0];
  if (!song) throw new UsageError('missing the song file');
  const out = typeof flags.o === 'string' ? flags.o : undefined;
  const stemsDir = typeof flags.stems === 'string' ? flags.stems : undefined;
  if (!out && !stemsDir) throw new UsageError('missing the file to write (-o song.wav or song.mp3), or --stems <folder>');
  if (args.length > 1) throw new UsageError(`render takes one song (got ${args.length})`);
  let format: 'wav' | 'mp3' | undefined;
  if (typeof flags.format === 'string') {
    if (flags.format !== 'wav' && flags.format !== 'mp3') throw new UsageError('--format takes wav or mp3');
    format = flags.format;
  }
  let outPlan: RenderPlan['out'];
  if (out) {
    const f = audioFormatOf(out);
    if (!f) throw new UsageError(`-o ${out}: give a .wav or .mp3 file`);
    if (format && format !== f) throw new UsageError(`-o ${out} is ${f.toUpperCase()}, but --format says ${format}`);
    if (sameFile(out, song)) throw new UsageError(`-o ${out} is the song itself`);
    if (existsSync(out) && !flags.overwrite) throw new UsageError(`${out} already exists: give another file, or --overwrite`);
    outPlan = { path: out, format: f };
  }
  const rate = flags.rate === undefined ? 44100 : Number(flags.rate);
  if (!(RATES as readonly number[]).includes(rate)) throw new UsageError(`--rate takes ${RATES.join(', ')}`);
  const fmt = outPlan?.format ?? format ?? 'wav';
  if (rate > 48000 && (fmt === 'mp3' || (format ?? 'wav') === 'mp3')) throw new UsageError('MP3 stops at 48000 Hz: --rate 88200 and 96000 are for WAV');
  const bitsText = flags.bits === undefined ? '24' : String(flags.bits);
  if (!Object.hasOwn(BITS, bitsText)) throw new UsageError('--bits takes 16, 24 or 32f (32-bit float)');
  if (flags.bits !== undefined && fmt === 'mp3' && !stemsDir) throw new UsageError('--bits is for WAV files');
  let stems: RenderPlan['stems'];
  if (stemsDir) {
    if (existsSync(stemsDir) && !statSync(stemsDir).isDirectory()) throw new UsageError(`--stems ${stemsDir} isn't a folder`);
    stems = { dir: stemsDir, format: format ?? outPlan?.format ?? 'wav' };
  }
  let target: RenderPlan['target'];
  if (typeof flags.target === 'string') target = flags.target === 'none' || flags.target === 'off' ? false : flags.target;
  const range = typeof flags.bars === 'string' ? barRange(flags.bars) : {};
  return { song, ...(outPlan ? { out: outPlan } : {}), ...(stems ? { stems } : {}), ...range, sampleRate: rate as RenderPlan['sampleRate'], bitDepth: BITS[bitsText as keyof typeof BITS], ...(target !== undefined ? { target } : {}), overwrite: flags.overwrite === true };
}

/** The browser options from the command's flags. */
export function browserOptions(flags: Flags, progressLabel = 'Rendering'): BrowserOptions {
  const timeout = flags.timeout === undefined ? undefined : Number(flags.timeout);
  if (timeout !== undefined && !(timeout > 0)) throw new UsageError('--timeout takes seconds');
  const tty = process.stderr.isTTY && !flags.quiet;
  let last = '';
  return {
    ...(typeof flags.browser === 'string' ? { browser: flags.browser } : {}),
    ...(typeof flags.samples === 'string' ? { samples: flags.samples } : {}),
    ...(typeof flags['app-url'] === 'string' ? { appUrl: flags['app-url'] } : {}),
    offline: flags.offline === true,
    ...(timeout ? { timeoutMs: timeout * 1000 } : {}),
    onProgress: tty
      ? (f, what) => {
          // (the escape that clears the line is the command's own; the stage, which can name a track, is made safe)
          const line = safeText(`${progressLabel}: ${what} ${Math.round(f * 100)}%`).replace(/\s+/g, ' ');
          if (line !== last) process.stderr.write(`\r\x1b[K${line}`);
          last = line;
          if (f >= 1) process.stderr.write('\r\x1b[K');
        }
      : undefined,
    onLog: flags.verbose ? (line) => printErr(line) : undefined,
  };
}

/** What the page's renderSong gives back (see src/runtime/render.ts). */
export interface RenderResult {
  song: string;
  range: { fromBar: number; toBar: number };
  format: 'wav' | 'mp3';
  sampleRate: number;
  bitDepth: number | null;
  ending: string;
  target: { id: string; lufs: number } | null;
  seconds: number;
  lufs: number | null;
  truePeakDbtp: number | null;
  files: Array<{ name: string; id: string; bytes: number; track?: { id: string; name: string } }>;
  notes: string[];
}

/**
 * Render a song file: its mixdown to `out` and/or its stems into a folder (writes checked first:
 * plain files only, nothing overwritten unless `overwrite`). Returns what was rendered, with the
 * files written in place of the page's ids.
 */
export async function renderSongFile(plan: RenderPlan, browser: BrowserOptions): Promise<{ mix?: RenderResult; stems?: RenderResult; written: string[] }> {
  const song = readSong(plan.song);
  const raw = readJson(plan.song);
  const end = songEndBar(song);
  if (end <= 1) throw new UsageError(`${basename(plan.song)} has no clips on a track that sounds: there's nothing to render`);
  if (plan.stems) mkdirSync(plan.stems.dir, { recursive: true });
  const range = plan.fromBar !== undefined ? { fromBar: plan.fromBar, toBar: plan.toBar } : {};
  const common = { ...range, sampleRate: plan.sampleRate, bitDepth: plan.bitDepth, ...(plan.target !== undefined ? { target: plan.target } : {}) };
  const written: string[] = [];
  return withRenderer(browser, async (session) => {
    const out: { mix?: RenderResult; stems?: RenderResult; written: string[] } = { written };
    if (plan.out) {
      const res = await session.call<RenderResult>('renderSong', raw, { ...common, format: plan.out.format });
      if (existsSync(plan.out.path) && !plan.overwrite) throw new UsageError(`${plan.out.path} already exists: give another file, or --overwrite`);
      writeFileSafe(plan.out.path, await session.take(res.files[0].id, res.files[0].bytes));
      written.push(plan.out.path);
      out.mix = { ...res, files: [{ ...res.files[0], name: plan.out.path }] };
    }
    if (plan.stems) {
      const res = await session.call<RenderResult>('renderSong', raw, { ...common, format: plan.stems.format, stems: true });
      const paths = res.files.map((f) => join(plan.stems!.dir, f.name));
      const there = paths.filter((p) => existsSync(p));
      if (there.length && !plan.overwrite) throw new UsageError(`${there.map((p) => basename(p)).join(', ')} already ${there.length === 1 ? 'exists' : 'exist'} in ${plan.stems.dir}: give another folder, or --overwrite`);
      const files = [];
      for (const [i, f] of res.files.entries()) {
        writeFileSafe(paths[i], await session.take(f.id, f.bytes));
        written.push(paths[i]);
        files.push({ ...f, name: paths[i] });
      }
      out.stems = { ...res, files };
    }
    return out;
  });
}

function renderText(r: RenderResult): string[] {
  const what = r.format === 'wav' ? `${r.sampleRate / 1000} kHz ${r.bitDepth === 32 ? '32-bit float' : `${r.bitDepth}-bit`} WAV` : `${r.sampleRate / 1000} kHz MP3 (320 kb/s)`;
  const lines = r.files.map((f) => `Wrote ${f.name}${f.track ? ` (${f.track.name})` : ''}`);
  lines.push(
    `${barsText(r.range.fromBar, r.range.toBar)}: ${clock(r.seconds)}, ${what}${r.lufs !== null ? `, ${r1(r.lufs)} LUFS` : ''}${r.truePeakDbtp !== null ? `, peak ${r1(r.truePeakDbtp)} dBTP` : ''}${r.target ? `, matched to ${r.target.lufs} LUFS (${r.target.id})` : ''}.`
  );
  return [...lines, ...r.notes];
}

export async function render(args: string[], flags: Flags): Promise<number> {
  const plan = renderPlan(args, flags);
  const result = await renderSongFile(plan, browserOptions(flags));
  if (flags.json) say(JSON.stringify({ ...(result.mix ? { mix: result.mix } : {}), ...(result.stems ? { stems: result.stems } : {}), written: result.written }, null, 2));
  else {
    if (result.mix) say(renderText(result.mix).join('\n'));
    if (result.stems) say(renderText(result.stems).join('\n'));
  }
  return 0;
}

export interface ListenPlan {
  song: string;
  fromBar?: number;
  toBar?: number;
  perTrack: boolean;
  /** A suggestion (or plain ops) to hear the song with, before and after. */
  suggestion?: string;
  ops?: string;
  force: boolean;
}

export function listenPlan(args: string[], flags: Flags): ListenPlan {
  const song = args[0];
  if (!song) throw new UsageError('missing the song file');
  if (args.length > 1) throw new UsageError(`listen takes one song (got ${args.length}); a suggestion goes with --suggestion`);
  if (typeof flags.suggestion === 'string' && typeof flags.ops === 'string') throw new UsageError('give --suggestion or --ops, not both');
  const range = typeof flags.bars === 'string' ? barRange(flags.bars) : {};
  return {
    song,
    ...range,
    perTrack: flags['per-track'] === true,
    ...(typeof flags.suggestion === 'string' ? { suggestion: flags.suggestion } : {}),
    ...(typeof flags.ops === 'string' ? { ops: flags.ops } : {}),
    force: flags.force === true,
  };
}

/** The ops to listen with, from a suggestion file (refused if it's out of date or for another song, unless `force`) or an ops file. */
export function opsToHear(song: ProjectSnapshot, plan: { suggestion?: string; ops?: string; force?: boolean }, read: (path: string) => unknown = readJson): { ops: unknown[]; idBase: string; title?: string } | null {
  if (plan.suggestion) {
    let s;
    try {
      s = parseSuggestionFile(read(plan.suggestion));
    } catch (err) {
      throw new UsageError(`${plan.suggestion}: ${(err as Error).message}`);
    }
    if (!plan.force) {
      if (s.songId && song.songId && s.songId !== song.songId) throw new UsageError(`${basename(plan.suggestion)} was made for another song (--force hears it anyway)`);
      const fresh = classifySuggestion({ touchedHashes: s.touchedHashes, touchedNames: s.touchedNames }, { song });
      if (fresh.status === 'out_of_date') throw new UsageError(`the song changed since ${basename(plan.suggestion)} was made (${fresh.changed.join('; ')}); --force hears it anyway`);
    }
    return { ops: s.ops, idBase: suggestionIdBase(s.ops), title: s.title };
  }
  if (plan.ops) {
    const raw = read(plan.ops) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { ops?: unknown } | null)?.ops;
    const shape = checkOpsShape({ opsVersion: OPS_VERSION, ops: list });
    if (shape.length) throw new UsageError(`${plan.ops}: the ops can't be read: ${shape.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
    return { ops: list as unknown[], idBase: suggestionIdBase(list) };
  }
  return null;
}

/** Bars [fromBar, toBar) of a song file (whole song if not given): a listen report, or with ops a before-and-after. */
export async function listenSongFile(
  path: string,
  opts: { fromBar?: number; toBar?: number; perTrack?: boolean; with?: { ops: unknown[]; idBase: string } | null; limits?: { maxBars: number; maxSeconds: number } },
  browser: BrowserOptions
): Promise<ListenReport | ListenComparison> {
  const song = readSong(path);
  const raw = readJson(path);
  const end = songEndBar(song);
  const fromBar = opts.fromBar ?? 1;
  const toBar = opts.toBar ?? Math.max(fromBar + 1, end);
  if (!(toBar > fromBar)) throw new UsageError('the bars end before they start');
  let after: ProjectSnapshot | null = null;
  if (opts.with) {
    const applied = applyOps(song, { opsVersion: OPS_VERSION, ops: opts.with.ops as never }, { idBase: opts.with.idBase });
    if (!applied.ok) throw new UsageError(`the ops can't be applied: ${applied.errors.map((e) => `op ${e.op}${e.path ? ` (${e.path})` : ''}: ${e.message}`).join('; ')}`);
    after = applied.song;
  }
  if (opts.limits) {
    if (toBar - fromBar > opts.limits.maxBars) throw new UsageError(`At most ${opts.limits.maxBars} bars at a time.`);
    const seconds = Math.max(secondsBetween(song, fromBar, toBar), after ? secondsBetween(after, fromBar, toBar) : 0);
    if (seconds > opts.limits.maxSeconds) throw new UsageError(`At most ${opts.limits.maxSeconds} seconds at a time (bars ${fromBar} to ${toBar} are ${Math.round(seconds)}).`);
  }
  const listenOpts = { fromBar, toBar, perTrack: opts.perTrack === true, ...(opts.with ? { ops: opts.with.ops, idBase: opts.with.idBase } : {}) };
  return withRenderer<ListenReport | ListenComparison>(browser, (session) => (opts.with ? session.call<ListenComparison>('compare', raw, listenOpts) : session.call<ListenReport>('listen', raw, listenOpts)));
}

function reportText(r: ListenReport, label = ''): string[] {
  const m = r.mix;
  const lines = [
    `${label}${barsText(r.range.fromBar, r.range.toBar)}, ${r.heard}: ${clock(r.seconds)}`,
    `  ${loudnessText(m.lufs, m.shortTermMaxLufs, r.seconds)}, true peak ${r1(m.truePeakDbtp)} dBTP, crest ${r1(m.crestDb)} dB`,
    `  Master: the limiter takes up to ${r1(m.master.limiterMaxGrDb)} dB off${m.master.clipperMaxDb !== null ? `, the clipper up to ${r1(m.master.clipperMaxDb)} dB` : ''}`,
  ];
  if (m.regions.length) lines.push(`  Balance: ${m.regions.map((x) => `${x.name} ${signed(x.db)}`).join(', ')}`);
  lines.push(`  Bar by bar (LUFS): ${r.bars.map((b) => `${b.bar}: ${r1(b.lufs)}`).join(', ')}`);
  for (const t of r.tracks ?? []) lines.push(`  "${t.name}": ${r1(t.lufs)} LUFS, peak ${r1(t.truePeakDbtp)} dBTP${t.regions.length ? `; ${t.regions.map((x) => `${x.name} ${signed(x.db)}`).join(', ')}` : ''}`);
  return lines;
}

export async function listen(args: string[], flags: Flags): Promise<number> {
  const plan = listenPlan(args, flags);
  const song = readSong(plan.song);
  const hearWith = opsToHear(song, plan);
  const result = await listenSongFile(plan.song, { fromBar: plan.fromBar, toBar: plan.toBar, perTrack: plan.perTrack, with: hearWith }, browserOptions(flags, 'Listening'));
  if (flags.json) {
    say(JSON.stringify(result, null, 2));
    return 0;
  }
  if ('difference' in result) {
    const d = result.difference;
    say(
      [
        `Before and after${hearWith?.title ? ` "${hearWith.title}"` : ''}:`,
        ...d.summary.map((x) => `  ${x}`),
        `  Bar by bar (LU after against before; * sounds different): ${d.bars.map((b) => `${b.bar}${b.changed ? '*' : ''} ${signed(b.lufsChange)}`).join(', ')}`,
        '',
        ...reportText(result.before, 'Before. '),
        '',
        ...reportText(result.after, 'After. '),
        ...(result.after.findings.length ? ['', 'Findings (after):', ...result.after.findings.map((f) => `  - ${f}`)] : []),
      ].join('\n')
    );
    return 0;
  }
  say([...reportText(result), ...(result.findings.length ? ['', 'Findings:', ...result.findings.map((f) => `  - ${f}`)] : ['', 'Nothing to flag.'])].join('\n'));
  return 0;
}

