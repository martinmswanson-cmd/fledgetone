/**
 * The command line's commands (all but `mcp`): reading a song (info, notes, check), comparing two
 * (diff), the app's lists (list), making one from a starter (new), applying a suggestion file
 * (apply), measuring a WAV file's loudness (measure), and share links (link, from-link). Each
 * writes to stdout and returns the exit code: 0 done, 1 done with something to fix or refused,
 * 2 a mistake in the command or an unreadable file.
 */
import { existsSync } from 'node:fs';
import { createStarter, isStarterId, STARTERS } from '../../../src/store/starters';
import { parseProject, serializeProject } from '../../../src/store/project';
import { projectFromHash, songLink } from '../../../src/store/shareLink';
import { toAgentSong, agentNotes, type AgentSong } from '../../../src/agent/agentSong';
import { diffSongs, rangesWords } from '../../../src/agent/songDiff';
import { applyOps } from '../../../src/agent/ops';
import { classifySuggestion, parseSuggestionFile } from '../../../src/agent/suggestion';
import { fingerprint, firstDifference, stableJson } from '../../../src/agent/fingerprint';
import { listInserts, listInstruments, listMaster, listParams, listPresets, listStarters } from '../../../src/agent/catalog';
import { createLoudnessAnalyser, shortTermWindowFull } from '../../../src/audio/loudness';
import { bandSpectrum, levelBetween, REGIONS, sumDb, totalBands } from '../../../src/audio/mixAnalysis';
import { readJson, readSong, readWav, sameFile, writeSong } from './files';
import { APP_VERSION } from './meta';
import { printOut } from './print';

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

export function info(args: string[], flags: Flags): number {
  const song = readSong(need(args[0], 'the song file'));
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
  const fixed = parseProject(raw);
  const problems: string[] = [];
  if (fixed.unread) problems.push(`${fixed.unread.tracks} tracks and ${fixed.unread.clips} clips can't be read and are left out when it opens.`);
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
      if (!fixed.tracks.some((t) => t.id === c.trackId)) problems.push(`Clip "${c.name}" belongs to no track: it's left out.`);
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
  if (!what || !lists[what]) throw new UsageError(`list what? ${Object.keys(lists).join(', ')}`);
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
  const fresh = classifySuggestion({ touchedHashes: suggestion.touchedHashes, touchedNames: suggestion.touchedNames }, { song });
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

export function measure(args: string[], flags: Flags): number {
  const path = need(args[0], 'the WAV file');
  if (!/\.wav$/i.test(path)) throw new UsageError('measure reads WAV files (export one from Fledgetone)');
  const { sampleRate, channels } = readWav(path);
  const m = measureAudio(channels, sampleRate);
  if (flags.json) json(m);
  else if (m.silent) say([`${path}: ${clock(m.seconds)}, silent: nothing to measure.`, ...(m.note ? [`(${m.note})`] : [])].join('\n'));
  else
    say(
      [
        `${path}: ${clock(m.seconds)}, ${m.channels === 1 ? 'mono' : `${m.channels} channels`}`,
        `${loudnessText(m.lufs, m.shortTermMaxLufs, m.seconds)}, true peak ${r1(m.truePeakDbtp)} dBTP, crest ${r1(m.crestDb!)} dB`,
        ...(m.regions.length ? ['Balance (each part of the spectrum against the whole):', ...m.regions.map((x) => `  ${x.name.padEnd(26)} ${db(x.db)}`)] : []),
        ...(m.note ? [`(Note: ${m.note}.)`] : []),
      ].join('\n')
    );
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
