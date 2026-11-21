# The reading check

The hearing's tests show that each measure finds what it is made to find. This check shows what they
can't: that an agent given only the sound report and pictures, and nothing else, finds what is in a
sound. Known properties are planted in made sounds and in songs; each sound's hearing is given to
a fresh agent that has seen nothing else, with one question; its answer is compared with what was
planted.

Run it after a change to anything in `src/audio/hearing/` (the measures, the words or the
pictures), and record the run in the table at the end.

## The files

- `make.mjs <out folder>`: writes the made sounds (48 kHz, 24-bit stereo WAV, 8 seconds each).
  It also exports the WAV reader and writer and the click planter that the scripts below use.
- `expected.json`: for each made sound, what was planted, what is to be found, and how close is a
  pass. A pair's second file is heard against its first.
- `heavy.mjs <out.fledgetone.json>`: the heavy test song: 16 bars at 140 bpm in E minor from the
  app's own synths (a synthesized techno kit, a distorted wobble bass, an analog lead and a glide
  pad), with the master Level pushed 12 dB into the limiter (`listen` says how much the limiter
  takes off: at least 6 dB). It has no recorded instruments, so it renders offline.
- `scripts/hearingCheckSet.test.mjs` (in `npm test`): `make.mjs` makes every file
  `expected.json` lists, and each made sound's report already holds its property.

## Before you start

The command line and the runtime it renders with are built (`npm run build:runtime` and
`npm run build:cli` after a change to either), and a browser is found (else set
`FLEDGETONE_BROWSER`). Run everything from the repository's folder, and put the check's folder
outside it:

```bash
FT="node tools/cli/dist/fledgetone.mjs"
CHECK=/tmp/reading-check            # any empty folder outside the repository
mkdir -p "$CHECK/work"
: > "$CHECK/key.jsonl"
key() { printf '%s\n' "$1" >> "$CHECK/key.jsonl"; }
```

Every sound an agent is given gets a folder named `sound-01`, `sound-02` and so on, holding only
its hearing (`sound-NN.json`) and pictures. Nothing in a name says what was planted: the audio is
copied to a plain name before it is heard, and what was planted is kept in `key.json`, beside the
folders, never in them. The work files (audio, songs, ops) stay in `work/`.

Two small scripts plant things. The first adds a click to a WAV file: one sample at the given
second raised by 4 times the RMS of the 50 ms around it, as in `click.wav`:

```bash
plant_click() {  # <in.wav> <out.wav> <seconds>
  node --input-type=module -e "
import { readWav, writeWav24, plantClick } from './scripts/audio-check/hearing/make.mjs';
const [from, to, seconds] = process.argv.slice(1);
const { sampleRate, channels } = readWav(from);
plantClick(channels, sampleRate, Number(seconds));
writeWav24(to, channels, sampleRate);
" "$@"
}
```

The second writes an ops file that raises one track's EQ by 6 dB over a third of an octave: a bell
at the given frequency, 6 dB, Q 4.32, added to the track's parametric EQ (which is switched on;
its first five bands stay as they are, and an EQ that was off has only flat bands and a high cut
that is off, which is the sixth and is dropped to make room):

```bash
boost_ops() {  # <song> <track id> <hz> <out ops.json>
  node -e "
const fs = require('fs');
const [song, id, hz, out] = process.argv.slice(1);
const t = JSON.parse(fs.readFileSync(song, 'utf8')).tracks.find((x) => x.id === id);
if (!t) throw new Error('no track ' + id);
const bands = t.fx.peq.bands.slice(0, 5).concat({ on: true, type: 'bell', freq: Number(hz), gain: 6, q: 4.32 });
const op = { op: 'set_insert', trackId: id, insert: 'peq', settings: { on: true, bands } };
fs.writeFileSync(out, JSON.stringify({ opsVersion: 1, ops: [op] }, null, 2) + '\n');
" "$@"
}
```

## 1. Made sounds

```bash
node scripts/audio-check/hearing/make.mjs "$CHECK/work/made"
n=0
next() { n=$((n + 1)); id=$(printf 'sound-%02d' $n); mkdir -p "$CHECK/$id"; }
for name in clean click resonance wobble pump side-band clipping hum; do
  next
  cp "$CHECK/work/made/$name.wav" "$CHECK/work/$id.wav"
  bpm=""; [ $name = pump ] && bpm="--bpm 120"
  $FT measure "$CHECK/work/$id.wav" --sound --pictures "$CHECK/$id" $bpm --json > "$CHECK/$id/$id.json"
  key "{\"sound\":\"$id\",\"part\":\"made\",\"file\":\"$name.wav\"}"
done
for pair in dull:bright clean-bass:distorted-bass; do
  next
  cp "$CHECK/work/made/${pair%%:*}.wav" "$CHECK/work/$id-a.wav"
  cp "$CHECK/work/made/${pair##*:}.wav" "$CHECK/work/$id-b.wav"
  $FT measure "$CHECK/work/$id-b.wav" --against "$CHECK/work/$id-a.wav" --sound --pictures "$CHECK/$id" --json > "$CHECK/$id/$id.json"
  key "{\"sound\":\"$id\",\"part\":\"made\",\"file\":\"${pair##*:}.wav\",\"heardAgainst\":\"${pair%%:*}.wav\"}"
done
```

For a pair, the agent is given the second sound's hearing, read against the first
(`sound-NN-b.wav` against `sound-NN-a.wav`).

## 2. Starters

Two starters, 16 bars each: Plaza (104 bpm) and Eastern (84 bpm). (Latin is left out: its
unplanted render already reads one click, at 4.0 s, from its percussion, so a planted click
there would not be the only one.) Each gets a planted click, heard alone, and a planted boost,
heard as a before and after. A song's place in seconds is `((bar - 1) * 4 + beat - 1) * 60 / bpm`
in bars of four quarter notes. Each click is put off the beat, away from the drums' hits (a
click planted on a hat hit can be hidden by it: in the heavy song, one at bar 13 half way between
beats 2 and 3, on a closed hat, is found only at 12 times the RMS).

```bash
song_plants() {  # <name> <song> <click seconds> <bar> <beat> <boost track> <boost track name> <hz>
  local name=$1 song=$2 at=$3 bar=$4 beat=$5 track=$6 tname=$7 hz=$8
  $FT render "$song" -o "$CHECK/work/$name.wav" --rate 48000 --offline
  next
  plant_click "$CHECK/work/$name.wav" "$CHECK/work/$id.wav" $at
  $FT measure "$CHECK/work/$id.wav" --sound --pictures "$CHECK/$id" --json > "$CHECK/$id/$id.json"
  key "{\"sound\":\"$id\",\"part\":\"$name\",\"read\":\"alone\",\"planted\":\"a click: one sample raised by 4 times the RMS of the 50 ms around it\",\"seconds\":$at,\"bar\":$bar,\"beat\":$beat,\"find\":\"a click at $at s\",\"tolerance\":\"0.05 s\"}"
  next
  boost_ops "$song" $track $hz "$CHECK/work/$name-ops.json"
  $FT listen "$song" --ops "$CHECK/work/$name-ops.json" --sound --pictures "$CHECK/$id" --offline --json > "$CHECK/$id/$id.json"
  key "{\"sound\":\"$id\",\"part\":\"$name\",\"read\":\"before and after\",\"planted\":\"the $tname track's EQ raised 6 dB over a third of an octave at $hz Hz (a bell, Q 4.32)\",\"hz\":$hz,\"find\":\"the after version rises in a narrow band near $hz Hz, where the $tname plays\",\"tolerance\":\"the rise named, at a frequency within a third of an octave of $hz Hz; the size in the mix is less than 6 dB\"}"
}
$FT new --starter plaza -o "$CHECK/work/plaza.fledgetone.json"
$FT new --starter eastern -o "$CHECK/work/eastern.fledgetone.json"
song_plants plaza "$CHECK/work/plaza.fledgetone.json" 23.942 11 2 track-starter_plaza-3 Trumpet 1200
song_plants eastern "$CHECK/work/eastern.fledgetone.json" 16.071 6 3 track-starter_eastern-1 Koto 1200
```

The Plaza click is at bar 11, half way between beats 2 and 3; the Eastern one at bar 6, half way
between beats 3 and 4. The Trumpet plays bars 9 to 16; the Koto all 16.

## 3. The heavy song

The same two plants, and the song as it is: its hearing must list no click and no fault.

```bash
node scripts/audio-check/hearing/heavy.mjs "$CHECK/work/heavy.fledgetone.json"
next
$FT listen "$CHECK/work/heavy.fledgetone.json" --sound --pictures "$CHECK/$id" --offline --json > "$CHECK/$id/$id.json"
key "{\"sound\":\"$id\",\"part\":\"heavy\",\"read\":\"alone\",\"planted\":\"nothing: the heavy song as it is\",\"find\":\"no click and no fault; the limiter taking at least 6 dB off, the distorted bass and the pumping may be named\",\"tolerance\":\"any click or other fault named is a fail\"}"
song_plants heavy "$CHECK/work/heavy.fledgetone.json" 21.107 13 2 track-heavy-2 "Wobble Bass" 400
```

The heavy click is at bar 13, a 16th note after beat 2.

## The key

```bash
node -e "
const fs = require('fs');
const check = process.argv[1];
const expected = JSON.parse(fs.readFileSync('scripts/audio-check/hearing/expected.json', 'utf8'));
const rows = fs.readFileSync(check + '/key.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const key = rows.map((r) => (r.part === 'made' ? { ...expected.sounds.find((e) => e.file === r.file), ...r } : r));
fs.writeFileSync(check + '/key.json', JSON.stringify({ question: expected.question, sounds: key }, null, 2) + '\n');
" "$CHECK"
```

Before any agent is asked, check that no name an agent sees gives the answer away:
`find "$CHECK"/sound-* | grep -Ei 'click|boost|plant'` prints nothing.

## Asking the agents

For each `sound-NN` folder, start a fresh agent that has seen nothing of this work: not this
file, not `key.json`, not the code. Give it that one folder (its JSON and its pictures) and only
this question, word for word:

> What do you find in this sound? Name anything unusual, and where or how much. If nothing is unusual, say so.

Compare its answer with the sound's entry in `key.json`.

**Passing:** every planted property named, with its place or value within the tolerance, and
nothing false reported on `clean.wav` (its sound number is in `key.json`) or on the heavy song as
it is. Something true but not planted (the bed's two sines named as held notes, the heavy song's
limiter) is not a fail.

For every miss, decide whether the report, the words or a picture failed to show it, fix that in
its own file with a unit test that pins the fix, and run the missed sound again with a new fresh
agent. A full run passes when every sound passes.

## Results

| Date | Version | Sound | What the agent said | Pass or fail |
|---|---|---|---|---|
| | | | | |
