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
  /** The key the pointer is over on the on-screen piano (the piano roll outlines where it would go) */
  hoverMidi: number | null;
  setHoverMidi: (midi: number | null) => void;
  /** The keyboard piano was already on when the panel opened (closing leaves it on) */
  pianoWasOn: boolean;
  setOpen: (open: boolean) => void;
  setNoteEntry: (on: boolean) => void;
}

export const usePianoPanel = create<PianoPanelState>((set, get) => ({
  open: false,
  noteEntry: false,
  hoverMidi: null,
  setHoverMidi: (hoverMidi) => get().hoverMidi !== hoverMidi && set({ hoverMidi }),
  pianoWasOn: false,
  setOpen: (open) => {
    if (open === get().open) return;
    const midi = useMidiStore.getState();
    if (open) {
      set({ open, pianoWasOn: midi.keyboardPiano });
      midi.setKeyboardPiano(true);
    } else {
      if (!get().pianoWasOn) midi.setKeyboardPiano(false);
      set({ open, noteEntry: false, hoverMidi: null });
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

/**
 * What the open piano roll does to notes with its keys (Ctrl+C, X, V, D, Del, Ctrl+A, Esc), so
 * the Edit menu does the same to notes while a clip is open there instead of to the clip.
 */
export interface NoteEditActions {
  /** How many notes are selected */
  selected: () => number;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  duplicate: () => void;
  remove: () => void;
  selectAll: () => void;
  selectNone: () => void;
}

let noteActions: NoteEditActions | null = null;

/** The open piano roll's note actions (null: no note clip is open). */
export const noteEditActions = (): NoteEditActions | null => noteActions;

/** Register the open piano roll's note actions. Returns the function that takes them away again. */
export function setNoteEditActions(actions: NoteEditActions): () => void {
  noteActions = actions;
  return () => {
    if (noteActions === actions) noteActions = null;
  };
}
