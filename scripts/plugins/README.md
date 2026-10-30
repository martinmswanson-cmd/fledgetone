# The built-in plugins

The Plugins menu's effects and instruments are open-source plugins compiled to WebAssembly, one
file per family in `public/fledgetone-plugins/` (published next to the app, downloaded when
first used; see `src/audio/plugins/builtinHost.ts`). `families.json` lists the families, where
their source comes from and the commit used; `LICENSES.txt` is their licence notices.

Every family exports the same small C interface (`bbplug.h`): create a plugin by index, set its
parameters (0 to 1), fill its input buffers, process a block, read its outputs, send it MIDI, and
choose its presets. `bbplug_impl.h` / `bbplug_impl.cpp` make writing a family easy: subclass
`BBPlugin` for each plugin. The app runs them in an AudioWorklet (`src/audio/plugins/processor.ts`).

## Building

Needs [emsdk](https://github.com/emscripten-core/emsdk) (`emcc`, `em++` on the PATH) and, for
Faust, the Faust compiler 2.70 (Ubuntu's `faust` package). Each family's source is checked out
at the commit in `families.json`; then:

```sh
sh airwindows/build.sh <airwin2rack checkout> ../../public/fledgetone-plugins/airwindows.wasm
sh mda/build.sh <mda-vst-src-2015-06-18.zip's mda-vst/src> ../../public/fledgetone-plugins/mda.wasm
sh open303/build.sh <Open303 checkout> ../../public/fledgetone-plugins/open303.wasm
sh mutable/build.sh <eurorack checkout with stmlib> ../../public/fledgetone-plugins/mutable.wasm
python3 faust/build.py ../../public/fledgetone-plugins/faust.wasm
node catalog.mjs   # rewrites src/audio/plugins/pluginCatalog.ts from the files
```

`npm test` checks every plugin in every file: the catalog matches, and each one makes sound (an
instrument) or passes it (an effect) without NaNs.

- **Airwindows**: Airwin Consolidated's sources as they are, with `airwindows/bb_airwin.cpp`.
- **MDA**: the 2015 mda-vst source release, built against `mda/audioeffectx.h` (our own small
  stand-in for the plug-in SDK it was written for, which can't be redistributed). Instruments
  get an output trim so they sit at the app's level. Their MIDI is queued and handed over in one
  call before each block (they start their note list afresh on every call, so one message a call
  kept only a block's last note), and an all-notes-off fades them out over 10 ms before it goes in.
  One change to the source, applied to a copy as it's built (`mda/mdaPiano-loud.patch`; the
  release's files stay as they are): the Piano zeroed a sample and printed a line wherever its
  voices' sum went over 2 (a loud chord: a click), and now only drops a broken value (NaN or
  infinite). Below that level it plays exactly as before.
- **Open303**: its DSP code, with `open303/bb_open303.cpp` (presets ours).
- **Mutable Instruments**: Plaits (each engine an instrument), Braids (its 47 shapes as presets), Rings, Elements and Clouds, with
  `mutable/bb_*.cpp`; `mutable/override/plaits/user_data.h` stands in for the module's flash
  memory. They run at their own rates' tuning (pitch corrected for the browser's rate).
- **Faust**: `faust/plugins.json` lists the programs: physical models from the Faust libraries
  and its STK examples (MIT, BSD, STK-4.3 only), and effects that are one-line programs of ours
  calling the libraries' processors. `faust/trims.json` levels the instruments.

## GPL plugins

Families marked `"gpl": true` (their files in `public/fledgetone-plugins/gpl/`, their catalog in
`src/audio/plugins/pluginCatalogGpl.ts`) are only in builds made with `VITE_GPL_PLUGINS=1`: the
dev server (`.env.development`) and `npm run build:full` (written to `dist-full/`, never to
`dist-single/`). The website build leaves out their catalog, and their files are not copied to
the site, until the app's own source is published: the GPL asks that whoever gets the program can
get its source. `LICENSES-GPL.txt` is their notice (in the third-party licences of the builds that have them: the website and the full build; a copy sits next to them as public/fledgetone-plugins/gpl/LICENSES.txt).

```sh
sh surge/build.sh <surge checkout, with submodules> ../../public/fledgetone-plugins/gpl/surge.wasm
python3 surge/patches.py <surge checkout> ../../public/fledgetone-plugins/gpl/surge-patches
sh dragonfly/build.sh <dragonfly-reverb checkout> ../../public/fledgetone-plugins/gpl/dragonfly.wasm
sh plateau/build.sh <ValleyRackFree checkout> ../../public/fledgetone-plugins/gpl/plateau.wasm
sh setbfree/build.sh <setBfree checkout> ../../public/fledgetone-plugins/gpl/setbfree.wasm
```

- **Surge XT**: its engine library built without JUCE or Lua (`surge/prepare.py` makes the few
  changes WebAssembly needs; `surge/nofiles.c` answers its file lookups with "not found"), with
  `surge/bb_surge.cpp`. Its factory patches are separate files the app fetches when one is chosen
  (`bb_load`); `surge/patches.py` copies them, renaming the few named after artists, songs,
  people or products and leaving out a few crude ones.
- **Dragonfly Reverb**: the hall, room, plate and early-reflection reverbs' DSP with Freeverb3,
  each in its own namespace (`dragonfly/adapter.inc`), with stand-ins for the two bits of DPF the
  DSP uses (`dragonfly/override/`).
- **Plateau**: only the Dattorro plate reverb from ValleyRackFree (`src/Plateau/Dattorro.cpp` and
  the filters and delays it uses), with the VCV module's knob scaling in `plateau/bb_plateau.cpp`.
- **setBfree**: the organ's sources as its LV2 plugin builds them, with `setbfree/bb_setbfree.cpp`
  in place of `b_synth/lv2.c`; settings go through setBfree's named MIDI controls.
  `setbfree/quiet.h` drops its status prints.

When publishing the site, copy only the top-level files of `public/fledgetone-plugins/` (the
`*.wasm` and `LICENSES.txt`), never `gpl/`.
