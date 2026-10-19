# Contributing to Fledgetone

Thanks for wanting to help. Fledgetone is a music studio in the browser, built most of all for
people who make music for games and video, and for beginners who want something that sounds good
on day one. Every kind of help counts: a clear bug report, a sound that's off, a starter song, a
better sentence in the guide, or code.

Everyone taking part agrees to the [code of conduct](CODE_OF_CONDUCT.md): be kind, give feedback
on the work rather than the person, and email martin@twobirdsworkshop.com if something's wrong.

This page covers:

1. [Ways to help](#ways-to-help) (no code needed for most)
2. [Setting up](#setting-up)
3. [Finding your way around](#finding-your-way-around)
4. [Recipes for common contributions](#recipes-for-common-contributions)
5. [The checks](#the-checks)
6. [Conventions](#conventions)
7. [Things that bite](#things-that-bite)
8. [Checking sound](#checking-sound)
9. [Pull requests](#pull-requests)
10. [Licences: your work and other people's](#licences-your-work-and-other-peoples)
11. [Being kind](#being-kind)

## Ways to help

- **Report a bug.** Say what you did, what you expected and what happened instead, which browser
  and system you use, and attach the song if you can (File › Save makes a `.fledgetone.json`; take
  anything private out first). Something you *hear* wrong is a bug too: a click, a note out of
  tune, an instrument much louder than the others. A short recording helps a lot.
- **Suggest a feature.** Describe the music you were trying to make and where the app got in the
  way, more than the button you'd add. Game and film composers: tell us what your engine or
  middleware needs.
- **Listen.** Open the starters and the sound effects maker and tell us what sounds cheap,
  harsh, quiet or wrong. Ears are the scarcest resource on this project.
- **Write.** The user guide (`GUIDE.md`, also shown in the app) should be plain, short and
  correct. If something confused you, it will confuse others: send the sentence you wish you'd
  read.
- **Make content.** Starter songs, sound effect recipes, sets and synth patches are plain data
  in TypeScript and a great first contribution (see the recipes below).
- **Code.** Look for issues labelled *good first issue*, or ask in an issue before starting
  something big, so nobody's work is wasted.

## Setting up

You need Node 22 and npm.

```sh
npm install
npm run dev            # the dev server: http://localhost:5173
```

The app needs a click before it can make sound (a browser rule): press Play or Start Audio. The
welcome dialog shows on a fresh page; close it, or see [Things that bite](#things-that-bite) for
browser tests.

Three builds matter:

```sh
npm run build          # dist/: the production build, as fledgetone.com publishes it
npm run build:single   # dist-single/index.html: the whole app in one file, to run from a file
npm run build:full     # dist-full/: the one-file app with the GPL plugins (Surge XT, Dragonfly...) in it
```

fledgetone.com is built by Netlify from `master` (see `netlify.toml`): a home page at `/` and the
app at `/app/`, an installable web app
with a service worker; only production builds register the worker. The one-file build isn't
published; it fetches the recordings and plugins from their fallback address on
twobirdsworkshop.com.

The dev server includes the GPL plugins (`.env.development` sets `VITE_GPL_PLUGINS=1`), so you
see everything while you work.

## Finding your way around

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app fits together, what happens when you
  edit, play, save and export, and *where to start for common changes*. Read this first.
- [docs/CODEMAP.md](docs/CODEMAP.md): every source file and what it's for, by folder.
- [GUIDE.md](GUIDE.md): what the app does, from the user's side. If you're changing a feature,
  read its section first.
- [scripts/plugins/README.md](scripts/plugins/README.md): the built-in plugins (WebAssembly) and
  how each family is built.

The stack: React 19, TypeScript, zustand, Tone.js 15 on the Web Audio API, Tailwind and Vite.
The main folders:

| Folder | What's in it |
| --- | --- |
| `src/store/` | The song (`timelineStore.ts`), the project file format (`project.ts`), and pure logic: notes, tempo, markers, starters, game states, intensity, stingers |
| `src/audio/` | The audio engine: instruments, effects, the live engine, exports, the game kit |
| `src/audio/sfx/` | The sound effects maker's synth (pure maths, no Web Audio) |
| `src/audio/plugins/` | Hosting the built-in plugins and web plugins (WAM) |
| `src/components/` | The screen: React components |
| `src/gameKit/` | The players shipped in game kits: web (`adaptive-music.js`), Godot (`godot/`), Unity (`unity/`) |
| `src/runtime/` | The web runtime player that synthesizes a song in a game |
| `scripts/` | Unit tests (`*.test.mjs`), generators, sample and plugin build scripts |
| `public/` | Recorded instruments and plugin WebAssembly, served next to the app |

## Keep the studio and Pocket in step

Fledgetone has two interfaces over one engine and one song: the **studio** (on a computer) and
**Pocket** (on a phone, `src/pocket/`). Every change, to either one, includes a look at the other:

- **A feature or a fix in one**: decide whether it belongs in the other too, and do it there, or
  say why not.
- **Anything about how a song is made or kept** (clips, notes, tracks, markers, the loop, the
  project file): make a song in one and open it in the other, and check it looks and plays right
  in both (Pocket's sections are the song's markers, so the studio shows them on its timeline).
- **Words about the other interface** (the studio's menus and notices describe Pocket, Pocket's
  Share and settings describe the studio): keep them true.
- **The docs**: GUIDE.md has a section for each, and the Learn lessons and their screenshots
  (`learn/shots/`, taken by `scripts/guide-shots/capture.mjs`) show both.

## Recipes for common contributions

Each recipe lists the files to touch. The checks below catch most mistakes; run them.

### A starter song

1. Write a function that returns the project, in `src/store/starters.ts`, `startersPlaylist.ts`
   or (for game music) `startersGame.ts` / `startersGameMore.ts` / `startersStory.ts`, using the helpers in `starterKit.ts` and the `KIT`
   export at the end of `startersPlaylist.ts`: `track`, `clip`, `melody`, `beat`, `progression`,
   `stabs`... Steps are 16th notes: step 4 is beat 2 of the first bar.
2. Add its entry to `STARTERS` in `starters.ts` (id, group, name, a one-line description with its
   tempo and key) and its builder to `BUILDERS` (or `GAME_BUILDERS`).
3. Mark its sections (they become the game states), put the loop on the main section, and mix
   it: no track should poke out of the balance.
4. Game starters also get stem groups (`grouped(track, 'Percussion')`), transitions and
   stingers through `gameReady()`.
5. Listen to it all the way through. Then measure its loudness with
   `IDS=<id> node scripts/audio-check/starters-loudness.cjs` and add its line to `STARTER_LEVELS`
   in `startersLoudness.ts`: the trim it suggests, then the loudness it measures with that trim
   (within 1.5 LU of its group's target; a test checks every starter has a line). If it needs
   more than about 4 dB of limiting to get there, look for a part whose peaks stand far over the
   rest. Update the starter list and count in `GUIDE.md`, and the count in the tour
   (`src/tour/lessons.ts`).

The **Classics** (complete public-domain pieces) are built the same way in `startersClassics.ts`,
with their notes in `classicsScores.ts` and their sources in `SCORE_CREDITS` (`src/credits.ts`),
but New lists them under **Demo songs**, not with the starters.

### A kind of sound effect

1. In `src/audio/sfx/sfxSynth.ts`, add the kind to a group in `SFX_GROUPS`, its label to
   `SFX_LABELS`, and a recipe in `generateSfx`: a few layers (`L({...})`, `click`, `thump`,
   `swish`, `bell`, `tone`) with random ranges from `between` and `pick`, so every click makes a
   different one.
2. Set its loudness class (`level: 'soft'` for menus, `'loud'` for impacts). Loops set
   `loop: true` and a `loopLength`.
3. `npm test` renders every kind with three seeds and checks it's audible, never over -1 dBFS,
   click-free and within its length. Then listen to ten or so in the app.
4. If it belongs in a set, add it to `SFX_SETS`. Update the list in `GUIDE.md`.

### An instrument

1. Add it to `src/audio/instrumentCatalog.ts` (key, name, category, range) and its preset in
   `src/audio/presets/` (a synth) or its sample set (recorded: see
   `scripts/real-samples/README.md` for converting and hosting the recordings).
2. Recorded sounds need a licence that allows redistribution and an entry in `src/credits.ts`.
3. Level-match it: play the same phrase on it and on a few neighbours and compare (`scripts/audio-check/`).
4. `npm run guide-tables` updates the guide's instrument list and credits.

### A built-in plugin family

Follow `scripts/plugins/README.md`: wrap the plugins with the `bbplug` interface, add the family
to `scripts/plugins/families.json` (with its source, commit and licence), build the `.wasm`, then
`node scripts/plugins/catalog.mjs` and `node --test scripts/plugins.test.mjs`. Add its credit to
`src/credits.ts` and its licence notice to `scripts/plugins/LICENSES.txt`.

A GPL family goes in `public/fledgetone-plugins/gpl/` with `"gpl": true`, its notice in
`LICENSES-GPL.txt`, and is only in builds made with `VITE_GPL_PLUGINS=1`.

### A field in the project file

1. Add it to `ProjectSnapshot` (and `ProjectData`) in `src/store/project.ts` as **optional**.
2. Write it in `serializeProject` only when it isn't the default, and read it in `parseProject`
   with a check and a default, so files from older versions and hand-edited files still open.
3. Carry it through `loadProject` and `currentProject` in `timelineStore.ts`, and the autosave
   subscription's change check.
4. Add a test that saves and reopens a project with it (see `scripts/projectPlugins.test.mjs`).

### The game kit players

The web, Godot and Unity players (`src/gameKit/`) read the same `audio_manifest.json` and offer
the same calls. Change all three together, keep the manifest change backward-compatible, and
update the kit's READMEs in `src/audio/gameKit.ts`. To check the Godot player for real:

```sh
# Export a game kit "for Godot" from the app, then:
mkdir kit-test && cd kit-test && unzip ../"My song game kit for Godot.zip"
printf 'config_version=5\n[application]\nconfig/name="KitTest"\n' > project.godot
godot --headless --path . --import
godot --headless --path . --quit-after 300 res://bos_music/my_song_example.tscn
```

Script errors show in the output. For Unity, open a project, unzip the "for Unity" kit into it,
add **Adaptive Music Example** to an empty GameObject and press Play.

## The checks

Run all of these before every commit; they must all pass.

```sh
npx tsc -b             # type check (what npm run build runs; tsc -p . checks nothing here)
npx oxlint src         # lint (2 known warnings: Playhead.tsx x2)
npm test               # unit tests (node --test scripts/*.test.mjs)
npm run build          # production build (what fledgetone.com publishes)
npm run build:single   # the one-file build (dist-single/index.html)
```

When a change touches sound, also run the sound checks (they need the dev server on port 5200,
`npx vite --port 5200`, and Playwright; see [Checking sound](#checking-sound)):

```sh
node scripts/audio-check/repeat.cjs              # exports repeat exactly, sample for sample
node scripts/audio-check/starters-loudness.cjs   # every starter's loudness (IDS=<id> for some)
```

Two generated files are checked by the tests. Regenerate them when you change what they're built
from:

```sh
npm run guide-tables   # GUIDE.md's instrument list and credits, from the instrument catalog
npm run codemap        # docs/CODEMAP.md, from the summary comment at the top of each source file
```

Please don't run a formatter over files you didn't otherwise change: the code has its own style
(long lines are fine where they read better), and reformatting buries the real change in a diff.

## Conventions

### Every file says what it is

Each source file starts with a comment saying what the file is for, in a sentence or three, then
anything a reader needs before the code (the approach, the units, the catch). The first paragraph
of it becomes the file's line in `docs/CODEMAP.md`, and a test fails if a file has none. Keep it
true when the file changes.

### Comments explain why

Comments are plain sentences about what something is for and why it's done this way, especially
where the obvious way was tried and failed ("Tone.Limiter keeps a 30 dB soft knee, which barely
limits, so..."). Exported functions, types and constants get a `/** ... */` doc comment. Don't
narrate what the next line does when the code already says it.

### Pure logic in its own file, with tests

Anything that's maths or rules on plain data (positions, tempo, markers, notes, takes, notation,
the starters, the sound effects synth) goes in a file with no React, store or Web Audio in it, so
Node can test it. Tests live in `scripts/*.test.mjs` and import the TypeScript directly. The
store's actions and the audio engine call those functions and apply what they return.

### The store is the source of truth

UI components change the song only through store actions (`timelineStore.ts`), and an action
that should be undoable calls `checkpoint()` once per gesture before changing anything (a drag is
one undo step, not one per mouse move). The audio engine follows the store; don't change what
plays from a component.

### Live and export must sound the same

Every sound path is built by a factory that works in whatever audio context is current, because
exports rebuild the whole graph in an `OfflineAudioContext`. When you change how something
sounds, check it live and in an export.

### Idle audio must cost nothing

Web Audio processes every connected node all the time. Build effects only while they're switched
on, make per-note nodes when a note starts and let them go when it ends, and avoid Tone `Signal`s
in anything that's always there. Switching an effect while playing must not drop out: track
strips crossfade on the audio clock when inserts change.

### Projects keep opening

Every saved file and autosave must keep loading. A new field is optional in the file, with a
default when it's missing; `parseProject` checks and repairs every field it reads.

### Words in the app

The user guide is `GUIDE.md` (also shown inside the app); every user-visible change updates it.
Interface text is plain and short: say what a thing does for the musician, not how it's built.
Don't name artists, songs, games, brands or people anywhere in the software (starters, presets,
descriptions, comments, the guide): describe a style by its genre, tempo and sound. The exceptions
are the public-domain classical works and their composers in the Classics, the credits of the sound
and score sources, and the owner's name and contact in `TERMS.md`.

## Things that bite

- **Tone's "ended" comes early in an export.** The offline clock runs ahead of the render, so a
  source's `onended` can fire before it has sounded. Clean up per-note nodes when the source is
  disposed, never in `onended`.
- **The global Tone context changes during an export.** While an export builds its graph, Tone's
  current context is the export's. Use `liveContext` / `liveTransport` (`liveContext.ts`) for
  anything that belongs to live playback, never Tone's globals.
- **Monophonic Tone synths throw on two notes at the same instant.** Instruments go through
  `monotonicTime` (`presets/monotonic.ts`); keep new ones doing the same.
- **The welcome dialog covers a fresh page** in browser tests: set
  `localStorage['bosBeatbox.welcomeSeen'] = 'true'` first.
- **Nodes made on the browser's own context.** Per-note nodes of the recorded instruments and the
  native buses are made straight on the native `AudioContext` (`nativeNodes.ts`) to skip Tone's
  wrapper. Connect native nodes into a Tone node with `nativeInputOf`, never the other way, and
  hold `keepActive(node)` on a Tone node only native nodes feed, or the wrapper decides it's idle
  and stops passing sound.
- **Vite hot reload and test pages.** After editing `src/`, restart the dev server before running
  browser checks, or the page can import a stale copy of a module.
- **Built-in plugins talk by message.** A plugin's notes reach its AudioWorklet as messages, so an
  export waits for every plugin to have its notes (`syncBuiltinPlugins`) before each step renders.
- **Built-in effects that make their own sound are faded.** An effect plugin that goes on sounding
  once its track is quiet (a Shepard tone, a noise source) is faded out after a few seconds
  (`followInput` in `plugins/processor.ts`), live and in exports. One meant to hold a sound for
  ever goes in `HOLDS_FOREVER` (`plugins/builtinHost.ts`).
- **Exports must repeat exactly.** The same song must export to the same samples every time.
  Seed any randomness from the song (`seededNoise.ts`, `noteSeed` in `human.ts`), never
  `Math.random` or the time. The export's offline contexts add up a node's inputs in a fixed order
  (`exactSums.ts`) and run sources' ended handlers on the render's clock (`endedOnTime.ts`); both
  hook into `connect` and the sources' `onended` / `'ended'` listeners, so new code gets them by
  using those as usual. Run `scripts/audio-check/repeat.cjs` after touching an
  instrument or effect.
- **Code inlined into a worklet or a Worker as text sees no module constants.** A function sent as
  source text (`fn.toString()`) works in the dev server, then fails in a production build, where
  the minifier has renamed the constants it reads. Pass its constants in as arguments, as
  `createLoudnessAnalyser` (`loudness.ts`) does, and check it in `npm run build && npm run preview`.
- **The service worker is only in production builds.** The dev server never registers one (and
  removes any a preview left on the same address), so offline, update and install behaviour can
  only be tried with `npm run build && npm run preview` (`scripts/pwa.test.mjs` covers the worker's
  logic).
- **No sound until asked.** The live audio context is held suspended until a click or key calls
  `initAudio` (`engine.ts`), and suspended again on `pagehide`. Start audio through `initAudio`
  (browser tests: click START AUDIO, or call it), never by resuming the context directly.

## Checking sound

Unit tests can't tell you how something sounds. `scripts/audio-check/` renders real audio through
the app's own export path in a headless browser and measures it (level, brightness, pitch), so
you can compare before and after a change:

```sh
npm run dev -- --port 5200
START=1 OUT=/tmp/before node scripts/audio-check/run.cjs scripts/audio-check/phrases.js '{"keys":["violin","cello"]}'
# change the code, restart the dev server, then the same with OUT=/tmp/after
python3 scripts/audio-check/phrases.py /tmp/before
python3 scripts/audio-check/phrases.py /tmp/after
```

It needs Playwright with Chromium, ffmpeg, and Python with numpy. When a change is meant to be
heard, attach a short before-and-after recording of the same phrase to the pull request.

Exports must repeat exactly. `node scripts/audio-check/repeat.cjs` renders every generated
instrument, kit, insert and a few starters twice and says which differ (`KEYS`, `FX`, `STARTERS`
and `THREADS` pick what it renders; see its header). Run it after touching an instrument or effect.

## Pull requests

- **One topic per pull request.** A fix and an unrelated tidy-up are two pull requests.
- **Say what changes for the musician** in plain words at the top, then how it works.
- **Show it.** Screenshots for anything on screen; a before-and-after recording for anything you
  hear.
- **Tests and the guide.** Pure logic gets a test; user-visible changes update `GUIDE.md`.
- **The changelog.** A change people will notice adds a line to the newest section of
  `CHANGELOG.md`, written for the people using the app: what changed for them, in plain words, no
  file names or code. Small fixes and tweaks don't need one. Changes not released yet gather under
  an **Unreleased** heading at the top; to release, the maintainer renames it to the new version
  (the date, `-2` and so on for a second release that day) and sets `version` in package.json to
  match (a test checks they agree). The site serves the version as `/version.json`.
- **All checks pass** (see [The checks](#the-checks)), including the one-file build.
- **Small commits with clear messages** are easier to review than one large one.

A maintainer will review it, usually within a week. Questions in the review are questions, not
rejections: answer or push a change, and say if you disagree.

## Licences: your work and other people's

Fledgetone is free software under the GNU General Public License, version 3 or later (see
`LICENSE`). By sending a contribution you agree that it's licensed the same way, and that you
have the right to contribute it.

- **Code you didn't write** must have a licence compatible with GPL-3.0-or-later (MIT, BSD,
  Apache-2.0, LGPL, GPL...). Say where it came from in the file's header comment and keep its
  copyright notice.
- **Sounds you didn't record** (samples, impulse responses, presets) need a licence that allows
  redistribution and modification, and an entry in `src/credits.ts`.
- **No ripped or "found" material**: no samples from commercial libraries or records, no presets
  copied from commercial products, and no artist or song names in anything we ship.
- **The name and logo** aren't covered by the GPL; see `TRADEMARKS.md`.
- **The published build** (`build:site`, as Netlify runs it for fledgetone.com: the home page at
  `/`, the app at `/app/`) has the GPL plugins, since this repository publishes the app's source
  with them; `build:single` leaves them out and `build:full` has them. Anywhere you publish a build
  with `public/fledgetone-plugins/gpl/`, publish its source too (a link to the repository at the
  same commit will do).

## Being kind

Be patient and generous with each other. People here range from first-time coders and
first-time musicians to people who've done this for decades; everyone's question deserves a
real answer. Criticise the work, never the person. Harassment, insults and discrimination aren't
welcome, and the maintainers will remove comments, pull requests or people that don't follow
this. If something makes you uncomfortable, tell a maintainer privately.
