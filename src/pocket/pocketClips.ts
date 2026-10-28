/**
 * Pocket's clip maths, as plain functions: the one clip a cell becomes from the clips it had (their
 * notes, controller lanes and step lanes kept where they played), and a section's copy of a clip
 * (linked copies share their notes, as the studio's "Duplicate linked" does, so they stay linked);
 * and the undo history of an edit folded into one step.
 */
import type { Clip, ClipExpression, ExprPoint, StepLane } from '../store/timelineTypes';
import { exprSpec, exprValueAt, lanesOf } from '../store/expression';
import { MAX_STEP_LANES, stepBars } from '../store/stepLanes';

const EPS = 1e-6;

/** What a cell's one clip takes from its pieces. */
export type MergedContent = Pick<Clip, 'notes' | 'expression' | 'stepLanes' | 'groove' | 'wobble'>;

/** Said when the pieces can't become one clip as they sound. */
const ASK = 'edit it on a computer, or join its clips there first';

/**
 * The content of one clip from `pieces` (a track's clips inside a section, cut at its edges, in
 * order), the clip starting at `from`: each piece's notes and lanes moved to
 * where they play. A message instead when that would change how it sounds: pieces with different
 * feels or wobble rates, take folders, or step lanes that only some pieces (with notes) have.
 * `newId` gives the notes new ids (null: keep them).
 */
export function mergePieces(pieces: readonly Clip[], from: number, newId: (() => string) | null): MergedContent | string {
  const first = pieces[0];
  if (pieces.some((p) => p.takes?.length)) return `This part has recorded takes in it: ${ASK}.`;
  if (pieces.some((p) => JSON.stringify(p.groove) !== JSON.stringify(first.groove) || p.wobble !== first.wobble)) return `This part's clips have different feels: ${ASK}.`;
  const off = (p: Clip) => p.startBar - from;
  const notes = pieces.flatMap((p) => p.notes.filter((n) => n.startOffset < p.lengthBars - EPS).map((n) => ({ ...n, id: newId ? newId() : n.id, startOffset: n.startOffset + off(p) })));

  // Controller lanes: each piece's points where it plays, held to its value at its start and end
  // (and at rest over a piece without that lane), so a glide never runs across into the next one
  const expression: ClipExpression = {};
  for (const lane of new Set(pieces.flatMap((p) => lanesOf(p.expression)))) {
    const { step } = exprSpec(lane);
    const points: ExprPoint[] = [];
    for (const p of pieces) {
      const own = p.expression?.[lane];
      const at0 = off(p), at1 = off(p) + p.lengthBars;
      points.push({ at: at0, value: exprValueAt(own, 0, step) });
      for (const q of own ?? []) if (q.at > EPS && q.at < p.lengthBars - EPS) points.push({ at: q.at + at0, value: q.value });
      points.push({ at: at1, value: exprValueAt(own, p.lengthBars, step) });
    }
    if (points.some((q) => q.value !== 0)) expression[lane] = points;
  }

  // Step lanes: a lane per setting, its steps moved with their piece. A piece after the first with
  // a lane must have it too, set from its start or carrying straight on from the piece before
  // (else the setting went back to the track's own between them, which one clip can't say)
  const stepLanes: StepLane[] = [];
  for (const target of new Set(pieces.flatMap((p) => (p.stepLanes ?? []).filter((l) => l.steps.length).map((l) => l.target)))) {
    let lane = null as StepLane | null;
    let end = 0;
    for (const p of pieces) {
      const own = p.stepLanes?.find((l) => l.target === target && l.steps.length);
      if (!own) {
        if (lane && p.notes.length) return `Some of this part's clips have step lanes and some don't: ${ASK}.`;
        continue;
      }
      const shift = off(p);
      const steps = shift / stepBars(own);
      if (Math.abs(steps - Math.round(steps)) > EPS || (lane && (own.grid !== lane.grid || !!own.perNote !== !!lane.perNote))) return `This part's step lanes don't line up across its clips: ${ASK}.`;
      if (lane && Math.abs(end - shift) > EPS && !own.steps.some((s) => Math.abs(s.at) < EPS)) return `Some of this part's clips have step lanes and some don't: ${ASK}.`;
      const moved = own.steps.filter((s) => s.at > -EPS && s.at < p.lengthBars - EPS).map((s) => ({ ...s, at: s.at + shift }));
      lane = lane ? { ...lane, steps: [...lane.steps, ...moved] } : { ...own, steps: moved };
      end = shift + p.lengthBars;
    }
    if (lane) stepLanes.push(lane);
  }
  if (stepLanes.length > MAX_STEP_LANES) return `This part has more step lanes than one clip can hold: ${ASK}.`;

  return {
    notes,
    ...(Object.keys(expression).length ? { expression } : {}),
    ...(stepLanes.length ? { stepLanes } : {}),
    ...(first.groove ? { groove: first.groove } : {}),
    ...(first.wobble ? { wobble: first.wobble } : {}),
  };
}

/**
 * A copy of `part` (a clip, or the part of one inside a section) moved `shift` bars, with id `id`.
 * Linked (`pattern`): it shares the clip's notes, so the two stay linked (patterns.ts unlinks a
 * new member whose content isn't the pattern's); else its notes get ids of their own.
 */
export function sectionCopy(part: Clip, shift: number, id: string, pattern: string | undefined, newId: () => string): Clip {
  const copy: Clip = { ...part, id, startBar: part.startBar + shift, isSelected: false, notes: pattern ? part.notes : part.notes.map((n) => ({ ...n, id: newId() })) };
  if (pattern) copy.pattern = pattern;
  else delete copy.pattern;
  return copy;
}

/**
 * The undo history after an edit (`after`) with the steps it pushed onto `before` folded into its
 * first (the song as it was before the edit); null when it pushed one or none. The history is
 * capped, so where it was is found rather than counted.
 */
export function foldSteps<T>(before: readonly T[], after: readonly T[]): T[] | null {
  if (after === before) return null;
  const at = before.length ? after.lastIndexOf(before[before.length - 1]) : -1;
  return after.length > at + 2 ? after.slice(0, at + 2) : null;
}
