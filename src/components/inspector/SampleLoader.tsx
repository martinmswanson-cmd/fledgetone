/**
 * The Sampler instrument's panel: load a sound file and choose the key that plays it at its own
 * pitch.
 */
import React, { useState } from 'react';
import { FileAudio, Play, Trash2, Upload } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import { importSoundFile, MAX_SOUND_BYTES, SoundError } from '../../audio/soundLibrary';
import { previewTrackNotes } from '../../audio/liveTracks';
import { initAudio } from '../../audio/engine';
import { pickAudioFiles } from '../timeline/audioFiles';
import { SoundLibraryFooter } from './SoundLibraryFooter';

const ROOT_NOTES = ['C2', 'C3', 'C4', 'C5', 'C6'];

/**
 * The Sampler instrument's sound: load a WAV / MP3 / OGG from your computer, choose the note that
 * plays it at its original pitch, and every other note plays it higher or lower. The sound goes
 * into the browser's sound library (shared, kept by content) and is saved inside project files.
 */
export const SampleLoader: React.FC<{ track: Track }> = ({ track }) => {
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'error'; text?: string }>({ kind: 'idle' });
  const sample = track.sample;

  const load = async () => {
    const [file] = await pickAudioFiles(false);
    if (!file) return;
    setStatus({ kind: 'busy', text: 'Loading…' });
    try {
      const meta = await importSoundFile(file, file.name);
      useTimelineStore.getState().setTrackSample(track.id, { name: file.name, soundId: meta.id, root: sample?.root ?? 'C4' });
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof SoundError ? err.message : `Couldn't read ${file.name} as audio. Try a WAV, MP3 or OGG file.` });
    }
  };

  const preview = async () => {
    if (!sample) return;
    await initAudio();
    previewTrackNotes(track.id, [{ note: sample.root, duration: '2n', velocity: 0.9 }]);
  };

  return (
    <div className="flex flex-col gap-2 bg-forge-bg p-2.5 rounded-lg border border-teal-500/40 shadow-md">
      <div className="flex items-center gap-1.5">
        <FileAudio className="w-3.5 h-3.5 text-teal-400" />
        <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-white">Your Sound</span>
      </div>

      {sample ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="flex-1 truncate text-forge-text font-semibold" title={sample.name}>
            {sample.name}
          </span>
          <button type="button" onClick={() => void preview()} className="p-1 rounded border border-forge-border text-forge-muted hover:text-white" title="Play at its original pitch">
            <Play className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => useTimelineStore.getState().setTrackSample(track.id, undefined)}
            className="p-1 rounded border border-forge-border text-forge-muted hover:text-red-300"
            title="Remove this sound"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-forge-muted">Load a sound from your computer, then play it on any note in the piano roll.</p>
      )}

      <button
        type="button"
        onClick={() => void load()}
        disabled={status.kind === 'busy'}
        className="h-8 flex items-center justify-center gap-1.5 rounded-md border border-teal-500/50 bg-teal-500/10 text-teal-200 text-xs font-mono hover:bg-teal-500/20 disabled:opacity-50"
      >
        <Upload className="w-3.5 h-3.5" />
        {status.kind === 'busy' ? status.text : sample ? 'Replace sound…' : 'Load a sound…'}
      </button>

      {sample && (
        <label className="flex items-center gap-2 text-[10px] font-mono text-forge-muted">
          <span className="uppercase">Original pitch on</span>
          <select
            value={sample.root}
            onChange={(e) => useTimelineStore.getState().setTrackSample(track.id, { ...sample, root: e.target.value })}
            className="h-6 bg-forge-panel border border-forge-border rounded px-1 text-forge-text"
          >
            {ROOT_NOTES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      {status.kind === 'error' && <p className="text-[11px] text-red-400">{status.text}</p>}
      <p className="text-[10px] text-forge-muted/80">Sounds are kept in this browser and saved inside the project file. Max {MAX_SOUND_BYTES / 1048576} MB.</p>
      <SoundLibraryFooter />
    </div>
  );
};
