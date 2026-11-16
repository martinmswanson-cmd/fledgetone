# Pro tools to build: the list and the workflow plan

Plugins and features that professional producers expect, especially those Ableton Live and FL Studio
have, that Fledgetone doesn't have yet. Checked against the code on 2026-11-15. Phase 0 is
started (steps 1 to 4 and 6 are done), and M1 (#6) is done for the Rust plugins; nothing else is. The new plugins are written in Rust as GPL-3.0-or-later crates that other GPL projects can
use.

## The list

**Where** says what each item is built as:

- **Rust**: a plugin crate in `engine/`.
- **Host**: a feature of the app, written in TypeScript.
- **Both**: a Rust engine with a screen in the app.

**Size** is a rough guess. S is days, M is one or two weeks, L is several weeks.

### Mixing and production tools

| # | Item | What it does | Where | Size | Needs |
|---|------|--------------|-------|------|-------|
| 1 | Resonance suppressor | Finds narrow peaks that ring and move from note to note (growls, supersaws, FM basses) and turns each down only while it rings | Rust | M | 0 |
| 2 | Pro EQ upgrade | Dynamic bands, mid/side per band, a linear-phase mode, **Match** against the reference song. Today's Pro EQ (`src/audio/peq.ts`) is static Web Audio biquads; `PeqEditor.tsx` already draws the curve | Both | L | 0 |
| 3 | Stereo and phase meter | Vectorscope, a live correlation bar, loudness history, PSR/PLR (dynamic range left), a mono-compatibility warning on the master | Both | M | 0 |
| 4 | Vocal cleanup | Noise reduction learned from a quiet stretch of the take, de-hum, de-click, de-plosive | Rust | L | 0 |
| 5 | Audio to MIDI | Turn a recorded melody, bass line or hummed tune into notes (the pitch tracking in `vocalTune.ts` is a start) | Both | M | 0 |
| 6 | Sidechain input for any plugin (done for Rust plugins) | `scripts/plugins/bbplug.h` had stereo in and out only. Add sidechain buffers and a "Sidechain from…" picker so any compressor, gate or vocoder can be keyed from another track | Host + adapter | M | 0 |

### Making your own sounds from sine waves (Operator, Sytrus, Harmor)

| # | Item | What it does | Where | Size | Needs |
|---|------|--------------|-------|------|-------|
| 7 | FM operator synth | 4 to 6 sine operators, each with a ratio or fixed frequency, a multi-stage envelope, feedback and a shape. Preset algorithms, or wire any operator into any other in a matrix (Sytrus-style) | Both | L | 0 |
| 8 | Additive synth and harmonic editor | Draw the level and phase of up to 256 partials and morph between drawings; resynthesise a sample. First step: a harmonic editor that writes into Fledge Synth's **User table** (`src/audio/plugins/userTable.ts`). Then a full additive engine with an envelope on each partial | Both | S, then L | 0 |
| 9 | Wavetable editor | Draw a single cycle, type a formula, or edit each frame (today a User table can only come from an audio clip) | Both | M | 8 |
| 10 | Modulators on any setting | LFO, multi-stage envelope, envelope follower (from another track's level) or random source moving any parameter of any track or plugin (Ableton 12 modulators, FL's Peak and Formula Controllers) | Host | M | 0 |
| 11 | Modular patcher | Oscillators, envelopes, filters, maths, mixers and effects wired freely, saved as an instrument or an effect (FL Patcher, Bitwig Grid). Full control of every part of a sound | Both | L+ | 7, 8, 10 |

### Instruments inside instruments (Instrument Rack, FL Layer and Patcher)

| # | Item | What it does | Where | Size | Needs |
|---|------|--------------|-------|------|-------|
| 12 | Instrument Rack / Layer | One track holding several chains, each any instrument with its own effects. Per chain: key zone, velocity zone, level, pan, transpose. One **chain selector** knob crossfades between chains. 8 macros reach any setting inside. Saves to **My sounds** as one sound | Host | L | — |
| 13 | Effect Rack | Parallel effect chains on one insert: parallel compression, different chains for the lows and the highs, dry/wet per chain | Host | M | 12 |
| 14 | Drum Rack pads that hold any instrument | A pad plays a Drum Designer kick, a Fledge Synth patch or a plugin, with its own effects and sends (today: samples only) | Host | M | 12 |

### Other Ableton and FL staples

| # | Item | What it does | Where | Size | Needs |
|---|------|--------------|-------|------|-------|
| 15 | MIDI effects chain | Arpeggiator, chord, scale lock, note echo, randomise and velocity shaping, before the instrument (Ableton's MIDI effects, FL's Riff Machine) | Both | M | 0 |
| 16 | Microtuning | Tuning systems and Scala (`.scl`) files for every instrument (Ableton 12) | Both | M | 0 |
| 17 | Granular instrument | Play your own sample as grains (Ableton's Granulator, FL's Granulizer); Clouds exists only as an effect | Rust | M | 0 |
| 18 | Transient shaper | Attack and sustain with a display that shows what it does (Faust's Transient has only sliders) | Rust | S | 0 |
| 19 | Polarity and phase alignment | A polarity flip and a phase alignment control on every channel strip (`lineUp.ts` may cover part) | Host | S | — |

## Workflow plan

### Phase 0: foundations (once, before any new plugin)

Fledge Synth (`engine/fledge-synth`) already shows the pattern: a Rust crate under
GPL-3.0-or-later with no dependencies. It builds as `rlib` (a plain library) and as `cdylib` (the
`.wasm` the app loads through the `bb_*` interface in `src/abi.rs`). Phase 0 turns that one crate
into a home for many:

1. **Cargo workspace** in `engine/`, with Fledge Synth as its first member. *Done 2026-11-16.*
2. **`fledge-dsp`**: move the shared building blocks out of Fledge Synth's `dsp.rs`, `fx.rs` and
   `tables.rs` (oversampling, filters, FFT, envelopes, LFOs, band-limited tables).
   `tests/legacy_sound.rs` and `scripts/audio-check/repeat.cjs` prove Fledge Synth sounds exactly
   as before. *Done 2026-11-16: `engine/fledge-dsp`. Every preset rendered through the old and
   the new `fledge.wasm` at 44.1, 48 and 96 kHz came out the same sample for sample.*
3. **A `Plugin` trait** that every plugin crate implements. It covers:
   - describing its parameters;
   - processing a block of audio, with an optional sidechain;
   - taking MIDI events;
   - saving and loading its state.

   The project's rule that parameters are only ever added at the end (so saved songs keep their
   sound) is written into the trait's documentation. *Done 2026-11-16: `engine/fledge-plugin`.*
4. **`fledge-wasm`**: one adapter, generalised from Fledge Synth's `abi.rs`, that turns any
   `Plugin` into a `bb_*` `.wasm`, plus one build script for every family. The sidechain buffers
   (#6) go into the interface here, so every new plugin supports them from day one.
   *Done 2026-11-16: `engine/fledge-wasm` (`fledge_wasm::export!`) and `engine/build.sh`. Fledge
   Synth runs through it and sounds the same sample for sample. The sidechain is in the
   interface (`bb_sidechain`, buffers 4 and 5; see `scripts/plugins/bbplug.h`); the app doesn't
   feed it yet, which is M1.*
5. **Native wrapper spike**: build Fledge Synth as CLAP and VST3 (for example with nih-plug) and
   open it in Reaper or Bitwig. This decides whether native builds are part of each plugin's
   workflow.
6. **CI**: there is none today (`.github/` has only templates). Add a GitHub Actions workflow that
   runs `cargo test`, `cargo clippy` and the wasm build, next to the app's checks
   (`tsc -b`, `oxlint`, `npm test`, `npm run build`). *Done 2026-11-16:
   `.github/workflows/checks.yml`; clippy passes with no warnings (the lints left alone are
   listed in `engine/Cargo.toml`).*
7. **Decisions to make**:
   - the crate names on crates.io;
   - whether native builds ship with each release;
   - a short README template for each crate (what it is, usage, licence).

### The workflow for each Rust plugin

1. **Spec**: one page with:
   - what it does, and which Ableton or FL tool it compares to;
   - its parameters, presets and CPU budget;
   - how we'll measure that it works.
2. **DSP crate** on `fledge-dsp`, with Rust tests:
   - no NaNs and no denormal stalls;
   - level-matched where it should be;
   - no aliasing;
   - the same input always gives the same output;
   - the same sound at 32, 44.1, 48 and 96 kHz.
3. **Measurement example**, like `engine/fledge-synth/examples/bands.rs`, that prints numbers to
   tune by.
4. **Into the app**:
   - build the `.wasm` through `fledge-wasm`;
   - add it to `scripts/plugins/families.json`;
   - run `node scripts/plugins/catalog.mjs` and `scripts/plugins.test.mjs`.
5. **Its window**: start with the generic slider window. Add a custom panel only where the plugin
   needs one (an EQ curve, a harmonic drawing, an operator matrix).
6. **Sound checks** (CONTRIBUTING.md, "The checks"):
   - `repeat.cjs`: live and export match;
   - `rates.cjs`: the same sound at every sample rate;
   - `switch-sweep.cjs`: presets, undo and Reset all, with no bursts;
   - its level next to the other plugins.
7. **Docs**: a GUIDE.md section, credits in `src/credits.ts`, a CHANGELOG line, `npm run codemap`.
8. **Native build** (if Phase 0 says yes): CLAP and VST3, opened in another DAW.
9. **Publish**: version the crate and release it on crates.io with a usage example.

### The workflow for each host feature (#6, #10, #12 to #14, #19)

1. **Spec**: what the user sees, what is saved, how it sounds live and in an export.
2. **Data**: new fields in `timelineTypes.ts`, optional with defaults, repaired by `parseProject`
   (CONTRIBUTING.md, "Projects keep opening").
3. **Pure logic** in its own file with node tests in `scripts/*.test.mjs`.
4. **Audio graph**: built by a factory that works live and in an export. It costs nothing while
   off.
5. **Screens**, then the UI checks (`scripts/ui-check/popup-tab.cjs` for menus and popups).
6. **Sound checks**, docs and the changelog, as for a plugin.

### Milestones, in order

| Milestone | Items | Why here |
|-----------|-------|----------|
| M0 Foundations | Phase 0 | Everything else builds on it |
| M1 Sidechain | #6 | Goes into the adapter while it's new. *Done 2026-11-16 for Rust plugins: a "Sidechain from" picker on any plugin that listens to one, live, in exports, stems and freezes, and Fledge Compressor (`engine/fledge-compressor`) as the first. The C families are not rebuilt (their compressors have no key input), so the existing plugins don't listen yet.* |
| M2 Racks | #12, then #13 and #14 | Layering for every existing instrument; the Effect Rack and pads reuse it |
| M3 Harmonic editor | #8 first step | Sine-wave sound design for little work, into Fledge Synth |
| M4 FM operator synth | #7 | The first new Rust instrument; proves the per-plugin workflow |
| M5 Modulators | #10 | Brings LFOs and followers to every setting; the patcher needs it |
| M6 Bass-music mixing | #1, #2, #18 | The core of dubstep and EDM mixes |
| M7 Recording tools | #4, #5, #3 | For vocals and recorded parts |
| M8 Staples | #9, #15, #16, #17, #19 | Each one stands alone |
| M9 Modular patcher | #11, full additive engine (#8) | The largest; builds on M3 to M5 |

Each milestone ends with a release: the checks pass, GUIDE.md and CHANGELOG.md are updated, and the
crates are published.
