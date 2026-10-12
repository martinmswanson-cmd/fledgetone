import type { Clip, ClipTake, CompSegment, NoteEvent } from './timelineTypes';
import { normalizeClipAudio, splitAudio, trimAudioStart } from './audioClips';
import { moveExpression, normalizeExpression, shiftExpression } from './expression';

/**
 * Take folders and comping. Recording over the same span again (a loop's passes, or a punch over a
 * take) keeps every take in one clip; the comp says which take plays in each stretch of it.
 * - A MIDI take folder's notes are the comp's: each stretch plays the notes of its take that start
 *   in it. They're written into the clip's notes whenever the comp changes, so the clip plays and
 *   edits like any other (a comp change rewrites them from the takes).
 * - A mic take folder plays the comp's pieces of each take's sound, cut where the comp changes
 *   with a short crossfade (expandAudioComp makes those pieces for the scheduler).
 * Pure, so it's unit tested (scripts/takes.test.mjs).
 */

const EPS = 1e-6;

/** The comp as segments in order, the first at the clip's start, each naming a take that exists, none repeating its neighbour. */
export function compSegments(clip: Pick<Clip, 'takes' | 'comp' | 'lengthBars'>): CompSegment[] {
  const n = clip.takes?.length ?? 0;
  if (!n) return [];
  const raw = (clip.comp?.length ? clip.comp : [{ at: 0, take: n - 1 }])
    .filter((s) => s.at < clip.lengthBars - EPS)
    .map((s) => ({ at: Math.max(0, s.at), take: Math.max(0, Math.min(n - 1, Math.round(s.take))) }))
    .sort((a, b) => a.at - b.at);
  if (!raw.length || raw[0].at > EPS) raw.unshift({ at: 0, take: raw[0]?.take ?? n - 1 });
  const out: CompSegment[] = [];
  for (const s of raw) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.at - s.at) < EPS) last.take = s.take;
    else if (!last || last.take !== s.take) out.push({ ...s });
  }
  return out;
}

/** Where each segment ends. */
const segmentEnds = (segs: CompSegment[], length: number) => segs.map((_, i) => (i + 1 < segs.length ? segs[i + 1].at : length));

/** The notes the comp plays: each stretch's take's notes that start in it. */
export function compNotes(clip: Pick<Clip, 'takes' | 'comp' | 'lengthBars'>): Array<Omit<NoteEvent, 'id'> & { id?: string }> {
  const segs = compSegments(clip);
  const ends = segmentEnds(segs, clip.lengthBars);
  return segs.flatMap((s, i) => (clip.takes![s.take].notes ?? []).filter((n) => n.startOffset >= s.at - EPS && n.startOffset < ends[i] - EPS));
}

/**
 * The clip with `takes` and `comp` set and what it plays brought in line: a MIDI folder's notes
 * (new ids from `makeId`) and the expression of the take its comp starts with; a mic folder's
 * sound as the take its comp starts with (what its waveform shows).
 */
export function applyComp(clip: Clip, makeId: () => string): Clip {
  if (!clip.takes?.length) return clip;
  const segs = compSegments(clip);
  const first = clip.takes[segs[0].take];
  if (clip.audio || first.audio) {
    // The folder's own gain, fades and stretch stay: only which sound, and where in it, is the take's
    const audio = first.audio && clip.audio ? { ...clip.audio, soundId: first.audio.soundId, offset: first.audio.offset } : (first.audio ?? clip.audio);
    if (audio && clip.audio && audio.soundId !== clip.audio.soundId) delete audio.tunedFrom;
    return { ...clip, comp: segs, ...(audio ? { audio } : {}) };
  }
  const next: Clip = { ...clip, comp: segs, notes: compNotes(clip).map((n) => ({ ...n, id: makeId() })) };
  if (first.expression) next.expression = first.expression;
  else delete next.expression;
  return next;
}

/**
 * A MIDI folder whose notes were edited in the piano roll (moved, transposed, quantized): each
 * comp stretch's edited notes go back into the take it plays, so the next comp change keeps them.
 * Unedited (or a mic folder): as it is.
 */
export function keepNoteEdits(clip: Clip): Clip {
  if (clip.audio || !clip.takes?.length) return clip;
  const playing = compNotes(clip);
  const key = (n: Omit<NoteEvent, 'id'>) => `${n.note}|${n.startOffset.toFixed(6)}|${n.duration}|${n.velocity}`;
  const now = clip.notes.map(key).sort().join(',');
  if (now === playing.map(key).sort().join(',')) return clip;
  const segs = compSegments(clip);
  const ends = segmentEnds(segs, clip.lengthBars);
  const takes = clip.takes.map((t) => ({ ...t, notes: [...(t.notes ?? [])] }));
  segs.forEach((s, i) => {
    const inside = (n: { startOffset: number }) => n.startOffset >= s.at - EPS && (n.startOffset < ends[i] - EPS || i === segs.length - 1);
    const take = takes[s.take];
    take.notes = [...take.notes.filter((n) => !inside(n)), ...clip.notes.filter(inside)];
  });
  return { ...clip, takes };
}

/** The comp with take `take` playing from `from` to `to` (bars into the clip), the rest as it was. */
export function setCompRange(clip: Pick<Clip, 'takes' | 'comp' | 'lengthBars'>, from: number, to: number, take: number): CompSegment[] {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(clip.lengthBars, Math.max(from, to));
  if (b - a < EPS) return compSegments(clip);
  const segs = compSegments(clip);
  const takeAt = (at: number) => [...segs].reverse().find((s) => s.at <= at + EPS)?.take ?? take;
  const next: CompSegment[] = [...segs.filter((s) => s.at < a - EPS), { at: a, take }, ...(b < clip.lengthBars - EPS ? [{ at: b, take: takeAt(b) }] : []), ...segs.filter((s) => s.at > b + EPS)];
  return compSegments({ ...clip, comp: next });
}

/** A new take added to the folder (made one from the clip's own content if it isn't one yet), comped in whole. */
export function addTake(clip: Clip, take: ClipTake): Clip {
  const takes: ClipTake[] = clip.takes?.length
    ? [...clip.takes]
    : [{ id: `${clip.id}-t0`, name: 'Take 1', ...(clip.audio ? { audio: clip.audio } : { notes: clip.notes, ...(clip.expression ? { expression: clip.expression } : {}) }) }];
  takes.push(take);
  return { ...clip, takes, comp: [{ at: 0, take: takes.length - 1 }] };
}

/** The folder with one take gone (the comp's stretches that used it go to the take before). Null if it was the last one. */
export function removeTake(clip: Clip, index: number): Clip | null {
  const takes = clip.takes ?? [];
  if (takes.length <= 1) return null;
  const left = takes.filter((_, i) => i !== index);
  const comp = compSegments(clip).map((s) => ({ at: s.at, take: s.take === index ? Math.max(0, index - 1) : s.take > index ? s.take - 1 : s.take }));
  return { ...clip, takes: left, comp };
}

/** A take folder of one take is just a clip: its takes and comp go. */
export function flattenTakes(clip: Clip): Clip {
  const { takes: _t, comp: _c, ...rest } = clip;
  return rest;
}

/** How many seconds the pieces of a comped sound overlap where the take changes (the automatic crossfade blends them there). */
export const COMP_CROSSFADE = 0.01;

/**
 * The pieces a mic take folder plays: one clip per comp stretch, its take's sound from the right
 * place (`secondsPerBar`: at the clip's tempo, stretch included). Each piece runs COMP_CROSSFADE
 * on into the next, so the automatic crossfade (audioClips.crossfades) blends them at equal power.
 * Any other clip comes back as it is.
 */
export function expandAudioComp(clip: Clip, secondsPerBar: number): Clip[] {
  if (!clip.audio || !clip.takes || clip.takes.length < 2) return [clip];
  const segs = compSegments(clip);
  const only = segs.length === 1 ? clip.takes[segs[0].take].audio : undefined;
  if (only && only.soundId === clip.audio.soundId && only.offset === clip.audio.offset) return [clip];
  const ends = segmentEnds(segs, clip.lengthBars);
  const overlap = COMP_CROSSFADE / secondsPerBar;
  return segs.map((s, i) => {
    const take = clip.takes![s.take].audio ?? clip.audio!;
    const first = i === 0;
    const last = i === segs.length - 1;
    return {
      ...clip,
      id: `${clip.id}#${i}`,
      startBar: clip.startBar + s.at,
      lengthBars: ends[i] - s.at + (last ? 0 : overlap),
      takes: undefined,
      comp: undefined,
      audio: {
        ...take,
        offset: take.offset + s.at * secondsPerBar,
        fadeIn: first ? clip.audio!.fadeIn : 0,
        fadeOut: last ? clip.audio!.fadeOut : 0,
        gain: clip.audio!.gain,
        // Played at the folder's stretch (the offsets above are worked out with it)
        ...(clip.audio!.stretchBpm ? { stretchBpm: clip.audio!.stretchBpm } : {}),
      },
    };
  });
}

/** Takes from a project file (absent when there are none or they're unreadable). */
export function normalizeTakes(raw: unknown, parseNote: (v: unknown) => NoteEvent | null): ClipTake[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ClipTake[] = [];
  raw.forEach((v, i) => {
    if (typeof v !== 'object' || v === null) return;
    const r = v as Record<string, unknown>;
    const audio = normalizeClipAudio(r.audio);
    const notes = Array.isArray(r.notes) ? r.notes.map(parseNote).filter((n): n is NoteEvent => !!n) : undefined;
    if (!audio && !notes) return;
    const expression = normalizeExpression(r.expression);
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : `take-${i}`,
      name: typeof r.name === 'string' && r.name ? r.name.slice(0, 40) : `Take ${i + 1}`,
      ...(audio ? { audio } : { notes: notes! }),
      ...(expression ? { expression } : {}),
    });
  });
  return out.length > 1 ? out : undefined;
}

/** Every clip as it plays: mic take folders as their comp's pieces (`secondsPerBarOf`: how long a bar of a clip's sound lasts, stretch included). */
export function expandAudioComps(clips: Clip[], secondsPerBarOf: (clip: Clip) => number): Clip[] {
  return clips.some((c) => c.audio && c.takes) ? clips.flatMap((c) => (c.audio && c.takes ? expandAudioComp(c, secondsPerBarOf(c)) : [c])) : clips;
}

/** The comp seen from `shift` bars further into the clip. */
const shiftComp = (clip: Clip, shift: number): CompSegment[] => {
  const segs = compSegments(clip);
  const takeAt = [...segs].reverse().find((s) => s.at <= shift + EPS)?.take ?? 0;
  return [{ at: 0, take: takeAt }, ...segs.filter((s) => s.at > shift + EPS).map((s) => ({ at: s.at - shift, take: s.take }))];
};

/**
 * A folder's takes after its left edge moved `delta` bars later (earlier if negative), `seconds`
 * that in its sound: every take moves with the clip, as its own notes, lanes and sound do.
 */
export function trimTakes(clip: Clip, delta: number, seconds: number): Pick<Clip, 'takes' | 'comp'> | Record<string, never> {
  if (!clip.takes?.length) return {};
  const takes = clip.takes.map((t) => ({
    ...t,
    ...(t.notes ? { notes: t.notes.map((n) => ({ ...n, startOffset: n.startOffset - delta })) } : {}),
    ...(t.expression ? { expression: moveExpression(t.expression, -delta) } : {}),
    ...(t.audio ? { audio: trimAudioStart(t.audio, seconds) } : {}),
  }));
  const comp = delta >= 0 ? shiftComp(clip, delta) : compSegments(clip).map((s, i) => ({ at: i ? s.at - delta : 0, take: s.take }));
  return { takes, comp };
}

/** A folder cut in two `rel` bars in (`seconds` that in its sound): each half keeps every take's part on its side. */
export function splitTakes(clip: Clip, rel: number, seconds: number, makeId: () => string): [Pick<Clip, 'takes' | 'comp'>, Pick<Clip, 'takes' | 'comp'>] | null {
  if (!clip.takes?.length) return null;
  const left = clip.takes.map((t) => {
    const out: ClipTake = { ...t, ...(t.notes ? { notes: t.notes.filter((n) => n.startOffset < rel - EPS) } : {}) };
    const expression = shiftExpression(t.expression, 0, rel);
    if (expression) out.expression = expression;
    else delete out.expression;
    return out;
  });
  const right = clip.takes.map((t) => {
    const out: ClipTake = {
      ...t,
      id: makeId(),
      ...(t.notes ? { notes: t.notes.filter((n) => n.startOffset >= rel - EPS).map((n) => ({ ...n, id: makeId(), startOffset: n.startOffset - rel })) } : {}),
      ...(t.audio ? { audio: splitAudio(t.audio, seconds) } : {}),
    };
    const expression = shiftExpression(t.expression, -rel, clip.lengthBars - rel);
    if (expression) out.expression = expression;
    else delete out.expression;
    return out;
  });
  return [
    { takes: left, comp: compSegments({ ...clip, lengthBars: rel }) },
    { takes: right, comp: shiftComp(clip, rel) },
  ];
}

const longest = (pieces: RecordedPiece[]): RecordedPiece => pieces.reduce((a, b) => (b.lengthBars > a.lengthBars + EPS ? b : a));

/** A piece of a mic recording to keep: song bars `startBar` for `lengthBars`, from `from` seconds into the recording. */
export interface RecordedPiece {
  startBar: number;
  lengthBars: number;
  from: number;
}

/**
 * Where a mic recording that began at `startBar` and lasted `seconds` goes: one piece, or with
 * takes on and the loop going round, a take per pass (`between(a, b)`: seconds from bar a to bar b
 * at the song's tempo). Punching, every piece is cut to the punch range. A pass that covers only
 * part of the span (the first, begun after the loop In; the last, stopped early) is a take only if
 * it starts where the span does; the others are dropped. Empty when nothing lands in range.
 */
export function recordedPieces(
  startBar: number,
  seconds: number,
  loop: { inBar: number; outBar: number } | null,
  punch: { inBar: number; outBar: number } | null,
  takes: boolean,
  between: (a: number, b: number) => number,
  barAfter: (bar: number, seconds: number) => number
): RecordedPiece[] {
  // The recording as passes: song spans with where each starts in the recording
  const passes: Array<{ a: number; b: number; from: number }> = [];
  // (Started before the loop In, the Transport still goes round the loop once it gets to Out)
  if (loop && startBar < loop.outBar - EPS) {
    let from = 0;
    let a = startBar;
    while (from < seconds - 1e-4 && passes.length < 512) {
      const full = between(a, loop.outBar);
      const b = from + full <= seconds ? loop.outBar : barAfter(a, seconds - from);
      passes.push({ a, b, from });
      from += full;
      a = loop.inBar;
    }
  } else passes.push({ a: startBar, b: barAfter(startBar, seconds), from: 0 });
  const looped = passes.length > 1;
  // The span the pieces are kept to
  const spanA = Math.max(looped ? loop!.inBar : startBar, punch ? punch.inBar : -Infinity);
  const spanB = Math.min(looped ? loop!.outBar : passes[0].b, punch ? punch.outBar : Infinity);
  if (spanB <= spanA + EPS) return [];
  const pieces = passes
    .map((p) => {
      const a = Math.max(p.a, spanA);
      const b = Math.min(p.b, spanB);
      return b > a + EPS ? { startBar: a, lengthBars: b - a, from: p.from + between(p.a, a) } : null;
    })
    .filter((p): p is RecordedPiece => !!p);
  if (!looped || !pieces.length) return pieces;
  const span = spanB - spanA;
  // A pass cut short by stopping just after the loop came round (under a beat) isn't a performance
  const played = pieces.filter((p, i) => i < pieces.length - 1 || p.lengthBars >= Math.min(0.25, span) - EPS || pieces.length === 1);
  const full = played.filter((p) => Math.abs(p.startBar - spanA) < EPS && p.lengthBars >= span - EPS);
  if (takes) {
    const whole = played.filter((p) => Math.abs(p.startBar - spanA) < EPS);
    // Every take a piece of the span's whole length (an early stop just leaves its end silent)
    return whole.length ? whole.map((p) => ({ ...p, lengthBars: span })) : [longest(played)];
  }
  // Without takes, the passes over the same span: the last whole one played, else the longest
  return [full.length ? full[full.length - 1] : longest(played)];
}
