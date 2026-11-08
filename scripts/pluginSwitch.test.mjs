// Switching a built-in plugin's whole sound with notes held (a preset chosen, an undo putting the
// settings back, Reset all, Surge XT's patch loading): the output fades out on the old sound, the
// change is made silent, and it fades back in (processor.ts 'switch' / 'switched'; the host sends
// them round every such change, builtinHost.ts switching). No click, no burst louder than either
// sound, held notes playing on (Surge XT's stop as its patch changes is the fade out). Fledge
// Synth's own part (bb_settle: its eased level straight at the new one) is in its wasm. Run with
// `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const catalog = new URL('../src/audio/plugins/pluginCatalog.ts', import.meta.url).href;
const catalogGpl = new URL('../src/audio/plugins/pluginCatalogGpl.ts', import.meta.url).href;
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
const { GPL_PLUGIN_FAMILIES } = await import(catalogGpl).catch(() => ({}));

const sr = 48000;
const scope = { sampleRate: sr, currentFrame: 0 };
let toHost = () => {};
/** The processor class as the worklet has it; its messages out go to `toHost` */
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
const wasm = (file) => new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${file}`, import.meta.url)));
const fledge = wasm(PLUGIN_FAMILIES.find((f) => f.family === 'fledge').file);
const NEURO = 5;
const INIT_SAW = 0;

const makeProc = (module, family, opts = {}) => {
  const sent = [];
  toHost = (m) => sent.push(m);
  const p = new Proc({ processorOptions: { family, module, index: 0, outputGain: 1, limits: null, ...opts } });
  assert.ok(p.alive, `${family} started`);
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
/** The loudest 10 ms (steps of 2.5 ms) of `x` between `from` and `to` seconds */
const loudest = (x, from, to) => {
  let most = 0;
  for (let t = from; t + 0.01 <= to + 1e-9; t += 0.0025) most = Math.max(most, rms(x.subarray(Math.round(t * sr), Math.round((t + 0.01) * sr))));
  return most;
};
/** The largest step from one sample to the next between `from` and `to` seconds */
const step = (x, from, to) => {
  let most = 0;
  for (let i = Math.max(1, Math.round(from * sr)); i < Math.round(to * sr); i++) most = Math.max(most, Math.abs(x[i] - x[i - 1]));
  return most;
};
const chord = (p, vel = 100) => p.message({ type: 'events', events: [45, 52, 57].map((n) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x90, n, vel] } })) });

/**
 * A chord held through a switch made by `messages` at 0.5 s (the host's way: 'switch', the
 * change, 'switched'). Before and after levels, the switch's first 60 ms, its steps against the
 * steady ones, and how loud the chord is at the end.
 */
const through = (p, messages) => {
  chord(p);
  const before = render(p, 0.5);
  for (const m of messages) p.message(m);
  const after = render(p, 0.5);
  const x = new Float32Array(before.length + after.length);
  x.set(before);
  x.set(after, before.length);
  const at = before.length / sr;
  return {
    was: loudest(x, at - 0.3, at - 0.01),
    first: loudest(x, at, at + 0.06),
    settled: loudest(x, at + 0.15, at + 0.45),
    jump: step(x, at - 0.01, at + 0.04),
    steady: Math.max(step(x, at - 0.3, at - 0.02), step(x, at + 0.15, at + 0.45)),
    end: rms(x.subarray(x.length - 4800)),
  };
};
const ownValues = (() => {
  const { p } = makeProc(fledge, 'fledge');
  return p.describe().map((d) => d.value);
})();

test('Fledge Synth: undo from Neuro back to your own sound, on a held chord: no burst, no click', () => {
  const { p } = makeProc(fledge, 'fledge', { program: NEURO });
  const r = through(p, [{ type: 'switch' }, { type: 'noProgram', asked: 1 }, ...ownValues.map((value, index) => ({ type: 'set', index, value })), { type: 'switched' }]);
  // (Before: the own sound came in at Neuro's level, about 2.5 times its own for 10 ms, peak 0.88)
  assert.ok(r.first <= 1.1 * Math.max(r.was, r.settled), `first 60 ms ${r.first.toFixed(3)} against ${r.was.toFixed(3)} before, ${r.settled.toFixed(3)} after`);
  assert.ok(r.jump <= 1.5 * r.steady + 0.01, `step ${r.jump.toFixed(3)} at the switch against ${r.steady.toFixed(3)} steady`);
  assert.ok(r.end > 0.05, 'the chord plays on');
  assert.equal(p.program(), -1);
});

test('Fledge Synth: Init saw chosen from Neuro, and Neuro from your own sound, on a held chord', () => {
  for (const [from, to] of [
    [NEURO, INIT_SAW],
    [undefined, NEURO],
  ]) {
    const { p } = makeProc(fledge, 'fledge', from === undefined ? {} : { program: from });
    const r = through(p, [{ type: 'switch' }, { type: 'program', index: to, asked: 1 }, { type: 'switched' }]);
    assert.ok(r.first <= 1.1 * Math.max(r.was, r.settled), `${from}->${to}: first 60 ms ${r.first.toFixed(3)} against ${r.was.toFixed(3)} / ${r.settled.toFixed(3)}`);
    assert.ok(r.jump <= 1.5 * r.steady + 0.01, `${from}->${to}: step ${r.jump.toFixed(3)} against ${r.steady.toFixed(3)}`);
    assert.ok(r.end > 0.03, 'the chord plays on');
    assert.equal(p.program(), to);
  }
});

test('the switch: silent, at once; playing, its messages wait for the fade out, sync never does', () => {
  // Nothing playing: the preset is chosen at once (an offline render's settings, a stopped song)
  const quiet = makeProc(fledge, 'fledge');
  render(quiet.p, 0.05);
  quiet.p.message({ type: 'switch' });
  quiet.p.message({ type: 'program', index: NEURO, asked: 1 });
  assert.equal(quiet.p.program(), NEURO);
  quiet.p.message({ type: 'switched' });

  // Playing: the preset waits until the old sound has faded out (5 ms), the answers with it
  const { p, sent } = makeProc(fledge, 'fledge');
  chord(p);
  render(p, 0.3);
  sent.length = 0;
  p.message({ type: 'switch' });
  p.message({ type: 'program', index: NEURO, asked: 1 });
  p.message({ type: 'describe', id: 3 });
  p.message({ type: 'sync', id: 4 });
  assert.equal(p.program(), -1, 'not yet: the old sound fades out first');
  assert.deepEqual(
    sent.map((m) => m.type),
    ['synced'],
    'sync is answered at once (everything before it has arrived), the describe waits'
  );
  const fade = render(p, 0.005);
  assert.ok(Math.abs(fade.at(-1)) < 0.02, 'faded out');
  render(p, 0.003);
  assert.equal(p.program(), NEURO, 'made once silent');
  assert.equal(sent.find((m) => m.id === 3)?.params.length > 0, true, 'the describe answered after it, with the new settings');
  // Silent until 'switched'; never longer than the hold (a lost 'switched')
  assert.ok(rms(render(p, 0.02)) < 1e-4, 'silent while the switch is being made');
  render(p, 0.1);
  assert.ok(rms(render(p, 0.05)) > 0.02, 'back after the hold without its end');
});

test('the switch waits for all its messages, the old sound playing on, then fades out (never a long silence)', () => {
  // An undo's 318 settings take the page a few ms to send: until 'switched' the old sound plays
  // on at full level, then the dip is only the fades (5 ms out, 10 ms in)
  const { p } = makeProc(fledge, 'fledge', { program: NEURO });
  chord(p);
  render(p, 0.3);
  p.message({ type: 'switch' });
  p.message({ type: 'noProgram', asked: 1 });
  const gathering = render(p, 0.008);
  assert.ok(rms(gathering.subarray(-128)) > 0.05, 'still playing while the messages come');
  assert.equal(p.program(), NEURO, 'nothing changed yet');
  for (const [index, value] of ownValues.entries()) p.message({ type: 'set', index, value });
  p.message({ type: 'switched' });
  const dip = render(p, 0.04);
  let silent = 0;
  for (let b = 0; b < dip.length / 128; b++) if (rms(dip.subarray(b * 128, (b + 1) * 128)) < 0.002) silent++;
  assert.ok(silent <= 2, `${silent} silent blocks: only where the fades meet`);
  assert.equal(p.program(), -1);
  assert.ok(rms(dip.subarray(dip.length - 480)) > 0.05, 'back to full within 20 ms');
  // Never sent its end: after SWITCH_GATHER_S it fades out and is made all the same
  const q = makeProc(fledge, 'fledge');
  chord(q.p);
  render(q.p, 0.2);
  q.p.message({ type: 'switch' });
  q.p.message({ type: 'program', index: NEURO, asked: 1 });
  render(q.p, 0.06);
  assert.equal(q.p.program(), NEURO);
});

test('a knob turned while it plays is not a switch (no fade)', () => {
  const pair = [makeProc(fledge, 'fledge'), makeProc(fledge, 'fledge')];
  const t0 = scope.currentFrame;
  const outs = pair.map(({ p }, k) => {
    scope.currentFrame = t0;
    chord(p);
    render(p, 0.2);
    p.message({ type: 'set', index: 0, value: 0.3 });
    return render(p, 0.1);
  });
  assert.deepEqual(outs[0], outs[1]);
  assert.ok(rms(outs[0].subarray(0, 480)) > 0.02, 'no dip');
});

const gpl = GPL_PLUGIN_FAMILIES?.find?.((f) => f.family === 'surge');
const surgeFile = gpl && new URL(`../public/fledgetone-plugins/${gpl.file}`, import.meta.url);
test('Surge XT: a patch loaded with notes held stops them with a fade, not a cut', { skip: !surgeFile || !fs.existsSync(surgeFile) }, () => {
  const surge = new WebAssembly.Module(fs.readFileSync(surgeFile));
  const { p } = makeProc(surge, 'surge', { ownMemory: true });
  chord(p, 110);
  const before = render(p, 0.4);
  const patch = fs.readFileSync(new URL('../public/fledgetone-plugins/gpl/surge-patches/Basses/Bass 1.fxp', import.meta.url));
  for (const m of [{ type: 'switch' }, { type: 'load', data: patch.buffer.slice(patch.byteOffset, patch.byteOffset + patch.byteLength) }, { type: 'switched' }]) p.message(m);
  const after = render(p, 0.1);
  const was = rms(before.subarray(before.length - 480));
  assert.ok(was > 0.02, 'the chord sounds before');
  // (Before: silent from the first sample of the load: a cut)
  const firstMs = rms(after.subarray(0, 48));
  assert.ok(firstMs > 0.5 * was, `the first ms ${firstMs.toFixed(3)} still near ${was.toFixed(3)}: fading, not cut`);
  assert.ok(rms(after.subarray(192, 240)) < 0.2 * was, 'faded out by 5 ms');
});

// --- The host: which changes are switches, and only while the context plays ---

const queue = [];
const sentToProc = [];
const later = (f) => queue.push(f);
const deliver = async () => {
  for (let n = 0; n < 2000 && queue.length; n++) {
    queue.shift()();
    await new Promise((r) => setImmediate(r));
  }
};
globalThis.window = globalThis;
globalThis.AudioWorkletNode = class {
  constructor(ctx, name, { processorOptions }) {
    this.port = {
      postMessage: (m) => {
        sentToProc.push(m.type);
        later(() => this.proc.port.onmessage({ data: m }));
      },
      onmessage: null,
    };
    toHost = (m) => later(() => this.port.onmessage?.({ data: m }));
    this.proc = new Proc({ processorOptions });
  }
};
const { createBuiltinInstance } = await import('../src/audio/plugins/builtinHost.ts');
const { editPluginParams } = await import('../src/store/pluginEdits.ts').catch(() => ({}));
const make = async (state, running) => {
  const ctx = { audioWorklet: { addModule: async () => {} }, sampleRate: sr, state: running ? 'running' : 'suspended' };
  const made = createBuiltinInstance(ctx, 'builtin:fledge/Fledge Synth', state);
  let done = false;
  made.then(
    () => (done = true),
    () => (done = true)
  );
  while (!done) {
    await deliver();
    await new Promise((r) => setTimeout(r, 1));
  }
  return made;
};
/** The messages the host sends while `act` runs */
const sends = async (act) => {
  await deliver();
  sentToProc.length = 0;
  await act();
  await deliver();
  return sentToProc.filter((t) => t !== 'describe' && t !== 'events');
};

test('the host: a preset, an undo of one, Reset all are switches (faded) while it plays; one knob is not', async () => {
  const inst = await make(undefined, true);
  const { controls, audioNode: node } = inst;
  const own = node.getStateNow();
  // A preset chosen
  assert.deepEqual(await sends(() => controls.setProgram(NEURO)), ['switch', 'program', 'switched']);
  const neuro = node.getStateNow();
  // Its undo: every setting back, no preset
  const undo = await sends(() => node.setState(own));
  assert.equal(undo[0], 'switch');
  assert.equal(undo.at(-1), 'switched');
  assert.ok(undo.filter((t) => t === 'set').length > 10);
  assert.ok(undo.includes('noProgram'));
  // Redo
  const redo = await sends(() => node.setState(neuro));
  assert.deepEqual([redo[0], redo[1], redo.at(-1)], ['switch', 'program', 'switched']);
  // An undo of one knob's turn: that knob alone, no fade (it moves as the knob does)
  const turned = { ...own, values: own.values.map((v, i) => (i === 0 ? 0.31 : v)) };
  await node.setState(turned);
  await deliver();
  const one = await sends(() => node.setState(own));
  assert.ok(one.length && one.every((t) => t === 'set'), `no switch for one knob: ${[...new Set(one)]}`);
  // Reset all (several at once)
  if (editPluginParams) {
    await node.setState(neuro);
    await deliver();
    const moves = controls.params().flatMap((p, i) => (p.value !== p.defaultValue ? [[i, p.defaultValue]] : [])).slice(0, 5);
    const reset = await sends(() => editPluginParams(controls, moves, undefined));
    assert.deepEqual([reset[0], reset.at(-1)], ['switch', 'switched']);
  }
});

test('the host: in a context that is not playing (an offline render a script holds paused), no fade is asked for', async () => {
  const inst = await make(undefined, false);
  assert.deepEqual(await sends(() => inst.controls.setProgram(NEURO)), ['program']);
  const undo = await sends(() => inst.audioNode.setState({ builtin: 1, values: ownValues }));
  assert.ok(!undo.includes('switch') && !undo.includes('switched'));
});
