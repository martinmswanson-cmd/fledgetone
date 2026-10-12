// Unit tests for Intensity and stem groups (src/store/intensity.ts). Run with `npm test`.
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

const { curveLevel, defaultCurve, trackIntensityLevel, parseCurves, groupsInUse } = await import('../src/store/intensity.ts');

test('a curve gives straight lines between its points, flat beyond the ends', () => {
  const c = [[0.2, 0], [0.6, 1]];
  assert.equal(curveLevel(c, 0), 0);
  assert.ok(Math.abs(curveLevel(c, 0.4) - 0.5) < 1e-12);
  assert.equal(curveLevel(c, 1), 1);
  assert.equal(curveLevel([], 0.3), 1);
});

test('presets come in at their own points', () => {
  assert.equal(curveLevel(defaultCurve('Ambient'), 0), 1);
  assert.equal(curveLevel(defaultCurve('Percussion'), 0.1), 0);
  assert.equal(curveLevel(defaultCurve('Percussion'), 0.5), 1);
  assert.equal(curveLevel(defaultCurve('Climax'), 0.7), 0);
  assert.equal(curveLevel(defaultCurve('Climax'), 1), 1);
});

test('tracks without a group play at full level; groups use their curve or the default', () => {
  assert.equal(trackIntensityLevel({}, {}, 0), 1);
  assert.equal(trackIntensityLevel({ stemGroup: 'Climax' }, {}, 0.5), 0);
  assert.equal(trackIntensityLevel({ stemGroup: 'Mine' }, { Mine: [[0, 0.25], [1, 0.25]] }, 0.9), 0.25);
});

test('curves from a file are cleaned up', () => {
  assert.deepEqual(parseCurves({ A: [[1, 2], [-1, 0.5], ['x', 1]], B: 'no', '': [[0, 1]] }), { A: [[0, 0.5], [1, 1]] });
  assert.deepEqual(groupsInUse([{ stemGroup: 'B' }, {}, { stemGroup: 'A' }, { stemGroup: 'B' }]), ['B', 'A']);
});
