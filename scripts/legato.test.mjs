// Legato on the mono instruments (src/audio/legato.ts): touching notes join, the plugin host's
// note order for Fledge Synth, and the piano roll's Legato tool writing notes that reach the next.
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
const L = await import('../src/audio/legato.ts');
const T = await import('../src/store/noteTools.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');

const on = (n, time) => ({ type: 'wam-midi', time, data: { bytes: [0x90, n, 100] } });
const off = (n, time) => ({ type: 'wam-midi', time, data: { bytes: [0x80, n, 0] } });
const order = (events) => events.map((e) => `${(e.data.bytes[0] & 0xf0) === 0x90 && e.data.bytes[2] ? 'on' : 'off'}${e.data.bytes[1]}`);

test('a note joins the last one when it starts before its end, or within a millisecond after', () => {
  assert.equal(L.joinsNote(1, 1.5), true); // overlapping
  assert.equal(L.joinsNote(1, 1), true); // touching
  assert.equal(L.joinsNote(1.0008, 1), true); // a hair after (bars to seconds)
  assert.equal(L.joinsNote(1.002, 1), false); // a gap
  assert.equal(L.joinsNote(0, -Infinity), false); // the first note
});

test('touching notes reach a legato plugin with the next note-on ahead of the last note-off', () => {
  // Sent as the scheduler does: each note's on and off together, one note after another
  const joined = [];
  for (const e of [on(60, 0), off(60, 1), on(62, 1), off(62, 2), on(62, 2.0005), off(62, 3)]) L.insertTimedEvent(joined, e, L.LEGATO_JOIN);
  assert.deepEqual(order(joined), ['on60', 'on62', 'off60', 'on62', 'off62', 'off62']);
  // The other way round (an off sent after the on it touches) comes out the same
  const late = [];
  for (const e of [on(60, 0), on(62, 1), off(60, 1)]) L.insertTimedEvent(late, e, L.LEGATO_JOIN);
  assert.deepEqual(order(late), ['on60', 'on62', 'off60']);
  // A real gap, and every other plugin: plain time order
  const gap = [];
  for (const e of [on(60, 0), off(60, 1), on(62, 1.01)]) L.insertTimedEvent(gap, e, L.LEGATO_JOIN);
  assert.deepEqual(order(gap), ['on60', 'off60', 'on62']);
  const plain = [];
  for (const e of [on(60, 0), off(60, 1), on(62, 1)]) L.insertTimedEvent(plain, e, 0);
  assert.deepEqual(order(plain), ['on60', 'off60', 'on62']);
});

test("the Legato tool's notes reach the next note, never short of it", () => {
  const N = (id, note, start) => ({ id, note, startOffset: start, duration: '16n', velocity: 0.8 });
  // Off the tick grid (a hand-placed note): rounded up to the next tick
  const l = T.legato([N('a', 'C4', 0), N('b', 'D4', 0.1003), N('c', 'E4', 0.5)], 1);
  assert.ok(durationToBars(l[0].duration) >= 0.1003);
  assert.ok(durationToBars(l[0].duration) - 0.1003 < 1 / 768 + 1e-9);
  assert.ok(durationToBars(l[1].duration) >= 0.5 - 0.1003);
  assert.equal(durationToBars(l[2].duration), 0.5);
});

/** Fledge Synth through the plugin processor, with notes as the host sends them; its output's level every 5 ms. */
function renderFledge(preset, notes, seconds) {
  const sr = 48000;
  const { BUILTIN_PROCESSOR_SOURCE } = globalThis.__proc;
  let Proc;
  const g = { sampleRate: sr, currentFrame: 0, AudioWorkletProcessor: class { constructor() { this.port = { postMessage: () => {} }; } }, registerProcessor: (_, c) => (Proc = c), console: { log() {} } };
  new Function('g', `with (g) { ${BUILTIN_PROCESSOR_SOURCE} }`)(g);
  const fam = globalThis.__families.find((f) => f.family === 'fledge');
  const module = new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${fam.file}`, import.meta.url)));
  const p = new Proc({ processorOptions: { family: 'fledge', module, index: 0, program: globalThis.__presets.indexOf(preset) } });
  p.message({ type: 'events', events: notes.flatMap(([n, a, b]) => [on(n, a), off(n, b)]) });
  const env = [];
  let e = 0, k = 0;
  for (let f = 0; f < seconds * sr; f += 128) {
    g.currentFrame = f;
    const oL = new Float32Array(128), oR = new Float32Array(128);
    p.process([], [[oL, oR]]);
    for (let i = 0; i < 128; i++) {
      e += oL[i] ** 2;
      if (++k === 240) { env.push(10 * Math.log10(e / k + 1e-20)); e = 0; k = 0; }
    }
  }
  return env;
}

test('Fledge Synth in Legato mode joins a note drawn right where the last one ends, as it does an overlapping one', async () => {
  globalThis.__proc = await import('../src/audio/plugins/processor.ts');
  globalThis.__families = (await import('../src/audio/plugins/pluginCatalog.ts')).PLUGIN_FAMILIES;
  globalThis.__presets = (await import('../src/audio/plugins/fledgeMacros.ts')).FLEDGE_PRESETS;
  const at = (s) => Math.round(s / 0.005);
  // Lead/Sync and Bass/Detune are Legato presets. Touching notes (the next starting where the last
  // ends) must sound like overlapping ones: a glide, or a tie on the same pitch, with no new attack
  for (const [preset, a, b] of [['Lead/Sync', 72, 74], ['Bass/Detune', 36, 36]]) {
    const touching = renderFledge(preset, [[a, 0.1, 0.6], [b, 0.6, 1.1]], 1.2);
    const overlapping = renderFledge(preset, [[a, 0.1, 0.62], [b, 0.6, 1.1]], 1.2);
    const worst = Math.max(...touching.slice(at(0.6), at(1.05)).map((v, i) => Math.abs(v - overlapping[at(0.6) + i])));
    assert.ok(worst < 0.5, `${preset}: touching notes sound as overlapping ones do (${worst.toFixed(2)} dB apart)`);
  }
});
