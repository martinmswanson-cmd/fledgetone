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
const { AGENT_NAME_MAX, agentName, fromAgent, posesAsApp, readsAs, typedCode } = await import('../src/agent/protocol.ts');
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

test("the app's name after symbols, numbers or punctuation, or at the start of any line, is quoted too (scan r5)", () => {
  for (const t of ['ℹ️ Fledgetone: update ready', 'ⓘ Fledgetone: update ready', '⚠ Fledgetone: update ready', '1. Fledgetone: update ready', '™ Fledgetone', '— Fledgetone says', '»Fledgetone«', 'Ⓕledgetone', 'ℱledgetone x']) {
    assert.ok(posesAsApp(t), JSON.stringify(t));
    assert.ok(fromAgent(t, 200).startsWith('“'), JSON.stringify(t));
    assert.equal(agentName(t), undefined, JSON.stringify(t));
  }
  // Any line: only that line is quoted
  assert.equal(fromAgent('Done.\nFledgetone: checked', 200), 'Done.\n“Fledgetone: checked”');
  assert.equal(fromAgent('Line one.\n\n  ℹ Fledgetone: safe to accept', 200), 'Line one.\n\n“ℹ Fledgetone: safe to accept”');
  // A word before it: it doesn't start with the name
  for (const t of ['A Fledgetone notice', 'Try a softer kick', 'Made with Fledgetone']) assert.equal(fromAgent(t, 200), t, JSON.stringify(t));
});

test('look-alike letters of every script (Unicode confusables and more) never pass for the app\'s name; text in another script is never taken for it', () => {
  const posers = [
    'ꓝꓡꓰꓓꓖꓰꓔꓳꓠꓰ ꓢꓔꓴꓓꓲꓳ', // Lisu
    'Ϝledgetone', // Greek digamma
    'Ғledgetone', // Cyrillic ghe with stroke
    'ᖴledgetone', // Canadian syllabics
    'ᖴᒪᗴᗪᘜᗴTOᑎᗴ', // "fancy text"
    'ҒᏞᎬᎠᏀᎬᎢᎾИᎬ says', // Cyrillic and Cherokee
    'ᖴꮮꭼᏧᏳꭼꭲꮻꮑꭼ', // Cherokee small letters
    '𝐅𝐥𝐞𝐝𝐠𝐞𝐭𝐨𝐧𝐞', // mathematical bold
    'ⓕⓛⓔⓓⓖⓔⓣⓞⓝⓔ', // circled
    'Fʟᴇᴅɢᴇᴛᴏɴᴇ', // small capitals
    'Ƒledgetone',
    'F1edget0ne',
    'Fl3dg3t0n3',
    'Ḟḷḗḍġḗṭṑṇḗ', // accents
    'F-l-e-d-g-e-t-o-n-e',
    'Fledgеtоnе', // Cyrillic e and o
    'Fledgetone⁠ update', // a word joiner
  ];
  for (const name of posers) {
    assert.equal(agentName(name), undefined, JSON.stringify(name));
    assert.ok(fromAgent(`${name}: your autosave failed`, 200).startsWith('“'), JSON.stringify(name));
  }
  // Names that aren't the app's, in any script, stay as they are
  for (const name of ['Claude', 'Felix the agent', 'Fledglings tone', 'Пожалуйста, слушайте', '日本語のエージェントです', 'مساعد الموسيقى', 'עוזר מוזיקה', 'संगीत सहायक', 'Ελληνικός βοηθός', 'Flute helper', 'Codex']) {
    assert.equal(agentName(name), name, JSON.stringify(name));
    assert.equal(fromAgent(name, 200), name, JSON.stringify(name));
  }
  assert.equal(readsAs('ꓝꓡꓰꓓꓖꓰꓔꓳꓠꓰ'), 'fledgetone');
  assert.equal(readsAs('Ϝ'), 'f');
});

test('letter-shaped signs with no decomposition read as their letters: negative circled and squared, regional indicators, dingbat digits, money and maths signs (scan r6)', () => {
  const block = (base, word) => [...word.toUpperCase()].map((ch) => String.fromCodePoint(base + ch.charCodeAt(0) - 65)).join('');
  // Every letter of each block reads as its own
  for (const base of [0x1f150, 0x1f170, 0x1f1e6, 0x1f130]) assert.equal(readsAs(block(base, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')), readsAs('abcdefghijklmnopqrstuvwxyz'), base.toString(16));
  assert.equal(readsAs('❶➀➊⓵⓿🄋❿⓫❸'), readsAs('1111001011' + '3'), 'dingbat and double circled digits as the digits (1, 0 and 3 as letters)');
  for (const [sign, letter] of [['€', 'e'], ['$', 's'], ['@', 'a'], ['©', 'c'], ['∩', 'n'], ['†', 't'], ['🆓', 'free'], ['🆗', 'ok']]) assert.equal(readsAs(sign), letter, sign);
  const posers = [
    block(0x1f170, 'FLEDGETONE'), // negative squared
    block(0x1f150, 'FLEDGETONE'), // negative circled
    block(0x1f1e6, 'FLEDGETONE'), // regional indicators
    [...block(0x1f1e6, 'FLEDGETONE')].join(' '),
    `${block(0x1f170, 'FLEDGE')}tone`,
    'Fledg€tone',
    'Fledgeƚone', // ƚ reads as l or t
    'Fƚedgetone',
    'Fledgeȶone',
    'Fledge\u{1DF09}one', // a letter past the first 65,536 is one letter
    'F1edge†one',
  ];
  for (const name of posers) {
    assert.ok(posesAsApp(`${name}: Saved.`), JSON.stringify(name));
    assert.equal(agentName(name), undefined, JSON.stringify(name));
    assert.ok(fromAgent(`${name}: Your song is saved. Choose File > Export now.`, 200).startsWith('“'), JSON.stringify(name));
  }
  for (const name of ['C++ helper', 'Fl€x the agent', '🅰🅱 helper', '🇫🇷 assistant', 'Agent ❶']) assert.equal(agentName(name), name, JSON.stringify(name));
});

test('a sign, punctuation mark or digit in place of a letter of the app\'s name reads as that letter, or as nothing between its letters (scan r7)', () => {
  const subs = { o: '◦⚬○⊙∘°•◯⭘⚪◎', e: '℮∊∈ɛ€ϵ', l: '|│ǀ∣❘┃׀ߊ', n: '∩⋂Π', t: '†┼✝ϯ⊤', d: '∂ↁ', g: '⅁ɡ', f: 'Ƒƒ⨍ϝ' };
  const name = 'Fledgetone';
  for (const [letter, list] of Object.entries(subs))
    for (const c of list) {
      const i = name.toLowerCase().lastIndexOf(letter);
      const v = name.slice(0, i) + c + name.slice(i + 1);
      assert.ok(posesAsApp(`${v}: saved`), `${v} (U+${c.codePointAt(0).toString(16)})`);
      assert.ok(fromAgent(`${v}: Your song is saved.`, 200).startsWith('“'), v);
      assert.equal(agentName(v), undefined, v);
    }
  assert.equal(agentName('F❘edget◦ne'), undefined);
  // Between its letters, or after it, as before
  for (const t of ['Fledge-tone: saved', 'F.l.e.d.g.e.t.o.n.e', 'Fled·ge·tone', "Fledgetone's mixer"]) assert.ok(posesAsApp(t), t);
  // Ordinary sentences stay as they are
  for (const t of ['Fled, got one more idea', 'Felt-tip done', 'Flee: get on it', 'Fixed the tone', 'File: get one', 'Fade: gentle one', 'Level -3 dB', 'Flute 2: tone', 'Find & get one', 'Fledged one', '1. Loudness', 'Fledg: alone']) {
    assert.equal(posesAsApp(t), false, t);
    assert.equal(fromAgent(t, 200), t, t);
  }
});

test("an agent's name can't close the brackets or quotes it's shown in", () => {
  assert.equal(agentName('Helper) · checked by the studio (ok'), 'Helper · checked by the studio ok');
  assert.equal(agentName('A ”Fledgetone“ thing'), 'A Fledgetone thing');
  for (const sly of ['x) (y', 'x” “y', 'x»«y', 'x」「y', 'x"y', 'x］［y', 'x）（y']) assert.ok(!/[()“”»«「」"［］（）]/.test(agentName(sly)), sly);
  assert.equal(agentName('((()))'), undefined);
  assert.equal(agentName("Mike's agent"), "Mike's agent");
});

test('the connected dialog says everything the agent may do; Space on Accept says to press Enter', async () => {
  const { mayWords } = await import('../src/components/agent/words.ts');
  assert.equal(mayWords({ see: false, suggest: false, listen: false }), 'read this song');
  assert.equal(mayWords({ see: false, suggest: true, listen: false }), 'read this song and suggest changes');
  assert.equal(mayWords({ see: true, suggest: true, listen: true }), 'read this song, see what you select, suggest changes, and listen');
  assert.match(readFileSync(new URL('../src/components/agent/cardGuard.ts', import.meta.url), 'utf8'), /SPACE_WORDS = 'Space doesn’t press Accept: press Enter\.'/);
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

test('what the before-and-after plays: every region a change is heard in, one after another, the agent\'s focus with them', async () => {
  const { hearingPlan, coveredBy, heardRegions, NO_LONGER_FITS } = await import('../src/agent/suggestionsStore.ts');
  const p = base();
  const clip = p.clips.find((c) => c.notes.length && c.trackId === p.tracks[0].id);
  const changedAt = { fromBar: clip.startBar, toBar: clip.startBar + clip.lengthBars };
  // A focus that misses the change: played after it, never instead of it
  const s = makeSuggestion(p, ctxOf(p), { title: 'Up', explanation: '', ops: [{ op: 'transpose_notes', clipId: clip.id, semitones: 12 }], focus: { fromBar: 40, toBar: 42 } }).suggestion;
  assert.ok(s.regions.every((r) => coveredBy(s.audition, r)), `${JSON.stringify(s.audition)} plays ${JSON.stringify(s.regions)}`);
  assert.ok(coveredBy(s.audition, { fromBar: changedAt.fromBar, toBar: Math.ceil(changedAt.toBar) }));
  assert.ok(coveredBy(s.audition, { fromBar: 40, toBar: 42 }), 'the focus too');
  assert.equal(s.unheard, null);
  // A track's level (r7 of the scan: it plays nowhere near the other change): both are heard, one after the other
  const flute = p.tracks[3];
  const r7 = makeSuggestion(p, ctxOf(p), { title: 'Two', explanation: '', ops: [{ op: 'set_track', trackId: flute.id, volumeDb: -20 }, { op: 'add_clip', trackId: p.tracks[0].id, startBar: 40, lengthBars: 1, notes: [{ pitch: 'C5', start: 0, length: 1 }] }] }).suggestion;
  // (the added note rings out past its bar: its release, the track's effects and the master reverb it sends to)
  assert.deepEqual(r7.regions, [{ fromBar: 9, toBar: 20 }, { fromBar: 40, toBar: 43 }]);
  assert.deepEqual(r7.audition, [{ fromBar: 8, toBar: 20 }, { fromBar: 39, toBar: 43 }], 'each with the bar before it');
  assert.equal(r7.unheard, null);
  // A focus given with a mix change joins where the track plays (never replaces it)
  const focused = makeSuggestion(p, ctxOf(p), { title: 'Flute', explanation: '', ops: [{ op: 'set_track', trackId: flute.id, volumeDb: -20 }], focus: { fromBar: 1, toBar: 2 } }).suggestion;
  assert.deepEqual(focused.audition, [{ fromBar: 1, toBar: 2 }, { fromBar: 8, toBar: 20 }]);
  // The tempo: the whole song
  const tempo = makeSuggestion(p, ctxOf(p), { title: 'Faster', explanation: '', ops: [{ op: 'set_tempo', bpm: 100 }] }).suggestion;
  assert.equal(tempo.regions[0].fromBar, 1);
  assert.ok(coveredBy(tempo.audition, tempo.regions[0]));

  const song = { bpm: 120, tempoPoints: [] };
  const fast = { bpm: 200, tempoPoints: [] };
  const plan = (regions, focus, songs = [song]) => hearingPlan(regions, { fromBar: 1, toBar: 9 }, focus, songs);
  // Far apart (r1): each with its bar before
  assert.deepEqual(plan([{ fromBar: 2, toBar: 3 }, { fromBar: 70, toBar: 71 }]), { plays: [{ fromBar: 1, toBar: 3 }, { fromBar: 69, toBar: 71 }], unheard: null, limit: null, focusLeftOut: false });
  // 45 bars at 120 BPM are 90 seconds (r3): they fit only without the bar before, so that goes, never a bar of the change
  assert.deepEqual(plan([{ fromBar: 2, toBar: 47 }]), { plays: [{ fromBar: 2, toBar: 47 }], unheard: null, limit: null, focusLeftOut: false });
  // Too long to hear at once: as much as fits, from its start, the rest unheard, and why (90 seconds)
  assert.deepEqual(plan([{ fromBar: 5, toBar: 80 }]), { plays: [{ fromBar: 5, toBar: 50 }], unheard: [{ fromBar: 50, toBar: 80 }], limit: 'seconds', focusLeftOut: false });
  // At 200 BPM the 64 bars come first
  assert.deepEqual(plan([{ fromBar: 60, toBar: 124 }], undefined, [fast]), { plays: [{ fromBar: 60, toBar: 124 }], unheard: null, limit: null, focusLeftOut: false });
  assert.deepEqual(plan([{ fromBar: 60, toBar: 130 }], undefined, [fast]), { plays: [{ fromBar: 60, toBar: 124 }], unheard: [{ fromBar: 124, toBar: 130 }], limit: 'bars', focusLeftOut: false });
  // Several regions sharing the limit: two whole ones with their bars before, the third cut, and those after it unheard
  const many = plan([{ fromBar: 2, toBar: 32 }, { fromBar: 40, toBar: 70 }, { fromBar: 80, toBar: 85 }, { fromBar: 100, toBar: 101 }], undefined, [fast]);
  assert.deepEqual(many.plays, [{ fromBar: 1, toBar: 32 }, { fromBar: 39, toBar: 70 }, { fromBar: 80, toBar: 82 }]);
  assert.deepEqual(many.unheard, [{ fromBar: 82, toBar: 85 }, { fromBar: 100, toBar: 101 }]);
  assert.equal(many.limit, 'bars');
  // The slower of the two songs counts (a suggestion that slows the song down plays longer after)
  assert.equal(plan([{ fromBar: 5, toBar: 40 }], undefined, [fast, song]).limit, null);
  assert.equal(plan([{ fromBar: 5, toBar: 60 }], undefined, [fast, song]).limit, 'seconds');
  // A focus that doesn't fit with the changes is left out, and said so; one that does is played
  assert.deepEqual(plan([{ fromBar: 5, toBar: 7 }], { fromBar: 100, toBar: 160 }), { plays: [{ fromBar: 4, toBar: 7 }], unheard: null, limit: null, focusLeftOut: true });
  assert.deepEqual(plan([{ fromBar: 5, toBar: 7 }], { fromBar: 6, toBar: 9 }).plays, [{ fromBar: 4, toBar: 9 }]);
  // Nothing to hear (only names): the fallback, or the focus
  assert.deepEqual(plan([], { fromBar: 3, toBar: 5 }).plays, [{ fromBar: 3, toBar: 5 }]);
  assert.deepEqual(plan([]).plays, [{ fromBar: 1, toBar: 9 }]);
  // What's heard of the regions, and what isn't, by name
  assert.deepEqual(heardRegions({ regions: [{ fromBar: 5, toBar: 80 }, { fromBar: 90, toBar: 91 }], unheard: [{ fromBar: 50, toBar: 80 }, { fromBar: 90, toBar: 91 }] }), [{ fromBar: 5, toBar: 50 }]);
  // Heard only in part: Accept says which bars weren't, the limit, and asks for its second press
  const partly = { ...s, regions: [{ fromBar: 5, toBar: 80 }], unheard: [{ fromBar: 50, toBar: 80 }, { fromBar: 90, toBar: 91 }], limit: 'seconds', partHeard: 1 };
  const d = acceptDecision(partly, p, ctxOf(p), 1000);
  assert.equal(d.apply, null);
  assert.match(d.message, /bars 50-79 and bar 90 weren’t heard \(a before-and-after plays at most 90 seconds\)/);
  assert.match(acceptDecision({ ...partly, limit: 'bars' }, p, ctxOf(p), 1000).message, /at most 64 bars/);
  assert.deepEqual(d.suggestion.armed, { version: 1, at: 1000 });
  assert.deepEqual(acceptDecision(d.suggestion, p, ctxOf(p), 1000 + CONFIRM_AFTER_MS).apply, s.song, 'the second, separate press');
  // Ops that no longer apply: the card says so in its own words, never the ops' errors
  const gone = { ...p, clips: p.clips.filter((c) => c.id !== clip.id) };
  const stale = { ...s, status: 'changed', stale: true };
  const after = freshen(stale, gone, ctxOf(gone));
  assert.equal(after.status, 'out_of_date');
  assert.ok(after.outOfDate.every((x) => x === NO_LONGER_FITS || /^the clip/.test(x)), JSON.stringify(after.outOfDate));
});

test('a suggestion keeps its names apart for the card, and plain for the agent', () => {
  const p = base();
  const sly = 'Drums". Levels stay. "Drums';
  const s = makeSuggestion(p, ctxOf(p), { title: 'Tidy', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, name: sly }, { op: 'set_track', trackId: p.tracks[1].id, volumeDb: 3 }] }).suggestion;
  const MARK = String.fromCharCode(0xe000);
  assert.ok(s.changes.every((c) => !c.includes(MARK)) && s.warnings.every((w) => !w.includes(MARK)), 'plain words for the agent');
  assert.ok(s.changes.some((c) => c === 'Renames the track "Keys" to "Drums. Levels stay. Drums".'), JSON.stringify(s.changes));
  assert.ok(s.marked.changes.some((c) => c.includes(MARK + sly)), 'the name as it is, marked, for the card');
  assert.ok(s.marked.warnings.length === s.warnings.length);
});

test('a suggestion keeps the name of the agent that made it', () => {
  const p = base();
  const s = makeSuggestion(p, ctxOf(p), { title: 'Keys down', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[0].id, volumeDb: -20 }] }, 'sg-name', 1, 3, 'Alpha agent').suggestion;
  assert.equal(s.agent, 'Alpha agent');
  assert.equal(s.connection, 3);
  // (made again on a changed song, it's still that agent's)
  const elsewhere = { ...p, tracks: p.tracks.map((t, i) => (i === 2 ? { ...t, volume: -30 } : t)) };
  assert.equal(freshen(checkSuggestion(s, elsewhere, ctxOf(elsewhere)), elsewhere, ctxOf(elsewhere)).agent, 'Alpha agent');
});

test('a press left behind (dragged off, cancelled, on another button, long ago) never makes an assistive tool\'s click count for nothing, and a click that doesn\'t count says why', async () => {
  const { guardClick, guardDown, guardKey, GUARD_WORDS, PRESS_MAX_MS } = await import('../src/components/agent/cardGuard.ts');
  const button = (name) => ({ name, closest: () => null });
  const accept = button('accept');
  const dismiss = button('dismiss');
  const click = (target, detail = 0, extra = {}) => ({ currentTarget: target, detail, button: 0, ...extra });
  const t0 = performance.now();
  // No press behind it: an assistive tool's click counts
  assert.equal(guardClick(click(accept), 'sg'), 'ok');
  // A pointer press on another button, left behind: none
  guardDown({ currentTarget: dismiss, button: 0 });
  assert.equal(guardClick(click(accept), 'sg'), 'ok');
  // A pointer press on this button over a second ago (dragged off, its click never came): none
  guardDown({ currentTarget: accept, button: 0 });
  assert.equal(guardClick(click(accept), 'sg', t0 + PRESS_MAX_MS + 500), 'ok');
  // ...but just now: that click isn't an assistive tool's, and it says so
  guardDown({ currentTarget: accept, button: 0 });
  assert.equal(guardClick(click(accept), 'sg'), 'unfinished');
  // Enter's own press on this button counts; a held Enter doesn't, and says so
  const key = (target, repeat = false) => ({ currentTarget: target, key: 'Enter', repeat, preventDefault() {}, stopPropagation() {} });
  guardKey(key(accept));
  assert.equal(guardClick(click(accept), 'sg'), 'ok');
  guardKey(key(accept, true));
  assert.equal(guardClick(click(accept), 'sg'), 'held');
  // A double-click's second click
  assert.equal(guardClick(click(accept, 2), 'sg'), 'double');
  // A pointer's click with no press on this button behind it
  assert.equal(guardClick(click(accept, 1), 'sg'), 'unfinished');
  for (const r of ['unsettled', 'double', 'held', 'unfinished']) assert.ok(GUARD_WORDS[r].length > 10, r);
});

test('where a suggestion is heard, by sound: the bars two renders differ in (barDifferences, changedRegions), with the rules\' never dropped', async () => {
  const { barDifferences, changedRegions, HEARD_DIFFERENCE_DB } = await import('../src/agent/listenReport.ts');
  const { withSoundRegions } = await import('../src/agent/suggestionsStore.ts');
  const rate = 100;
  const bar = 2; // seconds a bar
  const bars = 8;
  const tone = (n, f = () => 0.5) => Float32Array.from({ length: n }, (_, i) => Math.sin(i) * f(i));
  const a = [tone(bars * bar * rate), tone(bars * bar * rate)];
  const spans = Array.from({ length: bars }, (_, i) => ({ start: i * bar, end: (i + 1) * bar }));
  // The same: nothing differs
  assert.deepEqual(changedRegions(barDifferences(a, a, rate, spans, spans), 1), []);
  // Bar 3 louder, and a faint tail into bar 4 (above -70 dBFS), and a hair in bar 7 (below it: rounding)
  const b = a.map((ch) => {
    const out = ch.slice();
    for (let i = 2 * bar * rate; i < 3 * bar * rate; i++) out[i] *= 2;
    for (let i = 3 * bar * rate; i < 3 * bar * rate + 20; i++) out[i] += 0.01;
    out[6 * bar * rate] += 1e-6;
    return out;
  });
  const d = barDifferences(a, b, rate, spans, spans);
  assert.equal(d[0], null);
  assert.ok(d[2] > -20 && d[3] > HEARD_DIFFERENCE_DB && d[6] < HEARD_DIFFERENCE_DB, JSON.stringify(d));
  assert.deepEqual(changedRegions(d, 1), [{ fromBar: 3, toBar: 5 }]);
  // A tempo change at bar 6: bars that lie elsewhere in the other can't be lined up, and count as changed
  const slower = spans.map((s, i) => (i < 5 ? s : { start: 10 + (i - 5) * 2.5, end: 10 + (i - 4) * 2.5 }));
  const t = barDifferences(a, a, rate, spans, slower);
  assert.deepEqual(t.slice(5), ['tempo', 'tempo', 'tempo']);
  assert.deepEqual(changedRegions(t, 1), [{ fromBar: 6, toBar: 9 }]);
  // The regions then: the rules' and the sound's, joined, and what plays made again for them
  const p = base();
  const s = makeSuggestion(p, ctxOf(p), { title: 'Up', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[3].id, volumeDb: -20 }] }).suggestion;
  assert.equal(s.found, 'rules');
  const found = withSoundRegions(s, [{ fromBar: 2, toBar: 3 }, { fromBar: 12, toBar: 20 }], p);
  assert.equal(found.found, 'sound');
  assert.deepEqual(found.regions, [{ fromBar: 2, toBar: 3 }, { fromBar: 9, toBar: 20 }]);
  assert.deepEqual(found.ruleRegions, s.regions);
  assert.deepEqual(found.audition, [{ fromBar: 1, toBar: 3 }, { fromBar: 8, toBar: 20 }]);
  // (none found by sound: the rules' alone, never fewer)
  assert.deepEqual(withSoundRegions(s, [], p).regions, s.regions);
});

test('heard only once Suggested has played through every region: what B played, as song bars (playedBars, playedThrough)', async () => {
  const { playedThrough } = await import('../src/agent/suggestionsStore.ts');
  const { playedBars } = await import('../src/audio/auditionMath.ts');
  const tempo = { bpm: 120, points: [] };
  // Two stretches, bars 4-6 (4 s) and 10-11 (2 s): B's buffer is 6 s long
  const plays = [{ fromBar: 4, toBar: 6 }, { fromBar: 10, toBar: 11 }];
  const starts = [0, 4];
  // Stopped 3 s in: bars 4 to 5.5 only
  const early = playedBars([[0, 3]], plays, starts, 6, tempo);
  assert.deepEqual(early, [{ fromBar: 4, toBar: 5.5 }]);
  assert.equal(playedThrough(early, { fromBar: 4, toBar: 6 }), false);
  // Played round, from part way: all of it
  const round = playedBars([[0, 2], [2, 6]], plays, starts, 6, tempo);
  assert.deepEqual(round, [{ fromBar: 4, toBar: 6 }, { fromBar: 10, toBar: 11 }]);
  assert.ok(playedThrough(round, { fromBar: 4, toBar: 6 }) && playedThrough(round, { fromBar: 10, toBar: 11 }));
  // Switched to Now for a second in the middle: not yet
  const gap = playedBars([[0, 1], [2, 6]], plays, starts, 6, tempo);
  assert.equal(playedThrough(gap, { fromBar: 4, toBar: 6 }), false);
  assert.equal(playedThrough(gap, { fromBar: 10, toBar: 11 }), true);
});

test('checked by sound unless the musician\'s own song is too long (a suggestion can\'t make it skip); not checked and a tail not known: Accept always asks twice (scan r6)', async () => {
  const { tooLongWhy, measureEnd, uncheckedTail, notFoundWords, UNCHECKED_WORDS, MEASURE_MAX_SECONDS, MEASURE_RENDER_MAX_SECONDS } = await import('../src/agent/suggestionsStore.ts');
  const p = base();
  const drums = p.tracks[1];
  const far = (bar) => makeSuggestion(p, ctxOf(p), { title: 'Far', explanation: '', ops: [{ op: 'add_clip', trackId: drums.id, startBar: bar, lengthBars: 1, notes: [{ pitch: 'C1', start: 0, length: 0.0625, velocity: 0.05 }] }] }).suggestion;
  // A tiny clip far away (past 4 minutes at the song's 82 BPM) doesn't make the musician's short song too long to check
  const s90 = far(90);
  assert.ok(measureEnd(p, s90) > 90);
  assert.equal(tooLongWhy(p, s90), null, 'still checked by sound');
  // Only one that would make the renders longer than MEASURE_RENDER_MAX_SECONDS isn't (and the card says so, in the studio's words)
  assert.equal(tooLongWhy(p, far(200)), 'made_too_long');
  assert.equal(notFoundWords('made_too_long'), `it would make the song longer than ${MEASURE_RENDER_MAX_SECONDS / 60} minutes`);
  // The musician's own song longer than MEASURE_MAX_SECONDS: not checked, whatever the suggestion
  const long = { ...p, clips: [...p.clips, { ...p.clips[0], id: 'long', startBar: 130, lengthBars: 2 }] };
  assert.equal(tooLongWhy(long, far(3)), 'too_long');
  assert.equal(notFoundWords('too_long'), `the song is longer than ${MEASURE_MAX_SECONDS / 60} minutes`);
  // Not checked, and every tail known: heard counts as before; a tail not known: never all through
  const s = makeSuggestion(p, ctxOf(p), { title: 'Up', explanation: '', ops: [{ op: 'set_track', trackId: drums.id, volumeDb: -10 }] }).suggestion;
  assert.equal(typeof s.sure, 'boolean');
  assert.equal(uncheckedTail({ ...s, found: 'rules', foundWhy: 'too_long', sure: true }), false);
  assert.equal(uncheckedTail({ ...s, found: 'sound', sure: false }), false, 'checked by sound: the sound says where');
  // Not checked yet (Hear plays at once, the check comes while it plays): not all of it either, until it's found
  assert.equal(uncheckedTail({ ...s, found: 'rules', foundWhy: undefined, sure: false }), true);
  const pending = acceptDecision({ ...s, found: 'rules', foundWhy: undefined, sure: false, partHeard: s.version, partUnchecked: true, heard: null }, p, ctxOf(p), 1000);
  assert.match(pending.message, /^The studio was still checking by sound where this changes when you heard it\. If the check \(which goes on in the background\) finds nothing past what you heard, it counts as heard; if it finds more, hear that too\. Or press Accept without listening\.$/);
  const unsure = { ...s, found: 'rules', foundWhy: 'too_long', sure: false, partHeard: s.version, partUnchecked: true, heard: null };
  assert.equal(uncheckedTail(unsure), true);
  const first = acceptDecision(unsure, p, ctxOf(p), 1000);
  assert.equal(first.apply, null);
  assert.ok(first.message.startsWith(UNCHECKED_WORDS), first.message);
  assert.ok(first.message.endsWith('Press Accept without listening to take it all the same.'));
  const second = acceptDecision(first.suggestion, p, ctxOf(p), 1000 + CONFIRM_AFTER_MS + 10);
  assert.ok(second.apply, 'the second, separate press takes it');
  // The card and noteHeard say and do so (source)
  assert.match(readFileSync(new URL('../src/components/agent/SuggestionCard.tsx', import.meta.url), 'utf8'), /data-not-checked=""/);
  assert.match(readFileSync(new URL('../src/agent/songWatch.ts', import.meta.url), 'utf8'), /if \(!played \|\| unchecked\)/);
});

test('without Listen, an agent reads only where the rules say a suggestion is heard, never what the renders found (scan r6)', async () => {
  const { withSoundRegions, hearingByRules, hearingAsFound } = await import('../src/agent/suggestionsStore.ts');
  const p = base();
  const s = makeSuggestion(p, ctxOf(p), { title: 'Up', explanation: '', ops: [{ op: 'set_track', trackId: p.tracks[3].id, volumeDb: -20 }] }).suggestion;
  const found = withSoundRegions(s, [{ fromBar: 1, toBar: 3 }], p);
  assert.equal(hearingAsFound(found).found, 'sound');
  assert.ok(hearingAsFound(found).regions.some((r) => r.fromBar === 1));
  const rules = hearingByRules(found, p);
  assert.equal(rules.found, 'rules');
  assert.deepEqual(rules.regions, s.ruleRegions);
  assert.deepEqual(rules.audition, s.audition, 'what the rules alone would play');
  const handlers = readFileSync(new URL('../src/agent/handlers.ts', import.meta.url), 'utf8');
  assert.match(handlers, /const by = listen \? hearingAsFound\(s\) : hearingByRules\(s, song\);/);
  // (scan r7) and nothing that moves with them: heard by the rules' regions, no "finding", why not by sound only from the rules
  assert.match(handlers, /heard: listen \? s\.heard !== null && s\.heard === s\.version : s\.heardByRules === s\.version,/);
  assert.match(handlers, /const rulesWhy = listen \? null : tooLongWhy\(song, s\);/);
  assert.match(handlers, /\.\.\.\(!listen\s+\? rulesWhy/);
  const watch = readFileSync(new URL('../src/agent/songWatch.ts', import.meta.url), 'utf8');
  assert.match(watch, /if \(hearingByRules\(s, currentProject\(\)\)\.unheard \|\| !s\.ruleRegions\.every\(\(r\) => playedThrough\(a\.heardB, r\)\)\) return;/);
  // (scan r7) what B played of a version counts after Stop too: a check by sound that finishes later and finds nothing past it leaves it heard
  assert.match(watch, /if \(a\.key === null \|\| !a\.heardB\.length\) return;/);
  assert.match(watch, /if \(!playedVersion\(s, a\)\) return;/);
});
