import { create } from 'zustand';

/**
 * Which tour or tutorial is running and at which step, and what this browser has done before:
 * whether the welcome has been shown, and which lessons were finished (or where one was left).
 * Kept in localStorage; if that's unavailable (private windows) everything still works, it just
 * isn't remembered.
 */

const SEEN_KEY = 'bosBeatbox.welcomeSeen';
const PROGRESS_KEY = 'bosBeatbox.tutorialProgress';

export interface LessonProgress {
  /** Finished at least once */
  done?: boolean;
  /** Where it was left, to resume from */
  step?: number;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered this time
  }
}

interface TourState {
  /** The lesson running and its step, or null */
  active: { lesson: string; step: number } | null;
  progress: Record<string, LessonProgress>;
  welcomeSeen: boolean;
  start: (lesson: string, step?: number) => void;
  goTo: (step: number) => void;
  /** Stop, remembering the step to resume from (or that it's finished) */
  stop: (finished?: boolean) => void;
  markWelcomeSeen: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  active: null,
  progress: read<Record<string, LessonProgress>>(PROGRESS_KEY, {}),
  welcomeSeen: read<boolean>(SEEN_KEY, false),
  start: (lesson, step = 0) => set({ active: { lesson, step } }),
  goTo: (step) => {
    const a = get().active;
    if (a) set({ active: { ...a, step } });
  },
  stop: (finished = false) => {
    const a = get().active;
    if (!a) return;
    const prev = get().progress[a.lesson] ?? {};
    const progress = { ...get().progress, [a.lesson]: finished ? { done: true } : { ...prev, step: a.step } };
    write(PROGRESS_KEY, progress);
    set({ active: null, progress });
  },
  markWelcomeSeen: () => {
    write(SEEN_KEY, true);
    set({ welcomeSeen: true });
  },
}));
