# Fledgetone guide

## Getting started

Fledgetone is a music maker that runs in your browser. You build a song on the **Arrangement Timeline** out of **tracks** (one instrument each) and **clips** (blocks of notes on a track), mix it, and export it as a WAV file.

It's made for a computer: a PC or Mac with a mouse, a keyboard and a wide screen. On a phone a notice says so once; you can continue, but the timeline is cramped, drag-and-drop editing and keyboard shortcuts don't work, and audio may stutter.

1. Click **START AUDIO** in the top-right corner. Browsers only allow sound after you click something, so the button glows red until audio is running. Pressing Play also starts it.
2. To hear an example, open the **File** menu at the top, choose **New…** and pick **Demo song**, or one of the 75 starters (game music like Boss Fight, Stealth and Cozy Village, and genres like Drift Phonk, Bossa Jazz-Pop and Dubstep).
3. Press **Space** (or the green Play button) to play, and Space again to pause.
4. Double-click a clip to open its notes in the **piano roll** under the timeline.

At the very top is the **menu bar**: every tool in the app, where a desktop DAW keeps it (see The menu bar below), with the project's name, **Save**, **Export** and **Share** on the right. Under it is the header: **TEMPO** and **TAP**, **Swing**, **Intensity**, **MASTER** volume, the loudness reading (once audio runs), **SEARCH**, **LEARN**, **GUIDE** and **START AUDIO**. Under that, top to bottom:

- **Arrangement Timeline**: the toolbar, the ruler, your tracks (in folders, if you make some), the Overview strip and the piano roll or audio editor.
- **The bottom panel**: tabs for the **Mixer**, the **Launcher** (see Clip launcher), **EQ & Dynamics**, **Game**, **Video** and **Sound FX**. Click a tab to show it; click the open tab (or the arrow on the right) to fold the panel away. Drag its top edge to make it taller or shorter (double-click the edge to reset). The tab and height are remembered in this browser.

### The menu bar

- **File**: New…, Open… (`Ctrl+O`), Save (`Ctrl+S`), Export audio / video… (`Ctrl+E`), Share…, Cut song to length…, Export markers for video editors…, Game kit, FMOD / Wwise package…
- **Edit**: Undo, Redo, Cut, Copy, Paste at the playhead, Duplicate, Delete, Select all / nothing, and the Selection and Razor tools.
- **Song**: markers and hit points, the Markers list, Fit tempo / tempo finder, Tap tempo, Breathe (see Tempo changes), Play bars In → Out backwards (see Play backwards), insert and delete bars, Build-up & drop and key changes at the playhead, Cut song to length.
- **Track** (the selected track): Add track…, Delete, Freeze, Move up / down, New folder with this track, Mute, Solo, Arm, the Inspector, EQ, Pro EQ, Multiband, Human feel, Duck others under this track, Automation.
- **Tools**: Mixer, Sound effects maker, Generate variations, Tune vocal, Synth Designer, the microphone, MIDI keyboard, metronome, Performance & memory.
- **Video**: load the reference video, its preview window, Find cuts, Dip under dialogue, the tempo finder, Cut to length, markers for editors, music onto the video, remove the video.
- **Game**: the Game tab and its parts (transitions, intensity, stingers, loop variations), Sound effects maker, variations, and the game kit, web runtime and FMOD / Wwise exports.
- **View**: the bottom panel's tabs, show or hide it, the Inspector, zoom, and bars or timecode on the ruler.
- **Help**: Guide, Tour & tutorials, Search, Keyboard shortcuts, Report a problem, What's new, Terms of use.

Hover across the bar while a menu is open to move between menus; the arrow keys work too, and `Esc` closes.

> The app always opens on an empty timeline. If your last session had clips (or markers, with no clips yet), a banner offers to **Restore** it, saying how many and when it was saved. It stays across reloads until you click **Restore** or **Dismiss**.


### Tour and tutorials

The first time you open Fledgetone it offers a one-minute **tour** and six hands-on **tutorials**; click **LEARN** in the header (or search for *tutorial*) to find them again any time.

- **Quick tour**: points at each part of the screen and says what it's for. Just read and click **Next**.
- **Beginner: Your first song**: open a starter, play it, mute a track, change the tempo, write a note, undo, and export.
- **Intermediate: Shape and mix a song**: add an instrument, use the Filter, Pump and reverb, draw automation, use the Mixer, add markers, a build-up and drop, and the loop.
- **Expert: Pro techniques**: search, the Synth Designer, sidechaining from any track, the Gate, key changes, freezing, the Game preview and game-ready exports, and the fastest shortcuts.
- **Intermediate: Write with the helpers**: a chord progression in a key, an accompaniment for it, the Drummer, melody variations, and a clip's own swing (FEEL).
- **Intermediate: Make it expressive**: a Swell from the piano roll's TOOLS, the mod wheel as dynamics, a Vibrato lane, Breathe (a tempo that eases into phrase ends) and Play backwards.
- **Intermediate: Game music that reacts**: open a game starter, switch states in the Game tab, the transition matrix, a written bridge, switching on the phrase, and Audition like the game.
- **Expert: Make it react**: parameters the game sets, costumes, shuffled pieces and silences, effects and parameter sliders in Audition, Try it in a game, and what the game kit carries.

A tutorial puts a glowing ring round the part of the screen to use, and its card sits in a corner out of the way: it moves only if a menu, picker or dialog you open would end up under it. Drag the card by its top row to put it anywhere, or shrink it to one line with **–** (the line still shows what to do). Steps marked **Your turn** wait for you to do it and move on by themselves once you have (with a tick); everything else just needs **Next**. The app works normally the whole time, shortcuts included. **Back** goes to the previous step, **Skip** moves past a task you'd rather not do, and the **X** closes the tutorial: **LEARN** then offers to **Resume** where you stopped. Finished tutorials are ticked. Progress is remembered in this browser.

### Search

Press `Ctrl+K` (`Cmd+K` on a Mac), or click **SEARCH** in the header, and type what you're after: a tool (*export*, *mixer*, *mic*), a setting (*swing*, *reverb*, *stable playback*, *count-in*), an instrument (*violin*, *8-bit*, *angelic*), a genre starter (*horror*) or anything in this guide (*frame rate*). Results are labelled **Tool**, **Setting**, **Instrument**, **Starter** or **Guide**; the best match is first. A word with one letter wrong still finds it when nothing matches as typed (*viloin*).

Up and Down choose, `Enter` goes: a tool opens (Export, the Mixer...), a setting is scrolled into view and ringed in blue (opening the Inspector or the recording options first if it's in there), a guide result opens the guide at that section, and a starter shows it in the New dialog. On an instrument, `Enter` adds a track with it and `Shift+Enter` puts it on the selected track. Piano roll tools (scale, chords, arpeggiate...) need a clip open in the piano roll; search says so if none is. `Esc` closes search.

## The timeline

The timeline is 400 bars long, in 4/4 at one tempo. Each row is a track: its header on the left (name, volume, pan, mute, solo), its clips on the right.

### Tools

- **Selection tool** (`V`, the arrow): select, move, trim and create clips.
- **Razor tool** (`C`, the scissors): click a clip to cut it in two at that point. A red line previews the cut.

### Selecting clips

- Click a clip to select it. **Shift**, **Ctrl** or **Cmd**-click adds or removes clips.
- Drag a box over empty lane space to select every clip it touches (hold Shift to add to the selection).
- `Ctrl+A` selects all clips. `Esc` or a click on empty space clears the selection.

### Editing clips

- **Move**: drag the middle of a clip. All selected clips move together, sideways in time and up or down to other tracks. To ignore snap, start dragging and then hold **Shift** (Shift-clicking a clip selects it instead). A click that wobbles by a few pixels changes nothing.
- **Move to another track**: a clip can only go onto a track whose instrument can play it: the same instrument, drum kit to drum kit (Drums and Drum Machine), or any pitched instrument to any other (the Sampler and Taiko count as pitched). While you drag, the tracks it can land on are outlined in cyan; over any other track the clips stay on their own tracks. If several clips are selected and any one can't go to its new track, none of them change track, so a section spread over several tracks stays lined up.
- **Scroll while dragging**: bring the pointer to the edge of the track area and the timeline scrolls that way, faster the closer you get. The mouse wheel works mid-drag too.
- **Alt-drag**: hold **Alt** (Option on a Mac) and drag. Copies stay behind and the originals move.
- **Duplicate** (`Ctrl+D`, or right-click a clip > Duplicate): copies the selected clips as one block right after the end of the selection, so a section spread over several tracks stays lined up. The copies become the selection, so pressing `Ctrl+D` again keeps extending the section. If the copy wouldn't fit before bar 401, nothing is copied and a message says why.
- **Repeat ×N…** (right-click a clip): type how many copies you want (1 to 64) and press Enter. They go end to end after the selection, like Duplicate. If they wouldn't all fit before bar 401, the menu says how many would.
- **Fill to loop Out** (right-click a clip): repeats the selection end to end up to the loop's OUT. The last copy is cut short at OUT (its hidden notes come back if you drag its edge out). Fill makes at most 2,000 clips at a time.
- **Trim**: drag a clip's left or right edge. Trimming hides notes rather than deleting them, so dragging the edge back brings them back. Zoom in if a clip is too narrow to show its edge handles.
- **Copy, cut, paste**: `Ctrl+C`, `Ctrl+X`, `Ctrl+V`. Paste lands at the playhead (on the snap grid), on the tracks the clips came from, and selects the pasted clips. When playback is stopped, the playhead then moves to the end of the paste, so pressing `Ctrl+V` again lays copies end to end. Right-click a lane or clip for **Paste here**: if everything you copied came from one track, it pastes onto the track you right-clicked when that track's instrument can play it (the menu says "this track"); otherwise clips go back to the tracks they came from. Clips whose track no longer exists are only pasted that way.
- **Delete**: `Delete` or `Backspace`.
- Right-click a clip for **Edit notes**, Copy, Cut, Duplicate, Repeat ×N…, Fill to loop Out, Paste here and Delete.
- Duplicate, Repeat, Fill and every move (time and track together) are one Undo step each.

### Inserting and deleting bars

Right-click the time ruler. Apart from **Add marker here** (see Markers), the menu acts on **all tracks** at the point you clicked (on the snap grid; Shift for the exact point):

- **Insert 1, 2, 4 or 8 bars here**: adds empty bars. Clips that cross the point are cut in two there, and everything after it moves right. If that would push a clip or a marker past bar 401, nothing changes and the menu says so.
- **Delete bars In → Out**: removes the loop's range. Clips inside it go, clips that cross IN or OUT lose the part inside, and everything after it moves left to close the gap.

Markers, automation points, the loop and the playhead move with the music. Each edit is one Undo step, even one that only moves the loop or the playhead. Undo puts everything back, the loop and the playhead included; if either has moved since (you played, or dragged the loop), it moves back with the music instead. `Ctrl+Shift+Z` or `Ctrl+Y` does the edit again.

### Build-up & drop

Right-click the time ruler on the bar where the drop lands and choose **Build-up & drop here**. In one Undo step it writes:

- a **riser** and a **noise sweep** over the 4 bars before it, with a **reverse crash** into the drop (an FX track);
- a **snare roll** over the same 4 bars: quarters, then 8ths, then 16ths getting louder (a drum track);
- an **impact** with a **sub drop** on the drop itself, and a downlifter a bar later;
- markers called **Build** and **Drop**, unless there's already one on those bars.

It uses an FX track and a drum track that are empty there, or adds new ones (Build FX, Snare Roll) so nothing you wrote is covered up. Near the start of the song the build is shorter (a drop at bar 3 gets 2 bars). They're ordinary clips: change, move or delete them as you like.


### Cut to length: 6, 15, 30, 60 and 90-second versions

For an ad, a trailer or a social clip, the music often has to last an exact time. Right-click the time ruler and choose **Cut song to length…** (or search *cut down*), pick **6 s**, **15 s**, **30 s**, **60 s** or **90 s**, or type a length (`0:45:00` or `45`).

- It works in **sections**: the stretches between your markers (in a song without markers, 8-bar phrases; 4-bar ones in a song under 16 bars). Whole sections are left out for a shorter version, or a middle section is repeated for a longer one, so every edit falls on a bar line where the music changes anyway.
- It always **ends on the song's own ending** (its last section), keeps the sections in order, and keeps the parts that matter most: the busiest sections, and those named like a main part (Drop, Chorus, Hook, Theme, Combat, Boss...) before an Intro, Break or Build.
- The dialog shows the sections it will use, in order, with the length that makes. **Nudge the tempo** (on by default) changes the tempo by up to 8% so it lasts exactly the length you picked, to the hundredth of a second; untick it to keep your tempo and get the nearest whole number of bars.
- **Cut to** rebuilds the timeline in one Undo step: clips are cut at the section edges, automation goes with its section, the section markers move to where their sections now start (hit points locked to time stay put), and the loop covers the new version. `Ctrl+Z` brings the whole song back; a nudged tempo stays, so set it back by hand. Save a copy first if you want to keep both versions.

### Key change

Right-click the ruler where the new key starts and choose **Key change here: up a semitone**, **up a whole step** or **down a semitone**. Every pitched note from there to the end moves, in one Undo step; drum kits, percussion (Taiko and the like), sound effects, the FX track, the Slicer and audio clips stay as they are. A clip that runs across that point changes only from it on. A note that would go outside its instrument's range stays put, and the menu says how many did. The classic final-chorus lift is up a whole step, set up by a bar of the new key's V7 chord or a bar of silence.
### Creating clips

- With the Selection tool, double-click empty lane space for a new 1-bar clip starting on that beat (whatever SNAP is set to). It opens in the piano roll.
- Right-click empty lane space for empty clips of 1, 2 or 4 bars, ready-made patterns (Drums, Drum Machine, Slap Bass, Space Clav and Brass Stabs have them), and Paste.
- The **+** in a track header opens the same menu at the playhead.

### Snap

The **SNAP** menu in the toolbar sets the grid that clip moves, trims, razor cuts, the playhead, the loop brackets, markers and paste land on: **1/4** (a beat), **1/8**, **1/16**, **Frame** (one video frame, see Timecode & frame rates) or **Off**. Hold **Shift** to ignore snap when clicking or dragging on the ruler, razor-cutting, right-clicking or dropping a pad; for clip moves and trims, start the drag first and then hold Shift. The loop brackets always snap: set SNAP to Off to place them freely. The snap step is also the shortest a clip or the loop can be (never less than a 16th).

**Magnetic edges**: while you drag a clip or its edge (with SNAP on and Shift not held), its start or end jumps onto another clip's start or end, a marker, the playhead or a loop bracket once it comes within a few pixels, so parts butt up exactly. Further away, it snaps to the grid as usual.

### Zoom and scrolling

- Zoom with the slider at the right of the toolbar, or `+` and `-` (they keep the playhead where it is on screen when it's visible). **Ctrl+mouse wheel** (Cmd on a Mac) or a trackpad pinch zooms around the pointer. Zoom goes from 12 to 1280 pixels per bar, deep enough to see single video frames.
- Zoomed in, the lanes show faint lines on every 16th, or on every frame when SNAP is Frame.
- Scroll in time with **Shift+mouse wheel**, a sideways trackpad swipe, or the **Overview** strip under the tracks: drag its cyan window to scroll, click anywhere on it to jump, and drag either end of the window to zoom.
- **See more tracks at once**: drag the bar with the grip right under the tracks down to make the timeline taller, pushing the panel under it down (or up to make it shorter). It stops at the last track, so there's never empty space under them. Double-click it to fit every track in, and again to go back to the usual height. Adding a track grows the timeline just enough to show it (up to about three quarters of the window; past that, it scrolls to the new track). The height is remembered in this browser.
- While playing, the view follows the playhead. While stopped, a jump to a spot that's off screen (`,` and `.`, a position in the Markers list, **Go to In** or `Home`, or a position typed into a readout) scrolls the view to it.

### Undo

`Ctrl+Z` undoes and `Ctrl+Shift+Z` or `Ctrl+Y` redoes, up to 100 steps. Undo covers:

- clip and note edits;
- Insert and Delete bars, along with where they moved the loop and the playhead;
- markers: adding, moving, renaming, locking and deleting them;
- adding and deleting tracks (Undo brings a deleted track back with its clips), and changing a track's instrument;
- M, S and R, VOL and PAN, the EQ, Distortion, Compressor, Chorus, the sends and the Master tab (OTT, Stereo Width, reverb and delay);
- loading, replacing or removing a Sampler sound, and its **Original pitch on** note;
- automation: adding, moving and deleting points, ramps and clearing or removing lanes;
- the Game tab's own parts: costumes, stingers, the game's sound effects, transition rules, and how each state plays (shuffle and silences).

One slider adjustment is one step, whether you drag it, tap its arrow keys or double-click to reset it. Tempo, swing, the loop (other than by Insert and Delete bars), zoom, snap, frame rate, ruler units, master volume and the project name are not undone.

## Playback and the loop

- **Play / Pause**: the green button or `Space`. Playback starts exactly at the playhead, and notes that start right there play. With the loop on, a playhead at or past OUT jumps straight back to IN, so to play later parts turn the loop off (`L`) or move OUT.
- **Stop** (the square): stops and sends the playhead back to the loop's In point.
- **Go to In** (the skip-back button, or `Home`). If the In point is off screen, the view scrolls to it.
- **Playhead**: click or drag anywhere on the ruler, or drag the red line. Works while playing too.

### The loop

The amber region on the ruler, between the **IN** and **OUT** brackets, is the loop. With loop on (the Repeat button or `L`), playback goes round it, and the beat at IN plays on every pass. With it off, playback runs to the end of the timeline.

- Drag the IN and OUT brackets, or move the playhead and press `I` (set In) or `O` (set Out). They follow the snap grid; set SNAP to Off to place them anywhere.
- For exact values, click the small chevron (˅) right of the Loop button. **Loop range** has **In**, **Out** and **Length** boxes in the ruler's units (bars, or timecode in Time mode); each accepts bars (`17.3`) or a timecode (`00:00:12:15`), and Length takes bars.beats (`2.2`) or a timecode duration. Enter applies. Typed values don't snap. Typing an In at or after the current Out moves the whole loop there.
- A new project loops bars 1 to 5, so at first you only hear 4 bars. Press `L` to turn the loop off, or move OUT.

### Going to an exact position

Both readouts in the toolbar are also input boxes. Click one, type a position, and press **Enter** to jump the playhead there, scrolling the view to it if it's off screen (`Esc` cancels):

- **BAR.BEAT.TICK**: a bar (`17`), a bar and beat (`17.3`) or bar, beat and hundredths of a beat (`17.3.50`).
- **TIMECODE**: a timecode (see below).

## Tempo changes and time signatures

The thin top row of the ruler holds the song's tempo and time signature, and every change along the way. A faint line traces the tempo across the song, rising where it speeds up; a glide shows as a slope.

- **Add a tempo change**: double-click the top row, or right-click the ruler and choose **Tempo change here** (a jump) or **Tempo glide to here** (the tempo slides there from the change before, evenly over time, for a ritardando or a build that speeds up).
- **Breathe** (Song menu): the tempo eases back into the end of every 4-bar phrase (or 8, deeper) and picks up again on the next downbeat, as a pianist playing rubato does, with a longer slow-down into the last one. It writes ordinary tempo glides over the loop (the whole song when the loop is off), so live playback and every export follow it, and you can drag or delete them like any other. One Undo step takes it out. It won't write over a glide already in that stretch.
- **Edit one**: click its flag. Type the **BPM** (40 to 240, to 0.01), tick **Glide from the tempo before** to make it a glide, or **Remove** it. Click the first flag to change the song's starting tempo (the same as TEMPO in the header).
- **Move one**: drag its flag along the row. It snaps to the grid (Shift for none).
- **Time signatures**: right-click the ruler and choose **Time signature change here**, or click the time signature at the start of the row for the song's own. Pick the beats per measure (1 to 16) and the beat (2, 4, 8 or 16): 3/4, 6/8, 7/8, 5/4 and so on. A change lands on the nearest measure line, and dragging its flag keeps it on measure lines.

What changes and what doesn't:

- The ruler counts **measures** in their time signature, and the grid, the bar lines in the lanes and the BAR.BEAT.TICK readout follow it. The metronome clicks each beat of the measure, accented on beat 1, and the count-in is one measure of the song's time signature.
- Clips, notes, the loop and markers stay where they are in the music when the tempo changes: they keep their place in beats, and their time in seconds moves. Timecode, the video, and the time readouts follow the tempo.
- Audio clips that follow the tempo (stretched to it) play at the tempo where they start. Audio clips that don't play at their own speed, so their length in bars follows the tempo there.
- Exports, stems, freezing and every game export follow the tempo map to the sample, and so does playback, the loop included (a loop that crosses a change goes back to the tempo at its In each time round).
- Inserting and deleting bars moves the changes after them (deleting bars deletes the changes in them). Every change is one Undo step.

## Timecode and frame rates

The **TIMECODE** readout shows the playhead as hours, minutes, seconds and frames (`HH:MM:SS:FF`), counted from the start of bar 1 at the song's tempo. Use it to line music up with video or a game.

### Choosing a frame rate

Click the frame rate next to **TIMECODE** (it starts at **30 FPS**) and pick one:

| Rate | Typical use |
|---|---|
| 23.976 fps | Film shot for NTSC video ("24p" on most cameras) |
| 24 fps | Film and animation at a true 24 fps |
| 25 fps | PAL video (Europe, Australia) |
| 29.97 fps | NTSC video, non-drop-frame |
| 29.97 DF | NTSC broadcast video, drop-frame |
| 30 fps | Games, screen recordings and web video at a true 30 fps |
| 60 fps | Games and high-frame-rate video |

The frame rate is saved with the project. Projects from before this setting open at 30 fps. **New** keeps the frame rate you're using.

- **23.976** and **29.97** count 24 or 30 frames a second, but each frame lasts 1001/1000 as long, matching camera and broadcast footage. Non-drop 29.97 runs 3.6 seconds an hour behind the clock, as in video editors.
- **29.97 DF** (drop-frame) is written with a `;` before the frames (`00:01:00;02`). It stays in step with the clock by skipping the frame numbers `;00` and `;01` at the start of every minute except every tenth. Typing a skipped label goes to the next real frame.

### Typing a timecode

Click the timecode, type, and press Enter:

- `00:01:12:10` is 1 minute, 12 seconds, frame 10. Fields fill in from the right (frames, then seconds, minutes, hours), so you can leave off leading zeros: `1:12:10` is the same place, and `12:10` is 12 seconds, frame 10. Colons, semicolons, dots or spaces all separate fields.
- Digits on their own fill in from the frames, like in video editors: `1500` is 15 seconds, `10215` is 1 minute 2 seconds and 15 frames, and `12` is frame 12.
- Fields can overflow: `90:00` is 90 seconds.
- In drop-frame, `;` before the frames is optional.

A red box means the entry couldn't be read, or is past the end of the timeline.

### A timecode ruler

The **Bars | Time** switch above the track names changes what the ruler counts. **Time** labels it as `M:SS:FF` (minutes, seconds, frames), so any label can be typed straight into the timecode box. Labels come every few seconds when zoomed out, and every few frames when zoomed in, with smaller ticks in between. In drop-frame, minute labels read like `1:00;02`.

### Snapping to frames

Set **SNAP** to **Frame** to make clip moves, clip edges, razor cuts, the playhead, the loop brackets and markers land exactly on video frames at the current frame rate. (A clip made by double-clicking a lane still starts on a beat; drag it to put it on a frame.) The Export dialog also shows the loop's start timecode, so you know where a loop export sits against the picture.

> For frame-accurate work, **set the tempo and frame rate first**: positions are stored in bars, so changing either one leaves things off the new frame grid. Also set **Swing** to 0%, because swing delays the off-beat 16th notes slightly.

Frame snap applies to the timeline. Notes you write in the piano roll sit on its own grid (1/16, 1/8 or 1/4), counted from the clip's start. A pad dropped into a clip with Frame snap on lands on a frame instead; the piano roll shows it at the nearest 16th, and moving or nudging it puts it back on the grid.

## Scoring to a video

Write music to a gameplay clip, a trailer or a cutscene, and see the picture while you work.

- Click **Video** in the **Video** tab of the bottom panel (or **Video › Load reference video…**, or drop a video file anywhere on the page) to load an MP4 or WebM. It appears as a **video lane** under the ruler, with its frames along the song at the current tempo, and in a **preview window** that follows the playhead: it plays along when you play, and shows the frame under the playhead when you click or drag on the ruler, so you can line hits up with the picture.
- **Drag the video lane** sideways to move where the video starts in the song. It snaps to beats; hold Shift to place it freely. The lane's header shows where it starts (time and bar).
- **Find the cuts**: the scissors on the video lane's header looks through the video for hard cuts and drops a hit point (a marker locked to time) on each one, named **Cut 1**, **Cut 2**..., at the frame where the new shot starts. It takes a second or two for a short clip (the header shows how far it's got; click it again to stop). Cuts already marked aren't added twice. Then **FIT › Hit points** finds a tempo that lands the music on them. Move the video first: the markers go where the cuts fall in the song now.
- **Dip under dialogue**: the speech bubble on the video lane's header listens to the video's own sound for voices and shows how much talking it found. Pick how far the music should dip (**-3** to **-24 dB**, -10 to start) and click **Dip the music**: every track's volume dips from a moment before each line until half a second after it, with short pauses between words bridged so the music doesn't bob up mid-sentence. It's written as **volume automation** (one Undo step), so you can see each dip on the tracks, move or reshape it, and it's in every export. A track that already has a volume lane keeps its shape, lowered in the dips; remember a volume lane takes over from the track's fader. It listens for anything loud in the voice range, so loud effects or music in the video can count too: check the dips and delete any you don't want.
- The preview window: drag its top bar to move it, the arrows button cycles its size (small, medium, large), the speaker button lets you hear the video's own sound while you work (off by default), and **×** hides it. The eye button on the video lane shows it again; **×** on the lane removes the video.
- To export the music **on** your video, choose **Video (MP4)** in Export. With a video loaded, **Put the music on** *your video* is ticked: the picture is your video, where it sits on the timeline (black before and after), instead of the visualizer. Tick **Keep the video's own sound too** to mix its sound effects and dialogue under the music.
- The **Video** tab of the bottom panel has it all in one place: load or remove the video, its preview and sound, where it starts (type a time), **Find cuts** and **Dip under dialogue**, the hit points and the **Tempo finder**, **Cut to length**, the markers for **Premiere / Resolve / Final Cut**, and exporting the music onto the video.
- **The video is saved with the project.** It's kept in this browser, so a reload (or **Restore** of your last session) brings it back, where it was. A saved project file carries the video inside it when it's 40 MB or less; a bigger one stays in this browser, and opening the project elsewhere says which video it scores to (load it again and it goes back to its place).

## Markers

Markers are named points on the timeline: the sections of a song (intro, build, drop), or hit points in a video.

### Adding markers and jumping to them

- Press `M` to drop a marker at the playhead, even while playing. Markers are named **Marker 1**, **Marker 2** and so on. If a marker is already at that exact spot, nothing is added and a message says so.
- Press `Shift+M` to drop a **hit point** instead: a marker named **Hit 1**, **Hit 2**... that's locked to time, for a moment in a video the music should land on (a door slam, a cut, a logo). The **tempo finder** uses them (below).
- Or right-click the time ruler and choose **Add marker here**: it goes where you clicked, on the snap grid (hold Shift for the exact point).
- Or open the **Markers** list and click **At playhead**.
- `,` (comma) jumps to the previous marker and `.` (period) to the next. While playing, `,` skips a marker you passed less than half a second ago, so pressing it again and again keeps going back. Holding the key down while playing jumps once; holding it while stopped steps through the markers one by one. If the marker is off screen, the view scrolls to it.

### Flags on the ruler

Each marker is a violet flag with its name in the ruler, just under the numbers, with a thin violet line down through the tracks. The lines don't get in the way: clips, box selection and automation work straight through them. A long name is cut short to fit before the next flag; hover a flag to see its full name, position and timecode.

- **Click** a flag to move the playhead there.
- **Drag** it to move the marker. It snaps to the SNAP grid; hold Shift for no snap.
- **Double-click** it to rename it (up to 80 characters). Enter or a click anywhere else keeps the name; `Esc` cancels.
- **Right-click** it for **Rename**, **Lock to time** (or **Lock to bar**) and **Delete**. Unlike a click, the menu leaves the playhead where it is, so it doesn't interrupt playback.
- **With the keyboard**: `Tab` reaches each flag. `Enter` moves the playhead there, `F2` renames it, `Delete` deletes it, `←` / `→` move it one SNAP step (with Shift, a bar), and the menu key or `Shift+F10` opens its menu.

A marker normally stays on its bar when you change the tempo, so it moves with the music. **Lock to time** keeps its timecode instead and lets its bar move, for lining up with a video; its flag shows a small lock. If a faster tempo pushes a locked marker past the end of the timeline, it isn't drawn and the list says "after the end"; it comes back when you slow the tempo down.

### The tempo finder: land the music on your hit points

Drop hit points on the moments in a video that matter (`Shift+M`, or **Lock to time** on any marker), then click **FIT** next to the tempo and choose **Hit points**. It tries every tempo in the range (70 to 180 BPM unless you type another, in steps of 0.01) and lists the five that put the most hits on the grid:

- **Bar**, **Beat** or **1/8**: what the hits should land on. A hit counts when it's within one frame at your frame rate.
- Each suggestion shows how many hits it lands and how far off they are on average; click it to see every hit's timecode, the bar and beat it lands on, and how early or late it is.
- **Apply** sets that tempo. Hit points keep their times, so they now sit on the grid, ready for a crash or a stab right on them.
- The line above the list says how many land at the tempo you have now.

### The Markers list

Click the flag button right of the Loop button (it shows how many markers there are). The list has every marker in order, with its position (bar.beat.hundredths) and its timecode at your frame rate, drop-frame included. It grows to fill the room under it, and scrolls when there are more markers than fit.

- Type over a name to rename the marker; the flag changes as you type.
- The lock button locks the marker to time, or back to its bar. The bin deletes it.
- Click a position to move the playhead there (the view scrolls to it if it's off screen).
- `Esc` or a click outside closes the list.
- **Export markers for…** saves every marker (sections and hit points) as a file your video editing software imports, so the editor sees the same names at the same moments on their timeline:
  - **Premiere Pro (.xml)**: File › Import; it opens as a sequence carrying the markers.
  - **DaVinci Resolve (.edl)**: right-click the timeline in the Media Pool, or Timeline › Import › Timeline Markers from EDL. Resolve timelines usually start at 01:00:00:00, so tick **Timeline starts at 01:00:00:00** first.
  - **Final Cut Pro (.fcpxml)**: File › Import › XML; a project with the markers on its timeline.
  - **Spreadsheet (.csv)**: name, timecode and seconds.

  They use your frame rate (drop-frame included). With a reference video loaded, **From the video's start** (on) counts from the video's first frame, where it sits on the editor's timeline; untick it to count from bar 1.

### Markers and the rest of the song

- Adding, moving, renaming, locking and deleting a marker are one Undo step each.
- **Insert bars** moves the markers at or after the insert point with the music. **Delete bars In → Out** deletes the markers in the removed bars (one exactly at IN goes, one exactly at OUT is kept) and moves the later ones left. Markers locked to time stay where they are.
- Markers are saved with the project and in autosave, even before there are any clips (hit points placed on a video before the music is written): the Restore banner offers that session too. Older versions of the app open the file without them.
- WAV exports carry the markers as cue points (see Exporting audio).

## Writing notes: the piano roll

Double-click a clip with the Selection tool (or right-click it and choose **Edit notes**, which works with either tool) to open it in the piano roll under the timeline. Drum kits show a row per drum (Kick, Snare, Clap, the hats, toms, crash, ride and cowbell); other instruments show a keyboard covering the instrument's range.

- **Add a note**: click empty grid. Keep the button down and drag to place it.
- **Move**: drag a note sideways (time) or up and down (pitch). Selected notes move together.
- **Length**: drag a note's right edge.
- **Delete**: right-click a note, or select notes and press `Delete`.
- **Select**: click a note. Shift, Ctrl or Cmd-click adds notes; `Ctrl+A` selects them all; `Esc` clears the selection.
- **Nudge**: arrow keys move selected notes by one grid step or one semitone; Shift with up and down moves an octave.
- **Hear it**: click the keys on the left. Adding or clicking a note plays it, and so does dragging it to a new pitch.

The header has the clip's name (click to rename), **GRID** (1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4), **NEW NOTE** length, **VEL** (velocity: how hard new notes are played; with notes selected it changes those notes) and zoom. Click the piano roll's ruler to move the playhead. Close it with **Close** or `Esc` (when no notes are selected).

**Fine grids and triplets.** **T** means triplet: three in the space of two, so 1/16T puts six notes in a beat and 1/8T three. Clicking places a note on the grid line at or before the pointer. Dragging a note, or its right edge, snaps it to the grid, and the arrow keys move notes one grid step. Changing the grid never moves existing notes. Zoom in (the magnifier) for comfortable 1/32 editing. Swing leaves triplets and 1/32 notes on the grid, and an 8th with a 1/32 roll or a triplet in it plays straight, so rolls stay even with Swing on.

**Step sequencer** (drum clips): with **STEPS** ticked (the default for drum kits), a click puts a hit in that GRID step of the row, and a click on a hit takes it out, like a drum machine. Shift-click adds an accent (full velocity). Alt-click (or STEPS off) adds and drags notes as usual.

**Composing helpers** (in the piano roll's header):

- **SCALE**: pick a key (root and scale: Major, Minor, Harmonic minor, Dorian, Phrygian, Lydian, Mixolydian, the two pentatonics, Blues, Japanese, and the colours game music leans on: **Hirajoshi** and **Yo** (Japanese), **Phrygian dominant** and **Double harmonic** (desert), **Hungarian minor** (gothic), **Harmonic major**, **Melodic minor**, **Lydian dominant**, **Locrian**, **Whole tone** (dreams, magic), the two **Diminished** scales (menace, horror) and **Chromatic**). The CHORD stamps also have Min6, Min(maj7), 6/9, Dim7, Augmented and a 3-semitone Cluster; on the Chromatic scale, "Triad in key" stacks semitones, a cluster too. Rows outside the key are shaded dark and the root's rows lit, and a click lands on the nearest note of the key, so nothing sounds wrong.
- **CHORD**: a click adds a whole chord from the note you click. **Triad in key** and **7th chord in key** build the right chord for that place in the scale (in A minor, a click on D gives D minor); the others are fixed shapes (Major, Minor, Sus2, Sus4, 7, Maj7, Min7, Add9, Diminished, Power, Octave). The chord drags as one.
- **TOOLS** changes the selected notes, or the whole clip with nothing selected, in one Undo step: **Quantize** (starts, or starts and lengths, to the GRID), **Humanize** (small random shifts in timing and velocity), **Strum** (a chord's notes a moment apart, low to high or high to low), **Arpeggiate** (each chord becomes a broken chord at the GRID's speed: up, down, up and down, or random), **Legato** (each note lasts until the next), **Ratchet x2 / x3 / x4** (each note split into equal repeats, getting louder), **Roll** (each note repeated at the GRID's speed for its length, rising: set GRID to 1/32 for a snare or hat roll), **Semitone up / down**, **Octave up / down**, and **Fit to scale**. Drum clips have Quantize, Humanize, Ratchet and Roll.
- **GHOSTS** shows the other tracks' notes over the same bars as faint outlines in their colours, so a melody can follow the chords.

**Expression lanes** (at the bottom of the piano roll, for every instrument except the drum kits and FX): what a keyboard's wheels, pedal and knobs would play over the clip, and each note's own expression. Pick the lane in the menu at the left of the lane.

- **Pitch bend**: every note bends together. Click to add a point, drag one to move it (it snaps to the grid; Shift for none), and right-click or double-click a point to remove it; the bend glides from point to point. The lane shows ±2 semitones; **±2 st** switches it to ±12 for big swoops. Bends reach up to an octave either way.
- **Mod wheel (dynamics)**: how loud and how bright, from soft (bottom) to full (top), on every instrument, as orchestral sample libraries use it. Instruments recorded soft and loud and held (the **Violins**, **Violas**, **Cellos**, **Tremolo**, **Solo Violin** and **Double Bass**, **Oboe**, **Clarinet**, **Bassoon**, **French Horn**, **Trumpet**, **Trombone**, **Tuba** and the saxes, all **(Real)**) crossfade from the soft recording to the loud one while the note plays; every other instrument gets louder (about 18 dB from bottom to top) and brighter. A held note can swell and fade: draw a rising line for a crescendo, or let **Swell** draw it (below). A clip without a mod wheel lane plays as it always did, each note's velocity setting its loudness. A MIDI keyboard's wheel does the same live, and is recorded into this lane.
- **Vibrato**: vibrato, deeper as it goes up (at the top, half a semitone either way, about five and a half times a second). Drawn like the bend. (In songs saved before the mod wheel became dynamics, the mod wheel lane was vibrato: opening one moves it to this lane, so it sounds as it did.)
- **Swell, Crescendo, Diminuendo** (the piano roll's **Tools** menu): the mod wheel drawn for you over the selected notes (all of the clip's with none selected). Notes that touch or overlap are one phrase, and each phrase grows to its middle and fades (Swell), grows (Crescendo) or fades (Diminuendo). The mod wheel lane opens to show it; edit the points as you like, and one Undo takes it out.
- **Stutter build, Spring bounce, Tritone slide, Scoop** (the piano roll's **Tools** menu): **Stutter build** retriggers whatever is on each bar's last beat 2, 4, 8, then 16 times, bar by bar, tightening into the next phrase (on drums too). **Spring bounce** draws each note's own bend so its pitch boings like a weight on a spring and settles (an 808 favourite). **Tritone slide** holds each note, then slides it up half an octave (the "devil's interval"). **Scoop** starts each note a little flat and swoops up into it, the rave hoover's move. They're drawn as each note's **Note bend**, so you can reshape them.
- **Shape dynamics** (Tools menu): makes a line's loudness rise and fall the way a player phrases it, without drawing anything. The notes are split into phrases at each rest (or every two bars); in each, the loudness grows to the phrase's highest note and falls away after it, higher notes leaning a little louder and the last note easing off. Each phrase keeps its average, so the part's level and its accents between phrases stay as you wrote them. It changes the velocities, once (Undo to take it back).
- **Play backwards**: a block of music turned round, as a tape played backwards: notes swell in from nothing and their echoes and reverb come before them. **Song > Play bars … backwards (In → Out)** does everything between the loop's In and Out; right-click a clip of notes and choose **Play backwards** for that one clip, through its own track. The music is rendered (instruments, inserts, sends and reverb, the master section left for the way back) and reversed, and comes back as an audio clip on a new track in the same place, while the notes it came from leave that stretch (clips crossing its edges are cut there and keep their outside parts). One Undo brings the notes back; the audio clip's own **Reverse** button (in its audio editor) plays it forwards again. **Reverse notes** in the piano roll's Tools menu is the composer's kind instead: the notes stay notes, mirrored in time, the last first.
- **Sustain pedal**: drag along the lane to hold the pedal down there; notes let go while it's down ring on until it comes up. Click a held stretch to lift it.

- **Controller lanes (CC)**: any MIDI controller by number (choose one under **Add a controller lane**). Drawn like the bend, from 0 at the bottom to 127 at the top. A controller lane moves the track setting it's mapped to with MIDI learn, or else the usual one: **CC 7** volume, **11** expression (also volume: a string or wind player's swell within a phrase), **10** pan, **74** filter cutoff, **71** resonance, **91** reverb send, **93** delay send. Plugin instruments also get it as MIDI. Knobs on your controller that aren't mapped are recorded into controller lanes.
- **Note bend** and **Note pressure** (select one note): that note's own expression, as an MPE keyboard plays it. **Note bend** slides just that note away from its pitch and back (up to 24 semitones either way); **Note pressure** swells and fades it (its level, from silent at the bottom to full at the top). The lane covers the note's length. The Multi Sampler plays these on each note on its own; other instruments bend as a whole while the note plays.

A ● in the lane menu means that lane has something in it. The lanes travel with the clip when it's moved, copied, split or trimmed, and play the same live and in exports. Bends and vibrato play on the recorded instruments, Slap Bass, Sub Bass, 808, Lead, Space Clav, Brass Stabs, Pad and plugin instruments; the sustain pedal works on every instrument.

**Notation**: tick **NOTATION** in the piano roll's header to see the clip as sheet music: a staff (a grand staff when it spans both clefs; drum clips on a percussion staff) in the song's key and meter, with chords, rests, ties over bar lines, beams and accidentals. Notes are put on a 16th grid and each staff reads as one voice (notes that start together are a chord, held until the next one starts). The measure the playhead is in is lit. **MusicXML** saves the clip for notation programs (MuseScore, Sibelius, Dorico and others), and **Print** prints it or saves it as a PDF. Untick NOTATION to edit the notes again.

### Smart tools: chords, bass lines, a drummer and fills

Right-click to have parts written for you. Each one is a single Undo step, and the result is ordinary notes you can edit.

- **Chord progression…** (right-click an empty spot on an instrument track): four well-worn chords, such as I–V–vi–IV (pop) or i–VI–III–VII (epic), and the borrowed and chromatic ones game and film music lean on: ♭VI–♭VII–I (**level clear**, victory), I–♭VII–IV–I (**open field**), I–♭VI (**wonder**), I–III–IV (**hero's journey**), I–II (**magic**), I–IV–iv–I (**wistful ache**), a **calm maj7 vamp**, a **rousing march**; in minor, i–IV (**ancient**), i–♭II (**menace**), i–V–VI–V (**castle**), i–♭vi (**tragic grandeur**), i–♯iii (**sudden shock**), the **noir** line cliché, i–♭VI–♭VII–I and i–iv–V–I (**triumph**, dark to light) and vii°7–V7 (**dread**). Then the extended colours of city-night, ballad, lo-fi and funk writing: Imaj7–iii7–vi9–IVmaj7 (**city at night**), IVmaj7–iv6–Imaj7 (**bittersweet turn**), IVmaj7–V7–iii7–vi7 (**royal road**), IVmaj7–III7–vi7–I7 (**sunset**), ii9–V13sus–Imaj9 (**lo-fi, neo-soul**), IVmaj7–V7sus–iii7–vi9 (**night drive**) and, in minor, i9–IV9 (**Dorian funk vamp**), iiø7–V7–i7 (**minor turnaround**) and i–v–♭VI–♭III (**requiem**). Chord names show the colour: Cadd9, Fmaj9, Am9, Dm11, G7sus4, G13sus4. All in the song's key (worked out from its notes; pick another key in the dialog). Choose how long each chord lasts, how many times through, and how they're played: **Held chords**, a **Quarter-note pulse**, **Off-beat stabs** or an **Arpeggio**. **7th chords** makes them jazzier. Each chord is voiced to move as little as it can from the last, as a keyboard player would. The clip is named after its chords and starts on the bar line you clicked.
- **Math patterns…** (right-click an empty spot on an instrument track): a clip a formula writes, in the song's key (or one you pick), 4, 8 or 16 bars long. **Pendulum wave**: six notes swinging at slightly different speeds (6 to 11 swings every 4 bars), each playing as it crosses the middle; they drift apart into ripples and line up again every 4 bars (bells, a celesta or a harp suit it). **Fibonacci groove**: the Fibonacci numbers, counted in fours, pick tones of the home chord; the pattern repeats every 6 notes against 8 in a bar, so each bar lands differently (a pluck or bass). **Fifths walk**: every fourth note of the scale, a line that walks the circle of fifths through the key. **Pascal's harp**: Pascal's triangle with only its odd numbers kept (a Sierpinski fractal), one row a step, played as a rising harp chord. **Endless riser**: copies of a rising line an octave apart, each fading in at the bottom and out at the top, so it seems to rise forever and never gets higher (a Shepard tone): for builds and tension.
- **Chords for this melody** (right-click a note clip): chords that fit the clip's tune, a chord a bar (half a bar for a clip of two bars or less), on a new track under it. Long notes and notes on the beat count most; the chords are chosen to move the way songs usually do, ending on the home chord or the V.
- **Bass line from these chords** (right-click a chord clip): a driving 8th-note bass on each chord's root, on a new Slap Bass track under it (change the instrument as you like).
- **Melody variations…** (right-click a note clip): the tune another way, in the song's key (shown and changeable: a major key and its relative minor share their notes, so pick the one the tune feels like). Every note moves by the scale's own steps, so it stays in key; a sharp or flat outside the scale keeps it. **Answer phrase** (the same rhythm going the other way, starting a step from where the tune ended and coming home to the key note: call and response), **Darker** (the minor; a minor tune goes Phrygian), **Brighter** (the major; a major tune goes Lydian), **Simpler** (only the notes on the beat, each held to the next), **Busier** (passing notes filling the leaps), **Syncopated** (downbeat notes an eighth early), **Up a step** (a sequence that builds), **Mirror** (upside down around the first note), **Harmony a third above** (a second voice to play along), or **Surprise me** (two of them together; make another for another). **Put it** after the clip on its track (the first free spot), on a new track under it (the harmony's default, to play together), or in place of it. One undo step.
- **Accompaniment for these chords…** (right-click a chord clip): a part that follows each chord change, on a new track under it: a **Walking bass** (quarters up the chord, a half step into the next one), **Oom-pah-pah** (the root low on the beat, the chord on the others: a waltz in 3/4, an oom-pah in 4/4, a lilt in 6/8), an **Alberti bass**, **Strummed guitar**, a **Harp glissando** on each change, a driving **String ostinato** accented 3+3+2, **Sparkle** (a few high chord notes here and there), a **Horn fanfare** (a triplet pickup, then up the chord) or a **Drone**. Each suggests an instrument; pick another if you like. The notes are moved into the instrument's range.
- **Drummer…** (right-click an empty spot on a drum-kit track): a beat in one of twenty styles (**Four on the floor**, **Backbeat**, **Boom bap**, **Trap**, **Two-step**, **Funk**, **Dembow**, **Half time**, and for games: **Waltz** in 3/4, **Jig** in 6/8, **March**, **Shuffle**, **Big-band swing**, **Bossa nova**, **Calypso**, **Maqsum** desert hand drums, **Battle ostinato**, **Tribal build**, **Blast beat**, a **Heartbeat**, and **Brushes**: a soft swirl on the snare leaning on two and four, for ballads and a city at night), 1 to 16 bars (measures, in 3/4 or 6/8) long. The beats follow the song's time signature; a waltz or a jig in a 4/4 song offers to set 3/4 or 6/8 for the clip (and back after it), in the same Undo step. The shuffle and swing styles give their clip swung 8ths (see FEEL). with an **Energy** slider (sparse, steady, busy) and a fill every 2, 4 or 8 bars. A crash opens the part. Every clip it makes is a new take: the hats breathe and the kicks move a little from bar to bar.
- **Fill** (right-click a drum clip): replaces the end of the bar under the pointer with a **snare roll** (last beat), a **tom run** (last two beats), a **build-up** (the whole bar, snare 8ths to 16ths to 32nds, getting louder) or a **kick pickup**. Kicks on the beat stay, and a crash and kick land on the next downbeat.

> With no notes selected, `Delete` acts on the timeline and deletes the selected clip, usually the one you're editing. `Ctrl+Z` brings it back.

## Instruments

Each track plays one instrument. Add a track with **+ Add Track** under the last track, or change a track's instrument in the Track Inspector (**SOUND GENERATOR**). Both open a list with a search field at the top: type part of a name (*sax*), a style or mood (*8-bit*, *angelic*, *orchestral*, *jazz*, *horror*) or a word from the description (*slap*), then Up / Down and `Enter`, or click. With nothing typed it lists every instrument by group. <!-- instruments:start (generated by npm run guide-tables) -->
There are 215 instruments in 15 groups:

| Group | Instruments |
|---|---|
| Drums & Percussion | Drums, Drum Machine, Taiko Drums, Studio Kit (Real), Acoustic Kit, Breakbeat Kit, LinnDrum, CR-78, Techno Kit, Bongos & Percussion, Melodic Toms, Syndrum, Woodblock, Agogô |
| Bass | Slap Bass, Sub-Bass, 808 Bass, Wobble Bass, Growl Bass, Reese Bass, Upright Bass (Real), Electric Bass (Real), Fretless Bass, Bass + Lead, Slapped Bass, Slapped Bass 2, Analog Synth Bass, Synth Bass 2 |
| Choir & Voices | Solo Voice (Real), Choir, Voices "Ooh", Synth Choir |
| Pads & Atmospheres | Halo Pad, Warm Pad, New Age Pad, Choir Pad, Glass Pad, Sweep Pad, Atmosphere, Crystal, Sci-Fi, Goblins, Polysynth Pad, Metallic Pad, Rain, Soundtrack, Brightness, Echo Drops |
| Orchestra | Violins (Real), Violins Short (Real), Violas (Real), Violas Short (Real), Pizzicato Section (Real), Tremolo Section (Real), Solo Violin (Real), Double Bass (Real), Harp (Real), Flute (Real), Flute Short (Real), Oboe (Real), Clarinet (Real), Bassoon (Real), French Horn (Real), French Horn Short (Real), Trumpet (Real), Trumpet Short (Real), Trombone (Real), Trombone Short (Real), Tuba (Real), String Section (Real), Brass Section (Real), Timpani (Real), Concert Bass Drum (Real), Orchestra Hit, English Horn, Piccolo, Recorder |
| Keys & Synths | Grand Piano, Space Clav, Wavetable Synth, Analog Lead, Supersaw, Synth Designer, Pluck, Concert Grand (Real), Upright Piano (Real), Pipe Organ (Real), Chapel Organ (Real), Harpsichord (Real), Electric Piano (Real), Synth Strings, Drawbar Organ, Rock Organ, Bright Piano, Electric Grand, Honky-Tonk Piano, FM Electric Piano, Clavinet, Percussive Organ, Reed Organ, Square Lead, Saw Lead, Calliope, Chiff Lead, Charang, Voice Lead, Fifths Lead, Synth Brass, Synth Brass 2, Synth Strings 2 |
| Guitars & Strings | Acoustic Guitar, Mandolin, Cellos (Real), Cellos Short (Real), Electric Guitar (Real), Crunch Guitar (Real), Distortion Guitar (Real), Hollow-Body Guitar (Real), Flatwound Guitar (Real), Banjo (Real), Classical Guitar, Muted Guitar, Steel-String Guitar, Guitar Harmonics |
| Winds & Brass | Alto Sax (Real), Baritone Sax (Real), Tenor Sax (Real), Brass Stabs, Muted Trumpet, Soprano Sax |
| Mallets & Bells | Marimba (Real), Xylophone (Real), Glockenspiel (Real), Tubular Bells (Real), Vibraphone (Real), Celesta, Music Box, Tinkle Bell |
| World | Kalimba (Real), Steel Drums (Real), Harmonica (Real), Ocarina (Real), Zither (Real), Erhu, Fiddle, Sitar, Koto, Shamisen, Shakuhachi, Pan Flute, Bagpipes, Accordion, Dulcimer, Shehnai, Whistle |
| FX | FX |
| Sound Effects | Reverse Cymbal, Seashore, Birds, Telephone, Helicopter, Applause, Gunshot, Fret Noise, Breath |
| Chiptune | Chip Lead, Chip Bass, Chip Drums |
| Retro (GM) | Bass Guitar, Electric Piano, Pipe Organ, Electric Guitar, Harp, Violin, Cello, Strings, Saxophone, Trumpet, French Horn, Flute, Marimba, Chimes, Timpani, Viola, Contrabass, Pizzicato Strings, Tremolo Strings, Slow Strings, Oboe, Clarinet, Bassoon, Trombone, Tuba, Brass Section, Tenor Sax, Harpsichord, Glockenspiel, Vibraphone, Xylophone, Distortion Guitar, Overdrive Guitar, Banjo, Upright Bass, Ocarina, Harmonica, Kalimba, Steel Drums, Jazz Guitar, Clean Guitar, Finger Bass, Pick Bass, Baritone Sax |
| Your Sounds | Sampler, Drum Rack, Multi Sampler |

- **Generated in the browser** (they work offline): Drums, Drum Machine, Slap Bass, Sub-Bass, 808 Bass, Wobble Bass, Growl Bass, Reese Bass, Space Clav, Wavetable Synth, Analog Lead, Supersaw, Synth Designer, Pluck, Brass Stabs, Chip Lead, Chip Bass, Chip Drums, FX.
- **Recorded** (193 instruments and kits, downloaded the first time you use them): all the others, except the Sampler, Drum Rack and Multi Sampler, which play your own sound files.
<!-- instruments:end -->

### Real recordings

The instruments marked **(Real)** are proper multi-sampled recordings, made the way commercial sample libraries are, rather than the general-purpose (General MIDI) soundfont sounds of the 1990s many of the others use:

- **Several loudnesses per note.** Most were recorded played softly and loudly, some at three or four loudnesses (the clarinet, horn, trombone, pianos and basses), and the velocity picks the recording, so a soft note has the tone of a softly played instrument, not a loud one turned down. The recordings' levels are matched, so velocity still sets the loudness smoothly.
- **Several takes per note.** Short notes, plucked strings and guitars have two takes of each note that play in turn, so repeated notes, strummed rhythms and ostinatos don't sound copy-pasted.
- **In tune and even.** Every recording was measured and corrected to true pitch (the pianos keep their stretched upper octaves, as real pianos have), brass and wind notes that scoop up into pitch were bent onto it, and notes much louder or quieter than their neighbours were evened out.
- **In stereo.** The recordings keep both sides as they were recorded, so a string section is as wide as the section and a piano spreads from low to high, with the room they were played in (the guitars and basses were recorded straight from the instrument, in mono, and stay so).
- **Held as long as you like.** A held note plays its recording, then repeats a seamless stretch of its steady part for as long as the note (or your key) lasts: a pad of strings can hold for a minute.
- **Smooth between loudnesses.** A velocity right at the boundary between two recordings plays both, blended, so notes either side of it don't jump from one tone to the other.
- **Letting go.** The **Harpsichord**, **Concert Grand** and **Upright Piano** make the sound a key makes as it's let go (the harpsichord's jack falling back, a piano's damper settling on the string) when a note ends before it has rung out, at the level it was recorded with the note (a piano's quieter the longer the note was held).
- **Players breathe.** Wind and brass notes held longer than a player's breath (about 6 to 9 seconds) fade gently instead of holding forever.
- **Sections aren't robots.** In the string and brass sections and the choir, the notes of a chord start a few milliseconds apart, as no two players start together.

The instruments:

- **Strings**: **Violins**, **Violas** and **Cellos (Real)**, sections bowed with vibrato, each with a **Short** version playing short, bouncing strokes (spiccato) for ostinatos; **Pizzicato Section** and **Tremolo Section** (cellos, violas and violins across the range); a **Solo Violin**, a bowed **Double Bass** and a concert **Harp**. The bowed strings play as a string player would: a short note starts past the bow's slow start, so fast runs speak instead of swelling in; a note written to overlap the one before is a **legato** change, sliding into the new note without a fresh bow attack (overlap the notes in the piano roll to get it); and a solo violin, viola or cello plays at most two notes of a chord at once (a double stop: the lowest and highest). The violins have a string player's EQ (the 2.5 and 4 kHz bite taken down), and the reverb, as a real hall does, soaks up the very top and the boom.
- **Woodwinds**: **Flute** (and **Flute Short** for tongued notes), **Oboe**, **Clarinet** and **Bassoon**.
- **Brass**: **French Horn**, **Trumpet** and **Trombone**, each with a **Short** version for stabs and fanfares, and **Tuba**. The real horns play up to D#4 (the recordings have nothing between there and D5); above that, use the **Brass Section**.
- **Sections**: **String Section (Real)** is the cellos, violas and violins as one instrument (cellos at the bottom, violins at the top), for pads, swells and film chords; **Brass Section (Real)** is the trombone, horn and trumpet the same way. Each section is levelled so it sounds as one group across the keyboard.
- **Percussion**: **Timpani (Real)**, five kettle drums at three loudnesses (notes from D#2 to A#3; a starter's lower or higher hits move by octaves onto the drums).
- **Keys and mallets**: a **Concert Grand** at four loudnesses, an **Upright Piano**, a Flemish **Harpsichord**, a church **Pipe Organ** with its pedal pipes and a gentler **Chapel Organ**, and **Marimba**, **Xylophone**, **Glockenspiel**, **Vibraphone** (soft mallets), **Tubular Bells** and a **Kalimba**.
- **Band**: **Alto Sax**, **Tenor Sax** and **Baritone Sax**, a plucked **Upright Bass** and a fingered **Electric Bass**, and the guitars: **Electric Guitar (Real)**, **Crunch Guitar (Real)** and **Distortion Guitar (Real)** (one recorded electric through three amps: clean and bright, pushed until it breaks up, and high gain), **Hollow-Body Guitar (Real)** through a warm clean amp, and **Flatwound Guitar (Real)**, warm and round for jazz and soul.

The guitars were recorded straight from the pickup, as guitarists do when they want to choose the amp later, and each instrument adds its amp and speaker cabinet in the app. Chords go through the amp together, as they do on a real amp, so a distorted chord grinds the way it should. The three amp versions share one set of recordings, so using all three downloads it once.

They come from the site the app is published on (about 165 MB in all, fetched a set at a time the first time you use each instrument, 1 to 10 MB each, then kept in this browser) and are free to use (see Credits). The older instruments that a recording now replaces are in the **Retro (GM)** group at the bottom of the instrument menu, so songs that use them sound as they did; to hear a song with the real ones, change the track's instrument in the Track Inspector (they start out at about the same loudness as the instrument they replace). The starters play the recordings: their strings, brass, winds, harp, guitars, basses, electric piano, organ, mallets, timpani, sax, banjo, harmonica, ocarina, steel drums and acoustic drum kit are the **(Real)** instruments (the short-stroke versions for parts of short notes), and their soft pads are Synth Designer pads (the **Glass pad**, **Halo pad**, **Sweep pad**, **Polysynth** and **Soundtrack pad** presets). A few sounds have no free recording yet and are still the older ones: taiko, choir, celesta, music box and much of the World group. The **Studio Kit (Real)** is a full recorded drum kit (kick, snare, hats, three toms, crash and ride, each at four loudnesses with two takes), and **Solo Voice (Real)** is one low male voice singing "aah". The brightest of them (the **Glockenspiel**, **Harpsichord**, **Harmonica** and **Trombone Short (Real)**, and the Studio Kit's hats, cymbals and snare) are kept at twice the detail, so notes played away from their recorded pitch stay clear and sparkling; they take twice the memory (except on computers with 4 GB or less). Turn **Expressive playing** on (it is on for new tracks): with real recordings it filters the soft notes much less, because the soft recording already sounds soft.

### Expressive playing

A recorded instrument has one recording per note, made at one loudness, so on its own a soft note is just the same note turned down, and every repeat is identical: that's much of what makes sampled music sound like an old game. **Expressive playing** (a tick box under the instrument in the Track Inspector) plays the recordings the way the instruments really behave:

- **Softer is darker.** Each note gets its own tone filter that follows its velocity: at full velocity the recording is untouched; soft notes lose their brightness as well as their level (by about two to three octaves of top end at the softest, depending on the instrument family, brass and strings the most, pads the least). So a crescendo drawn with velocities brightens as it grows, as a real one does.
- **A natural loudness curve.** Velocity follows a decibel curve rather than a straight line, so the soft end is really soft.
- **No machine-gun repeats.** Every note is a hair different, up to ±3 cents in pitch and ±0.6 dB in level, worked out from the note and its moment so exports come out the same every time. On the drum kits, each hit is detuned a little (the kick hardly at all, the hats and claps the most) and its level varies, as a real drummer's hits do.
- **A modern 808.** The 808 Bass becomes a clean mono sub with a separate driven copy for the grit, low end untouched by the distortion, with a softer attack (6 ms).

It's on for every track of a new song and every track you add. Songs made before it existed open with it off, so they sound as they did; tick it to try. Velocities matter more with it on: draw accents (0.85-0.95), normal notes (0.55-0.7) and ghosts (0.25-0.35), and use the **HUMAN** insert for timing.

For **classical and angelic** music: Choir and Voices "Ooh" for heavenly voices, Halo Pad, Glass Pad and Choir Pad underneath, Harp, Celesta and Glockenspiel for sparkle, and the Orchestra group for everything from a string quartet (Violin, Viola, Cello, Contrabass) to a full orchestra with woodwinds, brass and Timpani.

- **Recorded instruments** download their sounds the first time you use them, so they need an internet connection then; after that they're kept in this browser and load at once, even offline (Master tab › **Instruments offline** can download them all ahead of time). A spinner shows on the track header while they load, and the Inspector shows **Loading CDN...**, **Ready** or **Error**. When a song opens, each instrument fetches the recordings of the notes the song plays first, and plays as soon as those have arrived; the rest download behind it, one at a time, and join in as they come (an instrument added to a song starts with one loudness of every note). A note whose own recording hasn't arrived yet plays the nearest one that has, while its own is fetched. Exports wait for every recording the song plays. To save memory, recordings are kept without their silent ends, and ones whose two sides are the same sound are kept as one; neither changes how anything sounds. On a phone or a computer with little memory (4 GB or less), the rest of an instrument's recordings download only when a note needs them. If a download fails, the track header shows a red **!** in place of its coloured dot and the Inspector shows **Error** with a **Retry** button; click either to try again. Failed downloads are also retried when your connection comes back, and when you hear it with ▶ in the instrument menu, add another track with it or export. Once it downloads, every track using it plays from its next note, with no reload.
- **Tuning**: every recording of the recorded instruments was measured for pitch, and the ones that were out of tune (some soundfont recordings are off by up to half a semitone, so neighbouring notes clashed) are re-pitched as they load, or replaced by a steadier recording a semitone away. Across the instruments, 99.8% of notes are within 10 cents (a tenth of a semitone) of true pitch. **Pizzicato Strings** now uses a steadier set of recordings, one for every key. Bells, drums and the piano (tuned slightly wide on purpose, as real pianos are) are left as recorded.
- **Balance across the range**: every instrument's level was measured in its low, middle and top register with a weighting close to how ears hear at normal volume. Instruments that got louder or harsher up high play their top notes softer (a taper), the brightest ones (Flute, Recorder, Pan Flute, Ocarina, Violin, Erhu, Saxophone) start a little quieter, and the deep instruments and strings (Cello, Viola, Contrabass, Strings, Tremolo, French Horn, Trombone, Tuba, Bassoon, the basses, the choirs) have their slow recorded swell trimmed so notes speak at once, more upper-mid presence and less low-mid boom, so they sound close instead of in the next room.
- Every drum kit has the same eleven rows: **Kick**, **Snare**, **Clap**, **Closed Hat**, **Open Hat**, **Tom Low**, **Tom Mid**, **Tom High**, **Cowbell**, **Ride** and **Crash**, so drum parts move between kits. The recorded kits play their own recordings of the kick, snare, hats and toms, and synthesized hits for the rows they have no recording of. On a MIDI keyboard, the drum pads land on the matching rows. Taiko and Timpani are played like pitched instruments.
- Slap Bass, Sub-Bass, 808 Bass and Analog Lead play one note at a time; in a chord, only the loudest note sounds. The **808 slides**: a note that starts before the previous one has ended glides to its pitch instead of hitting again (the trap and drill 808 slide), so draw the first note long enough to overlap the next. Notes that only touch hit separately. Space Clav (16 notes at once), Wavetable Synth (12) and Brass Stabs (8) cut short whichever ringing note is quietest when they run out (a note already let go before one still held, never one that has only just started unless every note has), so new notes still play (only notes beyond the limit that start at the very same moment are dropped). A recorded instrument rings up to 64 notes at once; past that, the one quietest at that moment fades out quickly, worked out from how hard it was played, how far it has died away and whether its key is still down.

### Synth Designer

**Synth Designer** (Keys & Synths) is a synth you build yourself. Its controls appear in the Track Inspector under the instrument:

- **Load preset…** starts from a sound: Init saw, Supersaw lead, Wobble bass, Growl bass, Sub bass, Angelic pad, Warm pad, Glass pad, Halo pad, Sweep pad, Polysynth, Soundtrack pad, Pluck, Bell, Brass, 8-bit lead, Riser noise, **Analog poly**, **FM bell**, **FM electric piano**, **Organ**, **Vowel lead**, **Pulse bass** or **Rave hoover** (three saws slightly out of tune with a saw an octave under, gliding between notes; add the **Scoop** tool for the classic swoop).
- **Osc 1** and **Osc 2**: a wave each (Saw, Square, Triangle, Sine, **Pulse** (narrow, nasal and hollow), **Organ** (drawbar harmonics) or **Vowel** (an "ah", vocal)), tuned by octave, semitone and cents, with a level. **Sub** adds a sine an octave down, **Noise** adds white noise.
- **Unison** stacks up to 7 copies of each oscillator, detuned across **Spread** and panned across **Width**, for big wide leads and pads. Unison saws start at different points of their cycle, as analog oscillators do, so a stack doesn't sweep ("zip") as it opens up.
- **Filter**: Low-pass, High-pass, Band-pass or **Ladder** (a warm 24 dB low-pass, driven a little and resonant, as on classic analog synths), with **Cutoff**, **Reso**(nance), how far its own envelope opens it (**Env amt**, in octaves), how much it follows the note (**Key trk**) and **Drive** for grit (shaped at four times the sample rate, so it doesn't fizz). **Drift** makes each note's oscillators a few cents off from each other and its filter a little brighter or darker, as no two notes on an analog synth are quite alike. **FM** lets Osc 2 bend Osc 1's pitch at audio rate, for bells, electric pianos and metallic basses (Osc 2's own level can be at 0: it still bends Osc 1).
- **Filter envelope** and **Amp envelope**: Attack, Decay, Sustain, Release.
- **LFO**: wobbles the **Filter**, adds vibrato to the **Pitch** or tremolo to the **Volume**, in sync with the tempo (1/1 to 1/32, triplets too) or free in Hz. Each note restarts it, so a synced filter LFO is a dubstep wobble locked to the beat.
- **Mono** plays one note at a time and **Glide**s between them; **Level** sets the output.

Every change is one Undo step (a whole slider drag is one), is saved with the project and plays from the next note. Double-click a slider to reset it.

### EDM instruments

- **Wobble Bass**: the dubstep wobble, a filter sweeping in time with the beat. **Growl Bass**: the talking riddim growl, a vowel filter ("oo", "ah", "eh") swept the same way. **Reese Bass**: detuned saws that beat slowly, for drum & bass and dubstep.
- These three play one note at a time (the loudest wins). A note that starts before the previous one ends **slides** to its pitch without re-attacking: draw a note a little longer so it overlaps the next one. Notes that don't overlap start fresh.
- **WOBBLE** in the piano roll header (Wobble and Growl only) sets the wobble rate for the whole clip: **1/1**, **1/2**, **1/4**, **1/8** (default), **1/8T**, **1/16**, **1/16T** or **1/32**. Each note restarts the sweep, so wobbles stay locked to the beat. Different clips can use different rates; the rate shows as a small tag on the clip, is saved with the project, and travels with copies. Changing it is one undo step.
- **Supersaw**: seven detuned saws per note, spread wide, for house and trance chords. **Pluck**: a short, bright pluck for melodies and arps. Both play chords.
- **FX** has fixed rows like a drum kit: **Riser**, **Noise Sweep**, **Reverse Crash**, **Impact**, **Sub Drop** and **Downlifter**. Every effect except Impact lasts as long as the note you draw: draw a 4-bar note for a 4-bar riser, and end a Reverse Crash on the drop. Impact is a one-shot boom of about 3.5 s. In an FX clip, NEW NOTE starts at 1 bar, and clicking a row's name previews it. FX clips only go on FX tracks.
- Right-click an empty spot on a lane of these instruments for ready-made parts: **Wobble Riff**, **Growl Riff**, **Reese Line**, **Trance Chords**, **Pluck Arp**, and for FX a **Build-Up** and a **Drop Hit**.

### Chiptune

The sound of 8-bit game consoles, for retro games:

- **Chip Lead**: a 25% pulse wave, the classic 8-bit lead. Notes start and stop hard, and a vibrato comes in after a note has sounded a moment. It plays chords, so it does arpeggios too: fast 16th notes cycling through a chord are the chip way of playing one.
- **Chip Bass**: the stepped triangle wave those consoles played bass on. Like the real thing it has no fade: notes are on or off.
- **Chip Drums**: a noise kit with the same five notes as the other kits: a pitch-swept kick, a noise snare, short noise hats, and a metallic open hat and cowbell from the noise channel's "short mode".

Set the master's **Stereo Width** off for the authentic mono sound. The **Chiptune** starter (New) has all three playing together.

### The Sampler: your own sound

1. Add a track with **Your Sounds > Sampler** (or switch a track to Sampler).
2. In the Inspector, click **Load a sound…** and pick an audio file (WAV, MP3, OGG and most others) up to 50 MB.
3. Under **ORIGINAL PITCH ON**, choose which C (C2, C3, C4, C5 or C6; C4 by default) plays the file at its normal pitch. Higher notes play it faster and higher, lower notes slower and lower.
4. Write notes for it in the piano roll like any other instrument.

The sound is kept in this browser and saved inside the project file (see **Where your sounds live** below). It plays only as long as each note lasts (then fades out quickly), so draw long notes for long sounds. The play button previews a half note at the original pitch; the trash button removes the sound (`Ctrl+Z` brings it back).

### Drum Rack: your own drum sounds

**Add Track > Your Sounds > Drum Rack** gives 16 pads, each playing a sound of your own, laid out like a pad controller (pad 1, C2, bottom left; pad 16, D#3, top right).

- **Load sounds**: **Load sounds…** in its Inspector panel fills the pads in order with the files you pick (up to 16). Drop files on a pad to load them from there on, or select a pad and click **Load…**. Each pad is named after its file (rename it in the name box above its settings).
- **Each pad's own effects**: select a pad (clicking it plays it) for its **Level**, **Pan**, **Pitch** (±24 semitones), **Decay** (how long it rings before fading; "full" plays the whole sound), **Low-pass**, **High-pass**, **Drive** (saturation) and **reverse**.
- **Choke groups**: pads in the same group cut each other off, as a closed hi-hat stops an open one ringing. Put the open and closed hats in group 1.
- In the piano roll each pad is a row, named as you named it, with the **STEPS** step sequencer. A MIDI keyboard plays the pads on C2 to D#3, and any other octave lands on them too.
- The rack's sounds are kept like the Sampler's (see Where your sounds live) and saved inside the project file. The whole track also has the usual mixer, inserts and sends.

### Multi Sampler: an instrument from your own recordings

**Add Track > Your Sounds > Multi Sampler** plays several of your sounds across the keyboard: record or collect a few notes of an instrument (a C every octave, or every few notes) and it becomes a playable instrument, each key using the nearest recording, played higher or lower.

- **Add sounds…** (or drop files on the panel). Each sound's own pitch is read from its file name ("Piano C4.wav", "Strings A#2.flac") or, if the name doesn't say, worked out by listening to it. Each then plays the keys nearest it.
- **Velocity layers**: sounds of the same note marked by loudness in their names (pp, p, mp, mf, f, ff, soft, hard) become layers: soft playing uses the soft recording, hard playing the hard one.
- The table lists each sound's **Root** (the key it plays at its own pitch), **Keys** (the lowest and highest it plays) and **Vel** (the softest and hardest velocity), all editable. Click a sound's name to hear it. **Re-map by root** lays them out again from their roots. **Attack** and **Release** shape every note.
- Pitch bend and per-note expression (see the piano roll) play on each note's own voice.

### Audio tracks: your own recordings

An **Audio** track holds sound files as clips instead of notes. Add one with **Add Track > Your Sounds > Audio**.

- **Getting a file in** (WAV, MP3, OGG, FLAC, M4A and anything else your browser can play, up to 50 MB each): drag files from your computer onto an Audio track's lane (it snaps; hold `Shift` for no snap), or onto the strip under the tracks to make a new Audio track. You can also click **Load audio…** in the Inspector (clips go at the playhead), or double-click an Audio lane or right-click it > **Load audio file…** (clips go at that bar). Several files land end to end.
- A clip is as long as its sound, is named after the file, and plays it as recorded. It keeps its start bar and its length in seconds when you change the tempo, so its length in bars follows the tempo, unless it **follows the tempo** (below).
- **Follow tempo** (in the clip editor): tick it for a loop or a recording made at a set tempo, and the clip is **time-stretched** with the song's tempo: it keeps its pitch and its length in bars, playing faster or slower. Set **recorded at** to the tempo it was made at; the buttons beside it suggest tempos at which the clip lasts a whole number of bars. **×1.20** and so on shows how fast it's playing; past about 30% faster or slower (amber) hits start to smear. Drum hits are kept sharp and on the beat. While a new tempo's stretch is being made (a moment, after you stop dragging the tempo), the clip plays sped up like tape, in time but a little off pitch.
- **Crossfades**: overlap two audio clips on a track (drag one over the end of another) and they **crossfade** across the overlap: the earlier fades out as the later fades in, with equal-power curves so the level holds through it. The overlap is drawn as a yellow X. A clip lying wholly inside another plays on top of it instead (a layer). A crossfade longer than a clip's own fade replaces that fade.
- **Tune vocal** (right-click an audio clip, the clip editor, or **Tools › Tune vocal**): pulls a recorded voice (or any instrument playing one note at a time) onto the notes of a key, keeping its timing. Pick the **key** (it starts on the key the song's notes are in) and **major**, **minor** or **chromatic** (any note); **Strength** is how far onto the note (100% lands right on it), **Speed** how fast it gets there (0 ms snaps at once for the hard tuned sound; 40 to 200 ms keeps slides and vibrato natural). The graph shows the pitch sung (grey) and tuned (colour) against the key's notes. **Hear tuned** and **Hear original** compare them; **Apply** makes a tuned copy for the clip (one Undo step). The original is kept: **Untune** in the same dialog goes back to it.
- **Editing** works as for note clips: move, trim, razor, copy and paste, duplicate, Repeat, Fill to loop Out, Insert/Delete bars, undo. Trimming the left edge makes the clip play from further into the sound. Audio clips only move between Audio tracks.
- **Fades**: drag the small square at either top corner of a clip (shown when the clip is wide enough).
- **Gain and fades**: double-click a clip (or right-click > **Gain and fades**) for the clip editor under the timeline: the waveform, **GAIN** (-24 to +24 dB), **Fade in**, **Fade out**, and **Chop to Slicer…**. `Esc` closes it.
- **Warp markers** (the clip editor's **Warp** tool): pin a moment of the sound (a drum hit, a word) and move it in time; the audio either side stretches to fit, at the same pitch. Double-click the waveform to add a marker, drag one sideways to move that moment (it snaps to 16ths; Shift for anywhere), right-click to remove it. Markers work while the clip follows the tempo: adding one to a clip that doesn't sets **Follow tempo** at the song's tempo, so nothing else changes. **Clear warp** removes them all.
- **Quantize audio**: finds the hits in the clip and pulls each onto the chosen grid (1/4 to 1/32) with warp markers, at 25 to 100% strength. Tighten a loose drum take or a strummed part; drag any marker to adjust, or Undo.
- **Gain envelope** (the **Gain envelope** tool): draw the clip's level over its sound, on top of its gain and fades: click to add a point, drag points up and down (-60 dB, silent, to +12 dB), right-click to remove one. Duck a breath, lift a quiet word. **Clear envelope** removes it.
- **Reverse**: plays the clip backwards (a reversed copy of its sound, the same stretch of it mirrored). Click **Reversed** to go back.
- **Normalize**: sets the clip's gain so its loudest moment peaks just under full scale.
- The track's mixer, effects, sends and automation all work on Audio tracks. Swing never moves audio clips. Pressing Play in the middle of a clip plays it from the right place, and exports are sample-accurate.

### The Slicer: vocal chops

The **Slicer** (**Add Track > Your Sounds > Slicer**) cuts a sound into slices and puts one on each key from C3 up (Slice 1 on C3, Slice 2 on C#3, and so on, up to 64).

- In the Inspector, click **Load a sound…**. **CUT**: **Auto** cuts where it hears a new word or hit (**SENS** sets how faint a hit still starts a slice); **Equal** cuts the sound into 4, 8, 16 or 32 equal slices.
- On the waveform, drag a marker to move a cut, double-click to add one, and right-click a marker to remove it. Click a slice to hear it.
- In the piano roll the rows read **Slice 1**, **Slice 2** and so on. A note plays its slice from the start, for the note's length or the slice's length, whichever is shorter.
- **Pitch** mode: every key plays the slice you last clicked, pitched from its own key, so you can play a chop as a melody.
- **Chop to Slicer…** (right-click an audio clip, or in the clip editor) makes a Slicer track from that clip's sound, with a clip that plays the slices in order, ready to rearrange. The audio clip stays.
- Slices play at the sound's own level; use the track fader to balance it.

### Plugins

The **Plugins** menu holds hundreds of built-in effects and instruments: open-source plugins from Airwindows, MDA, Mutable Instruments, Faust and Open303, compiled to run in the browser (see Credits for who made them). They need no address and nothing to allow.

- **Plugins › Browse plugins…** opens the plugin browser: search by name or by what it does ("tape", "warm", "bell", "granular"), or pick a group down the side: **Instruments**, **Recommended** and **Basic** (the Airwindows picks), then each kind of effect (Reverb, Saturation, Dynamics, Filter, Lo-Fi and more). **Effects go on** chooses the track. **Add** puts an effect on that track; an instrument's **New track** makes a track that plays it. The menu also has shortcuts straight to the reverbs, delays, saturation, tape, dynamics, filters and others.
- **Effects** go after the track's instrument and before its own inserts, in the order you add them, like the web plugins below. Right-click a track's name for **Add plugin effect…**, and to open or remove each one.
- **Instruments** become tracks you write notes for, record onto and play from a MIDI keyboard, like any other: an acid bass line synth; electric piano, piano, FM and analog poly synths; 22 synthesis engines (analog, FM, wavetable, chords, speech, swarm, drums and more); resonators, modal voices, bells and physical models of brass, woodwinds, strings, guitars and percussion.
- **Its window** opens when you add it, with what it does and a slider for each setting, showing the value as the plugin does. Double-click a slider to put it back; **Reset all** puts them all back. Plugins that come with presets have a **Preset** list at the top.
- **★** a plugin in the browser to keep it under **Favourites**, and on the Plugins menu (added to the selected track in one click). **Recently used** lists the last ones you added.
- Everything works as for any plugin: automation lanes for every setting, MIDI learn, freezing, bouncing, exports, and the settings saved with the project.
- The plugins download the first time you open the browser or use one (about 9 MB in all, in a few files) and are kept in this browser. **Master tab › Instruments offline › Download all** includes them, for working offline.

### Plugins from the web (Web Audio Modules)

The app can also load **Web Audio Modules** (WAM 2): instruments and effects other people make for the web, each at its own address. Look for them in the WAM community's plugin lists; you need the address of the plugin's module (usually ending `index.js`), and its site has to let other sites load it.

- **A plugin instrument**: **Add Track → Plugin instrument (WAM)…**, paste the address and press **Load plugin**. It becomes a track you write notes for, record onto and play from a MIDI keyboard like any other (notes, velocity, held keys, pitch bend and the expression lanes go to it as MIDI).
- **A plugin effect**: right-click a track's name (any but a bus), **Add plugin from a web address (WAM)…** (or **Plugins › Effect from a web address (WAM)…**). Effects come after the track's instrument and before its own inserts, in the order you add them. Right-click the track to open or remove each one.
- **Its window**: the plugin's own controls open when you add it. Reopen them with the plug icon on the track's header, or from the right-click menu. Drag the window by its title bar; **BYPASS** (effects) lets the sound pass it by; closing the window leaves the plugin playing.
- **Its settings** are read from it every few seconds and when its window closes, and saved with the project, so exports, freezing and reopening the project hear it as you set it.
- Addresses you've used are listed under **Used before** in the dialog.

Plugins are programs from their sites, so only load ones you trust. A project you open that uses plugins plays without them at first, and a bar at the top names the sites: **Load plugins** allows them (remembered in this browser). Plugins need an internet connection (the site they come from), and a plugin that fails to load says why and stays silent (an effect lets the sound through). A plugin is only as good as its maker made it: one that's slow can make playback stutter, and freezing its track helps.

### Where your sounds live

Sound files (audio clips, the Slicer and the Sampler) are kept in this browser, once each, shared between tracks and projects, so a big file doesn't fill up autosave. **Save** puts the sounds inside the `.fledgetone.json` file, so a saved project opens complete on any computer, and opening it puts the sounds back into the browser. The Audio, Slicer and Sampler panels show how much the browser holds, and **Free unused** deletes the sounds no project on screen or restorable session uses. A clip whose sound was freed shows "Sound not in this browser" until you load the sound again or reopen the project file.

## Hearing an instrument before you choose it

Every instrument menu (Add Track, and the instrument at the top of the Track Inspector) has a **▶** button on each row: click it to hear that instrument play a short rising phrase and a chord (a drum kit plays a short beat), without choosing it. It plays "dry", without any track's volume or effects. The first time, a recorded instrument downloads its sounds before it plays.

## Mixing and effects

### The Mixer

The **Mixer** tab of the bottom panel shows every track side by side as a mixing desk: a level meter (after the fader: green, amber near the top, red at the very top), a fader, pan, the reverb (**REV**) and delay (**DLY**) sends, **M**ute and **S**olo, and which inserts are on. The master fader is on the right. These are the same settings as the track headers and the Inspector; each drag is one Undo step and a double-click resets. Click a track's name to open it in the Inspector for its inserts, EQ and automation.

**Make space** (under the strips) carves room in the mix the way a mix engineer does, with small moves on each track's Pro EQ: every part above the bass loses the rumble under its lowest note (a low cut), parts reaching down into the bass's octaves are thinned there by 2 dB, and parts playing in the lead melody's range give way 2.5 dB where the lead's presence is, so the melody comes through without being turned up. It works out the bass, the lead and the rest from the notes. A band you've already moved is left alone; drums, sound effects, audio and buses aren't touched. One Undo takes it all back.

**Spectrum**: right of the master fader, the live spectrum of everything you hear, drawn as a neon display: magenta for the lows, through purple and cyan, to yellow for the highs, with scanlines, a readout of the loudest frequency and the level, and a glitch on hard bass hits. Pick its style from the menu above it, and it's remembered:
- **LED bars**: segmented bars (lows on the left) with peaks that fall slowly.
- **Neon city**: a rainy skyline. Each tower rises with its part of the sound and more of its windows light up, reflected in the wet street.
- **Grid terrain**: the spectrum scrolls toward you as a wireframe landscape (lows in the middle, highs out to the sides).
- **Radar HUD**: the spectrum round a sweeping radar (lows at the top, highs at the bottom), with blips where it's loud, the level in the middle and, when there's room, low/mid/high meters and readouts.
- **Data rain**: streams of glyphs that fall faster, longer and brighter where the sound is loud, with a line tracing the spectrum.
- **Holo pigeons**: the workshop's two pigeons as holograms on projector pads, one faceted and one in pixels. They bob their heads on the beat and flicker.

### Track headers

**Right-click a track's name** for its **colour**, **Move up** / **Move down**, **New folder…**, **Move into** a folder or **Take out of** one, its **Output** (the master or a bus), **Send to a new bus**, plugin effects (**Add plugin effect (WAM)…**, and **Open** or **Remove** each one), Freeze and Delete.

**Folders**: a folder groups tracks under a row of its own. Its arrow **folds** them away (they still play, and the folder's row shows their clips in miniature, so you can see where the music is); double-click the folder's lane to fold or unfold too. Its **M** and **S** mute or solo every track in it, the folder icon sets a colour for it and its tracks, double-click its name to rename it, and **×** ungroups it (the tracks stay where they are). Tracks in a folder show a thin stripe of its colour. Moving a track up or down past the edge of its folder takes it out; a track outside folders hops over a whole folder. Folders are saved with the project and every change is one Undo step (folding isn't).

Each track header has **VOL** (-60 to +6 dB) and **PAN** sliders (double-click either to reset), and buttons for **M** (mute), **S** (solo) and **R** (record arm: takes go on this track, one track at a time; arming also selects it). If any track is soloed, only soloed tracks play. Muted and un-soloed tracks are also left out of exports.

Tracks are stereo, so wide sounds keep their width all the way to the master: the Supersaw, Space Clav and Mandolin, the noise in the FX instrument, the **Chorus** effect, recorded instruments with stereo samples, and stereo files in the Sampler. Most synths and mono samples are mono and sit in the middle, and so are the drum kits, effects included (a Chorus on a kit doesn't widen it). **PAN** works as a balance: in the middle both sides play, and turning it towards one side fades out the other, so at full left you hear only the left channel. For a mono sound that's the same as moving it across.

### Buses (group channels)

A **bus** is a track with no clips of its own that other tracks play into, so they share one fader, one set of inserts and EQ, and one pair of sends: put all the drums through one compressor, or turn every backing part down together.

- **Make one**: **Add Track → Bus (group channel)**, or select clips on each of the tracks you want, right-click one of those tracks' names and choose **Group N tracks into a new bus** (for just the track you right-click, **Send to a new bus**).
- **Route a track**: right-click its name and pick **Play into “Bus name”**, or **Output: back to the master**; or use the output menu at the bottom of its Mixer strip. The track's header shows **→ Bus name**, and the bus shows **bus · N** (how many tracks play into it).
- A bus has a fader, pan, every insert and the EQ, sends, mute, solo, automation and a meter, like any track. At 0 dB, centred and with nothing on, it leaves the sound exactly as it was.
- **Mute** a bus and its tracks go silent; **solo** it and you hear it with everything playing into it. Soloing a track in a bus keeps the bus playing.
- Buses can play into other buses (a drums bus into a music bus). A route that would come back round to itself isn't offered.
- Deleting a bus sends its tracks back to the master. Buses can't hold clips, be armed or be frozen. Exports, stems and freezing play through them as you hear them.

### Return tracks (effect returns)

A **return** is a track for a shared effect: put a reverb, a delay or any effect on it, and send as much of any track to it as you like. Many tracks share one room or one echo, and each decides how much of itself goes in, without changing its own sound.

- **Make one**: **Add Track → Return (effect return)**, or right-click a track's name and choose **Send to a new return** (that track starts sending to it at 50%).
- **Put effects on it**: select the return and turn on its inserts in the Inspector, usually the **Reverb** or **Delay** (on a return they start at 100% mix, since the dry sound already plays from the tracks), or any plugin effect.
- **Send to it**: every track's Inspector has a slider for each return under the sends (and **+ Send to a new return**), each track's Mixer strip has one too, and the track menu has **Send to “Return name”** and **Stop sending**. **pre** takes the send before the track's fader, so the return keeps going as the track fades (or is turned all the way down); otherwise the send follows the fader.
- A return has a fader, pan, every insert, plugin effects, mute and automation like any track, and can play into a bus. It shows **return · N** (how many tracks send to it). Returns are solo-safe: soloing a track keeps the returns playing, so you hear it with its reverb.
- Send levels can be automated (pick **Send → Return name** in a track's automation LANE). Deleting a return removes the sends to it (Undo brings them back). Exports, stems and freezing play through returns as you hear them; a frozen track still feeds its returns live.

### The Track Inspector (FX Rack)

Click **FX Rack** in the toolbar, or the sliders icon on a track header (or **Track › Inspector & FX rack**), to open the Inspector on the right. Click another track's header to switch to it. The **Track FX** tab, top to bottom:

- **SOUND GENERATOR**: the track's instrument. Changing it renames and recolours the track but keeps its clips.
- **PAN** and **DIST** (at the top, under the volume): **DIST** sets how far back on the stage the track sits, from **Front** (as recorded, up close) to 100% (the back of the hall). Further back, a part is a little darker, a little quieter and more of it reaches the reverb, as a far instrument sounds in a real room. New orchestral tracks take their usual seat in an orchestra, seen from the audience: first violins to the left, cellos and basses to the right, woodwinds in the middle behind the strings, horns behind them on the left, trumpets, trombones and tuba to the right at the back, timpani at the very back (double-click DIST to put a track back in its seat). Band instruments, synths and your own sounds start up front.
- **HUMAN**: makes the track sound played rather than programmed. A real player never hits the same note quite the same way twice, so with Human on every note comes out a little different: **Timing** puts notes a few milliseconds either side of the beat (up to ±8 ms), **Dynamics** plays them a little softer or harder (up to ±30%), and **Pitch** leaves them a hair sharp or flat (up to ±12 cents, like a string player or a slightly loose guitar; only on instruments that play pitches, so drum kits don't show it). The notes of a chord land a hair apart, like fingers. Each note's variation is worked out from the note itself, so the song sounds the same every time you play it and in your exports, while no two notes are alike. Your notes aren't changed: switch it off and they play exactly as written. Start around 30 to 50% for a natural feel; turn Timing right up for a loose, laid-back one. (The piano roll's **Humanize** tool is different: it moves the notes themselves, once.) A new track on a recorded instrument starts with Human on at a player's feel for it: an orchestra's players a little loose in time and touch, a band's a little less, keyboards and mallets tighter, a drum kit tight in time with only its hits' strength varying. Synths start exact, as a machine plays.
- **DUCK OTHERS UNDER THIS**: for a track that stands in for the game's dialogue or sound effects (a voice line, placeholder effects). Switch it on and every other track dips by **Dip** (2 to 24 dB, 8 to start) wherever this track sounds: a moment before each note or audio clip (so the first syllable isn't masked), holding while it sounds, and back up 0.4 s after; gaps under about a third of a second are bridged. It follows the track's clips as you edit them, plays live and in every export, and isn't written as automation. Muting the proxy stops the ducking. The Mixer marks a proxy track **PROXY**. (To dip under a reference video's own dialogue instead, use the speech bubble on the video lane.)
- **DISTORTION**: Drive, from clean at 0% through overdrive to fuzz at 100%. It's a pedal-style overdrive: the lows are tightened, the top is rolled off the harder you drive, and the level stays about the same, so turning it up changes the tone rather than the volume.
- **3-BAND PARAMETRIC EQ**: LOW (400 Hz), MID (1 kHz) and HIGH (2.5 kHz), each -24 to +12 dB. **Reset** flattens them.
- **PRO EQ**: a parametric EQ you draw. Up to six bands, each a **Low cut**, **Low shelf**, **Bell**, **Notch**, **High shelf** or **High cut**. Drag a numbered dot sideways for its frequency and up or down for its gain (Shift: fine); the mouse wheel over the graph changes the selected band's width (Q); double-click empty space to add a band there; double-click a dot to switch it off or on; right-click a dot to remove it. Under the graph: the selected band's shape, frequency, gain and Q. The curve is exactly what the filters do, and while the song plays the track's own sound is drawn behind it, so you can see what you're cutting. **Open big** shows it in the **EQ & Dynamics** tab of the bottom panel. It starts flat, with a low shelf, two bells and a high shelf ready to drag (and a low cut and high cut, off).
- **COMPRESSOR**: Threshold, Ratio and Makeup gain.
- **MULTIBAND**: a compressor in three bands, **Low**, **Mid** and **High**, split at **Low / mid** and **Mid / high** (the bands add back up exactly, so with nothing squeezing the sound is unchanged). Each band has its own **Threshold**, **Ratio** and **Gain**, or **bypass**; **Attack** and **Release** are shared. Meters show how much each band is turning down. Tame a boomy low end without dulling the top, or squash a harsh top only when it gets loud. (The Master's **OTT** is a ready-made multiband for the whole mix.)
- **CHORUS**: Rate, Depth and Mix.
- **LO-FI**: **Crush** rounds the sound to fewer bits (16-bit is clean, 3-bit a buzzy 8-bit crunch), **Tone** darkens the top (1 to 20 kHz), **Wow** wobbles the pitch slowly like a worn tape, and **Mix** blends it with the clean sound. For lo-fi keys, dusty drums, chiptune grit and phonk.
- **FILTER**: **Low-pass**, **High-pass** or **Band-pass**; **Cutoff** (20 Hz to 20 kHz); **Resonance** (Q 0.5 to 15: high values boost a narrow band at the cutoff, up to about +23 dB, so turn the track down when you push it); **Slope** 12 or 24 dB. It comes after the other effects, so it sweeps everything on the track. Moving Cutoff or Resonance while playing glides smoothly.
- **DELAY**: echoes in time with the song. **Time** is a note value (1/32 to 1/2, dotted and triplet ones too) of the tempo; **ping-pong** bounces the echoes left and right; **Feedback** (how many repeats), **Tone** (darkens each repeat) and **Mix**.
- **REVERB**: a room of the track's own (apart from the shared master reverb): **Decay** (0.3 s for a small room to 12 s for a huge hall), **Pre-delay** (a gap before the room answers, which keeps a voice clear), **Tone** (darker is warmer) and **Mix**. On a return track, run it at 100% mix.
- **GATE**: chops the track's volume in time with the song (a trance gate, or a stutter before a drop). **Rate** 1/8, 1/8T, 1/16, 1/16T or 1/32; **Depth** (how far it closes: 100% is silent between chops); **Length** (how much of each step it stays open). The chops line up with bar 1, in playback and exports alike. Try it on a held pad or supersaw chord.
- **PUMP**: sidechain-style ducking. The track's volume dips and swells back on every **Kick** (any drum-kit track's kick that is actually playing), every **Beat**, every **1/8**, or every note of a **Track** you pick under **Follows** (a sidechain from any part: duck the pads under the bass, or the chords under a lead; the followed track can even be muted, as a silent trigger). **Depth** (how far it ducks) and **Release** (50 to 600 ms, how long it takes to come back). A muted or soloed-out kick track doesn't pump, so if you solo the pumped track, solo the drums too.
- **POST-FADER AUX SENDS**: how much of the track goes to the shared reverb and the ping-pong echo, and to each **return track** (see Return tracks), each before or after the fader.
- **CHANNEL FADER**: the same volume and pan as the header.
- **Delete this track** (also the trash icon at the top). It asks first if the track has clips; `Ctrl+Z` brings the track and its clips back.

Human, Distortion, Pro EQ, Compressor, Multiband, Chorus, Lo-fi, Filter, Delay, Reverb, Gate and Pump each have an **ON / OFF** switch and start off. An effect that's off is taken out of the sound completely, so it costs nothing. You can switch effects on and off while the song plays without a gap, a click or a doubled sound, however busy the computer is: the change crossfades over 10 ms, about 20 to 30 ms after the click. A Compressor switched on comes in about 0.2 s later, once it has settled, and any other switch on that track in the meantime waits for it. A compressor holds the sound back by a few milliseconds (it looks ahead), so while any track, bus or return has a Compressor or Multiband on (or plays an electric guitar amp), the other tracks are held back by the same amount and everything stays in time: a compressed kick still lands with the bass. When that amount changes while the song plays, the other tracks slide to it over about a second, too gently to hear, so a held bass note doesn't dip. Playback then runs those few milliseconds later, recording allows for it, and exports start exactly on time. Turning a control while the song plays glides to the new value in a few milliseconds, so mute, solo and dragged sliders don't click. The EQ is on whenever any band isn't at 0 dB. Double-click a Drive, EQ, Compressor or Chorus slider to reset it to its starting value (EQ bands go back to 0 dB); the send, reverb and delay sliders don't reset on double-click (the master OTT and Stereo Width sliders do).

### Master

The Inspector's second tab, **Master**, works on the whole mix. At the top:

- **Loudness**: how loud the song is, measured the way streaming services measure it (LUFS). **Now (3 s)** is the last three seconds, **Since Play** the whole stretch since you last pressed Play, and **Peak** the highest true peak (dBTP). A line under them says what the level means: quiet, about streaming level (around -14 LUFS), loud like a club master, or very loud. The peak turns red above -1 dBTP, where a song can distort once a streaming service converts it. **Reset** starts measuring again. The header shows the **Now** reading too, from the moment audio is running, and turns red with the peak.
- **Glue**: the master compressor that holds the whole mix together, in five styles. **Standard** (how every song sounded before there was a choice), **Gentle** (barely touches it: acoustic, orchestral, jazz), **Punchy** (a slower attack lets each drum hit through before it holds the rest: rock, hip-hop, pop), **Tight** (firm and loud: dubstep, EDM, drum and bass) or **Off**. The starters pick one for their genre.
- **OTT**: the multiband compressor of bass music. It splits the mix into lows, mids and highs, turns each band's loud parts down and its quiet parts up, and adds back the level it takes, so the mix gets denser, brighter and louder. **Depth** is how much (start around 20 to 40%), **Time** how fast it reacts (snappy to slow), **In gain** drives it harder and **Out gain** turns the result up or down.
- **Stereo Width**: makes the mix wider (up to 200%) or narrower (0% is mono). **Keep the bass in the middle** (on by default) leaves everything below about 120 Hz centred however wide the rest goes, so the low end stays strong on club systems and phones.
- **Level**: turns the whole mix up or down (-24 to +12 dB) after the OTT and Stereo Width, just before the limiter. Turning it up pushes the mix into the limiter, which is how you make a master louder; the limiter keeps the peaks down. It works whether the OTT is on or off. Double-click it to go back to 0 dB.

- **Playback**: how this browser buffers live audio. **Responsive** (the default) has the least delay between a key you play and its sound. **Stable** gives the audio a bigger buffer and more time to schedule notes, so busy moments in big songs play through instead of crackling; Play then starts about a quarter of a second later, and live playing has a few hundredths of a second more delay. It's a setting for this browser, not the project, and takes effect after a reload (the panel offers one; your work is kept, click **Restore** after it). Below the choice, **Delay from a key to sound** is the delay the browser measures between a note leaving the app and you hearing it (its audio buffer and your sound device), in milliseconds; keys you play, from a MIDI keyboard, the computer keyboard or the screen, start at once, so this is the delay you feel. Some browsers don't report it.
- **Instruments offline**: recordings are kept in this browser once an instrument has downloaded them, so a song opens at once the next time and the instruments you've used work without an internet connection. The panel shows how many are kept. **Download all** fetches every instrument's recordings now (about 320 MB, a few minutes on a fast connection) so they all work offline: a bar shows the progress and **Stop** pauses it (what's done is kept; **Download all** carries on from there). **Remove** frees the space; instruments download their recordings again when next used.

OTT and Stereo Width sit between the master compressor and the limiter, are off in a new project, are saved with it, can be undone, and switch on or off while the song plays without a gap. The Level (0 dB in a new project) is saved and undone the same way. All three are in exports too.

The **limiter** at the very end looks 5 ms ahead and keeps the true peak (including the peaks between samples that a converter or an MP3 encoder rebuilds) under -1 dBTP, live and in every export. It turns down smoothly before a peak arrives instead of clipping it, and holds its gain through a bass note's cycles, so loud drops stay clean instead of crackling or pumping.

Under them are the two effects every track shares through its sends:

- **Master Reverb**: Room Decay Time, from 0.8 s (tight) to 12 s. Changing it, or the room, while the song plays never cuts off what's already ringing: the new room takes over smoothly, and the long rooms ring all the way down to silence. **Room** picks the kind of space it is: **Concert hall** (warm and wide, its lows ringing a little longer), **Chamber** (a smaller room: close, clear, a quick bloom), **Church** (stone and height: long, dark, slow to bloom), **Studio room** (short, tight and natural, for drums and bands), **Plate** (dense, bright and smooth at once, for vocals and snares) or **Lush** (a smooth, dense tail that shimmers gently, with no hard echoes, for pads, ballads and ambient). Each of the first five is built the way a real room answers: a few distinct early reflections off the nearest walls, then a tail whose highs die sooner than its lows, and different in each ear. **Lush** is made differently: instead of a room's answer worked out in advance, a set of echoes feeding each other makes the tail as it plays, so it takes far less of the computer's power, even with a long decay, and none when nothing is playing: a good pick for long tails on a slower computer. It's about as loud as the concert hall at the same decay, so switching between them keeps the mix in balance, and it fades over without a gap. (If your browser can't run it, the concert hall plays in its place.) The starters pick one for their genre. One click picks a space: **Room** (1 s), **Studio** (1.8 s), **Hall** (3.2 s, for an orchestra), **Cathedral** (7 s, for choir and organ) or **Heaven** (11 s, for angelic pads and ambient). **Use a recorded room…** loads a recording of a real space instead (an impulse response: a WAV of a clap or sweep dying away in a hall, church or studio; free ones are shared online, often under Creative Commons, so credit the recordist as their licence asks). The reverb then sounds like that room, its tail as long as the recording (up to 12 s), and the recording is saved inside the project file. The **×** next to its name goes back to the generated hall.
- **Ping-Pong Echo Delay**: Echo Subdivision (1/4, 1/8, dotted 1/8 or 1/16, locked to the tempo) and Echo Feedback (0 to 80%).

### Tempo, swing and master volume

In the header:

- **TEMPO**: the song's starting tempo (tempo changes later in the song are on the ruler: see Tempo changes and time signatures). Click the number to type a tempo from 40 to 240 BPM, with up to two decimals (`115.25`); Enter sets it, Esc cancels. `-` and `+` change it by 1 BPM, and the slider moves in whole BPM. **TAP** sets it from your clicks: tap at least twice; it averages your last few taps and starts over if you pause for more than 2.5 seconds.
- **FIT**: sets the tempo so part of the song lasts a given time. Choose **Loop In→Out**, **Whole song** or a number of **Bars**, then type the **Target length** in seconds (`25.5`) or as a timecode (`0:25:00`). It shows the new tempo and the resulting length as you type; **Apply** (or Enter) sets it, to 0.01 BPM, picked so the part ends in the frame you typed. Over long stretches at slow tempos it can land a frame either side, and the panel shows the exact result first.
- **SWING**: delays the off-beat 16th notes (the second 16th of each 8th) for a shuffled feel, from 0 to 50%; at 50% they land on the 1/8-triplet line. Downbeats, 8ths, triplets and 1/32 notes stay on the grid. In an 8th where a clip has a 1/32 roll or triplets, that clip plays the whole 8th straight, so rolls stay even (other clips keep swinging). A clip moved off the 16th grid (Shift-drag, Frame snap) swings on its own 16ths. A clip cut off the grid (the razor with Shift, Snap Off or Frame snap, a start trimmed off the grid, or Insert bars at an off-grid point) keeps the swing it had: its notes go on swinging on the song's 16ths. New blank projects start at 20% (the demo song uses 15%). Double-click it for 0% (straight).
- **MASTER**: the final output level (-30 to +6 dB). It also sets the export level, but it isn't saved with the project.

Every track goes through a master compressor and a limiter that holds peaks just under full scale, so at MASTER 0 dB or lower playback never clips and sounds the same as your exports. MASTER is applied after the limiter, so above 0 dB playback can clip (exports are turned down to fit).

**FEEL** (in the piano roll's toolbar) gives one clip its own swing instead of the song's: **Straight**, **Swing 8ths** (light, a triplet shuffle, or a hard dotted lilt: jigs, shuffles, big band) or **Swing 16ths**. It plays the same in playback, exports and the game kit.

Mixer and effect changes, tempo changes and time signatures can be undone with `Ctrl+Z`; the starting tempo, swing and master volume can't.

### When playback lags: the performance badge and Clear memory

While the song plays, the app watches for three signs that the computer isn't keeping up: notes reaching the sound engine too late, the page freezing for a moment, and the sound engine itself falling behind (it can't make the sound as fast as it plays, which you hear as crackles). A few of the first two in a few seconds, or the engine running behind, turns the badge in the header (next to LUFS) into an amber **LAG**, and a warning appears at the top with **Clear memory**. Close the warning with **×** (it stays away until you next press Play). When all is well the badge shows how much memory the page is using (in Chrome).

**Clear memory** (in the warning, or from the badge at any time) lets go of what the app holds but isn't using: downloaded recordings of instruments no track plays, decoded sounds no clip uses, the instrument menu's preview players, and any notes left hanging. Everything comes back by itself if needed (an instrument re-downloads when you use it again). Tick **Also empty the undo history** to free the most on a long session, but then earlier edits can't be undone.

The app also steps in by itself. At the first late note or freeze of a playback, it hands notes to the sound engine further ahead of time (0.4 s instead of 0.1 s) until you press Stop, so the next busy moment is absorbed instead of heard; once a playback has needed that, later ones start with it. The only cost is that a fader, a mute or a jump you make while it plays takes a moment longer to be heard; playing your keyboard or MIDI keyboard isn't affected. And while it lags, the meters and the spectrum draw less often, to leave the computer's time to the music.

If you press Play while instruments are still downloading their recordings (a song just opened), the Play button spins until they're in (ten seconds at most; click it to cancel), so the song doesn't start with them missing.

Big songs also get help without asking. While a song plays, a track with nothing to play for a while rests: it's switched off until just before its next note, so thirty tracks waiting for their entry don't cost what thirty playing ones do (an orchestral test song needed about a third less of the sound engine). Tracks scrolled out of sight in the timeline and the mixer aren't drawn, and the spectrum moves at half speed in songs with more than 16 tracks. The badge's details show **Notes sent ahead: further** while this is on.

Click the badge for the details, including **Audio engine speed** while playing (100% is keeping up). When the engine is what's behind, the warning offers **Use Stable playback** directly; it takes effect after a reload. If playback lags a second time in a session even after notes are sent further ahead, the app switches to Stable playback for next time by itself and tells you so, unless you chose a Playback setting yourself (then yours is kept).

Recordings of instruments no track (stinger or costume) has used for three minutes are let go while the song is stopped, so trying many instruments in a long session doesn't fill the memory; they download again (from this browser's store, at once) if you use them again.

If it still lags: **Freeze** the busiest tracks (below), turn on **Stable playback** (Master tab › Playback), and close other tabs and programs. **Auto-freeze** (below) does most of the freezing for you.

### Freezing tracks

Big songs can ask more of the computer than it has, and playback starts to crackle or skip. **Freezing** a track fixes that: click the snowflake in its header and the app renders the track's instrument, effects and EQ to audio once (a second or two), then plays that recording instead. A frozen track costs about as much as one audio clip: on a 36-track test song, freezing everything cut the playback work to about a quarter.

- A frozen track's snowflake is lit. Its **volume**, **pan** and **sends** (and their automation) stay live, so you can keep mixing it.
- Change anything that went into the recording, such as its notes, instrument, effects, EQ, filter automation, the tempo or the swing, and the freeze is out of date: the snowflake turns amber and the track plays live again, so you always hear the real thing. Click the snowflake to freeze it again. Undo the change and it's frozen again.
- A track's Pump that follows the kick is frozen ducking to the drum tracks that were sounding. Mute those drums, or solo another track, and it plays live until you put them back.
- An armed track plays live while it's armed, so you hear what you play into it.
- Click a lit snowflake to unfreeze. Freezing and unfreezing can be undone.
- Exports always render every track from its instrument, frozen or not, so they sound exactly the same either way.
- The frozen audio stays in this browser (about 10 MB per minute of track in storage, and about 20 MB per minute in memory while the project is open). It isn't saved inside project files: open the project in another browser and frozen tracks play live until you freeze them again. **Free unused** in the sound panels keeps the frozen audio of this project and your last session.
- Audio tracks can't be frozen: they already play recordings.

**Auto-freeze** does this for you in big songs. Once a song has 6 or more instrument tracks, the tracks you haven't changed for a few seconds are frozen in the background while the song is stopped (never while it plays, so nothing changes under you). Their snowflake shows a faint ring. Change one and it plays live again at once, then is frozen again a few seconds after you leave it alone. On a five-song test mix it cut the playback work by more than half.

- Auto-frozen audio is kept in memory only, never in the project or the browser's storage, and stops at a limit set by the computer's memory (the busiest tracks go first). A track too long to fit is left live. A freeze already under way pauses while the song plays.
- Click a ringed snowflake to freeze that track for good (a normal freeze).
- Turn it off in **Master tab › Playback › Auto-freeze big songs**; it shows how many tracks are frozen and the memory they use. It's a setting for this browser, on by default.

### Bounce in place

Right-click a track's name and choose **Bounce in place** (or **Track ▸ Bounce in place**) to turn it into audio for good: its instrument, inserts and EQ are rendered to one audio clip on a new Audio track right under it. The new track takes over the original's volume, pan, sends, output and their automation, so the mix sounds the same. The original is muted and kept, so you can go back to it. Unlike freezing, the bounce is an ordinary audio clip: cut it, reverse it, warp it, chop it into the Slicer. One Undo step undoes it all.

## Clip launcher

The **Launcher** tab of the dock is a grid of loops: a column for every track and a row for every **scene**. Click a clip to launch it: it starts on the next bar line and loops, in place of the track's arrangement. Launch something else on the same track and it takes over at the next bar line; a pulsing clip is waiting for its turn. This is for jamming, trying sections against each other, and building an arrangement live.

- **Fill the grid**: **Scenes from song** turns each section of the song (between its markers, or every 4 or 8 bars) into a scene. **Send selected clips** (or right-click clips, **Send to launcher**) puts the selected clips into each track's first empty slot. Drag a clip to another slot to move it, Alt-drag to copy it, and hover it for **×** to delete it.
- **Launch a scene** with the ▶ at the start of its row: every track plays its clip in that row, and a track with nothing there stops.
- **Stop** a track with the ■ in its column header (or click an empty slot); **Stop all** stops every clip. **Back to arrangement** lets every track play its arrangement again from the next bar line.
- **Launch on**: launches land on the next beat, half bar, bar (the usual), 2 bars or 4 bars.
- With nothing playing, launching starts playback from the bar the playhead is in. While the launcher is in use the song doesn't loop. Stopping playback ends the session, and the song plays its arrangement again.
- **Write to arrangement** writes what you played, from your first launch to where you stopped, into the timeline (one Undo step): where a track played a slot, copies of its clip; where it was stopped, nothing. So you can jam a song together and then edit it.
- The launcher's clips are saved with the project and undo like everything else. Moving the playhead back before your first launch plays the arrangement until it gets there.

## Automation

Automation makes a track setting change over the song: a filter opening during a build-up, a fade-out, a pan sweep, an echo on one word. You draw a line, and the setting follows it every time the song plays and in every export.

### Opening a lane

Click the **curve button** in a track header ("Show automation"; it's tinted amber when the track has automation). The track's lane switches to **automation view**: its clips are dimmed and can't be edited there, and the header shows **LANE**, the number of points and the value at the playhead. Use **LANE** to pick the setting. Almost anything can be automated:

- **Track**: Volume, Pan, Filter Cutoff, Filter Resonance, Reverb Send, Delay Send, EQ Low, EQ Mid, EQ High.
- **Sends**: the send to each return track.
- **Effects**: every continuous setting of the inserts: Distortion drive, Compressor threshold, ratio and makeup, Chorus rate, depth and mix, Lo-fi tone, wow and mix, Delay feedback, tone and mix, Reverb pre-delay, tone and mix, Gate depth and length, Pump depth and release. A lane for an effect that's off is marked (off); drawing its first point switches the effect on.
- **Plugins**: each parameter of the track's plugins (instrument and effects), named as the plugin names them, over its whole range.

A ● marks settings that already have points. Click the curve button again to go back to the clips.

### Drawing

- Click empty space to add a point (time snaps to the SNAP grid; hold Shift for free time), or click the line to add a point on it.
- Drag a point to move it: time snaps, the value is free, and Shift during the drag stops snapping. Points can't pass their neighbours, but two can share a bar for an instant jump. Alt+drag leaves a copy behind.
- Drag the line between two points to move both up or down.
- **Alt+drag the line** between two points to bend it: up or down pulls its middle that way. A line that starts slow and rushes in at the end makes a build feel like it's taking off; one that falls away fast then settles makes a natural fade. A tooltip shows the bend. Right-click a line for **Bend: slow start**, **Bend: fast start** or **Straighten line**.
- Drag a box on empty space to select points (Shift or Ctrl adds). `Delete` deletes them; `Esc` clears the selection. Double-click or right-click a point to delete just that one.
- **Right-click the lane** for **Ramp up In → Out** and **Ramp down In → Out** (a one-click build-up or fade over the loop region), **Delete selected points**, **Clear lane** and **Remove lane**. Ramps go from silence to the fader level for Volume, 200 Hz to 20 kHz for Filter Cutoff, -24 dB to 0 dB for EQ, and bottom to top for the others.
- Every gesture is one undo step.

### How it plays

- Lanes run between their points in straight lines (or bent ones, as drawn); before the first point and after the last they hold that point's value. Volume works like a mixing fader (-60 dB silent to +6 dB; 0 dB is about 84% up); Cutoff (20 Hz to 20 kHz) and Resonance (Q 0.5 to 15) are logarithmic; Pan runs L100 to R100; sends 0 to 100%; EQ -24 to +12 dB.
- While a lane has points it owns that setting: its control shows **AUTO**, follows the lane and can't be moved (click **AUTO** to open the lane). Clear or remove the lane to get the control back.
- Filter lanes only sound while the track's **Filter** is on. Drawing a Filter lane's first point turns it on; if you switch the Filter off later, the lane is kept, dimmed, with a **Turn filter on** button.
- Exports (mixdown and stems) follow lanes to within a millisecond. While playing, an edit, seek or undo is heard on the new line within about a tenth of a second; jumps glide over 4 ms so they don't click.
- Insert and Delete bars on the ruler move points with the music, deleting a track deletes its lanes (Undo brings them back), and lanes are saved with the project.

### MIDI learn: knobs and faders, and writing automation

Any setting a lane can drive can also be moved by a knob or fader on a MIDI controller:

1. Open the track's automation and pick the setting in **LANE**.
2. Click **MIDI** beside it (it pulses), then move a knob or fader on your controller. The button now shows its number (**CC74** and so on).
3. Moving that knob now moves the setting, over its whole range. Each burst of movement is one Undo step.

Right-click the button to forget the knob (or use the list in the MIDI popover, which shows every mapping). A knob moves one setting; learning it for another moves it there. Mappings are saved with the project.

**Write automation**: switch on **W** (beside the MIDI button, or **Write automation from knobs while playing** in the MIDI popover). While the song plays, moving a mapped knob writes its setting's lane at the playhead, replacing what the lane had there, so you can perform a filter sweep or a fade and keep it. Stop playing (or switch W off) to just move the setting again.

## Projects: saving and opening

The project's name, **Save**, **Export** and **Share** sit at the right of the menu bar; **New** and **Open** are in the **File** menu.

- **Project name**: click it to rename. It's used for the file names when you save and export.
- **New**: start a **Blank timeline** (four empty tracks), load the **Demo song** (Sunset Stroll, 88 BPM), or start from one of 76 **starters**. They're folded into groups: click a group to open it, or type in **Find a starter** (a name, a mood, a tempo: *boss*, *cozy*, *140*, *minor*). The groups are **Game Worlds** (Overworld Adventure, Dungeon Crawl, Cozy Village, Space Station, Racing, Platformer, Open Field, Cosmic Waltz, Big Band City, Quiet World, Wild Field, Underwater Waltz, Desert Bazaar, Fog Town), **Game Moments** (Boss Fight, Stealth, Title Screen, Puzzle, Shop, RPG Battle, Countdown Town, Save Room, Cathedral Boss, Arena Metal), **Anime & Cartoon** (Starlit City, Farewell Piano, Sunset Drive, Midnight Caper, Velvet Infiltration, Wanderer's Road, Meadow Waltz, Champion's Showdown, Ruin Requiem, Neon Ritual: story sounds, each game-ready with two states), **Electronic** (Formula Rush, Dubstep, House, Trance, Drum & Bass, Synthwave, Chiptune), **Artcore & Rhythm Games** (Final Boss Artcore, Melodic Hardcore, Breakcore), **Bass Music** (Metal Dubstep, Melodic Dubstep, Riddim, Kawaii Future Bass), **Orchestral & Choir** (Classical, Angelic, Cinematic, Epic Orchestral, Horror), **Hip-Hop & Phonk** (Drift Phonk, UK Drill, Hyper Trap, Neo-Soul), **Pop & Jazz** (Bedroom Pop, Bossa Jazz-Pop, City Pop, Theatrical Pop), **Band** (Rock, Metal, Pop, Funk, Jazz, Hip-Hop, Trap, Rap-Rock, Math Rock) and **Chill & World** (Lo-Fi, Ambient, Celtic, Fantasy Tavern, Latin, Eastern). The newer starters keep the low end gentle: kicks below full force, soft impacts and no sub drops, and builds that get quieter before the drop instead of louder drops. Each starter is 16 bars or so with its sections marked (intro, build, drop, and so on), the loop around the whole song (so Play goes from the start to the end, then round again; drag the loop's In and Out on the ruler to repeat just one part), their held strings, pads and voices swelling with each phrase, solo violin and cello lines played legato (sliding between notes) and long held melodies given vibrato where the style suits, and the slow orchestral pieces (Classical, Angelic, Cinematic) breathing at their phrase ends, its tracks mixed and the master's OTT and Stereo Width set for the style, and its level set for its kind of music on the master's **Level** (about -14 LUFS for most, a dB louder for band and rhythm-game music, a dB quieter for orchestral, game, cartoon and chill pieces, and about -19 for the gentle ones: Ambient, Title Screen, Save Room, Quiet World), so switching between starters doesn't jump in loudness. Change anything; it's an ordinary project. This replaces what's on screen and clears undo (the song it replaces is offered back by the Restore banner).
  - **Game starters are ready to wire into a game.** Each section is a game state that loops on its own (Explore and Danger, Sneak and Spotted, Phase 1, Phase 2 and Defeated...); the tracks are in stem groups (Ambient, Percussion, Tension, Climax), so the **Intensity** slider builds the music up and down; the **transitions** between states are set (a fill into a fight, a crossfade back out, a riser into the final lap, a victory stinger when the boss falls); and **stingers** in the song's key are made (item, level up, victory, game over...). Open the **Game** tab to try it: click the states, move Intensity, play the stingers. Then export it as a game kit, for FMOD or Wwise, or as stems.
- **Open** (`Ctrl+O`): load a `.fledgetone.json` project file. Like New, it replaces what's on screen straight away and clears undo (the Restore banner offers the replaced song back). If the file can't be read, a red message explains why and nothing is replaced. You can also drop a `.fledgetone.json` file anywhere on the page: a drop onto an empty timeline opens it at once, and when there's work on the timeline a dialog asks before replacing it.
- **Share**: three ways to send the song to someone:
  - **A link to this song**: the whole song travels inside the link (nothing is uploaded anywhere), and opening it opens the song in Fledgetone, ready to play and change. **Copy link**, or **Share…** for your device's share menu. Sound files (audio clips, Sampler and Slicer sounds) can't go in a link, so the dialog says which tracks would be silent; frozen tracks just play live. Links are packed tight (less than half the length they used to be), but a very long one can be cut off by some chat apps: the dialog warns when it's long. Links made before still open.
  - **The song as an MP3**: the whole song mixed, handed to your share menu where the browser can (phones, Windows, Safari on a Mac), or downloaded.
  - **The project file**: everything, sound files included, shared or downloaded the same way.

  Opening a shared link on a page that already has work on its timeline asks first.
- **Save** (`Ctrl+S`): the first time, choose the folder and the file name; after that, Save writes straight back to that same file, as a desktop DAW does (the Save button's tooltip names it). A project you opened with **Open** saves back to the file it came from.
- **Save As…** (`Ctrl+Shift+S`, in the **File** menu): save to another folder or under another name (a copy, a version); from then on, Save writes there. The picker opens in the folder you last saved a project to.
- Choosing where to save needs Chrome or Edge on a computer. Other browsers (Safari, Firefox, phones) save the file to their downloads folder instead.
- **New**, a shared link or **Restore** starts a song that isn't that file: its first Save asks where again, so nothing overwrites the file by mistake.
- Keep your project files: they're the only way to move a project to another browser or computer.

A project file holds the tracks, clips, mixer and effect settings, tempo, swing, loop, markers, master reverb and delay, the master's OTT and Stereo Width, frame rate, and every sound it uses (audio clips, Slicer and Sampler sounds). It doesn't hold the master volume, zoom, snap or ruler setting.

Whether it comes from **New**, **Open** or **Restore**, a project opens showing the start of the timeline, with the playhead at its loop's In point; if that's off the first screen, the view scrolls to it instead. It never keeps the previous project's scroll position.

### Autosave

The app also saves your work in this browser half a second after every change. The project bar shows **Saved in this browser · <time>**. Next time you open the app, a banner offers to **Restore** it.

- At startup the app sets your last session aside. The banner stays across reloads until you click **Restore** (which replaces what's on screen) or **Dismiss**. Only the most recent session with clips or markers is kept: if you make something else and reload, the banner offers that one instead. The banner says how many clips it has (or markers, when it has no clips yet) and when it was saved.
- If autosave fails, the project bar says why in red: the project is too big for browser storage (about 5 MB per site, usually because of big Sampler sounds), storage is full (Dismiss the old session to make room), or the browser blocks storage for this site. While it's failing, closing or reloading the tab asks first, so you can **Save**.
- Autosave is per browser and per site, and private windows don't keep it. Use **Save** for anything you care about.

## Playing a MIDI keyboard

Click the **MIDI** button (the keyboard icon) in the toolbar, then **Connect MIDI devices**. Chrome and Edge connect at once; Firefox asks for permission first; Safari has no MIDI support (use the computer keyboard piano instead). The app reconnects by itself next time.

- **Input** picks one device or **All inputs**. The light and readout show the last thing played.
- Your playing goes to the **armed** track if one is armed, otherwise the **selected** track, through its instrument, mixer and effects, so you hear what you'll record.
- Velocity, note-off, the sustain pedal and all-notes-off work on every instrument. The pitch bend wheel (±2 semitones) works on the recorded instruments, Slap Bass, Sub Bass, 808, Lead, Space Clav, Brass Stabs, Pad and plugin instruments. When you record, the bend and mod wheels go into the clip's **Pitch bend** and **Mod wheel (dynamics)** lanes (see Expression lanes), and the sustain pedal into how long the notes ring.
- On a drum kit, the standard General MIDI drum pads (kick 36, snare 38, hats 42 and 46) play the kit's sounds.
- **Knobs and faders** move the settings you map them to (see MIDI learn, under Automation). Knobs that aren't mapped go to plugin instruments as MIDI, and when recording go into the clip's controller lanes.
- **MPE keyboards** (each note on its own channel, with its own bend and pressure): tick **MPE keyboard** in the MIDI popover. A note's own bend (±48 semitones, the MPE standard) and pressure then move only that note, and recording puts them into the note (its Note bend and Note pressure lanes). The Multi Sampler plays them per note; other instruments bend as a whole.

### The computer keyboard as a piano

In the MIDI popover, tick **Computer keyboard piano**. `A` `S` `D` `F` `G` `H` `J` `K` `L` `;` `'` are the white keys from C, `W` `E` `T` `Y` `U` `O` `P` the black keys, and `Z` / `X` move an octave down or up. Notes play at a fixed velocity. While it's on, those keys play notes instead of their usual jobs (`L`, `O`); Space and the other shortcuts still work. It's off by default.

## Recording

### Recording from a microphone

Click **Mic** in the toolbar to record your voice, a guitar, or anything on your computer's audio input. The browser asks for permission the first time. Playback starts from the playhead as you click it, so you can sing or play along; the button turns into **Stop** with a level meter. Click **Stop** and the take goes onto the selected Audio track (or a new one) exactly where you played it: the delays of the speakers and the mic are taken off, so it lines up with the beat. The take is saved in the sound library like a dropped sound file, so it can be trimmed, faded, chopped to the Slicer, frozen and exported.

The input isn't played through the speakers while you record (no feedback); use headphones to hear the music. Microphone access needs a secure page (the published site, on https).

To **resample** (record a part, then mangle it), export the part as a WAV and drop it back onto a lane, or right-click an audio clip for **Chop to Slicer…**.

1. Arm a track with **R** on its header (one track at a time; Audio tracks can't be armed).
2. Switch **Record** on (the red circle in the toolbar).
3. Press **Play**. With the **1-bar count-in** on (the default) you hear four clicks first, then the music and the take start together.
4. Play. Notes are placed where you heard them against the music, with their velocity and length.
5. **Pause**, **Stop** or switching Record off ends the take. It becomes a clip named **Take 1**, **Take 2** and so on, on whole bars. Switching Record on while playing starts a take right there.

- **Undo** removes the whole take in one step. With **Quantize** on, the notes are snapped when you stop, as a second step: the first `Ctrl+Z` puts them back where you played them, the second removes the take.
- **Loop recording**: with the loop on, every pass adds to the same take, so you can build a part up pass by pass. Or tick **Loop passes are takes** to keep each pass as a take of its own and pick the best afterwards (see Takes and comping).
- Takes are ordinary clips: swing, editing, Insert/Delete bars and export work on them like any other.
- **Recording settings** (the arrow next to Record): **1-bar count-in**, **Quantize** (Off, 1/16, 1/8 or 1/16T), **Metronome while playing**, **Loop passes are takes**, **Punch in / out** and **Click level**. These are kept in your browser, not in the project.

### Punch in and out

Punch replaces just one part: play along from earlier to get the feel, and only what you play between the punch **In** and **Out** is kept.

- Tick **Punch in / out** in the recording settings and type its **In** and **Out** bars, or press **= loop** to punch over the loop. Or right-click the ruler: **Punch in here** and **Punch out here** (each switches punch on).
- The punch range shows as a red bar along the bottom of the ruler.
- A MIDI take keeps the notes that start inside the range, cut off at the Out, and its clip is exactly the range. A mic recording is cut to the range too.
- With **Loop passes are takes** on, punching over the same range again adds a take each time, so you can try a fill as often as you like.

### Takes and comping

With **Loop passes are takes** ticked, recording round the loop keeps each pass as a separate take in one clip (a **take folder**), and recording over a clip of exactly the same span (the same punch range, or the loop again) adds takes to it. This works for MIDI and for the microphone. The newest take plays at first; the clip shows **NT** (N takes) by its name.

Click **NT**, or right-click the clip and choose **Takes (N)…**, to **comp**: build the part from the best bits of each take.

- Each take is a row (notes or waveform). The lit stretch of each row is what plays; the rest is shaded.
- **Drag along a take** to use it there; it snaps to beats (Shift for 16ths). A click uses that beat.
- Click a take's **name** to use it all the way through. The bin deletes a take.
- **Flatten** keeps what the comp plays as an ordinary clip and drops the other takes. (A mic comp made of several takes stays as the take it starts with when flattened: to keep a mixed comp, leave it as a folder.)
- Where a mic comp changes take, the two blend over 10 ms, so the joins don't click.
- Each change is one Undo step. Take folders save with the project, split and trim like any clip, and play the comp live and in every export. Editing a MIDI folder's notes in the piano roll works as usual, but the next comp change rebuilds the notes from the takes.

### Metronome

The **metronome** button in the toolbar clicks on every beat while playing, louder on beat 1 of each bar. It follows the tempo, ignores swing, and is never in an exported WAV. It clicks in time with the music as you hear it, allowing for the few milliseconds the master section and any compressors hold the music back. The count-in clicks even when the metronome is off.

## Exporting audio

Click **Export**. The dialog has four choices, and remembers them in this browser:

- **Range**: **Whole song** (bar 1 to the end of the last clip that plays), **Loop region** (In to Out, whether or not the loop is on), or **Intro + loop** (for games, below). For the loop, the dialog shows where it starts as a timecode at your frame rate.
- **Export**: **Mixdown** (one stereo WAV of everything that plays) or **Stems**. For a mixdown, **Match a loudness target** turns the whole file up or down to where it's going: **Streaming** (-14 LUFS: Spotify, YouTube, Apple Music, SoundCloud), **Loud: club and EDM** (-9 LUFS, as club music is mastered; streaming services turn it down to -14), **Games** (-16 LUFS, room for sound effects and voices), **Podcast and video voice-over** (-16 LUFS) or **TV and broadcast** (-23 LUFS, the European standard). If a quiet mix would need its peaks pushed past -1 dBTP to get there, a look-ahead limiter holds them down (up to 8 dB of it); beyond that the file stops short and the message says by how much (turn on the master **OTT** and raise its **Out gain** to get louder). A game's intro and loop are only turned up or down together, never limited, so the loop's seam stays seamless. When a mixdown finishes, its loudness and peak show at the bottom of the screen. **Stems** (one WAV per track that plays and has clips in the range, in one .zip). Stems all start at the range start and have the same length, so they line up in another program, and each includes the track's effects, sends and the shared reverb and echo. **Bypass master compressor & limiter** (on by default) makes the stems add up to the mix as it is before the master compressor and limiter.
- **Ending**:
  - **Ring out**: the range, then the release, reverb and echo tails ring out: the file ends once everything has died away (under -70 dBFS, at the file's level after any loudness match), after a second at least and at most as long as the reverb rings (the dialog says how long that can be).
  - **Exact length**: exactly the range, to the sample, with a 5 ms fade at the very end so it doesn't click.
  - **Seamless loop** (Loop region only): exactly one loop long, with the tails of the pass before already ringing at its start, so it repeats in a game engine or looping player without a gap or click. It stays exactly on the beat at any tempo, fractional ones included. As a WAV (the mixdown and every stem) it also carries **loop points** (a standard `smpl` chunk covering the whole file), which Godot, GameMaker, samplers and many Web Audio loaders read, so you don't have to set the loop by hand.
- **Format**: the **file type**: **WAV** (uncompressed and exact, the only one that holds markers and loop points), **MP3** (320 kb/s, plays everywhere) or **OGG** (Ogg Vorbis, about 256 kb/s, the best compressed format for games: Godot and Unity loop it without a gap). Then **44.1 kHz** or **48 kHz** (the recorded instruments are prepared again at the rate you choose, so either is as clean as the other, whatever rate your sound card runs at), and for WAV **16-bit**, **24-bit** or **32-bit float**. A 16-bit file is dithered (a faint, steady hiss far below the music, instead of the grainy distortion rounding to 16 bits otherwise leaves on fades and reverb tails); digital silence stays silent. Always stereo. An MP3 can have a few milliseconds of silence added at its start by the format itself, so use OGG or WAV for anything that has to loop seamlessly. Compressing a file nudges its peaks up a little, so MP3, OGG and a video's sound keep their true peaks under -1.5 dBTP instead of -1, and still play back under -1.

A mixdown renders on several of your computer's processor cores at once where the browser allows it (Chrome and Edge do), so a big song exports up to two or three times faster. It sounds exactly the same: tracks whose sound only meets at the master are rendered side by side and added up before the master section. Tracks that play through a group bus or return with a Compressor, Distortion, Lo-fi, multiband compressor or a plugin on it are rendered together, and so are tracks with plugins. Stems render several at a time the same way, each on a core of its own. Exporting the same song again gives the same file, sample for sample: drums, risers and noisy synths vary from hit to hit, but the same way every time.

### Video (MP4)

Choose **Export: Video (MP4)** to turn the song (or the loop region) into a video for YouTube, socials or a game's trailer: 1280×720 at 30 frames a second, with the mix as its sound and a visualizer as its picture. It shows the project's name, a spectrum that moves with the music, the whole song's waveform with a playhead, the section you're in (from your markers) and the time. It's made faster than real time: a 30-second song takes about 20 seconds. **Visualizer style** draws the spectrum in any of the Mixer's spectrum styles (LED bars, Neon city, Grid terrain, Radar HUD, Data rain, Holo pigeons). **Normalize** sets it to -14 LUFS, the loudness YouTube plays at.

Videos need Chrome or Edge (or another browser with WebCodecs) on a site served over https. On Windows and Mac they're H.264 with AAC sound, which plays everywhere; where the browser doesn't have those, they're VP9 or AV1 with Opus sound, which browsers, VLC, YouTube and Discord play but some older players don't.

### Game preview: hear it the way the game will play it

The **Game** tab of the bottom panel is for rehearsing adaptive music, the kind that changes with what the player is doing:

- **States**: every section between your markers is a button (Intro, Explore, Combat, Boss...). Click one and the song moves there **on the next bar** (or next beat, or at once: the menu above them) and loops it, the way a game switches music. The playing state is green; a waiting one pulses amber.
- **Transitions** (click to open, under the states): a matrix of how each state hands over to each other one. Rows are the state you come **from** (and **Any**, for a rule that applies from every state unless that row has its own); columns are the state you go **to**. Click a cell and pick:
  - **Cut** (straight in), **Fill** (a snare fill over the beat before, on the song's own kit), **Riser** (over the bar before; the switch waits a bar if there isn't a whole one left), **Impact** (a hit on the new state's downbeat), **Crossfade** (the old state fades out as the new one fades in, over 1 to 16 beats), or **Stinger** (one of your stingers plays on the line, and the new state comes in after it: a 2-bar stinger bridges 2 bars), or **Bridge** (a bar or two written to lead into the new state, then the state).
  - **Bridge** writes the lead-in from your song: it looks at what the new state opens on and plays the chord that pulls hardest into it (its dominant seventh: G7 into C), with the bass stepping up into the new root and the drums filling the last beat. **2 bars** turns through the chord before that first (ii before a major chord, iv before a minor one). It plays on your song's own chord part, bass and drums, through its mix, in the new state's tempo and time signature. Change the song and the bridge follows.
  - **When**: on the next bar (the default), on the next beat, on the next **phrase** (every 2, 4 or 8 bars counted from the state's start, so the music turns where a phrase does), at the **end of the loop** (when the state comes round, or its shuffled piece ends), or at once.
  - A switch with no rule cuts on the next bar. Rules are saved with the project.
  - Switching states on the timeline plays the cuts, fills, risers, impacts, stinger bridges and written bridges (on preview instruments), and waits for the phrase or the loop's end; a crossfade needs two parts of the song at once, so there it cuts. **Audition like the game** (below) plays every rule exactly.
- **Intensity**: the music a game turns up as things get exciting. Give each track a **stem group** with the list beside it: **Ambient**, **Percussion**, **Tension**, **Climax** or **Other…** (any name); **Auto-assign** puts drums in Percussion, effects in Tension, leads in Climax and everything else in Ambient. Each group in use gets a **curve**: how loud its tracks play (up) at each intensity (across). Drag a point to move it, click empty space to add one, double-click a point to remove it; the dashed line is the intensity now. Then scrub **Intensity** (here, or next to Swing in the header) while the song plays: the groups crossfade along their curves, smoothly, the way the game's audio code will mix them. Tracks without a group always play at full level, and the on/off switches still mute a track outright.
  - The mixdown and video exports play at the Intensity you set; stems, layers and the game kit stay at full level, so the game can apply the curves itself (the curves go into the kit's files).
  - Stem groups, the curves and the intensity are saved with the project. Changing a track's group is an Undo step; moving the slider and the curves isn't.
- When it sounds right, export the sections with **Intro + loop** and the layers with **Layers** (below) for your game engine.

**Stingers** (at the bottom of the panel) are short cues a game plays over its music when something happens. Choose one from **+ Add a stinger…**: **Victory** (a fanfare), **Level up** (a rising arpeggio), **Item found**, **Checkpoint**, **Danger** (tense low pulses) or **Game over** (falling to a low minor chord). Each is written in the song's key, worked out from its notes and shown next to the heading, and plays at the song's tempo.

- Click a stinger to fire it over the music, the way the game will: on the next bar, the next beat or at once (the same choice as the states). It lights up when it plays.
- Pick its **instrument** from the list beside it. The dice makes **another version** (a different rhythm or register), written again in the song's current key, so after a key change or new chords it follows.
- The list button **puts it on the timeline** at the playhead, on a new track, as an ordinary clip you can edit in the piano roll.
- **Export stingers (.zip)** renders each one as a WAV through the song's master section, ringing out, ready for the game.
- Stingers are saved with the project. Adding, changing or deleting one isn't an Undo step (putting one on the timeline is).

**Loop variations** (under the stingers) export 2, 3 or 4 **takes** of the loop region, so a player who stays in one place doesn't hear the very same loop over and over: the game picks a different take each time round. **A** is the loop as written; **B** ends with a snare fill into the loop point, **C** with a tom fill, and **D** drops the hats for the first half with a kick pickup at the end (the fills go on the first drum track that plays through the loop's last beat). With **Human feel** ticked, tracks without the Human insert get a light one, so every take's timing and dynamics differ too. **Export** saves a .zip of seamless WAV loops (with loop points), all exactly the loop's length and at one level, so the game can switch takes at the loop point without a jump.

### Sound effects maker

The **Sound FX** tab of the bottom panel (or **Tools › Sound effects maker**, or search *sound effects*) makes the sounds games are full of: menus, hits, pickups, magic, footsteps, jingles and ambience loops. It has four parts: **Make a sound**, **Make a set**, **My sounds** and **In this game**.

**Make a sound.** Pick a group (**Retro**, **UI**, **Combat**, **Movement**, **Rewards**, **Magic & Sci-fi**, **Jingles**, **Loops**), then a kind of sound: **Click**, **Confirm**, **Error**, **Sword swing**, **Heavy impact**, **Footstep**, **Gem**, **Level up**, **Teleport**, **Victory**, **Rain** and about sixty more. Each click makes a new one of that kind and plays it. **Mutate** makes one like it but a little different; **Surprise me** any kind.

- **Layers.** A sound is up to four layers played together: a modern hit is a thump, a crack and a tail; a sword swing a whoosh and a ring. Each layer has its **Source** (square, saw, triangle, sine, 8-bit noise, soft noise, deep noise, FM, bell or crackle), its pitch (**Pitch**, **Slide** and its **Curve**, a **Jump** partway through, **Notes** to play in turn such as *0 4 7 12* for an arpeggio, **Vibrato**, **Repeat** for a warble), its loudness over time (**Attack**, **Hold**, **Punch**, **Decay**, **Tremolo**), a filter (**low-pass** or **band-pass**, **Cutoff**, **Resonance**, **Sweep**, **Wobble**, **High-pass**, **Crush**), and its **Level** and **Start** in the sound. **+ Layer** adds one; **Copy layer** copies the one you're on; untick **On** to hear the sound without it. Letting go of any slider plays the result.
- **Finish** goes over the whole sound: **Pitch** (every layer), **Drive** (soft clipping: grit and weight), **Echo** (with its time and feedback), **Reverb** and **Room**, **Loudness** and **Volume**, and **Loop**.
- **Even loudness.** Every sound is made to a loudness for its kind (**soft** for menus, **normal**, **loud** for impacts and explosions), never above -1 dBFS, with the silence after it trimmed and its ends faded so it never clicks. Sounds you make on different days still sit together in a game.
- **Loops** (the **Loops** group, or tick **Loop** on any sound) render exactly the loop's length and join up seamlessly: engines, wind, rain, fire, a stream, alarms, force fields. Saved as WAV they carry loop points, so Godot, samplers and most engines loop them on their own.
- **Tune to key** (on when the song has notes) puts pitches, jumps and the notes of jingles in the key the song is in, so a coin or a level-up sits in the music. The key and the first layer's note show next to it.
- **Variations.** A sound a game plays over and over (a footstep, a hit) sounds mechanical if it's the very same every time. Set **Variations** (up to 8) and **Spread** (how far their pitch moves) and **Hear variations**; saving then makes them all, numbered (*footstep_01.wav*, *footstep_02.wav*...), in a zip.
- **Save** as **WAV** or **OGG** (small; Godot and Unity import it), at 44.1 or 48 kHz. File names are ready for a game: lower case with underscores (*open_menu.wav*). **Add to song** puts the sound at the playhead on the selected Audio track (or a new one). **Keep** puts it in My sounds. **Add to game** puts it in the song's game sounds (below), with its variations: the game kit carries it. **Recent** brings back the last twelve you made.

**Make a set.** Every sound a kind of game needs, in one go: **Menus & UI** (12 sounds), **Retro platformer**, **Action RPG**, **Sci-fi shooter**, **Casual & puzzle** and **Ambience loops**. The sounds of a set share a style (the same tone, register and space), so they sound like a family, and they're levelled to sit together. Play each one, **↻** for another of it in the set's style, **Edit** to shape it in Make a sound, **✕** to leave it out, **New style** to make the whole set again differently, and **Hear all**. **Download set** saves a zip with a folder of files named for the game (with variations, if you set them) and a *sounds.json* that opens the set again in My sounds (**Import**), to change it later.

**In this game** lists the song's game sounds: what the **game kit** export carries next to the music, each named for the game (*sword_hit*) and played with `playSfx("sword_hit")` in its players. Play each one, rename it, set its **Variations**, **Edit** it (then **Update in game** puts your changes back) or remove it. **Add all to game** on a set adds the whole set. They're saved with the song.

**My sounds** keeps the sounds you **Keep** in this browser: play, **Edit**, save or delete them. **Export all** saves them to a file, to back them up or share them; **Import** opens one (or a set's *sounds.json*).

The same settings always make the same sound, so a sound you kept can be made again exactly.

### Micro-variations for game sounds

A sound a game plays again and again (a footstep, a sword swing, a menu click) sounds mechanical if it's the very same every time, so games pick one of several slightly different takes at random. Right-click a short clip (a beat or two) and choose **Generate variations…**:

- **Takes**: 4, 6 or 8. The first is the clip as it is; the others are drawn within the bounds below, spread across them so no two come out nearly the same. **Reroll** draws new ones.
- **Pitch** (± %, 5% is about a semitone either way; a higher take is a little shorter, as on a sampler, so it works on drums and recordings too), **Brightness** (± %: the track's Filter cutoff, or a gentle low-pass if the Filter is off), **Length** (± ms: how long each note is held before it lets go) and **Level** (± %).
- **Keep the reverb and echo**: off by default, since game sounds are usually dry and the game adds its own space.
- The numbered buttons play each take. **Save .zip** saves them as `<clip>_01.wav` to `_08.wav` (one shared level, the loudest at -1 dBFS, with the silence at the end trimmed); **Lay out on the timeline** puts them end to end on a new Audio track right after the clip.

### Audition like the game

**Audition like the game** (in the Game tab) renders the states, their stems, the stingers and the transition sounds exactly as the game kit exports them (it takes a few seconds, more for a long song), then plays them with the kit's own web player. Big pads switch states (a waiting one pulses until its line), stinger pads fire stingers on the next beat, and **Intensity** crossfades the stem groups. Every switch follows your transition matrix, crossfades included, so what you hear is what the game will do. The song stops while it's open.

### Costumes: the same music played another way

**Costumes** (in the Game tab) are the song played another way: each track on another instrument, or silent, and maybe faster or slower. The game swaps costumes mid-loop and the tune carries on in its new clothes: the 8-bit version in a retro room, a music box in a dream, the night version after dark, a hurry-up when time runs low.

- Pick a preset and **Add costume**: **8-bit** (every part on the chip sounds), **Music box** (the tune and chords on a music box, no drums), **Solo piano**, **Night** (no drums, brass on soft strings, 10% slower), **Hurry up** (20% faster, same pitch) or **Your own** (nothing changed yet).
- Open a costume to rename it (its name is what the game asks for), set its tempo, or pick each track's instrument: as it is, silent, or any other (drum parts can only go to another kit). Notes are moved into the new instrument's range.
- Hear them in **Audition like the game** (the **Costume** buttons). The game kit renders every state in every costume, lined up so a player can swap at any moment.

### How each state plays: shuffled pieces and silences

Under the states, **How each state plays** sets, for each state:

- **Order**: as written (a loop), or **shuffle 2-, 4- or 8-bar pieces**: the game plays the state's pieces in a random order, never the same piece twice running, so a long stay never sounds quite the same.
- **Silence**: none, or a silence between plays (4 to 12 s, 15 to 45 s, 1 to 3 min), a different length each time: music that comes and goes, so it still means something when it comes back.

The timeline plays a state as written; the game kit's players (and Audition like the game) do the shuffling and the silences.

### Effects in the game

The game kit's players can shape the music for what's going on, with no extra files: **underwater** (a low-pass and a big room), **muffled** (behind a wall, the pause menu), **low health** (duller, further away), **dream** (soft, washed in reverb) and **none**, gliding over a second or so. Try them in Audition like the game (the **Effect** buttons). In code it's `setEffect("underwater")` (web), `set_effect("underwater")` (Godot) or `SetEffect("underwater")` (Unity); `setFilter` and `setReverb` set the low-pass and the reverb directly. Sound effects aren't touched.

### Parameters: one number from the game, several changes in the music

A parameter is a number the game sets, 0 to 1, that moves several things in the music at once: **danger** raising the intensity as enemies close in, **health** muffling the music as it runs out, **depth** under water. The game doesn't need to know how the music is mixed; it just calls `setParameter("danger", 0.7)` (web), `set_parameter("danger", 0.7)` (Godot) or `SetParameter("danger", 0.7f)` (Unity). It's how games drive their music in FMOD and Wwise.

In the Game tab, **Parameters** adds one from a preset (or **your own**, empty):

- **danger**: the intensity rises from 15% to full, and the music opens up from a slightly dull 7 kHz over the first half.
- **health** (starts at 100%): below half, the music muffles (down to 1.2 kHz) and dips to 75%.
- **depth**: deeper is more muffled (down to 600 Hz) and roomier.
- **distance**: far from where the music plays (a radio, a stage), quieter, duller and roomier.
- **tension**: your stem groups come in one after another as it rises (each over its own stretch).

Each thing a parameter moves is a line you can change: **what** it moves (**Intensity**, **Filter** in Hz, **Reverb**, **Volume**, or one stem group's **Layer** level), what it **goes from** and **to**, and over which part of the parameter (**as danger goes from 0 to 50%**: before that it holds its first value, after it its last). **move something else…** adds a line. **starts at** is where the parameter is when the game starts.

When several parameters move the same thing, the strongest wins: the highest intensity and reverb, the lowest filter; volumes and a layer's levels multiply. The effects (above) and `setFilter` / `setReverb` combine the same way. A song whose parameters move the intensity follows them rather than `setIntensity`.

Move them in **Audition like the game**: each parameter gets a slider under **Intensity**. **Try it in a game** drives a parameter called danger (or threat, tension, alert) with the guard, like the intensity, and one called health (or hp, life) with your hearts. The game kit carries them all (its README lists them); the FMOD and Wwise packages leave them out.

### Try it in a game

**Game → Try it in a game…** (or **Try it in a game** in the Game tab) drops your song into a little 3D game so you can hear it react to play. You're a little robot; a one-eyed cube guard patrols the far side of a fenced field with eight coins.

- **Arrows** or **WASD** walk, **Space** jumps (land on the guard to beat it), **R** restarts, **Esc** closes. While it's open the game takes these keys, so Space jumps instead of playing the song.
- The game starts at once. The music renders the way the game kit exports it (the first time takes a while for a long song; opening it again on an unchanged song is instant) The guard naps until the music is ready, so you can walk around and grab coins meanwhile.
- Get close and the guard spots you: the music switches to the chase state through your transition matrix, and **Intensity** rises the closer the guard gets. Get away and it gives up, back to exploring. A hit costs a heart; three and it's game over (at one heart left the music goes dull and far away: the players' low-health effect). Bonking the guard plays the win stinger and the win state.
- Coins, footsteps, jumps, hits and the bonk play your song's game sounds when it has fitting ones, else the preview's own.
- **Music wiring** shows what plays for each moment (exploring, chasing, beaten, each stinger and sound), guessed from your names; change any of them there. The panel at the top left shows the state playing and the intensity, and the list under it says what the music just did and why.

### The game kit: everything for the game in one file

**Export game kit (.zip)** in the Game tab makes everything a game needs to play your music, and your sound effects, the way the panel does. Choose what it's **For** first:

- **Godot 4 project**: unzip it into your Godot project's folder (the one with `project.godot`). You get `bos_music/`, with the song's folder, the player, an **example scene** (`bos_music/<song>_example.tscn`: open it and press **F6**, then **1**, **2**... switch states, **Up** / **Down** intensity, **Space** a stinger, **A**, **B**... the sound effects) and a README with the steps to use it in your game: add `AdaptiveMusic.gd` as an autoload called **Music**, `Music.load_song("res://bos_music/<song>/")` once, then `Music.play(...)`, `Music.set_state(...)` and so on.
- **Unity project**: unzip it into your Unity project's folder (the one with `Assets`). Everything lands in `Assets/Fledgetone`: the player, the song under `Resources/BosMusic/<Song>`, an **example** component (make an empty GameObject, **Add Component › Adaptive Music Example**, press **Play**: buttons for every state, stinger and sound effect, and an intensity slider) and a README.
- **Any engine**: one folder with everything and the players for the web, Godot and Unity side by side, as below.

What's inside:

- `states/`: every state (section between markers) as a **seamless loop**, a whole number of bars long, with loop points.
- `stems/<state>/`: when tracks have stem groups, the same loop split by group (tracks without a group go in **Main**), every stem exactly the same length: played together at full level they make the mix.
- `transitions/`: the fill, riser and impact sounds your rules use (a fill or a riser starts just before the switch; an impact on it) and the bridges (`bridge into <state>.wav`: it plays on the switch and the state comes in after it), and `stingers/`: every stinger.
- `sfx/`: the song's sound effects (added with **Add to game** in the Sound FX tab), each with its variations (`sword_hit_01.wav`, `sword_hit_02.wav`...). Looping ones (an engine, the rain) carry loop points.
- `audio_manifest.json`: the tempo, the time signature, the sample rate, the key, every state (its loop, its stems, its length in bars, seconds and samples), the transition rules by state name, every stinger (with how many bars it bridges), each stem group's **intensity curve** ([intensity, level] points, both 0 to 1) as the recommended gain curve for the game's audio code, and every sound effect with its files.
- Ready-made players that read the manifest and do all of it (switching by your rules on the beat, crossfades, stinger bridges, intensity, sound effects): `adaptive-music.js` for a web game, `AdaptiveMusic.gd` for Godot 4, and `AdaptiveMusic.cs` for Unity (scheduled on Unity's audio clock, so changes land exactly on the beat). Each has `play`, `setState` / `set_state` / `SetState`, `setIntensity` / `set_intensity` / `SetIntensity`, `stinger`, `playSfx` / `play_sfx` / `PlaySfx` (a different variation each time, never the same one twice in a row; a looping sound plays until stopped), `stopSfx` / `stop_sfx` / `StopSfx`, and `stop`. Sound effects have their own volume (`setSfxVolume`, `sfxVolume`, or Godot's `sfx_bus`).
- A README that says how to drop it in, with your own state, stinger and sound names in the examples.

### FMOD and Wwise

**File › FMOD / Wwise package…** (also in the Game tab) lays your game music out for audio middleware, in one .zip:

- `Audio/`: every state as an exact loop, its stems by stem group, the stingers and the transition sounds (48 kHz, or 44.1).
- `cues.json`: the tempo, every state (bars, seconds, samples, stems, and where it sits on one timeline), the transition rules, the stingers and the intensity curves.
- `fmod/…js`: an **FMOD Studio** script. Put it in your project's Scripts folder and choose **Scripts › Fledgetone › Import**: it builds the event with a track per stem group, every state laid out with a loop region and a marker, the tempo, an **Intensity** parameter driving each group's volume along its curve, and an event per stinger.
- `wwise/…py`: a **Wwise** script (Wwise Authoring API, Python). With Wwise open, it builds a Music Switch Container with a playlist and segment per state and a track per stem group, a State Group with a state per section, an Intensity game parameter, and the stingers as sounds.
- `README.md`: how to run them, your states, transitions and intensity curves (in dB), and the steps each tool doesn't let a script do (FMOD's transition regions, Wwise's state assignments and RTPC curves).

Versions of FMOD and Wwise differ, so each script step reports whether it worked (OK or SKIP) rather than stopping the rest.

### The web runtime kit: music with no audio files

For a web game where download size matters, **Export web runtime kit (no audio files)** (in the Game tab) makes a .zip with just:

- the song's project file (`<song>.json`, usually tens of kilobytes, with any sounds your clips play inside it),
- `bos-player.js` (about 550 KB, about 135 KB as a web server sends it), which **synthesizes the music in the player's browser** when the game loads, with the same engine as Fledgetone: every state (as stems, if the song has stem groups), the stingers and the transitions,
- a test page (`index.html`) and a README.

In the game: `const music = await loadSong('./song.json', { onProgress })`, then `music.play(...)`, `music.setState(...)`, `music.setIntensity(...)` and `music.stinger(...)`, exactly as with the game kit's web player. Synthesizing takes a few seconds per minute of music (longer on slow devices; a 16-bar song with three stem groups took about 12 seconds in testing), so start it while the game loads and show a progress bar. Recorded instruments download their samples from the same public libraries the app uses, so they need a connection; the synths need nothing.

### Music for games: intro + loop, and layers

Game music usually plays an intro once and then loops the rest for as long as the player stays. Set the loop region to the part that should repeat (everything before its **In** is the intro) and choose **Range: Intro + loop**. The export is a .zip with:

- `<name> intro.<ext>`: bar 1 up to the loop's In, exactly, ending without a fade so it runs straight into the loop.
- `<name> loop.<ext>`: the loop region as a seamless loop (see **Seamless loop** above): exactly as long as the loop, and it repeats without a gap or click.
- For WAV, also `<name> intro+loop (loop points).wav` (untick **Also one file with loop points** to leave it out): both in one file, with the loop marked inside it. Godot (set the import's loop mode to detect from the WAV) and most samplers play the intro once and loop the rest on their own.

In your game, play the intro, then start the loop the moment the intro ends, set to repeat. Intro and loop share one level and one reverb, so the change can't be heard. **Normalize** measures the loop and moves both together.

Choose **Export: Layers** instead of Mixdown for **adaptive music**: an intro and a loop for every track that plays, all exactly the same lengths, so the game can play them together and fade layers in and out (drums when a fight starts, strings when the player finds something). They share one level, so turned all the way up they make the mix.

The footer shows the file name and its exact length. Exports include the whole mix: volumes, pans, mutes and solos, every effect, sends, the master reverb and delay, the master OTT and Stereo Width, swing, and the master volume. The first beat is as loud as the rest, so a kick right at the start keeps its attack. If the mix would clip, the file is turned down to just under full scale (stems all by the same amount, so their levels still match).

**Markers** in the range go into the file as cue points with their names, which DAWs, audio editors and game audio tools show as markers. Their positions count from the start of the file (the range start, or IN for a loop), in the mixdown and in every stem. A **Ring out** file also includes a marker sitting exactly at the end of the range. When there are any, the **Format** section says how many go in (or that the one marker does). The loop's IN and OUT aren't written as markers.

Exporting renders faster than real time (stems one track after another) and shows its progress. It pauses playback. **Cancel**, Esc or the X stops it.

> Exports need the sounds of every recorded instrument that's playing. If one can't download (for example, when you're offline), the export stops with an error. Mute that track, or switch it to a synth, to export without it.

## Keyboard shortcuts

Shortcuts don't work while you're typing in a box, or while a dialog or panel (Guide, Search, Export, New, FIT, Loop range, Markers) is open. `Ctrl+K` (search) works everywhere. On a focused slider, the arrow keys, Home, End, Page Up and Page Down move the slider and every other key is still a shortcut. A drop-down menu lets go of the keyboard after you pick from it with the mouse.

### Timeline

| Keys | Action |
|---|---|
| `Space` | Play / pause |
| `Ctrl+S` / `Ctrl+O` / `Ctrl+E` | Save / Open / Export (`Cmd` on a Mac) |
| `V` / `C` | Selection tool / Razor tool |
| `L` | Loop on / off |
| `J` / `Shift+L` | Playhead back / forward a bar (`Shift+J`: back 4 bars) |
| `K` | Play / pause (like Space) |
| `I` / `O` | Set loop In / Out at the playhead |
| `Home` | Go to the loop In point |
| `M` | Add a marker at the playhead |
| `Shift+M` | Add a hit point (a marker locked to time) at the playhead |
| `,` / `.` | Jump to the previous / next marker |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |
| `Ctrl+A` | Select all clips |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste at the playhead |
| `Ctrl+D` | Duplicate the selection as a block right after itself |
| `Delete` or `Backspace` | Delete selected clips |
| `Esc` | Clear the selection |
| `+` / `-` | Zoom in / out (around the playhead) |
| `Ctrl+K` | Search tools, settings, instruments, starters and the guide |
| `?` | Open this guide |
| `A`–`'`, `W`–`P`, `Z` / `X` | With the computer keyboard piano on: play notes, and change octave |

On a Mac, use `Cmd` instead of `Ctrl`.

### Mouse

| Gesture | Action |
|---|---|
| Shift on the ruler, with the Razor, on right-click or a pad drop; or after you start dragging a clip | Ignore snap (loop brackets and piano-roll notes always snap) |
| Alt (Option) + drag a clip | Duplicate it |
| Drag a clip up or down | Move it to another track that can play it |
| Ctrl / Cmd + mouse wheel, or pinch | Zoom around the pointer |
| Right-click the ruler | Add a marker here, a build-up & drop, a key change from here, insert bars here, or delete the bars between In and Out |
| Click a marker flag | Move the playhead there |
| Drag a marker flag | Move the marker (Shift: no snap) |
| Double-click a marker flag | Rename it |
| Right-click a marker flag | Rename, Lock to time / Lock to bar, Delete |
| Curve button on a track header | Show or hide that track's automation |
| Shift / Ctrl / Cmd + click | Add to or remove from the selection |
| Double-click empty lane (Selection tool) | New 1-bar clip |
| Double-click a clip (Selection tool) | Edit its notes (with the Razor, right-click > Edit notes) |
| Double-click a VOL or PAN slider | Reset it |
| Double-click the Swing slider | Set swing to 0% |

### Piano roll (while it's open)

| Keys | Action |
|---|---|
| `Ctrl+A` | Select all notes |
| `Delete` or `Backspace` | Delete selected notes |
| Arrow keys | Nudge selected notes (time, or one semitone) |
| `Shift+Up` / `Shift+Down` | Move selected notes an octave |
| `Esc` | Clear the note selection, or close the piano roll |

## Tips and limits

- Songs can be up to 400 bars long, with any number of tempo changes (40 to 240 BPM, to 0.01 BPM) and time signatures. The shortest loop is a 16th note.
- For EDM, set **Swing** to 0% (new blank projects start at 20%). Dubstep is usually 140 BPM with the snare on beat 3 (half-time), house around 124 to 128, drum & bass around 174.
- Projects that use Wobble Bass, Growl Bass, Reese Bass, Supersaw, Pluck, FX, Audio tracks or the Slicer only open in this version of the app or later.
- Recorded instruments (piano, strings, winds and others) download their sounds the first time you use them, so they need an internet connection the first time; then they're kept and work offline. To have them all offline, use **Download all** in the Master tab's **Instruments offline** panel. Everything else always works offline.
- Muted tracks, and tracks silenced by another track's Solo, don't play their notes at all, which saves processing power on big songs.
- If playback stutters on a big song, freeze the tracks you aren't changing (the snowflake in each track's header), switch **Playback** to **Stable** in the Inspector's Master tab, mute tracks you aren't working on, or switch off effects you don't need. Exporting never stutters, it just takes longer.
- Sounds you load are kept in this browser; a private window may not allow it. Save the project to keep its sounds safe.

## Reporting a problem

Something not working, sounding wrong or crashing? Click **Report a problem** at the bottom of the page (or search for *report*). Describe what you were doing, what you expected and what happened instead, and add your email if you'd like a reply. **Email it** opens your email program with the report addressed to martin@twobirdsworkshop.com; **Copy report** copies it to paste anywhere. You can also use the contact form at twobirdsworkshop.com (pick **SOMETHING'S BROKEN**).

**Your music is yours.** Everything you make with Fledgetone belongs to you, to use, sell or share as you like; your songs stay on your computer. **Terms** at the bottom of the page (or **Help › Terms of use**) has the full terms, including what you're responsible for and what Fledgetone isn't.

With **Include technical details** ticked (it is unless you untick it), the report also carries your browser, audio settings, the size of the song (tracks, clips, notes, tempo, instruments) and the last few errors the page hit; **See exactly what's included** shows all of it. Your song itself isn't sent: if the problem is in one song, **Save** it and attach the file.

## Credits

The synths and drum kits are generated in your browser. The recorded instruments play free sample libraries that people made and shared. Thank you to all of them.

### Recorded instruments

> **Releasing music commercially (a game, a paid album)?** Music you make is yours, but six recorded drum kits (Acoustic, Breakbeat, LinnDrum, CR-78, Techno, Bongos) come from a collection that states no licence. For a commercial release, use the synthesized kits (Drums, Drum Machine) or build a **Drum Rack** from CC0 recordings (public domain: no conditions at all), such as Versilian's VCSL percussion or the Hydrogen "Audiophob" kit.

<!-- credits:start (generated by npm run guide-tables) -->
| Instruments | Samples | Licence |
|---|---|---|
| Grand Piano | Salamander Grand Piano by Alexander Holm, from the [Tone.js audio collection](https://github.com/Tonejs/audio) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Acoustic Kit, Breakbeat Kit, LinnDrum, CR-78, Techno Kit, Bongos & Percussion | Drum machine and kit samples from Chris Wilson's Web Audio samples, from the [Tone.js audio collection](https://github.com/Tonejs/audio) | Not stated by the collection (see its [drum-samples folder](https://github.com/Tonejs/audio/tree/master/drum-samples)) |
| Bass Guitar, Electric Guitar, Saxophone | Karoryfer Samples, via [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Acoustic Guitar | University of Iowa Electronic Music Studios, via [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Harp, Trumpet, French Horn, Flute, Erhu | Versilian Studios Orchestra (VSCO 2), via [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Cellos (Real), Cellos Short (Real), Violins (Real), Violins Short (Real), Violas (Real), Violas Short (Real), Pizzicato Section (Real), Tremolo Section (Real), Solo Violin (Real), Harp (Real), Flute (Real), Flute Short (Real), Oboe (Real), Clarinet (Real), Bassoon (Real), French Horn (Real), French Horn Short (Real), Trumpet (Real), Trumpet Short (Real), Trombone (Real), Trombone Short (Real), Tuba (Real), Pipe Organ (Real), Chapel Organ (Real), Marimba (Real), Xylophone (Real), Glockenspiel (Real), String Section (Real), Brass Section (Real) | Strings, woodwinds, brass, harp, mallets and organ from the [Versilian Community Sample Library, VSCO 2 CE](https://github.com/sgossner/VSCO-2-CE) by Versilian Studios (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Timpani (Real), Tubular Bells (Real), Vibraphone (Real), Harpsichord (Real), Kalimba (Real), Tenor Sax (Real), Harmonica (Real), Ocarina (Real), Zither (Real), Concert Bass Drum (Real) | Timpani, tubular bells, vibraphone, harpsichord, kalimba, tenor saxophone, harmonica, ocarina, zither (dan tranh), concert bass drum, and the harpsichord and piano release sounds from the [Versilian Community Sample Library (VCSL)](https://github.com/sgossner/VCSL) by Versilian Studios (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Steel Drums (Real) | Steel drums from [jSteelDrum](https://github.com/sfzinstruments/jlearman.SteelDrum) by jlearman (converted to MP3, hosted with the app) | The Unlicense (public domain) |
| Electric Piano (Real) | Electric piano from [E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos) by Greg Sullivan (converted to MP3, hosted with the app) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Banjo (Real) | Banjo from [ganjo](https://github.com/sfzinstruments/ganjo) by itsclipping (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Solo Voice (Real) | Solo voice from the [legato vocal tutorial](https://github.com/sfzinstruments/legato_vocal_tutorial) by Karoryfer Samples (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Studio Kit (Real) | Studio drum kit from [Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums) by Karoryfer Samples, close and overhead microphones mixed (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Upright Piano (Real) | Upright piano sampled by Simon Dalzell of Ivy Audio, from the [VSCO 2 CE](https://github.com/sgossner/VSCO-2-CE) library by Versilian Studios, which may redistribute it (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain), as part of VSCO 2 CE |
| Concert Grand (Real) | [Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano), samples by AKAI, mapped by kinwie (converted to MP3, hosted with the app) | Public domain |
| Alto Sax (Real) | Alto saxophone from [Weresax](https://github.com/sfzinstruments/karoryfer.weresax) by Karoryfer Lecolds (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Baritone Sax (Real) | Baritone saxophone from [Bear Sax](https://github.com/sfzinstruments/karoryfer.bear-sax) by Karoryfer Lecolds (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Double Bass (Real), Upright Bass (Real) | Double bass from [Meatbass](https://github.com/sfzinstruments/karoryfer.meatbass) by Karoryfer Lecolds, played by Drogomir Smolken (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Electric Bass (Real) | Electric bass from [Growlybass](https://github.com/sfzinstruments/karoryfer.growlybass) by Karoryfer Lecolds (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Flatwound Guitar (Real) | Electric guitar from [Emily Guitar](https://github.com/sfzinstruments/karoryfer.emilyguitar) by Karoryfer Lecolds, played by D. Smolken (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Electric Guitar (Real), Crunch Guitar (Real), Distortion Guitar (Real), Hollow-Body Guitar (Real) | Electric guitars from [Black And Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars) by Karoryfer Lecolds, recorded by Brian Wood (converted to MP3, hosted with the app) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) |
| Violin, Cello, Strings, Timpani, Choir, Voices "Ooh", Synth Choir, Halo Pad, Warm Pad, New Age Pad, Choir Pad, Glass Pad, Sweep Pad, Atmosphere, Crystal, Sci-Fi, Goblins, Viola, Contrabass, Tremolo Strings, Slow Strings, Synth Strings, Orchestra Hit, Oboe, Clarinet, Bassoon, English Horn, Piccolo, Recorder, Trombone, Tuba, Brass Section, Muted Trumpet, Tenor Sax, Harpsichord, Drawbar Organ, Rock Organ, Celesta, Glockenspiel, Music Box, Vibraphone, Xylophone, Classical Guitar, Distortion Guitar, Overdrive Guitar, Muted Guitar, Banjo, Upright Bass, Fretless Bass, Fiddle, Sitar, Koto, Shamisen, Shakuhachi, Pan Flute, Ocarina, Bagpipes, Accordion, Harmonica, Kalimba, Steel Drums, Dulcimer, Bright Piano, Electric Grand, Honky-Tonk Piano, FM Electric Piano, Clavinet, Percussive Organ, Reed Organ, Square Lead, Saw Lead, Calliope, Chiff Lead, Charang, Voice Lead, Fifths Lead, Bass + Lead, Synth Brass, Synth Brass 2, Synth Strings 2, Polysynth Pad, Metallic Pad, Rain, Soundtrack, Brightness, Echo Drops, Jazz Guitar, Clean Guitar, Steel-String Guitar, Guitar Harmonics, Finger Bass, Pick Bass, Slapped Bass, Slapped Bass 2, Analog Synth Bass, Synth Bass 2, Soprano Sax, Baritone Sax, Shehnai, Whistle, Melodic Toms, Syndrum, Woodblock, Agogô, Tinkle Bell, Reverse Cymbal, Seashore, Birds, Telephone, Helicopter, Applause, Gunshot, Fret Noise, Breath | Musyng Kite SoundFont, rendered by Benjamin Gleitzman's [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| Taiko Drums, Electric Piano, Pipe Organ, Mandolin, Marimba, Chimes, Pizzicato Strings | FluidR3 GM SoundFont by Frank Wen, rendered by Benjamin Gleitzman's [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
<!-- credits:end -->

- The guitar, bass, saxophone, strings, harp, flute and brass samples were collected and edited (trimmed, volume-matched, cleaned up and tuned) by Nicholaus Brosowsky for [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments). Its samples are released under CC BY 3.0.
- The Erhu is shaped in the app from the VSCO violin, and the Mandolin from the FluidR3 steel-string guitar. The Electric and Acoustic Guitar recordings go through an amp stage and a brightening in the app. The Violin, Cello and Strings notes are 3 seconds long in the soundfont, so the app loops their steady part when it loads them and a note can be held as long as you like. The top octave of the Violin, Erhu, Strings and Flute plays quieter so it doesn't pierce.
- Fledgetone loads these samples straight from the projects above; it doesn't copy or change the files.

### Plugins

<!-- plugin-credits:start (generated by npm run guide-tables) -->
| Plugins | Made by | Licence |
|---|---|---|
| Airwindows: 508 effects | The [Airwindows](https://www.airwindows.com) effects by Chris Johnson, through the [Airwin Consolidated](https://github.com/baconpaul/airwin2rack) library by Paul Walker | [MIT](https://opensource.org/license/mit) |
| MDA: 33 effects, 4 instruments | The mda plug-ins by Paul Kellett ([mda-vst](https://sourceforge.net/projects/mda-vst/)) | [MIT](https://opensource.org/license/mit) (offered under MIT or the GPL) |
| Open303: 1 instrument | [Open303](https://github.com/RobinSchmidt/Open303) by Robin Schmidt | [MIT](https://opensource.org/license/mit) |
| Mutable Instruments: 6 effects, 32 instruments | Plaits, Braids, Rings, Elements and Clouds by Emilie Gillet ([Mutable Instruments eurorack](https://github.com/pichenettes/eurorack) code) | [MIT](https://opensource.org/license/mit) |
| Faust: 22 effects, 32 instruments | Physical models and effects from the [Faust](https://faust.grame.fr) libraries and examples by GRAME and contributors, among them Romain Michon, Julius O. Smith III, Yann Orlarey and Stéphane Letz (the waveguide models after the Synthesis ToolKit by Perry Cook and Gary Scavone) | [MIT](https://opensource.org/license/mit), BSD and STK-4.3 (the library code is used under the Faust exception to its LGPL) |
<!-- plugin-credits:end -->

Their licence notices come with the app, in `third-party-licenses.txt` and in `fledgetone-plugins/LICENSES.txt` next to the plugin files.

### Software

Built with [Tone.js](https://github.com/Tonejs/Tone.js) by Yotam Mann, [standardized-audio-context](https://github.com/chrisguttandin/standardized-audio-context) and automation-events by Christoph Guttandin, [React](https://react.dev), [zustand](https://github.com/pmndrs/zustand) by Paul Henschel, [Lucide](https://lucide.dev) icons, [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) by Vanilagy (video export), [wasm-media-encoders](https://github.com/arseneyr/wasm-media-encoders) by arseneyr (MP3 and Ogg export), @babel/runtime and tslib. They are open source under the MIT licence, except Lucide (ISC) and tslib (0BSD). wasm-media-encoders contains the LAME MP3 encoder (LGPL) and the Xiph Vorbis and Ogg libraries (BSD). Their full licence texts come with the app: in `third-party-licenses.txt` next to a web build, and in a comment at the top of the single-file `Bos-Beatbox.html`.
