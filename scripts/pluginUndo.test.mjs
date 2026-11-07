// Turning a built-in plugin's knobs is undoable (src/store/pluginEdits.ts), in every plugin's own
// window as in Fledge Synth's panel and Pocket's Sound tool: one drag is one step, Reset all is one
// step, a preset is one step. The store and the plugin host are stood in for. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const STORE = stub('export const useTimelineStore = { getState: () => globalThis.__store };');
const WAM = stub('export const captureWamStateNow = (id) => globalThis.__captured.push(id); export const pluginIdOfControls = () => "fx1";');
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === './timelineStore') return { url: ${JSON.stringify(STORE)}, shortCircuit: true };
  if (specifier === '../audio/wamHost') return { url: ${JSON.stringify(WAM)}, shortCircuit: true };
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);
globalThis.window = globalThis;
globalThis.__captured = [];
const store = { past: [], checkpointPlugin(id) { this.past.push({ plugins: [id] }); }, someOtherEdit() { this.past.push({}); } };
globalThis.__store = store;
const { editPluginParam, editPluginParams, editPluginProgram, resetAllMoves } = await import('../src/store/pluginEdits.ts');

const fake = () => {
  const values = [0, 0.5, 0.5, 0];
  return { values, program: -1, set: (i, v) => (values[i] = v), setProgram: async function (p) { this.program = p; } };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('every move of one drag is one step; another slider, or after a pause, is another', async () => {
  store.past = [];
  const c = fake();
  for (let k = 1; k <= 30; k++) editPluginParam(c, 1, 0.5 + k / 60);
  assert.equal(store.past.length, 1);
  editPluginParam(c, 0, 0.2);
  assert.equal(store.past.length, 2);
  // (Something else done in between: the next move is a step of its own)
  store.someOtherEdit();
  editPluginParam(c, 0, 0.3);
  assert.equal(store.past.length, 4);
  await wait(300);
  assert.ok(globalThis.__captured.includes('fx1'), 'the new settings are read onto the track');
});

test('Reset all is one step, not one per slider, and the turn after it is its own', () => {
  store.past = [];
  const c = fake();
  editPluginParam(c, 0, 0.9);
  editPluginParams(c, [[0, 0], [1, 0.5], [2, 0.5], [3, 0]]);
  assert.equal(store.past.length, 2);
  assert.deepEqual(c.values, [0, 0.5, 0.5, 0]);
  editPluginParam(c, 0, 0.4);
  assert.equal(store.past.length, 3);
});

test('Reset all leaves parameters a lane holds with it; with nothing else to move, it makes no step', () => {
  store.past = [];
  const c = fake();
  const params = [
    { value: 0.8, defaultValue: 0, held: true },
    { value: 0.5, defaultValue: 0.5 },
    { value: 0.2, defaultValue: 0.5 },
    { value: 0, defaultValue: 0 },
  ];
  assert.deepEqual(resetAllMoves(params), [[2, 0.5]]);
  params[2].value = 0.5;
  assert.deepEqual(resetAllMoves(params), []);
  editPluginParams(c, resetAllMoves(params));
  assert.equal(store.past.length, 0, 'no empty undo step');
  assert.deepEqual(c.values, [0, 0.5, 0.5, 0]);
});

test('a preset is a step of its own', async () => {
  store.past = [];
  const c = fake();
  await editPluginProgram(c, 2);
  await editPluginProgram(c, 3);
  assert.equal(store.past.length, 2);
  assert.equal(c.program, 3);
});

test("a built-in plugin's window changes its settings only through these", () => {
  const panel = readFileSync(new URL('../src/components/timeline/BuiltinPluginPanel.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /controls\.set(Program)?\(/);
  for (const name of ['editPluginParam(', 'editPluginParams(', 'editPluginProgram(']) assert.ok(panel.includes(name), name);
});
