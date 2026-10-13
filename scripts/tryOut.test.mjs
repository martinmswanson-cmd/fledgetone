// Unit tests for the game preview's wiring (src/store/tryOut.ts). Run with `npm test`.
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


const { guessTryOutMap, intensityFor } = await import('../src/store/tryOut.ts');

const song = (states, stingers = [], sfx = []) => ({ states: states.map((name) => ({ name })), stingers, sfx });

test('the calm, fight and win states come from their names', () => {
  const m = guessTryOutMap(song(['Explore', 'Danger']));
  assert.equal(m.calm, 'Explore');
  assert.equal(m.fight, 'Danger');
  assert.equal(m.win, '');
  const boss = guessTryOutMap(song(['Phase 1', 'Phase 2', 'Defeated']));
  assert.deepEqual([boss.calm, boss.fight, boss.win], ['Phase 1', 'Phase 2', 'Defeated']);
  const stealth = guessTryOutMap(song(['Sneak', 'Spotted']));
  assert.deepEqual([stealth.calm, stealth.fight], ['Sneak', 'Spotted']);
  // Names that say nothing: the first two, in order
  const plain = guessTryOutMap(song(['A', 'B', 'C']));
  assert.deepEqual([plain.calm, plain.fight], ['A', 'B']);
  // One state: nothing to switch to
  const one = guessTryOutMap(song(['Loop']));
  assert.deepEqual([one.calm, one.fight], ['Loop', '']);
});

test('stingers by kind and sound effects by name; loops are never one-shot sounds', () => {
  const m = guessTryOutMap(
    song(['Explore', 'Danger'], [{ name: 'Item', kind: 'item' }, { name: 'Victory', kind: 'victory' }, { name: 'Game over', kind: 'gameOver' }], [
      { name: 'coin', loop: false },
      { name: 'footstep', loop: false },
      { name: 'sword_hit', loop: false },
      { name: 'rain', loop: true },
    ])
  );
  assert.deepEqual([m.coinStinger, m.winStinger, m.loseStinger], ['Item', 'Victory', 'Game over']);
  assert.deepEqual([m.coinSfx, m.stepSfx, m.hurtSfx], ['coin', 'footstep', 'sword_hit']);
  assert.equal(m.jumpSfx, '');
});

test('intensity rises as the enemy closes in', () => {
  assert.equal(intensityFor(3, false), 0.3);
  assert.equal(intensityFor(7, true), 0.3);
  assert.equal(intensityFor(1.2, true), 1);
  assert.equal(intensityFor(0.2, true), 1);
  const mid = intensityFor(4.1, true);
  assert.ok(mid > 0.6 && mid < 0.7);
});
