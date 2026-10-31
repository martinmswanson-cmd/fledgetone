import type { Clip, LoopRegion, NoteCond, NoteEvent } from './timelineTypes';
import { hashSeed } from '../audio/human';
import { seededRandom } from '../audio/seededNoise';

/**
 * Notes that don't play every time, as on a hardware step sequencer: a note's `chance` (75%, 50%,
 * 25%...) and its condition (`cond`: play only on the 1st of every 2 passes, the 4th of every 4).
 * A repeated section then changes a little each time round without writing it out again.
 *
 * Nothing here is random at play time. Whether a note plays comes from its Human seed (its clip,
 * pitch and place: human.ts noteSeed) and the pass, so the song plays the same every time, in the
 * export too, and a copy of the clip plays its own way.
 *
 * The pass. A clip doesn't loop its own notes (notes past its end are hidden), so a section
 * repeats as copies side by side: Pocket's section copies, linked clips, Duplicate, the clip
 * launcher's repeats. A clip's pass is its place in the run of copies it belongs to: the clips on
 * its track that follow one another with no gap and play the same thing (linked, or the same
 * notes). A A B A plays passes 0 1 0 (B starts the count again, as a pattern change does on a
 * drum machine). Playing live with the loop on, each time round the loop continues that count as
 * if the loop were written out as copies: a loop over one clip plays passes 0, 1, 2...; a loop
 * over A B plays A on pass 0 every time. Exports render the arrangement once, so they count copies
 * only; a seamless loop export renders every pass of its loop as the first one, so the file loops
 * without a seam. The first pass of a live loop therefore sounds just like the export.
 */

const EPS = 1e-6;

/** The choices the editors offer, in order. */
export const NOTE_CHANCES: ReadonlyArray<{ id: string; label: string; short: string; chance?: number; cond?: NoteCond }> = [
  { id: 'always', label: 'Always', short: '' },
  { id: 'c75', label: '75% of the time', short: '75%', chance: 0.75 },
  { id: 'c50', label: '50% of the time', short: '50%', chance: 0.5 },
  { id: 'c25', label: '25% of the time', short: '25%', chance: 0.25 },
  { id: '1of2', label: '1st of every 2', short: '1:2', cond: { n: 1, of: 2 } },
  { id: '2of2', label: '2nd of every 2', short: '2:2', cond: { n: 2, of: 2 } },
  { id: '1of4', label: '1st of every 4', short: '1:4', cond: { n: 1, of: 4 } },
  { id: '4of4', label: '4th of every 4', short: '4:4', cond: { n: 4, of: 4 } },
];

/** A chance as saved: a number strictly between 0 and 1 (else absent: always). */
export function normalizeChance(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v >= 1) return undefined;
  return Math.max(0.01, Math.round(v * 100) / 100);
}

/** A condition as saved: pass n (1 to of) of every `of` (2 to 16), whole numbers. */
export function normalizeCond(v: unknown): NoteCond | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { n, of } = v as Record<string, unknown>;
  if (typeof n !== 'number' || typeof of !== 'number' || !Number.isInteger(n) || !Number.isInteger(of)) return undefined;
  if (of < 2 || of > 16 || n < 1 || n > of) return undefined;
  return { n, of };
}

/** Does the note play only some of the time? */
export const isConditional = (n: Pick<NoteEvent, 'chance' | 'cond'>): boolean => n.chance !== undefined || n.cond !== undefined;

/** The choice (NOTE_CHANCES id) a note has, or 'custom' for a mix the list doesn't hold. */
export function chanceIdOf(n: Pick<NoteEvent, 'chance' | 'cond'>): string {
  const hit = NOTE_CHANCES.find((c) => c.chance === n.chance && c.cond?.n === n.cond?.n && c.cond?.of === n.cond?.of);
  return hit?.id ?? 'custom';
}

/** A short mark for a note that plays some of the time ("50%", "1:2", "1:2 50%"); '' for always. */
export function chanceMark(n: Pick<NoteEvent, 'chance' | 'cond'>): string {
  return [n.cond ? `${n.cond.n}:${n.cond.of}` : '', n.chance !== undefined ? `${Math.round(n.chance * 100)}%` : ''].filter(Boolean).join(' ');
}

/** The note with the choice `id` (NOTE_CHANCES) in place of its own. */
export function withChance<T extends NoteEvent>(n: T, id: string): T {
  const pick = NOTE_CHANCES.find((c) => c.id === id);
  if (!pick) return n;
  const out: T = { ...n };
  delete out.chance;
  delete out.cond;
  if (pick.chance !== undefined) out.chance = pick.chance;
  if (pick.cond) out.cond = pick.cond;
  return out;
}

/**
 * Does a note play on `pass` (0 = the first)? Its condition first (pass n of every `of`), then
 * its chance, drawn from its seed and the pass: the same note on the same pass always decides
 * the same way.
 */
export function notePlays(n: Pick<NoteEvent, 'chance' | 'cond'>, seed: number, pass: number): boolean {
  if (n.cond && n.cond.of > 1 && ((pass % n.cond.of) + n.cond.of) % n.cond.of !== n.cond.n - 1) return false;
  if (n.chance === undefined || n.chance >= 1) return true;
  return seededRandom(hashSeed(`${seed >>> 0}~${pass}`))() < n.chance;
}

/** Where a clip sits, in bars. */
interface Span {
  start: number;
  end: number;
}

/** A clip's run of copies (see the top of the file): its place in it, and its track's other runs of the same thing. */
export interface ClipRun {
  index: number;
  chain: Span[];
  /** Every run on the track playing the same thing, its own included */
  same: Span[][];
}

/** What a clip plays, as a key: its pattern when linked, else its notes. */
const contentKeys = new WeakMap<NoteEvent[], string>();
export function contentKey(c: Clip): string {
  if (c.pattern) return `p:${c.pattern}`;
  return `n:${c.lengthBars}:${notesKey(c.notes)}`;
}
function notesKey(notes: NoteEvent[]): string {
  let k = contentKeys.get(notes);
  if (k === undefined) {
    k = JSON.stringify(notes.map((n) => [n.note, n.startOffset, n.duration, n.velocity, n.chance, n.cond]));
    contentKeys.set(notes, k);
  }
  return k;
}

const hasConditions = new WeakMap<NoteEvent[], boolean>();
/** Does any of the clip's notes play only some of the time? */
export function clipHasConditions(c: Pick<Clip, 'notes'>): boolean {
  let has = hasConditions.get(c.notes);
  if (has === undefined) {
    has = c.notes.some(isConditional);
    hasConditions.set(c.notes, has);
  }
  return has;
}

/**
 * `notes`, `from`'s notes rewritten for a render (held notes begun again at its start, see
 * auditionMath.ts restartHeldNotes), play as `from`'s do in its run of copies: the same content
 * and conditions (see clipRuns), so the clip keeps its pass.
 */
export function keepContentKey(notes: NoteEvent[], from: Pick<Clip, 'notes'>): void {
  contentKeys.set(notes, notesKey(from.notes));
  hasConditions.set(notes, clipHasConditions(from));
}

/** The end of the id of a clip made to begin a note held over a render's start again (see auditionMath.ts restartHeldNotes). */
export const HELD_CLIP = '~held';

/** The clip whose notes a clip plays: a held-over note's clip plays its own clip's (its chance, drift and passes). */
export const ownClipId = (id: string): string => (id.endsWith(HELD_CLIP) ? id.slice(0, -HELD_CLIP.length) : id);

/**
 * The run of copies of every clip that has notes playing only some of the time, by clip id
 * (clips without any aren't listed: their pass doesn't matter).
 */
export function clipRuns(clips: readonly Clip[]): Map<string, ClipRun> {
  const out = new Map<string, ClipRun>();
  const byTrack = new Map<string, Clip[]>();
  const held: string[] = [];
  for (const c of clips) {
    if (c.audio || !clipHasConditions(c)) continue;
    // (A held-over note's clip goes round with its own clip: see ownClipId)
    if (ownClipId(c.id) !== c.id) {
      held.push(c.id);
      continue;
    }
    const list = byTrack.get(c.trackId);
    if (list) list.push(c);
    else byTrack.set(c.trackId, [c]);
  }
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.startBar - b.startBar || a.id.localeCompare(b.id));
    const runs = new Map<string, Array<{ ids: string[]; spans: Span[] }>>();
    for (const c of list) {
      const key = contentKey(c);
      const own = runs.get(key) ?? [];
      runs.set(key, own);
      const last = own[own.length - 1];
      const span = { start: c.startBar, end: c.startBar + c.lengthBars };
      if (last && Math.abs(last.spans[last.spans.length - 1].end - span.start) < EPS) {
        last.ids.push(c.id);
        last.spans.push(span);
      } else own.push({ ids: [c.id], spans: [span] });
    }
    for (const own of runs.values()) {
      const same = own.map((r) => r.spans);
      for (const r of own) r.ids.forEach((id, index) => out.set(id, { index, chain: r.spans, same }));
    }
  }
  for (const id of held) {
    const run = out.get(ownClipId(id));
    if (run) out.set(id, run);
  }
  return out;
}

/**
 * The pass a clip of `run` plays on, `wraps` times round the live loop (0 before the loop first
 * comes round, and always in an export). See the top of the file.
 */
export function passOf(run: ClipRun | undefined, wraps: number, loop: Pick<LoopRegion, 'inBar' | 'outBar'> | null): number {
  if (!run) return 0;
  if (wraps <= 0 || !loop) return run.index;
  const inside = (s: Span) => s.start >= loop.inBar - EPS && s.end <= loop.outBar + EPS;
  const me = run.chain[run.index];
  if (!inside(me)) return run.index;
  const first = run.chain.findIndex(inside);
  const within = run.chain.filter(inside);
  const fromIn = Math.abs(within[0].start - loop.inBar) < EPS;
  // The loop is all this run: the count carries on round the loop
  if (fromIn && Math.abs(within[within.length - 1].end - loop.outBar) < EPS) return run.index + wraps * within.length;
  const back = run.index - first;
  if (!fromIn) return back;
  // The run starts at the loop's In: it follows on from a run of the same thing ending at its Out
  const tail = run.same.find((ch) => ch !== run.chain && ch.some((s) => Math.abs(s.end - loop.outBar) < EPS && inside(s)));
  return back + (tail ? tail.filter(inside).length : 0);
}
