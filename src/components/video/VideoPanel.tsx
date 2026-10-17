import React from 'react';
import { Clapperboard, Crosshair, Download, Eye, EyeOff, Film, Scissors, Volume2, VolumeX, X } from 'lucide-react';
import { useVideoStore } from '../../store/videoStore';
import { useSongTempo, useTimelineStore } from '../../store/timelineStore';
import { useUiStore } from '../../store/uiStore';
import { secondsToBar } from '../../audio/transport';
import { VideoButton } from './VideoButton';
import { DialogueDipButton, FindCutsButton } from './VideoLane';
import { ExportForEditors } from '../timeline/MarkerList';
import { press } from '../../search/reveal';

/**
 * The Video tab of the dock: everything for scoring to picture in one place: the reference video,
 * finding its cuts and its dialogue, hit points and the tempo finder, cut-downs, and handing the
 * markers (or the finished music on the video) back to the editor.
 */

const BUTTON = 'h-8 px-3 flex items-center gap-1.5 rounded-md border border-forge-border bg-forge-bg text-forge-text hover:border-cyan-400/60 disabled:opacity-50';

const clock = (s: number) => {
  const c = Math.round(s * 100);
  return `${Math.floor(c / 6000)}:${((c % 6000) / 100).toFixed(2).padStart(5, '0')}`;
};

const Card: React.FC<{ title: string; children: React.ReactNode; label?: string }> = ({ title, children, label }) => (
  <section className="flex flex-col gap-2 rounded-lg border border-forge-border bg-forge-bg/50 p-3 min-w-0" aria-label={label ?? title}>
    <h4 className="text-[10px] font-mono uppercase tracking-wider text-forge-muted">{title}</h4>
    {children}
  </section>
);

export const VideoPanel: React.FC = () => {
  const video = useVideoStore((s) => s.video);
  const start = useVideoStore((s) => s.start);
  const previewOpen = useVideoStore((s) => s.previewOpen);
  const muted = useVideoStore((s) => s.muted);
  const bpm = useSongTempo();
  const markers = useTimelineStore((s) => s.markers);
  const hits = markers.filter((m) => m.anchor === 'time').length;
  const missing = useVideoStore((s) => s.missing);
  const v = useVideoStore.getState();

  return (
    <div className="grid gap-3 p-3 text-xs text-forge-muted md:grid-cols-2 xl:grid-cols-4" role="region" aria-label="Video tools">
      <Card title="Reference video">
        <div className="flex flex-wrap items-center gap-2">
          <VideoButton />
          {video && (
            <>
              <button type="button" className={BUTTON} onClick={() => v.setPreviewOpen(!previewOpen)} title={previewOpen ? 'Hide the preview window' : 'Show the preview window'}>
                {previewOpen ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />} Preview
              </button>
              <button type="button" className={BUTTON} onClick={() => v.setMuted(!muted)} title={muted ? "Hear the video's own sound" : "Mute the video's own sound"}>
                {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />} Sound
              </button>
              <button type="button" className={`${BUTTON} hover:!border-red-400/60`} onClick={v.remove} title="Remove the video">
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
        {video ? (
          <div className="flex flex-col gap-1 text-[11px]">
            <span className="text-forge-text truncate" title={video.name}>
              <Clapperboard className="inline w-3.5 h-3.5 mr-1 text-amber-400" />
              {video.name}
            </span>
            <span>
              {clock(video.duration)} long · {video.width}×{video.height}
            </span>
            <label className="flex items-center gap-2">
              Starts at
              <input
                type="number"
                step={0.01}
                value={Number(start.toFixed(3))}
                onChange={(e) => v.setStart(Number(e.target.value) || 0)}
                className="w-20 h-6 bg-forge-bg border border-forge-border rounded px-1 text-forge-text"
                aria-label="Where the video starts in the song (seconds)"
              />
              s · bar {secondsToBar(start, bpm).toFixed(2)}
            </label>
            <span>Drag the film strip on the timeline to move it too. The video is saved in this browser and in project files.</span>
          </div>
        ) : missing ? (
          <p className="text-[11px] text-amber-200">
            This project scores to <b>{missing.name}</b> (from {missing.start.toFixed(2)} s), which isn't in this browser: load it again with Video and it goes back where it was.
          </p>
        ) : (
          <p className="text-[11px]">Load gameplay, a trailer or a cut: it plays in sync with the playhead, as a strip under the ruler and in a preview window. You can also drop a video file on the page.</p>
        )}
      </Card>

      <Card title="Find in the video">
        <div className="flex flex-wrap gap-2">
          {video ? (
            <>
              <FindCutsButton labelled />
              <DialogueDipButton labelled />
            </>
          ) : (
            <p className="text-[11px]">Load a video to find its hard cuts (a hit point on each) and where people talk (the music dips there).</p>
          )}
        </div>
        <p className="text-[11px]">Cuts become hit points: markers locked to time, so they stay put when the tempo changes.</p>
      </Card>

      <Card title="Hit points and tempo">
        <p className="text-[11px]">
          {hits ? `${hits} hit point${hits === 1 ? '' : 's'}` : 'No hit points yet'} · {markers.length} marker{markers.length === 1 ? '' : 's'} in all. Shift+M drops a hit point at the playhead.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BUTTON}
            onClick={async () => {
              if (await press('button[title^="Fit to time"]')) await press('[aria-label="What to fit"] button:last-child');
            }}
            title="Find tempos that put your hit points on the beat"
          >
            <Crosshair className="w-3.5 h-3.5" /> Tempo finder
          </button>
          <button type="button" className={BUTTON} onClick={() => useUiStore.getState().setDialog('cut')} title="A 6, 15, 30, 60 or 90-second version, cut at the sections">
            <Scissors className="w-3.5 h-3.5" /> Cut to length
          </button>
        </div>
      </Card>

      <Card title="Back to the edit" label="Export for editors">
        {markers.length ? <ExportForEditors /> : <p className="text-[11px]">Add markers (M) or hit points to export them for Premiere, Resolve or Final Cut.</p>}
        <button type="button" className={BUTTON} onClick={() => useUiStore.getState().setDialog('export')} title="Render the music, or the music on the video as an MP4">
          {video ? <Film className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />} {video ? 'Export music onto the video' : 'Export the music'}
        </button>
      </Card>
    </div>
  );
};
