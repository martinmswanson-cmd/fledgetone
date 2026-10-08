import React from 'react';
import { useTimelineStore } from '../../store/timelineStore';
import type { AutomationParam, Track } from '../../store/timelineTypes';
import { AUTOMATED_TIP, useAutomatedValue } from './automationHooks';

/** "AUTO" next to a control an automation lane drives. Clicking it shows that lane on the timeline. */
export const AutoBadge: React.FC<{ trackId: string; param: AutomationParam }> = ({ trackId, param }) => (
  <button
    type="button"
    title={`${AUTOMATED_TIP} (click to show the lane)`}
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      useTimelineStore.getState().showAutomation(trackId, true, param);
    }}
    className="shrink-0 px-1 rounded-sm border border-amber-500/50 bg-amber-500/15 text-amber-300 text-[8px] leading-[13px] font-mono font-bold tracking-wide hover:bg-amber-500/30"
  >
    AUTO
  </button>
);

/**
 * Renders `children` with the value an automation lane gives `param` at the playhead (null while no
 * lane owns it). Only this re-renders as the value follows the playhead, not the panel around it.
 */
export const Automatable: React.FC<{ track: Track; param: AutomationParam; children: (automated: number | null) => React.ReactNode }> = ({
  track,
  param,
  children,
}) => {
  const automated = useAutomatedValue(track, param);
  return <>{children(automated)}</>;
};
