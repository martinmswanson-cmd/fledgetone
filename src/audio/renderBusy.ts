/**
 * How many offline renders (exports, stems, freezes) are running right now, so things that
 * shouldn't interrupt one can wait for it: the update notice (pwa.ts) holds back until it's 0.
 */
import { create } from 'zustand';

export const useRenderBusy = create<{ running: number }>(() => ({ running: 0 }));

/** Run `render`, counted as running while it does. */
export async function countedRender<T>(render: () => Promise<T>): Promise<T> {
  useRenderBusy.setState((s) => ({ running: s.running + 1 }));
  try {
    return await render();
  } finally {
    useRenderBusy.setState((s) => ({ running: Math.max(0, s.running - 1) }));
  }
}
