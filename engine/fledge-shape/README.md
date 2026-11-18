# Fledge Shape

A shape that repeats in time with the song and moves the volume, a filter or the pan. Written in
Rust; it builds to WebAssembly for Fledgetone (`public/fledgetone-plugins/fledge-shape.wasm`) and
as a Rust library.

The host tells it the tempo and the song's position in beats (`Info::transport`), and it counts on
between tellings, so the shape lands on the same beats every time. A position under 0 (the song
has stopped) leaves it running from where it was.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Moves | Volume, Low-pass, High-pass, Pan |
| 1 | Shape | Duck, Fall, Rise, Triangle, Gate, Trance gate, Stairs, Bounce |
| 2 | Every | 4 bars, 2 bars, 1 bar, 1/2, 1/4, 1/8, 1/8T, 1/16, 1/16T, 1/32 |
| 3 | Depth | 0 to 100 % |
| 4 | Smooth | 1 to 51 ms |
| 5 | Starts at | 0 to 100 % of the way through the shape |

A shape's height runs from 0 to 1. On the volume, 1 is the sound untouched and 0 silence (at full
depth). On the low-pass 1 is 20 kHz and 0 is 200 Hz; on the high-pass 1 is 20 Hz and 0 is 4 kHz.
On the pan, 0 is left and 1 right, and a side is only ever turned down. A bar is counted as four
beats.

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. No added delay. The shapes are fixed: there is no drawing your own yet, and it moves one thing at a time.

## Build and test

```sh
../build.sh fledge-shape
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-shape
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
