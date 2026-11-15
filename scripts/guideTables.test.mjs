// The guide's instrument list and Credits must match the catalog (see scripts/guide-tables.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { GUIDE, generatedGuide, uncredited, uncreditedPlugins } = await import('./guide-tables.mjs');

test('every recorded instrument has a credited source', () => {
  assert.deepEqual(uncredited(), [], 'add their source to src/credits.ts');
});

test('every built-in plugin family is credited', () => {
  assert.deepEqual(uncreditedPlugins(), [], 'add the family to PLUGIN_CREDITS in src/credits.ts');
});

test("the guide's instrument list and credits are up to date", () => {
  const text = readFileSync(GUIDE, 'utf8');
  assert.equal(text, generatedGuide(text), 'run: npm run guide-tables');
});

test("the home page's counts are up to date", async () => {
  const { HOME, generatedHome } = await import('./guide-tables.mjs');
  const text = readFileSync(HOME, 'utf8');
  assert.ok((text.match(/data-count="/g) ?? []).length >= 5, 'the home page has lost its counted numbers');
  assert.equal(text, generatedHome(text), 'run: npm run guide-tables');
});
