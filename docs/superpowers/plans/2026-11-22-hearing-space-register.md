# Hearing: space and register Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new groups in Hearing's sound report: `space` (decay, wet share, echo, tail width) and `register` (where the pitched parts sit, and the top line).

**Architecture:** One pure module per group in `src/audio/hearing/` (`space.ts`, `register.ts`), typed in `types.ts`, versioned in `HEARING_VERSIONS`, run by `hearSound`, worded by `soundWords`, compared by `compareSound`. Tests on made signals in `scripts/`.

**Tech Stack:** TypeScript, Node's test runner (`node --test`), the existing hearing helpers (`frames.ts`, `harmonicPercussive.ts`, `sampleAnalysis.ts` onset helpers, `movement.ts` `noteOf`).

**Spec:** `docs/superpowers/specs/2026-11-22-hearing-space-register-design.md`

## Global Constraints

- Signal maths only: no model, no outside service, no new dependency in any `package.json`.
- `src/audio/hearing/` stays pure: no DOM, no Web Audio, no store imports.
- Words describe and never judge: no "good", "bad", "too", "should" in any line a person or agent reads; no em dashes in user-facing text.
- A reading may not change with playback level: for every measure, the same sound 6 dB and 20 dB quieter differs by less than one comparison step.
- `HEARING_VERSIONS` gains `space: 1` and `register: 1`; no existing group's version or numbers change (the pins in `scripts/hearingVersions.test.mjs` for existing groups pass unchanged).
- A `listen` or `measure` without the hearing options does no new work and its output is unchanged (the snapshot tests pass unchanged).
- Test sounds are made in code; nothing names a musician, a track or anyone's listening.
- Every source file starts with a summary comment; run `npm run codemap` after adding files and commit `docs/CODEMAP.md`.
- Tests import sources with the resolve hook at the top of `scripts/hearingVersions.test.mjs`; never spread a long list into `Math.max`/`Math.min` in `src/` (use `maxOf`/`minOf` from `src/support/minMax.ts`).
- Before each commit: `npx tsc -b`, `npx oxlint src` (20 known warnings, add none), the task's test files; `npm test` once per task.
- Work on the branch `ccr-8ed2b55e-pd8bf8` (Hearing's branch, PR #13; if PR #13 has merged, the branch restarts from `master`). Commit, don't push: the controller pushes after a private check that nothing personal is in the change.

## Review Focus

1. A mono file, a sound with no pitched content (drums only, noise), and silence: `register` is null with no register words; `space` has nulls where nothing can be measured, never NaN. Pinned in Task 1 and Task 2.
2. A sustained pad with no gaps (no note ever ends): decay and wet share are null or flagged as unmeasurable rather than a made-up tail. Pinned in Task 2.
3. A note repeated at a steady rate (a riff on 1/8 notes) must not read as an echo. Pinned in Task 2.
4. An old saved hearing (no `space` or `register`) compared with a new one: the two groups are skipped with the "only one of these has it" note, no throw. Pinned in Task 3.
5. A long file (240 s stereo): the two groups add under 15 s together to `hearSound` and no more than 200 MB peak memory. Pinned in Task 4 (`scripts/audio-check/hearing/long-file.mjs` prints the numbers).

---

### Task 1: Register

**Files:**
- Create: `src/audio/hearing/register.ts`
- Modify: `src/audio/hearing/types.ts` (the `Register` interface, `register?: Register` on `SoundReport`, `register: 1` in `HEARING_VERSIONS`), `src/audio/hearing/hearSound.ts` (call it beside the other groups), `src/audio/hearing/words.ts` (its lines), `scripts/fixtures/hearingSignals.mjs` (a `melody` helper)
- Test: `scripts/hearingRegister.test.mjs`

**Interfaces:**
- Produces:

```ts
// types.ts
export interface Register {
  lowHz: number;          // 10th percentile of the pitched energy's pitch
  highHz: number;         // 90th percentile
  centreHz: number;       // median
  topHz: number | null;   // median over time of the highest prominent pitched part
  octaves: number[];      // share of pitched energy in each octave C1..C8 (8 numbers, sum 1, 2 places)
}
// register.ts
export function registerOf(channels: readonly Float32Array[], sampleRate: number): Register | null;   // null when no pitched content
// words.ts (exported helper)
export function noteName(hz: number): string;   // nearest equal-tempered note with octave, A4 = 440: 'C4', 'F#5'
// hearingSignals.mjs
export function melody(notes /* Array<[hz, startSeconds, seconds]> */, seconds, peakDb, sr = SR); // each note a decaying saw with 5 ms edges
```

- [ ] **Step 1: Write the failing tests** in `scripts/hearingRegister.test.mjs`:
  - `a melody an octave higher reads an octave higher`: the same 8-note melody (C4 to C5 scale) and transposed up an octave: `log2(high.centreHz / low.centreHz)` within 0.1 of 1; `topHz` likewise.
  - `a pad under a lead reads both`: a pad of held saws C3, E3, G3 under a lead melody C5 to G5 at the same level: `lowHz` within a semitone-ish band of C3 to E3 (130 to 165 Hz), `highHz` within 700 to 800 Hz, `topHz` within 500 to 800 Hz, `octaves` has more than 0.2 in both octave 3 and octave 5.
  - `drums, noise and silence have no register`: `S.every(4, 4, () => S.burst(0.12, 40, 1, -6, 1))`, `S.pink(4, -18, 1)` and 4 s of zeros give `null`.
  - `register does not change with level`: the pad-and-lead sound 6 dB and 20 dB quieter: every Hz within 1.5% and each octave share within 0.05.
  - `register words`: `soundWords` on a report holding the pad-and-lead register writes exactly one line starting `Its pitched parts sit between ` naming `noteName(lowHz)` and `noteName(highHz)` and `centred near `, and when `topHz` is set one line `The top line sits around ${noteName(topHz)}.`; a report with `register` absent writes neither.
  - `noteName`: 440 → `A4`, 261.63 → `C4`, 277.18 → `C#4`, 55 → `A1`.
- [ ] **Step 2: Run them.** `node --test scripts/hearingRegister.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `registerOf`.** Take the harmonic part of the mix (`harmonicPercussive(...).parts`), frame it (4096 at 48 kHz, scaled for other rates, hop a quarter), and for each frame pick pitch candidates by harmonic sum over 1/12-octave candidates from 30 Hz to 4.2 kHz, keeping those within 15 dB of the frame's strongest and above an energy floor relative to the loudest frame (never an absolute level, so the reading doesn't depend on playback level). `low/high/centre` are energy-weighted percentiles of all kept candidates; `top` is the median over frames of the highest candidate within 10 dB of that frame's strongest. `null` when fewer than 5% of frames hold a candidate. Round Hz to whole numbers above 100 and 1 decimal below.
- [ ] **Step 4: Wire it**: `HEARING_VERSIONS.register = 1`; `hearSound` sets `report.register` when not null; `soundWords` writes the two lines after the pitch lines.
- [ ] **Step 5: Run the test file, `scripts/hearingReport.test.mjs` and `scripts/hearingVersions.test.mjs`.** Expected: PASS (existing pins unchanged).
- [ ] **Step 6: Checks** (Global Constraints) **and commit** ("Hearing: register, where the pitched parts sit").

### Task 2: Space

**Files:**
- Create: `src/audio/hearing/space.ts`
- Modify: `src/audio/hearing/types.ts` (`Space`, `space?: Space`, `space: 1`), `src/audio/hearing/hearSound.ts`, `src/audio/hearing/words.ts`, `scripts/fixtures/hearingSignals.mjs` (`reverb`, `delay`)
- Test: `scripts/hearingSpace.test.mjs`

**Interfaces:**
- Consumes: `melody` (Task 1), `noteOf(hz, bpm)` from `movement.ts` (an echo's note is `noteOf(1000 / ms, bpm)`), `onsetStrength`/`onsetTimes` from `sampleAnalysis.ts`.
- Produces:

```ts
// types.ts
export interface Space {
  decayMs: number | null;      // median time for sound to fall 20 dB after a note or hit ends; null when nothing ends
  wetShare: number | null;     // 0..1, share of energy in tails rather than direct sound (2 places); null as above
  echo: { ms: number; repeats: number; note?: string } | null;   // a clear echo: its delay, how many repeats stand out, its note value at the known tempo
  tailWiderDb: number | null;  // side-over-mid in the tails minus in the direct sound, dB (1 place); null for mono or when nothing ends
}
// space.ts
export function spaceOf(channels: readonly Float32Array[], sampleRate: number, tempoBpm?: number): Space;
// hearingSignals.mjs
export function reverb(x, rtSeconds, wet, seed = 1, sr = SR);   // convolve with exponentially decaying noise (RT60 = rtSeconds), mix wet 0..1
export function delay(x, delaySeconds, feedback, repeats, sr = SR);
```

- [ ] **Step 1: Write the failing tests** in `scripts/hearingSpace.test.mjs` (a "dry pluck sound" is `S.melody` of 8 short notes 0.25 s long, one every 0.75 s):
  - `longer reverb reads longer`: the pluck sound through `reverb` at 0.3, 1 and 3 s (wet 0.5) gives `decayMs` in increasing order, with the 1 s one between 250 and 450 ms of a 20 dB fall (an RT60 of 1 s falls 20 dB in about 333 ms; within 35%) and the 3 s one between 700 and 1300 ms; `wetShare` in increasing order.
  - `a dry sound has short decays and no echo`: the dry pluck sound: `decayMs` under 120, `wetShare` under 0.15, `echo` null.
  - `an 1/8-note delay at 120 bpm`: the dry pluck sound through `delay(x, 0.25, 0.5, 6)` with `tempoBpm` 120: `echo.ms` within 10 of 250, `echo.note` `'1/8'`, `echo.repeats` at least 3.
  - `a riff is not an echo`: a single note repeated every 0.25 s for 4 s, dry: `echo` null (Review Focus 3).
  - `a held pad has nothing that ends`: 4 s of held saws (no gaps): `decayMs`, `wetShare` and `tailWiderDb` null (Review Focus 2).
  - `wide tails`: the pluck sound, mono direct sound, its reverb decorrelated between channels (two seeds): `tailWiderDb` over 6; with the same reverb in both channels, under 1.
  - `mono, silence and short`: a mono pluck sound gives `tailWiderDb` null and finite others; zeros give all nulls; never NaN (walk with the `finite` helper of `scripts/hearingReport.test.mjs`).
  - `space does not change with level`: the 1 s reverb sound 6 dB and 20 dB quieter: `decayMs` within 10%, `wetShare` within 0.05.
  - `space words`: on hand-made reports: `decayMs` 80 → `Dry: sounds stop almost at once (they fall 20 dB in 80 ms).`; 1200 → `Long tails: sounds ring on, falling 20 dB in 1.2 s.`; between 150 and 1000 no decay line; `wetShare` 0.55 → `Much of it is tail rather than direct sound (wet share 0.55).`; an echo {250, 4, '1/8'} → `An echo every 250 ms (1/8 notes), 4 repeats standing out.`; `tailWiderDb` 4.5 → `The tails are wider than the direct sound (+4.5 dB).`; absent `space` writes none.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `spaceOf`.** Find note and hit ends from the onset curve and the 10 ms level envelope: an end is where the level, after a peak, falls without a new onset for at least 300 ms. Time the 20 dB fall from the end (median over ends; at least 3 ends, else null), measuring levels relative to each peak, so playback level drops out. The wet share is the energy after each end over the energy of its note. An echo is a peak of the level envelope's autocorrelation between 60 and 1500 ms that repeats at multiples of its lag with falling height, and is not explained by the onsets themselves (a repeated note's onsets line up with the lag; an echo's repeats come without onsets of their own). `tailWiderDb` compares side-over-mid energy after ends with the same before them.
- [ ] **Step 4: Wire it**: `HEARING_VERSIONS.space = 1`; `hearSound` sets `report.space` (passing `opts.tempoBpm`); `soundWords` writes its lines after the movement lines.
- [ ] **Step 5: Run the test file, `scripts/hearingReport.test.mjs` and `scripts/hearingVersions.test.mjs`.** Expected: PASS.
- [ ] **Step 6: Checks and commit** ("Hearing: space, how long sounds ring and whether they echo").

### Task 3: Comparing space and register, and their pins

**Files:**
- Modify: `src/audio/hearing/compareSound.ts` (`GROUPS` gains `'space'` and `'register'`; their rows), `scripts/hearingVersions.test.mjs` (pins for the two groups on its made sound, plus a reverb version of it), `scripts/hearingCompare.test.mjs` (the level test's sounds gain the 1 s reverb pluck sound)
- Test: `scripts/hearingCompare.test.mjs`, `scripts/hearingVersions.test.mjs`

**Interfaces:**
- Consumes: `Space`, `Register` (Tasks 1 and 2).
- Produces: comparison measures named `decay`, `wet share`, `echo`, `tail width`, `register centre`, `register low`, `register high`, `top line`, compared only when both sides have a number (Ruling 2 of the Hearing work: absent on one side is not compared).

| Measure | Change is | Step |
|---|---|---|
| `decay` | `log2(b / a)`, said as a ratio | 0.4 |
| `wet share` | plain difference | 0.1 |
| `echo` | `log2(b.ms / a.ms)` when both have one; when one only, a one-sided line like the movement group's (`Echo: only in the second (250 ms, 1/8 notes).`, size at most 3) | 0.1 |
| `tail width` | dB | 2 |
| `register centre`, `register low`, `register high`, `top line` | octaves, `log2(b / a)`, written with note names (`Top line: C5 against C4 (+1.00 octaves).`) | 0.25 |

- [ ] **Step 1: Write the failing tests**:
  - `wetter and longer reads as space`: the dry pluck sound against the 1 s reverb one: differences include `decay` and `wet share`, both positive.
  - `an octave higher reads as register`: the low melody against the high one: `register centre` and `top line` with change within 0.1 of +1.
  - `an old saved hearing has neither group`: a saved hearing with `space`, `register` and their versions deleted, against a new one: `skipped` holds `space` and `register` with the "only one of these has it" note; no throw (Review Focus 4).
  - The level test passes with the reverb pluck sound added (every measure, `space` and `register` included, within a step at 6 and 20 dB down).
  - Version pins: `space` and `register` pinned on the version test's sound (and its reverb version), with the failure message naming the group as the existing pins do.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the rows** in `compareSound.ts`, reusing its `plain`, `ratio` and one-sided helpers.
- [ ] **Step 4: Run `scripts/hearingCompare.test.mjs` and `scripts/hearingVersions.test.mjs`.** Expected: PASS.
- [ ] **Step 5: Checks and commit** ("Hearing: space and register in comparisons, and pinned").

### Task 4: The reading check, docs and the long-file numbers

**Files:**
- Modify: `scripts/audio-check/hearing/make.mjs` and `expected.json` (new made sounds), `scripts/hearingCheckSet.test.mjs` (their asserts), `scripts/audio-check/hearing/README.md` (the new sounds), `scripts/audio-check/hearing/long-file.mjs` (prints the two groups' time), `docs/AGENT.md` ("Hearing more than loudness": the two groups, what each tells, their limits), `tools/cli/README.md` ("Hearing more"), `CHANGELOG.md` (one line under Unreleased), `docs/CODEMAP.md` (regenerated)
- Test: `scripts/hearingCheckSet.test.mjs`

**Interfaces:**
- Consumes: `reverb`, `delay`, `melody` (fixtures), `spaceOf`, `registerOf` through `hearSound`.

- [ ] **Step 1: Write the failing tests** in `scripts/hearingCheckSet.test.mjs`, for new entries of `expected.json`:
  - `dry-pluck.wav` / `wet-pluck.wav` (pair; the second through a 2 s reverb, wet 0.5): the comparison has `decay` and `wet share` rising.
  - `echo.wav` (alone; the dry pluck sound with a 375 ms delay, feedback 0.5, heard with `--bpm 120`): an echo within 10 ms of 375 and no note value (a dotted 1/8 is not one of the values `noteOf` names, so no note is the right reading), and the words name 375 ms.
  - `low-melody.wav` / `high-melody.wav` (pair; an octave apart): `register centre` and `top line` rising by about an octave.
  - `sparse.wav` / `busy.wav` (pair; the same pad, the second with a hat every 1/16 note and a second melody): `onsets a second` rising and words for the busier one naming more onsets.
  - The file-set test still says exactly the files `expected.json` lists.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Add the sounds to `make.mjs` and `expected.json`** (48 kHz, 24-bit, 8 s, each entry with its property, value and tolerance as the existing ones).
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Docs.** In `docs/AGENT.md` and `tools/cli/README.md`: what `space` and `register` tell and their words; their limits in plain sentences: a voice counts as a pitched part; register needs pitched sound and says nothing for drums or noise; decay needs notes that end (a held pad gives none); an echo is told from a repeated note only when the repeats come without onsets of their own; a reverb shorter than about 80 ms is not told from the sound itself. One line under `## Unreleased` in `CHANGELOG.md`.
- [ ] **Step 6: Long-file numbers.** `node scripts/audio-check/hearing/long-file.mjs 240`: report the seconds the two groups add and the peak memory (Review Focus 5: under 15 s together and 200 MB).
- [ ] **Step 7: Checks** (all of `npm test` with the browser tests running: `FLEDGETONE_BROWSER=/opt/pw-browsers/chromium`), `npm run codemap`, **and commit** ("Hearing: space and register in the reading check and the docs").
- [ ] **Step 8 (controller):** run the reading check for the new made sounds with fresh agents, as `scripts/audio-check/hearing/README.md` says, and record the results there.
