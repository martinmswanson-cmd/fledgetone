/**
 * Pocket's arranging: copy everything in the loop to right after it, put a build-up and a drop
 * at the loop's end (or the playhead), speed the loop up into the drop, and loop a clip. Each is
 * one undo step, and each returns what it did for a toast.
 */
import { useTimelineStore } from '../store/timelineStore';
import { uid, type Clip } from '../store/timelineTypes';
import { speedUpIntoDrop, suggestBlock } from '../store/speedUpActions';
import { SPEED_UP_DEFAULTS } from '../store/speedUp';

const EPS = 1e-6;

/** The block the tools work on: the loop when it's on, else the bars around the playhead the studio would pick. */
export function workingBlock(): { from: number; to: number } {
  const s = useTimelineStore.getState();
  if (s.loopRegion.enabled) return { from: s.loopRegion.inBar, to: s.loopRegion.outBar };
  const b = suggestBlock(s.playheadPosition);
  return { from: b.from, to: b.to };
}

/**
 * Copy every clip inside the loop (or starting in it, cut at its end) to right after it, and move
 * the loop onto the copy. A message for the person.
 */
export function repeatLoop(): string {
  const s = useTimelineStore.getState();
  const { inBar, outBar } = s.loopRegion;
  const span = outBar - inBar;
  const inside = s.clips.filter((c) => !c.audio && c.startBar >= inBar - EPS && c.startBar < outBar - EPS);
  if (!inside.length) return 'Nothing in the loop to repeat (audio clips stay where they are)';
  s.checkpoint();
  const copies: Clip[] = inside.map((c) => {
    const lengthBars = Math.min(c.lengthBars, outBar - c.startBar);
    return {
      ...c,
      id: uid('clip'),
      isSelected: false,
      startBar: c.startBar + span,
      lengthBars,
      notes: c.notes.filter((n) => n.startOffset < lengthBars - EPS).map((n) => ({ ...n, id: uid('note') })),
    };
  });
  useTimelineStore.setState((st) => ({ clips: [...st.clips, ...copies] }));
  useTimelineStore.getState().setLoopRange(outBar, outBar + span);
  return `Repeated bars ${inBar} to ${outBar}: the loop is on the copy now`;
}

/** A build-up into a drop at the end of the loop (or the next bar after the playhead). */
export function buildAndDrop(): string {
  const s = useTimelineStore.getState();
  const drop = s.loopRegion.enabled ? s.loopRegion.outBar : Math.ceil(s.playheadPosition + EPS);
  return s.addBuildAndDrop(drop) ?? `A build-up into a drop at bar ${drop}: riser, snare roll and an impact`;
}

/** The last quarter of the loop speeds up into the drop at its end (25%, or 50% with the drum roll), and snaps back. */
export function speedUpLoop(roll: boolean): string {
  const { from, to } = workingBlock();
  return speedUpIntoDrop({ ...SPEED_UP_DEFAULTS, from, to, amount: roll ? 0.5 : 0.25, curve: roll ? 'build' : 'steady' }, { roll });
}

/** Loop a clip (turning the loop on). */
export function loopClip(clip: Pick<Clip, 'startBar' | 'lengthBars'>): void {
  const s = useTimelineStore.getState();
  s.setLoopRange(clip.startBar, clip.startBar + clip.lengthBars);
  if (!useTimelineStore.getState().loopRegion.enabled) s.toggleLoop();
}
