/**
 * The hearing pieces `measure` (commands.ts) and `listen` (renderCommands.ts) share, and the agent
 * helper uses too: the options checked (times, close-ups, the pictures' folder, the file to save
 * in, the sound to read against), an audio file measured and heard (a WAV in Node, other audio in
 * the headless browser), pictures written, a saved hearing read, and the lines the text output
 * adds. Also what every command shares: UsageError, the flags' shape and the browser options.
 * Imports neither commands.ts nor renderCommands.ts, so neither imports the other.
 */
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { createLoudnessAnalyser, shortTermWindowFull } from '../../../src/audio/loudness';
import { bandSpectrum, levelBetween, REGIONS, sumDb, totalBands } from '../../../src/audio/mixAnalysis';
import { hearingOf, HEARING_FILE, parseSavedHearing, type SavedHearing } from '../../../src/audio/hearing/hearingOf';
import { compareSound, stretchOf, type SoundComparison } from '../../../src/audio/hearing/compareSound';
import { encodePng } from '../../../src/audio/hearing/png';
import type { PictureInfo } from '../../../src/audio/hearing/pictures';
import type { SoundReport } from '../../../src/audio/hearing/types';
import { tenth, tooLongToHear, wavHeader, type AudioHearing, type KeptPicture } from '../../../src/agent/listenReport';
import { readJson, readWav, sameFile, WavFormatError, writeFileSafe, writeJson } from './files';
import { withRenderer, type BrowserOptions, type RenderSession } from './browserRender';
import { APP_VERSION } from './meta';
import { printErr, safeText } from './print';

export type Flags = Record<string, string | string[] | boolean | undefined>;

/** A command's mistake: said on stderr, exit code 2. */
export class UsageError extends Error {}

const need = (v: string | undefined, what: string): string => {
  if (!v) throw new UsageError(`missing ${what}`);
  return v;
};

/**
 * Loudness and balance of rendered audio: what `measure` prints. Mono is measured as one channel
 * (as BS.1770 does: not as the same sound twice, which reads 3 dB louder); of more than two
 * channels only the first two are measured, and `note` says so. Silence has no balance.
 */
export function measureAudio(channels: Float32Array[], sampleRate: number) {
  if (!(sampleRate >= 8000)) throw new UsageError(`a sample rate of ${sampleRate} Hz can't be measured (8 kHz and up)`);
  const used = channels.slice(0, 2);
  const left = used[0] ?? new Float32Array(0);
  const right = used[1] ?? new Float32Array(left.length);
  const notes: string[] = [];
  if (channels.length > 2) notes.push(`only the first two of its ${channels.length} channels were measured (as left and right)`);
  const analyser = createLoudnessAnalyser(sampleRate);
  // Fed in tenths of a second, so the loudest 3 seconds (short-term) can be read on the way
  const hop = Math.max(1, Math.round(sampleRate / 10));
  // (only whole 3-second windows count: null for audio shorter than 3 seconds)
  let shortTermMax: number | null = null;
  for (let i = 0; i < left.length; i += hop) {
    const n = Math.min(hop, left.length - i);
    analyser.feed(left.subarray(i, i + n), right.subarray(i, i + n), n);
    if (!shortTermWindowFull(i + n, sampleRate)) continue;
    const now = analyser.read().shortTerm;
    if (shortTermMax === null || now > shortTermMax) shortTermMax = now;
  }
  const reading = analyser.read();
  let peak = 0;
  let sum = 0;
  for (const ch of used) for (const v of ch) {
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const silent = peak === 0;
  if (!left.length) notes.push('it holds no audio');
  else if (silent) notes.push('it is silent');
  else if (left.length < sampleRate * 0.4) notes.push('it is shorter than 0.4 seconds, too short for a loudness reading');
  const rmsDb = 10 * Math.log10(sum / Math.max(1, used.length * left.length));
  const peakDb = 20 * Math.log10(peak);
  let regions: Array<{ name: string; db: number }> = [];
  // (under 0.4 seconds the balance means nothing: too few windows to average)
  if (!silent && left.length >= sampleRate * 0.4) {
    const spectrum = bandSpectrum(used, sampleRate);
    const bands = totalBands(spectrum);
    const total = sumDb(bands);
    if (Number.isFinite(total)) regions = REGIONS.map((x) => ({ name: x.name, db: Math.round((levelBetween(spectrum, bands, x.lo, x.hi) - total) * 10) / 10 }));
  }
  return {
    seconds: Math.round((left.length / sampleRate) * 100) / 100,
    channels: channels.length,
    silent,
    lufs: reading.integrated,
    shortTermMaxLufs: shortTermMax,
    truePeakDbtp: reading.truePeakMax,
    crestDb: silent ? null : peakDb - rmsDb,
    regions,
    ...(notes.length ? { note: notes.join('; ') } : {}),
  };
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

/** The audio files `measure` reads (a WAV in Node; the others, and a WAV Node can't read, in the headless browser). */
export const AUDIO_TYPES = ['.wav', '.mp3', '.flac', '.ogg', '.opus', '.m4a', '.aac'] as const;
const isAudio = (path: string) => (AUDIO_TYPES as readonly string[]).includes(extname(path).toLowerCase());
export const isWav = (path: string) => extname(path).toLowerCase() === '.wav';
const isJson = (path: string) => /\.json$/i.test(path);

/** Seconds from `90`, `90.5`, `1:30` or `1:30.5`; anything else is a mistake in `option`. */
export function secondsArg(text: string, option: string): number {
  const plain = /^\d+(?:\.\d+)?$/.exec(text);
  if (plain) return Number(text);
  const m = /^(\d+):([0-5]\d(?:\.\d+)?)$/.exec(text);
  if (!m) throw new UsageError(`${option} takes seconds, like 90, 90.5 or 1:30 (got ${text})`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** A string option's values (one, or several where it may be given again). */
const values = (v: Flags[string]): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);
const stringFlag = (flags: Flags, name: string) => (typeof flags[name] === 'string' ? (flags[name] as string) : undefined);

/** A stretch from two time options, checked: the end after the start. */
function stretchFlags(flags: Flags, from: string, to: string): { fromSeconds?: number; toSeconds?: number } {
  const a = stringFlag(flags, from) === undefined ? undefined : secondsArg(stringFlag(flags, from)!, `--${from}`);
  const b = stringFlag(flags, to) === undefined ? undefined : secondsArg(stringFlag(flags, to)!, `--${to}`);
  if (a !== undefined && b !== undefined && !(b > a)) throw new UsageError(`--${to} ${stringFlag(flags, to)} isn't after --${from} ${stringFlag(flags, from)}: the stretch ends before it starts`);
  return { ...(a !== undefined ? { fromSeconds: a } : {}), ...(b !== undefined ? { toSeconds: b } : {}) };
}

/** The nearest of `path` and the folders above it that is there (null: none is). */
function nearestThere(path: string): string | null {
  for (let p = resolve(path); ; p = dirname(p)) {
    if (existsSync(p)) return p;
    if (dirname(p) === p) return null;
  }
}

/** Where a file or folder `option` names can be written: plain words when a folder on the way is a file, or (for a file) its folder isn't there. */
function checkWritable(option: string, path: string, kind: 'file' | 'folder'): void {
  const there = nearestThere(kind === 'file' ? dirname(resolve(path)) : path);
  const folder = kind === 'file' ? dirname(resolve(path)) : resolve(path);
  if (there && !statSync(there).isDirectory()) {
    if (there === folder) throw new UsageError(`${option} ${path} isn't a folder`);
    const shown = relative(process.cwd(), there);
    throw new UsageError(`${option} ${path}: ${shown && !shown.startsWith('..') && !isAbsolute(shown) ? shown : there} is a file, not a folder`);
  }
  if (kind === 'file' && there !== folder) throw new UsageError(`${option} ${path}: the folder ${dirname(path)} isn't there`);
}

/** The hearing options `measure` and `listen` share, checked (nothing is read or written here). */
export interface HearingFlags {
  /** The folder to write the pictures in. */
  pictures?: string;
  /** Another sound (an audio file) or a saved hearing (.json) to read this one against, and a stretch of it (seconds). */
  against?: string;
  againstFromSeconds?: number;
  againstToSeconds?: number;
  /** The file to save the hearing in. */
  save?: string;
  /** Whether a hearing was asked for, by --sound or an option that needs one. */
  sound: boolean;
}

export function hearingFlags(flags: Flags, closes: number): HearingFlags {
  const pictures = stringFlag(flags, 'pictures');
  if (pictures !== undefined) checkWritable('--pictures', pictures, 'folder');
  const against = stringFlag(flags, 'against');
  if (against !== undefined && !isJson(against) && !isAudio(against)) throw new UsageError(`--against takes an audio file (${AUDIO_TYPES.join(', ')}) or a saved hearing (.json)`);
  const stretch = stretchFlags(flags, 'against-from', 'against-to');
  if (against === undefined) for (const name of ['against-from', 'against-to']) if (flags[name] !== undefined) throw new UsageError(`--${name} goes with --against (a stretch of that sound)`);
  const save = stringFlag(flags, 'save');
  if (save !== undefined) {
    if (!isJson(save)) throw new UsageError(`--save writes a .json file (like song.hearing.json)`);
    if (against !== undefined && sameFile(save, against)) throw new UsageError(`--save ${save} is the file given with --against`);
    if (existsSync(save) && !flags.overwrite) throw new UsageError(`${save} already exists: give another file, or --overwrite`);
    checkWritable('--save', save, 'file');
  }
  return {
    ...(pictures !== undefined ? { pictures } : {}),
    ...(against !== undefined ? { against } : {}),
    ...(stretch.fromSeconds !== undefined ? { againstFromSeconds: stretch.fromSeconds } : {}),
    ...(stretch.toSeconds !== undefined ? { againstToSeconds: stretch.toSeconds } : {}),
    ...(save !== undefined ? { save } : {}),
    sound: flags.sound === true || pictures !== undefined || against !== undefined || save !== undefined || closes > 0,
  };
}

/** What `measure` was asked: the file, its stretch, and the hearing options. */
export interface HearPlan {
  file: string;
  fromSeconds?: number;
  toSeconds?: number;
  sound: boolean;
  pictures?: string;
  /** Moments to picture close up, seconds from the start of the file. */
  closeUps: number[];
  bpm?: number;
  against?: string;
  againstFromSeconds?: number;
  againstToSeconds?: number;
  save?: string;
}

/** `measure`'s arguments, checked (nothing is read or written here). */
export function hearPlan(args: string[], flags: Flags): HearPlan {
  const file = need(args[0], 'the audio file');
  if (!isAudio(file)) throw new UsageError(`measure reads ${AUDIO_TYPES.join(', ')} files`);
  const stretch = stretchFlags(flags, 'from', 'to');
  const closeUps = values(flags.close).map((c) => {
    const at = secondsArg(c, '--close');
    if ((stretch.fromSeconds !== undefined && at < stretch.fromSeconds) || (stretch.toSeconds !== undefined && at >= stretch.toSeconds)) throw new UsageError(`--close ${c} is outside the stretch heard`);
    return at;
  });
  let bpm: number | undefined;
  const bpmText = stringFlag(flags, 'bpm');
  if (bpmText !== undefined) {
    bpm = Number(bpmText);
    if (!/^\d+(?:\.\d+)?$/.test(bpmText) || !(bpm >= 20 && bpm <= 400)) throw new UsageError(`--bpm takes the tempo in beats a minute, 20 to 400 (got ${bpmText})`);
  }
  return { file, ...stretch, ...hearingFlags(flags, closeUps.length), closeUps, ...(bpm !== undefined ? { bpm } : {}) };
}

/** A picture written to a file: what it shows, and where it is. */
export type WrittenPicture = PictureInfo & { path: string; bytes: number };

/** Each picture as `<folder>/<name>.png` (the folder made if it isn't there; a file of that name is written over). Returns the paths. */
export async function writePictures(folder: string, pictures: ReadonlyArray<{ name: string; png: Uint8Array }>): Promise<string[]> {
  mkdirSync(folder, { recursive: true });
  const paths: string[] = [];
  for (const p of pictures) {
    // (a name is the hearing's own, letters, digits and dashes; anything else can't reach another folder)
    const path = join(folder, `${p.name.replace(/[^A-Za-z0-9._-]/g, '-')}.png`);
    writeFileSafe(path, p.png);
    paths.push(path);
  }
  return paths;
}

/** Pictures kept in the renderer's page, read and written to `folder`, each listed by its path. */
export async function takePictures(session: RenderSession, kept: readonly KeptPicture[], folder: string, written: string[]): Promise<WrittenPicture[]> {
  const out: WrittenPicture[] = [];
  for (const { id, ...info } of kept) {
    const [path] = await writePictures(folder, [{ name: info.name, png: await session.take(id, info.bytes) }]);
    written.push(path);
    out.push({ ...info, path });
  }
  return out;
}

/** An audio file heard: as the renderer's AudioHearing, its pictures listed by where they were written. */
export type HeardFile = Omit<AudioHearing, 'pictures'> & { pictures?: WrittenPicture[]; written: string[] };

/** A sound to read another against, and its name. */
export type AgainstSound = { sound: SoundReport; label: string };

/** A WAV file's length from its header (null when it doesn't say), read from its first bytes only. */
function wavSeconds(path: string): number | null {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(1 << 20, statSync(path).size));
    readSync(fd, head, 0, head.length, 0);
    return wavHeader(head)?.seconds ?? null;
  } finally {
    closeSync(fd);
  }
}

/** A stretch `measure` can't hear: outside the file, or longer than a hearing takes. Said in one line, as the renderer says it. */
const outsideTheFile = () => new Error('that stretch is outside the file');
/** A close-up past the end of the file. */
const pastTheEnd = (at: number, name: string) => new UsageError(`--close ${at} is past the end of ${name}`);

/** A WAV file read in Node, cut to the plan's stretch and checked (null: a WAV format Node doesn't read, for the browser to try). */
function loadWav(plan: HearPlan): { cut: Float32Array[]; sampleRate: number; from: number; to: number } | null {
  const from = plan.fromSeconds ?? 0;
  if (plan.sound) {
    // (a file over the limit is refused before it is read, where its header says how long it is)
    const said = wavSeconds(plan.file);
    if (said !== null && from < said) {
      const early = tooLongToHear(Math.min(plan.toSeconds ?? said, said) - from);
      if (early) throw new Error(early);
    }
  }
  let wav;
  try {
    wav = readWav(plan.file);
  } catch (err) {
    if (err instanceof WavFormatError) return null;
    throw err;
  }
  const { sampleRate, channels } = wav;
  const frames = channels[0]?.length ?? 0;
  const length = frames / sampleRate;
  const to = Math.min(plan.toSeconds ?? length, length);
  if ((plan.fromSeconds !== undefined || plan.toSeconds !== undefined) && !(from < length && to > from)) throw outsideTheFile();
  if (plan.sound) {
    const long = tooLongToHear(to - from);
    if (long) throw new Error(long);
  }
  const past = plan.closeUps.find((s) => s >= to);
  if (past !== undefined) throw pastTheEnd(past, basename(plan.file));
  const a = Math.round(from * sampleRate);
  const b = plan.toSeconds === undefined ? frames : Math.max(a + 1, Math.round(to * sampleRate));
  const cut = a === 0 && b === frames ? channels : channels.map((c) => c.slice(a, b));
  return { cut, sampleRate, from, to };
}

/** A WAV loaded by loadWav, measured and, when the plan asks, heard. */
async function hearLoaded(plan: HearPlan, wav: NonNullable<ReturnType<typeof loadWav>>, against: AgainstSound | undefined): Promise<HeardFile> {
  const { cut, sampleRate, from, to } = wav;
  const name = basename(plan.file);
  const m = measureAudio(cut, sampleRate);
  const ms = (x: number) => Math.round(x * 1000) / 1000;
  const out: HeardFile = {
    file: name,
    range: { fromSeconds: ms(from), toSeconds: ms(to) },
    seconds: ms((cut[0]?.length ?? 0) / sampleRate),
    channels: cut.length,
    silent: m.silent,
    lufs: tenth(m.lufs),
    shortTermMaxLufs: tenth(m.shortTermMaxLufs),
    truePeakDbtp: tenth(m.truePeakDbtp),
    crestDb: tenth(m.crestDb),
    regions: m.regions,
    ...(m.note ? { note: m.note } : {}),
    written: [],
  };
  if (!plan.sound) return out;
  const heard = hearingOf(cut, sampleRate, { engine: APP_VERSION, tempoBpm: plan.bpm, closeUps: plan.closeUps.map((s) => s - from), pictures: plan.pictures !== undefined, against });
  out.sound = heard.sound;
  if (plan.pictures !== undefined) {
    const pictures: WrittenPicture[] = [];
    // (each encoded and written in turn, its raster let go once it is)
    while (heard.pictures.length) {
      const { raster, ...info } = heard.pictures.shift()!;
      const png = await encodePng(raster);
      const [path] = await writePictures(plan.pictures, [{ name: info.name, png }]);
      out.written.push(path);
      pictures.push({ ...info, path, bytes: png.length });
    }
    out.pictures = pictures;
  }
  if (against) out.against = compareSound(against.sound, heard.sound, { a: against.label, b: name });
  return out;
}

/** A saved hearing (.json), or a stretch of it from its per-second grid (stretchOf). */
function savedAgainst(path: string, stretch: { fromSeconds?: number; toSeconds?: number }): AgainstSound {
  const label = basename(path);
  const raw = readJson(path);
  let saved: SavedHearing;
  try {
    saved = parseSavedHearing(raw);
  } catch {
    throw new UsageError(`${label} isn't a saved hearing (fledgetone measure --save makes one)`);
  }
  if (stretch.fromSeconds === undefined && stretch.toSeconds === undefined) return { sound: saved.sound, label };
  try {
    return { sound: stretchOf(saved.sound, stretch.fromSeconds ?? 0, stretch.toSeconds ?? saved.sound.seconds), label };
  } catch (err) {
    if (err instanceof RangeError) throw outsideTheFile();
    throw err;
  }
}

/** Whether a sound to read against is heard in the page (audio Node doesn't read by name: not a saved hearing, not a WAV). */
export const againstInPage = (path: string) => !isJson(path) && !isWav(path);

/**
 * The sound to read against `path`, heard in the open page `session` where it must be (the file
 * served at `address`), else as againstOf hears it.
 */
export async function againstFrom(path: string, stretch: { fromSeconds?: number; toSeconds?: number }, browser: BrowserOptions, session?: RenderSession, address?: string): Promise<AgainstSound> {
  if (!session || !address || !againstInPage(path)) return againstOf(path, browser, stretch);
  const label = basename(path);
  const heard = await session.call<AudioHearing>('hearAudio', address, { name: label, ...definedStretch(stretch), sound: true });
  return { sound: heard.sound!, label };
}

const definedStretch = (s: { fromSeconds?: number; toSeconds?: number }) => ({ ...(s.fromSeconds !== undefined ? { fromSeconds: s.fromSeconds } : {}), ...(s.toSeconds !== undefined ? { toSeconds: s.toSeconds } : {}) });

/**
 * An audio file measured and, when the plan asks, heard: its sound report, its pictures written to
 * the plan's folder, read against another sound, and saved. A WAV is read in Node (no browser);
 * other audio, or a WAV Node can't read, is decoded and heard in the headless browser. Everything
 * that can be checked about the file (its stretch, its length, the close-ups) is checked before
 * the sound to read it against is heard.
 */
export async function hearAudioFile(plan: HearPlan, browser: BrowserOptions): Promise<HeardFile> {
  if (!existsSync(plan.file) || !statSync(plan.file).isFile()) throw new Error(`can't read ${plan.file}`);
  const stretch = { fromSeconds: plan.againstFromSeconds, toSeconds: plan.againstToSeconds };
  const name = basename(plan.file);
  const wav = isWav(plan.file) ? loadWav(plan) : null;
  let out: HeardFile;
  if (wav) out = await hearLoaded(plan, wav, plan.against ? await againstOf(plan.against, browser, stretch) : undefined);
  else {
    const serve = [{ path: '/heard/0', file: plan.file }, ...(plan.against && againstInPage(plan.against) ? [{ path: '/heard/1', file: plan.against }] : [])];
    out = await withRenderer({ ...browser, serve }, async (session) => {
      const asked = { name, ...definedStretch(plan), ...(plan.bpm !== undefined ? { tempoBpm: plan.bpm } : {}) };
      // Measured first: the stretch and the length are checked by the page, and the close-ups against its end
      const measured = await session.call<AudioHearing>('hearAudio', '/heard/0', asked);
      const past = plan.closeUps.find((s) => s >= measured.range.toSeconds);
      if (past !== undefined) throw pastTheEnd(past, name);
      // (measured without the sound, so with no pictures)
      const { pictures: _none, ...plain } = measured;
      if (!plan.sound) return { ...plain, written: [] };
      const against = plan.against ? await againstFrom(plan.against, stretch, browser, session, '/heard/1') : undefined;
      const from = plan.fromSeconds ?? 0;
      const res = await session.call<AudioHearing>('hearAudio', '/heard/0', { ...asked, sound: true, pictures: plan.pictures !== undefined, closeUps: plan.closeUps.map((s) => s - from), ...(against ? { against } : {}) });
      const written: string[] = [];
      const { pictures, ...rest } = res;
      return { ...rest, ...(pictures && plan.pictures !== undefined ? { pictures: await takePictures(session, pictures, plan.pictures, written) } : {}), written };
    });
  }
  if (plan.save && out.sound) {
    const saved: SavedHearing = { fledgetoneHearing: HEARING_FILE, of: name, range: { fromSeconds: out.range.fromSeconds, toSeconds: out.range.toSeconds }, sound: out.sound };
    writeJson(plan.save, saved);
    out.written.push(plan.save);
  }
  return out;
}

/**
 * The sound to read another against, and its name: a saved hearing (.json), or a stretch of it
 * (from its per-second grid: stretchOf), or an audio file heard as `measure` hears one.
 */
export async function againstOf(path: string, browser: BrowserOptions, stretch: { fromSeconds?: number; toSeconds?: number } = {}): Promise<AgainstSound> {
  if (isJson(path)) return savedAgainst(path, stretch);
  const heard = await hearAudioFile({ file: path, ...definedStretch(stretch), sound: true, closeUps: [] }, browser);
  return { sound: heard.sound!, label: basename(path) };
}

/** The lines a hearing adds to what a command prints: the sound in words, what it was read against, the pictures written. */
export function hearingLines(h: { sound?: SoundReport; against?: SoundComparison; pictures?: ReadonlyArray<{ path: string; shows: string }> }, againstLabel?: string, heading = 'Sound'): string[] {
  const lines: string[] = [];
  if (h.sound) lines.push(`${heading}:`, ...h.sound.words.map((w) => `  ${w}`));
  if (h.against) lines.push(`Against ${againstLabel ?? 'the other sound'}:`, ...h.against.notes.map((n) => `  ${n}`), ...h.against.differences.map((d) => `  ${d.words}`));
  if (h.pictures?.length) lines.push('Pictures:', ...h.pictures.map((p) => `  ${p.path}: ${p.shows}`));
  return lines;
}
