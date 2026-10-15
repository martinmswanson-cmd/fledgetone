// DC taken out of recordings as they load (removeDc in src/audio/samplers/recordingMaths.ts): a recording with a measurable offset loses it without its sound changing; one without is left exactly as it was. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const { removeDc, DC_RATIO } = await import('../src/audio/samplers/recordingMaths.ts');
const SR = 48000;
const mean = (d, a = 0, b = d.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += d[i];
  return s / (b - a);
};

test("a saxophone-like note whose offset builds as it's held, and a celesta-like one whose offset dies away, lose it", () => {
  const n = SR * 3;
  const sax = Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 155 * i) / SR) * Math.min(1, i / 2000) + 0.015 * Math.min(1, i / SR));
  const celesta = Float32Array.from({ length: n }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1047 * i) / SR) * Math.exp(-i / SR) + 0.006 * Math.exp(-i / (0.7 * SR)));
  for (const [name, data] of [['sax', sax], ['celesta', celesta]]) {
    const before = data.slice();
    assert.ok(removeDc([data], SR), name);
    assert.ok(Math.abs(mean(data)) < 0.1 * Math.abs(mean(before)), `${name}: ${mean(before).toFixed(5)} -> ${mean(data).toFixed(5)}`);
    // The tone itself is untouched: what changed is slow (under 10 Hz), never a step
    let step = 0;
    for (let i = 1; i < n; i++) step = Math.max(step, Math.abs(data[i] - before[i] - (data[i - 1] - before[i - 1])));
    assert.ok(step < 1e-5, `${name}: the change moves ${step} a sample`);
  }
});

test('a recording without a measurable offset, even a deep note or a drum hit, is left exactly as it was', () => {
  const attack = (i) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, i / (0.02 * SR)));
  const deep = Float32Array.from({ length: SR * 2 }, (_, i) => 0.8 * attack(i) * Math.sin((2 * Math.PI * 31 * i) / SR) * Math.exp(-i / SR));
  // A hit with a thump that pushes one way, then back: it averages out
  const thump = (i) => {
    const t = (i - 0.03 * SR) / (0.01 * SR);
    return -t * Math.exp(-t * t);
  };
  const hit = Float32Array.from({ length: SR }, (_, i) => 0.9 * attack(i) * Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp(-i / 6000) + 0.2 * thump(i));
  for (const data of [deep, hit, new Float32Array(1000)]) {
    const before = data.slice();
    assert.equal(removeDc([data, data.slice()], SR), false);
    assert.deepEqual(data, before);
  }
  assert.ok(DC_RATIO <= 0.001);
});
