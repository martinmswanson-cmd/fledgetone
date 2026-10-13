// The recordings hosted with the app (public/bos-beat-box-samples): every file an instrument asks
// for is there, and every note has each loudness layer and take. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const hosted = Object.values(INSTRUMENTS).filter((d) => d.samples?.baseUrl.startsWith('bos-beat-box-samples/'));

test('the real instruments are hosted with the app', () => {
  assert.deepEqual(hosted.map((d) => d.key).sort(), ['realCello', 'realCelloShort', 'realCrunchGuitar', 'realGuitar', 'realHollowGuitar', 'realLeadGuitar']);
});

test('every hosted recording an instrument plays is in public/', () => {
  const used = new Set();
  for (const def of hosted) {
    const { baseUrl, fallbackUrl, samples } = def.samples;
    assert.ok(fallbackUrl?.endsWith(baseUrl), `${def.key}: the site fallback mirrors the folder`);
    for (const file of Object.values(samples)) {
      assert.ok(existsSync(join(PUBLIC, baseUrl, file)), `${def.key}: ${baseUrl}${file} is missing`);
      used.add(baseUrl + file);
    }
  }
  // Nothing hosted that no instrument plays
  for (const folder of readdirSync(join(PUBLIC, 'bos-beat-box-samples'), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const file of readdirSync(join(PUBLIC, 'bos-beat-box-samples', folder.name)).filter((f) => f.endsWith('.mp3'))) {
      assert.ok(used.has(`bos-beat-box-samples/${folder.name}/${file}`), `${folder.name}/${file} is hosted but unused`);
    }
  }
});

test('each note has every loudness layer and take, layers rising to full velocity', () => {
  for (const def of hosted) {
    const { layers, samples } = def.samples;
    assert.ok(layers.length >= 2 && layers.at(-1) === 1, def.key);
    for (let i = 1; i < layers.length; i++) assert.ok(layers[i] > layers[i - 1], def.key);
    const byNote = new Map();
    for (const name of Object.keys(samples)) {
      const [note, l, t] = name.split('|');
      assert.ok(Number(l) < layers.length, `${def.key} ${name}`);
      byNote.set(note, [...(byNote.get(note) ?? []), `${l}|${t}`]);
    }
    const shapes = new Set([...byNote.values()].map((v) => v.sort().join()));
    assert.equal(shapes.size, 1, `${def.key}: every note has the same layers and takes`);
    const [lo, hi] = def.range;
    const midis = [...byNote.keys()].map((n) => {
      const m = n.match(/^([A-G]#?)(-?\d)$/);
      return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(m[1]) + 12 * (Number(m[2]) + 1);
    });
    // No note in the playable range is more than 2 semitones from a recording
    for (let m = lo; m <= hi; m++) assert.ok(Math.min(...midis.map((r) => Math.abs(r - m))) <= 2, `${def.key}: ${m} is far from any recording`);
  }
});
