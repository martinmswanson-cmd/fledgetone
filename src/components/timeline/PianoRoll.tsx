import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Piano, X, ZoomIn, ZoomOut } from 'lucide-react';
import { initAudio } from '../../audio/engine';
import { DRUM_NOTES } from '../../audio/scheduler';
import { previewTrackNotes } from '../../audio/liveTracks';
import { FX_ROWS, INSTRUMENTS, isDrumKind, isFxKind } from '../../audio/instrumentCatalog';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, InstrumentKey, NoteEvent } from '../../store/timelineTypes';
import { barsToDuration, durationToBars } from '../../store/timelineTypes';
import { DEFAULT_WOBBLE, WOBBLE_RATES, type WobbleRate } from '../../store/timelineTypes';
import { shouldIgnoreShortcut } from '../keyboard';
import { UndoableRange } from '../UndoableRange';

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
  { note: DRUM_NOTES.cowbell, label: 'Cowbell', black: false, midi: -1 },
  { note: DRUM_NOTES.openHat, label: 'Open Hat', black: true, midi: -1 },
  { note: DRUM_NOTES.closedHat, label: 'Closed Hat', black: false, midi: -1 },
  { note: DRUM_NOTES.snare, label: 'Snare', black: true, midi: -1 },
  { note: DRUM_NOTES.kick, label: 'Kick', black: false, midi: -1 },
];

const FX_ROW_LIST: Row[] = FX_ROWS.map((r, i) => ({ ...r, black: i % 2 === 1, midi: -1 }));


const toMidi = (note: string) => Tone.Frequency(note).toMidi();
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

function rowsFor(instrument: InstrumentKey, notes: NoteEvent[]): Row[] {
  if (isDrumKind(instrument)) return DRUM_ROWS;
  if (isFxKind(instrument)) return FX_ROW_LIST;
  // Instrument's playable range, widened to fit any notes already in the clip
  let [lo, hi] = INSTRUMENTS[instrument].range;
  for (const n of notes) {
    const m = toMidi(n.note);
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
  }
  const rows: Row[] = [];
  for (let m = hi; m >= lo; m--) {
    const note = Tone.Frequency(m, 'midi').toNote();
    rows.push({ note, label: note, black: isBlack(m), midi: m });
  }
  return rows;
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
  return <PianoRollEditor key={clip.id} clip={clip} instrument={track.instrumentKey} color={track.color} trackName={track.name} />;
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
}

const PianoRollEditor: React.FC<EditorProps> = ({ clip, instrument, color, trackName }) => {
  // Drum kits and the FX instrument both have fixed, named rows instead of a keyboard
  const isDrums = isDrumKind(instrument) || isFxKind(instrument);
  const rowH = isDrums ? 30 : 16;
  const [stepW, setStepW] = useState(24);
  const unitW = stepW / UNITS_PER_16TH;
  const [gridUnits, setGridUnits] = useState(UNITS_PER_16TH);
  // FX notes last as long as they're drawn: a bar is a useful riser to start from
  const [lengthUnits, setLengthUnits] = useState(isFxKind(instrument) ? UNITS_PER_BAR : isDrums ? 6 : 12);
  const [velocity, setVelocity] = useState(0.8);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Rows only grow while the editor is open, so notes never jump rows mid-edit
  const [rows, setRows] = useState(() => rowsFor(instrument, clip.notes));
  useEffect(() => {
    if (isDrums) return;
    const needed = rowsFor(instrument, clip.notes);
    if (needed.length > rows.length) setRows(needed);
  }, [clip.notes, instrument, isDrums, rows.length]);

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

  // Open scrolled to the notes (or middle of the range)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || isDrums) return;
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

  const onGridPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const noteEl = (e.target as HTMLElement).closest<HTMLElement>('[data-note-id]');

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
    const note = { note: row.note, startOffset: start / UNITS_PER_BAR, duration: barsToDuration(len / UNITS_PER_BAR), velocity };
    const [id] = useTimelineStore.getState().addNotes(clip.id, [note]);
    setSelected(new Set([id]));
    void preview(clip.trackId, [{ ...note, duration: '16n' }]);
    startDrag(e, new Set([id]), 'move', true, id);
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
        ArrowUp: [0, e.shiftKey && !isDrums ? -12 : -1],
        ArrowDown: [0, e.shiftKey && !isDrums ? 12 : 1],
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
  }, [selected, visibleNotes, gridUnits, rows, totalUnits, clip.id, isDrums]);

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
          <label className="flex items-center gap-1.5" title="How fast this clip's notes wobble: one filter sweep per note value (T = triplet), starting again with every note">
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
                  // An FX row plays a bar of its effect: a riser an 8th long is just a blip
                  onPointerDown={() => void preview(clip.trackId, [{ note: r.note, duration: isFxKind(instrument) ? '1m' : '8n', velocity }])}
                  className={`w-full flex items-center justify-end pr-1.5 border-b border-black/40 text-[9px] font-mono ${
                    isDrums
                      ? 'bg-forge-panelLight text-forge-text text-[10px] hover:bg-forge-border'
                      : r.black
                        ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                        : 'bg-zinc-200 text-zinc-600 hover:bg-white'
                  }`}
                  style={{ height: rowH }}
                  title={`Preview ${r.label}`}
                >
                  {isDrums || r.note.startsWith('C') && !r.note.startsWith('C#') ? r.label : ''}
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
              {rows.map((r, i) => (
                <div
                  key={r.note}
                  className={`absolute left-0 right-0 border-b border-black/30 ${r.black ? 'bg-black/25' : 'bg-white/[0.03]'}`}
                  style={{ top: i * rowH, height: rowH }}
                />
              ))}
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
                    title={`${isDrums ? rows[idx].label : n.note} • velocity ${Math.round(n.velocity * 100)}`}
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
