# Fledge effects

{{HEADER}}

Fledgetone's own effects, built to WebAssembly, with a small wrapper so you can use them in any web
page or browser game through the Web Audio API. Three of them can listen to a second sound (a
sidechain): the compressor ducks under it, the gate opens on it, and the vocoder takes it as its
voice.

{{SUMMARY}}

## What's in this zip

| File | What it is |
| --- | --- |
| `fledge-effects.js` | The wrapper you import (main thread) |
| `fledge-effects-processor.js` | Its AudioWorklet processor, which runs an effect |
{{FILES}}
| `index.html` | An example page: a chord and a kick through the effect you choose |
| `source/` | The effects' Rust source code, to build the `.wasm` files yourself |
| `LICENSE` | The GNU General Public License, version 3 |

## Try it

Serve this folder and open `index.html` (AudioWorklets don't run from a `file://` page):

```sh
npx serve
```

## Use it

```js
import { FledgeEffect } from './fledge-effects.js';

const context = new AudioContext();
const comp = await FledgeEffect.create(context, 'compressor', { preset: 'Duck under the kick' });
bass.connect(comp.node);                          // the sound to treat goes into the node...
comp.connect(context.destination);                // ...and comes out of it
comp.setSidechain(kick);                          // the sound it listens to (any AudioNode)

comp.setParam('Threshold', 0.4);                  // every parameter is 0 to 1
comp.setParam('Key listen', true);                // a switch takes true or false
console.log(await comp.describe());               // each with the text it shows: "-36.0 dB"
await comp.setPreset('Gentle glue');
```

The effects are `'compressor'`, `'gate'`, `'vocoder'`, `'repeat'`, `'harmony'`, `'shifter'` and
`'spectral'`. The calls:

| Call | What it does |
| --- | --- |
| `FledgeEffect.create(context, kind, options?)` | Makes an effect. Options: `preset` (name or number), `tempo` (BPM), `wasmUrl`, `processorUrl` |
| `effect.node` | The AudioWorkletNode: connect the sound to treat to it |
| `connect(node)`, `disconnect()` | Where its stereo sound goes |
| `setSidechain(node)` | The sound it listens to, or `null` for none. Only the compressor, the gate and the vocoder listen (`effect.listens`) |
| `setParam(name, value, time?)`, `getParam(name)` | A parameter, 0 to 1 (or true/false). `time` is on the audio clock (`context.currentTime`), now if left out |
| `listParams()`, `describe()` | The parameters' names; every parameter now, with the text the effect shows for it |
| `listPresets()`, `setPreset(name)` | The presets; choose one (it sets every parameter) |
| `setTempo(bpm)`, `setPosition(beats, time?)`, `stop(time?)` | For the beat repeat (`effect.followsSong`): the tempo, where the song is, and that it has stopped |
| `effect.info` | Its name and what it does |
| `destroy()` | Free the effect |

They work in an `OfflineAudioContext` too, to render sound to a buffer.

Things to know:

- **A sidechain is heard only while one is set.** With none, the compressor and the gate follow
  their own input, and the vocoder passes its input through untouched.
- **The beat repeat fills bars by itself only if you tell it where the song is**: call
  `setPosition(beats, time)` on each beat or bar, with `time` on the audio clock. Its **Repeat**
  switch works without that.
- **Fledge Spectral's sound comes out one frame late** (2048 samples up to 48 kHz: 43 ms at
  48 kHz; 4096 above), and **Fledge Harmony's added voices** come a few milliseconds behind its
  input. Delay your other sounds to match if that matters.
- The same input gives the same output every time, so an offline render matches what was heard.

## The effects

Every parameter is a number from 0 to 1. Knobs go from their lowest to their highest setting;
switches are off below 0.5 and on above; a choice's options are spread evenly from 0 to 1.
**Starts at** is how each is set when the effect is made (before a preset is chosen).

{{EFFECTS}}

## Build the .wasm files yourself

The effects are written in Rust, with no dependencies from anyone else. `source/` is the whole
workspace: each effect is its own crate (`source/fledge-compressor` and so on), built on
`source/fledge-dsp` (filters, delay lines, an FFT), `source/fledge-plugin` (what a plugin is) and
`source/fledge-wasm` (which makes one a WebAssembly module). In `source/`:

```sh
rustup target add wasm32-unknown-unknown
./build.sh                         # builds them all; in Fledgetone's repository, also puts them in public/fledgetone-plugins/
cargo test --release --workspace   # their tests
```

Outside Fledgetone's repository, take the files from
`source/target/wasm32-unknown-unknown/release/` (named with underscores:
`fledge_compressor.wasm`). The modules have no imports and export the plain C functions listed in
`source/fledge-wasm/src/lib.rs`, which `fledge-effects-processor.js` calls.

{{LICENCE}}
