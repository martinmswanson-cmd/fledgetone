# The real instruments' recordings

`public/bos-beat-box-samples/` holds the recordings for the instruments marked **(Real)**:
`cello-sustain`, `cello-spiccato` (Cellos, Cellos Short), `guitar-black` (Electric, Crunch and
Distortion Guitar) and `guitar-green` (Hollow-Body Guitar). Each file is
`<note>_<layer>_<take>.mp3`: the note (`Cs3` = C#3), the loudness (0 = softest) and the take.
`src/audio/instrumentCatalog.ts` (`hosted`) lists them and `scripts/hostedSamples.test.mjs`
checks that every one is there.

Sources (both CC0, public domain):

- Cello section: [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) by Versilian
  Studios, `Strings/Cello Section/susvib` (v1 and v3) and `spic` (v1 and v2, two takes).
- Electric guitars: [Black And Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars)
  by Karoryfer Lecolds (recorded by Brian Wood), `Samples/black/ord` and `Samples/green/ord`:
  `twang_<note>_<p|mf|f>_rr<n>.wav`, every third semitone from E2 (their note names are an
  octave above standard: their `e3` is MIDI 40).

To rebuild them (Python 3 with numpy, and ffmpeg with libmp3lame), from an empty folder:

```sh
cp scripts/real-samples/*.py /some/empty/folder && cd /some/empty/folder
python3 fetch.py      # downloads the source WAVs into dl/
python3 tune.py       # measures each recording's steady pitch into tune.json
python3 convert.py /path/to/bos-beat-box/public/bos-beat-box-samples
```

`convert.py` folds each recording to mono, corrects its pitch, starts it at the note, matches
each note's softer recordings to its loudest one (−4 / −2 dB for the guitars, −3 dB for the
cellos: velocity sets the loudness, the recording the tone), caps the length with a fade (guitars
4 s, sustained cellos 9.5 s, short cellos 2 s), applies one gain per set and writes VBR MP3.

The published site must serve the folder next to `bos-beat-box.html`; the app loads it from
there, or from `https://twobirdsworkshop.com/bos-beat-box-samples/` when the page is opened from
a file or hosted elsewhere (the site's `_headers` allows that cross-origin).
