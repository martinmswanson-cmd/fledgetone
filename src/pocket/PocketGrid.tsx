/**
 * Pocket's song grid: the whole song at once. In portrait the sections run down the page in song
 * order and the tracks across (it reads like a lyric sheet); turned on its side in landscape it's
 * the studio's timeline, sections left to right. Each cell shows what a track plays in a section;
 * tapping one selects it for the drawer (and loops the section). A section's letter loops it, its
 * ⋯ (or holding a letter) arranges the song; + adds a section (a copy of the selected one) or a
 * track. Above it: Loop / Song (what Play plays), Mix all and + Track.
 */
import React, { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Drum, Ellipsis, Mic, Music, Plus, SlidersHorizontal, Zap, Waves } from 'lucide-react';
import { useTimelineStore } from '../store/timelineStore';
import { getAudiblePositionBar } from '../audio/transport';
import type { Clip, NoteEvent, Track } from '../store/timelineTypes';
import { gridTracks, copySection, pocketSections, type PocketSection } from './pocketSections';
import { sectionNotes, useSelection } from './pocketCell';
import { editorOf, usePocket } from './pocketStore';
import { noteToMidi } from './pocketGrid';
import { buzz } from './pocketSession';
import { selectTrack } from './PocketDrawer';
import { showToast } from '../components/timeline/toastStore';

const EPS = 1e-6;

/** Select a section, and loop it when the loop is on. While playing, the song moves there on the next bar line. */
export function goToSection(i: number, sections: readonly PocketSection[]): void {
  const sec = sections[i];
  if (!sec) return;
  usePocket.getState().set({ section: i });
  const s = useTimelineStore.getState();
  // (A jump still waiting from before is dropped: this choice replaces it)
  pendingJump = null;
  if (!s.loopRegion.enabled) return;
  s.setLoopRange(sec.from, sec.to);
  if (!s.isPlaying) {
    if (s.playheadPosition < sec.from - EPS || s.playheadPosition >= sec.to - EPS) s.seek(sec.from);
    return;
  }
  const at = getAudiblePositionBar();
  if (at >= sec.from - EPS && at < sec.to - EPS) return;
  pendingJump = { bar: sec.from, when: Math.floor(at + EPS) + 1 };
}

/** A jump waiting for the next bar line (see goToSection). */
let pendingJump: { bar: number; when: number } | null = null;

export const trackIcon = (t: Track): React.ComponentType<{ className?: string }> => {
  const how = editorOf(t.instrumentKey, t.plugin);
  return how === 'beat' ? Drum : how === 'notes' ? Music : how === 'vocals' ? Mic : how === 'drop' ? Zap : SlidersHorizontal;
};

/** What a cell draws: its notes (relative to the section) and its recordings (start and length, in bars). */
interface CellContent {
  notes: NoteEvent[];
  audio: Array<{ at: number; len: number }>;
}

function cellContent(clips: readonly Clip[], t: Track, sec: PocketSection): CellContent {
  const audio: CellContent['audio'] = [];
  for (const c of clips) {
    if (c.trackId !== t.id || !c.audio || c.startBar >= sec.to - EPS || c.startBar + c.lengthBars <= sec.from + EPS) continue;
    audio.push({ at: Math.max(0, c.startBar - sec.from), len: Math.min(sec.to, c.startBar + c.lengthBars) - Math.max(sec.from, c.startBar) });
  }
  return { notes: sectionNotes(clips, t.id, sec), audio };
}

const Cell = memo(function Cell({ content, len, color, drums, className, label, onTap, i, row, col }: {
  content: CellContent;
  len: number;
  color: string;
  drums: boolean;
  className: string;
  label: string;
  onTap: () => void;
  i: number;
  row: number;
  col: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    if (!r.width) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    g.fillStyle = color;
    const W = r.width, H = r.height;
    for (const a of content.audio) g.fillRect((a.at / len) * W, H * 0.3, Math.max(2, (a.len / len) * W - 2), H * 0.4);
    const notes = content.notes;
    if (!notes.length) return;
    const midis = notes.map((n) => noteToMidi(n.note) ?? 60);
    if (drums) {
      // A row per drum, at most 5 px tall, the rows centred
      const rows = [...new Set(midis)].sort((a, b) => a - b);
      const h = Math.max(2, Math.min(5, (H - 2) / rows.length - 1));
      const top = (H - rows.length * (h + 1)) / 2;
      notes.forEach((n, k) => g.fillRect((n.startOffset / len) * W, top + (rows.length - 1 - rows.indexOf(midis[k])) * (h + 1), Math.max(2, W / (len * 16) - 1), h));
    } else {
      const lo = Math.min(...midis) - 1, hi = Math.max(...midis) + 1;
      notes.forEach((n, k) => g.fillRect((n.startOffset / len) * W, H - ((midis[k] - lo) / (hi - lo)) * H - 1.5, Math.max(3, (W / len) * Math.min(len, durBars(n)) - 1), 3));
    }
  }, [content, len, color, drums]);
  return (
    <button type="button" className={className} style={{ gridRow: row, gridColumn: col, ['--c' as string]: color }} data-i={i} aria-label={label} onClick={onTap}>
      <canvas ref={canvas} />
      <i className="ph" />
    </button>
  );
});

/** A note's length in bars, for drawing (named lengths are enough here). */
function durBars(n: NoteEvent): number {
  const d = n.duration;
  const named: Record<string, number> = { '1m': 1, '2n': 0.5, '4n': 0.25, '8n': 0.125, '16n': 0.0625, '32n': 0.03125, '2n.': 0.75, '4n.': 0.375, '8n.': 0.1875 };
  if (named[d] !== undefined) return named[d];
  if (/^\d+(\.\d+)?m$/.test(d)) return parseFloat(d);
  if (d.includes(':')) {
    const [b = 0, q = 0, s = 0] = d.split(':').map(Number);
    return b + q / 4 + s / 16;
  }
  return 0.0625;
}

const SectionChip: React.FC<{ sec: PocketSection; i: number; fx: string | null; selected: boolean; style: React.CSSProperties; className: string; onTap: () => void; onArrange: () => void }> = ({
  sec,
  i,
  fx,
  selected,
  style,
  className,
  onTap,
  onArrange,
}) => {
  const held = useRef(false);
  const timer = useRef(0);
  const clear = () => window.clearTimeout(timer.current);
  return (
    <button
      type="button"
      className={`pk-chip ${selected ? 'sel' : ''} ${className}`}
      style={style}
      data-i={i}
      aria-label={selected ? `${sec.name} (${sec.letter}): arrange` : `${sec.name} (${sec.letter}): loop it`}
      onPointerDown={() => {
        held.current = false;
        timer.current = window.setTimeout(() => {
          held.current = true;
          buzz();
          onArrange();
        }, 450);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) return;
        if (selected) onArrange();
        else onTap();
      }}
    >
      <span>{sec.letter}</span>
      {selected && (
        <span className="more" aria-hidden="true">
          <Ellipsis className="w-4 h-4" />
        </span>
      )}
      {fx && <small>{fx}</small>}
    </button>
  );
};

/** The section a marker name marks as a build-up or drop, for the chip's label. */
const fxOf = (name: string): string | null => (/build/i.test(name) ? 'BUILD' : /drop/i.test(name) ? 'DROP' : null);

export const PocketGrid: React.FC<{ land: boolean }> = ({ land }) => {
  const { track: selTrack, index, sections } = useSelection();
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const loop = useTimelineStore((s) => s.loopRegion);
  const isPlaying = useTimelineStore((s) => s.isPlaying);
  const mixAll = usePocket((p) => p.mixAll);
  const shown = gridTracks(tracks);
  const grid = useRef<HTMLDivElement>(null);
  const songMode = !loop.enabled;

  const contents = useMemo(() => sections.map((sec) => shown.map((t) => cellContent(clips, t, sec))), [sections, shown, clips]);

  // The playhead: which place in the song plays now, and where in it (written straight to the cells, not through React)
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    let raf = 0;
    let lastRow = -2;
    const tick = () => {
      const s = useTimelineStore.getState();
      if (!s.isPlaying) {
        // (Stopped before the bar line: the jump is forgotten, so the next Play starts where it shows)
        pendingJump = null;
        el.querySelectorAll('[data-active]').forEach((c) => c.removeAttribute('data-active'));
        lastRow = -2;
        return;
      }
      const at = getAudiblePositionBar();
      if (pendingJump && at >= pendingJump.when - 0.01) {
        const jump = pendingJump;
        pendingJump = null;
        s.seek(jump.bar);
      }
      const p = usePocket.getState();
      const row = s.loopRegion.enabled ? p.section : sections.findIndex((x) => at >= x.from - EPS && at < x.to - EPS);
      const sec = sections[row];
      if (row !== lastRow) {
        el.querySelectorAll('[data-active]').forEach((c) => c.removeAttribute('data-active'));
        el.querySelectorAll(`.pk-cell[data-i="${row}"]`).forEach((c) => c.setAttribute('data-active', ''));
        el.querySelectorAll('.pk-chip[data-i]').forEach((c) => c.classList.toggle('now', !s.loopRegion.enabled && Number((c as HTMLElement).dataset.i) === row));
        lastRow = row;
      }
      if (sec) el.style.setProperty('--at', `${Math.max(0, Math.min(1, (at - sec.from) / (sec.to - sec.from))) * 100}%`);
      raf = requestAnimationFrame(tick);
    };
    if (isPlaying) raf = requestAnimationFrame(tick);
    else tick();
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, sections]);

  // Keep the selected cell in view (clear of the pinned letters and names)
  useEffect(() => {
    const el = grid.current;
    const cur = el?.querySelector<HTMLElement>('.pk-cell.cur');
    const corner = el?.querySelector<HTMLElement>('.pk-corner');
    if (!el || !cur || !corner) return;
    const g = el.getBoundingClientRect(), r = cur.getBoundingClientRect(), head = corner.getBoundingClientRect();
    if (r.left < g.left + head.width) el.scrollLeft -= g.left + head.width - r.left + 4;
    else if (r.right > g.right) el.scrollLeft += r.right - g.right + 4;
    if (r.top < g.top + head.height) el.scrollTop -= g.top + head.height - r.top + 4;
    else if (r.bottom > g.bottom) el.scrollTop += r.bottom - g.bottom + 4;
  }, [index, selTrack?.id, land]);

  const N = sections.length, T = shown.length;
  const pos = (i: number, k: number) => (land ? { row: k + 2, col: i + 2 } : { row: i + 2, col: k + 2 });
  const cols = land ? `minmax(96px, 112px) repeat(${N}, minmax(64px, 72px)) 52px` : `58px repeat(${T}, minmax(70px, 1fr)) 48px`;
  const rows = land ? `44px repeat(${T}, 42px) 42px` : `40px repeat(${N}, 42px) 42px`;

  const selectCell = (i: number, t: Track) => {
    buzz();
    selectTrack(t);
    goToSection(i, sections);
  };
  const arrange = (i: number) => usePocket.getState().set({ sheet: 'section', sheetSection: i });
  const addSection = () => {
    buzz();
    const problem = copySection(index);
    if (problem) return showToast(problem);
    showToast(`A copy of ${sections[index].letter}, after it: change it, or make it its own (its ⋯)`);
    // The copy is the next section: select it (and loop it)
    goToSection(index + 1, pocketSections());
  };

  return (
    <section className="pk-arr" aria-label="The song: its sections and tracks">
      <div className="flex items-center gap-1.5 pl-[var(--gx)] pr-[var(--gxr)] py-1.5 shrink-0">
        <button
          type="button"
          aria-pressed={songMode}
          className={`h-9 px-3 rounded-xl border text-[13px] font-semibold flex items-center gap-1.5 ${songMode ? 'border-cyan-400 text-cyan-200 bg-cyan-500/10' : 'border-forge-border bg-forge-panel text-forge-muted'}`}
          onClick={() => {
            const s = useTimelineStore.getState();
            const sec = sections[index];
            if (!songMode) {
              s.toggleLoop();
              showToast('Play runs the whole song, in this order');
            } else {
              s.setLoopRange(sec.from, sec.to);
              if (!useTimelineStore.getState().loopRegion.enabled) s.toggleLoop();
              showToast(`Play loops ${sec.letter}`);
            }
          }}
        >
          <Waves className="w-4 h-4" />
          {songMode ? 'Song' : 'Loop'}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={mixAll}
          className={`h-9 px-2.5 rounded-xl border text-[12.5px] font-medium flex items-center gap-1.5 ${mixAll ? 'border-cyan-400 bg-cyan-500/10' : 'border-forge-border bg-forge-panel'}`}
          onClick={() => usePocket.getState().set({ mixAll: !mixAll, ...(usePocket.getState().drawer === 'low' ? { drawer: 'mid' } : {}) })}
        >
          <SlidersHorizontal className="w-4 h-4" /> Mix all
        </button>
        <button type="button" className="h-9 px-2.5 rounded-xl border border-forge-border bg-forge-panel text-[12.5px] font-medium flex items-center gap-1.5" onClick={() => usePocket.getState().set({ sheet: 'add' })}>
          <Plus className="w-4 h-4" /> Track
        </button>
      </div>
      <div ref={grid} className="pk-grid" style={{ gridTemplateColumns: cols, gridTemplateRows: rows }}>
        <div className="pk-corner pk-stick-both" style={{ gridRow: 1, gridColumn: 1 }}>
          {land ? 'Tracks' : 'Song'}
        </div>
        {sections.map((sec, i) => (
          <SectionChip
            key={`s${i}`}
            sec={sec}
            i={i}
            fx={fxOf(sec.name)}
            selected={i === index}
            className={land ? 'pk-stick-top' : 'pk-stick-left'}
            style={land ? { gridRow: 1, gridColumn: i + 2 } : { gridRow: i + 2, gridColumn: 1 }}
            onTap={() => {
              buzz();
              goToSection(i, sections);
            }}
            onArrange={() => arrange(i)}
          />
        ))}
        <button
          type="button"
          className={`pk-chip add ${land ? 'pk-stick-top' : 'pk-stick-left'}`}
          style={land ? { gridRow: 1, gridColumn: N + 2 } : { gridRow: N + 2, gridColumn: 1 }}
          aria-label={`New section: a copy of ${sections[index]?.letter}`}
          onClick={addSection}
        >
          +
        </button>
        {shown.map((t, k) => {
          const Icon = trackIcon(t);
          const solo = shown.some((x) => x.isSoloed);
          return (
            <div
              key={t.id}
              className={`pk-thd ${land ? 'pk-stick-left' : 'pk-stick-top'} ${t.id === selTrack?.id ? 'sel' : ''} ${t.isMuted || (solo && !t.isSoloed) ? 'silent' : ''}`}
              style={{ ...(land ? { gridRow: k + 2, gridColumn: 1 } : { gridRow: 1, gridColumn: k + 2 }), ['--c' as string]: t.color }}
            >
              <button
                type="button"
                className="pk-thname"
                aria-pressed={t.id === selTrack?.id}
                onClick={() => {
                  buzz();
                  selectTrack(t);
                }}
              >
                <Icon />
                <b>{t.name}</b>
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className={`pk-thd add ${land ? 'pk-stick-left' : 'pk-stick-top'}`}
          style={land ? { gridRow: T + 2, gridColumn: 1 } : { gridRow: 1, gridColumn: T + 2 }}
          aria-label="Add an instrument"
          onClick={() => usePocket.getState().set({ sheet: 'add' })}
        >
          +
        </button>
        {sections.map((sec, i) =>
          shown.map((t, k) => {
            const content = contents[i]?.[k] ?? { notes: [], audio: [] };
            const full = content.notes.length > 0 || content.audio.length > 0;
            const cur = i === index && t.id === selTrack?.id;
            const at = pos(i, k);
            return (
              <Cell
                key={`${i}:${t.id}`}
                content={content}
                len={sec.to - sec.from}
                color={t.color}
                drums={editorOf(t.instrumentKey, t.plugin) === 'beat'}
                className={`pk-cell${full ? ' full' : ''}${t.id === selTrack?.id ? ' colsel' : ''}${i === index ? ' rowsel' : ''}${cur ? ' cur' : ''}`}
                label={`${t.name} in ${sec.letter} (${sec.name})${full ? '' : ', empty'}`}
                onTap={() => selectCell(i, t)}
                i={i}
                row={at.row}
                col={at.col}
              />
            );
          })
        )}
      </div>
    </section>
  );
};
