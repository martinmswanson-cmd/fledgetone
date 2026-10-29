/**
 * `fledgetone mcp`: the agent's tools, as an MCP server on stdio (stdout carries only the
 * protocol; everything else goes to stderr). Two ways to work:
 *
 * - File mode: tools given a `file` read a song from the folder the helper was started for
 *   (--root, the current folder by default), and `suggest` with `file` and `out` writes a
 *   suggestion file there for `fledgetone apply` (or, later, the studio) to take in. `listen`
 *   with a file and `render_file` render it on this computer, in a headless browser, by the
 *   app's own export (renderCommands.ts, browserRender.ts).
 * - Live mode: the musician pairs the studio (connect_studio gives the code), and the tools read
 *   the song as it is on screen and put suggestions on the studio's Suggestions panel, where the
 *   musician hears them before and after and accepts or dismisses them. There is no accept tool:
 *   only the musician accepts.
 *
 * The helper enforces the agent's limits (LIMITS in protocol.ts); the studio enforces its own and
 * what the musician allowed.
 */
import { existsSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toAgentSong, agentNotes, agentAutomation } from '../../../src/agent/agentSong';
import { applyOps, checkOpsShape, OPS_VERSION } from '../../../src/agent/ops';
import { diffSongs } from '../../../src/agent/songDiff';
import { makeSuggestionFile, SUGGESTION_FORMAT } from '../../../src/agent/suggestion';
import { previewOps } from '../../../src/agent/studioReads';
import { LIMITS, RateLimiter, type StudioMethod } from '../../../src/agent/protocol';
import { listInserts, listInstruments, listMaster, listParams, listPresets, listStarters } from '../../../src/agent/catalog';
import { BridgeError, BridgeServer, DEFAULT_PORT, NOT_CONNECTED } from './bridgeServer';
import { fileInRoot, readJson, readSong, sameFile, writeJson } from './files';
import { checkProblems, suggestionIdBase } from './commands';
import { AGENT_DOC, APP_VERSION } from './meta';
import { audioFormatOf, opsToHear, listenSongFile, renderSongFile, secondsBetween, songEndBar } from './renderCommands';
import type { BrowserOptions } from './browserRender';

export interface McpOptions {
  root: string;
  bridge: BridgeServer;
  /** How song files are rendered and listened to (render_file, listen with a file). */
  render?: BrowserOptions;
}

/** The longest render_file makes, seconds (a song; listen keeps to LIMITS.listenMaxSeconds). */
export const RENDER_FILE_MAX_SECONDS = 600;

const SONG_TYPES = ['.fledgetone.json', '.json'];

const ok = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });

/** Run a tool's body, turning thrown errors into tool errors in plain words. */
async function guard(body: () => unknown): Promise<CallToolResult> {
  try {
    const out = await body();
    return out && typeof out === 'object' && 'content' in (out as object) ? (out as CallToolResult) : ok(out);
  } catch (err) {
    if (err instanceof BridgeError) return fail(err.code === 'not_connected' ? NOT_CONNECTED : `The studio: ${err.message}`);
    return fail((err as Error).message || String(err));
  }
}

const opsSchema = z.array(z.record(z.string(), z.unknown())).max(LIMITS.maxOps).describe('The ops, version 1 (see the fledgetone://docs/ops resource). Ids may be "$name" refs to things earlier ops made with ref.');

export const SERVER_INSTRUCTIONS = `Fledgetone is a music studio. These tools let you read a song and suggest changes to it; the musician hears each suggestion before and after, then accepts or dismisses it. You never change the song yourself.

Two ways to work: with files (pass "file" to read a .fledgetone.json song from the working folder; suggest with "file" and "out" writes a suggestion file), or live with the studio (call connect_studio, tell the musician the code, call connect_studio again with waitSeconds to wait for them; then get_song reads the song on screen and suggest puts a suggestion on their Suggestions panel).

With files you can also hear the song without the studio: listen with "file" measures bars of it (with "suggestion" or "ops", before and after), and render_file writes a WAV or MP3 file, both rendered on this computer as the app's Export renders.

Read the fledgetone://docs/ops resource for the ops and their units before you suggest. Try ops with preview_suggestion first. Keep suggestions small and say why in plain words.`;

/** The MCP server with every tool and resource. */
export function createMcpServer({ root, bridge, render = {} }: McpOptions): McpServer {
  const server = new McpServer({ name: 'fledgetone', version: APP_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  const songFile = (file: string) => readSong(fileInRoot(root, file, { types: SONG_TYPES, mustExist: true }));
  const live = (method: StudioMethod, params: Record<string, unknown> = {}, timeoutMs?: number) => bridge.request(method, params, timeoutMs);
  const needStudio = () => {
    if (!bridge.isPaired) throw new BridgeError('not_connected', NOT_CONNECTED);
  };
  const limited = (limiter: RateLimiter, what: string) => {
    const wait = limiter.take();
    if (wait) throw new Error(`Too many ${what} calls: try again in ${Math.ceil(wait / 100) / 10} seconds.`);
  };

  const getSongRate = new RateLimiter(LIMITS.getSongPerSecond, 1000);
  const suggestRate = new RateLimiter(1, LIMITS.suggestEveryMs);
  const listenRate = new RateLimiter(LIMITS.listensPerMinute, 60_000);
  const pointRate = new RateLimiter(1, LIMITS.pointAtEveryMs);
  const sayRate = new RateLimiter(1, LIMITS.sayEveryMs);
  let listening = false;

  // ---------- The connection ----------

  server.registerTool(
    'studio_status',
    { title: 'Studio status', description: 'Whether a studio is connected, what the musician lets you do, and how many of your suggestions are waiting.', inputSchema: {}, annotations: { readOnlyHint: true } },
    () =>
      guard(() => ({
        ...bridge.status(),
        permissions: bridge.permissions(),
        waitingSuggestions: waitingSuggestions(),
        files: root,
        ...(bridge.isPaired ? {} : { hint: 'Call connect_studio to pair with the studio, or pass "file" to the tools to work with song files.' }),
      }))
  );

  server.registerTool(
    'connect_studio',
    {
      title: 'Connect to the studio',
      description:
        'Get a pairing code for the musician to type in Fledgetone ("Let an agent connect…"). Call it once with waitSeconds 0 to get the code and tell the musician (say it as it is, e.g. K7QM-3XPD-9TBW); then call it again with waitSeconds (up to 60) to wait for them. The same code is kept until it is used or expires (10 minutes); newCode asks for another.',
      inputSchema: { waitSeconds: z.number().min(0).max(LIMITS.connectWaitMaxSeconds).optional(), newCode: z.boolean().optional() },
    },
    ({ waitSeconds, newCode }) =>
      guard(async () => {
        if (bridge.isPaired) return { ...bridge.status(), connected: true };
        const { code, expiresAt } = bridge.pairingCode(newCode === true);
        const port = bridge.port;
        const say = `Open Fledgetone, choose "Let an agent connect…" and type the code ${code}${port !== DEFAULT_PORT ? ` (with the port set to ${port})` : ''}.`;
        if (waitSeconds) {
          const connected = await bridge.waitForPairing(waitSeconds * 1000);
          return connected ? { ...bridge.status(), connected: true } : { connected: false, code, expiresAt, port, say, hint: 'Not paired yet: call again to keep waiting.' };
        }
        return { connected: false, code, expiresAt, port, say };
      })
  );

  // ---------- Reading ----------

  server.registerTool(
    'get_song',
    {
      title: 'Read the song',
      description: 'The song as a compact summary (schema fledgetone.agent-song/1): tempo, key, sections, markers, tracks with their mix and inserts, clips with their ids. Live from the studio, or from a song file with "file".',
      inputSchema: { file: z.string().optional().describe('A .fledgetone.json file in the working folder (file mode)') },
      annotations: { readOnlyHint: true },
    },
    ({ file }) =>
      guard(() => {
        if (file) return toAgentSong(songFile(file), { appVersion: APP_VERSION });
        needStudio();
        limited(getSongRate, 'get_song');
        return live('get_song');
      })
  );

  server.registerTool(
    'get_notes',
    {
      title: 'Read notes',
      description: `Notes with their ids (for change_notes and remove_notes), in song order: of a track, a clip, or starting in a range of song bars (toBar not included). At most ${2000} at a time: pass "next" back as "cursor" for more.`,
      inputSchema: { file: z.string().optional(), trackId: z.string().optional(), clipId: z.string().optional(), fromBar: z.number().optional(), toBar: z.number().optional(), cursor: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ file, ...q }) =>
      guard(() => {
        if (file) return agentNotes(songFile(file), q);
        needStudio();
        return live('get_notes', q);
      })
  );

  server.registerTool(
    'get_automation',
    {
      title: 'Read automation',
      description: 'Automation lanes with every point (bar, value 0 to 1, curve): all of them, a track’s, or one setting’s.',
      inputSchema: { file: z.string().optional(), trackId: z.string().optional(), param: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ file, ...q }) =>
      guard(() => {
        if (file) return { lanes: agentAutomation(songFile(file), q) };
        needStudio();
        return live('get_automation', q);
      })
  );

  server.registerTool(
    'get_view',
    { title: 'What the musician sees', description: 'What the musician has open and selected in the studio (if they allow it), and where the playhead is.', inputSchema: {}, annotations: { readOnlyHint: true } },
    () =>
      guard(() => {
        needStudio();
        return live('get_view');
      })
  );

  server.registerTool(
    'wait_for_changes',
    {
      title: 'Wait for changes',
      description: `Wait (up to ${LIMITS.waitForChangesMaxSeconds} seconds) for something to happen in the studio: an edit (with its new revision), a selection, a suggestion accepted or dismissed, pairing or disconnecting. Pass the "last" you got back as "since" next time.`,
      inputSchema: { since: z.number().int().min(0).optional(), timeoutSeconds: z.number().min(0).max(LIMITS.waitForChangesMaxSeconds).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ since, timeoutSeconds }) => guard(() => bridge.waitForEvents(since ?? 0, (timeoutSeconds ?? 10) * 1000))
  );

  server.registerTool(
    'listen',
    {
      title: 'Listen',
      description: `Render a stretch of the song and measure it: loudness (LUFS), true peak, crest, balance across the spectrum, what the master's limiter and clipper did, the loudness bar by bar, and findings in plain words. At most ${LIMITS.listenMaxBars} bars or ${LIMITS.listenMaxSeconds} seconds, one at a time, ${LIMITS.listensPerMinute} a minute (toBar not included). Live: in the studio (the musician must allow listening); with suggestionId (or ops) it measures the song as that suggestion would make it. With "file": a song file in the working folder, rendered on this computer with no studio open; perTrack adds each track's own loudness and balance (and the mix findings that name tracks), and "suggestion" (a suggestion file) or "ops" gives a before-and-after: both reports and the difference bar by bar, so you can tell which bars change.`,
      inputSchema: {
        file: z.string().optional(),
        fromBar: z.number().min(1),
        toBar: z.number().min(1),
        perTrack: z.boolean().optional().describe('File mode: each track measured too'),
        suggestion: z.string().optional().describe('File mode: a suggestion file (.json) in the working folder, to hear before and after'),
        suggestionId: z.string().optional(),
        ops: opsSchema.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ file, fromBar, toBar, perTrack, suggestion, suggestionId, ops }) =>
      guard(async () => {
        if (toBar <= fromBar) throw new Error('toBar must come after fromBar (toBar not included).');
        if (toBar - fromBar > LIMITS.listenMaxBars) throw new Error(`At most ${LIMITS.listenMaxBars} bars at a time.`);
        if ([suggestionId, ops, suggestion].filter((x) => x !== undefined).length > 1) throw new Error('Give one of suggestionId, suggestion or ops.');
        if (file) {
          if (suggestionId) throw new Error('suggestionId is a suggestion on the studio’s panel: with a file, give "suggestion" (a suggestion file) or "ops".');
          const songPath = fileInRoot(root, file, { types: SONG_TYPES, mustExist: true });
          const song = readSong(songPath);
          const hearWith = suggestion ? opsToHear(song, { suggestion: fileInRoot(root, suggestion, { types: ['.json'], mustExist: true }) }) : ops ? { ops, idBase: 'listen' } : null;
          if (listening) throw new Error('One listen at a time: wait for the one under way.');
          limited(listenRate, 'listen');
          listening = true;
          try {
            return await listenSongFile(songPath, { fromBar, toBar, perTrack, with: hearWith, limits: { maxBars: LIMITS.listenMaxBars, maxSeconds: LIMITS.listenMaxSeconds } }, render);
          } finally {
            listening = false;
          }
        }
        if (perTrack || suggestion) throw new Error('perTrack and suggestion files are for listening to a file (give "file"); the studio’s listen measures the mix.');
        needStudio();
        if (listening) throw new Error('One listen at a time: wait for the one under way.');
        limited(listenRate, 'listen');
        listening = true;
        try {
          return await live('listen', { fromBar, toBar, ...(suggestionId ? { suggestionId } : {}), ...(ops ? { opsVersion: OPS_VERSION, ops } : {}) }, LIMITS.listenTimeoutMs);
        } finally {
          listening = false;
        }
      })
  );

  server.registerTool(
    'render_file',
    {
      title: 'Render a song file',
      description: `Render a song file in the working folder to a WAV or MP3 file there, as the app's Export makes it (on this computer, no studio needed): the whole song, or bars fromBar to toBar (toBar not included). At most ${RENDER_FILE_MAX_SECONDS / 60} minutes of audio, one render or listen at a time. Gives back the file's length, loudness and true peak. It never writes over a file unless overwrite is true, and only .wav and .mp3 files.`,
      inputSchema: {
        file: z.string(),
        out: z.string().describe('The .wav or .mp3 file to write, in the working folder'),
        fromBar: z.number().min(1).optional(),
        toBar: z.number().min(1).optional(),
        format: z.enum(['wav', 'mp3']).optional().describe('Default: from the extension of out'),
        sampleRate: z.union([z.literal(44100), z.literal(48000)]).optional(),
        bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]).optional().describe('WAV: 16, 24 (default) or 32 (float)'),
        overwrite: z.boolean().optional(),
      },
    },
    ({ file, out, fromBar, toBar, format, sampleRate, bitDepth, overwrite }) =>
      guard(async () => {
        const songPath = fileInRoot(root, file, { types: SONG_TYPES, mustExist: true });
        const outPath = fileInRoot(root, out, { types: ['.wav', '.mp3'], write: true });
        const kind = audioFormatOf(outPath)!;
        if (format && format !== kind) throw new Error(`"out" is a .${kind} file but format says ${format}.`);
        if (existsSync(outPath) && overwrite !== true) throw new Error(`${out} exists: choose another name, or pass overwrite: true.`);
        if ((fromBar === undefined) !== (toBar === undefined)) throw new Error('Give both fromBar and toBar, or neither (the whole song).');
        const song = readSong(songPath);
        const from = fromBar ?? 1;
        const to = toBar ?? songEndBar(song);
        if (to <= from) throw new Error(fromBar === undefined ? 'The song has no clips on a track that sounds: there is nothing to render.' : 'toBar must come after fromBar.');
        if (secondsBetween(song, from, to) > RENDER_FILE_MAX_SECONDS) throw new Error(`At most ${RENDER_FILE_MAX_SECONDS / 60} minutes at a time: give fromBar and toBar.`);
        if (listening) throw new Error('One render or listen at a time: wait for the one under way.');
        listening = true;
        try {
          const done = await renderSongFile(
            { song: songPath, out: { path: outPath, format: kind }, ...(fromBar !== undefined ? { fromBar, toBar } : {}), sampleRate: sampleRate ?? 44100, bitDepth: bitDepth ?? 24, overwrite: overwrite === true },
            render
          );
          const r = done.mix!;
          return { written: out, seconds: r.seconds, range: r.range, format: r.format, sampleRate: r.sampleRate, bitDepth: r.bitDepth, lufs: r.lufs, truePeakDbtp: r.truePeakDbtp, target: r.target, notes: r.notes };
        } finally {
          listening = false;
        }
      })
  );

  // ---------- Suggesting ----------

  const suggestions = new Map<string, string>();
  const waitingSuggestions = () => [...suggestions.values()].filter((s) => s === 'waiting' || s === 'changed').length;
  bridge.subscribe((e) => {
    if (e.event === 'suggestion' && e.params && typeof e.params === 'object') {
      const { id, status } = e.params as { id?: unknown; status?: unknown };
      if (typeof id === 'string' && typeof status === 'string') suggestions.set(id, status);
    }
    if (e.event === 'disconnected') suggestions.clear();
  });

  server.registerTool(
    'suggest',
    {
      title: 'Suggest a change',
      description: `Suggest a change as ops. Live: it goes on the musician's Suggestions panel with your title and explanation; they hear it before and after and accept or dismiss it (wait_for_changes tells you which). At most ${LIMITS.waitingSuggestions} waiting at once, one every ${LIMITS.suggestEveryMs / 1000} seconds, ${LIMITS.maxOps} ops and ${LIMITS.maxAddedNotes} added notes. File mode: with "file" (the song) and "out" (a .json file to write), it writes a suggestion file the musician can apply with \`fledgetone apply\`.`,
      inputSchema: {
        title: z.string().min(1).max(LIMITS.titleMaxChars),
        explanation: z.string().max(LIMITS.explanationMaxChars).describe('Why, in plain words: what the musician will hear.'),
        ops: opsSchema,
        focus: z.object({ fromBar: z.number(), toBar: z.number() }).optional().describe('The bars to play the before-and-after over (else the touched bars and one before)'),
        file: z.string().optional(),
        out: z.string().optional(),
      },
    },
    ({ title, explanation, ops, focus, file, out }) =>
      guard(async () => {
        const shape = checkOpsShape({ opsVersion: OPS_VERSION, ops });
        if (shape.length) return fail(`The ops can't be read:\n${shape.map((e) => `- ${e.path || 'ops'}: ${e.message}`).join('\n')}`);
        if (file || out) {
          if (!file || !out) throw new Error('File mode needs both "file" (the song) and "out" (the suggestion file to write).');
          const songPath = fileInRoot(root, file, { types: SONG_TYPES, mustExist: true });
          const outPath = fileInRoot(root, out, { types: ['.json'], write: true });
          if (outPath.toLowerCase().endsWith('.fledgetone.json') || outPath.toLowerCase() === songPath.toLowerCase() || sameFile(outPath, songPath)) throw new Error('"out" is a suggestion file (name it like change.suggestion.json), never the song itself.');
          if (existsSync(outPath)) {
            const old = (() => {
              try {
                return readJson(outPath) as { format?: unknown };
              } catch {
                return null;
              }
            })();
            if (old?.format !== SUGGESTION_FORMAT) throw new Error(`${out} exists and isn't a suggestion file: choose another name.`);
          }
          const song = readSong(songPath);
          const result = applyOps(song, { opsVersion: OPS_VERSION, ops }, { idBase: suggestionIdBase(ops) });
          if (!result.ok) return fail(`The suggestion can't be applied:\n${result.errors.map((e) => `- op ${e.op}${e.path ? ` (${e.path})` : ''}: ${e.message}`).join('\n')}`);
          writeJson(outPath, makeSuggestionFile(song, { title, explanation, ops: ops as never }));
          return { written: out, apply: `fledgetone apply ${file} ${out} -o <new song>.fledgetone.json`, changes: result.diff.changes.map((c) => c.text), warnings: result.warnings, notes: result.notes, audition: focus ?? result.diff.audition };
        }
        needStudio();
        if (waitingSuggestions() >= LIMITS.waitingSuggestions) throw new Error(`${LIMITS.waitingSuggestions} suggestions are already waiting for the musician: wait for them to accept or dismiss some, or withdraw one.`);
        limited(suggestRate, 'suggest');
        const res = (await live('suggest', { title, explanation, opsVersion: OPS_VERSION, ops, ...(focus ? { focus } : {}) })) as { id?: unknown };
        if (res && typeof res.id === 'string') suggestions.set(res.id, 'waiting');
        return res;
      })
  );

  server.registerTool(
    'preview_suggestion',
    {
      title: 'Try ops',
      description: 'A dry run: what the ops would change, in plain words, with warnings and the bars to listen to, or the errors that stop them. Nothing is changed or shown to the musician.',
      inputSchema: { ops: opsSchema, file: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ ops, file }) =>
      guard(() => {
        if (file) return previewOps(songFile(file), ops);
        needStudio();
        return live('preview_suggestion', { ops });
      })
  );

  server.registerTool(
    'get_suggestion',
    {
      title: 'A suggestion’s status',
      description: 'A suggestion you made (or, without id, all of yours): waiting, accepted, dismissed, out of date (the song changed under it), or changed (the song changed elsewhere: the musician should listen again).',
      inputSchema: { id: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      guard(() => {
        needStudio();
        return live('get_suggestion', id ? { id } : {});
      })
  );

  server.registerTool(
    'withdraw_suggestion',
    { title: 'Withdraw a suggestion', description: 'Take back a suggestion that is still waiting.', inputSchema: { id: z.string() } },
    ({ id }) =>
      guard(async () => {
        needStudio();
        const res = await live('withdraw_suggestion', { id });
        suggestions.set(id, 'withdrawn');
        return res;
      })
  );

  server.registerTool(
    'say',
    {
      title: 'Say something',
      description: `A short message to the musician on the Suggestions panel (plain text, at most ${LIMITS.sayMaxChars} characters, one a second). "about" ties it to a suggestion.`,
      inputSchema: { text: z.string().min(1).max(LIMITS.sayMaxChars), about: z.string().optional() },
    },
    ({ text, about }) =>
      guard(() => {
        needStudio();
        limited(sayRate, 'say');
        return live('say', { text, ...(about ? { about } : {}) });
      })
  );

  server.registerTool(
    'point_at',
    {
      title: 'Point at something',
      description: 'Highlight something in the studio for the musician: a track, a clip, a range of bars, a marker, or a control (by its name in the studio). One a second.',
      inputSchema: {
        target: z
          .object({ track: z.string().optional(), clip: z.string().optional(), bars: z.object({ fromBar: z.number(), toBar: z.number() }).optional(), marker: z.string().optional(), control: z.string().optional() })
          .describe('Exactly one of track, clip, bars, marker or control'),
        note: z.string().max(200).optional(),
      },
    },
    ({ target, note }) =>
      guard(() => {
        const given = Object.entries(target).filter(([, v]) => v !== undefined);
        if (given.length !== 1) throw new Error('Point at exactly one thing: track, clip, bars, marker or control.');
        needStudio();
        limited(pointRate, 'point_at');
        return live('point_at', { target: Object.fromEntries(given), ...(note ? { note } : {}) });
      })
  );

  // ---------- Lists and files ----------

  const listTool = (name: string, title: string, description: string, fn: (query?: string) => unknown) =>
    server.registerTool(name, { title, description, inputSchema: { query: z.string().optional() }, annotations: { readOnlyHint: true } }, ({ query }) => guard(() => fn(query)));
  listTool('list_instruments', 'Instruments', 'The instruments: key (for add_track and set_instrument), name, category, playable range, and whether a suggestion may add it.', (q) => listInstruments(q));
  listTool('list_presets', 'Synth presets', 'The Synth Designer presets, for set_synth_preset.', (q) => listPresets(q));
  listTool('list_starters', 'Starters', 'The starter songs (fledgetone new --starter <id> makes one as a file).', (q) => listStarters(q));
  listTool('list_params', 'Automatable settings', 'The settings an automation lane can drive (param for set_automation).', (q) => listParams(q));
  listTool('list_inserts', 'Inserts', 'Each insert (for set_insert) with its settings, defaults and ranges.', (q) => listInserts(q));
  listTool('list_master', 'Master settings', 'The master section’s settings for set_master, with defaults and ranges.', () => listMaster());

  server.registerTool(
    'check_file',
    { title: 'Check a song file', description: 'What the app would change when it opens a song file (values out of range, parts it can’t read). Empty: it opens as it is.', inputSchema: { file: z.string() }, annotations: { readOnlyHint: true } },
    ({ file }) =>
      guard(() => {
        const path = fileInRoot(root, file, { types: SONG_TYPES, mustExist: true });
        readSong(path);
        return { ok: true, problems: checkProblems(readJson(path)).problems };
      })
  );

  server.registerTool(
    'diff_files',
    { title: 'Compare two songs', description: 'What changed from one song file to another, in plain words.', inputSchema: { a: z.string(), b: z.string() }, annotations: { readOnlyHint: true } },
    ({ a, b }) =>
      guard(() => {
        const d = diffSongs(songFile(a), songFile(b));
        return { changes: d.changes.map((c) => c.text), bars: d.bars };
      })
  );

  // ---------- Resources ----------

  server.registerResource('ops-guide', 'fledgetone://docs/ops', { title: 'The agent guide: ops, the song summary, the connection', mimeType: 'text/markdown' }, (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: AGENT_DOC }] }));
  const liveResource = (name: string, uri: string, title: string, method: StudioMethod) =>
    server.registerResource(name, uri, { title, mimeType: 'application/json' }, async (u) => {
      if (!bridge.isPaired) throw new Error(NOT_CONNECTED);
      return { contents: [{ uri: u.href, mimeType: 'application/json', text: JSON.stringify(await live(method), null, 2) }] };
    });
  liveResource('studio-song', 'fledgetone://studio/song', 'The song on screen', 'get_song');
  liveResource('studio-view', 'fledgetone://studio/view', 'What the musician sees', 'get_view');
  liveResource('studio-suggestions', 'fledgetone://studio/suggestions', 'Your suggestions and their status', 'get_suggestion');

  return server;
}
