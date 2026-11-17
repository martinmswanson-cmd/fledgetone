# Fledge Wasm

Turns any [`fledge-plugin`](../fledge-plugin) `Plugin` into the WebAssembly module Fledgetone's
plugin host loads: the `bb_*` interface of `scripts/plugins/bbplug.h`. No dependencies beyond
`fledge-plugin`.

In the plugin's crate, built as a `cdylib`:

```rust
fledge_wasm::export!(MySynth, MyEffect);
```

One module is a "family" of one or more plugins, in the order given. A plugin's place in that
order is saved in songs, so new plugins go at the end.

To add a family to Fledgetone:

1. Add its crate to the workspace (`engine/Cargo.toml`) and to `FAMILIES` in `engine/build.sh`.
2. Add it to `scripts/plugins/families.json`.
3. Run `engine/build.sh`, then `node scripts/plugins/catalog.mjs > /dev/null`.
4. An effect also goes on the Tools page: add it to `FLEDGE_EFFECTS` in `scripts/tools-site.mjs` and
   to `EFFECTS` in `tools/fledge-effects/fledge-effects.js` (a test fails until it is).

A family's own exports beyond the interface (Fledge Synth's user table, for one) reach their
plugin with `fledge_wasm::host().plugin::<MySynth>(handle)`.

## Test

```sh
cargo test --release -p fledge-wasm
```

The adapter runs natively too: the tests drive it as the plugin host does.

## Licence

GPL-3.0-or-later, as the rest of Fledgetone.
