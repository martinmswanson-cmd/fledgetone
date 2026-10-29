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

Lists
  list instruments|presets|starters|params|inserts|master [query] [--json]

Your agent
  mcp [--root <folder>] [--port <n>] [--dev] [--allow-null-origin]
                                        The agent tools, as an MCP server on stdio. Files are read
                                        and written only inside --root (default: this folder).
                                        The studio connects on 127.0.0.1:${DEFAULT_PORT} (--port 0: any free port).

Options
  -o, --out <file>    The file to write (never the input unless --overwrite)
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
    },
  });
  const flags: cmd.Flags = { ...values, o: values.o ?? values.out };
  const [command, ...args] = positionals;
  if (values.version) {
    process.stdout.write(`${APP_VERSION}\n`);
    return 0;
  }
  if (values.help || !command || command === 'help') {
    process.stdout.write(HELP);
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
    case 'mcp':
      return mcp(values);
    default:
      throw new cmd.UsageError(`unknown command "${command}" (fledgetone --help lists them)`);
  }
}

/** The agent tools: an MCP server on stdio and the studio connection, until stdin closes. */
async function mcp(values: { root?: string; port?: string; dev?: boolean; 'allow-null-origin'?: boolean }): Promise<number> {
  const root = resolve(values.root ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new cmd.UsageError(`--root ${root} isn't a folder`);
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new cmd.UsageError('--port takes a port number (0: any free one)');
  // stdout is the MCP protocol's alone: anything else written there would break it
  console.log = console.info = console.warn = (...a: unknown[]) => process.stderr.write(a.map(String).join(' ') + '\n');
  let server: ReturnType<typeof createMcpServer> | null = null;
  const bridge = new BridgeServer({
    port,
    dev: values.dev === true,
    allowNull: values['allow-null-origin'] === true,
    version: APP_VERSION,
    agentName: () => server?.server.getClientVersion()?.name,
  });
  await bridge.start();
  server = createMcpServer({ root, bridge });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`fledgetone: agent tools ready (files in ${root})\n`);
  await new Promise<void>((done) => {
    const stop = () => done();
    process.stdin.once('end', stop);
    process.stdin.once('close', stop);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await bridge.close();
  await server.close();
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
    const usage = err instanceof cmd.UsageError || (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS');
    process.stderr.write(`fledgetone: ${(err as Error).message}\n${usage ? 'fledgetone --help lists the commands.\n' : ''}`);
    process.exitCode = 2;
  }
);
