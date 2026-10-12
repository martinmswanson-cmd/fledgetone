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
npm test               # node --test scripts/*.test.mjs (120 tests)
npm run build          # production build
npm run build:single   # the one-file site (dist-single/index.html)
npm run guide-tables   # rewrite GUIDE.md's instrument list and credits from the catalog
```

Run all five checks before every commit.

## Where things live

| Area | Files |
|------|-------|
| Instruments list (names, ranges, sample sets, levels, shaping) | `src/audio/instrumentCatalog.ts` |
| Recorded instruments: loading, onset trim, per-instrument tone shaping, high-note taper | `src/audio/samplers/samplerManager.ts` |
| Synth presets (Wobble, Growl, Reese, Supersaw, 808...) | `src/audio/presets/` |
| Track inserts (Distortion, Filter, Pump, Chorus...) | `src/audio/effects/` |
| Audio graph, master bus, live playback | `src/audio/engine.ts`, `liveTracks.ts`, `scheduler.ts`, `transport.ts` |
| Export (offline render, stems, intro + loop) | `src/audio/exportWav.ts`, `ExportDialog.tsx` |
| MP3 / OGG encoding (wasm-media-encoders), WAV loop chunk | `src/audio/encoders.ts`, `wavCues.ts` |
| MP4 video (WebCodecs + mp4-muxer) | `src/audio/videoExport.ts` |
| Share link (`#song=`), Share dialog, opening a link | `src/store/shareLink.ts`, `ShareDialog.tsx`, `src/components/SharedLinkOpener.tsx` |
| Synth Designer (patch, presets, engine, panel) | `src/store/synthPatch.ts`, `src/audio/presets/designer.ts`, `src/components/inspector/SynthPanel.tsx` |
| Recorded drum kits, extra drum rows (clap, toms, crash, ride) | `src/audio/presets/sampledKit.ts`, `kitExtras.ts`, `DRUM_NOTES` in `instruments.ts` |
| Piano roll helpers (scales, chords, arp, strum, humanize) | `src/store/noteTools.ts` (unit tested) |
| Reference video (lane, preview, export onto it) | `src/store/videoStore.ts`, `src/components/video/`, `footage` in `videoExport.ts` |
| Mixer, Game preview, Mic | `src/components/timeline/MixerDialog.tsx`, `GamePreview.tsx`, `MicButton.tsx`, `src/audio/micRecorder.ts` |
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
| Game state transitions (fill / riser / impact into a state) | `src/store/transitions.ts`, `playNotesAt` in `stingerPlayer.ts`, `goTo` and `TransitionList` in `GamePreview.tsx`; saved as `transitions` (marker id to kind) |
| Game kit export (states, stingers, transitions, music.json, players) | `src/audio/gameKit.ts`; the players are plain files in `src/gameKit/` imported with `?raw` (the web one was run on a real kit; the Godot and Unity ones haven't been compiled here: no engines in the container) |
| Lo-fi and Gate inserts | `createLightLofi` / `createLightGate` in `effects/lightFx.ts`; the Gate is chopped by the strip's beat clock (`createPumpClock`) |
| Genre starters, build-up & drop | `src/store/starters.ts`, `src/store/buildDrop.ts` (action `addBuildAndDrop`) |
| Audio clips, sound library (IndexedDB), Slicer | `audioClipSchedule.ts`, `soundLibrary.ts`, `slicing.ts`, `src/store/audioClips.ts` |
| MIDI keyboard, recording, metronome | `midi.ts`, `recorder.ts`, `metronome.ts`, `src/store/recording.ts` |
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

- **Live and export must sound the same.** Every sound path is built for both the live context and
  the offline export context. Change one, check both.
- **Switching an effect while playing must not drop out.** Track strips crossfade on the audio
  clock when inserts change. Keep that pattern for anything new on a track or the master.
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

- **Human insert** (Oct 2026): per track, in the FX Rack above Distortion. It works on notes in
  the scheduler, not on audio: each note drifts late (0 to 15 ms, never early, because the
  export's look-ahead is about 5 ms), softer / harder and (pitched kinds only, via an `"…hz"`
  note string) sharp / flat. The drift is a hash of clip id + note id + tick, so live, export and
  freeze match. Mono basses, the 808 and drum kits keep a group together (one drift per group),
  so chords still pick the loudest note, 808 slides still slide and open hats still choke.

- **Type check with `npx tsc -b`** (what `npm run build` runs). `tsc --noEmit -p .` checks nothing
  here: the root tsconfig only has references.

## Ideas not started

- Tempo changes during a song (a tempo map) and time-signature changes; a sustain-pedal lane;
  per-note pitch bend; rim / shaker / tambourine rows on the kits.

- A desktop app in Rust, once the web version peaks (the owner wants to wait).
- Swap `mp4-muxer` for Mediabunny.
- Crossfades between overlapping audio clips; time-stretching audio clips to the tempo.
- Curved automation; track folders and colour groups.
- More effects: a visual parametric EQ, multiband compression, bitcrusher, vocal tuning.
- Game engine export: cue data for FMOD / Wwise / Unity / Godot, stingers on the beat.
- Save the reference video with the project (IndexedDB) instead of session only.

## Small known issues

- On very large projects, a short hitch of up to 80 ms can follow Play. No notes play late. Freeze
  and Stable playback make it rare.
- A clip moved off the 16th grid and then cut off the grid plays without swing (on purpose: it
  can't be told from a triplet pattern).
- Supersaw chords lean up to about 0.6 dB per bar (single notes within 0.15 dB): inaudible.

## Waiting on the owner

- Whether the new starters, chiptune sounds and the build-up & drop sound right.
