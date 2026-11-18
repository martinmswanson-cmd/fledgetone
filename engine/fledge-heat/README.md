# Fledge Heat

A saturator in three bands, written in Rust. It builds to WebAssembly for Fledgetone
(`public/fledgetone-plugins/fledge-heat.wasm`) and as a Rust library.

The sound is split into lows, mids and highs by two Linkwitz-Riley crossovers. The lows also pass
the upper crossover's turn of phase, so the bands add back to the sound level for level wherever
the crossovers sit (within 0.03 dB from 100 Hz to 8 kHz, with them as close as they go). Each band
is taken to twice the sample rate, goes through its own shape from `fledge-dsp` (antialiased by
antiderivatives) there, and comes back; divided by that shape's make-up, which matches the loudness of a
sound near full level: there more drive is more grit, not more level. A quiet sound comes up with
the drive (a supersaw pad at -28 dB came out 5 dB louder through "Torn apart" in the app). The Mix blends against the sound as the split passes it, so the two stay in step.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Low / mid | 60 Hz to 1 kHz |
| 1 | Mid / high | 1 to 12 kHz (never less than 1.5 times Low / mid: it shows what's used) |
| 2, 5, 8 | Low, Mid, High style | Clean, Soft, Warm, Hard, Fold, Bias, Tube |
| 3, 6, 9 | Low, Mid, High drive | 0 to 36 dB |
| 4, 7, 10 | Low, Mid, High level | -12 to +12 dB (a Clean band's too) |
| 11 | Mix | 0 to 100 % |
| 12 | Output | -12 to +12 dB |

Measured (`cargo test --release -p fledge-heat -- --nocapture`): with only the lows driven hard,
a 100 Hz note has its third harmonic at -18 dB while a 1 kHz note played with it has none
(-88 dB) and the two don't beat (-70 dB). From 6 to 30 dB of drive the level rises by under 3 dB
for Soft, Warm and Hard, falls 0.5 dB for Fold, and rises 5 to 6 dB for Bias and Tube. A quiet
high note through a driven band loses 0.2 dB at 10 kHz and 1.3 dB at 18 kHz (shaped at the base
rate it lost 1.8 and 8.1 dB), and at half Mix 0.2 and 1.0 dB: the Mix doesn't comb.

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. No frames and no look-ahead: the sound is late only by what the filters turn it (a few samples). A band switched to Clean and back starts clean.

## Build and test

```sh
../build.sh fledge-heat
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-heat
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
