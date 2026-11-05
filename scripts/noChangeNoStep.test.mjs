// An edit that changes nothing makes no undo step and keeps Redo: the piano roll's TOOLS (Quantize
// on notes already on the grid, Remove slides on unbent notes), the transition matrix (a Cut for Any
// with no rule there) and a game parameter's number clamped back to what it was. Pocket's Drummer,
// step pads and fill go by the time signature where the section is, as the studio does. Run with `npm test`.
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
const { sameNotes, quantize, transpose } = await import('../src/store/noteTools.ts');
const { withSlide, diveNotes } = await import('../src/store/slides.ts');
const { sameRule } = await import('../src/store/transitions.ts');
const { sameParamTarget, cleanTarget } = await import('../src/store/gameParams.ts');
const { drummer } = await import('../src/store/smartTools.ts');
const T = await import('../src/audio/tempoMap.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const N = (id, note, start, duration = '4n', extra = {}) => ({ id, note, startOffset: start, duration, velocity: 0.8, ...extra });

test('notes already on the grid quantize to the same notes; off the grid they change', () => {
  const on = [N('a', 'C4', 0), N('b', 'E4', 0.25)];
  assert.ok(sameNotes(on, quantize(on, 1 / 16, 0, 1, false, 1)));
  assert.ok(sameNotes(on, quantize(on, 1 / 16, 0, 1, true, 1)));
  const off = [N('a', 'C4', 0.01)];
  assert.ok(!sameNotes(off, quantize(off, 1 / 16, 0, 1, false, 1)));
});

test('removing slides from unbent notes gives the same notes; from a bent one it changes', () => {
  const plain = [N('a', 'C4', 0), N('b', 'E4', 0.25, '8n', { chance: 0.5 })];
  assert.ok(sameNotes(plain, plain.map((n) => withSlide(n, 0))));
  const bent = withSlide(N('a', 'C4', 0), 3);
  assert.ok(!sameNotes([bent], [withSlide(bent, 0)]));
  const dived = diveNotes([N('a', 'C4', 0)]);
  assert.ok(!sameNotes([N('a', 'C4', 0)], dived));
});

test('sameNotes: order does not matter, ids, fields and curves do', () => {
  const a = N('a', 'C4', 0);
  const b = N('b', 'E4', 0.25);
  assert.ok(sameNotes([a, b], [b, a]));
  assert.ok(sameNotes([a], [{ ...a, chance: undefined }]));
  assert.ok(!sameNotes([a], [{ ...a, id: 'z' }]));
  assert.ok(!sameNotes([a], [{ ...a, velocity: 0.7 }]));
  assert.ok(!sameNotes([a], [a, b]));
  assert.ok(!sameNotes([a, a], [a, { ...a, note: 'D4' }]));
  assert.ok(!sameNotes([a], transpose([a], 1, 0, 127)));
  const curve = { ...a, expr: { pressure: [{ at: 0, value: 0.5 }] } };
  assert.ok(sameNotes([curve], [{ ...a, expr: { pressure: [{ value: 0.5, at: 0 }] } }]));
  assert.ok(!sameNotes([curve], [{ ...a, expr: { pressure: [{ at: 0, value: 0.6 }] } }]));
});

test('transition rules: the same rule, or both none, is no change', () => {
  assert.ok(sameRule(undefined, undefined));
  assert.ok(sameRule({ kind: 'cut' }, { kind: 'cut', quantize: undefined }));
  assert.ok(sameRule({ kind: 'crossfade', beats: 2 }, { beats: 2, kind: 'crossfade' }));
  assert.ok(!sameRule(undefined, { kind: 'cut' }));
  assert.ok(!sameRule({ kind: 'cut' }, { kind: 'cut', quantize: 'beat' }));
  // The store gives the state back as it was when the rule set doesn't change
  const store = src('src/store/timelineStore.ts');
  const body = store.slice(store.indexOf('setTransitionRule: (from, to, rule)'), store.indexOf('gameSfx: [],'));
  assert.match(body, /if \(sameRule\(s\.transitions\[key\], next\[key\]\)\) return s;/);
});

test('a game parameter target clamped back to its value is the same target', () => {
  const t = cleanTarget({ kind: 'volume', from: 0, to: 1, start: 0.2, end: 1 });
  assert.ok(sameParamTarget(t, cleanTarget({ ...t, end: 1.5 })));
  assert.ok(!sameParamTarget(t, cleanTarget({ ...t, end: 0.9 })));
  const store = src('src/store/timelineStore.ts');
  assert.match(store, /if \(target && sameParamTarget\(p\.targets\[index\], targets\[index\]\)\) return s;/);
});

test('the intensity curve, step lanes and audio handles make their undo step on the first real change', () => {
  const curve = src('src/components/timeline/IntensityPanel.tsx');
  const down = curve.slice(curve.indexOf('onPointerDown='), curve.indexOf('onPointerMove='));
  assert.doesNotMatch(down, /checkpoint\(\)/);
  assert.match(src('src/components/timeline/StepLanes.tsx'), /if \(!recorded\) \{\s*useTimelineStore\.getState\(\)\.checkpoint\(\);/);
  assert.doesNotMatch(src('src/components/timeline/AudioWarpGain.tsx'), /if \(checkpoint\) store\(\)\.checkpoint\(\);/);
});

// A 4/4 song that turns 3/4 at bar 3
const map = { base: { num: 4, den: 4 }, points: [{ id: 'mp', bar: 3, num: 3, den: 4 }] };

test("Pocket's Drummer in a 3/4 section plays a 3/4 beat: the snare on beat 2 of every measure", () => {
  const from = 3, to = 6;
  const meter = T.meterAt(from, map);
  assert.deepEqual([meter.num, meter.den], [3, 4]);
  const bars = Math.max(1, Math.round(((to - from) * meter.den) / meter.num));
  assert.equal(bars, 4);
  const notes = drummer('rock', bars, 0.5, 0, 1, (() => { let i = 0; return () => `n${i++}`; })(), meter).filter((n) => n.startOffset < to - from - 1e-6);
  const snares = notes.filter((n) => n.note === 'D1').map((n) => T.toMeasureBeat(from + n.startOffset, map));
  assert.ok(snares.length >= 4);
  for (const m of snares) assert.equal(m.beat, 2);
  // In 4/4 the meter there is the song's own
  assert.deepEqual(T.meterAt(1, map), { num: 4, den: 4 });
  // (and the code reads it where the section starts)
  assert.match(src('src/pocket/PocketSheets.tsx'), /const meter = meterAt\(sec\.from, meterMap\);/);
  assert.match(src('src/pocket/PocketPads.tsx'), /const meter = meterAt\(sec\.from, meterMap\);/);
  assert.doesNotMatch(src('src/pocket/PocketPads.tsx') + src('src/pocket/PocketSheets.tsx'), /\(s\) => s\.meter\)/);
});

test("Pocket's fill goes in the section's last measure, however short the measure", () => {
  for (const [num, den] of [[3, 8], [2, 8], [1, 4], [4, 4], [3, 4], [7, 8]]) {
    const m = { base: { num, den }, points: [] };
    const to = 1 + 4 * (num / den);
    const last = T.measureAt(to - 1e-6, m);
    assert.equal(last.measure, 4, `${num}/${den}`);
    assert.ok(Math.abs(last.start + last.length - to) < 1e-9);
  }
  // 4/4: the same measure as the middle of the last bar
  const plain = { base: { num: 4, den: 4 }, points: [] };
  assert.equal(T.measureAt(5 - 1e-6, plain).start, T.measureAt(4.5, plain).start);
  assert.match(src('src/pocket/PocketSheets.tsx'), /fillClipBar\(id, sec\.to - 1e-6, f\.id\)/);
});
