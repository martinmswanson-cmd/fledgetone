# Fledge Shifter

A frequency shifter, written in Rust. It builds to WebAssembly for Fledgetone
(`public/fledgetone-plugins/fledge-shifter.wasm`) and as a Rust library.

Every frequency is moved by the same number of hertz (a pitch shifter multiplies them), so a
note's overtones go out of tune with it. A hertz or less, mixed half and half, is a phasing that
only rises or only falls; fed back through the delay, each echo is shifted again.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Shift | -2000 to +2000 Hz (finer near 0) |
| 1 | Spread | 0 % (both sides the same), 50 % (the right side unshifted), 100 % (the right side the other way) |
| 2 | Feedback | 0 to 90 % |
| 3 | Delay | 1 to 500 ms (what the feedback goes through) |
| 4 | Mix | 0 to 100 % |

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound.

How: a pair of all-pass chains gives two copies of the sound a quarter turn apart (within 0.7 of a
degree from 0.002 to 0.498 of the sample rate), which a sine and a cosine at the shift turn into
one sideband. In the tests the other sideband is 40 dB or more down from 40 Hz to 12 kHz. The
all-pass coefficients are Olli Niemitalo's published design. One sample of delay.

## Build and test

```sh
../build.sh fledge-shifter
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-shifter
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
