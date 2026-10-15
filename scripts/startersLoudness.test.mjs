// Unit tests for the starters' loudness table and trim (src/store/startersLoudness.ts): every
// starter has a measured trim, every measured level is within 1.5 LU of its group's target, no
// target is too loud, and the trim moves the whole mix without changing its balance. Run with
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
    assert.equal(starterTrimDb(id), trim);
  }
  assert.equal(starterTrimDb('not a starter'), 0);
});

const COMP = { on: false, threshold: -20, ratio: 4, makeup: 3 };
const mk = (id, extra = {}) => ({ id, name: id, volume: -10, reverbSend: 0.2, delaySend: 0.1, fx: { compressor: COMP }, ...extra });
const OTT = { on: false, depth: 0.5, time: 0.3, inGain: 0, outGain: 0 };
const master = (on) => ({ glue: 'standard', ott: { ...OTT, on }, width: { on: false, amount: 1.3, monoBass: true } });

test('trimMix moves what reaches the master, once', () => {
  const p = {
    name: 't',
    master: master(false),
    tracks: [
      mk('lead', { sends: [{ to: 'room', level: 0.4 }, { to: 'room2', level: 0.3, pre: true }], automation: [{ param: 'volume', points: [{ bar: 1, value: 0.5 }] }] }),
      mk('kick', { output: 'bus' }),
      mk('bus'),
      mk('room'),
      mk('room2'),
    ],
  };
  const q = trimMix(p, 6);
  const t = Object.fromEntries(q.tracks.map((x) => [x.id, x]));
  // Into the master: the fader moves
  assert.equal(t.lead.volume, -4);
  assert.equal(t.bus.volume, -4);
  assert.equal(t.room.volume, -4);
  // Its post-fader send into a return that also moved is taken back; a pre-fader one isn't
  assert.ok(Math.abs(t.lead.sends[0].level - 0.4 / 10 ** (6 / 20)) < 1e-9);
  assert.equal(t.lead.sends[1].level, 0.3);
  // Its shared reverb and delay sends ride on its fader
  assert.equal(t.lead.reverbSend, 0.2);
  // Into a bus: the fader stays (the bus moves), the shared sends that skip the bus move
  assert.equal(t.kick.volume, -10);
  assert.ok(Math.abs(t.kick.reverbSend - 0.2 * 10 ** (6 / 20)) < 1e-9);
  // A volume lane moves with its fader: dB = 6 + 80 log10(value)
  const db = (v) => 6 + 80 * Math.log10(v);
  assert.ok(Math.abs(db(t.lead.automation[0].points[0].value) - (db(0.5) + 6)) < 1e-9);
  // Nothing to do at 0
  assert.equal(trimMix(p, 0), p);
});

test('trimMix keeps faders in their range: the rest goes on the makeup gain', () => {
  const q = trimMix({ master: master(false), tracks: [mk('a', { volume: 4 }), mk('b', { volume: 3, fx: { compressor: { ...COMP, on: true } } })] }, 4);
  assert.equal(q.tracks[0].volume, 6);
  // Its compressor was off: on as a plain gain (ratio 1) with the 2 dB the fader couldn't take
  assert.deepEqual(q.tracks[0].fx.compressor, { on: true, threshold: 0, ratio: 1, makeup: 2 });
  // On already: its makeup goes up by the rest
  assert.equal(q.tracks[1].volume, 6);
  assert.equal(q.tracks[1].fx.compressor.makeup, 4);
  assert.equal(trimMix({ master: master(false), tracks: [mk('c', { volume: -58 })] }, -4).tracks[0].volume, -60);
});

test('trimMix with the OTT on moves its Out gain, not the faders', () => {
  const p = { master: master(true), tracks: [mk('a')] };
  const q = trimMix(p, 5);
  assert.equal(q.master.ott.outGain, 5);
  assert.equal(q.tracks[0].volume, -10);
  // Past the Out gain's +12, the rest goes on the faders
  const r = trimMix(p, 14);
  assert.equal(r.master.ott.outGain, 12);
  assert.equal(r.tracks[0].volume, -8);
});
