import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lock, LockOpen, Pencil, Trash2 } from 'lucide-react';
import { TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import type { Marker } from '../../store/timelineTypes';
import { snapBar } from '../../store/timelineTypes';
import { MARKER_NAME_MAX } from '../../store/markers';
import { formatBarsBeats, formatSmpte } from '../../audio/transport';
import { barFromClientX } from './Playhead';
import { MenuItem } from './ClipContextMenu';
import { menuClass, useKeepOnScreen, useMenuDismiss } from './menuHooks';
import { HEADER_WIDTH, RULER_HEIGHT, TRACK_HEIGHT } from './layout';

/** Where a flag hangs in the ruler: under the bar numbers, over the beat ticks. */
const FLAG_TOP = 19;
const FLAG_HEIGHT = 13;
/** Widest a flag gets (a long name is cut short; its tooltip has all of it). */
const FLAG_MAX_WIDTH = 144;
/** Narrowest: a flag squeezed by its neighbour still shows a letter or two. */
const FLAG_MIN_WIDTH = 14;
/** A flag this close to the end of the timeline opens to the left of its line, so it stays on the ruler. */
const FLAG_ROOM = FLAG_MAX_WIDTH + 6;

/** The x of a marker's line, on a whole pixel so it's sharp. */
const markerX = (marker: Marker, zoom: number) => Math.round((marker.bar - 1) * zoom);

/**
 * The markers' flags in the time ruler. Click one to move the playhead there, drag it to move
 * the marker (snapped unless Shift is held), double-click to rename it, right-click for more.
 * Memoized, so the ruler redrawing as the view scrolls doesn't redraw them.
 */
export const MarkerFlags = React.memo(function MarkerFlags({ originRef }: { originRef: React.RefObject<HTMLElement | null> }) {
  const markers = useTimelineStore((s) => s.markers);
  const zoom = useTimelineStore((s) => s.zoom);
  const bpm = useTimelineStore((s) => s.bpm);
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const [editing, setEditing] = useState<string | null>(null);
  const stopEditing = useCallback(() => setEditing(null), []);
  const [menu, setMenu] = useState<MarkerMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const totalWidth = TOTAL_BARS * zoom;

  const startDrag = (e: React.PointerEvent, marker: Marker) => {
    if (e.button !== 0) return;
    // Not a scrub of the ruler underneath
    e.preventDefault();
    e.stopPropagation();
    const origin = originRef.current;
    // Where on the flag it was grabbed, so the marker doesn't jump to the pointer
    const grab = barFromClientX(e.clientX, origin) - marker.bar;
    const startX = e.clientX;
    let moved = false;
    let committed = false;
    let applied = marker.bar;

    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      if (!moved) {
        moved = true;
        document.body.style.cursor = 'grabbing';
      }
      const s = useTimelineStore.getState();
      const raw = barFromClientX(ev.clientX, origin) - grab;
      const bar = Math.max(1, Math.min(TOTAL_BARS + 1, ev.shiftKey ? raw : snapBar(raw, s.snapGrid, s)));
      if (bar === applied) return;
      applied = bar;
      // The undo step comes with the first change, so a click that wobbles leaves the history alone
      if (!committed) {
        committed = true;
        s.checkpoint();
      }
      s.moveMarker(marker.id, bar);
    };
    const end = (click: boolean) => () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (!click || moved) return;
      const s = useTimelineStore.getState();
      const now = s.markers.find((m) => m.id === marker.id);
      if (now) s.seek(now.bar);
    };
    const onUp = end(true);
    // The browser took a touch over (to scroll): no click
    const onCancel = end(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  return (
    <>
      {markers.map((m, i) => {
        const x = markerX(m, zoom);
        // A marker held to its time can be past the end after a tempo rise (the list still shows it)
        if (x > totalWidth) return null;
        const leftward = x > totalWidth - FLAG_ROOM;
        const side = leftward ? 'right-0' : 'left-0';
        // A flag stops short of the next one (the one before, if it opens leftwards) rather than cover its name
        const neighbour = leftward ? markers[i - 1] : markers[i + 1];
        const room = neighbour ? Math.abs(markerX(neighbour, zoom) - x) - 1 : Infinity;
        const maxWidth = Math.max(FLAG_MIN_WIDTH, Math.min(FLAG_MAX_WIDTH, room));
        const renaming = editing === m.id;
        return (
          <div
            key={m.id}
            data-marker={m.id}
            // Over the in/out brackets and the playhead's handle, so a flag the playhead sits on (just
            // added, or jumped to) still takes every click; under the ruler's corner box when scrolled.
            // The one under the pointer comes to the front, so a flag squeezed by the next is easy to get at
            className={`absolute ${renaming ? 'z-[23]' : 'z-[21] hover:z-[22]'}`}
            style={{ left: x, top: FLAG_TOP, height: RULER_HEIGHT - FLAG_TOP }}
          >
            <div className="absolute left-0 top-0 bottom-0 w-px bg-violet-300 pointer-events-none" />
            {renaming ? (
              <FlagNameInput marker={m} className={side} onDone={stopEditing} />
            ) : (
              <div
                className={`absolute top-0 ${side} ${leftward ? 'rounded-l-sm pr-1 pl-1.5' : 'rounded-r-sm pl-1 pr-1.5'} flex items-center gap-0.5 bg-violet-500/90 hover:bg-violet-400 text-[9px] font-semibold leading-none text-white whitespace-nowrap shadow-md cursor-pointer touch-none`}
                style={{ height: FLAG_HEIGHT, maxWidth }}
                onPointerDown={(e) => startDrag(e, m)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditing(m.id);
                }}
                onContextMenu={(e) => {
                  // The marker's own menu, not the ruler's
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ x: e.clientX, y: e.clientY, id: m.id });
                }}
                title={`${m.name} · ${formatBarsBeats(m.bar)} · ${formatSmpte(m.bar, bpm, fps, dropFrame)}${
                  m.anchor === 'time' ? ' · locked to time' : ''
                }\nClick: move the playhead here. Drag: move it (Shift: no snap). Double-click: rename. Right-click: more.`}
              >
                {m.anchor === 'time' && <Lock className="w-2 h-2 shrink-0" aria-label="Locked to time" />}
                <span className="truncate">{m.name}</span>
              </div>
            )}
          </div>
        );
      })}
      {/* In the page, not the ruler, so no box around the ruler can clip it or stack over it */}
      {menu && createPortal(<MarkerMenu menu={menu} onClose={closeMenu} onRename={setEditing} />, document.body)}
    </>
  );
});

/** Renaming a marker on its flag: Enter (or clicking away) keeps the name, Esc drops it. */
const FlagNameInput: React.FC<{ marker: Marker; className: string; onDone: () => void }> = ({ marker, className, onDone }) => {
  const [text, setText] = useState(marker.name);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const finish = useCallback(
    (keep: boolean) => {
      if (finished.current) return;
      finished.current = true;
      if (keep && ref.current) useTimelineStore.getState().renameMarker(marker.id, ref.current.value, true);
      onDone();
    },
    [marker.id, onDone]
  );
  // Focus without scrolling the lanes to it
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  // A press anywhere else keeps the name. Blur alone misses some: the ruler, clips and flags take
  // the press without moving focus (they prevent its default to start their drags)
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (e.target !== ref.current) finish(true);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [finish]);
  return (
    <input
      ref={ref}
      value={text}
      maxLength={MARKER_NAME_MAX}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      // Clicks in the field place the caret, not scrub the ruler; right-click gets the browser's text menu
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      aria-label="Marker name"
      className={`absolute -top-px ${className} w-32 h-[15px] px-1 rounded-sm bg-black/90 border border-violet-300 text-[10px] text-white focus:outline-none`}
    />
  );
};

interface MarkerMenuState {
  x: number;
  y: number;
  id: string;
}

/** Right-click menu for a marker's flag: Rename, Lock to time / Lock to bar, Delete. */
const MarkerMenu: React.FC<{ menu: MarkerMenuState; onClose: () => void; onRename: (id: string) => void }> = ({ menu, onClose, onRename }) => {
  const ref = useRef<HTMLDivElement>(null);
  useMenuDismiss(ref, onClose);
  useKeepOnScreen(ref, menu.x, menu.y);
  const marker = useTimelineStore((s) => s.markers.find((m) => m.id === menu.id));
  const timecode = useTimelineStore((s) => (marker ? formatSmpte(marker.bar, s.bpm, s.fps, s.dropFrame) : ''));
  // Gone meanwhile (undone): nothing left to act on
  useEffect(() => {
    if (!marker) onClose();
  }, [marker, onClose]);
  if (!marker) return null;

  const s = useTimelineStore.getState();
  const locked = marker.anchor === 'time';
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  return (
    <div ref={ref} role="menu" aria-label={`Marker ${marker.name}`} className={menuClass} onContextMenu={(e) => e.preventDefault()}>
      <div className="px-3 pt-1 pb-1.5 text-[10px] text-forge-muted">
        <div className="truncate text-forge-text">{marker.name}</div>
        <div className="tabular-nums">
          {formatBarsBeats(marker.bar)} · {timecode}
        </div>
        <div>{locked ? 'Keeps its time when the tempo changes' : 'Stays on its bar when the tempo changes'}</div>
      </div>
      <MenuItem label="Rename" shortcut="dbl-click" icon={<Pencil className="w-3.5 h-3.5" />} onClick={run(() => onRename(marker.id))} />
      <MenuItem
        label={locked ? 'Lock to bar' : 'Lock to time'}
        icon={locked ? <LockOpen className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
        onClick={run(() => s.setMarkerAnchor(marker.id, locked ? 'bar' : 'time'))}
      />
      <MenuItem label="Delete" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={run(() => s.deleteMarker(marker.id))} divider />
    </div>
  );
};

/**
 * A thin line down through every lane at each marker: one overlay for all the lanes, under the
 * track headers and the ruler, and transparent to the pointer, so clips and automation underneath
 * are edited as usual.
 */
export const MarkerLines = React.memo(function MarkerLines() {
  const markers = useTimelineStore((s) => s.markers);
  const zoom = useTimelineStore((s) => s.zoom);
  const rows = useTimelineStore((s) => s.tracks.length);
  if (!markers.length || !rows) return null;
  return (
    <div
      aria-hidden="true"
      className="absolute z-[13] right-0 pointer-events-none"
      style={{ left: HEADER_WIDTH, top: RULER_HEIGHT, height: rows * TRACK_HEIGHT }}
    >
      {markers.map((m) =>
        m.bar <= TOTAL_BARS + 1 ? <div key={m.id} className="absolute top-0 bottom-0 w-px bg-violet-300/40" style={{ left: markerX(m, zoom) }} /> : null
      )}
    </div>
  );
});
