// Unit tests for the beat-store package's pieces (src/audio/beatPack.ts). Run with `npm test`.
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

const { beatFileBase, tagTimes, layTag, coverExtension } = await import('../src/audio/beatPack.ts');

test('file names carry the title, tempo and key', () => {
  assert.equal(beatFileBase('Night Drive', 140, 'A minor'), 'Night Drive - 140 BPM - A minor');
  assert.equal(beatFileBase('a/b: c?', 92.5, null), 'a-b- c- - 92.5 BPM');
  assert.equal(beatFileBase('  ', 120, 'C# major'), 'Untitled - 120 BPM - C# major');
});

test('the tag plays at the start and every N seconds, never off the end', () => {
  assert.deepEqual(tagTimes(100, 2, { atStart: true, every: 30 }), [0.5, 30.5, 60.5, 90.5]);
  assert.deepEqual(tagTimes(100, 2, { atStart: false, every: 30 }), [30, 60, 90]);
  assert.deepEqual(tagTimes(100, 2, { atStart: true, every: 0 }), [0.5]);
  assert.deepEqual(tagTimes(10, 2, { atStart: false, every: 0 }), []);
  // A tag longer than the gap: they don't overlap
  const t = tagTimes(60, 8, { atStart: true, every: 5 });
  for (let i = 1; i < t.length; i++) assert.ok(t[i] - t[i - 1] >= 9);
  assert.ok(t.every((x) => x + 8 <= 60));
});

test('the tag is laid over the beat, with the beat dipped under it and back after', () => {
  const sr = 1000;
  const beat = [new Float32Array(3000).fill(0.5), new Float32Array(3000).fill(0.5)];
  const tag = [new Float32Array(500).fill(0.2)];
  layTag(beat, sr, tag, [1], 0, 6);
  const dip = 10 ** (-6 / 20);
  // Before the dip, during the tag, and after it
  assert.equal(beat[0][100], 0.5);
  assert.ok(Math.abs(beat[0][1200] - (0.5 * dip + 0.2)) < 1e-6);
  assert.ok(Math.abs(beat[1][1200] - (0.5 * dip + 0.2)) < 1e-6);
  assert.equal(beat[0][2000], 0.5);
  // The dip ramps rather than steps
  for (let i = 900; i < 1000; i++) assert.ok(Math.abs(beat[0][i] - beat[0][i - 1]) < 0.01, `step at ${i}`);
});

test('cover images: JPEG, PNG or WebP', () => {
  assert.equal(coverExtension('image/jpeg'), 'jpg');
  assert.equal(coverExtension('', 'art.PNG'), 'png');
  assert.equal(coverExtension('image/webp'), 'webp');
  assert.equal(coverExtension('image/gif', 'a.gif'), null);
});
