# Fledge Heat

A saturator in three bands, written in Rust. It builds to WebAssembly for Fledgetone
(`public/fledgetone-plugins/fledge-heat.wasm`) and as a Rust library.

The sound is split into lows, mids and highs by two Linkwitz-Riley crossovers (the bands add back
to the sound level for level), and each band goes through its own shape from `fledge-dsp`
(antialiased by antiderivatives), divided by that shape's make-up, which matches the loudness of a
sound near full level: there more drive is more grit, not more level. A quiet sound comes up with
the drive (a supersaw pad at -28 dB came out 5 dB louder through "Torn apart" in the app). The Mix blends against the sound as the split passes it, so the two stay in step.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Low / mid | 60 Hz to 1 kHz |
| 1 | Mid / high | 1 to 12 kHz |
| 2, 5, 8 | Low, Mid, High style | Clean, Soft, Warm, Hard, Fold, Bias, Tube |
| 3, 6, 9 | Low, Mid, High drive | 0 to 36 dB |
| 4, 7, 10 | Low, Mid, High level | -12 to +12 dB |
| 11 | Mix | 0 to 100 % |
| 12 | Output | -12 to +12 dB |

Measured (`cargo test --release -p fledge-heat -- --nocapture`): with only the lows driven hard,
a 100 Hz note has its third harmonic at -18 dB while a 1 kHz note played with it has none
(-88 dB) and the two don't beat (-70 dB). From 6 to 30 dB of drive the level rises by under 3 dB
for Soft, Warm and Hard, falls 0.7 dB for Fold, and rises 5 to 6 dB for Bias and Tube.

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. No added delay, and no oversampling: the shapes are antialiased where they bend.

## Build and test

```sh
../build.sh fledge-heat
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-heat
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
