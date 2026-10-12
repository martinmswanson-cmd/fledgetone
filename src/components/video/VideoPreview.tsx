import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Maximize2, Minimize2, Volume2, VolumeX, X } from 'lucide-react';
import { songTempo, useTimelineStore } from '../../store/timelineStore';
import { useVideoStore } from '../../store/videoStore';
import { barToSeconds } from '../../audio/transport';

const WIDTHS = { small: 260, medium: 400, large: 640 } as const;
/** Further off than this (seconds) while playing, the video jumps back into step. */
const DRIFT = 0.12;

/**
 * The reference video in a floating window that follows the playhead: playing along with the
 * song, and showing the frame under the playhead while stopped (so scrubbing the ruler scrubs it).
 * Drag it by its top bar.
 */
export const VideoPreview: React.FC = () => {
  const video = useVideoStore((s) => s.video);
  const open = useVideoStore((s) => s.previewOpen);
  const size = useVideoStore((s) => s.previewSize);
  const muted = useVideoStore((s) => s.muted);
  const ref = useRef<HTMLVideoElement>(null);
  const [pos, setPos] = useState<{ right: number; bottom: number }>({ right: 16, bottom: 16 });
  const [outside, setOutside] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !video || !open) return;
    let raf = 0;
    const tick = () => {
      const { playheadPosition, isPlaying } = useTimelineStore.getState();
      const t = barToSeconds(playheadPosition, songTempo(useTimelineStore.getState())) - useVideoStore.getState().start;
      const inside = t >= 0 && t < video.duration;
      setOutside((was) => (was === !inside ? was : !inside));
      if (!inside) {
        if (!el.paused) el.pause();
      } else if (isPlaying) {
        if (Math.abs(el.currentTime - t) > DRIFT) el.currentTime = t;
        if (el.paused) void el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        // Only seek when the playhead has moved (seeking is not free)
        if (Math.abs(el.currentTime - t) > 1 / 60 && !el.seeking) el.currentTime = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.pause();
    };
  }, [video, open]);

  if (!video || !open) return null;
  const width = WIDTHS[size];

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const p0 = pos;
    const move = (ev: PointerEvent) =>
      setPos({
        right: Math.max(0, Math.min(window.innerWidth - 80, p0.right - (ev.clientX - x0))),
        bottom: Math.max(0, Math.min(window.innerHeight - 40, p0.bottom - (ev.clientY - y0))),
      });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const s = useVideoStore.getState();
  return (
    <div
      className="fixed z-40 rounded-lg overflow-hidden border border-forge-borderLight bg-black shadow-2xl"
      style={{ right: pos.right, bottom: pos.bottom, width }}
      role="region"
      aria-label="Video preview"
    >
      <div className="flex items-center gap-1.5 px-2 h-7 bg-forge-panel text-[10px] font-mono text-forge-muted cursor-move select-none" onPointerDown={startDrag}>
        <GripHorizontal className="w-3.5 h-3.5" />
        <span className="truncate text-forge-text">{video.name}</span>
        <span className="ml-auto" />
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => s.setMuted(!muted)} title={muted ? "Hear the video's own sound" : "Mute the video's own sound"} className="hover:text-forge-text">
          {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => s.setPreviewSize(size === 'small' ? 'medium' : size === 'medium' ? 'large' : 'small')}
          title="Size: small, medium, large"
          className="hover:text-forge-text"
        >
          {size === 'large' ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => s.setPreviewOpen(false)} title="Hide (show it again from the video lane)" className="hover:text-forge-text">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="relative bg-black" style={{ aspectRatio: `${video.width || 16} / ${video.height || 9}` }}>
        <video ref={ref} src={video.url} muted={muted} playsInline preload="auto" className="absolute inset-0 w-full h-full object-contain" />
        {outside && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-[11px] font-mono text-forge-muted">
            The playhead is outside the video
          </div>
        )}
      </div>
    </div>
  );
};
