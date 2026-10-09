/**
 * MIDI messages as the app understands them, and the computer keyboard's piano layout. Pure
 * functions: the Web MIDI access and the live playing are in liveInput.ts.
 */

/**
 * A channel message the app acts on (every channel is listened to). A note-on's `name` is the
 * note as the track plays it (a drum pad's row), filled in when it's played; the number stays
 * what the keyboard sent, which is what its note-off carries.
 */
export type MidiMessage =
  | { kind: 'noteOn'; note: number; velocity: number; name?: string }
  | { kind: 'noteOff'; note: number }
  | { kind: 'sustain'; down: boolean }
  | { kind: 'pitchBend'; cents: number }
  | { kind: 'allNotesOff' };

/** How far the bend wheel moves the pitch at full travel: two semitones, the common default. */
export const PITCH_BEND_RANGE_CENTS = 200;

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CONTROL_CHANGE = 0xb0;
const PITCH_BEND = 0xe0;
const CC_SUSTAIN = 64;
const CC_ALL_SOUND_OFF = 120;
const CC_ALL_NOTES_OFF = 123;

/**
 * Read one message from a MIDI input (the browser hands over whole messages, running status
 * resolved). Returns null for anything the app doesn't act on: other controllers, aftertouch,
 * program changes, clock. A note-on with velocity 0 is a note-off, as the MIDI spec allows.
 */
export function decodeMidi(data: ArrayLike<number>): MidiMessage | null {
  if (data.length < 2) return null;
  const status = data[0] & 0xf0;
  const d1 = data[1] & 0x7f;
  const d2 = data.length > 2 ? data[2] & 0x7f : 0;
  switch (status) {
    case NOTE_ON:
      return d2 > 0 ? { kind: 'noteOn', note: d1, velocity: d2 / 127 } : { kind: 'noteOff', note: d1 };
    case NOTE_OFF:
      return { kind: 'noteOff', note: d1 };
    case CONTROL_CHANGE:
      if (d1 === CC_SUSTAIN) return { kind: 'sustain', down: d2 >= 64 };
      if (d1 === CC_ALL_NOTES_OFF || d1 === CC_ALL_SOUND_OFF) return { kind: 'allNotesOff' };
      return null;
    case PITCH_BEND: {
      // 14 bits, 8192 is the centre
      const value = d1 | (d2 << 7);
      return { kind: 'pitchBend', cents: ((value - 8192) / 8192) * PITCH_BEND_RANGE_CENTS };
    }
    default:
      return null;
  }
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The note name the piano roll uses for a MIDI note number: 60 is C4, 61 C#4 (sharps, never flats). */
export function midiNoteName(midi: number): string {
  const n = Math.max(0, Math.min(127, Math.round(midi)));
  return `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

/** A short label for a note number, e.g. for the activity readout ("C4 · 100"). */
export function midiNoteLabel(midi: number, velocity: number): string {
  return `${midiNoteName(midi)} · ${Math.round(velocity * 127)}`;
}

/**
 * The computer keyboard as a piano, by physical key (KeyboardEvent.code), the layout most music
 * apps use: the home row A S D F G H J K L ; ' is an octave and a half of white keys from C, and
 * W E T Y U O P are the black keys above them. The value is semitones above the octave's C.
 */
export const PIANO_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
};

/** Z and X move the keyboard piano down and up an octave. */
export const PIANO_OCTAVE_KEYS: Readonly<Record<string, -1 | 1>> = { KeyZ: -1, KeyX: 1 };

/** Octaves the keyboard piano can sit on: its A key plays C of this octave (C3 is MIDI 48). */
export const PIANO_OCTAVE_MIN = 0;
export const PIANO_OCTAVE_MAX = 7;
export const DEFAULT_PIANO_OCTAVE = 3;

/** The MIDI note a physical key plays with the piano on `octave`, or null if it isn't a piano key. */
export function pianoKeyNote(code: string, octave: number): number | null {
  const semitone = PIANO_KEYS[code];
  if (semitone === undefined) return null;
  const clamped = Math.max(PIANO_OCTAVE_MIN, Math.min(PIANO_OCTAVE_MAX, octave));
  return (clamped + 1) * 12 + semitone;
}
