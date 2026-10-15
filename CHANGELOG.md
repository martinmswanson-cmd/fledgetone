# Changelog

What changed in each version of Fledgetone, newest first. The version shows at the bottom left of
the app (with the build it came from), so you can check the site is running the one you expect;
click it to read this list. To check from outside the app, open `/version.json` on the site.

Each version is the date it was released (a second release on the same day gets `-2`, and so on).
Changes not released yet gather under **Unreleased** at the top. When you release, rename it to the new version and set `version` in package.json to match (a test
checks they agree).

## 2026.10.15-19 — Rap vocal tools

- Rap vocal tools: **vocal chain presets** on Audio tracks (Clean lead, Aggressive lead, Ad-lib, Phone / radio, Dark and wide, Backing stack: one click, one Undo step), **Hard tune** (fast pitch correction to the song's key, with a natural-to-instant Speed, note holding so it steps cleanly, and more scales: harmonic minor, phrygian, pentatonics), **Double this take** (two new performances panned left and right, a little early or late and a few cents apart, the same every time), and an **Ad-lib track** button that makes a new Audio track with the Ad-lib chain, ready to record.

## 2026.10.15-18 — Drum tools

- **Drum Designer**: a new **Designed Kit** whose every drum you make yourself, synthesized: kicks (punch, pitch sweep, decay, distortion), snares (tone, noise, snap, body), claps (bursts, spread, tail), hats (metal, color, decay), rims, toms, shakers and cowbells, two layers each, with 30 presets named by sound (hard trap kick, punchy drill snare, crisp clap...). Saved with the project; plays the same live and in exports.
- **Hat roll painter** (ROLL… in the piano roll): turn a hat note or a span into a roll at 1/16, 1/16 triplet, 1/32, 1/32 triplet, 1/64 or a stutter, its velocity rising, falling or swelling and its pitch climbing like drill hats.
- **Swing per drum** (GROOVE… in a drum clip's piano roll): swing the hats while the kick and snare stay straight, with groove templates (straight, light swing, heavy swing, lazy, pushed) that set each row's timing and velocity.
- **Note repeat** for finger drumming (MIDI popover): hold a pad and it repeats at 1/8, 1/16, 1/32 or a triplet rate, on the song's grid, its loudness following the pad's pressure; recorded hit by hit.
- Changing a clip's swing (FEEL) while the song plays is now heard at once, and a frozen track follows a change of its clips' swing or a note's own expression.

## 2026.10.15-17 — Heavy bass tools

- Heavy bass tools for trap, drill, rage, phonk and bass music: an **808 designer** on 808 Bass tracks (drive and clip character with a tone control, punch, slide time, decay, a top layer that phones and laptops can hear, tune to key, and six presets from clean and deep to blown out), a **Bass Drive** insert that distorts the mids and highs while the sub stays clean and mono, a **Sub enhancer** (a clean sine under a bass's notes), **Glide** for the monophonic synths, a kick and bass clash check with one-click **Duck under the kick**, and **Reese bass**, **Dark reese** and **Formant growl** presets in the Synth Designer (the Growl bass preset's low end is now centred).

## 2026.10.15-16 — Terms: not open source yet

- The terms of use no longer describe Fledgetone as open source: it isn't yet. It's free to use for making your music, and the open-source parts and sounds inside it keep their own licences.

## 2026.10.15-15 — Celesta, recorder and muted trumpet

- New real recordings: **Celesta (Real)** (every key, in stereo), **Recorder (Real)** (tenor, alto and soprano recorders as one instrument) and **Muted Trumpet (Real)** (harmon mute, soft and loud). The starters play them; the older Celesta, Recorder and Muted Trumpet move to Retro (GM), so older songs sound as they did.

## 2026.10.15-14 — A small thank-you

- The terms' questions and answers now say how to credit Fledgetone if you'd like to (never required, always appreciated).

## 2026.10.15-13 — Terms: questions and answers

- The terms of use start with plain questions and answers: owning and selling your music, credit, game kits in paid games, privacy, lost work, similar songs, content claims and more.

## 2026.10.15-12 — Clearer terms

- The terms of use now cover more: lost work, loud sound and flashing visualisers, music written by the tools, sounds everyone shares, and an age of 13 or older.
- The scripts and players Fledgetone writes into game kits and FMOD/Wwise packages can be used in any game or app, closed-source and paid ones included, under any licence. Each such export carries a LICENSE-exported-files.txt saying so.

## 2026.10.15-11 — Terms of use

- Fledgetone has terms of use (**Terms** at the bottom of the page, or **Help › Terms of use**): everything you make is yours, and you're responsible for what you make and use.

## 2026.10.15-10 — Exports repeat exactly

- Exporting the same song twice gives the same file: snares, hi-hats, claps, cymbals, risers and synth noise used to come out a little different every time. Each hit still sounds slightly different from the next.
- With a loudness target, a ring-out export's tails are judged at the file's final level, so a quiet song turned up no longer ends its tails early.

## 2026.10.15-9 — Hear instruments in the menu

- Every instrument in the instrument menus (Add Track and the Track Inspector) has a ▶ button: click it to hear that instrument before choosing it.
- The Instruments tab of the bottom panel is gone: hearing instruments moved into the menus, and its old pads and patterns had been replaced by the starters, the piano roll and the step sequencer. The bottom panel now has more room for the Mixer, EQ and Game panels.

## 2026.10.15-8 — Clearer timeline resize

- The timeline's resize bar sits right under the tracks with a grip on it, and says "more tracks below: drag down" when some tracks are out of view.

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
