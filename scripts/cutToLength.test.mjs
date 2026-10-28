// Unit tests for Cut to length (src/store/cutToLength.ts). Run with `npm test`.
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

const { songSections, planCut, exactTempo, songEnd, stateNames } = await import('../src/store/cutToLength.ts');

const note = (startOffset) => ({ id: 'n' + startOffset, note: 'C4', startOffset, duration: '8n', velocity: 0.8 });
const clip = (startBar, lengthBars, perBar) => ({
  id: 'c' + startBar, trackId: 't', name: 'c', startBar, lengthBars, isSelected: false,
  notes: Array.from({ length: Math.round(lengthBars * perBar) }, (_, i) => note(i / perBar)),
});
const marker = (bar, name, anchor = 'bar') => ({ id: name, name, anchor, bar, seconds: ((bar - 1) * 240) / 120 });

// Intro 4 (sparse), Verse 8, Drop 8 (busy), Break 4, Drop 2 8 (busy), Outro 4: 36 bars
const clips = [clip(1, 4, 2), clip(5, 8, 4), clip(13, 8, 12), clip(21, 4, 2), clip(25, 8, 12), clip(33, 4, 3)];
const markers = [marker(1, 'Intro'), marker(5, 'Verse'), marker(13, 'Drop'), marker(21, 'Break'), marker(25, 'Drop 2'), marker(33, 'Outro'), marker(9.3, 'Hit 1', 'time')];

test('sections come from bar markers (not hit points)', () => {
  const s = songSections(clips, markers);
  assert.equal(songEnd(clips), 37);
  assert.deepEqual(s.map((x) => [x.name, x.from, x.to]), [['Intro', 1, 5], ['Verse', 5, 13], ['Drop', 13, 21], ['Break', 21, 25], ['Drop 2', 25, 33], ['Outro', 33, 37]]);
  const drop = s.find((x) => x.name === 'Drop');
  const intro = s.find((x) => x.name === 'Intro');
  assert.ok(drop.weight > intro.weight);
});

test('a song without markers is cut into 8-bar phrases', () => {
  const s = songSections(clips, []);
  assert.equal(s.length, 5);
  assert.deepEqual([s[0].from, s[0].to, s[4].from, s[4].to], [1, 9, 33, 37]);
});

test('a short cut keeps the ending and the busiest part', () => {
  const s = songSections(clips, markers);
  // 30 s at 120 BPM is 15 bars: a Drop (8) and the Outro (4) is 12, Drop + Break + Outro is 16
  const plan = planCut(s, 15);
  assert.equal(plan.order[plan.order.length - 1], 5, 'ends on the Outro');
  assert.ok(plan.order.some((i) => s[i].name.startsWith('Drop')), 'keeps a drop');
  assert.ok(Math.abs(plan.bars - 15) / 15 <= 0.08 || plan.bars === 16 || plan.bars === 12);
  for (let k = 1; k < plan.order.length; k++) assert.ok(plan.order[k] > plan.order[k - 1], 'in order');
});

test('a longer cut repeats a middle section', () => {
  const s = songSections(clips, markers);
  const plan = planCut(s, 52);
  assert.ok(plan.bars >= 48 && plan.bars <= 56, `got ${plan.bars}`);
  assert.equal(plan.order[0], 0);
  assert.equal(plan.order[plan.order.length - 1], 5);
  assert.ok(plan.order.length > s.length);
});

test('exact tempo only within the nudge', () => {
  assert.equal(exactTempo(16, 30, 128), 128);
  assert.equal(exactTempo(16, 31, 128), 123.87);
  assert.equal(exactTempo(16, 40, 128), null);
});

test('state names: a song without markers has phrase states, and names that make one file name are told apart', () => {
  const clip = { id: 'c', trackId: 't', name: '', startBar: 1, lengthBars: 16, notes: [], isSelected: false };
  assert.deepEqual(stateNames(songSections([clip], [])), ['Bars 1-8', 'Bars 9-16']);
  // A lone marker at bar 1 doesn't make sections of its own
  assert.deepEqual(stateNames(songSections([clip], [{ id: 'm', name: 'Explore', bar: 1, anchor: 'bar' }])), ['Bars 1-8', 'Bars 9-16']);
  assert.deepEqual(stateNames([{ name: 'Boss/Fight' }, { name: 'Boss-Fight' }, { name: 'Calm' }]), ['Boss/Fight', 'Boss-Fight 2', 'Calm']);
});
