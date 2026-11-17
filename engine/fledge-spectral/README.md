# Fledge Spectral

An effect that works on a sound by its spectrum, written in Rust. It builds to WebAssembly for
Fledgetone (`public/fledgetone-plugins/fledge-spectral.wasm`) and as a Rust library.

The sound is cut into overlapping frames, each taken apart into how loud and where in its cycle
every frequency is, changed there, and put back together.

| # | Parameter | What it does |
| --- | --- | --- |
| 0 | Freeze | Off, On: while on, the sound of the moment it was switched is held and goes on sounding |
| 1 | Gate | Off, or -90 to 0 dB: frequencies quieter than this are taken out, each on its own |
| 2 | Blur | 0 to 100 %: each frequency's loudness lingers (at full, about 9 dB down every 3 s) |
| 3 | Smear | 0 to 100 %: each frequency is spread over its neighbours (up to 3 % of the spectrum either way), and scattered, so pitches turn breathy |
| 4 | Mix | 0 to 100 % |

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound.

What to know:

- **It is one frame late:** 2048 samples up to 48 kHz (43 ms at 48 kHz), 4096 above. The dry part
  of the Mix is held back by the same, so the two stay in step, but the host is not told, so the
  track plays that much behind the others.
- With nothing set, what comes out is what went in (to within 0.0002), one frame late.
- A held or lingering note keeps turning at its own rate: each frequency takes the turn of the
  peak it belongs to, so close notes in a chord hold without beating against each other.
- Smear scatters each side on its own, so a sound in the middle comes out wide.
- The smear's lost loudness is made up to within about 3 dB, between what clear notes and noise lose.

## Build and test

```sh
../build.sh fledge-spectral
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-spectral
```

## Licence

MIT (see `LICENSE` in the `engine` folder). The studio itself is GPL-3.0-or-later.
