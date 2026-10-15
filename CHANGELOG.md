# Changelog

What changed in each version of Fledgetone, newest first. The version shows at the bottom left of
the app (with the build it came from), so you can check the site is running the one you expect;
click it to read this list. To check from outside the app, open `/version.json` on the site.

Each version is the date it was released (a second release on the same day gets `-2`, and so on).
Changes not released yet gather under **Unreleased** at the top. When you release, rename it to the new version and set `version` in package.json to match (a test
checks they agree).

## 2026.10.15-7 — FX panel fits the timeline

- With the track FX panel open, the timeline no longer stretches past its last track into empty grey space: the panel is as tall as the timeline and scrolls inside, so the resize bar sits right under the tracks.

## 2026.10.15-6 — Timeline stops at the last track

- Dragging the timeline taller stops at the last track instead of leaving empty grey space under it.

## 2026.10.15-5 — Timeline grows with new tracks

- Adding an instrument grows the timeline just enough to show its track, moving the panels below down with it, instead of hiding it below.

## 2026.10.15-4 — Engine polish 2

- The timeline resize bar now really changes the timeline's height and moves the Mixer and Instruments panel down with it, whatever the song's length.
- MP3, OGG and video exports keep their peaks under -1.5 dBTP, so they still play back under -1 dBTP after compression.
- Switching a compressor on or off while the song plays no longer makes a held bass note on the other tracks dip.
- Recorded instruments from the older sound set (celesta, saxophone, steel-string guitar and others) no longer add a DC offset to the mix.
- The Riddim starter plays at -14 LUFS like the rest of its group, with a softer snare and the growls up front.
- Recorded electric guitars cost less to play, with no change in sound.
- Ring-out exports end once the tails have died away instead of after a fixed time, so long reverbs and cymbals are no longer cut off.

## 2026.10.15-3 — Taller timeline

- Drag the bar under the timeline to make it taller and see more tracks at once; double-click it to fit every track.

## 2026.10.15-2 — Engine polish

### Sound
- **Lush** room for the master reverb: a smooth, dense, gently shimmering tail, as loud as the concert hall but much lighter on the computer.
- Turning knobs, muting and soloing while a song plays no longer clicks.
- Tracks with a compressor stay exactly in time with the rest of the mix (they used to run a few milliseconds late), live and in exports. The metronome and recorded takes line up with the mix too.
- Recorded instruments get louder with every step of velocity; some used to get quieter where they crossed into their next recorded loudness.
- **Electric Piano (Real)** notes ring on and fade naturally while held; the starters' held electric piano chords use it.
- The glockenspiel, harmonica, short trombone and the studio kit's hats, cymbals and snare stay clearer when played away from their recorded pitch.
- Long reverb rooms ring all the way down, and changing the room or decay while playing no longer cuts the tail or makes playback stutter.
- When an instrument has too many notes ringing, the quietest gives way instead of the oldest.
- Long held pad and drone notes keep sounding past 10 seconds.
- A track set back with Distance keeps its extra reverb when its reverb send is automated.

### Master
- New **Level** control: turns the whole mix up or down just before the limiter.
- Exports' peaks stay at or under -1 dBTP; ring-out exports fade their last moments instead of stopping on a long tail.

### Starter songs
- Every starter plays at a matching loudness for its kind of music (within 1 LU of its target), so switching between them no longer jumps in level. Their level sits on the master Level.
- The double bass no longer drowns out the orchestral starters, and the drums no longer swamp the trap, drill, phonk, dubstep and riddim starters.
- A starter sounds exactly the same every time you open it, and a song's human feel no longer changes when it's reopened, so exports repeat exactly.
- Fixed silent hand drums in two game starters.

### Speed and memory
- Exports render on several processor cores at once: about twice as fast on big songs, and stems render several at a time.
- Songs load the notes they play first and start sooner; the rest arrive in the background (on phones and smaller computers, only when needed). Memory at Play start is about a third of what it was.
- Synth Designer sounds use about half as many audio parts per note.
- Exports no longer stay in memory after they finish.
- Exports at 44.1 or 48 kHz are equally clean whatever rate your sound card runs at.

### Playing and settings
- Keys played on screen (the instrument browser, piano roll previews, deck pads) sound at once instead of a tenth of a second later.
- The Playback panel shows the delay from a key to its sound.
- If you chose Responsive playback yourself, the app no longer switches you to Stable; when it switches by itself, it tells you.
- An export waiting on a recording that won't download stops after a while and says which instrument failed.
- Exported stems each get their own dither, and the intro + loop export no longer clicks where the loop begins.

## 2026.10.15 — Better sound

### New instruments (free recordings)
- **Studio Kit (Real)**: a recorded drum kit (kick, snare, hats, three toms, crash and ride), each at four loudnesses with two takes, so repeated hits never sound identical. The starters' drum parts use it.
- **Electric Piano (Real)**, **Banjo (Real)**, **Harmonica (Real)**, **Ocarina (Real)**, **Steel Drums (Real)**, **Zither (Real)**, **Solo Voice (Real)** and **Concert Bass Drum (Real)**.
- The older versions they replace moved to the **Retro (GM)** group; songs using them sound as before.

### Recordings play more like the real thing
- Recordings are in stereo.
- Held notes keep sounding (they loop smoothly) instead of stopping when the recording ends.
- Soft and loud recordings blend into each other as you play harder, instead of jumping.
- Harpsichord and piano make their key-release sound when you let go.
- Wind and brass players run out of breath on very long notes.

### Space and mix
- **Room styles** for the shared reverb: concert hall, chamber, church, studio room and plate.
- **Distance** (DIST in the Track Inspector): pushes a part further back in the room.
- New orchestral tracks sit where the players sit on stage.
- **Make space** (Mixer): small EQ moves so parts stop covering each other.

### Master
- A look-ahead limiter keeps peaks under -1 dBTP, so exports don't clip.
- **Loudness targets** in Export: streaming, loud, game, podcast, broadcast.
- **Glue styles** for the master compressor: standard, gentle, punchy, tight, off.
- 16-bit exports are dithered.

### Synths
- Ladder filter, drift (analog wander), FM, organ, pulse and vowel waves, wider unison.
- New presets: Analog poly, FM bell, FM electric piano, Organ, Vowel lead, Pulse bass, and five pads.
- Less harshness on distortion (it's processed at 4x the sample rate).

### Playing
- New tracks get a human feel that suits the instrument.
- **Shape dynamics** in the piano roll: phrases rise and fall like a player's.
- Chords on section instruments spread a few milliseconds, as a section never plays exactly together.

### Speed and memory
- Playback switches itself to stable mode if the page keeps lagging.
- Instrument recordings you haven't used for a while are let go after 3 minutes stopped.
- Songs start faster: a lighter version of each instrument loads first.

## 2026.10.14 — Fledgetone

- The app is now called Fledgetone, with its own logo.
- The starters play recorded orchestral, band and keyboard instruments; the older sounds are in a new **Retro (GM)** group.
- Mod wheel is dynamics on every instrument; new Vibrato lane and Swell tools.
- Strings play like strings: portamento on legato, short notes, double stops.
- Recorded rooms for the master reverb.
- **Play backwards** and **Reverse notes**.
- **Math patterns**: music written by a formula.
- **Melody variations**, smarter game transitions and game parameters.
- Faster song opening, shorter share links, and fixes from two bug hunts.
