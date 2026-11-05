/**
 * A range slider whose adjustments are one undo step each (a drag, a burst of arrow keys, a
 * screen reader's change, a double-click reset), used for most of the app's sliders and Pocket's
 * Mix all faders.
 */
import React from 'react';
import { useTimelineStore } from '../store/timelineStore';
import { latestStep, useSliderUndo } from './sliderUndo';

interface UndoableRangeProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number;
  onValue: (value: number) => void;
  /** The value a double-click restores (no double-click reset if left out). */
  resetValue?: number;
  /** False while the slider edits something outside the arrangement (no history). */
  undoable?: boolean;
  /**
   * The position an arrow key moves it to from `value` (1 up or right, -1 down or left), for a
   * slider whose value is rounded before it's kept (see roundedKeyStep); the browser's own step otherwise.
   */
  keyStep?: (value: number, dir: 1 | -1) => number;
}

/** Covers both clicks of a double-click. */
const DOUBLE_CLICK_MS = 600;

/**
 * A range slider whose adjustments are one undo step each: a drag, a burst of arrow-key presses,
 * a lone change (a screen reader's) or a double-click reset. The step is taken with the first
 * change of a gesture that changes the song (see useSliderUndo), so a click or a key press that
 * changes nothing leaves no empty step.
 */
export const UndoableRange: React.FC<UndoableRangeProps> = ({
  value,
  onValue,
  resetValue,
  undoable = true,
  keyStep,
  onPointerDown,
  onKeyDown,
  onBlur,
  ...rest
}) => {
  const undo = useSliderUndo(undoable);

  return (
    <input
      type="range"
      {...rest}
      value={value}
      onPointerDown={(e) => {
        undo.press();
        onPointerDown?.(e);
      }}
      onKeyDown={(e) => {
        undo.key(e);
        onKeyDown?.(e);
        const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
        if (keyStep && dir && !e.defaultPrevented && !rest.disabled) {
          e.preventDefault();
          const lo = Number(rest.min ?? 0);
          const hi = Number(rest.max ?? 100);
          const next = Math.max(lo, Math.min(hi, keyStep(value, dir)));
          if (next !== value) undo.change(() => onValue(next), value);
        }
      }}
      onBlur={(e) => {
        undo.blur();
        onBlur?.(e);
      }}
      onChange={(e) => {
        const next = Number(e.target.value);
        undo.change(() => onValue(next), value);
      }}
      onDoubleClick={
        resetValue === undefined
          ? undefined
          : () => {
              if (value === resetValue) return;
              const g = undo.gesture();
              // If the double-click's first click moved the thumb it already took a step: the
              // reset belongs to that same step
              const sameStep = undoable && performance.now() - g.checkpointAt <= DOUBLE_CLICK_MS && latestStep() === g.step;
              if (sameStep && g.startValue === resetValue) {
                // The first click moved the thumb off its reset value and this puts it back: no
                // change at all, so leave history as it was (an empty step makes the next undo do nothing)
                onValue(resetValue);
                useTimelineStore.setState((s) => ({ past: s.past.slice(0, -1), future: g.future }));
                return;
              }
              undo.change(() => onValue(resetValue), value, !sameStep);
            }
      }
    />
  );
};
