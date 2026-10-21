# Drop pad effects

{{HEADER}}

The effects of Fledgetone's Drop pad, for any web page or browser game: what a DJ does to a whole
mix with a finger, held for as long as you hold it, in time with the music.

| Effect | What it does |
| --- | --- |
| Stutter | Repeats the 16th note that was playing when you pressed |
| Filter | Sweeps the sound down to a muffle over a bar, and back up when you let go |
| Tape stop | Slows the sound to a halt over a beat, like a tape machine switched off |
| Crush | Makes it gritty and lo-fi |
| Gate | Chops it into 16th notes |
| Echo | Throws what's playing into a dotted-8th echo that rings on after you let go |

Several can be on at once. Every change glides over a few milliseconds, so nothing clicks, and
none of them makes the sound louder than it was (apart from the echo's tail).

## What's in this zip

| File | What it is |
| --- | --- |
| `drop-effects.js` | The helper you import (main thread) |
| `drop-processor.js` | Its AudioWorklet processor |
| `drop-fx.js` | The effects themselves as a plain JavaScript module (`createDropKernel`), for use without Web Audio, for example to process a buffer |
| `drop-fx.ts` | The same in TypeScript, as written |
| `index.html` | An example: a simple beat and a pad for each effect |
| `LICENSE` | The GNU General Public License, version 3 |

## Try it

Serve this folder and open `index.html` (AudioWorklets don't run from a `file://` page):

```sh
npx serve
```

## Use it

```js
import { createDropEffects } from './drop-effects.js';

const context = new AudioContext();
const drop = await createDropEffects(context, { tempo: 128 });
yourMusic.connect(drop.input);
drop.connect(context.destination);

pad.onpointerdown = () => drop.on('Stutter');
pad.onpointerup = () => drop.off('Stutter');
```

| Call | What it does |
| --- | --- |
| `createDropEffects(context, options?)` | Makes the effects. Options: `tempo` (BPM, 120 if left out) or `sixteenth` (seconds), `processorUrl` |
| `input`, `connect(node)`, `disconnect()` | Send the music into `input`; connect the output onwards. `node` is the AudioWorkletNode itself |
| `on(fx, time?)` | Turn an effect on. `fx` is its name (`'Stutter'`, `'Filter'`, `'Tape stop'`, `'Crush'`, `'Gate'`, `'Echo'`) or number (0 to 5). `time` is on the audio clock, now if left out |
| `off(fx, time?)` | Let go of it |
| `cancel(time?)` | Let go of everything and forget what was due after `time` (for a stop or a jump) |
| `setTempo(bpm)`, `setSixteenth(seconds)` | The music's tempo; effects turned on after this keep time with it |
| `effects` | The effects' names |
| `dispose()` | Stop it for good |

For effects on the beat, give `on` the time of the next 16th note of your music rather than now.

## Without Web Audio

`drop-fx.js` exports `createDropKernel(sampleRate)`, the same code the processor runs. Tell it
when effects start and stop in samples, then process stereo blocks:

```js
import { createDropKernel } from './drop-fx.js';

const kernel = createDropKernel(48000);
const sixteenth = 48000 * 15 / 120;            // samples in a 16th note at 120 BPM
kernel.on(0, 48000, sixteenth);                // Stutter on at 1 second
kernel.off(0, 96000);                          // off at 2 seconds
kernel.process(left, right, left, right, left.length, 0);   // in place, from sample 0
```

{{LICENCE}}
