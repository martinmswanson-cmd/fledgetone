/**
 * How a name field's typing becomes an undo step (useFieldUndo in sliderUndo.ts): a whole name typed
 * is one step, taken with the first change after the field is focused (see beginEdit). If another
 * step is taken while the field keeps focus (a drag that doesn't take focus, an Undo), the next
 * change starts a step of its own, so the typing after it isn't folded into that other step.
 */

/** The undo history as a field sees it */
export interface FieldHistory {
  /** The song now becomes a step with the first change that follows (beginEdit) */
  begin: () => void;
  /** A begin nothing changed after is let go (endEdit) */
  end: () => void;
  /** The newest undo step (identity only) */
  latest: () => unknown;
}

export function fieldEdit(history: FieldHistory) {
  // The newest step when the field's edit began or last changed something
  let step: unknown;
  return {
    focus: () => {
      history.begin();
      step = history.latest();
    },
    blur: () => history.end(),
    /** Make a change (`apply`): a step of its own if another step was taken since the last one */
    change: (apply: () => void) => {
      if (history.latest() !== step) history.begin();
      apply();
      step = history.latest();
    },
  };
}
