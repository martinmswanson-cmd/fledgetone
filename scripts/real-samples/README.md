# The real instruments' recordings

`public/fledgetone-samples/` holds the recordings for the instruments marked **(Real)**, one
folder per set (a set can serve several instruments: the Electric, Crunch and Distortion Guitars
all play `guitar-black`). Each file is `<note>_<layer>_<take>.mp3`: the note (`Cs3` = C#3), the
loudness (0 = softest) and the take. `src/audio/hostedSets.ts` lists each set's notes, loudnesses
and takes (generated), `src/audio/instrumentCatalog.ts` (`real`) turns a set into an instrument,
and `scripts/hostedSamples.test.mjs` checks every file an instrument plays is there.

## Where they come from

All public domain (CC0, The Unlicense) or free to redistribute (with credit: CC BY 3.0, CC BY 4.0);
`src/credits.ts` credits each one.

- [VSCO 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) by Versilian Studios: the
  string sections, solo violin, harp, flute, piccolo, oboe, clarinet, bassoon, the short horn,
  trumpet and trombone notes, the muted horn and the
  muted trumpet (harmon mute), marimba, xylophone, glockenspiel, pipe organ and upright piano
  (the piano by Simon Dalzell of Ivy Audio, redistributable as part of VSCO).
- [VCSL](https://github.com/sgossner/VCSL) (Versilian Community Sample Library) by Versilian
  Studios: timpani, tubular bells, vibraphone, harpsichord, kalimba, tenor saxophone, harmonica,
  ocarina, zither (a dan tranh), concert bass drum, baroque recorders (tenor, alto and soprano),
  a grand piano (a Steinway model B), an old upright (a Knight), a folk harp, wine glasses (a glass
  harp), a mbira, a balafon, a bowed psaltery, hand chimes, a gong and a didgeridoo.
- Karoryfer Lecolds: electric guitars ([Black And Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars),
  [Emily Guitar](https://github.com/sfzinstruments/karoryfer.emilyguitar)), the baritone saxophone
  ([Bear Sax](https://github.com/sfzinstruments/karoryfer.bear-sax)),
  double bass ([Meatbass](https://github.com/sfzinstruments/karoryfer.meatbass)) and electric bass
  ([Growlybass](https://github.com/sfzinstruments/karoryfer.growlybass)), the studio drum kit
  ([Big Rusty Drums](https://github.com/sfzinstruments/karoryfer.big-rusty-drums)), the brush kit
  ([Unruly Drums](https://github.com/sfzinstruments/karoryfer.unruly-drums)) and the solo
  voice (the "a" vowel of the [legato vocal tutorial](https://github.com/sfzinstruments/legato_vocal_tutorial)),
  all CC0.
- [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) (CC0): the session drum kit,
  the Latin percussion and the percussion extras.
- [Splendid Grand Piano](https://github.com/sfzinstruments/SplendidGrandPiano): public-domain
  samples by AKAI.
- [jSteelDrum](https://github.com/sfzinstruments/jlearman.SteelDrum) by jlearman (The Unlicense,
  public domain): steel drums.
- [E-Pianos](https://github.com/sfzinstruments/GregSullivan.E-Pianos): an electric piano recorded
  by Greg Sullivan (CC BY 3.0; credit "Greg Sullivan").
- [ganjo](https://github.com/sfzinstruments/ganjo) by itsclipping (CC0): a six-string banjo.
- [A Sampled Celesta](https://gitlab.com/echoparallax/a-sampled-celesta) by Neil Bickford, on GitLab
  (its LICENSE: the audio files CC0, the code MIT): a celesta, every key, from its "Tuned Denoised
  Mix" SoundFont.

- [University of Iowa Musical Instrument Samples](https://theremin.music.uiowa.edu/MIS.html) by
  Lawrence Fritts and the University of Iowa Electronic Music Studios: the solo violin, viola,
  cello and double bass, bowed (the 2012 recordings: every semitone at pp, mf and ff,
  without vibrato, in an anechoic room; the centre microphone's 16-bit 44.1 kHz mono files), and
  the nylon-string classical guitar (a Raimundo 118, played by Brian Penkrot in 2011 in the
  anechoic chamber, every semitone of every string at pp, mf and ff; the 16-bit 44.1 kHz mono
  files, `Piano_Other/guitar/Guitar.mono.1644.1.zip`), and the soprano and alto saxophones and
  trumpet (with vibrato), French horn, tenor and bass trombones, tuba, alto and bass flutes and
  bass clarinet (the earlier recordings, every semitone at
  pp, mf and ff, one zip each, whose scales name no string). Their terms, from the
  [MIS page](https://theremin.music.uiowa.edu/MIS.html): "Since 1997, these recordings have been
  freely available on this website and may be downloaded and used for any projects, without
  restrictions." Credited anyway.
- [VocalSet](https://zenodo.org/records/1193957) by Julia Wilkins, Prem Seetharaman, Alison Wahl
  and Bryan Pardo (CC BY 4.0; credited): the two choirs, made by `vocalset.py` from its 20 singers'
  held "a" and "u" vowels (soft, straight and loud), each moved onto the choir's notes.
- The vocal chops (`chops-airy`, `chops-soul`, `chops-shout`) are made by
  `scripts/vocal-chops/build.py` instead (it lists each recording, its maker and page): CC0
  voices cut into syllables, tuned onto the keys with the WORLD vocoder; it updates
  `hostedSets.ts` through `convert.py`'s `write_index`.
- The electric guitars' release sounds (the strings damped as a note is let go) are the
  [Black And Green Guitars](https://github.com/sfzinstruments/karoryfer.black-and-green-guitars)
  library's own (`Samples/black/rel`, `Samples/green/rel`; CC0, as the rest of it).

Also looked at, for strings: [FreePats](https://freepats.zenvoid.org/) has no bowed strings (its
only orchestral string set is a harp).

Also looked at, for guitars: FreePats' steel-string acoustic (FSS Steel-String Guitar) is GPL-3.0
"with a special exception", not allowed here; its nylon guitar (Spanish Classical Guitar, CC0) was
recorded, its page says, in conditions "far from ideal" and filtered, and is sampled sparsely,
where Iowa's is every note at three loudnesses; its FSBS electric guitars (CC0) are another
direct-recorded electric like the Karoryfer ones, with no picking loudnesses to add. The SFZ
Instruments list's other free guitars are commercial (Karoryfer's paid libraries), custom-licensed
(Unreal Instruments) or MIT (Blue Jeans And Moonbeams, outside the allowed licences). Archive.org's
"CC0" steel-string guitar sets are taken from commercial sample CDs and synthesizer ROMs, which the
uploader couldn't put in the public domain. No free steel-string acoustic recorded note by note
was found, so the Acoustic Guitar plays the Iowa nylon guitar voiced brighter.

## Rebuilding them

Needs Python 3 with numpy, git, and ffmpeg with libmp3lame. From an empty working folder (the
downloads take about 1.7 GB):

```sh
python3 /path/to/bos-beat-box/scripts/real-samples/fetch.py            # downloads into dl/<set>/
python3 /path/to/bos-beat-box/scripts/real-samples/measure.py          # each recording's real note and tuning: measure.json
python3 /path/to/bos-beat-box/scripts/real-samples/convert.py /path/to/bos-beat-box
python3 /path/to/bos-beat-box/scripts/real-samples/levels.py          # after converting the grand piano: its levels and tuning, setLevels.ts
```

Each script takes set names to work on just those (`fetch.py --list harp` shows what a set would
fetch). `SHOW_TRIM=1 convert.py ...` prints how much each note was evened out. The drum kits are
mixed instead of fetched: run `kit.py studio-kit` (or `session-kit`, `brush-kit`, `latin-percussion`, `percussion-extras`) before measuring and converting them. The Iowa
strings and guitar are fetched by `iowa.py` instead (`iowa.py violin cello nylon-guitar ...`,
about 720 MB of zips; each is deleted once split).

- **`sets.py`** says what each set is made of: the library, which files (a pattern that reads
  the note, loudness and take from each file's name), how its names count octaves, and what kind
  of note it is (held, short, plucked, ringing or struck), which sets how it's measured and how
  long a note is kept.
- **`fetch.py`** lists each library's files (a clone without their contents) and downloads the
  ones a set uses, at most two takes per note and loudness. A library on GitLab is written
  `gitlab:<owner>/<name>` in `REPOS`. A set whose recordings come in a SoundFont (`sf2`, the
  celesta) downloads that file and unpacks the recordings it uses into WAVs (a left and right pair
  as one stereo file; `soundfont.py`), then deletes it.
- **`iowa.py`** fetches a set of the University of Iowa's recordings (`iowa` in `sets.py`): a zip of
  chromatic scales, one file a string and loudness, played note by note. It splits each scale at
  the silences between its notes (10 dB over the room's noise; when that doesn't find the scale's
  notes, the threshold that does), checks each note's pitch against the scale's (its harmonics
  against the points between them, which octaves don't fool), and keeps one string per note and
  loudness, where the note lies lowest on it (a semitone to a fifth over the open string, so
  neighbouring notes share a tone). A bowed note shorter than 1.6 s, or whose first half second
  stands over 6 dB above the rest (an accent that dies away, which some notes were played as),
  is left out for the note's other loudnesses to stand in. The two viola zips hold sound recorded
  at 96 kHz in files marked 44.1 kHz; it reads them at their real rate. A plucked scale (the
  guitar's) rings on into the next note, often with no silence between, so its notes are found
  by their onsets instead (6 dB rises over 300 Hz, where the chamber's rumble doesn't reach) and
  named by their pitch, read from just after the pluck; each starts at the pluck itself (a soft
  one can follow the finger's touch on the string by 50 ms) and loses the rumble under 0.7 of its
  note. A note's string is one it was played on evenly, soft to loud (the C3 on the A string is
  quieter ff than pp), then the lowest position as for the strings.
- **`vocalset.py`** makes the choir (`made` in `sets.py`, so `fetch.py` leaves it be): it reads
  only the 60 files it uses out of VocalSet's 2 GB zip (by HTTP range requests), splits each into
  its held notes by its pitch track, and moves every singer whose note is within a fifth onto each
  choir note with the WORLD vocoder (`pip install pyworld`), keeping their vowel and vibrato; the
  singers of a note are spread over the stage and a few milliseconds apart. Run it before measuring
  and converting `choir`.
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
  highs dying faster, until 60 dB down or the set's cap. `tail='faded'` (the electric guitars,
  whose library faded its softer notes out from 40 dB down, 1.5 to 4 s in, which the amps' lift
  of a tail made a held chord's sudden end) first cuts the fade off, where the level falls 6 dB
  under the straight line of its decay over the note's body, and carries on at that line's rate.
  One gain per set leaves its loudest peak
  just under full scale. It writes the MP3s (LAME V0 with a 20 kHz low-pass, so nothing a listener hears is cut: the sets were first made at V4, which cut everything over about 16 kHz) and `src/audio/hostedSets.ts`, with each set's bytes, seconds of sound (what it takes decoded: in all, and each file's in tenths of a second) and fingerprint.
  A set with `xloop` (the strings) loops a held note inside its own sustain instead: the longest
  stretch of it up to 3 s, its start moved by up to two periods to where it best matches the sound
  before the loop's end, its last quarter second crossfaded into what comes before its start, and
  its level held steady from just before the loop (so a bow's swell isn't repeated); the file
  stops 0.3 s past the loop. (Repeating a 1.5 s stretch to the cap, as the other held sets do, made
  a held string's vibrato and bowing audibly cycle every 1.5 s.) A set with `steady` (played
  without vibrato) has its slow pitch drift taken out, followed every 20 ms, as the app adds the
  vibrato; its loudnesses are matched over their first half second and their body (0.3 to 1.5 s),
  not their first tenth or their peak, as a loud bowed note can start slower than a soft one; and a recording that isn't one steady note (a louder sound
  caught with it, or a quiet sound before it) is left out for the note's other loudnesses.

Every set recorded at several loudnesses has been rebuilt with the matching and lining up
above. After rebuilding one, play a velocity sweep on it in the app (the same note at rising
velocities, a few notes across its range): each should be at least as loud as the one before.

fledgetone.com serves the folder next to the app (Netlify publishes `public/` with the build, and
`public/_headers` lets other sites load the files too). The app loads the recordings from there,
or from the fallback address `https://fledgetone.com/app/fledgetone-samples/` when the page doesn't
have them next to it (the one-file build opened from a file, a copy hosted elsewhere, the phone
app). Each
set is asked for with its fingerprint (`?v=<hash>`, the `hash` in `hostedSets.ts`), so after
rebuilding a set the browsers that kept the old files fetch the new ones.
