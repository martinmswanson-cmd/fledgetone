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
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { toAgentSong, agentNotes, agentAutomation } from '../../../src/agent/agentSong';
import { applyOps, checkOpsShape, OPS_VERSION } from '../../../src/agent/ops';
import { diffSongs } from '../../../src/agent/songDiff';
import { makeSuggestionFile, NO_CHANGE, SUGGESTION_FORMAT } from '../../../src/agent/suggestion';
import { previewOps } from '../../../src/agent/studioReads';
import { LIMITS, RateLimiter, type StudioMethod } from '../../../src/agent/protocol';
import { agentText, cleanForAgent } from '../../../src/agent/agentText';
import { listInserts, listInstruments, listMaster, listParams, listPresets, listStarters } from '../../../src/agent/catalog';
import { BridgeError, BridgeServer, DEFAULT_PORT, NOT_CONNECTED, portTakenMessage } from './bridgeServer';
import { fileInRoot, readJson, readSong, sameFile, writeJson } from './files';
import { AUDIO_TYPES, UsageError, againstOf, checkProblems, hearAudioFile, hearPlan, suggestionIdBase, type Flags } from './commands';
import { AGENT_DOC, APP_VERSION } from './meta';
import { Conversation, CONVERSATION_INSTRUCTIONS, registerConversationTools } from './conversation';
import { audioFormatOf, opsToHear, listenPlan, listenSongFile, renderSongFile, secondsBetween, songEndBar, type ListenHearing } from './renderCommands';
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

// Every answer made plain (cleanForAgent): what comes from a song file or the studio (names, ids,
// the words built from them) never carries hidden text or control characters to the agent
/** The tool results made here (ok and fail): only these go to the agent as they are. */
const made = new WeakSet<CallToolResult>();
const mark = (r: CallToolResult): CallToolResult => (made.add(r), r);
const ok = (value: unknown): CallToolResult => mark({ content: [{ type: 'text', text: typeof value === 'string' ? agentText(value) : JSON.stringify(cleanForAgent(value), null, 2) }] });
const fail = (message: string): CallToolResult => mark({ isError: true, content: [{ type: 'text', text: agentText(message) }] });

/**
 * Run a tool's body, turning thrown errors into tool errors in plain words. Whatever it returns
 * is made plain (ok), unless it's a result ok or fail made: an answer that only looks like a tool
 * result (an object with "content", from the studio or a file) is cleaned like any other.
 */
async function guard(body: () => unknown): Promise<CallToolResult> {
  try {
    const out = await body();
    return out && typeof out === 'object' && made.has(out as CallToolResult) ? (out as CallToolResult) : ok(out);
  } catch (err) {
    if (err instanceof BridgeError) return fail(err.code === 'not_connected' ? NOT_CONNECTED : `The studio: ${err.message}`);
    return fail((err as Error).message || String(err));
  }
}


/** The most pictures a reply attaches as images, and the most PNG bytes in all (the rest are named in the text by path). */
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Where a picture goes among the images attached: the spectrogram, the difference, close-ups, the level picture, the spectrum; others are named only. */
function imageRank(name: string): number {
  const n = name.replace(/^(?:before|after)-/, '');
  if (n.startsWith('spectrogram')) return 0;
  if (n.startsWith('difference')) return 1;
  if (n.startsWith('closeup')) return 2;
  if (n.startsWith('level')) return 3;
  if (n.startsWith('spectrum')) return 4;
  return 5;
}

/**
 * Which pictures a reply attaches as images: in the order spectrogram, difference, close-ups, level,
 * spectrum (the others are only named), at most six and 3 MB in all; it stops at the first that
 * would pass a limit. Everything not attached is returned too, so the text can name it.
 */
export function pickImages<T extends { name: string; size: number }>(pictures: readonly T[]): { attached: T[]; notAttached: T[] } {
  const ranked = pictures.map((p, i) => ({ p, i })).filter(({ p }) => imageRank(p.name) < 5).sort((a, b) => imageRank(a.p.name) - imageRank(b.p.name) || a.i - b.i);
  const attached: T[] = [];
  let total = 0;
  for (const { p } of ranked) {
    if (attached.length >= MAX_IMAGES || total + p.size > MAX_IMAGE_BYTES) break;
    attached.push(p);
    total += p.size;
  }
  return { attached, notAttached: pictures.filter((p) => !attached.includes(p)) };
}

/** The names of the hearing options as the tool's inputs spell them, in place of the command line's. */
const askedFor = (err: unknown): unknown =>
  err instanceof UsageError
    ? new Error(
        err.message
          .replace(/--against-from/g, 'againstFromSeconds')
          .replace(/--against-to/g, 'againstToSeconds')
          .replace(/--close/g, 'closeUps')
          .replace(/--against/g, 'against')
          .replace(/--pictures/g, 'pictures')
          .replace(/--save/g, 'save')
          .replace(/--bpm/g, 'bpm')
          .replace(/--from/g, 'fromSeconds')
          .replace(/--to/g, 'toSeconds')
      )
    : err;

type Pic = { name: string; path: string; bytes?: number };
const isPic = (v: unknown): v is Pic => !!v && typeof v === 'object' && typeof (v as Pic).path === 'string' && typeof (v as Pic).name === 'string' && 'shows' in v;

const opsSchema = z.array(z.record(z.string(), z.unknown())).max(LIMITS.maxOps).describe('The ops, version 1 (see the fledgetone://docs/ops resource). Ids may be "$name" refs to things earlier ops made with ref.');

export const SERVER_INSTRUCTIONS = `Fledgetone is a music studio. These tools let you read a song and suggest changes to it; the musician hears each suggestion before and after, then accepts or dismisses it. You never change the song yourself.

Two ways to work: with files (pass "file" to read a .fledgetone.json song from the working folder; suggest with "file" and "out" writes a suggestion file), or live with the studio (call connect_studio, tell the musician the code, call connect_studio again with waitSeconds to wait for them; then get_song reads the song on screen and suggest puts a suggestion on their Suggestions panel).

With files you can also hear the song without the studio: listen with "file" measures bars of it (with "suggestion" or "ops", before and after), and render_file writes a WAV or MP3 file, both rendered on this computer as the app's Export renders.

listen with a file and hear_audio can also describe a sound's character (bright, dark, gritty, wide...) and return pictures of it: a spectrogram, a level picture, close-ups of moments you name.

Read the fledgetone://docs/ops resource for the ops and their units before you suggest. Try ops with preview_suggestion first. Keep suggestions small and say why in plain words.`;

/** The MCP server with every tool and resource. */
export function createMcpServer({ root, bridge, render = {} }: McpOptions): McpServer {
  const server = new McpServer({ name: 'fledgetone', version: APP_VERSION }, { instructions: `${SERVER_INSTRUCTIONS}\n\n${CONVERSATION_INSTRUCTIONS}` });
  const conversation = new Conversation(bridge);

  const songFile = (file: string) => readSong(fileInRoot(root, file, { types: SONG_TYPES, mustExist: true }));
  const live = (method: StudioMethod, params: Record<string, unknown> = {}, timeoutMs?: number) => bridge.request(method, params, timeoutMs);
  const needStudio = () => {
    if (!bridge.isPaired) throw new BridgeError('not_connected', NOT_CONNECTED);
  };
  const limited = (limiter: RateLimiter, what: string) => {
    const wait = limiter.take();
    if (wait) throw new Error(`Too many ${what} calls: try again in ${Math.ceil(wait / 100) / 10} seconds.`);
  };

  /**
   * A folder for pictures inside the root (made when a picture is written): links followed, it must
   * be inside the root, and it must be the pictures' own (new, empty, or holding only .png files),
   * since pictures of the same names are written over.
   */
  const folderInRoot = (folder: string): string => {
    const realRoot = realpathSync.native(root);
    const outside = () => new Error(`pictures ${folder} is outside the folder the helper works in.`);
    let probe = resolve(realRoot, folder);
    const fresh: string[] = [];
    for (;;) {
      let st = lstatSync(probe, { throwIfNoEntry: false });
      if (st?.isSymbolicLink()) {
        // (a link is followed; one that leads nowhere is an escape)
        try {
          probe = realpathSync.native(probe);
        } catch {
          throw outside();
        }
        st = lstatSync(probe);
      }
      if (st) break;
      fresh.unshift(basename(probe));
      const up = dirname(probe);
      if (up === probe) break;
      probe = up;
    }
    const real = realpathSync.native(probe);
    const rel = relative(realRoot, real);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw outside();
    if (!statSync(real).isDirectory()) throw new Error(`pictures ${folder} is a file.`);
    if (!fresh.length && readdirSync(real, { withFileTypes: true }).some((e) => !e.isFile() || !/\.png$/i.test(e.name))) throw new Error(`pictures needs a folder of its own: ${folder} holds other files.`);
    return join(real, ...fresh);
  };
  /** A path made by a hearing, as the agent names it: relative to the root. */
  const inRoot = (path: string) => relative(realpathSync.native(root), path).split(sep).join('/');
  const underRoot = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(underRoot);
    if (!value || typeof value !== 'object') return value;
    const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, underRoot(v)]));
    return isPic(value) ? { ...out, path: inRoot(value.path) } : out;
  };
  /** A hearing's report as text (every picture named with its path), then up to six of its pictures as images, 3 MB in all. */
  const withImages = (report: Record<string, unknown>, shown: readonly Pic[]): CallToolResult => {
    const { attached, notAttached } = pickImages(shown.map((p) => ({ ...p, size: p.bytes ?? statSync(p.path).size })));
    const images = attached.map((p) => ({ type: 'image' as const, data: readFileSync(p.path).toString('base64'), mimeType: 'image/png' as const }));
    const result = ok(shown.length ? { ...(underRoot(report) as object), pictureImages: { attached: attached.map((p) => inRoot(p.path)), notAttached: notAttached.map((p) => inRoot(p.path)) } } : underRoot(report));
    result.content.push(...images);
    return result;
  };
  /** The checked inputs of a hearing: the options in the command line's own words, so `hearPlan` and `listenPlan` check them as they check the command line. */
  const hearingInputs = (o: { pictures?: string; closeUps?: Array<string | number>; against?: string; againstFromSeconds?: number; againstToSeconds?: number; save?: string; sound?: boolean }): Flags => {
    const save = o.save === undefined ? undefined : fileInRoot(root, o.save, { types: ['.json'], write: true });
    if (save && existsSync(save)) throw new Error(`${o.save} already exists: choose another name.`);
    return {
      ...(o.sound ? { sound: true } : {}),
      ...(o.pictures !== undefined ? { pictures: folderInRoot(o.pictures) } : {}),
      ...(o.closeUps?.length ? { close: o.closeUps.map(String) } : {}),
      ...(o.against !== undefined ? { against: fileInRoot(root, o.against, { types: [...AUDIO_TYPES, '.json'], mustExist: true }) } : {}),
      ...(o.againstFromSeconds !== undefined ? { 'against-from': String(o.againstFromSeconds) } : {}),
      ...(o.againstToSeconds !== undefined ? { 'against-to': String(o.againstToSeconds) } : {}),
      ...(save !== undefined ? { save } : {}),
    };
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
        // The port taken when the helper started: try it again (it isn't swapped for another by itself)
        const port = await bridge.tryListen();
        if (!port) throw new Error(portTakenMessage(bridge.portTaken ?? DEFAULT_PORT));
        const { code, expiresAt } = bridge.pairingCode(newCode === true);
        // (always the port: the studio dials the one in its box, and pairing works only on the helper's own)
        const say = `Open Fledgetone, choose "Let an agent connect…", type the code ${code} and check the port is ${port}${port !== DEFAULT_PORT ? ' (not the usual one)' : ''}.`;
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
      description: `Wait (up to ${LIMITS.waitForChangesMaxSeconds} seconds) for something to happen in the studio: an edit (with its new revision), a selection, a suggestion accepted or dismissed, a message from the musician (user_message: answer it with say and replyTo), pairing or disconnecting. Pass the "last" you got back as "since" next time.`,
      inputSchema: { since: z.number().int().min(0).optional(), timeoutSeconds: z.number().min(0).max(LIMITS.waitForChangesMaxSeconds).optional() },
      annotations: { readOnlyHint: true },
    },
    ({ since, timeoutSeconds }) =>
      guard(async () => {
        const out = await bridge.waitForEvents(since ?? 0, (timeoutSeconds ?? 10) * 1000);
        conversation.seenIn(out.events);
        return out;
      })
  );

  server.registerTool(
    'listen',
    {
      title: 'Listen',
      description: `Render a stretch of the song and measure it: loudness (LUFS), true peak, crest, balance across the spectrum, what the master's limiter and clipper did, and findings in plain words. At most ${LIMITS.listenMaxBars} bars or ${LIMITS.listenMaxSeconds} seconds, one at a time, ${LIMITS.listensPerMinute} a minute (toBar not included). Live: in the studio (the musician must allow listening); with suggestionId (or ops) it measures the song as that suggestion would make it. With "file": a song file in the working folder, rendered on this computer with no studio open, with the loudness bar by bar too; perTrack adds each track's own loudness and balance (and the mix findings that name tracks), and "suggestion" (a suggestion file) or "ops" gives a before-and-after: both reports and the difference bar by bar, so you can tell which bars change. With "file" it can also describe the sound's character in words (sound: true), write pictures of it into a folder in the working folder (pictures) and return them as images, picture moments close up (closeUps, like "9.3" for bar 9, quarter beat 3), read it against another sound (against, with the stretch of that sound) and save the hearing (save). It measures and draws; it does not hear, and the words describe without judging. It writes (pictures into the folder you name, a saved hearing) only when pictures or save is given. Nothing is sent anywhere.`,
      inputSchema: {
        file: z.string().optional(),
        fromBar: z.number().min(1),
        toBar: z.number().min(1),
        perTrack: z.boolean().optional().describe('File mode: each track measured too'),
        suggestion: z.string().optional().describe('File mode: a suggestion file (.json) in the working folder, to hear before and after'),
        suggestionId: z.string().optional(),
        ops: opsSchema.optional(),
        sound: z.boolean().optional().describe('File mode: describe the sound\'s character in words'),
        pictures: z.string().min(1).optional().describe('File mode: a folder in the working folder to write pictures in (made if it is not there); they come back as images as well. It must be a folder of its own: new, empty or holding only .png files'),
        closeUps: z.array(z.string()).max(6).optional().describe('File mode: moments to picture close up, as a bar and its quarter beat: "9.3" is bar 9, beat 3; "9" is its first beat'),
        against: z.string().optional().describe('File mode: an audio file or a saved hearing (.json) in the working folder to read this sound against (like with like)'),
        againstFromSeconds: z.number().min(0).optional().describe('File mode: the stretch of "against" to read against, from (seconds)'),
        againstToSeconds: z.number().min(0).optional().describe('File mode: the stretch of "against", to (seconds)'),
        save: z.string().optional().describe('File mode: a new .json file in the working folder to save the hearing (measurements, never audio) in'),
      },
      annotations: { readOnlyHint: false },
    },
    ({ file, fromBar, toBar, perTrack, suggestion, suggestionId, ops, sound, pictures, closeUps, against, againstFromSeconds, againstToSeconds, save }) =>
      guard(async () => {
        if (toBar <= fromBar) throw new Error('toBar must come after fromBar (toBar not included).');
        if (toBar - fromBar > LIMITS.listenMaxBars) throw new Error(`At most ${LIMITS.listenMaxBars} bars at a time.`);
        if ([suggestionId, ops, suggestion].filter((x) => x !== undefined).length > 1) throw new Error('Give one of suggestionId, suggestion or ops.');
        if (file) {
          if (suggestionId) throw new Error('suggestionId is a suggestion on the studio’s panel: with a file, give "suggestion" (a suggestion file) or "ops".');
          const songPath = fileInRoot(root, file, { types: SONG_TYPES, mustExist: true });
          const song = readSong(songPath);
          const hearWith = suggestion ? opsToHear(song, { suggestion: fileInRoot(root, suggestion, { types: ['.json'], mustExist: true }) }) : ops ? { ops, idBase: 'listen' } : null;
          let plan;
          try {
            plan = listenPlan([songPath], hearingInputs({ sound, pictures, closeUps, against, againstFromSeconds, againstToSeconds, save }));
          } catch (err) {
            throw askedFor(err);
          }
          if (listening) throw new Error('One listen at a time: wait for the one under way.');
          limited(listenRate, 'listen');
          listening = true;
          try {
            // (an audio file read against is heard here, inside the one-at-a-time hold)
            const read = plan.against ? await againstOf(plan.against, render, { fromSeconds: plan.againstFromSeconds, toSeconds: plan.againstToSeconds }) : undefined;
            const hearing: ListenHearing | undefined = plan.sound
              ? { sound: true, ...(plan.pictures !== undefined ? { pictures: plan.pictures } : {}), ...(plan.closeBars ? { closeBars: plan.closeBars } : {}), ...(read ? { against: read } : {}), ...(plan.save ? { save: plan.save } : {}) }
              : undefined;
            const result = await listenSongFile(songPath, { fromBar, toBar, perTrack, with: hearWith, ...(hearing ? { hearing } : {}), limits: { maxBars: LIMITS.listenMaxBars, maxSeconds: LIMITS.listenMaxSeconds } }, render);
            if (!hearing) return result;
            // (the mix's pictures, with a suggestion the after version's and the difference; each track's are named only)
            const reports = 'difference' in result ? [result.after] : [result];
            const shown: Pic[] = [...reports.flatMap((r) => r.pictures ?? []), ...('difference' in result ? (result.difference.pictures ?? []) : []), ...reports.flatMap((r) => (r.tracks ?? []).flatMap((t) => t.pictures ?? []))];
            return withImages(result as unknown as Record<string, unknown>, shown);
          } catch (err) {
            throw askedFor(err);
          } finally {
            listening = false;
          }
        }
        if (sound !== undefined || pictures !== undefined || closeUps !== undefined || against !== undefined || againstFromSeconds !== undefined || againstToSeconds !== undefined || save !== undefined) throw new Error('sound, pictures, closeUps, against and save are for listening to a file (give "file").');
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
    'hear_audio',
    {
      title: 'Hear an audio file',
      description: `Measure an audio file in the working folder (${AUDIO_TYPES.join(', ')}) and describe its sound in plain words: loudness, then its character (tone, level and movement over time, stereo width, rhythm, harmony, faults), with pictures of it (a spectrogram, a level picture, a spectrum, close-ups of the seconds you name in closeUps) written to a folder in the working folder and returned as images. It measures and draws; it does not hear, and the words describe without judging. Nothing is sent anywhere: no model and no outside service is involved, it is all signal maths on this computer. At most 15 minutes at a time (name a stretch with fromSeconds and toSeconds), one at a time, ${LIMITS.listensPerMinute} a minute. against reads it against another audio file or a saved hearing (.json), level-matched: compare like with like, a stretch of similar length. save writes the hearing (measurements, never audio) to a new .json file.`,
      inputSchema: {
        file: z.string().describe(`An audio file in the working folder: ${AUDIO_TYPES.join(', ')}`),
        fromSeconds: z.number().min(0).optional(),
        toSeconds: z.number().min(0).optional(),
        sound: z.boolean().optional().describe('Describe the sound\'s character in words (default true; false is the loudness and balance alone)'),
        pictures: z.string().min(1).optional().describe('A folder in the working folder to write pictures in (made if it is not there); they come back as images as well. It must be a folder of its own: new, empty or holding only .png files'),
        closeUps: z.array(z.number().min(0)).max(6).optional().describe('Moments to picture close up, in seconds from the start of the file'),
        bpm: z.number().optional().describe('The tempo, when you know it (20 to 400); it is estimated otherwise'),
        against: z.string().optional().describe('An audio file or a saved hearing (.json) in the working folder to read this against'),
        againstFromSeconds: z.number().min(0).optional(),
        againstToSeconds: z.number().min(0).optional(),
        save: z.string().optional().describe('A new .json file in the working folder to save the hearing in'),
      },
      annotations: { readOnlyHint: false },
    },
    ({ file, fromSeconds, toSeconds, sound, pictures, closeUps, bpm, against, againstFromSeconds, againstToSeconds, save }) =>
      guard(async () => {
        const path = fileInRoot(root, file, { types: [...AUDIO_TYPES], mustExist: true });
        let plan;
        try {
          plan = hearPlan([path], {
            ...hearingInputs({ sound: sound !== false, pictures, closeUps, against, againstFromSeconds, againstToSeconds, save }),
            ...(fromSeconds !== undefined ? { from: String(fromSeconds) } : {}),
            ...(toSeconds !== undefined ? { to: String(toSeconds) } : {}),
            ...(bpm !== undefined ? { bpm: String(bpm) } : {}),
          });
        } catch (err) {
          throw askedFor(err);
        }
        if (sound === false && plan.sound && pictures === undefined && against === undefined && save === undefined && !closeUps?.length) plan.sound = false;
        if (listening) throw new Error('One listen at a time: wait for the one under way.');
        limited(listenRate, 'listen');
        listening = true;
        try {
          const { written: _written, ...heard } = await hearAudioFile(plan, render);
          return withImages({ ...heard, ...(plan.save ? { saved: inRoot(plan.save) } : {}) }, heard.pictures ?? []);
        } catch (err) {
          throw askedFor(err);
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
        focus: z.object({ fromBar: z.number(), toBar: z.number() }).optional().describe('Bars you would like heard as well: the before-and-after plays them along with every bar the suggestion changes, if they fit (never instead of them)'),
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
          // (as the studio refuses one live: a suggestion file with nothing in it isn't written)
          if (!result.diff.changes.length) return fail(NO_CHANGE);
          writeJson(outPath, makeSuggestionFile(song, { title, explanation, ops: ops as never }));
          return { written: out, apply: `fledgetone apply ${file} ${out} -o <new song>.fledgetone.json`, changes: result.diff.changes.map((c) => c.text), warnings: result.warnings, notes: result.notes, regions: result.diff.regions, audition: focus ?? result.diff.audition };
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
      description: `A suggestion you made (or, without id, all of yours): waiting, accepted, dismissed, out of date (the song changed under it), or changed (the song changed elsewhere: the musician should listen again). Also whether the musician heard it as it is (heard), where its changes are heard (regions: a track's level or sound counts wherever that track plays, the tempo or the master the whole song), the stretches its before-and-after plays one after another (audition), and, when those can't hold every region (at most ${LIMITS.listenMaxBars} bars and ${LIMITS.listenMaxSeconds} seconds), the bars left unheard (unheard) and the limit that left them out (limit).`,
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
      description: `A short message to the musician on the Suggestions panel (plain text, at most ${LIMITS.sayMaxChars} characters, one a second). "about" ties it to a suggestion; "replyTo" (the id of one of their messages) shows it as your answer to that message.`,
      inputSchema: { text: z.string().min(1).max(LIMITS.sayMaxChars), about: z.string().optional(), replyTo: z.string().max(64).optional() },
    },
    ({ text, about, replyTo }) =>
      guard(async () => {
        needStudio();
        if (replyTo && !conversation.hasMusicianMessage(replyTo)) throw new Error('replyTo must be the id of one of the musician\'s messages (see get_messages).');
        limited(sayRate, 'say');
        const res = (await live('say', { text, ...(about ? { about } : {}), ...(replyTo ? { replyTo } : {}) })) as { id?: unknown } | null;
        conversation.addAgent(typeof res?.id === 'string' ? res.id : `m${Date.now().toString(36)}`, text, { ...(replyTo ? { replyTo } : {}), ...(about ? { about } : {}) });
        return res;
      })
  );
  registerConversationTools(server, conversation, guard);

  server.registerTool(
    'point_at',
    {
      title: 'Point at something',
      description: 'Highlight something in the studio for the musician: a track, a clip, a range of bars, a marker, or a control (by its name in the studio). One a second. A control is shown only if it is on screen; unless the musician allowed seeing their view, the answer is the same whether it was there or not.',
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
        return { changes: d.changes.map((c) => c.text), bars: d.bars, regions: d.regions };
      })
  );

  // ---------- Resources ----------

  server.registerResource('ops-guide', 'fledgetone://docs/ops', { title: 'The agent guide: ops, the song summary, the connection', mimeType: 'text/markdown' }, (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: AGENT_DOC }] }));
  const liveResource = (name: string, uri: string, title: string, method: StudioMethod) =>
    server.registerResource(name, uri, { title, mimeType: 'application/json' }, async (u) => {
      if (!bridge.isPaired) throw new Error(NOT_CONNECTED);
      return { contents: [{ uri: u.href, mimeType: 'application/json', text: JSON.stringify(cleanForAgent(await live(method)), null, 2) }] };
    });
  liveResource('studio-song', 'fledgetone://studio/song', 'The song on screen', 'get_song');
  liveResource('studio-view', 'fledgetone://studio/view', 'What the musician sees', 'get_view');
  liveResource('studio-suggestions', 'fledgetone://studio/suggestions', 'Your suggestions and their status', 'get_suggestion');

  return server;
}
