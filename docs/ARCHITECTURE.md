# Architecture

How Fledgetone is put together: the parts, how a change travels through them, and where to
start when you want to change something. For a one-line description of every file, see
[CODEMAP.md](CODEMAP.md). For how to use the app, see [GUIDE.md](../GUIDE.md).

## The shape of it

Fledgetone is a single-page app with no server: React for the screen, a zustand store for the
song, and Tone.js over the Web Audio API for the sound. Everything runs in the browser; songs
autosave to the browser and save to `.fledgetone.json` files.

```
            ┌──────────────────────────────────────────────────────────┐
            │  UI  (src/components, React)                             │
            │  reads the store with hooks, calls its actions           │
            └───────────────┬──────────────────────────────▲───────────┘
                            │ actions                      │ state
            ┌───────────────▼──────────────────────────────┴───────────┐
            │  Store  (src/store/timelineStore.ts, zustand)            │
            │  the song + view + transport state, every action, undo   │
            │  uses pure logic from src/store/*.ts                     │
            └───────┬───────────────────────────────┬──────────────────┘
                    │ subscribe                     │ subscribe
     ┌──────────────▼──────────────┐     ┌──────────▼───────────────────┐
     │ connectTimelineToAudio      │     │ connectAutosave              │
     │ keeps the live engine in    │     │ writes the song to the       │
     │ step with the song          │     │ browser after each change    │
     └──────────────┬──────────────┘     └──────────────────────────────┘
                    │
     ┌──────────────▼──────────────────────────────────────────────────┐
     │  Audio engine  (src/audio, Tone.js / Web Audio)                 │
     │  per track: instrument -> channel strip -> master chain -> out   │
     │  Transport events play the notes, audio clips and automation    │
     │  the export rebuilds the same graph offline                     │
     └─────────────────────────────────────────────────────────────────┘
```

Three rules hold the design together:

1. **The store is the single source of truth.** The UI never talks to the audio engine to change
   the song; it calls a store action, and the engine follows the store. (The exceptions are
   things that aren't the song: auditioning a sound, playing a MIDI keyboard live, meters.)
2. **Logic is pure where it can be.** Most files in `src/store` and many in `src/audio` are plain
   functions on plain data, with no React, store or Web Audio in them, so `npm test` runs them
   under Node. The store's actions call them and apply what they return.
3. **Live and export share their code.** Every instrument, strip, schedule and the master chain
   is built by a factory that works in whatever audio context is current. Live playback builds
   them once; an export builds them again in an `OfflineAudioContext`. That's why an export sounds
   like the app, and why a change to the sound must work in both.

## Core ideas and units

- **Positions are bars.** Everywhere in the app a song position is a 1-based number of bars
  (bar 1 is the start; 5.75 is three quarters into bar 5). A "bar" is always four quarter notes,
  whatever the time signature: the meter only changes how positions are counted and drawn
  (`src/audio/tempoMap.ts`). Note positions inside a clip are bars from the clip's start.
- **Ticks** are Tone's Transport units, 192 per quarter note. `transport.ts` converts.
- **Tempo** is a map: a starting BPM plus tempo changes (jumps or glides) and meter changes,
  in `tempoMap.ts`. `songTempo(state)` gives the map; seconds and bars convert through it.
- **The song length limit** is `TOTAL_BARS` (400).
- **Tracks** (`Track` in `timelineTypes.ts`) each have one instrument (`instrumentKey`), a mixer
  channel's settings (volume, pan, sends, inserts in `fx`), automation lanes, and options such as
  a folder, a bus output, freeze and Expressive playing. Two special kinds have no clips of their
  own: **buses** (tracks route into them) and **returns** (tracks send to them); see `buses.ts`.
- **Clips** (`Clip`) sit on one track. A note clip has `notes` (`NoteEvent`: note name, start,
  duration, velocity, optional per-note expression); an audio clip has `audio` (a sound file from
  the library, its offset, gain, fades, stretch and warp markers). Clips can also carry
  controller lanes and take folders.
- **Instruments** are listed in `src/audio/instrumentCatalog.ts`: name, category, range, kind
  (`synth`, `drums`, `sampled`, `custom`, `slicer`, `rack`, `multi`, `audio`, `plugin`, `bus`,
  `return`...), and for recorded ones where their samples come from. Every part of the app that
  lists or validates instruments reads this one table.

## The data

`timelineTypes.ts` defines the song's data. The store's state is that data plus things that
aren't saved (selection, zoom, the playhead, what's open). `currentProject()` in the store
gives the saveable part as a `ProjectSnapshot`; `project.ts` turns it into the file format
(`serializeProject`) and reads a file back, checking and repairing every field
(`parseProject`), so old files and hand-edited ones still open.

Sound files are not in the store. They live in the **sound library** (`soundLibrary.ts`): stored
in IndexedDB under a hash of their bytes, decoded once per sample rate, with waveform peaks
measured in idle time. Clips and instruments refer to them by id. A saved project file embeds
the sounds it uses; the browser autosave doesn't (they're already in IndexedDB).

## What happens when...

### The page loads

`main.tsx` first picks the live audio context's buffering (`playbackMode.ts`), then mounts
`App`. The **Timeline** component wires the app together when it mounts:
`connectTimelineToAudio()` (the engine follows the store), `connectAutosave()` and
`installLiveInput()` (MIDI and the computer keyboard). `App.tsx` starts the performance monitor
and the error log. The app always opens on an empty timeline; if the last session had work,
`RestoreSessionBanner` offers it back (the previous autosave is set aside at startup by
`project.ts`). Browsers only allow sound after a click, so the audio context starts on the first
Play or Start Audio (`initAudio` in `engine.ts`).

### Someone edits the song

Take dragging a clip. `ClipView` calls `checkpoint()` when the drag starts (one undo step per
gesture), then a store action such as `moveClips` with each move. The action computes the new
clips (often with a helper from `src/store`) and `set()`s them. Then, all from that one `set`:

- React components that read those clips re-render (components select only what they need, so
  the rest don't).
- `connectTimelineToAudio`'s subscription sees new clips. It works out what the engine should
  play now (`liveView` in `freeze.ts` swaps frozen tracks for their audio, `launcherClips` swaps
  in clip-launcher slots, `withControllerLanes` turns CC lanes into automation), and updates only
  what changed: `syncLiveTracks` (track strips and instruments, `liveTracks.ts`),
  `rescheduleClips` (the note events, `scheduler.ts`), the audio clips and automation schedules,
  the Transport's loop, tempo and swing, the master settings, ducking and intensity.
- `connectAutosave` writes the song to localStorage a moment later.

**Undo** keeps up to 100 snapshots of the song's data (`HistoryEntry` in `timelineStore.ts`: the
tracks, clips, markers, tempo and meter maps, and master settings). `undo()` puts the previous
one back with `set()`, and the same subscriptions bring the screen and the sound along. The view
(zoom, scroll, the playhead, what's open) and the loop aren't in it, except that undoing an
insert or delete of bars puts the loop and playhead back where they were.

### Play is pressed

`play()` starts the audio context if needed and starts the live Transport at the playhead
(`startTransportAt` in `transport.ts`). From there the Transport drives everything on the audio
clock, ahead of time, so the main thread being busy doesn't make notes late:

- **Notes**: `createClipSchedule` (`scheduler.ts`) keeps one Transport event per tick that has
  notes. When it fires, it looks up that tick's note groups and hands each to its track's
  instrument, found by track id at that moment (so swapping an instrument needs no reschedule).
  Swing and the Human insert's drift are applied here.
- **Audio clips**: `createAudioClipSchedule` (`audioClipSchedule.ts`) starts each clip's sound at
  its tick, and handles starting, seeking or looping into the middle of one.
- **Automation**: `createAutomationSchedule` (`automationSchedule.ts`) writes each lane as
  parameter automation a short stretch ahead of the clock, through each parameter's
  `ParamWriter` (`effects/paramWriter.ts`), so a lane and a hand on the control never fight.
- **The playhead** is drawn by a `requestAnimationFrame` loop in the store that reads where the
  listener is now (`getAudiblePositionBar`, which allows for output latency) and sets
  `playheadPosition`.

Each instrument plays into its track's **channel strip** (`effects/trackStrip.ts`): inserts in a
fixed order, then pan, solo and mute, the fader, and sends. Strips play into the **master chain**
(`createMixChain` in `engine.ts`): master bus, compressor, the OTT and width inserts, limiter
and a soft ceiling, plus the shared reverb and delay returns.

### Someone plays a MIDI keyboard or records

`liveInput.ts` takes Web MIDI messages (decoded by `midi.ts`) and computer-keyboard notes, and
plays them straight on the audio clock (not through the Transport) into the armed or selected
track's instrument. While recording, `recorder.ts` stamps each note with where in the song the
player heard the music when they played it (`latency.ts`), and the store turns the take into a
clip (`recording.ts`, with quantize; loop passes and punches become take folders, `takes.ts`).
Microphone recording is `micRecorder.ts`.

### The song is exported

`ExportDialog` calls a render in `exportWav.ts`. `renderArrangement` makes an
`OfflineAudioContext`, makes it Tone's current context, and builds the whole graph in it from
the same factories as live: the master chain, a strip and instrument per audible track, and the
note, audio clip and automation schedules on the offline Transport. Rather than scheduling the
whole song up front, it renders in steps (`suspend()`), scheduling a little ahead each time and
disposing finished notes, so long songs render in linear time. The result is scaled down if its
true peak passes -1 dBTP, then encoded: WAV here (16/24/32-bit, markers as cue points), MP3 and
Ogg in `encoders.ts`, MP4 video in `videoExport.ts`. Stems, intro-plus-loop, seamless loops,
the game kit (`gameKit.ts`), FMOD / Wwise packages and freezing a track are all variations on
the same render.

One thing to know when touching this: Tone's clock runs ahead of the offline render, so
JavaScript callbacks (a source's `onended`, say) can fire before their sound has been rendered.
Clean up per-note nodes when they're disposed, not when they report ending.

### The song is saved, opened or shared

- **Autosave**: every change, to localStorage (`writeAutosave` in `project.ts`).
- **Save / Save As / Open**: `projectFile.ts`, with the File System Access API where the browser
  has it (Save then rewrites the same file), and a download elsewhere. Files embed their sounds.
- **Share**: a link with the whole song (without sound files) packed and compressed after `#s=`
  (`shareLink.ts`; older `#song=` links still open); opening it is `SharedLinkOpener`.
- Anything that replaces the song (New, Open, a link, Restore) goes through `loadProject`, which
  tells `onProjectReplaced` listeners (for example, to forget which file Save writes to).

## The instruments

`createInstrument(key, output, options)` in `instruments.ts` builds any instrument as a
`TrackInstrument`: `play(notes, time)` for scheduled notes, `noteOn` for held keys, and
`dispose`. By kind:

- **Synths** (`presets/`): Tone.js synths (`synths.ts`, `poly.ts`), or per-note plain Web Audio
  nodes (`native.ts`: the EDM basses and synths, chiptune, the FX instrument, the Synth Designer)
  that exist only while a note sounds.
- **Drum kits**: synthesized (`drums.ts`, `kitExtras.ts`) or recorded (`sampledKit.ts`), all on
  the same drum note map (`DRUM_NOTES`) so parts move between kits.
- **Recorded instruments** (`samplers/samplerManager.ts`): multi-sampled recordings downloaded
  once ever (kept in IndexedDB by `recordingStore.ts`, which can also download them all for
  offline use) and shared, with onset trimming, sustain looping, tuning fixes, tone shaping (including
  guitar amps), loudness layers and round-robin takes, and Expressive playing.
- **Your sounds**: the Sampler, Slicer, Drum Rack and Multi Sampler play sounds from the library;
  Plugin tracks host Web Audio Modules (`wamHost.ts`, `presets/wamPlugin.ts`).

Each instrument also gets its level correction from the catalog (`gain`) and a high-note taper.

## Built-in plugins

The Plugins menu's effects and instruments are open-source plugins compiled to WebAssembly
(`scripts/plugins/`, see its README), one file per family in `public/bos-beat-box-plugins/`,
described by the generated `audio/plugins/pluginCatalog.ts`. On a track they're Web Audio Module
plugins with a `builtin:<family>/<name>` address: `wamHost.loadWam` hands those to
`plugins/builtinHost.ts`, which makes an AudioWorkletNode (`plugins/processor.ts`) that looks like
a WAM (parameters, timed MIDI and automation events, getState / setState), so plugin tracks,
effect chains, automation lanes, saving, freezing and exports need nothing new. A family's
WebAssembly is downloaded once (kept like the instruments' recordings, `recordingStore.ts`),
compiled once per page, and instantiated once per audio context; every plugin of the family in
that context lives in that one instance's memory. Exports render in steps (suspend, schedule,
resume): `syncBuiltinPlugins` waits for every plugin's processor to have the step's events
before the render resumes. Families marked GPL are only in builds with `VITE_GPL_PLUGINS=1`.

## Keeping it fast

Web Audio keeps processing every connected node, even silent ones, and Tone's `Signal`s are
`ConstantSourceNode`s that run all the time. So:

- An insert effect exists only while it's switched on; switching it off disconnects and disposes
  it (`trackStrip.ts`). The common inserts are lean re-implementations (`effects/lightFx.ts`)
  with no Signals.
- Per-note instruments make their nodes when a note starts and let them go when it ends;
  polyphonic Tone synths free idle voices (`poly.ts`).
- The audio thread's cost is mostly a fixed price per node, so fewer nodes is the whole game.
  Recorded instruments play each note as one buffer source and one gain made straight on the
  browser's own context (`samplerManager.ts`, `nativeNodes.ts`), skipping the extra nodes and
  graph walks Tone's wrapper adds; their expressive filters are shared by notes of similar
  brightness. The parametric EQ builds only the bands in use, a send joins the track only while
  it's turned up, and the meter and spectrum analysers join only while something on screen reads
  them (`trackStrip.ts`).
- A recorded note stops where its recording falls silent, a long release stops once it's below
  -70 dB, and at most three notes of one pitch (64 in all) ring per instrument: a further one fades
  the oldest in about 50 ms (`samplerManager.ts`), so fast repeats of a ringing note don't pile up.
- Auto-freeze (`store/autoFreeze.ts`): in a song with 6 or more instrument tracks, tracks left
  unchanged for a few seconds are rendered in the background while the song is stopped, kept in
  memory only (`provideMemorySound` in `soundLibrary.ts`, budgeted by the device's memory), and
  handed to the engine through the same live view as a manual freeze (`liveView` in `freeze.ts`).
  A changed fingerprint puts the track back live at once. On the 5-starter test song it cut the
  audio thread's load from about 73% to 33%.
- The scheduler keeps one Transport event per tick, not per note, and updates incrementally.
- React components subscribe to the smallest slice of state they need; things that move every
  frame (the playhead, meters) are drawn by small components of their own, on one shared frame
  loop at a rate each asks for (`frameTicker.ts`, `playheadReadout.ts`), moving with CSS
  transforms and never reading layout (`scrollLeft`, `clientWidth`) in a frame.
- The lag badge (`perfMonitor.ts`) also checks that the audio clock keeps up with the wall
  clock, which catches the audio thread overloading even when the page itself is smooth.

## Where to start for common changes

- **Add an instrument**: an entry in `INSTRUMENT_KEYS` and `INSTRUMENTS`
  (`instrumentCatalog.ts`). A synth needs a factory in `presets/` and a case in
  `createInstrument`; a recorded one needs a sample source and an entry in `src/credits.ts`
  (a test checks every recording is credited). Then `npm run guide-tables` updates the guide's
  instrument list.
- **Add a track insert effect**: its settings in `TrackFx` with defaults and parsing
  (`timelineTypes.ts`: `defaultTrackFx`, `normalizeTrackFx`), the effect (usually in
  `effects/lightFx.ts`), its place in the chain (`trackStrip.ts`), its panel (`InsertFx.tsx`),
  and, if it can be automated, its parameters in `automation.ts`.
- **Add an action** (something that changes the song): declare it in `TimelineState` and
  implement it in `useTimelineStore` (`timelineStore.ts`), calling `checkpoint()` first if it
  should be undoable. Put the logic in a pure helper in `src/store` with a test if it's more than
  a few lines.
- **Add a field to the song**: the type in `timelineTypes.ts`, saving and reading it in
  `project.ts` (old files without it must still open), and `historyEntry` / `restoreEntry` in
  the store if undo should cover it.
- **Add a menu item, button or palette entry**: menus are `MenuBar.tsx`; the search palette's
  entries are `paletteEntries.ts`; dialogs open through `uiStore.ts`.
- **Add a genre starter**: `starters.ts` or `startersPlaylist.ts`, built with the helpers in
  `starterKit.ts`.

## Audio engine details

The hard-won rules of the engine. Each one is there because breaking it caused a real bug.

- Every Tone.js `Signal` is a `ConstantSourceNode` that Chrome processes all the time, even
  when nothing is connected to it. Idle nodes cost CPU, so effects are created only while
  they're switched on, polyphonic voices are disposed after a few seconds of silence, and the
  sound deck's instruments are built on first use.
- The WAV export drives Tone's offline clock by hand (`exportWav.ts`): it renders a second at a
  time, and before each second runs the clock in 128-sample steps to a quarter of a second past
  it. So Tone's callbacks run ahead of the audio; anything that disposes nodes must wait until
  the render has passed them.
- Settings that automation can drive (pan, sends, Filter cutoff / resonance, EQ bands, a Volume
  lane's gain) are written only through a `ParamWriter` (`effects/paramWriter.ts`), by the track
  strip and the automation scheduler alike. It never cancels a stretch that has started:
  `cancelScheduledValues()` inside a running ramp snaps the param back to where it was before,
  which clicks. So lanes are written in stretches of at most 50 ms, which bounds how late a seek
  or an edit is heard. Stretches are jumps and linear ramps, never `setValueCurveAtTime()`:
  Chrome only checks an event against the clock when it renders that param, and a strip nothing
  sounds into isn't rendered, so curves written meanwhile are moved when a note wakes it, end up
  overlapping, and crash the page. A `ParamWriter` never throws (it runs inside Tone's clock and
  store actions).
- Live, Tone runs on standardized-audio-context, which on every `connect()` and `disconnect()`
  walks every path downstream of the connection looking for loops (it stops only at a
  DelayNode). Each note connects fresh nodes, so the walk's length is paid per note: every live
  track strip starts with a zero-delay DelayNode that ends it there. Diamonds (a split that joins
  again) double the paths after them, so keep them behind that barrier.
- A connection made or broken on the main thread takes effect whenever the audio thread next
  renders, so re-patching a playing graph link by link opens gaps (or doubles the sound) for
  as long as the main thread takes in between. Live, each link of a strip's insert chain goes
  through a gain of its own, and switching an insert crossfades the old links into the new ones
  on the audio clock, then takes the old ones apart (`rewire` in `trackStrip.ts`).
  `cancelAndHoldAtTime()` holds nothing when no ramp is under way, so a fade that follows it
  needs a `setValueAtTime()` first, or it ramps from the param's last event.
- Transport positions are written in ticks (`` `${ticks}i` ``). Tone converts those through seconds,
  so `toneFixes.ts` makes results within float noise of a whole tick whole again; otherwise about
  one tick in ten was filed a tick early (skipped when playback started on it or a loop came back
  to it).
- Swing is applied by the clip schedule, not Tone's Transport, which bends every position inside
  an 8th; keep the Transport's own swing at 0. `swungNotes` in `transport.ts` picks the notes it
  delays per clip (off-beat 16ths on the clip's own 16th grid, or the song's if more of its notes
  sit there, as after a cut off the grid; an 8th holding a 1/32 or triplet run stays straight)
  and `swingDelay` says by how much.
- Project files are versioned (`PROJECT_VERSION` in `project.ts`). New optional fields don't
  need a version bump; older builds ignore fields they don't know.
- Live input and recording work in *heard* time (`heardTime` in `latency.ts`): the clock says
  what the graph renders now, the listener hears it an output latency later (30-40 ms in Chrome,
  from `getOutputTimestamp()` on the native context behind standardized-audio-context's). A note
  played against the music is placed at the Transport position heard when the key went down, and
  a take ends where the listener was when they stopped. Held keys use each instrument's `noteOn`
  (a Tone synth's `triggerAttack`, or for the native-node synths a long note let go early with
  `VoiceSet.release`); an instrument without one plays held keys as short sequenced notes.

## Builds

- `npm run dev`: Vite dev server.
- `npm run build`: type check and production build into `dist/`.
- `npm run build:single`: `dist-single/index.html`, the whole app inlined into one HTML file
  (`scripts/build-single.mjs`). That file is what's published. The real instruments' recordings
  (`public/bos-beat-box-samples`) are served next to it, not inlined.
- `npm run build:runtime`: `dist-runtime/bos-player.js`, the player that games use to play a
  saved project (`src/runtime/player.ts`).
