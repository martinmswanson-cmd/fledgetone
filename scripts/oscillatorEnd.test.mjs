// Every Tone oscillator start connects the oscillator's pitch and detune to a new browser oscillator
// (src/audio/toneFixes.ts): once that one has ended they're disconnected from it, so it can be let go,
// and not before. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

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
const Tone = await import('tone');
const { disconnectWhenEnded } = await import('../src/audio/toneFixes.ts');

/** A stand-in for a browser oscillator: its 'ended' listeners, and its two params. */
function fakeOscillator() {
  const listeners = [];
  return {
    frequency: { name: 'frequency' },
    detune: { name: 'detune' },
    addEventListener(type, listener, options) {
      listeners.push({ type, listener, once: options?.once === true });
    },
    end() {
      for (const l of listeners.splice(0)) if (l.type === 'ended') l.listener();
    },
    listeners,
  };
}
/** A stand-in for a Tone signal: what it was disconnected from. */
function fakeSignal(fail = false) {
  const cut = [];
  return {
    cut,
    disconnect(to) {
      if (fail) throw new Error('not connected');
      cut.push(to);
    },
  };
}

test('pitch and detune stay connected while the oscillator plays, and are disconnected once it has ended', () => {
  const osc = fakeOscillator();
  const frequency = fakeSignal();
  const detune = fakeSignal();
  disconnectWhenEnded(osc, [
    [frequency, osc.frequency],
    [detune, osc.detune],
  ]);
  assert.deepEqual(frequency.cut, []);
  assert.deepEqual(detune.cut, []);
  assert.equal(osc.listeners.length, 1);
  assert.equal(osc.listeners[0].once, true);
  osc.end();
  assert.deepEqual(frequency.cut, [osc.frequency]);
  assert.deepEqual(detune.cut, [osc.detune]);
});

test('a disconnect that fails leaves the others to go through', () => {
  const osc = fakeOscillator();
  const frequency = fakeSignal(true);
  const detune = fakeSignal();
  disconnectWhenEnded(osc, [
    [frequency, osc.frequency],
    [detune, osc.detune],
  ]);
  assert.doesNotThrow(() => osc.end());
  assert.deepEqual(detune.cut, [osc.detune]);
});

test("Tone still connects a new browser oscillator's pitch and detune at each start, which the fix wraps", () => {
  const require = createRequire(import.meta.url);
  const dir = require.resolve('tone').replace(/build[\\/].*$/, '');
  const src = readFileSync(dir + 'build/esm/source/oscillator/Oscillator.js', 'utf8');
  const start = src.slice(src.indexOf('    _start('), src.indexOf('    _stop('));
  assert.match(start, /new ToneOscillatorNode\(/);
  assert.match(start, /this\.frequency\.connect\(this\._oscillator\.frequency\)/);
  assert.match(start, /this\.detune\.connect\(this\._oscillator\.detune\)/);
  // (And the start used is the wrapped one)
  assert.match(String(Tone.Oscillator.prototype._start), /disconnectWhenEnded/);
});
