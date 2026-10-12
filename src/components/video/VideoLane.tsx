import React, { useRef } from 'react';
import { Clapperboard, Eye, EyeOff, Scissors, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { findSceneCuts, useVideoStore } from '../../store/videoStore';
import { showToast } from '../timeline/toastStore';
import { secondsToBar } from '../../audio/transport';
import { HEADER_WIDTH } from '../timeline/layout';

const LANE_HEIGHT = 48;
const THUMB_W = 72;

const clock = (s: number) => {
  const sign = s < 0 ? '-' : '';
  const a = Math.abs(s);
  return `${sign}${Math.floor(a / 60)}:${(a % 60).toFixed(2).padStart(5, '0')}`;
};

/**
 * The reference video as a lane under the ruler: its frames along the song at the tempo, so
 * hits can be lined up by eye. Drag it sideways to change where it starts (Shift: no snapping to
 * bars); the header shows the start and opens the preview window.
 */
export const VideoLane: React.FC = () => {
  const video = useVideoStore((s) => s.video);
  const thumbs = useVideoStore((s) => s.thumbs);
  const start = useVideoStore((s) => s.start);
  const previewOpen = useVideoStore((s) => s.previewOpen);
  const zoom = useTimelineStore((s) => s.zoom);
  const bpm = useTimelineStore((s) => s.bpm);
  const laneRef = useRef<HTMLDivElement>(null);
  if (!video) return null;

  const xOf = (songSeconds: number) => (secondsToBar(songSeconds, bpm) - 1) * zoom;
  const pxPerSecond = xOf(1) - xOf(0);
  // As many thumbnails as fit side by side
  const thumbStep = thumbs[1]?.at ?? 1;
  const stride = Math.max(1, Math.ceil(THUMB_W / Math.max(1e-6, pxPerSecond * thumbStep)));
  // Each shown thumbnail fills the space to the next, like a film strip
  const thumbW = Math.max(8, pxPerSecond * thumbStep * stride - 1);
  const left = xOf(start);
  const width = Math.max(4, xOf(start + video.duration) - left);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const s0 = start;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      let next = s0 + dx / pxPerSecond;
      // Snap the start to the nearest beat unless Shift is held
      if (!ev.shiftKey) {
        const beat = 60 / bpm;
        next = Math.round(next / beat) * beat;
      }
      useVideoStore.getState().setStart(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="flex border-b border-forge-border" style={{ height: LANE_HEIGHT }} data-video-lane="">
      <div
        className="sticky left-0 z-20 shrink-0 bg-forge-panel border-r border-forge-border flex items-center gap-1.5 px-2 text-[10px] font-mono text-forge-muted"
        style={{ width: HEADER_WIDTH }}
      >
        <Clapperboard className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="truncate text-forge-text" title={video.name}>{video.name}</span>
        <span className="ml-auto tabular-nums shrink-0" title="Where the video starts in the song (drag the strip to move it)">
          @{clock(start)} · bar {secondsToBar(start, bpm).toFixed(2)}
        </span>
        <FindCutsButton />
        <button type="button" title={previewOpen ? 'Hide the preview window' : 'Show the preview window'} onClick={() => useVideoStore.getState().setPreviewOpen(!previewOpen)} className="hover:text-forge-text shrink-0">
          {previewOpen ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
        <button type="button" title="Remove the video" onClick={() => useVideoStore.getState().remove()} className="hover:text-red-400 shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div ref={laneRef} className="relative flex-1 bg-black/40 overflow-hidden" style={{ width: 0 }}>
        <div
          className="absolute top-1 bottom-1 rounded border border-amber-400/60 bg-zinc-900 overflow-hidden cursor-grab active:cursor-grabbing"
          style={{ left, width }}
          onPointerDown={onPointerDown}
          title={`${video.name}: drag to move where it starts (Shift: off the beat)`}
        >
          {thumbs.map((t, i) =>
            i % stride === 0 ? (
              <img
                key={t.at}
                src={t.url}
                alt=""
                draggable={false}
                className="absolute top-0 bottom-0 h-full object-cover pointer-events-none opacity-90"
                style={{ left: xOf(start + t.at) - left, width: thumbW }}
              />
            ) : null
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Find the video's hard cuts and drop a hit point (a marker locked to time) on each, named Cut 1,
 * Cut 2..., where they fall in the song. Click again while it looks to stop.
 */
const FindCutsButton: React.FC = () => {
  const [progress, setProgress] = React.useState<number | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const run = async () => {
    if (abort.current) {
      abort.current.abort();
      return;
    }
    const { video, start } = useVideoStore.getState();
    if (!video) return;
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    try {
      const cuts = await findSceneCuts(video.url, setProgress, controller.signal);
      const added = useTimelineStore.getState().addHitsAt(
        cuts.map((t) => start + t),
        'Cut'
      );
      showToast(
        cuts.length === 0
          ? 'No hard cuts found in the video.'
          : `Found ${cuts.length} cut${cuts.length === 1 ? '' : 's'}${added < cuts.length ? ` (${added} new)` : ''}: markers "Cut 1"... locked to time. FIT › Hit points finds a tempo for them.`
      );
    } catch {
      showToast("Couldn't read the video's frames.");
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void run()}
      title={progress === null ? 'Find the cuts: a hit point on every hard cut in the video' : 'Looking for cuts… click to stop'}
      aria-label={progress === null ? 'Find cuts in the video' : 'Stop looking for cuts'}
      className="hover:text-forge-text shrink-0 tabular-nums"
    >
      {progress === null ? <Scissors className="w-3.5 h-3.5" /> : `${Math.round(progress * 100)}%`}
    </button>
  );
};
