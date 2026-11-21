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
| `measure <audio> [--sound] [--pictures <folder>] [--from <s>] [--to <s>] [--close <s>]... [--bpm <n>] [--against <audio\|hearing.json> [--against-from <s>] [--against-to <s>]] [--save <hearing.json>] [--json]` | An audio file's loudness (LUFS, and the loudest 3 seconds: none in a file under 3 seconds), true peak, crest and balance across the spectrum. WAV is read here; MP3, FLAC, Ogg, Opus, M4A and AAC (and a WAV this can't read, such as 8-bit) are decoded in the headless browser. `--from` and `--to` take a stretch of it (seconds: `90`, `90.5`, `1:30`). With `--sound`, its character in words too; `--pictures`, `--close`, `--against` and `--save` hear it as well (see "Hearing more") |
| `render <song> -o <out.wav\|out.mp3> [--bars 1-16] [--rate 44100\|48000] [--bits 16\|24\|32f] [--stems <folder>] [--target <id>\|none] [--json]` | The song as Export makes it: WAV (24-bit by default; 32f is float) or MP3 (320 kb/s), ringing out at the end. `--stems` writes one file per track into a folder (without the master section, as Export's stems, and never matched to a loudness target), as well as or instead of `-o`. `--target` matches a loudness target (`streaming`, `loud`, `club`, `game`, `podcast`, `broadcast`); by default, as Export: the Loud master's own when it's on, else none. 88.2 and 96 kHz too, for WAV. Never writes over a file unless `--overwrite` |
| `listen <song> [--bars 9-16] [--per-track] [--suggestion <file> \| --ops <file>] [--sound] [--pictures <folder>] [--close <bar[.beat]>]... [--against <audio\|hearing.json> [--against-from <s>] [--against-to <s>]] [--save <hearing.json>] [--json]` | Bars rendered as the studio's listen renders them and measured: loudness, the loudest 3 seconds, true peak, crest, balance, what the master's limiter and clipper did, bar by bar, each track with `--per-track`, and the Mix check's findings. With a suggestion file (or a file of ops), before and after, and which bars sound different. `--json` gives what the agent reads (see docs/AGENT.md). The hearing options work as for `measure`, on the song's bars: `--close 9.3` is a close-up at bar 9, beat 3; with a suggestion, the sound of before and after is compared and a picture of their difference made, and `--against` is read against the after version |
| `studio [--port 47200] [--app <folder>]` | A built copy of the app (`npm run build` or `build:site` first) on `127.0.0.1`, for Safari and Brave, which won't let fledgetone.com reach the helper. `mcp --studio` starts it with the helper and lets it connect |
| `link <song> [--base <url>]` | A share link that opens the song in Fledgetone |
| `from-link <link> -o <out>` | The song in a share link, as a file |
| `mcp [--root <folder>] [--port <n>] [--dev] [--allow-origin <url>] [--studio [--studio-port <n>]]` | The agent helper: an MCP server on stdio, with the studio connection on `127.0.0.1` (and with `--studio`, the studio itself) |

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

## Hearing more

`measure` and `listen` can describe a sound's character as well as its loudness, draw pictures of
it, compare it with another sound and save what they heard. All of it is signal maths on this
computer: nothing is sent anywhere, and no model or outside service is asked.

- `--sound`: the sound report, in plain words after the usual lines (and as `sound` in `--json`).
  It has eight groups:
  - **tone**: the balance of the spectrum: each part against the whole, where its centre sits
    (bright or dark), how it tilts, where the top rolls off, sub bass against bass, narrow peaks
    (a resonance, or a held note);
  - **texture**: tonal or noisy, smooth or rough (beating inside its bands), how much of it is
    percussive, and flat tops in the waveform (where it was clipped or limited);
  - **movement**: how much it changes over its length, and slow wobbles in the low, middle or
    high band (how fast, in notes when the tempo is known, and how deep);
  - **dynamics**: loudness, the loudest 3 seconds, true peak, crest and loudness range;
  - **attack**: how often notes or hits start, how fast they rise, and the shape of a single hit;
  - **stereo**: how alike the channels are, the balance between them, what is lost in mono, the
    width of each part of the spectrum, and how wide the low end is;
  - **pitch**: the tempo (and how sure it is), the key, the tuning, and the twelve pitch classes;
  - **faults**: clicks, clipping, a DC offset, hum, digital silence and a channel that is silent
    or much quieter than the other, each with where it is (a moment is written as minutes,
    seconds and hundredths, `0:26.53`) and its size with its unit (a click's jump and clipping's
    highest peak in dBFS, a DC offset in dBFS, hum in Hz, a quieter channel in dB).

  The words describe the sound; they never judge it. What to do about it is yours to decide.
- `--pictures <folder>`: PNG pictures of it, written there (the folder is made if it isn't there,
  and a picture of the same name is written over): `spectrogram` (frequency against time; a range of
  more than 8 bars, or 30 seconds of a file, also gets detail spectrograms of 8 bars or 30
  seconds each, at most twelve, spread evenly: the details of a very long range do not cover all
  of it, and the text then says which stretches they cover), `stereo` (the side signal), `level`
  (the waveform and loudness), `spectrum` (with the other sound's, when there is one: the two
  are then drawn level-matched, each total against its own whole level), `chroma`
  (the pitch classes over time), a close-up of each of the first six faults that have a place,
  and `difference` (with a suggestion: where the after version differs). With `--per-track`,
  each track's are named for its id (`track-3-spectrogram`; an id that doesn't begin `track-`
  gets that put before it), and the text gives each track's own words under its line;
  with a suggestion, the after version's `after-...`. The text lists each with what it shows;
  `--json` lists them by path. Nothing is written beside the audio or the song unless asked.
- `--close`: a close-up picture of a moment (it turns `--sound` on, as `--pictures`, `--against`
  and `--save` do; give it as often as you like). For `measure`, seconds from the start of the
  file. For `listen`, a bar and its quarter beat: `--close 9.3` is bar 9, beat 3, and `--close 9`
  its first beat. Bars are four quarter notes whatever the meter, and beats are quarter-note beats
  1 to 4; where the song's ruler counts otherwise (in 3/4 or 6/8, or after a meter change), the
  words say both: `bar 9, beat 3 (measure 12, beat 1 on the ruler)`.
- `--against <file>`: read this sound against another: an audio file (heard the same way) or a
  saved hearing. `--against-from` and `--against-to` take a stretch of it (of a saved hearing too,
  from its second-by-second measurements: tone, width and loudness only). The comparison is
  level-matched (the overall level is taken out before the tone is compared) and lists, after
  its notes, the kinds of fault the two do not share (`Clicks: 1 in click.wav (at 0:12.50), none
  in clean.wav.`) and then the differences, largest first; when nothing differs by more than a
  step, it says so. What only one of the two has (a band's movement, a width down at the floor)
  is said as that, not compared as a number. Compare like with like: the same kind of stretch, of a similar
  length (a short loud stretch reads brighter, louder and more squashed than a whole track, and
  it says so when the lengths differ).
- `--save <file.json>`: save the hearing: measurements only, never the audio. A saved hearing
  goes stale when the rules of one of its groups change: that group can't be compared any more
  (it says so), and the hearing is to be made again from the audio. It isn't written over
  unless `--overwrite`. With `listen --suggestion` (or `--ops`), it saves the hearing of the
  after version. A hearing saved from a song says which bars it is of (`range`); a stretch of
  it (`--against-from`, `--against-to`) is counted in seconds from the start of those bars.
- `--bpm <n>` (`measure`): the tempo, when you know it (else it is found from the sound).
- `--from` and `--to` (`measure`): a stretch of the file. Every time read or given stays a time
  in the file: the first line says the stretch (`click.wav: 0:10 to 0:20 of 1:00, 2 channels`), a
  click 12.5 seconds into the file reads `at 0:12.50` and its close-up is `closeup-12.50s`,
  `--close 12` is 12 seconds into the file, and `--against-from` and `--against-to` of a hearing
  saved from that stretch are times in the file as well. For a song (`listen`), places are bars
  and beats; where seconds appear they are counted from the start of the bars heard.

`measure --json` with any of these options (or `--from` / `--to`, or a file other than a WAV) is
the hearing of the file: `file`, `range` (the stretch, seconds), `fileSeconds` (the file's
length, when a stretch was asked for), `seconds`, `channels`, `silent`,
the loudness numbers rounded to a tenth (`lufs`, `shortTermMaxLufs`, `truePeakDbtp`, `crestDb`),
`regions`, a `note` when something was done to measure it, and, when asked, `sound`, `against`
and `pictures` (each with its `path`). `listen --json` is its report with `sound`, `against` and
`pictures` added. The per-second grids (`sound.along`: the spectrum, loudness and pitch classes
of each second, about 2 KB a second) are in a saved hearing only (`--save`, written on one
line); `--json` leaves them out. Mistakes in these options are said in one line before anything is heard: a
time that isn't one, a `--close` outside the bars or past the end of the file, a `--pictures` or
`--save` place that can't be written to; the file to read against is heard only once the rest is
checked.

It hears at most 15 minutes at a time (name a stretch of a longer file with `--from` and `--to`).
A 4-minute WAV takes about 40 seconds with every picture. Without these options, `measure` and
`listen` print just what they did before, `--json` included, and do no more work (only a WAV this
command line can't read itself, such as 8-bit or A-law, is now decoded in the headless browser
rather than refused).

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
