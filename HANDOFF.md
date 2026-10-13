# Bo's Beatbox: handoff

Read this first when picking the project up in a new session. (Updated after the big genre, instrument and tools batch: 105 instruments, 24 starters, Synth Designer, video scoring, Mixer, Game preview, mic recording, lag detection.) It covers what the app is, how
the code is laid out, how to check changes (including sound), what's finished, and what's next.

## The app and who it's for

Bo's Beatbox is a music maker that runs in the browser. It's laid out like a video editor more
than a classic DAW: an arrangement timeline with tracks and clips, a timecode readout, markers,
a ripple-editing toolbar. It's used mostly for **dubstep and EDM**, so bass sounds, drops and
loudness matter more than orchestral realism.

- Repository: `martinmswanson-cmd/bos-beat-box`, default branch `master`.
- Work branch: `ccr-1ba142ee-suz8wp` (pull request #1). It holds everything finished. It has
  not been merged into `master`.
- The owner publishes the site themselves from a **single HTML file**:
  `npm run build:single` writes `dist-single/index.html`. Hand that over as `bos-beat-box.html`
  after every finished change.
- Users read `GUIDE.md` (also shown in the app with `?`). Every user-visible change updates it.

## Working with the owner

- Don't name artists or songs anywhere in the software (starters, blurbs, comments, the guide): describe styles by genre, tempo and sound instead.
- They judge by ear. Describe changes in plain musical terms, not code, and send **before and
  after audio clips** (MP3) of the same phrase when a sound changes.
- Their words so far: instruments that "sound like toys", Distortion that "makes everything sound
  bad", a Wobble Bass that was "squishy, kinda gross", Violin "coming from another room", high
  notes that "hurt my ears". Each was fixed by measuring the rendered audio, finding the cause,
  then checking the fix the same way (see **Checking sound** below).
- They prefer one agent doing the work over a fan-out of subagents.
- They are usage-conscious. Pick a stopping point, commit and push before long jobs.
- Don't open pull requests unless asked. Don't push branches other than the work branch without
  asking.

## Stack and commands

React 19, TypeScript, zustand, Tone.js 15, Tailwind, Vite. No backend: projects autosave in the
browser and save to `.beatbox.json` files.

```
npm install
npm run dev            # dev server
npx tsc -b             # type check
npx oxlint             # lint (3 known warnings: Playhead.tsx x2, SoundAuditionPanel.tsx x1)
npm test               # node --test scripts/*.test.mjs
npm run build          # production build
npm run build:single   # the one-file site (dist-single/index.html)
npm run guide-tables   # rewrite GUIDE.md's instrument list and credits from the catalog
npm run codemap        # rewrite docs/CODEMAP.md from the files' summary comments
```

Run all five checks before every commit.

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
| Share link (`#song=`), Share dialog, opening a link | `src/store/shareLink.ts`, `ShareDialog.tsx`, `src/components/SharedLinkOpener.tsx` |
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
| Genre starters: helpers, the style batch (artcore, bass music, phonk, jazz-pop...) | `src/store/starterKit.ts`, `src/store/startersPlaylist.ts` (metadata and groups in `starters.ts`) |
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
| Real instruments (hosted recordings, loudness layers, takes, guitar amps) | `hosted` in `instrumentCatalog.ts` (files in `public/bos-beat-box-samples`, rebuilt by `scripts/real-samples/`); `SampleSource.layers` played by a sampler per layer and take (`createSamplerVoice`); `AMPS` in `samplerManager.ts` (built in `shapingChain`); the site must serve the folder next to the page |
| App state, undo, project load | `src/store/timelineStore.ts`, `timelineTypes.ts` |
| Project file format, autosave | `src/store/project.ts` |
| Timeline UI | `src/components/timeline/` |
| Inspector (track and master panels) | `src/components/inspector/` |
| Drop a project file to open it / phone notice | `src/components/ProjectDrop.tsx`, `MobileNotice.tsx` |

`README.md` has the engine notes (how the track strip re-patches without gaps, why kits fold to
mono, and so on).

### Things that bite

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
ffmpeg -i /tmp/after/violin.wav -q:a 2 violin-after.mp3   # for the owner to listen to
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
Violin and Erhu; drag a `.beatbox.json` onto the page to open it; a one-time notice for phone users.

## Recently finished

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
  (`dist-full/`). Never copy `public/bos-beat-box-plugins/gpl/` to the site before the app's source
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
- **Try it in a game** (`src/components/game/GameTryOut.tsx`, `tryOutScene.ts`, `src/store/tryOut.ts`):
  three.js scene (Bo and Slate built like gomofu-guys) whose events drive the kit's web player
  (`AdaptiveMusic`) on the live mix: notice/lose switch states, distance sets intensity, coins and
  hits fire stingers and sfx. Renders with `buildGameKitParts(..., stemsOnly)`, cached per song
  JSON for the session. Slate naps until the music is ready. Note: Tone's current context is the
  offline one while a render runs, so the preview keeps the live context in a ref.
- **Game starters** (`src/store/startersGame.ts`): states as markers, stem groups, transitions and
  stingers set up (`gameReady`). Starters fold into groups in the New dialog with a filter;
  `reveal()` opens a folded `<details>` it finds.
- **Auto-freeze** (`src/store/autoFreeze.ts`): renders settled tracks of a big song (6+ instrument
  tracks) while stopped, into memory-only sounds (`provideMemorySound`), within a memory budget;
  `liveView` takes them through its `autoFrozen` hook when the fingerprint still matches. Renders
  finished while playing wait in `pending` until stop. `renderTrackChannels` (freezeActions.ts) is
  the shared render. Heavy test song: audio-thread load 73% → 33%, 38 tracks, 208 MB, about a
  minute to settle.
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
- **Share**: a link with the song deflated into `#song=` (short ids, packed notes; sounds and
  freezes left out), an MP3 to the share sheet, or the project file. Discord cuts messages at
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
  Add Track, the Inspector's SOUND GENERATOR and the Instrument Browser use a searchable list.

- **From the owner's style report** (Oct 2026): 808 slides
  (overlapping 808 notes glide, `create808`), key change from the ruler, Ratchet / Roll / Semitone
  tools, Lo-fi (bit crush, tone, tape wow) and Gate (tempo-synced chop) inserts, and 18 starters
  for the owner's styles. Starters there keep the owner's ear-safety rules: kicks at 0.8, no sub
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
    (`components/dock/BottomDock.tsx`): Mixer, EQ & Dynamics, Instruments, Game, Video, Sound FX tabs.
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
- A desktop app in Rust, once the web version peaks (the owner wants to wait).
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

## Waiting on the owner

- Whether the new starters, chiptune sounds and the build-up & drop sound right.
