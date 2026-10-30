# fledgetone: the command line

Fledgetone songs on the command line, and the helper that lets your own agent read a song and
suggest changes (an MCP server). How to connect an agent, the ops it suggests with and how the
connection is kept safe are in [docs/AGENT.md](../../docs/AGENT.md).

**Fledgetone sends nothing anywhere. Your agent sends what it reads to whoever runs it.**

## Building it

You need Node 22. From a fresh clone of the repository:

```sh
npm install                     # the app's own packages (the build uses Vite)
cd tools/cli && npm install     # the command line's: the MCP SDK, ws and zod (and playwright-core, for rendering)
cd ../.. && npm run build:cli   # writes tools/cli/dist/fledgetone.mjs
node tools/cli/dist/fledgetone.mjs --help
```

Rendering song files (`render`, `listen`, and the helper's `render_file` and `listen` with a
file) also needs the app's renderer, `npm run build:runtime` (it writes
`dist-runtime/fledgetone-render.js`), and playwright-core, which drives a browser to render in.
It's an optional package of tools/cli, so `npm install` there brings it (it downloads no browser);
without it the rest of the command line works, and rendering says how to get it. A copy found
elsewhere is used too (`NODE_PATH`, the global packages, or `FLEDGETONE_PLAYWRIGHT=<its folder>`).

An installed Google Chrome or Chromium is used (or Edge, or one Playwright downloaded before, of
any version); without one, `npx playwright-core install
chromium` in `tools/cli` downloads one, or `--browser <path>` names one. The browser is started for
each render with no window and closed when it ends; it opens only a page this command line serves
on `127.0.0.1`, and reaches nothing else but fledgetone.com, for the recordings of instruments the
song uses (the same files and addresses the app downloads them from). Those are kept in
`~/.cache/fledgetone` (`FLEDGETONE_CACHE` for another folder), so each downloads once; in a copy
of the repository the recordings in `public/fledgetone-samples` are used first, and `--samples
<folder>` gives another such folder. `--offline` downloads nothing. A download is kept only if
it's a whole file of the kind asked for (a recording, a plugin), and a kept one that's damaged is
deleted and downloaded again.

Behind a proxy, set `HTTPS_PROXY` (and `NO_PROXY` for addresses that go around it): the
downloads go through it. A proxy that uses a certificate of its own needs it in
`NODE_EXTRA_CA_CERTS` (a file of PEM certificates), as other Node programs do.

Songs with plugins from other sites (by their address, not Fledgetone's built-in ones) aren't
rendered: the command line doesn't run plugins from the internet. It says which tracks; export
those songs from the studio, or take the plugins off (or mute those tracks) to render the rest.
The built-in plugins load from `public/fledgetone-plugins` in this copy.

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
| `info <song> [--json]` | The song in plain words: tempo and time signature (and their changes), key, length, markers, sections, tracks and clips with their ids. `--json` gives the summary an agent reads |
| `notes <song> [--track <name\|id>] [--bars 5-8] [--json]` | Its notes with their ids, in song order |
| `check <song> [--json] [--fix -o <out>]` | What the app changes when it opens the file (values out of range, parts it can't read). Exit 0: nothing; 1: something, listed. `--fix` writes the repaired song |
| `diff <a> <b> [--json]` | What changed from one song to another |
| `list instruments\|presets\|starters\|params\|inserts\|master [query] [--json]` | What there is to choose from |
| `new --starter <id> -o <out> [--name <name>]` | A new song from a starter |
| `apply <song> <suggestion.json> -o <out> [--overwrite] [--force]` | Applies a suggestion file to a song, writing a new song. It never writes over the song it reads (unless `--overwrite`) and refuses a suggestion whose song has changed since, or that was made for another song (unless `--force`) |
| `measure <file.wav> [--json]` | An export's loudness (LUFS, and the loudest 3 seconds: none in a file under 3 seconds), true peak, crest and balance across the spectrum |
| `render <song> -o <out.wav\|out.mp3> [--bars 1-16] [--rate 44100\|48000] [--bits 16\|24\|32f] [--stems <folder>] [--target <id>\|none] [--json]` | The song as Export makes it: WAV (24-bit by default; 32f is float) or MP3 (320 kb/s), ringing out at the end. `--stems` writes one file per track into a folder (without the master section, as Export's stems, and never matched to a loudness target), as well as or instead of `-o`. `--target` matches a loudness target (`streaming`, `loud`, `club`, `game`, `podcast`, `broadcast`); by default, as Export: the Loud master's own when it's on, else none. 88.2 and 96 kHz too, for WAV. Never writes over a file unless `--overwrite` |
| `listen <song> [--bars 9-16] [--per-track] [--suggestion <file> \| --ops <file>] [--json]` | Bars rendered as the studio's listen renders them and measured: loudness, the loudest 3 seconds, true peak, crest, balance, what the master's limiter and clipper did, bar by bar, each track with `--per-track`, and the Mix check's findings. With a suggestion file (or a file of ops), before and after, and which bars sound different. `--json` gives what the agent reads (see docs/AGENT.md) |
| `studio [--port 47200] [--app <folder>]` | A built copy of the app (`npm run build` or `build:site` first) on `127.0.0.1`, for Safari and Brave, which won't let fledgetone.com reach the helper. `mcp --studio` starts it with the helper and lets it connect |
| `link <song> [--base <url>]` | A share link that opens the song in Fledgetone |
| `from-link <link> -o <out>` | The song in a share link, as a file |
| `mcp [--root <folder>] [--port <n>] [--dev] [--allow-null-origin] [--allow-origin <url>] [--studio [--studio-port <n>]]` | The agent helper: an MCP server on stdio, with the studio connection on `127.0.0.1` (and with `--studio`, the studio itself) |

`--bars 9-16` is bars 9 to 16, 16 included (as `notes --bars`); without it, the whole song. The
render and listen options `--samples`, `--offline`, `--browser`, `--timeout <seconds>` (default
600) and `--verbose` (what the page logs and what it was refused) work for `mcp` too. `--app-url
http://localhost:5200/` renders with a running dev server's code instead of the build, for
working on Fledgetone.

Names and titles from song and suggestion files are printed without control characters or
invisible ones (no terminal escapes; no variation selectors, fillers or other characters that
show nothing, but an emoji's own joiners and selector), errors and `--json` included.

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
| `playwright-core` (optional: for rendering) | 1.64.1 | Apache-2.0 |

Everything they bring in is MIT, ISC, BSD-2-Clause or BSD-3-Clause, all compatible with
GPL-3.0-or-later. None of it is in the app the website serves.

## Tests

`npm test` at the repository's root runs `scripts/cli.test.mjs`, `scripts/mcpServer.test.mjs`
and `scripts/cliRender.test.mjs` (and the live part of `scripts/agentProtocol.test.mjs`) from the
source here. Without `tools/cli/node_modules` they're skipped, with a message saying so.
`scripts/renderBrowser.test.mjs` renders a small song of built-in synths in a headless browser
(offline, with a cache folder of its own it deletes): skipped, saying why, without a browser,
playwright-core or the built renderer.
