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
const { closeMessage } = await import('../src/agent/bridgeProtocolClient.ts');
const { acceptDecision, keepSuggestions, ARMED_MS, CONFIRM_AFTER_MS, isArmed, mergeAnnouncements, shortText, capSeconds, checkSuggestion, extKey, freshen, makeSuggestion, newSuggestionId, undoCheck, waitingCount, isOpen } = await import('../src/agent/suggestionsStore.ts');
const { AGENT_NAME_MAX, agentName, fromAgent, readsAs, typedCode } = await import('../src/agent/protocol.ts');
const { preRollStart, restartHeldNotes, sameBarOffset, PRE_ROLL_MAX_BARS } = await import('../src/audio/auditionMath.ts');
const { durationToBars } = await import('../src/store/timelineTypes.ts');
const { followTracks } = await import('../src/store/drumFollow.ts');
const { newKitDesign } = await import('../src/store/drumDesign.ts');
const { applyOps } = await import('../src/agent/ops.ts');
const { classifySuggestion } = await import('../src/agent/suggestion.ts');
const { fingerprint } = await import('../src/agent/fingerprint.ts');
const { createStarter } = await import('../src/store/starters.ts');

const base = () => createStarter('lofi');

test('the revision goes up only when an undo step\'s worth of the song changes', () => {
  const tracks = [];
  const clips = [];
  const c = new RevisionCounter();
  assert.equal(c.update({ tracks, clips, masterFx: { reverbDecay: 2 } }), 0);
  assert.equal(c.update({ tracks, clips, masterFx: { reverbDecay: 2 } }), 0, 'the shared effects rebuilt but the same');
  assert.equal(c.update({ tracks: [{ id: 't1' }], clips, masterFx: { reverbDecay: 2 } }), 1);
  assert.equal(c.update({ tracks, clips, masterFx: { reverbDecay: 3 } }), 2);
  assert.ok(!partsChanged({ a: tracks }, { a: tracks }));
  assert.ok(partsChanged({ a: tracks }, { a: tracks, b: 1 }));
});

test('selecting clips and folding folders aren\'t edits: the revision stays, a suggestion stays as it is', () => {
  const p = base();
  const parts = (clips, tracks = p.tracks) => ({ tracks, clips, markers: p.markers });
  const c = new RevisionCounter();
  c.update(parts(p.clips));
  // As selectClip and clearSelection make them: new clip objects, only isSelected changed
  const selected = p.clips.map((x, i) => (i === 1 ? { ...x, isSelected: !x.isSelected } : x));
  assert.equal(c.update(parts(selected)), 0);
  assert.equal(c.update(parts(selected.map((x) => ({ ...x, isSelected: false })))), 0);
  const folded = p.tracks.map((t, i) => (i === 0 ? { ...t, folder: { id: 'f1', name: 'Drums', color: '#fff', collapsed: true } } : t));
  const open = folded.map((t, i) => (i === 0 ? { ...t, folder: { id: 'f1', name: 'Drums', color: '#fff' } } : t));
  assert.equal(c.update(parts(p.clips, folded)), 1, 'a folder made is an edit');
  assert.equal(c.update(parts(p.clips, open)), 1, 'folding it isn\'t');
  // Anything else about a clip is
  assert.equal(c.update(parts(p.clips.map((x, i) => (i === 1 ? { ...x, startBar: x.startBar + 1 } : x)), open)), 2);
  assert.equal(c.update(parts(p.clips.slice(1), open)), 3, 'a clip gone');
  assert.equal(c.update(parts([...p.clips.slice(1), p.clips[0]], open)), 4, 'clips in another order');
  // A suggestion made before the musician selected a clip is still the one they heard
  const made = makeSuggestion(p, ctxOf(p), { title: 'Quieter', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -6 }] }, 'sg-sel');
  assert.ok(made.ok);
  const now = { ...p, clips: p.clips.map((x, i) => (i === 0 ? { ...x, isSelected: true } : x)) };
  assert.equal(checkSuggestion(made.suggestion, now, ctxOf(now)), made.suggestion);
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

test('Accept: one press only for what was heard; unheard, a separate second press within a few seconds', () => {
  const p = base();
  const s = makeSuggestion(p, ctxOf(p), { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -20 }] }).suggestion;
  // Never heard, unchanged: not in one press
  const t0 = 50_000;
  const one = acceptDecision(s, p, ctxOf(p), t0);
  assert.equal(one.apply, null);
  assert.match(one.message, /haven’t heard this yet/);
  // A press too soon after (a double-click's pace): ignored, still armed from the first
  const quick = acceptDecision(one.suggestion, p, ctxOf(p), t0 + CONFIRM_AFTER_MS - 1);
  assert.equal(quick.apply, null);
  assert.equal(quick.ignored, true);
  assert.equal(quick.suggestion.armed.at, t0);
  // A separate press in time: in
  assert.deepEqual(acceptDecision(one.suggestion, p, ctxOf(p), t0 + 2000).apply, s.song);
  // Too late: armed again instead (the button had gone back to Accept)
  const late = acceptDecision(one.suggestion, p, ctxOf(p), t0 + ARMED_MS + 1);
  assert.equal(late.apply, null);
  assert.equal(late.suggestion.armed.at, t0 + ARMED_MS + 1);
  assert.ok(!isArmed(one.suggestion, t0 + ARMED_MS + 1));
  // The song changing meanwhile disarms it, and the next version needs its own two presses
  const elsewhere = { ...p, tracks: p.tracks.map((t, i) => (i === 2 ? { ...t, volume: -30 } : t)) };
  const moved = checkSuggestion(one.suggestion, elsewhere, ctxOf(elsewhere));
  assert.equal(moved.armed, null);
  const next = acceptDecision(one.suggestion, elsewhere, ctxOf(elsewhere), t0 + 2000);
  assert.equal(next.apply, null, 'armed for the old version only');
  assert.equal(next.suggestion.armed.version, 2);
  // Heard: one press
  assert.deepEqual(acceptDecision({ ...s, heard: 1 }, p, ctxOf(p), t0).apply, s.song);
});

test("the helper's reasons for closing, in plain words", () => {
  assert.match(closeMessage(4009, 'waiting'), /Another tab or studio is already connected/);
  assert.match(closeMessage(4001, 'wrong_code'), /Too many wrong codes/);
  assert.match(closeMessage(4003, 'proving'), /didn’t match/);
  assert.match(closeMessage(4010, 'proving'), /isn’t waiting for a code/);
  assert.match(closeMessage(1006, 'waiting'), /isn’t answering on that port/);
  assert.match(closeMessage(4000, 'paired'), /ended the connection/);
  assert.equal(closeMessage(1006, 'paired'), undefined);
});

test('the list keeps every waiting suggestion: only the oldest answered ones go', () => {
  const mk = (id, status) => ({ id, status });
  const list = [mk('a', 'accepted'), mk('b', 'waiting'), mk('c', 'dismissed'), mk('d', 'changed'), mk('e', 'out_of_date')];
  assert.deepEqual(keepSuggestions(list, 3).map((s) => s.id), ['b', 'd', 'e']);
  assert.deepEqual(keepSuggestions(list, 2).map((s) => s.id), ['b', 'd'], 'never fewer than the waiting ones');
  assert.deepEqual(keepSuggestions(list, 10).map((s) => s.id), ['a', 'b', 'c', 'd', 'e']);
});

test('what is said to screen readers: short, and merged', () => {
  assert.equal(shortText('a '.repeat(100), 20).length <= 21, true);
  assert.ok(shortText('word '.repeat(50)).endsWith('…'));
  assert.equal(shortText('Short one.'), 'Short one.');
  assert.equal(mergeAnnouncements(['A.', 'A.', 'B.']), 'A. B.');
  assert.equal(mergeAnnouncements(['A.', 'B.', 'C.', 'D.']), 'A. B. And 2 more updates from your agent.');
});

test("what an agent writes is shown as the agent's: plain, never the app's name in front, names capped", () => {
  assert.equal(fromAgent('Fledgetone says: accept all', 200), '“Fledgetone says: accept all”');
  assert.equal(fromAgent('  fledge-tone warning', 200), '“fledge-tone warning”');
  assert.equal(fromAgent('Try a softer kick‮', 200), 'Try a softer kick');
  assert.equal(agentName('Fledgetone Studio'), undefined);
  assert.equal(agentName('  My\n\tHelper\u0007 '), 'My Helper');
  assert.equal(agentName('x'.repeat(300)).length, AGENT_NAME_MAX);
  assert.equal(agentName(42), undefined);
  // Look-alikes of the app's name don't pass either: other scripts, invisible characters, full width, accents
  for (const name of ['Fledgetοne', 'F\u200bledgetone: file broken', 'Fledge\u200dtone', '\u200e\u200fFledgetone', 'ＦＬＥＤＧＥＴＯＮＥ', 'FIedgetone', 'Flédgetone', 'Fl\u0435dgetone']) {
    assert.equal(agentName(name), undefined, JSON.stringify(name));
    assert.ok(fromAgent(name, 200).startsWith('“'), JSON.stringify(name));
  }
  assert.equal(readsAs('ＦＬＥＤＧＥＴＯＮＥ'), 'fledgetone');
  assert.equal(agentName('The app'), 'The app');
  assert.equal(fromAgent('a\u200bb\u2028c', 20), 'ab\nc', 'invisible characters gone, separators as line breaks');
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
  const d = acceptDecision({ ...s, heard: 1 }, p, ctxOf(p), 1000);
  assert.deepEqual(d.apply, s.song, 'heard and unchanged: one press');
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
  // Accept with this version not heard: the first press arms "Accept without listening", a separate second accepts it
  const first = acceptDecision(fresh, elsewhere, ctxOf(elsewhere), 10_000);
  assert.equal(first.apply, null);
  assert.match(first.message, /Accept without listening/);
  assert.deepEqual(first.suggestion.armed, { version: 2, at: 10_000 });
  assert.ok(isArmed(first.suggestion, 10_100));
  assert.deepEqual(acceptDecision(first.suggestion, elsewhere, ctxOf(elsewhere), 10_000 + CONFIRM_AFTER_MS).apply, fresh.song);
  // Heard as it is now: Accept puts in what was heard
  assert.deepEqual(acceptDecision({ ...fresh, heard: 2 }, elsewhere, ctxOf(elsewhere)).apply, fresh.song);
  // Heard before the song changed: that was another version, so heard again first
  const before = acceptDecision({ ...s, heard: 1 }, elsewhere, ctxOf(elsewhere), 5);
  assert.equal(before.apply, null);
  assert.match(before.message, /changed since you heard/);
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

test('accepted, then undone (and redone): by where its undo step is, not by what the song holds', () => {
  const p = base();
  const s = makeSuggestion(p, ctxOf(p), { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -20 }] }).suggestion;
  const accepted = { ...s, status: 'accepted', step: 'sg@1' };
  assert.equal(undoCheck(accepted, 'done', 1), accepted, 'still in');
  const undone = undoCheck(accepted, 'undone', 1);
  assert.equal(undone.status, 'undone');
  assert.equal(undoCheck(undone, 'done', 1).status, 'accepted', 'redo');
  // The step gone from the history (a new song, the history trimmed): it stays as it was
  assert.equal(undoCheck(accepted, null, 1), accepted);
  assert.equal(undoCheck(undone, null, 1), undone);
  assert.equal(undoCheck(s, 'undone', 1), s, 'only accepted ones');
  assert.equal(undoCheck({ ...s, status: 'accepted' }, 'undone', 1).status, 'accepted', 'no step: nothing to tell');
  assert.equal(undoCheck(accepted, 'undone', 2), accepted, 'another song opened: it says nothing of this one');
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

test('a stretch is rendered from the earliest note still held into it (capped), so held notes are heard', () => {
  const track = { id: 'pad', name: 'Pad', instrumentKey: 'synthDesigner', isMuted: false, isSoloed: false, volume: 0, pan: 0 };
  const song = (notes, bpm = 120) => ({ tracks: [track], clips: [{ id: 'c', trackId: 'pad', startBar: 3, lengthBars: 20, notes }], bpm, tempoPoints: [] });
  const note = (startOffset, duration) => ({ id: `n${startOffset}`, note: 'C4', startOffset, duration, velocity: 0.8 });
  // A four-bar note from bar 5 is still sounding at bar 7: start at 5
  assert.equal(preRollStart(song([note(2, '4m')]), 7), 5);
  // One that ended before: nothing to run in
  assert.equal(preRollStart(song([note(2, '1m')]), 7), 7);
  // Starting at the bar itself: nothing either
  assert.equal(preRollStart(song([note(4, '4m')]), 7), 7);
  // A very long one: at most PRE_ROLL_MAX_BARS earlier
  assert.equal(preRollStart(song([note(0, '16m')]), 15), 15 - PRE_ROLL_MAX_BARS);
  // ...and at most 20 seconds (at 40 BPM a bar is 6 s: just over 3 bars)
  assert.ok(Math.abs(preRollStart(song([note(0, '16m')], 40), 15) - (15 - 20 / 6)) < 1e-9);
  // A muted track's notes don't count
  assert.equal(preRollStart({ ...song([note(2, '4m')]), tracks: [{ ...track, isMuted: true }] }, 7), 7);
});

test('a note held from before the run-in begins again at its start, for what is left of it (only if still sounding at the range)', () => {
  const note = (id, startOffset, duration) => ({ id, note: 'C2', startOffset, duration, velocity: 0.8 });
  const clips = [
    { id: 'drone', trackId: 't', startBar: 1, lengthBars: 40, notes: [note('d', 0, '40m'), note('short', 1, '1m'), note('later', 30, '2m'), note('crash', 20, '4m')] },
    { id: 'after', trackId: 't', startBar: 25, lengthBars: 4, notes: [note('x', 0, '4m')] },
  ];
  const out = restartHeldNotes(clips, 22, 30);
  const d = out[0].notes.find((n) => n.id === 'd');
  assert.equal(out[0].startBar + d.startOffset, 22, 'begins at the run-in');
  assert.ok(Math.abs(durationToBars(d.duration) - 19) < 1e-9, 'for the 19 bars left of it');
  assert.equal(d.heldFrom, 1, 'keeping where it really begins (its drift, chance and accent are its own)');
  assert.equal(out[0].notes.find((n) => n.id === 'short'), clips[0].notes[1], 'notes over by then are as they were');
  assert.equal(out[0].notes.find((n) => n.id === 'later'), clips[0].notes[2], 'and those after it');
  // Held over the run-in's start but over before the range (a cymbal ringing to bar 25): never struck again
  assert.equal(out[0].notes.find((n) => n.id === 'crash'), clips[0].notes[3]);
  assert.equal(out[1], clips[1], 'a clip after it untouched');
  assert.equal(restartHeldNotes(clips, 1, 5), clips, 'nothing held over bar 1: the same clips');
  assert.equal(restartHeldNotes([{ ...clips[0], notes: [note('crash', 20, '4m')] }], 22, 30)[0].notes[0].startOffset, 20, 'a one-shot over before the range stays put');
  // Cut at its clip's end
  const cut = restartHeldNotes([{ id: 'c', trackId: 't', startBar: 1, lengthBars: 10, notes: [note('n', 0, '40m')] }], 5, 8);
  assert.ok(Math.abs(durationToBars(cut[0].notes[0].duration) - 6) < 1e-9);
});

test("a restarted note's Human seed and feel come from where it really begins", () => {
  const src = readFileSync(new URL('../src/audio/scheduler.ts', import.meta.url), 'utf8');
  assert.match(src, /const own = note\.heldFrom !== undefined \? barToTicks\(note\.heldFrom\) : tick;/);
  assert.match(src, /noteSeed\(clip\.id, note\.note, own\)/);
  assert.match(src, /feelVelocity\(feel, note\.velocity, own,/);
  assert.match(src, /posOf\(own\)/);
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

test("arming, a freeze and MIDI knobs aren't edits; mute and solo are, but never make a suggestion out of date", () => {
  const p = base();
  const keys = p.tracks[0].id;
  const parts = (tracks) => ({ tracks, clips: p.clips, markers: p.markers });
  const with0 = (patch) => p.tracks.map((t, i) => (i === 0 ? { ...t, ...patch } : t));
  const c = new RevisionCounter();
  c.update(parts(p.tracks));
  assert.equal(c.update(parts(with0({ isArmed: true }))), 0, 'armed');
  assert.equal(c.update(parts(with0({ isArmed: false }))), 0, 'disarmed');
  assert.equal(c.update(parts(with0({ freezing: true }))), 0, 'freezing');
  assert.equal(c.update(parts(with0({ frozen: { at: 1 } }))), 0, 'frozen');
  assert.equal(c.update(parts(with0({ midiMap: [{ cc: 7, param: 'volume' }] }))), 0, 'MIDI learn');
  assert.equal(c.update(parts(with0({ isMuted: true }))), 1, 'a mute is heard: it counts');
  assert.equal(c.update(parts(with0({ isSoloed: true }))), 2);
  // A suggestion on the track: muting, soloing, renaming or recolouring it doesn't put it out of date
  const s = makeSuggestion(p, ctxOf(p), { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: keys, volumeDb: -20 }] }).suggestion;
  for (const patch of [{ isMuted: true }, { isSoloed: true }, { name: 'Piano' }, { color: '#123456' }, { isArmed: true }]) {
    const now = { ...p, tracks: with0(patch) };
    const checked = checkSuggestion(s, now, ctxOf(now));
    assert.notEqual(checked.status, 'out_of_date', JSON.stringify(patch));
    // ...and made again on the song as it is, the musician's mute and solo stay
    const fresh = freshen(checked, now, ctxOf(now));
    assert.ok(isOpen(fresh), JSON.stringify(patch));
    assert.equal(fresh.song.tracks[0].volume, -20);
    // (arming isn't kept in a song file: Accept keeps the studio's own, see accept.ts)
    for (const [k, v] of Object.entries(patch)) if (k !== 'isArmed') assert.deepEqual(fresh.song.tracks[0][k], v, `${k} as the musician left it`);
  }
  const armed = { ...p, tracks: with0({ isArmed: true }) };
  assert.equal(checkSuggestion(s, armed, ctxOf(armed)), s, 'arming: as it was, still heard');
  // A suggestion file from before (mute, solo, name and colour in its fingerprint) still fits
  const legacy = { ...s, touchedHashes: { [`track:${keys}`]: fingerprint((({ isArmed: _a, freezing: _f, frozen: _z, midiMap: _m, ...rest }) => rest)(p.tracks[0])) } };
  assert.equal(classifySuggestion(legacy, { song: p }).status, 'unchanged');
});

test('out of date, then what it changes put back: it waits again', () => {
  const p = base();
  const keys = p.tracks[0].id;
  const s = makeSuggestion(p, ctxOf(p), { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: keys, volumeDb: -20 }] }, 'sg-back').suggestion;
  const edited = { ...p, tracks: p.tracks.map((t, i) => (i === 0 ? { ...t, pan: 0.5 } : t)) };
  const gone = checkSuggestion(s, edited, ctxOf(edited));
  assert.equal(gone.status, 'out_of_date');
  assert.equal(checkSuggestion(gone, edited, ctxOf(edited)), gone, 'the song as it went out of date: not checked again');
  // Another edit, the track still changed: still out of date
  const more = { ...edited, tracks: edited.tracks.map((t, i) => (i === 2 ? { ...t, volume: -12 } : t)) };
  assert.equal(checkSuggestion(gone, more, ctxOf(more)).status, 'out_of_date');
  // Undone (the very song it was made on): waiting, as it was
  const back = checkSuggestion(gone, p, ctxOf(p));
  assert.equal(back.status, 'waiting');
  assert.equal(back.outOfDate, undefined);
  assert.ok(isOpen(back));
  assert.deepEqual(acceptDecision({ ...back, heard: 1 }, p, ctxOf(p)).apply, s.song);
  // The pan put back by hand while another track changed: changed (made again when heard)
  const byHand = { ...more, tracks: more.tracks.map((t, i) => (i === 0 ? p.tracks[0] : t)) };
  const again = checkSuggestion(checkSuggestion(gone, more, ctxOf(more)), byHand, ctxOf(byHand));
  assert.equal(again.status, 'changed');
  assert.equal(again.stale, true);
  assert.equal(freshen(again, byHand, ctxOf(byHand)).song.tracks[2].volume, -12);
  // Another song: never back
  assert.equal(checkSuggestion(gone, p, ctxOf(p, 2)).status, 'other_song');
  // Suggestions carry the connection they were made in
  assert.equal(makeSuggestion(p, ctxOf(p), { title: 'x', explanation: '', ops: [{ op: 'set_track', trackId: keys, pan: 0.2 }] }, 'sg-c', 0, 3).suggestion.connection, 3);
});
