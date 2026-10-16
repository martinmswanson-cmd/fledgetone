// CHANGELOG.md's newest version is the one in package.json, so the version the app shows always
// has its list of changes (see the top of CHANGELOG.md for how to release).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// (Changes not released yet gather under an "Unreleased" heading at the top)
const headings = [...changelog.matchAll(/^## (\S+)/gm)].map((m) => m[1]);
const versions = headings.filter((h) => h !== 'Unreleased');

test('an Unreleased section, if any, comes first', () => {
  assert.ok(!headings.slice(1).includes('Unreleased'));
});

test('the newest changelog entry is the version in package.json', () => {
  assert.equal(versions[0], version);
});

test('changelog versions are dates (with -2 and so on for a second release that day), newest first, each once', () => {
  for (const v of versions) assert.match(v, /^\d{4}\.\d{1,2}\.\d{1,2}(-\d+)?$/, v);
  const order = (v) => {
    const [date, n = '1'] = v.split('-');
    const [y, m, d] = date.split('.').map(Number);
    return ((y * 100 + m) * 100 + d) * 100 + Number(n);
  };
  for (let i = 1; i < versions.length; i++) assert.ok(order(versions[i - 1]) > order(versions[i]), `${versions[i - 1]} before ${versions[i]}`);
});
