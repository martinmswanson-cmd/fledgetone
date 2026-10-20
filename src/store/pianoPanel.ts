/**
 * The on-screen piano (PianoPanel.tsx): whether it's open, and note entry, where each key played
 * goes into the open piano roll at a cursor that then moves on (PianoRoll.tsx). Opening it turns
 * the computer keyboard piano on (midiStore); closing it turns it back off, unless it was on before.
 */
import { create } from 'zustand';
import { useMidiStore } from './midiStore';

interface PianoPanelState {
  open: boolean;
  /** Keys played go into the open piano roll, one step after another */
  noteEntry: boolean;
  /** The keyboard piano was already on when the panel opened (closing leaves it on) */
  pianoWasOn: boolean;
  setOpen: (open: boolean) => void;
  setNoteEntry: (on: boolean) => void;
}

export const usePianoPanel = create<PianoPanelState>((set, get) => ({
  open: false,
  noteEntry: false,
  pianoWasOn: false,
  setOpen: (open) => {
    if (open === get().open) return;
    const midi = useMidiStore.getState();
    if (open) {
      set({ open, pianoWasOn: midi.keyboardPiano });
      midi.setKeyboardPiano(true);
    } else {
      if (!get().pianoWasOn) midi.setKeyboardPiano(false);
      set({ open, noteEntry: false });
    }
  },
  setNoteEntry: (noteEntry) => {
    if (noteEntry) get().setOpen(true);
    set({ noteEntry });
  },
}));

// The computer keyboard piano switched off elsewhere (the MIDI popover): the panel goes with it
useMidiStore.subscribe((s, before) => {
  if (before.keyboardPiano && !s.keyboardPiano && usePianoPanel.getState().open) usePianoPanel.setState({ open: false, noteEntry: false });
});
