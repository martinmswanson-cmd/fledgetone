# Changelog

What changed in each version of Fledgetone, newest first. The version shows at the bottom left of
the app (with the build it came from), so you can check the site is running the one you expect;
click it to read this list. To check from outside the app, open `/version.json` on the site.

Each version is the date it was released (a second release on the same day gets `-2`, and so on).
Changes not released yet gather under **Unreleased** at the top. When you release, rename it to the new version and set `version` in package.json to match (a test
checks they agree).

## Unreleased

- The guide matches the app again: the menu bar list covers every menu and item (Plugins and Learn included), game music has a chapter of its own, the Track Inspector is described in its real order, and wrong counts, menu paths and button names are fixed.
- The tour and tutorials describe the screen as it is now (the bottom panel's tabs, the Pump's Trigger, how Save works, the Drummer's 21 styles).
- **Download all** (Master tab › Instruments offline) says how much it fetches: about 280 MB, the built-in plugins included.
- Three instruments are renamed so they no longer carry product names: **80s Drum Machine** (was LinnDrum), **Rhythm Box** (was CR-78) and **Synth Drum** (was Syndrum). They sound the same, and songs that use them open as before. The starters' "Rhodes" tracks are now called "E. Piano".
- The terms of use (section 6) now say that a few recorded drum kits come from a collection that states no licence, as the guide's Credits do.

## 2026.10.16 — Demo songs

- **New** has a **Demo songs** section: the demo song (Sunset Stroll) and the five Classics, right under Blank timeline, to open and listen to. Fledgetone's old pages on twobirdsworkshop.com now go to fledgetone.com.

## 2026.10.15-34 — The Classics, settled

- The Classics group keeps just the five classical pieces.

## 2026.10.15-33 — The Classics

- A new **Classics** group of starters in **New**: five complete public-domain pieces (Pachelbel's Canon in D for solo strings and sections, the first movement of Beethoven's "Moonlight" sonata and Debussy's Clair de lune on the concert grand with the pedal, the Prelude of Bach's first cello suite on the solo cello, and Grieg's In the Hall of the Mountain King for orchestra, speeding up to the end), each with its dynamics, rubato and phrasing. Where their notes come from is in the guide's Credits.

## 2026.10.15-32 — Speed up from the clip menu

- Right-click a clip: **Speed up the end** speeds up the last 25% of the block by 25% and snaps back (one click), **Speed up the end + drum roll** goes 50% faster with the roll, and **Speed up the end…** opens the options.

## 2026.10.15-31 — Speed up into the drop

- **Speed up into the drop** (Arrange a beat › Drops & switches, right-click the ruler › **Speed up into here…**, or search *speed up*): the tempo rises over the last part of a block of music (the last 10 to 100%, 25% to start with) by up to double time, evenly or slow-then-fast, and snaps back to the old tempo on the drop (or stays fast). It can roll the snare up into the drop too (8ths, 16ths, then 32nds). It writes ordinary tempo glides, so playback, exports, the metronome and the grid follow it, and one Undo takes it out.

## 2026.10.15-30 — No sound on its own

- Fledgetone makes no sound until you start the audio (a click or a key), even when Chrome would allow it: a song Chrome reopens after a restart no longer starts playing by itself. Closing or leaving the page silences it at once, even if Chrome keeps running in the background.
- Effects that make their own sound (the Shepard tone, noise sources, click tracks) fade out a few seconds after their track goes quiet and come back when it plays, instead of droning on through the whole song and while stopped. Reverb and delay tails fade as before; the infinite reverbs still hold.

## 2026.10.15-29 — Real-sounding guitars

- Guitars that sound like the ones on records: less sharp, in a room, and played the way a guitarist plays. New **Classical Guitar (Real)**: a nylon-string guitar recorded on every note, soft, medium and hard, so no note is stretched from a neighbour's. The starters' classical guitar parts play it, and the **Acoustic Guitar (Real)** (until now the Acoustic Guitar) plays it too, voiced brighter for strumming (it used to be sharpened with an 8 dB treble boost and distortion).
- The real electric guitars' amps sound like a miked amp on a record: the speaker's piercing peak near 4 kHz is taken down, the hardest-picked recordings (much brighter than the rest) play only for accents, and a held chord rings on for 5 or 6 seconds, dying away, instead of stopping after 3 or 4.
- Every guitar plays in a small studio room after its amp (they were recorded dry, in mono), and the electric guitars make the sound of the strings being damped when a note is let go early.
- A chord written as one block on a guitar, banjo or mandolin is strummed: low to high on the way down, high to low when the hand comes back up for a chord that follows closely, quicker the harder it's played.
- The older General MIDI guitars sound darker as well as quieter when played softly, as the other guitars do.

## 2026.10.15-28 — Full names on hover

- In Search and the instrument menus, the result under the pointer (or chosen with the arrow keys) shows its whole name and description instead of cutting it off, and hovering shows it as a tooltip too.

## 2026.10.15-27 — Exports repeat exactly

- Exporting the same song twice now gives exactly the same file, sample for sample, for every instrument, kit, effect and starter (before, two exports could differ by a rounding error in the last bit, more after a distortion).

## 2026.10.15-26 — Install Fledgetone

- Fixed: in the published app the live loudness meter, and the loudness measured for exports, could fail with an error: they work again.
- Install Fledgetone as an app (Help › Install Fledgetone…, or Safari's Add to Dock / Home Screen): its own window, and it opens offline after one visit.
- The app is kept in your browser, so it opens at once and isn't downloaded again; recordings you've used aren't downloaded again either.
- New versions download in the background and show "Version … is ready: Reload". The app never reloads by itself: Reload autosaves first, and What's new opens after it.
- Master tab › Instruments offline shows whether the browser will keep your work when the disk gets full (Storage: protected), with Protect to ask.

## 2026.10.15-25 — A Learn menu

- A **Learn** menu at the top lists the tour and every tutorial, one click each (finished ones ticked, a half-done one picks up where you stopped). The guide and the tour now say where to find them correctly.

## 2026.10.15-24 — New violin in the starters

- The starters' solo violin is the new **Violin (Real)**: every note recorded, warmer and with a player's vibrato.

## 2026.10.15-23 — Flip a sample

- **Flipping a sample**: an audio clip's **tempo and key** are heard from its sound (with how sure, in the clip editor, on the clip and in the Audio track's panel), with one click to set the song to the sample's tempo, stretch the sample to the song's, or move it into the song's key (a re-pitched copy, same length). **Chop sample…** cuts it into up to 16 chops at its hits, in equal parts or by hand (drag, add and remove markers), onto a new Drum Rack's pads, each with its own start, end, fade, reverse, pitch, level and choke (one chop cuts the others, like a classic sampler); **Chop and play** writes a starting pattern that plays them in a new order, and **New idea** another. **Filter out the bass** clears a sample's low end for your own 808.

## 2026.10.15-22 — Warmer, more real strings

- Strings that sound less sharp and more like a record. New real recordings: **Violin**, **Viola**, **Cello** and **Contrabass (Real)**, single players recorded on every note at soft, medium and loud, so no note is stretched from a neighbour's. They were recorded without vibrato in a dead room, so each held note gets a player's vibrato (starting a moment into the note, a little different every time, with the shimmer of the instrument's body), a small stage around it, and a hall's softening of the bow's bite.
- Every bowed string swells in as a bow does (slower the softer it's played) instead of starting at full level, and held notes loop a longer stretch of the recording (up to 3 s, its level held steady) instead of repeating the same 1.5 s.
- A new orchestral track starts with more of the hall's reverb (strings on records sit in a hall).
- The Classical starter's string quartet plays the new violin, viola and cello, in more of the hall; the Cinematic starter's strings and cellos sit further into the hall too.
- The starters no longer add a second, even vibrato on top of strings that already play their own.

## 2026.10.15-21 — Mix and master tools

- **Clipper** on the master: shaves the tallest peaks flat before the limiter, for loud rap and electronic masters, with drive, a hard-to-soft character, a ceiling and a meter of how much it's clipping. Oversampled, so it stays clean, and the same in exports.
- **Reference track**: load a finished song, hear it at your mix's loudness, flip between the two with one A/B button, and see where your tonal balance differs on a spectrum. It stays in your browser and is never exported.
- **Mix check**: renders the song and each track and points out, in plain words and with the track to look at, wide bass, the kick and bass fighting, muddy or harsh spots, parts covering each other, a level wrong for where the song is going, and a master working too hard.
- **Bus presets**: one-click drum, 808/bass, vocal and music buses, with two new bus inserts: **Saturation** and **Mono bass**.
- **Beat store package**: one dialog makes a tagged MP3 preview, the untagged WAV, the stems and an optional cover in one .zip, named with the tempo and key.

## 2026.10.15-20 — Arrange a beat

- **Arrange a beat** (Song menu, the ruler's right-click menu, or search *arrange*): a **Dark melody** generator for trap, drill, rage and phonk (minor, harmonic minor or phrygian with the flat second for tension, sparse rhythms, a repeating motif with a new ending, density, register and **New idea**, the same idea number always writing the same melody), **Drop out** and **Stop** before a drop, **Riser** and **Reverse cymbal** into it, a **Beat switch** (half time, double time or a new drum pattern with the bass following its kicks), **Song form** (intro, hook, verse, hook, verse, bridge, hook, outro from a 4- or 8-bar loop, with section markers) and a **Producer tag** kept in the browser for every project, placed at the start or every few bars with the beat ducking under it. Each is one Undo step.

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
