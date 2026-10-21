// Unit tests for the Android app's version (scripts/androidVersion.mjs): versionName and the
// versionCode Google Play needs to rise with every release. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { androidVersion } from './androidVersion.mjs';

test("a day's version, and its later releases, in order", () => {
  assert.deepEqual(androidVersion('2026.10.21'), { versionName: '2026.10.21', versionCode: 2026102100 });
  assert.deepEqual(androidVersion('2026.10.21-3'), { versionName: '2026.10.21-3', versionCode: 2026102103 });
  const order = ['2026.9.30-12', '2026.10.1', '2026.10.20-9', '2026.10.20-10', '2026.10.21', '2027.1.2'].map((v) => androidVersion(v).versionCode);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(androidVersion('2099.12.31-99').versionCode < 2100000000);
});

test('anything else is refused', () => {
  for (const bad of ['1.0', '2026.13.1', '2026.10.0', '2026.10.21-100', 'next']) assert.throws(() => androidVersion(bad));
});

test("package.json's version is one", () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(androidVersion(version).versionCode > 2026000000);
});
