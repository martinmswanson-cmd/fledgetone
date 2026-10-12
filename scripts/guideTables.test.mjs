// The guide's instrument list and Credits must match the catalog (see scripts/guide-tables.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { GUIDE, generatedGuide, uncredited } = await import('./guide-tables.mjs');

test('every recorded instrument has a credited source', () => {
  assert.deepEqual(uncredited(), [], 'add their source to src/credits.ts');
});

test("the guide's instrument list and credits are up to date", () => {
  const text = readFileSync(GUIDE, 'utf8');
  assert.equal(text, generatedGuide(text), 'run: npm run guide-tables');
});
