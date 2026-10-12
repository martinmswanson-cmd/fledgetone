# Bo's Beatbox: handoff

Read this first when picking the project up in a new session. (Updated after the game exports, video, sharing, chiptune and build & drop work.) It covers what the app is, how
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
npm test               # node --test scripts/*.test.mjs (102 tests)
npm run build          # production build
npm run build:single   # the one-file site (dist-single/index.html)
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

## Ideas not started

- A desktop app in Rust, once the web version peaks (the owner wants to wait).
- Swap `mp4-muxer` for Mediabunny.

## Small known issues

- On very large projects, a short hitch of up to 80 ms can follow Play. No notes play late. Freeze
  and Stable playback make it rare.
- A clip moved off the 16th grid and then cut off the grid plays without swing (on purpose: it
  can't be told from a triplet pattern).
- Supersaw chords lean up to about 0.6 dB per bar (single notes within 0.15 dB): inaudible.

## Waiting on the owner

- Whether the new starters, chiptune sounds and the build-up & drop sound right.
