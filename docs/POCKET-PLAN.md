# Fledgetone Pocket 2: the plan

Pocket today (stages 1 and 2, see [MOBILE-PLAN.md](MOBILE-PLAN.md)) works, but it is the studio
made smaller: a timeline of tracks, a track picker then a clip picker then an editor, the
transport across the top where a thumb can't reach, and six tabs. This plan redesigns it as its
own thing: the easiest way to make a song on a phone, in Fledgetone's look, over the same engine
and the same project files.

A clickable prototype of the screens goes with it (see "Prototype" at the end). Try it on a real
phone before any of this is built.

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

## The screens

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

## Idea A: everything on one screen

An alternative to the four tabs, after the studio on a computer, where nothing is more than a
click away on the one window: the timeline on top, the dock under it, and clicking a track
changes what the dock shows. On a phone the same, stacked:

- **The song strip** across the top: the sections in order as chips (A A B A C, +). Tap one
  to loop it and edit it, tap it again to arrange (repeat, its own copy, move, build-up, drop,
  remove). **+** copies the section into a new one after it. **Loop / Song** at its start picks
  what Play plays, and Play says which ("Loop A" or "Song").
- **The tracks** under it: a slim row each with its pattern in the section being edited and
  its level. **Mix all** turns the rows into faders with mute and solo, in place.
- **The transport**: Undo, Rec (named for the selected track: "Rec drums", "Rec vocal"), Play,
  Redo.
- **The drawer** at the bottom, in the selected track's colour: its **Play**, **Draw**,
  **Sound** and **Mix** (for vocals: **Sing** and **Mix**). Drag its handle up for a bigger
  editor, down to see more tracks.

Song, Sing and Mix stop being places to go: the song is always across the top, singing is the
vocal track's drawer, and each track's mix is in its drawer. Only rare things open over the
screen: adding an instrument, sharing, the song's settings and the lyrics.

On an iPhone SE (667 px tall) the drawer at its middle size leaves room for three tracks; more
tracks scroll, with the selected one kept in view. Try both prototypes, then test them with people who haven't seen either before picking one.

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

## Stages

| Stage | What | Done when |
|---|---|---|
| 0 | The prototype, tried on an iPhone and an Android phone | The screens and words feel right in the hand |
| 1 | The shell: top bar, the dock, four tabs; Share as a sheet; the silent switch; storage.persist | Today's screens all reachable from the new shell |
| 2 | Loops on the launcher's scenes; + Next; the instrument sheet with today's Beat and Notes inside | A loop made without the old tabs |
| 3 | Play modes: scale pads, chord strips, one-drum-at-a-time steps, note repeat | A beat and a melody played in, in time |
| 4 | Sing: takes, voice chips, lyrics, the latency check | A vocal recorded and kept without nudging |
| 5 | Song: the chain written to the arrangement, transitions, round trips with the studio | A song made in Pocket opens finished in the studio, and back |
| 6 | Mix strips with macros; the portrait video | A shared MP3 and video from the phone |
| 7 | First run, tips, the install prompt; speed and memory on older phones | A first loop in under 30 seconds, no reloads on an iPhone 12 |

Each stage ships on its own; the old screens go when their replacement is in.

## How we'll know it's easy

- Sound in one tap from opening it; a first loop in under 30 seconds; a 3-section song with a
  vocal in under 10 minutes, by someone who hasn't seen it before.
- Nothing needs landscape, two hands, or a target smaller than 44 px.
- No song lost in testing, on either phone.

## To decide

- The names: Loops / Sing / Song / Mix (or Make / Sing / Arrange / Mix).
- Whether Pocket keeps a read-only view of the timeline for songs made in the studio.
- Landscape for the pads only (more room for 16 pads and two hands), or portrait everywhere.
- Whether the portrait video is in stage 6 or later.

## Prototype

Two clickable prototypes, made to be tried on a phone, are kept outside the repository until
the design is settled: the four-tab design above and idea A (one screen). They are sketches for
trying the layout, not code for the app; their drums are the Drum Designer's presets rendered
by the studio's drum synth, the keys the electric piano recordings, and recording is simulated.
