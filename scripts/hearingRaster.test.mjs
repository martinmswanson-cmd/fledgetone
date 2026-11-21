// Unit tests for the hearing report's pictures (src/audio/hearing/raster.ts, font5x7.ts, png.ts): a small
// in-memory RGB picture, a 5x7 pixel font and a PNG encoder. Run with `npm test`.
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

const R = await import('../src/audio/hearing/raster.ts');
const { GLYPHS } = await import('../src/audio/hearing/font5x7.ts');
const { encodePng } = await import('../src/audio/hearing/png.ts');

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/** How many of the 35 pixels differ between two letters. */
function diff(a, b) {
  let n = 0;
  for (let row = 0; row < 7; row++) for (let bit = 0; bit < 5; bit++) if (((GLYPHS[a][row] >> bit) & 1) !== ((GLYPHS[b][row] >> bit) & 1)) n++;
  return n;
}

test('rectangles, pixels and edges', () => {
  const r = R.raster(10, 10, [0, 0, 0]); R.fillRect(r, 8, 8, 5, 5, [255, 0, 0]); R.setPixel(r, -1, 50, [1, 1, 1]);
  assert.deepEqual(R.pixel(r, 9, 9), [255, 0, 0]); assert.deepEqual(R.pixel(r, 7, 7), [0, 0, 0]); assert.equal(r.data.length, 300);
});
test('the ramp runs between its ends', () => {
  assert.deepEqual(R.ramp(R.HEAT, -1), R.HEAT[0]); assert.deepEqual(R.ramp(R.HEAT, 2), R.HEAT.at(-1));
  for (let i = 1; i <= 20; i++) assert.ok(lum(R.ramp(R.HEAT, i / 20)) > lum(R.ramp(R.HEAT, (i - 1) / 20)), 'louder is always lighter');
});
test('every printable character has a letter', () => {
  for (let c = 32; c < 127; c++) { const g = GLYPHS[String.fromCharCode(c)]; assert.equal(g.length, 7); assert.ok(g.every((row) => row >= 0 && row < 32)); }
  assert.ok(GLYPHS['A'].some((row) => row > 0)); assert.ok(GLYPHS[' '].every((row) => row === 0));
});
test('text paints and reports its width', () => {
  const r = R.raster(100, 20, [0, 0, 0]); assert.equal(R.text(r, '1 kHz', 2, 2, [255, 255, 255]), 30); assert.equal(R.textWidth('ab', 2), 24);
  assert.ok(r.data.some((v) => v === 255));
});
test('a PNG that a reader accepts', async () => {
  const r = R.raster(3, 2, [10, 20, 30]); R.setPixel(r, 2, 1, [200, 100, 50]);
  const png = await encodePng(r);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset); assert.equal(dv.getUint32(16), 3); assert.equal(dv.getUint32(20), 2); assert.equal(png[24], 8); assert.equal(png[25], 2);
  // read the chunks back: each CRC right, and the pixels the same after inflating IDAT
  const { inflateSync, crc32 } = await import('node:zlib'); let at = 8; const idat = [];
  while (at < png.length) { const n = dv.getUint32(at); const body = png.subarray(at + 4, at + 8 + n); assert.equal(dv.getUint32(at + 8 + n), crc32(body)); if (String.fromCharCode(...body.subarray(0, 4)) === 'IDAT') idat.push(body.subarray(4)); at += 12 + n; }
  const raw = inflateSync(Buffer.concat(idat)); assert.equal(raw.length, 2 * (1 + 9));
  assert.deepEqual([...raw.subarray(11, 20)], [10, 20, 30, 10, 20, 30, 200, 100, 50]);
});

test('no two glyphs are the same, and only printable ASCII is in the font', () => {
  const keys = Object.keys(GLYPHS);
  assert.equal(keys.length, 95);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) assert.ok(diff(keys[i], keys[j]) > 0, `"${keys[i]}" and "${keys[j]}" look the same`);
});
test('digits and capitals use all seven rows', () => {
  for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') assert.ok(GLYPHS[ch][0] > 0 && GLYPHS[ch][6] > 0, `${ch} leaves out its top or bottom row`);
});
test('easily confused characters differ by at least 3 pixels', () => {
  for (const [a, b] of [['0', 'O'], ['1', 'l'], ['1', 'I'], ['l', 'I'], ['5', 'S'], ['8', 'B'], ['2', 'Z'], ['.', ','], ['-', '_']]) assert.ok(diff(a, b) >= 3, `${a} and ${b} differ by only ${diff(a, b)}`);
});

test('drawing outside the picture, with odd sizes or fractions, is safe', () => {
  const r = R.raster(20, 10, [5, 5, 5]); const before = r.data.slice();
  R.fillRect(r, -50, -50, 10, 10, [9, 9, 9]); R.fillRect(r, 5, 5, -4, 3, [9, 9, 9]); R.fillRect(r, 5, 5, 3, -3, [9, 9, 9]); R.fillRect(r, 100, 100, 5, 5, [9, 9, 9]);
  R.fillRect(r, NaN, 0, 5, 5, [9, 9, 9]); R.fillRect(r, 0, 0, Infinity, 5, [9, 9, 9]);
  R.line(r, -1e9, -1e9, -5e8, -3e8, [9, 9, 9]); R.line(r, 1e9, 3, 2e9, 4, [9, 9, 9]); R.line(r, NaN, 0, 3, 3, [9, 9, 9]);
  R.text(r, 'hello', -100, -100, [9, 9, 9]); R.text(r, 'hello', 500, 500, [9, 9, 9], 3); R.text(r, 'x', NaN, 2, [9, 9, 9]);
  assert.deepEqual(r.data, before, 'nothing visible was drawn');
  assert.equal(r.data.length, 20 * 10 * 3);
  assert.doesNotThrow(() => { R.text(r, 'x', 2, 2, [9, 9, 9], -2); R.text(r, 'x', 2, 2, [9, 9, 9], NaN); R.text(r, 'x', 2, 2, [9, 9, 9], 1e9); });
  R.text(r, 'WIDE TEXT THAT RUNS OFF THE RIGHT EDGE', 10.6, 3.4, [9, 9, 9], 2); R.line(r, -5, -5, 30, 20, [9, 9, 9]); R.fillRect(r, -3, -3, 8, 8, [9, 9, 9]);
  assert.equal(r.data.length, 20 * 10 * 3);
  R.fillRect(r, 2.4, 2.6, 2, 2, [1, 2, 3]); assert.deepEqual(R.pixel(r, 2, 3), [1, 2, 3]);
  const q = R.raster(5, 5, [0, 0, 0]); R.line(q, 0, 0, 4, 4, [7, 7, 7]);
  for (let i = 0; i < 5; i++) assert.deepEqual(R.pixel(q, i, i), [7, 7, 7]);
  R.line(q, 4, 0, 0, 0, [8, 8, 8]); assert.deepEqual(R.pixel(q, 2, 0), [8, 8, 8]);
});
test('a text character that is not in the font is drawn as a question mark', () => {
  const a = R.raster(10, 10, [0, 0, 0]); const b = R.raster(10, 10, [0, 0, 0]);
  R.text(a, 'é', 1, 1, [255, 255, 255]); R.text(b, '?', 1, 1, [255, 255, 255]);
  assert.deepEqual(a.data, b.data);
});
test('a picture needs a whole size of at least 1', () => {
  for (const [w, h] of [[0, 5], [5, 0], [-1, 5], [2.5, 5], [5, 2.5], [NaN, 5], [5, Infinity]]) assert.throws(() => R.raster(w, h, [0, 0, 0]), RangeError);
  assert.equal(R.raster(1, 1, [1, 2, 3]).data.length, 3);
});
test('the ramp gives whole channels, and NaN gives the first stop', () => {
  assert.deepEqual(R.ramp(R.HEAT, NaN), R.HEAT[0]);
  for (let i = 0; i <= 97; i++) for (const c of [...R.ramp(R.HEAT, i / 97), ...R.ramp(R.DIVERGING, i / 97)]) assert.ok(Number.isInteger(c) && c >= 0 && c <= 255);
  assert.deepEqual(R.ramp([[0, 0, 0], [100, 50, 10]], 0.5), [50, 25, 5]);
});
test('the diverging ramp is darkest in the middle and equally strong at both ends', () => {
  const mid = lum(R.ramp(R.DIVERGING, 0.5));
  for (let i = 0; i <= 100; i++) if (i !== 50) assert.ok(lum(R.ramp(R.DIVERGING, i / 100)) > mid, 'the middle is the darkest point');
  const lo = lum(R.DIVERGING[0]); const hi = lum(R.DIVERGING.at(-1));
  assert.ok(Math.abs(lo - hi) <= 0.15 * Math.max(lo, hi), `ends ${lo} and ${hi} are not about equally light`);
});
test('a big picture encodes quickly and reads back the same', async () => {
  const w = 1600; const h = 900; const r = R.raster(w, h, [0, 0, 0]); let s = 12345;
  for (let i = 0; i < r.data.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; r.data[i] = s >>> 24; }
  const t0 = performance.now(); const png = await encodePng(r); const ms = performance.now() - t0;
  assert.ok(ms < 3000, `took ${ms} ms`);
  const dv = new DataView(png.buffer, png.byteOffset); const { inflateSync } = await import('node:zlib'); let at = 8; const idat = [];
  while (at < png.length) { const n = dv.getUint32(at); const body = png.subarray(at + 4, at + 8 + n); if (String.fromCharCode(...body.subarray(0, 4)) === 'IDAT') idat.push(body.subarray(4)); at += 12 + n; }
  const raw = inflateSync(Buffer.concat(idat)); assert.equal(raw.length, h * (1 + w * 3));
  for (const y of [0, 1, 450, 899]) { assert.equal(raw[y * (1 + w * 3)], 0); assert.deepEqual(new Uint8Array(raw.subarray(y * (1 + w * 3) + 1, (y + 1) * (1 + w * 3))), r.data.subarray(y * w * 3, (y + 1) * w * 3)); }
});
