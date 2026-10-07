import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Film } from 'lucide-react';
import { connectAutosave, connectTimelineToAudio, TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import { ProjectBar, RestoreSessionBanner } from './ProjectBar';
import { TimelineScrollbar } from './TimelineScrollbar';
import { PianoRoll } from './PianoRoll';
import { TimelineToolbar } from './TimelineToolbar';
import { TimeRuler } from './TimeRuler';
import { TrackHeader } from './TrackHeader';
import { TrackLane } from './TrackLane';
import { Playhead, useScrub } from './Playhead';
import { ClipContextMenu } from './ClipContextMenu';
import type { ContextMenuState } from './ClipContextMenu';
import { TrackInspector } from '../inspector/TrackInspector';
import { AddTrackMenu } from './AddTrackMenu';
import { HEADER_WIDTH, RULER_HEIGHT, TRACK_HEIGHT } from './layout';
import type { RulerUnits } from '../../store/timelineTypes';


function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Duplicate every selected clip directly after itself and select the copies (Ctrl+D). */
function duplicateSelectionInPlace(): void {
  const { clips, duplicateClip, moveClip, clearSelection, selectClip, checkpoint } = useTimelineStore.getState();
  const selected = clips.filter((c) => c.isSelected);
  if (selected.length === 0) return;
  checkpoint();
  const copies = selected
    .map((c) => {
      const id = duplicateClip(c.id);
      if (id) moveClip(id, c.startBar + c.lengthBars);
      return id;
    })
    .filter((id): id is string => id !== null);
  clearSelection();
  copies.forEach((id) => selectClip(id, true));
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Ids of clips whose on-screen box intersects the marquee (content-relative px). */
function clipsInMarquee(m: Marquee): Set<string> {
  const { clips, tracks, zoom } = useTimelineStore.getState();
  const left = Math.min(m.x0, m.x1);
  const right = Math.max(m.x0, m.x1);
  const top = Math.min(m.y0, m.y1);
  const bottom = Math.max(m.y0, m.y1);
  const rowOf = new Map(tracks.map((t, i) => [t.id, i]));
  const hits = new Set<string>();
  for (const c of clips) {
    const row = rowOf.get(c.trackId);
    if (row === undefined) continue;
    const cx0 = HEADER_WIDTH + (c.startBar - 1) * zoom;
    const cx1 = cx0 + c.lengthBars * zoom;
    const cy0 = RULER_HEIGHT + row * TRACK_HEIGHT;
    const cy1 = cy0 + TRACK_HEIGHT;
    if (cx1 > left && cx0 < right && cy1 > top && cy0 < bottom) hits.add(c.id);
  }
  return hits;
}

/** Bars / Timecode switch for the time ruler. */
const RulerUnitsToggle: React.FC = () => {
  const units = useTimelineStore((s) => s.rulerUnits);
  const fps = useTimelineStore((s) => s.fps);
  const options: Array<{ value: RulerUnits; label: string; title: string }> = [
    { value: 'bars', label: 'Bars', title: 'Ruler counts bars and beats' },
    { value: 'timecode', label: 'Time', title: `Ruler counts minutes, seconds and frames (${fps} fps)` },
  ];
  return (
    <div className="flex rounded border border-forge-border overflow-hidden normal-case tracking-normal" role="group" aria-label="Ruler units">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={units === o.value}
          onClick={() => useTimelineStore.getState().setRulerUnits(o.value)}
          className={`px-1.5 py-0.5 text-[10px] font-mono ${
            units === o.value ? 'bg-cyan-500/20 text-cyan-200' : 'text-forge-muted hover:text-forge-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
};

/**
 * Premiere-style arrangement timeline: toolbar, ruler with loop brackets,
 * sticky track headers, clip lanes and a playhead spanning every lane.
 */
export const Timeline: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const zoom = useTimelineStore((s) => s.zoom);
  const activeTool = useTimelineStore((s) => s.activeTool);
  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onScrubStart = useScrub(rulerRef);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const contentRef = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);

  /**
   * Rubber-band selection: drag on empty lane space to select every clip the box touches.
   * Shift/Ctrl adds to the existing selection. A plain click on empty space clears it.
   */
  const handleLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !(e.target as HTMLElement).closest('[data-lane]')) return;
    const content = contentRef.current;
    if (!content) return;
    const store = useTimelineStore.getState();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (store.activeTool !== 'select') return;

    e.preventDefault();
    const base = additive ? new Set(store.clips.filter((c) => c.isSelected).map((c) => c.id)) : new Set<string>();
    const toLocal = (clientX: number, clientY: number) => {
      const r = content.getBoundingClientRect();
      return {
        x: Math.max(HEADER_WIDTH, Math.min(r.width, clientX - r.left)),
        y: Math.max(RULER_HEIGHT, Math.min(r.height, clientY - r.top)),
      };
    };
    const start = toLocal(e.clientX, e.clientY);
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      const p = toLocal(ev.clientX, ev.clientY);
      if (!dragging && Math.hypot(p.x - start.x, p.y - start.y) < 4) return;
      dragging = true;
      const m = { x0: start.x, y0: start.y, x1: p.x, y1: p.y };
      setMarquee(m);
      const hits = clipsInMarquee(m);
      base.forEach((id) => hits.add(id));
      useTimelineStore.getState().setSelection(hits);
    };
    const onUp = () => {
      if (!dragging && !additive) useTimelineStore.getState().clearSelection();
      setMarquee(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Bind store <-> Tone.Transport for the lifetime of the timeline
  useEffect(() => connectTimelineToAudio(), []);
  useEffect(() => connectAutosave(), []);

  // Keep the playhead in view while playing (page-turn style)
  useEffect(
    () =>
      useTimelineStore.subscribe((state, prev) => {
        const el = scrollRef.current;
        if (!el || !state.isPlaying || state.playheadPosition === prev.playheadPosition) return;
        const x = (state.playheadPosition - 1) * state.zoom;
        const viewWidth = el.clientWidth - HEADER_WIDTH;
        if (x < el.scrollLeft || x > el.scrollLeft + viewWidth - 24) {
          el.scrollLeft = Math.max(0, x - 24);
        }
      }),
    []
  );

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"]')) return;
      const s = useTimelineStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.code === 'Space') {
        e.preventDefault();
        // A focused button would also "click" on Space and double-toggle
        if (e.target instanceof HTMLButtonElement) e.target.blur();
        void s.togglePlay();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'z') {
        e.preventDefault();
        s.undo();
      } else if (mod && key === 'a') {
        e.preventDefault();
        s.selectAll();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelectionInPlace();
      } else if (mod && (key === 'c' || key === 'x')) {
        // Only hijack copy/cut when clips are selected, so page text copying still works
        if (!s.clips.some((c) => c.isSelected)) return;
        e.preventDefault();
        if (key === 'c') s.copySelectedClips();
        else s.cutSelectedClips();
      } else if (mod && key === 'v') {
        e.preventDefault();
        s.pasteClips();
      } else if (mod || e.altKey) {
        return;
      } else if (key === 'v') {
        s.setTool('select');
      } else if (key === 'c') {
        s.setTool('razor');
      } else if (key === 'i') {
        s.setLoopIn(s.playheadPosition);
      } else if (key === 'o') {
        s.setLoopOut(s.playheadPosition);
      } else if (key === 'l') {
        s.toggleLoop();
      } else if (e.key === 'Home') {
        e.preventDefault();
        s.seek(s.loopRegion.inBar);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelectedClips();
      } else if (e.key === 'Escape') {
        s.clearSelection();
      } else if (e.key === '=' || e.key === '+') {
        s.setZoom(s.zoom * 1.25);
      } else if (e.key === '-') {
        s.setZoom(s.zoom / 1.25);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="bg-forge-panel border border-forge-border rounded-xl shadow-lg overflow-hidden flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-forge-border">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-forge-accent-keys" />
          <h2 className="text-xs font-mono font-bold tracking-wider uppercase text-forge-text">Arrangement Timeline</h2>
        </div>
        <ProjectBar />
      </div>

      <RestoreSessionBanner />
      <TimelineToolbar />

      <div className="flex flex-row relative min-h-[300px] overflow-hidden">
        <div
          ref={scrollRef}
          className={`flex-1 overflow-x-hidden overflow-y-auto max-h-[520px] ${activeTool === 'razor' ? 'cursor-crosshair' : ''}`}
          onWheel={(e) => {
            // The native horizontal bar is replaced by TimelineScrollbar, so handle sideways scrolling here
            const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
            if (dx) e.currentTarget.scrollLeft += dx;
          }}
        >
          <div
            ref={contentRef}
            className="relative"
            style={{ width: HEADER_WIDTH + TOTAL_BARS * zoom }}
            onPointerDown={handleLanePointerDown}
          >
            {/* Ruler row */}
            <div className="sticky top-0 z-[25] flex" style={{ height: RULER_HEIGHT }}>
              <div
                className="sticky left-0 z-30 shrink-0 bg-forge-panel border-r border-b border-forge-border flex items-center justify-between px-3 text-[10px] font-mono uppercase tracking-widest text-forge-muted"
                style={{ width: HEADER_WIDTH }}
              >
                Tracks
                <RulerUnitsToggle />
              </div>
              <TimeRuler originRef={rulerRef} onScrubStart={onScrubStart} />
            </div>

            {/* Tracks */}
            {tracks.map((track) => (
              <div key={track.id} className="flex">
                <TrackHeader track={track} onOpenMenu={setMenu} />
                <TrackLane track={track} originRef={rulerRef} onOpenMenu={setMenu} />
              </div>
            ))}

            {/* Add Track Row */}
            <div className="flex border-b border-forge-border bg-black/20" style={{ height: 38 }}>
              <div
                className="sticky left-0 z-20 shrink-0 bg-forge-panel border-r border-forge-border flex items-center px-2 relative"
                style={{ width: HEADER_WIDTH }}
              >
                <AddTrackMenu />
              </div>
              <div className="flex-1 bg-black/10" />
            </div>

            <Playhead variant="line" onScrubStart={onScrubStart} />

            {marquee && (
              <div
                className="absolute z-[18] pointer-events-none border border-cyan-300/90 bg-cyan-400/15 rounded-sm"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            )}
          </div>
        </div>

        {/* DaVinci Fairlight Track Inspector & FX Rack */}
        <TrackInspector />
      </div>

      <TimelineScrollbar scrollRef={scrollRef} />
      <PianoRoll />

      <div className="px-4 py-1.5 border-t border-forge-border text-[11px] font-mono text-forge-muted hidden md:block">
        + or double-click a lane to add a clip • double-click a clip to edit notes • drag pads from the sound deck onto a track •
        Drag box / Shift-click multi-select • Ctrl+Z undo • Ctrl+C/X/V • Ctrl+D duplicate • C razor • Del delete • ? guide
      </div>

      {menu && <ClipContextMenu menu={menu} onClose={closeMenu} onDuplicate={duplicateSelectionInPlace} />}
    </div>
  );
};
