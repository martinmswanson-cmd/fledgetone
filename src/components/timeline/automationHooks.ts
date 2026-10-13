/**
 * React hook for a control that follows an automation lane: the lane's value at the playhead,
 * updated a few times a second while playing.
 */
import { useEffect, useReducer } from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { AutomationParam, Track } from '../../store/timelineTypes';
import { specOf, laneOf, laneValueAt } from '../../audio/automation';

/** How often a control following a lane catches up while playing (ms): smooth enough to watch, no per-frame renders. */
const FOLLOW_MS = 125;

/**
 * The value an automation lane gives `param` at the playhead (in the setting's own units), or null
 * while no lane with points owns it. While playing it updates a few times a second; stopped, as
 * soon as the playhead moves. Only the component using it re-renders, and only when the value changes.
 */
export function useAutomatedValue(track: Track, param: AutomationParam): number | null {
  const points = laneOf(track, param)?.points;
  const active = points && points.length > 0 ? points : null;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!active) return;
    const { toReal } = specOf(param);
    const readNow = () => toReal(laneValueAt(active, useTimelineStore.getState().playheadPosition)!);
    let last = readNow();
    let timer = 0;
    const check = () => {
      timer = 0;
      const value = readNow();
      if (Object.is(value, last)) return;
      last = value;
      rerender();
    };
    const unsubscribe = useTimelineStore.subscribe((s, prev) => {
      if (s.playheadPosition === prev.playheadPosition) return;
      if (!s.isPlaying) {
        clearTimeout(timer);
        check();
      } else if (!timer) {
        timer = window.setTimeout(check, FOLLOW_MS);
      }
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [active, param]);

  // Read at render, so it's right whatever made the component render
  return active ? specOf(param).toReal(laneValueAt(active, useTimelineStore.getState().playheadPosition)!) : null;
}

/** Tooltip of a control an automation lane drives. */
export const AUTOMATED_TIP = 'Automated: edit or clear the lane';
