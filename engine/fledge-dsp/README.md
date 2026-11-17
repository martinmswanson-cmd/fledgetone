# Fledge DSP

The building blocks Fledgetone's plugins are made of, written in Rust with no dependencies. The
same code builds natively and to WebAssembly, and gives the same output for the same input every
time.

| Module | What's in it |
| --- | --- |
| `filter` | A zero-delay-feedback state-variable filter, a four-pole ladder, a pitched comb, vowel formants, shelving and peak biquads, a one-pole low pass, a DC blocker |
| `oversample` | Twice the sample rate and back (polyphase half-band filters, 90 dB of rejection) |
| `shaper` | Drive shapes antialiased by antiderivatives, their make-up gain, and a soft ceiling at -1 dBFS |
| `envelope` | An ADSR with analog-like curves |
| `lfo` | LFO shapes |
| `delay` | A delay line read between samples (linear or Hermite) |
| `dynamics` | A three-band compressor that works both ways (OTT) |
| `fft` | A radix-2 FFT |
| `wavetable` | Wavetables of morphing frames, band-limited per octave and made when first read; tables from your own single cycles |
| `math` | Denormal flushing, a fast tanh, a seeded random generator |

It began as part of [Fledge Synth](../fledge-synth), which is built on it.

```rust
use fledge_dsp::filter::{Svf, SvfCoef};

// Cutoff in Hz, the sample rate, and the damping (1.414 is flat; lower rings more)
let coef = SvfCoef::new(800.0, 48000.0, 1.414);
let mut filter = Svf::default();
let low = filter.tick(&coef, 0.5).lp;
```

## Test

```sh
cargo test --release -p fledge-dsp
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
