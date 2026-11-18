/**
 * Shift and a letter opens a tool: the plugin browser, the tuner, the spectrum analyser, the FX
 * rack and the Mixer. Plain data and one pure function, so the timeline's key handler, the menus
 * (which show the keys beside their items) and the tests agree on them. They work where the other
 * timeline shortcuts do: not while typing, not with a dialog open, and not while the computer
 * keyboard is a piano (it takes the letters).
 */
export const TOOL_SHORTCUTS = {
  /** Browse plugins (effects go on the selected track) */
  plugins: 'P',
  tuner: 'T',
  analyser: 'A',
  /** The Inspector and its FX rack, shown or hidden */
  fxRack: 'F',
  /** The Mixer in the bottom panel, shown or hidden */
  mixer: 'X',
} as const;

export type ToolShortcut = keyof typeof TOOL_SHORTCUTS;

/** The keys as a menu shows them: "Shift+P". */
export const toolShortcutLabel = (tool: ToolShortcut): string => `Shift+${TOOL_SHORTCUTS[tool]}`;

/** The tool a key press opens, if it's one of these (Shift and the letter alone: no Ctrl, Cmd or Alt). */
export function toolForKey(e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): ToolShortcut | null {
  if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return null;
  const key = e.key.toUpperCase();
  return (Object.keys(TOOL_SHORTCUTS) as ToolShortcut[]).find((t) => TOOL_SHORTCUTS[t] === key) ?? null;
}
