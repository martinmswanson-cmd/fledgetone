# Fledge Dynamic EQ

Four bells that can move with the sound, each on both sides, the middle or the sides. Written in
Rust; it builds to WebAssembly for Fledgetone (`public/fledgetone-plugins/fledge-eq.wasm`) and as
a Rust library.

Each band is a bell (the form in Robert Bristow-Johnson's Audio EQ Cookbook). A band with a
"moves by" amount listens to its own range (a band-pass as wide as the bell, on the sound as it
came in) and turns by that much more as that range passes its threshold: nothing at the threshold,
all of it 12 dB over, 10 ms to get there and 150 ms back. The sound is worked on as middle and
side (the sum and the difference of the two sides), so a band can treat either alone.

Four bands, six parameters each (band 1 is parameters 0 to 5, band 2 is 6 to 11, and so on), then
the output:

| Parameter | Range |
| --- | --- |
| Frequency | 20 Hz to 20 kHz |
| Gain | -18 to +18 dB |
| Width | 0.3 (wide) to 12 (narrow) |
| Moves by | -18 to +18 dB (0: it doesn't move) |
| Threshold | -70 to 0 dB |
| Works on | Stereo, Mid, Side |
| 24: Output | -12 to +12 dB |

Measured (the test `a_moving_band_turns_only_while_its_range_is_loud`): a band that moves by
-10 dB over -30 dB leaves a sound at -50 dB alone (0.00 dB) and turns one at -6 dB down 9.99 dB.

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. No added delay. It has sliders, not a curve to draw on: Fledgetone's Pro EQ insert is still the drawn one.

## Build and test

```sh
../build.sh fledge-eq
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-eq
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
