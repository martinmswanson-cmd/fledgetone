// Unit tests for clip expression lanes (src/store/expression.ts). Run with `npm test`.
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
const x = await import('../src/store/expression.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('lanes rest before their first point, glide between points, and hold after', () => {
  const bend = [{ at: 0.5, value: 0 }, { at: 1, value: 2 }];
  near(x.exprValueAt(bend, 0.2), 0);
  near(x.exprValueAt(bend, 0.75), 1);
  near(x.exprValueAt(bend, 3), 2);
  // The pedal steps
  const pedal = [{ at: 1, value: 1 }, { at: 2, value: 0 }];
  assert.equal(x.exprValueAt(pedal, 1.5, true), 1);
  assert.equal(x.exprValueAt(pedal, 2.5, true), 0);
});

test('the sustain pedal holds notes let go while it is down', () => {
  const pedal = [{ at: 0, value: 1 }, { at: 1.5, value: 0 }, { at: 2, value: 1 }];
  const notes = [
    { startOffset: 0, duration: '8n' }, // let go at 0.125, pedal down: rings to 1.5
    { startOffset: 1.5, duration: '8n' }, // let go at 1.625, pedal up: as written
    { startOffset: 2.5, duration: '4n' }, // pedal down to the clip's end (4)
  ];
  const held = x.sustainNotes(notes, pedal, 4);
  near(durationToBars(held[0].duration), 1.5);
  assert.equal(held[1], notes[1]);
  near(durationToBars(held[2].duration), 1.5);
  // No pedal: the same notes
  assert.equal(x.sustainNotes(notes, undefined, 4), notes);
});

test('pitch events follow the bend, add vibrato where the wheel is up, and reset at the end', () => {
  assert.deepEqual(x.pitchEvents({ lengthBars: 2, expression: {} }), []);
  const ev = x.pitchEvents({ lengthBars: 2, expression: { bend: [{ at: 0, value: 0 }, { at: 1, value: 2 }] } });
  near(ev[0].cents, 0);
  near(ev.find((e) => Math.abs(e.at - 0.5) < 1e-9).cents, 100);
  // Held at 2 semitones after bar 1: said again every 16th (so starting there bends at once), then the reset
  const after = ev.filter((e) => e.at > 1 + 1e-9);
  assert.equal(after.length, 16);
  assert.ok(after.slice(0, -1).every((e) => e.cents === 200));
  assert.deepEqual(after[after.length - 1], { at: 2, cents: 0, mod: 0 });
  const vib = x.pitchEvents({ lengthBars: 1, expression: { mod: [{ at: 0, value: 1 }] } });
  assert.equal(vib.length, 129);
  near(x.pitchCents({ at: 0, cents: 0, mod: 1 }, 1 / (4 * x.VIBRATO_HZ)), x.VIBRATO_CENTS, 1e-6);
});

test('lanes from a file are tidied and clamped', () => {
  const e = x.normalizeExpression({ bend: [{ at: 2, value: 40 }, { at: 1, value: -1 }], sustain: [{ at: 0, value: 0.7 }], mod: 'nope' });
  assert.deepEqual(e.bend, [{ at: 1, value: -1 }, { at: 2, value: 12 }]);
  assert.deepEqual(e.sustain, [{ at: 0, value: 1 }]);
  assert.equal(e.mod, undefined);
  assert.equal(x.normalizeExpression(null), undefined);
});
