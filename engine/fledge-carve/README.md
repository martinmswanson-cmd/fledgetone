# Fledge Carve

Makes room for another track, written in Rust. It builds to WebAssembly for Fledgetone
(`public/fledgetone-plugins/fledge-carve.wasm`) and as a Rust library.

It listens to the sidechain in 28 narrow bands from 60 Hz to 16 kHz and turns its own input down,
band by band (a bell filter each), by as much as the sidechain is sounding there: nothing at the
threshold, the whole Amount 18 dB over it. With no sidechain it passes its input exactly.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Amount | 0 to 24 dB |
| 1 | Threshold | -70 to 0 dB |
| 2 | Attack | 1 to 200 ms |
| 3 | Release | 20 ms to 2 s |
| 4 | From | 60 Hz to 16 kHz |
| 5 | To | 60 Hz to 16 kHz |
| 6 | Removed only | Off, On |

Measured (the test `it_turns_down_only_where_the_other_track_is`): with a 1 kHz tone on the
sidechain and the defaults (an Amount of 8 dB), this track's 1 kHz comes down 7.7 dB, its 200 Hz
and 5 kHz by under 0.1 dB. Each band is set to 0.8 of the Amount, because neighbouring bells
overlap: a track carved across its whole range then comes down by about the Amount.

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. No added delay.

## Build and test

```sh
../build.sh fledge-carve
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-carve
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
