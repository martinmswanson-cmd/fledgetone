// Unit tests for the song's game sound effects (src/store/gameSfx.ts). Run with `npm test`.
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


const { createGameSfx, freeSfxName, parseGameSfx } = await import('../src/store/gameSfx.ts');
const { generateSfx } = await import('../src/audio/sfx/sfxSynth.ts');

test('names are made game-safe and unique', () => {
  assert.equal(freeSfxName('Sword hit!', []), 'sword_hit');
  assert.equal(freeSfxName('Sword hit', [{ name: 'sword_hit' }]), 'sword_hit_2');
  assert.equal(freeSfxName('sword hit', [{ name: 'sword_hit' }, { name: 'sword_hit_2' }]), 'sword_hit_3');
  const a = createGameSfx('Coin', generateSfx('coin', 1), [], 12, 9);
  assert.equal(a.name, 'coin');
  assert.equal(a.variations, 8);
  assert.equal(a.spread, 3);
});

test('game sounds read back from a project file; bad ones are left out, names stay unique', () => {
  const good = createGameSfx('Gem', generateSfx('gem', 2), [], 3, 1);
  const back = parseGameSfx(JSON.parse(JSON.stringify([good, { ...good, id: 'x' }, { name: 'broken', sound: { layers: [] } }, null, 'nope'])));
  assert.equal(back.length, 2);
  assert.deepEqual(back[0], good);
  assert.equal(back[1].name, 'gem_2');
  assert.deepEqual(parseGameSfx(undefined), []);
});
