// Unit tests for sorting a sample pack (src/store/samplePack.ts): which drum a file is, loops,
// kits laid out pad by pad, an instrument's notes, what's left out and why. Run with `npm test`.
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
const p = await import('../src/store/samplePack.ts');
const f = (path, size = 1000) => ({ path, size });
const name = (files, i) => files[i].path.split('/').pop();

test('a file is the drum its name or folder says', () => {
  const cases = [
    ['Pack/Kicks/BD_01.wav', 'kick'], ['Pack/One Shots/Kick01.wav', 'kick'], ['Pack/Drums/HiHat 3.wav', 'closedHat'],
    ['Pack/Drums/OpenHat.wav', 'openHat'], ['Pack/Hats/OH_02.wav', 'openHat'], ['Pack/Drums/Snare Tight.wav', 'snare'],
    ['Pack/Claps/clap.wav', 'clap'], ['Pack/808s/808 Long C.wav', 'bass808'], ['Pack/Toms/Tom Low.wav', 'tomLow'],
    ['Pack/Perc/Conga Hi.wav', 'perc'], ['Pack/Cymbals/Crash 1.wav', 'crash'], ['Pack/Keys/Rhodes C3.wav', null],
    ['Pack/Drum Rack/thing.wav', null], ['Pack/FX/Riser 8 bars.wav', 'fx'],
    // The file's own word beats its folder's
    ['Pack/Kicks/Snare 2.wav', 'snare'],
    // Short names that are also words count only on their own, and an instrument's folder holds no drums
    ['Pack/Oh Yeah.wav', null], ['Pack/Vox/Oh Yeah.wav', null], ['Pack/Keys/Bell C4.wav', null], ['Pack/Sub Bass.wav', null],
    ['Pack/OH 2.wav', 'openHat'], ['Trap Bass Kit/Kicks/Kick 1.wav', 'kick'], ['Pack/BD_01.wav', 'kick'], ['Pack/Sub.wav', 'bass808'],
  ];
  for (const [path, role] of cases) assert.equal(p.drumRole(path), role, path);
});

test('loops are told from one-shots', () => {
  assert.ok(p.isLoop('Pack/Loops/Drum Loop 1.wav'));
  assert.ok(p.isLoop('Pack/Melody 140 BPM Am.wav'));
  assert.ok(p.isLoop('Pack/Breaks/Amen.wav'));
  assert.ok(!p.isLoop('Pack/Kicks/Kick 1.wav'));
  assert.ok(!p.isLoop('Pack/Kicks/Kick 808.wav'));
});

test('a pack becomes a kit, an instrument, loops and one-shots; every file goes somewhere once', () => {
  const files = [
    f('Trap Kit/Kicks/Kick 01.wav'), f('Trap Kit/Kicks/Kick 02.wav'), f('Trap Kit/Kicks/Kick 10.wav'),
    f('Trap Kit/Snares/Snare 01.wav'), f('Trap Kit/Hats/HH 01.wav'), f('Trap Kit/Hats/Open Hat 01.wav'),
    f('Trap Kit/Claps/Clap 01.wav'), f('Trap Kit/808s/808 C.wav'),
    f('Trap Kit/Keys/EP C2.wav'), f('Trap Kit/Keys/EP C3.wav'), f('Trap Kit/Keys/EP C4.wav'),
    f('Trap Kit/Loops/Drum Loop 140 BPM.wav'), f('Trap Kit/Vox/Hey.wav'), f('Trap Kit/readme.txt'), f('Trap Kit/Huge.wav', 9e9),
  ];
  const plan = p.planPack(files, { maxBytes: 50 * 1048576 });
  assert.equal(plan.kits.length, 1);
  assert.equal(plan.kits[0].name, 'Trap Kit');
  const pad = (i) => (plan.kits[0].pads[i] ? name(files, plan.kits[0].pads[i].file) : null);
  assert.equal(pad(0), 'Kick 01.wav'); // in name order: 01, 02, 10
  assert.equal(pad(1), 'Snare 01.wav');
  assert.equal(pad(2), 'Clap 01.wav');
  assert.equal(pad(4), 'HH 01.wav');
  assert.equal(pad(5), 'Open Hat 01.wav');
  assert.equal(pad(13), '808 C.wav');
  // Spare kicks fill the first empty pads
  assert.equal(pad(3), 'Kick 02.wav');
  assert.equal(pad(6), 'Kick 10.wav');
  assert.deepEqual(plan.instruments.map((i) => [i.name, i.files.map((x) => x.root)]), [['Keys', [36, 48, 60]]]);
  assert.deepEqual(plan.loops.map((i) => name(files, i)), ['Drum Loop 140 BPM.wav']);
  assert.deepEqual(plan.oneShots.map((i) => name(files, i)), ['Hey.wav']);
  assert.deepEqual(plan.skipped.map((s) => [name(files, s.file), s.reason]), [['readme.txt', 'not audio'], ['Huge.wav', 'too big']]);
  const placed = [...plan.kits.flatMap((k) => k.pads.filter(Boolean).map((x) => x.file)), ...plan.instruments.flatMap((i) => i.files.map((x) => x.file)), ...plan.loops, ...plan.oneShots, ...plan.skipped.map((s) => s.file)];
  assert.equal(new Set(placed).size, placed.length);
  assert.equal(placed.length, files.length);
});

test('a big pack: more kits, up to the limits, and what was left out is counted', () => {
  const many = [
    ...Array.from({ length: 40 }, (_, i) => f(`P/Kicks/Kick ${i}.wav`)),
    ...Array.from({ length: 40 }, (_, i) => f(`P/Snares/Snare ${i}.wav`)),
  ];
  const plan = p.planPack(many, { maxBytes: 1e9, maxKits: 2, maxFiles: 20 });
  assert.equal(plan.kits.length, 2);
  assert.equal(plan.kits.flatMap((k) => k.pads.filter(Boolean)).length, 20);
  const placed = [...plan.kits.flatMap((k) => k.pads.filter(Boolean).map((x) => x.file)), ...plan.loops, ...plan.oneShots, ...plan.skipped.map((s) => s.file)];
  assert.equal(new Set(placed).size, 80);
  // Without a budget: four kits of 16, and the rest as one-shots (at most two racks of them)
  const all = p.planPack(Array.from({ length: 200 }, (_, i) => f(`P/Kicks/Kick ${i}.wav`)), { maxBytes: 1e9 });
  assert.equal(all.kits.length, 4);
  assert.equal(all.oneShots.length, p.ONE_SHOT_PADS);
  assert.equal(all.skipped.length, 200 - 64 - p.ONE_SHOT_PADS);
});

test('two notes are not an instrument; a pack with no drums makes no kit', () => {
  const plan = p.planPack([f('Keys/EP C2.wav'), f('Keys/EP C3.wav'), f('Pads/Warm.wav')], { maxBytes: 1e9 });
  assert.equal(plan.instruments.length, 0);
  assert.equal(plan.kits.length, 0);
  assert.equal(plan.oneShots.length, 3);
  assert.equal(p.planPack([], { maxBytes: 1e9 }).kits.length, 0);
});
