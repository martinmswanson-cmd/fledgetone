// Sliders and drags make an undo step only when they change something: an arrow key on a slider
// whose value is rounded (the Multiband crossovers, the Pro EQ's Q) always moves it, a slider's step
// is taken with the first change that touches the song, Pocket's Mix all faders are their own undo
// steps from the keyboard or a screen reader, a starting tempo change never turns a field or slider
// that was only held into an empty step, and a click on a Pro EQ band, a warp marker, a gain point or
// an intensity point leaves it as it was. Run with `npm test`.
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
const { roundedKeyStep } = await import('../src/components/keyboard.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const between = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));

const wholeHz = (v) => Math.round(Math.exp(v));
const qOf = (v) => Math.round(Math.exp(v) * 100) / 100;

test('an arrow key on the Low / mid crossover moves it a whole hertz at the bottom of its range', () => {
  const press = (hz, dir) => wholeHz(roundedKeyStep(Math.log(hz), dir, 0.01, wholeHz, Math.log, 1));
  // At 40 Hz the slider's own step is 0.4 Hz: it would round back to 40
  assert.equal(wholeHz(Math.log(40) + 0.01), 40);
  assert.equal(press(40, 1), 41);
  assert.equal(press(41, -1), 40);
  // Up the range its own step moves it more than a hertz, and is kept
  assert.equal(press(500, 1), wholeHz(Math.log(500) + 0.01));
  assert.ok(press(500, 1) > 501);
  // Every press from 40 to 1000 Hz moves it
  for (let hz = 40, n = 0; hz < 1000; n++) {
    const next = press(hz, 1);
    assert.ok(next > hz, `stuck at ${hz} Hz`);
    hz = next;
    assert.ok(n < 1000);
  }
});

test("an arrow key on a Pro EQ band's Q moves it a hundredth at the narrow end", () => {
  const press = (q, dir) => qOf(roundedKeyStep(Math.log(q), dir, 0.01, qOf, Math.log, 0.01));
  assert.equal(qOf(Math.log(0.2) + 0.01), 0.2);
  assert.equal(press(0.2, 1), 0.21);
  assert.equal(press(0.21, -1), 0.2);
  assert.equal(press(0.1, 1), 0.11);
  for (let q = 0.1; q < 18; ) {
    const next = press(q, 1);
    assert.ok(next > q, `stuck at Q ${q}`);
    q = next;
  }
  for (let q = 18; q > 0.1; ) {
    const next = press(q, -1);
    assert.ok(next < q, `stuck at Q ${q}`);
    q = next;
  }
});

test('the crossover and Q sliders use that key step, and a move that rounds to the same value changes nothing', () => {
  const mbc = src('src/components/inspector/MbcPanel.tsx');
  assert.match(mbc, /label="Low \/ mid"[^\n]*onChange=\{\(v\) => wholeHz\(v\) !== m\.lowFreq && set\(\{ lowFreq: wholeHz\(v\) \}\)\} keyStep=\{logHzStep\}/);
  assert.match(mbc, /label="Mid \/ high"[^\n]*keyStep=\{logHzStep\}/);
  const peq = src('src/components/inspector/PeqEditor.tsx');
  assert.match(peq, /onValue=\{\(v\) => qOf\(v\) !== b\.q && update\(sel, \{ q: qOf\(v\) \}\)\} keyStep=\{qKeyStep\}/);
  // The slider steps by keyStep itself (the browser's step would be overwritten by its own change event)
  const range = src('src/components/UndoableRange.tsx');
  assert.match(range, /if \(keyStep && dir && !e\.defaultPrevented && !rest\.disabled\) \{\s*e\.preventDefault\(\);/);
  assert.match(src('src/components/inspector/InsertFx.tsx'), /keyStep=\{keyStep\}/);
});

test("a slider's step is taken only when its change touches the song, and a lone change is a step of its own", () => {
  const hook = src('src/components/sliderUndo.ts');
  const change = between(hook, 'change: (apply', '\n    },\n  };');
  assert.ok(!change.includes('checkpoint()'), 'no checkpoint pushed before knowing the change made one');
  assert.match(change, /store\.beginEdit\(\);\s*apply\(\);\s*useTimelineStore\.getState\(\)\.endEdit\(\);/);
  // No step made: the next change of the gesture is still its first
  assert.match(change, /if \(step === before\) return;\s*g\.pending = false;/);
  // A screen reader's change (no pointer, no key burst) starts a step
  assert.match(change, /else if \(!g\.pointer && !g\.inBurst\) g\.pending = true;/);
  // The end of a press, and a blur, let go of a pending step nothing changed after
  assert.match(between(hook, 'release: () => {', '\n    },'), /endEdit\(\)/);
  assert.match(between(hook, 'blur: () => {', '\n    },'), /endEdit\(\)/);
  assert.match(src('src/components/UndoableRange.tsx'), /useSliderUndo\(undoable\)/);
});

test("Pocket's Mix all faders and its sliders make their undo steps as the studio's do", () => {
  const drawer = src('src/pocket/PocketDrawer.tsx');
  const strips = between(drawer, '<div className="pk-strips"', 'Loud master');
  assert.ok(!/<input type="range"/.test(strips), 'no plain range inputs in Mix all');
  assert.equal((strips.match(/<UndoableRange className="pk-vfader"/g) ?? []).length, 2);
  assert.ok(!/onPointerDown=\{\(\) => s\(\)\.beginEdit\(\)\}/.test(drawer));
  const ui = src('src/pocket/pocketUi.tsx');
  const touch = between(ui, 'export const TouchRange', '\n};');
  assert.match(touch, /useSliderUndo\(undoable\)/);
  assert.match(touch, /onKeyDown=\{\(e\) => undo\.key\(e\)\}/);
  assert.match(touch, /undo\.change\(\(\) => onChange\(next\), value\)/);
  for (const f of ['src/pocket/PocketDrawer.tsx', 'src/pocket/PocketRack.tsx']) assert.ok(!src(f).includes('onStart='), f);
});

test('a starting tempo change makes no undo step, even with a field or slider held', () => {
  const store = src('src/store/timelineStore.ts');
  const changes = between(store, 'function changesHistory', '\n}\n');
  // As restoreEntry: the starting tempo comes back only with the tempo changes
  assert.match(changes, /const tempoOnly = after\.tempoPoints === before\.tempoPoints;/);
  assert.match(changes, /k === 'bpm' && tempoOnly \? false/);
  assert.match(between(store, 'function restoreEntry', '\n}\n'), /const bpm = entry\.tempoPoints !== s\.tempoPoints \? entry\.bpm : s\.bpm;/);
  // setBpm keeps a held field's step waiting (its markers and audio clips move with it, but that's no step)
  const setBpm = between(store, '    setBpm: (bpm) => {', '\n    },');
  assert.match(setBpm, /const held = pendingCheckpoint;\s*pendingCheckpoint = null;\s*set\(/);
  assert.match(setBpm, /pendingCheckpoint = held;/);
  assert.match(between(store, '    endEdit: () => {', '\n    },'), /pendingCheckpoint = null;/);
  // Fields that hold an edit let it go when left
  for (const f of ['src/components/timeline/AudioClipEditor.tsx', 'src/components/timeline/PianoRoll.tsx', 'src/components/inspector/SampleKitPanels.tsx']) {
    assert.match(src(f), /onFocus=\{\(\) => [^\n]*beginEdit\(\)\}\s*onBlur=\{\(\) => [^\n]*endEdit\(\)\}/, f);
  }
});

test('a click on a Pro EQ band, a warp marker, a gain point or an intensity point changes nothing', () => {
  const peq = between(src('src/components/inspector/PeqEditor.tsx'), 'const drag = (e: React.PointerEvent, i: number)', 'const addAt');
  assert.match(peq, /if \(!moved && Math\.abs\(dx\) < 3 && Math\.abs\(dy\) < 3\) return;/);
  assert.match(peq, /const freq = dx === 0 \? b0\.freq :/);
  const warp = between(src('src/components/timeline/AudioWarpGain.tsx'), 'const drag = (e: React.PointerEvent', '// ---------- Warp');
  assert.match(warp, /if \(!moved && Math\.abs\(ev\.clientX - clientX\) < 3 && Math\.abs\(ev\.clientY - clientY\) < 3\) return;/);
  // An intensity point moves by as much as the pointer has: none, and it stays exactly where it was
  const intensity = src('src/components/timeline/IntensityPanel.tsx');
  assert.match(intensity, /\[clamp\(point\[0\] \+ \(x - from\[0\]\)\), clamp\(point\[1\] \+ \(y - from\[1\]\)\)\]/);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const point = [0.2, 0];
  const at = 0.3384140018294504;
  assert.deepEqual([clamp(point[0] + (at - at)), clamp(point[1] + (at - at))], point);
});
