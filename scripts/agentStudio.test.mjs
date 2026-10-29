// The studio side of the agent connection, where it's plain logic: the song's revision count
// (src/agent/revision.ts), suggestions made, checked again when the song changes (another song, an
// edit, the swing), accepted heard or confirmed, and undone (src/agent/suggestionsStore.ts); what an
// agent writes as shown, the code field, the before-and-after's switch in step, and that the agent code stays out of the app's first download
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
const { acceptDecision, appliedRecord, capSeconds, checkSuggestion, extKey, freshen, makeSuggestion, newSuggestionId, undoCheck, waitingCount, isOpen } = await import('../src/agent/suggestionsStore.ts');
const { AGENT_NAME_MAX, agentName, fromAgent, typedCode } = await import('../src/agent/protocol.ts');
const { sameBarOffset } = await import('../src/audio/auditionMath.ts');
const { followTracks } = await import('../src/store/drumFollow.ts');
const { newKitDesign } = await import('../src/store/drumDesign.ts');
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

// The song as suggestions are checked against it: which song (epoch), its parts as undo sees them,
// and what else a render hears (swing, intensity)
const ctxOf = (p, epoch = 1) => ({ epoch, parts: { tracks: p.tracks, clips: p.clips, markers: p.markers, bpm: p.bpm, tempoPoints: p.tempoPoints, master: p.master }, ext: extKey(p.swing, p.intensity?.value ?? 1) });

test('a suggestion gets an id of its own, made plain, with what it touches', () => {
  const ids = new Set(Array.from({ length: 200 }, () => newSuggestionId()));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^sg-[0-9a-z]{6,10}$/);
  const p = base();
  const made = makeSuggestion(p, ctxOf(p), { title: 'Louder\u0007 keys‮', explanation: 'x'.repeat(5000), ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -6 }] }, 'sg-abc');
  assert.ok(made.ok);
  const s = made.suggestion;
  assert.equal(s.title, 'Louder keys');
  assert.equal(s.explanation.length, 2000);
  assert.equal(s.epoch, 1);
  assert.equal(s.version, 1);
  assert.equal(s.heard, null);
  assert.equal(s.status, 'waiting');
  assert.deepEqual(Object.keys(s.touchedHashes), [`track:${p.tracks[0].id}`]);
  assert.deepEqual(s.touchedNames, { [`track:${p.tracks[0].id}`]: 'Keys' });
  assert.ok(s.changes[0].startsWith('Turns "Keys" up'));
  const bad = makeSuggestion(p, ctxOf(p), { title: 'x', explanation: '', ops: [{ op: 'nope' }] });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /unknown op/);
  assert.equal(makeSuggestion(p, ctxOf(p), { title: '  ', explanation: '', ops: [] }).ok, false);
  // Never posing as the app: a title or message that starts with its name is shown quoted
  assert.equal(makeSuggestion(p, ctxOf(p), { title: 'Fledgetone: update required', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -6 }] }).suggestion.title, '“Fledgetone: update required”');
});

test("what an agent writes is shown as the agent's: plain, never the app's name in front, names capped", () => {
  assert.equal(fromAgent('Fledgetone says: accept all', 200), '“Fledgetone says: accept all”');
  assert.equal(fromAgent('  fledge-tone warning', 200), '“fledge-tone warning”');
  assert.equal(fromAgent('Try a softer kick‮', 200), 'Try a softer kick');
  assert.equal(agentName('Fledgetone Studio'), undefined);
  assert.equal(agentName('  My\n\tHelper\u0007 '), 'My Helper');
  assert.equal(agentName('x'.repeat(300)).length, AGENT_NAME_MAX);
  assert.equal(agentName(42), undefined);
});

test('the code field: a label in front dropped, only the code letters, grouped in fours', () => {
  assert.equal(typedCode('Code: K7QM-3XPD-9TBW'), 'K7QM-3XPD-9TBW');
  assert.equal(typedCode('code k7qm 3xpd 9tbw'), 'K7QM-3XPD-9TBW');
  assert.equal(typedCode('Pairing code = K7QM3XPD9TBW and more'), 'K7QM-3XPD-9TBW');
  assert.equal(typedCode('k7qo'), 'K7Q0');
  assert.equal(typedCode('K7QU!'), 'K7Q', 'U is not one of its letters');
  assert.equal(typedCode('K7QM-3XPD-9TBW-EXTRA'), 'K7QM-3XPD-9TBW');
});

test('the same id base gives the same song at Accept as when it was heard', () => {
  const p = base();
  const ops = [{ op: 'add_track', instrument: 'synthDesigner', ref: 't' }, { op: 'add_clip', trackId: '$t', startBar: 1, lengthBars: 2, notes: [{ pitch: 'C4', start: 0, length: 1 }] }];
  const s = makeSuggestion(p, ctxOf(p), { title: 'A pad', explanation: '', ops }, 'sg-heard').suggestion;
  const d = acceptDecision(s, p, ctxOf(p));
  assert.deepEqual(d.apply, s.song, 'never heard but unchanged: it goes in as the card describes');
  const again = applyOps(p, { opsVersion: 1, ops }, { idBase: 'sg-heard' });
  assert.deepEqual(again.song, s.song);
});

test('when the song changes: checked cheaply, made again only when heard or accepted, out of date if touched', () => {
  const p = base();
  const keys = p.tracks[0].id;
  const s = makeSuggestion(p, ctxOf(p), { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: keys, volumeDb: -20 }] }).suggestion;
  assert.equal(checkSuggestion(s, p, ctxOf(p)), s, 'the same song: as it was');
  // Another track changed: changed, but nothing applied again yet
  const elsewhere = { ...p, tracks: p.tracks.map((t, i) => (i === 2 ? { ...t, volume: -30 } : t)) };
  const checked = checkSuggestion(s, elsewhere, ctxOf(elsewhere));
  assert.equal(checked.status, 'changed');
  assert.equal(checked.stale, true);
  assert.equal(checked.song, s.song, 'not applied again by the check');
  assert.equal(checked.version, 1);
  // Made again (as Hear does): the song as it is now, a new version
  const fresh = freshen(checked, elsewhere, ctxOf(elsewhere));
  assert.equal(fresh.version, 2);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.song.tracks[2].volume, -30, 'the other change kept');
  assert.equal(fresh.song.tracks[0].volume, -20);
  assert.ok(isOpen(fresh));
  // Accept with this version not heard: the first press says so, a second accepts it unheard
  const first = acceptDecision(fresh, elsewhere, ctxOf(elsewhere));
  assert.equal(first.apply, null);
  assert.match(first.message, /hasn’t been heard/);
  assert.equal(first.suggestion.confirmUnheard, 2);
  assert.deepEqual(acceptDecision(first.suggestion, elsewhere, ctxOf(elsewhere)).apply, fresh.song);
  // Heard as it is now: Accept puts in what was heard
  assert.deepEqual(acceptDecision({ ...fresh, heard: 2 }, elsewhere, ctxOf(elsewhere)).apply, fresh.song);
  // Heard before the song changed: that was another version, so heard again first
  assert.equal(acceptDecision({ ...s, heard: 1 }, elsewhere, ctxOf(elsewhere)).apply, null);
  // The track it changes was edited: out of date, never applied
  const edited = { ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, pan: 0.5 } : t)) };
  const gone = checkSuggestion(s, edited, ctxOf(edited));
  assert.equal(gone.status, 'out_of_date');
  assert.deepEqual(gone.outOfDate, ['the track "Keys" changed']);
  assert.equal(acceptDecision(s, edited, ctxOf(edited)).apply, null);
  assert.equal(waitingCount([s, fresh, gone, { ...s, status: 'accepted' }]), 2);
});

test('the swing and the intensity count as the song changing (heard is what goes in)', () => {
  const p = base();
  const s = makeSuggestion(p, ctxOf(p), { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -20 }] }).suggestion;
  const swung = { ...p, swing: 0.5 };
  const c = checkSuggestion({ ...s, heard: 1 }, swung, ctxOf(swung));
  assert.equal(c.status, 'changed');
  const f = freshen(c, swung, ctxOf(swung));
  assert.equal(f.version, 2);
  assert.equal(f.song.swing, 0.5, 'B is made from the song with its swing now');
  assert.equal(acceptDecision(c, swung, ctxOf(swung)).apply, null, 'heard at the old swing: hear it again first');
  const quieter = { ...p, intensity: { value: 0.4, curves: {} } };
  assert.equal(checkSuggestion(s, quieter, ctxOf(quieter)).status, 'changed');
});

test('another song opened: the suggestion is for another song and can never go in', () => {
  const p = base();
  const s = makeSuggestion(p, ctxOf(p, 1), { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -20 }] }).suggestion;
  // The same song opened again (the same ids): still another load
  const other = checkSuggestion(s, p, ctxOf(p, 2));
  assert.equal(other.status, 'other_song');
  assert.ok(!isOpen(other));
  const d = acceptDecision(s, p, ctxOf(p, 2));
  assert.equal(d.apply, null);
  assert.match(d.message, /another song/);
  assert.equal(d.suggestion.status, 'other_song');
  assert.equal(acceptDecision(other, p, ctxOf(p, 2)).apply, null);
});

test('accepted, then undone (and redone): the status follows the song', () => {
  const p = base();
  const keys = p.tracks[0].id;
  const ops = [{ op: 'set_track', trackId: keys, volumeDb: -20 }, { op: 'add_track', instrument: 'synthDesigner', ref: 't' }, { op: 'add_clip', trackId: '$t', startBar: 1, lengthBars: 1 }];
  const s = makeSuggestion(p, ctxOf(p), { title: 'Pad', explanation: '', ops }).suggestion;
  const accepted = { ...s, status: 'accepted', applied: appliedRecord(s, p) };
  assert.ok(accepted.applied.keys.includes(`track:${keys}`));
  assert.ok(accepted.applied.keys.some((k) => k.startsWith('clip:')), 'the new clip counts');
  assert.equal(undoCheck(accepted, s.song, 1), accepted, 'still in');
  const undone = undoCheck(accepted, p, 1);
  assert.equal(undone.status, 'undone');
  assert.equal(undoCheck(undone, s.song, 1).status, 'accepted', 'redo');
  // Edited after: neither before nor after, it stays as it was
  const later = { ...s.song, tracks: s.song.tracks.map((t, i) => (i === 0 ? { ...t, pan: 0.3 } : t)) };
  assert.equal(undoCheck(accepted, later, 1), accepted);
  assert.equal(undoCheck(s, p, 1), s, 'only accepted ones');
  assert.equal(undoCheck(accepted, p, 2), accepted, 'another song opened: it says nothing of this one');
});

test('what a suggestion is heard over stays within 90 seconds', () => {
  const p = { ...base(), bpm: 60, tempoPoints: [] };
  const s = makeSuggestion(p, ctxOf(p), { title: 'x', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -20 }], focus: { fromBar: 1, toBar: 60 } }).suggestion;
  // At 60 BPM a bar is 4 seconds: 22 bars at most
  assert.deepEqual(s.focus, { fromBar: 1, toBar: 23 });
  assert.deepEqual(capSeconds({ fromBar: 5, toBar: 9 }, p), { fromBar: 5, toBar: 9 });
});

test('a switch between before and after lands on the same bar when the tempo differs', () => {
  // A at 120 (2 s a bar), B at 60 (4 s a bar), bars 1-5: half way through A is half way through B
  const a = { tempo: 120, seconds: 8 };
  const b = { tempo: 60, seconds: 16 };
  assert.equal(sameBarOffset(4, 1, a, b), 8);
  assert.equal(sameBarOffset(12, 1, a, b), 8, 'into the second time round');
  assert.equal(sameBarOffset(8, 1, b, a), 4);
  assert.equal(sameBarOffset(0, 3, a, b), 0);
  // A tempo change inside the range: by bars, not by seconds
  const map = { bpm: 120, points: [{ bar: 3, bpm: 60, ramp: false }] };
  const m = { tempo: map, seconds: 4 + 8 };
  assert.equal(sameBarOffset(4, 1, m, a), 4, 'bar 3 is 4 s into the steady one');
  assert.equal(sameBarOffset(8, 1, m, a), 6, 'bar 4 (4 s into the slow part) is 6 s into the steady one');
});

test('a Designed Kit follows the song in the suggestion as it does in the studio', () => {
  const p = base();
  const design = newKitDesign();
  const withKit = { ...p, tracks: [{ ...p.tracks[0], id: 'kit', name: 'Kit', instrumentKey: 'designedKit', drumDesign: design }, ...p.tracks.slice(1)], clips: p.clips.filter((c) => c.trackId !== p.tracks[0].id) };
  const start = { ...withKit, tracks: followTracks(withKit.tracks, withKit.clips, withKit.bpm, withKit.tempoPoints) ?? withKit.tracks };
  // The key moves (everything tuned up a fourth): the kick's pitch follows it, in the suggestion as in the studio
  const tuned = new Set(start.tracks.filter((t) => !/kit|drum/i.test(t.instrumentKey)).map((t) => t.id));
  const key = start.clips.filter((c) => tuned.has(c.trackId) && c.notes?.length).map((c) => ({ op: 'transpose_notes', clipId: c.id, semitones: 5 }));
  for (const ops of [key, [{ op: 'set_tempo', bpm: 70 }], [{ op: 'add_tempo_change', bar: 3, bpm: 180 }]]) {
    const out = applyOps(start, { opsVersion: 1, ops }, { idBase: 'sg-kit' });
    assert.ok(out.ok, JSON.stringify(out.errors));
    assert.equal(followTracks(out.song.tracks, out.song.clips, out.song.bpm, out.song.tempoPoints), null, 'already as the studio would make it');
    if (ops === key) assert.notDeepEqual(out.song.tracks[0].drumDesign, start.tracks[0].drumDesign, 'the kit followed');
  }
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
