// Unit tests for the notation model and MusicXML (src/store/notation.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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
const { notate, spell, keySpec, keyFifths, spellPitch, musicXml } = await import('../src/store/notation.ts');
const { keyOf } = await import('../src/store/songKey.ts');
const FOUR = { base: { num: 4, den: 4 }, points: [] };
const n = (note, startOffset, duration, id = `${note}${startOffset}`) => ({ id, note, startOffset, duration, velocity: 0.8 });
const glyphs = (m, s = 0) => m.staves[s].map((g) => `${g.keys.length ? g.keys.join('+') : 'r'}:${g.units}${g.tie ? '~' : ''}`).join(' ');

test('lengths are spelled as note values, split at the beat when off it', () => {
  const four = { num: 4, den: 4 };
  assert.deepEqual(spell(0, 16, four), [16]);
  assert.deepEqual(spell(0, 12, four), [12]);
  assert.deepEqual(spell(1, 4, four), [3, 1]);
  assert.deepEqual(spell(2, 6, four), [2, 4]);
  assert.deepEqual(spell(0, 5, four), [4, 1]);
  // 3/4: no whole notes; 6/8 beats are dotted quarters
  assert.deepEqual(spell(0, 12, { num: 3, den: 4 }), [12]);
  assert.deepEqual(spell(0, 12, { num: 6, den: 8 }), [12]);
  // Rests aren't dotted across a beat
  assert.deepEqual(spell(4, 12, four, true), [4, 8]);
});

test('a clip becomes measures of chords and rests, tied over bar lines', () => {
  const clip = { startBar: 1, lengthBars: 2, notes: [n('C5', 0, '4n'), n('E5', 0, '4n'), n('G5', 0.5, '2n.')] };
  const score = notate(clip, FOUR, null);
  assert.deepEqual(score.staves, ['treble']);
  assert.equal(score.measures.length, 2);
  assert.equal(glyphs(score.measures[0]), '72+76:4 r:4 79:8~');
  assert.equal(glyphs(score.measures[1]), '79:4 r:4 r:8');
  // Low and high notes: a grand staff split at middle C
  const wide = notate({ startBar: 1, lengthBars: 1, notes: [n('C3', 0, '1m'), n('C5', 0, '2n')] }, FOUR, null);
  assert.deepEqual(wide.staves, ['treble', 'bass']);
  assert.equal(glyphs(wide.measures[0], 0), '72:8 r:8');
  assert.equal(glyphs(wide.measures[0], 1), '48:16');
  // A clip starting mid-measure starts with a rest
  const late = notate({ startBar: 1.5, lengthBars: 0.5, notes: [n('A4', 0, '4n')] }, FOUR, null);
  assert.equal(glyphs(late.measures[0]), 'r:8 69:4 r:4');
});

test('keys: signatures and spelling', () => {
  assert.equal(keySpec(keyOf(7, 'major')), 'G');
  assert.equal(keySpec(keyOf(5, 'major')), 'F');
  assert.equal(keySpec(keyOf(9, 'minor')), 'Am');
  assert.equal(keySpec(keyOf(2, 'minor')), 'Dm');
  assert.equal(keyFifths(keyOf(10, 'major')), -2);
  assert.equal(keyFifths(keyOf(4, 'major')), 4);
  assert.deepEqual(spellPitch(70, keyOf(5, 'major')), { step: 'B', alter: -1, octave: 4 });
  assert.deepEqual(spellPitch(70, keyOf(4, 'major')), { step: 'A', alter: 1, octave: 4 });
});

test('MusicXML has the notes, ties and staves', () => {
  const score = notate({ startBar: 1, lengthBars: 2, notes: [n('C3', 0, '1m'), n('G5', 0.5, '2n.')] }, FOUR, keyOf(7, 'major'));
  const xml = musicXml(score, { title: 'Song & Co', partName: 'Keys', bpm: 120 });
  assert.match(xml, /<score-partwise version="4.0">/);
  assert.match(xml, /Song &amp; Co/);
  assert.match(xml, /<staves>2<\/staves>/);
  assert.match(xml, /<fifths>1<\/fifths>/);
  assert.match(xml, /<tie type="start"\/>/);
  assert.equal((xml.match(/<measure /g) ?? []).length, 2);
});
