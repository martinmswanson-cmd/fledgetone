# Pitch survey for the recorded instruments

How `src/audio/sampleTuning.ts` was made, to re-run when instruments or recordings change.
Needs Python 3 with numpy, ffmpeg, and the Playwright harness used elsewhere (`npx vite --port 5200`).

1. Export each sampled instrument's recordings (baseUrl + samples) from the catalog to `list.json`,
   download them, and measure every recording with `fastpitch.py jobs.json out.json`: the pitch is
   read by its period (YIN, energy-weighted over the loud part of the note) and from its harmonics.
2. For soundfont instruments, download every semitone too and run `select.py`: each sample slot uses
   the steadiest recording within a semitone (both readings agree within 12 cents, spread under 25),
   corrected by its measured offset. Writes `tuning.json`.
3. Render chromatic scales through the app (`node scales.cjs <keys...>`, `DIR=` for the folder) and
   run `refine.py <dir>`: the keys that play from one recording give its remaining error; their
   median updates its correction. One round brought 99.8% of keys within 10 cents.
4. `gen.py` writes `src/audio/sampleTuning.ts` from `tuning.json`.

Not corrected: bells and mallets (their overtones aren't harmonic), drums, and the piano (stretched
tuning is deliberate). Voices are read by their period only (vowels fool the harmonic reading).
Pizzicato uses the FluidR3 recordings, one per semitone: the Musyng Kite ones are a section whose
pitch wanders by 20-50 cents within a note (its G-flat 3 is a semitone flat), which no single
correction can fix.
