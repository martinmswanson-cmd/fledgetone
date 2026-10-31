// A note made shorter has its curves cut to its new length (noteExpression.ts withNoteLength,
// fitNoteCurves), as a saved file opens it (cutNoteLane): the studio's edits, the agent's ops and
// the reopened song all hold and play the same note. Run with `npm test`.
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
const { cutNoteExpression, withNoteLength, fitNoteCurves, fitNotesCurves, fitClipCurves, fitClipsCurves, isExpressive, noteSteps } = await import('../src/store/noteExpression.ts');
const { parseProject, serializeProject } = await import('../src/store/project.ts');
const { applyOps } = await import('../src/agent/ops.ts');
const { diffSongs } = await import('../src/agent/songDiff.ts');

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// Flat over its first half, rising only after: shortened to half a bar it moves nothing
const bent = () => ({ id: 'n1', note: 'C4', startOffset: 0, duration: '1m', velocity: 0.9, expr: { bend: [{ at: 0, value: 0 }, { at: 0.6, value: 0 }, { at: 1, value: 12 }] } });
const song = (notes) => ({
  format: 'fledgetone-project',
  version: 1,
  name: 'Cut',
  bpm: 120,
  swing: 0,
  loopRegion: { inBar: 1, outBar: 3, enabled: false },
  tracks: [{ id: 't1', name: 'Keys', instrumentKey: 'keys', volume: -12, pan: 0, reverbSend: 0, delaySend: 0 }],
  clips: [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, expression: { bend: [{ at: 0, value: 2 }, { at: 2, value: 2 }] }, notes }],
});
const reopen = (p) => parseProject(JSON.parse(JSON.stringify(serializeProject(p))));

test('a note made shorter has its curves cut to its new length, as a saved file opens it', () => {
  const n = withNoteLength(bent(), '2n');
  assert.equal(n.duration, '2n');
  assert.deepEqual(n.expr, { bend: [{ at: 0, value: 0 }, { at: 0.5, value: 0 }] });
  // (the same as the song saved and opened again)
  const opened = reopen(parseProject(song([{ ...bent(), duration: '2n' }])));
  assert.deepEqual(opened.clips[0].notes[0].expr, n.expr);
  // Lengthened again later the cut part doesn't come back; in one drag (curves from the note as it began) it does
  assert.deepEqual(withNoteLength(n, '1m').expr, n.expr);
  assert.deepEqual(withNoteLength(n, '1m', bent()).expr, bent().expr);
  // A note without curves stays without them; a longer one keeps its curves as they are
  assert.equal('expr' in withNoteLength({ id: 'x', note: 'C4', startOffset: 0, duration: '4n', velocity: 1 }, '8n'), false);
  const longer = bent();
  assert.equal(withNoteLength(longer, '2m').expr, longer.expr);
});

test('fitting leaves notes and clips with nothing past their end the very same objects', () => {
  const plain = { id: 'p', note: 'D4', startOffset: 0, duration: '4n', velocity: 1 };
  const inside = bent();
  assert.equal(fitNoteCurves(plain), plain);
  assert.equal(fitNoteCurves(inside), inside);
  assert.equal(cutNoteExpression(inside.expr, 1), inside.expr);
  const notes = [plain, inside];
  assert.equal(fitNotesCurves(notes), notes);
  const clip = { id: 'c', trackId: 't', name: 'c', startBar: 1, lengthBars: 2, notes, takes: [{ id: 'k', name: 'Take 1', notes }] };
  assert.equal(fitClipCurves(clip), clip);
  // One shortened: only it changes (its take's copy too), the others kept
  const short = { ...bent(), duration: '2n' };
  const c2 = { ...clip, notes: [plain, short], takes: [{ id: 'k', name: 'Take 1', notes: [short] }] };
  const fit = fitClipCurves(c2);
  assert.notEqual(fit, c2);
  assert.equal(fit.notes[0], plain);
  assert.deepEqual(fit.notes[1].expr.bend.at(-1), { at: 0.5, value: 0 });
  assert.deepEqual(fit.takes[0].notes[0].expr.bend.at(-1), { at: 0.5, value: 0 });
  // Clips already in the song before aren't looked at
  const list = [c2];
  assert.equal(fitClipsCurves(list, list), list);
  assert.notEqual(fitClipsCurves(list), list);
});

test('whether a note is expressive, and its steps, are judged on its curves cut to its length', () => {
  const n = bent();
  assert.equal(isExpressive(n.expr), true);
  assert.equal(isExpressive(n.expr, 1), true);
  assert.equal(isExpressive(n.expr, 0.5), false, 'flat over its half bar: it moves nothing');
  assert.equal(isExpressive(n.expr, 0.8), true);
  for (const length of [0.5, 0.8, 0.3]) {
    const whole = noteSteps(n.expr, length);
    const cut = noteSteps(cutNoteExpression(n.expr, length), length);
    assert.equal(whole.length, cut.length);
    whole.forEach((s, i) => assert.ok(s.at === cut[i].at && Math.abs(s.cents - cut[i].cents) < 1e-9 && Math.abs(s.pressure - cut[i].pressure) < 1e-9));
  }
});

test("the studio's store cuts the curves of every note an edit makes shorter, and of a song it opens", () => {
  const store = src('src/store/timelineStore.ts');
  const wrapper = store.slice(store.indexOf('function withLinkedClips'), store.indexOf('export const useTimelineStore'));
  assert.match(wrapper, /fitClipsCurves\(next\.clips!, s\.clips\)/);
  assert.match(store, /shareLinkedContent\(fitClipsCurves\(p\.clips\)\)/);
  // The piano roll's resize and draw keep the curves of the note as the drag found it
  const roll = src('src/components/timeline/PianoRoll.tsx');
  assert.equal((roll.match(/withNoteLength\(n, barsToDuration\(len \/ UNITS_PER_BAR\)/g) ?? []).length, 2);
  assert.doesNotMatch(roll, /\{ \.\.\.n, duration: barsToDuration/);
});

test("the agent's ops cut curves themselves: no caution, and only the note it changed counted", () => {
  // A clip from before, a note in it shortened without its curve cut (as the studio once kept it)
  const opened = parseProject(song([bent(), { id: 'n2', note: 'E4', startOffset: 1, duration: '4n', velocity: 0.5 }]));
  const session = { ...opened, clips: opened.clips.map((c) => ({ ...c, notes: c.notes.map((n) => (n.id === 'n1' ? { ...n, duration: '2n' } : n)) })) };
  const a = applyOps(session, { opsVersion: 1, ops: [{ op: 'change_notes', clipId: 'c1', notes: [{ id: 'n2', velocity: 0.7 }] }] }, { idBase: 'sg-a' });
  assert.equal(a.ok, true);
  assert.deepEqual(a.warnings, []);
  assert.deepEqual(
    a.diff.changes.map((c) => c.text),
    ['In "A" on "Keys": changes 1 note in bar 2.']
  );
  assert.deepEqual(a.song.clips[0].notes[0].expr, { bend: [{ at: 0, value: 0 }, { at: 0.5, value: 0 }] });
  // The agent shortening the bent note itself
  const b = applyOps(opened, { opsVersion: 1, ops: [{ op: 'change_notes', clipId: 'c1', notes: [{ id: 'n1', length: 0.5 }] }] }, { idBase: 'sg-b' });
  assert.equal(b.ok, true);
  assert.deepEqual(b.warnings, []);
  assert.deepEqual(b.song.clips[0].notes[0].expr, { bend: [{ at: 0, value: 0 }, { at: 0.5, value: 0 }] });
  // ...and a copy of the clip holds its notes as a saved file would
  const c = applyOps(session, { opsVersion: 1, ops: [{ op: 'duplicate_clip', clipId: 'c1', toBar: 5 }] }, { idBase: 'sg-c' });
  assert.equal(c.ok, true, JSON.stringify(c.errors));
  assert.deepEqual(c.warnings, []);
  assert.equal(c.song.clips[0], session.clips[0], 'the clip copied is left as it was');
  assert.deepEqual(c.song.clips[1].notes[0].expr, { bend: [{ at: 0, value: 0 }, { at: 0.5, value: 0 }] });
  assert.match(c.diff.changes.map((x) => x.text).join(' '), /Adds the clip/);
  // What the ops made opens exactly as it is
  for (const r of [a, b]) assert.deepEqual(reopen(r.song).clips.map((x) => x.notes), r.song.clips.map((x) => x.notes));
  assert.deepEqual(reopen(c.song).clips[1].notes, c.song.clips[1].notes);
});

test('a curve cut at a note\'s end is no change of the note', () => {
  const opened = parseProject(song([bent()]));
  const before = { ...opened, clips: opened.clips.map((c) => ({ ...c, notes: [{ ...c.notes[0], duration: '2n' }] })) };
  const after = { ...before, clips: before.clips.map((c) => ({ ...c, notes: fitNotesCurves(c.notes) })) };
  assert.notEqual(after.clips[0].notes, before.clips[0].notes);
  assert.deepEqual(diffSongs(before, after).changes, []);
});

test('a caution for a value brought into range names the part in plain words, never a field path', () => {
  const ops = src('src/agent/ops.ts');
  const fn = ops.slice(ops.indexOf('function differsAt'), ops.indexOf('function keptWords'));
  assert.doesNotMatch(fn, /\(its \$\{path\}\)/);
  // A setting out of range: its own name, never "fx.filter.cutoff" or the like
  const opened = parseProject(song([]));
  const r = applyOps(opened, { opsVersion: 1, ops: [{ op: 'set_track', trackId: 't1', volumeDb: 20 }] }, { idBase: 'sg-d' });
  for (const w of r.warnings) assert.doesNotMatch(w, /\w\.\w|\[\d+\]/, w);
});
