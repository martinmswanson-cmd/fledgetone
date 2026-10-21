// Fledge Synth's macro names and wobble (fledgeMacros.ts) against the engine itself: the preset
// list is the engine's, every macro a preset uses has a name (and none that it doesn't), every
// bass has three, and the wobble is found where a preset has one. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const M = await import('../src/audio/plugins/fledgeMacros.ts');
const { FLEDGE_SYNC } = await import('../src/audio/plugins/fledgeLayout.ts');

const { instance: { exports: e } } = await WebAssembly.instantiate(readFileSync(new URL('../public/fledgetone-plugins/fledge.wasm', import.meta.url)));
const text = (p) => {
  const m = new Uint8Array(e.memory.buffer);
  let end = p;
  while (m[end]) end++;
  return Buffer.from(m.subarray(p, end)).toString('utf8');
};
const h = e.bb_create(0, 48000);
const index = new Map();
for (let i = 0; i < e.bb_params(h); i++) index.set(text(e.bb_param_name(h, i)), i);
const val = (name) => e.bb_get(h, index.get(name));
const presets = Array.from({ length: e.bb_programs(h) }, (_, p) => text(e.bb_program_name(h, p)));

test('the preset list is the engine’s, in its order', () => {
  assert.deepEqual(M.FLEDGE_PRESETS, presets);
  assert.ok(presets.includes(M.FLEDGE_START_PRESET));
  assert.deepEqual(Object.keys(M.FLEDGE_MACRO_NAMES).sort(), [...presets].sort());
});

test('every macro a preset uses is named, and only those; every bass has three', () => {
  const problems = [];
  presets.forEach((name, p) => {
    e.bb_set_program(h, p);
    const names = M.FLEDGE_MACRO_NAMES[name];
    for (let k = 1; k <= 4; k++) {
      const moves = M.macroTargets(val, k);
      if (!!names[k - 1] !== moves.length > 0) problems.push(`${name}: macro ${k} is named "${names[k - 1] ?? ''}" and moves ${moves.join(', ') || 'nothing'}`);
      if (names[k - 1]) assert.ok(names[k - 1].length <= 14, `${name}: "${names[k - 1]}" is short enough for a slider`);
      assert.equal(M.macroLabel(name, k, moves), names[k - 1] || (moves.length ? moves.join(', ') : `Macro ${k}`));
    }
    if (name.startsWith('Bass/')) assert.equal(names.length, 3, `${name} has three macros`);
  });
  assert.deepEqual(problems, []);
});

test('a macro rerouted to nothing goes back to a plain name; your own sound names it by what it moves', () => {
  assert.equal(M.macroLabel('Bass/Wobble', 3, []), 'Macro 3');
  assert.equal(M.macroLabel(undefined, 2, ['Drive', 'FM']), 'Drive, FM');
  assert.equal(M.macroLabel('Not a preset', 1, ['Cutoff']), 'Cutoff');
});

test('the wobble is the first LFO in time with the song that moves something', () => {
  const at = (name) => {
    e.bb_set_program(h, presets.indexOf(name));
    return M.wobbleOf(val);
  };
  assert.deepEqual(at('Bass/Wobble'), { lfo: 1, division: FLEDGE_SYNC.indexOf('1/8'), label: 'Wobble rate' });
  assert.deepEqual(at('Bass/Riddim'), { lfo: 1, division: FLEDGE_SYNC.indexOf('1/8T'), label: 'Pulse rate' });
  assert.equal(at('Chords/Future bass').label, 'Pulse rate');
  // Its LFO runs free, in Hz: nothing in time with the song to set
  assert.equal(at('Bass/Detune'), null);
  assert.equal(at('Init saw'), null);
  // Every bass with a wobble offers it
  for (const name of presets.filter((n) => n.startsWith('Bass/'))) {
    const w = at(name);
    if (w) assert.ok(w.division >= 0 && w.division < FLEDGE_SYNC.length, name);
  }
  for (const d of M.WOBBLE_DIVISIONS) assert.ok(d.index >= 0, d.label);
});
