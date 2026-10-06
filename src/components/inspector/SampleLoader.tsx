import React, { useRef, useState } from 'react';
import { FileAudio, Play, Trash2, Upload } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import type { Track } from '../../store/timelineTypes';
import { loadCustomSample } from '../../audio/samplers/samplerManager';
import { previewTrackNotes } from '../../audio/liveTracks';
import { initAudio } from '../../audio/engine';

/** Big sounds bloat the project file and can't be autosaved by the browser (~5 MB limit). */
const MAX_BYTES = 3 * 1024 * 1024;
const ROOT_NOTES = ['C2', 'C3', 'C4', 'C5', 'C6'];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * The Sampler instrument's sound: load a WAV / MP3 / OGG from your computer, choose the note that
 * plays it at its original pitch, and every other note plays it higher or lower. The sound is
 * stored inside the project, so saved projects bring it along.
 */
export const SampleLoader: React.FC<{ track: Track }> = ({ track }) => {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'error'; text?: string }>({ kind: 'idle' });
  const sample = track.sample;

  const load = async (file: File) => {
    if (file.size > MAX_BYTES) {
      setStatus({ kind: 'error', text: `That file is ${(file.size / 1048576).toFixed(1)} MB. Please use a sound under 3 MB (trim it, or save it as MP3).` });
      return;
    }
    setStatus({ kind: 'busy', text: 'Loading…' });
    try {
      const dataUrl = await readAsDataUrl(file);
      await loadCustomSample(dataUrl); // make sure the browser can actually decode it
      useTimelineStore.getState().setTrackSample(track.id, { name: file.name, dataUrl, root: sample?.root ?? 'C4' });
      setStatus({ kind: 'idle' });
    } catch {
      setStatus({ kind: 'error', text: `Couldn't read ${file.name} as audio. Try a WAV, MP3 or OGG file.` });
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
        onClick={() => input.current?.click()}
        disabled={status.kind === 'busy'}
        className="h-8 flex items-center justify-center gap-1.5 rounded-md border border-teal-500/50 bg-teal-500/10 text-teal-200 text-xs font-mono hover:bg-teal-500/20 disabled:opacity-50"
      >
        <Upload className="w-3.5 h-3.5" />
        {status.kind === 'busy' ? status.text : sample ? 'Replace sound…' : 'Load a sound…'}
      </button>
      <input
        ref={input}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.m4a,.aif,.aiff,.flac"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void load(file);
        }}
      />

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
      <p className="text-[10px] text-forge-muted/80">Sounds are saved inside the project file. Max 3 MB.</p>
    </div>
  );
};
