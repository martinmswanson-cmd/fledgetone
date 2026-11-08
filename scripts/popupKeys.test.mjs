// Tab and the app's popups (src/components/popupKeys.ts): a Tab or Shift+Tab that takes focus out
// of an open popup closes it, so no menu, picker or popover stays open with every shortcut off.
// Shift+Tab off its top goes back to what opened it; Tab off its end moves on (a popup in its place)
// or to the stop after what opened it (one moved to the end of the page); a Tab from what opened it
// goes in. Every family uses it: the menu bar's menus, the floating pickers, the popovers and the
// right-click menus, which take focus on their first item when the keyboard opens them. Run with `npm test`.
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
const { tabMove, focusAt, createInputMemory, KEY_OPEN_MS } = await import('../src/components/popupKeys.ts');
const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Tab off the end, or Shift+Tab off the top, closes the popup; inside it, Tab moves on as usual', () => {
  for (const place of ['inline', 'portal']) {
    // Within it: nothing to do
    assert.equal(tabMove('inside', false, place, true), null);
    assert.equal(tabMove('inside', true, place, true), null);
    assert.equal(tabMove('first', false, place, true), null);
    assert.equal(tabMove('last', true, place, true), null);
    // Shift+Tab off the top: closed, back on what opened it (with nothing to go back to: on, as the browser takes it)
    assert.deepEqual(tabMove('first', true, place, true), { close: true, focus: 'opener' });
    assert.deepEqual(tabMove('only', true, place, true), { close: true, focus: 'opener' });
    assert.deepEqual(tabMove('first', true, place, false), { close: true, focus: 'natural' });
    // A Tab from what opened it goes in; Shift+Tab from there leaves it, closed
    assert.deepEqual(tabMove('opener', false, place, true), { close: false, focus: 'first' });
    assert.deepEqual(tabMove('opener', true, place, true), { close: true, focus: 'natural' });
    // Focus somewhere else entirely: closed once focus lands outside
    assert.deepEqual(tabMove('outside', false, place, true), { close: true, focus: 'natural' });
  }
  // Tab off the end: a popup in its place lets focus move on; one at the end of the page goes to the stop after its button
  assert.deepEqual(tabMove('last', false, 'inline', true), { close: true, focus: 'natural' });
  assert.deepEqual(tabMove('only', false, 'inline', true), { close: true, focus: 'natural' });
  assert.deepEqual(tabMove('last', false, 'portal', true), { close: true, focus: 'after-opener' });
  assert.deepEqual(tabMove('last', false, 'portal', false), { close: true, focus: 'natural' });
});

test('where focus is, from the stops before and after it', () => {
  assert.equal(focusAt(true, false, 0, 3), 'first');
  assert.equal(focusAt(true, false, 2, 0), 'last');
  assert.equal(focusAt(true, false, 0, 0), 'only');
  assert.equal(focusAt(true, false, 1, 1), 'inside');
  assert.equal(focusAt(false, true, 0, 0), 'opener');
  assert.equal(focusAt(false, false, 0, 0), 'outside');
});

test('a menu counts as opened from the keyboard only right after a key, with no click since', () => {
  const m = createInputMemory();
  assert.equal(m.fromKeys(0), false);
  m.seen('key', 1000);
  assert.equal(m.fromKeys(1000 + 50), true);
  assert.equal(m.fromKeys(1000 + KEY_OPEN_MS + 1), false);
  m.seen('pointer', 1100);
  assert.equal(m.fromKeys(1150), false, 'a right-click after it');
});

test('every family of popups closes when Tab takes focus out of it', () => {
  // The menu bar's menus (in their place after the menu buttons)
  const bar = src('src/components/menu/MenuBar.tsx');
  assert.match(bar, /usePopupKeys\(ref, \{ onClose, opener, place: 'inline' \}\)/);
  // The floating pickers (Add Track, instruments): at the end of the page
  const floating = src('src/components/useFloatingMenu.tsx');
  assert.match(floating, /usePopupKeys\(menuRef, \{ open: pos !== null, onClose: \(\) => setPos\(null\), opener: buttonRef, place: 'portal' \}\)/);
  // Every popover (Recording, MIDI input, Fit tempo, Loop range, the grooves, markers, Roll painter, the performance badge)
  assert.match(src('src/components/Popover.tsx'), /usePopupKeys\(ref, \{ onClose, opener: anchorRef, place: 'inline' \}\)/);
  // The right-click menus (clip, track, ruler, marker, automation lane) and the tempo editor, which take focus when the keyboard opens them
  assert.match(src('src/components/timeline/menuHooks.ts'), /usePopupKeys\(ref, \{ onClose, place: 'portal', menu: true \}\)/);
  for (const file of ['ClipContextMenu', 'TrackMenu', 'RulerContextMenu', 'AutomationMenu', 'TempoRow', 'Markers']) assert.match(src(`src/components/timeline/${file}.tsx`), /useMenuDismiss\(ref, /, file);
  const popovers = ['TempoControls', 'timeline/RollPainter', 'timeline/LoopRangePopover', 'timeline/DrumGroovePanel', 'timeline/GrooveFeelPicker', 'timeline/MarkerList', 'timeline/RecordControls', 'PerfBadge'];
  for (const file of popovers) assert.match(src(`src/components/${file}.tsx`), /<Popover\b/, file);
});
