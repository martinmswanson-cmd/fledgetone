// Every built-in plugin (public/fledgetone-plugins/) loads, matches the catalog, and plays: an
// instrument makes sound from a note, an effect passes a tone, and nothing gives NaN or blows up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
const { PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalog.ts');
const { GPL_PLUGIN_FAMILIES } = await import('../src/audio/plugins/pluginCatalogGpl.ts');

for (const family of [...PLUGIN_FAMILIES, ...GPL_PLUGIN_FAMILIES]) {
  const file = new URL(`../public/fledgetone-plugins/${family.file}`, import.meta.url);
  test(`${family.family}: every plugin plays`, { skip: !existsSync(file) && family.gpl ? 'GPL family not built here' : false }, async () => {
    const bytes = readFileSync(file);
    assert.equal(createHash('sha1').update(bytes).digest('hex').slice(0, 12), family.hash, 'run: node scripts/plugins/catalog.mjs');
    const mod = await WebAssembly.compile(bytes);
    const imports = {};
    for (const i of WebAssembly.Module.imports(mod)) (imports[i.module] ??= {})[i.name] = () => 0;
    // Writing text must say it wrote it (as the app's processor does), or the C runtime retries forever
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
    assert.equal(e.bb_count(), family.plugins.length);
    const problems = [];
    family.plugins.forEach((info, i) => {
      assert.equal(JSON.parse(text(e.bb_info(i))).name, info.name);
      const h = e.bb_create(i, 44100);
      for (let p = 0; p < e.bb_params(h); p++) {
        if (!text(e.bb_param_name(h, p))) problems.push(`${info.name}: parameter ${p} has no name`);
        text(e.bb_param_display(h, p));
      }
      if (info.instrument) e.bb_midi(h, 0x90, 60, 100);
      let peak = 0;
      for (let b = 0; b < 60; b++) {
        for (const w of [0, 1]) {
          const input = new Float32Array(e.memory.buffer, e.bb_buffer(h, w), 128);
          for (let k = 0; k < 128; k++) input[k] = info.instrument ? 0 : 0.25 * Math.sin(((b * 128 + k) * 2 * Math.PI * 220) / 44100);
        }
        e.bb_process(h, 128);
        for (const w of [2, 3]) for (const v of new Float32Array(e.memory.buffer, e.bb_buffer(h, w), 128)) peak = Number.isFinite(v) ? Math.max(peak, Math.abs(v)) : Infinity;
      }
      if (!Number.isFinite(peak) || peak > 8) problems.push(`${info.name}: peak ${peak}`);
      // (Some effects start silent: a gate, a spectral or granular buffer filling)
      if (info.instrument && peak < 1e-4 && !/Ominous|Voice Formant/.test(info.name)) problems.push(`${info.name}: silent`);
      e.bb_destroy(h);
    });
    assert.deepEqual(problems, []);
  });
}

// Fledgetone's own synth: every preset plays a chord at each of a few tempos without going over
// its safety ceiling (it never clips louder than -1 dB), and it's quiet once the notes end
test('fledge: every preset plays, stays under its ceiling and stops', async () => {
  const { instance: { exports: e } } = await WebAssembly.instantiate(readFileSync(new URL('../public/fledgetone-plugins/fledge.wasm', import.meta.url)));
  const text = (p) => {
    const m = new Uint8Array(e.memory.buffer);
    let end = p;
    while (m[end]) end++;
    return Buffer.from(m.subarray(p, end)).toString('utf8');
  };
  const problems = [];
  const h = e.bb_create(0, 48000);
  const count = e.bb_programs(h);
  assert.ok(count >= 10, 'presets');
  const render = (blocks) => {
    let peak = 0;
    for (let b = 0; b < blocks; b++) {
      e.bb_process(h, 128);
      for (const w of [2, 3]) for (const v of new Float32Array(e.memory.buffer, e.bb_buffer(h, w), 128)) peak = Number.isFinite(v) ? Math.max(peak, Math.abs(v)) : Infinity;
    }
    return peak;
  };
  for (let p = 0; p < count; p++) {
    const name = text(e.bb_program_name(h, p));
    for (const bpm of [70, 140, 174]) {
      e.bb_set_program(h, p);
      e.bb_tempo(h, bpm);
      for (const n of [36, 48, 55, 60]) e.bb_midi(h, 0x90, n, 120);
      const peak = render(375); // a second
      for (const n of [36, 48, 55, 60]) e.bb_midi(h, 0x80, n, 0);
      if (!Number.isFinite(peak) || peak > 0.9) problems.push(`${name} at ${bpm}: peak ${peak}`);
      if (peak < 1e-3) problems.push(`${name} at ${bpm}: silent`);
      // (Long enough for the longest release plus reverb tail)
      render(375 * 14);
      const tail = render(40);
      if (tail > 1e-3) problems.push(`${name} at ${bpm}: still sounding ${tail} after release`);
    }
  }
  e.bb_destroy(h);
  assert.deepEqual(problems, []);
});

// The editor's layout (fledgeLayout.ts) matches the engine: every control names a real
// parameter, every choice's list is the engine's (as it names each option, at its place out of
// the list's room), and every parameter has a control
test('fledge: the editor layout matches the engine', async () => {
  const L = await import('../src/audio/plugins/fledgeLayout.ts');
  const { instance: { exports: e } } = await WebAssembly.instantiate(readFileSync(new URL('../public/fledgetone-plugins/fledge.wasm', import.meta.url)));
  const text = (p) => {
    const m = new Uint8Array(e.memory.buffer);
    let end = p;
    while (m[end]) end++;
    return Buffer.from(m.subarray(p, end)).toString('utf8');
  };
  const h = e.bb_create(0, 48000);
  const names = new Map();
  for (let i = 0; i < e.bb_params(h); i++) names.set(text(e.bb_param_name(h, i)), i);
  const seen = new Set();
  for (const c of L.allFledgeControls()) {
    const i = names.get(c.p);
    assert.ok(i !== undefined, `${c.p} isn't a parameter`);
    assert.ok(!seen.has(i), `${c.p} is on the panel twice`);
    seen.add(i);
    if (c.kind === 'choice')
      c.options.forEach((o, k) => {
        e.bb_set(h, i, L.choiceValue(k, c.cap));
        assert.equal(text(e.bb_param_display(h, i)), o, c.p);
        assert.equal(L.choiceIndex(e.bb_get(h, i), c.options.length, c.cap), k, c.p);
      });
    if (c.kind === 'toggle') {
      e.bb_set(h, i, 1);
      assert.equal(text(e.bb_param_display(h, i)), 'on', c.p);
    }
  }
  const missing = [...names.keys()].filter((n) => !seen.has(names.get(n)));
  assert.deepEqual(missing, []);
  e.bb_destroy(h);
});
