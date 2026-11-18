// The Shift+letter tool shortcuts (src/store/toolShortcuts.ts), the value text of a plugin's
// sliders (src/audio/plugins/tidyValue.ts), and that the guide and the tutorials name what the
// app has. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => readFileSync(join(ROOT, p), 'utf8');
const { TOOL_SHORTCUTS, toolForKey, toolShortcutLabel } = await import('../src/store/toolShortcuts.ts');
const { tidyValue } = await import('../src/audio/plugins/tidyValue.ts');

const key = (k, mods = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test('Shift and a letter opens its tool; nothing else does', () => {
  assert.equal(toolForKey(key('P', { shiftKey: true })), 'plugins');
  assert.equal(toolForKey(key('t', { shiftKey: true })), 'tuner', 'Caps Lock gives a small letter with Shift');
  assert.equal(toolForKey(key('A', { shiftKey: true })), 'analyser');
  assert.equal(toolForKey(key('F', { shiftKey: true })), 'fxRack');
  assert.equal(toolForKey(key('X', { shiftKey: true })), 'mixer');
  assert.equal(toolForKey(key('p')), null, 'the letter alone is not a shortcut');
  for (const mod of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(toolForKey(key('P', { shiftKey: true, [mod]: true })), null, mod);
  assert.equal(toolForKey(key('Q', { shiftKey: true })), null);
  assert.equal(toolForKey(key('Tab', { shiftKey: true })), null, 'a named key is not a letter');
  assert.equal(toolShortcutLabel('plugins'), 'Shift+P');
});

test('each tool has a letter of its own, clear of the timeline\'s Shift shortcuts', () => {
  const letters = Object.values(TOOL_SHORTCUTS);
  assert.equal(new Set(letters).size, letters.length);
  // Shift+L (forward a bar), Shift+J (back four bars), Shift+M (a hit point) are taken
  for (const taken of ['L', 'J', 'M']) assert.ok(!letters.includes(taken), taken);
  const timeline = src('src/components/timeline/Timeline.tsx');
  assert.match(timeline, /toolForKey\(e\)/, 'the timeline\'s key handler asks');
});

test('the menus, the guide and the tutorials show the same keys', () => {
  const menu = src('src/components/menu/MenuBar.tsx');
  for (const tool of Object.keys(TOOL_SHORTCUTS)) assert.ok(menu.includes(`toolShortcutLabel('${tool}')`), `${tool} has its keys beside a menu item`);
  const guide = src('GUIDE.md');
  for (const tool of Object.keys(TOOL_SHORTCUTS)) assert.ok(guide.includes(`\`${toolShortcutLabel(tool)}\``), `the guide lists ${toolShortcutLabel(tool)}`);
});

test('the guide lists every tutorial the Learn menu has, by its title', () => {
  const lessons = src('src/tour/lessons.ts');
  const order = lessons.match(/export const LESSONS: Lesson\[\] = \[([^\]]+)\]/)[1].split(',').map((s) => s.trim());
  const guide = src('GUIDE.md');
  for (const name of order) {
    const block = lessons.slice(lessons.indexOf(`const ${name}: Lesson = {`));
    const title = block.match(/title: (['"])(.+?)\1,/)[2];
    const level = block.match(/level: '(\w+)'/)[1];
    const line = level === 'Tour' ? `- **${title}**` : `- **${level}: ${title}**`;
    assert.ok(guide.includes(line), `the guide has "${line}"`);
  }
});

test("a slider's value: four printed places are trimmed, text written for reading is left alone", () => {
  assert.equal(tidyValue('-3.0000 dB'), '-3.00 dB');
  assert.equal(tidyValue('0.5000'), '0.50');
  assert.equal(tidyValue('250.0000 ms'), '250 ms');
  assert.equal(tidyValue('12.3456 Hz'), '12.3 Hz');
  assert.equal(tidyValue('-0.0001'), '0.00');
  for (const kept of ['1/4', '1/8T', '1/16', '4 bars', '4.0:1', '50 %', '16 voices', '9.0 dB', '+0.0 dB', '2.50 kHz', 'Off', 'Trance gate', '-1 octave', '1.0 ms'])
    assert.equal(tidyValue(kept), kept, kept);
  assert.equal(tidyValue('  0.2500  '), '0.25');
});
