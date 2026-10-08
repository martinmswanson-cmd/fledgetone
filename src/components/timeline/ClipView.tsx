import React, { useMemo, useState } from 'react';
import * as Tone from 'tone';
import { TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import type { Clip, InstrumentKey, Track } from '../../store/timelineTypes';
import { DEFAULT_WOBBLE, durationToBars, formatBarCount, minClipLength, snapBar } from '../../store/timelineTypes';
import { DRUM_NOTES } from '../../audio/scheduler';
import { canMoveClipBetween, FX_ROWS, INSTRUMENTS, isDrumKind, isFxKind } from '../../audio/instrumentCatalog';
import { barFromClientX } from './Playhead';
import type { ContextMenuState } from './ClipContextMenu';
import { HEADER_WIDTH, RULER_HEIGHT, TRACK_HEIGHT, TRIM_HANDLE_PX } from './layout';
import { shadeNotes, type NoteRect } from './noteShades';

const CLIP_INSET = 4;
const CLIP_HEIGHT = TRACK_HEIGHT - CLIP_INSET * 2;
const LABEL_HEIGHT = 16;

const DRUM_ROWS: string[] = [
  DRUM_NOTES.cowbell,
  DRUM_NOTES.openHat,
  DRUM_NOTES.closedHat,
  DRUM_NOTES.snare,
  DRUM_NOTES.kick,
];

/** Lay out the visible notes of a clip as mini piano-roll rectangles. */
function layoutNotes(clip: Clip, instrument: InstrumentKey, zoom: number): NoteRect[] {
  const visible = clip.notes.filter((n) => n.startOffset >= -1e-6 && n.startOffset < clip.lengthBars - 1e-6);
  if (visible.length === 0) return [];

  const areaTop = LABEL_HEIGHT + 2;
  const areaHeight = CLIP_HEIGHT - areaTop - 4;
  let rowOf: (note: string) => number;
  let rows: number;

  if (isDrumKind(instrument)) {
    rows = DRUM_ROWS.length;
    rowOf = (note) => Math.max(0, DRUM_ROWS.indexOf(note));
  } else if (isFxKind(instrument)) {
    rows = FX_ROWS.length;
    rowOf = (note) => Math.max(0, FX_ROWS.findIndex((r) => r.note === note));
  } else {
    const midis = visible.map((n) => Tone.Frequency(n.note).toMidi());
    const lo = Math.min(...midis);
    const hi = Math.max(...midis);
    rows = Math.max(hi - lo + 1, 6);
    const pad = Math.floor((rows - (hi - lo + 1)) / 2);
    rowOf = (note) => hi + pad - Tone.Frequency(note).toMidi();
  }

  const rowHeight = areaHeight / rows;
  return visible.map((n) => ({
    left: n.startOffset * zoom,
    width: Math.max(2, Math.min(durationToBars(n.duration), clip.lengthBars - n.startOffset) * zoom - 1),
    top: areaTop + rowOf(n.note) * rowHeight,
    height: Math.max(2, rowHeight - 1),
    opacity: 0.45 + n.velocity * 0.55,
  }));
}

type DragMode = 'move' | 'trim-start' | 'trim-end';

/** The element that scrolls the lanes (the nearest ancestor with vertical overflow scrolling). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/** Edge zone (px) where a drag scrolls the timeline, and the fastest it scrolls (px per frame). */
const AUTO_SCROLL_EDGE = 24;
const AUTO_SCROLL_MAX = 24;

/** Auto-scroll step for a pointer at `pos` in a view from `lo` to `hi`: faster the deeper into an edge zone. */
function edgeStep(pos: number, lo: number, hi: number): number {
  const depth = pos < lo + AUTO_SCROLL_EDGE ? pos - lo - AUTO_SCROLL_EDGE : pos > hi - AUTO_SCROLL_EDGE ? pos - hi + AUTO_SCROLL_EDGE : 0;
  return Math.sign(depth) * Math.min(AUTO_SCROLL_MAX, Math.ceil(Math.abs(depth) / 3));
}

interface ClipViewProps {
  clip: Clip;
  track: Track;
  originRef: React.RefObject<HTMLElement | null>;
  onOpenMenu: (menu: ContextMenuState) => void;
}

/**
 * A single clip block on a track lane.
 * Select tool: click to select (Shift/Ctrl adds), drag to move (all selected clips move together,
 * in time and onto other tracks whose instrument fits), Alt+drag to duplicate, drag either edge to
 * trim. Razor tool: click to split.
 * Edits snap to the active grid; hold Shift while dragging to bypass snap. Near the edges of the
 * lanes a drag scrolls the timeline.
 * Memoized: an edit to one clip doesn't re-render (and re-draw the notes of) every other clip.
 */
export const ClipView = React.memo(function ClipView({ clip, track, originRef, onOpenMenu }: ClipViewProps) {
  const zoom = useTimelineStore((s) => s.zoom);
  const activeTool = useTimelineStore((s) => s.activeTool);
  const isEditing = useTimelineStore((s) => s.editingClipId === clip.id);
  const [razorX, setRazorX] = useState<number | null>(null);

  const shades = useMemo(() => shadeNotes(layoutNotes(clip, track.instrumentKey, zoom)), [clip, track.instrumentKey, zoom]);

  const left = (clip.startBar - 1) * zoom;
  const width = clip.lengthBars * zoom;

  const snapped = (bar: number, shift: boolean) => {
    const s = useTimelineStore.getState();
    return shift ? bar : snapBar(bar, s.snapGrid, s);
  };

  const razorBarAt = (clientX: number, shift: boolean) => snapped(barFromClientX(clientX, originRef.current), shift);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const store = useTimelineStore.getState();

    if (store.activeTool === 'razor') {
      store.splitClip(clip.id, razorBarAt(e.clientX, e.shiftKey));
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const mode: DragMode =
      width > TRIM_HANDLE_PX * 3 && localX <= TRIM_HANDLE_PX
        ? 'trim-start'
        : width > TRIM_HANDLE_PX * 3 && localX >= rect.width - TRIM_HANDLE_PX
          ? 'trim-end'
          : 'move';

    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      store.selectClip(clip.id, true);
      return;
    }
    if (!clip.isSelected) store.selectClip(clip.id, false);

    const startY = e.clientY;
    // Where the pointer grabbed, in bars. The clip follows the pointer's place on the timeline,
    // not on the screen, so it keeps up when the view scrolls under it (at the edges, or the wheel).
    const grabBar = barFromClientX(e.clientX, originRef.current);
    const origStart = clip.startBar;
    const origEnd = clip.startBar + clip.lengthBars;
    const altDuplicate = mode === 'move' && e.altKey;
    let last = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
    let moved = false; // past the few pixels that tell a drag from a click
    let followTime = false; // moved 3px sideways: from then on the clip moves in time too
    // The change last made, as a key: the same again is skipped (the pointer and a scroll can both
    // ask for it). It starts as "no change", so nothing happens until something does.
    let applied = mode === 'move' ? '0|0' : String(mode === 'trim-start' ? origStart : origEnd);

    // Moves take every selected clip along (just this one if it isn't selected), as a block
    const tracks = store.tracks;
    const rowOf = new Map(tracks.map((t, i) => [t.id, i]));
    const lane = e.currentTarget.closest<HTMLElement>('[data-lane]');
    const scroller = scrollParent(e.currentTarget);
    const dragged = mode === 'move' ? useTimelineStore.getState().clips.filter((c) => c.isSelected || c.id === clip.id) : [clip];
    const origStarts = new Map(dragged.map((c) => [c.id, c.startBar]));
    const origRows = new Map(dragged.map((c) => [c.id, rowOf.get(c.trackId) ?? -1]));
    const blockStart = Math.min(...dragged.map((c) => c.startBar));
    const blockEnd = Math.max(...dragged.map((c) => c.startBar + c.lengthBars));
    // Row offsets at which every dragged clip lands on a track whose instrument can play it
    // (0, staying put, always qualifies). Other offsets keep the clips on their own tracks.
    const rowOffsets = new Set([0]);
    for (let d = 1 - tracks.length; mode === 'move' && d < tracks.length; d++) {
      const fits = dragged.every((c) => {
        const row = origRows.get(c.id)!;
        const target = tracks[row + d];
        return row >= 0 && target !== undefined && canMoveClipBetween(tracks[row].instrumentKey, target.instrumentKey);
      });
      if (fits) rowOffsets.add(d);
    }
    const grabbedRow = rowOf.get(clip.trackId) ?? 0;

    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';

    let committed = false;
    /**
     * Make a change unless it's the one already made. The undo step comes with the first change,
     * not when the pointer starts moving, so a click that wobbles a little leaves the history (and
     * the redo steps) alone.
     */
    const apply = (key: string, change: () => void) => {
      if (key === applied) return;
      applied = key;
      if (!committed) {
        committed = true;
        const s = useTimelineStore.getState();
        s.checkpoint(); // one undo step per drag gesture
        // Alt+drag: leave copies behind at the original positions, drag the originals
        if (altDuplicate) dragged.forEach((c) => s.duplicateClip(c.id));
      }
      change();
    };

    /** Put the clip(s) where the pointer (`last`) says. */
    const update = () => {
      const s = useTimelineStore.getState();
      const pointerBar = barFromClientX(last.clientX, originRef.current);
      const dx = (pointerBar - grabBar) * s.zoom;
      if (Math.abs(dx) >= 3) followTime = true;
      if (!moved) {
        // Trims only follow the pointer sideways; a move also follows it up and down
        if ((mode === 'move' ? Math.hypot(dx, last.clientY - startY) : Math.abs(dx)) < 3) return;
        moved = true;
        // Light up the lanes the grabbed clip can be dropped on
        if (mode === 'move') s.setClipDragTargets(new Set([...rowOffsets].map((d) => tracks[grabbedRow + d].id)));
      }
      const deltaBars = pointerBar - grabBar;
      const shift = last.shiftKey;

      if (mode === 'move') {
        // Time stays put until the pointer has gone sideways, so a clip that only changes track
        // keeps its place even off the grid. (A trim has always gone sideways by now.)
        const snappedDelta = followTime ? snapped(origStart + deltaBars, shift) - origStart : 0;
        // Clamp the block as a whole, so clips pushed against either end keep their spacing
        const delta = Math.max(1 - blockStart, Math.min(TOTAL_BARS + 1 - blockEnd, snappedDelta));
        // Row under the pointer (held to the first and last track), counted from the lane the drag
        // started in. Rows are all TRACK_HEIGHT tall.
        const laneTop = lane?.getBoundingClientRect().top;
        const pointerRows =
          laneTop === undefined
            ? 0
            : Math.max(-grabbedRow, Math.min(tracks.length - 1 - grabbedRow, Math.floor((last.clientY - laneTop) / TRACK_HEIGHT)));
        const rowDelta = rowOffsets.has(pointerRows) ? pointerRows : 0;
        apply(`${delta}|${rowDelta}`, () =>
          s.moveClips(
            dragged.map((c) => ({
              clipId: c.id,
              startBar: origStarts.get(c.id)! + delta,
              trackId: tracks[origRows.get(c.id)! + rowDelta]?.id,
            }))
          )
        );
      } else if (mode === 'trim-start') {
        const minLen = minClipLength(s.snapGrid, s);
        const start = Math.min(snapped(origStart + deltaBars, shift), origEnd - minLen);
        apply(String(start), () => s.trimClipStart(clip.id, start));
      } else {
        const minLen = minClipLength(s.snapGrid, s);
        const end = Math.max(snapped(origEnd + deltaBars, shift), origStart + minLen);
        apply(String(end), () => s.trimClipEnd(clip.id, end - origStart));
      }
    };

    // Near an edge of the lanes, scroll the timeline towards the pointer while it stays there.
    // Moves scroll both ways, trims only sideways. The edges are those of the part on screen, so
    // it also works when the page has scrolled part of the timeline out of the window.
    let frame = 0;
    const autoScroll = () => {
      frame = 0;
      if (!scroller || !moved) return;
      const r = scroller.getBoundingClientRect();
      const { scrollLeft, scrollTop } = scroller;
      scroller.scrollLeft += edgeStep(last.clientX, Math.max(0, r.left + HEADER_WIDTH), Math.min(window.innerWidth, r.right));
      if (mode === 'move') scroller.scrollTop += edgeStep(last.clientY, Math.max(0, r.top + RULER_HEIGHT), Math.min(window.innerHeight, r.bottom));
      if (scroller.scrollLeft === scrollLeft && scroller.scrollTop === scrollTop) return; // out of the zone, or at the end
      update();
      frame = requestAnimationFrame(autoScroll);
    };

    const onMove = (ev: PointerEvent) => {
      last = { clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey };
      update();
      if (!frame) frame = requestAnimationFrame(autoScroll);
    };
    // Scrolled some other way mid-drag (the mouse wheel): keep the clip under the pointer
    const onScroll = () => {
      if (moved) update();
    };

    // A cancelled pointer (the browser took a touch over) ends the drag too, so the edge
    // scrolling can't run on by itself
    const onUp = () => {
      document.body.style.cursor = '';
      cancelAnimationFrame(frame);
      if (moved && mode === 'move') useTimelineStore.getState().setClipDragTargets(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      scroller?.removeEventListener('scroll', onScroll);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    scroller?.addEventListener('scroll', onScroll);
  };

  const handleHover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activeTool !== 'razor') return;
    setRazorX((razorBarAt(e.clientX, e.shiftKey) - clip.startBar) * zoom);
  };

  const isRazor = activeTool === 'razor';

  return (
    <div
      className={`absolute rounded-md overflow-hidden select-none border ${
        clip.isSelected ? 'ring-2 ring-white/90 border-white/80 z-10' : 'border-black/40'
      } ${isEditing ? 'outline outline-2 outline-dashed outline-cyan-300 outline-offset-2' : ''} ${isRazor ? 'cursor-crosshair' : 'cursor-grab'}`}
      style={{
        left,
        width,
        top: CLIP_INSET,
        height: CLIP_HEIGHT,
        // Skip layout and paint of clips scrolled out of view (long songs have thousands of note marks)
        contentVisibility: 'auto',
        backgroundColor: `${track.color}2e`,
        borderColor: clip.isSelected ? undefined : `${track.color}99`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handleHover}
      onPointerLeave={() => setRazorX(null)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (useTimelineStore.getState().activeTool === 'select') useTimelineStore.getState().openEditor(clip.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!clip.isSelected) useTimelineStore.getState().selectClip(clip.id, false);
        onOpenMenu({ x: e.clientX, y: e.clientY, bar: razorBarAt(e.clientX, e.shiftKey), trackId: clip.trackId, clipId: clip.id });
      }}
      title={`${clip.name} — bar ${clip.startBar.toFixed(2)}, ${formatBarCount(clip.lengthBars)} bars • double-click to edit notes`}
    >
      {/* Label strip */}
      <div
        className="absolute inset-x-0 top-0 px-1.5 flex items-center text-[10px] font-semibold text-black/90 truncate"
        style={{ height: LABEL_HEIGHT, backgroundColor: track.color }}
      >
        <span className="truncate">{clip.name}</span>
        {INSTRUMENTS[track.instrumentKey].wobble && (
          <span className="ml-auto pl-1 shrink-0 font-mono text-[9px] font-bold text-black/70" title="Wobble rate (set in the piano roll)">
            {clip.wobble ?? DEFAULT_WOBBLE}
          </span>
        )}
      </div>

      {/* Notes */}
      {shades.length > 0 && (
        <svg className="absolute left-0 top-0 w-full h-full pointer-events-none" shapeRendering="crispEdges" aria-hidden="true">
          {shades.map(({ opacity, d }) => (
            <path key={opacity} d={d} fill={track.color} fillOpacity={opacity} />
          ))}
        </svg>
      )}

      {/* Trim handles */}
      {!isRazor && width > TRIM_HANDLE_PX * 3 && (
        <>
          <div
            className="absolute left-0 top-0 bottom-0 cursor-ew-resize hover:bg-white/25"
            style={{ width: TRIM_HANDLE_PX }}
          />
          <div
            className="absolute right-0 top-0 bottom-0 cursor-ew-resize hover:bg-white/25"
            style={{ width: TRIM_HANDLE_PX }}
          />
        </>
      )}

      {/* Razor preview line */}
      {isRazor && razorX !== null && razorX > 0 && razorX < width && (
        <div
          className="absolute top-0 bottom-0 w-px bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.9)] pointer-events-none"
          style={{ left: razorX }}
        />
      )}
    </div>
  );
});
