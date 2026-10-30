import { liveMix } from './engine';
import { getLiveInstrument } from './liveTracks';
import { DRUM_NOTES, safely } from './instruments';
import type { NoteOff, TrackInstrument, VoiceControl } from './instruments';
import { DROP_ROWS, isDropKind, isDrumKind, isMixKind, isRackKind, isSlicerKind } from './instrumentCatalog';
import { noteRepeatOff, noteRepeatOn, noteRepeatPressure, stopNoteRepeats } from './noteRepeat';
import { liveTransport } from './liveContext';
import { heardTime, outputLatencySeconds } from './latency';
import { decodeMidi, midiNoteLabel, midiNoteName, MPE_BEND_RANGE_CENTS, PIANO_OCTAVE_KEYS, PITCH_BEND_RANGE_CENTS, pianoKeyNote } from './midi';
import type { MidiMessage } from './midi';
import { recordMidi, setPedalSource } from './recorder';
import { setMetronomeOn, setMetronomeVolume } from './metronome';
import { useMidiStore, ALL_INPUTS, midiConnectedBefore } from '../store/midiStore';
import type { MidiInputInfo } from '../store/midiStore';
import { useTimelineStore } from '../store/timelineStore';
import { handleMidiCc } from '../store/midiLearn';
import type { Track } from '../store/timelineTypes';
import { RACK_BASE_NOTE, RACK_PADS } from '../store/timelineTypes';
import { isSliderKey, isTextEntry } from '../components/keyboard';

/**
 * Playing the timeline's instruments live: from a MIDI keyboard (Web MIDI) or the computer
 * keyboard. Notes go to the armed track's instrument, or the selected track's when none is
 * armed, through its channel strip, and are triggered straight on the audio clock (not through
 * the Transport) so they sound at once. Whatever is played also goes to the take being recorded
 * (recorder.ts), stamped with the audio time at which the listener heard it (latency.ts).
 */

/** Velocity the computer keyboard plays at (100 of 127). */
const KEYBOARD_VELOCITY = 100 / 127;

/** The live context's clock: the global context is the export's while a WAV export sets up. */
const liveContext = () => liveMix.bus.context;
const liveNow = () => liveContext().rawContext.currentTime;

/** The kits' rows (kick C1, snare D1...), by note name. */
const DRUM_ROWS = new Set<string>(Object.values(DRUM_NOTES));

/**
 * The note name a MIDI note plays on `track`. On a drum kit, a note that isn't one of its rows
 * is tried an octave down: the kits' rows sit an octave below the General MIDI drum map (kick 36,
 * snare 38, closed hat 42, open hat 46, cowbell 56), so a keyboard's drum pads land on them.
 */
export function noteNameOn(midi: number, track: Track | undefined): string {
  // A Drum Rack's pads are C2 up: any octave of the keyboard plays them, 16 keys to the pads
  if (track && isRackKind(track.instrumentKey)) return midiNoteName(RACK_BASE_NOTE + (((midi - RACK_BASE_NOTE) % RACK_PADS) + RACK_PADS) % RACK_PADS);
  // The Drop pad's six effects from C4 up: every key plays one of them (C4 to F4, then again)
  if (track && isDropKind(track.instrumentKey)) return DROP_ROWS[(((midi - 60) % DROP_ROWS.length) + DROP_ROWS.length) % DROP_ROWS.length].note;
  const name = midiNoteName(midi);
  if (!track || !isDrumKind(track.instrumentKey) || DRUM_ROWS.has(name)) return name;
  const below = midiNoteName(midi - 12);
  return DRUM_ROWS.has(below) ? below : name;
}

// ---------- playing ----------

/** Notes sounding now, by MIDI note number, with the function that ends each. */
const held = new Map<number, NoteOff>();
/**
 * The Drop pad's effects held from the keyboard, by MIDI note number: "<track id>|<row>" for as
 * long as the key (or the pedal, once it's let go) holds it. Several keys play the same effect,
 * and one already holding it keeps it alone.
 */
const holding = new Map<number, string>();
/**
 * MPE: the note each channel is playing, and its own controls (when the instrument has voices of
 * its own, see TrackInstrument.noteVoice). Channel 1 (0 here) is the keyboard's master channel:
 * its bend moves every note.
 */
const mpeNotes = new Map<number, { note: number; voice: VoiceControl | null }>();
/** Let go while the sustain pedal was down: ended when it comes up. */
const sustained = new Map<number, NoteOff>();
let pedal = false;
setPedalSource(() => pedal);

/** The track live notes play on: the armed one, else the selected one. */
function targetTrack(): Track | undefined {
  const s = useTimelineStore.getState();
  const track = s.tracks.find((t) => t.isArmed) ?? s.tracks.find((t) => t.id === s.selectedTrackId);
  // A bus or a return plays no instrument
  return track && !isMixKind(track.instrumentKey) ? track : undefined;
}

/**
 * Start `note` on `instrument` as a held key. An instrument without noteOn (one that plays
 * one-shots, or an older one) plays the note as a short sequenced note instead.
 */
function startNote(instrument: TrackInstrument, note: { note: string; duration: string; velocity: number }, time: number): NoteOff {
  if (instrument.noteOn) return instrument.noteOn(note, time);
  instrument.play([note], time);
  return () => {};
}

function endNote(midi: number, at: number): void {
  holding.delete(midi);
  const off = held.get(midi);
  if (off) {
    held.delete(midi);
    safely(() => off(at));
  }
  const waiting = sustained.get(midi);
  if (waiting) {
    sustained.delete(midi);
    safely(() => waiting(at));
  }
}

// ---------- listening to what's played ----------

/** A key played or let go, live (a MIDI keyboard, the computer keyboard or the on-screen piano). */
export interface LiveNote {
  on: boolean;
  midi: number;
  velocity: number;
}
const noteListeners = new Set<(note: LiveNote) => void>();
const emitNote = (note: LiveNote) => noteListeners.forEach((l) => safely(() => l(note)));

/** Hear every key played live (the on-screen piano lights them, note entry writes them). Returns a stop function. */
export function onLiveNote(listener: (note: LiveNote) => void): () => void {
  noteListeners.add(listener);
  return () => noteListeners.delete(listener);
}

/** A key of the on-screen piano pressed (or let go), played like a key of the computer keyboard. */
export function pressScreenKey(midi: number, down: boolean): void {
  const message: MidiMessage = down ? { kind: 'noteOn', note: midi, velocity: KEYBOARD_VELOCITY } : { kind: 'noteOff', note: midi };
  playMidi(message, heardTime());
  useMidiStore.getState().noteActivity(describe(message));
}

/** Play `message` now (live), and record it as heard at `heard` (a drum pad as the row it played, see noteNameOn). */
export function playMidi(message: MidiMessage, heard: number): void {
  const now = liveNow();
  const track = targetTrack();
  // The instrument is looked up per message: undefined while the track is muted or soloed out
  const instrument = track ? getLiveInstrument(track.id) : undefined;
  let recorded = message;
  switch (message.kind) {
    case 'noteOn': {
      // Struck again while still sounding (or sustained): the earlier one ends first
      endNote(message.note, now);
      const name = noteNameOn(message.note, track);
      // On the Drop pad several keys hold the same effect: one already held by another key keeps
      // it, and this one does nothing (no second, stacked move in a take or the piano roll)
      const drop = track && isDropKind(track.instrumentKey) ? `${track.id}|${name}` : null;
      if (drop && [...holding.entries()].some(([k, v]) => k !== message.note && v === drop)) {
        // (The piano roll still hears the key: it's note entry's to write, on its own clip)
        emitNote({ on: true, midi: message.note, velocity: message.velocity });
        return;
      }
      if (drop) holding.set(message.note, drop);
      const mpe = useMidiStore.getState().mpe && message.channel !== undefined && message.channel > 0;
      if (instrument) {
        const note = { note: name, duration: '4n', velocity: message.velocity };
        if (mpe && instrument.noteVoice) {
          // Its own voice, so its channel's bend and pressure move it alone
          safely(() => {
            const voice = instrument.noteVoice!(note, now);
            mpeNotes.set(message.channel!, { note: message.note, voice });
            held.set(message.note, (at) => voice?.off(at));
          });
        } else {
          safely(() => held.set(message.note, startNote(instrument, note, now)));
          if (mpe) mpeNotes.set(message.channel!, { note: message.note, voice: null });
        }
      }
      recorded = { ...message, name };
      emitNote({ on: true, midi: message.note, velocity: message.velocity });
      // Note repeat: a held pad on a kit, the Drum Rack or the Slicer plays again at the rate until let go
      const rate = useMidiStore.getState().noteRepeat;
      if (rate !== 'off' && track && instrument && (isDrumKind(track.instrumentKey) || isRackKind(track.instrumentKey) || isSlicerKind(track.instrumentKey))) {
        noteRepeatOn({
          midi: message.note,
          name,
          trackId: track.id,
          rate,
          velocity: message.velocity,
          struckAt: now,
          struckTick: liveTransport.state === 'started' ? liveTransport.getTicksAtTime(heard) : null,
          now: liveNow,
        });
      }
      break;
    }
    case 'noteOff': {
      emitNote({ on: false, midi: message.note, velocity: 0 });
      noteRepeatOff(message.note);
      if (message.channel !== undefined && mpeNotes.get(message.channel)?.note === message.note) mpeNotes.delete(message.channel);
      const off = held.get(message.note);
      if (!off) {
        // (Nothing sounding to hold on: a muted track's key lets go of its effect too, once the
        // pedal does if it's down, as the take holds the note till then)
        if (pedal && holding.has(message.note)) sustained.set(message.note, () => {});
        else holding.delete(message.note);
        break;
      }
      held.delete(message.note);
      if (pedal) sustained.set(message.note, off);
      else {
        holding.delete(message.note);
        safely(() => off(now));
      }
      break;
    }
    case 'sustain':
      pedal = message.down;
      if (!pedal) {
        for (const [key, off] of sustained) {
          holding.delete(key);
          safely(() => off(now));
        }
        sustained.clear();
      }
      break;
    case 'pitchBend': {
      const own = useMidiStore.getState().mpe && message.channel ? mpeNotes.get(message.channel) : undefined;
      if (own) {
        // An MPE note's own bend (its range is 48 semitones)
        const cents = (message.cents / PITCH_BEND_RANGE_CENTS) * MPE_BEND_RANGE_CENTS;
        if (own.voice) safely(() => own.voice!.bend(cents, now));
        else if (instrument?.bend) safely(() => instrument.bend!(cents, now));
        recorded = { kind: 'noteExpr', note: own.note, lane: 'bend', value: cents / 100 };
        break;
      }
      // In MPE only the master channel bends every note: a member channel with no note held
      // (its bend comes just before the note, or after it ended) bends nothing
      if (useMidiStore.getState().mpe && message.channel) break;
      if (instrument?.bend) safely(() => instrument.bend!(message.cents, now));
      break;
    }
    case 'pressure': {
      // A repeating pad's pressure sets its repeats' loudness (channel pressure: every pad's)
      noteRepeatPressure(message.note, message.value);
      const own = message.note !== undefined ? [...mpeNotes.values()].find((m) => m.note === message.note) : message.channel ? mpeNotes.get(message.channel) : undefined;
      if (!own) break;
      if (own.voice) safely(() => own.voice!.pressure(message.value, now));
      recorded = { kind: 'noteExpr', note: own.note, lane: 'pressure', value: message.value };
      break;
    }
    case 'allNotesOff':
      releaseLiveNotes();
      break;
    case 'mod':
      // An instrument recorded at several loudnesses plays the wheel as dynamics (the take records it as usual)
      if (instrument?.dynamics) safely(() => instrument.dynamics!(message.value, now));
      break;
    case 'cc':
      // (A plugin gets it as MIDI; a mapped setting has already followed it, see midiLearn.ts)
      // (Played live: kept as the player left it where the song resets the controllers, see wamPlugin.ts)
      if (instrument?.cc) safely(() => instrument.cc!(message.cc, message.value, now, true));
      break;
  }
  recordMidi(recorded, heard);
}

/** End every note being played live (Stop, a window losing focus, a panic). */
export function releaseLiveNotes(): void {
  stopNoteRepeats();
  const now = liveNow();
  for (const off of held.values()) safely(() => off(now));
  for (const off of sustained.values()) safely(() => off(now));
  held.clear();
  sustained.clear();
  holding.clear();
  mpeNotes.clear();
  pedal = false;
}

/** What the activity readout shows for a message. */
function describe(message: MidiMessage): string {
  switch (message.kind) {
    case 'noteOn':
      return midiNoteLabel(message.note, message.velocity);
    case 'noteOff':
      return `${midiNoteName(message.note)} off`;
    case 'sustain':
      return message.down ? 'sustain down' : 'sustain up';
    case 'pitchBend':
      return `bend ${message.cents >= 0 ? '+' : ''}${Math.round(message.cents)} cents`;
    case 'mod':
      return `mod wheel ${Math.round(message.value * 100)}%`;
    case 'allNotesOff':
      return 'all notes off';
    case 'cc':
      return `CC ${message.cc} ${Math.round(message.value * 127)}`;
    case 'pressure':
      return `pressure ${Math.round(message.value * 100)}%`;
    case 'noteExpr':
      return `${midiNoteName(message.note)} ${message.lane}`;
  }
}

// ---------- Web MIDI ----------

let access: MIDIAccess | null = null;
const listening = new Set<MIDIInput>();

function describeInputs(): MidiInputInfo[] {
  if (!access) return [];
  return [...access.inputs.values()].map((input) => ({
    id: input.id,
    name: input.name || input.manufacturer || 'MIDI input',
    state: input.state,
  }));
}

function onMidiMessage(this: MIDIInput, e: MIDIMessageEvent): void {
  const { inputId } = useMidiStore.getState();
  if (inputId !== ALL_INPUTS && this.id !== inputId) return;
  if (!e.data) return;
  const message = decodeMidi(e.data);
  if (!message) return;
  // Heard time first: the event's own stamp says when the key went down
  const heard = heardTime(e.timeStamp);
  // A knob or fader: MIDI learn, mapped settings, automation writing
  if (message.kind === 'cc') {
    // A knob not mapped to anything (or learning) is recorded into the take's controller lanes
    if (!handleMidiCc(message.cc, message.value)) playMidi(message, heard);
  } else playMidi(message, heard);
  useMidiStore.getState().noteActivity(describe(message));
}

/** Listen to every input the browser knows (the chosen one is filtered per message). */
function listenToInputs(): void {
  if (!access) return;
  const current = new Set(access.inputs.values());
  for (const input of listening) {
    if (current.has(input)) continue;
    input.removeEventListener('midimessage', onMidiMessage as EventListener);
    listening.delete(input);
  }
  for (const input of current) {
    if (listening.has(input)) continue;
    input.addEventListener('midimessage', onMidiMessage as EventListener);
    listening.add(input);
  }
  useMidiStore.getState().setInputs(describeInputs());
}

/**
 * Ask the browser for the MIDI devices (Chrome and Edge have them; Firefox asks the user first;
 * Safari has no Web MIDI). The result shows in the MIDI popover. Safe to call again.
 */
export async function connectMidi(): Promise<void> {
  const store = useMidiStore.getState();
  if (access) {
    listenToInputs();
    return;
  }
  if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
    store.setSupport('unsupported');
    return;
  }
  store.setSupport('requesting');
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch {
    useMidiStore.getState().setSupport('denied');
    return;
  }
  access.addEventListener('statechange', listenToInputs);
  listenToInputs();
  useMidiStore.getState().setSupport('ready');
}

// ---------- the computer keyboard as a piano ----------

/** Keys down, by physical key, with the note each plays (the octave may change while it's held). */
const keysDown = new Map<string, number>();

/** True when a key press should be left alone: typing, a slider, or a dialog other than the MIDI popover. */
function keyboardBusy(e: KeyboardEvent): boolean {
  if (isTextEntry(e.target)) return true;
  if (e.target instanceof HTMLInputElement && e.target.type === 'range' && isSliderKey(e)) return true;
  return document.querySelector('[role="dialog"]:not([aria-label="MIDI input"])') !== null;
}

function onKeyDown(e: KeyboardEvent): void {
  const midiState = useMidiStore.getState();
  if (!midiState.keyboardPiano || e.ctrlKey || e.metaKey || e.altKey || keyboardBusy(e)) return;
  const octaveStep = PIANO_OCTAVE_KEYS[e.code];
  if (octaveStep !== undefined) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) midiState.setOctave(midiState.octave + octaveStep);
    return;
  }
  const note = pianoKeyNote(e.code, midiState.octave);
  if (note === null) return;
  // Taken over from the shortcuts (the deck's pads, V and C...) while the piano is on
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat || keysDown.has(e.code)) return;
  keysDown.set(e.code, note);
  const message: MidiMessage = { kind: 'noteOn', note, velocity: KEYBOARD_VELOCITY };
  playMidi(message, heardTime(e.timeStamp));
  midiState.noteActivity(describe(message));
}

/** A piano key let go: its note ends (and the readout says so, as it does for a MIDI key). */
function keyboardNoteOff(note: number, heard: number): void {
  const message: MidiMessage = { kind: 'noteOff', note };
  playMidi(message, heard);
  useMidiStore.getState().noteActivity(describe(message));
}

function onKeyUp(e: KeyboardEvent): void {
  const note = keysDown.get(e.code);
  if (note === undefined) return;
  keysDown.delete(e.code);
  e.preventDefault();
  e.stopImmediatePropagation();
  keyboardNoteOff(note, heardTime(e.timeStamp));
}

/** Keys let go while the page wasn't listening (the window lost focus) would ring on. */
function releaseKeyboardNotes(): void {
  const now = heardTime();
  for (const note of keysDown.values()) keyboardNoteOff(note, now);
  keysDown.clear();
}

// ---------- installation ----------

/**
 * Hook live input up for as long as the timeline is mounted: the keyboard piano, MIDI devices
 * (asked for at once if the user connected them before), the metronome following its settings,
 * and the output latency readout. Returns an uninstall function.
 */
export function installLiveInput(): () => void {
  // Capture phase, so a piano key never reaches the deck's pads or the timeline's shortcuts
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', releaseKeyboardNotes);

  const options = () => useTimelineStore.getState().recordOptions;
  setMetronomeVolume(options().metronomeVolume);
  setMetronomeOn(options().metronome);
  const unsubscribe = useTimelineStore.subscribe((state, prev) => {
    if (state.recordOptions !== prev.recordOptions) {
      setMetronomeVolume(state.recordOptions.metronomeVolume);
      setMetronomeOn(state.recordOptions.metronome);
    }
    // Stop and Pause let every voice go (releaseAllVoices): forget the keys held with them
    if (state.isPlaying !== prev.isPlaying && !state.isPlaying) releaseLiveNotes();
  });
  // A piano switched off mid-chord: let the keys go
  const unsubscribeMidi = useMidiStore.subscribe((state, prev) => {
    if (state.keyboardPiano !== prev.keyboardPiano && !state.keyboardPiano) releaseKeyboardNotes();
  });
  const latency = () => useMidiStore.getState().setOutputLatency(liveContext().state === 'running' ? outputLatencySeconds() : null);
  latency();
  const latencyTimer = window.setInterval(latency, 2000);

  if (midiConnectedBefore) void connectMidi();

  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', releaseKeyboardNotes);
    unsubscribe();
    unsubscribeMidi();
    clearInterval(latencyTimer);
    releaseLiveNotes();
    setMetronomeOn(false);
  };
}
