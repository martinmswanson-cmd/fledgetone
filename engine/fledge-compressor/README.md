# Fledge Compressor

A clean stereo compressor that can be keyed from a sidechain, written in Rust. It builds to
WebAssembly for Fledgetone (`public/fledgetone-plugins/fledge-compressor.wasm`) and as a Rust
library.

With nothing on its sidechain it follows its own input. With another track connected it follows
that instead: a bass ducking under the kick, the music under a voice.

- A soft-knee gain computer in decibels, the gain smoothed with separate attack and release times
- One gain for both channels, so the stereo picture doesn't move
- A high-pass on what it listens to, **Key listen** to hear that, a parallel **Mix**, make-up gain
- No look-ahead: it adds no delay
- Five presets

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Threshold | -60 to 0 dB |
| 1 | Ratio | 1:1 to 20:1 |
| 2 | Attack | 0.1 to 200 ms |
| 3 | Release | 10 ms to 2 s |
| 4 | Knee | 0 to 24 dB |
| 5 | Make-up | 0 to 24 dB |
| 6 | Key high-pass | Off, or up to 1 kHz |
| 7 | Mix | 0 to 100 % |
| 8 | Key listen | Off, On |

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound.

```rust
use fledge_compressor::{normal, Compressor, THRESHOLD};
use fledge_plugin::{Block, Plugin};

let mut comp = Compressor::new(48000.0);
comp.set(THRESHOLD, normal(THRESHOLD, -24.0));
let (bass, kick) = ([0.2f32; 128], [0.9f32; 128]);
let (mut left, mut right) = ([0f32; 128], [0f32; 128]);
comp.process(&mut Block { input: [&bass, &bass], sidechain: Some([&kick, &kick]), output: [&mut left, &mut right] });
```

## Build and test

```sh
../build.sh fledge-compressor               # the WebAssembly, into public/fledgetone-plugins/
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-compressor
```

## Licence

GPL-3.0-or-later, as the rest of Fledgetone.
