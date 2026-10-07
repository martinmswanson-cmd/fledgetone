import React, { useState } from 'react';
import { TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import { snapBar } from '../../store/timelineTypes';
import { dragInstrument, readDragPayload } from '../../store/dragSounds';
import { compatibleInstruments } from '../../audio/instrumentCatalog';
import { ClipView } from './ClipView';
import { LaneFrameGrid } from './LaneFrameGrid';
import type { ContextMenuState } from './ClipContextMenu';
import { barFromClientX } from './Playhead';
import { barLabelStep, TRACK_HEIGHT } from './layout';

interface TrackLaneProps {
  track: Track;
  originRef: React.RefObject<HTMLElement | null>;
  onOpenMenu: (menu: ContextMenuState) => void;
}

/**
 * Horizontal lane holding a track's clips over a bar/beat grid. Empty-space clicks and marquee
 * drags are handled by Timeline (via data-lane). Here: right-click menu, double-click to create
 * an empty clip and open it, dropping sounds/patterns from the deck (matching instrument only),
 * and the highlight while clips are dragged between tracks.
 */
export const TrackLane: React.FC<TrackLaneProps> = ({ track, originRef, onOpenMenu }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  const clips = useTimelineStore((s) => s.clips);
  const dragging = useTimelineStore((s) => s.draggingInstrument);
  // Faint lines on every 16th when zoomed in for detail work (once they're 16px apart). A whole zoom
  // makes that a whole number of 1/64 px, so a repeating background stays exact. With Frame snap,
  // LaneFrameGrid marks the frames instead.
  const fineGridPx = useTimelineStore((s) => (s.snapGrid !== 'frame' && s.zoom >= 256 ? s.zoom / 16 : 0));
  const clipDropTarget = useTimelineStore((s) => s.clipDragTargets?.has(track.id) ?? false);
  const [dropBar, setDropBar] = useState<number | null>(null);
  const trackClips = clips.filter((c) => c.trackId === track.id);

  const snapped = (clientX: number, shift: boolean) => {
    const raw = barFromClientX(clientX, originRef.current);
    const s = useTimelineStore.getState();
    return shift ? raw : snapBar(raw, s.snapGrid, s);
  };

  const accepts = dragging !== null && compatibleInstruments(dragging, track.instrumentKey);

  return (
    <div
      className={`relative shrink-0 border-b border-forge-border bg-forge-bg transition-[box-shadow,opacity] ${
        // Lanes that take what's being dragged light up. A deck drag also fades the rest; a clip drag
        // doesn't, so the other tracks' clips stay easy to line up against.
        accepts || clipDropTarget ? 'shadow-[inset_0_0_0_2px_rgba(103,232,249,0.6)]' : dragging ? 'opacity-40' : ''
      }`}
      style={{
        width: TOTAL_BARS * zoom,
        height: TRACK_HEIGHT,
        backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)${
          fineGridPx ? ', linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px)' : ''
        }`,
        // Major lines every labelled bar; minor lines per beat, or per bar when zoomed far out
        backgroundSize: `${zoom * barLabelStep(zoom)}px 100%, ${zoom >= 48 ? zoom / 4 : zoom}px 100%${fineGridPx ? `, ${fineGridPx}px 100%` : ''}`,
      }}
      data-lane={track.id}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu({ x: e.clientX, y: e.clientY, bar: snapped(e.clientX, e.shiftKey), trackId: track.id, clipId: null });
      }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget || useTimelineStore.getState().activeTool !== 'select') return;
        // New one-bar clip starting on the beat that was double-clicked
        const raw = barFromClientX(e.clientX, originRef.current);
        const s = useTimelineStore.getState();
        const id = s.createEmptyClip(track.id, Math.floor((raw - 1) * 4) / 4 + 1, 1);
        if (id) s.openEditor(id);
      }}
      onDragOver={(e) => {
        const source = dragInstrument(e);
        if (!source || !compatibleInstruments(source, track.instrumentKey)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropBar(snapped(e.clientX, e.shiftKey));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropBar(null);
      }}
      onDrop={(e) => {
        const payload = readDragPayload(e);
        setDropBar(null);
        if (!payload || !compatibleInstruments(payload.instrument, track.instrumentKey)) return;
        e.preventDefault();
        useTimelineStore.getState().dropOnTrack(track.id, snapped(e.clientX, e.shiftKey), payload);
      }}
    >
      <LaneFrameGrid />
      {trackClips.map((clip) => (
        <ClipView key={clip.id} clip={clip} track={track} originRef={originRef} onOpenMenu={onOpenMenu} />
      ))}

      {accepts && dropBar !== null && (
        <div
          className="absolute top-0 bottom-0 z-20 w-[2px] bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)] pointer-events-none"
          style={{ left: (dropBar - 1) * zoom }}
        />
      )}
    </div>
  );
};
