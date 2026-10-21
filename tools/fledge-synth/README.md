# Fledge Synth

{{HEADER}}

Fledgetone's own synthesizer, built to WebAssembly, with a small wrapper so you can play it in any
web page or browser game through the Web Audio API.

- Two wavetable oscillators, each with up to 16 unison voices, FM, a sub and noise
- Two filters (low-pass, ladder, band-pass, high-pass, notch, comb and formant)
- Envelopes, four LFOs that can keep time with your music, a mod matrix and four macros
- Drive, EQ, chorus, phaser, delay, reverb and an OTT-style compressor
- {{PRESET_COUNT}} presets: basses, leads, keys, chords, pads and effects

## What's in this zip

| File | What it is |
| --- | --- |
| `fledge-synth.js` | The wrapper you import (main thread) |
| `fledge-processor.js` | Its AudioWorklet processor, which runs the synth |
| `fledge-choices.js` | The options of the parameters that are choices |
| `fledge.wasm` | The synth itself, compiled to WebAssembly |
| `index.html` | An example page that plays a few notes |
| `source/` | The synth's Rust source code, to build `fledge.wasm` yourself |
| `LICENSE` | The GNU General Public License, version 3 |

## Try it

Serve this folder and open `index.html` (AudioWorklets don't run from a `file://` page):

```sh
npx serve
```

## Use it

```js
import { FledgeSynth } from './fledge-synth.js';

const context = new AudioContext();
const synth = await FledgeSynth.create(context, { preset: 'Lead/Supersaw', tempo: 120 });
const volume = new GainNode(context, { gain: 0.3 });
synth.connect(volume).connect(context.destination);

button.onclick = async () => {
  await context.resume();                         // browsers start sound only after a click
  const t = context.currentTime;
  synth.noteOn('C4', 100, t);                     // a note number (60) or a name, velocity 1 to 127
  synth.noteOff('C4', t + 0.5);
};

synth.setParam('Cutoff', 0.4);                    // every parameter is 0 to 1
synth.setParam('Filter type', 'Ladder');          // a choice also takes its option's name
synth.setParam('Reverb on', true);
await synth.setPreset('Bass/Wobble');
```

The calls:

| Call | What it does |
| --- | --- |
| `FledgeSynth.create(context, options?)` | Makes a synth. Options: `preset` (name or number), `tempo` (BPM), `wasmUrl`, `processorUrl` |
| `connect(node)`, `disconnect()` | Where its stereo sound goes. `synth.node` is the AudioWorkletNode itself |
| `noteOn(note, velocity?, time?)`, `noteOff(note, time?)` | Play and let go of a note. `time` is on the audio clock (`context.currentTime`), now if left out |
| `allNotesOff(time?, hard?)` | Let every note go (`hard`: cut them off at once) |
| `pitchBend(amount, time?)`, `modWheel(amount, time?)` | Bend (-1 to 1) and the mod wheel (0 to 1) |
| `midi(status, data1, data2, time?)` | Any MIDI message |
| `setParam(name, value, time?)`, `getParam(name)` | A parameter, 0 to 1 (or an option's name, or true/false) |
| `listParams()`, `choices(name)` | The parameters' names; a choice's options |
| `describe()` | Every parameter now, with the text the synth shows for it ("8.00 kHz") |
| `listPresets()`, `setPreset(name)` | The presets; choose one (it sets every parameter) |
| `setTempo(bpm)` | The tempo the LFOs and the delay keep time with |
| `destroy()` | Free the synth |

It works in an `OfflineAudioContext` too, to render sound to a buffer.

The synth's own **Level** parameter starts at -14 dB and a safety clipper keeps every note under
-1 dB, but a stack of loud notes can still be loud: keep a volume control after it.

## Presets

{{PRESETS}}

## Parameters

Every parameter is a number from 0 to 1. Knobs go from their lowest to their highest setting;
switches are off below 0.5 and on above. **Starts at** is how each is set when a synth is made
(before a preset is chosen).

{{PARAMS}}

### Choices

These parameters are choices. Set them by the option's name, for example
`synth.setParam('LFO 1 shape', 'Wobble')`.

{{CHOICES}}

## Build fledge.wasm yourself

The synth is written in Rust, with no dependencies. In `source/`:

```sh
rustup target add wasm32-unknown-unknown
./build.sh                 # writes ../../public/fledgetone-plugins/fledge.wasm in Fledgetone's repository
cargo test --release       # the synth's tests
```

Outside Fledgetone's repository, run the build line from `build.sh` and take the file from
`target/wasm32-unknown-unknown/release/fledge_synth.wasm`. The module has no imports and exports
the plain C functions listed in `source/src/abi.rs`, which `fledge-processor.js` calls.

{{LICENCE}}
