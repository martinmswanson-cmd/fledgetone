import React, { useState } from 'react';
import { AudioWaveform, Upload } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import { snapBar } from '../../store/timelineTypes';
import { MAX_SOUND_BYTES } from '../../audio/soundLibrary';
import { dropAudioFiles, pickAudioFiles } from '../timeline/audioFiles';
import { SoundLibraryFooter } from './SoundLibraryFooter';
import { VocalChainPanel } from './VocalChainPanel';

/** An Audio track's panel: load sound files as clips (at the playhead), and where the sounds live. */
export const AudioTrackPanel: React.FC<{ track: Track }> = ({ track }) => {
  const clipCount = useTimelineStore((s) => s.clips.filter((c) => c.trackId === track.id).length);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const files = await pickAudioFiles();
    if (!files.length) return;
    setBusy(true);
    try {
      const s = useTimelineStore.getState();
      await dropAudioFiles(track.id, snapBar(s.playheadPosition, s.snapGrid, s), files);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <div className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-sky-500/40 shadow-md">
      <div className="flex items-center gap-1.5">
        <AudioWaveform className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Audio clips</span>
        <span className="ml-auto text-[10px] font-mono text-forge-muted">{clipCount} clip{clipCount === 1 ? '' : 's'}</span>
      </div>
      <p className="text-[11px] text-forge-muted">
        Drop sound files (WAV, MP3, OGG, FLAC, M4A) onto this track's lane, or load them here at the playhead. A clip plays its file as
        recorded: drag its edges to trim, its top corners for the fades, and double-click it for gain.
      </p>
      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        className="h-8 flex items-center justify-center gap-1.5 rounded-md border border-sky-500/50 bg-sky-500/10 text-sky-200 text-xs font-mono hover:bg-sky-500/20 disabled:opacity-50"
      >
        <Upload className="w-3.5 h-3.5" />
        {busy ? 'Loading…' : 'Load audio…'}
      </button>
      <p className="text-[10px] text-forge-muted/80">Files up to {MAX_SOUND_BYTES / 1048576} MB. The clip keeps its length in seconds when the tempo changes.</p>
      <SoundLibraryFooter />
    </div>
    <VocalChainPanel track={track} />
    </>
  );
};
