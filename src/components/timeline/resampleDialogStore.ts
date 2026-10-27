/**
 * Whether the Resample dialog (ResampleDialog.tsx) is open, and what it starts on: the selected
 * clips or the loop range, and where the new sound goes. Kept apart so menus can open it.
 */
import { create } from 'zustand';
import { useTimelineStore } from '../../store/timelineStore';
import type { ResampleTarget } from '../../store/resample';

export type ResampleFrom = 'clips' | 'mix' | 'track';

export const useResampleDialog = create<{ open: boolean; from: ResampleFrom; target: ResampleTarget }>(() => ({ open: false, from: 'clips', target: 'audio' }));

/** Open Resample on the selected clips (if any), else the loop range. */
export function openResample(target: ResampleTarget = 'audio', from?: ResampleFrom): void {
  const any = useTimelineStore.getState().clips.some((c) => c.isSelected);
  useResampleDialog.setState({ open: true, target, from: from ?? (any ? 'clips' : 'mix') });
}
