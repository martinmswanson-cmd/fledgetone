// Fledge Synth's built module (public/fledgetone-plugins/fledge.wasm) as the app plays it: a
// mono riff that repeats each bar, given the song position with each note as the host gives it,
// comes back the same each time round ("Mono restart"); new sounds keep the low end in the middle
// up to 180 Hz ("Mono below"); older saved sounds and the older presets keep how they sounded
// (running on, 120 Hz). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { instance: { exports: e } } = await WebAssembly.instantiate(readFileSync(new URL('../public/fledgetone-plugins/fledge.wasm', import.meta.url)));
const text = (p) => {
  const m = new Uint8Array(e.memory.buffer);
  let end = p;
  while (m[end]) end++;
  return Buffer.from(m.subarray(p, end)).toString('utf8');
};
const SR = 48000;
const make = () => {
  const h = e.bb_create(0, SR);
  const index = new Map();
  for (let i = 0; i < e.bb_params(h); i++) index.set(text(e.bb_param_name(h, i)), i);
  const programs = Array.from({ length: e.bb_programs(h) }, (_, p) => text(e.bb_program_name(h, p)));
  const shown = (name) => text(e.bb_param_display(h, index.get(name)));
  return { h, index, programs, shown };
};

test('a new sound restarts its mono notes and keeps the lows in the middle up to 180 Hz; older ones as they were', () => {
  const s = make();
  assert.equal(s.shown('Mono restart'), 'on');
  assert.match(s.shown('Mono below'), /^18\d Hz$/);
  // A saved sound from before these settings came (fewer values): as it sounded then
  e.bb_legacy(s.h, s.index.get('Mono restart'));
  assert.equal(s.shown('Mono restart'), 'off');
  assert.equal(s.shown('Mono below'), '120 Hz');
  // An older preset keeps its sound; a new one has both
  e.bb_set_program(s.h, s.programs.indexOf('Bass/Growl'));
  assert.equal(s.shown('Mono restart'), 'off');
  assert.equal(s.shown('Mono below'), '120 Hz');
  e.bb_set_program(s.h, s.programs.indexOf('Bass/Neuro Reese'));
  assert.equal(s.shown('Mono restart'), 'on');
  e.bb_set_program(s.h, s.programs.indexOf('Pad/Wide Wash'));
  assert.equal(s.shown('Mono below'), '250 Hz');
  e.bb_destroy(s.h);
});

test('a new sound takes its note random values by step; older saved sounds and presets by pitch, as they did', () => {
  const s = make();
  assert.equal(s.shown('Random by step'), 'on');
  // Saved before it came (with or without Mono restart and Mono below): by pitch, as it sounded
  e.bb_legacy(s.h, s.index.get('Random by step'));
  assert.equal(s.shown('Random by step'), 'off');
  e.bb_set_program(s.h, s.programs.indexOf('Bass/Neuro Reese'));
  assert.equal(s.shown('Random by step'), 'on');
  e.bb_legacy(s.h, s.index.get('Mono restart'));
  assert.equal(s.shown('Random by step'), 'off');
  e.bb_set_program(s.h, s.programs.indexOf('Bass/Growl'));
  assert.equal(s.shown('Random by step'), 'off');
  e.bb_destroy(s.h);
});

test('a mono riff that repeats each bar sounds the same each time round, as the host plays it', () => {
  // 120 BPM: a 16th is 6000 samples, so each bar starts on the same sample of a 128-sample block
  const riff = [41, 41, 53, 41, 44, 41, 48, 41, 41, 53, 51, 41, 46, 41, 39, 41];
  const play = (preset, restart) => {
    const s = make();
    e.bb_set_program(s.h, s.programs.indexOf(preset));
    if (restart !== undefined) e.bb_set(s.h, s.index.get('Mono restart'), restart ? 1 : 0);
    e.bb_tempo(s.h, 120);
    const out = new Float32Array(16 * 6000 * 5);
    let at = 0;
    for (let step = 0; step < 16 * 5; step++) {
      const n = riff[step % 16];
      e.bb_position(s.h, step / 4);
      e.bb_midi(s.h, 0x90, n, 100);
      for (let k = 0; k < 6000; ) {
        const len = Math.min(128, 4500 - k > 0 ? 4500 - k : 6000 - k);
        e.bb_process(s.h, len);
        out.set(new Float32Array(e.memory.buffer, e.bb_buffer(s.h, 2), len), at);
        at += len;
        k += len;
        if (k === 4500) e.bb_midi(s.h, 0x80, n, 0);
      }
    }
    e.bb_destroy(s.h);
    return out;
  };
  const unlike = (x, a, b) => {
    const bar = 16 * 6000;
    let d = 0, t = 0;
    for (let i = 0; i < bar; i++) {
      d += (x[a * bar + i] - x[b * bar + i]) ** 2;
      t += x[a * bar + i] ** 2;
    }
    return d / t;
  };
  // (Bar 2 against bar 4: the presets' slow sweep takes two bars to come round. Not Neuro Reese:
  // its phaser sweeps at its own rate in Hz, not the song's)
  for (const preset of ['Bass/Talking Growl', 'Bass/Riddim Cell', 'Bass/Dive Screech']) {
    assert.ok(unlike(play(preset), 1, 3) < 1e-6, `${preset} comes round the same`);
    assert.ok(unlike(play(preset, false), 1, 3) > 1e-3, `${preset} running on drifts`);
  }
});
