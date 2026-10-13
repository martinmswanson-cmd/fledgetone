/**
 * The markers list popover (rename, lock to time or bar, delete, go to) and exporting the markers
 * for video editing software.
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Flag, Lock, LockOpen, Plus, Trash2 } from 'lucide-react';
import { TOTAL_BARS, songTempo, useSongTempo, useTimelineStore } from '../../store/timelineStore';
import type { Marker } from '../../store/timelineTypes';
import { frameRateLabel } from '../../store/timelineTypes';
import { cleanMarkerName, MARKER_NAME_MAX } from '../../store/markers';
import { barToSeconds, formatBarsBeats, formatSmpte } from '../../audio/transport';
import { useVideoStore } from '../../store/videoStore';
import { EDITOR_FORMATS, editorMarkerFile, type EditorFormat } from '../../store/editorMarkers';
import { downloadBlob } from '../../audio/exportWav';
import { Popover } from '../Popover';

/**
 * A marker's name, edited in place. What's typed applies as it's typed (the flag on the ruler
 * follows), all of it one undo step per visit to the field. A blank name is never applied.
 */
const MarkerNameField: React.FC<{ marker: Marker }> = ({ marker }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const recorded = useRef(false);
  return (
    <input
      value={draft ?? marker.name}
      maxLength={MARKER_NAME_MAX}
      onFocus={(e) => {
        recorded.current = false;
        setDraft(marker.name);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const clean = cleanMarkerName(e.target.value);
        if (!clean || clean === marker.name) return;
        const s = useTimelineStore.getState();
        if (!recorded.current) {
          recorded.current = true;
          s.checkpoint();
        }
        s.renameMarker(marker.id, clean);
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      aria-label={`Name of the marker at ${formatBarsBeats(marker.bar)}`}
      className="h-6 min-w-0 w-full bg-transparent border border-transparent hover:border-forge-border rounded px-1 text-xs text-forge-text focus:outline-none focus:border-cyan-500 focus:bg-forge-bg"
    />
  );
};

/** One marker in the list: lock, name, where it is (click to go there), delete. */
const MarkerRow: React.FC<{ marker: Marker; timecode: string }> = ({ marker, timecode }) => {
  const { seek, setMarkerAnchor, deleteMarker } = useTimelineStore.getState();
  const locked = marker.anchor === 'time';
  const pastEnd = marker.bar > TOTAL_BARS + 1;
  return (
    <li className="flex items-center gap-1 rounded-md border border-forge-border bg-forge-bg/60 pl-0.5 pr-1 py-0.5">
      <button
        type="button"
        onClick={() => setMarkerAnchor(marker.id, locked ? 'bar' : 'time')}
        aria-pressed={locked}
        aria-label={`Lock ${marker.name} to time`}
        title={
          locked
            ? 'Locked to time: stays at this timecode when the tempo changes. Click to lock it to its bar.'
            : 'Stays on its bar when the tempo changes. Click to lock it to time instead.'
        }
        className={`h-7 w-7 shrink-0 flex items-center justify-center rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
          locked ? 'text-violet-200 bg-violet-500/25' : 'text-forge-muted hover:text-forge-text'
        }`}
      >
        {locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
      </button>
      <div className="flex-1 min-w-0 flex flex-col">
        <MarkerNameField marker={marker} />
        <button
          type="button"
          onClick={() => seek(marker.bar, true)}
          title="Move the playhead here"
          className="px-1 text-left font-mono text-[10px] tabular-nums text-cyan-300/90 hover:text-cyan-200 truncate rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        >
          {formatBarsBeats(marker.bar)} · {timecode}
          {pastEnd && <span className="text-forge-muted"> · after the end</span>}
        </button>
      </div>
      <button
        type="button"
        onClick={() => deleteMarker(marker.id)}
        aria-label={`Delete ${marker.name}`}
        title="Delete marker"
        className="h-7 w-7 shrink-0 flex items-center justify-center rounded text-forge-muted hover:text-red-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </li>
  );
};

/** Every marker with its bar and timecode: rename, lock, delete, or click a position to go there. */
const MarkerListPopover: React.FC<{ anchorRef: React.RefObject<HTMLElement | null>; onClose: () => void }> = ({ anchorRef, onClose }) => {
  const markers = useTimelineStore((s) => s.markers);
  const bpm = useSongTempo();
  const fps = useTimelineStore((s) => s.fps);
  const dropFrame = useTimelineStore((s) => s.dropFrame);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // The timeline card clips what hangs below it, so the list scrolls rather than grows past the
  // card (or the window): it takes whatever room there is below the panel, and at least 12rem
  useLayoutEffect(() => {
    const list = listRef.current;
    const panel = list?.closest<HTMLElement>('[role="dialog"]');
    if (!list || !panel) return;
    list.style.maxHeight = '';
    let bottom = window.innerHeight;
    for (let box = panel.parentElement; box && box !== document.body; box = box.parentElement) {
      if (getComputedStyle(box).overflowY !== 'visible') bottom = Math.min(bottom, box.getBoundingClientRect().bottom);
    }
    const room = bottom - 8 - panel.getBoundingClientRect().bottom;
    if (room > 0) list.style.maxHeight = `${list.getBoundingClientRect().height + room}px`;
  });

  return (
    <Popover label="Markers" onClose={onClose} anchorRef={anchorRef} className="left-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-forge-text">Markers</span>
        <button
          type="button"
          data-autofocus
          onClick={() => setNotice(useTimelineStore.getState().addMarker())}
          title="Drop a marker at the playhead (M)"
          className="h-7 px-2 flex items-center gap-1 rounded-md border border-forge-border bg-forge-bg text-[11px] text-forge-text hover:border-violet-400/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
        >
          <Plus className="w-3.5 h-3.5" />
          At playhead
        </button>
      </div>
      {notice && <p className="text-[11px] text-amber-300">{notice}</p>}
      {markers.length === 0 ? (
        <p className="leading-snug">No markers yet. Press M to drop one at the playhead, or right-click the ruler and choose Add marker here.</p>
      ) : (
        <>
          <div className="flex justify-between font-mono text-[10px]">
            <span>bar.beat.hundredths · timecode</span>
            <span>{frameRateLabel(fps, dropFrame)}</span>
          </div>
          <ul ref={listRef} className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {markers.map((m) => (
              <MarkerRow key={m.id} marker={m} timecode={formatSmpte(m.bar, bpm, fps, dropFrame)} />
            ))}
          </ul>
        </>
      )}
      {markers.length > 0 && <ExportForEditors />}
      <p className="text-[11px] leading-snug">
        Press , (comma) and . (period) to jump to the previous and next marker. A marker locked to time keeps its timecode when the tempo
        changes; the others stay on their bar.
      </p>
    </Popover>
  );
};

/** Toolbar button that opens the markers list (it shows how many there are). */
export const MarkersButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const count = useTimelineStore((s) => s.markers.length);
  return (
    <div className="relative flex items-center">
      <button
        ref={anchorRef}
        id="btn-markers"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Markers: list, rename and jump to them (M adds one at the playhead; , and . jump)"
        className={`h-8 min-w-8 px-2 flex items-center justify-center gap-1 rounded-md border text-xs font-mono transition-colors ${
          open
            ? 'bg-violet-500/15 border-violet-400/70 text-violet-200'
            : 'bg-forge-bg border-forge-border text-forge-muted hover:text-forge-text hover:border-forge-borderLight'
        }`}
      >
        <Flag className="w-4 h-4" />
        {count > 0 && <span className="text-[10px] tabular-nums">{count}</span>}
        <span className="sr-only">Markers</span>
      </button>
      {open && <MarkerListPopover anchorRef={anchorRef} onClose={close} />}
    </div>
  );
};

/**
 * The markers as a file for video editing software, so the editor sees the sections and hit
 * points on their own timeline. With a reference video loaded they count from its first frame.
 */
export const ExportForEditors: React.FC = () => {
  const video = useVideoStore((s) => s.video);
  const videoStart = useVideoStore((s) => s.start);
  const [startHour, setStartHour] = useState<0 | 1>(0);
  const [fromVideo, setFromVideo] = useState(true);
  const save = (format: EditorFormat) => {
    const s = useTimelineStore.getState();
    const offset = video && fromVideo ? videoStart : 0;
    const songEnd = s.clips.reduce((e, c) => Math.max(e, c.startBar + c.lengthBars), 1);
    const length = Math.max(video && fromVideo ? video.duration : 0, barToSeconds(songEnd, songTempo(s)) - offset);
    const text = editorMarkerFile(
      format,
      s.markers.map((m) => ({ name: m.name, seconds: m.seconds - offset })),
      { title: s.projectName || 'Untitled', fps: s.fps, dropFrame: s.dropFrame, startHour },
      length
    );
    const ext = EDITOR_FORMATS.find((f) => f.id === format)!.ext;
    downloadBlob(new Blob([text], { type: 'text/plain' }), `${s.projectName || 'Untitled'} markers.${ext}`);
  };
  return (
    <div className="flex flex-col gap-1.5 border-t border-forge-border pt-2">
      <select
        value=""
        onChange={(e) => e.target.value && save(e.target.value as EditorFormat)}
        className="h-7 bg-forge-bg border border-forge-border rounded-md px-1.5 text-[11px] text-forge-text"
        aria-label="Export the markers for video editing software"
      >
        <option value="">Export markers for…</option>
        {EDITOR_FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <label className="flex items-center gap-1" title="DaVinci Resolve timelines usually start at 01:00:00:00">
          <input type="checkbox" checked={startHour === 1} onChange={(e) => setStartHour(e.target.checked ? 1 : 0)} />
          Timeline starts at 01:00:00:00
        </label>
        {video && (
          <label className="flex items-center gap-1" title="Count from the video's first frame, where it sits on the editor's timeline">
            <input type="checkbox" checked={fromVideo} onChange={(e) => setFromVideo(e.target.checked)} />
            From the video's start
          </label>
        )}
      </div>
    </div>
  );
};
