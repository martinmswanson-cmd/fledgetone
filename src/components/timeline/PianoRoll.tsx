import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Piano, X, ZoomIn, ZoomOut } from 'lucide-react';
import { initAudio } from '../../audio/engine';
import { DRUM_NOTES } from '../../audio/scheduler';
import { previewTrackNotes } from '../../audio/liveTracks';
import { FX_ROWS, INSTRUMENTS, isDrumKind, isFxKind, isSlicerKind } from '../../audio/instrumentCatalog';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, InstrumentKey, NoteEvent, SlicerSettings } from '../../store/timelineTypes';
import { barsToDuration, durationToBars, SLICE_KEY_BASE, uid } from '../../store/timelineTypes';
import { arpeggiate, chordNotes, CHORDS, fitToScale, humanize, inScale, legato, midiOf, nameOf, quantize, ratchet, roll, ROOT_NAMES, SCALES, strum, transpose } from '../../store/noteTools';
import type { ChordId, Scale, ScaleId } from '../../store/noteTools';
import { DEFAULT_WOBBLE, WOBBLE_RATES, type WobbleRate } from '../../store/timelineTypes';
import { shouldIgnoreShortcut } from '../keyboard';
import { UndoableRange } from '../UndoableRange';
import { AudioClipEditor } from './AudioClipEditor';

const KEY_W = 72;
const RULER_H = 20;
const EDGE_PX = 6;

interface Row {
  note: string;
  label: string;
  black: boolean;
  /** MIDI number, or -1 for drum rows */
  midi: number;
}

const DRUM_ROWS: Row[] = [
  { note: DRUM_NOTES.crash, label: 'Crash', black: true, midi: -1 },
  { note: DRUM_NOTES.ride, label: 'Ride', black: false, midi: -1 },
  { note: DRUM_NOTES.cowbell, label: 'Cowbell', black: true, midi: -1 },
  { note: DRUM_NOTES.tomHigh, label: 'Tom High', black: false, midi: -1 },
  { note: DRUM_NOTES.tomMid, label: 'Tom Mid', black: true, midi: -1 },
  { note: DRUM_NOTES.tomLow, label: 'Tom Low', black: false, midi: -1 },
  { note: DRUM_NOTES.openHat, label: 'Open Hat', black: true, midi: -1 },
  { note: DRUM_NOTES.closedHat, label: 'Closed Hat', black: false, midi: -1 },
  { note: DRUM_NOTES.clap, label: 'Clap', black: true, midi: -1 },
  { note: DRUM_NOTES.snare, label: 'Snare', black: false, midi: -1 },
  { note: DRUM_NOTES.kick, label: 'Kick', black: true, midi: -1 },
];

const FX_ROW_LIST: Row[] = FX_ROWS.map((r, i) => ({ ...r, black: i % 2 === 1, midi: -1 }));


const toMidi = (note: string) => Tone.Frequency(note).toMidi();
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

/** Rows a semitone apart from `hi` down to `lo`, labelled by note name (or as `label` says). */
function keyRows(lo: number, hi: number, label: (midi: number, note: string) => string = (_, note) => note): Row[] {
  const rows: Row[] = [];
  for (let m = hi; m >= lo; m--) {
    const note = Tone.Frequency(m, 'midi').toNote();
    rows.push({ note, label: label(m, note), black: isBlack(m), midi: m });
  }
  return rows;
}

/** The lowest and highest MIDI numbers in `notes`, widening [lo, hi]. */
function widenTo(notes: NoteEvent[], lo: number, hi: number): [number, number] {
  for (const n of notes) {
    const m = toMidi(n.note);
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  return [lo, hi];
}

/** Rows Slice N… use, in pitch mode a keyboard around the focused slice's own key. */
function slicerRows(slicer: SlicerSettings | undefined, notes: NoteEvent[]): Row[] {
  const count = Math.max(1, slicer?.slices.length ?? 0);
  if (slicer?.pitch) {
    const focus = Math.min(slicer.focus, count - 1);
    const own = SLICE_KEY_BASE + focus;
    const [lo, hi] = widenTo(notes, own - 12, own + 24);
    return keyRows(lo, hi, (m, note) => (m === own ? `Slice ${focus + 1} (${note})` : note));
  }
  // One row per slice, the keys above C3 (8 to draw into before a sound is loaded)
  const [, hi] = widenTo(notes, SLICE_KEY_BASE, SLICE_KEY_BASE + (slicer ? count : 8) - 1);
  return keyRows(SLICE_KEY_BASE, hi, (m) => `Slice ${m - SLICE_KEY_BASE + 1}`).map((r, i) => ({ ...r, black: i % 2 === 1 }));
}

function rowsFor(instrument: InstrumentKey, notes: NoteEvent[], slicer?: SlicerSettings): Row[] {
  if (isDrumKind(instrument)) return DRUM_ROWS;
  if (isFxKind(instrument)) return FX_ROW_LIST;
  if (isSlicerKind(instrument)) return slicerRows(slicer, notes);
  // Instrument's playable range, widened to fit any notes already in the clip
  const [lo, hi] = widenTo(notes, ...INSTRUMENTS[instrument].range);
  return keyRows(lo, hi);
}

function rowIndexOf(rows: Row[], note: string): number {
  if (rows[0]?.midi === -1) return rows.findIndex((r) => r.note === note);
  // Pitched rows run down one semitone at a time from rows[0]
  const index = rows[0].midi - toMidi(note);
  return index >= 0 && index < rows.length ? index : -1;
}

/**
 * Note positions and lengths are worked out in 96ths of a bar ("units"): a 1/32 is 3, a 1/16
 * triplet 4 (three in the space of two 16ths), a 1/16 6 and a 1/8 triplet 8. A unit is 8
 * Transport ticks, so a note placed on any grid lands exactly on its tick and never drifts.
 */
const UNITS_PER_BAR = 96;
/** The zoom (`stepW`) is in pixels per 16th. */
const UNITS_PER_16TH = 6;
const UNITS_PER_BEAT = 24;

const GRID_OPTIONS = [
  { label: '1/32', units: 3 },
  { label: '1/16T', units: 4 },
  { label: '1/16', units: 6 },
  { label: '1/8T', units: 8 },
  { label: '1/8', units: 12 },
  { label: '1/4', units: 24 },
];

const LENGTH_OPTIONS = [
  { label: '1/32', units: 3 },
  { label: '1/16T', units: 4 },
  { label: '1/16', units: 6 },
  { label: '1/8T', units: 8 },
  { label: '1/8', units: 12 },
  { label: '1/8 dotted', units: 18 },
  { label: '1/4', units: 24 },
  { label: '1/4 dotted', units: 36 },
  { label: '1/2', units: 48 },
  { label: '1 bar', units: 96 },
  { label: '2 bars', units: 192 },
  { label: '4 bars', units: 384 },
];

/**
 * Bars as units: a whole number for anything on the 96th grid (every note the piano roll places),
 * so moving it adds whole units with no rounding error; anything else (notes moved by a trim to
 * a frame position) keeps its exact place.
 */
function unitsOf(bars: number): number {
  const units = bars * UNITS_PER_BAR;
  const whole = Math.round(units);
  return Math.abs(units - whole) < 1e-6 ? whole : units;
}

const noteUnits = (n: NoteEvent) => unitsOf(durationToBars(n.duration));

/** The width of a note's resize handle: narrower on short notes, so there's still room to grab the note itself. */
const edgeOf = (noteWidth: number) => Math.min(EDGE_PX, noteWidth / 3);

/** The scale and chord chosen last, kept while the app is open so the next clip opens with them. */
let rememberedScale: Scale | null = null;
let rememberedChord: ChordId = 'off';
let rememberedGhosts = true;
let rememberedStepMode = true;

const TOOLS = [
  { id: 'quantize', label: 'Quantize to grid', drums: true },
  { id: 'quantizeEnds', label: 'Quantize starts and lengths', drums: false },
  { id: 'humanize', label: 'Humanize (timing and velocity)', drums: true },
  { id: 'strumDown', label: 'Strum chords (low to high)', drums: false },
  { id: 'strumUp', label: 'Strum chords (high to low)', drums: false },
  { id: 'arpUp', label: 'Arpeggiate up (grid speed)', drums: false },
  { id: 'arpDown', label: 'Arpeggiate down', drums: false },
  { id: 'arpUpDown', label: 'Arpeggiate up and down', drums: false },
  { id: 'arpRandom', label: 'Arpeggiate random', drums: false },
  { id: 'legato', label: 'Legato (fill the gaps)', drums: false },
  { id: 'ratchet2', label: 'Ratchet x2 (split each note)', drums: true },
  { id: 'ratchet3', label: 'Ratchet x3', drums: true },
  { id: 'ratchet4', label: 'Ratchet x4', drums: true },
  { id: 'roll', label: 'Roll (repeat at grid speed, rising)', drums: true },
  { id: 'semiUp', label: 'Semitone up', drums: false },
  { id: 'semiDown', label: 'Semitone down', drums: false },
  { id: 'octaveUp', label: 'Octave up', drums: false },
  { id: 'octaveDown', label: 'Octave down', drums: false },
  { id: 'fitScale', label: 'Fit to scale', drums: false },
] as const;
type ToolId = (typeof TOOLS)[number]['id'];

let audioReady = false;
/** Play notes through the clip's track (its instrument and effects), starting audio if needed. */
async function preview(trackId: string, notes: Pick<NoteEvent, 'note' | 'duration' | 'velocity'>[]) {
  if (!audioReady) {
    await initAudio();
    audioReady = true;
  }
  // At the clip's wobble rate, as it will play
  const { clips, editingClipId } = useTimelineStore.getState();
  const wobble = clips.find((c) => c.id === editingClipId)?.wobble;
  previewTrackNotes(trackId, wobble ? notes.map((n) => ({ ...n, wobble })) : notes);
}

/** Follow the pointer until release. */
function trackPointer(cursor: string, onMove: (ev: PointerEvent) => void, onEnd?: () => void): void {
  const onUp = () => {
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    onEnd?.();
  };
  document.body.style.cursor = cursor;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/**
 * Note editor for one clip, docked under the timeline. Click empty grid to add a note (then
 * drag to place it), drag notes to move them, drag a note's right edge to change its length,
 * right-click (or Delete) to delete. Arrow keys nudge / transpose the selection.
 */
export const PianoRoll: React.FC = () => {
  const clipId = useTimelineStore((s) => s.editingClipId);
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === s.editingClipId) ?? null);
  const track = useTimelineStore((s) => (clip ? s.tracks.find((t) => t.id === clip.trackId) ?? null : null));

  if (!clipId || !clip || !track) return null;
  // An audio clip has no notes: its editor is for its gain and fades
  if (clip.audio) return <AudioClipEditor key={clip.id} clip={clip} track={track} />;
  return <PianoRollEditor key={clip.id} clip={clip} instrument={track.instrumentKey} color={track.color} trackName={track.name} slicer={track.slicer} />;
};

/**
 * The playhead line over the grid. It follows the store's playhead (updated every frame
 * while playing) on its own, so the editor and its notes don't re-render 60 times a second.
 */
const GridPlayhead: React.FC<{ startBar: number; stepW: number; gridW: number }> = ({ startBar, stepW, gridW }) => {
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const x = (playhead - startBar) * 16 * stepW;
  if (x < 0 || x > gridW) return null;
  return <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 pointer-events-none z-20" style={{ left: x }} />;
};

interface EditorProps {
  clip: Clip;
  instrument: InstrumentKey;
  color: string;
  trackName: string;
  /** A Slicer track's slices (its rows) */
  slicer?: SlicerSettings;
}

const PianoRollEditor: React.FC<EditorProps> = ({ clip, instrument, color, trackName, slicer }) => {
  // Drum kits and the FX instrument both have fixed, named rows instead of a keyboard
  const isDrums = isDrumKind(instrument) || isFxKind(instrument);
  // So does the Slicer (one row per slice), unless it's in Pitch mode
  const sliceRows = isSlicerKind(instrument) && !slicer?.pitch;
  const namedRows = isDrums || sliceRows;
  const rowH = isDrums ? 30 : sliceRows ? 22 : 16;
  const [stepW, setStepW] = useState(24);
  const unitW = stepW / UNITS_PER_16TH;
  const [gridUnits, setGridUnits] = useState(UNITS_PER_16TH);
  // FX notes last as long as they're drawn: a bar is a useful riser to start from
  const [lengthUnits, setLengthUnits] = useState(isFxKind(instrument) ? UNITS_PER_BAR : isDrums ? 6 : 12);
  const [velocity, setVelocity] = useState(0.8);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scale, setScaleState] = useState<Scale | null>(rememberedScale);
  const [chord, setChordState] = useState<ChordId>(rememberedChord);
  const [ghosts, setGhostsState] = useState(rememberedGhosts);
  // Drum clips: a click toggles a hit on the grid, like a step sequencer
  const [stepMode, setStepModeState] = useState(rememberedStepMode);
  const setStepMode = (next: boolean) => setStepModeState((rememberedStepMode = next));
  const stepping = stepMode && isDrumKind(instrument);
  const setScale = (next: Scale | null) => setScaleState((rememberedScale = next));
  const setChord = (next: ChordId) => setChordState((rememberedChord = next));
  const setGhosts = (next: boolean) => setGhostsState((rememberedGhosts = next));
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rows only grow while the editor is open, so notes never jump rows mid-edit; a Slicer's follow its slices and mode
  const [rows, setRows] = useState(() => rowsFor(instrument, clip.notes, slicer));
  useEffect(() => {
    if (isDrums) return;
    const needed = rowsFor(instrument, clip.notes, slicer);
    if (isSlicerKind(instrument)) setRows((current) => (current.length === needed.length && current[0]?.note === needed[0]?.note && current[0]?.label === needed[0]?.label ? current : needed));
    else if (needed.length > rows.length) setRows(needed);
  }, [clip.notes, instrument, isDrums, rows.length, slicer]);

  const totalUnits = Math.round(clip.lengthBars * UNITS_PER_BAR);
  /** Where the clip starts, in units from bar 1 (clips may start mid-bar): the grid lines up with the song. */
  const clipUnits = unitsOf(clip.startBar - 1);
  const beatMarks = useMemo(() => {
    const marks: { at: number; bar: number; beat: number }[] = [];
    for (let abs = Math.ceil(clipUnits / UNITS_PER_BEAT - 1e-9) * UNITS_PER_BEAT; abs - clipUnits < totalUnits; abs += UNITS_PER_BEAT) {
      marks.push({ at: abs - clipUnits, bar: Math.floor(abs / UNITS_PER_BAR) + 1, beat: Math.floor((abs % UNITS_PER_BAR) / UNITS_PER_BEAT) + 1 });
    }
    return marks;
  }, [clipUnits, totalUnits]);
  const gridW = totalUnits * unitW;
  /** The nearest grid line to `u` (units from the clip start). */
  const snapUnits = (u: number) => Math.round((u + clipUnits) / gridUnits) * gridUnits - clipUnits;
  /**
   * Thin lines every `period` units, counted from bar 1, as a CSS background. A repeating
   * gradient rather than tiles, which would drift where a period isn't a whole number of pixels.
   */
  const lines = (period: number, color: string) => {
    const at = (((-clipUnits % period) + period) % period) * unitW;
    return `repeating-linear-gradient(to right, ${color} ${at}px, ${color} ${at + 1}px, transparent ${at + 1}px, transparent ${at + period * unitW}px)`;
  };
  /** Triplet and 1/32 grids get their own lines; coarser ones keep the 16th lines. */
  const lineUnits = gridUnits % UNITS_PER_16TH === 0 ? UNITS_PER_16TH : gridUnits;
  const gridH = rows.length * rowH;

  const visibleNotes = useMemo(
    () => clip.notes.filter((n) => n.startOffset >= -1e-6 && n.startOffset < clip.lengthBars - 1e-6),
    [clip.notes, clip.lengthBars]
  );

  // Other tracks' notes over the same bars, drawn faintly behind this clip's so parts fit together
  const allClips = useTimelineStore((st) => st.clips);
  const allTracks = useTimelineStore((st) => st.tracks);
  const ghostNotes = useMemo(() => {
    if (!ghosts || namedRows) return [];
    const pitched = new Set(allTracks.filter((t) => !isDrumKind(t.instrumentKey) && !isFxKind(t.instrumentKey) && !isSlicerKind(t.instrumentKey)).map((t) => t.id));
    const from = clip.startBar;
    const to = clip.startBar + clip.lengthBars;
    const out: { key: string; note: string; start: number; length: number; color: string }[] = [];
    for (const c of allClips) {
      if (c.id === clip.id || c.audio || !pitched.has(c.trackId) || c.startBar >= to || c.startBar + c.lengthBars <= from) continue;
      const color = allTracks.find((t) => t.id === c.trackId)?.color ?? '#888';
      for (const n of c.notes) {
        if (n.startOffset >= c.lengthBars) continue;
        const at = c.startBar + n.startOffset;
        const len = Math.min(durationToBars(n.duration), c.lengthBars - n.startOffset);
        if (at >= to || at + len <= from) continue;
        out.push({ key: `${c.id}:${n.id}`, note: n.note, start: at - from, length: len, color });
      }
    }
    return out;
  }, [ghosts, namedRows, allClips, allTracks, clip.id, clip.startBar, clip.lengthBars]);

  // Open scrolled to the notes (or middle of the range)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || namedRows) return;
    const idxs = clip.notes.map((n) => rowIndexOf(rows, n.note)).filter((i) => i >= 0);
    const target = idxs.length ? idxs.reduce((a, b) => a + b, 0) / idxs.length : rows.length / 2;
    el.scrollTop = Math.max(0, target * rowH - el.clientHeight / 2 + RULER_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const local = (clientX: number, clientY: number) => {
    const r = gridRef.current!.getBoundingClientRect();
    return { units: (clientX - r.left) / unitW, row: Math.floor((clientY - r.top) / rowH), x: clientX - r.left, y: clientY - r.top };
  };

  const currentNotes = () => useTimelineStore.getState().clips.find((c) => c.id === clip.id)?.notes ?? [];

  /** Drag the given notes; mode move = time + pitch, resize = length. */
  const startDrag = (e: React.PointerEvent, ids: Set<string>, mode: 'move' | 'resize', alreadyRecorded: boolean, primaryId: string) => {
    const store = useTimelineStore.getState();
    const origin = local(e.clientX, e.clientY);
    const originals = new Map(currentNotes().filter((n) => ids.has(n.id)).map((n) => [n.id, n]));
    const primary = originals.get(primaryId);
    const starts = [...originals.values()].map((n) => unitsOf(n.startOffset));
    // A move keeps every dragged note inside the clip: start >= 0 and before the clip's end
    const minShift = -Math.min(...starts);
    const maxShift = totalUnits - Math.max(...starts);
    let recorded = alreadyRecorded;
    let lastRowShift = 0;

    trackPointer(mode === 'move' ? 'grabbing' : 'ew-resize', (ev) => {
      const p = local(ev.clientX, ev.clientY);
      const pulled = (p.x - origin.x) / unitW;
      // Nothing moves until the pointer has gone half a grid step. Then the grabbed note's start
      // (its end, for a resize) snaps to the grid, like a clip on the timeline, and the other
      // notes move by as much. Notes already on the grid move by whole grid steps.
      let dUnits = 0;
      if (primary && Math.abs(pulled) >= gridUnits / 2) {
        const anchor = unitsOf(primary.startOffset) + (mode === 'resize' ? noteUnits(primary) : 0);
        dUnits = snapUnits(anchor + pulled) - anchor;
        if (mode === 'move') {
          // Held back by whole grid steps at either end of the clip, so the notes stay on the grid
          if (dUnits < minShift) dUnits += Math.ceil((minShift - dUnits) / gridUnits - 1e-9) * gridUnits;
          if (dUnits > maxShift - 1e-6) dUnits -= (Math.floor((dUnits - maxShift) / gridUnits + 1e-9) + 1) * gridUnits;
          if (dUnits < minShift) dUnits = 0;
        }
      }
      const dRows = mode === 'move' ? Math.round((p.y - origin.y) / rowH) : 0;
      if (!recorded && (dUnits !== 0 || dRows !== 0)) {
        store.checkpoint();
        recorded = true;
      }
      const next = currentNotes().map((n) => {
        const o = originals.get(n.id);
        if (!o) return n;
        if (mode === 'resize') {
          const start = unitsOf(o.startOffset);
          const len = Math.max(gridUnits, Math.min(totalUnits - start, noteUnits(o) + dUnits));
          return { ...n, duration: barsToDuration(len / UNITS_PER_BAR) };
        }
        const rowIdx = Math.max(0, Math.min(rows.length - 1, rowIndexOf(rows, o.note) + dRows));
        return { ...n, startOffset: (unitsOf(o.startOffset) + dUnits) / UNITS_PER_BAR, note: rows[rowIdx].note };
      });
      store.setClipNotes(clip.id, next);

      if (dRows !== lastRowShift) {
        lastRowShift = dRows;
        const moved = next.find((n) => n.id === primaryId);
        if (moved) void preview(clip.trackId, [{ ...moved, duration: '16n' }]);
      }
    });
  };

  /** The nearest in-scale note to `midi` that has a row. */
  const snapRow = (midi: number) => {
    if (!scale) return midi;
    for (let d = 0; d <= 6; d++) {
      for (const m of [midi + d, midi - d]) if (inScale(m, scale) && rowIndexOf(rows, nameOf(m)) >= 0) return m;
    }
    return midi;
  };

  /** Run a tool over the selected notes (all of the clip's, with none selected): one undo step. */
  const applyTool = (tool: ToolId) => {
    const store = useTimelineStore.getState();
    const notes = currentNotes();
    const target = selected.size ? notes.filter((n) => selected.has(n.id)) : notes;
    if (!target.length) return;
    const rest = notes.filter((n) => !target.includes(n));
    const bars = clip.lengthBars;
    const grid = gridUnits / UNITS_PER_BAR;
    const [lo, hi] = INSTRUMENTS[instrument].range;
    const newId = () => uid('note');
    const out = (() => {
      switch (tool) {
        case 'quantize': return quantize(target, grid, clip.startBar - 1);
        case 'quantizeEnds': return quantize(target, grid, clip.startBar - 1, 1, true);
        case 'humanize': return humanize(target, bars);
        case 'strumDown': return strum(target, bars, 1 / 96, true);
        case 'strumUp': return strum(target, bars, 1 / 96, false);
        case 'arpUp': return arpeggiate(target, grid, 'up', newId);
        case 'arpDown': return arpeggiate(target, grid, 'down', newId);
        case 'arpUpDown': return arpeggiate(target, grid, 'upDown', newId);
        case 'arpRandom': return arpeggiate(target, grid, 'random', newId);
        case 'legato': return legato(target, bars);
        case 'ratchet2': return ratchet(target, 2, newId);
        case 'ratchet3': return ratchet(target, 3, newId);
        case 'ratchet4': return ratchet(target, 4, newId);
        case 'roll': return roll(target, grid, newId);
        case 'semiUp': return transpose(target, 1, lo, hi);
        case 'semiDown': return transpose(target, -1, lo, hi);
        case 'octaveUp': return transpose(target, 12, lo, hi);
        case 'octaveDown': return transpose(target, -12, lo, hi);
        case 'fitScale': return scale ? fitToScale(target, scale) : target;
      }
    })();
    store.checkpoint();
    store.setClipNotes(clip.id, [...rest, ...out]);
    if (selected.size) setSelected(new Set(out.map((n) => n.id)));
    // Rows grow to fit notes moved past them (an octave up)
    const needed = rowsFor(instrument, [...rest, ...out], slicer);
    if (!namedRows && needed.length > rows.length) setRows(needed);
  };

  const onGridPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const noteEl = (e.target as HTMLElement).closest<HTMLElement>('[data-note-id]');

    if (stepping && !e.altKey) {
      // Step sequencer: the cell under the click (one GRID step on its row) gets a hit, or loses its hits
      const p = local(e.clientX, e.clientY);
      const row = rows[p.row];
      if (!row) return;
      const cell = Math.max(0, Math.floor((p.units + clipUnits) / gridUnits) * gridUnits - clipUnits);
      const inCell = currentNotes().filter((n) => n.note === row.note && unitsOf(n.startOffset) >= cell - 1e-6 && unitsOf(n.startOffset) < cell + gridUnits - 1e-6);
      const store = useTimelineStore.getState();
      if (inCell.length) {
        store.deleteNotes(clip.id, new Set(inCell.map((n) => n.id)));
        setSelected(new Set());
        return;
      }
      if (cell >= totalUnits) return;
      // Shift: an accent
      const note = { note: row.note, startOffset: cell / UNITS_PER_BAR, duration: barsToDuration(gridUnits / UNITS_PER_BAR), velocity: e.shiftKey ? 1 : velocity };
      store.addNotes(clip.id, [note]);
      void preview(clip.trackId, [{ ...note, duration: '16n' }]);
      return;
    }

    if (noteEl) {
      const id = noteEl.dataset.noteId!;
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      let sel = selected;
      if (additive) {
        sel = new Set(selected);
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
      } else if (!selected.has(id)) {
        sel = new Set([id]);
      }
      setSelected(sel);
      if (!sel.has(id)) return;
      const note = currentNotes().find((n) => n.id === id);
      if (note) void preview(clip.trackId, [{ ...note, duration: '16n' }]);
      const rect = noteEl.getBoundingClientRect();
      const resize = e.clientX > rect.right - edgeOf(rect.width);
      startDrag(e, resize ? new Set([id]) : sel, resize ? 'resize' : 'move', false, id);
      return;
    }

    // Empty grid: add a note, then let the same drag place it
    const p = local(e.clientX, e.clientY);
    const row = rows[p.row];
    if (!row) return;
    // The grid line at or before the click
    const start = Math.max(0, Math.floor((p.units + clipUnits) / gridUnits) * gridUnits - clipUnits);
    const len = Math.min(lengthUnits, totalUnits - start);
    const at = { startOffset: start / UNITS_PER_BAR, duration: barsToDuration(len / UNITS_PER_BAR), velocity };
    // In a scale, a click lands on the nearest note of it; a chord stamps every note of the chord
    let pitches = [row.note];
    if (!namedRows) {
      const clicked = midiOf(row.note);
      const root = scale ? snapRow(clicked) : clicked;
      const midis = chordNotes(root, chord, scale);
      pitches = midis.map(nameOf).filter((n) => rowIndexOf(rows, n) >= 0);
      if (!pitches.length) pitches = [row.note];
    }
    const added = pitches.map((note) => ({ note, ...at }));
    const ids = useTimelineStore.getState().addNotes(clip.id, added);
    setSelected(new Set(ids));
    void preview(clip.trackId, added.map((n) => ({ ...n, duration: '8n' })));
    startDrag(e, new Set(ids), 'move', true, ids[0]);
  };

  const deleteNote = (id: string) => {
    useTimelineStore.getState().deleteNotes(clip.id, new Set([id]));
    setSelected((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
  };

  // Keys: capture phase so Delete / Ctrl+A act on notes instead of timeline clips
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreShortcut(e)) return;
      const store = useTimelineStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const handled = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };

      if (mod && e.key.toLowerCase() === 'a') {
        handled();
        setSelected(new Set(visibleNotes.map((n) => n.id)));
        return;
      }
      if (e.key === 'Escape') {
        handled();
        if (selected.size) setSelected(new Set());
        else store.closeEditor();
        return;
      }
      if (selected.size === 0) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        handled();
        store.deleteNotes(clip.id, selected);
        setSelected(new Set());
        return;
      }

      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-gridUnits, 0],
        ArrowRight: [gridUnits, 0],
        ArrowUp: [0, e.shiftKey && !namedRows ? -12 : -1],
        ArrowDown: [0, e.shiftKey && !namedRows ? 12 : 1],
      };
      const delta = arrows[e.key];
      if (!delta) return;
      handled();
      const [dUnits, dRows] = delta;
      const notes = currentNotes();
      // The selection moves one grid step as a block: at the clip's edge it stays put rather than bunching up
      const outside = (n: NoteEvent) => {
        const u = unitsOf(n.startOffset) + dUnits;
        return u < 0 || u > totalUnits - 1e-6;
      };
      if (notes.some((n) => selected.has(n.id) && outside(n))) return;
      store.checkpoint();
      store.setClipNotes(
        clip.id,
        notes.map((n) => {
          if (!selected.has(n.id)) return n;
          const rowIdx = Math.max(0, Math.min(rows.length - 1, rowIndexOf(rows, n.note) + dRows));
          return { ...n, startOffset: (unitsOf(n.startOffset) + dUnits) / UNITS_PER_BAR, note: rows[rowIdx].note };
        })
      );
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, visibleNotes, gridUnits, rows, totalUnits, clip.id, namedRows]);

  // Velocity slider edits the selection when there is one, else sets the velocity for new notes
  const selectedVelocity = (() => {
    const sel = visibleNotes.filter((n) => selected.has(n.id));
    return sel.length ? sel.reduce((a, n) => a + n.velocity, 0) / sel.length : null;
  })();
  const onVelocity = (v: number) => {
    setVelocity(v);
    if (!selected.size) return;
    useTimelineStore.getState().setClipNotes(
      clip.id,
      currentNotes().map((n) => (selected.has(n.id) ? { ...n, velocity: v } : n))
    );
  };

  const select = 'h-7 bg-forge-bg border border-forge-border rounded-md px-1.5 text-forge-text focus:outline-none focus:border-cyan-500';

  return (
    <div className="border-t-2 bg-forge-panel flex flex-col" style={{ borderTopColor: color }} aria-label="Piano roll">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b border-forge-border text-xs font-mono text-forge-muted">
        <div className="flex items-center gap-2">
          <Piano className="w-4 h-4" style={{ color }} />
          <input
            value={clip.name}
            onChange={(e) => useTimelineStore.getState().renameClip(clip.id, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-7 w-40 bg-transparent border border-transparent hover:border-forge-border focus:border-cyan-500 rounded-md px-2 text-sm font-semibold text-forge-text focus:outline-none"
            aria-label="Clip name"
          />
          <span className="text-[11px]">{trackName}</span>
        </div>
        <label className="flex items-center gap-1.5">
          GRID
          <select className={select} value={gridUnits} onChange={(e) => setGridUnits(Number(e.target.value))}>
            {GRID_OPTIONS.map((o) => (
              <option key={o.units} value={o.units}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          NEW NOTE
          <select className={select} value={lengthUnits} onChange={(e) => setLengthUnits(Number(e.target.value))}>
            {LENGTH_OPTIONS.map((o) => (
              <option key={o.units} value={o.units}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5" title={selected.size ? 'Velocity of the selected notes' : 'Velocity for new notes'}>
          {selected.size ? `VEL (${selected.size})` : 'VEL'}
          <UndoableRange
            min={0.1}
            max={1}
            step={0.05}
            value={selectedVelocity ?? velocity}
            onValue={onVelocity}
            undoable={selected.size > 0}
            className="w-24 cursor-pointer"
            style={{ accentColor: color }}
          />
          <span className="w-8 tabular-nums text-forge-text">{Math.round((selectedVelocity ?? velocity) * 100)}</span>
        </label>
        {INSTRUMENTS[instrument].wobble && (
          <label data-search="wobble" className="flex items-center gap-1.5" title="How fast this clip's notes wobble: one filter sweep per note value (T = triplet), starting again with every note">
            WOBBLE
            <select
              className={select}
              value={clip.wobble ?? DEFAULT_WOBBLE}
              onChange={(e) => useTimelineStore.getState().setClipWobble(clip.id, e.target.value as WobbleRate)}
            >
              {WOBBLE_RATES.map((rate) => (
                <option key={rate} value={rate}>{rate}</option>
              ))}
            </select>
          </label>
        )}
        {!namedRows && (
          <label data-search="scale" className="flex items-center gap-1.5" title="Shade the notes outside a key; clicks land on the key's notes">
            SCALE
            <select
              className={select}
              aria-label="Scale root"
              value={scale?.root ?? 0}
              disabled={!scale}
              onChange={(e) => scale && setScale({ ...scale, root: Number(e.target.value) })}
            >
              {ROOT_NAMES.map((n, i) => (
                <option key={n} value={i}>{n}</option>
              ))}
            </select>
            <select
              className={select}
              aria-label="Scale"
              value={scale?.id ?? 'off'}
              onChange={(e) => setScale(e.target.value === 'off' ? null : { root: scale?.root ?? 0, id: e.target.value as ScaleId })}
            >
              <option value="off">Off</option>
              {(Object.keys(SCALES) as ScaleId[]).map((id) => (
                <option key={id} value={id}>{SCALES[id].name}</option>
              ))}
            </select>
          </label>
        )}
        {!namedRows && (
          <label data-search="chord" className="flex items-center gap-1.5" title="A click adds a whole chord from the note you click">
            CHORD
            <select className={select} value={chord} onChange={(e) => setChord(e.target.value as ChordId)}>
              {(Object.keys(CHORDS) as ChordId[]).map((id) => (
                <option key={id} value={id}>{CHORDS[id].name}</option>
              ))}
            </select>
          </label>
        )}
        {isDrumKind(instrument) && (
          <label data-search="steps" className="flex items-center gap-1.5 cursor-pointer" title="Step sequencer: a click turns a hit on or off in that GRID step (Shift-click: an accent). Alt-click: add and drag notes as usual. Off: always add and drag.">
            <input type="checkbox" checked={stepMode} onChange={(e) => setStepMode(e.target.checked)} className="accent-cyan-500" />
            STEPS
          </label>
        )}
        <label data-search="tools" className="flex items-center gap-1.5" title={selected.size ? 'Change the selected notes' : 'Change all the notes in this clip (select some to change only those)'}>
          TOOLS
          <select
            className={select}
            value=""
            onChange={(e) => {
              if (e.target.value) applyTool(e.target.value as ToolId);
              e.currentTarget.blur();
            }}
          >
            <option value="">{selected.size ? `${selected.size} selected…` : 'All notes…'}</option>
            {TOOLS.filter((t) => (namedRows ? t.drums : t.id !== 'fitScale' || scale)).map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        {!namedRows && (
          <label data-search="ghosts" className="flex items-center gap-1.5 cursor-pointer" title="Show the other tracks' notes at these bars, faintly, behind this clip's">
            <input type="checkbox" checked={ghosts} onChange={(e) => setGhosts(e.target.checked)} className="accent-cyan-500" />
            GHOSTS
          </label>
        )}
        <div className="flex items-center gap-1.5">
          <button type="button" title="Zoom out" onClick={() => setStepW((w) => Math.max(10, w - 6))} className="hover:text-forge-text">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button type="button" title="Zoom in" onClick={() => setStepW((w) => Math.min(60, w + 6))} className="hover:text-forge-text">
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
        <span className="hidden xl:inline text-[11px]">
          Click to add • drag to move • drag right edge to resize • right-click to delete • arrows nudge
        </span>
        <button
          type="button"
          onClick={() => useTimelineStore.getState().closeEditor()}
          className="ml-auto flex items-center gap-1 text-forge-muted hover:text-forge-text"
          title="Close editor (Esc)"
        >
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="relative overflow-auto max-h-[340px] select-none">
        <div className="relative" style={{ width: KEY_W + gridW, height: RULER_H + gridH }}>
          {/* Ruler */}
          <div
            className="sticky top-0 z-20 flex bg-forge-panel border-b border-forge-border cursor-pointer"
            style={{ height: RULER_H, width: KEY_W + gridW }}
            onPointerDown={(e) => {
              const r = gridRef.current!.getBoundingClientRect();
              const units = Math.max(0, (e.clientX - r.left) / unitW);
              useTimelineStore.getState().seek(clip.startBar + units / UNITS_PER_BAR);
            }}
            title="Click to move the playhead"
          >
            <div className="sticky left-0 z-10 shrink-0 bg-forge-panel border-r border-forge-border" style={{ width: KEY_W }} />
            <div
              className="relative"
              style={{
                width: gridW,
                // Ticks along the bottom at the grid's spacing
                backgroundImage: lines(lineUnits, 'rgba(255,255,255,0.18)'),
                backgroundSize: '100% 4px',
                backgroundPosition: 'left bottom',
                backgroundRepeat: 'no-repeat',
              }}
            >
              {beatMarks.map(({ at, bar, beat }) => (
                <span
                  key={at}
                  className={`absolute top-[3px] text-[10px] font-mono tabular-nums ${beat === 1 ? 'text-forge-text' : 'text-forge-muted/70'}`}
                  style={{ left: at * unitW + 3 }}
                >
                  {bar}.{beat}
                </span>
              ))}
            </div>
          </div>

          <div className="flex">
            {/* Keyboard / drum names */}
            <div className="sticky left-0 z-10 shrink-0 border-r border-forge-border" style={{ width: KEY_W }}>
              {rows.map((r) => (
                <button
                  key={r.note}
                  type="button"
                  // An FX row plays a bar of its effect: a riser an 8th long is just a blip; a slice plays a half note of itself
                  onPointerDown={() => void preview(clip.trackId, [{ note: r.note, duration: isFxKind(instrument) ? '1m' : isSlicerKind(instrument) ? '2n' : '8n', velocity }])}
                  className={`w-full flex items-center justify-end pr-1.5 border-b border-black/40 text-[9px] font-mono ${
                    namedRows
                      ? 'bg-forge-panelLight text-forge-text text-[10px] hover:bg-forge-border'
                      : r.black
                        ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        : 'bg-zinc-200 text-zinc-600 hover:bg-white'
                  }`}
                  style={{ height: rowH }}
                  title={`Preview ${r.label}`}
                >
                  {namedRows || r.label !== r.note || (r.note.startsWith('C') && !r.note.startsWith('C#')) ? r.label : ''}
                </button>
              ))}
            </div>

            {/* Grid */}
            <div
              ref={gridRef}
              className="relative cursor-crosshair"
              style={{ width: gridW, height: gridH }}
              onPointerDown={onGridPointerDown}
            >
              {rows.map((r, i) => {
                // With a scale: notes outside it darker, its root lit
                const m = scale && !namedRows ? midiOf(r.note) : NaN;
                const outside = Number.isFinite(m) && !inScale(m, scale!);
                const root = Number.isFinite(m) && (((m - scale!.root) % 12) + 12) % 12 === 0;
                return (
                  <div
                    key={r.note}
                    className={`absolute left-0 right-0 border-b border-black/30 ${outside ? 'bg-black/55' : root ? 'bg-cyan-400/[0.09]' : r.black ? 'bg-black/25' : 'bg-white/[0.03]'}`}
                    style={{ top: i * rowH, height: rowH }}
                  />
                );
              })}
              {ghostNotes.map((g) => {
                const idx = rowIndexOf(rows, g.note);
                if (idx < 0) return null;
                return (
                  <div
                    key={g.key}
                    className="absolute rounded-[3px] border pointer-events-none"
                    style={{ left: unitsOf(g.start) * unitW + 1, width: Math.max(3, unitsOf(g.length) * unitW - 2), top: idx * rowH + 3, height: rowH - 6, borderColor: g.color, opacity: 0.35 }}
                  />
                );
              })}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  // Bar, beat and grid lines, lined up with the song, not the clip start
                  backgroundImage: [
                    lines(UNITS_PER_BAR, 'rgba(255,255,255,0.28)'),
                    lines(UNITS_PER_BEAT, 'rgba(255,255,255,0.12)'),
                    lines(lineUnits, 'rgba(255,255,255,0.05)'),
                  ].join(', '),
                }}
              />

              {visibleNotes.map((n) => {
                const idx = rowIndexOf(rows, n.note);
                if (idx < 0) return null;
                const start = unitsOf(n.startOffset);
                const len = Math.min(totalUnits - start, noteUnits(n));
                const width = Math.max(4, len * unitW - 2);
                const isSel = selected.has(n.id);
                return (
                  <div
                    key={n.id}
                    data-note-id={n.id}
                    className={`absolute rounded-[3px] border cursor-grab ${isSel ? 'border-white ring-1 ring-white/80 z-10' : 'border-black/50'}`}
                    style={{
                      left: start * unitW + 1,
                      width,
                      top: idx * rowH + 1,
                      height: rowH - 2,
                      backgroundColor: color,
                      opacity: 0.4 + n.velocity * 0.6,
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      deleteNote(n.id);
                    }}
                    title={`${namedRows ? rows[idx].label : n.note} • velocity ${Math.round(n.velocity * 100)}`}
                  >
                    <div className="absolute right-0 top-0 bottom-0 cursor-ew-resize" style={{ width: edgeOf(width) }} />
                  </div>
                );
              })}

              <GridPlayhead startBar={clip.startBar} stepW={stepW} gridW={gridW} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
