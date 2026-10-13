// docs/CODEMAP.md is generated from the summary comment at the top of each source file
// (scripts/codemap.mjs). Run with `npm test`; `npm run codemap` rewrites the map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { CODEMAP, filesWithoutSummary, generatedCodemap, summaryOf } = await import('./codemap.mjs');

test('every source file starts with a summary of what it is', () => {
  assert.deepEqual(filesWithoutSummary(), [], 'add a comment at the top of each saying what the file is for');
});

test('the code map is up to date', () => {
  assert.equal(readFileSync(CODEMAP, 'utf8'), generatedCodemap(), 'run `npm run codemap`');
});

test("a summary is the top comment's first paragraph, or the first comment after the imports", () => {
  assert.equal(summaryOf('/**\n * Plays notes.\n * Second line.\n *\n * Detail.\n */\nimport x from "y";'), 'Plays notes. Second line.');
  assert.equal(summaryOf('// One line.\n// Two.\n\nconst a = 1;'), 'One line. Two.');
  assert.equal(summaryOf('# Godot player.\n#\n# Usage.\nextends Node'), 'Godot player.');
  assert.equal(summaryOf('import a from "a";\nimport {\n  b,\n} from "b";\n\n/** After imports. */\nexport const c = 1;'), 'After imports.');
  assert.equal(summaryOf('import a from "a";\nexport const c = 1;'), null);
});
