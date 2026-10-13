/**
 * A range slider whose adjustments are one undo step each (a drag, a burst of arrow keys, a
 * double-click reset), used for most of the app's sliders.
 */
import React, { useRef } from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { isSliderKey } from './keyboard';

interface UndoableRangeProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number;
  onValue: (value: number) => void;
  /** The value a double-click restores (no double-click reset if left out). */
  resetValue?: number;
  /** False while the slider edits something outside the arrangement (no history). */
  undoable?: boolean;
}

/** Slider key presses closer together than this are one adjustment. */
const KEY_BURST_MS = 800;
/** Covers both clicks of a double-click. */
const DOUBLE_CLICK_MS = 600;

type RedoSteps = ReturnType<typeof useTimelineStore.getState>['future'];

/** The newest undo step (identity only). */
const latestStep = () => {
  const { past } = useTimelineStore.getState();
  return past[past.length - 1];
};

/**
 * A range slider whose adjustments are one undo step each: a drag, a burst of arrow-key presses,
 * or a double-click reset. It checkpoints just before the first change of a gesture, not on
 * every value it passes through, and a click that changes nothing leaves no empty step.
 */
export const UndoableRange: React.FC<UndoableRangeProps> = ({
  value,
  onValue,
  resetValue,
  undoable = true,
  onPointerDown,
  onKeyDown,
  onBlur,
  ...rest
}) => {
  const gesture = useRef({
    pending: false,
    inBurst: false,
    burstTimer: 0,
    checkpointAt: 0,
    step: undefined as unknown,
    /** The value when the gesture's step was taken, and the redo steps that step cleared */
    startValue: value,
    future: [] as RedoSteps,
  });

  const change = (next: number) => {
    const g = gesture.current;
    if (undoable && g.pending) {
      g.future = useTimelineStore.getState().future;
      g.startValue = value;
      useTimelineStore.getState().checkpoint();
      g.step = latestStep();
      g.checkpointAt = performance.now();
    }
    g.pending = false;
    onValue(next);
  };

  return (
    <input
      type="range"
      {...rest}
      value={value}
      onPointerDown={(e) => {
        gesture.current.pending = true;
        onPointerDown?.(e);
      }}
      onKeyDown={(e) => {
        const g = gesture.current;
        if (isSliderKey(e)) {
          // A burst carries on only while its step is still the latest one (not after an undo)
          if (!g.inBurst || latestStep() !== g.step) g.pending = true;
          g.inBurst = true;
          clearTimeout(g.burstTimer);
          g.burstTimer = window.setTimeout(() => (g.inBurst = false), KEY_BURST_MS);
        }
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        gesture.current.inBurst = false;
        onBlur?.(e);
      }}
      onChange={(e) => change(Number(e.target.value))}
      onDoubleClick={
        resetValue === undefined
          ? undefined
          : () => {
              if (value === resetValue) return;
              const g = gesture.current;
              // If the double-click's first click moved the thumb it already checkpointed: the
              // reset belongs to that same step
              const sameStep = undoable && performance.now() - g.checkpointAt <= DOUBLE_CLICK_MS && latestStep() === g.step;
              if (sameStep && g.startValue === resetValue) {
                // The first click moved the thumb off its reset value and this puts it back: no
                // change at all, so leave history as it was (an empty step makes the next undo do nothing)
                onValue(resetValue);
                useTimelineStore.setState((s) => ({ past: s.past.slice(0, -1), future: g.future }));
                return;
              }
              g.pending = !sameStep;
              change(resetValue);
            }
      }
    />
  );
};
