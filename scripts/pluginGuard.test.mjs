// The built-in plugin processor's safety (processor.ts): a plugin that plays NaN or blows up never
// reaches the track (its output is silenced and it starts again, saying so once); the Mutable
// Instruments plugins each have memory of their own, so one never plays what another left behind;
// and the parameters kept in their safe range (paramLimits.ts) are clamped only past it. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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

const { BUILTIN_PROCESSOR_SOURCE, BLOWN_UP } = await import('../src/audio/plugins/processor.ts');
const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');
const { PARAM_LIMITS, OWN_MEMORY_FAMILIES } = await import('../src/audio/plugins/paramLimits.ts');

const sr = 48000;
const scope = { sampleRate: sr, currentFrame: 0 };
const sent = [];
let Proc;
const src = BUILTIN_PROCESSOR_SOURCE.replace(/\bcurrentFrame\b/g, 'scope.currentFrame');
new Function('scope', 'sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'console', src)(
  scope,
  sr,
  class {
    constructor() {
      this.port = { postMessage: (m) => sent.push(m) };
    }
  },
  (_, c) => (Proc = c),
  { log() {} }
);
const modules = new Map();
const family = (name) => PLUGIN_FAMILIES.find((f) => f.family === name);
const moduleOf = (name) => {
  if (!modules.has(name)) modules.set(name, new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${family(name).file}`, import.meta.url))));
  return modules.get(name);
};
/** A plugin as builtinHost makes it (its family's memory rule and its limits), unless `opts` says otherwise */
const make = (fam, name, opts = {}) => {
  sent.length = 0;
  const index = family(fam).plugins.findIndex((p) => p.name === name);
  assert.ok(index >= 0, name);
  const p = new Proc({
    processorOptions: { family: fam, module: moduleOf(fam), index, ownMemory: OWN_MEMORY_FAMILIES.has(fam), limits: PARAM_LIMITS[`builtin:${fam}/${name}`] ?? null, ...opts },
  });
  const ready = sent.find((m) => m.type === 'ready');
  assert.ok(ready, `${name} started`);
  return { p, ready };
};
/** Play `seconds` of it (a tone in, for an effect), notes held from the start; the output's peak and any non-finite sample */
const play = (p, seconds, { notes = [], input = false } = {}) => {
  if (notes.length) p.message({ type: 'events', events: notes.map((n) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x90, n, 110] } })) });
  let peak = 0;
  let bad = false;
  for (let b = 0; b < (seconds * sr) / 128; b++) {
    const out = [new Float32Array(128), new Float32Array(128)];
    const tone = input ? Float32Array.from({ length: 128 }, (_, k) => 0.25 * Math.sin((2 * Math.PI * 220 * (scope.currentFrame + k)) / sr)) : null;
    p.process(tone ? [[tone, tone]] : [], [out]);
    for (const c of out) for (const v of c) Number.isFinite(v) ? (peak = Math.max(peak, Math.abs(v))) : (bad = true);
    scope.currentFrame += 128;
  }
  if (notes.length) p.message({ type: 'events', events: notes.map((n) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x80, n, 0] } })) });
  return { peak, bad };
};

test('a Mutable plugin made where another was plays sound, not NaN (Particles, then String and Reverb)', () => {
  const a = make('mutable', 'Particles');
  play(a.p, 1.5, { notes: [48, 60, 67] });
  a.p.message({ type: 'destroy' });
  const b = make('mutable', 'String and Reverb');
  const r = play(b.p, 1, { notes: [48, 60, 67] });
  assert.equal(r.bad, false);
  assert.ok(r.peak > 1e-3, 'it plays');
  assert.ok(!sent.some((m) => m.type === 'fault'), 'with nothing to guard against');
});

test('a plugin that blows up is silenced, not passed on, says so once and plays again', () => {
  // The piano model with its stiffness past the limit (no limits given): a full-scale blow-up on a low note
  const { p } = make('faust', 'Piano Model', { limits: null, values: undefined });
  const k = sent.find((m) => m.type === 'ready').params.findIndex((x) => x.name === 'Stiffness factor');
  p.message({ type: 'set', index: k, value: 0.6 });
  const r = play(p, 2, { notes: [36] });
  assert.equal(r.bad, false);
  assert.ok(r.peak < BLOWN_UP, `peak ${r.peak}`);
  assert.equal(sent.filter((m) => m.type === 'fault').length, 1);
  // Started again as it was set: a note it can play sounds
  p.message({ type: 'set', index: k, value: 0.28 });
  play(p, 1.2);
  const after = play(p, 1, { notes: [60] });
  assert.ok(after.peak > 1e-3 && after.peak < 4, `peak ${after.peak}`);
});

test('the limited parameters exist, and only values past a limit change', () => {
  for (const [url, limits] of Object.entries(PARAM_LIMITS)) {
    const [fam, name] = url.slice('builtin:'.length).split('/');
    const { p, ready } = make(fam, name, { limits: null });
    for (const [param, [lo, hi]] of Object.entries(limits)) {
      const i = ready.params.findIndex((x) => x.name === param);
      assert.ok(i >= 0, `${name} has ${param}`);
      // The default is inside the limit
      assert.ok(ready.defaults[i] >= lo && ready.defaults[i] <= hi, `${name} ${param} default`);
    }
    p.message({ type: 'destroy' });
    const inside = make(fam, name);
    const outside = make(fam, name);
    for (const [param, [lo, hi]] of Object.entries(limits)) {
      const i = inside.ready.params.findIndex((x) => x.name === param);
      const mid = (lo + hi) / 2;
      sent.length = 0;
      inside.p.message({ type: 'set', index: i, value: mid });
      assert.equal(sent.find((m) => m.type === 'display').value.toFixed(4), mid.toFixed(4), `${name} ${param} inside`);
      sent.length = 0;
      outside.p.message({ type: 'set', index: i, value: hi < 1 ? 1 : 0 });
      assert.equal(sent.find((m) => m.type === 'display').value.toFixed(4), (hi < 1 ? hi : lo).toFixed(4), `${name} ${param} clamped`);
    }
  }
  // A saved setting past the limit starts at the limit; the piano then plays its low notes cleanly
  const k = make('faust', 'Piano Model', { limits: null }).ready.params.findIndex((x) => x.name === 'Stiffness factor');
  const values = make('faust', 'Piano Model', { limits: null }).ready.params.map((x) => x.value);
  values[k] = 1;
  const { p, ready } = make('faust', 'Piano Model', { values });
  assert.equal(ready.params[k].value.toFixed(2), '0.30');
  const r = play(p, 1, { notes: [21, 24] });
  assert.ok(r.peak > 1e-3 && r.peak < 4, `peak ${r.peak}`);
  assert.ok(!sent.some((m) => m.type === 'fault'));
});

test('with every limited parameter set past its limit, nothing plays louder than +12 dBFS', () => {
  const most = 10 ** (12 / 20);
  for (const [url, limits] of Object.entries(PARAM_LIMITS)) {
    const [fam, name] = url.slice('builtin:'.length).split('/');
    const info = family(fam).plugins.find((p) => p.name === name);
    const fresh = make(fam, name, { limits: null }).ready;
    for (const notes of info.instrument ? [[21], [36], [60], [88], [108]] : [[]]) {
      // Each limited parameter saved at the far end of its range, the rest as they start
      const values = fresh.params.map((x) => (Object.hasOwn(limits, x.name) ? (limits[x.name][1] < 1 ? 1 : 0) : x.value));
      const { p } = make(fam, name, { values });
      const r = play(p, 1.5, { notes, input: !info.instrument });
      assert.ok(!r.bad && r.peak < most, `${name} ${notes.join()}: peak ${(20 * Math.log10(r.peak)).toFixed(1)} dBFS`);
      assert.ok(!sent.some((m) => m.type === 'fault'), `${name} ${notes.join()} blew up`);
    }
  }
});

test("the piano model's brightness at its limit is within a few dB of its default, top notes too", () => {
  for (const note of [60, 88, 108]) {
    const plain = play(make('faust', 'Piano Model').p, 1, { notes: [note] }).peak;
    const values = make('faust', 'Piano Model', { limits: null }).ready.params.map((x) => (x.name === 'Brightness factor' ? 1 : x.value));
    const bright = play(make('faust', 'Piano Model', { values }).p, 1, { notes: [note] }).peak;
    assert.ok(20 * Math.log10(bright / plain) < 3.5, `${note}: ${(20 * Math.log10(bright / plain)).toFixed(1)} dB over the default`);
  }
});
