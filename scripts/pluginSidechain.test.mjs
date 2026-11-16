// A sidechain into a built-in plugin (processor.ts): a plugin that listens to one (Fledge
// Compressor) follows the second input while the host says one is connected, and its own input
// otherwise; a plugin that doesn't listen ignores it. Run with `npm test`.
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
const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');

const sr = 48000;
const scope = { sampleRate: sr, currentFrame: 0 };
const sent = [];
let Proc;
new Function('scope', 'sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'console', BUILTIN_PROCESSOR_SOURCE.replace(/\bcurrentFrame\b/g, 'scope.currentFrame'))(
  scope,
  sr,
  class {
    constructor() {
      this.port = { postMessage: (m) => sent.push(m) };
    }
  },
  (_, c) => (Proc = c),
  { log() {} }
);
const family = (name) => PLUGIN_FAMILIES.find((f) => f.family === name);
const make = (fam, name, opts = {}) => {
  sent.length = 0;
  const f = family(fam);
  const index = f.plugins.findIndex((p) => p.name === name);
  assert.ok(index >= 0, name);
  const module = new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${f.file}`, import.meta.url)));
  const p = new Proc({ processorOptions: { family: fam, module, index, outputGain: 1, limits: null, ...opts } });
  const ready = sent.find((m) => m.type === 'ready');
  assert.ok(ready, `${name} started`);
  return { p, ready };
};
const tone = (hz, amp) => Float32Array.from({ length: 128 }, (_, k) => amp * Math.sin((2 * Math.PI * hz * (scope.currentFrame + k)) / sr));
/**
 * Play `seconds` of a quiet 1 kHz tone through it, with `key` on the second input (a loud 60 Hz
 * tone, "silent": connected but handing in no channels, or nothing); the gain over the last tenth
 * of a second, in dB
 */
const gain = (p, seconds, key) => {
  let [inE, outE] = [0, 0];
  const blocks = Math.round((seconds * sr) / 128);
  for (let b = 0; b < blocks; b++) {
    const x = tone(1000, 0.01);
    const out = [new Float32Array(128), new Float32Array(128)];
    const k = key === 'loud' ? tone(60, 0.5) : null;
    p.process(k ? [[x, x], [k, k]] : [[x, x], []], [out]);
    assert.ok(out[0].every(Number.isFinite) && out[1].every(Number.isFinite));
    if (b >= blocks - 38) for (let i = 0; i < 128; i++) (inE += x[i] * x[i]), (outE += out[0][i] * out[0][i]);
    scope.currentFrame += 128;
  }
  return 10 * Math.log10(outE / inE);
};

test('the catalog says which plugins listen to a sidechain', () => {
  const comp = family('fledge-compressor').plugins.find((p) => p.name === 'Fledge Compressor');
  assert.equal(comp.sidechain, true);
  assert.ok(!comp.instrument);
  assert.ok(!family('fledge').plugins[0].sidechain);
});

test('a compressor ducks to its sidechain only while one is connected', () => {
  const { p, ready } = make('fledge-compressor', 'Fledge Compressor');
  assert.deepEqual(ready.params.slice(0, 2).map((x) => x.name), ['Threshold', 'Ratio']);
  // Nothing connected: the quiet tone is far under the threshold, and whatever arrives on the
  // second input is not listened to
  assert.ok(Math.abs(gain(p, 0.5, 'loud')) < 0.05);
  p.message({ type: 'sidechain', connected: true });
  const ducked = gain(p, 1, 'loud');
  assert.ok(ducked < -6, `ducked by ${ducked} dB`);
  // Connected, but the other track is silent (no channels come in): it opens up again
  assert.ok(Math.abs(gain(p, 2, 'silent')) < 0.05);
  assert.ok(gain(p, 1, 'loud') < -6);
  p.message({ type: 'sidechain', connected: false });
  assert.ok(Math.abs(gain(p, 2, 'loud')) < 0.05);
  p.message({ type: 'destroy' });
});

test('a sidechain connected from the start, and kept through a preset switch', () => {
  const { p } = make('fledge-compressor', 'Fledge Compressor', { sidechain: true });
  assert.ok(gain(p, 1, 'loud') < -6);
  // A preset chosen (the plugin's whole sound switched): it still listens afterwards
  p.message({ type: 'switch' });
  p.message({ type: 'program', index: 1, asked: 1 });
  p.message({ type: 'switched' });
  gain(p, 0.5, 'loud');
  assert.ok(gain(p, 1, 'loud') < -6);
  p.message({ type: 'destroy' });
});

test('the same sidechain gives the same output every time', () => {
  const render = () => {
    scope.currentFrame = 0;
    const { p } = make('fledge-compressor', 'Fledge Compressor', { sidechain: true });
    const all = [];
    for (let b = 0; b < 200; b++) {
      const [x, k] = [tone(440, 0.3), tone(60, b % 40 < 10 ? 0.8 : 0)];
      const out = [new Float32Array(128), new Float32Array(128)];
      p.process([[x, x], [k, k]], [out]);
      all.push(...out[0]);
      scope.currentFrame += 128;
    }
    p.message({ type: 'destroy' });
    return all;
  };
  assert.deepEqual(render(), render());
});

test('a plugin that does not listen ignores a sidechain', () => {
  const fam = PLUGIN_FAMILIES.find((f) => f.family !== 'fledge-compressor' && f.plugins.some((p) => !p.instrument));
  const info = fam.plugins.find((p) => !p.instrument);
  const run = (connected) => {
    scope.currentFrame = 0;
    const { p } = make(fam.family, info.name, { followInput: true });
    if (connected) p.message({ type: 'sidechain', connected: true });
    const all = [];
    for (let b = 0; b < 60; b++) {
      const [x, k] = [tone(440, 0.3), tone(60, 0.8)];
      const out = [new Float32Array(128), new Float32Array(128)];
      p.process(connected ? [[x, x], [k, k]] : [[x, x]], [out]);
      all.push(...out[0], ...out[1]);
      scope.currentFrame += 128;
    }
    p.message({ type: 'destroy' });
    return all;
  };
  assert.deepEqual(run(true), run(false));
});
