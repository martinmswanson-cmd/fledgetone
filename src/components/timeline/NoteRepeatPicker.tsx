/**
 * The MIDI popover's NOTE REPEAT choice: off, or the rate a held drum pad repeats at (1/8 to 1/32
 * and their triplets), for finger drumming on a pad controller or the computer keyboard.
 */
import React from 'react';
import { useMidiStore } from '../../store/midiStore';
import { NOTE_REPEAT_RATES } from '../../store/noteRepeat';
import type { NoteRepeatSetting } from '../../store/noteRepeat';

export const NoteRepeatPicker: React.FC = () => {
  const rate = useMidiStore((m) => m.noteRepeat);
  return (
    <label
      data-search="note repeat finger drumming pad roll repeat hats"
      className="flex items-center gap-2 text-forge-text"
      title="Finger drumming: hold a pad and its drum repeats at this rate, on the song's grid while it plays (pad pressure sets the loudness). On drum kits, the Drum Rack and the Slicer; recorded like any other hits."
    >
      Note repeat
      <select
        value={rate}
        onChange={(e) => useMidiStore.getState().setNoteRepeat(e.target.value as NoteRepeatSetting)}
        className="h-7 bg-forge-bg border border-forge-border rounded-md px-2 text-xs font-mono text-forge-text focus:outline-none focus:border-cyan-500"
        aria-label="Note repeat rate"
      >
        <option value="off">Off</option>
        {NOTE_REPEAT_RATES.map((r) => (
          <option key={r} value={r}>{r.endsWith('T') ? `${r.slice(0, -1)} triplet` : r}</option>
        ))}
      </select>
    </label>
  );
};
