// The master's Headroom (MasterSettings.headroom): the mix turned down where it enters the master
// section, ahead of the compressor. Blank new songs start with it; saved songs and starters, which
// were mixed without it, keep their sound. Run with `npm test`.
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

const T = await import('../src/store/timelineTypes.ts');

test('a song saved without Headroom opens without it, and one saved with it keeps it, inside its range', () => {
  assert.equal(T.normalizeMasterSettings({ glue: 'tight', level: 2 }).headroom, undefined);
  assert.equal(T.normalizeMasterSettings(undefined).headroom, undefined);
  assert.equal(T.normalizeMasterSettings({ headroom: 6 }).headroom, 6);
  assert.equal(T.normalizeMasterSettings({ headroom: 4.5 }).headroom, 4.5);
  assert.equal(T.normalizeMasterSettings({ headroom: 99 }).headroom, 12);
  // Never a boost, and nothing that isn't a number: none
  for (const bad of [0, -3, 'six', null, NaN, Infinity]) assert.equal(T.normalizeMasterSettings({ headroom: bad }).headroom, undefined, String(bad));
});

test('the gain the Headroom puts ahead of the compressor: exactly 1 without it, 6 dB down at 6', () => {
  assert.equal(T.headroomGain(T.defaultMasterSettings()), 1);
  assert.equal(T.headroomGain({ ...T.defaultMasterSettings(), headroom: 0 }), 1);
  assert.ok(Math.abs(T.headroomGain({ ...T.defaultMasterSettings(), headroom: 6 }) - 0.5012) < 1e-4);
  assert.ok(Math.abs(T.headroomGain({ ...T.defaultMasterSettings(), headroom: 12 }) - 0.2512) < 1e-4);
});

test('changing the Headroom is a change of the master (it reaches the engine and the autosave); none and 0 are the same', () => {
  const old = T.defaultMasterSettings();
  assert.equal(T.sameMasterSettings(old, { ...old, headroom: 6 }), false);
  assert.equal(T.sameMasterSettings({ ...old, headroom: 6 }, { ...old, headroom: 3 }), false);
  assert.equal(T.sameMasterSettings({ ...old, headroom: 6 }, { ...old, headroom: 6 }), true);
  assert.equal(T.sameMasterSettings(old, { ...old, headroom: 0 }), true);
});

test('a blank new song starts with 6 dB of Headroom and its lows in the middle', () => {
  const blank = T.newSongMaster(undefined, true);
  assert.equal(blank.headroom, 6);
  assert.equal(blank.monoLow, true);
  assert.equal(blank.glue, 'standard');
  assert.equal(blank.level, 0);
});

test('a starter keeps the levels it was mixed at: no Headroom, its own master, its lows in the middle', () => {
  const mixed = { ...T.defaultMasterSettings(), glue: 'gentle', level: 10.5 };
  const starter = T.newSongMaster(mixed, false);
  assert.equal(starter.headroom, undefined);
  assert.equal(starter.level, 10.5);
  assert.equal(starter.glue, 'gentle');
  assert.equal(starter.monoLow, true);
});

test('the assistant sees the Headroom and says a change of it in plain words', async () => {
  const { diffSongs } = await import('../src/agent/songDiff.ts');
  const { createStarter } = await import('../src/store/starters.ts');
  const a = createStarter('lofi');
  const words = (x, y) => diffSongs(x, y).changes.map((c) => c.text).join('\n');
  const withRoom = { ...a, master: { ...a.master, headroom: 6 } };
  assert.match(words(a, withRoom), /6 dB of headroom ahead of the master/);
  assert.match(words(withRoom, a), /no headroom ahead of the master/i);
  assert.match(words(withRoom, { ...a, master: { ...a.master, headroom: 3 } }), /3 dB of headroom ahead of the master compressor \(it was 6 dB\)/);
  const { toAgentSong } = await import('../src/agent/agentSong.ts');
  assert.equal(toAgentSong(withRoom).master.headroomDb, 6);
  assert.equal(toAgentSong(a).master.headroomDb, 0);
});
