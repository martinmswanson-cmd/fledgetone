# Fledge Plugin

The `Plugin` trait that Fledgetone's Rust instruments and effects implement. No dependencies.

A plugin describes itself, has parameters set as 0..1, processes stereo audio a block at a time
(with an optional sidechain), may take MIDI, may come with presets, and can save and load its
state. It knows nothing about who runs it: [`fledge-wasm`](../fledge-wasm) turns any `Plugin` into
the WebAssembly module Fledgetone loads.

```rust
use fledge_plugin::{Block, Info, Plugin};

struct Gain {
    level: f32,
}

impl Plugin for Gain {
    fn info() -> Info {
        Info { name: "Gain", category: "Utility", about: "Turns it up or down.", instrument: false, sidechain: false, transport: false, tags: &[] }
    }
    fn new(_sample_rate: f32) -> Self {
        Gain { level: 0.5 }
    }
    fn param_count() -> usize {
        1
    }
    fn param_name(_i: usize) -> &'static str {
        "Level"
    }
    fn get(&self, _i: usize) -> f32 {
        self.level
    }
    fn set(&mut self, _i: usize, value: f32) {
        self.level = value;
    }
    fn process(&mut self, block: &mut Block) {
        for ch in 0..2 {
            for (out, x) in block.output[ch].iter_mut().zip(block.input[ch]) {
                *out = x * self.level * 2.0;
            }
        }
    }
}
```

Two rules every plugin keeps (the crate's documentation says why):

- **Parameters are only ever added at the end.** A saved song stores them by position, so one
  never moves, goes or changes meaning. `legacy(count)` is where an older sound's newer
  parameters are set as it sounded when it was saved.
- **The same input gives the same output**, so live playback and an export match.

## Licence

GPL-3.0-or-later, as the rest of Fledgetone.
