// The Glide Pad (src/audio/presets/glidePad.ts): in the catalog with a plain name among the keys and
// synths, a pad that glides between chords (and bends, and plays from a pool of voices), its own
// room the same every time, wide (another noise in each ear) and with no click at its start; and
// the build into a peak's pad is now a Glide Pad gliding its chords. Run with `npm test`.
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
const { INSTRUMENTS, INSTRUMENT_KEYS } = await import('../src/audio/instrumentCatalog.ts');
const G = await import('../src/store/chordGlide.ts');
const { bendSupport } = await import('../src/store/slides.ts');
const { VOICE_POOL_INSTRUMENTS } = await import('../src/audio/noteMemory.ts');
const { partKind } = await import('../src/store/partKind.ts');
const R = await import('../src/audio/presets/glidePadRoom.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the Glide Pad is in the catalog: a plain name, keys and synths, a pad', () => {
  const d = INSTRUMENTS.glidePad;
  assert.ok(INSTRUMENT_KEYS.includes('glidePad'));
  assert.equal(d.name, 'Glide Pad');
  assert.equal(d.blurb, 'Soft, wide, dark pad that glides between chords');
  assert.equal(d.category, 'Keys & Synths');
  assert.equal(d.kind, 'synth');
  assert.deepEqual(d.range, [36, 88]);
  assert.ok(Array.isArray(d.taper));
  assert.equal(partKind('glidePad'), 'pad');
  // (no other instrument has its name)
  assert.equal(Object.values(INSTRUMENTS).filter((i) => i.name === 'Glide Pad').length, 1);
});

test('it glides between chords, bends, and plays from a pool of voices', () => {
  assert.ok(G.chordGlideSupport({ instrumentKey: 'glidePad' }));
  assert.equal(bendSupport({ instrumentKey: 'glidePad' }, 'synth'), 'yes');
  assert.ok(VOICE_POOL_INSTRUMENTS.has('glidePad'));
  assert.match(G.glideNotHere('Pluck'), /Glide Pad, Wavetable, Keys and Brass glide/);
  // Its instrument has the voice that glides (as Wavetable, Keys and Brass do: poly())
  const inst = src('src/audio/instruments.ts');
  assert.match(inst.slice(inst.indexOf("case 'glidePad'")), /return poly\(pad,/);
  const pad = src('src/audio/presets/glidePad.ts');
  assert.match(pad, /glide: \(note: string, time: number, velocity: number\): VoiceControl \| null/);
});

test('its room: the same every time, another noise in each ear, each ear’s energy 1, no click at its start, dying away', () => {
  const a = R.darkRoomChannels(44100);
  const b = R.darkRoomChannels(44100);
  assert.equal(a[0].length, Math.round(R.ROOM_SECONDS * 44100));
  assert.ok(a[0].every((v, i) => v === b[0][i]) && a[1].every((v, i) => v === b[1][i]));
  for (const ch of a) {
    let e = 0;
    for (const v of ch) e += v * v;
    assert.ok(Math.abs(e - 1) < 1e-4, `energy ${e}`);
    // (its first sample silent, the first 5 ms fading in)
    assert.ok(Math.abs(ch[0]) === 0);
  }
  let lr = 0;
  for (let i = 0; i < a[0].length; i++) lr += a[0][i] * a[1][i];
  assert.ok(Math.abs(lr) < 0.05, `the ears alike by ${lr}`);
  // its last half second about 50 dB under its first
  const rms = (x, s, e) => Math.sqrt(x.subarray(s, e).reduce((t, v) => t + v * v, 0) / (e - s));
  const fall = 20 * Math.log10(rms(a[0], 0.01 * 44100, 0.5 * 44100) / rms(a[0], 3 * 44100, 3.5 * 44100));
  assert.ok(fall > 25, `${fall} dB`);
  // another rate: the same length in seconds
  assert.equal(R.darkRoomChannels(48000)[0].length, Math.round(R.ROOM_SECONDS * 48000));
});

test('the build into a peak: its pad is a Glide Pad, gliding its chords', async () => {
  const C = src('src/store/chillsActions.ts');
  assert.match(C, /export const PEAK_PAD = 'glidePad' as const;/);
  assert.match(C, /makeTrack\(PEAK_PAD, made, 'Peak pad'\)/);
  assert.match(C, /glide: \{ ms: PEAK_PAD_GLIDE_MS \}/);
});
