import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Piano, X, ZoomIn, ZoomOut } from 'lucide-react';
import { initAudio } from '../../audio/engine';
import { DRUM_NOTES } from '../../audio/scheduler';
import { previewTrackNotes } from '../../audio/liveTracks';
import { INSTRUMENTS, isDrumKind } from '../../audio/instrumentCatalog';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, InstrumentKey, NoteEvent } from '../../store/timelineTypes';
import { barsToDuration, durationToBars } from '../../store/timelineTypes';

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


const toMidi = (note: string) => Tone.Frequency(note).toMidi();
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

function rowsFor(instrument: InstrumentKey, notes: NoteEvent[]): Row[] {
  if (isDrumKind(instrument)) return DRUM_ROWS;
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
  return rows.findIndex((r) => r.midi === toMidi(note));
}

const GRID_OPTIONS = [
  { label: '1/16', steps: 1 },
  { label: '1/8', steps: 2 },
  { label: '1/4', steps: 4 },
];

const LENGTH_OPTIONS = [
  { label: '1/16', steps: 1 },
  { label: '1/8', steps: 2 },
  { label: '1/8 dotted', steps: 3 },
  { label: '1/4', steps: 4 },
  { label: '1/4 dotted', steps: 6 },
  { label: '1/2', steps: 8 },
  { label: '1 bar', steps: 16 },
];

let audioReady = false;
/** Play notes through the clip's track (its instrument and effects), starting audio if needed. */
async function preview(trackId: string, notes: Pick<NoteEvent, 'note' | 'duration' | 'velocity'>[]) {
  if (!audioReady) {
    await initAudio();
    audioReady = true;
  }
  previewTrackNotes(trackId, notes);
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
  const playhead = useTimelineStore((s) => s.playheadPosition);

  if (!clipId || !clip || !track) return null;
  return <PianoRollEditor key={clip.id} clip={clip} instrument={track.instrumentKey} color={track.color} trackName={track.name} playhead={playhead} />;
};

interface EditorProps {
  clip: Clip;
  instrument: InstrumentKey;
  color: string;
  trackName: string;
  playhead: number;
}

const PianoRollEditor: React.FC<EditorProps> = ({ clip, instrument, color, trackName, playhead }) => {
  const isDrums = isDrumKind(instrument);
  const rowH = isDrums ? 30 : 16;
  const [stepW, setStepW] = useState(24);
  const [gridSteps, setGridSteps] = useState(1);
  const [lengthSteps, setLengthSteps] = useState(isDrums ? 1 : 2);
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

  const totalSteps = Math.round(clip.lengthBars * 16);
  /** 16ths from the start of the bar the clip begins in (clips may start mid-bar). */
  const startStep = Math.round((clip.startBar - 1) * 16);
  const phase = ((startStep % 16) + 16) % 16;
  const beatMarks = useMemo(() => {
    const marks: { step: number; bar: number; beat: number }[] = [];
    for (let step = (4 - (startStep % 4)) % 4; step < totalSteps; step += 4) {
      const abs = startStep + step;
      marks.push({ step, bar: Math.floor(abs / 16) + 1, beat: Math.floor((abs % 16) / 4) + 1 });
    }
    return marks;
  }, [startStep, totalSteps]);
  const gridW = totalSteps * stepW;
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
    return { step: (clientX - r.left) / stepW, row: Math.floor((clientY - r.top) / rowH), x: clientX - r.left, y: clientY - r.top };
  };

  const currentNotes = () => useTimelineStore.getState().clips.find((c) => c.id === clip.id)?.notes ?? [];

  /** Drag the given notes; mode move = time + pitch, resize = length. */
  const startDrag = (e: React.PointerEvent, ids: Set<string>, mode: 'move' | 'resize', alreadyRecorded: boolean, primaryId: string) => {
    const store = useTimelineStore.getState();
    const origin = local(e.clientX, e.clientY);
    const originals = new Map(currentNotes().filter((n) => ids.has(n.id)).map((n) => [n.id, n]));
    let recorded = alreadyRecorded;
    let lastRowShift = 0;

    trackPointer(mode === 'move' ? 'grabbing' : 'ew-resize', (ev) => {
      const p = local(ev.clientX, ev.clientY);
      const dSteps = Math.round((p.x - origin.x) / stepW / gridSteps) * gridSteps;
      const dRows = mode === 'move' ? Math.round((p.y - origin.y) / rowH) : 0;
      if (!recorded && (dSteps !== 0 || dRows !== 0)) {
        store.checkpoint();
        recorded = true;
      }
      const next = currentNotes().map((n) => {
        const o = originals.get(n.id);
        if (!o) return n;
        if (mode === 'resize') {
          const startStep = Math.round(o.startOffset * 16);
          const len = Math.max(gridSteps, Math.min(totalSteps - startStep, Math.round(durationToBars(o.duration) * 16) + dSteps));
          return { ...n, duration: barsToDuration(len / 16) };
        }
        const step = Math.max(0, Math.min(totalSteps - 1, Math.round(o.startOffset * 16) + dSteps));
        const rowIdx = Math.max(0, Math.min(rows.length - 1, rowIndexOf(rows, o.note) + dRows));
        return { ...n, startOffset: step / 16, note: rows[rowIdx].note };
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
      const resize = e.clientX > noteEl.getBoundingClientRect().right - EDGE_PX;
      startDrag(e, resize ? new Set([id]) : sel, resize ? 'resize' : 'move', false, id);
      return;
    }

    // Empty grid: add a note, then let the same drag place it
    const p = local(e.clientX, e.clientY);
    const row = rows[p.row];
    if (!row) return;
    const step = Math.max(0, Math.min(totalSteps - 1, Math.floor(p.step / gridSteps) * gridSteps));
    const len = Math.min(lengthSteps, totalSteps - step);
    const note = { note: row.note, startOffset: step / 16, duration: barsToDuration(len / 16), velocity };
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
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
      if (document.querySelector('[role="dialog"]')) return;
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
        ArrowLeft: [-gridSteps, 0],
        ArrowRight: [gridSteps, 0],
        ArrowUp: [0, e.shiftKey && !isDrums ? -12 : -1],
        ArrowDown: [0, e.shiftKey && !isDrums ? 12 : 1],
      };
      const delta = arrows[e.key];
      if (!delta) return;
      handled();
      store.checkpoint();
      const [dSteps, dRows] = delta;
      store.setClipNotes(
        clip.id,
        currentNotes().map((n) => {
          if (!selected.has(n.id)) return n;
          const step = Math.max(0, Math.min(totalSteps - 1, Math.round(n.startOffset * 16) + dSteps));
          const rowIdx = Math.max(0, Math.min(rows.length - 1, rowIndexOf(rows, n.note) + dRows));
          return { ...n, startOffset: step / 16, note: rows[rowIdx].note };
        })
      );
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, visibleNotes, gridSteps, rows, totalSteps, clip.id, isDrums]);

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

  const playheadX = (playhead - clip.startBar) * 16 * stepW;
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
          <select className={select} value={gridSteps} onChange={(e) => setGridSteps(Number(e.target.value))}>
            {GRID_OPTIONS.map((o) => (
              <option key={o.steps} value={o.steps}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          NEW NOTE
          <select className={select} value={lengthSteps} onChange={(e) => setLengthSteps(Number(e.target.value))}>
            {LENGTH_OPTIONS.map((o) => (
              <option key={o.steps} value={o.steps}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5" title={selected.size ? 'Velocity of the selected notes' : 'Velocity for new notes'}>
          {selected.size ? `VEL (${selected.size})` : 'VEL'}
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={selectedVelocity ?? velocity}
            onPointerDown={() => selected.size && useTimelineStore.getState().checkpoint()}
            onChange={(e) => onVelocity(Number(e.target.value))}
            className="w-24 cursor-pointer"
            style={{ accentColor: color }}
          />
          <span className="w-8 tabular-nums text-forge-text">{Math.round((selectedVelocity ?? velocity) * 100)}</span>
        </label>
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
              const step = Math.max(0, (e.clientX - r.left) / stepW);
              useTimelineStore.getState().seek(clip.startBar + step / 16);
            }}
            title="Click to move the playhead"
          >
            <div className="sticky left-0 z-10 shrink-0 bg-forge-panel border-r border-forge-border" style={{ width: KEY_W }} />
            <div className="relative" style={{ width: gridW }}>
              {beatMarks.map(({ step, bar, beat }) => (
                <span
                  key={step}
                  className={`absolute top-[3px] text-[10px] font-mono tabular-nums ${beat === 1 ? 'text-forge-text' : 'text-forge-muted/70'}`}
                  style={{ left: step * stepW + 3 }}
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
                  onPointerDown={() => void preview(clip.trackId, [{ note: r.note, duration: '8n', velocity }])}
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
                  backgroundImage:
                    'linear-gradient(to right, rgba(255,255,255,0.28) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)',
                  backgroundSize: `${stepW * 16}px 100%, ${stepW * 4}px 100%, ${stepW}px 100%`,
                  // Line the bar/beat lines up with the song, not the clip start
                  backgroundPosition: `${(((16 - phase) % 16) * stepW)}px 0, ${(((4 - (phase % 4)) % 4) * stepW)}px 0, 0 0`,
                }}
              />

              {visibleNotes.map((n) => {
                const idx = rowIndexOf(rows, n.note);
                if (idx < 0) return null;
                const start = Math.round(n.startOffset * 16);
                const len = Math.max(1, Math.min(totalSteps - start, durationToBars(n.duration) * 16));
                const isSel = selected.has(n.id);
                return (
                  <div
                    key={n.id}
                    data-note-id={n.id}
                    className={`absolute rounded-[3px] border cursor-grab ${isSel ? 'border-white ring-1 ring-white/80 z-10' : 'border-black/50'}`}
                    style={{
                      left: start * stepW + 1,
                      width: Math.max(6, len * stepW - 2),
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
                    <div className="absolute right-0 top-0 bottom-0 cursor-ew-resize" style={{ width: EDGE_PX }} />
                  </div>
                );
              })}

              {playheadX >= 0 && playheadX <= gridW && (
                <div className="absolute top-0 bottom-0 w-[2px] bg-red-500 pointer-events-none z-20" style={{ left: playheadX }} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
