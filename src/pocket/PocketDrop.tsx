/**
 * The Drop pad in Pocket's drawer: six big pads that do something to the whole mix for as long as
 * a finger holds them (stutter, a filter sweep, tape stop, crush, gate, an echo throw: see
 * effects/dropFx.ts). Several can be held at once. While the song plays, a press starts on the next
 * 16th and a let-go ends on one, so every move is in time. With Rec on while the section plays,
 * each move is written into the Drop track's cell, from where it started to where it was let go,
 * replacing what that effect had there; the song then plays it every time, in the studio and in
 * exports too. Under the pads, the section's moves, with the playhead.
 */
import React, { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { DROP_ROWS } from '../audio/instrumentCatalog';
import { audioNow, dropOff, dropOn, nextSixteenthAt } from '../audio/dropLive';
import { liveTransport } from '../audio/liveContext';
import { ticksToBar } from '../audio/transport';
import { durationToBars, type NoteEvent, type Track } from '../store/timelineTypes';
import { STEPS_PER_WHOLE } from './pocketGrid';
import { editCell, sectionNotes } from './pocketCell';
import type { PocketSection } from './pocketSections';
import { pocketNoteId, usePocket, usePlayPosition } from './pocketStore';
import { buzz } from './pocketSession';

const EPS = 1e-6;

/** Each pad's colour and what it does, in DROP_ROWS order. */
const PADS: Array<{ color: string; about: string }> = [
  { color: '#f43f5e', about: 'repeats the 16th' },
  { color: '#38bdf8', about: 'sweeps it down' },
  { color: '#f59e0b', about: 'slows to a stop' },
  { color: '#a3e635', about: 'gritty, lo-fi' },
  { color: '#c084fc', about: 'chops into 16ths' },
  { color: '#2dd4bf', about: 'throws an echo' },
];

/** The section's 16th at audio time `time` (null: the song isn't in the section then). */
function stepAt(time: number, sec: PocketSection): number | null {
  if (liveTransport.state !== 'started') return null;
  const bar = ticksToBar(liveTransport.getTicksAtTime(time));
  if (bar < sec.from - EPS || bar >= sec.to - EPS) return null;
  return Math.round((bar - sec.from) * STEPS_PER_WHOLE);
}

/** Seconds a 16th lasts now. */
const sixteenth = () => 15 / liveTransport.bpm.value;

/** Write a move into the cell: effect `row` from `from` for `steps` 16ths, over what that effect had there. */
function writeMove(track: Track, sec: PocketSection, note: string, from: number, steps: number): void {
  const to = from + steps;
  editCell(track.id, sec, (have) => [
    ...have.filter((n) => {
      if (n.note !== note) return true;
      const s = Math.round(n.startOffset * STEPS_PER_WHOLE);
      const e = s + Math.max(1, Math.round(durationToBars(n.duration) * STEPS_PER_WHOLE));
      return e <= from || s >= to;
    }),
    { id: pocketNoteId(), note, startOffset: from / STEPS_PER_WHOLE, duration: `0:0:${steps}`, velocity: 1 } satisfies NoteEvent,
  ]);
}

interface Hold {
  fx: number;
  /** Audio time the effect started */
  at: number;
  /** Where it's being written (Rec on, in the section), else null */
  step: number | null;
}

export const DropPads: React.FC<{ track: Track; sec: PocketSection }> = ({ track, sec }) => {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const rec = usePocket((p) => p.rec);
  const clips = useTimelineStore((s) => s.clips);
  const holds = useRef(new Map<number, Hold>());
  const [lit, setLit] = useState<ReadonlySet<number>>(new Set());
  const relight = () => setLit(new Set([...holds.current.values()].map((h) => h.fx)));
  const total = Math.max(1, Math.round((sec.to - sec.from) * STEPS_PER_WHOLE));
  const moves = sectionNotes(clips, track.id, sec);

  const press = (pointer: number, fx: number) => {
    buzz(10);
    const at = nextSixteenthAt(audioNow());
    dropOn(fx, at);
    const recording = usePocket.getState().rec && useTimelineStore.getState().isPlaying;
    holds.current.set(pointer, { fx, at, step: recording ? stepAt(at, sec) : null });
    relight();
  };
  const release = (pointer: number) => {
    const h = holds.current.get(pointer);
    if (!h) return;
    holds.current.delete(pointer);
    relight();
    const playing = liveTransport.state === 'started';
    // At least a 16th, ending on one
    const off = playing ? Math.max(nextSixteenthAt(audioNow()), h.at + sixteenth() - 1e-4) : audioNow();
    dropOff(h.fx, off);
    if (h.step === null) return;
    const end = stepAt(off, sec);
    // Let go after the section wrapped round or moved on: the move lasts to the section's end, as it played
    const steps = end !== null && end > h.step ? end - h.step : total - h.step;
    writeMove(track, sec, DROP_ROWS[h.fx].note, h.step, Math.max(1, Math.min(steps, total - h.step)));
  };

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="pk-drop" aria-label="Drop pads: hold one to change the whole mix">
        {DROP_ROWS.map((row, fx) => (
          <button
            key={row.note}
            type="button"
            className={`pk-pad ${lit.has(fx) ? 'hit' : ''}`}
            style={{ ['--c' as string]: PADS[fx].color, touchAction: 'none' }}
            aria-pressed={lit.has(fx)}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              press(e.pointerId, fx);
            }}
            onPointerUp={(e) => release(e.pointerId)}
            onPointerCancel={(e) => release(e.pointerId)}
            onLostPointerCapture={(e) => release(e.pointerId)}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span>{PADS[fx].about}</span>
            {row.label}
          </button>
        ))}
      </div>
      <Moves moves={moves} total={total} sec={sec} />
      <div className="flex items-center gap-2 shrink-0 min-h-9">
        <p className="flex-1 text-[11.5px] text-forge-muted leading-snug">
          {!isPlaying ? 'Play the song, then hold a pad.' : rec ? `Rec is on: your moves are written into ${sec.letter}.` : 'Turn Rec on to keep your moves in the song.'}
        </p>
        {moves.length > 0 && (
          <button
            type="button"
            className="h-9 px-3 rounded-xl border border-forge-border bg-forge-panelLight text-[12.5px] font-medium flex items-center gap-1.5 shrink-0"
            onClick={() => editCell(track.id, sec, () => [])}
          >
            <Trash2 className="w-4 h-4" /> Clear {sec.letter}
          </button>
        )}
      </div>
    </div>
  );
};

/** The section's moves, a thin row per effect, with the playhead. */
const Moves: React.FC<{ moves: NoteEvent[]; total: number; sec: PocketSection }> = ({ moves, total, sec }) => {
  const at = usePlayPosition();
  const head = at >= sec.from - EPS && at < sec.to - EPS ? ((at - sec.from) * STEPS_PER_WHOLE) / total : null;
  return (
    <div className="pk-dropmoves" aria-hidden>
      {DROP_ROWS.map((row, fx) => (
        <div key={row.note}>
          {moves
            .filter((n) => n.note === row.note)
            .map((n) => {
              const s = n.startOffset * STEPS_PER_WHOLE;
              const len = Math.min(total - s, durationToBars(n.duration) * STEPS_PER_WHOLE);
              return <i key={n.id} style={{ left: `${(s / total) * 100}%`, width: `${(len / total) * 100}%`, background: PADS[fx].color }} />;
            })}
        </div>
      ))}
      {head !== null && <b style={{ left: `${head * 100}%` }} />}
    </div>
  );
};
