// An effect that follows the song (processor.ts): Fledge Repeat is told the tempo and the position
// with `wam-transport` events, fills the end of each bar by itself while the song plays, and stops
// doing so when it's told the song has stopped. Run with `npm test`.
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

const sr = 48000;
const scope = { sampleRate: sr, currentFrame: 0 };
const sent = [];
let Proc;
new Function('scope', 'sampleRate', 'AudioWorkletProcessor', 'registerProcessor', 'console', BUILTIN_PROCESSOR_SOURCE.replace(/\bcurrentFrame\b/g, 'scope.currentFrame'))(
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
const family = PLUGIN_FAMILIES.find((f) => f.family === 'fledge-repeat');
const module = new WebAssembly.Module(fs.readFileSync(new URL(`../public/fledgetone-plugins/${family.file}`, import.meta.url)));
// Every 1 bar, for 1/4, 16ths (each choice's middle value)
const FILL_EVERY_BAR = [0, 0.3, 0.3, 0.4375, 1, 0, 0.5, 1, 1];
// A beat that is a whole number of render blocks (192 of 128 frames), so the test can say where
// the song is exactly on each: 117.1875 BPM
const BPM = 117.1875;
const BEAT = 24576;

/** A sound that is never the same twice. */
const sound = (frame) => 0.3 * Math.sin(frame * 0.01) + 0.2 * (((frame % 977) / 977) - 0.5);

/** Play `beats` beats through it, the host saying where the song is on each (or nothing, if `told` is false); which beats came out changed. */
function play(p, beats, told = true, from = 0) {
  const changed = [];
  for (let b = 0; b < beats; b++) {
    if (told) p.message({ type: 'events', events: [{ type: 'wam-transport', time: scope.currentFrame / sr, data: { tempo: BPM, playing: true, beat: from + b } }] });
    let differs = false;
    for (let k = 0; k < BEAT / 128; k++) {
      const x = Float32Array.from({ length: 128 }, (_, i) => sound(scope.currentFrame + i));
      const out = [new Float32Array(128), new Float32Array(128)];
      p.process([[x, x]], [out]);
      assert.ok(out[0].every(Number.isFinite));
      for (let i = 0; i < 128; i++) if (Math.abs(out[0][i] - x[i]) > 1e-5) differs = true;
      scope.currentFrame += 128;
    }
    if (differs) changed.push(b + 1);
  }
  return changed;
}

test('the catalog says which effects follow the song', () => {
  assert.equal(family.plugins[0].transport, true);
  assert.ok(!PLUGIN_FAMILIES.find((f) => f.family === 'fledge-compressor').plugins[0].transport);
});

test('a beat repeat fills the last beat of each bar while the song plays, and only then', () => {
  scope.currentFrame = 0;
  const p = new Proc({ processorOptions: { family: 'fledge-repeat', module, index: 0, values: FILL_EVERY_BAR, outputGain: 1, limits: null } });
  assert.ok(sent.find((m) => m.type === 'ready'));
  // Before the song has played, it has no position to follow: the track untouched
  assert.deepEqual(play(p, 8, false), []);
  // Playing from the song's start: the 4th beat of each bar is a fill
  assert.deepEqual(play(p, 12), [4, 8, 12]);
  // The song stops: nothing more by itself, even into what would have been a fill
  p.message({ type: 'events', events: [{ type: 'wam-transport', time: scope.currentFrame / sr, data: { tempo: BPM, playing: false } }] });
  assert.deepEqual(play(p, 8, false), []);
  // ...and from a bar's third beat when it plays again
  assert.deepEqual(play(p, 6, true, 2), [2, 6]);
  p.message({ type: 'destroy' });
});

test('the same song gives the same fills every time', () => {
  const render = () => {
    scope.currentFrame = 0;
    const p = new Proc({ processorOptions: { family: 'fledge-repeat', module, index: 0, values: [0, 0.3, 0.3, 0.6875, 0.6, 0.2, 0.46, 0.5, 1], outputGain: 1, limits: null } });
    const all = [];
    for (let b = 0; b < 16; b++) {
      p.message({ type: 'events', events: [{ type: 'wam-transport', time: scope.currentFrame / sr, data: { tempo: BPM, playing: true, beat: b } }] });
      for (let k = 0; k < BEAT / 128; k++) {
        const x = Float32Array.from({ length: 128 }, (_, i) => sound(scope.currentFrame + i));
        const out = [new Float32Array(128), new Float32Array(128)];
        p.process([[x, x]], [out]);
        all.push(...out[0]);
        scope.currentFrame += 128;
      }
    }
    p.message({ type: 'destroy' });
    return all;
  };
  assert.deepEqual(render(), render());
});
