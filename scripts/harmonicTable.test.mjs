// A wavetable drawn as harmonics (src/audio/plugins/harmonicTable.ts) and the user table that
// carries it (userTable.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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
const H = await import('../src/audio/plugins/harmonicTable.ts');
const U = await import('../src/audio/plugins/userTable.ts');

/** Harmonic k's level in a cycle (its sine and cosine parts together). */
const level = (cycle, k) => {
  let [s, c] = [0, 0];
  for (let i = 0; i < cycle.length; i++) {
    s += cycle[i] * Math.sin((2 * Math.PI * k * i) / cycle.length);
    c += cycle[i] * Math.cos((2 * Math.PI * k * i) / cycle.length);
  }
  return (2 * Math.hypot(s, c)) / cycle.length;
};
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

test('a bar is silent at the bottom, full at the top, and decibels between', () => {
  assert.equal(H.heightToGain(0), 0);
  assert.equal(H.heightToGain(1), 1);
  assert.ok(Math.abs(20 * Math.log10(H.heightToGain(0.5)) + H.HARMONIC_RANGE_DB / 2) < 1e-9);
  for (const g of [1, 0.5, 0.1, 0.01]) assert.ok(Math.abs(H.heightToGain(H.gainToHeight(g)) / g - 1) < 0.01, `${g}`);
  // Too quiet for the scale: silent
  assert.equal(H.gainToHeight(1e-4), 0);
  assert.equal(H.gainToHeight(0), 0);
});

test('one harmonic is a sine, and nothing drawn is silence', () => {
  const sine = H.harmonicCycle([1], 'together');
  assert.equal(sine.length, U.USER_CYCLE);
  for (let i = 0; i < sine.length; i += 97) assert.ok(Math.abs(sine[i] - 0.9 * Math.sin((2 * Math.PI * i) / sine.length)) < 1e-6);
  // The 3rd harmonic alone goes round three times
  const third = H.harmonicCycle([0, 0, 1], 'together', 256);
  assert.ok(level(third, 3) > 0.89 && level(third, 1) < 1e-6);
  assert.ok(H.harmonicCycle([0, 0, 0], 'together').every((v) => v === 0));
  assert.ok(H.harmonicCycle([], 'spread').every((v) => v === 0));
  assert.equal(H.anyHarmonic({ v: 1, drawings: [[0, 0]], phase: 'together' }), false);
});

test('the shapes have the harmonics their names say', () => {
  const of = (name, n = 32) => H.harmonicCycle(H.harmonicShape(name, n), 'together');
  const saw = of('Saw');
  for (const k of [2, 3, 8, 32]) assert.ok(Math.abs((level(saw, k) / level(saw, 1)) * k - 1) < 0.02, `saw harmonic ${k}`);
  assert.ok(level(saw, 33) < 1e-6, 'nothing above what was drawn');
  const square = of('Square');
  assert.ok(level(square, 2) < 1e-6 && Math.abs((level(square, 3) / level(square, 1)) * 3 - 1) < 0.02);
  const triangle = of('Triangle');
  assert.ok(Math.abs((level(triangle, 3) / level(triangle, 1)) * 9 - 1) < 0.03 && level(triangle, 4) < 1e-6);
  assert.deepEqual(H.harmonicShape('Sine', 16).filter((h) => h > 0), [1]);
  // Every shape is a drawing of the size asked for, in range, with no DC in its cycle
  for (const s of H.HARMONIC_SHAPES) {
    const d = H.harmonicShape(s.name, 64);
    assert.equal(d.length, 64);
    assert.ok(d.every((h) => h >= 0 && h <= 1) && d[0] > 0, s.name);
    const c = H.harmonicCycle(d, 'together');
    assert.ok(Math.abs(c.reduce((a, v) => a + v, 0) / c.length) < 1e-6 && Math.abs(peak(c) - 0.9) < 1e-6, s.name);
  }
  assert.deepEqual(H.harmonicShape('no such shape', 8), H.harmonicShape('Saw', 8));
});

test('how the harmonics line up changes the wave, not the tone', () => {
  const d = H.harmonicShape('Saw', 32);
  const [together, alternate, spread] = ['together', 'alternate', 'spread'].map((p) => H.harmonicCycle(d, p));
  // The same harmonics at the same levels against each other
  for (const k of [2, 5, 17]) for (const c of [alternate, spread]) assert.ok(Math.abs(level(c, k) / level(c, 1) / (level(together, k) / level(together, 1)) - 1) < 1e-3);
  // Spread: lower peaks for the same loudness, where the highs are strong (together, they pile up into a spike)
  const bright = H.harmonicShape('Bright', 32);
  const crest = (p) => { const c = H.harmonicCycle(bright, p); return peak(c) / rms(c); };
  assert.ok(crest('spread') < crest('together') * 0.7, `${crest('spread')} against ${crest('together')}`);
  assert.notDeepEqual([...alternate.slice(0, 8)], [...together.slice(0, 8)]);
});

test('the tools change a whole drawing', () => {
  const d = H.harmonicShape('Saw', 8);
  assert.deepEqual(H.applyHarmonicTool(d, 'clear'), Array(8).fill(0));
  assert.deepEqual(H.applyHarmonicTool(d, 'odd').map((h) => h > 0), [true, false, true, false, true, false, true, false]);
  assert.deepEqual(H.applyHarmonicTool(d, 'even').map((h) => h > 0), [true, true, false, true, false, true, false, true]);
  const darker = H.applyHarmonicTool(d, 'darker');
  // 3 dB an octave: the 1st stays, the 2nd loses 3 dB, the 4th 6 dB
  assert.equal(darker[0], d[0]);
  for (const [i, db] of [[1, 3], [3, 6], [7, 9]]) assert.ok(Math.abs(20 * Math.log10(H.heightToGain(d[i]) / H.heightToGain(darker[i])) - db) < 0.15, `harmonic ${i + 1}`);
  const brighter = H.applyHarmonicTool(darker, 'brighter');
  brighter.forEach((h, i) => assert.ok(Math.abs(h - d[i]) < 0.005));
  // A silent harmonic stays silent, and nothing passes full
  assert.deepEqual(H.applyHarmonicTool([1, 0, 1], 'brighter'), [1, 0, 1]);
  assert.deepEqual(H.resizeDrawing([1, 0.5], 4), [1, 0.5, 0, 0]);
  assert.deepEqual(H.resizeDrawing([1, 0.5, 0.2], 2), [1, 0.5]);
});

test('drawings from a file are tidied, and what is not one is left out', () => {
  assert.equal(H.normalizeHarmonics(null), undefined);
  assert.equal(H.normalizeHarmonics({ v: 2, drawings: [[1]] }), undefined);
  assert.equal(H.normalizeHarmonics({ v: 1, drawings: [] }), undefined);
  assert.equal(H.normalizeHarmonics({ v: 1, drawings: [[1], 'x'] }), undefined);
  const tidy = H.normalizeHarmonics({ v: 1, drawings: [[2, -1, 'a', NaN, 0.12345], ...Array(9).fill(Array(200).fill(0.5))], phase: 'sideways', extra: 1 });
  assert.deepEqual(tidy.drawings[0], [1, 0, 0, 0, 0.123]);
  assert.equal(tidy.drawings.length, H.DRAWINGS_MAX);
  assert.equal(tidy.drawings[1].length, H.HARMONICS_MAX);
  assert.equal(tidy.phase, 'together');
  assert.deepEqual(Object.keys(tidy).sort(), ['drawings', 'phase', 'v']);
  assert.deepEqual(H.normalizeHarmonics(H.defaultHarmonics()), H.defaultHarmonics());
});

test('a drawn table is small, carries its drawing, and plays what was drawn', async () => {
  const harmonics = { v: 1, drawings: [H.harmonicShape('Sine', 64), H.harmonicShape('Saw', 64), H.harmonicShape('Square', 64)], phase: 'spread' };
  const table = await H.harmonicUserTable(harmonics);
  assert.equal(table.frames, 3);
  assert.equal(table.name, 'Drawn harmonics');
  assert.ok(U.userTableKb(table) <= 2, `${table.data.length} characters`);
  // Saved and opened: the drawing comes back with it
  const back = U.normalizeUserTable(JSON.parse(JSON.stringify(table)));
  assert.deepEqual(back.harmonics, harmonics);
  assert.deepEqual(back, table);
  // The cycles the synth gets are the drawings' (to the 16 bits they're stored in)
  const cycles = await U.unpackUserTable(back);
  assert.equal(cycles.length, 3 * U.USER_CYCLE);
  const want = H.harmonicCycles(harmonics).cycles;
  let worst = 0;
  for (let i = 0; i < cycles.length; i++) worst = Math.max(worst, Math.abs(cycles[i] - want[i]));
  assert.ok(worst < 2e-3, `off by ${worst}`);
  // A share link's lighter copy keeps the drawing too
  const link = await U.linkUserTable(table);
  assert.deepEqual(link.harmonics, harmonics);
  // A table made from a sound has none, and a broken drawing is dropped without losing the table
  assert.equal(U.normalizeUserTable({ ...table, harmonics: { v: 1, drawings: [] } }).harmonics, undefined);
  assert.equal(U.normalizeUserTable({ ...table, harmonics: undefined }).data, table.data);
});

test('the synth plays a drawn sine as a sine', async () => {
  const fs = await import('node:fs');
  const { instance: { exports: e } } = await WebAssembly.instantiate(fs.readFileSync(new URL('../public/fledgetone-plugins/fledge.wasm', import.meta.url)));
  const { cycles, frames } = H.harmonicCycles({ v: 1, drawings: [H.harmonicShape('Sine', 16)], phase: 'together' });
  const ptr = e.fledge_picture_buffer(frames);
  new Float32Array(e.memory.buffer, ptr, cycles.length).set(cycles);
  assert.equal(e.fledge_picture_set(frames), 1);
  // (Making the table grows the module's memory: the wave is read from it as it is afterwards)
  const at = e.fledge_wave(U.USER_TABLE_INDEX, 0.5, 0, 0);
  const wave = new Float32Array(e.memory.buffer, at, 256).slice();
  assert.ok(level(wave, 1) > 0.3 && level(wave, 2) < 1e-3 * level(wave, 1) && level(wave, 3) < 1e-3 * level(wave, 1));
  e.fledge_picture_set(0);
});
