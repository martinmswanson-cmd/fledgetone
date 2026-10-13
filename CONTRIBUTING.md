# Contributing to Bo's Beatbox

Thanks for wanting to help. This page covers setting up, the checks every change must pass, and
the conventions the code follows. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first for
how the app fits together, and use [docs/CODEMAP.md](docs/CODEMAP.md) to find the file you need.

## Setting up

Requires Node 22.

```sh
npm install
npm run dev            # dev server (http://localhost:5173)
```

The app needs a click before it can make sound (a browser rule): press Play or Start Audio.

## Checks

Run all of these before every commit; they must all pass.

```sh
npx tsc -b             # type check
npx oxlint src         # lint (3 known warnings: Playhead.tsx x2, SoundAuditionPanel.tsx x1)
npm test               # unit tests (node --test scripts/*.test.mjs)
npm run build          # production build
npm run build:single   # the one-file build that gets published (dist-single/index.html)
```

Two generated files are checked by the tests. Regenerate them when you change what they're built
from:

```sh
npm run guide-tables   # GUIDE.md's instrument list and credits, from the instrument catalog
npm run codemap        # docs/CODEMAP.md, from the summary comment at the top of each source file
```

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
the starters) goes in a file with no React, store or Web Audio in it, so Node can test it.
Tests live in `scripts/*.test.mjs` and import the TypeScript directly. The store's actions and
the audio engine call those functions and apply what they return.

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
Interface text is plain and short. Don't name artists or songs anywhere in the software
(starters, descriptions, comments, the guide): describe a style by its genre, tempo and sound.

### Third-party sounds

Recorded instruments must come from sources whose licence allows redistribution, and each one
needs an entry in `src/credits.ts` (a test fails without it). Say where the files come from and
how they were converted, as `scripts/real-samples/README.md` does.

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
- **Vite hot reload and test pages.** After editing `src/`, restart the dev server before running
  browser checks, or the page can import a stale copy of a module.

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
