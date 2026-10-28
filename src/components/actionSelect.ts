/**
 * Menus drawn as a <select> whose options are actions (Mangle…, TOOLS, Load preset…): picking
 * an option with the mouse runs it at once, but on Windows and Linux the arrow keys (and typed
 * letters) change a closed <select> straight away, which would run the first action the moment a
 * keyboard user starts looking. Here a choice made from the keyboard waits, shown in the menu,
 * until Enter (or leaving the menu) runs it; Esc lets it go.
 */
import React, { useState } from 'react';

/** Keys that leave a waiting choice to run or drop (the rest, arrows and letters, only move it). */
const COMMIT_KEYS = new Set(['Enter', 'Tab', 'Escape']);

export interface ActionSelectRules {
  /** The option the menu shows: '' (its label) or a choice waiting for Enter */
  readonly pending: string;
  /** A key pressed on the menu: what to run now ('' for nothing), and whether the key was used for it */
  keyDown: (key: string) => { run: string; used: boolean };
  /** The menu's value changed: what to run now ('' for nothing) */
  change: (value: string) => string;
  /** Focus left the menu: what to run now ('' for nothing) */
  blur: () => string;
}

/** The rules, with no React (so Node tests them). `show` is told what the menu should show. */
export function actionSelect(show: (value: string) => void = () => {}): ActionSelectRules {
  let pending = '';
  let byKey = false;
  const set = (v: string) => {
    pending = v;
    show(v);
  };
  /** The waiting choice, taken */
  const take = () => {
    const v = pending;
    set('');
    return v;
  };
  return {
    get pending() {
      return pending;
    },
    keyDown(key) {
      byKey = !COMMIT_KEYS.has(key) && key !== ' ';
      // (A closed menu changes during the key's own default action: a change after that, a click
      // in a list the key opened as on a Mac, is a pick)
      if (byKey) setTimeout(() => (byKey = false), 0);
      if (key === 'Escape') set('');
      if (key !== 'Enter' || !pending) return { run: '', used: false };
      return { run: take(), used: true };
    },
    change(value) {
      set(value);
      if (!byKey) return take();
      // Stepping through the options of a closed menu: wait for Enter
      byKey = false;
      return '';
    },
    blur() {
      byKey = false;
      return take();
    },
  };
}

/** The props for an action <select>: spread them on it, with its first option's value ''. `run` gets the chosen value. */
export function useActionSelect(run: (value: string) => void): Pick<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'onKeyDown' | 'onBlur'> {
  const [pending, setPending] = useState('');
  const [r] = useState(() => actionSelect(setPending));
  const go = (v: string) => v && run(v);
  return {
    value: pending,
    onChange: (e) => go(r.change(e.target.value)),
    onKeyDown: (e) => {
      const { run: v, used } = r.keyDown(e.key);
      if (used) e.preventDefault();
      go(v);
    },
    onBlur: () => go(r.blur()),
  };
}

/** An action <select> (its first option's value ''): `onAction` gets the chosen option's value. */
export const ActionSelect: React.FC<Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'onKeyDown' | 'onBlur'> & { onAction: (value: string) => void }> = ({ onAction, ...rest }) =>
  React.createElement('select', { ...rest, ...useActionSelect(onAction) });
