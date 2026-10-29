// The studio side of the agent connection, where it's plain logic: the song's revision count
// (src/agent/revision.ts), suggestions made, checked again when the song changes and accepted
// (src/agent/suggestionsStore.ts), and that the agent code stays out of the app's first download
// (only AgentMount is there, and it loads the rest on demand). The rest is checked in a browser by
// scripts/agent-check/e2e.cjs. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const { partsChanged, RevisionCounter } = await import('../src/agent/revision.ts');
const { acceptDecision, makeSuggestion, newSuggestionId, refreshSuggestion, waitingCount, isOpen } = await import('../src/agent/suggestionsStore.ts');
const { applyOps } = await import('../src/agent/ops.ts');
const { createStarter } = await import('../src/store/starters.ts');

const base = () => createStarter('lofi');

test('the revision goes up only when an undo step\'s worth of the song changes', () => {
  const tracks = [];
  const clips = [];
  const c = new RevisionCounter();
  assert.equal(c.update({ tracks, clips, masterFx: { reverbDecay: 2 } }), 0);
  assert.equal(c.update({ tracks, clips, masterFx: { reverbDecay: 2 } }), 0, 'the shared effects rebuilt but the same');
  assert.equal(c.update({ tracks: [...tracks], clips, masterFx: { reverbDecay: 2 } }), 1);
  assert.equal(c.update({ tracks, clips, masterFx: { reverbDecay: 3 } }), 2);
  assert.ok(!partsChanged({ a: tracks }, { a: tracks }));
  assert.ok(partsChanged({ a: tracks }, { a: tracks, b: 1 }));
});

test('a suggestion gets an id of its own, made plain, with what it touches', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newSuggestionId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^sg-[0-9a-z]{6,10}$/);
  const p = base();
  const made = makeSuggestion(p, 4, { title: 'Louder\u0007 keys\u202e', explanation: 'x'.repeat(5000), ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -6 }] }, 'sg-abc');
  assert.ok(made.ok);
  const s = made.suggestion;
  assert.equal(s.title, 'Louder keys');
  assert.equal(s.explanation.length, 2000);
  assert.equal(s.revision, 4);
  assert.equal(s.status, 'waiting');
  assert.deepEqual(Object.keys(s.touchedHashes), [`track:${p.tracks[0].id}`]);
  assert.deepEqual(s.touchedNames, { [`track:${p.tracks[0].id}`]: 'Keys' });
  assert.ok(s.changes[0].startsWith('Turns "Keys" up'));
  const bad = makeSuggestion(p, 4, { title: 'x', explanation: '', ops: [{ op: 'nope' }] });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /unknown op/);
  assert.equal(makeSuggestion(p, 4, { title: '  ', explanation: '', ops: [] }).ok, false);
});

test('the same id base gives the same song at Accept as when it was heard', () => {
  const p = base();
  const ops = [{ op: 'add_track', instrument: 'synthDesigner', ref: 't' }, { op: 'add_clip', trackId: '$t', startBar: 1, lengthBars: 2, notes: [{ pitch: 'C4', start: 0, length: 1 }] }];
  const s = makeSuggestion(p, 1, { title: 'A pad', explanation: '', ops }, 'sg-heard').suggestion;
  const d = acceptDecision(s, p, 1);
  assert.deepEqual(d.apply, s.song);
  const again = applyOps(p, { opsVersion: 1, ops }, { idBase: 'sg-heard' });
  assert.deepEqual(again.song, s.song);
});

test('when the song changes: still fits, applied again (heard again before it goes in), or out of date', () => {
  const p = base();
  const keys = p.tracks[0].id;
  const s = makeSuggestion(p, 1, { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: keys, volumeDb: -20 }] }).suggestion;
  // Another track changed: applied again to the song as it is now
  const elsewhere = { ...p, tracks: p.tracks.map((t, i) => (i === 2 ? { ...t, volume: -30 } : t)) };
  const fresh = refreshSuggestion(s, elsewhere, 2);
  assert.equal(fresh.status, 'changed');
  assert.equal(fresh.revision, 2);
  assert.equal(fresh.song.tracks[2].volume, -30, 'the other change kept');
  assert.equal(fresh.song.tracks[0].volume, -20);
  assert.ok(isOpen(fresh));
  // At Accept without that check having run: it asks to listen again, and doesn't apply
  const first = acceptDecision(s, elsewhere, 2);
  assert.equal(first.apply, null);
  assert.match(first.message, /listen again/);
  // Once checked (status changed), Accept applies the song as applied again
  assert.deepEqual(acceptDecision(fresh, elsewhere, 2).apply, fresh.song);
  // The track it changes was edited: out of date, never applied
  const edited = { ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, pan: 0.5 } : t)) };
  const gone = refreshSuggestion(s, edited, 3);
  assert.equal(gone.status, 'out_of_date');
  assert.deepEqual(gone.outOfDate, ['the track "Keys" changed']);
  assert.equal(acceptDecision(s, edited, 3).apply, null);
  assert.equal(waitingCount([s, fresh, gone, { ...s, status: 'accepted' }]), 2);
  // Same revision: as made
  assert.equal(refreshSuggestion(s, edited, 1), s);
});

test("the agent code isn't in the app's first download: AgentMount loads it on demand", () => {
  const mount = readFileSync(new URL('../src/components/agent/AgentMount.tsx', import.meta.url), 'utf8');
  const statics = [...mount.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(statics.filter((s) => /agent/.test(s)), [], 'no static import of the agent code');
  assert.match(mount, /lazy\(\(\) => import\('\.\/AgentStudio'\)\)/);
  for (const file of ['../src/App.tsx', '../src/components/Header.tsx', '../src/components/menu/MenuBar.tsx', '../src/search/paletteEntries.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from '[^']*\/agent\/(?!AgentMount)[^']*'/, file);
  }
});
