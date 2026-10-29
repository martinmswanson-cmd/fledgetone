// Whether a suggestion still fits the song (src/agent/suggestion.ts): edits elsewhere let it be
// applied again, an edit of what it touches makes it out of date, what only the screen holds (a
// folder folded, a track armed or frozen) doesn't count, and a deleted track is named. Run with
// `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
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
const { classifySuggestion, makeSuggestionFile, parseSuggestionFile, touchedHashes, touchedNames } = await import('../src/agent/suggestion.ts');
const { createStarter } = await import('../src/store/starters.ts');

const base = () => {
  const p = createStarter('lofi');
  return { ...p, tracks: p.tracks.map((t, i) => (i < 2 ? { ...t, folder: { id: 'f1', name: 'Band', color: '#fff' } } : t)) };
};
const withTrack = (p, i, patch) => ({ ...p, tracks: p.tracks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

test('the same revision applies; edits elsewhere re-apply; an edit of what it touches is out of date', () => {
  const p = base();
  const ops = [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -10 }];
  const made = { revision: 3, touchedHashes: touchedHashes(p, ops), touchedNames: touchedNames(p, ops) };
  assert.equal(classifySuggestion(made, { revision: 3, song: p }).status, 'unchanged');
  assert.equal(classifySuggestion(made, { revision: 4, song: withTrack(p, 1, { volume: -20 }) }).status, 'reapply');
  const edited = classifySuggestion(made, { revision: 4, song: withTrack(p, 0, { pan: 0.5 }) });
  assert.deepEqual(edited, { status: 'out_of_date', changed: ['the track "Keys" changed'] });
});

test('what only the screen or the moment holds does not make a suggestion out of date', () => {
  const p = base();
  const ops = [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -10 }];
  const made = { revision: 1, touchedHashes: touchedHashes(p, ops) };
  const views = [
    withTrack(p, 0, { folder: { ...p.tracks[0].folder, collapsed: true } }),
    withTrack(p, 0, { isArmed: true }),
    withTrack(p, 0, { freezing: true }),
    withTrack(p, 0, { frozen: { soundId: 's', startBar: 1, seconds: 10, gainDb: 0, fingerprint: 'x' } }),
    withTrack(p, 0, { midiMap: [{ cc: 1, param: 'volume' }] }),
  ];
  for (const song of views) assert.equal(classifySuggestion(made, { revision: 2, song }).status, 'reapply');
});

test('a deleted track is named, from the names kept with the suggestion', () => {
  const p = base();
  const ops = [{ op: 'add_clip', trackId: p.tracks[2].id, startBar: 17, lengthBars: 4 }];
  const file = parseSuggestionFile(JSON.parse(JSON.stringify(makeSuggestionFile(p, { title: 'x', explanation: '', ops }))));
  assert.deepEqual(file.touchedNames, { [`kind:${p.tracks[2].id}`]: 'Bass' });
  const gone = { ...p, tracks: p.tracks.filter((_, i) => i !== 2), clips: p.clips.filter((c) => c.trackId !== p.tracks[2].id) };
  assert.deepEqual(classifySuggestion(file, { song: gone }), { status: 'out_of_date', changed: ['the track "Bass" is gone'] });
  // Without the names it still says what kind of thing went, never an id
  assert.deepEqual(classifySuggestion({ touchedHashes: file.touchedHashes }, { song: gone }).changed, ['a track it changes is gone']);
});
