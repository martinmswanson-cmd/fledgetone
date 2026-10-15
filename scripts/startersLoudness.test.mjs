// Unit tests for the starters' loudness table and trim (src/store/startersLoudness.ts): every
// starter has a measured trim, every measured level is within 1.5 LU of its group's target, no
// target is too loud, and the trim moves the master Level only. Run with
// `npm test`. (The levels themselves come from rendering; see the file's header comment.)
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
const { GENTLE_STARTERS, GROUP_LOUDNESS, MAX_STARTER_LOUDNESS, STARTER_LEVELS, starterLoudness, starterTrimDb, trimMix } = await import('../src/store/startersLoudness.ts');
const { LEVEL_MAX, LEVEL_MIN } = await import('../src/store/timelineTypes.ts');

// The starter list, read from its source (importing starters.ts would load every instrument)
const source = readFileSync(new URL('../src/store/starters.ts', import.meta.url), 'utf8');
const STARTERS = [...source.matchAll(/\{ id: '(\w+)', group: '([^']+)'/g)].map(([, id, group]) => ({ id, group }));

test('the starter list was read', () => {
  assert.ok(STARTERS.length >= 70, `found ${STARTERS.length}`);
});

test('every starter has a measured trim, and every trim a starter', () => {
  const ids = new Set(STARTERS.map((s) => s.id));
  for (const { id } of STARTERS) assert.ok(STARTER_LEVELS[id], `${id} has no entry in STARTER_LEVELS: render it and add its trim`);
  for (const id of Object.keys(STARTER_LEVELS)) assert.ok(ids.has(id), `${id} in STARTER_LEVELS is not a starter`);
  for (const id of GENTLE_STARTERS) assert.ok(ids.has(id), `${id} in GENTLE_STARTERS is not a starter`);
});

test('every group has a target, none louder than the limit', () => {
  for (const { group } of STARTERS) assert.ok(group in GROUP_LOUDNESS, `no loudness target for ${group}`);
  for (const lufs of Object.values(GROUP_LOUDNESS)) assert.ok(lufs <= MAX_STARTER_LOUDNESS);
});

test('every starter measured within 1.5 LU of its target, with a sane trim', () => {
  for (const { id, group } of STARTERS) {
    const { trim, lufs } = STARTER_LEVELS[id];
    const target = starterLoudness(id, group);
    assert.ok(Math.abs(lufs - target) <= 1.5, `${id}: ${lufs} LUFS, target ${target}`);
    assert.ok(lufs <= MAX_STARTER_LOUDNESS + 0.5, `${id}: ${lufs} LUFS is too loud`);
    assert.ok(Math.abs(trim) <= 15, `${id}: a ${trim} dB trim means its mix needs fixing`);
    // The trim is the master Level, which stops at its range: a trim past it would be cut short
    // without a word, and the starter would play quieter than its measured loudness
    assert.ok(trim >= LEVEL_MIN && trim <= LEVEL_MAX, `${id}: a ${trim} dB trim is past the master Level's range (${LEVEL_MIN} to ${LEVEL_MAX}): raise its faders instead`);
    assert.equal(starterTrimDb(id), trim);
  }
  assert.equal(starterTrimDb('not a starter'), 0);
});

const OTT = { on: false, depth: 0.5, time: 0.3, inGain: 0, outGain: 0 };
const master = (on, level = 0) => ({ glue: 'standard', ott: { ...OTT, on, outGain: on ? 2 : 0 }, width: { on: false, amount: 1.3, monoBass: true }, level });
const mk = (id, extra = {}) => ({ id, name: id, volume: -10, reverbSend: 0.2, delaySend: 0.1, fx: {}, ...extra });

test('trimMix moves the master Level and nothing else', () => {
  for (const on of [false, true]) {
    const p = { name: 't', master: master(on), tracks: [mk('lead', { sends: [{ to: 'room', level: 0.4 }] }), mk('kick', { output: 'bus' }), mk('bus'), mk('room')] };
    const q = trimMix(p, 6);
    assert.equal(q.master.level, 6);
    // The faders and the OTT keep the starter's mix
    assert.deepEqual(q.tracks, p.tracks);
    assert.deepEqual(q.master.ott, p.master.ott);
    assert.equal(trimMix(p, -3.5).master.level, -3.5);
  }
  // Added to a Level already set, within its range
  assert.equal(trimMix({ master: master(false, 2), tracks: [] }, 4).master.level, 6);
  assert.equal(trimMix({ master: master(false, 10), tracks: [] }, 5).master.level, 12);
  assert.equal(trimMix({ master: master(false), tracks: [] }, -30).master.level, -24);
  // A project with no master settings gets the defaults with the Level set
  assert.equal(trimMix({ tracks: [] }, 3).master.level, 3);
  // Nothing to do at 0
  const p = { master: master(false), tracks: [] };
  assert.equal(trimMix(p, 0), p);
});
