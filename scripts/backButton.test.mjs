// Unit tests for the phone's Back button (src/native/backButton.ts): the newest way back that does
// something runs, ways back that are removed stop running, and with none Back reports nothing done
// (the app then goes to the background). Run with `npm test`.
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
const { onBack, goBack, escapeOpenDialog } = await import('../src/native/backButton.ts');

test('Back runs the newest way back, then the ones under it', () => {
  const log = [];
  let starters = true;
  const offScreen = onBack(() => {
    if (!starters) return false;
    starters = false;
    log.push('starters');
    return true;
  });
  const offSheet = onBack(() => {
    log.push('sheet');
    offSheet();
    return true;
  });
  assert.equal(goBack(), true);
  assert.equal(goBack(), true);
  // Nothing left to go back from: the app goes to the background
  assert.equal(goBack(), false);
  assert.deepEqual(log, ['sheet', 'starters']);
  offScreen();
  assert.equal(goBack(), false);
});

test('a way back removed twice, or out of order, leaves the others', () => {
  const log = [];
  const a = onBack(() => (log.push('a'), true));
  const b = onBack(() => (log.push('b'), true));
  a();
  a();
  assert.equal(goBack(), true);
  b();
  assert.equal(goBack(), false);
  assert.deepEqual(log, ['b']);
});

test('an open dialog gets an Escape; with none, nothing is done', () => {
  const sent = [];
  const dialog = { dispatchEvent: (e) => sent.push(e.key) };
  globalThis.KeyboardEvent ??= class {
    constructor(type, init) {
      Object.assign(this, { type, ...init });
    }
  };
  assert.equal(escapeOpenDialog({ querySelectorAll: () => [] }), false);
  assert.equal(escapeOpenDialog({ querySelectorAll: () => [{}, dialog] }), true);
  assert.deepEqual(sent, ['Escape']);
});
