# Pigeons on the keys

{{HEADER}}

Fledgetone's **Pigeons** video picture, for any web page: a song played by low-poly pigeons on a
big piano keyboard, seen from above at an angle. A pigeon stands on each key as it plays; the key
goes down under it and lights up in its track's colour. Give it the notes and it draws the picture
for any moment of the song, so it suits a visualizer beside a player, a scrubbable score, or frames
for a video.

It draws; it makes no sound and reads no audio. You bring the notes (from your own sequencer, a
MIDI file you've parsed, a song's data) and the time. It draws with WebGL, on a canvas of yours.

How the birds behave:

- Each note gets the free bird that can reach its key in time: one already on the keys side-steps
  to the next key or flies along to a further one; one waiting on the floor walks over and hops up.
- A jump of more than about a key and a half is flown, wings spread and beating. A bird playing
  the same key again hops on the spot to strike it afresh.
- **No two pigeons ever touch.** Birds on neighbouring keys stand side by side; birds on the move
  step round each other or fly over; wings open only as far as the birds nearby leave room.
- Birds with nothing to play get down and wait on the floor, pecking.
- The camera follows what's playing, and pulls back when the low and high parts are far apart.
- Nine backgrounds (a plaza, a park, a rooftop at sunset, a night street, snow, space, a future
  city, above the clouds, a beach) and five camera angles, and the picture can change between the
  ones you choose as the song goes: at times you give, such as every four bars or at each section.
- Most birds are blue-grey; the odd one is dark, red-brown or pied. The same song always gets the
  same birds doing the same things.

## What's in this zip

| File | What it is |
| --- | --- |
| `pigeon-keys.js` | The helper you import: `createPigeons(canvas, song, options)` |
| `pigeon-scene.js` | The scene itself as one JavaScript module (`PigeonScene`), bundled from the studio's own code with three.js inside it ({{SCENE_SIZE}}; {{SCENE_GZIP}} gzipped) |
| `pigeonScene.ts` | The scene in TypeScript, as written |
| `index.html` | An example: a small song played with oscillators, its pigeons following the audio clock |
| `THIRD-PARTY-LICENSES.txt` | The licence of the library inside `pigeon-scene.js` |
| `LICENSE` | The MIT licence |

## Try it

Serve this folder and open `index.html` (modules don't load from a `file://` page):

```sh
npx serve
```

## Use it

```js
import { createPigeons } from './pigeon-keys.js';

const pigeons = createPigeons(canvas, {
  tracks: ['#a855f7', '#14b8a6'],                     // the colour each track's keys light up in
  notes: [
    { track: 0, start: 0.5, end: 1, pitch: 72 },      // seconds, and a MIDI note (60 is middle C)
    { track: 1, start: 0, end: 1.9, pitch: 45 },
  ],
});

function frame() {
  pigeons.draw(audio.currentTime);      // or audioContext.currentTime - whenTheSongBegan
  requestAnimationFrame(frame);
}
frame();
```

| In `song` | What it is |
| --- | --- |
| `notes` | `{ start, end, pitch, track?, drum?, kick? }` each: seconds from the song's start, a MIDI note number, the index of its track (0 if left out). The keyboard's birds play pitched notes. One with `drum: true` or `kick: true` is a drum hit: it goes to the drum pads (see `pads`), and the backgrounds jump on the kicks |
| `bars` | When each bar line falls, in seconds (optional): the beat the backgrounds jump on, in a song with no kicks |
| `tracks` | The colour each track's keys light up in: a CSS colour each, or `{ color }` (optional; `TRACK_COLORS` in turn if left out) |
| `duration` | The song's length in seconds (if left out: when the last note ends) |

| In `options` | What it does |
| --- | --- |
| `shape` | `'tall'` (the keys run up the canvas), `'wide'` (across it), or `'auto'`: tall when the canvas is taller than it's wide (`'auto'` if left out) |
| `backgrounds` | The backgrounds to use, by id, in the order they appear (`['plaza']` if left out) |
| `backgroundAt` | When it changes to the next background, in seconds from the song's start: round and round the list, each fading into the next. Never, if left out |
| `cameras` | The camera angles to use, by id, in order (`['diagonal']` if left out) |
| `cameraAt` | When it cuts to the next angle, in seconds. Never, if left out |
| `motion` | How much the backgrounds move with the music, from 0 (still) to 1 (fully; 1 if left out) |
| `pads` | Whether fast parts and the drums get instruments of their own beside the keyboard (`true` if left out; `false` keeps every pitched note on the keyboard and leaves the drums out). Set when the pigeons are made: `setLook` doesn't change it |
| `whole` | `true`: the camera zooms out to hold every key the song plays, from its lowest note to its highest, and stays there, so no note is out of the picture. `false` (if left out): it follows what's playing, closer in |
| `floor` | A floor colour of your own, any CSS colour, in place of the backgrounds' |
| `across` | How many white keys fit across the canvas's narrow side at the closest the camera comes (each angle has its own, about 16); a smaller number makes everything bigger |
| `centerY` | Where the keyboard's middle sits, from the top of the canvas, from 0 to 1 (0.5) |

| Background | What it is |
| --- | --- |
{{BACKGROUNDS}}

| Camera angle | What it is |
| --- | --- |
{{CAMERAS}}

The backgrounds move with the music: a ring spreads across the floor from each key as it's struck,
in its track's colour, and each background has its own way of moving. On the beat (the kicks, or
the bar lines of a song with none) the future city's grid brightens, the night street's lamplight
swells and the park's daisies nod; struck notes send light to the city's circuits and make stars
flare; in busier passages more snow falls and space drifts by faster; and the sunset goes down
through the song. The calm ones (the clouds, the plaza, the beach, the sunset) only ever move
gently: the clouds drift at about a key's width every eight seconds, whatever the music does. It
follows the notes you give, not the sound, so it's the same every time. `motion: 0` keeps them
still.

A keyboard can't show a fast part well: the birds can't cross it in time, and the notes go by
before a key has moved. So a track of short, quick notes (half of them under 0.3 seconds long and
under 0.3 seconds apart, on 16 pitches or fewer) gets a bank of touch pads in front of the
keyboard, one pad for each pitch it uses, low to high, in its track's colour, with two to four
birds of its own that hop from pad to pad. Up to three tracks get one, the busiest first. Drum
hits get drum pads behind the keyboard: a bird stomps the kick's pad, and birds peck a snare (pitch
26, 27 or 38 to 40), the hats (30, 34, 42, 44, 46) and one drum for anything else. The keyboard
keeps the slower parts, and is only as long as they need. `pads: false` puts every pitched note
back on the keyboard.

`everyBars(barTimes, n)` gives the times of every `n`th bar line, for `backgroundAt` and `cameraAt`:
`cameraAt: everyBars(bars, 4)` cuts every four bars. For changes at a song's sections, give the
times its sections start.

| Call | What it does |
| --- | --- |
| `createPigeons(canvas, song, options?)` | Works out every bird's part once, and returns the calls below. The canvas must be one nothing has drawn on yet: it's given a WebGL context |
| `draw(time)` | Draws the picture at `time` seconds, at the size the canvas has then |
| `onKeys(time)` | How many pigeons are on the keys at `time`: standing on a key (playing it or not) or hopping between keys; not the ones flying or waiting on the floor |
| `setLook(changes)` | Changes `backgrounds`, `backgroundAt`, `cameras`, `cameraAt`, `motion` or `whole` (only the ones you give); the next `draw` uses them |
| `isDark(time)` | Whether the floor is dark at `time`: for choosing the colour of anything you draw over it |
| `setFloor(color)` | A floor colour of your own in place of the backgrounds' (`null`: theirs again); the next `draw` uses it |
| `duration` | The song's length |
| `dispose()` | Lets go of the WebGL context and everything made for it |
| `PIGEON_BACKGROUNDS`, `PIGEON_CAMERAS` | The backgrounds and angles there are, `{ id, name, blurb }` each (and their colours and angles), to fill a menu from |

Every picture is drawn from the time alone, with nothing remembered between calls: draw frames in
any order, skip frames, or draw the same time twice. For a sharp picture, give the canvas as many
pixels as it shows (`canvas.width = canvas.clientWidth * devicePixelRatio`, and the same for its
height); `draw` fits itself to whatever size the canvas has. To put the picture into a video or
onto another canvas, draw this canvas there right after `draw` (`context.drawImage(canvas, 0, 0)`).

There are up to 30 birds: music with more notes at once than that (or about 40 notes a second)
still lights every key, but some keys play without a bird.

## Without the helper

`pigeon-scene.js` exports what the helper is made of: `PigeonScene` (`new PigeonScene(data,
options)`, then `render(time)`), and the parts under it, which need no canvas: `planPigeons(data)`
works out every bird's moves, and `posedAt(plan, time)` gives where each bird is at a moment, kept
clear of the others. `pigeonScene.ts` says what each part means.

## The library inside

{{THIRD_PARTY}}

{{LICENCE}}
