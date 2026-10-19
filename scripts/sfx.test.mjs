// Unit tests for the sound effects maker and key detection (src/audio/sfx/sfxSynth.ts, src/store/songKey.ts). Run with `npm test`.
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

const { generateSfx, renderSfx, sfxLength, sfxWav, snapToScale, mutateSfx, varySfx, tuneSfx, parseSfx, fromParams, sfxFileName, SFX_CATEGORIES, SFX_GROUPS, SFX_SETS, SFX_LABELS, SFX_CEILING } = await import('../src/audio/sfx/sfxSynth.ts');
const { detectKey } = await import('../src/store/songKey.ts');
const { setSfxRecordings } = await import('../src/audio/sfx/sfxModern.ts');
const { SFX_RECORDING_SETS } = await import('../src/audio/sfx/sfxRecordingSets.ts');

// Stand-ins for the recordings (the app loads the real ones): a decaying noise burst per take, as
// long as the real one; a loop's take steady noise
const fakeTakes = new Map();
for (const [group, set] of Object.entries(SFX_RECORDING_SETS)) {
  set.seconds.forEach((sec, take) => {
    const n = Math.round(sec * 48000);
    const x = new Float32Array(n);
    let seed = (take + 1) * 2654435761 + group.length;
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      x[i] = ((seed / 2 ** 32) * 2 - 1) * (set.loop ? 0.5 : Math.exp((-6 * i) / n));
    }
    fakeTakes.set(`${group}/${take}`, { samples: x, sampleRate: 48000 });
  });
}
setSfxRecordings((g, t) => fakeTakes.get(`${g}/${t}`), (g) => SFX_RECORDING_SETS[g]?.takes ?? 0);

const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('every kind of sound renders: audible, never over -1 dBFS, no clicks at the ends, within its length', () => {
  for (const c of SFX_CATEGORIES) {
    for (const seed of [1, 2, 3]) {
      const s = generateSfx(c, seed);
      const x = renderSfx(s, 44100);
      assert.ok(x.every(Number.isFinite), `${c} finite`);
      assert.ok(peakOf(x) <= SFX_CEILING + 1e-6, `${c} peak ${peakOf(x)}`);
      assert.ok(peakOf(x) > 0.05, `${c} audible`);
      assert.ok(x.length <= Math.round(sfxLength(s) * 44100) + 1, `${c} length`);
      if (!s.loop) assert.ok(Math.abs(x[0]) < 1e-6 && Math.abs(x[x.length - 1]) < 1e-6, `${c} ends`);
    }
  }
});

test('every kind has a label, a group, and the sets only use real kinds', () => {
  for (const c of SFX_CATEGORIES) assert.ok(SFX_LABELS[c], c);
  assert.equal(new Set(SFX_CATEGORIES).size, SFX_CATEGORIES.length);
  assert.equal(SFX_GROUPS.reduce((n, g) => n + g.kinds.length, 0), SFX_CATEGORIES.length);
  for (const set of SFX_SETS) for (const k of set.kinds) assert.ok(SFX_CATEGORIES.includes(k), `${set.id}: ${k}`);
});

test('a loop is exactly its length and joins up without a jump', () => {
  for (const c of ['wind', 'engineHum', 'alarm', 'rain']) {
    const s = generateSfx(c, 5);
    assert.ok(s.loop);
    const x = renderSfx(s, 44100);
    assert.equal(x.length, Math.round(s.loopLength * 44100));
    // The step from the last sample to the first is no bigger than the sound's usual steps
    let typical = 0;
    for (let i = 1; i < x.length; i++) typical = Math.max(typical, Math.abs(x[i] - x[i - 1]));
    assert.ok(Math.abs(x[0] - x[x.length - 1]) <= typical + 1e-6, c);
  }
});

test('the same seed makes the same sound; a new seed a different one; a set shares its style', () => {
  assert.deepEqual(renderSfx(generateSfx('explosion', 9)), renderSfx(generateSfx('explosion', 9)));
  assert.notDeepEqual(generateSfx('coin', 1), generateSfx('coin', 2));
  const m = mutateSfx(generateSfx('laser', 4), 5);
  assert.equal(m.layers[0].wave, generateSfx('laser', 4).layers[0].wave);
  // UI sounds of one set use the same tone
  const a = generateSfx('uiHover', 11, 99);
  const b = generateSfx('uiConfirm', 12, 99);
  assert.equal(a.layers[0].wave, b.layers[0].wave);
});

test('variations: the first is the sound itself, the rest differ a little', () => {
  const s = generateSfx('footstep', 3);
  assert.deepEqual(varySfx(s, 0), s);
  const v = varySfx(s, 2, 1);
  assert.notDeepEqual(v, s);
  assert.ok(Math.abs(v.pitch - s.pitch) <= 1);
  assert.notDeepEqual(renderSfx(v), renderSfx(s));
});

test('tune to key puts pitched layers and their notes in the key', () => {
  const cMajor = [0, 2, 4, 5, 7, 9, 11];
  const s = tuneSfx(generateSfx('levelUp', 8), 0, cMajor);
  for (const l of s.layers) {
    const midi = 69 + 12 * Math.log2(l.freq / 440);
    assert.ok(Math.abs(midi - Math.round(midi)) < 1e-6);
    for (const n of l.seq) assert.ok(cMajor.includes((((Math.round(midi) + n) % 12) + 12) % 12), `note ${n}`);
  }
});

test('a WAV file of the sound; a loop carries its loop points', () => {
  const x = renderSfx(generateSfx('blip', 3));
  const wav = sfxWav(x, 44100);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(wav.length, 44 + x.length * 2);
  const looped = sfxWav(x, 44100, true);
  assert.equal(String.fromCharCode(...looped.slice(44 + x.length * 2, 48 + x.length * 2)), 'smpl');
});

test('saved sounds read back; old one-layer settings still open; nonsense does not', () => {
  const s = generateSfx('spell', 4);
  assert.deepEqual(parseSfx(JSON.parse(JSON.stringify(s))), s);
  const old = { wave: 'square', freq: 500, slide: 3, curve: 0.5, arp: 0, arpAt: 0.3, vibDepth: 0, vibRate: 6, duty: 0.5, attack: 0, hold: 0.05, decay: 0.2, punch: 0, lowpass: 20000, lpSweep: 0, highpass: 20, crush: 0, repeat: 0, volume: 0.8, seed: 3 };
  assert.equal(parseSfx(old).layers.length, 1);
  assert.deepEqual(parseSfx(old).layers[0], fromParams(old).layers[0]);
  assert.equal(parseSfx(null), null);
  assert.equal(parseSfx({ layers: [] }), null);
});

test('file names for games', () => {
  assert.equal(sfxFileName('Open menu', 2), 'open_menu_02');
  assert.equal(sfxFileName('  Sword hit!! '), 'sword_hit');
  assert.equal(sfxFileName('***'), 'sound');
});

test('snapping to a scale', () => {
  // 450 Hz is nearest A4 (440); in C major A is in the scale
  assert.ok(Math.abs(snapToScale(450, 0, [0, 2, 4, 5, 7, 9, 11]) - 440) < 1e-9);
  // 466 Hz (A#4) is not in C major: A4 or B4
  const s = snapToScale(466.16, 0, [0, 2, 4, 5, 7, 9, 11]);
  assert.ok(Math.abs(s - 440) < 1e-6 || Math.abs(s - 493.88) < 0.01);
});

test('key detection from notes', () => {
  const tracks = [{ id: 't', instrumentKey: 'piano' }, { id: 'd', instrumentKey: 'drums' }];
  const notes = (names) => names.map((note, i) => ({ id: 'n' + i, note, startOffset: i * 0.25, duration: '4n', velocity: 0.8 }));
  const clip = (trackId, names) => ({ id: 'c' + trackId, trackId, name: 'c', startBar: 1, lengthBars: 4, isSelected: false, notes: notes(names) });
  // A minor: A C E, D F A, E G# B, A C E
  const am = detectKey([clip('t', ['A2', 'C4', 'E4', 'A4', 'D3', 'F4', 'A4', 'E3', 'G#4', 'B4', 'A2', 'C4', 'E4', 'A3']), clip('d', ['C1', 'C1', 'C1'])], tracks);
  assert.equal(am.name, 'A minor');
  const g = detectKey([clip('t', ['G2', 'B3', 'D4', 'G4', 'C3', 'E4', 'G4', 'D3', 'F#4', 'A4', 'G2', 'B3', 'D4'])], tracks);
  assert.equal(g.name, 'G major');
  assert.equal(detectKey([clip('d', ['C1'])], tracks), null);
});

test('sounds made before the modern engine (and every classic sound) render exactly as they did', async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/sfx-classic.json', import.meta.url), 'utf8'));
  assert.ok(fixtures.length > 100);
  for (const f of fixtures) {
    const x = renderSfx(f.sound, 22050);
    const h = createHash('sha256').update(Buffer.from(Int32Array.from(x, (v) => Math.round(v * 1e5)).buffer)).digest('hex').slice(0, 16);
    assert.equal(`${f.category} ${x.length} ${h}`, `${f.category} ${f.length} ${f.hash}`);
  }
});

test('the modern engine: every kind but Retro is modern, renders stereo, joins its loops on both sides', async () => {
  const { renderSfxStereo, sfxWavChannels } = await import('../src/audio/sfx/sfxSynth.ts');
  const retro = new Set(SFX_GROUPS.find((g) => g.name === 'Retro').kinds);
  for (const c of SFX_CATEGORIES) {
    const s = generateSfx(c, 4);
    assert.equal(!!s.modern, !retro.has(c), c);
    const ch = renderSfxStereo(s, 32000);
    assert.equal(ch.length, s.modern ? 2 : 1, c);
    for (const x of ch) {
      assert.ok(x.every(Number.isFinite), `${c} finite`);
      assert.ok(peakOf(x) <= SFX_CEILING + 1e-6, `${c} peak`);
    }
    if (s.modern && s.loop) {
      for (const x of ch) {
        let typical = 0;
        for (let i = 1; i < x.length; i++) typical = Math.max(typical, Math.abs(x[i] - x[i - 1]));
        assert.ok(Math.abs(x[0] - x[x.length - 1]) <= typical + 1e-6, `${c} loop joins`);
      }
    }
  }
  // A stereo 24-bit file
  const wav = sfxWavChannels(renderSfxStereo(generateSfx('gem', 2), 48000), 48000, false, 24);
  const view = new DataView(wav.buffer);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint16(34, true), 24);
});

test('a struck body rings on after the strike; a moving layer moves', async () => {
  const { renderSfxStereo } = await import('../src/audio/sfx/sfxSynth.ts');
  const strike = (body) => ({ ...generateSfx('uiNotify', 1), layers: [{ ...generateSfx('uiNotify', 1).layers[0], wave: 'pink', hold: 0, decay: 0.005, freq: 800, delay: 0, body: undefined, ...(body ? { body: 'metal', ring: 1, bodyMix: 0.9 } : {}) }], reverb: 0, echo: 0 });
  assert.ok(renderSfxStereo(strike(true), 32000)[0].length > 10 * renderSfxStereo(strike(false), 32000)[0].length);
  const pass = { ...generateSfx('uiSwipe', 1), reverb: 0 };
  pass.layers = pass.layers.map((l) => ({ ...l, width: 0, pan: -1, panTo: 1 }));
  const [L, R] = renderSfxStereo(pass, 32000);
  const energy = (x, from, to) => x.slice(from, to).reduce((e, v) => e + v * v, 0);
  const half = L.length >> 1;
  assert.ok(energy(L, 0, half) > energy(R, 0, half));
  assert.ok(energy(R, half, L.length) > energy(L, half, L.length));
});
