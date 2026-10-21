# Fledgetone Pocket 2: the plan

Pocket today (stages 1 and 2, see [MOBILE-PLAN.md](MOBILE-PLAN.md)) works, but it is the studio
made smaller: a timeline of tracks, a track picker then a clip picker then an editor, the
transport across the top where a thumb can't reach, and six tabs. This plan redesigns it as its
own thing: the easiest way to make a song on a phone, in Fledgetone's look, over the same engine
and the same project files.

**Where it stands:** two designs were prototyped: four tabs (below) and **everything on one
screen**. The one-screen design is the one taken forward, and it's **built** (2026.10.19-2,
src/pocket/): the song grid, the transport, the drawer with pads, steps and the piano roll, the
mixer, landscape, the starters screen, on the real engine and the real arrangement (sections are
the song's markers; arranging uses the studio's insert and remove bars). Pocket will be an **app in the
App Store and Google Play**, built from the same web code as the studio (see "An app, from the
same code"). Clickable prototypes of both designs go with the plan (see "Prototype" at the end).

## What the research says

Mobile music apps compared: BandLab, GarageBand for iPhone, FL Studio Mobile, Koala Sampler,
Remixlive/Groovepad, Caustic, Medly, Ableton Note, Korg Gadget, n-Track, Auxy, Endlesss, Voloco,
Rapchat, Chrome Music Lab's Song Maker, Teenage Engineering's OP-1 and EP-133, and CapCut for its
editing patterns.

- **What works on a phone is loops first.** Koala (Sample / Sequence / Perform), Auxy (loops and
  scenes), Korg Gadget (scenes stacked, the instrument below), Ableton Note (8 scenes), Medly
  (sections and blocks), GarageBand's Live Loops. You make a loop, then the next one, then put
  them in order.
- **What fails is the desktop timeline made small.** GarageBand's and BandLab's region editing
  (tiny trim handles), n-Track's many taps per edit, Caustic's rack squeezed into landscape. A
  phone is for sketching and finishing simple songs, not for dragging edges to the pixel.
- **One press for "the next part".** The EP-133's Commit copies the scene and moves you into
  the copy. Making the next section is one tap.
- **Record first.** Voloco and Rapchat open on a beat and a big record button. Ableton Note's
  reviewers missed being able to sing over the loop: that is a gap Fledgetone can fill.
- **Constraints help.** Song Maker's scale lock makes wrong notes impossible. Koala avoids deep
  settings on purpose to "keep you in flow".
- **Users' most common complaints:** tiny targets, settings hidden in menus, vocal latency fixed
  by hand, lost projects (FL Studio Mobile's forums are full of them), ads and paywalls in the
  middle of making something. Fledgetone has no ads or paywall; the rest are design work.

## Principles

1. **Portrait, one hand.** Everything you press is in the bottom half of the screen: play,
   record, undo, the tabs and the instrument. The top is for looking at (the song's name,
   tempo, where it's playing).
2. **Big targets.** 44 px at the least, pads 72 px or more, steps 40 px or more. Never more
   than 16 steps or 8 note rows on screen at once: page through them instead of shrinking them.
3. **Loops first, the timeline never.** A song is a few **sections** (A, B, C…), each a loop,
   put in order. There is no clip dragging on a timeline in Pocket. The studio still has one.
4. **One tap for the next section** (copies the one playing and moves into the copy).
5. **Tap a track to play it.** Tapping a track opens its instrument (pads for drums, keys in
   the song's key for the rest, the microphone for vocals) ready to play and record. You never
   pick a track and then a clip and then an editor.
6. **Play or draw.** Every instrument has both: play it live (with Rec, it writes what you
   play, in time), or draw the notes and steps on a grid.
7. **In key by default.** Notes and pads only offer the song's scale; chords come ready-made.
8. **Sheets, not menus.** Sound, effects and options open as a sheet from the bottom, over the
   music, which keeps playing. Swipe it down to close.
9. **Tap does the common thing, hold shows more.** Tap a pad to play it, hold it for its sound
   and level. Every hold and swipe also has a button.
10. **Undo is always there**, in the dock under your thumb, with a history of the last changes.
11. **Never lose a song.** Autosave on every change (as now), ask the browser to keep the
    storage (`navigator.storage.persist()`), and remind people to save a project file.
12. **Sounds good without touching a knob.** The mixer is a level, mute, solo and one or two
    big macros per track. Starters load a finished-sounding loop.

## The screens (the four-tab design)

The first design, prototyped and compared with the one-screen design below, which replaced it.
Its parts (the editors, Sing, the mixer's macros, Share, the first run) carry over into the
one-screen design's drawer and sheets.

```
 ┌─────────────────────────────┐
 │ Night Drive   92 BPM · A min│  top bar: look, don't touch (tap opens song settings)
 │ A ▸ 3.2                  ⤴  │  where it's playing; share
 ├─────────────────────────────┤
 │                             │
 │   the tab's screen          │
 │                             │
 ├─────────────────────────────┤
 │  ↶   ●   ▶ (big)  +Next  ↷ │  the dock: undo, record, play, next section, redo
 │ Loops  Sing  Song  Mix      │  four tabs
 └─────────────────────────────┘
```

### Top bar
The song's name, tempo and key (tap: a sheet to change them, with Tap tempo and the metronome),
the section and beat playing, and Share. Nothing else.

### The dock (always there)
Undo, **Record**, a big **Play**, **+ Next** (copy this section into a new one and go to it) and
Redo, then the four tabs. The loop is always on in Loops (the section repeats); Song plays the
sections in order.

### Loops (the home screen)
A row per track (big, in the track's colour, with its icon and name) and a column per section
(A, B, C…; three on screen, swipe for more). The section playing is lit, the one queued pulses.
- Tap a section's letter: it plays from the next bar line (the clip launcher's scene).
- Tap a track's name: its instrument opens (below).
- Tap an empty cell: start that track's part in that section (an empty loop, then the
  instrument). A cell shows its notes small, like the studio's clips.
- Hold a cell: Copy to…, Clear, Length (1, 2, 4, 8 bars), Mute in this section.
- **+ Add**: Drums, Bass, Keys, Synth, Strings, Voice… (the instrument catalog's categories,
  then the sound).

### The instrument (a sheet over Loops)
Opens three-quarters high with the section still playing. A row at the top: the track's sound
(tap to change), **Play / Draw**, the pattern's length and the bar shown.
- **Drums, play:** 4×4 big pads (the drum kit). With Rec on, hits land on the nearest step.
  Hold a pad: its sound, level and pitch. **Note repeat** (hold a pad with a 1/8 or 1/16 chosen)
  for hats and rolls.
- **Drums, draw:** one drum at a time: pick it on a small pad strip, then its 16 steps as a
  4×4 block (a row per beat), each step a big square. Steps for all drums at once make 128 tiny targets on a phone; one drum at a
  time keeps them big. Drummer and Fill buttons as now.
- **Keys, bass and synths, play:** two rows of 8 pads, each a note of the song's scale (an
  octave shift either side), or **Chords**: 7 strips, one per chord of the key (i, ii°, III…),
  tap to strum, hold to sustain.
- **Keys, draw:** the note grid as now, but half a bar (8 steps) across and 8 rows of the
  scale's notes down, so each cell is a thumb wide (page across the bar, scroll by octave, slide to paint, tap to erase), with 1/16, 1/8, 1/4 lengths.
- **808s:** the same, with Glide on a note's hold sheet.

### Sing
Record first: the section loops, a big round **Record** in the middle, a count-in of one bar.
- Each pass is a **take**; takes stack up, swipe between them, the star keeps one.
- **Voice** chips under it: Clean, Pop, Rap, Airy, Hard tune, Radio, Big (the vocal chain
  presets). Tune and Double as now.
- **Lyrics**: a notepad over the screen, kept with the song.
- Headphones notice when there are none (the song leaks into the mic), and the latency
  measured once and applied to every take: nobody nudges a vocal by hand.

### Song
The sections in order as big chips (A A B A C). Tap + to add the section playing; drag to
reorder; hold for Repeat, Remove, and the transitions: **Build-up** into it, **Drop**, **Speed up**
(what the Song screen's Arrange buttons do today), **Fade out** for the last one. Play from here
plays the song; a strip across the top shows where it is.

### Mix
Channel strips side by side, swiped sideways: a tall level fader, mute, solo, and two macros:
**Space** (reverb) and a per-type one (**Punch** on drums, **Drive** on bass, **Warmth** on keys,
**Polish** on vocals). The master strip at the end: level, **Loud** (the clipper), and the
loudness against -14 LUFS.

### Share (a sheet from the top bar)
MP3 to the share sheet, a **portrait video** of the song (the showcase video, 9:16, for
stories and reels), a link, the project file, and **Open on a computer** (the link and how).

### First run
A grid of starters by mood (Trap, Lo-fi, House, Pop, Drill, Ambient, Empty). Tap one: it plays.
Three tips, one at a time, pointing at Loops, the instrument and Sing, never more, and never
again once dismissed.

## The one-screen design (the one going ahead)

After the studio on a computer, where nothing is more than a click away in the one window: the
timeline on top, the dock under it, and clicking a track changes what the dock shows. On a phone,
the same thing stacked, with no tabs.

```
 ┌──────────────────────────────┐
 │ ‹ Night Drive · 92 · A min ⤴ │  back to the starters; song settings; share
 │ Loop        Mix all  + Track │
 ├──────┬──────┬──────┬──────┬──┤
 │      │Drums │ 808  │ Keys │Vo│  tracks across (tap to select)
 │ A  ⋯ │▮▯▮▮▯ │ ▬ ▬  │ ═══  │  │  sections down, in song order
 │ A    │▮▯▮▮▯ │ ▬ ▬  │ ═══  │∿∿│  each cell: that track's part there
 │ B    │▮▮▮▮▮ │ ▬▬ ▬ │ ═══  │∿∿│
 │ +    │      │      │      │  │
 ├──────┴──────┴──────┴──────┴──┤
 │  ↶   ● Rec drums  ▶ Loop A  ↷│  the transport
 ├──────────────────────────────┤
 │ BIGGER ⌃ ━━━ ⌃ OR DRAG       │  the drawer: the selected track's
 │ ● Drums · A  Play Draw Sound │  Play, Draw, Sound and Mix
 │ [Open hat][Low tom][Mid][Hi] │
 │ [Kick][Snare][Clap][Hat]     │
 └──────────────────────────────┘
```

- **The song is a grid.** In portrait the sections run down the page in song order and the
  tracks across, so the whole song shows at once and reads like a lyric sheet: each line left to
  right, the lines down. It scrolls both ways with the section letters and track names pinned.
  **Turning the phone** turns the grid into the studio's timeline (sections left to right, tracks
  as rows) with the drawer beside it. Landscape is a bonus, never required.
- **Tap a cell** to edit that track in that section: the drawer becomes its instrument. Tap a
  section's letter to loop it (from the next bar line); its **⋯** (or holding any letter)
  arranges the song: play it twice, make it its own copy, move it, build-up, drop, remove.
  **+** under the sections copies the selected one into a new one; **+** after the tracks adds an
  instrument. **Loop / Song** picks what Play plays, and Play says which ("Loop A", "Song").
- **The transport:** Undo, Rec (named for the selected track: "Rec drums", "Rec vocal"), Play,
  Redo.
- **The drawer** at the bottom, in the selected track's colour: **Play**, **Draw**, **Sound** and
  **Mix** (vocals: **Sing** and **Mix**). Its handle says which way a tap takes it (Bigger,
  Smaller) and can be dragged.
  - **Blocks never shrink.** Pads, steps and piano roll rows are a fixed size (pads 60 px, steps
    54, roll rows 34): a bigger drawer shows more of them, a smaller one fewer, and the rest
    scroll, with a fade at the edge that has more.
  - **The rows that matter stay under the thumb.** Drum pads are laid out like an MPC: kick,
    snare, clap and hat along the bottom, and the drawer grows upwards from them. Keys have six
    rows of the key's notes, low ones at the bottom. Steps keep beat 1 at the top.
  - **Mix all** turns the drawer into a mixer for every track (a fader, mute and solo each, and
    the master), like the Mixer tab of the studio's dock.
- **The piano roll** (Draw, for keys, bass and synths) opens the drawer full and puts it back
  when you leave. Rows are the key's notes over five octaves, columns are 16ths, both a fixed
  size. Tap to draw a note, drag right to make it longer; drag a note to move it, its right edge
  to stretch it; dragging to an edge scrolls the roll. Pens: **Note**, **Chord** (a chord in key
  in one tap), **Erase**, and the length of new notes. Tap a note to select it: a bar with
  shorter, longer, down, up, copy and delete edits it in steps. One finger draws, two fingers
  scroll (and so do the note names and the ruler); tap a note name to hear it; **Home** goes
  back to the key's home note; the roll turns its page to follow the playhead.
- Only rare things open over the screen: adding an instrument, sharing, the song's settings and
  the lyrics. The back button (and the phone's own back) goes to the starters, with a way back
  to the song.

On an iPhone SE (667 px tall) the drawer at its middle size leaves room for two or three
sections of the grid; on an iPhone 13, four.

## How it fits the studio

- **Sections are the clip launcher's scenes** (`src/store/launcher.ts`): a track's part in a
  section is its slot in that scene. Loops plays scenes; nothing new for the engine.
- **The song is the arrangement.** The Song screen's chain is written into the arrangement
  (`writeSessionToArrangement` and the arrange helpers in `pocketArrange.ts`) each time it
  changes, so the studio opens the finished song on its timeline, and exports work as they do.
  The chain itself is kept in the project so Pocket can show it again.
- **Opened from the studio:** a song made on a computer has an arrangement but maybe no scenes.
  Pocket makes sections from its markers (`scenesFromSections`) and keeps the arrangement as it
  is until the Song screen is changed; if both changed, it asks before rewriting.
- The existing pieces carry over: the pads, the step and note grids, painting, the Drummer,
  vocal chains, tuning, the starters, the export and session code. Mostly a new shell and new
  layouts, not new audio.

## An app, from the same code

Pocket goes in the App Store (and Google Play), built from the same web code as the studio. On
an iPhone a web page can't do what a music app needs:

- **Sound you can count on:** the silent switch mutes web audio, and a page stops when the phone
  locks or another app opens. An app sets its own audio session, plays in the background and
  handles AirPods and headphones.
- **Songs that aren't lost:** Safari may clear a site's storage after a week without a visit. An
  app's storage is its own, and songs can live in Files and iCloud.
- **MIDI:** Safari on iPhone has none. **Haptics:** none from the web on iPhone.
- **Recording:** an app can ask for low-latency audio and manage the microphone, which is what
  decides whether a vocal lands in time.
- **Being found:** people look for music apps in the stores, not "Add to Home Screen".

On Android the web does better (Chrome has MIDI, vibration and installing), so there a store app
is mostly about being found; the web version stays for anyone who wants it.

**How:** a native shell (Capacitor or similar) around Fledgetone's own web code, not a rewrite,
so there is one engine and one project format: a song made in the app still opens in the studio,
and fixes reach both. Small native pieces do what Safari can't: the audio session (the silent
switch, background playback), haptics, Files and iCloud, MIDI, keeping the screen awake,
recording. If the web audio inside the app is ever the limit (most likely recording latency), that
one piece moves to native code later, without touching the rest.

**Before submitting:**
- **Apple turns down apps that are only a website in a wrapper** (guideline 4.2). The native
  pieces above, working offline and Files support make it an app; they're in the first version
  sent for review.
- **Licences:** Fledgetone's code is GPL-3.0, and the GPL and the App Store's terms don't fit
  together (VLC was taken down over it in 2011). Fledgetone's own code can go to the store under
  its owner's own terms. The GPL plugins (Surge XT, Dragonfly and the others) can't, and the app
  is built without them (no `VITE_GPL_PLUGINS`), as the plain build already is. Recordings keep
  their credits (`src/credits.ts`). Have this checked by someone who knows open-source licensing
  before launch.
- **Accounts:** Apple's developer programme ($99 a year), Google Play ($25 once). Apple's review
  usually takes a day or two per submission.
- **A Mac with Xcode** to build and send the iPhone app, and real iPhones to test on (which also
  settles what the prototype can't: the feel of the pads, two-finger scrolling, recording
  latency, speed while playing).

## Phones (things to get right)

- **iPhone silent switch:** set `navigator.audioSession.type = 'playback'` on the first tap
  (`'play-and-record'` while recording), and say so on screen if the phone still won't play.
- **Memory:** load only what the song uses, one recording at a time, cap the tracks (12) and
  the plugins Pocket offers. iPhones close heavy pages long before computers do.
- **Latency:** use the output latency the browser reports (`latency.ts` does already), measure
  it once with the speaker and mic if it's missing, and recommend wired headphones.
- **Storage:** `navigator.storage.persist()`, an install prompt (home screen apps keep their
  storage), and a gentle "save a copy" nudge after a song has had real work.
- **Haptics:** a short buzz on Android (as `buzz` does now); iPhones don't allow it from the web,
  so every press also lights up.
- **Test on real phones.** WebKit can't be tested from the build environment.
- In the app, the native audio session, storage and haptics replace the browser workarounds above;
  the workarounds stay for the web version.

## Stages

| Stage | What | Done when |
|---|---|---|
| 0 | The prototypes, tried on an iPhone and an Android phone, and with people who haven't seen them | The one-screen design and its words feel right in the hand |
| 1 | The app shell: Pocket in a native wrapper, the audio session, haptics, storage, Files; builds for iPhone and Android | Today's Pocket runs as an app on a real iPhone, from a test build |
| 2 | The one-screen layout: the song grid on the launcher's scenes, the transport, the drawer with today's Beat, Notes and Vocals inside, landscape | A loop made and arranged without the old tabs |
| 3 | The drawer's editors: fixed-size pads (MPC layout), scale pads and chords, steps, the piano roll, note repeat | A beat and a melody played in and drawn, in time |
| 4 | Longer parts (2, 4, 8 bars), velocity, swing, quantise, notes outside the key, 808 glide | A real song's parts fit, not just one-bar loops |
| 5 | Sing in the drawer: real recording through the app, takes, voice presets, lyrics, latency handled | A vocal recorded and kept without nudging |
| 6 | Song: the order written to the arrangement, transitions, round trips with the studio | A song made in Pocket opens finished in the studio, and back |
| 7 | Effects per track as one-knob presets, Mix all, drawn automation, samples onto pads | A mixed song with a filter sweep and a chopped sample |
| 8 | Sharing (MP3, WAV, stems, the portrait video), first run and tips, speed and memory on older phones | A first loop in under 30 seconds; no crashes on an iPhone 12 |
| 9 | Store listings, privacy details, licences checked, review | Pocket in the App Store and Google Play |

Each stage ships on its own (to testers first: TestFlight on iPhone); the old screens go when
their replacement is in.

**Where it is:** stage 1's shell is built ([APP.md](APP.md)): the native projects, the audio
session, haptics, the screen kept on, the share sheet for exports and project files, and an
Android test build. Left: building it on a Mac and running it on a real iPhone.

## How we'll know it's easy

- Sound in one tap from opening it; a first loop in under 30 seconds; a 3-section song with a
  vocal in under 10 minutes, by someone who hasn't seen it before.
- Nothing needs landscape, two hands, or a target smaller than 44 px.
- No song lost in testing, on either phone.

## To decide

- **Liquid glass:** frosted, see-through layers for what floats over the song (the transport,
  the drawer's header, sheets, the piano roll's bar), tinted dark with Fledgetone's cyan edge,
  never on pads or grids. To try in the prototype with a switch, and on a real iPhone while a
  song plays (blur behind moving content costs battery and smoothness).
- Free, or paid, or free with something extra, and what the app is called in the stores.
- Whether Android ships with iPhone or after it.
- Whether the portrait video is in stage 8 or later.

## Prototype

Two clickable prototypes, made to be tried on a phone, are kept outside the repository until
the design is settled: the four-tab design and the one-screen design. They are sketches for
trying the layout, not code for the app; their drums are the Drum Designer's presets rendered
by the studio's drum synth, the keys the electric piano recordings, and recording is simulated.
