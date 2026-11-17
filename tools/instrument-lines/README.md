# Instrument lines

{{HEADER}}

Fledgetone's **Lines** video picture, for any web page: a song drawn as one glowing line per
instrument on a canvas. Each line rises and falls with the notes its instrument plays and changes
colour with them, a dot at its head; a line ends when its instrument falls silent and a new one
rises from the bottom when it comes back. Give it the notes and it draws the picture for any
moment of the song, so it suits a visualizer beside a player, a scrubbable score, or frames for a
video.

It draws; it makes no sound and reads no audio. You bring the notes (from your own sequencer, a
MIDI file you've parsed, a song's data) and the time.

| With the lines | What it draws |
| --- | --- |
| Song map | A strip across the top, one piece per section, filling as the song plays |
| Section | The name of the section the song is in |
| Chord | The chord name you give it for that moment, in big letters, and the next one |
| Drum pulse | A row along the bottom with a mark for every drum hit, and a soft flash on each kick |
| Rings on notes | A ring bursts from a line where each note starts |
| What's coming | A faint line ahead of each dot: where that instrument goes next |

How the lines behave:

- The instruments playing at a moment share the height, the lowest part at the bottom, and make
  room as one comes in. Colour is the real pitch: low notes amber, high notes violet.
- A chord follows its top note. A fast run follows its average, so the line stays a calm curve.
- A rest of up to a second and a half keeps the line going flat; a longer one ends it.
- The same note struck fast, again and again (a roll, a stutter), draws as a row of teeth.

## What's in this zip

| File | What it is |
| --- | --- |
| `instrument-lines.js` | The helper you import: `createLines(canvas, song, options)` |
| `lines-draw.js` | The lines themselves as a plain JavaScript module (`linesData`, `drawLines`), bundled from the studio's own code |
| `lines.ts`, `linesDraw.ts` | The same in TypeScript, as written |
| `index.html` | An example: a small song played with oscillators, its lines following the audio clock |
| `LICENSE` | The MIT licence |

## Try it

Serve this folder and open `index.html` (modules don't load from a `file://` page):

```sh
npx serve
```

## Use it

```js
import { createLines } from './instrument-lines.js';

const lines = createLines(canvas, {
  tracks: ['Bass', 'Lead'],
  notes: [
    { track: 0, start: 0, end: 1.9, pitch: 45 },     // seconds, and a MIDI note (60 is middle C)
    { track: 1, start: 0.5, end: 1, pitch: 72 },
    { track: 0, start: 0, end: 0.1, pitch: 36, kick: true },   // a drum hit; `drum: true` for any other
  ],
  sections: [{ at: 0, name: 'Intro' }, { at: 16, name: 'Drop' }],
  chords: [{ at: 0, end: 4, name: 'Am' }],
});

function frame() {
  lines.draw(audio.currentTime);        // or audioContext.currentTime - whenTheSongBegan
  requestAnimationFrame(frame);
}
frame();
```

| In `song` | What it is |
| --- | --- |
| `notes` | `{ start, end, pitch, track, drum?, kick? }` each: seconds from the song's start, a MIDI note number, the index of its track. A `drum` or `kick` note is a hit in the drum row, not part of a line |
| `tracks` | The tracks' names, drawn beside their dots (optional) |
| `bars` | When each bar line falls, in seconds (optional) |
| `sections` | `{ at, name }` each, for the song map and the section's name (optional) |
| `chords` | `{ at, end, name }` each (optional). This tool doesn't work chords out of the notes: give it the names you want shown |
| `duration` | The song's length in seconds (if left out: when the last note ends) |

| In `options` | What it does |
| --- | --- |
| `look` | `{ map, chord, drums, rings, ahead }`: which of the extras to draw (all, if left out) |
| `section` | Draw the section's name (`true` if left out) |
| `secondsShown` | How many seconds of the song the picture is wide (11; 6 on a canvas taller than wide) |
| `headAt` | Where "now" is across the picture, from 0 to 1 (0.7; 0.6 on a tall canvas) |
| `background` | A CSS colour painted behind the lines, or `null` to draw over what's already on the canvas (`'#0a0b10'` if left out). The lines are made for a dark background |
| `unitsWide` | The picture is designed 1280 units wide (720 on a tall canvas); a smaller number makes everything bigger |
| `padding` | Room left around the picture, in those units (40) |

| Call | What it does |
| --- | --- |
| `createLines(canvas, song, options?)` | Works the lines out once, and returns the calls below |
| `draw(time)` | Draws the picture at `time` seconds, filling the canvas at the size it has then |
| `set(options)` | Changes options; the next `draw` uses them |
| `data`, `duration` | The lines as worked out (each track's runs), and the song's length |

Every picture is drawn from the time alone, with nothing remembered between calls: draw frames in
any order, skip frames, or draw the same time twice. For a sharp picture, give the canvas as many
pixels as it shows (`canvas.width = canvas.clientWidth * devicePixelRatio`, and the same for its
height); `draw` fits itself to whatever size the canvas has.

## Without the helper

`lines-draw.js` exports the two parts the helper is made of: `linesData(song)`, which turns notes
into each track's runs of line, and `drawLines(context, data, box, time, options)`, which draws
them into a rectangle of a canvas you've already scaled. `linesDraw.ts` says what each option
means.

{{LICENCE}}
