# Fledge Smooth

A resonance suppressor, written in Rust. It builds to WebAssembly for Fledgetone
(`public/fledgetone-plugins/fledge-smooth.wasm`) and as a Rust library.

It listens to the sound in 28 narrow bands from 60 Hz to 16 kHz, compares each band's level with
the bands two to four places either side of it, and turns a band down (with a bell filter) only
while it stands out from them, and only by as much as it does. Levels are steadied first, so hiss
wavering in a narrow band isn't taken for a resonance: a band's own over the Attack (15 ms at
least), its neighbours' over 40 ms as they fall and as fast as its own as they rise, so a sound
that starts isn't cut while its neighbours catch up.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Depth | 0 to 100 % (of up to 24 dB a band) |
| 1 | Stands out by | 0 to 18 dB |
| 2 | Attack | 1 to 200 ms |
| 3 | Release | 20 ms to 2 s |
| 4 | From | 60 Hz to 16 kHz |
| 5 | To | 60 Hz to 16 kHz |
| 6 | Removed only | Off, On |

Measured (`cargo test --release -p fledge-smooth -- --nocapture how_much`): a 2 kHz tone ringing
24 dB over hiss comes down 6.9 dB at a depth of 25 %, 13.9 dB at 50 % and 27.9 dB at 100 %, while
500 Hz moves by 0.1 dB at most. On hiss alone the deepest cut at any moment is 1.3 dB at the
default Attack (1.6 dB at 1 ms, 0.2 dB at 100 ms). At full depth with an Attack of 1 ms a ringing
that starts is down 11 dB after 20 ms and 19 dB after 40 ms; with 30 ms, 5 dB after 40 ms.

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. No added delay: each band is a filter that runs along with the sound. Bands are about a third of an octave wide, so it is coarser than a suppressor that works on a spectrum, and it has not been tuned by ear yet.

## Build and test

```sh
../build.sh fledge-smooth
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-smooth
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
