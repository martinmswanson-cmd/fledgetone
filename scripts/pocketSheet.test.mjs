// Pocket's sheets (src/pocket/pocketUi.tsx Sheet) are modal as the studio's dialogs are: they take
// focus as they open, Tab goes round inside, Esc closes, and focus goes back to what opened them
// (useDialogFocus). The backdrop, a tap target, is out of the Tab order and not read out as a
// second Close. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/pocket/pocketUi.tsx', import.meta.url), 'utf8');
const sheet = ui.slice(ui.indexOf('export const Sheet'), ui.indexOf('\n};', ui.indexOf('export const Sheet')));

test("a Pocket sheet takes focus, keeps Tab inside, closes on Esc and gives focus back (the studio's dialog focus)", () => {
  assert.match(ui, /import \{ useDialogFocus \} from '\.\.\/components\/timeline\/useDialogFocus';/);
  assert.match(sheet, /const sheet = useRef<HTMLDivElement>\(null\);\s*\/\/[^\n]*\n\s*useDialogFocus\(sheet, onClose\);/);
  // The element the hook works on is the dialog, focusable itself
  assert.match(sheet, /<div ref=\{sheet\} tabIndex=\{-1\} role="dialog" aria-modal="true" aria-label=\{title\}/);
  // Esc is the hook's (only the sheet on top closes); the phone's Back still closes it
  assert.ok(!/addEventListener\('keydown'/.test(sheet), 'no Esc of its own');
  assert.match(sheet, /onBack\(/);
});

test("a Pocket sheet's backdrop is outside the dialog, out of the Tab order and hidden from screen readers", () => {
  const backdrop = /<button type="button"([^>]*)className="absolute inset-0 bg-black\/60" onClick=\{onClose\} \/>/.exec(sheet);
  assert.ok(backdrop, 'the backdrop');
  assert.match(backdrop[1], /tabIndex=\{-1\}/);
  assert.match(backdrop[1], /aria-hidden="true"/);
  assert.ok(!/aria-label="Close"/.test(backdrop[1]));
  assert.ok(sheet.indexOf('bg-black/60') < sheet.indexOf('role="dialog"'), 'before the dialog, not in it');
});
