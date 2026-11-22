# Hearing: space and register

Date: 2026-11-22. Status: approved (as the public half of a larger design kept elsewhere).

## Intent

Hearing describes a sound in eight groups so an agent that can't hear can read it. Two things a
musician often says about a track have no measure yet:

- **Space**: "too dry", "needs echo", "it sounds far away". How long sounds ring on after they end,
  how much of the sound is tail rather than direct sound, whether there is a clear echo and at what
  time, and whether the tails are wider than the direct sound.
- **Register**: "the notes are too high", "the bass sits too low". Where the pitched parts sit: the
  range of the pitched energy, its centre, and where the top line (the highest prominent pitched
  part) sits.

Both become new groups of the sound report, with their own rule versions, plain words, comparison
rows, and stated limits, under the same rules as the rest of Hearing.

## Goals

- `space` and `register` in every sound report long enough for the other groups (0.4 s or more).
- Plain-word lines that describe and never judge, and comparison rows so "wetter", "higher" and
  "longer tails" show in a comparison, level-matched like the rest.
- Readings that don't change with playback level (within one comparison step, down to 20 dB).
- A reading check extended with made sounds for each: a fresh agent given only the reports and
  pictures names what was planted.

## Non-goals

- Naming instruments or telling a voice from instruments (a voice counts as a pitched part).
- New pictures (the spectrogram already shows tails and echoes).
- Changing any existing group's numbers (their versions stay as they are).

## Anti-goals

- Any other model or outside service: signal maths only.
- Words that judge ("good", "bad", "too", "should").
- New work for a `listen` or `measure` that didn't ask for hearing.
- Anything that names a musician, a track or anyone's listening: test sounds are made in code.

## Constraints

- Space and register are new groups: `HEARING_VERSIONS` gains `space: 1` and `register: 1`. A saved
  hearing made before them has neither group, and a comparison with it says so ("only one of these
  has it") rather than failing.
- Register uses the harmonic part of the sound (`harmonicPercussive`), so drums and noise give no
  register (null) rather than a false one.
- Echo times are in milliseconds, and as a note value when the tempo is known (`noteOf` from
  `movement.ts`).

## Approaches

The measures follow the existing groups' pattern: one pure module per group in `src/audio/hearing/`,
wired into `hearSound`, worded in `words.ts`, compared in `compareSound.ts`. One way fits; the
alternative (a separate report beside the sound report) would split what an agent reads in two.

## Left to the builder

The exact algorithms, within the tests in the plan: how decays are found and timed, how the wet share
is defined, how an echo is told from a repeated note, how pitch salience is picked, and the exact
thresholds of the word lines.
