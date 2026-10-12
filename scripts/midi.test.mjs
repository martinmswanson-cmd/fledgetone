// Unit tests for the MIDI message decoder and the computer keyboard's piano layout
// (src/audio/midi.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);
const { decodeMidi, midiNoteName, midiNoteLabel, pianoKeyNote, PIANO_KEYS, PIANO_OCTAVE_KEYS, PITCH_BEND_RANGE_CENTS } = await import('../src/audio/midi.ts');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('note on and off, on any channel, with velocity scaled to 0..1', () => {
  assert.deepEqual(decodeMidi([0x90, 60, 127]), { kind: 'noteOn', note: 60, velocity: 1 });
  near(decodeMidi([0x95, 61, 64]).velocity, 64 / 127);
  assert.deepEqual(decodeMidi([0x80, 60, 64]), { kind: 'noteOff', note: 60 });
  assert.deepEqual(decodeMidi([0x8f, 60]), { kind: 'noteOff', note: 60 });
  // Note-on with velocity 0 is a note-off (running status keyboards send these)
  assert.deepEqual(decodeMidi([0x90, 60, 0]), { kind: 'noteOff', note: 60 });
  assert.deepEqual(decodeMidi(new Uint8Array([0x91, 72, 100])), { kind: 'noteOn', note: 72, velocity: 100 / 127 });
});

test('sustain pedal, mod wheel, all notes off, pitch bend; other messages are ignored', () => {
  assert.deepEqual(decodeMidi([0xb0, 64, 127]), { kind: 'sustain', down: true });
  assert.deepEqual(decodeMidi([0xb0, 64, 63]), { kind: 'sustain', down: false });
  assert.deepEqual(decodeMidi([0xb0, 64, 64]), { kind: 'sustain', down: true });
  assert.deepEqual(decodeMidi([0xb0, 123, 0]), { kind: 'allNotesOff' });
  assert.deepEqual(decodeMidi([0xb0, 120, 0]), { kind: 'allNotesOff' });
  // Centre, full up, full down (14 bits, little end first)
  assert.deepEqual(decodeMidi([0xe0, 0x00, 0x40]), { kind: 'pitchBend', cents: 0 });
  near(decodeMidi([0xe0, 0x7f, 0x7f]).cents, PITCH_BEND_RANGE_CENTS * (8191 / 8192));
  near(decodeMidi([0xe0, 0x00, 0x00]).cents, -PITCH_BEND_RANGE_CENTS);
  assert.deepEqual(decodeMidi([0xb0, 1, 127]), { kind: 'mod', value: 1 });
  assert.equal(decodeMidi([0xb0, 7, 64]), null); // channel volume
  assert.equal(decodeMidi([0xc0, 5]), null); // program change
  assert.equal(decodeMidi([0xd0, 5]), null); // aftertouch
  assert.equal(decodeMidi([0xf8]), null); // clock
  assert.equal(decodeMidi([]), null);
  assert.equal(decodeMidi([0x90]), null);
});

test('note names are the piano roll\'s (C4 is 60, sharps only), clamped to the MIDI range', () => {
  assert.equal(midiNoteName(60), 'C4');
  assert.equal(midiNoteName(61), 'C#4');
  assert.equal(midiNoteName(24), 'C1');
  assert.equal(midiNoteName(30), 'F#1');
  assert.equal(midiNoteName(44), 'G#2');
  assert.equal(midiNoteName(0), 'C-1');
  assert.equal(midiNoteName(127), 'G9');
  assert.equal(midiNoteName(200), 'G9');
  assert.equal(midiNoteName(-5), 'C-1');
  assert.equal(midiNoteLabel(60, 100 / 127), 'C4 · 100');
});

test('the keyboard piano: A is C of the octave, W the C# above, up to the quote key; Z and X shift octaves', () => {
  assert.equal(pianoKeyNote('KeyA', 3), 48); // C3
  assert.equal(pianoKeyNote('KeyW', 3), 49);
  assert.equal(pianoKeyNote('KeyK', 3), 60); // C4
  assert.equal(pianoKeyNote('Quote', 3), 65); // F4
  assert.equal(pianoKeyNote('KeyA', 4), 60);
  assert.equal(pianoKeyNote('KeyQ', 3), null); // not a piano key (a deck pad)
  assert.equal(pianoKeyNote('Digit1', 3), null);
  // Octaves outside the range are clamped
  assert.equal(pianoKeyNote('KeyA', -3), 12);
  assert.equal(pianoKeyNote('KeyA', 9), 96);
  assert.equal(Object.keys(PIANO_KEYS).length, 18);
  assert.deepEqual(PIANO_OCTAVE_KEYS, { KeyZ: -1, KeyX: 1 });
  // Every semitone from C to F an octave up, once each
  assert.deepEqual([...new Set(Object.values(PIANO_KEYS))].sort((a, b) => a - b), Array.from({ length: 18 }, (_, i) => i));
});
