# Fledge Harmony

Harmony voices from one sung or played line, written in Rust. It builds to WebAssembly for
Fledgetone (`public/fledgetone-plugins/fledge-harmony.wasm`) and as a Rust library.

It follows the pitch of a single line (one note at a time) and adds up to two voices above or
below it. In a key and scale the intervals are steps of the scale, so the harmony stays in key; in
Chromatic they are semitones. The added voices keep the original's resonances (pitch-synchronous
overlap-add), so a voice shifted up still sounds like the same singer.

| # | Parameter | Range |
| --- | --- | --- |
| 0 | Key | C to B |
| 1 | Scale | Major, Minor, Chromatic |
| 2 | Voice 1 | -12 to +12 steps of the scale (semitones in Chromatic) |
| 3 | Voice 1 level | 0 to 100 % |
| 4 | Voice 2 | -12 to +12 steps |
| 5 | Voice 2 level | 0 to 100 % |
| 6 | Dry | 0 to 100 % of the line itself |
| 7 | Formant | -12 to +12 semitones (the voices' resonances, apart from their pitch) |
| 8 | Spread | 0 to 100 %: voice 1 to the left, voice 2 to the right |
| 9 | Detune | 0 to 30 cents: voice 1 sharp, voice 2 flat |

Parameters keep their order: new ones are only ever added at the end, so saved songs keep their
sound.

What to know:

- It follows pitches from 70 Hz to 1 kHz, one note at a time. Where there is no clear single pitch
  (consonants, breath, chords, silence) the added voices rest.
- The added voices come about two and a half periods behind the line (12 ms at 200 Hz, 30 ms at
  80 Hz). The line itself is not delayed.
- Two voices cost about 2.4 % of one processor core at 48 kHz (measured in Node).
- The grains are cut in step with the pitch found, not at the voice's own pulses, and the tests
  are on made-up vowel tones: it has not been tuned by ear on real singing.

## Build and test

```sh
../build.sh fledge-harmony
node ../../scripts/plugins/catalog.mjs > /dev/null
cargo test --release -p fledge-harmony
```

## Licence

GPL-3.0-or-later, as the rest of Fledgetone.
