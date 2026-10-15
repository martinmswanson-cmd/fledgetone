/**
 * The master reverb's room: the generated hall, or a recording of a real room (an impulse
 * response: a WAV of a clap or sweep in a hall, church, or studio) loaded from a file. The
 * recording goes into the sound library and is saved inside project files, as samples are.
 */
import React, { useState } from 'react';
import { Building2, X } from 'lucide-react';
import { useTimelineStore } from '../../store/timelineStore';
import { importSoundFile, SoundError, useSoundLibrary } from '../../audio/soundLibrary';
import { pickAudioFiles } from '../timeline/audioFiles';
import { ROOM_STYLE_IDS, ROOM_STYLES, type RoomStyle } from '../../audio/effects/roomIR';

export const RecordedRoom: React.FC = () => {
  const room = useTimelineStore((s) => s.masterReverbRoom);
  const name = useSoundLibrary((s) => (room ? s.metas[room]?.name : undefined));
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [file] = await pickAudioFiles(false);
    if (!file) return;
    setError(null);
    try {
      const meta = await importSoundFile(file, file.name);
      if (meta.seconds !== undefined && meta.seconds > 20) {
        setError(`${file.name} is ${Math.round(meta.seconds)} s long: a room recording is a few seconds of a clap or sweep dying away.`);
        return;
      }
      useTimelineStore.getState().setMasterReverbRoom(meta.id);
    } catch (err) {
      setError(err instanceof SoundError ? err.message : `Couldn't read ${file.name} as audio. Try a WAV file.`);
    }
  };

  return (
    <div data-search="recorded-room" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-xs font-mono">
        <Building2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="text-forge-muted">Room:</span>
        <span className="flex-1 truncate text-cyan-200 font-bold" title={room ? (name ?? 'A recorded room') : 'Made from the decay time'}>
          {room ? (name ?? 'Recorded room') : 'Generated hall'}
        </span>
        {room && (
          <button
            type="button"
            title="Back to the generated hall (its decay time works again)"
            aria-label="Use the generated hall"
            onClick={() => useTimelineStore.getState().setMasterReverbRoom(null)}
            className="p-0.5 rounded border border-forge-border text-forge-muted hover:text-white"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => void load()}
        title="Load a recording of a real room (an impulse response WAV): the reverb then sounds like that room. It's saved with the project."
        className="h-7 rounded border border-cyan-500/40 text-cyan-200 text-[11px] font-mono hover:bg-cyan-950/40 transition"
      >
        Use a recorded room…
      </button>
      {room && <p className="text-[10px] text-forge-muted leading-snug">The recording sets the length of the tail, so the decay time is set aside while it's in use.</p>}
      {error && <p role="alert" className="text-[10px] text-red-300 leading-snug">{error}</p>}
    </div>
  );
};

/** The kind of room the generated reverb is (see roomIR.ts): hall, chamber, church, studio or plate. */
export const RoomStylePicker: React.FC = () => {
  const style = useTimelineStore((s) => s.masterRoomStyle);
  const recorded = useTimelineStore((s) => s.masterReverbRoom !== null);
  return (
    <label className={`flex flex-col gap-1 text-[10px] font-mono text-forge-muted ${recorded ? 'opacity-45' : ''}`} title={recorded ? 'A recorded room is in use: remove it to use these' : undefined}>
      <span className="flex items-center gap-2">
        Room
        <select
          value={style}
          disabled={recorded}
          onChange={(e) => useTimelineStore.getState().setMasterRoomStyle(e.target.value as RoomStyle)}
          className="ml-auto h-6 bg-forge-bg border border-forge-border rounded px-1 text-[11px] text-forge-text"
        >
          {ROOM_STYLE_IDS.map((id) => (
            <option key={id} value={id}>
              {ROOM_STYLES[id].name}
            </option>
          ))}
        </select>
      </span>
      <span>{ROOM_STYLES[style].about}</span>
    </label>
  );
};
