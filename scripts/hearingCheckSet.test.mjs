// Tests for the reading check's made sounds (scripts/audio-check/hearing/make.mjs and expected.json):
// make.mjs writes exactly the files expected.json lists, and the sound report of each one already
// holds the property planted in it, so the measures are pinned before any agent is asked to read them.
// Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

const { hearingOf } = await import('../src/audio/hearing/hearingOf.ts');
const { compareSound } = await import('../src/audio/hearing/compareSound.ts');

const here = new URL('./audio-check/hearing/', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('expected.json', here), 'utf8'));
const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

/** A 24-bit PCM WAV's channels, as make.mjs writes them. */
function readWav24(path) {
  const buf = readFileSync(path);
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF');
  let at = 12;
  let fmt;
  while (at + 8 <= buf.length) {
    const id = buf.toString('latin1', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    if (id === 'data') {
      assert.deepEqual([fmt.rate, fmt.bits], [48000, 24], `${path}: 48 kHz, 24-bit`);
      const frames = size / (3 * fmt.channels);
      const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++)
        for (let c = 0; c < fmt.channels; c++) channels[c][i] = buf.readIntLE(at + 8 + 3 * (i * fmt.channels + c), 3) / 8388608;
      return channels;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error(`${path} has no data`);
}

const out = mkdtempSync(join(tmpdir(), 'fledgetone-check-set-'));
execFileSync(process.execPath, [new URL('make.mjs', here).pathname, out]);
const sounds = new Map();
const soundOf = (e) => {
  if (!sounds.has(e.file)) sounds.set(e.file, hearingOf(readWav24(join(out, e.file)), 48000, { engine: 't', tempoBpm: e.bpm }).sound);
  return sounds.get(e.file);
};
test.after(() => rmSync(out, { recursive: true, force: true }));

test('make.mjs writes every file expected.json lists, and no others', () => {
  const listed = expected.sounds.map((e) => e.file).sort();
  assert.deepEqual(readdirSync(out).sort(), listed);
  for (const e of expected.sounds) {
    assert.ok(['alone', 'pair'].includes(e.read), `${e.file}: read alone or as a pair`);
    assert.ok(e.planted && e.find, `${e.file}: says what was planted and what is to be found`);
    if (e.read === 'pair' && e.against !== null) assert.ok(listed.includes(e.against), `${e.file} is read against a made file`);
    const channels = readWav24(join(out, e.file));
    assert.equal(channels[0].length, 8 * 48000, `${e.file}: 8 seconds`);
  }
});

const checks = {
  clean: (r) => {
    assert.equal(r.faults.length, 0, JSON.stringify(r.faults));
    assert.ok(r.tone.peaks.length <= 2, JSON.stringify(r.tone.peaks));
  },
  click: (r, e) => {
    const clicks = r.faults.filter((f) => f.kind === 'click');
    assert.equal(clicks.length, 1, JSON.stringify(r.faults));
    near(clicks[0].seconds, e.value, 0.002, 'the click');
  },
  resonance: (r, e) => {
    assert.ok(r.tone.peaks.length > 0, 'a peak');
    near(Math.log2(r.tone.peaks[0].hz / e.value), 0, 1 / 12, 'the peak, octaves from 3 kHz');
  },
  wobble: (r, e) => {
    const low = r.movement.modulations.find((m) => m.band === 'low');
    assert.ok(low, JSON.stringify(r.movement.modulations));
    near(low.hz, e.value, 0.2, 'the low band wobble');
  },
  pump: (r) => assert.ok(r.words.some((w) => /^The mid band dips and returns on the beat \(\d+\.\d dB\): sidechain pumping and parts played on the beat both read this way\.$/.test(w)), r.words.join('\n')),
  'side-band': (r) => {
    const width = (name) => r.stereo.width.find((w) => w.name.startsWith(name)).db;
    assert.ok(width('presence') >= width('mids') + 10, JSON.stringify(r.stereo.width));
  },
  clipping: (r) => assert.ok(r.faults.some((f) => f.kind === 'clipping'), JSON.stringify(r.faults)),
  hum: (r, e) => assert.ok(r.faults.some((f) => f.kind === 'hum' && f.value === e.value), JSON.stringify(r.faults)),
};

for (const e of expected.sounds.filter((x) => x.read === 'alone'))
  test(`${e.file}: the report holds ${e.property}`, () => {
    assert.ok(checks[e.property], `a check for ${e.property}`);
    checks[e.property](soundOf(e), e);
  });

test('bright.wav against dull.wav: the first difference is in tone', () => {
  const c = compareSound(soundOf({ file: 'dull.wav' }), soundOf({ file: 'bright.wav' }), { a: 'dull.wav', b: 'bright.wav' });
  assert.equal(c.differences[0].group, 'tone', JSON.stringify(c.differences.slice(0, 3)));
});

test('distorted-bass.wav against clean-bass.wav: roughness or flat tops rise', () => {
  const c = compareSound(soundOf({ file: 'clean-bass.wav' }), soundOf({ file: 'distorted-bass.wav' }), { a: 'clean-bass.wav', b: 'distorted-bass.wav' });
  assert.ok(
    c.differences.some((d) => /roughness|flat tops/i.test(d.measure) && d.change > 0),
    JSON.stringify(c.differences.map((d) => [d.measure, d.change]))
  );
});
