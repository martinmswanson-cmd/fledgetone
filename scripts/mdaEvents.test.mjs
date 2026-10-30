// The mda instruments (JX10, DX10, EPiano, Piano) get every MIDI message of a block: they start
// their list of the block's notes afresh on each processEvents call, so bb_mda.cpp hands them all
// of a block's messages at once. A chord plays every note, a note that ends where the next starts
// is released, a controller on a note's last block doesn't lose its note-off, and all-notes-off
// fades out instead of cutting the voices dead (a note during the fade waits for the quiet). A burst of
// messages loses no note-off, Reset All Controllers puts them back as fresh, and a loud Piano chord
// plays through with no sample zeroed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RATE = 44100;
const file = process.env.MDA_WASM || new URL('../public/fledgetone-plugins/mda.wasm', import.meta.url);
const mod = await WebAssembly.compile(readFileSync(file));
const imports = {};
for (const i of WebAssembly.Module.imports(mod)) (imports[i.module] ??= {})[i.name] = () => 0;
// Writing text must say it wrote it, as the app's processor does (the Piano prints when a loud chord
// goes over its limit), or the C runtime retries forever
let e;
imports.wasi_snapshot_preview1.fd_write = (fd, iovs, count, written) => {
  const view = new DataView(e.memory.buffer);
  let total = 0;
  for (let k = 0; k < count; k++) total += view.getUint32(iovs + k * 8 + 4, true);
  view.setUint32(written, total, true);
  return 0;
};
({ exports: e } = await WebAssembly.instantiate(mod, imports));
e._initialize?.();
const text = (p) => {
  const m = new Uint8Array(e.memory.buffer);
  let end = p;
  while (m[end]) end++;
  return Buffer.from(m.subarray(p, end)).toString('utf8');
};
const names = [];
for (let i = 0; i < e.bb_count(); i++) names.push(JSON.parse(text(e.bb_info(i))).name);

/** A fresh instrument and a way to render it, block by block, after sending messages */
function synth(name) {
  const h = e.bb_create(names.indexOf(name), RATE);
  const out = [];
  return {
    midi: (...m) => e.bb_midi(h, ...m),
    /** Render `blocks` blocks of 128; returns their left channel */
    render(blocks) {
      const got = new Float32Array(blocks * 128);
      for (let b = 0; b < blocks; b++) {
        e.bb_process(h, 128);
        got.set(new Float32Array(e.memory.buffer, e.bb_buffer(h, 2), 128), b * 128);
      }
      out.push(got);
      return got;
    },
    done: () => e.bb_destroy(h),
  };
}
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const seconds = (s) => Math.ceil((s * RATE) / 128);
const INSTRUMENTS = ['JX10', 'DX10', 'EPiano', 'Piano'];

test('mda instruments: a chord plays every note, not just its top one', () => {
  for (const name of INSTRUMENTS) {
    const chord = synth(name);
    for (const n of [60, 64, 67]) chord.midi(0x90, n, 100);
    const a = chord.render(seconds(0.5));
    chord.done();
    const top = synth(name);
    top.midi(0x90, 67, 100);
    const b = top.render(seconds(0.5));
    top.done();
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
    assert.ok(diff > 0.01, `${name}: the chord sounds like its top note alone (${diff})`);
  }
});

test('mda instruments: a note ending where the next starts is released', () => {
  for (const name of INSTRUMENTS) {
    const s = synth(name);
    s.midi(0x90, 60, 100);
    s.render(seconds(0.3));
    // Legato: the first note's end and the next's start in one block
    s.midi(0x80, 60, 0);
    s.midi(0x90, 62, 100);
    s.render(seconds(0.3));
    s.midi(0x80, 62, 0);
    s.render(seconds(8));
    const tail = peak(s.render(seconds(0.2)));
    s.done();
    assert.ok(tail < 1e-4, `${name}: still sounding ${tail} after both notes ended`);
  }
});

test("mda instruments: a controller on a note's last block doesn't keep it sounding", () => {
  for (const name of INSTRUMENTS) {
    const s = synth(name);
    s.midi(0x90, 60, 100);
    s.render(seconds(0.3));
    s.midi(0x80, 60, 0);
    s.midi(0xb0, 1, 40);
    s.render(seconds(8));
    const tail = peak(s.render(seconds(0.2)));
    s.done();
    assert.ok(tail < 1e-4, `${name}: still sounding ${tail} after its note ended`);
  }
});

test('mda instruments: all-notes-off fades out, then the next note plays', () => {
  for (const name of INSTRUMENTS) {
    const s = synth(name);
    for (const n of [48, 60, 64, 67]) s.midi(0x90, n, 120);
    const before = s.render(seconds(0.3));
    const level = peak(before.subarray(before.length - 1024));
    s.midi(0xb0, 64, 0);
    s.midi(0xb0, 123, 0);
    const after = s.render(seconds(0.1));
    // About 10 ms down to nothing: no sample far louder than the faded level allows
    const fade = Math.round(0.01 * RATE);
    for (let i = 0; i < after.length; i++) {
      const allowed = i <= fade + 1 ? level * 1.5 * (1 - i / (fade + 2)) + 1e-3 : 1e-4;
      assert.ok(Math.abs(after[i]) <= allowed, `${name}: ${after[i]} at ${i} after all-notes-off`);
    }
    s.midi(0x90, 60, 100);
    assert.ok(peak(s.render(seconds(0.2))) > 0.01, `${name}: silent after all-notes-off`);
    s.done();
  }
});

test('mda Piano: a loud chord plays through, with no sample zeroed (a click) where its sum goes over 2', () => {
  // (Upstream zeroes the sample and prints there; mda/mdaPiano-loud.patch keeps it, dropping only NaN)
  for (let program = 0; program < 8; program++) {
    const h = e.bb_create(names.indexOf('Piano'), RATE);
    e.bb_set_program(h, program);
    for (const n of [36, 48, 55, 60, 64, 67]) e.bb_midi(h, 0x90, n, 127);
    const got = [];
    for (let b = 0; b < seconds(1); b++) {
      e.bb_process(h, 128);
      got.push(...new Float32Array(e.memory.buffer, e.bb_buffer(h, 2), 128));
    }
    e.bb_destroy(h);
    // Away from its attack: its largest step from one sample to the next is a fraction of its level
    // (a sample zeroed would step by the whole of it)
    const settled = got.slice(4410);
    let step = 0;
    for (let i = 1; i < settled.length; i++) step = Math.max(step, Math.abs(settled[i] - settled[i - 1]));
    const loud = Math.max(...settled.map(Math.abs));
    for (let i = 4411; i < got.length; i++) {
      // A sample dropped to 0 among loud ones is a click
      assert.ok(!(got[i] === 0 && Math.abs(got[i - 1]) > 0.2 * loud), `program ${program}: sample ${i} zeroed`);
    }
    assert.ok(step < 0.5 * loud, `program ${program}: a step of ${step} at a level of ${loud}`);
    assert.ok(loud > 0.5, `program ${program}: plays (${loud})`);
  }
});

test('mda instruments: a note during the fade after all-notes-off waits for the quiet, then plays from silence', () => {
  const quiet = Math.round(0.01 * RATE) + 1 + Math.round(0.03 * RATE) + 1;
  for (const name of INSTRUMENTS) {
    for (const wait of [0, 1, 4, 8]) {
      const s = synth(name);
      for (const n of [48, 60, 64, 67]) s.midi(0x90, n, 120);
      const before = s.render(seconds(0.5));
      const level = peak(before.subarray(before.length - 1024));
      for (const n of [48, 60, 64, 67]) s.midi(0x80, n, 0);
      s.midi(0xb0, 123, 0);
      const pre = s.render(wait);
      s.midi(0x90, 72, 100);
      const post = s.render(seconds(0.2));
      s.done();
      const all = new Float32Array(pre.length + post.length);
      all.set(pre);
      all.set(post, pre.length);
      // The fade goes on down (never back up at once), then nothing until the quiet ends
      const fade = Math.round(0.01 * RATE);
      for (let i = 0; i < quiet - 1; i++) {
        const allowed = i <= fade + 1 ? level * 1.5 * (1 - i / (fade + 2)) + 1e-3 : 0;
        assert.ok(Math.abs(all[i]) <= allowed, `${name} (note after ${wait} blocks): ${all[i]} at ${i}`);
      }
      // and the note plays from there, 40 ms after the reset at most
      assert.ok(quiet <= 0.0405 * RATE, `the quiet lasts ${quiet / RATE} s`);
      assert.ok(peak(all.subarray(quiet)) > 0.01, `${name} (note after ${wait} blocks): the note never played`);
      let step = 0;
      for (let i = quiet - 2; i < quiet + 3; i++) step = Math.max(step, Math.abs(all[i + 1] - all[i]));
      assert.ok(step < 0.25, `${name} (note after ${wait} blocks): a jump of ${step} as the note starts`);
    }
  }
});

test('mda instruments: a burst of 300 controllers before a note-off still ends the note', () => {
  for (const name of INSTRUMENTS) {
    const s = synth(name);
    s.midi(0x90, 60, 100);
    s.render(20);
    for (let i = 0; i < 300; i++) s.midi(0xb0, 1, (i * 7) % 128);
    s.midi(0x80, 60, 0);
    s.render(seconds(8));
    const tail = peak(s.render(seconds(0.2)));
    s.done();
    assert.ok(tail < 1e-4, `${name}: still sounding ${tail} after its note-off`);
  }
});

test('mda instruments: more notes in a block than they keep (40) all go in, the rest a block later', () => {
  for (const name of INSTRUMENTS) {
    const s = synth(name);
    for (let n = 60; n < 68; n++) s.midi(0x90, n, 100);
    s.render(seconds(0.3));
    // 48 note-offs in one block: 40 for notes not playing, then the 8 that are
    for (let n = 80; n < 120; n++) s.midi(0x80, n, 0);
    for (let n = 60; n < 68; n++) s.midi(0x80, n, 0);
    s.render(seconds(8));
    const tail = peak(s.render(seconds(0.2)));
    s.done();
    assert.ok(tail < 1e-4, `${name}: still sounding ${tail} after every note-off`);
  }
});

test('mda instruments: Reset All Controllers (CC 121) puts every controller back as a fresh one has it', () => {
  const moves = [
    [0xb0, 1, 127],
    [0xb0, 2, 90],
    [0xb0, 3, 50],
    [0xb0, 7, 30],
    [0xb0, 16, 120],
    [0xb0, 71, 10],
    [0xb0, 74, 127],
    [0xd0, 100, 0],
    [0xe0, 0, 100],
  ];
  for (const name of INSTRUMENTS) {
    for (let program = 0; program < 3; program++) {
      const make = () => {
        const h = e.bb_create(names.indexOf(name), RATE);
        e.bb_set_program(h, program);
        return h;
      };
      const play = (h) => {
        e.bb_midi(h, 0x90, 60, 100);
        const got = [];
        for (let b = 0; b < seconds(0.5); b++) {
          e.bb_process(h, 128);
          got.push(...new Float32Array(e.memory.buffer, e.bb_buffer(h, 2), 128));
        }
        e.bb_destroy(h);
        return got;
      };
      const fresh = play(make());
      const moved = make();
      for (const m of moves) e.bb_midi(moved, ...m);
      e.bb_process(moved, 128);
      // (A block for the moves, as a fresh one gets: compared from the note on)
      const reference = make();
      e.bb_process(reference, 128);
      e.bb_midi(moved, 0xb0, 121, 0);
      const a = play(moved);
      const b = play(reference);
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff = Math.max(diff, Math.abs(a[i] - b[i]));
      assert.equal(diff, 0, `${name} program ${program}: not as fresh after CC 121 (off by ${diff})`);
      assert.ok(peak(fresh) > 0.01);
    }
  }
});

test('mda instruments: Reset All Controllers lets go of the notes the pedal held', () => {
  for (const name of INSTRUMENTS) {
    const s = synth(name);
    s.midi(0xb0, 64, 127);
    s.midi(0x90, 60, 100);
    s.render(seconds(0.3));
    s.midi(0x80, 60, 0);
    s.midi(0xb0, 121, 0);
    s.render(seconds(8));
    const tail = peak(s.render(seconds(0.2)));
    s.done();
    assert.ok(tail < 1e-4, `${name}: the pedal still holds the note (${tail})`);
  }
});
