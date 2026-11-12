/**
 * Pocket's piano roll (Draw, for keys, bass and synths): the selected cell's notes on rows of the
 * song's key (and any other notes it has), over the instrument's range, a column per 16th. Both
 * are a fixed size and the roll scrolls. One finger draws (tap for a note as long as the pen,
 * drag right to make it longer), moves a note (drag it) or stretches it (drag its right end); two
 * fingers scroll, as do the note names and the ruler; dragging to an edge scrolls that way. Pens:
 * Note, Chord (a chord in the key in one tap) and Erase. Tapping a note selects it, and the bar
 * above edits it in steps (and sets how often it plays: noteChance.ts). A gesture works on a draft
 * and saves once, as one undo step, when it ends.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Check, Copy, Home, Percent, Trash2 } from 'lucide-react';
import { chanceMark, isConditional, withChance } from '../store/noteChance';
import { ChanceSheet } from './pocketUi';
import { useSongMeter, useTimelineStore } from '../store/timelineStore';
import { getAudiblePositionBar } from '../audio/transport';
import { SLICE_KEY_BASE, type Track } from '../store/timelineTypes';
import type { SongKey } from '../store/songKey';
import { INSTRUMENTS } from '../audio/instrumentCatalog';
import { STEPS_PER_WHOLE, fromRoll, midiToNote, noteToMidi, rollRulerMarks, scaleRows, toRoll, type RollNote } from './pocketGrid';
import { editCell, sectionNotes } from './pocketCell';
import { clipsIn } from './pocketSections';
import { chordGlideSupport, glidePairs } from '../store/chordGlide';
import type { PocketSection } from './pocketSections';
import { pocketNoteId, sliceCount, usePocket } from './pocketStore';
import { audition } from './pocketSound';
import { buzz } from './pocketSession';
import { penBars, penLengths, rememberPen } from '../store/penLength';
import type { MeterMap } from '../audio/tempoMap';
import { PocketSteps, POCKET_LANE_H } from './PocketSteps';
import { bendSupport, slideOf, withDive, withSlide } from '../store/slides';
import { showToast } from '../components/timeline/toastStore';
import { scrollBehavior } from '../components/reducedMotion';
import { maxOf, minOf } from '../support/minMax';

const RW = 40, RH = 34, KEYW = 46, RULERH = 24;
const EPS = 1e-6;
/** New note lengths (16th steps) up to a half note; the song's bar where the section starts joins them (penLengths) */
const SHORT_LENS = [{ bars: 1 / 16, label: '1/16' }, { bars: 1 / 8, label: '1/8' }, { bars: 1 / 4, label: '1/4' }, { bars: 1 / 2, label: '1/2' }];
const penLens = (at: number, map: MeterMap): Array<[number, string]> => penLengths(SHORT_LENS, [1], at, map).map((o) => [Math.round(o.bars * STEPS_PER_WHOLE), o.label]);
const lenName = (lens: Array<[number, string]>, len: number) => lens.find(([l]) => l === len)?.[1] ?? `${len}/16`;

let pen: 'note' | 'chord' | 'erase' = 'note';
/** A new note's length in 16ths: the last drawn for this kind of part, shared with the studio's roll (penLength.ts). */
const penSteps = (track: Track, at: number, map: MeterMap) => Math.max(1, Math.round(penBars(track.instrumentKey, at, map) * STEPS_PER_WHOLE));

export const PocketRoll: React.FC<{ track: Track; sec: PocketSection; songKey: SongKey }> = ({ track, sec, songKey }) => {
  const clips = useTimelineStore((s) => s.clips);
  const saved = useMemo(() => toRoll(sectionNotes(clips, track.id, sec)), [clips, track.id, sec]);
  const [draft, setDraft] = useState<RollNote[] | null>(null);
  const notes = draft ?? saved;
  const [sel, setSel] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [, setPenTick] = useState(0);
  const roll = useRef<HTMLDivElement>(null);
  const surf = useRef<HTMLDivElement>(null);
  const steps = Math.round((sec.to - sec.from) * STEPS_PER_WHOLE);
  const meter = useSongMeter();
  const rulerMarks = useMemo(() => rollRulerMarks(sec.from, sec.to, meter), [sec.from, sec.to, meter]);
  // ("1 bar" is the song's bar: three quarters in 3/4)
  const lens = useMemo(() => penLens(sec.from, meter), [sec.from, meter]);

  // A Slicer (not in Pitch mode) has a row per slice, from C3 up, as in the studio's piano roll
  const slices = sliceCount(track);
  const nameOf = (midi: number) => (slices ? `S${midi - SLICE_KEY_BASE + 1}` : midiToNote(midi));
  const isRoot = (midi: number) => !slices && (((midi - songKey.root) % 12) + 12) % 12 === 0;
  // Rows: the key's notes over the instrument's range (five octaves at most), and any other note the cell has
  const rows = useMemo(() => {
    const range = INSTRUMENTS[track.instrumentKey]?.range ?? [36, 84];
    const mid = Math.round((range[0] + range[1]) / 2);
    const keyRows = slices ? Array.from({ length: slices }, (_, i) => SLICE_KEY_BASE + i) : scaleRows(songKey, range, mid - 12, 5).map((n) => noteToMidi(n)!);
    return [...new Set([...keyRows, ...saved.map((n) => n.midi)])].sort((a, b) => b - a);
  }, [track.instrumentKey, songKey, saved, slices]);
  const rowOf = (midi: number) => rows.indexOf(midi);
  // Where it opens: among the part's notes (the row nearest their middle), else the key's home note
  const middle = saved.length ? (minOf(saved.map((n) => n.midi)) + maxOf(saved.map((n) => n.midi))) / 2 : null;
  const home =
    middle !== null
      ? rows.reduce((best, m) => (Math.abs(m - middle) < Math.abs(best - middle) ? m : best), rows[0])
      : slices
        ? SLICE_KEY_BASE
        : (rows.find((m) => isRoot(m) && m <= (INSTRUMENTS[track.instrumentKey]?.range[0] ?? 36) + 30) ?? rows[Math.floor(rows.length / 2)]);

  // Glide between chords (see chordGlide.ts): the cell's clips' pairs, from the same function as the
  // studio's roll and the sound, as lines from each note into the note it glides to
  const glides = chordGlideSupport(track);
  const cellGlide = useMemo(() => clipsIn(clips, track.id, sec.from, sec.to).find((c) => !c.audio)?.glide, [clips, track.id, sec.from, sec.to]);
  const glideLines = useMemo(
    () =>
      clipsIn(clips, track.id, sec.from, sec.to)
        .filter((c) => c.glide && !c.audio)
        .flatMap((c) => glidePairs(c.notes, c.lengthBars).map((p) => ({ key: `${p.from.id}>${p.to.id}`, at: c.startBar + p.at - sec.from, from: noteToMidi(p.from.note), to: noteToMidi(p.to.note) })))
        .filter((l): l is { key: string; at: number; from: number; to: number } => l.at > -EPS && l.at < sec.to - sec.from + EPS && l.from !== null && l.to !== null),
    [clips, track.id, sec.from, sec.to]
  );

  const commit = (next: RollNote[]) => {
    editCell(track.id, sec, () => fromRoll(next));
    setDraft(null);
  };

  // Open on the key's home note; keep the sideways scroll per track
  const xKey = `${track.id}:${sec.from}`;
  useLayoutEffect(() => {
    const el = roll.current;
    if (!el) return;
    const y = rollScroll.get(track.id);
    const homeRow = el.querySelector<HTMLElement>('[data-home]');
    el.scrollTop = y ?? (homeRow ? homeRow.offsetTop - el.clientHeight / 2 : 0);
    el.scrollLeft = rollScrollX.get(xKey) ?? 0;
    const keep = () => {
      if (!el.isConnected) return;
      rollScroll.set(track.id, el.scrollTop);
      rollScrollX.set(xKey, el.scrollLeft);
    };
    el.addEventListener('scroll', keep, { passive: true });
    return () => el.removeEventListener('scroll', keep);
  }, [track.id, xKey]);

  // The playhead, and the page turning to keep it in sight (not while a finger is on the roll)
  const busy = useRef(false);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = useTimelineStore.getState();
      const ph = surf.current?.querySelector<HTMLElement>('.pk-rph');
      const el = roll.current;
      if (ph && el) {
        const at = getAudiblePositionBar();
        const on = s.isPlaying && at >= sec.from - EPS && at < sec.to - EPS;
        ph.style.display = on ? 'block' : 'none';
        if (on) {
          const x = (at - sec.from) * STEPS_PER_WHOLE * RW;
          ph.style.left = `${x}px`;
          const view = el.clientWidth - KEYW;
          if (!busy.current && (x < el.scrollLeft || x > el.scrollLeft + view - RW)) el.scrollLeft = Math.max(0, x - RW);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sec.from, sec.to]);

  // The gestures
  useEffect(() => {
    const el = roll.current, sf = surf.current;
    if (!el || !sf) return;
    const pts = new Map<number, { x: number; y: number }>();
    let act: null | { type: 'draw' | 'move' | 'stretch' | 'erase'; before: RollNote[]; work: RollNote[]; ids: string[]; start: { step: number; row: number }; n0?: RollNote; moved: boolean; tapped?: string } = null;
    let pan: null | { x: number; y: number; sl: number; st: number } = null;
    let last: { clientX: number; clientY: number } | null = null;
    let loop = 0;
    const cell = (e: { clientX: number; clientY: number }) => {
      const r = sf.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      return { x, step: Math.max(0, Math.min(steps - 1, Math.floor(x / RW))), row: Math.max(0, Math.min(rows.length - 1, Math.floor(y / RH))) };
    };
    const hit = (work: RollNote[], step: number, row: number) => {
      const midi = rows[row];
      for (let i = work.length - 1; i >= 0; i--) if (work[i].midi === midi && step >= work[i].step && step < work[i].step + work[i].len) return i;
      return -1;
    };
    const show = (work: RollNote[]) => setDraft(work.map((n) => ({ ...n })));
    const apply = (e: { clientX: number; clientY: number }) => {
      if (!act) return;
      const c = cell(e);
      if (c.step !== act.start.step || c.row !== act.start.row) act.moved = true;
      const w = act.work;
      if (act.type === 'erase') {
        const i = hit(w, c.step, c.row);
        if (i >= 0) w.splice(i, 1);
      } else if (act.type === 'draw' && act.moved) {
        for (const n of w) if (act.ids.includes(n.id)) n.len = Math.max(1, Math.min(steps - n.step, c.step - n.step + 1));
      } else if (act.type === 'stretch') {
        const n = w.find((x) => x.id === act!.ids[0]);
        if (n) n.len = Math.max(1, Math.min(steps - n.step, c.step - n.step + 1));
      } else if (act.type === 'move' && act.n0) {
        const n = w.find((x) => x.id === act!.ids[0]);
        if (n) {
          const was = n.midi;
          n.step = Math.max(0, Math.min(steps - n.len, act.n0.step + c.step - act.start.step));
          n.midi = rows[Math.max(0, Math.min(rows.length - 1, rowOf(act.n0.midi) + c.row - act.start.row))];
          if (n.midi !== was) void audition(track.id, midiToNote(n.midi), 0.7);
        }
      }
      show(w);
    };
    // Dragging near an edge scrolls the roll that way, so a note can go where the screen didn't reach
    const edge = () => {
      loop = 0;
      if (!act || !last) return;
      const r = el.getBoundingClientRect(), z = 36;
      const f = (d: number) => Math.max(0, Math.min(1, 1 - d / z)) * 14;
      const vx = last.clientX > r.right - z ? f(r.right - last.clientX) : last.clientX < r.left + KEYW + z ? -f(last.clientX - r.left - KEYW) : 0;
      const vy = last.clientY > r.bottom - z ? f(r.bottom - last.clientY) : last.clientY < r.top + RULERH + z ? -f(last.clientY - r.top - RULERH) : 0;
      if (!vx && !vy) return;
      const sl = el.scrollLeft, st = el.scrollTop;
      el.scrollLeft += vx;
      el.scrollTop += vy;
      if (el.scrollLeft !== sl || el.scrollTop !== st) apply(last);
      loop = requestAnimationFrame(edge);
    };
    const down = (e: PointerEvent) => {
      sf.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      busy.current = true;
      if (pts.size === 2) {
        // A second finger: scrolling, not drawing (what the first began is undone)
        if (act) setDraft(null);
        act = null;
        const [a, b] = [...pts.values()];
        pan = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, sl: el.scrollLeft, st: el.scrollTop };
        return;
      }
      if (pts.size > 2 || pan) return;
      const c = cell(e);
      const before = saved.map((n) => ({ ...n }));
      const work = saved.map((n) => ({ ...n }));
      act = { type: 'draw', before, work, ids: [], start: { step: c.step, row: c.row }, moved: false };
      if (pen === 'erase') {
        act.type = 'erase';
        apply(e);
        return;
      }
      const i = hit(work, c.step, c.row);
      if (i >= 0) {
        const n = work[i];
        act.ids = [n.id];
        act.n0 = { ...n };
        act.tapped = n.id;
        act.type = c.x > (n.step + n.len) * RW - 16 && n.len > 1 ? 'stretch' : 'move';
        return;
      }
      const row = rowOf(rows[c.row]);
      // (A Slicer's rows are slices, not notes of a key: no chords there)
      const chordRows = pen === 'chord' && !slices ? [row, row - 2, row - 4].filter((r) => r >= 0) : [row];
      const len = Math.min(penSteps(track, sec.from, meter), steps - c.step);
      for (const r of chordRows) {
        const id = pocketNoteId();
        work.push({ id, midi: rows[r], step: c.step, len, velocity: 0.8 });
        act.ids.push(id);
        void audition(track.id, midiToNote(rows[r]), 0.75);
      }
      setSel(null);
      buzz();
      show(work);
    };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pan) {
        const [a, b] = [...pts.values()];
        if (!b) return;
        el.scrollLeft = pan.sl - ((a.x + b.x) / 2 - pan.x);
        el.scrollTop = pan.st - ((a.y + b.y) / 2 - pan.y);
        return;
      }
      if (!act) return;
      last = { clientX: e.clientX, clientY: e.clientY };
      apply(last);
      if (!loop) loop = requestAnimationFrame(edge);
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      cancelAnimationFrame(loop);
      loop = 0;
      last = null;
      if (!pts.size) busy.current = false;
      if (pan) {
        if (!pts.size) pan = null;
        return;
      }
      if (!act) return;
      const a = act;
      act = null;
      if ((a.type === 'move' || a.type === 'stretch') && !a.moved && a.tapped) {
        // A tap on a note selects it (and plays it)
        const n = a.work.find((x) => x.id === a.tapped);
        if (n) void audition(track.id, midiToNote(n.midi), 0.75);
        setSel(a.tapped);
        setDraft(null);
        return;
      }
      if (a.type === 'move' || a.type === 'stretch') setSel(a.ids[0]);
      // A note drawn longer, or stretched: the next one is drawn that long
      if ((a.type === 'draw' || a.type === 'stretch') && a.moved) {
        const n = a.work.find((x) => x.id === a.ids[0]);
        if (n) rememberPen(track.instrumentKey, n.len / STEPS_PER_WHOLE);
      }
      if (JSON.stringify(a.work.map(({ from: _f, ...r }) => r)) === JSON.stringify(a.before.map(({ from: _f, ...r }) => r))) setDraft(null);
      else commit(a.work);
    };
    const cancel = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      act = null;
      pan = null;
      busy.current = false;
      setDraft(null);
    };
    sf.addEventListener('pointerdown', down);
    sf.addEventListener('pointermove', move);
    sf.addEventListener('pointerup', up);
    sf.addEventListener('pointercancel', cancel);
    return () => {
      sf.removeEventListener('pointerdown', down);
      sf.removeEventListener('pointermove', move);
      sf.removeEventListener('pointerup', up);
      sf.removeEventListener('pointercancel', cancel);
      cancelAnimationFrame(loop);
    };
    // (rows and saved are what the gestures work on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, saved, steps, track.id, sec]);

  const selected = sel ? notes.find((n) => n.id === sel) ?? null : null;
  const change = (fn: (n: RollNote, all: RollNote[]) => void) => {
    if (!selected) return;
    const work = saved.map((n) => ({ ...n }));
    const n = work.find((x) => x.id === selected.id);
    if (!n) return;
    fn(n, work);
    commit(work);
  };
  const ib = 'w-[33px] h-9 rounded-[10px] border border-forge-border bg-forge-panelLight grid place-items-center shrink-0 disabled:opacity-35';
  // (On a Slicer the Chord pen draws single notes: it shows as Note)
  const penOn = (k: typeof pen) => pen === k || (k === 'note' && pen === 'chord' && slices > 0);
  const chip = 'h-9 px-3 rounded-[10px] border border-forge-border bg-forge-panelLight text-[12.5px] font-medium shrink-0 disabled:opacity-40';

  return (
    <>
      {/* (Wider than a narrow phone: it scrolls sideways) */}
      <div className="flex items-center gap-1.5 h-[38px] shrink-0 overflow-x-auto -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
        {selected ? (
          <>
            <span className="font-mono text-sm font-semibold px-1 whitespace-nowrap">
              {nameOf(selected.midi)} <span className="text-[11px] text-forge-muted font-medium">{lenName(lens, selected.len)}</span>
            </span>
            <button type="button" aria-label="Shorter" className={ib} disabled={selected.len <= 1} onClick={() => change((n) => (n.len = Math.max(1, n.len - 1)))}>
              <ChevronLeft className="w-[18px] h-[18px]" />
            </button>
            <button type="button" aria-label="Longer" className={ib} disabled={selected.step + selected.len >= steps} onClick={() => change((n) => (n.len = Math.min(steps - n.step, n.len + 1)))}>
              <ChevronRight className="w-[18px] h-[18px]" />
            </button>
            <button type="button" aria-label="Down a note" className={ib} disabled={rowOf(selected.midi) >= rows.length - 1} onClick={() => change((n) => { n.midi = rows[rowOf(n.midi) + 1]; void audition(track.id, midiToNote(n.midi), 0.7); })}>
              <ChevronDown className="w-[18px] h-[18px]" />
            </button>
            <button type="button" aria-label="Up a note" className={ib} disabled={rowOf(selected.midi) <= 0} onClick={() => change((n) => { n.midi = rows[rowOf(n.midi) - 1]; void audition(track.id, midiToNote(n.midi), 0.7); })}>
              <ChevronUp className="w-[18px] h-[18px]" />
            </button>
            <button type="button" aria-label="Copy it after itself" className={ib} onClick={() => change((n, all) => { const c = { ...n, id: pocketNoteId(), from: undefined, step: Math.min(steps - n.len, n.step + n.len) }; all.push(c); setSel(c.id); })}>
              <Copy className="w-[17px] h-[17px]" />
            </button>
            <button type="button" aria-label={slideOf(fromRoll([selected])[0])?.kind === 'dive' ? 'Dive: on (tap to take it off)' : 'Dive: start an octave up and fall to the note'} aria-pressed={slideOf(fromRoll([selected])[0])?.kind === 'dive'} className={`${chip} !px-2.5${slideOf(fromRoll([selected])[0])?.kind === 'dive' ? ' !border-cyan-400 text-cyan-200' : ''}`} onClick={() => change((n) => { const note = fromRoll([n])[0]; n.from = slideOf(note)?.kind === 'dive' ? withSlide(note, 0) : withDive(note); if (bendSupport(track, INSTRUMENTS[track.instrumentKey]?.kind) === 'no') showToast(`${INSTRUMENTS[track.instrumentKey]?.name ?? 'This instrument'} doesn't bend: the dive plays at the note's own pitch`); })}>
              Dive
            </button>
            <button type="button" aria-label={`How often it plays: ${selected.from && isConditional(selected.from) ? chanceMark(selected.from) : 'always'}`} className={`${ib}${selected.from && isConditional(selected.from) ? ' !border-cyan-400 text-cyan-200' : ''}`} onClick={() => setChoosing(true)}>
              <Percent className="w-[17px] h-[17px]" />
            </button>
            <button type="button" aria-label="Delete the note" className={ib} onClick={() => { change((n, all) => all.splice(all.indexOf(n), 1)); setSel(null); }}>
              <Trash2 className="w-[17px] h-[17px]" />
            </button>
            <button type="button" aria-label="Done: back to drawing" className={`${ib} ml-auto !border-cyan-400`} onClick={() => setSel(null)}>
              <Check className="w-[18px] h-[18px]" />
            </button>
          </>
        ) : (
          <>
            <div className="flex p-[3px] rounded-xl bg-forge-bg border border-forge-border shrink-0">
              {(slices ? (['note', 'erase'] as const) : (['note', 'chord', 'erase'] as const)).map((k) => (
                <button key={k} type="button" aria-pressed={penOn(k)} className={`h-[30px] px-2.5 rounded-lg text-[12.5px] font-medium ${penOn(k) ? 'bg-forge-panelLight text-forge-text shadow-[inset_0_0_0_1px_#3a3a44]' : 'text-forge-muted'}`} onClick={() => { pen = k; setPenTick((x) => x + 1); }}>
                  {k === 'note' ? 'Note' : k === 'chord' ? 'Chord' : 'Erase'}
                </button>
              ))}
            </div>
            <button type="button" aria-label="Length of new notes" className={chip} disabled={pen === 'erase'} onClick={() => { const len = penSteps(track, sec.from, meter); const next = lens.find(([l]) => l > len)?.[0] ?? lens[0][0]; rememberPen(track.instrumentKey, next / STEPS_PER_WHOLE); setPenTick((x) => x + 1); }}>
              {lenName(lens, penSteps(track, sec.from, meter))}
            </button>
            <button type="button" aria-label="Back to the key's home note" className={`${chip} !px-2.5`} onClick={() => { const el = roll.current, h = el?.querySelector<HTMLElement>('[data-home]'); if (el && h) el.scrollTo({ top: h.offsetTop - el.clientHeight / 2, behavior: scrollBehavior() }); }}>
              <Home className="w-4 h-4" />
            </button>
            {!slices && (
              <button type="button" className={chip} onClick={() => usePocket.getState().set({ sheet: 'chords' })}>
                Chords
              </button>
            )}
            <button type="button" className={chip} onClick={() => usePocket.getState().set({ sheet: 'feel' })}>
              Feel
            </button>
            {!slices && (
              <button type="button" aria-label={`Glide between chords: ${cellGlide ? 'on' : 'off'}`} className={`${chip}${cellGlide ? ' !border-cyan-400 text-cyan-200' : ''}`} onClick={() => usePocket.getState().set({ sheet: 'glide' })}>
                Glide
              </button>
            )}
          </>
        )}
      </div>
      <div ref={roll} className="pk-roll" style={{ ['--c' as string]: track.color }}>
        <div className="pk-rinner" style={{ gridTemplateColumns: `${KEYW}px ${steps * RW}px`, gridTemplateRows: `${RULERH}px ${rows.length * RH}px ${POCKET_LANE_H}px` }}>
          <div className="pk-rcorner" />
          <div className="pk-rruler">
            {rulerMarks.map((m) => (
              <span key={m.step} style={{ left: m.step * RW }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="pk-rkeys">
            {rows.map((m) => (
              <button key={m} type="button" className={`pk-rkey${isRoot(m) ? ' root' : ''}`} style={{ height: RH }} data-home={m === home ? '' : undefined} aria-label={`Play ${slices ? `slice ${m - SLICE_KEY_BASE + 1}` : midiToNote(m)}`} onClick={() => void audition(track.id, midiToNote(m), 0.75)}>
                {nameOf(m)}
              </button>
            ))}
          </div>
          <div ref={surf} className="pk-rsurf" style={{ ['--rw' as string]: `${RW}px`, ['--rh' as string]: `${RH}px` }} aria-label={`${track.name}'s notes in ${sec.letter}: draw with one finger, scroll with two`}>
            {rows.map((m, r) => (isRoot(m) ? <i key={m} className="pk-rootband" style={{ top: r * RH, height: RH }} /> : null))}
            {notes.map((n) => {
              const r = rowOf(n.midi);
              if (r < 0) return null;
              const mark = n.from && isConditional(n.from) ? chanceMark(n.from) : '';
              return (
                <div key={n.id} className={`pk-rnote${n.id === sel ? ' sel' : ''}${mark ? ' cond' : ''}`} style={{ left: n.step * RW + 1, top: r * RH + 3, width: n.len * RW - 2, height: RH - 6 }}>
                  {n.len * RW > 44 ? <span>{nameOf(n.midi)}{mark && n.len * RW > 84 ? ` ${mark}` : ''}</span> : null}
                </div>
              );
            })}
            {glideLines.length > 0 && (
              <svg data-glide-lines="" className="absolute inset-0 pointer-events-none" width={steps * RW} height={rows.length * RH} aria-hidden style={{ zIndex: 2 }}>
                {glideLines.map((l) => {
                  const a = rowOf(l.from);
                  const b = rowOf(l.to);
                  if (a < 0 || b < 0) return null;
                  const x0 = l.at * STEPS_PER_WHOLE * RW - 6;
                  const w = 16;
                  const y0 = a * RH + RH / 2;
                  const y1 = b * RH + RH / 2;
                  return <path key={l.key} data-glide={`${midiToNote(l.from)}>${midiToNote(l.to)}`} d={`M${x0},${y0} C${x0 + w / 2},${y0} ${x0 + w / 2},${y1} ${x0 + w},${y1}`} fill="none" stroke={glides ? 'rgb(250,204,21)' : 'rgba(255,255,255,0.4)'} strokeWidth={2.5} strokeDasharray={glides ? undefined : '4 4'} strokeLinecap="round" />;
                })}
              </svg>
            )}
            <i className="pk-rph" />
          </div>
          <PocketSteps track={track} sec={sec} rw={RW} keyW={KEYW} erase={pen === 'erase'} />
        </div>
      </div>
      {choosing && selected && (
        <ChanceSheet
          title={`${nameOf(selected.midi)}: how often it plays`}
          note={selected.from ?? {}}
          onClose={() => setChoosing(false)}
          onPick={(id) => change((n) => (n.from = withChance(n.from ?? fromRoll([n])[0], id)))}
        />
      )}
    </>
  );
};

const rollScroll = new Map<string, number>();
const rollScrollX = new Map<string, number>();
