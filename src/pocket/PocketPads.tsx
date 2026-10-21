/**
 * The drawer's pads and steps, for the selected cell. Drum pads are laid out like an MPC (kick,
 * snare, clap and hat along the bottom, under the thumb; a Drum Rack's pad 1 to 4 there, its empty
 * pads opening the Pads tool to fill them); note pads are the song's key over six
 * rows, low notes at the bottom; chord pads are the key's chords. With Rec on while the song plays
 * the section, what's played is written into the cell on the nearest 16th. The drum steps show one
 * drum at a time, a bar of 16ths as a block (a row per beat), so every step is a thumb wide.
 * Blocks keep their size: a taller drawer shows more of them, and the rest scroll (useAnchoredScroll
 * keeps the rows that matter in place as the drawer changes size).
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { getAudiblePositionBar } from '../audio/transport';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { NOTE_NAMES, type SongKey } from '../store/songKey';
import type { NoteEvent, Track } from '../store/timelineTypes';
import { STEPS_PER_WHOLE, noteToMidi, scaleRows, stepsPerBar } from './pocketGrid';
import { audition, padsOf } from './pocketSound';
import { editCell, sectionNotes } from './pocketCell';
import { cellClip } from './pocketSections';
import type { PocketSection } from './pocketSections';
import { isRackKey, pocketNoteId, usePocket, usePlayPosition } from './pocketStore';
import { buzz } from './pocketSession';

const EPS = 1e-6;

/**
 * Keep a scrolling block of pads where the person left it as the drawer grows or shrinks: anchored
 * to its bottom (the rows under the thumb stay put) or its top, and opened on its `[data-home]`
 * child (or its anchored end) the first time. Also fades the edge that has more beyond it.
 */
const scrolls = new Map<string, number>();
export function useAnchoredScroll(ref: React.RefObject<HTMLElement | null>, key: string, anchor: 'top' | 'bottom'): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fade = () => {
      el.classList.toggle('pk-fade-below', el.scrollTop + el.clientHeight < el.scrollHeight - 4);
      el.classList.toggle('pk-fade-above', el.scrollTop > 4);
    };
    const apply = () => {
      const saved = scrolls.get(key);
      if (saved === undefined) {
        const home = el.querySelector<HTMLElement>('[data-home]');
        el.scrollTop = home ? home.offsetTop + home.offsetHeight - el.clientHeight + 6 : anchor === 'bottom' ? el.scrollHeight : 0;
      } else el.scrollTop = anchor === 'bottom' ? el.scrollHeight - el.clientHeight - saved : saved;
      fade();
    };
    apply();
    let resizing = false;
    const remember = () => {
      if (!resizing && el.isConnected) scrolls.set(key, anchor === 'bottom' ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop);
      fade();
    };
    const ro = new ResizeObserver(() => {
      if (!el.isConnected) return;
      resizing = true;
      apply();
      requestAnimationFrame(() => (resizing = false));
    });
    ro.observe(el);
    el.addEventListener('scroll', remember, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', remember);
    };
  }, [ref, key, anchor]);
}

/** Where the song is in the section while it plays (16ths from its start), or null. */
function stepNow(sec: Pick<PocketSection, 'from' | 'to'>): number | null {
  const s = useTimelineStore.getState();
  if (!s.isPlaying) return null;
  const at = getAudiblePositionBar();
  if (at < sec.from - EPS || at >= sec.to - EPS) return null;
  const total = Math.round((sec.to - sec.from) * STEPS_PER_WHOLE);
  return Math.round((at - sec.from) * STEPS_PER_WHOLE) % total;
}

/** Write what was played into the cell (Rec on, the song playing in the section). */
function recordInto(track: Track, sec: PocketSection, notes: Array<{ note: string; steps: number; velocity?: number }>): void {
  if (!usePocket.getState().rec) return;
  const step = stepNow(sec);
  if (step === null) return;
  editCell(track.id, sec, (have) => {
    const fresh = notes.filter((n) => !have.some((h) => noteToMidi(h.note) === noteToMidi(n.note) && Math.round(h.startOffset * STEPS_PER_WHOLE) === step));
    return [...have, ...fresh.map((n): NoteEvent => ({ id: pocketNoteId(), note: n.note, startOffset: step / STEPS_PER_WHOLE, duration: n.steps === 1 ? '16n' : n.steps === 2 ? '8n' : '4n', velocity: n.velocity ?? 0.85 }))];
  });
}

function flash(el: HTMLElement): void {
  el.classList.add('hit');
  window.setTimeout(() => el.classList.remove('hit'), 90);
}

/** The swing amounts the Swing button steps through. */
const SWINGS = [0, 0.15, 0.3, 0.5];

/** Pads in the MPC's order: the first row along the bottom (a short last row filled out with gaps, so the rows line up). */
const padOrder = <T,>(items: readonly T[], perRow = 4): Array<T | null> => {
  const rows: Array<Array<T | null>> = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));
  const last = rows[rows.length - 1];
  while (last && last.length < perRow) last.push(null);
  return rows.reverse().flat();
};

export const DrumPads: React.FC<{ track: Track; sec: PocketSection }> = ({ track, sec }) => {
  const ref = useRef<HTMLDivElement>(null);
  useAnchoredScroll(ref, `${track.id}:pads`, 'bottom');
  return (
    <div ref={ref} className="pk-pads" aria-label={`${track.name}'s pads`}>
      {padOrder(padsOf(track)).map((p, k) =>
        !p ? (
          <span key={`gap${k}`} />
        ) : p.empty ? (
          // An empty Drum Rack pad: tapped, the Pads tool opens on it to fill it
          <button
            key={p.note}
            type="button"
            className="pk-pad empty"
            style={{ ['--c' as string]: p.color }}
            aria-label={`Pad ${(p.index ?? 0) + 1}, empty: fill it`}
            onClick={() => usePocket.getState().set({ tool: 'sound', rackPad: p.index ?? 0 })}
          >
            + Pad {(p.index ?? 0) + 1}
          </button>
        ) : (
        <button
          key={p.note}
          type="button"
          className="pk-pad"
          style={{ ['--c' as string]: p.color }}
          onPointerDown={(e) => {
            buzz(10);
            flash(e.currentTarget);
            void audition(track.id, p.note);
            recordInto(track, sec, [{ note: p.note, steps: 1 }]);
          }}
        >
          {p.label}
        </button>
        )
      )}
    </div>
  );
};

export const DrumSteps: React.FC<{ track: Track; sec: PocketSection }> = ({ track, sec }) => {
  const meter = useTimelineStore((s) => s.meter);
  const clips = useTimelineStore((s) => s.clips);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  // (A Drum Rack opens on its first pad with a sound)
  const [drum, setDrum] = useState(() => Math.max(0, padsOf(track).findIndex((p) => !p.empty)));
  const [page, setPage] = useState(0);
  const bar = usePlayPosition();
  const ref = useRef<HTMLDivElement>(null);
  useAnchoredScroll(ref, `${track.id}:steps`, 'top');
  const perBar = stepsPerBar(meter);
  const total = Math.round((sec.to - sec.from) * STEPS_PER_WHOLE);
  const pages = Math.max(1, Math.ceil(total / perBar - EPS));
  const notes = sectionNotes(clips, track.id, sec);
  const rack = isRackKey(track.instrumentKey);
  const pads = padsOf(track);
  const pad = pads[Math.min(drum, pads.length - 1)];
  const inSec = isPlaying && bar >= sec.from - EPS && bar < sec.to - EPS;
  const now = inSec ? Math.floor((bar - sec.from) * STEPS_PER_WHOLE) : -1;
  // While it plays the steps follow the song a bar at a time, except for a while after a tap: the
  // bar being worked on stays put (a tapped step doesn't flip out of sight)
  const [holdUntil, setHoldUntil] = useState(0);
  const following = inSec && Date.now() > holdUntil;
  const shown = following ? Math.floor(now / perBar) : Math.min(page, pages - 1);
  const hold = (bar: number) => {
    setPage(bar);
    setHoldUntil(Date.now() + 4000);
  };
  const isOn = (step: number) => notes.some((n) => n.note === pad.note && Math.round(n.startOffset * STEPS_PER_WHOLE) === step);
  const beatEvery = Math.max(1, Math.round(perBar / meter.num));
  const usedRows = new Set(notes.map((n) => n.note));
  // The cell's own swing (its clip's groove), stepped through a few amounts
  const groove = clips.find((c) => c.trackId === track.id && !c.audio && Math.abs(c.startBar - sec.from) < EPS && Math.abs(c.lengthBars - (sec.to - sec.from)) < EPS)?.groove ?? null;
  const swing = SWINGS.reduce((best, v) => (Math.abs(v - (groove?.swing ?? 0)) < Math.abs(best - (groove?.swing ?? 0)) ? v : best), 0);
  const swingName = swing ? `${Math.round(swing * 100)}%` : 'off';
  const tool = 'shrink-0 h-8 px-3 rounded-lg border border-forge-border bg-forge-panel text-xs font-medium';
  return (
    <>
      <div className="flex gap-1.5 overflow-x-auto shrink-0 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {pads.map((p, i) => (
          <button
            key={p.note}
            type="button"
            aria-pressed={p === pad}
            className={`shrink-0 h-9 px-3 rounded-[10px] border text-[12.5px] font-medium${p.empty ? ' text-forge-muted' : ''}`}
            style={p === pad ? { borderColor: p.color, background: `${p.color}44` } : { borderColor: '#2a2a30', background: '#222228' }}
            onClick={() => {
              setDrum(i);
              void audition(track.id, p.note);
            }}
          >
            {usedRows.has(p.note) ? '● ' : ''}
            {p.empty ? `Pad ${(p.index ?? 0) + 1}` : p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {/* (The drummer and fills write a kit's drums: a Drum Rack's pads are your own sounds) */}
        {!rack && (
          <>
            <button type="button" className={tool} onClick={() => usePocket.getState().set({ sheet: 'drummer' })}>
              Drummer
            </button>
            <button type="button" className={tool} onClick={() => usePocket.getState().set({ sheet: 'fill' })}>
              Fill
            </button>
          </>
        )}
        <button
          type="button"
          className={tool}
          aria-label={`Swing: ${swingName}. Tap for more`}
          onClick={() => {
            const id = cellClip(track.id, sec, true);
            if (!id) return;
            const next = SWINGS[(SWINGS.indexOf(swing) + 1) % SWINGS.length];
            useTimelineStore.getState().setClipGroove(id, next > 0 ? { ...(groove ?? { grid: 16 }), swing: next } : null);
          }}
        >
          Swing {swingName}
        </button>
        <button type="button" className={tool} onClick={() => editCell(track.id, sec, () => [])}>
          Clear
        </button>
        {pages > 1 && (
          <button
            type="button"
            className={tool}
            onClick={() => {
              // Bar `shown`'s steps (every drum) in every bar of the section, in place of theirs
              const from = (shown * perBar) / STEPS_PER_WHOLE, to = ((shown + 1) * perBar) / STEPS_PER_WHOLE, len = sec.to - sec.from;
              editCell(track.id, sec, (have) => {
                const bar = have.filter((n) => n.startOffset >= from - EPS && n.startOffset < to - EPS);
                const out: NoteEvent[] = [];
                for (let b = 0; b < pages; b++) {
                  const shift = ((b - shown) * perBar) / STEPS_PER_WHOLE;
                  for (const n of bar) if (n.startOffset + shift < len - EPS) out.push({ ...n, id: b === shown ? n.id : pocketNoteId(), startOffset: n.startOffset + shift });
                }
                return out;
              });
            }}
          >
            Copy to all bars
          </button>
        )}
        {pages > 1 &&
          Array.from({ length: pages }, (_, i) => (
            <button key={i} type="button" className={`${tool} font-mono ${i === shown ? '!border-cyan-400 text-cyan-200 !bg-cyan-500/10' : ''}`} onClick={() => hold(i)}>
              Bar {i + 1}
            </button>
          ))}
      </div>
      <div ref={ref} className="pk-pads steps" style={{ ['--c' as string]: pad.color, gridTemplateColumns: `repeat(${Math.min(4, perBar)}, 1fr)` }}>
        {Array.from({ length: Math.min(perBar, total - shown * perBar) }, (_, k) => {
          const step = shown * perBar + k;
          const on = isOn(step);
          return (
            <button
              key={step}
              type="button"
              aria-label={`${pad.label}, step ${step + 1}`}
              aria-pressed={on}
              className={`pk-step${on ? ' on' : ''}${k % beatEvery === 0 ? ' beat' : ''}${step === now ? ' now' : ''}`}
              onClick={() => {
                buzz();
                hold(shown);
                editCell(track.id, sec, (have) =>
                  on
                    ? have.filter((n) => !(n.note === pad.note && Math.round(n.startOffset * STEPS_PER_WHOLE) === step))
                    : [...have, { id: pocketNoteId(), note: pad.note, startOffset: step / STEPS_PER_WHOLE, duration: '16n', velocity: 0.85 }]
                );
                if (!on) void audition(track.id, pad.note);
              }}
            >
              <small>{k % beatEvery === 0 ? k / beatEvery + 1 : ''}</small>
            </button>
          );
        })}
      </div>
    </>
  );
};

/** The key's notes over the instrument's range, low to high, starting on a root below `centre`. */
export function keyNotes(key: SongKey, track: Track, centre: number, octaves: number): string[] {
  const range = INSTRUMENTS[track.instrumentKey]?.range ?? [36, 84];
  return scaleRows(key, range, centre, octaves).reverse();
}

/** The middle of what a track plays (or of its instrument's range). */
export function centreOf(track: Track, notes: readonly NoteEvent[]): number {
  const midis = notes.map((n) => noteToMidi(n.note)).filter((m): m is number => m !== null);
  if (midis.length) return Math.round(midis.reduce((a, b) => a + b, 0) / midis.length);
  const range = INSTRUMENTS[track.instrumentKey]?.range ?? [48, 72];
  return Math.round((range[0] + range[1]) / 2);
}

export const NotePads: React.FC<{ track: Track; sec: PocketSection; songKey: SongKey; shift: number }> = ({ track, sec, songKey, shift }) => {
  const ref = useRef<HTMLDivElement>(null);
  // (Where the pads sit is worked out when the track opens, so they don't move while playing)
  const centre = useMemo(() => centreOf(track, sectionNotes(useTimelineStore.getState().clips, track.id, sec)), [track.id, sec.from]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = keyNotes(songKey, track, centre + 12 * shift, 4).slice(0, 24);
  const homeMidi = all.map(noteToMidi).find((m) => m !== null && (m - songKey.root) % 12 === 0 && m >= centre + 12 * shift - 12);
  useAnchoredScroll(ref, `${track.id}:keys:${shift}`, 'bottom');
  return (
    <div ref={ref} className="pk-pads" aria-label={`${track.name}'s notes in ${songKey.name}`}>
      {padOrder(all).map((note, k) => {
        if (!note) return <span key={`gap${k}`} />;
        const m = noteToMidi(note) ?? 60;
        const root = (((m - songKey.root) % 12) + 12) % 12 === 0;
        return (
          <button
            key={note}
            type="button"
            className={`pk-pad${root ? ' root' : ''}`}
            data-home={m === homeMidi ? '' : undefined}
            style={{ ['--c' as string]: track.color }}
            onPointerDown={(e) => {
              buzz(10);
              flash(e.currentTarget);
              void audition(track.id, note, 0.8);
              recordInto(track, sec, [{ note, steps: 2, velocity: 0.8 }]);
            }}
          >
            {note}
          </button>
        );
      })}
    </div>
  );
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** The key's chords (a triad on each note of the scale), around `centre`. */
export function keyChords(key: SongKey, track: Track, centre: number): Array<{ name: string; roman: string; notes: string[] }> {
  const scale = keyNotes(key, track, centre, 3);
  const first = scale.findIndex((n) => ((((noteToMidi(n) ?? 0) - key.root) % 12) + 12) % 12 === 0);
  const from = Math.max(0, first);
  const out: Array<{ name: string; roman: string; notes: string[] }> = [];
  for (let d = 0; d < 7; d++) {
    const tri = [scale[from + d], scale[from + d + 2], scale[from + d + 4]];
    if (tri.some((n) => !n)) break;
    const [a, b, c] = tri.map((n) => noteToMidi(n)!);
    const third = b - a, fifth = c - a;
    const quality = third === 4 ? '' : fifth === 6 ? '°' : 'm';
    const roman = quality === '' ? ROMAN[d] : quality === '°' ? `${ROMAN[d].toLowerCase()}°` : ROMAN[d].toLowerCase();
    out.push({ name: `${NOTE_NAMES[((a % 12) + 12) % 12]}${quality === '' ? '' : quality === '°' ? 'dim' : 'm'}`, roman, notes: tri });
  }
  return out;
}

export const ChordPads: React.FC<{ track: Track; sec: PocketSection; songKey: SongKey }> = ({ track, sec, songKey }) => {
  const ref = useRef<HTMLDivElement>(null);
  const centre = useMemo(() => centreOf(track, sectionNotes(useTimelineStore.getState().clips, track.id, sec)), [track.id, sec.from]); // eslint-disable-line react-hooks/exhaustive-deps
  const chords = keyChords(songKey, track, centre);
  useAnchoredScroll(ref, `${track.id}:chords`, 'top');
  return (
    <div ref={ref} className="pk-pads chords" aria-label={`Chords in ${songKey.name}`}>
      {chords.map((ch) => (
        <button
          key={ch.roman}
          type="button"
          className="pk-pad !flex-row !items-center !justify-between !px-4"
          style={{ ['--c' as string]: track.color }}
          onPointerDown={(e) => {
            buzz(10);
            flash(e.currentTarget);
            ch.notes.forEach((n, k) => window.setTimeout(() => void audition(track.id, n, 0.75), k * 18));
            recordInto(track, sec, ch.notes.map((note) => ({ note, steps: 4, velocity: 0.75 })));
          }}
        >
          {ch.name}
          <span>{ch.roman}</span>
        </button>
      ))}
    </div>
  );
};

