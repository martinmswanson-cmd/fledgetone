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

const { BUILTIN_PROCESSOR_SOURCE, BLOWN_UP, OUTPUT_CEILING } = await import('../src/audio/plugins/processor.ts');
const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');
const { GPL_PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalogGpl.ts');
const { PARAM_LIMITS, OUTPUT_TRIMS_DB, ownMemoryFor } = await import('../src/audio/plugins/paramLimits.ts');

const sr = 48000;
const scope = { sampleRate: sr, currentFrame: 0 };
const sent = [];
const src = BUILTIN_PROCESSOR_SOURCE.replace(/\bcurrentFrame\b/g, 'scope.currentFrame');
/** The processor class from `source`, in a scope of its own (its families' shared instances fresh) */
const processorClass = (source = src) => {
  let C;
  new Function('scope', 'sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'console', source)(
    scope,
    sr,
    class {
      constructor() {
        this.port = { postMessage: (m) => sent.push(m) };
      }
    },
    (_, c) => (C = c),
    { log() {} }
  );
  return C;
};
const Proc = processorClass();
/** The same processor with no output ceiling: what the plugins play as they are */
const Uncapped = processorClass(src.replace(/const CEILING = [^;]+;/, 'const CEILING = Infinity;'));
const modules = new Map();
const family = (name) => [...PLUGIN_FAMILIES, ...GPL_PLUGIN_FAMILIES].find((f) => f.family === name);
const moduleOf = (name) => {
  if (!modules.has(name)) modules.set(name, new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${family(name).file}`, import.meta.url))));
  return modules.get(name);
};
/** A plugin as builtinHost makes it (its family's memory rule and its limits), unless `opts` says otherwise */
const make = (fam, name, { Processor = Proc, offline = false, ...opts } = {}) => {
  sent.length = 0;
  const index = family(fam).plugins.findIndex((p) => p.name === name);
  assert.ok(index >= 0, name);
  const p = new Processor({
    processorOptions: { family: fam, module: moduleOf(fam), index, ...ownMemoryFor(fam, offline), limits: PARAM_LIMITS[`builtin:${fam}/${name}`] ?? null, outputGain: 10 ** ((OUTPUT_TRIMS_DB[`builtin:${fam}/${name}`] ?? 0) / 20), ...opts },
  });
  const ready = sent.find((m) => m.type === 'ready');
  assert.ok(ready, `${name} started`);
  return { p, ready };
};
/** Play `seconds` of it (a tone in, for an effect), notes held from the start; the output's peak and any non-finite sample */
const play = (p, seconds, { notes = [], input = false, velocity = 110 } = {}) => {
  if (notes.length) p.message({ type: 'events', events: notes.map((n) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x90, n, velocity] } })) });
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
      // (Without the output ceiling: the limits themselves keep it down)
      const { p } = make(fam, name, { values, Processor: Uncapped });
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

test('the piano model, turned down, plays every key under -1 dBFS at any velocity, and only quieter', () => {
  const ceiling = 10 ** (-1 / 20);
  const gain = 10 ** (OUTPUT_TRIMS_DB['builtin:faust/Piano Model'] / 20);
  const index = family('faust').plugins.findIndex((p) => p.name === 'Piano Model');
  /** One note's output, as the host makes the plugin (trimmed) or with no trim */
  const render = (note, velocity, outputGain) => {
    const { p } = make('faust', 'Piano Model', outputGain === undefined ? {} : { outputGain });
    p.message({ type: 'events', events: [{ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x90, note, velocity] } }] });
    const out = [];
    for (let b = 0; b < 375; b++) {
      const o = [new Float32Array(128), new Float32Array(128)];
      p.process([], [o]);
      for (let k = 0; k < 128; k++) out.push(Math.abs(o[0][k]) > Math.abs(o[1][k]) ? o[0][k] : o[1][k]);
      scope.currentFrame += 128;
    }
    p.message({ type: 'destroy' });
    return out;
  };
  assert.ok(index >= 0);
  for (const velocity of [64, 100, 127])
    for (let note = 21; note <= 108; note++) {
      const peak = Math.max(...render(note, velocity).map(Math.abs));
      assert.ok(peak < ceiling, `${note} at ${velocity}: ${(20 * Math.log10(peak)).toFixed(1)} dBFS`);
    }
  // The same sound, only quieter
  const trimmed = render(88, 100);
  const plain = render(88, 100, 1);
  assert.ok(trimmed.every((v, i) => Math.abs(v - plain[i] * gain) < 1e-6));
});

/** Every sample of `seconds` of it, left then right per block, with a tone in for an effect and notes held from the start */
const samples = (p, seconds, { notes = [], input = false } = {}) => {
  if (notes.length) p.message({ type: 'events', events: notes.map((n) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x90, n, 127] } })) });
  const all = [];
  const start = scope.currentFrame;
  for (let b = 0; b < (seconds * sr) / 128; b++) {
    const out = [new Float32Array(128), new Float32Array(128)];
    const f = start + b * 128;
    const tone = input ? Float32Array.from({ length: 128 }, (_, k) => 0.25 * Math.sin((2 * Math.PI * 110 * (f + k)) / sr)) : null;
    scope.currentFrame = f;
    p.process(tone ? [[tone, tone]] : [], [out]);
    all.push(out[0], out[1]);
  }
  scope.currentFrame = start + Math.round((seconds * sr) / 128) * 128;
  return all;
};

test('the output ceiling changes only samples past +12 dBFS, and holds those there', () => {
  // Instruments at full velocity and effects with a tone in, as they start, and at settings that go far past it
  const cases = [
    ['mda', 'JX10', { program: 0 }, [36, 60, 84]],
    ['mda', 'EPiano', { program: 1 }, [84]],
    ['fledge', 'Fledge Synth', { program: 3 }, [36, 48]],
    ['faust', 'Marimba Model', {}, [60]],
    ['mutable', 'Particles', {}, [48, 60]],
    ['airwindows', 'PurestGain', {}, null],
    ['faust', 'Stereo Compressor', {}, null],
    ['mda', 'Loudness', { values: [0.819, 1, 0], limits: null }, null],
    ['airwindows', 'Point', { values: [1, 1, 0] }, null],
  ];
  let held = 0;
  for (const [fam, name, opts, notes] of cases) {
    const at = scope.currentFrame;
    const capped = samples(make(fam, name, opts).p, 1, notes ? { notes } : { input: true });
    scope.currentFrame = at;
    const plain = samples(make(fam, name, { ...opts, Processor: Uncapped }).p, 1, notes ? { notes } : { input: true });
    for (let b = 0; b < plain.length; b++)
      for (let i = 0; i < 128; i++) {
        const want = Math.max(-OUTPUT_CEILING, Math.min(OUTPUT_CEILING, plain[b][i]));
        if (Object.is(capped[b][i], want) || capped[b][i] === want) continue;
        assert.fail(`${name}: ${capped[b][i]} where ${plain[b][i]} played`);
      }
    held += plain.reduce((n, ch) => n + ch.filter((v) => Math.abs(v) > OUTPUT_CEILING).length, 0);
  }
  assert.ok(held > 1000, 'the loud cases went past the ceiling');
});

test("mda Loudness's output stops at +12 dB, and with both its knobs at the top it doesn't blow up", () => {
  const { ready } = make('mda', 'Loudness', { values: [0.5, 1, 0] });
  assert.equal(ready.params[1].text.trim(), '12.0 dB');
  const r = play(make('mda', 'Loudness', { values: [1, 1, 0], Processor: Uncapped }).p, 1, { input: true });
  assert.ok(!r.bad, 'no NaN');
  assert.ok(!sent.some((m) => m.type === 'fault'), 'no blow-up');
});

test('the Mutable plugins share their instance in a render (made fresh, none deleted), each its own live', () => {
  assert.deepEqual(ownMemoryFor('mutable', false), { ownMemory: true, freshOnRestart: false });
  assert.deepEqual(ownMemoryFor('mutable', true), { ownMemory: false, freshOnRestart: true });
  assert.deepEqual(ownMemoryFor('faust', true), { ownMemory: false, freshOnRestart: false });
  // A render: a context of its own (a fresh family instance), every plugin made at the start
  const Render = processorClass();
  const names = ['Particles', 'String and Reverb', 'Modal Voice', 'Grain Stretch', 'Resonator FM', 'Macro Oscillator'];
  const plugins = names.map((n) => make('mutable', n, { Processor: Render, offline: true }).p);
  plugins.forEach((p, i) => {
    const info = family('mutable').plugins.find((x) => x.name === names[i]);
    const r = play(p, 0.8, info.instrument ? { notes: [48, 60] } : { input: true });
    assert.equal(r.bad, false, names[i]);
    assert.ok(r.peak > 1e-4, `${names[i]} plays`);
  });
  assert.ok(new Set(plugins.map((p) => p.e)).size === 1, 'one instance');
});

/** The loudest sample of one note (velocity 127) over 1.5 s, held for 1 s */
const notePeak = (fam, name, note, opts = {}) => {
  const { p } = make(fam, name, { Processor: Uncapped, ...opts });
  return play(p, 3, { notes: [note], velocity: 127 }).peak;
};
const dbfs = (x) => (20 * Math.log10(x)).toFixed(1);

test('the phaser on a narrow notch near the top of its range no longer rings up or blows up', () => {
  const { ready } = make('faust', 'Phaser', { limits: null });
  const at = (name) => ready.params.findIndex((x) => x.name.startsWith(name));
  // Narrow notch, notches as high and as far apart as they go, feedback near the top, a tone at
  // -12 dBFS in: +25 to +60 dBFS before (now under +6, its resonance on the tone)
  for (const feedback of [0.8, 0.95]) {
    const values = ready.defaults.slice();
    values[at('Notch width')] = 0;
    values[at('Min notch1')] = 1;
    values[at('Max notch1')] = 1;
    values[at('Notch freq ratio')] = 1;
    values[at('Feedback gain')] = feedback;
    values[at('Speed')] = 0.161;
    const r = play(make('faust', 'Phaser', { values, Processor: Uncapped }).p, 3, { input: true });
    assert.ok(!r.bad && r.peak < 2, `feedback ${feedback}: ${dbfs(r.peak)} dBFS`);
    assert.ok(!sent.some((m) => m.type === 'fault'), `feedback ${feedback} blew up`);
  }
});

test('Modal Voice bowed hard into strings with full damping plays its notes instead of blowing up', () => {
  const { ready } = make('mutable', 'Modal Voice', { limits: null });
  const values = ready.defaults.slice();
  values[ready.params.findIndex((x) => x.name === 'Bow')] = 1;
  values[ready.params.findIndex((x) => x.name === 'Damping')] = 1;
  values[ready.params.findIndex((x) => x.name === 'Resonator')] = 1;
  for (const note of [36, 60, 84]) {
    const { p } = make('mutable', 'Modal Voice', { values });
    const r = play(p, 2, { notes: [note] });
    assert.ok(!r.bad && r.peak > 1e-3, `${note} plays`);
    assert.ok(!sent.some((m) => m.type === 'fault'), `${note} blew up`);
  }
});

test('the hottest presets and keys found play under -1 dBFS now, the plugins only quieter', () => {
  const ceiling = 10 ** (-1 / 20);
  for (const [fam, name, program, note, before] of [
    ['mutable', 'Ominous Drone', 3, 48, 13.7],
    ['mda', 'EPiano', 1, 84, 9.1],
    ['setbfree', 'Tonewheel Organ', 10, 72, 10.4],
    ['mutable', 'Analog Snare', -1, 96, 5.5],
    ['mutable', 'Modal Voice', 4, 84, 2.4],
  ]) {
    const opts = program >= 0 ? { program } : {};
    const peak = notePeak(fam, name, note, opts);
    assert.ok(peak < ceiling, `${name} ${note}: ${dbfs(peak)} dBFS (was +${before})`);
  }
  // A trim is the same sound, only quieter
  const trim = 10 ** (OUTPUT_TRIMS_DB['builtin:mda/EPiano'] / 20);
  const at = scope.currentFrame;
  const trimmed = samples(make('mda', 'EPiano', { program: 1, Processor: Uncapped }).p, 0.5, { notes: [84] });
  scope.currentFrame = at;
  const plain = samples(make('mda', 'EPiano', { program: 1, outputGain: 1, Processor: Uncapped }).p, 0.5, { notes: [84] });
  assert.ok(trimmed.every((ch, b) => ch.every((v, i) => Math.abs(v - plain[b][i] * trim) < 1e-6)));
});
