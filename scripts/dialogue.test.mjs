// Unit tests for dip under dialogue (src/store/dialogue.ts). Run with `npm test`.
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

const { voiceLevels, speechSpans, dipLane, DEFAULT_DIP } = await import('../src/store/dialogue.ts');
const { AUTOMATION, laneValueAt } = await import('../src/audio/automation.ts');

const sr = 16000;
/** Quiet noise, with voice-like bursts (a 150 Hz buzz with harmonics up to 3 kHz, wobbling like syllables) in `talk` */
function scene(seconds, talk) {
  const x = new Float32Array(seconds * sr);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr;
    x[i] = 0.002 * rnd();
    if (talk.some(([a, b]) => t >= a && t < b)) {
      const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t);
      let v = 0;
      for (let h = 1; h <= 20; h++) v += Math.sin(2 * Math.PI * 150 * h * t) / h;
      x[i] += 0.2 * syllable * v;
    }
  }
  return x;
}

test('finds the lines and not the quiet between them', () => {
  const spans = speechSpans(voiceLevels(scene(6, [[1, 2], [3, 4.5]]), sr));
  assert.equal(spans.length, 2);
  assert.ok(Math.abs(spans[0].start - 1) < 0.08 && Math.abs(spans[0].end - 2) < 0.08, JSON.stringify(spans));
  assert.ok(Math.abs(spans[1].start - 3) < 0.08 && Math.abs(spans[1].end - 4.5) < 0.08, JSON.stringify(spans));
});

test('a short pause is bridged; a click is ignored', () => {
  const spans = speechSpans(voiceLevels(scene(5, [[1, 1.8], [2.1, 3], [4, 4.06]]), sr));
  assert.equal(spans.length, 1);
  assert.ok(spans[0].start < 1.1 && spans[0].end > 2.9);
});

test('silence has no dialogue', () => {
  assert.deepEqual(speechSpans(voiceLevels(scene(3, []), sr)), []);
});

test('dipLane: a new lane holds the fader, dips by the depth, and comes back', () => {
  const spb = 2; // 120 BPM
  const pts = dipLane([], 0, [{ from: 3, to: 4 }], DEFAULT_DIP, spb);
  const db = (bar) => {
    let v = pts[0].value;
    for (let i = 0; i < pts.length; i++) if (pts[i].bar <= bar) v = pts[i].value;
    return AUTOMATION.volume.toReal(v);
  };
  assert.ok(Math.abs(db(2) - 0) < 0.01);
  assert.ok(Math.abs(db(3.5) + DEFAULT_DIP.depth) < 0.01);
  assert.ok(Math.abs(db(6) - 0) < 0.01);
  assert.ok(pts[0].bar < 3 && pts[pts.length - 1].bar > 4);
});

test('dipLane: an existing lane keeps its shape and is lowered inside the dip', () => {
  const N = AUTOMATION.volume.toNorm;
  const lane = [{ bar: 1, value: N(-6) }, { bar: 9, value: N(-6) }];
  const pts = dipLane(lane, 0, [{ from: 4, to: 5 }], { depth: 6, attack: 0, release: 0 }, 2);
  for (const bar of [4.01, 4.5, 4.99]) assert.ok(Math.abs(AUTOMATION.volume.toReal(laneValueAt(pts, bar)) + 12) < 0.01, String(bar));
  assert.ok(Math.abs(AUTOMATION.volume.toReal(laneValueAt(pts, 7)) + 6) < 0.01);
  assert.ok(Math.abs(AUTOMATION.volume.toReal(pts[0].value) + 6) < 0.01);
});
