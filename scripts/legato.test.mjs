// Legato on the mono instruments (src/audio/legato.ts): overlapping notes join and touching ones
// stay separate, the plugin host's note order, and the piano roll's Legato tool writing notes that
// run into the next.
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

test('a note joins the last one only when it overlaps it; touching notes stay separate', () => {
  assert.equal(L.joinsNote(1, 1.5), true); // overlapping
  assert.equal(L.joinsNote(1, 1), false); // touching: a new note (a bassline of 8ths keeps its rhythm)
  assert.equal(L.joinsNote(0.9995, 1), false); // a hair before (bars to seconds): still touching
  assert.equal(L.joinsNote(1.002, 1), false); // a gap
  assert.equal(L.joinsNote(0, -Infinity), false); // the first note
});

test('the plugin host keeps notes in time order: an overlapping note-on comes before the last note-off by itself', () => {
  const plain = [];
  for (const e of [on(60, 0), off(60, 1), on(62, 1)]) L.insertTimedEvent(plain, e, 0);
  assert.deepEqual(order(plain), ['on60', 'off60', 'on62']);
  const over = [];
  for (const e of [on(60, 0), off(60, 1.02), on(62, 1)]) L.insertTimedEvent(over, e, 0);
  assert.deepEqual(order(over), ['on60', 'on62', 'off60']);
});

test('notes that only touch stay apart whichever way the rounding fell: the note-off first', () => {
  // The last note's end a hair after the next one's start (bar positions become seconds), queued
  // either way round
  const late = [];
  for (const e of [on(60, 0), off(60, 1 + 1e-12), on(62, 1)]) L.insertTimedEvent(late, e, 0);
  assert.deepEqual(order(late), ['on60', 'off60', 'on62']);
  const early = [];
  for (const e of [on(60, 0), on(62, 1), off(60, 1 + 1e-12)]) L.insertTimedEvent(early, e, 0);
  assert.deepEqual(order(early), ['on60', 'off60', 'on62']);
  const before = [];
  for (const e of [on(60, 0), on(62, 1 - 1e-12), off(60, 1)]) L.insertTimedEvent(before, e, 0);
  assert.deepEqual(order(before), ['on60', 'off60', 'on62']);
  // (The same pitch again, end to end: the old one ends, the new one sounds)
  const again = [];
  for (const e of [on(60, 0), off(60, 1 + 1e-12), on(60, 1)]) L.insertTimedEvent(again, e, 0);
  assert.deepEqual(order(again), ['on60', 'off60', 'on60']);
});

test("the Legato tool's notes run into the next note, so a mono synth glides", () => {
  const N = (id, note, start) => ({ id, note, startOffset: start, duration: '16n', velocity: 0.8 });
  const l = T.legato([N('a', 'C4', 0), N('b', 'D4', 0.1003), N('c', 'E4', 0.5)], 1);
  // Past the next note's start (an overlap), by about a 64th
  assert.ok(durationToBars(l[0].duration) > 0.1003 + 1 / 128);
  assert.ok(durationToBars(l[0].duration) < 0.1003 + 1 / 64 + 1 / 768 + 1e-9);
  assert.ok(durationToBars(l[1].duration) > 0.5 - 0.1003);
  // The last one to the clip's end, not past it
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

test("Fledge Synth in Legato mode glides through the Legato tool's overlapping notes, and strikes touching ones again", async () => {
  globalThis.__proc = await import('../src/audio/plugins/processor.ts');
  globalThis.__families = (await import('../src/audio/plugins/pluginCatalog.ts')).PLUGIN_FAMILIES;
  globalThis.__presets = (await import('../src/audio/plugins/fledgeMacros.ts')).FLEDGE_PRESETS;
  const at = (s) => Math.round(s / 0.005);
  // Lead/Sync is a Legato preset: joined, its second note glides in with no new attack
  for (const [preset, a, b] of [['Lead/Sync', 72, 74]]) {
    const overlapping = renderFledge(preset, [[a, 0.1, 0.63], [b, 0.6, 1.1]], 1.2);
    const touching = renderFledge(preset, [[a, 0.1, 0.6], [b, 0.6, 1.1]], 1.2);
    const worst = Math.max(...touching.slice(at(0.6), at(1.05)).map((v, i) => Math.abs(v - overlapping[at(0.6) + i])));
    assert.ok(worst > 0.5, `${preset}: touching notes start again (${worst.toFixed(2)} dB from the joined ones)`);
  }
});
