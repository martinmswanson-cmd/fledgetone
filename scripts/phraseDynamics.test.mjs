// Shape dynamics (src/store/phraseDynamics.ts): a phrase rises to its highest note and eases off at its end, keeping its average loudness.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const { shapeDynamics } = await import('../src/store/phraseDynamics.ts');
const line = (names, at = 0) => names.map((note, i) => ({ id: note + i + at, note, startOffset: at + i * 0.125, duration: '8n', velocity: 0.7 }));

test('a phrase swells to its top note and eases off at the end, its average kept', () => {
  const notes = line(['C4', 'D4', 'E4', 'G4', 'C5', 'G4', 'E4', 'D4']);
  const out = shapeDynamics(notes);
  const v = out.map((n) => n.velocity);
  const top = v[4];
  assert.ok(v.every((x) => x <= top + 1e-9), 'the top note is the loudest');
  assert.ok(v[7] < v[6], 'the last note eases off');
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(Math.abs(mean(v) - 0.7) < 0.01, 'the phrase’s average stays');
});

test('a rest starts a new phrase, each shaped on its own', () => {
  const notes = [...line(['C4', 'E4', 'G4', 'E4']), ...line(['A4', 'C5', 'A4', 'F4'], 1)];
  const out = shapeDynamics(notes);
  assert.ok(out[2].velocity > out[0].velocity && out[5].velocity > out[4].velocity);
});

test('non-stop notes start a new phrase every two of the song’s measures (3/4, 7/8), every two bars in 4/4 as before', async () => {
  const TM = await import('../src/audio/tempoMap.ts');
  const names = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5'];
  for (const [num, den] of [[3, 4], [7, 8]]) {
    const map = { base: { num, den }, points: [] };
    const beat = 1 / den;
    // Four measures of non-stop beats, rising over each pair of measures and starting low again
    const per = 2 * num;
    const notes = Array.from({ length: 4 * num }, (_, i) => ({ id: `n${i}`, note: names[i % per], startOffset: i * beat, duration: den === 4 ? '4n' : '8n', velocity: 0.7 }));
    for (const at of [1, TM.measureStart(3, map)]) {
      const out = shapeDynamics(notes, (from) => TM.addMeasures(at + from, 2, map) - at);
      const v = out.map((x) => x.velocity);
      // Two phrases, the same shape: the second starts on measure 3's first beat
      assert.deepEqual(v.slice(per), v.slice(0, per), `${num}/${den}`);
      assert.ok(v[per] < v[per - 1], 'the second phrase starts soft again');
    }
  }
  // 4/4: two bars, the meter passed or not
  const four = { base: { num: 4, den: 4 }, points: [] };
  const notes = Array.from({ length: 32 }, (_, i) => ({ id: 'q' + i, note: ['C4', 'E4', 'G4', 'C5', 'A4', 'F4', 'D4', 'B3'][i % 8], startOffset: i / 8, duration: '8n', velocity: 0.7 }));
  const fnv = (x) => {
    const s = JSON.stringify(x);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return h.toString(16);
  };
  assert.equal(fnv(shapeDynamics(notes)), 'f51f243');
  assert.deepEqual(shapeDynamics(notes, (from) => TM.addMeasures(2.5 + from, 2, four) - 2.5), shapeDynamics(notes));
  // The piano roll passes the song's measures
  assert.match(readFileSync(new URL('../src/components/timeline/PianoRoll.tsx', import.meta.url), 'utf8'), /shapeDynamics\(target, \(from\) => addMeasures\(clip\.startBar \+ from, 2, map\) - clip\.startBar\)/);
});
