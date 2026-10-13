# The built-in plugins

The Plugins menu's effects and instruments are open-source plugins compiled to WebAssembly, one
file per family in `public/bos-beat-box-plugins/` (published next to the app, downloaded when
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
sh airwindows/build.sh <airwin2rack checkout> ../../public/bos-beat-box-plugins/airwindows.wasm
sh mda/build.sh <mda-vst-src-2015-06-18.zip's mda-vst/src> ../../public/bos-beat-box-plugins/mda.wasm
sh open303/build.sh <Open303 checkout> ../../public/bos-beat-box-plugins/open303.wasm
sh mutable/build.sh <eurorack checkout with stmlib> ../../public/bos-beat-box-plugins/mutable.wasm
python3 faust/build.py ../../public/bos-beat-box-plugins/faust.wasm
node catalog.mjs   # rewrites src/audio/plugins/pluginCatalog.ts from the files
```

`npm test` checks every plugin in every file: the catalog matches, and each one makes sound (an
instrument) or passes it (an effect) without NaNs.

- **Airwindows**: Airwin Consolidated's sources as they are, with `airwindows/bb_airwin.cpp`.
- **MDA**: the 2015 mda-vst source release, built against `mda/audioeffectx.h` (our own small
  stand-in for the plug-in SDK it was written for, which can't be redistributed). Instruments
  get an output trim so they sit at the app's level.
- **Open303**: its DSP code, with `open303/bb_open303.cpp` (presets ours).
- **Mutable Instruments**: Plaits (each engine an instrument), Rings, Elements and Clouds, with
  `mutable/bb_*.cpp`; `mutable/override/plaits/user_data.h` stands in for the module's flash
  memory. They run at their own rates' tuning (pitch corrected for the browser's rate).
- **Faust**: `faust/plugins.json` lists the programs: physical models from the Faust libraries
  and its STK examples (MIT, BSD, STK-4.3 only), and effects that are one-line programs of ours
  calling the libraries' processors. `faust/trims.json` levels the instruments.

## GPL plugins

Families marked `"gpl": true` are only offered by builds made with `VITE_GPL_PLUGINS=1`
(`npm run build:full`), and their files are only published once the app's own source is: the GPL
asks that whoever gets the program can get its source.
