/**
 * Pocket's Beat screen: a drum track's patterns. Big pads play each drum (and, with Rec on while
 * the song plays, write the hit into the pattern on the nearest 16th), and the step grid under
 * them turns 16ths on and off, a bar at a time. Patterns (the track's clips) can be added,
 * repeated after themselves, lengthened and deleted.
 */
import React, { useState } from 'react';
import { CircleDot, Copy, Plus, Trash2 } from 'lucide-react';
import { getAudiblePositionBar } from '../audio/transport';
import { useTimelineStore } from '../store/timelineStore';
import type { Clip, Track } from '../store/timelineTypes';
import { Card, pill, pillOn } from './pocketUi';
import { clipsOf, editorOf, pickClip, pocketNoteId, usePlayPosition, usePocket } from './pocketStore';
import { noteSteps, stepsPerBar, toggleStep } from './pocketGrid';
import { audition, DRUM_PADS } from './pocketSound';

/** Choose which track and which of its clips an editor shows, and manage its clips. */
export const ClipPicker: React.FC<{
  tracks: Track[];
  track: Track | null;
  clip: Clip | null;
  clips: Clip[];
  onTrack: (id: string) => void;
  onClip: (id: string) => void;
  newLength: number;
}> = ({ tracks, track, clip, clips, onTrack, onClip, newLength }) => {
  const s = useTimelineStore.getState;
  const addClip = () => {
    if (!track) return;
    const last = clips[clips.length - 1];
    const at = last ? last.startBar + last.lengthBars : s().loopRegion.inBar;
    const id = s().createEmptyClip(track.id, at, newLength);
    if (id) onClip(id);
  };
  const repeat = () => {
    if (!clip) return;
    s().selectClip(clip.id, false);
    const id = s().repeatSelection(1);
    s().clearSelection();
    if (id) {
      const copy = useTimelineStore.getState().clips.find((c) => c.trackId === clip.trackId && Math.abs(c.startBar - (clip.startBar + clip.lengthBars)) < 1e-6);
      if (copy) onClip(copy.id);
    }
  };
  const remove = () => {
    if (!clip) return;
    s().selectClip(clip.id, false);
    s().deleteSelectedClips();
  };
  return (
    <>
      {tracks.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {tracks.map((t) => (
            <button key={t.id} type="button" className={`${pill} shrink-0 ${t.id === track?.id ? pillOn : ''}`} onClick={() => onTrack(t.id)}>
              <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {clips.map((c) => (
          <button key={c.id} type="button" className={`${pill} shrink-0 !px-3 ${c.id === clip?.id ? pillOn : ''}`} onClick={() => onClip(c.id)}>
            Bar {Math.round(c.startBar * 100) / 100}
            <span className="text-[11px] text-forge-muted">{c.lengthBars} bar{c.lengthBars === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className={`${pill} flex-1`} onClick={addClip} disabled={!track}>
          <Plus className="w-4 h-4" /> New
        </button>
        <button type="button" className={`${pill} flex-1`} onClick={repeat} disabled={!clip}>
          <Copy className="w-4 h-4" /> Repeat
        </button>
        <select
          aria-label="Length in bars"
          className={`${pill} !px-2 bg-forge-panel`}
          value={clip?.lengthBars ?? 1}
          disabled={!clip}
          onChange={(e) => clip && s().trimClipEnd(clip.id, Number(e.target.value))}
        >
          {[1, 2, 4, 8].map((n) => (
            <option key={n} value={n}>
              {n} bar{n === 1 ? '' : 's'}
            </option>
          ))}
          {clip && ![1, 2, 4, 8].includes(clip.lengthBars) && <option value={clip.lengthBars}>{clip.lengthBars} bars</option>}
        </select>
        <button type="button" aria-label="Delete this clip" className={pill} onClick={remove} disabled={!clip}>
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </>
  );
};

/** Which bar of a clip the grid shows, with buttons for each when there are several. */
export const BarPager: React.FC<{ bars: number; page: number; onPage: (n: number) => void }> = ({ bars, page, onPage }) =>
  bars > 1 ? (
    <div className="flex gap-1.5 overflow-x-auto mb-2">
      {Array.from({ length: bars }, (_, i) => (
        <button key={i} type="button" className={`${pill} !h-9 !px-3 shrink-0 ${i === page ? pillOn : ''}`} onClick={() => onPage(i)}>
          {i + 1}
        </button>
      ))}
    </div>
  ) : null;

export const PocketBeat: React.FC = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const allClips = useTimelineStore((s) => s.clips);
  const meter = useTimelineStore((s) => s.meter);
  const playhead = useTimelineStore((s) => s.playheadPosition);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const { beatTrackId, beatClipId } = usePocket();
  const [rec, setRec] = useState(false);
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(0);
  const bar = usePlayPosition();

  const drumTracks = tracks.filter((t) => editorOf(t.instrumentKey) === 'beat');
  const track = drumTracks.find((t) => t.id === beatTrackId) ?? drumTracks[0] ?? null;
  const clips = clipsOf(allClips, track?.id ?? null);
  const clip = pickClip(clips, beatClipId, playhead);
  const perBar = stepsPerBar(meter);
  const pages = clip ? Math.max(1, Math.ceil(clip.lengthBars - 1e-6)) : 1;
  const shownPage = Math.min(page, pages - 1);
  const rows = more ? DRUM_PADS : DRUM_PADS.slice(0, 5);

  // The step playing now, when the song is inside this clip
  const inClip = clip && bar >= clip.startBar && bar < clip.startBar + clip.lengthBars;
  const nowStep = inClip ? Math.floor((bar - clip.startBar) * perBar) : -1;
  // While playing, the grid follows the bar that's playing
  const followPage = isPlaying && inClip ? Math.floor(nowStep / perBar) : shownPage;

  if (!track) {
    return (
      <Card title="No drums yet">
        <p className="text-sm text-forge-muted mb-3">Add a drum kit to write a beat.</p>
        <button
          type="button"
          className={`${pill} w-full !border-cyan-400 text-cyan-200`}
          onClick={() => {
            const s = useTimelineStore.getState();
            const id = s.addTrack('drums');
            const clipId = useTimelineStore.getState().createEmptyClip(id, s.loopRegion.inBar, 1);
            usePocket.getState().set({ beatTrackId: id, beatClipId: clipId });
          }}
        >
          <Plus className="w-4 h-4" /> Add drums
        </button>
      </Card>
    );
  }

  const hit = (note: string) => {
    void audition(track.id, note);
    if (!rec || !isPlaying || !clip) return;
    const at = getAudiblePositionBar();
    if (at < clip.startBar || at >= clip.startBar + clip.lengthBars) return;
    const steps = Math.round(clip.lengthBars * perBar);
    const step = Math.round((at - clip.startBar) * perBar) % steps;
    const notes = useTimelineStore.getState().clips.find((c) => c.id === clip.id)?.notes ?? [];
    if (notes.some((n) => n.note === note && Math.round(n.startOffset * perBar) === step)) return;
    useTimelineStore.getState().addNotes(clip.id, [{ note, startOffset: step / perBar, duration: '16n', velocity: 0.85 }]);
  };

  const toggle = (note: string, step: number) => {
    if (!clip) return;
    const s = useTimelineStore.getState();
    const before = s.clips.find((c) => c.id === clip.id)?.notes ?? [];
    const after = toggleStep(before, note, step, perBar, 1, 0.85, pocketNoteId);
    s.checkpoint();
    s.setClipNotes(clip.id, after);
    if (after.length > before.length) void audition(track.id, note);
  };

  const steps = Array.from({ length: perBar }, (_, i) => followPage * perBar + i);
  const beatEvery = Math.max(1, Math.round(perBar / meter.num));

  return (
    <>
      <Card title="Pattern">
        <ClipPicker
          tracks={drumTracks}
          track={track}
          clip={clip}
          clips={clips}
          newLength={1}
          onTrack={(id) => usePocket.getState().set({ beatTrackId: id, beatClipId: null })}
          onClip={(id) => usePocket.getState().set({ beatTrackId: track.id, beatClipId: id })}
        />
      </Card>
      <div className="grid grid-cols-4 gap-2 mb-3">
        {DRUM_PADS.map((p) => (
          <button
            key={p.note}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              hit(p.note);
            }}
            className="aspect-square rounded-2xl border border-white/10 text-sm font-semibold active:brightness-150 active:scale-95 transition"
            style={{ background: `linear-gradient(160deg, ${p.color}55, ${p.color}22)` }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={rec}
          onClick={() => setRec(!rec)}
          className={`aspect-square rounded-2xl border text-sm font-semibold flex flex-col items-center justify-center gap-1 ${rec ? 'border-red-400 bg-red-500/25 text-red-200' : 'border-forge-border bg-forge-panel text-forge-muted'}`}
        >
          <CircleDot className="w-5 h-5" />
          Rec
        </button>
      </div>
      {rec && <p className="text-[11px] text-forge-muted -mt-1 mb-3">With Rec on, pads you play while the song plays inside this pattern are written into it.</p>}
      {clip && (
        <Card title="Steps" right={<button type="button" className={`${pill} !h-9`} onClick={() => setMore(!more)}>{more ? 'Fewer' : 'More'} sounds</button>}>
          <BarPager bars={pages} page={followPage} onPage={setPage} />
          <div className="space-y-1">
            {rows.map((r) => (
              <div key={r.note} className="flex items-center gap-1">
                <span className="w-14 shrink-0 text-[11px] text-forge-muted truncate">{r.label}</span>
                <div className="flex-1 grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${perBar}, minmax(0, 1fr))` }}>
                  {steps.map((step) => {
                    const on = clip.notes.some((n) => n.note === r.note && Math.round(n.startOffset * perBar) === step && noteSteps(n, perBar) > 0);
                    const beat = (step % perBar) % beatEvery === 0;
                    return (
                      <button
                        key={step}
                        type="button"
                        aria-label={`${r.label}, step ${step + 1}`}
                        aria-pressed={on}
                        onClick={() => toggle(r.note, step)}
                        className={`h-9 rounded-[5px] ${step === nowStep ? 'ring-2 ring-white/70' : ''}`}
                        style={{ background: on ? r.color : beat ? '#2a2a31' : '#1d1d22' }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
};
