# The real instruments' recordings

`public/fledgetone-samples/` holds the recordings for the instruments marked **(Real)**, one
folder per set (a set can serve several instruments: the Electric, Crunch and Distortion Guitars
all play `guitar-black`). Each file is `<note>_<layer>_<take>.mp3`: the note (`Cs3` = C#3), the
loudness (0 = softest) and the take. `src/audio/hostedSets.ts` lists each set's notes, loudnesses
and takes (generated), `src/audio/instrumentCatalog.ts` (`real`) turns a set into an instrument,
and `scripts/hostedSamples.test.mjs` checks every file an instrument plays is there.

## Where they come from

All public domain (CC0, The Unlicense) or free to redistribute (one with credit, CC BY 3.0);
`src/credits.ts` credits each one.

- [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) by Versilian Studios: the
  string sections, solo violin, harp, flute, oboe, clarinet, bassoon, horn, trumpet, trombone,
  tuba, marimba, xylophone, glockenspiel, pipe organ and upright piano (the piano by Simon Dalzell
  of Ivy Audio, redistributable as part of VSCO).
- [VCSL](https://github.com/sgossner/VCSL) (Versilian Community Sample Library) by Versilian
  Studios: timpani, tubular bells, vibraphone, harpsichord, kalimba, tenor saxophone, harmonica,
  ocarina, zither (a dan tranh) and concert bass drum.
- Karoryfer Lecolds: electric guitars ([Black And Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars),
  [Emily Guitar](https://github.com/sfzinstruments/karoryfer.emilyguitar)), saxophones
  ([Weresax](https://github.com/sfzinstruments/karoryfer.weresax), [Bear Sax](https://github.com/sfzinstruments/karoryfer.bear-sax)),
  double bass ([Meatbass](https://github.com/sfzinstruments/karoryfer.meatbass)) and electric bass
  ([Growlybass](https://github.com/sfzinstruments/karoryfer.growlybass)), the studio drum kit
  ([Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums)) and the solo
  voice (the "a" vowel of the [legato vocal tutorial](https://github.com/sfzinstruments/legato_vocal_tutorial)),
  all CC0.
- [Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano): public-domain
  samples by AKAI.
- [jSteelDrum](https://github.com/sfzinstruments/jlearman.SteelDrum) by jlearman (The Unlicense,
  public domain): steel drums.
- [E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos): an electric piano recorded
  by Greg Sullivan (CC BY 3.0; credit "Greg Sullivan").
- [ganjo](https://github.com/sfzinstruments/ganjo) by itsclipping (CC0): a six-string banjo.

## Rebuilding them

Needs Python 3 with numpy, git, and ffmpeg with libmp3lame. From an empty working folder (the
downloads take about 1.7 GB):

```sh
python3 /path/to/bos-beat-box/scripts/real-samples/fetch.py            # downloads into dl/<set>/
python3 /path/to/bos-beat-box/scripts/real-samples/measure.py          # each recording's real note and tuning: measure.json
python3 /path/to/bos-beat-box/scripts/real-samples/convert.py /path/to/bos-beat-box
```

Each script takes set names to work on just those (`fetch.py --list harp` shows what a set would
fetch). `SHOW_TRIM=1 convert.py ...` prints how much each note was evened out. The drum kit is
mixed instead of fetched: run `kit.py studio-kit` before measuring and converting it.

- **`sets.py`** says what each set is made of: the library, which files (a pattern that reads
  the note, loudness and take from each file's name), how its names count octaves, and what kind
  of note it is (held, short, plucked, ringing or struck), which sets how it's measured and how
  long a note is kept.
- **`fetch.py`** lists each library's files (a clone without their contents) and downloads the
  ones a set uses, at most two takes per note and loudness.
- **`kit.py`** mixes a multi-microphone drum kit (KITS in `sets.py`): every hit's close
  microphones, placed where the overheads hear the piece, with the overheads, into one stereo file
  per piece, loudness and take. The overheads hear the whole kit at one gain, so each close
  microphone is set against them and the pieces keep their levels against each other.
- **`measure.py`** finds each recording's real pitch (drums, `pitched=False`, keep their given note). A library's names can sit an octave or two
  from standard names, or a semitone off now and then, so the note comes from the sound: YIN for
  the octave, and a harmonic sieve over the spectrum for the exact tuning in cents.
- **`convert.py`** folds each recording to mono, corrects its tuning (except the pianos, whose
  stretched upper octaves are part of their sound), starts it at the note, and loops a held
  note's steady part (or the loop the file marks) so it can be held up to the set's length.
  A note much louder or quieter than its neighbours is evened toward them (up to 9 dB; not in a
  drum kit, `even=False`, whose pieces keep their own levels), and a
  note's softer recordings are matched to its loudest, so the app's velocity curve sets the level
  and the recording the tone. That match is by unweighted energy and peak (the lowest of the
  gains, so a softer recording never measures louder either way) over the first 0.1, 0.25 and
  0.5 s and the kind's level window (the first 0.8 s for held notes): matched by A-weighted
  loudness, as it once was, a drum's or a low note's soft recording, which has its energy in the lows the ear's curve hardly counts, came
  out several dB louder than its loud one (the concert bass drum's softest by 7 dB), so turning
  the velocity up across a loudness made it quieter. Before that, each of a note's recordings is
  lined up with its loudest (moved later by up to one period of the note, at most 12 ms, and
  turned over if need be): the app blends two loudnesses near a boundary, and two recordings out
  of step partly cancel (a vibraphone's soft and hard strokes blended came out 6 dB quieter than
  either). Missing recordings are filled from the same note's nearest loudness or other take; a
  `sparse` set (the electric piano, recorded at one to four loudnesses a note) instead leaves out
  a loudness a note within 3 semitones has (the app stretches that one, as the library's own
  mapping does) and shares the same note's nearest loudness's file for the others (`shared` in
  `hostedSets.ts`), so no file is a copy of another. A ringing set with `tail` (the electric
  piano again, whose recordings were cut off 0.4 to 5 s in while still sounding) gives each note
  the rest of its decay: its last 0.3 s repeated, each repeat quieter by the rate the recording
  was dying away at (a recording too short to tell takes the rate its neighbours' fit gives), the
  highs dying faster, until 60 dB down or the set's cap. One gain per set leaves its loudest peak
  just under full scale. It writes the MP3s and `src/audio/hostedSets.ts`.

Every set recorded at several loudnesses has been rebuilt with the matching and lining up
above. After rebuilding one, play a velocity sweep on it in the app (the same note at rising
velocities, a few notes across its range): each should be at least as loud as the one before.

The published site must serve the folder next to `fledgetone.html`; the app loads it from
there, or from `https://twobirdsworkshop.com/fledgetone-samples/` when the page is opened from
a file or hosted elsewhere (the site's `_headers` allows that cross-origin).
