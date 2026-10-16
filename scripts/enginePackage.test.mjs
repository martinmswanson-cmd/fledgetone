// Unit tests for the FMOD / Wwise package scripts (src/audio/enginePackage.ts). Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier.endsWith('?raw')) return { url: 'data:text/javascript,export default ""', shortCircuit: true };
  try { return await next(specifier, context); } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  } }`)
);
const { fmodScript, wwiseScript, engineReadme, stateLayout } = await import('../src/audio/engineScripts.ts');

const manifest = {
  format: 'fledgetone-audio-manifest', version: 2, name: "Hero's \"Boss\" Theme", bpm: 120, timeSignature: [4, 4], beatsPerBar: 4, sampleRate: 48000, key: 'A minor',
  intensity: { default: 1, groups: [{ name: 'Percussion', curve: [[0, 0], [0.5, 1], [1, 1]] }, { name: 'Main', curve: [[0, 1], [1, 1]] }] },
  states: [
    { name: 'Explore', file: 'states/Explore.wav', bars: 8, seconds: 16, samples: 768000, stems: [{ group: 'Percussion', file: 'stems/Explore/Percussion.wav', tracks: ['Drums'] }, { group: 'Main', file: 'stems/Explore/Main.wav', tracks: ['Bass'] }] },
    { name: 'Combat', file: 'states/Combat.wav', bars: 4, seconds: 8, samples: 384000, stems: [{ group: 'Percussion', file: 'stems/Combat/Percussion.wav', tracks: ['Drums'] }, { group: 'Main', file: 'stems/Combat/Main.wav', tracks: ['Bass'] }] },
  ],
  transitions: [{ from: '*', to: 'Combat', kind: 'stinger', quantize: 'bar', stinger: 'Danger' }],
  stingers: [{ name: 'Danger', kind: 'danger', label: 'Danger', file: 'stingers/Danger.wav', quantize: 'beat', bridgeBars: 1 }],
};

test('states are laid end to end with a bar between', () => {
  assert.deepEqual(stateLayout(manifest), [
    { name: 'Explore', start: 0, length: 16, bpm: 120, num: 4, den: 4 },
    { name: 'Combat', start: 18, length: 8, bpm: 120, num: 4, den: 4 },
  ]);
});

test('the FMOD script is valid JavaScript and carries the song', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fmod-'));
  const file = join(dir, 'script.js');
  writeFileSync(file, fmodScript(manifest));
  execFileSync(process.execPath, ['--check', file]);
  // Run it against a stand-in Studio that records what it was asked to do
  const calls = [];
  const obj = (kind) => new Proxy({ kind }, { get: (t, p) => (p in t ? t[p] : () => { calls.push(`${kind}.${String(p)}`); return obj(String(p)); }), set: (t, p, v) => { t[p] = v; return true; } });
  const studio = {
    menu: { addMenuItem: (item) => { studio.item = item; } },
    system: { getText: () => '/audio', message: () => {} },
    project: { workspace: { addEvent: () => obj('event'), masterEventFolder: {} }, create: (k) => obj(k), importAudioFile: (p) => { calls.push(`import ${p}`); return { length: 1 }; }, parameterType: { User: 0 } },
  };
  new Function('studio', 'console', require_(file))(studio, { log: () => {} });
  assert.match(studio.item.name, /Import "Hero's "Boss" Theme"/);
  studio.item.execute();
  assert.ok(calls.includes('import /audio/stems/Explore/Percussion.wav'));
  assert.ok(calls.includes('import /audio/stingers/Danger.wav'));
  assert.ok(calls.filter((c) => c === 'addGroupTrack.addSound').length >= 4);
});

test('the Wwise script compiles as Python', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wwise-'));
  const file = join(dir, 'import.py');
  writeFileSync(file, wwiseScript(manifest));
  execFileSync('python3', ['-m', 'py_compile', file]);
  // Its data reads back as the song
  const src = wwiseScript(manifest);
  const literal = src.match(/DATA = json\.loads\((".*")\)/)[1];
  const data = JSON.parse(JSON.parse(literal));
  assert.equal(data.name, "Hero's \"Boss\" Theme");
  assert.deepEqual(data.states[1].tracks.map((t) => t.file), ['stems/Combat/Percussion.wav', 'stems/Combat/Main.wav']);
});

test('the README lists the states, transitions and curves', () => {
  const r = engineReadme(manifest, 'both');
  assert.match(r, /\| Combat \| 4 \| 8\.000 \| 120 BPM \| 4\/4 \| 18\.000 s \|/);
  assert.match(r, /Any state → Combat: stinger \(stinger Danger\)/);
  assert.match(r, /\*\*Percussion\*\*: 0% → silent, 50% → 0\.0 dB/);
});

function require_(file) {
  return execFileSync('cat', [file]).toString();
}
