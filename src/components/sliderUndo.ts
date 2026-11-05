/**
 * How a slider's adjustments become undo steps (UndoableRange, Pocket's TouchRange): one step for
 * a drag, a burst of arrow keys or a lone change (a screen reader's), taken with the first change
 * that actually changes the song, so a press or a click that changes nothing leaves no empty step.
 * Also a name field's (useFieldUndo).
 */
import { useRef } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { isSliderKey } from './keyboard';
import { fieldEdit } from './fieldUndo';

/** Slider key presses closer together than this are one adjustment. */
const KEY_BURST_MS = 800;

type RedoSteps = ReturnType<typeof useTimelineStore.getState>['future'];

/** The newest undo step (identity only). */
export const latestStep = () => {
  const { past } = useTimelineStore.getState();
  return past[past.length - 1];
};

export interface SliderGesture {
  /** A change from here on starts a new step */
  pending: boolean;
  /** A pointer is down on the slider */
  pointer: boolean;
  inBurst: boolean;
  burstTimer: number;
  /** When the gesture's step was taken, the step, the value then and the redo steps it cleared */
  checkpointAt: number;
  step: unknown;
  startValue: number;
  future: RedoSteps;
}

/** A gesture's state, and the one listener that ends a pointer's */
type Gesture = SliderGesture & { undoable: boolean; release: () => void };
function newGesture(): Gesture {
  const g: Gesture = {
    pending: false,
    pointer: false,
    inBurst: false,
    burstTimer: 0,
    checkpointAt: 0,
    step: undefined,
    startValue: 0,
    future: [],
    undoable: true,
    release: () => {
      g.pointer = false;
      window.removeEventListener('pointerup', g.release, true);
      window.removeEventListener('pointercancel', g.release, true);
      // (A pending step nothing changed after is let go)
      if (g.undoable) useTimelineStore.getState().endEdit();
    },
  };
  return g;
}

/**
 * A slider's undo gesture. `press` on pointer down, `key` on keydown and `blur` on blur; `change`
 * makes each change (`apply`), with the slider's value before it.
 */
export function useSliderUndo(undoable = true) {
  const ref = useRef<Gesture | null>(null);
  const get = () => (ref.current ??= newGesture());
  return {
    /** The gesture now (for a double-click reset) */
    gesture: (): SliderGesture => get(),
    press: () => {
      const g = get();
      g.pending = true;
      g.undoable = undoable;
      if (!g.pointer) {
        g.pointer = true;
        window.addEventListener('pointerup', g.release, true);
        window.addEventListener('pointercancel', g.release, true);
      }
    },
    key: (e: { key: string }) => {
      if (!isSliderKey(e)) return;
      const g = get();
      // A burst carries on only while its step is still the latest one (not after an undo)
      if (!g.inBurst || latestStep() !== g.step) g.pending = true;
      g.inBurst = true;
      clearTimeout(g.burstTimer);
      g.burstTimer = window.setTimeout(() => (g.inBurst = false), KEY_BURST_MS);
    },
    blur: () => {
      get().inBurst = false;
      if (undoable) useTimelineStore.getState().endEdit();
    },
    /** `fresh`: true or false to say whether this change starts a step (a double-click's reset) */
    change: (apply: () => void, value: number, fresh?: boolean) => {
      if (!undoable) {
        apply();
        return;
      }
      const g = get();
      // A change with no drag or key burst behind it (a screen reader's) is an adjustment of its own
      if (fresh !== undefined) g.pending = fresh;
      else if (!g.pointer && !g.inBurst) g.pending = true;
      if (!g.pending) {
        apply();
        return;
      }
      const store = useTimelineStore.getState();
      const before = latestStep();
      const future = store.future;
      // The step is taken only if the change touches the song (see beginEdit)
      store.beginEdit();
      apply();
      useTimelineStore.getState().endEdit();
      const step = latestStep();
      if (step === before) return;
      g.pending = false;
      g.step = step;
      g.future = future;
      g.startValue = value;
      g.checkpointAt = performance.now();
    },
  };
}

const storeHistory = {
  begin: () => useTimelineStore.getState().beginEdit(),
  end: () => useTimelineStore.getState().endEdit(),
  latest: latestStep,
};

/**
 * A name field's undo step (see fieldEdit): `focus` on focus, `blur` on blur, and each change made
 * through `change`. Typing a whole name is one step, and typing after another step is a new one.
 */
export function useFieldUndo() {
  const ref = useRef<ReturnType<typeof fieldEdit> | null>(null);
  return (ref.current ??= fieldEdit(storeHistory));
}
