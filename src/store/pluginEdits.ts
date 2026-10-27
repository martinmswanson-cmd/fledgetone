/**
 * Turning a built-in plugin's knobs as undoable edits (Fledge Synth's panel in the studio, its
 * Sound tool in Pocket). The first move of a gesture makes an undo step holding the plugin's
 * settings before it (checkpointPlugin in timelineStore.ts); moves of the same control close
 * together, with nothing else done between, are the same step; choosing a preset is a step of
 * its own. The new settings are read onto the track a moment later, so a save or a redo has them.
 */
import type { BuiltinControls } from '../audio/plugins/builtinHost';
import { captureWamStateNow, pluginIdOfControls } from '../audio/wamHost';
import { useTimelineStore } from './timelineStore';
import { TABLE_CAP, USER_TABLE_INDEX, type UserTable } from '../audio/plugins/userTable';

/** Moves this close together are one undo step. */
const GESTURE_MS = 800;
let last: { key: string; at: number; step: unknown } | null = null;
const reading = new Map<string, number>();

/** Start an undo step for `pluginId`, unless this move of control `control` goes on the gesture before. */
function begin(pluginId: string, control: string): void {
  const now = Date.now();
  const key = `${pluginId}:${control}`;
  const top = () => useTimelineStore.getState().past.at(-1);
  if (!last || last.key !== key || now - last.at > GESTURE_MS || top() !== last.step) {
    useTimelineStore.getState().checkpointPlugin(pluginId);
    last = { key, at: now, step: top() };
  } else last.at = now;
}

/** Read the plugin's settings onto its track once the moves pause. */
function readSoon(pluginId: string): void {
  clearTimeout(reading.get(pluginId));
  reading.set(
    pluginId,
    window.setTimeout(() => {
      reading.delete(pluginId);
      captureWamStateNow(pluginId);
    }, 250)
  );
}

/**
 * Set parameter `index` (0 to 1) of a live built-in plugin, as an undoable edit. Moves of the same
 * `control` (the parameter, unless a group of them is drawn as one, like a shape's steps) close
 * together are one step.
 */
export function editPluginParam(controls: BuiltinControls, index: number, value: number, pluginId = pluginIdOfControls(controls), control = String(index)): void {
  if (pluginId) begin(pluginId, control);
  controls.set(index, value);
  if (pluginId) readSoon(pluginId);
}

/** Choose preset `program` of a live built-in plugin, as an undo step of its own. */
export async function editPluginProgram(controls: BuiltinControls, program: number, pluginId = pluginIdOfControls(controls)): Promise<void> {
  if (pluginId) {
    last = null;
    begin(pluginId, 'preset');
    // (The next turn of a knob is a step of its own)
    last = null;
  }
  await controls.setProgram(program);
  if (pluginId) readSoon(pluginId);
}

/**
 * Give Fledge Synth a user table (or take it away: null) as an undo step of its own; with
 * `oscillator` ("A" or "B"), that oscillator plays it too. False if the table couldn't be read.
 */
export async function editPluginTable(controls: BuiltinControls, table: UserTable | null, oscillator?: 'A' | 'B', pluginId = pluginIdOfControls(controls)): Promise<boolean> {
  if (pluginId) {
    last = null;
    begin(pluginId, 'table');
    last = null;
  }
  const ok = await controls.setUserTable(table);
  if (ok && oscillator) {
    const i = controls.params().findIndex((p) => p.name === `${oscillator} table`);
    if (i >= 0) controls.set(i, USER_TABLE_INDEX / (TABLE_CAP - 1));
  }
  if (pluginId) readSoon(pluginId);
  return ok;
}
