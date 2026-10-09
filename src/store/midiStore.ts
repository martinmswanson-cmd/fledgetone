import { create } from 'zustand';
import { DEFAULT_PIANO_OCTAVE, PIANO_OCTAVE_MAX, PIANO_OCTAVE_MIN } from '../audio/midi';

/**
 * MIDI input state for the MIDI popover: whether the browser gave the app its MIDI devices,
 * which input is listened to, the last activity, and the computer keyboard piano. The choices
 * are kept per browser (a MIDI keyboard belongs to the computer, not the project).
 */

/** How the Web MIDI request went: not asked yet, asking, no API (Safari), refused, or ready. */
export type MidiSupport = 'unknown' | 'requesting' | 'unsupported' | 'denied' | 'ready';

export interface MidiInputInfo {
  id: string;
  name: string;
  /** Plugged in ('connected') or known but unplugged ('disconnected'). */
  state: string;
}

/** Listen to every input. */
export const ALL_INPUTS = 'all';

export interface MidiActivity {
  /** performance.now() of the message */
  at: number;
  /** What it was, e.g. "C4 · 100", "sustain", "bend" */
  text: string;
}

interface MidiState {
  support: MidiSupport;
  inputs: MidiInputInfo[];
  /** The input listened to (ALL_INPUTS, or an input id). */
  inputId: string;
  activity: MidiActivity | null;
  /** The computer keyboard plays notes (and takes over the letter keys it uses). */
  keyboardPiano: boolean;
  /** The octave the keyboard piano's A key plays C in. */
  octave: number;
  /** Seconds the sound takes to reach the listener after it's rendered, as measured by the browser; null until audio runs. */
  outputLatency: number | null;

  setSupport: (support: MidiSupport) => void;
  setInputs: (inputs: MidiInputInfo[]) => void;
  setInputId: (inputId: string) => void;
  noteActivity: (text: string) => void;
  setKeyboardPiano: (on: boolean) => void;
  setOctave: (octave: number) => void;
  setOutputLatency: (seconds: number | null) => void;
}

const MIDI_KEY = 'bos-beat-box.midi';

interface MidiPrefs {
  inputId: string;
  octave: number;
  /** The user connected MIDI before: ask the browser for the devices again at startup. */
  connected: boolean;
}

export function readMidiPrefs(): MidiPrefs {
  const d: MidiPrefs = { inputId: ALL_INPUTS, octave: DEFAULT_PIANO_OCTAVE, connected: false };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(MIDI_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return d;
    const r = raw as Record<string, unknown>;
    return {
      inputId: typeof r.inputId === 'string' ? r.inputId : d.inputId,
      octave: typeof r.octave === 'number' ? Math.max(PIANO_OCTAVE_MIN, Math.min(PIANO_OCTAVE_MAX, Math.round(r.octave))) : d.octave,
      connected: r.connected === true,
    };
  } catch {
    return d;
  }
}

export function writeMidiPrefs(prefs: MidiPrefs): void {
  try {
    localStorage.setItem(MIDI_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked: the choice lasts for this page
  }
}

const prefs = readMidiPrefs();

export const useMidiStore = create<MidiState>((set, get) => {
  const remember = () => writeMidiPrefs({ inputId: get().inputId, octave: get().octave, connected: get().support === 'ready' });
  return {
    support: typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'unknown' : 'unsupported',
    inputs: [],
    inputId: prefs.inputId,
    activity: null,
    keyboardPiano: false,
    octave: prefs.octave,
    outputLatency: null,

    setSupport: (support) => {
      set({ support });
      remember();
    },
    setInputs: (inputs) => set({ inputs }),
    setInputId: (inputId) => {
      set({ inputId });
      remember();
    },
    noteActivity: (text) => set({ activity: { at: performance.now(), text } }),
    setKeyboardPiano: (on) => set({ keyboardPiano: on }),
    setOctave: (octave) => {
      set({ octave: Math.max(PIANO_OCTAVE_MIN, Math.min(PIANO_OCTAVE_MAX, Math.round(octave))) });
      remember();
    },
    // Polled every couple of seconds: only a change is worth a notification
    setOutputLatency: (seconds) => {
      if (seconds !== get().outputLatency) set({ outputLatency: seconds });
    },
  };
});

/** Whether to ask the browser for MIDI devices at startup (the user connected them before). */
export const midiConnectedBefore = prefs.connected;
