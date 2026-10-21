# Fledgetone: handoff

Read this first when picking the project up in a new session. (Updated for version 2026.10.21: Fledge Synth, Fledgetone's own synthesizer, on top of 224 instruments, 75 starters and six demo songs, about 640 built-in plugins, the producer tools, the installable app.) It covers what the app is, how
the code is laid out, how to check changes (including sound), what's finished, and what's next.

## The app and who it's for

Fledgetone is a music maker that runs in the browser. It's laid out like a video editor more
than a classic DAW: an arrangement timeline with tracks and clips, a timecode readout, markers,
a ripple-editing toolbar. It's used mostly for **dubstep and EDM**, so bass sounds, drops and
loudness matter more than orchestral realism.

- Repository: `martinmswanson-cmd/fledgetone` (public, GPL-3.0), default branch `master`.
- Work branch: `ccr-1ba142ee-suz8wp`. It holds everything finished, and `master` follows it.
- **Publishing**: fledgetone.com is built by Netlify from `master` on every push (`netlify.toml`:
  `npm run build:site`, with the GPL plugins): the home page (`site/`) at `/`, the app
  at `/app/` with the recordings and plugins next to it, as an installable app with a service worker. The old addresses on
  twobirdsworkshop.com (`/fledgetone.html`, `/fledgetone`, `/bos-beat-box`, `/bos-beat-box.html`)
  redirect to fledgetone.com with a 301; twobirdsworkshop.com still serves `fledgetone-samples/`
  and `fledgetone-plugins/` as the app's fallback download addresses.
- `npm run build:single` (`dist-single/index.html`) still makes the whole app in one HTML file,
  to run from a file; it isn't published any more.
- Users read `GUIDE.md` (also shown in the app with `?`). Every user-visible change updates it.

## Stack and commands

React 19, TypeScript, zustand, Tone.js 15, Tailwind, Vite. No backend: projects autosave in the
browser and save to `.fledgetone.json` files.

```
npm install
npm run dev            # dev server
npx tsc -b             # type check
npx oxlint src         # lint (17 known warnings, all only-export-components: files that export a helper next to their component)
npm test               # node --test scripts/*.test.mjs
npm run build          # production build of the app alone
npm run build:single   # the one-file build (dist-single/index.html)
npm run build:site     # fledgetone.com: home page (site/) at /, the app at /app/, GUIDE.md as pages at /guide/ (Netlify runs this)
npm run guide-tables   # rewrite GUIDE.md's instrument list and credits from the catalog
npm run codemap        # rewrite docs/CODEMAP.md from the files' summary comments
npm run app:sync       # the phone app: build dist-app/ and copy it into ios/ and android/ (docs/APP.md)
```

Run them all before every commit (CONTRIBUTING.md, The checks), and the sound checks
(`scripts/audio-check/repeat.cjs`, `starters-loudness.cjs`) when a change touches sound.

## Where things live

For how the parts fit together see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); for every file, [docs/CODEMAP.md](docs/CODEMAP.md) (generated from each file's summary comment: `npm run codemap`). The table below is the quick version.

| Area | Files |
|------|-------|
| Instruments list (names, ranges, sample sets, levels, shaping) | `src/audio/instrumentCatalog.ts` |
| Recorded instruments: loading, onset trim, per-instrument tone shaping, high-note taper | `src/audio/samplers/samplerManager.ts` |
| Synth presets (Wobble, Growl, Reese, Supersaw, 808...) | `src/audio/presets/` |
| Track inserts (Distortion, Filter, Pump, Chorus...) | `src/audio/effects/` |
| Audio graph, master bus, live playback | `src/audio/engine.ts`, `liveTracks.ts`, `scheduler.ts`, `transport.ts` |
| Export (offline render, stems, intro + loop) | `src/audio/exportWav.ts`, `ExportDialog.tsx` |
| MP3 / OGG encoding (wasm-media-encoders), WAV loop chunk | `src/audio/encoders.ts`, `wavCues.ts` |
| MP4 video (WebCodecs + Mediabunny) | `src/audio/videoExport.ts` |
| Spectrum readouts (bars and character styles), master analyser, Mixer view | `src/audio/spectrumSkins.ts`, `masterSpectrum.ts`, `src/components/timeline/SpectrumView.tsx` |
| Share link (`#s=`; older `#song=` still opens), Share dialog, opening a link | `src/store/shareLink.ts`, `ShareDialog.tsx`, `src/components/SharedLinkOpener.tsx` |
| Synth Designer (patch, presets, engine, panel) | `src/store/synthPatch.ts`, `src/audio/presets/designer.ts`, `src/components/inspector/SynthPanel.tsx` |
| Recorded drum kits, extra drum rows (clap, toms, crash, ride) | `src/audio/presets/sampledKit.ts`, `kitExtras.ts`, `DRUM_NOTES` in `instruments.ts` |
| Piano roll helpers (scales, chords, arp, strum, humanize) | `src/store/noteTools.ts` (unit tested) |
| Reference video (lane, preview, export onto it) | `src/store/videoStore.ts`, `src/components/video/`, `footage` in `videoExport.ts` |
| Mixer, Game preview, Mic | `src/components/timeline/MixerPanel.tsx`, `GamePreview.tsx`, `MicButton.tsx`, `src/audio/micRecorder.ts` |
| Lag detection, Clear memory | `src/audio/perfMonitor.ts` (late notes counted in `notLate`), `src/components/PerfBadge.tsx` |
| Search: palette (Ctrl+K), searchable instrument lists | `src/search/` (matching in `searchCore.ts`, unit tested; palette entries in `paletteEntries.ts`), `src/components/SearchPalette.tsx`, `InstrumentMenu.tsx` |
| Open dialogs, Inspector tab, guide section (so search can open them) | `src/store/uiStore.ts` |
| Sample credits, generated guide tables | `src/credits.ts`, `scripts/guide-tables.mjs` (a test fails if the guide is stale or an instrument has no credit) |
| Pitch corrections for recordings | `src/audio/sampleTuning.ts` (generated by `scripts/pitch-survey/`) |
| Tour and tutorials (welcome on first visit, LEARN, spotlight card) | `src/tour/lessons.ts` (steps: target selector, optional `task.begin`/`task.done` checks), `src/tour/tourStore.ts`, `src/components/tour/` |
| Genre starters: helpers, the style batch (artcore, bass music, phonk, jazz-pop...) | `src/store/starterKit.ts`, `src/store/startersPlaylist.ts` (metadata and groups in `starters.ts`; levels in `startersLoudness.ts`, measured by `scripts/audio-check/starters-loudness.cjs`) |
| The Classics (demo songs in New: five public-domain pieces) | `src/store/startersClassics.ts` (the arrangements), `classicsScores.ts` (the notes), `scoreNotes.ts` (the format), `SCORE_CREDITS` in `src/credits.ts`; New lists them under Demo songs (`ProjectBar.tsx`) |
| Key change, ratchet / roll tools | `src/store/keyChange.ts` (ruler menu), `ratchet` / `roll` in `noteTools.ts` |
| Human insert (per-note timing / velocity / pitch drift) | `src/audio/human.ts` (seeded from clip id, note id and tick; unit tested in `scripts/human.test.mjs`), applied in `scheduler.ts` `playGroup`; panel `HumanPanel` in `InsertFx.tsx` |
| Tempo finder (hit points = markers locked to time, Shift+M) | `src/store/tempoFinder.ts`, `HitFinder` in `TempoControls.tsx`, `addHit` in the store |
| Cut to length | `src/store/cutToLength.ts` (sections, plan), store action `cutToLength`, `CutToLengthDialog.tsx` |
| Sound effects maker, song key detection | `src/audio/sfx/sfxSynth.ts` (pure renderer + recipes), `src/components/sfx/SfxMakerDialog.tsx`, `src/store/songKey.ts` |
| Game stingers (saved in the project, fired from the Game preview) | `src/store/stingers.ts` (recipes, parse), `src/audio/stingerPlayer.ts` (fire on next beat, render), `StingerList` in `GamePreview.tsx` |
| Scene cuts in the reference video, markers for editors | `findSceneCuts` in `videoStore.ts` (+ `src/store/sceneCuts.ts`), `addHitsAt`; `src/store/editorMarkers.ts` (EDL / FCP7 XML / FCPXML / CSV), `ExportForEditors` in `MarkerList.tsx` |
| Loop variations (takes A-D for games) | `src/store/loopVariations.ts`, `renderLoopTakes` in `exportWav.ts`, `LoopVariations` in `GamePreview.tsx` |
| Transition matrix and audition pads | `src/store/transitions.ts` (rules keyed `from>to`, `*` for any; older files' `markerId: kind` become `*>id`), `ruleFor`; `TransitionMatrix` and `AuditionPads` in `GameMatrix.tsx` (the audition runs `src/gameKit/adaptive-music.js`, the same player the kit ships, typed by `adaptive-music.d.ts`); `goTo` in `GamePreview.tsx` |
| Game kit export (states, stems by group, stingers, transitions, audio_manifest.json v2, players) | `src/audio/gameKit.ts` (`buildGameKitParts` also feeds the audition), `renderGroupStems` in `exportWav.ts`; the players are plain files in `src/gameKit/` imported with `?raw` (the web one was run on a real kit; the Godot and Unity ones haven't been compiled here: no engines in the container) |
| Dip under dialogue (video's speech to volume automation) | `src/store/dialogue.ts` (voice-band levels, speech spans, `dipLane`), `findDialogue` in `videoStore.ts`, store `dipUnderDialogue`, `DialogueDipButton` in `VideoLane.tsx` |
| Intensity and stem groups | `src/store/intensity.ts` (curves), `track.stemGroup`, store `intensity` / `intensityCurves`; a `level` gain after each strip's fader (`setIntensityLevel` in `trackStrip.ts`), set live by `applyLiveIntensity` and in renders by `RenderOptions.intensity`; UI `IntensityPanel.tsx` and the header slider |
| Clip launcher (Launcher dock tab) | Slots on `Track.slots` (saved, undone, parsed by `parseSlots` in `project.ts`); what plays is `useLauncher` segments in `src/store/launcherView.ts` (pure: `launcherClips` rewrites the clip list the live engine gets, unit tested in `scripts/launcher.test.mjs`); actions and Write to arrangement in `src/store/launcher.ts`; UI `LauncherPanel.tsx`. While in use the transport doesn't loop (`loopOf` in `connectTimelineToAudio`); stopping playback ends the session |
| Bounce in place | `bounceTrack` in `src/store/freezeActions.ts` (shares `renderTrackSound` with freezing) |
| Smart tools (chord progressions, chords for a melody, bass from chords, drummer, fills) | Pure, seeded, unit tested: `src/store/smartTools.ts` (`scripts/smartTools.test.mjs`); store side `src/store/smartActions.ts`; dialog `SmartDialog.tsx`; menu items in `ClipContextMenu.tsx` |
| Autosave storage format | Notes packed as `N: [note, startOffset, duration, velocity, expr?]` lists (`packForStorage` / `unpackStored` in `project.ts`), lossless; saved at most 3 s after the first unsaved edit; a last session only the autosave holds is never overwritten (`previousOnlyInAutosave`); an unreadable autosave is kept under `bos-beat-box.autosave.unreadable` |
| Micro-variations (clip menu › Generate variations) | `src/store/microVariations.ts` (takes, notes, trim), `src/audio/microVariations.ts` (render + resample), `VariationsDialog.tsx` |
| Ducking under a proxy track | `src/store/duck.ts` (curve from the proxies' clips), `track.duckProxy`; a `duck` gain after each strip's Intensity level, driven as a hidden lane by `automationSchedule.ts` (`update(tracks, duck)`), live via `setLiveDuck` and in renders from `opts`; `DuckProxyPanel` in `InsertFx.tsx` |
| Web runtime (bos-player.js) and its kit | `src/runtime/player.ts` (`loadSong`), built by `npm run build:runtime` (`vite.runtime.config.ts`) into `dist-runtime/bos-player.js`, which `src/audio/runtimeKit.ts` imports with `?raw`; `dev` and `build` run it first. Keep `timelineStore` out of `src/audio` (the runtime would carry the whole app store) |
| Lo-fi and Gate inserts | `createLightLofi` / `createLightGate` in `effects/lightFx.ts`; the Gate is chopped by the strip's beat clock (`createPumpClock`) |
| Genre starters, build-up & drop | `src/store/starters.ts`, `src/store/buildDrop.ts` (action `addBuildAndDrop`) |
| Audio clips, sound library (IndexedDB), Slicer | `audioClipSchedule.ts`, `soundLibrary.ts`, `slicing.ts`, `src/store/audioClips.ts` |
| MIDI keyboard, recording, metronome | `midi.ts`, `recorder.ts`, `metronome.ts`, `src/store/recording.ts` |
| Return tracks and sends; Delay and Reverb inserts | `isReturn` / `liveSends` / `tidySends` in `src/store/buses.ts`; `setSends` / `sendTarget` in `trackStrip.ts` (gains tapped from `merge` pre-fader or `duck` post); `src/audio/effects/spaceFx.ts` (`createEcho`, `createReverb` with a seeded noise impulse, `insertTailSeconds` for exports' ring-out) |
| Automate anything, MIDI learn | `specOf` / `parseParam` / `FX_AUTOMATION` / `pluginParamInfo` in `src/audio/automation.ts`; params are `send:<id>`, `fx:<insert>.<field>`, `plugin:<pluginId>:<paramId>`. Non-native settings are "controls" in `trackStrip.ts`: a ParamWriter on no param, read on every context tick (`controlTick`) and applied with `atControlTime` (so exports schedule ahead); plugin params via `setWamParam`. MIDI learn: `src/store/midiLearn.ts`, `Track.midiMap` |
| Audio editing: warp, quantize, gain envelope, reverse, normalize | `src/store/warp.ts` (pure, tested: `beatAt`/`srcAt`/`sourceAt`/`clipSecondsAt`, `quantizeWarp`); warped copies in `soundLibrary.ts` (`warpSound`, piecewise WSOLA); `audioClipSchedule.ts` plays them and the envelope (a second gain per voice); `src/audio/audioEdits.ts`; editor overlay `AudioWarpGain.tsx` |
| Drum Rack, Multi Sampler | `src/store/sampleKits.ts` (pure, tested: pads, `mapZones`, `zoneFor`, names to roots), `src/audio/presets/sampleKits.ts` (buffer-source voices; a WaveShaper with no curve was silent live, so the drive stage is patched in only when used), `SampleKitPanels.tsx` |
| CC lanes, per-note expression, MPE | `Clip.expression.cc<n>` lanes (`laneCc`, `lanesOf` in `expression.ts`); `src/store/ccLanes.ts` turns them into automation (`withControllerLanes`, used live in `connectTimelineToAudio` and in `renderTracks`); plugins get CC via `TrackInstrument.cc`. `NoteEvent.expr` (`noteExpression.ts`), played by `playExpressive` in `scheduler.ts` through `TrackInstrument.noteVoice` (Multi Sampler) or a whole-instrument bend; MPE input in `liveInput.ts` (`mpeNotes`), recorded by `Take.noteControl` |
| Notation, MusicXML | `src/store/notation.ts` (pure, tested: `notate`, `spell`, `musicXml`), `NotationView.tsx` (VexFlow with the Bravura font, imported statically so the one-file build has it) |
| Real instruments (hosted recordings, loudness layers, takes, guitar amps) | `hosted` in `instrumentCatalog.ts` (files in `public/fledgetone-samples`, rebuilt by `scripts/real-samples/`); `SampleSource.layers` played by a sampler per layer and take (`createSamplerVoice`); `AMPS` in `samplerManager.ts` (built in `shapingChain`); fledgetone.com serves the folder next to the page, twobirdsworkshop.com is the fallback address |
| App state, undo, project load | `src/store/timelineStore.ts`, `timelineTypes.ts` |
| Project file format, autosave | `src/store/project.ts` |
| Timeline UI | `src/components/timeline/` |
| Inspector (track and master panels) | `src/components/inspector/` |
| Drop a project file to open it / phone notice | `src/components/ProjectDrop.tsx`, `MobileNotice.tsx` |
| Drop pad: the effects (one kernel, live worklet and export), the moves from the Drop track's notes, live control, Pocket's pads | `src/audio/effects/dropFx.ts`, `src/store/dropMoves.ts`, `src/audio/dropLive.ts`, `src/pocket/PocketDrop.tsx`; in the master chain (`masterChain.ts`, setDrop) and the export's master pass (`masterAfter.ts`, `exportWav.ts` dropFramesOf) |
| Fledge Synth engine (Rust, GPL): parameters, voices, modulation, effects, presets, the bb_* interface | `engine/fledge-synth/src/` (`params.rs`, `synth.rs`, `dsp.rs`, `fx.rs`, `tables.rs`, `presets.rs`, `abi.rs`); built to `public/fledgetone-plugins/fledge.wasm` by `engine/fledge-synth/build.sh` |
| Fledge Synth window | `src/components/timeline/FledgeSynthPanel.tsx`, `src/audio/plugins/fledgeLayout.ts` (controls by parameter name), `fledgeWave.ts` (wave pictures from a main-thread copy of the engine) |
| Built-in plugin host (Fledge Synth and every other built-in plugin) | `src/audio/plugins/builtinHost.ts` (main thread), `processor.ts` (the worklet), `src/audio/wamHost.ts` (live instances, settings reads, retiring) |

`docs/ARCHITECTURE.md` (Audio engine details) has the engine notes: how the track strip
re-patches without gaps, why automation goes through a ParamWriter, how exports repeat exactly,
and so on.

| Recent area | Files |
|------|-------|
| Installable app: service worker, update notice, storage protection | `src/pwa/` (`pwa.ts`, `sw.js`, `installAdvice.ts`), `UpdateNotice.tsx`, `StorageStatus.tsx`, the `serviceWorker` plugin in `vite.config.ts`, `public/manifest.webmanifest`, `public/_headers`; tested in `scripts/pwa.test.mjs` |
| Exports that repeat exactly | `src/audio/exactSums.ts` + `sumChain.ts` (fixed summing order), `endedOnTime.ts` + `endedDue.ts` (ended handlers on the render's clock), `seededNoise.ts`; checked by `scripts/audio-check/repeat.cjs` |
| No sound until asked, silence on close | `holdUntilAsked` / `initAudio` in `src/audio/engine.ts` |
| Effects that make their own sound fade once their track is quiet | `followInput` in `src/audio/plugins/processor.ts`, `HOLDS_FOREVER` in `builtinHost.ts`; `scripts/pluginFollow.test.mjs` |
| Speed up into the drop | `src/store/speedUp.ts` (pure), `speedUpActions.ts`, `SpeedUpSection.tsx` (Arrange a beat), the clip menu's quick items in `ClipContextMenu.tsx` |
| Arrange a beat (dark melody, drops, beat switch, song form, producer tag) | `src/store/darkMelody.ts`, `arrangeActions.ts`, `beatSwitch.ts`, `songForm.ts`, `producerTag.ts`; `ArrangeDialog.tsx` |
| Heavy bass, drum, vocal, mix and sample tools | `bass808.ts`, `bassTools.ts`, `kickClash.ts`, `drumDesign.ts`, `drumGroove.ts`, `noteRepeat.ts`, `vocalChains.ts`, `vocalActions.ts`, `busPresets.ts`, `sampleFlip.ts`, `flipActions.ts` in `src/store/`; `hardTune.ts`, `vocalDouble.ts`, `mixCheck.ts`, `referenceTrack.ts`, `beatPack.ts`, `sampleAnalysis.ts` in `src/audio/` |
| Learn menu (tour and tutorials) | `MenuBar.tsx` (the Learn menu), `src/tour/lessons.ts`, `LearnDialog.tsx` |

### Things that bite

CONTRIBUTING.md's list is the full one (it also covers exports that must repeat exactly, code
inlined into a worklet as text, the service worker being production-only, the sound held until
asked, and built-in effects that fade by themselves). The ones met most often here:

- **The welcome dialog covers a fresh page.** Browser tests start from an empty browser, so set
  `localStorage['bosBeatbox.welcomeSeen'] = 'true'` first (Playwright `addInitScript`) or the
  dialog sits on top of what they click.

- **Tone's "ended" comes early in an export.** The offline clock runs ahead of the render, so a
  source's `onended` can fire before it has sounded. Clean up per-note nodes when the source is
  disposed (exportWav.ts disposes them once the render is past them), never in `onended`.

- **Live and export must sound the same.** Every sound path is built for both the live context and
  the offline export context. Change one, check both.
- **Switching an effect while playing must not drop out.** Track strips crossfade on the audio
  clock when inserts change. Keep that pattern for anything new on a track or the master.
- **Nodes made on the browser's own context.** Per-note nodes of the recorded instruments and the
  native buses are made straight on the native `AudioContext` (`nativeNodes.ts`) to skip Tone's
  wrapper. Connect native nodes into a Tone node with `nativeInputOf`, never the other way, and
  hold `keepActive(node)` on a Tone node only native nodes feed, or the wrapper decides it's idle
  and stops passing sound.
- **Vite hot reload and test pages.** After editing `src/`, restart the dev server before running
  the audio checks. Otherwise the test page can import a stale copy of a module and measure the old
  code.
- **Built-in plugins keep two sets of values** (`builtinHost.ts`): `own`, the settings the knobs,
  presets and saved state set (saved, and what a parameter goes back to), and `params`, what it
  plays and shows. While an automation lane holds a parameter (`laneHeld`), the lane is in charge:
  the knob follows the lane, is marked `held` (dimmed, outlined, "automated by a lane"), and
  ignores the knob, MIDI learn and Reset all until the lane is deleted (`resetParam`, which also
  drops the lane's queued events in the worklet). Knobs turned from a MIDI controller go through
  `setParamNow`, like a turn of the knob.
- **Plugin settings reach the tracks every 3 s.** Anything that saves, shares, renders or freezes
  awaits `captureWamStates()` first (renders do it in `renderTracks`); closing the tab uses
  `captureWamStatesNow()`. Reads are numbered so a slow, late answer never replaces a newer one.
- Wobble rates are `'1/4'`, `'1/8'`, `'1/16'` (not Tone's `'8n'`).
- Sample libraries load from GitHub (`nbrosowsky/tonejs-instruments`, files spell sharps with `s`,
  e.g. `As3.mp3`) and the FluidR3 General MIDI set. Check a file exists before listing it.

## Checking sound

The app can't be judged by unit tests alone. `scripts/audio-check/` renders real audio through the
app's own export path in a headless browser and measures it:

```
npm run dev -- --port 5200      # restart after editing src/
START=1 OUT=/tmp/before node scripts/audio-check/run.cjs scripts/audio-check/phrases.js '{"keys":["violin","cello"]}'
# change the code, restart the dev server
START=1 OUT=/tmp/after  node scripts/audio-check/run.cjs scripts/audio-check/phrases.js '{"keys":["violin","cello"]}'
python3 scripts/audio-check/phrases.py /tmp/before
python3 scripts/audio-check/phrases.py /tmp/after
ffmpeg -i /tmp/after/violin.wav -q:a 2 violin-after.mp3   # to listen to
```

`phrases.js` plays eight rising notes and a held note per instrument. `phrases.py` prints, per
note, the level (dB), spectral centroid (Hz) and the share of energy above 2.5 kHz. Write your own
page scripts the same way for other checks: `lib.js` (prepended) has `mkTrack`, `mkClip`, FFT and
spectrum helpers. Needs Playwright with Chromium, ffmpeg, Python with numpy. Analyse in Python,
not in the page: in-page spectra came out wrong before.

## Finished (on the work branch)

Performance and export fixes; timecode and frame rates; markers; ripple editing; stereo channel
strips; swing; automation lanes; EDM synths (Wobble, Growl, Reese, Supersaw, Pluck, FX) and the
Filter, Pump and Distortion inserts; audio tracks and clips, a sound library and the Slicer for
vocal chops; MIDI keyboard input, recording takes with count-in and loop overdub, metronome,
computer-keyboard piano; every recording the sample libraries offer for each instrument, with
shaping for the Erhu, Electric and Acoustic Guitar, Violin and Cello and a quieter top octave on
Violin and Erhu; drag a `.fledgetone.json` onto the page to open it; a one-time notice for phone users.

## Recently finished

- **Drop pad** (on the work branch, not released): hold a pad to stutter, filter, tape-stop, crush,
  gate or echo the whole mix. It's a track (the Drop Pad instrument, kind `drop`) whose notes are
  the moves, one row per effect (DROP_ROWS), so copying a section copies its moves, the studio
  edits them in the piano roll, and mute turns them off. The effects run on the master after the
  OTT and width, before the Level and limiter: live in a worklet that's in the chain only while
  the song has a Drop track; in exports the same kernel runs over the render in masterAfter, at
  the samples dropFramesOf works out (checked: a Gate move's closed halves line up within 4 ms,
  in one piece and in parts). Drop notes play straight (no swing, groove shift or Human), a key
  change leaves them alone, and a held note lets go at the loop's end (live) or the range's end
  (export). In Pocket, presses and let-gos land on 16ths; with Rec on, each hold is written into
  the section over what that effect had there.
- **Pocket stage 1, the app shell** (on the work branch, not released): Pocket as a phone app with
  Capacitor ([docs/APP.md](docs/APP.md)). `ios/` and `android/` are the native projects;
  `src/native/nativeApp.ts` is the bridge (haptics, screen kept on, share sheet for exports and
  project files, links to fledgetone.com), and each function does nothing on the web. The iPhone
  project sets the audio session (`.playback`, background audio) and the microphone and Files
  settings. An Android test build was made and checked (`./gradlew assembleDebug`); the iPhone
  build needs a Mac with Xcode. The recordings aren't in the app and load from
  fledgetone.com/app/. Found on the way: the recordings' and plugins' fallback address pointed at
  twobirdsworkshop.com, whose copy of the recordings is gone (it answered with a web page), so
  the one-file build had no recorded instruments. Both now point at fledgetone.com/app/, and a
  web page in place of a file counts as missing (`fetchBytes`, `waitFor.ts`). Still to do for
  stage 1: run it on a real iPhone (the checklist is at the end of docs/APP.md). Still to decide:
  the app's name and ID, and whether some recordings go in the app.
- **Fledge Synth** (2026.10.21): Fledgetone's own GPL synthesizer, in Rust compiled to WebAssembly
  and loaded like any built-in plugin (`builtin:fledge/Fledge Synth`). 215 parameters by name
  (`params.rs`, `index_of`), 8 voices with up to 16 unison each, two wavetable oscillators, two
  filters, four LFOs (two drawn), three envelopes, macros, an 8-slot matrix, EQ, chorus,
  phaser/flanger, an 8 s delay, reverb, drive and an OTT, and 35 level-matched presets. After 23
  rounds of bug hunting the engine has 80 tests (`cargo test --release`), including the voice
  handling (repeated, very short and pedal-held notes, the same key struck twice, mono and legato
  retriggers, stealing). To change it: edit `engine/fledge-synth/src/`, run `cargo test --release`,
  then `./build.sh` and `node scripts/plugins/catalog.mjs > /dev/null` (don't pipe it to `head`:
  that stops it before it writes), then `node --test scripts/plugins.test.mjs` (checks the window's
  layout against the engine and that every preset plays).

- **Tempo map and time signatures** (`src/audio/tempoMap.ts`, pure, tested in
  `scripts/tempoMap.test.mjs`): positions stay in bars of 4 quarter notes; a `Tempo` is a number
  or `{bpm, points}` where each point jumps or glides (linear in time) from the one before. Every
  bars↔seconds conversion takes a `Tempo` (`barToSeconds`, `secondsToBar`, `tempoAt`). Meters
  only change counting (ruler, grid, readouts, metronome, count-in): `measuresBetween`,
  `toMeasureBeat`. Live, `scheduleTempo` puts Transport tempo events at each change and at the loop
  In, and `applyTempoAt` sets it on start and seek; exports do the same in the offline Transport.
  Audio clips play at `tempoAt(clip.startBar)`. UI: `TempoRow.tsx` (the ruler's top row), ruler
  menu entries. Store: `tempoPoints`, `meter`, `meterPoints` (in history, saved).
- **Buses** (`src/store/buses.ts`, tested): a track with `instrumentKey: 'bus'`; others route to
  it with `Track.output`. `soloLit` / `audibleIds` carry solo and mute through bus chains;
  `busFirst` orders renders so a bus strip exists before its inputs. A bus strip gets √2 input
  makeup (`trackStrip.ts`) so 0 dB centred is transparent through the double pan law.
- **Expression lanes** (`src/store/expression.ts`, tested): `Clip.expression = {bend, mod,
  sustain}`. Sustain lengthens notes (`sustainNotes`) before scheduling; bend and mod become pitch
  events every 1/128 bar where they move (`pitchEvents`), fired before notes. The recorded
  instruments bend through `samplerVoice`, which starts and releases its own sources and keeps
  each one's base rate (Tone's Sampler forgets a source once its release is scheduled).
  `ExpressionLane.tsx` is the editor.
- **Punch and takes** (`src/store/takes.ts`, tested; `recording.ts`): `Clip.takes` and `Clip.comp`
  (segments `{at, take}`). A MIDI folder's notes are rewritten from the comp (`applyComp`); a mic
  folder is expanded into one clip per segment at play time (`expandAudioComp`, live and export),
  overlapping by 10 ms so the automatic crossfade blends the joins. `Take` tracks the loop pass of
  each note (`cover` starts a pass); `finish(…, {passes, punch})` splits by pass and crops to the
  punch. Mic takes: one sound, each take an offset into it (`recordedPieces`). Punch state is
  session-only (`punch` in the store); `recordOptions.takes` is per browser. UI: `TakesDialog.tsx`,
  the record popover, the ruler's red punch bar.
- **WAM plugins** (`src/audio/wamHost.ts`, `presets/wamPlugin.ts`, `PluginDialogs.tsx`):
  `@webaudiomodules/sdk` sets up the host per native context; plugins load by dynamic import.
  They're wired into Tone's graph natively (`_nativeAudioNode`), and every Tone node a plugin plays
  into gets `keepActive` (a silent ConstantSource): standardized-audio-context takes nodes with no
  input it knows of out of the native graph, which silenced plugins live (offline worked). The
  SDK's base `initialize` ignores the initial state, so the host calls `setState` itself. Live
  instances register by plugin id (for their windows); `captureWamStates` reads settings every 3 s
  and on window close into `Track.plugin.state` / `pluginFx[].state` (no undo step). URLs from an
  opened project need allowing (`allowPluginUrls`, localStorage); the instrument rebuild key
  includes `pluginEpoch()`. Tested with two small SDK plugins (a sine synth and a level effect)
  served locally; the public plugin sites weren't reachable from the sandbox, so try a real one.

- **Spectrum styles** (`spectrumSkins.ts`): one `drawSpectrum(g, skin, rect, bands, t, memory)`
  draws LED bars, Neon city, Grid terrain, Radar HUD, Data rain or Holo pigeons into any canvas
  rect (in canvas pixels, no transform: the glitch and the city's reflection copy the canvas onto
  itself). Cyberpunk look: magenta/purple/cyan/yellow for lows to highs, `neon()` lines with
  additive glow, and `overlay()` (scanlines, HUD brackets, peak readout, glitch on bass hits) on
  every style. `memory` keeps each style's state between frames. The Mixer tab shows it live from
  an analyser on the master output (`masterSpectrum.ts`, connected only while shown; style in
  localStorage), and the MP4 export draws its spectrum with it ("Visualizer style", LED bars by
  default). The holo pigeons are the Two Birds logo's: one faceted (`FACETS`), one a pixel sprite
  (`SPRITE`).
- **Mastering** (merged from `qol/q`): the Inspector's Master tab has a loudness meter, an OTT
  (`src/audio/effects/ott.ts`, with makeup gain and a primed start so it doesn't burst when
  switched on) and Stereo Width (`masterChain.ts`). The header shows loudness. Exports report LUFS
  and true peak, and mixdowns can normalize to -14 LUFS (`ExportDialog.tsx`, `loudness.ts`).
- **Genre starters** in the New dialog (`src/store/starters.ts`): Dubstep, House, Drum & Bass,
  Trap. Each is 16 bars with section markers and master settings, balanced so drums lead.
- **Strings**: Violin and Cello now come from the Musyng Kite soundfont (dry, fast attack), plus a
  new Strings section instrument. The soundfont files stop at 3.1 s, so the loader loops their
  steady part up to 10 s (`extendSustain` in `samplerManager.ts`).

- **Freeze tracks** (`src/store/freeze.ts`, `freezeActions.ts`, `FreezeButton.tsx`): a track's
  instrument, inserts and EQ rendered to a library sound; the engine is handed a "live view" in
  which the frozen track is an Audio track with one clip of that sound (volume, pan, sends stay
  live). A fingerprint decides whether the freeze is current; otherwise the track plays live.
  The frozen gain adds back the centre pan law and the bus gain that playback applies a second
  time (`BUS_GAIN` in engine.ts). Cuts live audio work about 3.7x on a 36-track test song.
- **Built-in plugins** (`src/audio/plugins/`, `scripts/plugins/`): 644 open-source effects and
  instruments (Airwindows, MDA, Open303, Mutable Instruments with Braids, Faust) compiled to WebAssembly and
  hosted as WAM-shaped AudioWorklet nodes behind `builtin:` addresses. Plugins menu, browser
  (`PluginBrowser.tsx`), panel (`BuiltinPluginPanel.tsx`). Instruments are level-trimmed in their
  wrappers. GPL families (Surge XT with 607 factory patches fetched on demand, Dragonfly's four
  reverbs, Plateau reverb, setBfree organ) only in `VITE_GPL_PLUGINS=1` builds: the dev server and `npm run build:full`
  (`dist-full/`). Never copy `public/fledgetone-plugins/gpl/` to the site before the app's source
  is published.
- **Sound effects maker** (`src/audio/sfx/sfxSynth.ts`, `src/components/sfx/SfxMakerPanel.tsx`): layered
  sounds (up to 4 layers: waves, noise, FM, bell, crackle; SVF filter; seq notes) with drive, echo
  and reverb over the whole; ~70 kinds in `SFX_GROUPS`, `SFX_SETS` made with a shared style seed;
  levelled per kind (`LEVEL_DB`), trimmed, seamless loops (`smpl`), variations (`varySfx`), WAV/OGG,
  zips; My sounds in localStorage (`bosBeatbox.mySounds`). Pure maths, unit-tested in sfx.test.mjs.
- **Game sounds in the game kit** (`src/store/gameSfx.ts`): `gameSfx` in the store / `sfx` in the
  project (not undo steps, like stingers); the kit renders `sfx/<name>_NN.wav` and lists them in
  `manifest.sfx`; every player has playSfx / stopSfx. Kit layouts `any` / `godot` / `unity`
  (`buildGameKit(..., layout)`): Godot and Unity zips unzip into a project, with example scenes
  (`src/gameKit/godot/`, `src/gameKit/unity/`). The Godot player was run headless in Godot 4.3;
  the Unity scripts compile against stub UnityEngine types (no Unity here).
- **Game-music vocabulary**: scales in `noteTools.ts` (SCALES), borrowed/chromatic progressions as
  `X(semis, quality)` degrees in `smartTools.ts` (PROGRESSIONS, CHORD_QUALITIES), per-clip swing
  `clip.groove` {swing, grid 8|16} (scheduler `lateOf`, `swungNotes(..., grid)`), drum styles that
  write measures of a meter (`drummer(..., meter)`, DRUM_STYLES `meter`/`groove`), and
  accompaniments (`accompany`, ACCOMP_STYLES; `accompanyChords` in smartActions).
- **More game starters** (`src/store/startersGameMore.ts`): their `clip()` folds parts into each
  instrument's range; `boost()` levels a starter; a rule into '*' expands to every other state.
- **Costumes and state options** (`src/store/costumes.ts`): `costumes` / `stateOptions` in the store
  and project (saved, and undo steps like the rest of the Game tab's parts). The kit renders each state per costume (`states/<s> (<c>).wav`,
  `stems/<s> (<c>)/`), manifest `state.costumes`, `shuffleBars`, `gap`. All three players have
  setCostume / setEffect / setFilter / setReverb and play shuffled pieces with silences (web: scheduled
  on the audio clock, everything up front in an OfflineAudioContext; Godot: its own bus with a
  low-pass and reverb, pieces by timers; Unity: music on a child object with filters, pieces by
  PlayScheduled). Godot run headless; Unity compiled against stubs.
- **Melody variations** (`src/store/melodyVariations.ts`, `varyMelody` in smartActions, MelodyForm in
  SmartDialog): notes as scale degrees (`toDegree`/`fromDegree`, keeping chromatic alterations);
  answer (inverted contour, starts a step from the call's end, lands on the tonic), remode to
  minor/Phrygian or major/Lydian, simpler, busier (diatonic passing notes), syncopated, step up,
  mirror, harmony (+2 degrees, new track), surprise (seeded pair). Placed after / replace / new track.
- **Smarter transitions** (`src/store/transitions.ts`): rule `quantize` also 'phrase' (`phraseBars` 2/4/8
  from the state's start) and 'end' (the loop's or piece's end); kind 'bridge' (`bridgeBars` 1/2):
  `bridgeNotes` writes the new state's opening chord's dominant seventh (ii or iv before it for 2),
  bass stepping in through the leading tone, a drum fill; the kit renders it on the song's chord part,
  bass and drums (`bridgeFor` in gameKit.ts) as `transitions/bridge into <state>.wav`, and the players
  play it on the line and start the state `bridgeSeconds` later (like a stinger bridge). Live pads in
  the Game tab play it on preview instruments. Web and Godot timing checked.
- **Game parameters** (`src/store/gameParams.ts`, `GameParams.tsx`): `gameParams` in the store and
  project; each has targets (intensity, filter, reverb, volume, a group's layer) over a window of the
  parameter. `paramMix` combines them (highest intensity and reverb, lowest filter, volumes and layers
  multiply); the manifest's `parameters` carry them and all three players' `setParameter` do the same
  sums (web `mix()`, Godot `_mix()`, Unity `Mix()`; keep them in step, `scripts/gameParams.test.mjs`
  checks the web one). Audition has a slider per parameter; Try it drives danger/health by name.
- **Try it in a game** (`src/components/game/GameTryOut.tsx`, `tryOutScene.ts`, `src/store/tryOut.ts`):
  three.js scene (a robot hero and a cube guard) whose events drive the kit's web player
  (`AdaptiveMusic`) on the live mix: notice/lose switch states, distance sets intensity, coins and
  hits fire stingers and sfx. Renders with `buildGameKitParts(..., stemsOnly)`, cached per song
  JSON for the session. The guard naps until the music is ready. Note: Tone's current context is the
  offline one while a render runs, so the preview keeps the live context in a ref.
- **Game starters** (`src/store/startersGame.ts`): states as markers, stem groups, transitions and
  stingers set up (`gameReady`). Starters fold into groups in the New dialog with a filter;
  `reveal()` opens a folded `<details>` it finds.
- **Auto-freeze** (`src/store/autoFreeze.ts`): renders settled tracks of a big song (6+ instrument
  tracks) while stopped, into memory-only sounds (`provideMemorySound`), within a memory budget;
  `liveView` takes them through its `autoFrozen` hook when the fingerprint still matches. Renders
  finished while playing wait in `pending` until stop. `renderTrackChannels` (freezeActions.ts) is
  the shared render. Heavy test song: audio-thread load 73% → 33%, 38 tracks, 208 MB, about a
  minute to settle. A render pauses between steps while the song plays (`hold` in RenderOptions);
  a track whose render didn't fit is remembered (`tooBig`) and one that can't fit isn't rendered
  (it used to re-render the same track forever once the budget was full).
- **Sleeping channels** (`liveTracks.ts`, the strip's `sleep`): while playing, a track whose last
  scheduled note (plus a tail: 6 s, 14 s with reverb/delay/chorus inserts) is over is cut off after
  its `duck` gain (output, sends, meter taps), so the audio thread skips its strip and instrument.
  The scheduler's `onActivity` and `scheduledInstrument` wake it ahead of its next note; keyboard
  play (`getLiveInstrument`) and previews keep it awake 30 s. Never: buses, returns, audio/frozen
  tracks, Pumps, armed tracks; everything wakes on stop. Idle Web Audio nodes are not free (about
  3% of the audio thread per 100 here): a 37-track orchestral song went from 67% to 41%.
- **Off-screen rows** (`src/components/offscreen.ts`): timeline rows and mixer strips out of sight
  get `content-visibility: hidden` (not `auto`, which didn't help); hidden strips' meters aren't
  read. The playhead line moves by style, not render. On the same song the page's main thread while
  playing went from about 90% to 60%.
- **Sampler voice limits** (`samplerManager.ts`): notes stop at their recording's last audible
  sample, releases end below -70 dB, at most 3 notes per pitch and 64 per instrument (oldest fades
  over ~50 ms). Renders differ from before by about -60 dB.
- **Stable playback** (`src/audio/playbackMode.ts`): a per-browser choice of a bigger audio
  buffer, applied at startup. Use `liveContext.ts` (`liveTransport`, `liveDestination`), never
  `Tone.Transport` / `Tone.Destination` / `Tone.context`: Tone creates those at import from its
  default context, which Stable playback replaces.

- **Game exports** (Export dialog, Range "Intro + loop"): the intro rendered exactly, the loop
  seamless, sharing one reverb impulse and gain; zipped with a WAV carrying `smpl` loop points.
  "Layers" are stems. File type WAV / MP3 (320k) / OGG (q8); the encoders are bundled inline and
  `vite.config.ts` appends their licence notices.
- **MP4 video**: 1280x720 at 30 fps with a spectrum, waveform and section names. H.264/AAC is
  preferred, VP9 or AV1 with Opus the fallback. WebCodecs needs https (or localhost). H.264 is
  untested here (no encoder in the test Chromium). `mp4-muxer` is deprecated for Mediabunny.
- **Share**: a link with the song deflated into `#s=` (short ids, settings at their defaults left
  out, notes as a few bytes each; sounds and freezes left out; `TRACK_DEFAULTS` and
  `defaultTrackFx()` are part of the format, so changing them changes old links). Older `#song=`
  links still open. An MP3 to the share sheet, or the project file. Discord cuts messages at
  2,000 characters, so the dialog warns over that.
- **Chiptune** instruments (`src/audio/presets/chiptune.ts`) and four more starters: Cinematic,
  Lo-Fi, Chiptune, Hip-Hop.
- **Build-up & drop** (ruler right-click): riser, snare roll, impact and markers in one undo step.
- **Marker flags from the keyboard**: Tab, Enter, F2, Delete, arrows, Shift+F10.

- **Big batch**: 66 more instruments from Musyng Kite (choir, pads, orchestra, world, rock guitars,
  bells) and 6 recorded drum kits, levels measured; every kit has 11 rows. 16 more starters (24 in
  4 groups). Piano roll SCALE / CHORD / TOOLS / GHOSTS and a STEPS mode for drums. Synth Designer.
  Video scoring (session only, not saved). Reverb up to 12 s with one-click spaces. Mixer with
  meters. Game preview (sections as states, layers, intensity). J / K / Shift+L. Magnetic clip
  edges. Pump can follow any track. Mic recording. Lag detection with Clear memory.

- **52 more instruments** (the rest of General MIDI from FluidR3 / Musyng Kite: more pianos,
  organs, leads, pads, guitars, basses, reeds, percussion, and a Sound Effects group), each
  level-matched, register-balanced and pitch-checked. Out-of-tune recordings are re-pitched at load
  (560 corrections in `sampleTuning.ts`; 99.8% of keys within 10 cents).
- **Credits kept up to date**: `src/credits.ts` names the source and licence of every sample set;
  `npm run guide-tables` writes the instrument table and credits into GUIDE.md, and
  `scripts/guideTables.test.mjs` fails when they're stale or a recorded instrument has no credit.
  After adding an instrument, run it.
- **Search**: `Ctrl+K` palette over tools, settings, instruments, starters and guide sections.
  Settings are reached by `data-search` marks on panels (and aria-labels / titles), which
  `reveal.ts` scrolls to, focuses and rings. Add a mark and a `SETTINGS` entry for a new panel.
  Add Track and the Inspector's SOUND GENERATOR use a searchable list (with a ▶ to hear each instrument).

- **From the style report** (Oct 2026): 808 slides
  (overlapping 808 notes glide, `create808`), key change from the ruler, Ratchet / Roll / Semitone
  tools, Lo-fi (bit crush, tone, tape wow) and Gate (tempo-synced chop) inserts, and 18 starters
  for those styles. Starters there keep the report's ear-safety rules: kicks at 0.8, no sub
  drop, soft impacts, distortion on one track at most (0.08). The report's other asks still open:
  a tempo map, time signatures, a piano sustain-pedal lane, per-note pitch bend, a break slicer
  with per-slice pitch, amp-sim / saturation, and more drum rows (rim, shaker, tambourine).

- **Video and game batch** (Oct 2026): hit points (Shift+M) and the tempo finder (FIT ›
  Hit points), Cut to length, scene cuts from the reference video, dip under dialogue, marker
  export for Premiere / Resolve / Final Cut / CSV, the sound effects maker, stingers, state
  transitions, loop variations and the game kit. The song's key is detected from its notes
  (`songKey.ts`) for the effects and stingers.
- **Human insert** (Oct 2026): per track, in the FX Rack above Distortion. It works on notes in
  the scheduler, not on audio: each note drifts late (0 to 15 ms, never early, because the
  export's look-ahead is about 5 ms), softer / harder and (pitched kinds only, via an `"…hz"`
  note string) sharp / flat. The drift is a hash of clip id + note id + tick, so live, export and
  freeze match. Mono basses, the 808 and drum kits keep a group together (one drift per group),
  so chords still pick the loudest note, 808 slides still slide and open hats still choke.

- **Browser tests and the tour**: a step's card scrolls its target into view smoothly, so wait
  ~800 ms before clicking at a measured position, or the click lands where the target was.
- **Type check with `npx tsc -b`** (what `npm run build` runs). `tsc --noEmit -p .` checks nothing
  here: the root tsconfig only has references.

- **DAW batch** (Oct 2026):
  - *Layout*: a menu bar (`components/menu/MenuBar.tsx`, every tool by DAW menu; Ctrl+S/O/E) holds
    the project controls; the old bottom sections became the **bottom panel**
    (`components/dock/BottomDock.tsx`): Mixer, EQ & Dynamics, Instruments, Game, Video, Sound FX tabs (the
    Instruments tab was retired in 2026.10.15-9, its ▶ previews moved into the instrument menus; the
    Launcher tab came later).
    `uiStore.setDialog('mixer' | 'game' | 'sfx')` opens the dock tab instead (search and the tour
    rely on that). Tab and height are in localStorage (`bosBeatbox.dock`).
  - *Crossfades*: `audioClips.crossfades()` (overlaps on a track; a clip wholly inside another
    is a layer); the clip schedule uses them as equal-power fades (`clipEnvelope` curveIn/curveOut).
  - *Follow tempo*: `ClipAudio.stretchBpm`; `timeStretch.ts` (WSOLA, hits placed on time);
    `soundLibrary.stretchSound / requestStretch` cache copies per speed (last 3); the schedule
    plays the raw sound sped up (varispeed) until the copy exists; exports await it.
  - *Curved automation*: `AutomationPoint.curve` (-1..1, `automation.bend`); the schedule
    samples bent pieces every 10 ms. Alt-drag a line, or the lane's right-click menu.
  - *Folders*: `Track.folder` on every member (so undo / save / autosave need nothing new);
    `store/folders.ts` keeps members together; `components/timeline/rows.ts` lays out rows
    (folder rows, folded tracks hidden, the video lane) for the marquee, recording marker, marker
    lines; clip drags find the lane under the pointer from the DOM.
  - *Pro EQ / Multiband*: `TrackFx.peq` (6 biquads always patched in; off = peaking 0 dB) and
    `TrackFx.mbc` (LR4 crossovers + DynamicsCompressorNodes; the browser's auto make-up gain,
    0.6 × what it takes off full scale, is divided back out). `audio/peq.ts` draws the exact
    curve. Freeze fingerprints leave them out while off, so older freezes stay valid.
  - *Tune vocal*: `audio/vocalTune.ts` (YIN at half rate, scale snap, TD-PSOLA); Apply imports a
    tuned copy and keeps `ClipAudio.tunedFrom` (saved with the project) for Untune.
  - *Video saved*: the file is kept in the sound DB (`soundLibrary.storeBlob`, key
    `video:name|size|lastModified`); `ProjectSnapshot.video` holds the reference and start;
    saved files embed it up to 40 MB (`VIDEO_EMBED_MAX`); autosave watches the video store.
  - *FMOD / Wwise*: `audio/enginePackage.ts` (renders via `buildGameKitParts`) and
    `audio/engineScripts.ts` (FMOD Studio script, WAAPI Python script, README); the test runs the
    FMOD script against a stand-in `studio` object and compiles the Python.
  - *Video export*: Mediabunny (`Output` + encoded packet sources, a write queue per track).
  - Bitcrusher was already there as Lo-fi.
- **Browser tests**: after editing `src`, restart Vite before a script imports `/src/...`
  modules: once HMR has re-imported a module with `?t=`, the script's import is a second copy
  (a different store), and what it sets isn't what the page shows.

## Ideas not started

- Per-voice note expression on the built-in synths and recorded instruments (only the Multi
  Sampler plays it per note; the rest bend as a whole); rim / shaker / tambourine rows on the
  kits; live mod-wheel vibrato while playing (it's recorded, and plays back, but isn't heard live).
- Notation: editing in the staff, triplets and second voices (it shows one voice per staff on a
  16th grid); a whole-song score.
- A desktop app in Rust, once the web version peaks (on hold for now).
- Time-stretch and vocal tuning run on the main thread (about 0.2 s and 1 s per 30 s of audio):
  a Worker would keep the page smooth on long takes.
- The FMOD and Wwise scripts haven't been run against the real tools (none here): each step
  reports OK / SKIP, so check them in the tools and fix the SKIPs.

## Small known issues

- On very large projects, a short hitch of up to 80 ms can follow Play. No notes play late. Freeze
  and Stable playback make it rare.
- A clip moved off the 16th grid and then cut off the grid plays without swing (on purpose: it
  can't be told from a triplet pattern).
- Supersaw chords lean up to about 0.6 dB per bar (single notes within 0.15 dB): inaudible.

## On hold

- Whether the new starters, chiptune sounds and the build-up & drop sound right.
- **Remake the website's First Flight score** once the instrument updates are done (held until
  then). The film is AI-generated (`scripts/guide-shots/trailer.webm` is a small
  copy; the full 1280x720 one is in the Higgsfield library). The score is
  `site/video/first-flight.fledgetone.json` (117.76 BPM; cuts on bars 3, 5 and 7). To redo it: open
  it in the studio, rework it, Export > Mixdown, WAV, Ring out; then put it on the film with the last
  frame held while the chord rings, as `site/video/first-flight.mp4` (H.264 + AAC, faststart):
  `ffmpeg -i film.mp4 -i song.wav -filter_complex "[0:v]tpad=stop_mode=clone:stop_duration=2.6,fade=t=out:st=16.4:d=1.2,format=yuv420p[v];[1:a]atrim=0:17.6,afade=t=out:st=16.2:d=1.4[a]" -map "[v]" -map "[a]" -c:v libx264 -crf 22 -c:a aac -b:a 192k -movflags +faststart -t 17.6 site/video/first-flight.mp4`.
  Every picture or clip of the film carries an "AI-generated" note; the music doesn't need one.
- **Courier**, the second scored film on the website (modern electronic; a tempo map, 123.87 then 116.36 at bar 3 and 125.22 at bar 5, puts its cuts exactly on bars 3, 5 and 7):
  `site/video/courier.fledgetone.json`, shown as `site/video/courier.mp4`. Its sound effects (17, made
  in the sound effects maker and placed with Add to song) are on the SFX, SFX 2 and Ambience tracks. The film is AI-generated
  (stylized game-style footage of an original drone courier, deliberately not based on any existing game); it's in the
  Higgsfield library. Re-export it the same way as First Flight if the synths change.
