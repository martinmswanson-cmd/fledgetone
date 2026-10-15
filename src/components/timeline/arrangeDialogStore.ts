/**
 * Which tab of the Arrange a beat dialog (ArrangeDialog.tsx) is open, and the bar and track it was
 * opened for: kept outside the component so menus, the palette and right-click menus can open it.
 */
import { create } from 'zustand';

export type ArrangeTab = 'melody' | 'drops' | 'form' | 'tag';

/** A block of bars a tool was opened for (Speed up into here: the loop, say). */
export interface ArrangeRange {
  from: number;
  to: number;
}

/** Which tab of the Arrange dialog is open, and the bar (and track, or block of bars) it was opened for. */
export const useArrangeDialog = create<{ open: null | { tab: ArrangeTab; bar?: number; trackId?: string; range?: ArrangeRange } }>(() => ({ open: null }));

/** Open the Arrange dialog on a tab. */
export const openArrange = (tab: ArrangeTab, bar?: number, trackId?: string, range?: ArrangeRange): void => useArrangeDialog.setState({ open: { tab, bar, trackId, range } });
