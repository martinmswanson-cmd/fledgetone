# Fledge Vocoder

A channel vocoder that takes its voice from a sidechain, written in Rust. It builds to WebAssembly
for Fledgetone (`public/fledgetone-plugins/fledge-vocoder.wasm`) and as a Rust library.

The track it's on is the carrier (a synth, a pad, noise); the sidechain is the voice (speech,
singing, drums). Both are split into the same bands, and how loud the voice is in each band sets
how loud the carrier is there. With no sidechain the track passes through as it is.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Bands | 8, 12, 16, 24, 32 |
| 1 | Response | 5 to 300 ms (how long a band rings on after the voice leaves it) |
| 2 | Formant | -12 to +12 semitones (the carrier's bands against the voice's) |
| 3 | Sibilance | 0 to 100 % of the voice's own sound above 5 kHz, let straight through |
| 4 | Mix | 0 % (the carrier alone) to 100 % |
| 5 | Level | -24 to +24 dB |

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. The bands run from 90 Hz to 11 kHz, each two band-pass sections; no added delay.

## Build and test

```sh
../build.sh fledge-vocoder
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-vocoder
```

## Licence

GPL-3.0-or-later, as the rest of Fledgetone.
