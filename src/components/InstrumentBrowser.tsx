import React, { useState } from 'react';
import * as Tone from 'tone';
import { Library, Loader2 } from 'lucide-react';
import { INSTRUMENTS, instrumentsByCategory, isDrumKind } from '../audio/instrumentCatalog';
import type { InstrumentKey } from '../audio/instrumentCatalog';
import { auditionInstrument, DRUM_NOTES, safely } from '../audio/instruments';
import { auditionInput, initAudio } from '../audio/engine';
import { useAudioStore } from '../store/audioStore';
import { useTimelineStore } from '../store/timelineStore';
import { setDragPayload } from '../store/dragSounds';
import type { DragPayload } from '../store/dragSounds';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

const DRUM_PADS = [
  { note: DRUM_NOTES.kick, label: 'Kick' },
  { note: DRUM_NOTES.snare, label: 'Snare' },
  { note: DRUM_NOTES.closedHat, label: 'Closed Hat' },
  { note: DRUM_NOTES.openHat, label: 'Open Hat' },
  { note: DRUM_NOTES.cowbell, label: 'Cowbell' },
];

/** Two octaves starting on a C near the middle of the instrument's range. */
function keyboardFor(key: InstrumentKey): number[] {
  const [lo, hi] = INSTRUMENTS[key].range;
  const mid = Math.round((lo + hi) / 2);
  let start = Math.floor((mid - 12) / 12) * 12;
  start = Math.max(Math.ceil(lo / 12) * 12, Math.min(start, hi - 24));
  return Array.from({ length: 25 }, (_, i) => start + i).filter((m) => m >= lo && m <= hi);
}

/** Play one note on a dry copy of the instrument (same build and level as a track's). */
async function audition(key: InstrumentKey, note: string, duration: string) {
  await initAudio();
  const inst = auditionInstrument(key, auditionInput);
  try {
    await inst.ready; // sampled instruments download on first use
  } catch {
    return; // download failed: the status badge says so
  }
  safely(() => inst.play([{ note, duration, velocity: 0.85 }], Tone.now()));
}

function dragProps(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      setDragPayload(e, payload);
      useTimelineStore.getState().setDraggingInstrument(payload.instrument);
    },
    onDragEnd: () => useTimelineStore.getState().setDraggingInstrument(null),
  };
}

/**
 * Try any instrument: pick one, click keys to hear it, drag a key onto a matching track to
 * drop that note in. Sampled instruments download their recordings on first play.
 */
export const InstrumentBrowser: React.FC = () => {
  const [key, setKey] = useState<InstrumentKey>('rhodes');
  const [lit, setLit] = useState<string | null>(null);
  const status = useAudioStore((s) => s.instrumentStatus[key]);
  const def = INSTRUMENTS[key];
  const drums = isDrumKind(key);
  const duration = drums ? '16n' : '4n';

  const hit = (note: string) => {
    setLit(note);
    setTimeout(() => setLit((n) => (n === note ? null : n)), 160);
    void audition(key, note, duration);
  };

  const pad = (note: string, label: string, extra: string, style?: React.CSSProperties) => (
    <button
      key={note}
      type="button"
      onPointerDown={() => hit(note)}
      {...dragProps({ kind: 'sound', instrument: key, label: `${def.name} ${label}`, notes: [note], duration, velocity: 0.85 })}
      title={`${label}: click to play, drag onto a ${def.name} track`}
      className={`${extra} transition-transform ${lit === note ? 'scale-95 brightness-125' : ''}`}
      style={style}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-forge-panel border border-forge-border rounded-xl p-4 shadow-lg flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Library className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-forge-text font-mono">Instrument Browser</h2>
        </div>
        <select
          value={key}
          onChange={(e) => setKey(e.target.value as InstrumentKey)}
          className="h-8 bg-forge-bg border border-forge-border rounded-md px-2 text-xs font-semibold text-white focus:outline-none focus:border-cyan-500"
          aria-label="Instrument to try"
        >
          {instrumentsByCategory().map(({ category, instruments }) => (
            <optgroup key={category} label={category}>
              {instruments
                .filter((i) => i.kind !== 'custom')
                .map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <span className="text-[11px] text-forge-muted">{def.blurb}</span>
        {status === 'loading' && (
          <span className="flex items-center gap-1 text-[11px] text-amber-300">
            <Loader2 className="w-3 h-3 animate-spin" /> Downloading samples…
          </span>
        )}
        {status === 'error' && <span className="text-[11px] text-red-400">Couldn't download the samples. Check your connection.</span>}
        <span className="ml-auto text-[11px] text-forge-muted hidden md:inline">Click to play • drag onto a matching track</span>
      </div>

      {drums ? (
        <div className="grid grid-cols-5 gap-2">
          {DRUM_PADS.map((p) =>
            pad(p.note, p.label, 'h-14 rounded-lg border font-mono text-xs font-bold text-white bg-forge-bg hover:brightness-125', {
              borderColor: def.color,
              boxShadow: `inset 0 -3px 0 ${def.color}66`,
            })
          )}
        </div>
      ) : (
        <div className="flex gap-[2px] overflow-x-auto pb-1" role="group" aria-label={`${def.name} keyboard`}>
          {keyboardFor(key).map((m) => {
            const n = noteName(m);
            const black = isBlack(m);
            return pad(
              n,
              n,
              `shrink-0 w-9 h-20 rounded-b-md border text-[9px] font-mono flex items-end justify-center pb-1 ${
                black ? 'bg-zinc-900 text-zinc-400 border-zinc-700 h-14' : 'bg-zinc-100 text-zinc-600 border-zinc-300'
              }`,
              lit === n ? { backgroundColor: def.color, color: '#000' } : undefined
            );
          })}
        </div>
      )}
    </div>
  );
};
