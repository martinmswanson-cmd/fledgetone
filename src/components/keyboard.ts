/**
 * Shared rules for the app's global keyboard shortcuts (timeline, piano roll, guide).
 * Shortcuts must never steal keys from something the user is typing into, but a slider or menu
 * that merely has focus shouldn't switch them off either.
 */

/** <input> types that take typed text. An input without a type (or an unknown one) is "text". */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password', 'date', 'datetime-local', 'month', 'time', 'week']);

/** Keys a focused range slider uses to move its thumb. */
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * True when keys pressed on `target` are typed text: text-like inputs, textareas, editable
 * content, and a focused <select> (it picks options by typing their first letters).
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** True for a key that moves a focused range slider. */
export function isSliderKey(e: { key: string }): boolean {
  return SLIDER_KEYS.has(e.key);
}

/**
 * True when a global shortcut handler should leave this key alone: the user is typing, the key
 * moves the focused slider, or a dialog is open. Every other key on a slider (Space, Ctrl+Z,
 * the deck's pads...) still reaches the shortcuts.
 */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (isTextEntry(e.target)) return true;
  if (e.target instanceof HTMLInputElement && e.target.type === 'range' && isSliderKey(e)) return true;
  // Escape in a plugin's window closes that window (its own handler), not the piano roll
  if (e.key === 'Escape' && e.target instanceof Element && e.target.closest('[data-plugin-window]')) return true;
  // Knobs drawn as sliders (role="slider", as Fledge Synth's) take the same keys
  if (e.target instanceof Element && e.target.closest('[role="slider"]') && isSliderKey(e)) return true;
  return document.querySelector('[role="dialog"]') !== null;
}

/**
 * Let menus give focus back once they've done their job: a <select> blurs itself after the user
 * picks an option, so the next key goes to the shortcuts instead of its type-ahead search.
 * Changes made from the keyboard (arrow keys on a closed menu) keep focus, so stepping through
 * the options still works. Menus inside dialogs keep focus too: shortcuts are off there anyway,
 * and focus must stay in the dialog. Returns an uninstall function.
 */
export function blurMenusAfterChange(): () => void {
  let lastKey: { target: EventTarget | null; at: number } = { target: null, at: 0 };
  const onKeyDown = (e: KeyboardEvent) => {
    lastKey = { target: e.target, at: performance.now() };
  };
  const onChange = (e: Event) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement) || t.closest('[role="dialog"]')) return;
    if (lastKey.target === t && performance.now() - lastKey.at < 500) return;
    t.blur();
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('change', onChange, true);
  return () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('change', onChange, true);
  };
}
