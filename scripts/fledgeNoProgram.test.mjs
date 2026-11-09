// Undoing a preset chosen from "(your own sound)" on Fledge Synth, the one built-in whose presets
// start at none: the plugin goes back to no preset (its window, Pocket's Sound tool and the saved
// settings say "(your own sound)", and Previous/Next start from there), with the sound exactly as
// before and a held note sounding on, not cut. The processor (processor.ts 'noProgram') keeps the
// preset off until another is chosen, so later answers can't put it back, and the host
// (builtinHost.ts setState) asks for that. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const catalog = new URL('../src/audio/plugins/pluginCatalog.ts', import.meta.url).href;
const SOURCES = stub(`import { PLUGIN_FAMILIES } from ${JSON.stringify(catalog)};
export const GPL_PLUGINS = false;
export const pluginFamilies = () => PLUGIN_FAMILIES;
export const pluginSource = () => ({});`);
const plugins = new URL('../public/fledgetone-plugins/', import.meta.url).href;
const RECORDINGS = stub(`import { readFileSync } from 'node:fs';
export const recordingBytes = async (source, file) => { const b = readFileSync(new URL(file, ${JSON.stringify(plugins)})); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };`);
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === './pluginSources') return { url: ${JSON.stringify(SOURCES)}, shortCircuit: true };
  if (specifier === '../recordingStore') return { url: ${JSON.stringify(RECORDINGS)}, shortCircuit: true };
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);

const { BUILTIN_PROCESSOR_SOURCE } = await import('../src/audio/plugins/processor.ts');
const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');

const sr = 48000;
const scope = { sampleRate: sr, currentFrame: 0 };
let toHost = () => {};
/** The processor class as the worklet has it; its messages out go to `toHost` (later, as a port's do) */
const Proc = (() => {
  let C;
  new Function('scope', 'sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'console', BUILTIN_PROCESSOR_SOURCE.replace(/\bcurrentFrame\b/g, 'scope.currentFrame'))(
    scope,
    sr,
    class {
      constructor() {
        const send = toHost;
        this.port = { postMessage: (m) => send(m) };
      }
    },
    (_, c) => (C = c),
    { log() {} }
  );
  return C;
})();
const fledge = PLUGIN_FAMILIES.find((f) => f.family === 'fledge');
const module = new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${fledge.file}`, import.meta.url)));
const NEURO = 5;

/** A Fledge Synth processor made as builtinHost makes it, from `state`; `sent` collects what it says */
const makeProc = (state = {}) => {
  const sent = [];
  toHost = (m) => sent.push(m);
  const p = new Proc({ processorOptions: { family: 'fledge', module, index: 0, values: state.values, program: state.program, outputGain: 1, limits: null } });
  return { p, sent };
};
/** `seconds` of a processor's left channel */
const render = (p, seconds) => {
  const got = new Float32Array(Math.ceil((seconds * sr) / 128) * 128);
  for (let b = 0; b < got.length / 128; b++) {
    const out = [new Float32Array(128), new Float32Array(128)];
    p.process([], [out]);
    got.set(out[0], b * 128);
    scope.currentFrame += 128;
  }
  return got;
};
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

test('the processor: no preset again, until one is chosen; the sound and a held note are untouched', () => {
  const start = makeProc();
  const ready = start.sent.find((m) => m.type === 'ready');
  assert.equal(ready.program, -1, 'Fledge Synth starts at "(your own sound)"');
  assert.ok(ready.programs.length > NEURO);

  // Two alike from the start: a preset chosen in each, a chord held, then one is told "no preset"
  const pair = [makeProc(), makeProc()];
  for (const { p, sent } of pair) {
    p.message({ type: 'program', index: NEURO, asked: 1 });
    assert.equal(sent.at(-1).program, NEURO);
    p.message({ type: 'events', events: [45, 52, 57].map((n) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x90, n, 110] } })) });
  }
  const t0 = scope.currentFrame;
  const before = [render(pair[0].p, 0.5), (scope.currentFrame = t0, render(pair[1].p, 0.5))];
  assert.deepEqual(before[0], before[1]);
  const [a, b] = pair;
  b.sent.length = 0;
  b.p.message({ type: 'noProgram', asked: 2 });
  // (Nothing to answer: the parameters didn't move)
  assert.equal(b.sent.filter((m) => m.type === 'params').length, 0);
  b.p.message({ type: 'describe', id: 7 });
  const said = b.sent.find((m) => m.type === 'params' && m.id === 7);
  assert.equal(said.program, -1, 'it says no preset, as later answers must');
  assert.equal(said.asked, 2);
  assert.deepEqual(
    said.params.map((x) => x.value),
    a.p.describe().map((x) => x.value),
    'every setting as it was'
  );
  b.p.message({ type: 'legacy', id: 8, count: 0 });
  assert.equal(b.sent.find((m) => m.id === 8).program, -1);
  // The held chord plays on exactly as it would have (no cut, no click)
  const t1 = scope.currentFrame;
  const after = [render(a.p, 0.5), (scope.currentFrame = t1, render(b.p, 0.5))];
  assert.ok(rms(after[1]) > 0.05, 'the held chord still sounds');
  assert.deepEqual(after[1], after[0]);

  // Started again after a blow-up: still no preset, the settings kept (not the preset's put back)
  const values = b.p.describe().map((x) => x.value);
  scope.currentFrame += sr * 2;
  b.p.blewUp();
  assert.equal(b.p.program(), -1);
  assert.deepEqual(b.p.describe().map((x) => x.value), values);

  // A preset chosen again: that one
  b.p.message({ type: 'program', index: NEURO + 1, asked: 3 });
  assert.equal(b.sent.at(-1).program, NEURO + 1);
  assert.equal(b.sent.at(-1).asked, 3);
});

// --- The host, with its processor in a stand-in worklet ---

const queue = [];
const later = (f) => queue.push(f);
/** Deliver every message on its way (each way in order, as a port does) */
const settle = async () => {
  for (let n = 0; n < 1000 && queue.length; n++) {
    queue.shift()();
    await new Promise((r) => setImmediate(r));
  }
};
globalThis.window = globalThis;
globalThis.AudioWorkletNode = class {
  constructor(ctx, name, { processorOptions }) {
    this.port = { postMessage: (m) => later(() => this.proc.port.onmessage({ data: m })), onmessage: null };
    toHost = (m) => later(() => this.port.onmessage?.({ data: m }));
    this.proc = new Proc({ processorOptions });
  }
};
const { createBuiltinInstance } = await import('../src/audio/plugins/builtinHost.ts');
const ctx = { audioWorklet: { addModule: async () => {} }, sampleRate: sr };
const make = async (state) => {
  const made = createBuiltinInstance(ctx, 'builtin:fledge/Fledge Synth', state);
  let done = false;
  made.then(
    () => (done = true),
    () => (done = true)
  );
  while (!done) {
    await settle();
    await new Promise((r) => setTimeout(r, 1));
  }
  return made;
};

test('the host: undo of a preset chosen from "(your own sound)" goes back to no preset, and redo to the preset', async () => {
  const inst = await make(undefined);
  const node = inst.audioNode;
  const { controls } = inst;
  const start = node.getStateNow();
  assert.equal(controls.program(), -1);
  assert.equal('program' in start, false);

  let told = 0;
  controls.subscribe(() => told++);
  await controls.setProgram(NEURO);
  await settle();
  assert.equal(controls.program(), NEURO);
  const preset = node.getStateNow();
  assert.equal(preset.program, NEURO);

  // Undo: the settings before the preset
  told = 0;
  await node.setState(start);
  await settle();
  assert.equal(controls.program(), -1, 'the window and Pocket show "(your own sound)"');
  assert.ok(told > 0, 'the panels hear of it');
  assert.equal('program' in node.getStateNow(), false, 'the track and saves have no preset');
  assert.deepEqual(node.getStateNow().values, start.values, 'every setting as before');
  // A later read of the plugin (the panel's, an automation lane's) keeps it
  controls.subscribe(() => {});
  await settle();
  assert.equal(controls.program(), -1);

  // Redo: the preset again
  await node.setState(preset);
  await settle();
  assert.equal(controls.program(), NEURO);
  assert.deepEqual(node.getStateNow(), preset);
});

test('the host: an answer sent before the undo, arriving after it, does not put the preset back', async () => {
  const inst = await make(undefined);
  const node = inst.audioNode;
  const start = node.getStateNow();
  // A redo and an undo in quick succession: the preset's answer is still on its way at the undo
  await inst.controls.setProgram(NEURO);
  inst.controls.subscribe(() => {});
  await node.setState(start);
  await settle();
  assert.equal(inst.controls.program(), -1);
  assert.equal('program' in node.getStateNow(), false);
  // And the other way: undo then redo before any answer
  await node.setState({ ...start, program: NEURO });
  await node.setState(start);
  await node.setState({ ...start, program: NEURO + 1 });
  await settle();
  assert.equal(inst.controls.program(), NEURO + 1);
});

test('a saved state with a preset, or no settings at all, still works as before', async () => {
  const inst = await make({ builtin: 1, program: NEURO });
  assert.equal(inst.controls.program(), NEURO);
  // (Settings with no values: nothing to go back to, the preset stays)
  await inst.audioNode.setState({ builtin: 1 });
  await settle();
  assert.equal(inst.controls.program(), NEURO);
});
