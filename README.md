# Bo's Beatbox

Arrange, mix and export music in your browser. Bo's Beatbox is a small DAW: an arrangement
timeline with tracks and clips, a piano roll, 34 instruments (synths, drum kits, EDM basses and
FX, recorded instruments and your own samples), per-track effects, timecode at 24, 25, 30 or
60 fps, and WAV export. It runs entirely in the browser; nothing is uploaded anywhere.

**How to use it:** see [GUIDE.md](GUIDE.md). The same guide opens inside the app from the
**Guide** button in the header (or press `?`).

## Development

Requires Node 22.

```sh
npm install
npm run dev          # dev server at http://localhost:5173
npm run build        # typecheck + production build into dist/
npm run lint         # oxlint
npm test             # unit tests (node --test): timecode and drop-frame, automation maths, ParamWriter, swing and Transport ticks, markers and WAV cue points, insert / delete bars, restorable sessions
npm run build:single # dist-single/index.html: the whole app in one self-contained HTML file
```

`build:single` inlines the scripts, styles and favicon so the file can be uploaded anywhere on
its own. That is the file published on the Two Birds Workshop site as `bos-beat-box.html`.

### Where things live

| Path | What it is |
|---|---|
| `GUIDE.md` | The user guide, shown in the app by `src/components/guide/GuidePanel.tsx` |
| `src/store/timelineStore.ts` | All timeline state (tracks, clips, transport, tempo, frame rate, undo) and the bridge to the audio engine |
| `src/store/timelineTypes.ts` | Data types, snapping (including the frame grid) and duration helpers |
| `src/store/project.ts` | The `.beatbox.json` project format, validation and browser autosave |
| `src/store/markers.ts` | Marker maths: names, bar / time anchors across tempo changes, insert / delete bars, reading them from a file |
| `src/store/ripple.ts` | How insert / delete bars move positions and the loop (undo steps keep the edit as plain numbers) |
| `src/audio/engine.ts` | The master chain (bus, compressor, limiter, shared reverb / delay) |
| `src/audio/scheduler.ts` | Turns clips into Tone.js Transport events (one event per tick, updated incrementally) |
| `src/audio/liveTracks.ts`, `effects/trackStrip.ts` | One mixer strip and instrument per track for live playback |
| `src/audio/instruments.ts`, `instrumentCatalog.ts`, `presets/` | Every instrument and its sound design |
| `src/audio/automation.ts` | Automation lanes: each setting's scale (lane height to dB, Hz, pan...), values between points, lane edits |
| `src/audio/automationSchedule.ts`, `effects/paramWriter.ts` | Plays lanes as AudioParam automation, live and in the export; the one way automatable params get written |
| `src/audio/exportWav.ts` | Offline WAV render (mixdown, stems, exact-length and seamless-loop endings, 16/24/32-bit), built from the same factories as live playback |
| `src/audio/wavCues.ts` | Markers written into exported WAVs as cue points (`cue ` and `LIST`/`adtl`/`labl` chunks) |
| `src/audio/transport.ts` | Bars, ticks, seconds and timecode conversions |
| `src/components/timeline/` | Timeline UI: toolbar, ruler, lanes, clips, piano roll, project bar |

### Notes for changing the audio engine

- Every Tone.js `Signal` is a `ConstantSourceNode` that Chrome processes all the time, even
  when nothing is connected to it. Idle nodes cost CPU, so effects are created only while
  they're switched on, polyphonic voices are disposed after a few seconds of silence, and the
  sound deck's instruments are built on first use.
- The WAV export drives Tone's offline clock by hand in 128-sample steps, one second ahead of
  the render (`exportWav.ts`). Anything that disposes nodes must wait until the render has
  passed them.
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

## Credits

The recorded instruments use free sample libraries (Salamander Grand Piano, tonejs-instruments, FluidR3 GM via MIDI.js Soundfonts), all CC BY 3.0. The full credits, with links and licences, are in the Credits section of [GUIDE.md](GUIDE.md#credits) and in the app under GUIDE > Credits.
