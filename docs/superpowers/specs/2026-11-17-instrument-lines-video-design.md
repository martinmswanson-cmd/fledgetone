# Lines: a video picture with one glowing line per instrument

Design, 2026-11-17. Status: waiting for the owner's approval.

A moving sketch of the look is beside this file: `2026-11-17-instrument-lines-sketch.html` (open it
in a browser; it plays a made-up song, not a project). It is throwaway code, a reference for how the
picture should move and feel, not something to build on.

## Intent

Fledgetone's Video (MP4) export has two kinds of picture: Showcase (the notes on a scrolling piano
roll) and the spectrum styles. The owner wants more visual choices for videos people post, and
brought a reference clip in which glowing lines scroll past a playhead and bend to each new pitch.
His idea: instead of a line per chord voice, a line per **instrument**, so the video shows how the
parts of a song move, drop out and come back.

He watched the sketch and said it's the motion he meant, but "not attention grabbing enough yet",
and asked what could explain the song better. Four additions were sketched; he wants all of them
kept as options the user picks before exporting, with the song map, the section name and the chord
as three separate settings.

## What it is

A third kind of picture in the Video export's **Picture** menu, called **Lines: each instrument's
path** (`picture: 'lines'`).

- The picture scrolls right to left past a fixed "now" point. Nothing is drawn as a playhead line;
  the dots mark it.
- **A line per instrument.** Every heard track with pitched notes draws a line. Its height follows
  the pitch it is playing, across the song's whole pitched range, so lines cross. Its colour follows
  the pitch too (low warm, high cool), so a line changes colour as it climbs. Track colours are not
  used.
- **A glowing dot** rides at the head of each line. It is brighter and larger while a note sounds,
  and kicks outward for a moment as each note starts.
- **Bends.** When the pitch changes, the line eases to the new pitch over a short time (0.16 s in
  the sketch), starting as the new note starts.
- **Short rests keep the line going.** If an instrument is silent for no longer than an allowance
  (1.5 s), its line runs on flat at its last pitch. This is the owner's "allowance so it's not
  jittery".
- **Stopping.** Silent for longer than the allowance: the line ends where the last note ended, and a
  small dim dot stays behind at its end and scrolls away with it.
- **Coming back.** A new line rises from below the picture and reaches the pitch exactly as the
  first note sounds (about 1.1 s of rise).
- **A chord on one instrument** follows its top note. (Builder's reading; the owner hasn't ruled on
  it. See Open to the owner.)
- **Older line is dimmer**, and it fades out into the picture's left edge.
- The instrument's name sits beside its dot while its line is live.

### The six options

Each is its own tick box under Picture when Lines is chosen, remembered with the other export
settings, all on by default.

| Setting | What it draws |
|---|---|
| **Song map** | A strip across the top of the picture: one segment per section (from the markers), filling as the song plays. With no markers, one plain segment. |
| **Section** | The name of the section the song is in, drawn inside the picture at the top, with the map. It is the existing **Section names** setting (`marks.sections`), not a second one: while Lines is the picture, its tick box shows with Lines' options instead of under Title and marks, and the footer's section name is not drawn. |
| **Chord** | The chord sounding now in large type, and the next one beside it, smaller. Worked out from the notes (below). Blank where it can't tell. |
| **Drum pulse** | A row along the bottom: a tick per drum hit (fat for kicks, thin and tall for everything else), a pulse at "now", and a soft flash of the whole picture on each kick. |
| **Rings on notes** | A ring bursts from the line where each note starts and fades in about 0.7 s. |
| **What's coming** | A faint thin line ahead of each dot showing where the instrument goes next, including lines about to come in. |

With **Drum pulse** off, drums are not drawn at all. With an option off, its room goes to the lines.

## Goals

- The motion and feel of the sketch, at the export's real sizes (1920×1080 and 1080×1920) and both
  frame rates.
- Each of the six options can be judged and switched independently.
- Reads well on a real song: the eight starters are the test set.
- Fledgetone's own look. The reference clip is another product; nothing of its layout (its header,
  guitar diagram, fonts) is copied.

## Non-goals

- A live view in the studio or in Pocket. Export only.
- Lines for audio clips and vocals. They have no notes, so they get no line (as in Showcase).
- Lines over the user's own video (the "Put the music on your video" mode keeps its picture).
- Three further ideas raised and not chosen yet: line thickness from loudness, camera moves at a
  drop, names shown only as a line comes in.
- A setting for the allowance or the bend time. Fixed values, tuned on the starters.

## Anti-goals

- **Jitter.** A line that flickers on and off through ordinary rests, or a fast part whose line
  becomes a blur of zig-zags that hides the others.
- **A wrong chord shown with confidence.** Better blank than wrong.
- **Clutter with everything on.** All six options on, on a busy starter, must still be readable.
- Any change to what existing exports look like or how they're encoded.

## Constraints

- **Every frame is drawn from the time alone**, with no state carried between frames, as
  `showcaseDraw.ts` does. The export may draw frames in any order.
- Drawn in design units (1280×720 wide, 720×1280 tall) inside the `picture` box `videoExport.ts`
  hands over; what the title and marks leave out gives its room to the picture.
- Fast enough that a 60 fps export of a four-minute song still runs faster than real time on the
  machines Showcase does. The sketch's method (one path and one gradient per line, a wide faint
  stroke under a narrow bright one, no per-segment shadows) is the cost level to keep.
- The project's rules in CONTRIBUTING.md: all the checks before a commit, GUIDE.md updated for any
  user-visible change, a summary comment on each new file (`npm run codemap`), CHANGELOG and
  HANDOFF entries.
- Only what's heard is shown: muted tracks, tracks a solo leaves out, the Drop pad's track and notes
  hidden by a trimmed clip edge are left out, exactly as `showcaseData` already decides.

## Approaches

1. **A new picture beside Showcase (chosen).** Its own data shaping and drawing, fed by the notes
   `showcaseData` already collects. Reuses the export's title, marks, shapes, frame rates and
   encoding unchanged. The owner left the how to the builder; this is the builder's pick.
2. **A mode inside Showcase** (`layout: 'lines'`). Less plumbing, but the two pictures share almost
   no drawing, Showcase's own settings (one roll or lanes, sparkles) don't apply, and
   `showcaseDraw.ts` is already 455 lines.
3. **Lines from each track's sound** (render every track, track its pitch and level). Would cover
   audio clips and vocals, but needs a render per track, is slow, and pitch tracking of real sound
   is jittery: the anti-goal.

## How it's built (decided)

- **Data, pure and unit-tested in Node** (a new file in `src/store/`, tests in `scripts/`): from
  `ShowcaseData`, per pitched track, its **runs** (stretches of notes with no silence longer than
  the allowance) and, for a run and a time, the pitch its line shows. Per run the line follows the
  highest note sounding; when that note ends while lower ones hold, it stays where it is until the
  next note starts (no dropping to the lower voice). Drum hits come from the notes already marked
  `drum`.
- **Kick or not.** `ShowcaseNote` gains what the drum row is where the track is a drum kit (the
  kick row from `DRUM_NOTES`), so kicks draw fat and flash. Hits on a Drum Rack, the Slicer or a
  sound-effects track are all thin ticks and don't flash.
- **Which tracks are pitched.** Stricter than Showcase's rule: a track is pitched only if
  `showcaseData` doesn't mark it `drum` **and** its instrument isn't in the percussion or
  sound-effects categories (the rule `isPitched` in `src/store/keyChange.ts` uses). Congas, timpani
  and the like go to the drum row as thin ticks, and stay out of the chords. Showcase itself is
  unchanged.
- **Two lines on the same pitch** are drawn a few units apart, one above the other, so unison and
  doubled parts stay two lines (as Showcase splits a shared row).
- **Chords, pure and unit-tested.** Builder's rules, all the builder's calls:
  - A window is half a measure. Where a measure has an odd number of beats (`ShowcaseData.beats`),
    the window is the whole measure.
  - In a window, a pitch class counts if pitched notes of it sound for at least a quarter of the
    window. The root is `chordRoot` of the notes that count (`src/store/smartTools.ts`).
  - A name is shown only when the root has a major or minor third among the classes that count.
    It is cut down to the root, its quality (major, minor, diminished, augmented) and a seventh if
    there is one: `chordNameIn`'s spelling with any other extension dropped. No third (a bare
    fifth, a sus chord, a single line): blank.
  - Spelled in the key `detectKey` (`src/store/songKey.ts`) gives for the whole song. The key only
    decides flats or sharps; key changes mid-song are not followed.
  - Neighbouring windows with the same name merge. "Next" is the next named chord that differs
    from the current one, however far ahead; none ahead, nothing shown.
  - Tested against the starters: their builders (`src/store/starters.ts`, `startersWorld.ts`) write
    their chords from known progressions, which is the reference. A shown name that disagrees with
    the progression fails the test; a blank doesn't.
- **Drawing** in a new file in `src/audio/` beside `showcaseDraw.ts`, with the same shape of call
  (`g`, data, box, time, options).
- **Export dialog**: `picture` gains `'lines'`; six booleans (the Section one being the existing
  `marks.sections`) in the saved settings, read back with the same guarded parsing as the others.
  The existing **Waveform**, **Time**, **Title** and **Under it** marks work with Lines as with any
  picture.
- **Song map sections** come from the same marker list the Section names mark uses
  (`VideoOptions.sections`).

## Left to the builder

- Exact sizes, glows, easing, the pitch-to-colour ramp, and where "now" sits in each shape (the
  sketch uses 72% across in widescreen; portrait needs its own, with room ahead for What's coming).
- How many seconds are in view per shape (Showcase uses 8 wide, 4.5 tall).
- Keeping names readable when many lines are live at once: nudging labels apart, or hiding them
  past some count.
- Keeping fast parts calm (an arpeggio, a trill): for instance bending toward a smoothed pitch when
  notes come faster than the bend time. The sketch does nothing here and its arp shows the problem.
- A song whose pitched range is one note, or with no pitched tracks at all (drums only): the
  picture must still draw sensibly.
- File names, and whether Lines gets an entry in the search palette as Showcase has.
- The wording of the menu entry, the tick boxes and their hover text, in GUIDE.md's voice.

## Open to the owner

Calls the builder made that the owner hasn't seen ruled on. None blocks a start.

- An instrument playing a chord follows its top note.
- The allowance (1.5 s) and bend time are fixed, not settings.
- All six options start ticked.
- Chords show as plain triads and sevenths, blank when unsure (a part with no third, such as a
  power chord, shows nothing).
- The section name moves to the top of the picture with the song map while Lines is chosen.
- Percussion instruments (congas, timpani) count as drums here, not as lines.
- Two instruments on the same note are drawn slightly apart rather than as one line.
- The three unbuilt ideas (thickness from loudness, camera moves, names only on entry) wait for a
  later round.
