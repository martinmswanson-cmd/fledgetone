// Who made each GPL-licensed plugin and where its source is (src/audio/plugins/gplCredits.ts), as
// the web runtime kit's notice says it. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { GPL_CREDITS, gplNotice } = await import('../src/audio/plugins/gplCredits.ts');
const { GPL_PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalogGpl.ts');
const families = JSON.parse(readFileSync(new URL('./plugins/families.json', import.meta.url), 'utf8'));

test('every GPL plugin family has its makers, project, source and contact, as built', () => {
  for (const f of GPL_PLUGIN_FAMILIES) {
    const c = GPL_CREDITS[f.family];
    assert.ok(c, f.family);
    const built = families.find((x) => x.family === f.family);
    assert.equal(c.source, built.source, `${f.family}: the repository it's built from`);
    assert.equal(c.commit, built.commit, `${f.family}: the commit it's built from`);
    assert.equal(c.licence, f.licence);
    assert.equal(c.contact, `${c.source}/issues`);
    for (const u of [c.project, c.source, c.contact]) assert.match(u, /^https:\/\//);
  }
  assert.deepEqual(Object.keys(GPL_CREDITS).sort(), GPL_PLUGIN_FAMILIES.map((f) => f.family).sort());
});

test("the kit's notice names each plugin, its makers and its source", () => {
  const text = gplNotice(GPL_PLUGIN_FAMILIES.filter((f) => f.family === 'surge' || f.family === 'setbfree'));
  assert.match(text, /Surge XT \(GPL-3\.0\)/);
  assert.match(text, /setBfree \(the Tonewheel Organ\) \(GPL-2\.0-or-later\)/);
  assert.match(text, /Source: https:\/\/github\.com\/pantherb\/setBfree \(built from commit 2f41983b/);
  assert.match(text, /GPL-PLUGINS-LICENSE\.txt/);
  assert.doesNotMatch(text, /Dragonfly/);
});
