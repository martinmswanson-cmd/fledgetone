// Unit tests for search (src/search/searchCore.ts, instrumentSearch.ts). Run with `npm test`.
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
const { matchScore, rank, oneSlip, snippet, normalize } = await import('../src/search/searchCore.ts');
const { searchInstruments } = await import('../src/search/instrumentSearch.ts');

const names = (defs, n = 5) => defs.slice(0, n).map((d) => d.name);

test('normalize drops case, accents and punctuation', () => {
  assert.equal(normalize('  Café — 8-Bit!  '), 'cafe 8 bit');
});

test('oneSlip forgives one added, dropped, changed or swapped letter', () => {
  assert.ok(oneSlip('violin', 'viloin'));
  assert.ok(oneSlip('violin', 'violn'));
  assert.ok(oneSlip('violin', 'violins'));
  assert.ok(oneSlip('violin', 'viilin'));
  assert.ok(!oneSlip('violin', 'viola'));
});

test('every typed word has to match', () => {
  const item = { title: 'Reverb', keywords: 'space room hall', detail: 'How long the room rings' };
  assert.ok(matchScore('reverb hall', item) > 0);
  assert.equal(matchScore('reverb delay', item), 0);
});

test('a name match beats a keyword match, which beats a description match', () => {
  const items = [
    { title: 'Delay', detail: 'echoes, not reverb' },
    { title: 'Master space', keywords: 'reverb' },
    { title: 'Reverb send' },
  ];
  assert.deepEqual(rank(items, 'reverb', (x) => x).map((x) => x.title), ['Reverb send', 'Master space', 'Delay']);
});

test('joined words find spaced names', () => {
  assert.ok(matchScore('buildup', { title: 'Build up & drop' }) > 0);
});

test('instrument search finds by name, slip, genre and description', () => {
  assert.equal(searchInstruments('violin')[0].name, 'Violin');
  assert.equal(searchInstruments('viloin')[0].name, 'Violin');
  assert.ok(names(searchInstruments('8bit')).every((n) => /chip/i.test(n)), names(searchInstruments('8bit')).join());
  assert.ok(names(searchInstruments('angelic'), 3).some((n) => /choir|voice/i.test(n)));
  assert.ok(searchInstruments('slap bass').some((d) => d.key === 'slappedBass'));
  assert.equal(searchInstruments('zzzz').length, 0);
});

test('instrument search can leave some out', () => {
  assert.ok(searchInstruments('', (d) => d.kind !== 'audio').every((d) => d.kind !== 'audio'));
});

test('snippet shows the text around the match', () => {
  const s = snippet('a '.repeat(100) + 'the metronome clicks on every beat ' + 'b '.repeat(100), 'metronome', 60);
  assert.ok(s.includes('metronome') && s.startsWith('…') && s.endsWith('…'));
});
