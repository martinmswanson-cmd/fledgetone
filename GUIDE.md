# Bo's Beatbox guide

## Getting started

Bo's Beatbox is a music maker that runs in your browser. You build a song on the **Arrangement Timeline** out of **tracks** (one instrument each) and **clips** (blocks of notes on a track), mix it, and export it as a WAV file.

It's made for a computer: a PC or Mac with a mouse, a keyboard and a wide screen. On a phone a notice says so once; you can continue, but the timeline is cramped, drag-and-drop editing and keyboard shortcuts don't work, and audio may stutter.

1. Click **START AUDIO** in the top-right corner. Browsers only allow sound after you click something, so the button glows red until audio is running. Pressing Play also starts it.
2. To hear an example, click **New** above the timeline and choose **Demo song**, or one of the genre starters (Dubstep, House, Drum & Bass, Trap).
3. Press **Space** (or the green Play button) to play, and Space again to pause.
4. Double-click a clip to open its notes in the **piano roll** under the timeline.

At the top is the header: **TEMPO** and **TAP**, **Swing**, **MASTER** volume, the loudness reading (once audio runs), **GUIDE** and **START AUDIO**. Under it, top to bottom:

- **Arrangement Timeline**: the project bar (name, New, Open, Save, Export, Share), the toolbar, the ruler, your tracks, the Overview strip and the piano roll.
- **Instrument Browser**: try every instrument on an on-screen keyboard.
- **Interactive Soundbank Audition Deck**: pads you can click or play from the keyboard, and drag onto the timeline.

> The app always opens on an empty timeline. If your last session had clips (or markers, with no clips yet), a banner offers to **Restore** it, saying how many and when it was saved. It stays across reloads until you click **Restore** or **Dismiss**.

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

### Creating clips

- With the Selection tool, double-click empty lane space for a new 1-bar clip starting on that beat (whatever SNAP is set to). It opens in the piano roll.
- Right-click empty lane space for empty clips of 1, 2 or 4 bars, ready-made patterns (Drums, Drum Machine, Slap Bass, Space Clav and Brass Stabs have them), and Paste.
- The **+** in a track header opens the same menu at the playhead.
- Drag a pad from the Audition Deck onto a matching track (any drum kit accepts drum pads). Dropping inside a clip adds the notes to it; dropping on empty space makes a new clip.

### Snap

The **SNAP** menu in the toolbar sets the grid that clip moves, trims, razor cuts, the playhead, the loop brackets, markers and paste land on: **1/4** (a beat), **1/8**, **1/16**, **Frame** (one video frame, see Timecode & frame rates) or **Off**. Hold **Shift** to ignore snap when clicking or dragging on the ruler, razor-cutting, right-clicking or dropping a pad; for clip moves and trims, start the drag first and then hold Shift. The loop brackets always snap: set SNAP to Off to place them freely. The snap step is also the shortest a clip or the loop can be (never less than a 16th).

### Zoom and scrolling

- Zoom with the slider at the right of the toolbar, or `+` and `-` (they keep the playhead where it is on screen when it's visible). **Ctrl+mouse wheel** (Cmd on a Mac) or a trackpad pinch zooms around the pointer. Zoom goes from 12 to 1280 pixels per bar, deep enough to see single video frames.
- Zoomed in, the lanes show faint lines on every 16th, or on every frame when SNAP is Frame.
- Scroll in time with **Shift+mouse wheel**, a sideways trackpad swipe, or the **Overview** strip under the tracks: drag its cyan window to scroll, click anywhere on it to jump, and drag either end of the window to zoom.
- While playing, the view follows the playhead. While stopped, a jump to a spot that's off screen (`,` and `.`, a position in the Markers list, **Go to In** or `Home`, or a position typed into a readout) scrolls the view to it.

### Undo

`Ctrl+Z` undoes and `Ctrl+Shift+Z` or `Ctrl+Y` redoes, up to 100 steps. Undo covers:

- clip and note edits;
- Insert and Delete bars, along with where they moved the loop and the playhead;
- markers: adding, moving, renaming, locking and deleting them;
- adding and deleting tracks (Undo brings a deleted track back with its clips), and changing a track's instrument;
- M, S and R, VOL and PAN, the EQ, Distortion, Compressor, Chorus, the sends and the Master tab (OTT, Stereo Width, reverb and delay);
- loading, replacing or removing a Sampler sound, and its **Original pitch on** note;
- automation: adding, moving and deleting points, ramps and clearing or removing lanes.

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

- Click **Video** in the toolbar (or drop a video file anywhere on the page) to load an MP4 or WebM. It appears as a **video lane** under the ruler, with its frames along the song at the current tempo, and in a **preview window** that follows the playhead: it plays along when you play, and shows the frame under the playhead when you click or drag on the ruler, so you can line hits up with the picture.
- **Drag the video lane** sideways to move where the video starts in the song. It snaps to beats; hold Shift to place it freely. The lane's header shows where it starts (time and bar).
- The preview window: drag its top bar to move it, the arrows button cycles its size (small, medium, large), the speaker button lets you hear the video's own sound while you work (off by default), and **×** hides it. The eye button on the video lane shows it again; **×** on the lane removes the video.
- To export the music **on** your video, choose **Video (MP4)** in Export. With a video loaded, **Put the music on** *your video* is ticked: the picture is your video, where it sits on the timeline (black before and after), instead of the visualizer. Tick **Keep the video's own sound too** to mix its sound effects and dialogue under the music.
- The video stays loaded until you close the page; it isn't saved with the project (videos are too big). Load it again next time, and drag it back to its start.

## Markers

Markers are named points on the timeline: the sections of a song (intro, build, drop), or hit points in a video.

### Adding markers and jumping to them

- Press `M` to drop a marker at the playhead, even while playing. Markers are named **Marker 1**, **Marker 2** and so on. If a marker is already at that exact spot, nothing is added and a message says so.
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

### The Markers list

Click the flag button right of the Loop button (it shows how many markers there are). The list has every marker in order, with its position (bar.beat.hundredths) and its timecode at your frame rate, drop-frame included. It grows to fill the room under it, and scrolls when there are more markers than fit.

- Type over a name to rename the marker; the flag changes as you type.
- The lock button locks the marker to time, or back to its bar. The bin deletes it.
- Click a position to move the playhead there (the view scrolls to it if it's off screen).
- `Esc` or a click outside closes the list.

### Markers and the rest of the song

- Adding, moving, renaming, locking and deleting a marker are one Undo step each.
- **Insert bars** moves the markers at or after the insert point with the music. **Delete bars In → Out** deletes the markers in the removed bars (one exactly at IN goes, one exactly at OUT is kept) and moves the later ones left. Markers locked to time stay where they are.
- Markers are saved with the project and in autosave, even before there are any clips (hit points placed on a video before the music is written): the Restore banner offers that session too. Older versions of the app open the file without them.
- WAV exports carry the markers as cue points (see Exporting audio).

## Writing notes: the piano roll

Double-click a clip with the Selection tool (or right-click it and choose **Edit notes**, which works with either tool) to open it in the piano roll under the timeline. Drum kits show five rows (Cowbell, Open Hat, Closed Hat, Snare, Kick); other instruments show a keyboard covering the instrument's range.

- **Add a note**: click empty grid. Keep the button down and drag to place it.
- **Move**: drag a note sideways (time) or up and down (pitch). Selected notes move together.
- **Length**: drag a note's right edge.
- **Delete**: right-click a note, or select notes and press `Delete`.
- **Select**: click a note. Shift, Ctrl or Cmd-click adds notes; `Ctrl+A` selects them all; `Esc` clears the selection.
- **Nudge**: arrow keys move selected notes by one grid step or one semitone; Shift with up and down moves an octave.
- **Hear it**: click the keys on the left. Adding or clicking a note plays it, and so does dragging it to a new pitch.

The header has the clip's name (click to rename), **GRID** (1/32, 1/16T, 1/16, 1/8T, 1/8, 1/4), **NEW NOTE** length, **VEL** (velocity: how hard new notes are played; with notes selected it changes those notes) and zoom. Click the piano roll's ruler to move the playhead. Close it with **Close** or `Esc` (when no notes are selected).

**Fine grids and triplets.** **T** means triplet: three in the space of two, so 1/16T puts six notes in a beat and 1/8T three. Clicking places a note on the grid line at or before the pointer. Dragging a note, or its right edge, snaps it to the grid, and the arrow keys move notes one grid step. Changing the grid never moves existing notes. Zoom in (the magnifier) for comfortable 1/32 editing. Swing leaves triplets and 1/32 notes on the grid, and an 8th with a 1/32 roll or a triplet in it plays straight, so rolls stay even with Swing on.

**Composing helpers** (in the piano roll's header):

- **SCALE**: pick a key (root and scale: Major, Minor, Harmonic minor, Dorian, Phrygian, Lydian, Mixolydian, the two pentatonics, Blues or Japanese). Rows outside the key are shaded dark and the root's rows lit, and a click lands on the nearest note of the key, so nothing sounds wrong.
- **CHORD**: a click adds a whole chord from the note you click. **Triad in key** and **7th chord in key** build the right chord for that place in the scale (in A minor, a click on D gives D minor); the others are fixed shapes (Major, Minor, Sus2, Sus4, 7, Maj7, Min7, Add9, Diminished, Power, Octave). The chord drags as one.
- **TOOLS** changes the selected notes, or the whole clip with nothing selected, in one Undo step: **Quantize** (starts, or starts and lengths, to the GRID), **Humanize** (small random shifts in timing and velocity), **Strum** (a chord's notes a moment apart, low to high or high to low), **Arpeggiate** (each chord becomes a broken chord at the GRID's speed: up, down, up and down, or random), **Legato** (each note lasts until the next), **Octave up / down**, and **Fit to scale**. Drum clips have Quantize and Humanize.
- **GHOSTS** shows the other tracks' notes over the same bars as faint outlines in their colours, so a melody can follow the chords.

> With no notes selected, `Delete` acts on the timeline and deletes the selected clip, usually the one you're editing. `Ctrl+Z` brings it back.

## Instruments

Each track plays one instrument. Add a track with **+ Add Track** under the last track, or change a track's instrument in the Track Inspector (**SOUND GENERATOR**). There are 105 instruments in 14 groups:

| Group | Instruments |
|---|---|
| Drums & Percussion | Drums (analog kit), Drum Machine (808-style), Taiko Drums, Acoustic Kit, Breakbeat Kit, LinnDrum, CR-78, Techno Kit, Bongos & Percussion |
| Bass | Slap Bass, Sub-Bass, 808 Bass, Wobble Bass, Growl Bass, Reese Bass, Bass Guitar, Upright Bass, Fretless Bass |
| Choir & Voices | Choir, Voices "Ooh", Synth Choir |
| Pads & Atmospheres | Halo Pad, Warm Pad, New Age Pad, Choir Pad, Glass Pad, Sweep Pad, Atmosphere, Crystal, Sci-Fi, Goblins |
| Orchestra | Timpani, Viola, Contrabass, Pizzicato Strings, Tremolo Strings, Slow Strings, Orchestra Hit, Oboe, Clarinet, Bassoon, English Horn, Piccolo, Recorder, Trombone, Tuba, Brass Section |
| Keys & Synths | Grand Piano, Electric Piano, Space Clav, Wavetable Synth, Analog Lead, Supersaw, Pluck, Synth Designer, Pipe Organ, Synth Strings, Harpsichord, Drawbar Organ, Rock Organ |
| Guitars & Strings | Acoustic Guitar, Electric Guitar, Mandolin, Harp, Violin, Cello, Strings, Classical Guitar, Distortion Guitar, Overdrive Guitar, Muted Guitar, Banjo |
| Winds & Brass | Brass Stabs, Saxophone, Trumpet, French Horn, Flute, Muted Trumpet, Tenor Sax |
| Mallets & Bells | Marimba, Chimes, Celesta, Glockenspiel, Music Box, Vibraphone, Xylophone |
| World | Erhu, Fiddle, Sitar, Koto, Shamisen, Shakuhachi, Pan Flute, Ocarina, Bagpipes, Accordion, Harmonica, Kalimba, Steel Drums, Dulcimer |
| FX | FX (risers, sweeps, impacts, drops) |
| Chiptune | Chip Lead, Chip Bass, Chip Drums |
| Your Sounds | Sampler (plays a sound file you load) |

For **classical and angelic** music: Choir and Voices "Ooh" for heavenly voices, Halo Pad, Glass Pad and Choir Pad underneath, Harp, Celesta and Glockenspiel for sparkle, and the Orchestra group for everything from a string quartet (Violin, Viola, Cello, Contrabass) to a full orchestra with woodwinds, brass and Timpani.

- **Synths and synthesized kits** (Drums, Drum Machine, Slap Bass, Sub-Bass, 808 Bass, Wobble Bass, Growl Bass, Reese Bass, Space Clav, Wavetable Synth, Analog Lead, Supersaw, Pluck, Synth Designer, Brass Stabs, FX and the three Chiptune instruments) are generated in the browser and work offline.
- **Recorded instruments and kits** (the other 85) download their sounds the first time you use them, so they need an internet connection. A spinner shows on the track header while they load, and the Inspector shows **Loading CDN...**, **Ready** or **Error**. Notes are silent until the sounds arrive. If a download fails, the track header shows a red **!** in place of its coloured dot and the Inspector shows **Error** with a **Retry** button; click either to try again. Failed downloads are also retried when your connection comes back, and when you play that instrument in the Instrument Browser or Audition Deck, add another track with it or export. Once it downloads, every track using it plays from its next note, with no reload.
- Every drum kit has the same eleven rows: **Kick**, **Snare**, **Clap**, **Closed Hat**, **Open Hat**, **Tom Low**, **Tom Mid**, **Tom High**, **Cowbell**, **Ride** and **Crash**, so drum parts move between kits. The recorded kits play their own recordings of the kick, snare, hats and toms, and synthesized hits for the rows they have no recording of. On a MIDI keyboard, the drum pads land on the matching rows. Taiko and Timpani are played like pitched instruments.
- Slap Bass, Sub-Bass, 808 Bass and Analog Lead play one note at a time; in a chord, only the loudest note sounds. Space Clav (16 notes at once), Wavetable Synth (12) and Brass Stabs (8) cut short whichever ringing note would end soonest when they run out, so new notes still play (only notes beyond the limit that start at the very same moment are dropped).

### Synth Designer

**Synth Designer** (Keys & Synths) is a synth you build yourself. Its controls appear in the Track Inspector under the instrument:

- **Load preset…** starts from a sound: Init saw, Supersaw lead, Wobble bass, Growl bass, Sub bass, Angelic pad, Warm pad, Pluck, Bell, Brass, 8-bit lead or Riser noise.
- **Osc 1** and **Osc 2**: a wave each (Saw, Square, Triangle, Sine), tuned by octave, semitone and cents, with a level. **Sub** adds a sine an octave down, **Noise** adds white noise.
- **Unison** stacks up to 7 copies of each oscillator, detuned across **Spread** and panned across **Width**, for big wide leads and pads.
- **Filter**: Low-pass, High-pass or Band-pass, with **Cutoff**, **Reso**(nance), how far its own envelope opens it (**Env amt**, in octaves), how much it follows the note (**Key trk**) and **Drive** for grit.
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

### Audio tracks: your own recordings

An **Audio** track holds sound files as clips instead of notes. Add one with **Add Track > Your Sounds > Audio**.

- **Getting a file in** (WAV, MP3, OGG, FLAC, M4A and anything else your browser can play, up to 50 MB each): drag files from your computer onto an Audio track's lane (it snaps; hold `Shift` for no snap), or onto the strip under the tracks to make a new Audio track. You can also click **Load audio…** in the Inspector (clips go at the playhead), or double-click an Audio lane or right-click it > **Load audio file…** (clips go at that bar). Several files land end to end.
- A clip is as long as its sound, is named after the file, and plays it as recorded (no time-stretch). It keeps its start bar and its length in seconds when you change the tempo, so its length in bars follows the tempo.
- **Editing** works as for note clips: move, trim, razor, copy and paste, duplicate, Repeat, Fill to loop Out, Insert/Delete bars, undo. Trimming the left edge makes the clip play from further into the sound. Audio clips only move between Audio tracks.
- **Fades**: drag the small square at either top corner of a clip (shown when the clip is wide enough).
- **Gain and fades**: double-click a clip (or right-click > **Gain and fades**) for the clip editor under the timeline: the waveform, **GAIN** (-24 to +24 dB), **Fade in**, **Fade out**, and **Chop to Slicer…**. `Esc` closes it.
- The track's mixer, effects, sends and automation all work on Audio tracks. Swing never moves audio clips. Pressing Play in the middle of a clip plays it from the right place, and exports are sample-accurate.

### The Slicer: vocal chops

The **Slicer** (**Add Track > Your Sounds > Slicer**) cuts a sound into slices and puts one on each key from C3 up (Slice 1 on C3, Slice 2 on C#3, and so on, up to 64).

- In the Inspector, click **Load a sound…**. **CUT**: **Auto** cuts where it hears a new word or hit (**SENS** sets how faint a hit still starts a slice); **Equal** cuts the sound into 4, 8, 16 or 32 equal slices.
- On the waveform, drag a marker to move a cut, double-click to add one, and right-click a marker to remove it. Click a slice to hear it.
- In the piano roll the rows read **Slice 1**, **Slice 2** and so on. A note plays its slice from the start, for the note's length or the slice's length, whichever is shorter.
- **Pitch** mode: every key plays the slice you last clicked, pitched from its own key, so you can play a chop as a melody.
- **Chop to Slicer…** (right-click an audio clip, or in the clip editor) makes a Slicer track from that clip's sound, with a clip that plays the slices in order, ready to rearrange. The audio clip stays.
- Slices play at the sound's own level; use the track fader to balance it.

### Where your sounds live

Sound files (audio clips, the Slicer and the Sampler) are kept in this browser, once each, shared between tracks and projects, so a big file doesn't fill up autosave. **Save** puts the sounds inside the `.beatbox.json` file, so a saved project opens complete on any computer, and opening it puts the sounds back into the browser. The Audio, Slicer and Sampler panels show how much the browser holds, and **Free unused** deletes the sounds no project on screen or restorable session uses. A clip whose sound was freed shows "Sound not in this browser" until you load the sound again or reopen the project file.

## Trying sounds: Instrument Browser and Audition Deck

### Instrument Browser

Under the timeline. Pick any instrument except the Sampler from the menu and play the on-screen keyboard (or drum pads) with the mouse. Drag a key or pad onto a track that uses the same instrument to add that note. The browser plays instruments "dry", without any track's volume or effects.

### Soundbank Audition Deck

Pads for Slap Bass, Space Clav chords, Brass Stabs, the Drums kit, four recorded instruments and the stock patterns. Click a pad to hear it, or play it from the computer keyboard:

| Keys | Sound |
|---|---|
| `Q` `W` `E` `R` `T` | Kick, snare, closed hat, cowbell, open hat |
| `1` `2` `3` `4` | Slap Bass D1, F1, G1, A1 |
| `A` `S` `D` | Space Clav chords Dm9, G13, Bbmaj7 |
| `Z` `X` | Brass stabs Dm and C |

These keys work anywhere on the page except while typing in a box or with a dialog open. So pressing `R` plays a cowbell rather than arming a track.

Drag a pad or a pattern chip (**Lazy Beat**, **Hats Intro**, **Walking Bass**, **Soul Chords**, **Horn Hook**) onto a matching track: the lanes that accept it light up, the others fade. Drum pads and drum patterns fit either drum kit.

## Mixing and effects

### Track headers

Each track header has **VOL** (-60 to +6 dB) and **PAN** sliders (double-click either to reset), and buttons for **M** (mute), **S** (solo) and **R** (record arm: takes go on this track, one track at a time; arming also selects it). If any track is soloed, only soloed tracks play. Muted and un-soloed tracks are also left out of exports.

Tracks are stereo, so wide sounds keep their width all the way to the master: the Supersaw, Space Clav and Mandolin, the noise in the FX instrument, the **Chorus** effect, recorded instruments with stereo samples, and stereo files in the Sampler. Most synths and mono samples are mono and sit in the middle, and so are the drum kits, effects included (a Chorus on a kit doesn't widen it). **PAN** works as a balance: in the middle both sides play, and turning it towards one side fades out the other, so at full left you hear only the left channel. For a mono sound that's the same as moving it across.

### The Track Inspector (FX Rack)

Click **FX Rack** in the toolbar, or the sliders icon on a track header, to open the Inspector on the right. Click another track's header to switch to it. The **Track FX** tab, top to bottom:

- **SOUND GENERATOR**: the track's instrument. Changing it renames and recolours the track but keeps its clips.
- **DISTORTION**: Drive, from clean at 0% through overdrive to fuzz at 100%. It's a pedal-style overdrive: the lows are tightened, the top is rolled off the harder you drive, and the level stays about the same, so turning it up changes the tone rather than the volume.
- **3-BAND PARAMETRIC EQ**: LOW (400 Hz), MID (1 kHz) and HIGH (2.5 kHz), each -24 to +12 dB. **Reset** flattens them.
- **COMPRESSOR**: Threshold, Ratio and Makeup gain.
- **CHORUS**: Rate, Depth and Mix.
- **FILTER**: **Low-pass**, **High-pass** or **Band-pass**; **Cutoff** (20 Hz to 20 kHz); **Resonance** (Q 0.5 to 15: high values boost a narrow band at the cutoff, up to about +23 dB, so turn the track down when you push it); **Slope** 12 or 24 dB. It comes after the other effects, so it sweeps everything on the track. Moving Cutoff or Resonance while playing glides smoothly.
- **PUMP**: sidechain-style ducking. The track's volume dips and swells back on every **Kick drum** (any drum-kit track's kick that is actually playing), **Every beat** or **Every 1/8**. **Depth** (how far it ducks) and **Release** (50 to 600 ms, how long it takes to come back). A muted or soloed-out kick track doesn't pump, so if you solo the pumped track, solo the drums too.
- **POST-FADER AUX SENDS**: how much of the track goes to the shared reverb and the ping-pong echo.
- **CHANNEL FADER**: the same volume and pan as the header.
- **Delete this track** (also the trash icon at the top). It asks first if the track has clips; `Ctrl+Z` brings the track and its clips back.

Distortion, Compressor, Chorus, Filter and Pump each have an **ON / OFF** switch and start off. An effect that's off is taken out of the sound completely, so it costs nothing. You can switch effects on and off while the song plays without a gap, a click or a doubled sound, however busy the computer is: the change crossfades over 10 ms, about 20 to 30 ms after the click. A Compressor switched on comes in about 0.2 s later, once it has settled, and any other switch on that track in the meantime waits for it. The EQ is on whenever any band isn't at 0 dB. Double-click a Drive, EQ, Compressor or Chorus slider to reset it to its starting value (EQ bands go back to 0 dB); the send, reverb and delay sliders don't reset on double-click (the master OTT and Stereo Width sliders do).

### Master

The Inspector's second tab, **Master**, works on the whole mix. At the top:

- **Loudness**: how loud the song is, measured the way streaming services measure it (LUFS). **Now (3 s)** is the last three seconds, **Since Play** the whole stretch since you last pressed Play, and **Peak** the highest true peak (dBTP). A line under them says what the level means: quiet, about streaming level (around -14 LUFS), loud like a club master, or very loud. The peak turns red above -1 dBTP, where a song can distort once a streaming service converts it. **Reset** starts measuring again. The header shows the **Now** reading too, from the moment audio is running, and turns red with the peak.
- **OTT**: the multiband compressor of bass music. It splits the mix into lows, mids and highs, turns each band's loud parts down and its quiet parts up, and adds back the level it takes, so the mix gets denser, brighter and louder. **Depth** is how much (start around 20 to 40%), **Time** how fast it reacts (snappy to slow), **In gain** drives it harder and **Out gain** turns the result up or down. Raising Out gain pushes the mix into the limiter, which is how you make a master louder.
- **Stereo Width**: makes the mix wider (up to 200%) or narrower (0% is mono). **Keep the bass in the middle** (on by default) leaves everything below about 120 Hz centred however wide the rest goes, so the low end stays strong on club systems and phones.

- **Playback**: how this browser buffers live audio. **Responsive** (the default) has the least delay between a key you play and its sound. **Stable** gives the audio a bigger buffer and more time to schedule notes, so busy moments in big songs play through instead of crackling; Play then starts about a quarter of a second later, and live playing has a few hundredths of a second more delay. It's a setting for this browser, not the project, and takes effect after a reload (the panel offers one; your work is kept, click **Restore** after it).

OTT and Stereo Width sit between the master compressor and the limiter, are off in a new project, are saved with it, can be undone, and switch on or off while the song plays without a gap. They're in exports too.

Under them are the two effects every track shares through its sends:

- **Master Convolution Reverb**: Room Decay Time, from 0.8 s (tight) to 6 s (cathedral).
- **Ping-Pong Echo Delay**: Echo Subdivision (1/4, 1/8, dotted 1/8 or 1/16, locked to the tempo) and Echo Feedback (0 to 80%).

### Tempo, swing and master volume

In the header:

- **TEMPO**: click the number to type a tempo from 40 to 240 BPM, with up to two decimals (`115.25`); Enter sets it, Esc cancels. `-` and `+` change it by 1 BPM, and the slider moves in whole BPM. **TAP** sets it from your clicks: tap at least twice; it averages your last few taps and starts over if you pause for more than 2.5 seconds.
- **FIT**: sets the tempo so part of the song lasts a given time. Choose **Loop In→Out**, **Whole song** or a number of **Bars**, then type the **Target length** in seconds (`25.5`) or as a timecode (`0:25:00`). It shows the new tempo and the resulting length as you type; **Apply** (or Enter) sets it, to 0.01 BPM, picked so the part ends in the frame you typed. Over long stretches at slow tempos it can land a frame either side, and the panel shows the exact result first.
- **SWING**: delays the off-beat 16th notes (the second 16th of each 8th) for a shuffled feel, from 0 to 50%; at 50% they land on the 1/8-triplet line. Downbeats, 8ths, triplets and 1/32 notes stay on the grid. In an 8th where a clip has a 1/32 roll or triplets, that clip plays the whole 8th straight, so rolls stay even (other clips keep swinging). A clip moved off the 16th grid (Shift-drag, Frame snap) swings on its own 16ths. A clip cut off the grid (the razor with Shift, Snap Off or Frame snap, a start trimmed off the grid, or Insert bars at an off-grid point) keeps the swing it had: its notes go on swinging on the song's 16ths. New blank projects start at 20% (the demo song uses 15%). Double-click it for 0% (straight).
- **MASTER**: the final output level (-30 to +6 dB). It also sets the export level, but it isn't saved with the project.

Every track goes through a master compressor and a limiter that holds peaks just under full scale, so at MASTER 0 dB or lower playback never clips and sounds the same as your exports. MASTER is applied after the limiter, so above 0 dB playback can clip (exports are turned down to fit).

Mixer and effect changes can be undone with `Ctrl+Z`; tempo, swing and master volume can't.

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

## Automation

Automation makes a track setting change over the song: a filter opening during a build-up, a fade-out, a pan sweep, an echo on one word. You draw a line, and the setting follows it every time the song plays and in every export.

### Opening a lane

Click the **curve button** in a track header ("Show automation"; it's tinted amber when the track has automation). The track's lane switches to **automation view**: its clips are dimmed and can't be edited there, and the header shows **LANE**, the number of points and the value at the playhead. Use **LANE** to pick the setting: **Volume**, **Pan**, **Filter Cutoff**, **Filter Resonance**, **Reverb Send**, **Delay Send**, **EQ Low**, **EQ Mid** or **EQ High**. A ● marks settings that already have points. Click the curve button again to go back to the clips.

### Drawing

- Click empty space to add a point (time snaps to the SNAP grid; hold Shift for free time), or click the line to add a point on it.
- Drag a point to move it: time snaps, the value is free, and Shift during the drag stops snapping. Points can't pass their neighbours, but two can share a bar for an instant jump. Alt+drag leaves a copy behind.
- Drag the line between two points to move both up or down.
- Drag a box on empty space to select points (Shift or Ctrl adds). `Delete` deletes them; `Esc` clears the selection. Double-click or right-click a point to delete just that one.
- **Right-click the lane** for **Ramp up In → Out** and **Ramp down In → Out** (a one-click build-up or fade over the loop region), **Delete selected points**, **Clear lane** and **Remove lane**. Ramps go from silence to the fader level for Volume, 200 Hz to 20 kHz for Filter Cutoff, -24 dB to 0 dB for EQ, and bottom to top for the others.
- Every gesture is one undo step.

### How it plays

- Lanes run between their points in straight lines; before the first point and after the last they hold that point's value. Volume works like a mixing fader (-60 dB silent to +6 dB; 0 dB is about 84% up); Cutoff (20 Hz to 20 kHz) and Resonance (Q 0.5 to 15) are logarithmic; Pan runs L100 to R100; sends 0 to 100%; EQ -24 to +12 dB.
- While a lane has points it owns that setting: its control shows **AUTO**, follows the lane and can't be moved (click **AUTO** to open the lane). Clear or remove the lane to get the control back.
- Filter lanes only sound while the track's **Filter** is on. Drawing a Filter lane's first point turns it on; if you switch the Filter off later, the lane is kept, dimmed, with a **Turn filter on** button.
- Exports (mixdown and stems) follow lanes to within a millisecond. While playing, an edit, seek or undo is heard on the new line within about a tenth of a second; jumps glide over 4 ms so they don't click.
- Insert and Delete bars on the ruler move points with the music, deleting a track deletes its lanes (Undo brings them back), and lanes are saved with the project.

## Projects: saving and opening

The project bar sits above the toolbar.

- **Project name**: click it to rename. It's used for the file names when you save and export.
- **New**: start a **Blank timeline** (four empty tracks), load the **Demo song** (Sunset Stroll, 88 BPM), or start from one of 24 **genre starters** in four groups: **Electronic** (Dubstep, House, Trance, Drum & Bass, Synthwave, Chiptune), **Orchestral & Choir** (Classical, Angelic, Cinematic, Epic Orchestral, Horror), **Band** (Rock, Metal, Pop, Funk, Jazz, Hip-Hop, Trap) and **Chill & World** (Lo-Fi, Ambient, Celtic, Fantasy Tavern, Latin, Eastern). Each starter is 16 bars with its sections marked (intro, build, drop, and so on), the loop on the main section, its tracks mixed and the master's OTT and Stereo Width set for the style. Change anything; it's an ordinary project. This replaces what's on screen and clears undo, so save first.
- **Open**: load a `.beatbox.json` project file. Like New, it replaces what's on screen straight away and clears undo, so save first. If the file can't be read, a red message explains why and nothing is replaced. You can also drop a `.beatbox.json` file anywhere on the page: a drop onto an empty timeline opens it at once, and when there's work on the timeline a dialog asks before replacing it.
- **Share**: three ways to send the song to someone:
  - **A link to this song**: the whole song travels inside the link (nothing is uploaded anywhere), and opening it opens the song in Bo's Beatbox, ready to play and change. **Copy link**, or **Share…** for your device's share menu. Sound files (audio clips, Sampler and Slicer sounds) can't go in a link, so the dialog says which tracks would be silent; frozen tracks just play live. A very long link can be cut off by some chat apps: the dialog warns when it's long.
  - **The song as an MP3**: the whole song mixed, handed to your share menu where the browser can (phones, Windows, Safari on a Mac), or downloaded.
  - **The project file**: everything, sound files included, shared or downloaded the same way.

  Opening a shared link on a page that already has work on its timeline asks first.
- **Save**: downloads the project as `<name>.beatbox.json` to your downloads folder. Keep this file: it's the only way to move a project to another browser or computer.

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
- Velocity, note-off, the sustain pedal and all-notes-off work on every instrument. The pitch bend wheel (±2 semitones) works on Slap Bass, Sub Bass, 808, Lead, Space Clav, Brass Stabs and Pad.
- On a drum kit, the standard General MIDI drum pads (kick 36, snare 38, hats 42 and 46) play the kit's sounds.

### The computer keyboard as a piano

In the MIDI popover, tick **Computer keyboard piano**. `A` `S` `D` `F` `G` `H` `J` `K` `L` `;` `'` are the white keys from C, `W` `E` `T` `Y` `U` `O` `P` the black keys, and `Z` / `X` move an octave down or up. Notes play at a fixed velocity. While it's on, those keys play notes instead of their usual jobs (the Audition Deck pads, `L`, `O`); Space and the other shortcuts still work. It's off by default.

## Recording

1. Arm a track with **R** on its header (one track at a time; Audio tracks can't be armed).
2. Switch **Record** on (the red circle in the toolbar).
3. Press **Play**. With the **1-bar count-in** on (the default) you hear four clicks first, then the music and the take start together.
4. Play. Notes are placed where you heard them against the music, with their velocity and length.
5. **Pause**, **Stop** or switching Record off ends the take. It becomes a clip named **Take 1**, **Take 2** and so on, on whole bars. Switching Record on while playing starts a take right there (punch-in).

- **Undo** removes the whole take in one step. With **Quantize** on, the notes are snapped when you stop, as a second step: the first `Ctrl+Z` puts them back where you played them, the second removes the take.
- **Loop recording**: with the loop on, every pass adds to the same take, so you can build a part up pass by pass.
- Takes are ordinary clips: swing, editing, Insert/Delete bars and export work on them like any other.
- **Recording settings** (the arrow next to Record): **1-bar count-in**, **Quantize** (Off, 1/16, 1/8 or 1/16T), **Metronome while playing** and **Click level**. These are kept in your browser, not in the project.

### Metronome

The **metronome** button in the toolbar clicks on every beat while playing, louder on beat 1 of each bar. It follows the tempo, ignores swing, and is never in an exported WAV. The count-in clicks even when the metronome is off.

## Exporting audio

Click **Export**. The dialog has four choices, and remembers them in this browser:

- **Range**: **Whole song** (bar 1 to the end of the last clip that plays), **Loop region** (In to Out, whether or not the loop is on), or **Intro + loop** (for games, below). For the loop, the dialog shows where it starts as a timecode at your frame rate.
- **Export**: **Mixdown** (one stereo WAV of everything that plays) or **Stems**. For a mixdown, **Normalize to -14 LUFS** turns the whole file up or down to the loudness Spotify, YouTube and Apple Music play at, without letting its true peak pass -1 dBTP. If that would push the peak too high, the file stops short of -14 LUFS and the message says by how much; turn on the master **OTT** and raise its **Out gain** to get louder. When a mixdown finishes, its loudness and peak show at the bottom of the screen. **Stems** (one WAV per track that plays and has clips in the range, in one .zip). Stems all start at the range start and have the same length, so they line up in another program, and each includes the track's effects, sends and the shared reverb and echo. **Bypass master compressor & limiter** (on by default) makes the stems add up to the mix as it is before the master compressor and limiter.
- **Ending**:
  - **Ring out**: the range, then a few seconds more so reverb and echo tails ring out (the dialog says how long).
  - **Exact length**: exactly the range, to the sample, with a 5 ms fade at the very end so it doesn't click.
  - **Seamless loop** (Loop region only): exactly one loop long, with the tails of the pass before already ringing at its start, so it repeats in a game engine or looping player without a gap or click. It stays exactly on the beat at any tempo, fractional ones included.
- **Format**: the **file type**: **WAV** (uncompressed and exact, the only one that holds markers and loop points), **MP3** (320 kb/s, plays everywhere) or **OGG** (Ogg Vorbis, about 256 kb/s, the best compressed format for games: Godot and Unity loop it without a gap). Then **44.1 kHz** or **48 kHz**, and for WAV **16-bit**, **24-bit** or **32-bit float**. Always stereo. An MP3 can have a few milliseconds of silence added at its start by the format itself, so use OGG or WAV for anything that has to loop seamlessly.

### Video (MP4)

Choose **Export: Video (MP4)** to turn the song (or the loop region) into a video for YouTube, socials or a game's trailer: 1280×720 at 30 frames a second, with the mix as its sound and a visualizer as its picture. It shows the project's name, a spectrum that moves with the music, the whole song's waveform with a playhead, the section you're in (from your markers) and the time. It's made faster than real time: a 30-second song takes about 20 seconds. **Normalize** sets it to -14 LUFS, the loudness YouTube plays at.

Videos need Chrome or Edge (or another browser with WebCodecs) on a site served over https. On Windows and Mac they're H.264 with AAC sound, which plays everywhere; where the browser doesn't have those, they're VP9 or AV1 with Opus sound, which browsers, VLC, YouTube and Discord play but some older players don't.

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

Shortcuts don't work while you're typing in a box, or while a dialog or panel (Guide, Export, New, FIT, Loop range, Markers) is open. On a focused slider, the arrow keys, Home, End, Page Up and Page Down move the slider and every other key is still a shortcut. A drop-down menu lets go of the keyboard after you pick from it with the mouse.

### Timeline

| Keys | Action |
|---|---|
| `Space` | Play / pause |
| `V` / `C` | Selection tool / Razor tool |
| `L` | Loop on / off |
| `I` / `O` | Set loop In / Out at the playhead |
| `Home` | Go to the loop In point |
| `M` | Add a marker at the playhead |
| `,` / `.` | Jump to the previous / next marker |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |
| `Ctrl+A` | Select all clips |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste at the playhead |
| `Ctrl+D` | Duplicate the selection as a block right after itself |
| `Delete` or `Backspace` | Delete selected clips |
| `Esc` | Clear the selection |
| `+` / `-` | Zoom in / out (around the playhead) |
| `?` | Open this guide |
| `Q` `W` `E` `R` `T`, `1`–`4`, `A` `S` `D`, `Z` `X` | Play Audition Deck pads (see Trying sounds); with the computer keyboard piano on, `A`–`'` and `W`–`P` play notes and `Z` / `X` change octave |

On a Mac, use `Cmd` instead of `Ctrl`.

### Mouse

| Gesture | Action |
|---|---|
| Shift on the ruler, with the Razor, on right-click or a pad drop; or after you start dragging a clip | Ignore snap (loop brackets and piano-roll notes always snap) |
| Alt (Option) + drag a clip | Duplicate it |
| Drag a clip up or down | Move it to another track that can play it |
| Ctrl / Cmd + mouse wheel, or pinch | Zoom around the pointer |
| Right-click the ruler | Add a marker here, a build-up & drop, insert bars here, or delete the bars between In and Out |
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

- Songs can be up to 400 bars long, in 4/4, at one tempo (40 to 240 BPM, to 0.01 BPM). The shortest loop is a 16th note.
- For EDM, set **Swing** to 0% (new blank projects start at 20%). Dubstep is usually 140 BPM with the snare on beat 3 (half-time), house around 124 to 128, drum & bass around 174.
- Projects that use Wobble Bass, Growl Bass, Reese Bass, Supersaw, Pluck, FX, Audio tracks or the Slicer only open in this version of the app or later.
- Recorded instruments (piano, strings, winds and others) download their sounds the first time you use them, so they need an internet connection. Everything else works offline.
- Muted tracks, and tracks silenced by another track's Solo, don't play their notes at all, which saves processing power on big songs.
- If playback stutters on a big song, freeze the tracks you aren't changing (the snowflake in each track's header), switch **Playback** to **Stable** in the Inspector's Master tab, mute tracks you aren't working on, or switch off effects you don't need. Exporting never stutters, it just takes longer.
- Sounds you load are kept in this browser; a private window may not allow it. Save the project to keep its sounds safe.

## Credits

The synths and drum kits are generated in your browser. The recorded instruments play free sample libraries that people made and shared. Thank you to all of them.

### Recorded instruments

| Instrument | Samples | Licence |
|---|---|---|
| Grand Piano | Salamander Grand Piano by Alexander Holm, from the [Tone.js audio collection](https://github.com/Tonejs/audio) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Bass Guitar, Electric Guitar, Saxophone | Karoryfer Samples | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Acoustic Guitar | University of Iowa Electronic Music Studios | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Erhu, Harp, Trumpet, French Horn, Flute | Versilian Studios Orchestra (VSCO 2) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Violin, Cello, Strings | Musyng Kite SoundFont, rendered by Benjamin Gleitzman's [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| Taiko Drums, Electric Piano, Pipe Organ, Marimba, Chimes, Mandolin | FluidR3 GM SoundFont by Frank Wen, rendered by Benjamin Gleitzman's [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

- The guitar, bass, saxophone, strings, harp, flute and brass samples were collected and edited (trimmed, volume-matched, cleaned up and tuned) by Nicholaus Brosowsky for [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments). Its samples are released under CC BY 3.0.
- The Erhu is shaped in the app from the VSCO violin, and the Mandolin from the FluidR3 steel-string guitar. The Electric and Acoustic Guitar recordings go through an amp stage and a brightening in the app. The Violin, Cello and Strings notes are 3 seconds long in the soundfont, so the app loops their steady part when it loads them and a note can be held for about 10 seconds. The top octave of the Violin, Erhu, Strings and Flute plays quieter so it doesn't pierce.
- Bo's Beatbox loads these samples straight from the projects above; it doesn't copy or change the files.

### Software

Built with [Tone.js](https://github.com/Tonejs/Tone.js) by Yotam Mann, [standardized-audio-context](https://github.com/chrisguttandin/standardized-audio-context) and automation-events by Christoph Guttandin, [React](https://react.dev), [zustand](https://github.com/pmndrs/zustand) by Paul Henschel, [Lucide](https://lucide.dev) icons, @babel/runtime and tslib. They are open source under the MIT licence, except Lucide (ISC) and tslib (0BSD). Their full licence texts come with the app: in `third-party-licenses.txt` next to a web build, and in a comment at the top of the single-file `Bos-Beatbox.html`.
