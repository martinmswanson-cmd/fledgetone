# Hearing: pictures and a fuller description of sound, for an agent that can't hear

Design, 2026-11-20. Status: waiting for the owner's approval.

## Intent

An agent working on Fledgetone (the owner's assistant, or anyone's through the agent helper) can't
hear. Today `listen` and `measure` give it loudness, true peak, crest and the level of seven
frequency regions. That says how loud a sound is and roughly where its energy sits. It doesn't say
what the sound is like: a growl and a buzz can measure the same, and a click or a harsh resonance
goes unnoticed. The owner calls this the biggest chokepoint in development, because every question
of "how does it sound" comes back to his ears.

Two things an agent can do well are read pictures and read numbers. This design gives it both: a set
of **pictures of the sound** it can look at, and a **sound report** that describes character in
measured terms, for a Fledgetone song and for any audio file alike.

It is the first of three pieces the owner has agreed to, in this order:

1. **Hearing** (this document).
2. **A reference shelf and taste profile**: reference tracks measured with these tools and written
   up per style, so a song can be compared with the music it is meant to resemble. Designed next,
   separately. Its personal data is kept outside this public repository.
3. **Fine-tuning from the owner's reactions** (A/B choices, scored predictions). Designed last.

This document is complete without the other two, but several choices here exist to serve piece 2:
audio files as input, a report that can be saved and compared later without the audio, and
description without judgement.

## Goals

- An agent can tell, from pictures and the report alone, things it can't tell today: a click, a
  resonance, mud, harshness, grit against clean tone, a wobble and its rate, sidechain pump, how wide
  each part of the spectrum is, where the energy moves over time.
- The same hearing works on a rendered Fledgetone song (bars of it, or one track) and on an audio
  file (a reference track, an export, a recording).
- Two hearings can be compared: before and after a change, or a song against a reference.
- A saved report stands in for its audio, so a reference can be kept as measurements only.

## Non-goals

- The taste profile, choosing reference tracks, anything about the owner's listening (piece 2).
- Reading the music out of an audio file: chords, song structure, drum patterns, bass lines
  (piece 2; for a Fledgetone song the notes are already known).
- A listening page or anything the owner clicks to give verdicts (piece 3).
- Showing the pictures inside the studio. The spectrum analyser window stays as it is.

## Anti-goals

These would make it a failure even if it worked:

- **A judgement.** The report describes ("bright", "3 dB more side energy above 8 kHz than the
  reference"); it never scores a sound as good or bad. Whether a difference matters is decided by
  comparison with references and by the owner.
- **Another model.** No machine-learning model, tagger, embedding or outside service. All of it is
  signal maths in this repository. The only model that reads the result is the agent itself.
- **Other people's audio in this repository.** No test, fixture or example carries copyrighted
  music. Tests use made signals and Fledgetone's own renders.
- **A changed sound or a slower listen.** Nothing here alters what is rendered, and a plain `listen`
  as agents call it today costs no more time than it does now.

## Constraints

- The report types are part of the agent protocol (`ListenReport` in `src/agent/listenReport.ts`,
  described in `docs/AGENT.md`) and are shared with the studio's own listen. Every addition is
  optional and additive; a client that knows nothing of it keeps working.
- Analysis is pure TypeScript in `src/audio/`, tested from `scripts/*.test.mjs` like the existing
  maths (`mixAnalysis.ts`, `sampleAnalysis.ts`, `drumMeasure.ts`, `harmonicPercussive.ts`,
  `loudness.ts`). It builds on those; it doesn't duplicate them.
- No new runtime dependency in the app. The command line may use what Node provides.
- Listen's limits stand for songs (64 bars or 90 seconds a listen). An audio file may be a whole
  track, several minutes long.
- User-visible changes update `GUIDE.md`, `tools/cli/README.md`, `docs/AGENT.md`, `CHANGELOG.md`
  and the map in `HANDOFF.md`, as CONTRIBUTING.md asks.

## Approaches

1. **In the app's own code, reached through the command line and the agent helper (chosen).** The
   maths lives beside the existing analysis, `listen` and `measure` grow, and pictures are written
   as PNG files. Every agent gets it, in every session, with no setup; it is tested with the rest;
   and the studio can show the same findings later. It costs more to build than a script.
2. **A separate analysis script (Python with numpy and a music-analysis library).** Quickest to
   write and rich in ready-made measures. But it is a second toolchain outside the app, unavailable
   to anyone using the agent helper, untested by the app's checks, and it would measure with
   different maths from the studio's own meters, so the two could disagree about the same sound.
3. **A window in the studio.** The owner would see what the agent sees. But an agent can't look at
   the studio's screen, so it solves the wrong half of the problem first.

The owner asked for `listen` to be extended and for spectrograms, and left the rest of the how to
the builder; approach 1 is that.

## What it is

### One hearing, two sources

- **A song**: `listen` gains a fuller mode. The bars are rendered as now and then described and
  drawn. With per-track listening, each track can be heard this way on its own.
- **An audio file**: `measure` gains the same mode and reads more than WAV. WAV is read directly as
  now; other formats (at least MP3, FLAC, Ogg/Opus and AAC/M4A where the browser decodes them) are
  decoded in the headless browser the command line already drives for rendering. A file has no
  bars, so its time axis is seconds, unless a tempo is given or detected, when bars are shown too.
  The caller may name **a stretch of the file** (from and to, in seconds) to hear only that part.

Both produce the same report shape, so everything downstream (comparison, saving) treats them alike.

### The sound report

A new optional section of the report. Each measure is given for the whole range and, where it moves,
along time (per bar for a song, per second or so for a file). Existing analysis is reused wherever
it exists. The groups, and what each must let an agent tell:

| Group | Measures | Lets the agent tell |
|---|---|---|
| Tone | the long-term spectrum at 1/6 octave (mid and side), brightness (spectral centre), tilt in dB per octave, where the top rolls off, sub against bass, and the existing regions | dark or bright, thin or heavy, boxy, harsh, airy |
| Texture | noisiness (spectral flatness), roughness (fast amplitude beating inside bands, the measurable part of grit and growl), harmonic against percussive share | clean or distorted, tonal or noisy, smooth or gritty |
| Movement | how fast the spectrum changes, the strongest repeating modulation in the low and mid bands with its rate in Hz and as a note value at the song's tempo, pump depth from the low-band envelope | a wobble and its rate, a filter sweep, sidechain pump, a static sound |
| Dynamics | the existing loudness, short-term maximum, true peak and crest, plus loudness range and the loudness of each bar or second | squashed or open, where it lifts and drops |
| Attack | onsets per bar or second, how sharp the attacks are (rise time); for a single drum hit (a short file or stretch with one onset) the existing kick and snare measures as well | punchy or soft, busy or sparse |
| Stereo | left-right correlation, width per frequency band, how mono the low end is, what is lost when folded to mono | narrow or wide and where, phase trouble |
| Pitch | tempo, key and tuning from the existing detectors (for a file; a song already knows its own), pitch-class energy over time | what key it sits in, whether pitched content is in tune |
| Faults | clicks (isolated jumps), clipping and runs of flat tops, DC offset, steady hum, digital silence in the middle, a channel missing or much quieter | something is broken, and where |

Every fault and every notable feature carries **where** it is (bar and beat, or seconds), so a
picture can be made of that moment.

Alongside the numbers the report gives **plain-word lines**, as `findings` does today: each a
description tied to its number ("Bright: the spectral centre sits at 3.1 kHz", "A click at bar 9,
beat 3"). Words are taken from fixed thresholds and are descriptive only.

The report carries the settings it was made with, the engine version, and a **version for each
group** of measures. Two reports are compared on the groups whose versions match; for the others
the comparison says the older report must be made again from its audio. A saved report is therefore
a record that can go stale, not a permanent stand-in: whoever keeps one should be able to measure
the audio again (see Open with the owner).

So that a part of a saved report can be compared later without the audio, the report keeps the
1/6-octave spectrum (mid and side) and the loudness **along time**, at about one reading a second,
not only their averages.

### The pictures

PNG files written to a folder the caller names. Every picture has labelled axes and a legend that an
agent can read values from: frequency in Hz on a log scale from 20 Hz to 20 kHz, time in bars and
beats (song) or seconds (file), and a colour scale in dB. Pictures are sized to be read whole by an
agent (long edge about 1,500 pixels), so a long range is given as one overview and then detail
pictures of a fixed span each.

- **Spectrogram** of the mix (mid): the main picture.
- **Stereo picture**: side energy, or width, over time and frequency.
- **Level picture**: the waveform with short-term loudness and peaks drawn over it.
- **Average spectrum**: the long-term curve, mid and side, with a second hearing's curve drawn over
  it when one is given.
- **Pitch-class picture**: energy in each of the twelve notes over time.
- **Close-up**: a short moment at high time resolution, waveform above spectrogram, for attacks and
  faults. One is made for each fault found (up to a limit), and one for any moment the caller names.
- **Difference picture**: when two hearings are compared, after minus before in dB on a two-colour
  scale, on the same axes.

The report lists each picture with its path, what it shows and the range it covers.

### Comparing

- **Before and after** a suggestion (`listen` already does this for loudness): the sound reports
  are compared measure by measure, with the difference picture.
- **Against another hearing**: an audio file (or a stretch of one), or a saved report (or a stretch
  of it). The two are matched in loudness first, so tone isn't confused with level, and the result
  lists the differences in each group, largest first, in numbers and in plain words. Against a saved
  report there is no audio, so the comparison is of the measures and the spectrum only, and it says
  so.
- **Like with like is the caller's job.** A loud 16 bars set against a whole track, quiet parts and
  all, reads brighter, louder and more squashed only because it is an excerpt. This piece doesn't
  find the matching part of a reference by itself (naming a track's sections belongs to piece 2).
  The caller names the stretch, and when the two ranges differ in length by more than half, or one
  is a whole file and the other a few bars, the comparison says so at the top.

### Where it is reached

- **Command line**: `fledgetone listen` and `fledgetone measure` take options for the fuller
  report, a folder for pictures, a moment to close in on, and another hearing to compare against;
  `--json` gives the whole report.
- **Agent helper**: the same through `listen` with a file, and a way to hear an audio file. Pictures
  are returned as images where the protocol carries them, and as file paths otherwise.
- **Studio's live listen**: unchanged for now. It may ask for the fuller report later; nothing here
  prevents it.

## How it is known to work

The measure of success is whether an agent can read sound from what this makes. So beside the usual
unit tests of each measure against made signals (a sine has a known centre; a square wave gated at 4
Hz has a 4 Hz movement; two identical channels have a correlation of 1), there is a **reading
check**:

- A small set of made sounds, each with one known property: a click at a known time, a narrow
  resonance at a known frequency, a wobble at a known rate, pump at a known depth, a side-only band,
  hard clipping, hum, a dull and a bright version of the same sound, a clean and a distorted one.
- **Alone**, with nothing to compare against: the click, the resonance, the wobble, the pump, the
  side-only band, the clipping and the hum. The hearing of each is made and a fresh agent that sees
  only the report and pictures is asked what it finds. It must name the property and its place or
  value, and report nothing false on a clean sound.
- **As a pair**, through the comparison: dull against bright, clean against distorted. The agent
  must say which is which and roughly by how much. Alone, such a sound only gets its describing
  words; there is no absolute "too bright".
- **In real material**: renders of two of the app's starters, and of one **heavy** test song built in
  the test from the app's own synths (dense, loud, distorted bass, limited hard), since that is the
  music the app is mostly used for. In each, a planted click must be found alone, a planted boost
  must be found by comparing with the unplanted render, and the heavy song's own distortion and
  limiting must not be reported as clicks or faults.
- **How subtle**: the planted click is a jump of one sample, 12 dB above the level around it; the
  boost is 6 dB over a third of an octave; the wobble and the hum are 12 dB below the sound they sit
  in. These are a first bar, set by the builder of this design, to be tightened once it passes.

The made sounds and their expected answers are kept in the repository so the check can be run again
after a change.

## Limits, said plainly

Pictures and measures are not hearing. They will show what is physically there, not how loud or
unpleasant a listener finds it: masking, the ear's sensitivity by frequency, and whether grit is
exciting or ugly are outside them. A sound can read well and feel wrong. This piece narrows the gap
and makes the agent's questions to the owner precise; pieces 2 and 3 are what tie the measures to
his taste.

## Decided by the owner

- Only the agent itself reads the result; no other model is involved.
- `listen` is extended, and spectrograms are a main part of it.
- Hearing is built first, then the reference shelf, then fine-tuning from his reactions.

## The builder's calls

Made by the builder in this design, open to correction:

- Built into the app's code and reached through the command line and the agent helper (approach 1).
- `measure` is the entry for audio files and gains formats beyond WAV.
- Faults are reported with their place and get an automatic close-up.
- A saved report is versioned and can be compared without its audio.
- The reading check, by a fresh agent, is the acceptance test.
- The studio shows none of this yet.

- The caller names the stretch to compare; matching parts are not found automatically here.
- A saved report keeps spectrum and loudness along time, and is versioned group by group.
- The reading check has blind singles, pairs, and a heavy song, at the sizes given.
- Kick and snare measures apply to a single hit only.

## Open with the owner

- **Whether a reference's audio stays available after it is measured.** If it does, a stale report
  is simply made again. If it doesn't (a track measured while it streams, nothing kept), an old
  report loses the groups whose maths has since changed, and piece 2's reading of chords and
  structure has to happen at the same moment the track is measured. This doesn't change what piece 1
  builds; it decides how careful piece 2 must be.

## Left to the builder

- Names of options, report fields and files; how the fuller mode is asked for in the protocol.
- Thresholds behind each plain-word line, and the exact formula for each measure where more than one
  is in common use.
- How pictures are drawn and encoded (in Node or in the headless page), colours, fonts, exact sizes,
  how many detail pictures a long range gets, and the limit on close-ups.
- Limits on file length and how a very long file is handled.
- Whether per-track hearing draws every picture or a smaller set.
