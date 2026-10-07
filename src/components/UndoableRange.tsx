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
  const gesture = useRef({ pending: false, inBurst: false, burstTimer: 0, checkpointAt: 0, step: undefined as unknown });

  const change = (next: number) => {
    const g = gesture.current;
    if (undoable && g.pending) {
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
              // If the double-click's first click moved the thumb it already checkpointed: the
              // reset belongs to that same step
              gesture.current.pending = performance.now() - gesture.current.checkpointAt > DOUBLE_CLICK_MS;
              change(resetValue);
            }
      }
    />
  );
};
