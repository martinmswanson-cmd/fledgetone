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

> The app always opens on an empty timeline. If your last session had clips, a banner offers to **Restore** it. Any change you make overwrites the copy saved in the browser half a second later, but the banner keeps your last session until you click **Dismiss** or leave the page. So restore before you reload or close the tab.

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

- **Move**: drag the middle of a clip. All selected clips move together. Clips move in time only; they stay on their track. To ignore snap, start dragging and then hold **Shift** (Shift-clicking a clip selects it instead).
- **Duplicate**: hold **Alt** (Option on a Mac) and drag. Copies stay behind and the originals move. `Ctrl+D` places a copy of each selected clip right after itself.
- **Trim**: drag a clip's left or right edge. Trimming hides notes rather than deleting them, so dragging the edge back brings them back. Zoom in if a clip is too narrow to show its edge handles.
- **Copy, cut, paste**: `Ctrl+C`, `Ctrl+X`, `Ctrl+V`. Paste lands at the playhead (on the snap grid), on the tracks the clips came from, and selects the pasted clips. When playback is stopped, the playhead then moves to the end of the paste, so pressing `Ctrl+V` again lays copies end to end. Clips whose track no longer exists aren't pasted. Right-click empty lane space for **Paste here**.
- **Delete**: `Delete` or `Backspace`.
- Right-click a clip for **Edit notes**, Copy, Cut, Duplicate, Paste here and Delete.

### Creating clips

- With the Selection tool, double-click empty lane space for a new 1-bar clip starting on that beat (whatever SNAP is set to). It opens in the piano roll.
- Right-click empty lane space for empty clips of 1, 2 or 4 bars, ready-made patterns (Drums, Drum Machine, Slap Bass, Space Clav and Brass Stabs have them), and Paste.
- The **+** in a track header opens the same menu at the playhead.
- Drag a pad from the Audition Deck onto a matching track (any drum kit accepts drum pads). Dropping inside a clip adds the notes to it; dropping on empty space makes a new clip.

### Snap

The **SNAP** menu in the toolbar sets the grid that clip moves, trims, razor cuts, the playhead, the loop brackets and paste land on: **1/4** (a beat), **1/8**, **1/16**, **Frame** (one video frame, see Timecode & frame rates) or **Off**. Hold **Shift** to ignore snap when clicking or dragging on the ruler, razor-cutting, right-clicking or dropping a pad; for clip moves and trims, start the drag first and then hold Shift. The loop brackets always snap: set SNAP to Off to place them freely. The snap step is also the shortest a clip or the loop can be (never less than a 16th).

### Zoom and scrolling

- Zoom with the slider at the right of the toolbar, or `+` and `-`.
- Scroll in time with **Shift+mouse wheel**, a sideways trackpad swipe, or the **Overview** strip under the tracks: drag its cyan window to scroll, click anywhere on it to jump, and drag either end of the window to zoom.
- While playing, the view follows the playhead.

### Undo

`Ctrl+Z` undoes and `Ctrl+Shift+Z` or `Ctrl+Y` redoes, up to 100 steps. Undo covers clip and note edits only. Mixer settings, adding or deleting tracks, tempo, loop, zoom and snap are not undone.

## Playback and the loop

- **Play / Pause**: the green button or `Space`. Playback starts from the playhead. With the loop on, a playhead at or past OUT jumps straight back to IN, so to play later parts turn the loop off (`L`) or move OUT.
- **Stop** (the square): stops and sends the playhead back to the loop's In point.
- **Go to In** (the skip-back button, or `Home`).
- **Playhead**: click or drag anywhere on the ruler, or drag the red line. Works while playing too.

### The loop

The amber region on the ruler, between the **IN** and **OUT** brackets, is the loop. With loop on (the Repeat button or `L`), playback goes round it. With it off, playback runs to the end of the timeline.

- Drag the IN and OUT brackets, or move the playhead and press `I` (set In) or `O` (set Out). They follow the snap grid; set SNAP to Off to place them anywhere.
- A new project loops bars 1 to 5, so at first you only hear 4 bars. Press `L` to turn the loop off, or move OUT.

### Going to an exact position

Both readouts in the toolbar are also input boxes. Click one, type a position, and press **Enter** to jump the playhead there (`Esc` cancels):

- **BAR.BEAT.TICK**: a bar (`17`), a bar and beat (`17.3`) or bar, beat and hundredths of a beat (`17.3.50`).
- **TIMECODE**: a timecode (see below).

## Timecode and frame rates

The **TIMECODE** readout shows the playhead as hours, minutes, seconds and frames (`HH:MM:SS:FF`), counted from the start of bar 1 at the song's tempo. Use it to line music up with video or a game.

### Choosing a frame rate

Click the frame rate next to **TIMECODE** (it starts at **30 FPS**) and pick **24**, **25**, **30** or **60** fps:

| Rate | Typical use |
|---|---|
| 24 fps | Film and animation at a true 24 fps |
| 25 fps | PAL video (Europe, Australia) |
| 30 fps | Games, screen recordings and web video at a true 30 fps |
| 60 fps | Games and high-frame-rate video |

The frame rate is saved with the project. Projects from before this setting open at 30 fps. **New** keeps the frame rate you're using.

> Timecode here is non-drop-frame at exactly 24, 25, 30 or 60 frames a second. Much camera and broadcast video labelled "24" or "30" really runs at 23.976 or 29.97 fps, which isn't supported: against that kind of video, timecode drifts by about 2 frames a minute. Games and screen recordings normally run at true 30 or 60 fps and line up exactly.

### Typing a timecode

Click the timecode, type, and press Enter:

- `00:01:12:10` is 1 minute, 12 seconds, frame 10. Fields fill in from the right (frames, then seconds, minutes, hours), so you can leave off leading zeros: `1:12:10` is the same place, and `12:10` is 12 seconds, frame 10. Colons, semicolons, dots or spaces all separate fields.
- Digits on their own fill in from the frames, like in video editors: `1500` is 15 seconds, `10215` is 1 minute 2 seconds and 15 frames, and `12` is frame 12.
- Fields can overflow: `90:00` is 90 seconds.

A red box means the entry couldn't be read, or is past the end of the timeline.

### A timecode ruler

The **Bars | Time** switch above the track names changes what the ruler counts. **Time** labels it as `M:SS:FF` (minutes, seconds, frames), so any label can be typed straight into the timecode box. Labels come every few seconds when zoomed out, and every few frames when zoomed in at a fast enough tempo, with smaller ticks in between.

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

The header has the clip's name (click to rename), **GRID** (1/16, 1/8, 1/4), **NEW NOTE** length, **VEL** (velocity: how hard new notes are played; with notes selected it changes those notes) and zoom. Click the piano roll's ruler to move the playhead. Close it with **Close** or `Esc` (when no notes are selected).

> With no notes selected, `Delete` acts on the timeline and deletes the selected clip, usually the one you're editing. `Ctrl+Z` brings it back.

## Instruments

Each track plays one instrument. Add a track with **+ Add Track** under the last track, or change a track's instrument in the Track Inspector (**SOUND GENERATOR**). There are 28 instruments in 8 groups:

| Group | Instruments |
|---|---|
| Drums & Percussion | Drums (analog kit), Drum Machine (808-style), Taiko Drums |
| Bass | Slap Bass, Sub-Bass, 808 Bass, Bass Guitar |
| Keys & Synths | Grand Piano, Fender Rhodes, Space Clav, Wavetable Synth, Analog Lead, Pipe Organ |
| Guitars & Strings | Acoustic Guitar, Electric Guitar, Mandolin, Harp, Violin, Cello |
| Winds & Brass | Brass Stabs, Saxophone, Trumpet, French Horn, Flute |
| Mallets & Bells | Marimba, Chimes |
| World | Erhu |
| Your Sounds | Sampler (plays a sound file you load) |

- **Synths and drum kits** (Drums, Drum Machine, Slap Bass, Sub-Bass, 808 Bass, Space Clav, Wavetable Synth, Analog Lead, Brass Stabs) are generated in the browser and work offline.
- **Recorded instruments** (the other 18) download their sounds the first time you use them, so they need an internet connection. A spinner shows on the track header while they load, and the Inspector shows **Loading CDN...**, **Ready** or **Error**. Notes are silent until the sounds arrive. If you see **Error**, check your connection, then reload the page (or switch the track to another instrument and back) to try again; the track stays silent until you do.
- Both drum kits use the same five notes: **Kick**, **Snare**, **Closed Hat**, **Open Hat** and **Cowbell**, so drum parts can move between them. Taiko is played like a pitched instrument.
- Slap Bass, Sub-Bass, 808 Bass and Analog Lead play one note at a time; in a chord, only the loudest note sounds. Space Clav (16 notes at once), Wavetable Synth (12) and Brass Stabs (8) cut short whichever ringing note would end soonest when they run out, so new notes still play (only notes beyond the limit that start at the very same moment are dropped).

### The Sampler: your own sound

1. Add a track with **Your Sounds > Sampler** (or switch a track to Sampler).
2. In the Inspector, click **Load a sound…** and pick an audio file (WAV, MP3, OGG and most others) under 3 MB.
3. Under **ORIGINAL PITCH ON**, choose which C (C2, C3, C4, C5 or C6; C4 by default) plays the file at its normal pitch. Higher notes play it faster and higher, lower notes slower and lower.
4. Write notes for it in the piano roll like any other instrument.

The sound is stored inside the project, so saved projects bring it with them. It plays only as long as each note lasts (then fades out quickly), so draw long notes for long sounds. The play button previews a half note at the original pitch; the trash button removes the sound (this can't be undone).

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

These keys work anywhere on the page except while typing in a box, while a drop-down menu has focus (click an empty part of the page first) or with a dialog open. So pressing `R` plays a cowbell rather than arming a track.

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
- **POST-FADER AUX SENDS**: how much of the track goes to the shared reverb and the ping-pong echo.
- **CHANNEL FADER**: the same volume and pan as the header.
- **Delete this track** (also the trash icon at the top). It asks first if the track has clips, and it can't be undone.

Distortion, Compressor and Chorus each have an **ON / OFF** switch and start off. An effect that's off is taken out of the sound completely, so it costs nothing. The EQ is on whenever any band isn't at 0 dB. Double-click a Drive, EQ, Compressor or Chorus slider to reset it to its starting value (EQ bands go back to 0 dB); the send and Master Aux Bus sliders don't reset on double-click.

### Master Aux Bus

The Inspector's second tab sets the two effects every track shares through its sends:

- **Master Convolution Reverb**: Room Decay Time, from 0.8 s (tight) to 6 s (cathedral).
- **Ping-Pong Echo Delay**: Echo Subdivision (1/4, 1/8, dotted 1/8 or 1/16, locked to the tempo) and Echo Feedback (0 to 80%).

### Tempo, swing and master volume

In the header:

- **TEMPO**: `-` and `+` change it by 1 BPM, or drag the slider (40 to 240 BPM). **TAP** sets it from your clicks: tap at least twice; it averages your last few taps and starts over if you pause for more than 2.5 seconds.
- **SWING**: delays every other 16th note for a shuffled feel (0 to 50%). New blank projects start at 20% (the demo song uses 15%). Double-click it for 0% (straight).
- **MASTER**: the final output level (-30 to +6 dB). It also sets the export level, but it isn't saved with the project.

Every track goes through a master compressor and limiter, which keep the mix in check at MASTER 0 dB or lower. MASTER is applied after the limiter, so above 0 dB playback can clip. Exports are turned down automatically if they would clip.

Mixer and effect changes can't be undone with `Ctrl+Z`.

## Projects: saving and opening

The project bar sits above the toolbar.

- **Project name**: click it to rename. It's used for the file names when you save and export.
- **New**: start a **Blank timeline** (four empty tracks) or load the **Demo song** (Sunset Stroll, 88 BPM). This replaces what's on screen and clears undo, so save first.
- **Open**: load a `.beatbox.json` project file. Like New, it replaces what's on screen straight away and clears undo, so save first. If the file can't be read, a red message explains why and nothing is replaced.
- **Save**: downloads the project as `<name>.beatbox.json` to your downloads folder. Keep this file: it's the only way to move a project to another browser or computer.

A project file holds the tracks, clips, mixer and effect settings, tempo, swing, loop, master reverb and delay, frame rate, and any Sampler sounds. It doesn't hold the master volume, zoom, snap or ruler setting.

### Autosave

The app also saves your work in this browser half a second after every change. Next time you open the app, a banner offers to **Restore** it.

- The app always opens on an empty timeline. Your first change overwrites the copy saved in the browser, but the banner keeps your last session until you click **Dismiss** or leave the page, so **Restore** still works (it replaces whatever you've done since). After you dismiss it, or reload or close the tab having changed anything, the old session is gone.
- Autosave is per browser and per site; private windows don't keep it, and very large projects (big Sampler sounds) may not fit. Use **Save** for anything you care about.

## Exporting audio (WAV)

Click **Export WAV** and choose:

- **Whole song**: from bar 1 to the end of the last clip.
- **Loop region (In → Out)**: the range between the loop brackets, played once (whether or not the loop is on). Nothing after OUT plays into the file, only the reverb and echo tails of what came before. The dialog shows where it starts as a timecode at your frame rate.

The WAV is 44.1 kHz, 16-bit stereo, named after the project. It includes the whole mix: volumes, pans, mutes and solos, every effect, sends, the master reverb and delay, swing, and the master volume. A few seconds are added at the end so reverb and echo tails ring out. If the mix would clip, the file is turned down to just under full scale.

Exporting renders faster than real time and shows its progress. It pauses playback, and it can't be cancelled once started.

> Exports need the sounds of every recorded instrument that's playing. If one can't download (for example, when you're offline), the export stops with an error. Mute that track, or switch it to a synth, to export without it.

## Keyboard shortcuts

Shortcuts don't work while you're typing in a box, or while a dialog (Guide, Export, New) is open. After using a slider or menu, click an empty part of the page to give the shortcuts back.

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
| `Ctrl+D` | Duplicate selected clips after themselves |
| `Delete` or `Backspace` | Delete selected clips |
| `Esc` | Clear the selection |
| `+` / `-` | Zoom in / out |
| `?` | Open this guide |
| `Q` `W` `E` `R` `T`, `1`–`4`, `A` `S` `D`, `Z` `X` | Play Audition Deck pads (see Trying sounds) |

On a Mac, use `Cmd` instead of `Ctrl`.

### Mouse

| Gesture | Action |
|---|---|
| Shift on the ruler, with the Razor, on right-click or a pad drop; or after you start dragging a clip | Ignore snap (loop brackets and piano-roll notes always snap) |
| Alt (Option) + drag a clip | Duplicate it |
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

- Songs can be up to 400 bars long, in 4/4, at one tempo (40 to 240 BPM).
- Recorded instruments (piano, strings, winds and others) download their sounds the first time you use them, so they need an internet connection. Everything else works offline.
- Muted tracks, and tracks silenced by another track's Solo, don't play their notes at all, which saves processing power on big songs.
- If playback stutters on a big song, mute tracks you aren't working on, switch off effects you don't need, or export a WAV: exporting never stutters, it just takes longer.
- The **R** buttons on track headers and the red **Record** button in the toolbar don't record anything yet.
