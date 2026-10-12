import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VideoLane } from '../video/VideoLane';
import { connectAutosave, connectTimelineToAudio, MAX_ZOOM, MIN_ZOOM, TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import { RestoreSessionBanner } from './ProjectBar';
import { TimelineScrollbar } from './TimelineScrollbar';
import { PianoRoll } from './PianoRoll';
import { TimelineToolbar } from './TimelineToolbar';
import { TimeRuler } from './TimeRuler';
import { TrackHeader } from './TrackHeader';
import { TrackLane } from './TrackLane';
import { barFromClientX, Playhead, useScrub } from './Playhead';
import { ClipContextMenu } from './ClipContextMenu';
import { TakesDialog } from './TakesDialog';
import type { ContextMenuState } from './ClipContextMenu';
import { ChopToSlicerDialog } from './ChopToSlicerDialog';
import { VariationsDialog } from './VariationsDialog';
import { TuneDialog } from './TuneDialog';
import { NewAudioTrackDrop } from './NewAudioTrackDrop';
import { RulerContextMenu } from './RulerContextMenu';
import type { RulerMenuState } from './RulerContextMenu';
import { MarkerLines } from './Markers';
import { RecordingMarker } from './RecordControls';
import { Toast } from './Toast';
import { showToast } from './toastStore';
import { TrackInspector } from '../inspector/TrackInspector';
import { AddTrackMenu } from './AddTrackMenu';
import { useUiStore } from '../../store/uiStore';
import { useVideoStore } from '../../store/videoStore';
import { laneTops } from './rows';
import { trackRows } from '../../store/folders';
import { FolderRow } from './FolderRow';
import { TrackMenu, type TrackMenuState } from './TrackMenu';
import { HEADER_WIDTH, RULER_HEIGHT, TRACK_HEIGHT } from './layout';
import type { RulerUnits } from '../../store/timelineTypes';
import { frameRateLabel } from '../../store/timelineTypes';
import { blurMenusAfterChange, shouldIgnoreShortcut } from '../keyboard';
import { recoverFailedDownloads } from '../../audio/liveTracks';
import { installLiveInput } from '../../audio/liveInput';

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Ids of clips whose on-screen box intersects the marquee (content-relative px). */
function clipsInMarquee(m: Marquee): Set<string> {
  const { clips, tracks, zoom, automationView } = useTimelineStore.getState();
  const left = Math.min(m.x0, m.x1);
  const right = Math.max(m.x0, m.x1);
  const top = Math.min(m.y0, m.y1);
  const bottom = Math.max(m.y0, m.y1);
  const { tops } = laneTops(tracks, !!useVideoStore.getState().video);
  const hits = new Set<string>();
  for (const c of clips) {
    const rowTop = tops.get(c.trackId);
    // Clips under an open automation view are dimmed and can't be edited there (nor folded-away ones)
    if (rowTop === undefined || automationView[c.trackId]?.open) continue;
    const cx0 = HEADER_WIDTH + (c.startBar - 1) * zoom;
    const cx1 = cx0 + c.lengthBars * zoom;
    const cy0 = rowTop;
    const cy1 = cy0 + TRACK_HEIGHT;
    if (cx1 > left && cx0 < right && cy1 > top && cy0 < bottom) hits.add(c.id);
  }
  return hits;
}

/** Bars / Timecode switch for the time ruler. */
const RulerUnitsToggle: React.FC = () => {
  const units = useTimelineStore((s) => s.rulerUnits);
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const options: Array<{ value: RulerUnits; label: string; title: string }> = [
    { value: 'bars', label: 'Bars', title: 'Ruler counts bars and beats' },
    { value: 'timecode', label: 'Time', title: `Ruler counts minutes, seconds and frames (${frameRateLabel(fps, dropFrame)})` },
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
  const [rulerMenu, setRulerMenu] = useState<RulerMenuState | null>(null);
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null);
  const closeTrackMenu = useCallback(() => setTrackMenu(null), []);
  const closeRulerMenu = useCallback(() => setRulerMenu(null), []);
  /** The audio clip "Chop to Slicer…" was chosen for, while its dialog is open. */
  const [chopClipId, setChopClipId] = useState<string | null>(null);
  const variationsClipId = useUiStore((s) => s.variationsClipId);
  const setVariationsClipId = useUiStore.getState().setVariationsClip;
  const tuneClipId = useUiStore((s) => s.tuneClipId);
  const takesClipId = useUiStore((s) => s.takesClipId);
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

  // Tell the store which stretch of the lanes is on screen (the ruler draws only that; zoom anchors in it)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => useTimelineStore.getState().setView(el.scrollLeft, Math.max(1, el.clientWidth - HEADER_WIDTH));
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  // After a zoom has re-laid out the lanes, scroll to where setZoom says its anchor stays put
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = useTimelineStore.getState().viewLeft;
  }, [zoom]);

  // Ctrl/Cmd+wheel (and trackpad pinch) over the lanes or ruler zooms around the pointer. Native
  // listener: React's wheel handlers are passive, and the browser would zoom the whole page instead.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The zoom being aimed for, unrounded, so small pinch steps add up instead of rounding away
    let target = 0;
    const onWheel = (e: WheelEvent) => {
      const over = e.target as Element;
      if (!(e.ctrlKey || e.metaKey) || !(over.closest('[data-lane]') || rulerRef.current?.contains(over))) return;
      e.preventDefault();
      const s = useTimelineStore.getState();
      if (Math.abs(target - s.zoom) > 0.5) target = s.zoom;
      // Lines and pages (Firefox) to pixels; about 20% per mouse-wheel notch
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      target = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target * Math.exp(-dy * 0.002)));
      s.setZoom(target, barFromClientX(e.clientX, rulerRef.current));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Bind store <-> Tone.Transport for the lifetime of the timeline
  useEffect(() => connectTimelineToAudio(), []);
  useEffect(() => connectAutosave(), []);
  // Menus hand focus back once used, so the shortcuts below keep working
  useEffect(() => blurMenusAfterChange(), []);
  // Recorded instruments that failed to download play once a retry succeeds (and retry when the connection returns)
  useEffect(() => recoverFailedDownloads(), []);
  // MIDI and computer-keyboard playing, the metronome
  useEffect(() => installLiveInput(), []);

  // Keep the playhead in view while playing (page-turn style), and scroll where the store asks
  // (a jump to a marker off screen, a project opened)
  useEffect(
    () =>
      useTimelineStore.subscribe((state, prev) => {
        const el = scrollRef.current;
        if (!el) return;
        if (state.viewJumps !== prev.viewJumps) {
          el.scrollLeft = state.viewLeft;
          return;
        }
        if (!state.isPlaying || state.playheadPosition === prev.playheadPosition) return;
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
      if (shouldIgnoreShortcut(e)) return;
      const s = useTimelineStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.code === 'Space') {
        e.preventDefault();
        // A focused button would also "click" on Space and double-toggle
        if (e.target instanceof HTMLButtonElement) e.target.blur();
        // Holding Space would otherwise start and stop playback over and over
        if (!e.repeat) void s.togglePlay();
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
        // No menu to explain a refusal in, so say it in a toast
        const message = s.duplicateSelection();
        if (message) showToast(message);
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
      } else if (key === 'l' && e.shiftKey) {
        // Video-editor style shuttle: Shift+L a bar forward (L is the loop), J back, K play / pause
        e.preventDefault();
        s.seek(Math.floor(s.playheadPosition + 1e-6) + 1, true);
      } else if (key === 'l') {
        s.toggleLoop();
      } else if (key === 'j') {
        e.preventDefault();
        const bar = Math.ceil(s.playheadPosition - 1e-6) - 1;
        s.seek(Math.max(1, e.shiftKey ? bar - 3 : bar), true);
      } else if (key === 'k') {
        e.preventDefault();
        if (!e.repeat) void s.togglePlay();
      } else if (key === 'm') {
        // Holding M would only repeat "already a marker here" (or, while playing, drop a row of them)
        if (e.repeat) return;
        // Shift+M: a hit point, locked to time, for the tempo finder (FIT › Hit points)
        const message = e.shiftKey ? s.addHit() : s.addMarker();
        if (message) showToast(message);
      } else if (e.key === ',' || e.key === '.') {
        // Held down while playing, it would restart the music at every marker on the way
        if (e.repeat && s.isPlaying) return;
        s.jumpToMarker(e.key === ',' ? -1 : 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        s.seek(s.loopRegion.inBar, true);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        // Selected automation points first (selecting them is the last thing the user did)
        if (!s.deleteSelectedAutomationPoints()) s.deleteSelectedClips();
      } else if (e.key === 'Escape') {
        s.clearSelection();
        s.selectAutomationPoints(null);
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
    <div className="bg-forge-panel border border-forge-border rounded-xl shadow-lg overflow-hidden flex flex-col" aria-label="Arrangement Timeline">
      <RestoreSessionBanner />
      <TimelineToolbar />

      <div className="flex flex-row relative min-h-[300px] overflow-hidden">
        <div
          ref={scrollRef}
          data-timeline-scroll=""
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
            onPointerDownCapture={(e) => {
              // Selected automation points stay selected only while the user works in their lane (or its menu)
              const s = useTimelineStore.getState();
              if (s.automationSelection && !(e.target as Element).closest('[data-automation-lane], [data-automation-menu]')) s.selectAutomationPoints(null);
            }}
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
              <TimeRuler originRef={rulerRef} onScrubStart={onScrubStart} onOpenMenu={setRulerMenu} />
            </div>

            <VideoLane />

            {/* Tracks, under their folders' rows */}
            {trackRows(tracks).map((row) =>
              row.kind === 'folder' ? (
                <FolderRow key={`folder-${row.folder.id}`} folder={row.folder} members={row.members} />
              ) : (
                <div key={row.track.id} className="flex">
                  <TrackHeader track={row.track} onOpenMenu={setMenu} onTrackMenu={setTrackMenu} />
                  <TrackLane track={row.track} originRef={rulerRef} onOpenMenu={setMenu} />
                </div>
              )
            )}

            {/* Add Track Row */}
            <div className="flex border-b border-forge-border bg-black/20" style={{ height: 38 }}>
              <div
                className="sticky left-0 z-20 shrink-0 bg-forge-panel border-r border-forge-border flex items-center px-2 relative"
                style={{ width: HEADER_WIDTH }}
              >
                <AddTrackMenu />
              </div>
              <NewAudioTrackDrop originRef={rulerRef} />
            </div>

            <MarkerLines />
            <RecordingMarker />
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
        + or double-click a lane to add a clip • double-click a clip to edit notes • drag pads (Instruments tab below), or sound files, onto a track •
        Drag box / Shift-click multi-select • Ctrl+Z undo • Ctrl+C/X/V • Ctrl+D duplicate • C razor • Del delete • M marker • , and . previous / next marker • curve button: automation • ? guide
      </div>

      {menu && <ClipContextMenu menu={menu} onClose={closeMenu} onChop={setChopClipId} onVariations={setVariationsClipId} />}
      {rulerMenu && <RulerContextMenu menu={rulerMenu} onClose={closeRulerMenu} />}
      {trackMenu && <TrackMenu menu={trackMenu} onClose={closeTrackMenu} />}
      {chopClipId && <ChopToSlicerDialog clipId={chopClipId} onClose={() => setChopClipId(null)} />}
      {variationsClipId && <VariationsDialog clipId={variationsClipId} onClose={() => setVariationsClipId(null)} />}
      {tuneClipId && <TuneDialog clipId={tuneClipId} onClose={() => useUiStore.getState().setTuneClip(null)} />}
      {takesClipId && <TakesDialog clipId={takesClipId} onClose={() => useUiStore.getState().setTakesClip(null)} />}
      <Toast />
    </div>
  );
};
