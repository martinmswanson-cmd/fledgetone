// Which settings a plugin starts from when it's built again (src/audio/pluginStartState.ts, used
// by wamHost.ts's startingState): its last live read, unless its track's settings were changed
// from outside since. Run with `npm test`.
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

const { createStartStates } = await import('../src/audio/pluginStartState.ts');
const J = (program, cutoff = 0.5) => JSON.stringify({ builtin: 1, program, values: [cutoff] });

test('a rebuild starts from the knob just turned, read live, though its track still has the settings it was built from', () => {
  const s = createStartStates();
  // Built from the track's settings; a knob turned, read live (the store then has them too)
  assert.equal(s.choose('p', J(3), undefined), 'saved');
  s.seen('p', J(3));
  s.seen('p', J(3, 0.8));
  // A rebuild (bypass) that began with the track as it was: the live read wins
  assert.equal(s.choose('p', J(3), J(3, 0.8)), 'live');
  // ...and with the track up to date: the same either way
  assert.equal(s.choose('p', J(3, 0.8), J(3, 0.8)), 'live');
  // No settings on the track at all: the live read
  assert.equal(s.choose('p', undefined, J(3, 0.8)), 'live');
});

test('settings put on the track from outside since the live read (another preset, a whole new song) win', () => {
  const s = createStartStates();
  s.seen('p', J(3));
  s.seen('p', J(3, 0.8));
  // The same plugin id, another preset the live instance never had
  assert.equal(s.choose('p', J(7), J(3, 0.8)), 'saved');
  // Each plugin keeps its own memory
  s.seen('q', J(7));
  assert.equal(s.choose('p', J(7), J(3, 0.8)), 'saved');
  assert.equal(s.choose('q', J(7), J(1)), 'live');
  // A project replaced: nothing is known any more
  s.clear();
  assert.equal(s.choose('q', J(7), J(1)), 'saved');
});

test('only the last few settings are remembered (a rebuild starts from one of them)', () => {
  const s = createStartStates();
  for (let i = 0; i < 40; i++) s.seen('p', J(1, i / 40));
  assert.equal(s.choose('p', J(1, 39 / 40), J(2)), 'live');
  assert.equal(s.choose('p', J(1, 30 / 40), J(2)), 'live');
  assert.equal(s.choose('p', J(1, 0), J(2)), 'saved');
  // Seen again: remembered as the newest
  s.seen('p', J(1, 0));
  assert.equal(s.choose('p', J(1, 0), J(2)), 'live');
});
