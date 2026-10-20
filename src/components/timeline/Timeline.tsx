/**
 * The arrangement timeline: toolbar, ruler, the video lane, folder rows, sticky track headers and
 * clip lanes, the playhead, marquee selection, zoom and scroll, keyboard shortcuts, and the
 * editors docked under it (piano roll, audio clip editor). The heart of the UI.
 */
import { startAutoFreeze } from '../../store/autoFreeze';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VideoLane } from '../video/VideoLane';
import { livePlayhead, onPlayhead } from '../../store/playheadClock';
import { connectAutosave, connectTimelineToAudio, MAX_ZOOM, MIN_ZOOM, TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import { RestoreSessionBanner } from './ProjectBar';
import { TimelineScrollbar } from './TimelineScrollbar';
import { TimelineResizer } from './TimelineResizer';
import { PianoRoll } from './PianoRoll';
import { TimelineToolbar } from './TimelineToolbar';
import { TimeRuler } from './TimeRuler';
import { TrackHeader } from './TrackHeader';
import { TrackLane } from './TrackLane';
import { barFromClientX, Playhead, useScrub } from './Playhead';
import { ClipContextMenu } from './ClipContextMenu';
import { TakesDialog } from './TakesDialog';
import { Modal } from './Modal';
import { PluginPermissionBar, PluginUrlDialog, PluginWindow } from './PluginDialogs';
import { PluginBrowser } from './PluginBrowser';
// Registers the built-in plugins' window
import './BuiltinPluginPanel';
import { onPluginError } from '../../audio/presets/wamPlugin';

import type { ContextMenuState } from './ClipContextMenu';
import { ChopSampleDialog } from './ChopSampleDialog';
import { VariationsDialog } from './VariationsDialog';
import { TuneDialog } from './TuneDialog';
import { SmartDialog } from './SmartDialog';
import { ArrangeDialog } from './ArrangeDialog';
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
import { useTourStore } from '../../tour/tourStore';
import { useVideoStore } from '../../store/videoStore';
import { laneTops } from './rows';
import { useSkipOffscreen } from '../offscreen';
import { trackRows } from '../../store/folders';
import { FolderRow } from './FolderRow';
import { TrackMenu, type TrackMenuState } from './TrackMenu';
import { HEADER_WIDTH, RULER_HEIGHT, TRACK_HEIGHT } from './layout';
import type { RulerUnits } from '../../store/timelineTypes';
import { frameRateLabel } from '../../store/timelineTypes';
import { blurMenusAfterChange, shouldIgnoreShortcut } from '../keyboard';
import { recoverFailedDownloads } from '../../audio/liveTracks';
import { installLiveInput } from '../../audio/liveInput';

// A plugin that fails to load says why
onPluginError((message) => showToast(message));
const closePluginWindow = () => useUiStore.getState().setPluginWindow(null);

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
/** A track's row (header and lane), skipped while it's scrolled out of sight (see offscreen.ts). */
const TrackRow: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const row = useRef<HTMLDivElement>(null);
  useSkipOffscreen(row);
  return (
    <div ref={row} className="flex">
      {children}
    </div>
  );
};

/**
 * A song with nothing in it yet (a first visit, or New › blank): where to begin, over the empty
 * lanes. It goes with the first clip, and stays out of the way while a tutorial runs.
 */
const EmptySongPrompt: React.FC = () => {
  const empty = useTimelineStore((s) => s.clips.length === 0);
  const touring = useTourStore((s) => s.active !== null);
  if (!empty || touring) return null;
  return (
    <div className="absolute inset-0 z-[20] flex items-center justify-center pointer-events-none" style={{ paddingLeft: HEADER_WIDTH }}>
      <div data-testid="empty-song" className="pointer-events-auto max-w-sm rounded-lg border border-forge-border bg-forge-panel/95 px-4 py-3 text-center shadow-lg shadow-black/40">
        <p className="text-sm font-semibold text-forge-text">This song is empty</p>
        <p className="mt-1 text-[12px] text-forge-muted">Open a starter to hear something straight away, or double-click a lane to write your own notes.</p>
        <button
          type="button"
          onClick={() => useUiStore.getState().setDialog('new')}
          className="mt-3 h-8 px-3 rounded-md border border-cyan-500/60 bg-cyan-500/15 text-[12px] font-semibold text-cyan-100 hover:bg-cyan-500/25"
        >
          Open a starter
        </button>
      </div>
    </div>
  );
};

export const Timeline: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const zoom = useTimelineStore((s) => s.zoom);
  const activeTool = useTimelineStore((s) => s.activeTool);
  const timelineHeight = useUiStore((s) => s.timelineHeight);
  const rulerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onScrubStart = useScrub(rulerRef);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [rulerMenu, setRulerMenu] = useState<RulerMenuState | null>(null);
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null);
  const closeTrackMenu = useCallback(() => setTrackMenu(null), []);
  const closeRulerMenu = useCallback(() => setRulerMenu(null), []);
  /** The audio clip "Chop sample…" was chosen for, while its dialog is open. */
  const [chopClipId, setChopClipId] = useState<string | null>(null);
  const variationsClipId = useUiStore((s) => s.variationsClipId);
  const setVariationsClipId = useUiStore.getState().setVariationsClip;
  const tuneClipId = useUiStore((s) => s.tuneClipId);
  const takesClipId = useUiStore((s) => s.takesClipId);
  const pluginWindow = useUiStore((s) => s.pluginWindow);
  const pluginBrowser = useUiStore((s) => s.pluginBrowser);
  const pluginDialog = useUiStore((s) => s.pluginDialog);
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
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
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
  useEffect(() => startAutoFreeze(), []);
  // A track just added (or selected from elsewhere) is scrolled into view
  const trackCount = useTimelineStore((s) => s.tracks.length);
  const selectedTrack = useTimelineStore((s) => s.selectedTrackId);
  // A track added: the timeline grows just enough to show it (the panels under it move down with it),
  // up to most of the window, after which the new track is scrolled to instead
  const shownCount = useRef(trackCount);
  useLayoutEffect(() => {
    const added = trackCount > shownCount.current;
    shownCount.current = trackCount;
    const content = contentRef.current?.offsetHeight ?? 0;
    const { timelineHeight, setTimelineHeight } = useUiStore.getState();
    if (!added || content <= timelineHeight) return;
    const roomy = Math.max(timelineHeight, Math.round(window.innerHeight * 0.75));
    setTimelineHeight(Math.min(content, roomy));
  }, [trackCount]);
  useEffect(() => {
    const lane = selectedTrack ? document.querySelector<HTMLElement>(`[data-lane="${CSS.escape(selectedTrack)}"]`) : null;
    if (!lane) return;
    // Up or down only (a lane is as wide as the song: scrollIntoView would scroll the timeline sideways too)
    for (let p = lane.parentElement; p; p = p.parentElement) {
      const { overflowY } = getComputedStyle(p);
      if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
      const box = p.getBoundingClientRect();
      const r = lane.getBoundingClientRect();
      if (r.top < box.top) p.scrollTop -= box.top - r.top;
      else if (r.bottom > box.bottom) p.scrollTop += Math.min(r.top - box.top, r.bottom - box.bottom);
      break;
    }
  }, [trackCount, selectedTrack]);
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
        if (state.viewJumps !== prev.viewJumps) el.scrollLeft = state.viewLeft;
      }),
    []
  );
  useEffect(
    () =>
      onPlayhead(() => {
        const el = scrollRef.current;
        const state = useTimelineStore.getState();
        if (!el || !state.isPlaying) return;
        const x = (livePlayhead() - 1) * state.zoom;
        // The view as the store has it (setView, on every scroll and resize), not read from the
        // page: reading scrollLeft or clientWidth makes the browser lay the page out there and then,
        // and this runs every frame of playback
        const { viewLeft, viewWidth } = state;
        if (x < viewLeft || x > viewLeft + viewWidth - 24) {
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
        // No menu to explain a refusal in, so say it in a toast (with Shift: linked copies)
        const message = e.shiftKey ? s.duplicateLinked() : s.duplicateSelection();
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
        s.setLoopIn(livePlayhead());
      } else if (key === 'o') {
        s.setLoopOut(livePlayhead());
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
          className={`flex-1 overflow-x-hidden overflow-y-auto ${activeTool === 'razor' ? 'cursor-crosshair' : ''}`}
          style={{ maxHeight: timelineHeight }}
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
                <TrackRow key={row.track.id}>
                  <TrackHeader track={row.track} onOpenMenu={setMenu} onTrackMenu={setTrackMenu} />
                  <TrackLane track={row.track} originRef={rulerRef} onOpenMenu={setMenu} />
                </TrackRow>
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

        <EmptySongPrompt />

        {/* DaVinci Fairlight Track Inspector & FX Rack */}
        <TrackInspector />
      </div>

      <TimelineResizer scrollRef={scrollRef} />
      <TimelineScrollbar scrollRef={scrollRef} />
      <PianoRoll />

      <div className="px-4 py-1.5 border-t border-forge-border text-[11px] font-mono text-forge-muted hidden md:block">
        + or double-click a lane to add a clip • double-click a clip to edit notes • drag sound files onto a track •
        Drag box / Shift-click multi-select • Ctrl+Z undo • Ctrl+C/X/V • Ctrl+D duplicate • C razor • Del delete • M marker • , and . previous / next marker • curve button: automation • ? guide
      </div>

      {menu && <ClipContextMenu menu={menu} onClose={closeMenu} onChop={setChopClipId} onVariations={setVariationsClipId} />}
      {rulerMenu && <RulerContextMenu menu={rulerMenu} onClose={closeRulerMenu} />}
      {trackMenu && <TrackMenu menu={trackMenu} onClose={closeTrackMenu} />}
      {chopClipId && <ChopSampleDialog clipId={chopClipId} onClose={() => setChopClipId(null)} />}
      {variationsClipId && <VariationsDialog clipId={variationsClipId} onClose={() => setVariationsClipId(null)} />}
      {tuneClipId &&
        // A take folder plays several sounds: it's tuned once flattened (Takes, Flatten)
        ((useTimelineStore.getState().clips.find((c) => c.id === tuneClipId)?.takes?.length ?? 0) > 1 ? (
          <Modal title="Tune vocal" onClose={() => useUiStore.getState().setTuneClip(null)}>
            <p className="p-4 text-sm text-forge-muted">
              This clip is a take folder: it plays parts of several takes. Flatten it first (right-click it, Takes, Flatten), then tune it.
            </p>
          </Modal>
        ) : (
          <TuneDialog clipId={tuneClipId} onClose={() => useUiStore.getState().setTuneClip(null)} />
        ))}
      <SmartDialog />
      <ArrangeDialog />
      {takesClipId && <TakesDialog clipId={takesClipId} onClose={() => useUiStore.getState().setTakesClip(null)} />}
      {pluginBrowser && (
        <PluginBrowser
          trackId={pluginBrowser.trackId ?? useTimelineStore.getState().selectedTrackId}
          category={pluginBrowser.category}
          onClose={() => useUiStore.getState().setPluginBrowser(null)}
        />
      )}
      {pluginDialog && <PluginUrlDialog trackId={pluginDialog.trackId} onClose={() => useUiStore.getState().setPluginDialog(null)} />}
      {pluginWindow && (
        <PluginWindow key={pluginWindow.pluginId} trackId={pluginWindow.trackId} pluginId={pluginWindow.pluginId} onClose={closePluginWindow} />
      )}
      <PluginPermissionBar />
      <Toast />
    </div>
  );
};
