// Built-in effects fade out once they go on sounding by themselves after their input stops
// (processor.ts followInput), while a reverb's or delay's own tail is left alone.
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
let Proc;
const g = { sampleRate: sr, currentFrame: 0, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: () => {} }; } }, registerProcessor: (_, c) => (Proc = c), console: { log() {} } };
new Function(...Object.keys(g), BUILTIN_PROCESSOR_SOURCE)(...Object.values(g));

/** RMS level (dB) of the plugin's output in [from, to) seconds, after 0.5 s of noise then silence. */
function levels(familyName, name, follow, windows) {
  const fam = PLUGIN_FAMILIES.find((f) => f.family === familyName);
  const module = new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${fam.file}`, import.meta.url)));
  const p = new Proc({ processorOptions: { family: familyName, module, index: fam.plugins.findIndex((x) => x.name === name), followInput: follow } });
  let seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const end = Math.max(...windows.map((w) => w[1]));
  const sums = windows.map(() => [0, 0]);
  for (let f = 0; f < end * sr; f += 128) {
    const L = new Float32Array(128);
    if (f < sr / 2) for (let i = 0; i < 128; i++) L[i] = 0.3 * rnd();
    const oL = new Float32Array(128), oR = new Float32Array(128);
    p.process([[L, L]], [[oL, oR]]);
    for (let i = 0; i < 128; i++) windows.forEach(([a, b], k) => { if (f + i >= a * sr && f + i < b * sr) { sums[k][0] += oL[i] ** 2; sums[k][1]++; } });
  }
  return sums.map(([e, n]) => 10 * Math.log10(e / n + 1e-30));
}

test('a Shepard tone fades out once its track is quiet, and plays on without the fade', () => {
  const [early, late] = levels('mda', 'Shepard', true, [[1, 1.5], [8, 8.5]]);
  assert.ok(early > -30, `still sounding just after the input stops (${early.toFixed(1)} dB)`);
  assert.ok(late < -150, `silent a few seconds later (${late.toFixed(1)} dB)`);
  const [, unfollowed] = levels('mda', 'Shepard', false, [[1, 1.5], [8, 8.5]]);
  assert.ok(unfollowed > -30);
});

test("a delay's echoes are left to fade by themselves", () => {
  const a = levels('mda', 'DubDelay', true, [[1.5, 2], [8, 8.5]]);
  const b = levels('mda', 'DubDelay', false, [[1.5, 2], [8, 8.5]]);
  assert.deepEqual(a.map((x) => x.toFixed(3)), b.map((x) => x.toFixed(3)));
});
