import React, { useMemo, useState } from 'react';
import * as Tone from 'tone';
import { useTimelineStore } from '../../store/timelineStore';
import type { Clip, InstrumentKey, Track } from '../../store/timelineTypes';
import { durationToBars, minClipLength, snapBar } from '../../store/timelineTypes';
import { DRUM_NOTES } from '../../audio/scheduler';
import { isDrumKind } from '../../audio/instrumentCatalog';
import { barFromClientX } from './Playhead';
import type { ContextMenuState } from './ClipContextMenu';
import { TRACK_HEIGHT, TRIM_HANDLE_PX } from './layout';

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

interface NoteRect {
  id: string;
  left: number;
  width: number;
  top: number;
  height: number;
  opacity: number;
}

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
    id: n.id,
    left: n.startOffset * zoom,
    width: Math.max(2, Math.min(durationToBars(n.duration), clip.lengthBars - n.startOffset) * zoom - 1),
    top: areaTop + rowOf(n.note) * rowHeight,
    height: Math.max(2, rowHeight - 1),
    opacity: 0.45 + n.velocity * 0.55,
  }));
}

type DragMode = 'move' | 'trim-start' | 'trim-end';

interface ClipViewProps {
  clip: Clip;
  track: Track;
  originRef: React.RefObject<HTMLElement | null>;
  onOpenMenu: (menu: ContextMenuState) => void;
}

/**
 * A single clip block on a track lane.
 * Select tool: click to select (Shift/Ctrl adds), drag to move (all selected clips move together),
 * Alt+drag to duplicate, drag either edge to trim. Razor tool: click to split.
 * Edits snap to the active grid; hold Shift while dragging to bypass snap.
 */
export const ClipView: React.FC<ClipViewProps> = ({ clip, track, originRef, onOpenMenu }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const activeTool = useTimelineStore((s) => s.activeTool);
  const isEditing = useTimelineStore((s) => s.editingClipId === clip.id);
  const [razorX, setRazorX] = useState<number | null>(null);

  const notes = useMemo(() => layoutNotes(clip, track.instrumentKey, zoom), [clip, track.instrumentKey, zoom]);

  const left = (clip.startBar - 1) * zoom;
  const width = clip.lengthBars * zoom;

  const snapped = (bar: number, shift: boolean) => (shift ? bar : snapBar(bar, useTimelineStore.getState().snapGrid));

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

    const startX = e.clientX;
    const origStart = clip.startBar;
    const origEnd = clip.startBar + clip.lengthBars;
    let dragIds: string[] = [clip.id];
    let origStarts = new Map<string, number>();
    const altDuplicate = mode === 'move' && e.altKey;
    let duplicated = false;
    let moved = false;

    if (mode === 'move') {
      const selected = useTimelineStore.getState().clips.filter((c) => c.isSelected);
      dragIds = selected.some((c) => c.id === clip.id) ? selected.map((c) => c.id) : [clip.id];
      origStarts = new Map(selected.map((c) => [c.id, c.startBar]));
      origStarts.set(clip.id, origStart);
    }

    document.body.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';

    const onMove = (ev: PointerEvent) => {
      const s = useTimelineStore.getState();
      const deltaBars = (ev.clientX - startX) / s.zoom;
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      if (!moved) s.checkpoint(); // one undo step per drag gesture
      moved = true;

      if (mode === 'move') {
        // Alt+drag: leave copies behind at the original positions, drag the originals
        if (altDuplicate && !duplicated) {
          duplicated = true;
          dragIds.forEach((id) => s.duplicateClip(id));
        }
        const delta = snapped(origStart + deltaBars, ev.shiftKey) - origStart;
        dragIds.forEach((id) => s.moveClip(id, (origStarts.get(id) ?? origStart) + delta));
      } else if (mode === 'trim-start') {
        const minLen = minClipLength(s.snapGrid);
        s.trimClipStart(clip.id, Math.min(snapped(origStart + deltaBars, ev.shiftKey), origEnd - minLen));
      } else {
        const minLen = minClipLength(s.snapGrid);
        const end = Math.max(snapped(origEnd + deltaBars, ev.shiftKey), origStart + minLen);
        s.trimClipEnd(clip.id, end - origStart);
      }
    };

    const onUp = () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
      title={`${clip.name} — bar ${clip.startBar.toFixed(2)}, ${clip.lengthBars} bars • double-click to edit notes`}
    >
      {/* Label strip */}
      <div
        className="absolute inset-x-0 top-0 px-1.5 flex items-center text-[10px] font-semibold text-black/90 truncate"
        style={{ height: LABEL_HEIGHT, backgroundColor: track.color }}
      >
        <span className="truncate">{clip.name}</span>
      </div>

      {/* Notes */}
      {notes.map((n) => (
        <div
          key={n.id}
          className="absolute rounded-[1px] pointer-events-none"
          style={{
            left: n.left,
            width: n.width,
            top: n.top,
            height: n.height,
            backgroundColor: track.color,
            opacity: n.opacity,
          }}
        />
      ))}

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
};
