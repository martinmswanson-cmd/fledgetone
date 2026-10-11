# Bo's Beatbox: handoff

Read this first when picking the project up in a new session. It covers what the app is, how
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
npm test               # node --test scripts/*.test.mjs (77 tests)
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
| WAV export (offline render, stems) | `src/audio/exportWav.ts` |
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

## Next: the mastering tools (branch `qol/q`, unfinished)

Commit `6ac78d0` on `qol/q`. It branches from `a4f0071`, which is older than the audio tracks, MIDI
and instrument work, so **merge the work branch into it first** and expect conflicts in
`timelineStore.ts`, `project.ts`, `engine.ts` and `exportWav.ts`.

Already written, compiling, with unit tests (`scripts/ott.test.mjs`, `scripts/loudness.test.mjs`):

- `src/audio/effects/ott.ts`: an OTT-style three-band upward and downward compressor, as an
  AudioWorklet.
- `src/audio/effects/masterChain.ts`: master inserts between the master compressor and the
  limiter (OTT, then stereo width with mono bass under 120 Hz), with gapless switching live.
- `src/audio/loudness.ts`, `loudnessMeter.ts`: LUFS (integrated, short-term) and true peak.
- `MasterSettings` in `timelineTypes.ts` (defaults, normalising, comparison), saved in projects
  and kept in undo history.

Still to do:

1. Finish wiring the master chain into live playback and the export, and the meter's tap.
2. **Master panel** in the Inspector: OTT (depth, time, in and out gain), Width (amount, mono
   bass), the loudness meter. A small meter in the header.
3. **Export dialog**: show the mix's LUFS and true peak; an option to normalise to a target
   (for example -14 LUFS for streaming, louder for club tracks).
4. **Genre starters** in the New dialog: Dubstep 140, House 126, Drum & Bass 174, Trap 140. Each a
   ready project (tracks, a few clips, sensible inserts) defined as data.
5. Browser checks: live and exported WAV measure the same; switching OTT or Width while playing
   doesn't drop out; the meter reads a known test tone correctly. Then measure CPU before and
   after on a large project.
6. Guide sections for all of it. Then merge into the work branch, build the single file, hand it
   over.

## Small known issues

- On very large projects, a short hitch of up to 80 ms can follow Play. No notes play late.
- Repeated short Supersaw notes with overlapping tails can lean up to about 1.7 dB to one side.
- A clip moved off the 16th grid and then cut off the grid plays without swing.
- Marker flags can't be reached with Tab. The Markers list is the keyboard route.
- Pull request #1's description is out of date: it stops before the audio tracks, MIDI,
  instrument, Distortion, Wobble, drag-and-drop, phone-notice and strings commits.

## Waiting on the owner

- Whether the reworked Violin and Cello sound right, or need more or less brightness, or more
  taming of the high notes.
