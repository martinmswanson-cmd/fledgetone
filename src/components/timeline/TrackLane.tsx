import { useShallow } from 'zustand/react/shallow';
import React, { useState } from 'react';
import { songMeterOf, TOTAL_BARS, useTimelineStore } from '../../store/timelineStore';
import { isPlainMeter } from '../../audio/tempoMap';
import type { Track } from '../../store/timelineTypes';
import { snapBar } from '../../store/timelineTypes';
import { dragInstrument, readDragPayload } from '../../store/dragSounds';
import { compatibleInstruments, isAudioKind } from '../../audio/instrumentCatalog';
import { ClipView } from './ClipView';
import { AutomationLane } from './AutomationLane';
import { LaneFrameGrid, LaneMeterGrid } from './LaneFrameGrid';
import type { ContextMenuState } from './ClipContextMenu';
import { barFromClientX } from './Playhead';
import { barLabelStep, TRACK_HEIGHT } from './layout';
import { dropAudioFiles, hasFiles, pickAudioFiles } from './audioFiles';

interface TrackLaneProps {
  track: Track;
  originRef: React.RefObject<HTMLElement | null>;
  onOpenMenu: (menu: ContextMenuState) => void;
}

/**
 * Horizontal lane holding a track's clips over a bar/beat grid. Empty-space clicks and marquee
 * drags are handled by Timeline (via data-lane). Here: right-click menu, double-click to create
 * an empty clip and open it (on an Audio track: to load a sound file there), dropping sounds/patterns from the
 * deck (matching instrument only) or sound files from the desktop (Audio tracks), and the
 * highlight while clips are dragged between tracks. In automation view an envelope editor
 * covers the clips (see AutomationLane).
 */
export const TrackLane: React.FC<TrackLaneProps> = ({ track, originRef, onOpenMenu }) => {
  const zoom = useTimelineStore((s) => s.zoom);
  // Only this track's clips: an edit on another track doesn't re-render this lane
  const trackClips = useTimelineStore(useShallow((s) => s.clips.filter((c) => c.trackId === track.id)));
  const dragging = useTimelineStore((s) => s.draggingInstrument);
  // Faint lines on every 16th when zoomed in for detail work (once they're 16px apart). A whole zoom
  // makes that a whole number of 1/64 px, so a repeating background stays exact. With Frame snap,
  // LaneFrameGrid marks the frames instead.
  const fineGridPx = useTimelineStore((s) => (s.snapGrid !== 'frame' && s.zoom >= 256 ? s.zoom / 16 : 0));
  const clipDropTarget = useTimelineStore((s) => s.clipDragTargets?.has(track.id) ?? false);
  const automation = useTimelineStore((s) => s.automationView[track.id]);
  const plainMeter = useTimelineStore((s) => isPlainMeter(songMeterOf(s)));
  const [dropBar, setDropBar] = useState<number | null>(null);
  const [filesOver, setFilesOver] = useState(false);
  const isAudio = isAudioKind(track.instrumentKey);

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
        accepts || clipDropTarget || filesOver ? 'shadow-[inset_0_0_0_2px_rgba(103,232,249,0.6)]' : dragging ? 'opacity-40' : ''
      }`}
      style={{
        width: TOTAL_BARS * zoom,
        height: TRACK_HEIGHT,
        // Major lines every labelled bar; minor lines per beat, or per bar when zoomed far out (in
        // other time signatures LaneMeterGrid draws the measures and beats instead)
        backgroundImage: plainMeter
          ? `linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)${
              fineGridPx ? ', linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px)' : ''
            }`
          : fineGridPx
            ? 'linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px)'
            : 'none',
        backgroundSize: plainMeter ? `${zoom * barLabelStep(zoom)}px 100%, ${zoom >= 48 ? zoom / 4 : zoom}px 100%${fineGridPx ? `, ${fineGridPx}px 100%` : ''}` : `${fineGridPx}px 100%`,
      }}
      data-lane={track.id}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu({ x: e.clientX, y: e.clientY, bar: snapped(e.clientX, e.shiftKey), trackId: track.id, clipId: null });
      }}
      onDoubleClick={(e) => {
        if (e.target !== e.currentTarget || useTimelineStore.getState().activeTool !== 'select') return;
        const raw = barFromClientX(e.clientX, originRef.current);
        const bar = Math.floor((raw - 1) * 4) / 4 + 1;
        if (isAudio) {
          // Sound files, as clips from the beat that was double-clicked
          void pickAudioFiles().then((files) => dropAudioFiles(track.id, bar, files));
          return;
        }
        // New one-bar clip starting on the beat that was double-clicked
        const s = useTimelineStore.getState();
        const id = s.createEmptyClip(track.id, bar, 1);
        if (id) s.openEditor(id);
      }}
      onDragOver={(e) => {
        if (isAudio && hasFiles(e)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'copy';
          setFilesOver(true);
          setDropBar(snapped(e.clientX, e.shiftKey));
          return;
        }
        const source = dragInstrument(e);
        if (!source || !compatibleInstruments(source, track.instrumentKey)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropBar(snapped(e.clientX, e.shiftKey));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDropBar(null);
          setFilesOver(false);
        }
      }}
      onDrop={(e) => {
        setDropBar(null);
        setFilesOver(false);
        if (isAudio && hasFiles(e)) {
          e.preventDefault();
          e.stopPropagation();
          void dropAudioFiles(track.id, snapped(e.clientX, e.shiftKey), e.dataTransfer.files);
          return;
        }
        const payload = readDragPayload(e);
        if (!payload || !compatibleInstruments(payload.instrument, track.instrumentKey)) return;
        e.preventDefault();
        useTimelineStore.getState().dropOnTrack(track.id, snapped(e.clientX, e.shiftKey), payload);
      }}
    >
      <LaneFrameGrid />
      {!plainMeter && <LaneMeterGrid />}
      {trackClips.map((clip) => (
        <ClipView key={clip.id} clip={clip} track={track} originRef={originRef} onOpenMenu={onOpenMenu} />
      ))}
      {automation?.open && <AutomationLane track={track} param={automation.param} />}

      {(accepts || filesOver) && dropBar !== null && (
        <div
          className="absolute top-0 bottom-0 z-20 w-[2px] bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)] pointer-events-none"
          style={{ left: (dropBar - 1) * zoom }}
        />
      )}
    </div>
  );
};
