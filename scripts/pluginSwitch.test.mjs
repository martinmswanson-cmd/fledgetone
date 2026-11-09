// Switching a built-in plugin's whole sound with notes held (a preset chosen, an undo putting the
// settings back, Reset all, Surge XT's patch loading): the output fades out on the old sound, the
// change is made silent, and it fades back in (processor.ts 'switch' / 'switched'; the host sends
// them round every such change, builtinHost.ts switching). No click, no burst louder than either
// sound, held notes playing on (Surge XT's stop as its patch changes is the fade out). Fledge
// Synth's own part (bb_settle: its eased level straight at the new one) is in its wasm. Run with
// `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const stub = (code) => 'data:text/javascript,' + encodeURIComponent(code);
const catalog = new URL('../src/audio/plugins/pluginCatalog.ts', import.meta.url).href;
const catalogGpl = new URL('../src/audio/plugins/pluginCatalogGpl.ts', import.meta.url).href;
const SOURCES = stub(`import { PLUGIN_FAMILIES } from ${JSON.stringify(catalog)};
export const GPL_PLUGINS = false;
export const pluginFamilies = () => PLUGIN_FAMILIES;
export const pluginSource = () => ({});`);
const plugins = new URL('../public/fledgetone-plugins/', import.meta.url).href;
const RECORDINGS = stub(`import { readFileSync } from 'node:fs';
export const recordingBytes = async (source, file) => { const b = readFileSync(new URL(file, ${JSON.stringify(plugins)})); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };`);
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === './pluginSources') return { url: ${JSON.stringify(SOURCES)}, shortCircuit: true };
  if (specifier === '../recordingStore') return { url: ${JSON.stringify(RECORDINGS)}, shortCircuit: true };
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);

const { BUILTIN_PROCESSOR_SOURCE } = await import('../src/audio/plugins/processor.ts');
const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');
const { GPL_PLUGIN_FAMILIES } = await import(catalogGpl).catch(() => ({}));

const sr = 48000;
const scope = { sampleRate: sr, currentFrame: 0 };
let toHost = () => {};
/** The processor class as the worklet has it; its messages out go to `toHost` */
const Proc = (() => {
  let C;
  new Function('scope', 'sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'console', BUILTIN_PROCESSOR_SOURCE.replace(/\bcurrentFrame\b/g, 'scope.currentFrame'))(
    scope,
    sr,
    class {
      constructor() {
        const send = toHost;
        this.port = { postMessage: (m) => send(m) };
      }
    },
    (_, c) => (C = c),
    { log() {} }
  );
  return C;
})();
const wasm = (file) => new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${file}`, import.meta.url)));
const fledge = wasm(PLUGIN_FAMILIES.find((f) => f.family === 'fledge').file);
const NEURO = 5;
const INIT_SAW = 0;

const makeProc = (module, family, opts = {}) => {
  const sent = [];
  toHost = (m) => sent.push(m);
  const p = new Proc({ processorOptions: { family, module, index: 0, outputGain: 1, limits: null, ...opts } });
  assert.ok(p.alive, `${family} started`);
  return { p, sent };
};
/** `seconds` of a processor's left channel */
const render = (p, seconds) => {
  const got = new Float32Array(Math.ceil((seconds * sr) / 128) * 128);
  for (let b = 0; b < got.length / 128; b++) {
    const out = [new Float32Array(128), new Float32Array(128)];
    p.process([], [out]);
    got.set(out[0], b * 128);
    scope.currentFrame += 128;
  }
  return got;
};
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
/** The loudest 10 ms (steps of 2.5 ms) of `x` between `from` and `to` seconds */
const loudest = (x, from, to) => {
  let most = 0;
  for (let t = from; t + 0.01 <= to + 1e-9; t += 0.0025) most = Math.max(most, rms(x.subarray(Math.round(t * sr), Math.round((t + 0.01) * sr))));
  return most;
};
/** The largest step from one sample to the next between `from` and `to` seconds */
const step = (x, from, to) => {
  let most = 0;
  for (let i = Math.max(1, Math.round(from * sr)); i < Math.round(to * sr); i++) most = Math.max(most, Math.abs(x[i] - x[i - 1]));
  return most;
};
const chord = (p, vel = 100) => p.message({ type: 'events', events: [45, 52, 57].map((n) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes: [0x90, n, vel] } })) });

/**
 * A chord held through a switch made by `messages` at 0.5 s (the host's way: 'switch', the
 * change, 'switched'). Before and after levels, the switch's first 60 ms, its steps against the
 * steady ones, and how loud the chord is at the end.
 */
const through = (p, messages) => {
  chord(p);
  const before = render(p, 0.5);
  for (const m of messages) p.message(m);
  const after = render(p, 0.5);
  const x = new Float32Array(before.length + after.length);
  x.set(before);
  x.set(after, before.length);
  const at = before.length / sr;
  return {
    was: loudest(x, at - 0.3, at - 0.01),
    first: loudest(x, at, at + 0.06),
    settled: loudest(x, at + 0.15, at + 0.45),
    jump: step(x, at - 0.01, at + 0.04),
    steady: Math.max(step(x, at - 0.3, at - 0.02), step(x, at + 0.15, at + 0.45)),
    end: rms(x.subarray(x.length - 4800)),
  };
};
const ownValues = (() => {
  const { p } = makeProc(fledge, 'fledge');
  return p.describe().map((d) => d.value);
})();

test('Fledge Synth: undo from Neuro back to your own sound, on a held chord: no burst, no click', () => {
  const { p } = makeProc(fledge, 'fledge', { program: NEURO });
  const r = through(p, [{ type: 'switch' }, { type: 'noProgram', asked: 1 }, ...ownValues.map((value, index) => ({ type: 'set', index, value })), { type: 'switched' }]);
  // (Before: the own sound came in at Neuro's level, about 2.5 times its own for 10 ms, peak 0.88)
  assert.ok(r.first <= 1.1 * Math.max(r.was, r.settled), `first 60 ms ${r.first.toFixed(3)} against ${r.was.toFixed(3)} before, ${r.settled.toFixed(3)} after`);
  assert.ok(r.jump <= 1.5 * r.steady + 0.01, `step ${r.jump.toFixed(3)} at the switch against ${r.steady.toFixed(3)} steady`);
  assert.ok(r.end > 0.05, 'the chord plays on');
  assert.equal(p.program(), -1);
});

test('Fledge Synth: Init saw chosen from Neuro, and Neuro from your own sound, on a held chord', () => {
  for (const [from, to] of [
    [NEURO, INIT_SAW],
    [undefined, NEURO],
  ]) {
    const { p } = makeProc(fledge, 'fledge', from === undefined ? {} : { program: from });
    const r = through(p, [{ type: 'switch' }, { type: 'program', index: to, asked: 1 }, { type: 'switched' }]);
    assert.ok(r.first <= 1.1 * Math.max(r.was, r.settled), `${from}->${to}: first 60 ms ${r.first.toFixed(3)} against ${r.was.toFixed(3)} / ${r.settled.toFixed(3)}`);
    assert.ok(r.jump <= 1.5 * r.steady + 0.01, `${from}->${to}: step ${r.jump.toFixed(3)} against ${r.steady.toFixed(3)}`);
    assert.ok(r.end > 0.03, 'the chord plays on');
    assert.equal(p.program(), to);
  }
});

test('the switch: silent, at once when all there; playing, its messages wait for the fade out, sync never does', () => {
  // Nothing playing: the preset is chosen as soon as the switch's messages are all there, with no
  // fade out (a render between them would play half the change)
  const quiet = makeProc(fledge, 'fledge');
  render(quiet.p, 0.05);
  quiet.p.message({ type: 'switch' });
  quiet.p.message({ type: 'program', index: NEURO, asked: 1 });
  assert.equal(quiet.p.program(), -1);
  quiet.p.message({ type: 'switched' });
  assert.equal(quiet.p.program(), NEURO);

  // Playing: the preset waits until the old sound has faded out (5 ms), the answers with it
  const { p, sent } = makeProc(fledge, 'fledge');
  chord(p);
  render(p, 0.3);
  sent.length = 0;
  p.message({ type: 'switch' });
  p.message({ type: 'program', index: NEURO, asked: 1 });
  p.message({ type: 'describe', id: 3 });
  p.message({ type: 'sync', id: 4 });
  assert.equal(p.program(), -1, 'not yet: the old sound fades out first');
  assert.deepEqual(
    sent.map((m) => m.type),
    ['synced'],
    'sync is answered at once (everything before it has arrived), the describe waits'
  );
  const fade = render(p, 0.005);
  assert.ok(Math.abs(fade.at(-1)) < 0.02, 'faded out');
  render(p, 0.003);
  assert.equal(p.program(), NEURO, 'made once silent');
  assert.equal(sent.find((m) => m.id === 3)?.params.length > 0, true, 'the describe answered after it, with the new settings');
  // Silent until 'switched'; never longer than the hold (a lost 'switched')
  assert.ok(rms(render(p, 0.02)) < 1e-4, 'silent while the switch is being made');
  render(p, 0.1);
  assert.ok(rms(render(p, 0.05)) > 0.02, 'back after the hold without its end');
});

test('the switch waits for all its messages, the old sound playing on, then fades out (never a long silence)', () => {
  // An undo's 318 settings take the page a few ms to send: until 'switched' the old sound plays
  // on at full level, then the dip is only the fades (5 ms out, 10 ms in)
  const { p } = makeProc(fledge, 'fledge', { program: NEURO });
  chord(p);
  render(p, 0.3);
  p.message({ type: 'switch' });
  p.message({ type: 'noProgram', asked: 1 });
  const gathering = render(p, 0.008);
  assert.ok(rms(gathering.subarray(-128)) > 0.05, 'still playing while the messages come');
  assert.equal(p.program(), NEURO, 'nothing changed yet');
  for (const [index, value] of ownValues.entries()) p.message({ type: 'set', index, value });
  p.message({ type: 'switched' });
  const dip = render(p, 0.04);
  let silent = 0;
  for (let b = 0; b < dip.length / 128; b++) if (rms(dip.subarray(b * 128, (b + 1) * 128)) < 0.002) silent++;
  assert.ok(silent <= 2, `${silent} silent blocks: only where the fades meet`);
  assert.equal(p.program(), -1);
  assert.ok(rms(dip.subarray(dip.length - 480)) > 0.05, 'back to full within 20 ms');
  // Never sent its end: after SWITCH_GATHER_S it fades out and is made all the same
  const q = makeProc(fledge, 'fledge');
  chord(q.p);
  render(q.p, 0.2);
  q.p.message({ type: 'switch' });
  q.p.message({ type: 'program', index: NEURO, asked: 1 });
  render(q.p, 0.06);
  assert.equal(q.p.program(), NEURO);
});

test('a knob turned while it plays is not a switch (no fade)', () => {
  const pair = [makeProc(fledge, 'fledge'), makeProc(fledge, 'fledge')];
  const t0 = scope.currentFrame;
  const outs = pair.map(({ p }) => {
    scope.currentFrame = t0;
    chord(p);
    render(p, 0.2);
    p.message({ type: 'set', index: 0, value: 0.3 });
    return render(p, 0.1);
  });
  assert.deepEqual(outs[0], outs[1]);
  assert.ok(rms(outs[0].subarray(0, 480)) > 0.02, 'no dip');
});

const gpl = GPL_PLUGIN_FAMILIES?.find?.((f) => f.family === 'surge');
const surgeFile = gpl && new URL(`../public/fledgetone-plugins/${gpl.file}`, import.meta.url);
test('Surge XT: a patch loaded with notes held stops them with a fade, not a cut', { skip: !surgeFile || !fs.existsSync(surgeFile) }, () => {
  const surge = new WebAssembly.Module(fs.readFileSync(surgeFile));
  const { p } = makeProc(surge, 'surge', { ownMemory: true });
  chord(p, 110);
  const before = render(p, 0.4);
  const patch = fs.readFileSync(new URL('../public/fledgetone-plugins/gpl/surge-patches/Basses/Bass 1.fxp', import.meta.url));
  for (const m of [{ type: 'switch' }, { type: 'load', data: patch.buffer.slice(patch.byteOffset, patch.byteOffset + patch.byteLength) }, { type: 'switched' }]) p.message(m);
  const after = render(p, 0.1);
  const was = rms(before.subarray(before.length - 480));
  assert.ok(was > 0.02, 'the chord sounds before');
  // (Before: silent from the first sample of the load: a cut)
  const firstMs = rms(after.subarray(0, 48));
  assert.ok(firstMs > 0.5 * was, `the first ms ${firstMs.toFixed(3)} still near ${was.toFixed(3)}: fading, not cut`);
  assert.ok(rms(after.subarray(192, 240)) < 0.2 * was, 'faded out by 5 ms');
});

/** `seconds` of a processor's left channel, fed a sawtooth chord (110, 165, 220 Hz at 0.1) */
const renderFed = (p, seconds) => {
  const got = new Float32Array(Math.ceil((seconds * sr) / 128) * 128);
  for (let b = 0; b < got.length / 128; b++) {
    const inp = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      const t = (scope.currentFrame + i) / sr;
      for (const f of [110, 165, 220]) inp[i] += 0.1 * (2 * ((t * f) % 1) - 1);
    }
    const out = [new Float32Array(128), new Float32Array(128)];
    p.process([[inp, inp]], [out]);
    got.set(out[0], b * 128);
    scope.currentFrame += 128;
  }
  return got;
};

test('the Vocoder: a preset changed on a bright sound comes in at its own level (made afresh in the silence)', () => {
  const mdaFamily = PLUGIN_FAMILIES.find((f) => f.family === 'mda');
  const index = mdaFamily.plugins.findIndex((x) => x.name === 'Vocoder');
  const mda = wasm(mdaFamily.file);
  const p = makeProc(mda, 'mda', { index, program: 1, freshOnSwitch: true }).p;
  // 16 Band and Old Vocoder, back and forth at moments a little apart: its band filters, left as
  // one had them, blew up under the other on most (+19 to +30 dB over the settled sound, then the
  // guard's cut)
  const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  let was = loudest(renderFed(p, 0.8), 0.4, 0.79);
  for (let k = 0; k < 8; k++) {
    const to = k % 2 ? 1 : 2;
    for (const m of [{ type: 'switch' }, { type: 'program', index: to, asked: 1 }, { type: 'switched' }]) p.message(m);
    const y = renderFed(p, 0.8 + 0.0371 * k);
    const first = loudest(y, 0, 0.25);
    const settled = loudest(y, 0.35, 0.79);
    assert.ok(first <= 1.122 * Math.max(settled, was), `${k}, to ${to}: loudest 10 ms ${first.toFixed(3)} against ${settled.toFixed(3)} settled`);
    assert.ok(peak(y.subarray(0, 0.25 * sr)) <= 1.25 * peak(y.subarray(0.35 * sr)), `${k}, to ${to}: peak ${peak(y.subarray(0, 0.25 * sr)).toFixed(3)} against ${peak(y.subarray(0.35 * sr)).toFixed(3)} settled`);
    was = settled;
  }
  assert.equal(p.program(), 1);
});

/** A JX10 on preset `program`, made afresh in a switch as the host has it */
const jx10 = (program) => {
  const mdaFamily = PLUGIN_FAMILIES.find((f) => f.family === 'mda');
  const index = mdaFamily.plugins.findIndex((x) => x.name === 'JX10');
  return makeProc(wasm(mdaFamily.file), 'mda', { index, program, freshOnSwitch: true }).p;
};
/** Steps on a processor: [bytes...] sent now, or a number of seconds rendered. Its sound, from the start. */
const play = (p, steps) => {
  const parts = [];
  for (const st of steps) {
    if (typeof st === 'number') parts.push(render(p, st));
    else midiNow(p, st);
  }
  const x = new Float32Array(parts.reduce((n, q) => n + q.length, 0));
  let at = 0;
  for (const q of parts) {
    x.set(q, at);
    at += q.length;
  }
  return x;
};
/** Notes struck and let go one after another (`on` seconds each, then `gap`) */
const run = (notes, on, gap) => notes.flatMap((n) => [[0x90, n, 100], on, [0x80, n, 0], gap]);
const midiNow = (p, ...list) => p.message({ type: 'events', events: list.map((bytes) => ({ type: 'wam-midi', time: scope.currentFrame / sr, data: { bytes } })) });
const toPreset = (p, index) => {
  for (const m of [{ type: 'switch' }, { type: 'program', index, asked: 1 }, { type: 'switched' }]) p.message(m);
};
/** The pitch (Hz) of `x` between `from` and `to` seconds, from its autocorrelation's first strong peak */
const pitchOf = (x, from, to) => {
  const seg = x.subarray(Math.round(from * sr), Math.round(to * sr));
  const r = [];
  for (let lag = 0; lag < 1600; lag++) {
    let q = 0;
    for (let k = 0; k + lag < seg.length; k++) q += seg[k] * seg[k + lag];
    r.push(q);
  }
  let k = 1;
  while (k < 1600 && r[k] > 0) k++;
  let most = 0;
  for (let j = k; j < 1599; j++) most = Math.max(most, r[j]);
  for (let j = k; j < 1599; j++)
    if (r[j] >= 0.85 * most && r[j] >= r[j - 1] && r[j] >= r[j + 1]) return sr / (j + (r[j - 1] - r[j + 1]) / (2 * (r[j - 1] - 2 * r[j] + r[j + 1])));
  return 0;
};


test('the JX10: a preset changed on a held chord is made afresh: the held notes end with the fade, a new chord plays at its own level', () => {
  const ARCTIC = 60;
  // Held on Empty Patch, then Arctic Wind: its voices went on into the new filter and envelopes
  // (up to +18 dB); struck again as fresh notes, a chord that had died away came back out of
  // silence. Made afresh, the held notes end with the switch's fade
  const p = jx10(56);
  chord(p);
  const was = loudest(render(p, 0.5), 0.3, 0.49);
  toPreset(p, ARCTIC);
  const after = render(p, 1);
  assert.ok(loudest(after, 0, 0.99) <= was, 'never louder than it played');
  assert.ok(loudest(after, 0.01, 0.99) < 1e-4, `the held chord ends (${loudest(after, 0.01, 0.99).toFixed(5)})`);
  assert.equal(p.program(), ARCTIC);
  // The keys let go, struck again: the chord plays as on a fresh one
  const up = [45, 52, 57].map((n) => [0x80, n, 0]);
  midiNow(p, ...up);
  render(p, 0.1);
  chord(p);
  const again = loudest(render(p, 1), 0, 0.99);
  const f = jx10(ARCTIC);
  render(f, 0.05);
  chord(f);
  const fresh = loudest(render(f, 1), 0, 0.99);
  assert.ok(again <= 1.122 * fresh && again >= 0.7 * fresh, `struck again: ${again.toFixed(4)} against ${fresh.toFixed(4)} fresh`);
  // And let go: it ends as the fresh one does (nothing left hanging)
  const [lp, lf] = [p, f].map((q) => {
    midiNow(q, ...up);
    render(q, 2);
    return rms(render(q, 0.1));
  });
  assert.ok(lp <= 1.5 * lf + 1e-4, `let go: ${lp.toFixed(5)} against ${lf.toFixed(5)} fresh`);
});

test('the JX10: the sustain pedal is still down after a preset change (its notes end with it, the next ones it holds)', () => {
  const p = jx10(1);
  play(p, [[0x90, 57, 100], [0x90, 64, 100], 0.2, [0xb0, 64, 127], 0.05, [0x80, 57, 0], [0x80, 64, 0], 0.5]);
  toPreset(p, 3);
  const after = render(p, 0.6);
  assert.ok(loudest(after, 0.01, 0.59) < 1e-4, 'the notes the pedal held end with the switch');
  // A note struck and let go after it: the pedal holds it, and lets it go when it comes up
  const held = play(p, [[0x90, 60, 100], 0.3, [0x80, 60, 0], 0.8]);
  assert.ok(loudest(held, 0.9, 1.09) > 0.3 * loudest(held, 0, 0.3), 'held by the pedal');
  midiNow(p, [0xb0, 64, 0]);
  render(p, 3);
  assert.ok(rms(render(p, 0.1)) < 2e-3, 'let go with the pedal');
  // The pedal let up in the switch's gap: the next note is not held
  const q = jx10(1);
  play(q, [[0xb0, 64, 127], 0.1]);
  toPreset(q, 3);
  q.message({ type: 'events', events: [{ type: 'wam-midi', time: scope.currentFrame / sr + 0.007, data: { bytes: [0xb0, 64, 0] } }] });
  render(q, 0.2);
  const r = jx10(3);
  const [a, b] = [q, r].map((x) => loudest(play(x, [[0x90, 60, 100], 0.3, [0x80, 60, 0], 1.2]), 1.3, 1.49));
  assert.ok(a <= 1.5 * b + 1e-4, `pedal up in the gap: ${a.toFixed(4)} against ${b.toFixed(4)} unheld`);
});

test('the JX10: the bend is kept through a preset change, so the next note plays bent from its start', () => {
  // A note bent up two semitones (the wheel at the top), a preset chosen: made afresh, the
  // JX10 played the next notes unbent until the wheel moved again
  const p = jx10(46);
  play(p, [[0x90, 57, 100], 0.4, [0xe0, 0x7f, 0x7f], 0.4, [0x80, 57, 0], 0.05]);
  toPreset(p, 9);
  render(p, 0.3);
  const after = play(p, [[0x90, 57, 100], 0.6]);
  const f = jx10(9);
  const struck = play(f, [[0xe0, 0x7f, 0x7f], [0x90, 57, 100], 0.6]);
  for (const [from, to] of [
    [0.02, 0.12],
    [0.45, 0.58],
  ]) {
    const now = pitchOf(after, from, to);
    const fresh = pitchOf(struck, from, to);
    assert.ok(fresh > 240 && Math.abs(now / fresh - 1) < 0.01, `${from}-${to} s: ${now.toFixed(1)} Hz against ${fresh.toFixed(1)} bent`);
  }
});

test('the JX10: its mod wheel, other controllers, pressure and bend go to it again (no notes), and Stop clears them', () => {
  const p = jx10(0);
  midiNow(p, [0xb0, 1, 127], [0xb0, 74, 30], [0xd0, 90], [0xe0, 0, 80], [0x90, 57, 100], [0xa0, 57, 70], [0x90, 60, 90]);
  render(p, 0.2);
  const sent = [];
  const e = p.e;
  p.e = { ...e, bb_midi: (h, a, b, c) => (sent.push([a, b, c]), e.bb_midi(h, a, b, c)) };
  toPreset(p, 1);
  render(p, 0.05);
  assert.deepEqual(sent, [
    [0xb0, 1, 127],
    [0xb0, 74, 30],
    [0xd0, 90, 0],
    [0xe0, 0, 80],
  ]);
  // Stop (as the host sends it, wamPlugin.ts releaseAll): nothing is given again after it
  midiNow(p, [0x80, 57, 0], [0x80, 60, 0], [0xb0, 64, 0], [0xb0, 123, 0], [0xe0, 0, 64], [0xb0, 121, 0]);
  render(p, 0.2);
  sent.length = 0;
  toPreset(p, 0);
  render(p, 0.05);
  assert.deepEqual(sent, [], 'nothing after Stop');
});

test('the JX10: a switch never brings a note back, nor makes the next one swell (held keys, the pedal, a one-voice sound)', () => {
  // Struck again as fresh notes of the new sound, notes that had died away came back out of
  // silence (up to 0.48), a run under the pedal came in louder than it played (+4.8 dB), and, held
  // under a ceiling, a chord died down to a murmur swelled up to full level at the next note
  const cases = [
    ['a one-voice note let go under the pedal', 16, [[0x90, 57, 100], 0.3, [0xb0, 64, 127], 0.05, [0x80, 57, 0], 2], 18],
    ['a bass line under the pedal on a one-voice sound', 16, [[0xb0, 64, 127], 0.05, ...run([45, 47, 48, 50, 52, 53, 55, 57], 0.15, 0.05), 1.5], 1],
    ['a Thumb Piano run under the pedal, died away', 44, [[0xb0, 64, 127], 0.05, ...run([48, 52, 55, 60, 64, 67, 72, 76, 79, 84, 72, 67, 64, 60, 55, 52], 0.08, 0.02), 3], 43],
    ['a Thumb Piano chord still held, died away', 44, [[0x90, 57, 100], [0x90, 60, 100], [0x90, 64, 100], 3.15], 43],
    ['a Pizzicato chord still held, died away', 28, [[0x90, 57, 100], [0x90, 60, 100], [0x90, 64, 100], 3.15], 44],
    ['an Echo Pad run under the pedal, sounding', 1, [[0xb0, 64, 127], 0.05, ...run([48, 52, 55, 60, 64, 67, 72, 76, 79, 84, 72, 67, 64, 60, 55, 52], 0.08, 0.02), 0.3], 3],
    ['a Soft E.Piano chord held 8 s, a murmur', 43, [[0x90, 57, 100], [0x90, 60, 100], [0x90, 64, 100], 8], 3],
  ];
  for (const [what, from, steps, to] of cases) {
    const p = jx10(from);
    const x = play(p, steps);
    const was = loudest(x, x.length / sr - 0.3, x.length / sr - 0.01);
    toPreset(p, to);
    const after = render(p, 1.8);
    assert.ok(loudest(after, 0, 1.79) <= Math.max(was, 1e-4), `${what}, to ${to}: ${loudest(after, 0, 1.79).toFixed(4)} against ${was.toFixed(4)} before`);
    assert.ok(loudest(after, 0.01, 1.79) < 1e-4, `${what}, to ${to}: the held notes end`);
    // The next note, soft: it plays alone, as on a fresh one (no swell of the old notes under it)
    const next = loudest(play(p, [[0x90, 72, 30], 1]), 0, 0.99);
    const f = jx10(to);
    const alone = loudest(play(f, [[0x90, 72, 30], 1]), 0, 0.99);
    assert.ok(next <= 1.122 * alone, `${what}, to ${to}: the next note ${next.toFixed(4)} against ${alone.toFixed(4)} alone`);
    // A key of the chord let go and struck again: it plays in full, as on a fresh one
    const again = loudest(play(p, [[0x80, 60, 0], [0x90, 60, 110], 0.5]), 0, 0.49);
    const own = loudest(play(f, [[0x90, 60, 110], 0.5]), 0, 0.49);
    assert.ok(again >= 0.7 * own, `${what}, to ${to}: a key struck again ${again.toFixed(4)} against ${own.toFixed(4)} fresh`);
    // Everything let go: nothing left
    midiNow(p, [0x80, 57, 0], [0x80, 60, 0], [0x80, 64, 0], [0x80, 72, 0], [0xb0, 64, 0]);
    midiNow(f, [0x80, 60, 0], [0x80, 72, 0]);
    render(p, 3);
    render(f, 3);
    const [lp, lf] = [p, f].map((q) => rms(render(q, 0.1)));
    assert.ok(lp <= 1.5 * lf + 1e-4, `${what}: let go, ${lp.toFixed(5)} against ${lf.toFixed(5)}`);
  }
});

test('Fledge Synth: a held chord that had died away stays silent through a preset change; one still sounding plays on, no louder', () => {
  const [PLUCK, STAB, GLASS, STRINGS, SILK] = [21, 24, 55, 29, 52];
  // Held 4 s (by the keys, or the pedal after they came up) until silent, then a pad: struck again
  // as fresh notes, the chord came back out of silence (0.31 to 0.36)
  for (const from of [PLUCK, STAB, GLASS]) {
    for (const to of [STRINGS, SILK]) {
      for (const pedal of [false, true]) {
        const { p } = makeProc(fledge, 'fledge', { program: from });
        const keys = [45, 52, 57];
        const x = play(p, [...(pedal ? [[0xb0, 64, 127]] : []), ...keys.map((n) => [0x90, n, 100]), ...(pedal ? [0.1, ...keys.map((n) => [0x80, n, 0])] : []), 4]);
        const was = rms(x.subarray(x.length - 4800));
        toPreset(p, to);
        const after = loudest(render(p, 1.5), 0, 1.49);
        assert.ok(was < 1e-3 && after < 1e-3, `${from} to ${to} (pedal ${pedal}): ${was.toFixed(5)} before, ${after.toFixed(4)} after`);
      }
    }
  }
  // Still sounding (a pad held 4 s): it plays on from the level it had, coming in no louder than
  // the new sound plays (its first 250 ms against the louder of it settled and the chord struck
  // afresh on it)
  for (const to of [PLUCK, SILK, STRINGS]) {
    const { p } = makeProc(fledge, 'fledge', { program: STRINGS });
    chord(p);
    const x = render(p, 4);
    const was = loudest(x, 3.7, 3.99);
    toPreset(p, to);
    const after = render(p, 1);
    // (Over 4 s: the pads' slow attacks done)
    const f = makeProc(fledge, 'fledge', { program: to }).p;
    render(f, 0.05);
    chord(f);
    const fresh = loudest(render(f, 4), 0, 3.99);
    const most = loudest(after, 0.006, 0.25);
    const settled = loudest(after, 0.35, 0.99);
    assert.ok(most <= 1.122 * Math.max(settled, fresh), `${STRINGS} to ${to}: ${most.toFixed(4)} against ${settled.toFixed(4)} settled, ${fresh.toFixed(4)} fresh (${was.toFixed(4)} before)`);
    assert.ok(loudest(after, 0.02, 0.2) > 0.25 * Math.min(was, fresh), `${STRINGS} to ${to}: plays on`);
  }
});

test('a switch made while the plugin is silent is made at once, and a held chord that had died away stays silent', () => {
  // Fledge Synth's Stab dies away under a held chord; back to your own sound (as an undo), the
  // chord came back out of silence (about 0.3)
  const STAB = 24;
  const { p } = makeProc(fledge, 'fledge', { program: STAB });
  chord(p);
  const died = render(p, 4);
  assert.ok(rms(died.subarray(died.length - 1280)) < 1e-5, 'died away');
  for (const m of [{ type: 'switch' }, { type: 'noProgram', asked: 1 }, ...ownValues.map((value, index) => ({ type: 'set', index, value })), { type: 'switched' }]) p.message(m);
  assert.equal(p.program(), -1, 'made at once');
  const back = render(p, 0.5);
  assert.ok(loudest(back, 0, 0.49) < 1e-4, `stays silent (${loudest(back, 0, 0.49).toFixed(5)})`);
  // A new chord on it plays, fading in from the switch's start where it falls inside it
  chord(p);
  const fresh = render(p, 0.5);
  assert.ok(rms(fresh.subarray(fresh.length - 4800)) > 0.03, 'a new chord plays');

  // The page's messages can reach the plugin with a render between them: none of it plays until
  // it is all there
  const q = makeProc(fledge, 'fledge', { program: STAB }).p;
  chord(q);
  render(q, 4);
  const msgs = [{ type: 'switch' }, { type: 'noProgram', asked: 1 }, ...ownValues.map((value, index) => ({ type: 'set', index, value })), { type: 'switched' }];
  const half = msgs.length >> 1;
  for (const m of msgs.slice(0, half)) q.message(m);
  const mid = render(q, 128 / sr);
  for (const m of msgs.slice(half)) q.message(m);
  const rest = render(q, 0.5);
  assert.ok(rms(mid) < 1e-4, 'nothing of it plays until it is all there');
  assert.ok(loudest(rest, 0, 0.49) < 1e-4, 'nor after');
  assert.equal(q.program(), -1);
});

test('Fledge Synth: a one-voice preset chosen on a held chord plays one note, no louder than it plays', () => {
  // 808 slide from your own sound: the chord's three notes went on, 4-6 dB over the preset's own level
  const SLIDE = 13;
  const { p } = makeProc(fledge, 'fledge');
  const r = through(p, [{ type: 'switch' }, { type: 'program', index: SLIDE, asked: 1 }, { type: 'switched' }]);
  const f = makeProc(fledge, 'fledge', { program: SLIDE }).p;
  render(f, 0.05);
  chord(f);
  const fresh = loudest(render(f, 1), 0, 0.99);
  assert.ok(r.first <= 1.122 * Math.max(r.settled, fresh), `first 60 ms ${r.first.toFixed(3)} against ${r.settled.toFixed(3)} settled, ${fresh.toFixed(3)} fresh`);
});

// --- The host: which changes are switches, and only while the context plays ---

const queue = [];
const sentToProc = [];
const later = (f) => queue.push(f);
const deliver = async () => {
  for (let n = 0; n < 2000 && queue.length; n++) {
    queue.shift()();
    await new Promise((r) => setImmediate(r));
  }
};
globalThis.window = globalThis;
globalThis.AudioWorkletNode = class {
  constructor(ctx, name, { processorOptions }) {
    this.port = {
      postMessage: (m) => {
        sentToProc.push(m.type);
        later(() => this.proc.port.onmessage({ data: m }));
      },
      onmessage: null,
    };
    toHost = (m) => later(() => this.port.onmessage?.({ data: m }));
    this.proc = new Proc({ processorOptions });
  }
};
const { createBuiltinInstance } = await import('../src/audio/plugins/builtinHost.ts');
const { editPluginParams } = await import('../src/store/pluginEdits.ts').catch(() => ({}));
const make = async (state, running) => {
  const ctx = { audioWorklet: { addModule: async () => {} }, sampleRate: sr, state: running ? 'running' : 'suspended' };
  const made = createBuiltinInstance(ctx, 'builtin:fledge/Fledge Synth', state);
  let done = false;
  made.then(
    () => (done = true),
    () => (done = true)
  );
  while (!done) {
    await deliver();
    await new Promise((r) => setTimeout(r, 1));
  }
  return made;
};
/** The messages the host sends while `act` runs */
const sends = async (act) => {
  await deliver();
  sentToProc.length = 0;
  await act();
  await deliver();
  return sentToProc.filter((t) => t !== 'describe' && t !== 'events');
};

test('the host: a preset, an undo of one, Reset all are switches (faded) while it plays; one knob is not', async () => {
  const inst = await make(undefined, true);
  const { controls, audioNode: node } = inst;
  const own = node.getStateNow();
  // A preset chosen
  assert.deepEqual(await sends(() => controls.setProgram(NEURO)), ['switch', 'program', 'switched']);
  const neuro = node.getStateNow();
  // Its undo: every setting back, no preset
  const undo = await sends(() => node.setState(own));
  assert.equal(undo[0], 'switch');
  assert.equal(undo.at(-1), 'switched');
  assert.ok(undo.filter((t) => t === 'set').length > 10);
  assert.ok(undo.includes('noProgram'));
  // Redo
  const redo = await sends(() => node.setState(neuro));
  assert.deepEqual([redo[0], redo[1], redo.at(-1)], ['switch', 'program', 'switched']);
  // An undo of one knob's turn: that knob alone, no fade (it moves as the knob does)
  const turned = { ...own, values: own.values.map((v, i) => (i === 0 ? 0.31 : v)) };
  await node.setState(turned);
  await deliver();
  const one = await sends(() => node.setState(own));
  assert.ok(one.length && one.every((t) => t === 'set'), `no switch for one knob: ${[...new Set(one)]}`);
  // Reset all (several at once)
  if (editPluginParams) {
    await node.setState(neuro);
    await deliver();
    const moves = controls.params().flatMap((p, i) => (p.value !== p.defaultValue ? [[i, p.defaultValue]] : [])).slice(0, 5);
    const reset = await sends(() => editPluginParams(controls, moves, undefined));
    assert.deepEqual([reset[0], reset.at(-1)], ['switch', 'switched']);
  }
});

test('the host: the Vocoder is made afresh in a switch, other plugins are not', async () => {
  const { FRESH_ON_SWITCH } = await import('../src/audio/plugins/paramLimits.ts');
  assert.ok(FRESH_ON_SWITCH.has('builtin:mda/Vocoder'));
  let opts = null;
  const Was = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class extends Was {
    constructor(ctx, name, o) {
      super(ctx, name, o);
      opts = o.processorOptions;
    }
  };
  try {
    await make(undefined, true);
    assert.equal(opts.freshOnSwitch, false, 'Fledge Synth goes on from where it was (its own settle)');
  } finally {
    globalThis.AudioWorkletNode = Was;
  }
});

test('the host: in a context that is not playing (an offline render a script holds paused), no fade is asked for', async () => {
  const inst = await make(undefined, false);
  assert.deepEqual(await sends(() => inst.controls.setProgram(NEURO)), ['program']);
  const undo = await sends(() => inst.audioNode.setState({ builtin: 1, values: ownValues }));
  assert.ok(!undo.includes('switch') && !undo.includes('switched'));
});
