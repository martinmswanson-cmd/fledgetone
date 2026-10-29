/**
 * The on-screen piano: the computer keyboard's piano keys drawn as a keyboard, each with the
 * letter that plays it, lit while played (from the keyboard, a MIDI keyboard or a click). Its
 * octave buttons are Z and X. With a piano roll open, **Note entry** writes each key played into
 * it at a cursor that moves on (PianoRoll.tsx), so a melody can be typed in rather than placed
 * note by note with the mouse. State in pianoPanel.ts; the playing itself in liveInput.ts.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Piano, X } from 'lucide-react';
import { onLiveNote, pressScreenKey } from '../audio/liveInput';
import { midiNoteName, PIANO_KEYS, PIANO_OCTAVE_MAX, PIANO_OCTAVE_MIN } from '../audio/midi';
import { useAudioStore } from '../store/audioStore';
import { useMidiStore } from '../store/midiStore';
import { usePianoPanel } from '../store/pianoPanel';
import { useTimelineStore } from '../store/timelineStore';

/** The letter printed on a key, by physical key code */
const LABEL: Record<string, string> = { Semicolon: ';', Quote: "'" };
const labelOf = (code: string) => LABEL[code] ?? code.replace('Key', '');

const KEYS = Object.entries(PIANO_KEYS)
  .map(([code, semitone]) => ({ code, semitone, black: [1, 3, 6, 8, 10].includes(semitone % 12) }))
  .sort((a, b) => a.semitone - b.semitone);
const WHITES = KEYS.filter((k) => !k.black);
const WHITE_W = 44;

export const PianoPanel: React.FC = () => {
  const open = usePianoPanel((s) => s.open);
  const noteEntry = usePianoPanel((s) => s.noteEntry);
  const octave = useMidiStore((s) => s.octave);
  const audioRunning = useAudioStore((s) => s.audioState === 'running');
  const editing = useTimelineStore((s) => {
    const clip = s.clips.find((c) => c.id === s.editingClipId);
    return clip && !clip.audio ? clip : null;
  });
  const [lit, setLit] = useState<ReadonlySet<number>>(new Set());
  /** Where it was dragged to (its top-left corner), or null for the bottom-right corner */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The note each pointer (mouse, finger) is holding down */
  const pressed = useRef(new Map<number, number>());
  /** Drag it by its top row to anywhere on screen */
  const drag = (e: React.PointerEvent) => {
    const el = panelRef.current;
    if (!el || (e.target as HTMLElement).closest('button, input, label')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const from = { x: e.clientX - r.left, y: e.clientY - r.top };
    const move = (ev: PointerEvent) =>
      setPos({
        left: Math.max(8, Math.min(window.innerWidth - r.width - 8, ev.clientX - from.x)),
        top: Math.max(8, Math.min(window.innerHeight - r.height - 8, ev.clientY - from.y)),
      });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    if (!open) return;
    setLit(new Set());
    return onLiveNote((n) =>
      setLit((now) => {
        const next = new Set(now);
        if (n.on) next.add(n.midi);
        else next.delete(n.midi);
        return next;
      })
    );
  }, [open]);

  if (!open) return null;
  const base = (octave + 1) * 12;
  const setOctave = (o: number) => useMidiStore.getState().setOctave(Math.max(PIANO_OCTAVE_MIN, Math.min(PIANO_OCTAVE_MAX, o)));
  const press = (midi: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    // Before the audio runs, a click starts it (the key sounds from the next click on)
    if (!audioRunning) {
      void useAudioStore.getState().initializeAudio();
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pressed.current.set(e.pointerId, midi);
    pressScreenKey(midi, true);
  };
  /** The key this pointer pressed lets go (the note it played, even if the octave changed since) */
  const release = (e: React.PointerEvent) => {
    const midi = pressed.current.get(e.pointerId);
    if (midi === undefined) return;
    pressed.current.delete(e.pointerId);
    pressScreenKey(midi, false);
  };

  return (
    <div
      ref={panelRef}
      role="region"
      aria-label="Piano"
      data-piano-panel
      // (clear of the Suggestions panel when it's open: --agent-panel-w is its width then)
      style={pos ?? { bottom: '1rem', right: 'calc(var(--agent-panel-w, 0px) + 1rem)' }}
      className={`fixed z-[70] hidden md:flex flex-col gap-2 rounded-xl border border-forge-borderLight bg-forge-panel/95 shadow-2xl shadow-black/60 p-3 text-xs text-forge-muted`}
    >
      <div className="flex items-center gap-2 cursor-grab active:cursor-grabbing" onPointerDown={drag} title="Drag to move it">
        <Piano className="w-4 h-4 text-cyan-300" />
        <span className="font-semibold text-forge-text">Piano</span>
        <div className="flex items-center gap-1 ml-2 font-mono" title="Z and X move it an octave down and up">
          <button type="button" onClick={() => setOctave(octave - 1)} className="h-6 px-1.5 rounded border border-forge-border hover:border-forge-borderLight" aria-label="Octave down">
            Z −
          </button>
          <span className="w-16 text-center text-forge-text">{midiNoteName(base)}–{midiNoteName(base + 17)}</span>
          <button type="button" onClick={() => setOctave(octave + 1)} className="h-6 px-1.5 rounded border border-forge-border hover:border-forge-borderLight" aria-label="Octave up">
            + X
          </button>
        </div>
        <label
          className={`ml-3 flex items-center gap-1.5 ${editing ? 'text-forge-text cursor-pointer' : 'opacity-50'}`}
          title={editing ? 'Each key you play goes into the piano roll at the cursor, which then moves on by the New note length' : 'Open a clip in the piano roll (double-click it) to type notes into it'}
        >
          <input type="checkbox" checked={noteEntry && !!editing} disabled={!editing} onChange={(e) => usePianoPanel.getState().setNoteEntry(e.target.checked)} />
          Note entry
        </label>
        <button type="button" onClick={() => usePianoPanel.getState().setOpen(false)} className="ml-auto text-forge-muted hover:text-white" aria-label="Close the piano" title="Close (the letter keys go back to their shortcuts)">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="relative select-none touch-none" style={{ width: WHITES.length * WHITE_W, height: 112 }}>
        {WHITES.map((k, i) => {
          const midi = base + k.semitone;
          return (
            <button
              key={k.code}
              type="button"
              tabIndex={-1}
              aria-label={`${midiNoteName(midi)} (${labelOf(k.code)})`}
              onPointerDown={press(midi)}
              onPointerEnter={() => usePianoPanel.getState().setHoverMidi(midi)}
              onPointerLeave={() => usePianoPanel.getState().setHoverMidi(null)}
              onPointerUp={release}
              onPointerCancel={release}
              className={`absolute top-0 bottom-0 rounded-b-md border border-black/40 flex flex-col items-center justify-end pb-1.5 font-mono ${lit.has(midi) ? 'bg-cyan-300 text-black' : 'bg-zinc-100 text-zinc-500 hover:bg-white'}`}
              style={{ left: i * WHITE_W, width: WHITE_W - 2 }}
            >
              <span className="text-[13px] font-bold text-zinc-800">{labelOf(k.code)}</span>
              {k.semitone % 12 === 0 && <span className="text-[9px]">{midiNoteName(midi)}</span>}
            </button>
          );
        })}
        {KEYS.filter((k) => k.black).map((k) => {
          const midi = base + k.semitone;
          // Between the white keys either side of it
          const left = WHITES.findIndex((w) => w.semitone === k.semitone + 1) * WHITE_W - 14;
          return (
            <button
              key={k.code}
              type="button"
              tabIndex={-1}
              aria-label={`${midiNoteName(midi)} (${labelOf(k.code)})`}
              onPointerDown={press(midi)}
              onPointerEnter={() => usePianoPanel.getState().setHoverMidi(midi)}
              onPointerLeave={() => usePianoPanel.getState().setHoverMidi(null)}
              onPointerUp={release}
              onPointerCancel={release}
              className={`absolute top-0 z-10 rounded-b-md flex items-end justify-center pb-1 font-mono text-[11px] font-bold ${lit.has(midi) ? 'bg-cyan-400 text-black' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}
              style={{ left, width: 26, height: 68 }}
            >
              {labelOf(k.code)}
            </button>
          );
        })}
      </div>

      <p className="max-w-[484px] leading-snug">
        {!audioRunning
          ? 'Click a key (or START AUDIO) to hear it. '
          : ''}
        {noteEntry && editing
          ? 'Note entry: each key goes in at the cursor, keys held together make a chord. → leaves a gap, ← steps back, Backspace takes the last step out.'
          : 'Play with your keyboard: the letters on the keys. It plays the selected track (or the armed one), and Record keeps what you play.'}
      </p>
    </div>
  );
};
