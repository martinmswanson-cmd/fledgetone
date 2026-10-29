/**
 * Files for the command line and the agent tools: reading and writing songs (.fledgetone.json),
 * suggestion files, and WAV audio; and the agent tools' rule that a file must be inside the
 * folder the helper was started for (--root), with a song, suggestion or audio extension.
 */
import { closeSync, constants, existsSync, fstatSync, ftruncateSync, lstatSync, openSync, readFileSync, realpathSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseProject, serializeProject, type ProjectSnapshot } from '../../../src/store/project';

/** A song from a .fledgetone.json file. Throws with a readable reason. */
export function readSong(path: string): ProjectSnapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`can't read ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${path} isn't JSON: is it a Fledgetone song (.fledgetone.json)?`);
  }
  try {
    return parseProject(raw);
  } catch (err) {
    throw new Error(`${basename(path)}: ${(err as Error).message}`);
  }
}

/** The raw JSON of a file (for suggestion files and checks). */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`can't read ${path} as JSON`);
  }
}

/**
 * Write a file, never through a symbolic link: a link where the file goes (even one pointing at
 * nothing yet) is refused, so a planted link can't send the write somewhere else.
 */
export function writeFileSafe(path: string, text: string): void {
  const linkError = () => new Error(`${path} is a link: write to a plain file`);
  let link = false;
  try {
    link = lstatSync(path).isSymbolicLink();
  } catch {
    // Not there yet: made below
  }
  if (link) throw linkError();
  const parent = realpathSync.native(dirname(resolve(path)));
  let fd: number;
  try {
    // O_NOFOLLOW: a link made between the check and the open fails here too (where the system has
    // it; without, the checks after the open catch it). Not truncated until those checks pass.
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o644);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw code === 'ELOOP' ? linkError() : new Error(`can't write ${path} (${code ?? 'error'})`);
  }
  try {
    // What was opened must be the plain file at that path, in the folder that was checked: a link
    // (or a junction) swapped in, or a folder swapped above it, is refused before anything is written
    const opened = fstatSync(fd);
    const there = lstatSync(path);
    if (there.isSymbolicLink() || !opened.isFile() || there.dev !== opened.dev || there.ino !== opened.ino) throw linkError();
    if (realpathSync.native(dirname(resolve(path))) !== parent) throw new Error(`the folder of ${path} changed while it was being written`);
    ftruncateSync(fd, 0);
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

/** Write a song as a .fledgetone.json file (its sounds included, as Save does). */
export function writeSong(path: string, song: ProjectSnapshot): void {
  writeFileSafe(path, JSON.stringify(serializeProject(song), null, 2) + '\n');
}

export function writeJson(path: string, value: unknown): void {
  writeFileSafe(path, JSON.stringify(value, null, 2) + '\n');
}

/** Whether two paths are the same file, or would be: by device and inode when both exist (hard links too), else by their real paths. */
export function sameFile(a: string, b: string): boolean {
  if (existsSync(a) && existsSync(b)) {
    const x = statSync(a);
    const y = statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  }
  const real = (p: string) => {
    // A file not made yet: its folder's real path and its name
    const dir = dirname(resolve(p));
    return existsSync(dir) ? resolve(realpathSync.native(dir), basename(p)) : resolve(p);
  };
  return real(a) === real(b);
}

/** The extensions the agent tools may read or write. */
export const AGENT_FILE_TYPES = ['.fledgetone.json', '.json', '.wav', '.mp3'];

/**
 * `file` as an absolute path inside `root`, or an error in plain words: the agent tools reach
 * only the folder the helper was started for, and only songs, suggestions and audio.
 */
export function fileInRoot(root: string, file: string, opts: { types?: string[]; mustExist?: boolean; write?: boolean } = {}): string {
  const types = opts.types ?? AGENT_FILE_TYPES;
  if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('give a file name');
  const realRoot = realpathSync.native(root);
  const full = resolve(realRoot, file);
  if (!types.some((t) => full.toLowerCase().endsWith(t))) throw new Error(`only ${types.join(', ')} files can be used here`);
  // The folder it's in, with links followed, must be inside the root
  if (!existsSync(dirname(full))) throw new Error(`the folder of ${file} doesn't exist`);
  const dir = realpathSync.native(dirname(full));
  const inside = (p: string) => {
    const rel = relative(realRoot, p);
    return !rel.startsWith('..') && !isAbsolute(rel);
  };
  if (!inside(dir)) throw new Error(`${file} is outside the folder the helper works in (${realRoot}); start it with --root to use another`);
  const at = resolve(dir, basename(full));
  let link = false;
  try {
    link = lstatSync(at).isSymbolicLink();
  } catch {
    // Not there
  }
  // A file to be written is never a link (even one to nothing yet: the write would follow it out)
  if (link && opts.write) throw new Error(`${file} is a link: the helper writes only plain files`);
  const target = link ? (existsSync(at) ? realpathSync.native(at) : null) : at;
  if (!target || !inside(target)) throw new Error(`${file} is outside the folder the helper works in (${realRoot}); start it with --root to use another`);
  if (opts.mustExist && !existsSync(target)) throw new Error(`there's no file ${file}`);
  return target;
}

/** A WAV file's samples, one Float32Array per channel (PCM 16, 24 or 32 bit, or 32/64-bit float). */
export function readWav(path: string): { sampleRate: number; channels: Float32Array[] } {
  const buf = readFileSync(path);
  const damaged = () => new Error(`${basename(path)} is damaged or cut short: it can't be read as a WAV file`);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (at: number) => buf.toString('latin1', at, at + 4);
  if (buf.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${basename(path)} isn't a WAV file`);
  let at = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: { start: number; length: number } | null = null;
  while (at + 8 <= buf.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + size > buf.length) throw damaged();
      let format = view.getUint16(body, true);
      // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format GUID's first two bytes
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true);
      fmt = { format, channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    } else if (id === 'data') data = { start: body, length: Math.min(size, buf.length - body) };
    at = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error(`${basename(path)} has no audio in it`);
  const { format, channels: count, rate, bits } = fmt;
  if (!count) throw damaged();
  if (rate < 8000 || rate > 768000) throw new Error(`${basename(path)} says its sample rate is ${rate} Hz: only 8 kHz to 768 kHz can be measured`);
  const bytes = bits / 8;
  if (!count || !(format === 1 && [16, 24, 32].includes(bits)) && !(format === 3 && [32, 64].includes(bits))) throw new Error(`${basename(path)}: only 16, 24 and 32-bit PCM and float WAV files can be measured`);
  const frames = Math.floor(data.length / (bytes * count));
  const channels = Array.from({ length: count }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < count; c++) {
      const p = data.start + (i * count + c) * bytes;
      let v: number;
      if (format === 3) v = bits === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
      else if (bits === 16) v = view.getInt16(p, true) / 32768;
      else if (bits === 24) v = ((view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16)) as number) / 8388608;
      else v = view.getInt32(p, true) / 2147483648;
      channels[c][i] = v;
    }
  }
  return { sampleRate: rate, channels };
}
