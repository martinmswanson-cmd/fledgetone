/**
 * The toast's state: showToast puts a short message at the bottom of the screen.
 */
import { create } from 'zustand';

interface ToastState {
  text: string | null;
  /** Bumped on every message, so repeating the same one restarts its timer. */
  serial: number;
}

export const useToast = create<ToastState>(() => ({ text: null, serial: 0 }));

/** Show a short message at the bottom of the screen, e.g. why a keyboard shortcut did nothing. */
export function showToast(text: string): void {
  useToast.setState((s) => ({ text, serial: s.serial + 1 }));
}
