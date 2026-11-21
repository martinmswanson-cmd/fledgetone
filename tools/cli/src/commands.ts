/**
 * The command line's commands (all but `mcp`): reading a song (info, notes, check), comparing two
 * (diff), the app's lists (list), making one from a starter (new), applying a suggestion file
 * (apply), measuring an audio file's loudness and, when asked, hearing it (measure: its sound in
 * words, pictures of it, a comparison with another sound or a saved hearing, a saved hearing; a WAV
 * in Node, other audio in the headless browser), and share links (link, from-link). Each writes to
 * stdout and returns the exit code: 0 done, 1 done with something to fix or refused, 2 a mistake in
 * the command or an unreadable file.
 */
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { createStarter, isStarterId, STARTERS } from '../../../src/store/starters';
import { parseProject, serializeProject, unreadWords, type ProjectSnapshot } from '../../../src/store/project';
import { SONG_CAPS } from '../../../src/store/songCaps';
import { projectFromHash, songLink } from '../../../src/store/shareLink';
import { toAgentSong, agentNotes, type AgentSong } from '../../../src/agent/agentSong';
import { diffSongs, rangesWords } from '../../../src/agent/songDiff';
import { applyOps } from '../../../src/agent/ops';
import { classifySuggestion, parseSuggestionFile } from '../../../src/agent/suggestion';
import { fingerprint, firstDifference, stableJson } from '../../../src/agent/fingerprint';
import { listInserts, listInstruments, listMaster, listParams, listPresets, listStarters } from '../../../src/agent/catalog';
import { createLoudnessAnalyser, shortTermWindowFull } from '../../../src/audio/loudness';
import { bandSpectrum, levelBetween, REGIONS, sumDb, totalBands } from '../../../src/audio/mixAnalysis';
import { hearingOf, HEARING_FILE, parseSavedHearing, type SavedHearing } from '../../../src/audio/hearing/hearingOf';
import { compareSound, stretchOf, type SoundComparison } from '../../../src/audio/hearing/compareSound';
import { encodePng } from '../../../src/audio/hearing/png';
import type { PictureInfo } from '../../../src/audio/hearing/pictures';
import type { SoundReport } from '../../../src/audio/hearing/types';
import { tenth, tooLongToHear, wavHeader, type AudioHearing, type KeptPicture } from '../../../src/agent/listenReport';
import { readJson, readSong, readWav, sameFile, WavFormatError, writeFileSafe, writeJson, writeSong } from './files';
import { withRenderer, type BrowserOptions, type RenderSession } from './browserRender';
import { browserOptions } from './renderCommands';
import { APP_VERSION } from './meta';
import { printErr, printOut } from './print';

export type Flags = Record<string, string | string[] | boolean | undefined>;
type Out = (text: string) => void;

const say: Out = printOut;
const json = (v: unknown) => say(JSON.stringify(v, null, 2));
const r1 = (v: number) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) : String(v));
const db = (v: number) => `${v > 0 ? '+' : ''}${r1(v)} dB`;
/** The loudest 3 seconds in words: none for audio shorter than 3 seconds (null), "-" for silence. */
/** The loudness line's start: the integrated loudness and the loudest 3 seconds, or in plain words why there is none. */
export const loudnessText = (lufs: number | null, shortTermMax: number | null, seconds: number) =>
  lufs !== null && Number.isFinite(lufs) ? `Loudness ${r1(lufs)} LUFS (${loudestText(shortTermMax, seconds)})` : seconds < 0.4 ? 'Too short to measure loudness (under 0.4 seconds)' : 'Too quiet to measure loudness';
export const loudestText = (v: number | null, seconds: number) => (v === null && seconds < 3 ? 'too short for the loudest 3 seconds: under 3 seconds long' : `loudest 3 seconds ${v === null ? '-' : r1(v)}${v !== null && Number.isFinite(v) ? ' LUFS' : ''}`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** A command's mistake: said on stderr, exit code 2. */
export class UsageError extends Error {}

const need = (v: string | undefined, what: string): string => {
  if (!v) throw new UsageError(`missing ${what}`);
  return v;
};

/** The id base a suggestion's ops are applied with: from its ops, so the file applied again gives the same ids. */
export const suggestionIdBase = (ops: unknown) => `sg-${fingerprint(ops).slice(0, 10)}`;

/** The song in plain words, as `info` prints it. */
export function songText(s: AgentSong): string {
  const lines: string[] = [];
  lines.push(`${s.name}: ${r1(s.tempo.bpm)} BPM, ${s.meter.base}${s.key ? `, ${s.key}` : ''}, ${r1(s.lengthBars)} bars (${clock(s.lengthSeconds)})`);
  if (s.tempo.changes.length) lines.push(`Tempo changes: ${s.tempo.changes.map((t) => `${r1(t.bpm)} BPM at bar ${r1(t.bar)}${t.ramp ? ' (ramp)' : ''} [${t.id}]`).join(', ')}`);
  if (s.meter.changes.length) lines.push(`Meter changes: ${s.meter.changes.map((m) => `${m.meter} at bar ${r1(m.bar)}`).join(', ')}`);
  lines.push(`Loop: bars ${r1(s.loop.inBar)} to ${r1(s.loop.outBar)} (${s.loop.on ? 'on' : 'off'})`);
  if (s.markers.length) lines.push(`Markers: ${s.markers.map((m) => `${m.name} (bar ${r1(m.bar)}) [${m.id}]`).join(', ')}`);
  if (s.sections.length) lines.push(`Sections: ${s.sections.map((x) => `${x.name} ${r1(x.fromBar)}-${r1(x.toBar)}`).join(', ')}`);
  lines.push('', `Tracks (${s.tracks.length}):`);
  for (const t of s.tracks) {
    const bits = [`${db(t.volumeDb)}`, `pan ${t.pan === 0 ? 'C' : `${t.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(t.pan) * 100)}`}`];
    if (t.mute) bits.push('muted');
    if (t.solo) bits.push('soloed');
    if (t.reverbSend) bits.push(`reverb ${Math.round(t.reverbSend * 100)}%`);
    if (t.delaySend) bits.push(`delay ${Math.round(t.delaySend * 100)}%`);
    if (t.inserts.length) bits.push(`inserts: ${t.inserts.map((i) => i.insert).join(', ')}`);
    if (t.automation.length) bits.push(`automation: ${t.automation.map((a) => a.label).join(', ')}`);
    if (t.synthPreset) bits.push(`preset ${t.synthPreset}`);
    lines.push(`  ${t.name} (${t.instrument.name}, ${t.role}): ${bits.join(', ')}  [${t.id}]`);
  }
  lines.push('', `Clips (${s.clips.length}):`);
  for (const c of s.clips) {
    const track = s.tracks.find((t) => t.id === c.trackId)?.name ?? '?';
    lines.push(`  "${c.name}" on ${track}, bars ${r1(c.startBar)} to ${r1(c.startBar + c.lengthBars)}, ${c.kind === 'notes' ? `${c.notes} notes${c.range ? ` (${c.range})` : ''}` : c.kind}${c.linkedTo ? `, linked (${c.linkedTo})` : ''}  [${c.id}]`);
  }
  const m = s.master;
  const on = [m.ott.on && 'OTT', m.width.on && 'width', m.loud?.on && 'Loud', m.clipper?.on && 'clipper'].filter(Boolean);
  lines.push('', `Master: Level ${db(m.levelDb)}, compressor ${m.glue}${on.length ? `, ${on.join(', ')} on` : ''}`);
  if (s.omitted.length) lines.push(`(Left out to keep it short: ${s.omitted.join('; ')})`);
  return lines.join('\n');
}

/** How many things were past the caps when a file was read (see unreadWords). */
const overCount = (unread: NonNullable<ProjectSnapshot['unread']>) => (unread.notes ?? 0) + Object.values(unread.over ?? {}).reduce((a, b) => a + (b ?? 0), 0);

/** What reading the file left out, in one line ('' when nothing was): for render, listen and info. */
export function leftOutLine(song: Pick<ProjectSnapshot, 'unread'>): string {
  if (!song.unread) return '';
  const { parts, over } = unreadWords(song.unread);
  const bits = [parts && `${parts} this version can't read`, over].filter(Boolean);
  return bits.length ? `Left out on reading the file: ${bits.join('; ')}. The rest is used as it is.` : '';
}

/** Say (on stderr, so --json output stays as it is) what reading the file left out, if anything. */
export function sayLeftOut(song: Pick<ProjectSnapshot, 'unread'>): void {
  const line = leftOutLine(song);
  if (line) printErr(line);
}

export function info(args: string[], flags: Flags): number {
  const song = readSong(need(args[0], 'the song file'));
  sayLeftOut(song);
  const agent = toAgentSong(song, { appVersion: APP_VERSION });
  if (flags.json) json(agent);
  else say(songText(agent));
  return 0;
}

/**
 * What a file's check finds: tracks and clips it couldn't read, and values it brought into range
 * or repaired, each with where. Empty: the file opens exactly as it is.
 */
export function checkProblems(raw: unknown): { problems: string[]; fixed: ReturnType<typeof parseProject> } {
  // The tracks past the most a song opens with, and each clip's track, as the file has them
  // (reading it cuts its lists and may rename ids in place): their clips go with them, said once
  const fileTracks = (raw as { tracks?: unknown }).tracks;
  const fileClips = (raw as { clips?: unknown }).clips;
  const cappedTracks = new Set(Array.isArray(fileTracks) ? fileTracks.slice(SONG_CAPS.tracks).map((t) => (t as { id?: unknown } | null)?.id) : []);
  const trackOfClip = new Map<unknown, unknown>(Array.isArray(fileClips) ? fileClips.map((c) => [c, (c as { trackId?: unknown } | null)?.trackId]) : []);
  const fixed = parseProject(raw);
  const problems: string[] = [];
  if (fixed.unread) {
    const { parts, over } = unreadWords(fixed.unread);
    if (parts) problems.push(`${parts} can't be read and ${fixed.unread.tracks + fixed.unread.clips === 1 ? 'is' : 'are'} left out when it opens.`);
    if (over) problems.push(`It has ${over}: ${overCount(fixed.unread) === 1 ? 'that is' : 'those are'} left out when it opens.`);
  }
  const file = raw as { tracks?: unknown[]; clips?: unknown[] };
  const saved = serializeProject(fixed);
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const tracks = byId(saved.tracks);
  const clips = byId(saved.clips as Array<{ id: string }>);
  const seen = new Set<string>();
  for (const t of (file.tracks ?? []) as Array<{ id?: string; name?: string }>) {
    if (!t || typeof t.id !== 'string') continue;
    if (seen.has(`t:${t.id}`)) problems.push(`Track "${t.name}" appears twice: the second is left out.`);
    seen.add(`t:${t.id}`);
    const now = tracks.get(t.id);
    if (now && stableJson(now) !== stableJson(t)) {
      const d = firstDifference(t, now);
      if (d) problems.push(`Track "${t.name}": ${d}.`);
    }
  }
  for (const c of (file.clips ?? []) as Array<{ id?: string; name?: string; trackId?: string }>) {
    if (!c || typeof c.id !== 'string') continue;
    if (seen.has(`c:${c.id}`)) problems.push(`Clip "${c.name}" appears twice: the second is left out.`);
    seen.add(`c:${c.id}`);
    const now = clips.get(c.id);
    if (!now) {
      // (a clip of a track past the caps: said with the tracks above)
      if (!fixed.tracks.some((t) => t.id === c.trackId) && !cappedTracks.has(trackOfClip.get(c) ?? c.trackId)) problems.push(`Clip "${c.name}" belongs to no track: it's left out.`);
      continue;
    }
    if (stableJson(now) !== stableJson(c)) {
      const d = firstDifference(c, now);
      if (d) problems.push(`Clip "${c.name}": ${d}.`);
    }
  }
  return { problems, fixed };
}

export function check(args: string[], flags: Flags): number {
  const path = need(args[0], 'the song file');
  readSong(path); // a readable reason if it can't open at all
  const { problems, fixed } = checkProblems(readJson(path));
  if (flags.json) json({ ok: problems.length === 0, problems });
  else if (!problems.length) say(`${fixed.name}: opens as it is. Nothing to fix.`);
  else say([`${fixed.name}: ${problems.length} thing${problems.length === 1 ? '' : 's'} the app changes when it opens:`, ...problems.map((p) => `  - ${p}`)].join('\n'));
  if (flags.fix) {
    const out = need(flags.o as string | undefined, 'the file to write (-o)');
    if (sameFile(out, path) && !flags.overwrite) throw new UsageError(`-o ${out} is the file being checked: give another file, or --overwrite`);
    if (existsSync(out) && !flags.overwrite) throw new UsageError(`${out} already exists: give another file, or --overwrite`);
    writeSong(out, fixed);
    if (!flags.json) say(`Wrote the repaired song to ${out}.`);
    return 0;
  }
  return problems.length ? 1 : 0;
}

export function diff(args: string[], flags: Flags): number {
  const a = readSong(need(args[0], 'the first song file'));
  const b = readSong(need(args[1], 'the second song file'));
  const d = diffSongs(a, b);
  // (the words with their names in plain quotes: the marked ones are for the studio's cards)
  if (flags.json) json({ ...d, changes: d.changes.map(({ marked: _m, ...c }) => c) });
  else if (!d.changes.length) say('No differences.');
  else say([...d.changes.map((c) => `- ${c.text}`), ...(d.regions.length ? [`(Heard in ${rangesWords(d.regions)})`] : [])].join('\n'));
  return 0;
}

/** "5-8" (bars 5 to 8, 8 included) or "5" as a range of song bars, end not included. */
export function barRange(text: string): { fromBar: number; toBar: number } {
  const m = /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/.exec(text);
  if (!m) throw new UsageError('--bars takes a bar or a range, like 5 or 5-8');
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  if (from < 1) throw new UsageError('--bars: songs start at bar 1');
  if (to < from) throw new UsageError('--bars: the range ends before it starts');
  return { fromBar: from, toBar: to + 1 };
}

export function notes(args: string[], flags: Flags): number {
  const song = readSong(need(args[0], 'the song file'));
  let trackId: string | undefined;
  if (typeof flags.track === 'string') {
    const want = flags.track.toLowerCase();
    const t = song.tracks.find((x) => x.id === flags.track) ?? song.tracks.find((x) => x.name.toLowerCase() === want);
    if (!t) throw new UsageError(`no track "${flags.track}" (give its name or id: fledgetone info lists them)`);
    trackId = t.id;
  }
  const range = typeof flags.bars === 'string' ? barRange(flags.bars) : {};
  const all = [];
  let cursor: string | undefined;
  do {
    const page = agentNotes(song, { trackId, ...range, cursor });
    all.push(...page.notes);
    cursor = page.next;
  } while (cursor);
  if (flags.json) {
    json(all);
    return 0;
  }
  const names = new Map(song.tracks.map((t) => [t.id, t.name]));
  if (!all.length) say('No notes.');
  for (const n of all) say(`bar ${n.bar.toFixed(3).padStart(8)}  ${n.pitch.padEnd(4)} ${String(n.length).padEnd(8)} bars  velocity ${n.velocity.toFixed(2)}  ${names.get(n.trackId)}  [${n.clipId} ${n.id}]`);
  return 0;
}

export function list(args: string[], flags: Flags): number {
  const [what, query] = args;
  const lists: Record<string, () => unknown> = {
    instruments: () => listInstruments(query, { retro: flags.retro === true }),
    presets: () => listPresets(query),
    starters: () => listStarters(query),
    params: () => listParams(query),
    inserts: () => listInserts(query),
    master: () => listMaster(),
  };
  if (!what || !Object.hasOwn(lists, what)) throw new UsageError(`list what? ${Object.keys(lists).join(', ')}`);
  const items = lists[what]();
  if (flags.json) {
    json(items);
    return 0;
  }
  switch (what) {
    case 'instruments':
      for (const i of items as ReturnType<typeof listInstruments>) say(`${i.key.padEnd(22)} ${i.name} (${i.category}, ${i.range})${i.canAdd ? '' : ' [needs sound files: not for suggestions]'}: ${i.description}`);
      break;
    case 'presets':
      for (const p of items as string[]) say(p);
      break;
    case 'starters':
      for (const s of items as ReturnType<typeof listStarters>) say(`${s.id.padEnd(14)} ${s.name}: ${s.description}`);
      break;
    case 'params':
      for (const p of items as ReturnType<typeof listParams>) say(`${p.param.padEnd(26)} ${p.label}`);
      break;
    case 'inserts':
      for (const i of items as ReturnType<typeof listInserts>) {
        say(`${i.insert}:`);
        for (const [k, v] of Object.entries(i.settings)) say(`  ${k.padEnd(12)} default ${JSON.stringify(v.default)}${v.min !== undefined ? `, ${v.min} to ${v.max}` : ''}${v.choices ? `, one of ${v.choices.join(' ')}` : ''}`);
      }
      break;
    default:
      json(items);
  }
  return 0;
}

export function newSong(args: string[], flags: Flags): number {
  const id = flags.starter;
  if (typeof id !== 'string' || !isStarterId(id)) throw new UsageError(`--starter takes one of: ${STARTERS.map((s) => s.id).join(', ')}`);
  const out = need(flags.o as string | undefined, 'the file to write (-o)');
  if (existsSync(out) && !flags.overwrite) throw new UsageError(`${out} already exists: give another file, or --overwrite`);
  const song = createStarter(id);
  writeSong(out, typeof flags.name === 'string' && flags.name.trim() ? { ...song, name: flags.name.trim().slice(0, 80) } : song);
  say(`Wrote ${out}: the ${STARTERS.find((s) => s.id === id)!.name} starter.`);
  void args;
  return 0;
}

export function apply(args: string[], flags: Flags): number {
  const songPath = need(args[0], 'the song file');
  const suggestionPath = need(args[1], 'the suggestion file');
  const out = need(flags.o as string | undefined, 'the file to write (-o)');
  if (sameFile(out, songPath) && !flags.overwrite) throw new UsageError(`-o ${out} is the song itself: write the result to another file (or pass --overwrite)`);
  if (sameFile(out, suggestionPath)) throw new UsageError(`-o ${out} is the suggestion file`);
  if (existsSync(out) && !flags.overwrite) throw new UsageError(`${out} already exists: give another file, or --overwrite`);
  const song = readSong(songPath);
  let suggestion;
  try {
    suggestion = parseSuggestionFile(readJson(suggestionPath));
  } catch (err) {
    throw new UsageError(`${suggestionPath}: ${(err as Error).message}`);
  }
  if (suggestion.songId && song.songId && suggestion.songId !== song.songId && !flags.force) {
    say(`This suggestion was made for another song. Nothing was written (--force applies it anyway).`);
    return 1;
  }
  const fresh = classifySuggestion({ touchedHashes: suggestion.touchedHashes, touchedNames: suggestion.touchedNames, touchedRows: suggestion.touchedRows }, { song });
  if (fresh.status === 'out_of_date' && !flags.force) {
    say(`The song changed since this suggestion was made (${fresh.changed.join('; ')}). Nothing was written (--force applies it anyway).`);
    return 1;
  }
  const result = applyOps(song, { opsVersion: suggestion.opsVersion, ops: suggestion.ops }, { idBase: suggestionIdBase(suggestion.ops) });
  if (!result.ok) {
    say(['The suggestion can’t be applied:', ...result.errors.map((e) => `  - op ${e.op}${e.path ? ` (${e.path})` : ''}: ${e.message}`)].join('\n'));
    return 1;
  }
  writeSong(out, { ...result.song, sounds: song.sounds });
  if (flags.json) json({ written: out, changes: result.diff.changes.map((c) => c.text), warnings: result.warnings, notes: result.notes });
  else say([`"${suggestion.title}": wrote ${out}.`, ...result.diff.changes.map((c) => `- ${c.text}`), ...result.warnings.map((w) => `! ${w}`), ...result.notes.map((x) => `(${x})`)].join('\n'));
  return 0;
}

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

/** The audio files `measure` reads (a WAV in Node; the others, and a WAV Node can't read, in the headless browser). */
export const AUDIO_TYPES = ['.wav', '.mp3', '.flac', '.ogg', '.opus', '.m4a', '.aac'] as const;
const isAudio = (path: string) => (AUDIO_TYPES as readonly string[]).includes(extname(path).toLowerCase());
const isWav = (path: string) => extname(path).toLowerCase() === '.wav';

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
  if (pictures !== undefined && existsSync(pictures) && !statSync(pictures).isDirectory()) throw new UsageError(`--pictures ${pictures} isn't a folder`);
  const against = stringFlag(flags, 'against');
  if (against !== undefined && !/\.json$/i.test(against) && !isAudio(against)) throw new UsageError(`--against takes an audio file (${AUDIO_TYPES.join(', ')}) or a saved hearing (.json)`);
  const stretch = stretchFlags(flags, 'against-from', 'against-to');
  if (against === undefined) for (const name of ['against-from', 'against-to']) if (flags[name] !== undefined) throw new UsageError(`--${name} goes with --against (a stretch of that sound)`);
  const save = stringFlag(flags, 'save');
  if (save !== undefined) {
    if (!/\.json$/i.test(save)) throw new UsageError(`--save writes a .json file (like song.hearing.json)`);
    if (against !== undefined && sameFile(save, against)) throw new UsageError(`--save ${save} is the file given with --against`);
    if (existsSync(save) && !flags.overwrite) throw new UsageError(`${save} already exists: give another file, or --overwrite`);
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
    if (!/^\d+(?:\.\d+)?$/.test(bpmText) || !(bpm >= 20 && bpm <= 400)) throw new UsageError('--bpm takes the tempo in beats a minute, 20 to 400');
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

/** A WAV file heard in Node (null: a WAV format Node doesn't read, for the browser to try). */
async function hearWav(plan: HearPlan, against: { sound: SoundReport; label: string } | undefined): Promise<HeardFile | null> {
  const name = basename(plan.file);
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
  const outside = plan.closeUps.find((s) => s >= to);
  if (outside !== undefined) throw new UsageError(`--close ${outside} is past the end of ${name}`);
  const a = Math.round(from * sampleRate);
  const b = plan.toSeconds === undefined ? frames : Math.max(a + 1, Math.round(to * sampleRate));
  const cut = a === 0 && b === frames ? channels : channels.map((c) => c.slice(a, b));
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

/**
 * An audio file measured and, when the plan asks, heard: its sound report, its pictures written to
 * the plan's folder, read against another sound, and saved. A WAV is read in Node (no browser);
 * other audio, or a WAV Node can't read, is decoded and heard in the headless browser.
 */
export async function hearAudioFile(plan: HearPlan, browser: BrowserOptions): Promise<HeardFile> {
  if (!existsSync(plan.file) || !statSync(plan.file).isFile()) throw new Error(`can't read ${plan.file}`);
  const against = plan.against ? await againstOf(plan.against, browser, { fromSeconds: plan.againstFromSeconds, toSeconds: plan.againstToSeconds }) : undefined;
  const name = basename(plan.file);
  let out = isWav(plan.file) ? await hearWav(plan, against) : null;
  if (!out) {
    const from = plan.fromSeconds ?? 0;
    const address = '/heard/0';
    out = await withRenderer({ ...browser, serve: [{ path: address, file: plan.file }] }, async (session) => {
      const res = await session.call<AudioHearing>('hearAudio', address, {
        name,
        ...(plan.fromSeconds !== undefined ? { fromSeconds: plan.fromSeconds } : {}),
        ...(plan.toSeconds !== undefined ? { toSeconds: plan.toSeconds } : {}),
        sound: plan.sound,
        pictures: plan.pictures !== undefined,
        closeUps: plan.closeUps.map((s) => s - from),
        ...(plan.bpm !== undefined ? { tempoBpm: plan.bpm } : {}),
        ...(against ? { against } : {}),
      });
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
export async function againstOf(path: string, browser: BrowserOptions, stretch: { fromSeconds?: number; toSeconds?: number } = {}): Promise<{ sound: SoundReport; label: string }> {
  const label = basename(path);
  if (/\.json$/i.test(path)) {
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
  const heard = await hearAudioFile({ file: path, ...stretch, sound: true, closeUps: [] }, browser);
  return { sound: heard.sound!, label };
}

/** The lines a hearing adds to what a command prints: the sound in words, what it was read against, the pictures written. */
export function hearingLines(h: { sound?: SoundReport; against?: SoundComparison; pictures?: ReadonlyArray<{ path: string; shows: string }> }, againstLabel?: string, heading = 'Sound'): string[] {
  const lines: string[] = [];
  if (h.sound) lines.push(`${heading}:`, ...h.sound.words.map((w) => `  ${w}`));
  if (h.against) lines.push(`Against ${againstLabel ?? 'the other sound'}:`, ...h.against.notes.map((n) => `  ${n}`), ...h.against.differences.map((d) => `  ${d.words}`));
  if (h.pictures?.length) lines.push('Pictures:', ...h.pictures.map((p) => `  ${p.path}: ${p.shows}`));
  return lines;
}

/** What `measure` prints of a file's loudness and balance, as it always has. */
function measureText(path: string, m: { seconds: number; channels: number; silent: boolean; lufs: number | null; shortTermMaxLufs: number | null; truePeakDbtp: number | null; crestDb: number | null; regions: Array<{ name: string; db: number }>; note?: string }): string[] {
  const note = m.note?.replace(/\.$/, '');
  if (m.silent) return [`${path}: ${clock(m.seconds)}, silent: nothing to measure.`, ...(note ? [`(${note})`] : [])];
  return [
    `${path}: ${clock(m.seconds)}, ${m.channels === 1 ? 'mono' : `${m.channels} channels`}`,
    `${loudnessText(m.lufs, m.shortTermMaxLufs, m.seconds)}, true peak ${r1(m.truePeakDbtp ?? -Infinity)} dBTP, crest ${r1(m.crestDb!)} dB`,
    ...(m.regions.length ? ['Balance (each part of the spectrum against the whole):', ...m.regions.map((x) => `  ${x.name.padEnd(26)} ${db(x.db)}`)] : []),
    ...(note ? [`(Note: ${note}.)`] : []),
  ];
}

export async function measure(args: string[], flags: Flags): Promise<number> {
  const plan = hearPlan(args, flags);
  // A whole WAV, not heard: measured as it always was
  if (!plan.sound && plan.fromSeconds === undefined && plan.toSeconds === undefined && isWav(plan.file)) {
    let wav;
    try {
      wav = readWav(plan.file);
    } catch (err) {
      if (!(err instanceof WavFormatError)) throw err;
    }
    if (wav) {
      const m = measureAudio(wav.channels, wav.sampleRate);
      if (flags.json) json(m);
      else say(measureText(plan.file, m).join('\n'));
      return 0;
    }
  }
  const heard = await hearAudioFile(plan, browserOptions(flags, 'Hearing'));
  const { written: _written, ...result } = heard;
  if (flags.json) json(result);
  else say([...measureText(plan.file, heard), ...hearingLines(heard, plan.against && basename(plan.against)), ...(plan.save ? [`Saved the hearing in ${plan.save}.`] : [])].join('\n'));
  return 0;
}

export async function link(args: string[], flags: Flags): Promise<number> {
  const song = readSong(need(args[0], 'the song file'));
  const base = typeof flags.base === 'string' ? flags.base : 'https://fledgetone.com/app/';
  say(await songLink(song, base));
  return 0;
}

export async function fromLink(args: string[], flags: Flags): Promise<number> {
  const text = need(args[0], 'the link');
  const out = need(flags.o as string | undefined, 'the file to write (-o)');
  if (existsSync(out) && !flags.overwrite) throw new UsageError(`${out} already exists: give another file, or --overwrite`);
  const hash = text.includes('#') ? text.slice(text.indexOf('#')) : text.startsWith('s=') ? `#${text}` : text;
  let song;
  try {
    song = await projectFromHash(hash);
  } catch (err) {
    const why = err instanceof Error && err.message && !/^(The string|Failed|Invalid|The input|.*base64)/i.test(err.message) ? `: ${err.message}` : '';
    throw new UsageError(`that link can't be read (it may be cut short or changed)${why}`);
  }
  if (!song) throw new UsageError("that isn't a Fledgetone song link (it has #s=... in it)");
  writeSong(out, song);
  say(`Wrote ${out}: "${song.name}".`);
  return 0;
}
