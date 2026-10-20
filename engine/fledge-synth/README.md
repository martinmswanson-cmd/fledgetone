# Fledge Synth

Fledgetone's own synthesizer, written in Rust. The same engine builds to WebAssembly for the
browser (the studio loads `public/fledgetone-plugins/fledge.wasm` through its plugin host) and
as a Rust library for a future desktop app.

- Two wavetable oscillators (tables generated from formulas, band-limited per octave), each with
  up to 16 unison voices, detune, blend and stereo width; FM from B to A, a sine sub and noise
- Filters: 12 and 24 dB low-pass, ladder, band-pass, high-pass, notch, comb (+/−) and formant
- Amp, filter and pitch envelopes; two LFOs that can lock to the song's tempo (wobbles)
- Drive with six shapes (antialiased), multiband upward/downward compression (OTT), width,
  mono bass below 120 Hz and a safety clipper that never lets a note pass −1 dB
- Built-in presets for bass music, leads, chords and pads

## Build

```sh
./build.sh                                  # release WebAssembly into public/fledgetone-plugins/
node ../../scripts/plugins/catalog.mjs      # refresh the plugin catalog
cargo test --release -- --include-ignored   # engine tests
```

Needs Rust with the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`).
The module has no imports and exports the `bb_*` plugin interface (see `src/abi.rs` and
`scripts/plugins/bbplug.h`). Parameters keep their order: new ones are only ever added at the
end, so saved songs keep their sound.

## Licence

GPL-3.0-or-later, as the rest of Fledgetone.
