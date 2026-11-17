# Lines video picture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third picture for the Video (MP4) export, "Lines: each instrument's path", with six options.

**Architecture:** Pure data shaping in `src/store/` (lines and chords, unit-tested in Node), one stateless canvas drawing file in `src/audio/` beside `showcaseDraw.ts`, wired through `videoExport.ts` and `ExportDialog.tsx`. Fed by the notes `showcaseData` already collects.

**Tech Stack:** TypeScript, Canvas 2D, `node --test` (tests import the `.ts` files directly, so no enums or parameter properties).

**Spec:** `docs/superpowers/specs/2026-11-17-instrument-lines-video-design.md` (sketch beside it).

## Global Constraints

- Every frame drawn from the time alone; no state between frames.
- Drawn in design units inside the `picture` box `videoExport.ts` hands over.
- Fixed values: allowance 1.5 s, bend 0.16 s, entry rise 1.1 s, ring life 0.7 s.
- Existing pictures and encoding unchanged; `showcaseData`'s existing fields and Showcase's look unchanged.
- Drawing and line shaping import nothing from the app's stores (types only), so they can be lifted into a standalone tool later.
- Before each commit: `npx tsc -b`, `npx oxlint src`, `npm test`. GUIDE.md, CHANGELOG.md, HANDOFF.md and `npm run codemap` in the last task.

## Review Focus

- A song with no pitched tracks (drums only): the picture draws the drum row and nothing breaks.
- A pitched range of one note (low = high): the line sits mid-picture, no division by zero.
- A fast arpeggio: the line is a calm curve, not a zig-zag at every note.
- Two instruments in unison: two lines, slightly apart.
- A range with no markers and Song map on: one plain segment.

---

### Task 1: Notes know their kick and percussion

**Files:** Modify `src/store/showcase.ts`; Test `scripts/showcase.test.mjs`

**Interfaces — Produces:** `ShowcaseNote.kick?: true` (a drum kit's kick row: `isDrumKind(track)` and `midi === midiOf(DRUM_NOTES.kick)`), `ShowcaseNote.perc?: true` (track not `drum` but `!isPitched(instrumentKey)`).

- [ ] Test: a drum kit's `C2` has `kick: true`, its `D2` has no `kick`; a piano's note has neither; existing assertions unchanged.
- [ ] Implement, run `node --test scripts/showcase.test.mjs`, commit.

### Task 2: Lines data

**Files:** Create `src/store/lines.ts`; Test `scripts/lines.test.mjs`

**Interfaces — Consumes:** `ShowcaseData`. **Produces:**

```ts
export const LINE_ALLOWANCE = 1.5, LINE_BEND = 0.16, LINE_ENTRY = 1.1;
export interface LinePoint { t: number; pitch: number; bend: number }   // the line heads for `pitch` from `t`, arriving after `bend`
export interface LineRun { start: number; end: number; path: LinePoint[]; starts: number[]; sounding: Array<[number, number]> }
export interface LineTrack { name: string; runs: LineRun[] }
export interface LinesData { tracks: LineTrack[]; hits: Array<{ t: number; kick: boolean }>; low: number; high: number; bars: number[] }
export function linesData(d: ShowcaseData): LinesData;
export function runPitch(run: LineRun, t: number): number;     // t clamped into the run
export function isSounding(run: LineRun, t: number): boolean;
```

Rules: pitched = not `drum`, not `perc`; hits = every `drum` or `perc` note start. A run breaks where silence exceeds `LINE_ALLOWANCE`. The path follows the highest note sounding and doesn't drop to a lower held voice when the top note ends. Where lead notes start less than 0.22 s apart for three or more notes, the stretch is replaced by one point per 0.45 s holding the mean pitch, with `bend` 0.45 (the calm rule). `low`/`high` from pitched notes only (60/72 with none).

- [ ] Tests: a 1.4 s rest keeps one run and a 1.6 s rest makes two; `runPitch` is the old pitch at a note's start, the new one `LINE_BEND` later, between them halfway; a chord follows its top note and stays there when the top ends under held lower notes; sixteen notes 0.1 s apart alternating 60/72 give `runPitch` within 2 semitones of 66 mid-stretch; drums-only data gives no tracks and its hits; unison tracks give two tracks.
- [ ] Implement, run, commit.

### Task 3: Chords

**Files:** Create `src/store/linesChords.ts`; Test `scripts/linesChords.test.mjs`

**Interfaces — Produces:** `export interface ChordSpan { at: number; end: number; name: string }`, `export function lineChords(d: ShowcaseData, key: Pick<SongKey, 'root' | 'mode'> | null): ChordSpan[]` (sorted, named spans only, neighbours merged).

Rules as the spec's "Chords" list: half-measure windows (whole measure when `d.beats` is odd there), a pitch class counts at a quarter of the window, `chordRoot`, a third required, cut to triad or seventh, spelled with `chordNameIn`.

- [ ] Tests: C–E–G for a bar then A–C–E gives `C` then `Am`; C–E–G–B♭ gives `C7`; C–G alone gives nothing; C–F–G gives nothing; a passing note under a quarter of the window doesn't change the name; drum and `perc` notes are ignored; two equal neighbours merge into one span.
- [ ] Implement, run, commit.

### Task 4: Drawing

**Files:** Create `src/audio/linesDraw.ts`

**Interfaces — Consumes:** Task 2 and 3 types. **Produces:**

```ts
export interface LinesLook { map: boolean; chord: boolean; drums: boolean; rings: boolean; ahead: boolean }
export const DEFAULT_LINES_LOOK: LinesLook;   // all true
export function drawLines(g: CanvasRenderingContext2D, data: LinesData, box: ShowcaseBox, t: number,
  opts: { secondsShown: number; headAt: number; look: LinesLook; section: boolean; sections: ReadonlyArray<{ at: number; name: string }>; chords: readonly ChordSpan[]; duration: number }): void;
```

Follows the sketch. Lines on the same pitch are drawn a few units apart. With no pitched tracks, or `low === high`, it still draws.

- [ ] Implement; check by rendering frames in a browser page against a starter (wide and tall, every option on and off); commit.

### Task 5: Export wiring, dialog, docs

**Files:** Modify `src/audio/videoExport.ts`, `src/components/timeline/ExportDialog.tsx`, `src/search/paletteEntries.ts`, `GUIDE.md`, `CHANGELOG.md`, `HANDOFF.md`, `docs/CODEMAP.md` (generated)

- `VideoOptions.lines?: { data: LinesData; chords: ChordSpan[]; look: LinesLook }`; drawn in place of the spectrum; with it the footer's section name isn't drawn and doesn't reserve room.
- `ExportSettings.picture` gains `'lines'`; `linesLook: LinesLook` saved and read back guarded; six tick boxes under Picture (Section bound to `marks.sections`, and hidden from Title and marks while Lines is chosen).
- [ ] Implement; run all the checks; export a real MP4 of a starter in headless Chromium and look at frames; commit and push.
