// Game parameters (src/store/gameParams.ts): targets over their windows, how several combine,
// presets, and reading them back from a file. The players (adaptive-music.js) do the same sums.
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
const { cleanTarget, freeParamName, OPEN_FILTER, paramFromPreset, paramMix, parseGameParams, targetValue } = await import('../src/store/gameParams.ts');
const { AdaptiveMusic } = await import('../src/gameKit/adaptive-music.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('a target holds its ends outside its window and moves through it', () => {
  const t = { kind: 'volume', from: 0.25, to: 0.75, start: 1, end: 0.5 };
  near(targetValue(t, 0), 1);
  near(targetValue(t, 0.25), 1);
  near(targetValue(t, 0.5), 0.75);
  near(targetValue(t, 1), 0.5);
  // A window given backwards acts the same
  near(targetValue({ ...t, from: 0.75, to: 0.25 }, 0.5), 0.75);
});

test('a filter moves evenly in pitch', () => {
  const t = { kind: 'filter', from: 0, to: 1, start: 20000, end: 625 };
  near(targetValue(t, 0.5), Math.sqrt(20000 * 625), 1e-6);
  near(targetValue(t, 1), 625);
});

test('several parameters: highest intensity and reverb, lowest filter, volumes and layers multiply', () => {
  const mix = paramMix([
    { value: 1, targets: [{ kind: 'intensity', from: 0, to: 1, start: 0, end: 0.6 }, { kind: 'volume', from: 0, to: 1, start: 1, end: 0.5 }, { kind: 'layer', group: 'Drums', from: 0, to: 1, start: 1, end: 0.5 }] },
    { value: 1, targets: [{ kind: 'intensity', from: 0, to: 1, start: 0, end: 0.9 }, { kind: 'filter', from: 0, to: 1, start: OPEN_FILTER, end: 900 }, { kind: 'volume', from: 0, to: 1, start: 1, end: 0.5 }, { kind: 'layer', group: 'Drums', from: 0, to: 1, start: 1, end: 0.5 }] },
    { value: 0, targets: [{ kind: 'reverb', from: 0, to: 1, start: 0.3, end: 0.8 }, { kind: 'filter', from: 0, to: 1, start: 4000, end: 100 }] },
  ]);
  near(mix.intensity, 0.9);
  near(mix.filter, 900);
  near(mix.reverb, 0.3);
  near(mix.volume, 0.25);
  near(mix.layers.Drums, 0.25);
  assert.equal(paramMix([]).intensity, null);
});

test('presets: health starts full and only acts below half; tension brings the groups in one by one', () => {
  const health = paramFromPreset('health', []);
  assert.equal(health.value, 1);
  near(paramMix([health]).filter, OPEN_FILTER);
  assert.ok(paramMix([{ ...health, value: 0.1 }]).filter < 3000);
  const tension = paramFromPreset('tension', ['Ambient', 'Percussion', 'Tension', 'Climax']);
  assert.deepEqual(tension.targets.map((t) => t.group), ['Percussion', 'Tension', 'Climax']);
  const mid = paramMix([{ ...tension, value: 0.5 }]);
  near(mid.layers.Percussion, 1);
  near(mid.layers.Climax, 0);
  // With no groups it moves the intensity instead
  assert.equal(paramFromPreset('tension', []).targets[0].kind, 'intensity');
});

test('names are game-safe and unique', () => {
  assert.equal(freeParamName(' Danger level! ', []), 'Danger_level');
  assert.equal(freeParamName('danger', [{ name: 'danger' }]), 'danger_2');
  assert.equal(freeParamName('', []), 'parameter');
});

test('targets are kept in range, and files read back', () => {
  assert.deepEqual(cleanTarget({ kind: 'filter', from: -1, to: 2, start: 5, end: 99999 }), { kind: 'filter', from: 0, to: 1, start: 60, end: OPEN_FILTER });
  const read = parseGameParams([
    { name: 'danger', value: 0.4, targets: [{ kind: 'intensity', from: 0, to: 1, start: 0, end: 1 }, { kind: 'bogus' }, { kind: 'layer' }] },
    { name: 'danger', targets: [] },
    'nonsense',
  ]);
  assert.equal(read.length, 2);
  assert.equal(read[0].targets.length, 1);
  assert.equal(read[1].name, 'danger_2');
});

test('the web player does the same sums as the app', () => {
  const params = [paramFromPreset('depth', []), { ...paramFromPreset('distance', []), value: 0.6 }];
  const manifest = { states: [], stingers: [], intensity: { default: 1, groups: [] }, parameters: params.map((p) => ({ name: p.name, default: p.value, targets: p.targets.map((t) => ({ target: t.kind, from: t.from, to: t.to, start: t.start, end: t.end })) })) };
  // A stand-in audio context: the sums don't need sound
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect: (n) => n, gain: param(), frequency: param(), Q: param(), type: '', buffer: null });
  const ctx = { currentTime: 0, sampleRate: 8000, destination: node(), createGain: node, createBiquadFilter: node, createConvolver: node, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) };
  const music = new AdaptiveMusic(ctx);
  music.loadFrom(manifest, new Map());
  music.params.set('depth', 0.3);
  const want = paramMix([{ ...params[0], value: 0.3 }, params[1]]);
  const got = music.mix();
  near(got.filter, want.filter, 1e-3);
  near(got.reverb, want.reverb);
  near(got.volume, want.volume);
});
