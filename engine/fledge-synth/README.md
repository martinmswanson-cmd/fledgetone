# Fledge Synth

Fledgetone's own synthesizer, written in Rust. The same engine builds to WebAssembly for the
browser (the studio loads `public/fledgetone-plugins/fledge.wasm` through its plugin host) and
as a Rust library for a future desktop app.

- Two wavetable oscillators (tables generated from formulas, band-limited per octave), each with
  up to 16 unison voices, detune, blend and stereo width; FM from B to A, a sine sub and noise
- Filters: 12 and 24 dB low-pass, ladder, band-pass, high-pass, notch, comb (+/−) and formant
- Amp, filter, mod and pitch envelopes (the pitch one exponential or straight, for dives into
  each note); glide always or between joined notes only, at a constant time or rate, curved or
  straight
- Four LFOs: Free (one for every note, its phase read from the song position), Retrig, Envelope
  (one cycle, then it holds) and Sustain env (holds at a point while the key is down); delay,
  rise, smooth, key tracking, and when a mono note restarts them; synced to the song in straight,
  dotted and triplet values
- Per-note sources: note random (0..1 and −1..1), chaos (stepped random at a synced rate),
  velocity, note, release velocity, note pressure. Random values are seeded from the song
  position and the note (and can repeat each bar), so the live playback, an export and every
  re-export match
- A 16-slot matrix, each slot with a curve (linear, exponential, logarithmic, S) and an optional
  "via" source scaling its amount
- Drive in three places: before the filters, after them (with a cabinet-style tone) and on the
  mids and highs after the voices (the lows stay clean); soft, warm, hard clip, fold, asymmetric,
  tube (antialiased), bitcrush and downsample, each levelled so it adds grit, not volume
- The sub is mixed in clean and mono after the drive, the OTT and the effects (older saved sounds
  keep it with the voices, as they had it)
- Multiband upward/downward compression (OTT), effects, width, mono bass below 120 Hz and a
  safety clipper that never lets a note pass −1 dB
- Built-in presets for bass music, leads, chords and pads

Saved sounds keep their sound: parameters are only ever added at the end, and a sound saved
with fewer of them loads with the new ones set as it sounded then (`bb_legacy`).
`tests/legacy_sound.rs` renders every older preset and an older saved sound and compares them
with numbers taken from the engine before the change. `cargo run --release --example movement`
measures how the presets' timbre moves on a riff of 16ths (src/analysis.rs).

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
