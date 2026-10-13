/**
 * Chop to Slicer: cut an audio clip's sound into slices on a new Slicer track, with a clip that
 * plays them back in order.
 */
import React from 'react';
import { useTimelineStore, songTempo } from '../../store/timelineStore';
import { tempoAt } from '../../audio/tempoMap';
import { soundStatusText, useSoundLibrary } from '../../audio/soundLibrary';
import { audioSourceSeconds } from '../../store/audioClips';
import { slicerFor, resliced } from '../../audio/slicerTools';
import { SLICE_COUNTS } from '../../store/timelineTypes';
import type { SliceCount } from '../../store/timelineTypes';
import { Modal } from './Modal';
import { showToast } from './toastStore';

const choice =
  'text-left rounded-lg border border-forge-border bg-forge-bg px-3 py-2.5 hover:border-cyan-500/70 hover:bg-cyan-500/10 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus:border-cyan-500';

/**
 * "Chop to Slicer": cut an audio clip's sound into slices (at its transients, or into equal
 * parts) on a new Slicer track, with a clip that plays the slices in order where the audio clip is.
 */
export const ChopToSlicerDialog: React.FC<{ clipId: string; onClose: () => void }> = ({ clipId, onClose }) => {
  const clip = useTimelineStore((s) => s.clips.find((c) => c.id === clipId));
  const bpm = useTimelineStore((s) => (clip ? tempoAt(clip.startBar, songTempo(s)) : s.bpm));
  const status = useSoundLibrary((s) => (clip?.audio ? s.status[clip.audio.soundId] : undefined));
  const meta = useSoundLibrary((s) => (clip?.audio ? s.metas[clip.audio.soundId] : undefined));
  if (!clip?.audio) return null;
  const ready = status === 'ready' && !!meta;

  const chop = (mode: 'auto' | 'equal', count: SliceCount = 8) => {
    if (!clip.audio || !meta) return;
    const offset = clip.audio.offset;
    const part = { start: offset, end: Math.min(meta.seconds, offset + audioSourceSeconds(clip, bpm)) };
    const settings = resliced({ ...slicerFor(meta, part), mode, count });
    const trackId = useTimelineStore.getState().chopClipToSlicer(clip.id, settings);
    if (trackId) showToast(`Chopped "${clip.name}" into ${settings.slices.length} slice${settings.slices.length === 1 ? '' : 's'} on a new Slicer track.`);
    onClose();
  };

  return (
    <Modal title={`Chop "${clip.name}" to Slicer`} onClose={onClose}>
      <p>
        The part of the sound this clip plays goes onto a new Slicer track, cut into slices (one per key from C3 up), with a
        clip that plays them in order. The audio clip stays as it is.
      </p>
      {!ready && <p className="text-amber-300">{soundStatusText(status)}</p>}
      <button type="button" className={choice} onClick={() => chop('auto')} disabled={!ready} autoFocus>
        <div className="text-sm font-semibold text-forge-text">Auto: at the transients</div>
        <div className="mt-0.5 text-[11px] text-forge-muted">A slice starts wherever the sound jumps: each word, hit or pluck.</div>
      </button>
      <div className="grid grid-cols-4 gap-2">
        {SLICE_COUNTS.map((n) => (
          <button key={n} type="button" className={`${choice} text-center`} onClick={() => chop('equal', n)} disabled={!ready}>
            <div className="text-sm font-semibold text-forge-text">{n}</div>
            <div className="mt-0.5 text-[11px] text-forge-muted">equal slices</div>
          </button>
        ))}
      </div>
    </Modal>
  );
};
