// Unit tests for the Drum Rack and Multi Sampler settings (src/store/sampleKits.ts). Run with `npm test`.
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
const k = await import('../src/store/sampleKits.ts');

test('pads sit on C2 up and are read back tidy', () => {
  assert.equal(k.padNote(0), 'C2');
  assert.equal(k.padNote(15), 'D#3');
  assert.equal(k.padOfNote('C2'), 0);
  assert.equal(k.padOfNote('E3'), -1);
  const rack = k.normalizeRack({ pads: [{ name: 'Kick', soundId: 'a', gain: 99, pitch: -40, choke: 3.4, reverse: true }, 'junk'] });
  assert.equal(rack.pads.length, 16);
  assert.deepEqual(rack.pads[0], { name: 'Kick', soundId: 'a', gain: 12, pan: 0, pitch: -24, decay: 0, lowpass: 20000, highpass: 20, drive: 0, choke: 3, reverse: true });
  assert.equal(rack.pads[1].name, 'Pad 2');
  assert.equal(k.normalizeRack({}), undefined);
});

test('a sample file name says its note and loudness', () => {
  assert.equal(k.rootFromName('Piano_C4.wav'), 60);
  assert.equal(k.rootFromName('strings A#2 mf.flac'), 46);
  assert.equal(k.rootFromName('bass-Eb1'), 27);
  assert.ok(Number.isNaN(k.rootFromName('kick.wav')));
  assert.ok(Number.isNaN(k.rootFromName('Abc.wav')));
  assert.equal(k.velocityRank('Piano C4 pp.wav'), 1);
  assert.equal(k.velocityRank('Piano C4 ff.wav'), 6);
  assert.equal(k.velocityRank('Piano C4 f.wav'), 5);
  assert.ok(Number.isNaN(k.velocityRank('Piano C4.wav')));
});

test('sounds are laid across the keys by root, same roots becoming velocity layers', () => {
  const zones = k.mapZones([
    { soundId: 'c3', name: 'P C3', root: 48 },
    { soundId: 'c4p', name: 'P C4 pp', root: 60 },
    { soundId: 'c4f', name: 'P C4 ff', root: 60 },
    { soundId: 'c5', name: 'P C5', root: 72 },
  ]);
  const c3 = zones.find((z) => z.soundId === 'c3');
  assert.deepEqual([c3.lo, c3.hi], [21, 54]);
  const soft = zones.find((z) => z.soundId === 'c4p');
  const hard = zones.find((z) => z.soundId === 'c4f');
  assert.deepEqual([soft.lo, soft.hi, soft.velLo, soft.velHi], [55, 66, 1, 64]);
  assert.deepEqual([hard.velLo, hard.velHi], [65, 127]);
  assert.equal(zones.find((z) => z.soundId === 'c5').hi, 108);
  assert.equal(k.zoneFor(zones, 61, 0.2).soundId, 'c4p');
  assert.equal(k.zoneFor(zones, 61, 0.9).soundId, 'c4f');
  assert.equal(k.zoneFor(zones, 30, 0.5).soundId, 'c3');
  // Outside every range: the nearest root
  assert.equal(k.zoneFor(zones, 120, 0.5).soundId, 'c5');
});
