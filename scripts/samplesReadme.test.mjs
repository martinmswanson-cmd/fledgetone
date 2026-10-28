// The hosted recordings' README (public/fledgetone-samples/README.txt) names every folder there
// with its credit and licence, as src/credits.ts has them (see scripts/samples-readme.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { README, samplesReadme } = await import('./samples-readme.mjs');

test('the samples README is in step with the credits', () => {
  assert.equal(readFileSync(README, 'utf8'), samplesReadme(), 'run: npm run samples-readme');
});

test('a folder with no credit is an error, not left out', () => {
  assert.throws(() => samplesReadme(['flute', 'a-new-set']), /a-new-set/);
});
