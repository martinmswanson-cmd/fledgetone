# fledgetone: the command line

Fledgetone songs on the command line, and the helper that lets your own AI agent read a song and
suggest changes (an MCP server). How to connect an agent, the ops it suggests with and how the
connection is kept safe are in [docs/AGENT.md](../../docs/AGENT.md).

**Fledgetone sends nothing anywhere. Your agent sends what it reads to whoever runs it.**

## Building it

You need Node 22. From a fresh clone of the repository:

```sh
npm install                     # the app's own packages (the build uses Vite)
cd tools/cli && npm install     # the command line's: the MCP SDK, ws and zod
cd ../.. && npm run build:cli   # writes tools/cli/dist/fledgetone.mjs
node tools/cli/dist/fledgetone.mjs --help
```

`tools/cli/dist/` is build output: it isn't committed (the repository's `.gitignore` leaves out
every `dist`), so build it after each pull. The bundle holds the app's own plain-logic code it
uses (the project format, the starters, the instrument list, the ops), the version and the agent
guide; the three packages above stay outside it and load from `tools/cli/node_modules`, so keep
that folder next to it. To run it from anywhere, `npm link` in `tools/cli` puts `fledgetone` on
your PATH.

Working on it, run it from source without building (Node strips the types; the hook adds the
`.ts` extension the app's imports leave out):

```sh
node --import ./tools/cli/src/tsHook.mjs tools/cli/src/fledgetone.ts info song.fledgetone.json
npx tsc -p tools/cli                # type check
```

## Commands

| Command | What it does |
| --- | --- |
| `info <song> [--json]` | The song in plain words: tempo, key, length, markers, sections, tracks and clips with their ids. `--json` gives the summary an agent reads |
| `notes <song> [--track <name\|id>] [--bars 5-8] [--json]` | Its notes with their ids, in song order |
| `check <song> [--json] [--fix -o <out>]` | What the app changes when it opens the file (values out of range, parts it can't read). Exit 0: nothing; 1: something, listed. `--fix` writes the repaired song |
| `diff <a> <b> [--json]` | What changed from one song to another |
| `list instruments\|presets\|starters\|params\|inserts\|master [query] [--json]` | What there is to choose from |
| `new --starter <id> -o <out> [--name <name>]` | A new song from a starter |
| `apply <song> <suggestion.json> -o <out> [--overwrite] [--force]` | Applies a suggestion file to a song, writing a new song. It never writes over the song it reads (unless `--overwrite`) and refuses a suggestion whose song has changed since, or that was made for another song (unless `--force`) |
| `measure <file.wav> [--json]` | An export's loudness (LUFS, and the loudest 3 seconds), true peak, crest and balance across the spectrum |
| `link <song> [--base <url>]` | A share link that opens the song in Fledgetone |
| `from-link <link> -o <out>` | The song in a share link, as a file |
| `mcp [--root <folder>] [--port <n>] [--dev] [--allow-null-origin] [--allow-origin <url>]` | The agent helper: an MCP server on stdio, with the studio connection on `127.0.0.1` |

Exit codes: 0 done; 1 done with something to fix, or refused (an out-of-date suggestion); 2 a
mistake in the command or a file that can't be read. Nothing but the command's output goes to
stdout; messages go to stderr (and in `mcp`, stdout carries only the protocol).

## Licences

The command line is part of Fledgetone (GPL-3.0-or-later). Its packages, as pinned in
`package-lock.json` (checked in their `node_modules` folders):

| Package | Version | Licence |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT |
| `ws` | 8.22.0 | MIT |
| `zod` | 4.6.7 | MIT |
| `@types/ws` (type checking only) | 8.18.1 | MIT |

Everything they bring in is MIT, ISC, BSD-2-Clause or BSD-3-Clause, all compatible with
GPL-3.0-or-later. None of it is in the app the website serves.

## Tests

`npm test` at the repository's root runs `scripts/cli.test.mjs` and `scripts/mcpServer.test.mjs`
(and the live part of `scripts/agentProtocol.test.mjs`) from the source here. Without
`tools/cli/node_modules` they're skipped, with a message saying so.
