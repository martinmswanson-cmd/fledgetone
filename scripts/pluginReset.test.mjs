// The built-in plugins start the same however they're built, and Reset All Controllers puts the
// instruments' controllers back as they start. Every plugin fresh and given its own settings back
// sound the same (bb_faust.cpp applies every parameter once, rounded to its steps, as setting it
// does; bb_mda.cpp sets each once), so an export, the command line and live playback agree whether
// or not a live read of its settings came first. CC 121 restores each family's own fresh controller state: Faust (bend,
// pedal), setBfree (the speaker at its Rotary speed setting, the swell open) and Surge XT (wheels,
// pedals, pressure, its macros at their settings). mda's are in mdaEvents.test.mjs, Fledge
// Synth's in its own tests. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const RATE = 44100;
const modules = new Map();
/** A new instance of a family's WebAssembly (its plugins, and their exports) */
async function family(file) {
  if (!modules.has(file)) modules.set(file, await WebAssembly.compile(readFileSync(new URL(`../public/fledgetone-plugins/${file}`, import.meta.url))));
  const mod = modules.get(file);
  const imports = {};
  for (const i of WebAssembly.Module.imports(mod)) (imports[i.module] ??= {})[i.name] = i.kind === 'function' ? () => 0 : undefined;
  let e;
  if (imports.wasi_snapshot_preview1?.fd_write)
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
  const plugins = [];
  for (let i = 0; i < e.bb_count(); i++) plugins.push({ index: i, ...JSON.parse(text(e.bb_info(i))) });
  return { e, plugins, text };
}
/** Render `blocks` blocks of 128 of plugin handle `h` (silence in; for an effect, a tone in); its left channel */
function render(e, h, blocks, tone = false) {
  const out = new Float32Array(blocks * 128);
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(e.memory.buffer, e.bb_buffer(h, 0), 128);
    const r = new Float32Array(e.memory.buffer, e.bb_buffer(h, 1), 128);
    for (let k = 0; k < 128; k++) l[k] = r[k] = tone ? 0.5 * Math.sin((b * 128 + k) * 0.05) : 0;
    e.bb_process(h, 128);
    out.set(new Float32Array(e.memory.buffer, e.bb_buffer(h, 2), 128), b * 128);
  }
  return out;
}
const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const blocks = (s) => Math.ceil((s * RATE) / 128);

const FAMILIES = ['fledge.wasm', 'faust.wasm', 'mda.wasm', 'mutable.wasm', 'open303.wasm', 'airwindows.wasm', 'gpl/setbfree.wasm', 'gpl/surge.wasm', 'gpl/dragonfly.wasm', 'gpl/plateau.wasm'];

test('every built-in plugin sounds the same fresh as given its own settings back', { timeout: 600_000 }, async () => {
  for (const file of FAMILIES) {
    const { plugins } = await family(file);
    for (const p of plugins) {
      // (Each in an instance of its own, as each render's context has)
      const play = async (restore) => {
        const { e } = await family(file);
        const h = e.bb_create(p.index, RATE);
        if (restore) {
          const values = [...Array(e.bb_params(h))].map((_, i) => e.bb_get(h, i));
          values.forEach((v, i) => e.bb_set(h, i, v));
        }
        if (p.instrument) for (const n of [48, 55, 64]) e.bb_midi(h, 0x90, n, 100);
        return render(e, h, blocks(0.3), !p.instrument);
      };
      const d = maxDiff(await play(false), await play(true));
      assert.equal(d, 0, `${file} ${p.name}: off by ${d} once given its own settings back`);
    }
  }
});

test('Faust instruments: Reset All Controllers centres the bend and lets the pedal up, as fresh', async () => {
  const { e, plugins } = await family('faust.wasm');
  for (const p of plugins.filter((x) => x.instrument)) {
    const fresh = e.bb_create(p.index, RATE);
    const moved = e.bb_create(p.index, RATE);
    e.bb_midi(moved, 0xe0, 0, 100);
    e.bb_midi(moved, 0xb0, 64, 127);
    e.bb_midi(moved, 0xb0, 121, 0);
    for (const h of [fresh, moved]) e.bb_midi(h, 0x90, 60, 100);
    const a = render(e, fresh, blocks(0.3));
    const b = render(e, moved, blocks(0.3));
    assert.equal(maxDiff(a, b), 0, `${p.name}: not as fresh after CC 121`);
    // The pedal let up by it: a note let go then ends
    e.bb_midi(moved, 0xb0, 64, 127);
    e.bb_midi(moved, 0x80, 60, 0);
    e.bb_midi(moved, 0xb0, 121, 0);
    e.bb_midi(fresh, 0x80, 60, 0);
    assert.equal(maxDiff(render(e, fresh, blocks(1)), render(e, moved, blocks(1))), 0, `${p.name}: the pedal still holds after CC 121`);
    e.bb_destroy(fresh);
    e.bb_destroy(moved);
  }
});

test("setBfree: Reset All Controllers puts the speaker back at its preset's speed and opens the swell", async () => {
  const { e: first, plugins } = await family('gpl/setbfree.wasm');
  const organ = plugins[0].index;
  const h0 = first.bb_create(organ, RATE);
  const presets = first.bb_programs(h0);
  first.bb_destroy(h0);
  for (let program = 0; program < presets; program++) {
    // (Each organ in an instance of its own: organs in one share some of setBfree's state, its
    // noise and key clicks, so even two fresh ones one after the other differ)
    const play = async (moves) => {
      const { e } = await family('gpl/setbfree.wasm');
      const h = e.bb_create(organ, RATE);
      e.bb_set_program(h, program);
      for (const m of moves) e.bb_midi(h, ...m);
      for (const n of [48, 55, 64]) e.bb_midi(h, 0x90, n, 100);
      const got = render(e, h, blocks(1));
      e.bb_destroy(h);
      return got;
    };
    const fresh = await play([]);
    for (const [what, moves] of [
      ['the wheel down', [[0xb0, 1, 0]]],
      ['the wheel up', [[0xb0, 1, 127]]],
      ['the pedal', [[0xb0, 64, 127], [0xb0, 64, 0]]],
      ['the swell', [[0xb0, 11, 20]]],
    ]) {
      assert.equal(maxDiff(fresh, await play([...moves, [0xb0, 121, 0]])), 0, `preset ${program}: ${what}, then CC 121, isn't as fresh`);
    }
    // (The wheel moves the speaker, not its setting)
    const h = first.bb_create(organ, RATE);
    first.bb_set_program(h, program);
    const before = first.bb_get(h, 15);
    first.bb_midi(h, 0xb0, 1, 127);
    render(first, h, 1);
    assert.equal(first.bb_get(h, 15), before, `preset ${program}: the wheel changed the Rotary speed setting`);
    first.bb_destroy(h);
  }
});

test('Surge XT: Reset All Controllers puts its wheels, pedals, pressure and macros back as fresh', async () => {
  const { e, plugins } = await family('gpl/surge.wasm');
  const surge = plugins[0].index;
  const ref = e.bb_create(surge, RATE);
  const moved = e.bb_create(surge, RATE);
  for (const m of [
    [0xb0, 1, 127],
    [0xb0, 2, 90],
    [0xb0, 11, 30],
    [0xb0, 41, 127],
    [0xb0, 42, 5],
    [0xb0, 66, 127],
    [0xd0, 100, 0],
    [0xe0, 0, 100],
  ])
    e.bb_midi(moved, ...m);
  e.bb_midi(moved, 0xb0, 121, 0);
  for (const h of [ref, moved]) e.bb_midi(h, 0x90, 60, 100);
  const a = render(e, ref, blocks(0.5));
  const b = render(e, moved, blocks(0.5));
  assert.ok(peak(a) > 0.01, 'plays');
  assert.equal(maxDiff(a, b), 0, 'not as fresh after CC 121');
  e.bb_destroy(ref);
  e.bb_destroy(moved);
});
