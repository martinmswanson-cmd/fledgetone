# Bo's Beatbox guide

## Getting started

Bo's Beatbox is a music maker that runs in your browser. You build a song on the **Arrangement Timeline** out of **tracks** (one instrument each) and **clips** (blocks of notes on a track), mix it, and export it as a WAV file.

1. Click **START AUDIO** in the top-right corner. Browsers only allow sound after you click something, so the button glows red until audio is running. Pressing Play also starts it.
2. To hear an example, click **New** above the timeline and choose **Demo song**.
3. Press **Space** (or the green Play button) to play, and Space again to pause.
4. Double-click a clip to open its notes in the **piano roll** under the timeline.

At the top is the header: **TEMPO** and **TAP**, **Swing**, **MASTER** volume, **GUIDE** and **START AUDIO**. Under it, top to bottom:

- **Arrangement Timeline**: the project bar (name, New, Open, Save, Export WAV), the toolbar, the ruler, your tracks, the Overview strip and the piano roll.
- **Instrument Browser**: try every instrument on an on-screen keyboard.
- **Interactive Soundbank Audition Deck**: pads you can click or play from the keyboard, and drag onto the timeline.

> The app always opens on an empty timeline. If your last session had clips, a banner offers to **Restore** it, saying when it was saved. It stays across reloads until you click **Restore** or **Dismiss**.

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

Right-click the time ruler. The menu acts on **all tracks** at the point you clicked (on the snap grid; Shift for the exact point):

- **Insert 1, 2, 4 or 8 bars here**: adds empty bars. Clips that cross the point are cut in two there, and everything after it moves right. If that would push a clip past bar 401, nothing changes and the menu says so.
- **Delete bars In → Out**: removes the loop's range. Clips inside it go, clips that cross IN or OUT lose the part inside, and everything after it moves left to close the gap.

The loop and the playhead move with the music. Each edit is one Undo step; undo brings the clips back, but the loop and playhead stay where the edit put them.

### Creating clips

- With the Selection tool, double-click empty lane space for a new 1-bar clip starting on that beat (whatever SNAP is set to). It opens in the piano roll.
- Right-click empty lane space for empty clips of 1, 2 or 4 bars, ready-made patterns (Drums, Drum Machine, Slap Bass, Space Clav and Brass Stabs have them), and Paste.
- The **+** in a track header opens the same menu at the playhead.
- Drag a pad from the Audition Deck onto a matching track (any drum kit accepts drum pads). Dropping inside a clip adds the notes to it; dropping on empty space makes a new clip.

### Snap

The **SNAP** menu in the toolbar sets the grid that clip moves, trims, razor cuts, the playhead, the loop brackets and paste land on: **1/4** (a beat), **1/8**, **1/16**, **Frame** (one video frame, see Timecode & frame rates) or **Off**. Hold **Shift** to ignore snap when clicking or dragging on the ruler, razor-cutting, right-clicking or dropping a pad; for clip moves and trims, start the drag first and then hold Shift. The loop brackets always snap: set SNAP to Off to place them freely. The snap step is also the shortest a clip or the loop can be (never less than a 16th).

### Zoom and scrolling

- Zoom with the slider at the right of the toolbar, or `+` and `-` (they keep the playhead where it is on screen when it's visible). **Ctrl+mouse wheel** (Cmd on a Mac) or a trackpad pinch zooms around the pointer. Zoom goes from 12 to 1280 pixels per bar, deep enough to see single video frames.
- Zoomed in, the lanes show faint lines on every 16th, or on every frame when SNAP is Frame.
- Scroll in time with **Shift+mouse wheel**, a sideways trackpad swipe, or the **Overview** strip under the tracks: drag its cyan window to scroll, click anywhere on it to jump, and drag either end of the window to zoom.
- While playing, the view follows the playhead.

### Undo

`Ctrl+Z` undoes and `Ctrl+Shift+Z` or `Ctrl+Y` redoes, up to 100 steps. Undo covers:

- clip and note edits;
- adding and deleting tracks (Undo brings a deleted track back with its clips), and changing a track's instrument;
- M, S and R, VOL and PAN, the EQ, Distortion, Compressor, Chorus, the sends and the Master Aux Bus;
- loading, replacing or removing a Sampler sound, and its **Original pitch on** note.

One slider adjustment is one step, whether you drag it, tap its arrow keys or double-click to reset it. Tempo, swing, the loop, zoom, snap, frame rate, ruler units, master volume and the project name are not undone.

## Playback and the loop

- **Play / Pause**: the green button or `Space`. Playback starts from the playhead. With the loop on, a playhead at or past OUT jumps straight back to IN, so to play later parts turn the loop off (`L`) or move OUT.
- **Stop** (the square): stops and sends the playhead back to the loop's In point.
- **Go to In** (the skip-back button, or `Home`).
- **Playhead**: click or drag anywhere on the ruler, or drag the red line. Works while playing too.

### The loop

The amber region on the ruler, between the **IN** and **OUT** brackets, is the loop. With loop on (the Repeat button or `L`), playback goes round it. With it off, playback runs to the end of the timeline.

- Drag the IN and OUT brackets, or move the playhead and press `I` (set In) or `O` (set Out). They follow the snap grid; set SNAP to Off to place them anywhere.
- For exact values, click the small chevron (˅) right of the Loop button. **Loop range** has **In**, **Out** and **Length** boxes in the ruler's units (bars, or timecode in Time mode); each accepts bars (`17.3`) or a timecode (`00:00:12:15`), and Length takes bars.beats (`2.2`) or a timecode duration. Enter applies. Typed values don't snap. Typing an In at or after the current Out moves the whole loop there.
- A new project loops bars 1 to 5, so at first you only hear 4 bars. Press `L` to turn the loop off, or move OUT.

### Going to an exact position

Both readouts in the toolbar are also input boxes. Click one, type a position, and press **Enter** to jump the playhead there (`Esc` cancels):

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

Set **SNAP** to **Frame** to make clip moves, clip edges, razor cuts, the playhead and the loop brackets land exactly on video frames at the current frame rate. (A clip made by double-clicking a lane still starts on a beat; drag it to put it on a frame.) The Export dialog also shows the loop's start timecode, so you know where a loop export sits against the picture.

> For frame-accurate work, **set the tempo and frame rate first**: positions are stored in bars, so changing either one leaves things off the new frame grid. Also set **Swing** to 0%, because swing delays every other 16th note slightly.

Frame snap applies to the timeline. Notes you write in the piano roll sit on its own grid (1/16, 1/8 or 1/4), counted from the clip's start. A pad dropped into a clip with Frame snap on lands on a frame instead; the piano roll shows it at the nearest 16th, and moving or nudging it puts it back on the grid.

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

**Fine grids and triplets.** **T** means triplet: three in the space of two, so 1/16T puts six notes in a beat and 1/8T three. Clicking places a note on the grid line at or before the pointer. Dragging a note, or its right edge, snaps it to the grid, and the arrow keys move notes one grid step. Changing the grid never moves existing notes. Zoom in (the magnifier) for comfortable 1/32 editing. Swing also shifts triplet and 1/32 notes, so set **Swing** to 0% for straight hi-hat rolls and triplets.

> With no notes selected, `Delete` acts on the timeline and deletes the selected clip, usually the one you're editing. `Ctrl+Z` brings it back.

## Instruments

Each track plays one instrument. Add a track with **+ Add Track** under the last track, or change a track's instrument in the Track Inspector (**SOUND GENERATOR**). There are 34 instruments in 9 groups:

| Group | Instruments |
|---|---|
| Drums & Percussion | Drums (analog kit), Drum Machine (808-style), Taiko Drums |
| Bass | Slap Bass, Sub-Bass, 808 Bass, Bass Guitar, Wobble Bass, Growl Bass, Reese Bass |
| Keys & Synths | Grand Piano, Electric Piano, Space Clav, Wavetable Synth, Analog Lead, Pipe Organ, Supersaw, Pluck |
| Guitars & Strings | Acoustic Guitar, Electric Guitar, Mandolin, Harp, Violin, Cello |
| Winds & Brass | Brass Stabs, Saxophone, Trumpet, French Horn, Flute |
| Mallets & Bells | Marimba, Chimes |
| World | Erhu |
| FX | FX (risers, sweeps, impacts, drops) |
| Your Sounds | Sampler (plays a sound file you load) |

- **Synths and drum kits** (Drums, Drum Machine, Slap Bass, Sub-Bass, 808 Bass, Wobble Bass, Growl Bass, Reese Bass, Space Clav, Wavetable Synth, Analog Lead, Supersaw, Pluck, Brass Stabs and FX) are generated in the browser and work offline.
- **Recorded instruments** (the other 18) download their sounds the first time you use them, so they need an internet connection. A spinner shows on the track header while they load, and the Inspector shows **Loading CDN...**, **Ready** or **Error**. Notes are silent until the sounds arrive. If a download fails, the track header shows a red **!** in place of its coloured dot and the Inspector shows **Error** with a **Retry** button; click either to try again. Failed downloads are also retried when your connection comes back, and when you play that instrument in the Instrument Browser or Audition Deck, add another track with it or export. Once it downloads, every track using it plays from its next note, with no reload.
- Both drum kits use the same five notes: **Kick**, **Snare**, **Closed Hat**, **Open Hat** and **Cowbell**, so drum parts can move between them. Taiko is played like a pitched instrument.
- Slap Bass, Sub-Bass, 808 Bass and Analog Lead play one note at a time; in a chord, only the loudest note sounds. Space Clav (16 notes at once), Wavetable Synth (12) and Brass Stabs (8) cut short whichever ringing note would end soonest when they run out, so new notes still play (only notes beyond the limit that start at the very same moment are dropped).

### EDM instruments

- **Wobble Bass**: the dubstep wobble, a filter sweeping in time with the beat. **Growl Bass**: the talking riddim growl, a vowel filter ("oo", "ah", "eh") swept the same way. **Reese Bass**: detuned saws that beat slowly, for drum & bass and dubstep.
- These three play one note at a time (the loudest wins). A note that starts before the previous one ends **slides** to its pitch without re-attacking: draw a note a little longer so it overlaps the next one. Notes that don't overlap start fresh.
- **WOBBLE** in the piano roll header (Wobble and Growl only) sets the wobble rate for the whole clip: **1/1**, **1/2**, **1/4**, **1/8** (default), **1/8T**, **1/16**, **1/16T** or **1/32**. Each note restarts the sweep, so wobbles stay locked to the beat. Different clips can use different rates; the rate shows as a small tag on the clip, is saved with the project, and travels with copies. Changing it is one undo step.
- **Supersaw**: seven detuned saws per note, spread wide, for house and trance chords. **Pluck**: a short, bright pluck for melodies and arps. Both play chords.
- **FX** has fixed rows like a drum kit: **Riser**, **Noise Sweep**, **Reverse Crash**, **Impact**, **Sub Drop** and **Downlifter**. Every effect except Impact lasts as long as the note you draw: draw a 4-bar note for a 4-bar riser, and end a Reverse Crash on the drop. Impact is a one-shot boom of about 3.5 s. In an FX clip, NEW NOTE starts at 1 bar, and clicking a row's name previews it. FX clips only go on FX tracks.
- Right-click an empty spot on a lane of these instruments for ready-made parts: **Wobble Riff**, **Growl Riff**, **Reese Line**, **Trance Chords**, **Pluck Arp**, and for FX a **Build-Up** and a **Drop Hit**.

### The Sampler: your own sound

1. Add a track with **Your Sounds > Sampler** (or switch a track to Sampler).
2. In the Inspector, click **Load a sound…** and pick an audio file (WAV, MP3, OGG and most others) under 3 MB.
3. Under **ORIGINAL PITCH ON**, choose which C (C2, C3, C4, C5 or C6; C4 by default) plays the file at its normal pitch. Higher notes play it faster and higher, lower notes slower and lower.
4. Write notes for it in the piano roll like any other instrument.

The sound is stored inside the project, so saved projects bring it with them. It plays only as long as each note lasts (then fades out quickly), so draw long notes for long sounds. The play button previews a half note at the original pitch; the trash button removes the sound (`Ctrl+Z` brings it back).

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

Each track header has **VOL** (-60 to +6 dB) and **PAN** sliders (double-click either to reset), and buttons for **M** (mute), **S** (solo) and **R** (record arm, which doesn't do anything yet). If any track is soloed, only soloed tracks play. Muted and un-soloed tracks are also left out of exports.

### The Track Inspector (FX Rack)

Click **FX Rack** in the toolbar, or the sliders icon on a track header, to open the Inspector on the right. Click another track's header to switch to it. The **Track FX** tab, top to bottom:

- **SOUND GENERATOR**: the track's instrument. Changing it renames and recolours the track but keeps its clips.
- **DISTORTION**: Drive.
- **3-BAND PARAMETRIC EQ**: LOW (400 Hz), MID (1 kHz) and HIGH (2.5 kHz), each -24 to +12 dB. **Reset** flattens them.
- **COMPRESSOR**: Threshold, Ratio and Makeup gain.
- **CHORUS**: Rate, Depth and Mix.
- **FILTER**: **Low-pass**, **High-pass** or **Band-pass**; **Cutoff** (20 Hz to 20 kHz); **Resonance** (Q 0.5 to 15: high values boost a narrow band at the cutoff, up to about +23 dB, so turn the track down when you push it); **Slope** 12 or 24 dB. It comes after the other effects, so it sweeps everything on the track. Moving Cutoff or Resonance while playing glides smoothly.
- **PUMP**: sidechain-style ducking. The track's volume dips and swells back on every **Kick drum** (any drum-kit track's kick that is actually playing), **Every beat** or **Every 1/8**. **Depth** (how far it ducks) and **Release** (50 to 600 ms, how long it takes to come back). A muted or soloed-out kick track doesn't pump, so if you solo the pumped track, solo the drums too.
- **POST-FADER AUX SENDS**: how much of the track goes to the shared reverb and the ping-pong echo.
- **CHANNEL FADER**: the same volume and pan as the header.
- **Delete this track** (also the trash icon at the top). It asks first if the track has clips; `Ctrl+Z` brings the track and its clips back.

Distortion, Compressor, Chorus, Filter and Pump each have an **ON / OFF** switch and start off. An effect that's off is taken out of the sound completely, so it costs nothing. The EQ is on whenever any band isn't at 0 dB. Double-click a Drive, EQ, Compressor or Chorus slider to reset it to its starting value (EQ bands go back to 0 dB); the send and Master Aux Bus sliders don't reset on double-click.

### Master Aux Bus

The Inspector's second tab sets the two effects every track shares through its sends:

- **Master Convolution Reverb**: Room Decay Time, from 0.8 s (tight) to 6 s (cathedral).
- **Ping-Pong Echo Delay**: Echo Subdivision (1/4, 1/8, dotted 1/8 or 1/16, locked to the tempo) and Echo Feedback (0 to 80%).

### Tempo, swing and master volume

In the header:

- **TEMPO**: click the number to type a tempo from 40 to 240 BPM, with up to two decimals (`115.25`); Enter sets it, Esc cancels. `-` and `+` change it by 1 BPM, and the slider moves in whole BPM. **TAP** sets it from your clicks: tap at least twice; it averages your last few taps and starts over if you pause for more than 2.5 seconds.
- **FIT**: sets the tempo so part of the song lasts a given time. Choose **Loop In→Out**, **Whole song** or a number of **Bars**, then type the **Target length** in seconds (`25.5`) or as a timecode (`0:25:00`). It shows the new tempo and the resulting length as you type; **Apply** (or Enter) sets it, to 0.01 BPM, picked so the part ends in the frame you typed. Over long stretches at slow tempos it can land a frame either side, and the panel shows the exact result first.
- **SWING**: delays every other 16th note for a shuffled feel (0 to 50%). New blank projects start at 20% (the demo song uses 15%). Double-click it for 0% (straight).
- **MASTER**: the final output level (-30 to +6 dB). It also sets the export level, but it isn't saved with the project.

Every track goes through a master compressor and a limiter that holds peaks just under full scale, so at MASTER 0 dB or lower playback never clips and sounds the same as your exports. MASTER is applied after the limiter, so above 0 dB playback can clip (exports are turned down to fit).

Mixer and effect changes can be undone with `Ctrl+Z`; tempo, swing and master volume can't.

## Projects: saving and opening

The project bar sits above the toolbar.

- **Project name**: click it to rename. It's used for the file names when you save and export.
- **New**: start a **Blank timeline** (four empty tracks) or load the **Demo song** (Sunset Stroll, 88 BPM). This replaces what's on screen and clears undo, so save first.
- **Open**: load a `.beatbox.json` project file. Like New, it replaces what's on screen straight away and clears undo, so save first. If the file can't be read, a red message explains why and nothing is replaced.
- **Save**: downloads the project as `<name>.beatbox.json` to your downloads folder. Keep this file: it's the only way to move a project to another browser or computer.

A project file holds the tracks, clips, mixer and effect settings, tempo, swing, loop, master reverb and delay, frame rate, and any Sampler sounds. It doesn't hold the master volume, zoom, snap or ruler setting.

### Autosave

The app also saves your work in this browser half a second after every change. The project bar shows **Saved in this browser · <time>**. Next time you open the app, a banner offers to **Restore** it.

- At startup the app sets your last session aside. The banner stays across reloads until you click **Restore** (which replaces what's on screen) or **Dismiss**. Only the most recent session with clips is kept: if you make something else with clips and reload, the banner offers that one instead.
- If autosave fails, the project bar says why in red: the project is too big for browser storage (about 5 MB per site, usually because of big Sampler sounds), storage is full (Dismiss the old session to make room), or the browser blocks storage for this site. While it's failing, closing or reloading the tab asks first, so you can **Save**.
- Autosave is per browser and per site, and private windows don't keep it. Use **Save** for anything you care about.

## Exporting audio (WAV)

Click **Export WAV**. The dialog has four choices, and remembers them in this browser:

- **Range**: **Whole song** (bar 1 to the end of the last clip that plays) or **Loop region** (In to Out, whether or not the loop is on). For the loop, the dialog shows where it starts as a timecode at your frame rate.
- **Export**: **Mixdown** (one stereo WAV of everything that plays) or **Stems** (one WAV per track that plays and has clips in the range, in one .zip). Stems all start at the range start and have the same length, so they line up in another program, and each includes the track's effects, sends and the shared reverb and echo. **Bypass master compressor & limiter** (on by default) makes the stems add up to the mix as it is before the master compressor and limiter.
- **Ending**:
  - **Ring out**: the range, then a few seconds more so reverb and echo tails ring out (the dialog says how long).
  - **Exact length**: exactly the range, to the sample, with a 5 ms fade at the very end so it doesn't click.
  - **Seamless loop** (Loop region only): exactly one loop long, with the tails of the pass before already ringing at its start, so it repeats in a game engine or looping player without a gap or click.
- **Format**: **44.1 kHz** or **48 kHz**; **16-bit**, **24-bit** or **32-bit float**. Always stereo.

The footer shows the file name and its exact length. Exports include the whole mix: volumes, pans, mutes and solos, every effect, sends, the master reverb and delay, swing, and the master volume. If the mix would clip, the file is turned down to just under full scale (stems all by the same amount, so their levels still match).

Exporting renders faster than real time (stems one track after another) and shows its progress. It pauses playback. **Cancel**, Esc or the X stops it.

> Exports need the sounds of every recorded instrument that's playing. If one can't download (for example, when you're offline), the export stops with an error. Mute that track, or switch it to a synth, to export without it.

## Keyboard shortcuts

Shortcuts don't work while you're typing in a box, or while a dialog (Guide, Export, New) is open. On a focused slider, the arrow keys, Home, End, Page Up and Page Down move the slider and every other key is still a shortcut. A drop-down menu lets go of the keyboard after you pick from it with the mouse.

### Timeline

| Keys | Action |
|---|---|
| `Space` | Play / pause |
| `V` / `C` | Selection tool / Razor tool |
| `L` | Loop on / off |
| `I` / `O` | Set loop In / Out at the playhead |
| `Home` | Go to the loop In point |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |
| `Ctrl+A` | Select all clips |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste at the playhead |
| `Ctrl+D` | Duplicate the selection as a block right after itself |
| `Delete` or `Backspace` | Delete selected clips |
| `Esc` | Clear the selection |
| `+` / `-` | Zoom in / out (around the playhead) |
| `?` | Open this guide |
| `Q` `W` `E` `R` `T`, `1`–`4`, `A` `S` `D`, `Z` `X` | Play Audition Deck pads (see Trying sounds) |

On a Mac, use `Cmd` instead of `Ctrl`.

### Mouse

| Gesture | Action |
|---|---|
| Shift on the ruler, with the Razor, on right-click or a pad drop; or after you start dragging a clip | Ignore snap (loop brackets and piano-roll notes always snap) |
| Alt (Option) + drag a clip | Duplicate it |
| Drag a clip up or down | Move it to another track that can play it |
| Ctrl / Cmd + mouse wheel, or pinch | Zoom around the pointer |
| Right-click the ruler | Insert bars here, or delete the bars between In and Out |
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
- Projects that use Wobble Bass, Growl Bass, Reese Bass, Supersaw, Pluck or FX only open in this version of the app or later.
- Recorded instruments (piano, strings, winds and others) download their sounds the first time you use them, so they need an internet connection. Everything else works offline.
- Muted tracks, and tracks silenced by another track's Solo, don't play their notes at all, which saves processing power on big songs.
- If playback stutters on a big song, mute tracks you aren't working on, switch off effects you don't need, or export a WAV: exporting never stutters, it just takes longer.
- The **R** buttons on track headers and the red **Record** button in the toolbar don't record anything yet.

## Credits

The synths and drum kits are generated in your browser. The recorded instruments play free sample libraries that people made and shared. Thank you to all of them.

### Recorded instruments

| Instrument | Samples | Licence |
|---|---|---|
| Grand Piano | Salamander Grand Piano by Alexander Holm, from the [Tone.js audio collection](https://github.com/Tonejs/audio) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Bass Guitar, Electric Guitar, Saxophone | Karoryfer Samples | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Acoustic Guitar | University of Iowa Electronic Music Studios | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Violin, Harp, Trumpet, French Horn, Flute | Versilian Studios Orchestra (VSCO 2) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Cello | "Real cello notes" by flcellogrl on Freesound | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| Taiko Drums, Electric Piano, Pipe Organ, Marimba, Chimes, Mandolin, Erhu | FluidR3 GM SoundFont by Frank Wen, rendered by Benjamin Gleitzman's [MIDI.js Soundfonts](https://github.com/gleitz/midi-js-soundfonts) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |

- The guitar, bass, saxophone, strings, harp, flute and brass samples were collected and edited (trimmed, volume-matched, cleaned up and tuned) by Nicholaus Brosowsky for [tonejs-instruments](https://github.com/nbrosowsky/tonejs-instruments). Its samples are released under CC BY 3.0.
- The Mandolin and Erhu are shaped in the app from the FluidR3 steel-string guitar and violin.
- Bo's Beatbox loads these samples straight from the projects above; it doesn't copy or change the files.

### Software

Built with [Tone.js](https://github.com/Tonejs/Tone.js) by Yotam Mann, [standardized-audio-context](https://github.com/chrisguttandin/standardized-audio-context) and automation-events by Christoph Guttandin, [React](https://react.dev), [zustand](https://github.com/pmndrs/zustand) by Paul Henschel, [Lucide](https://lucide.dev) icons, @babel/runtime and tslib. They are open source under the MIT licence, except Lucide (ISC) and tslib (0BSD). Their full licence texts come with the app: in `third-party-licenses.txt` next to a web build, and in a comment at the top of the single-file `Bos-Beatbox.html`.
