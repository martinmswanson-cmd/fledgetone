/**
 * The reference video's lane under the ruler (its frames along the song), and the Find cuts and
 * Dip under dialogue buttons.
 */
import { tempoAt } from '../../audio/tempoMap';
import React, { useRef } from 'react';
import { Clapperboard, Eye, EyeOff, MessageSquareText, Scissors, X } from 'lucide-react';
import { useSongTempo, useTimelineStore } from '../../store/timelineStore';
import { findDialogue, findSceneCuts, useVideoStore } from '../../store/videoStore';
import { DEFAULT_DIP, type Span } from '../../store/dialogue';
import { Modal } from '../timeline/Modal';
import { showToast } from '../timeline/toastStore';
import { secondsToBar } from '../../audio/transport';
import { HEADER_WIDTH } from '../timeline/layout';

import { VIDEO_LANE_HEIGHT as LANE_HEIGHT } from '../timeline/rows';
const PANEL_BUTTON = 'h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border bg-forge-bg text-forge-text hover:border-cyan-400/60 disabled:opacity-50 tabular-nums';
const THUMB_W = 72;

const clock = (s: number) => {
  const sign = s < 0 ? '-' : '';
  const c = Math.round(Math.abs(s) * 100);
  return `${sign}${Math.floor(c / 6000)}:${((c % 6000) / 100).toFixed(2).padStart(5, '0')}`;
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
  const bpm = useSongTempo();
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
        const beat = 60 / tempoAt(1, bpm);
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
        <DialogueDipButton />
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
export const FindCutsButton: React.FC<{ labelled?: boolean }> = ({ labelled = false }) => {
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
      className={labelled ? PANEL_BUTTON : 'hover:text-forge-text shrink-0 tabular-nums'}
    >
      {progress === null ? <Scissors className="w-3.5 h-3.5" /> : `${Math.round(progress * 100)}%`}
      {labelled && (progress === null ? 'Find cuts' : 'Stop')}
    </button>
  );
};

/**
 * Dip under dialogue: listen to the video's own sound for voices, then dip every track's volume
 * there (as automation, one undo step), by an amount you pick.
 */
export const DialogueDipButton: React.FC<{ labelled?: boolean }> = ({ labelled = false }) => {
  const [busy, setBusy] = React.useState(false);
  const [found, setFound] = React.useState<Span[] | null>(null);
  const [depth, setDepth] = React.useState(DEFAULT_DIP.depth);
  const find = async () => {
    const { video } = useVideoStore.getState();
    if (!video) return;
    setBusy(true);
    try {
      const spans = await findDialogue(video.file);
      if (!spans.length) showToast('No dialogue found in the video\'s sound.');
      else setFound(spans);
    } catch (err) {
      showToast(`Couldn't listen to the video: ${err instanceof Error ? err.message : String(err)}.`);
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    const start = useVideoStore.getState().start;
    const n = useTimelineStore.getState().dipUnderDialogue(
      found!.map((s) => ({ start: start + s.start, end: start + s.end })),
      { ...DEFAULT_DIP, depth }
    );
    showToast(`Dipped ${n} track${n === 1 ? '' : 's'} by ${depth} dB under ${found!.length} line${found!.length === 1 ? '' : 's'} of dialogue (volume automation; Ctrl+Z takes it out).`);
    setFound(null);
  };
  const talk = found ? found.reduce((t, s) => t + s.end - s.start, 0) : 0;
  return (
    <>
      <button
        type="button"
        onClick={() => void find()}
        disabled={busy}
        title="Dip under dialogue: turn the music down wherever people talk in the video"
        aria-label="Dip the music under the video's dialogue"
        className={labelled ? PANEL_BUTTON : 'hover:text-forge-text shrink-0 disabled:opacity-50'}
      >
        <MessageSquareText className={`w-3.5 h-3.5 ${busy ? 'animate-pulse' : ''}`} />
        {labelled && (busy ? 'Listening…' : 'Dip under dialogue')}
      </button>
      {found && (
        <Modal title="Dip under dialogue" onClose={() => setFound(null)}>
          <div className="flex flex-col gap-3 p-4 text-xs text-forge-muted">
            <p>
              Found {found.length} stretch{found.length === 1 ? '' : 'es'} of talking ({talk.toFixed(1)} s in all), from {found[0].start.toFixed(1)} s to{' '}
              {found[found.length - 1].end.toFixed(1)} s into the video. The music dips there, starting a moment before each line and coming back
              half a second after it.
            </p>
            <label className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-12 uppercase">Dip</span>
              <input type="range" min={3} max={24} step={1} value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="flex-1 accent-cyan-400" aria-label="How far the music dips" />
              <span className="w-14 text-right text-forge-text">-{depth} dB</span>
            </label>
            <p className="text-[11px]">
              It's written as volume automation on every track, so you can see it, change it, and it's in your exports. A track that already has a volume
              lane keeps its shape, lowered in the dips. Note that a volume lane takes over from the track's fader.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setFound(null)} className="h-8 px-3 rounded-md border border-forge-border hover:text-forge-text">
                Cancel
              </button>
              <button type="button" onClick={apply} className="h-8 px-3 rounded-md border border-cyan-400/60 bg-cyan-500/15 text-cyan-100 font-semibold hover:bg-cyan-500/25">
                Dip the music
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
