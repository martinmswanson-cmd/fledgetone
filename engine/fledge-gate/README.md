# Fledge Gate

A gate that can open on a sidechain, written in Rust. It builds to WebAssembly for Fledgetone
(`public/fledgetone-plugins/fledge-gate.wasm`) and as a Rust library.

It lets a sound through while what it listens to is over the threshold, and turns it down by the
Range while it isn't. Listening to its own input it cleans up a recording; listening to another
track it chops one sound to the rhythm of another; flipped, it silences the sound under the other.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Threshold | -80 to 0 dB |
| 1 | Range | 0 to 80 dB (at the top: shut) |
| 2 | Attack | 0.1 to 100 ms |
| 3 | Hold | 0 to 500 ms |
| 4 | Release | 5 ms to 2 s |
| 5 | Hysteresis | 0 to 12 dB |
| 6 | Key high-pass | Off, or up to 1 kHz |
| 7 | Flip | Off, On |
| 8 | Key listen | Off, On |

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound. No look-ahead, so no added delay; one gain for both channels.

## Build and test

```sh
../build.sh fledge-gate
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-gate
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
