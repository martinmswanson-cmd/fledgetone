// Unit tests for action menus drawn as a <select> (src/components/actionSelect.ts): a pick with the
// mouse runs at once, arrow keys and letters only move the choice until Enter or leaving the menu,
// and Esc lets it go. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { actionSelect } = await import('../src/components/actionSelect.ts');

const setup = () => {
  const ran = [];
  const shown = [];
  const rules = actionSelect((v) => shown.push(v));
  // As the menu does: run what each event hands back
  const go = (v) => v && ran.push(v);
  const menu = {
    get pending() {
      return rules.pending;
    },
    keyDown: (key) => {
      const { run, used } = rules.keyDown(key);
      go(run);
      return used;
    },
    change: (value) => go(rules.change(value)),
    blur: () => go(rules.blur()),
  };
  return { ran, shown, menu };
};

test('a pick with the mouse runs straight away and the menu shows its label again', () => {
  const { ran, menu } = setup();
  menu.change('half');
  assert.deepEqual(ran, ['half']);
  assert.equal(menu.pending, '');
});

test('arrow keys only move the choice; Enter runs it once', () => {
  const { ran, menu } = setup();
  menu.keyDown('ArrowDown');
  menu.change('half');
  menu.keyDown('ArrowDown');
  menu.change('down5');
  assert.deepEqual(ran, []);
  assert.equal(menu.pending, 'down5');
  assert.equal(menu.keyDown('Enter'), true);
  assert.deepEqual(ran, ['down5']);
  assert.equal(menu.pending, '');
  assert.equal(menu.keyDown('Enter'), false, 'nothing waiting: Enter is left alone');
  assert.deepEqual(ran, ['down5']);
});

test('a letter typed to find an option waits too', () => {
  const { ran, menu } = setup();
  menu.keyDown('s');
  menu.change('stutter');
  assert.deepEqual(ran, []);
  assert.equal(menu.pending, 'stutter');
});

test('leaving the menu runs a waiting choice; Esc drops it', () => {
  const a = setup();
  a.menu.keyDown('ArrowDown');
  a.menu.change('half');
  a.menu.blur();
  assert.deepEqual(a.ran, ['half']);
  const b = setup();
  b.menu.keyDown('ArrowDown');
  b.menu.change('half');
  b.menu.keyDown('Escape');
  b.menu.blur();
  assert.deepEqual(b.ran, []);
  assert.equal(b.menu.pending, '');
});

test('a pick from an open list (Enter, or a click after keys) runs at once', () => {
  const { ran, menu } = setup();
  menu.keyDown('ArrowDown');
  menu.keyDown('Enter');
  menu.change('pitch');
  assert.deepEqual(ran, ['pitch']);
});

test('stepping back to the label leaves nothing to run', () => {
  const { ran, menu } = setup();
  menu.keyDown('ArrowDown');
  menu.change('half');
  menu.keyDown('ArrowUp');
  menu.change('');
  menu.keyDown('Enter');
  menu.blur();
  assert.deepEqual(ran, []);
});

test('a click in a list a key opened (a Mac) runs at once', async () => {
  const { ran, menu } = setup();
  menu.keyDown('ArrowDown');
  await new Promise((r) => setTimeout(r, 5));
  menu.change('pitch');
  assert.deepEqual(ran, ['pitch']);
});
