// Suggestion statuses are told as they settle (src/agent/suggestionsStore.ts settledChanges): an
// Accept's status on the way, and a failed Accept's taken back, reach no one. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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
const { settledChanges, updateSuggestion, useSuggestions } = await import('../src/agent/suggestionsStore.ts');

const told = () => {
  const seen = [];
  const stop = settledChanges((before, after) => {
    const was = new Map(before.map((s) => [s.id, s.status]));
    for (const s of after) if (was.get(s.id) !== s.status) seen.push(s.status);
  });
  return { seen, stop };
};

test('a status taken back while settling is told to no one; one that stays is told once', () => {
  useSuggestions.setState({ suggestions: [{ id: 'a', status: 'waiting' }] });
  const { seen, stop } = told();
  useSuggestions.setState({ settling: true });
  updateSuggestion('a', { status: 'accepted' });
  updateSuggestion('a', { status: 'waiting' });
  useSuggestions.setState({ settling: false });
  assert.deepEqual(seen, []);
  useSuggestions.setState({ settling: true });
  updateSuggestion('a', { status: 'accepted' });
  useSuggestions.setState({ settling: false });
  assert.deepEqual(seen, ['accepted']);
  updateSuggestion('a', { status: 'undone' });
  assert.deepEqual(seen, ['accepted', 'undone']);
  stop();
});
