# Fledge Repeat

A beat repeat in time with the song, written in Rust. It builds to WebAssembly for Fledgetone
(`public/fledgetone-plugins/fledge-repeat.wasm`) and as a Rust library.

While it's on, the slice of sound that comes in next plays as it comes and then again and again in
place of the track: a stutter, a roll, a fill. It goes on with the **Repeat** switch, or by itself
for the last stretch of every bar or every few bars.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Repeat | Off, On |
| 1 | Every | Off, 1, 2, 4 or 8 bars (how often it goes on by itself) |
| 2 | For | 1/8, 1/4, 1/2, 1 bar, 2 bars (the end of each stretch it fills) |
| 3 | Slice | 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32, 1/32T, 1/64 |
| 4 | Gate | 10 to 100 % of each repeat sounds |
| 5 | Decay | 0 to 100 % quieter, each repeat than the last |
| 6 | Pitch | -12 to +12 semitones, each repeat against the last |
| 7 | Chance | 0 to 100 %: how many of its own fills play (the same ones every time) |
| 8 | Mix | 0 to 100 % |

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. It follows the host's tempo and position (`Info::transport`): a bar is counted as four
beats. No added delay; the beat after a fill is the track from its first sample.

## Build and test

```sh
../build.sh fledge-repeat
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-repeat
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
