// Fledge Synth through the built-in plugin processor (processor.ts): an older saved sound (fewer
// values) loads as it sounded (its sub with the voices), a new one gets the clean sub; and once
// the host says where in the song each note is, a synth that has been playing for a while and a
// fresh one (live and an export) play the same notes identically. Run with `npm test`.
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

const { BUILTIN_PROCESSOR_SOURCE } = await import('../src/audio/plugins/processor.ts');
const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');
const M = await import('../src/audio/plugins/fledgeMacros.ts');
const sr = 48000;
let Proc;
const sent = [];
const g = {
  sampleRate: sr,
  currentFrame: 0,
  AudioWorkletProcessor: class {
    constructor() {
      this.port = { postMessage: (m) => sent.push(m) };
    }
  },
  registerProcessor: (_, c) => (Proc = c),
  console: { log() {} },
};
new Function(...Object.keys(g), BUILTIN_PROCESSOR_SOURCE)(...Object.values(g));
const fam = PLUGIN_FAMILIES.find((f) => f.family === 'fledge');
const module = new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${fam.file}`, import.meta.url)));
/** The number of parameters Fledge Synth had before the per-note movement work */
const OLD_COUNT = 215;

const make = (opts = {}) => {
  sent.length = 0;
  const p = new Proc({ processorOptions: { family: 'fledge', module, index: 0, ...opts } });
  const ready = sent.find((m) => m.type === 'ready');
  assert.ok(ready, 'the synth started');
  return { p, ready };
};
const text = (ready, name) => ready.params.find((x) => x.name === name)?.text;

test('an older saved sound keeps its sub with the voices; a new one gets the clean sub', () => {
  const { ready: fresh } = make();
  assert.ok(fresh.params.length > OLD_COUNT);
  assert.equal(text(fresh, 'Sub path'), 'Clean, after effects');
  // An old file's values: as many as there were then
  const old = fresh.params.slice(0, OLD_COUNT).map((x) => x.value);
  const { ready: loaded } = make({ values: old });
  assert.equal(text(loaded, 'Sub path'), 'With the voices');
  // An old file with a preset chosen
  const { ready: wobble } = make({ program: M.FLEDGE_PRESETS.indexOf('Bass/Wobble'), values: old });
  assert.equal(text(wobble, 'Sub path'), 'With the voices');
  // A sound saved now keeps what it says
  const { ready: now } = make({ values: fresh.params.map((x) => x.value) });
  assert.equal(text(now, 'Sub path'), 'Clean, after effects');
  // And loading an old sound into a synth already open (setState) does the same
  const { p } = make();
  sent.length = 0;
  p.message({ type: 'legacy', id: 7, count: OLD_COUNT });
  const reply = sent.find((m) => m.type === 'params' && m.id === 7);
  assert.equal(reply.params.find((x) => x.name === 'Sub path').text, 'With the voices');
});

test('the old presets keep their sub with the voices; the new ones are clean', () => {
  for (const [i, name] of M.FLEDGE_PRESETS.entries()) {
    const { ready } = make({ program: i });
    const want = i < 35 ? 'With the voices' : 'Clean, after effects';
    assert.equal(text(ready, 'Sub path'), want, name);
  }
});

test('with the song position, a synth that has played before and a fresh one sound the same', () => {
  // (Each processor reads the frame counter its source was made with: one source per synth)
  const run = (history) => {
    let P;
    const scope = { ...g, currentFrame: 0, registerProcessor: (_, c) => (P = c) };
    const holder = { scope };
    const src = BUILTIN_PROCESSOR_SOURCE.replace(/\bcurrentFrame\b/g, 'holder.scope.currentFrame');
    new Function('holder', ...Object.keys(scope), src)(holder, ...Object.values(scope));
    sent.length = 0;
    const p = new P({ processorOptions: { family: 'fledge', module, index: 0, program: M.FLEDGE_PRESETS.indexOf('Bass/Talking Growl') } });
    let frame = 0;
    const step = () => {
      holder.scope.currentFrame = frame;
      p.process([], [[new Float32Array(128), new Float32Array(128)]]);
      frame += 128;
    };
    if (history) {
      p.message({ type: 'events', events: [{ type: 'wam-midi', time: 0.01, data: { bytes: [0x90, 50, 90] } }, { type: 'wam-midi', time: 0.6, data: { bytes: [0x80, 50, 0] } }] });
      // (Then 4 s of silence: the OTT forgets what it heard, as it does after any long rest)
      for (let i = 0; i < 1700; i++) step();
    } else for (let i = 0; i < 200; i++) step();
    // The same notes, from where each one is
    const out = [];
    const six = 60 / 140 / 4;
    const at = frame;
    const notes = [36, 43, 48, 36, 39, 36, 46, 41];
    const events = [];
    notes.forEach((n, i) => {
      const t = (at + Math.round(i * six * sr)) / sr;
      events.push({ type: 'wam-transport', time: t, data: { tempo: 140, playing: true, beat: 32 + i / 4 } });
      events.push({ type: 'wam-midi', time: t, data: { bytes: [0x90, n, 100] } });
      events.push({ type: 'wam-midi', time: t + six * 0.8, data: { bytes: [0x80, n, 0] } });
    });
    p.message({ type: 'events', events });
    for (let b = 0; b < Math.ceil((notes.length * six * sr) / 128); b++) {
      holder.scope.currentFrame = frame;
      const L = new Float32Array(128), R = new Float32Array(128);
      p.process([], [[L, R]]);
      out.push(...L);
      frame += 128;
    }
    return out;
  };
  const live = run(true);
  const exported = run(false);
  let worst = 0;
  for (let i = 0; i < live.length; i++) worst = Math.max(worst, Math.abs(live[i] - exported[i]));
  assert.ok(Math.max(...exported.map(Math.abs)) > 0.05, 'it plays');
  assert.ok(worst < 1e-4, `live and export differ by ${worst}`);
  assert.deepEqual(run(false), exported, 'an export repeats exactly');
});

