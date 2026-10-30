/**
 * The `fledgetone` command: reads the arguments and runs a command (commands.ts), or starts the
 * agent tools (`fledgetone mcp`: the MCP server on stdio and the studio connection). Built into
 * tools/cli/dist/fledgetone.mjs by vite.cli.config.ts; see tools/cli/README.md.
 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as cmd from './commands';
import { BridgeServer, DEFAULT_PORT } from './bridgeServer';
import { createMcpServer } from './mcpServer';
import { APP_VERSION } from './meta';
import { printErr, printOut } from './print';
import * as rc from './renderCommands';
import { findAppBuild, NO_BUILD, startStudio, STUDIO_PORT } from './studioServer';

const HELP = `fledgetone ${APP_VERSION}: Fledgetone songs on the command line, and the connection for your own agent.

Usage: fledgetone <command> [options]

Songs
  info <song> [--json]                  What's in a song: tempo, key, sections, tracks, clips (with ids)
  notes <song> [--track <name|id>] [--bars 5-8] [--json]
                                        Its notes, with their ids
  check <song> [--json] [--fix -o <out>]
                                        What the app would change when it opens the file
  diff <a> <b> [--json]                 What changed from one song to another
  new --starter <id> -o <out> [--name <name>]
                                        A new song from a starter (list starters)
  apply <song> <suggestion.json> -o <out> [--overwrite] [--force]
                                        Apply a suggestion file, writing a new song
  link <song> [--base <url>]            A share link that opens the song in Fledgetone
  from-link <link> -o <out>             The song in a share link, as a file
  measure <file.wav> [--json]           Loudness (LUFS), true peak and balance of an export

Rendering (in a headless browser on this computer, by the app's own export)
  render <song> -o <out.wav|out.mp3> [--bars 1-16] [--rate 44100|48000] [--bits 16|24|32f]
         [--stems <folder>] [--target <id>|none] [--json]
                                        The song as a WAV or MP3 file, as Export makes it
  listen <song> [--bars 9-16] [--per-track] [--suggestion <s.json> | --ops <ops.json>] [--json]
                                        Bars rendered and measured: loudness, peaks, balance,
                                        bar by bar, findings; with a suggestion, before and after

Lists
  list instruments|presets|starters|params|inserts|master [query] [--json]

Your agent
  mcp [--root <folder>] [--port <n>] [--dev] [--allow-origin <url>]
      [--studio [--studio-port <n>]]
                                        The agent tools, as an MCP server on stdio. Files are read
                                        and written only inside --root (default: this folder).
                                        The studio connects on 127.0.0.1:${DEFAULT_PORT} (--port 0: any free port).
                                        --studio also serves the app here (as fledgetone studio)
                                        and lets it connect
  studio [--port ${STUDIO_PORT}] [--app <folder>]   A built copy of the app on 127.0.0.1, for browsers
                                        that won't let fledgetone.com reach the helper (Safari, Brave)

Options
  -o, --out <file>    The file to write (never the input unless --overwrite)
  --overwrite         Write over a file that's there
Rendering and listening
  --bars 9-16         Bars 9 to 16, 16 included (default: the whole song)
  --format wav|mp3    The stems' format without -o (default wav)
  --target <id>       Match a loudness target (streaming, loud, club, game, podcast, broadcast;
                      none: don't). Default as Export: the Loud master's own target when it's on
  --suggestion <file> Listen before and after a suggestion file (--force: even if it's out of date)
  --samples <folder>  Instrument recordings laid out as public/fledgetone-samples (default: that
                      folder in this copy of the repository); others download from fledgetone.com
                      once and are kept in ~/.cache/fledgetone (FLEDGETONE_CACHE)
  --offline           Download nothing
  --browser <path>    The browser to render with (else Chrome, Playwright's Chromium, Edge...)
  --app-url <url>     Render with a running dev server's code (working on Fledgetone)
  --timeout <s>       Give up after this many seconds (default 600)
  --verbose           Say what the page logs and refuses
  -h, --help          This help
  -v, --version       The version

Fledgetone sends nothing anywhere. Your agent sends what it reads to whoever runs it.
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      json: { type: 'boolean' },
      o: { type: 'string', short: 'o' },
      out: { type: 'string' },
      overwrite: { type: 'boolean' },
      force: { type: 'boolean' },
      fix: { type: 'boolean' },
      track: { type: 'string' },
      bars: { type: 'string' },
      starter: { type: 'string' },
      name: { type: 'string' },
      base: { type: 'string' },
      retro: { type: 'boolean' },
      root: { type: 'string' },
      port: { type: 'string' },
      dev: { type: 'boolean' },
      'allow-null-origin': { type: 'boolean' },
      'allow-origin': { type: 'string', multiple: true },
      stems: { type: 'string' },
      rate: { type: 'string' },
      bits: { type: 'string' },
      format: { type: 'string' },
      target: { type: 'string' },
      'per-track': { type: 'boolean' },
      suggestion: { type: 'string' },
      ops: { type: 'string' },
      samples: { type: 'string' },
      offline: { type: 'boolean' },
      browser: { type: 'string' },
      'app-url': { type: 'string' },
      timeout: { type: 'string' },
      verbose: { type: 'boolean' },
      quiet: { type: 'boolean' },
      studio: { type: 'boolean' },
      'studio-port': { type: 'string' },
      app: { type: 'string' },
    },
  });
  const flags: cmd.Flags = { ...values, o: values.o ?? values.out };
  const [command, ...args] = positionals;
  if (values.version) {
    printOut(APP_VERSION);
    return 0;
  }
  if (values.help || !command || command === 'help') {
    printOut(HELP);
    return 0;
  }
  switch (command) {
    case 'info':
      return cmd.info(args, flags);
    case 'check':
      return cmd.check(args, flags);
    case 'diff':
      return cmd.diff(args, flags);
    case 'notes':
      return cmd.notes(args, flags);
    case 'list':
      return cmd.list(args, flags);
    case 'new':
      return cmd.newSong(args, flags);
    case 'apply':
      return cmd.apply(args, flags);
    case 'measure':
      return cmd.measure(args, flags);
    case 'link':
      return cmd.link(args, flags);
    case 'from-link':
      return cmd.fromLink(args, flags);
    case 'render':
      return rc.render(args, flags);
    case 'listen':
      return rc.listen(args, flags);
    case 'studio':
      return studio(values);
    case 'mcp':
      return mcp(values);
    default:
      throw new cmd.UsageError(`unknown command "${command}" (fledgetone --help lists them)`);
  }
}

/** A port number from an option, or `fallback`. */
function portOf(text: string | undefined, fallback: number | undefined, what: string): number | undefined {
  if (text === undefined) return fallback;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new cmd.UsageError(`${what} takes a port number (0: any free one)`);
  return port;
}

/** Until the process is asked to stop (Ctrl+C), or `also` happens. */
function untilStopped(also?: (stop: () => void) => void): Promise<void> {
  return new Promise<void>((done) => {
    const stop = () => done();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    also?.(stop);
  });
}

/** `fledgetone studio`: a built app on 127.0.0.1, until Ctrl+C. */
async function studio(values: { port?: string; app?: string }): Promise<number> {
  const build = findAppBuild(values.app);
  if (!build) throw new cmd.UsageError(values.app ? `${values.app} isn't a built app (a folder with index.html and assets/)` : NO_BUILD);
  const { server, url } = await startStudio(portOf(values.port, STUDIO_PORT, '--port')!, build);
  printOut(
    `Fledgetone is at ${url} (on this computer only). Open it in your browser.\n` +
      `To let it connect to your agent, start the helper with --allow-origin ${server.origin}, or start both together: fledgetone mcp --studio.\n` +
      `Songs and settings kept here are this address's own, apart from fledgetone.com's. Ctrl+C stops it.\n`
  );
  await untilStopped();
  await server.close();
  return 0;
}

/** The agent tools: an MCP server on stdio and the studio connection, until stdin closes. */
async function mcp(values: { root?: string; port?: string; dev?: boolean; 'allow-null-origin'?: boolean; 'allow-origin'?: string[]; studio?: boolean; 'studio-port'?: string; app?: string; samples?: string; offline?: boolean; browser?: string; timeout?: string }): Promise<number> {
  // (gone: a page with no origin of its own is also any website's sandboxed frame, which could then reach the helper)
  if (values['allow-null-origin']) throw new cmd.UsageError('--allow-null-origin is no longer offered: any website could reach the helper through it. To use the studio from a copy on your computer, run fledgetone mcp --studio and open the address it gives.');
  const root = resolve(values.root ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new cmd.UsageError(`--root ${root} isn't a folder`);
  const port = portOf(values.port, undefined, '--port');
  // --studio: the app served here too, and let in (its address is known only once it's serving)
  let studioServer: Awaited<ReturnType<typeof startStudio>> | null = null;
  if (values.studio) {
    const build = findAppBuild(values.app);
    if (!build) throw new cmd.UsageError(NO_BUILD);
    studioServer = await startStudio(portOf(values['studio-port'], STUDIO_PORT, '--studio-port')!, build);
  }
  const render = rc.browserOptions({ ...values, quiet: true });
  // stdout is the MCP protocol's alone: anything else written there would break it
  console.log = console.info = console.warn = (...a: unknown[]) => printErr(a.map(String).join(' '));
  let server: ReturnType<typeof createMcpServer> | null = null;
  const bridge = new BridgeServer({
    port,
    dev: values.dev === true,
    studioOrigins: [...(studioServer?.origins ?? []), ...(values['allow-origin'] ?? [])].map((o) => {
      // An exact origin (scheme, host and port), as a page reports it
      let url: URL;
      try {
        url = new URL(o);
      } catch {
        throw new cmd.UsageError(`--allow-origin ${o} isn't an address like http://localhost:5960`);
      }
      return url.origin;
    }),
    version: APP_VERSION,
    log: (t: string) => printErr(`fledgetone: ${t}`),
    agentName: () => server?.server.getClientVersion()?.name,
  });
  await bridge.start();
  server = createMcpServer({ root, bridge, render });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  printErr(`fledgetone: agent tools ready (files in ${root})`);
  if (studioServer) printErr(`fledgetone: the studio is at ${studioServer.url} (it may connect)`);
  await untilStopped((stop) => {
    process.stdin.once('end', stop);
    process.stdin.once('close', stop);
  });
  await bridge.close();
  await server.close();
  await studioServer?.server.close();
  return 0;
}

// Output piped into something that stops reading (| head) ends the command quietly
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const code = (err as { code?: unknown } | null)?.code;
    const usage = err instanceof cmd.UsageError || (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS'));
    const message = (err instanceof Error && err.message) || String(err) || 'something went wrong';
    printErr(`fledgetone: ${message}${usage ? '\nfledgetone --help lists the commands.' : ''}`);
    process.exitCode = 2;
  }
);
