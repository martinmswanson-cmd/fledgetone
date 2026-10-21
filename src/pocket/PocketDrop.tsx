/**
 * The Drop pad in Pocket's drawer: six big pads that do something to the whole mix for as long as
 * a finger holds them (stutter, a filter sweep, tape stop, crush, gate, an echo throw: see
 * effects/dropFx.ts). Several can be held at once; a pad pressed while the song is stopped plays it. While the song plays, a press starts on the next
 * 16th and a let-go ends on one, so every move is in time. With Rec on while the section plays,
 * each move is written into the Drop track's cell, from where it started to where it was let go,
 * replacing what that effect had there; the song then plays it every time, in the studio and in
 * exports too. Under the pads, the section's moves, with the playhead.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { DROP_ROWS } from '../audio/instrumentCatalog';
import { audioNow, dropOff, dropOn, nextSixteenthAt } from '../audio/dropLive';
import { liveTransport } from '../audio/liveContext';
import { ticksToBar, transportStartsAt } from '../audio/transport';
import { durationToBars, type NoteEvent, type Track } from '../store/timelineTypes';
import { STEPS_PER_WHOLE } from './pocketGrid';
import { editCell, sectionNotes } from './pocketCell';
import type { PocketSection } from './pocketSections';
import { pocketNoteId, usePocket, usePlayPosition } from './pocketStore';
import { buzz, playPocket } from './pocketSession';

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

/**
 * The section's 16th at audio time `time` (null: the song isn't in the section then). Near a loop's
 * end the Transport may not have wrapped yet for a time just past it: that's the loop's start.
 */
function stepAt(time: number, sec: Pick<PocketSection, 'from' | 'to'>): number | null {
  if (liveTransport.state !== 'started') return null;
  let bar = ticksToBar(liveTransport.getTicksAtTime(time));
  if (liveTransport.loop) {
    const loopStart = ticksToBar(Math.round(liveTransport.toTicks(liveTransport.loopStart)));
    const loopEnd = ticksToBar(Math.round(liveTransport.toTicks(liveTransport.loopEnd)));
    if (bar >= loopEnd - EPS && loopEnd > loopStart) bar = loopStart + (bar - loopEnd);
  }
  if (bar < sec.from - EPS || bar >= sec.to - EPS) return null;
  return Math.round((bar - sec.from) * STEPS_PER_WHOLE);
}

/** Seconds a 16th lasts now. */
const sixteenth = () => 15 / liveTransport.bpm.value;

/**
 * Write a move into a track's cell: effect `note` from step `from` for `steps` 16ths, over what that
 * effect had there (a move it covers part of keeps the parts before and after).
 */
function writeMove(trackId: string, sec: Pick<PocketSection, 'from' | 'to'>, note: string, from: number, steps: number): void {
  const to = from + steps;
  const move = (at: number, len: number, id = pocketNoteId()): NoteEvent => ({ id, note, startOffset: at / STEPS_PER_WHOLE, duration: `0:0:${len}`, velocity: 1 });
  editCell(trackId, sec, (have) => [
    ...have.flatMap((n) => {
      if (n.note !== note) return [n];
      const s = Math.round(n.startOffset * STEPS_PER_WHOLE);
      const e = s + Math.max(1, Math.round(durationToBars(n.duration) * STEPS_PER_WHOLE));
      if (e <= from || s >= to) return [n];
      return [...(s < from ? [move(s, from - s, n.id)] : []), ...(e > to ? [move(to, e - to)] : [])];
    }),
    move(from, steps),
  ]);
}

interface Hold {
  fx: number;
  /** Audio time the effect started */
  at: number;
  /** Where it's being written (Rec on, the song playing the section), as things were at the press; else null */
  rec: { trackId: string; sec: Pick<PocketSection, 'from' | 'to'>; step: number; total: number } | null;
}

/** Keys that play a pad from the keyboard, as pointers of their own. */
const KEY_POINTER = -1000;

export const DropPads: React.FC<{ track: Track; sec: PocketSection }> = ({ track, sec }) => {
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const rec = usePocket((p) => p.rec);
  const clips = useTimelineStore((s) => s.clips);
  const holds = useRef(new Map<number, Hold>());
  const [lit, setLit] = useState<ReadonlySet<number>>(new Set());
  const relight = () => setLit(new Set([...holds.current.values()].map((h) => h.fx)));
  const total = Math.max(1, Math.round((sec.to - sec.from) * STEPS_PER_WHOLE));
  const moves = sectionNotes(clips, track.id, sec);

  /** Write a recorded hold, `steps` long (16ths), kept inside its section. */
  const keep = (h: Hold, steps: number) => {
    if (!h.rec) return;
    writeMove(h.rec.trackId, h.rec.sec, DROP_ROWS[h.fx].note, h.rec.step, Math.max(1, Math.min(steps, h.rec.total - h.rec.step)));
  };

  /** Presses waiting for the song to start (a pad pressed while stopped plays it), and whether they've let go since */
  const waiting = useRef(new Map<number, { released: boolean }>());

  const press = (pointer: number, fx: number) => {
    // A second finger on a pad already held does nothing (the first one's hold goes on)
    if ([...holds.current.values()].some((h) => h.fx === fx) || waiting.current.has(pointer)) return;
    buzz(10);
    if (!useTimelineStore.getState().isPlaying) {
      // Stopped: the pad plays the song (as Play would), and starts with it
      const w = { released: false };
      waiting.current.set(pointer, w);
      void playPocket(sec).then(() => {
        if (waiting.current.get(pointer) !== w) return;
        waiting.current.delete(pointer);
        begin(pointer, fx);
        // (A tap let go before the song started still plays its 16th)
        if (w.released) release(pointer);
      });
      return;
    }
    begin(pointer, fx);
  };
  const begin = (pointer: number, fx: number) => {
    if ([...holds.current.values()].some((h) => h.fx === fx)) return;
    // On the next 16th, or where the song starts if that's still to come
    const at = Math.max(nextSixteenthAt(audioNow()), transportStartsAt() ?? 0);
    dropOn(fx, at);
    const recording = usePocket.getState().rec && useTimelineStore.getState().isPlaying;
    const step = recording ? stepAt(at, sec) : null;
    holds.current.set(pointer, { fx, at, rec: step === null ? null : { trackId: track.id, sec: { from: sec.from, to: sec.to }, step, total } });
    relight();
  };
  const release = (pointer: number) => {
    const w = waiting.current.get(pointer);
    if (w) w.released = true;
    const h = holds.current.get(pointer);
    if (!h) return;
    holds.current.delete(pointer);
    relight();
    const playing = liveTransport.state === 'started';
    // At least a 16th, ending on one
    const off = playing ? Math.max(nextSixteenthAt(audioNow()), h.at + sixteenth() - 1e-4) : audioNow();
    dropOff(h.fx, off, h.at);
    // As long as it was held (a hold past the section's end or a wrap of the loop lasts to the section's end)
    keep(h, Math.round((off - h.at) / sixteenth()));
  };

  useEffect(() => {
    const all = holds.current;
    // Play, Stop, Pause or a jump: every effect is let go there (dropLive.ts), so the holds end there
    // too (one that hadn't started yet never sounded, and isn't kept)
    const ended = (time: number) => {
      for (const h of all.values()) if (time > h.at + 1e-4) keep(h, Math.round((time - h.at) / sixteenth()));
      all.clear();
      relight();
    };
    liveTransport.on('start', ended);
    liveTransport.on('stop', ended);
    liveTransport.on('pause', ended);
    const pending = waiting.current;
    return () => {
      pending.clear();
      liveTransport.off('start', ended);
      liveTransport.off('stop', ended);
      liveTransport.off('pause', ended);
      // Leaving the pads (another track, the mixer) with one held lets go of it
      const now = audioNow();
      for (const h of all.values()) {
        const off = liveTransport.state === 'started' ? Math.max(nextSixteenthAt(now), h.at + sixteenth() - 1e-4) : now;
        dropOff(h.fx, off, h.at);
        keep(h, Math.round((off - h.at) / sixteenth()));
      }
      all.clear();
    };
    // (Once: the handlers read the holds, which carry what they need)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="pk-drop" role="group" aria-label="Drop pads: hold one to change the whole mix">
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
            onKeyDown={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                e.preventDefault();
                press(KEY_POINTER - fx, fx);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') release(KEY_POINTER - fx);
            }}
            onBlur={() => release(KEY_POINTER - fx)}
          >
            <span>{PADS[fx].about}</span>
            {row.label}
          </button>
        ))}
      </div>
      <Moves moves={moves} total={total} sec={sec} />
      <div className="flex items-center gap-2 shrink-0 min-h-9">
        <p className="flex-1 text-[11.5px] text-forge-muted leading-snug">
          {!isPlaying ? 'Hold a pad: the song plays, and the pad changes it.' : rec ? `Rec is on: your moves are written into ${sec.letter}.` : 'Turn Rec on to keep your moves in the song.'}
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
