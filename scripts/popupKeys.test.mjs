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
const { tabMove, focusAt, createInputMemory, KEY_OPEN_MS, pickOpener, menuArrow } = await import('../src/components/popupKeys.ts');
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
    // (Nothing to go back to only when nothing was pressed to open it and nothing had focus: see pickOpener)
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

test('a popup opened by a click that left focus nowhere (a tempo flag, which drags): Tab goes in, Shift+Tab back on what opened it', () => {
  for (const place of ['inline', 'portal']) {
    assert.deepEqual(tabMove('nowhere', false, place, true), { close: false, focus: 'first' });
    assert.deepEqual(tabMove('nowhere', true, place, true), { close: true, focus: 'opener' });
  }
  // Focus on nothing, with what opened it known: "nowhere"; not known: outside
  assert.equal(focusAt(false, false, 0, 0, true), 'nowhere');
  assert.equal(focusAt(false, false, 0, 0, false), 'outside');
});

test('what a popup goes back to: the control given, else what was pressed to open it, else what had focus, else the pressed thing itself', () => {
  const ok = () => true;
  assert.deepEqual(pickOpener({ given: 'flag', pressedControl: 'lane', focused: 'play', pressedThing: 'span' }, ok), { el: 'flag', borrowed: false });
  // The tempo editor before: a press on its flag kept focus where it was (on Play, or nothing):
  // the flag pressed is what it goes back to, not Play, and never the end of the page
  assert.deepEqual(pickOpener({ given: null, pressedControl: 'flag', focused: 'play' }, ok), { el: 'flag', borrowed: false });
  assert.deepEqual(pickOpener({ given: null, pressedControl: null, focused: 'clip' }, ok), { el: 'clip', borrowed: false }, 'opened from the keyboard: what had focus');
  // A right-click on a track's name or the ruler (no control there): the thing itself, for the moment
  assert.deepEqual(pickOpener({ pressedThing: 'ruler' }, ok), { el: 'ruler', borrowed: true });
  // Gone from the page, or inside the popup: not usable
  assert.deepEqual(pickOpener({ given: 'gone', focused: 'clip' }, (el) => el !== 'gone'), { el: 'clip', borrowed: false });
  assert.equal(pickOpener({}, ok), null);
});

test('a press is remembered with what it pressed, for a popup opening just after it', () => {
  const m = createInputMemory();
  m.seen('pointer', 1000, 'flag');
  assert.equal(m.pressed(1000 + 300), 'flag');
  assert.equal(m.pressed(1000 + KEY_OPEN_MS + 1), undefined, 'long ago');
  m.seen('key', 1500);
  assert.equal(m.pressed(1510), undefined, 'a key since: opened from the keyboard');
});

test('the arrow keys in a menu: Up and Down a row (a row of colours is one), Left and Right along it, Home and End', () => {
  // The track menu: its colours (12, the track's own the 5th), then Move up, Move down, ...
  const rows = [12, 1, 1, 1];
  const chosen = [4, -1, -1, -1];
  assert.deepEqual(menuArrow(rows, chosen, 1, 0, 'ArrowDown'), { row: 2, item: 0 });
  assert.deepEqual(menuArrow(rows, chosen, 1, 0, 'ArrowUp'), { row: 0, item: 4 }, 'up onto the colours: the track\'s own');
  assert.deepEqual(menuArrow(rows, chosen, 0, 4, 'ArrowRight'), { row: 0, item: 5 });
  assert.deepEqual(menuArrow(rows, chosen, 0, 0, 'ArrowLeft'), { row: 0, item: 11 }, 'round the row');
  assert.deepEqual(menuArrow(rows, chosen, 0, 7, 'ArrowDown'), { row: 1, item: 0 }, 'down off the colours: the next item');
  assert.deepEqual(menuArrow(rows, chosen, 3, 0, 'ArrowDown'), { row: 0, item: 4 }, 'round the menu');
  assert.deepEqual(menuArrow(rows, chosen, 2, 0, 'Home'), { row: 0, item: 4 });
  assert.deepEqual(menuArrow(rows, chosen, 2, 0, 'End'), { row: 3, item: 0 });
  // An item alone in its row: Left and Right are nothing (the page doesn't scroll either: see usePopupKeys)
  assert.equal(menuArrow(rows, chosen, 2, 0, 'ArrowRight'), null);
  assert.equal(menuArrow(rows, chosen, 2, 0, 'Tab'), null);
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
  assert.match(src('src/components/timeline/menuHooks.ts'), /usePopupKeys\(ref, \{ onClose, opener, place: 'portal', menu: true \}\)/);
  // The tempo editor goes back to (and Tab on from) its own flag, however it was opened
  const tempo = src('src/components/timeline/TempoRow.tsx');
  assert.match(tempo, /useMenuDismiss\(ref, onClose, opener\)/);
  assert.match(tempo, /opener=\{\(\) => flagEls\.current\.get\(flagKey\(editing\.kind, editing\.id\)\)\}/);
  // The track menu's colours are a row of its items (the arrows go along it, and it opens on Move up / Move down, not a colour)
  assert.match(src('src/components/timeline/TrackMenu.tsx'), /role="menuitemradio"\s+aria-checked=\{c === track\.color\}/);
  for (const file of ['ClipContextMenu', 'TrackMenu', 'RulerContextMenu', 'AutomationMenu', 'TempoRow', 'Markers']) assert.match(src(`src/components/timeline/${file}.tsx`), /useMenuDismiss\(ref, /, file);
  const popovers = ['TempoControls', 'timeline/RollPainter', 'timeline/LoopRangePopover', 'timeline/DrumGroovePanel', 'timeline/GrooveFeelPicker', 'timeline/MarkerList', 'timeline/RecordControls', 'PerfBadge'];
  for (const file of popovers) assert.match(src(`src/components/${file}.tsx`), /<Popover\b/, file);
});

test('"Try it in a game" is a modal dialog, as the app\'s others are: focus kept inside, back to what opened it', () => {
  const game = src('src/components/game/GameTryOut.tsx');
  assert.match(game, /useDialogFocus\(box, onClose\)/);
  assert.match(game, /role="dialog" aria-modal="true" aria-label="Try it in a game"/);
  // One dialog round every game (changing the game keeps it and its opener); the games draw only their panels
  for (const file of ['GameTryOut', 'RhythmTryOut']) assert.equal((src(`src/components/game/${file}.tsx`).match(/role="dialog"/g) ?? []).length, file === 'GameTryOut' ? 1 : 0, file);
  // A menu item gives focus back to its menu's button before it runs, so a dialog it opens goes back there
  assert.match(src('src/components/menu/MenuBar.tsx'), /opener\(\)\?\.focus\(\{ preventScroll: true \}\);\s+onClose\(\);/);
});
