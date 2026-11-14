// The section instruments (String Section, Brass Section: several recorded sets as one instrument,
// each over its part of the keyboard) are evened across the whole keyboard, so the level doesn't
// step where one section hands over to the next. Run with `npm test`.
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

const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
const { SET_LEVELS } = await import('../src/audio/samplers/setLevels.ts');

const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/**
 * An instrument's recordings as they play, by loudness: [midi, the file's measured level plus the
 * gain the instrument gives it (dB), its set], lowest note first. Read from the files' own names,
 * so nothing here goes through the code that works the gains out.
 */
function played(key) {
  const { samples, gains = {} } = INSTRUMENTS[key].samples;
  const rows = new Map();
  for (const [name, file] of Object.entries(samples)) {
    const m = /^([\w-]+)\/([A-G])(s?)(-?\d+)_(\d+)_(\d+)\.mp3$/.exec(file);
    assert.ok(m, file);
    const [, folder, letter, sharp, octave, ownLayer, take] = m;
    const midi = 12 * (Number(octave) + 1) + PITCH[letter] + (sharp ? 1 : 0);
    const level = SET_LEVELS[folder]?.levels[`${midi}_${ownLayer}_${take}`];
    assert.ok(level !== undefined, `${folder} ${midi}_${ownLayer}_${take} has no measured level`);
    const layer = name.split('|')[1];
    if (!rows.has(layer)) rows.set(layer, []);
    rows.get(layer).push([midi, level + (gains[name] ?? 0), folder]);
  }
  for (const row of rows.values()) row.sort((a, b) => a[0] - b[0]);
  return rows;
}

for (const [key, name, sets] of [['realStrings', 'String Section', 3], ['realBrass', 'Brass Section', 4]]) {
  test(`${name}: no step in level where one section hands over to the next`, () => {
    const rows = played(key);
    assert.ok(rows.size >= 2);
    for (const [layer, row] of rows) {
      assert.equal(new Set(row.map((r) => r[2])).size, sets, 'every section plays');
      for (let i = 1; i < row.length; i++) {
        if (row[i][2] === row[i - 1][2]) continue;
        const step = row[i][1] - row[i - 1][1];
        // (The cellos' top recording and the violas' bottom one were 8 dB apart, the trombone's and the horn's 6)
        assert.ok(Math.abs(step) < 2.5, `loudness ${layer}: ${row[i - 1][2]} ${row[i - 1][0]} to ${row[i][2]} ${row[i][0]} steps ${step.toFixed(1)} dB`);
      }
    }
  });

  test(`${name}: neighbouring recordings are within 3 dB of each other all the way up`, () => {
    for (const [layer, row] of played(key)) {
      for (let i = 1; i < row.length; i++) {
        const step = row[i][1] - row[i - 1][1];
        assert.ok(Math.abs(step) < 3, `loudness ${layer}: note ${row[i - 1][0]} to ${row[i][0]} steps ${step.toFixed(1)} dB`);
      }
    }
  });

  test(`${name}: evened, not made over: no recording moves more than 6 dB, and the instrument is as loud as it was on average`, () => {
    const { samples, gains = {} } = INSTRUMENTS[key].samples;
    // Against the sections' own gains (the most any section was given before: 8.6 dB on the bass trombone)
    const plain = { realStrings: { 'cello-sustain': -4.4, 'violas-sustain': -6.9, 'violins-sustain': -3.6 }, realBrass: { 'bass-trombone': 8.6, 'tenor-trombone': 8.5, 'french-horn': 0, 'trumpet-vib': 0.2 } }[key];
    const changes = Object.entries(samples).map(([n, file]) => (gains[n] ?? 0) - plain[file.split('/')[0]]);
    assert.ok(Math.max(...changes.map(Math.abs)) > 1, 'some recordings are moved');
    assert.ok(Math.max(...changes.map(Math.abs)) <= 6, `the most a recording moves: ${Math.max(...changes.map(Math.abs)).toFixed(1)} dB`);
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    assert.ok(Math.abs(mean) < 1, `moved ${mean.toFixed(2)} dB on average`);
  });
}

test('the sections on their own (Cellos, Violins, French Horn...) play their recordings as before', () => {
  for (const key of ['realCello', 'realViolas', 'realViolins', 'realHorn', 'realTrumpet', 'realTrombone', 'realBassTrombone']) {
    assert.deepEqual(INSTRUMENTS[key].samples.gains ?? {}, {}, key);
  }
});
