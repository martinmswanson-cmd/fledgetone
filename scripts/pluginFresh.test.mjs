// Undoing a preset file chosen from "(none)" (Surge XT's patches): the processor starts the plugin
// again with no patch (processor.ts 'fresh'), so with the same settings it plays exactly as it did
// before the patch, and the host's setState asks for that (builtinHost.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);

const { BUILTIN_PROCESSOR_SOURCE } = await import('../src/audio/plugins/processor.ts');
const { GPL_PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalogGpl.ts');
const { PARAM_LIMITS, OUTPUT_TRIMS_DB, ownMemoryFor } = await import('../src/audio/plugins/paramLimits.ts');

const sr = 48000;
const scope = { sampleRate: sr, currentFrame: 0 };
const sent = [];
const processorClass = () => {
  let C;
  new Function('scope', 'sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'console', BUILTIN_PROCESSOR_SOURCE.replace(/\bcurrentFrame\b/g, 'scope.currentFrame'))(
    scope,
    sr,
    class {
      constructor() {
        this.port = { postMessage: (m) => sent.push(m) };
      }
    },
    (_, c) => (C = c),
    { log() {} }
  );
  return C;
};
const surge = GPL_PLUGIN_FAMILIES.find((f) => f.family === 'surge');
const url = 'builtin:surge/Surge XT';
const patch = (name) => {
  const b = fs.readFileSync(new URL(`../public/fledgetone-plugins/${surge.plugins[0].presetFiles.dir}/${name}.fxp`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
/** A Surge XT processor as builtinHost makes it, with `values` (each in a module instance of its own, as each context has) */
const make = (values) => {
  sent.length = 0;
  const Proc = processorClass();
  const module = new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${surge.file}`, import.meta.url)));
  return new Proc({ processorOptions: { family: 'surge', module, index: 0, values, ...ownMemoryFor('surge'), limits: PARAM_LIMITS[url] ?? null, outputGain: 10 ** ((OUTPUT_TRIMS_DB[url] ?? 0) / 20) } });
};
/** Play a chord for `seconds`: the left channel */
const play = (p, seconds) => {
  p.message({ type: 'events', events: [48, 55, 64].map((n) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x90, n, 100] } })) });
  const got = new Float32Array(Math.ceil((seconds * sr) / 128) * 128);
  for (let b = 0; b < got.length / 128; b++) {
    const out = [new Float32Array(128), new Float32Array(128)];
    p.process([], [out]);
    got.set(out[0], b * 128);
    scope.currentFrame += 128;
  }
  return got;
};
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('Surge XT: a patch, then back to none, plays exactly as it did before the patch', { skip: !surge && 'GPL plugins not in this build' }, () => {
  const ready = (() => {
    make();
    return sent.find((m) => m.type === 'ready');
  })();
  const values = ready.params.map((p) => p.value);
  const before = play(make(values), 0.5);
  assert.ok(peak(before) > 1e-3, 'it plays');

  const p = make(values);
  p.message({ type: 'load', data: patch('Basses/Bass 1') });
  const withPatch = sent.at(-1);
  assert.equal(withPatch.type, 'params');
  // (The patch's own sound differs, its hidden settings too)
  assert.ok(maxDiff(play(make(values), 0.5), (() => {
    const q = make(values);
    q.message({ type: 'load', data: patch('Basses/Bass 1') });
    return play(q, 0.5);
  })()) > 1e-3, 'the patch sounds different');

  sent.length = 0;
  p.message({ type: 'fresh' });
  const reply = sent.find((m) => m.type === 'params');
  assert.ok(reply, 'it says what it plays now');
  assert.equal(reply.program, -1);
  assert.deepEqual(reply.params.map((x) => x.value), values, 'the panel is back as it started');
  values.forEach((v, i) => p.message({ type: 'set', index: i, value: v }));
  assert.equal(maxDiff(before, play(p, 0.5)), 0, 'not as before the patch');
});

test('setState with no preset file puts a plugin with one back to none (an undo of a preset chosen from "(none)")', () => {
  const host = fs.readFileSync(new URL('../src/audio/plugins/builtinHost.ts', import.meta.url), 'utf8');
  assert.match(host, /saved\.preset === undefined\) await startFresh\(\)/);
  assert.match(host, /type: 'fresh'/);
});
