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
const { inflateSync, deflateSync, crc32 } = await import('node:zlib');
/** Read a PNG back: check the signature and every CRC, inflate IDAT, undo filters 0 and 2, map through PLTE when indexed. */
function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset); let at = 8; const idat = []; let plte = null; const names = [];
  while (at < png.length) {
    const n = dv.getUint32(at); const body = png.subarray(at + 4, at + 8 + n); assert.equal(dv.getUint32(at + 8 + n), crc32(body), 'chunk CRC');
    const name = String.fromCharCode(...body.subarray(0, 4)); names.push(name);
    if (name === 'IDAT') idat.push(body.subarray(4)); if (name === 'PLTE') plte = body.subarray(4); at += 12 + n;
  }
  const width = dv.getUint32(16); const height = dv.getUint32(20); const type = png[25]; assert.equal(png[24], 8);
  assert.ok(type === 2 || type === 3); assert.equal(type === 3, plte !== null); assert.equal(png[26] + png[27] + png[28], 0);
  assert.deepEqual(names.at(-1), 'IEND');
  const bpp = type === 3 ? 1 : 3; const stride = width * bpp; const raw = inflateSync(Buffer.concat(idat)); assert.equal(raw.length, height * (1 + stride));
  const px = new Uint8Array(height * stride); const filters = [];
  for (let y = 0; y < height; y++) {
    const f = raw[y * (1 + stride)]; filters.push(f); assert.ok(f === 0 || f === 2, `filter ${f}`);
    for (let i = 0; i < stride; i++) px[y * stride + i] = (raw[y * (1 + stride) + 1 + i] + (f === 2 && y > 0 ? px[(y - 1) * stride + i] : 0)) & 255;
  }
  let data = px; if (type === 3) { data = new Uint8Array(width * height * 3); for (let i = 0; i < width * height; i++) for (let k = 0; k < 3; k++) data[i * 3 + k] = plte[px[i] * 3 + k]; }
  return { width, height, type, plte, filters, data, idatBytes: idat.reduce((n, c) => n + c.length, 0) };
}
function same(r, png) { const d = decode(png); assert.equal(d.width, r.width); assert.equal(d.height, r.height); assert.deepEqual(d.data, r.data); return d; }

test('a PNG that a reader accepts', async () => {
  const r = R.raster(3, 2, [10, 20, 30]); R.setPixel(r, 2, 1, [200, 100, 50]);
  const png = await encodePng(r);
  const dv = new DataView(png.buffer, png.byteOffset); assert.equal(dv.getUint32(16), 3); assert.equal(dv.getUint32(20), 2); assert.equal(png[24], 8); assert.equal(png[25], 3);
  const d = same(r, png); assert.equal(d.plte.length, 6); assert.deepEqual([...d.plte], [10, 20, 30, 200, 100, 50]);
});
test('a picture of more than 256 colours is RGB', async () => {
  const r = R.raster(300, 2, [0, 0, 0]); for (let x = 0; x < 300; x++) R.setPixel(r, x, 0, [x & 255, x >> 8, x * 7 & 255]);
  const d = same(r, await encodePng(r)); assert.equal(d.type, 2); assert.equal(d.plte, null);
});
test('PNGs round trip exactly: one pixel, the 256 and 257 colour edge', async () => {
  const one = R.raster(1, 1, [9, 8, 7]); const d1 = same(one, await encodePng(one)); assert.equal(d1.type, 3);
  for (const colours of [256, 257]) {
    const r = R.raster(257, 3, [0, 0, 0]);
    for (let x = 0; x < 257; x++) for (let y = 0; y < 3; y++) { const k = Math.min(x, colours - 1); R.setPixel(r, x, y, [k, 255 - k, (k * 3 + y) & 255]); }
    const seen = new Set(); for (let i = 0; i < r.data.length; i += 3) seen.add(r.data[i] * 65536 + r.data[i + 1] * 256 + r.data[i + 2]);
    const d = same(r, await encodePng(r)); assert.equal(d.type, seen.size <= 256 ? 3 : 2, `${seen.size} colours`);
  }
  const edge = R.raster(256, 1, [0, 0, 0]); for (let x = 0; x < 256; x++) R.setPixel(edge, x, 0, [x, 0, 0]);
  assert.equal(same(edge, await encodePng(edge)).type, 3);
  const edge2 = R.raster(257, 1, [0, 0, 0]); for (let x = 0; x < 257; x++) R.setPixel(edge2, x, 0, [x & 255, x >> 8, 0]);
  assert.equal(same(edge2, await encodePng(edge2)).type, 2);
});
test('rows that change slowly down the picture use filter 2 and the file shrinks', async () => {
  // smooth vertical stripes that drift darker a step every few rows, so no row repeats the one above exactly
  const w = 300; const h = 200; const r = R.raster(w, h, [0, 0, 0]);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) R.setPixel(r, x, y, [(x * 37 + (x >> 3) * 11 + (y >> 2)) & 255, (x * 91 + 3 * (y >> 3)) & 255, (x * 13 + 50 + (y >> 4)) & 255]);
  const d = same(r, await encodePng(r));
  assert.equal(d.type, 2);
  assert.ok(d.filters.filter((f) => f === 2).length >= h * 0.9, 'filter 2 wins on most rows');
  const plain = new Uint8Array(h * (1 + w * 3)); for (let y = 0; y < h; y++) plain.set(r.data.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  const size0 = deflateSync(plain).length;
  assert.ok(d.idatBytes < size0 / 3, `${d.idatBytes} is not under a third of ${size0}`);
});
test('an indexed picture whose rows repeat uses filter 2 on most rows and stays small', async () => {
  const w = 300; const h = 200; const r = R.raster(w, h, [0, 0, 0]);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) R.setPixel(r, x, y, [((x % 200) * 37) & 255, ((x % 200) * 91) & 255, (x % 200) + 20 & 255]);
  const d = same(r, await encodePng(r)); assert.equal(d.type, 3);
  assert.ok(d.filters.filter((f) => f === 2).length >= h * 0.9);
  const seen = new Map(); const plain = new Uint8Array(h * (1 + w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = (y * w + x) * 3; const key = r.data[k] * 65536 + r.data[k + 1] * 256 + r.data[k + 2]; if (!seen.has(key)) seen.set(key, seen.size); plain[y * (1 + w) + 1 + x] = seen.get(key); }
  assert.ok(d.idatBytes <= deflateSync(plain).length * 1.5, "filter 2 on repeated rows costs little more than filter 0, which deflate already matches"); assert.ok(d.idatBytes < 1000);
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
  const guard = 16; const big = new Uint8Array(20 * 10 * 3 + 2 * guard).fill(77);
  const r = R.raster(20, 10, [5, 5, 5]); r.data = big.subarray(guard, guard + 600); r.data.fill(5); const before = r.data.slice();
  R.fillRect(r, -50, -50, 10, 10, [9, 9, 9]); R.fillRect(r, 5, 5, -4, 3, [9, 9, 9]); R.fillRect(r, 5, 5, 3, -3, [9, 9, 9]); R.fillRect(r, 100, 100, 5, 5, [9, 9, 9]);
  R.fillRect(r, NaN, 0, 5, 5, [9, 9, 9]); R.fillRect(r, 0, 0, Infinity, 5, [9, 9, 9]);
  R.line(r, -1e9, -1e9, -5e8, -3e8, [9, 9, 9]); R.line(r, 1e9, 3, 2e9, 4, [9, 9, 9]); R.line(r, NaN, 0, 3, 3, [9, 9, 9]);
  R.text(r, 'hello', -100, -100, [9, 9, 9]); R.text(r, 'hello', 500, 500, [9, 9, 9], 3); R.text(r, 'x', NaN, 2, [9, 9, 9]);
  assert.deepEqual(r.data, before, 'nothing visible was drawn');
  assert.equal(r.data.length, 20 * 10 * 3);
  assert.doesNotThrow(() => { R.text(r, 'x', 2, 2, [9, 9, 9], -2); R.text(r, 'x', 2, 2, [9, 9, 9], NaN); R.text(r, 'x', 2, 2, [9, 9, 9], 1e9); });
  R.text(r, 'WIDE TEXT THAT RUNS OFF THE RIGHT EDGE', 10.6, 3.4, [9, 9, 9], 2); R.line(r, -5, -5, 30, 20, [9, 9, 9]); R.fillRect(r, -3, -3, 8, 8, [9, 9, 9]);
  assert.equal(r.data.length, 20 * 10 * 3);
  assert.ok(big.subarray(0, guard).every((v) => v === 77) && big.subarray(guard + 600).every((v) => v === 77), 'nothing written outside the picture');
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
test('a big picture of 128 colours of noise is indexed, encodes quickly and reads back the same', async () => {
  const w = 1600; const h = 900; const r = R.raster(w, h, [0, 0, 0]); let seed = 12345;
  for (let i = 0; i < w * h; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const k = seed >>> 25; r.data[i * 3] = k * 2; r.data[i * 3 + 1] = 255 - k; r.data[i * 3 + 2] = k ^ 90; }
  const t0 = performance.now(); const png = await encodePng(r); const ms = performance.now() - t0;
  assert.ok(ms < 2000, `took ${ms} ms`);
  const d = same(r, png); assert.equal(d.type, 3); assert.equal(d.plte.length, 128 * 3);
});
test('a big picture of full-colour noise encodes quickly and reads back the same', async () => {
  const w = 1600; const h = 900; const r = R.raster(w, h, [0, 0, 0]); let seed = 99;
  for (let i = 0; i < r.data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; r.data[i] = seed >>> 24; }
  const t0 = performance.now(); const png = await encodePng(r); const ms = performance.now() - t0;
  assert.ok(ms < 2000, `took ${ms} ms`);
  assert.equal(same(r, png).type, 2);
});
test('a line never loops, whatever its coordinates', () => {
  const M = Number.MAX_VALUE; const big = [M, -M, 1e308, -1e308, 1.797e308, -1.797e308, 1e9, -1e9];
  const r = R.raster(20, 10, [5, 5, 5]);
  const calls = [[-1.797e308, 0, 1.797e308, 5], [1e308, 0, -1e308, 5]];
  for (const v of big) for (let pos = 0; pos < 4; pos++) { const a = [3, 4, 12, 6]; a[pos] = v; calls.push(a); for (const w of big) { const b = [3, 4, 12, 6]; b[pos] = v; b[(pos + 2) % 4] = w; calls.push(b); } }
  for (const a of calls) {
    const t0 = performance.now(); R.line(r, ...a, [9, 9, 9]);
    assert.ok(performance.now() - t0 < 50, `line(${a}) was slow`);
    assert.equal(r.data.length, 600);
  }
  const q = R.raster(20, 10, [0, 0, 0]); R.line(q, -1.797e308, 0, 1.797e308, 5, [9, 9, 9]); R.line(q, 1e308, 0, -1e308, 5, [9, 9, 9]);
  assert.ok(q.data.every((v) => v === 0 || v === 9));
});
test('fillRect gives the same picture as painting pixel by pixel', () => {
  const rects = [[2, 3, 5, 4], [-3, -2, 8, 6], [15, 7, 10, 10], [-10, -10, 5, 5], [30, 2, 4, 4], [2.4, 2.6, 3.5, 2.5], [4, 4, 0, 3], [4, 4, 3, 0], [4, 4, -3, 3], [4, 4, 3, -3], [-5, -5, 50, 50], [0.5, 0.5, 1, 1], [2.5, 2.5, 1.5, 1.5]];
  for (const [x, y, w, h] of rects) {
    const a = R.raster(20, 10, [0, 0, 0]); const b = R.raster(20, 10, [0, 0, 0]);
    R.fillRect(a, x, y, w, h, [1, 2, 3]);
    for (let j = Math.round(y); j < Math.round(y) + Math.round(h); j++) for (let i = Math.round(x); i < Math.round(x) + Math.round(w); i++) R.setPixel(b, i, j, [1, 2, 3]);
    assert.deepEqual(a.data, b.data, `rectangle ${[x, y, w, h]}`);
  }
});
