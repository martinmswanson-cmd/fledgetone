// Notes that play only some of the time (src/store/noteChance.ts): the chance and condition
// decision, the pass a clip plays on (its run of copies, the live loop's times round), and the
// fields surviving a project file, the autosave and a share link. Run with `npm test`.
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

// The autosave writes to browser storage: a stand-in for it
const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => void stored.set(k, String(v)),
  removeItem: (k) => void stored.delete(k),
  key: (i) => [...stored.keys()][i] ?? null,
  get length() {
    return stored.size;
  },
};

const c = await import('../src/store/noteChance.ts');
const { noteSeed } = await import('../src/audio/human.ts');
const { parseProject, serializeProject, PROJECT_FORMAT, PROJECT_VERSION, writeAutosave, preservePreviousSession } = await import('../src/store/project.ts');
const { songLink, projectFromHash } = await import('../src/store/shareLink.ts');
const { rollDrums, guessDrumStyle } = await import('../src/store/smartTools.ts');

const n = (id, note, at, extra = {}) => ({ id, note, startOffset: at, duration: '16n', velocity: 0.8, ...extra });
const clip = (id, startBar, lengthBars, notes, extra = {}) => ({ id, trackId: 't1', name: id, startBar, lengthBars, notes, isSelected: false, ...extra });

test('a condition plays its pass of every n, and nothing else', () => {
  const first = { cond: { n: 1, of: 2 } };
  const second = { cond: { n: 2, of: 2 } };
  assert.deepEqual([0, 1, 2, 3].map((p) => c.notePlays(first, 1, p)), [true, false, true, false]);
  assert.deepEqual([0, 1, 2, 3].map((p) => c.notePlays(second, 1, p)), [false, true, false, true]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((p) => c.notePlays({ cond: { n: 4, of: 4 } }, 9, p)), [false, false, false, true, false, false, false, true]);
  assert.equal(c.notePlays({}, 1, 5), true);
});

test('a chance decides the same way for the same note and pass, and plays about that often', () => {
  const half = { chance: 0.5 };
  for (let p = 0; p < 20; p++) assert.equal(c.notePlays(half, 1234, p), c.notePlays(half, 1234, p));
  let plays = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (c.notePlays(half, noteSeed('clip', 'F#1', i * 48), 0)) plays++;
  assert.ok(Math.abs(plays / N - 0.5) < 0.04, `played ${plays} of ${N}`);
  let quarter = 0;
  for (let i = 0; i < N; i++) if (c.notePlays({ chance: 0.25 }, noteSeed('clip', 'F#1', 0), i)) quarter++;
  assert.ok(Math.abs(quarter / N - 0.25) < 0.04, `played ${quarter} of ${N} passes`);
  // A condition comes first: a 1st-of-2 note with a chance never plays on the 2nd pass
  for (let i = 0; i < 50; i++) assert.equal(c.notePlays({ chance: 0.99, cond: { n: 1, of: 2 } }, i, 1), false);
});

test('saved values are checked', () => {
  assert.equal(c.normalizeChance(0.5), 0.5);
  assert.equal(c.normalizeChance(1), undefined);
  assert.equal(c.normalizeChance('0.5'), undefined);
  assert.equal(c.normalizeChance(0), 0.01);
  assert.deepEqual(c.normalizeCond({ n: 1, of: 4 }), { n: 1, of: 4 });
  assert.equal(c.normalizeCond({ n: 5, of: 4 }), undefined);
  assert.equal(c.normalizeCond({ n: 1, of: 1 }), undefined);
  assert.equal(c.normalizeCond({ n: 1.5, of: 4 }), undefined);
  assert.equal(c.chanceMark({ chance: 0.25, cond: { n: 1, of: 2 } }), '1:2 25%');
  assert.equal(c.chanceIdOf({ cond: { n: 2, of: 2 } }), '2of2');
  const plain = c.withChance(n('a', 'C1', 0, { chance: 0.5 }), '1of4');
  assert.deepEqual([plain.chance, plain.cond], [undefined, { n: 1, of: 4 }]);
  assert.equal('chance' in c.withChance(plain, 'always') || 'cond' in c.withChance(plain, 'always'), false);
});

test('copies side by side count passes; another pattern between starts the count again', () => {
  const notes = [n('a', 'F#1', 0, { cond: { n: 1, of: 2 } })];
  const other = [n('b', 'C1', 0, { chance: 0.5 })];
  // A A B A, linked: passes 0 1 0 for the As
  const clips = [clip('a1', 1, 4, notes, { pattern: 'p' }), clip('a2', 5, 4, notes, { pattern: 'p' }), clip('b1', 9, 4, other), clip('a3', 13, 4, notes, { pattern: 'p' })];
  const runs = c.clipRuns(clips);
  assert.deepEqual(['a1', 'a2', 'b1', 'a3'].map((id) => c.passOf(runs.get(id), 0, null)), [0, 1, 0, 0]);
  // Unlinked copies with the same notes count too (Duplicate, the launcher's repeats); a gap breaks the run
  const loose = c.clipRuns([clip('x1', 1, 2, notes), clip('x2', 3, 2, [...notes]), clip('x3', 6, 2, notes)]);
  assert.deepEqual(['x1', 'x2', 'x3'].map((id) => loose.get(id).index), [0, 1, 0]);
  // Clips with nothing conditional aren't listed
  assert.equal(c.clipRuns([clip('plain', 1, 1, [n('p', 'C1', 0)])]).size, 0);
});

test('a live loop counts on as if the loop were written out as copies', () => {
  const notes = [n('a', 'F#1', 0, { cond: { n: 1, of: 2 } })];
  // One clip looped: 0, 1, 2...
  const one = c.clipRuns([clip('a', 1, 4, notes)]);
  const loop = { inBar: 1, outBar: 5 };
  assert.deepEqual([0, 1, 2, 3].map((w) => c.passOf(one.get('a'), w, loop)), [0, 1, 2, 3]);
  // A A looped: 0 1, 2 3, 4 5
  const two = c.clipRuns([clip('a', 1, 4, notes, { pattern: 'p' }), clip('b', 5, 4, notes, { pattern: 'p' })]);
  const loop2 = { inBar: 1, outBar: 9 };
  assert.deepEqual([0, 1, 2].flatMap((w) => ['a', 'b'].map((id) => c.passOf(two.get(id), w, loop2))), [0, 1, 2, 3, 4, 5]);
  // A B looped: A is on its first pass every time (B comes between)
  const ab = c.clipRuns([clip('a', 1, 4, notes), clip('b', 5, 4, [n('b', 'C1', 0, { chance: 0.5 })])]);
  assert.deepEqual([0, 1, 2].map((w) => c.passOf(ab.get('a'), w, loop2)), [0, 0, 0]);
  // A A B A looped: written out, A A B A A A B A... so the first A follows the last one round the loop
  const aaba = c.clipRuns([clip('a1', 1, 1, notes, { pattern: 'p' }), clip('a2', 2, 1, notes, { pattern: 'p' }), clip('b', 3, 1, [n('b', 'C1', 0, { chance: 0.5 })]), clip('a3', 4, 1, notes, { pattern: 'p' })]);
  const loop4 = { inBar: 1, outBar: 5 };
  assert.deepEqual(['a1', 'a2', 'a3'].map((id) => c.passOf(aaba.get(id), 0, loop4)), [0, 1, 0]);
  assert.deepEqual(['a1', 'a2', 'a3'].map((id) => c.passOf(aaba.get(id), 1, loop4)), [1, 2, 0]);
  // A clip outside the loop keeps its place in the song
  const four = c.clipRuns([1, 2, 3, 4].map((b) => clip(`a${b}`, b, 1, notes, { pattern: 'p' })));
  assert.equal(c.passOf(four.get('a4'), 3, { inBar: 2, outBar: 4 }), 3);
  // A loop over the middle two of four copies: 1 2, then 3 4...
  assert.deepEqual([0, 1].flatMap((w) => ['a2', 'a3'].map((id) => c.passOf(four.get(id), w, { inBar: 2, outBar: 4 }))), [1, 2, 3, 4]);
});

test('a "1st of 2" note plays on alternate copies, the same in every render', () => {
  const notes = [n('a', 'F#1', 0, { cond: { n: 1, of: 2 } }), n('h', 'F#1', 0.25, { chance: 0.5 })];
  const clips = [1, 5, 9, 13].map((b) => clip(`c${b}`, b, 4, notes, { pattern: 'p' }));
  const render = () => {
    const runs = c.clipRuns(clips);
    return clips.map((cl) => cl.notes.map((note) => c.notePlays(note, noteSeed(cl.id, note.note, Math.round((cl.startBar + note.startOffset) * 768)), c.passOf(runs.get(cl.id), 0, null))));
  };
  const once = render();
  assert.deepEqual(once.map((r) => r[0]), [true, false, true, false]);
  assert.deepEqual(render(), once);
});

const SONG = () =>
  parseProject({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: 'Chance',
    bpm: 128,
    tracks: [{ id: 't1', name: 'Drums', color: '#f472b6', instrumentKey: 'drums', isMuted: false, isSoloed: false, isArmed: false, volume: -6, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0 }],
    clips: [clip('k', 1, 1, [n('n1', 'C1', 0), n('n2', 'F#1', 0.125, { chance: 0.5 }), n('n3', 'F#1', 0.25, { cond: { n: 2, of: 4 } }), n('n4', 'D1', 0.5, { chance: 0.75, cond: { n: 1, of: 2 }, expr: { bend: [{ at: 0, value: 0 }, { at: 0.1, value: 1 }] } }), n('n5', 'A#1', 0.75, { chance: 'lots', cond: { n: 9, of: 2 } })])],
  });
const whens = (p) => p.clips[0].notes.map((x) => [x.note, x.chance, x.cond]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

test('chance and condition survive a file, the autosave and a link; old files and bad values open', async () => {
  const song = SONG();
  assert.deepEqual(song.clips[0].notes.map((x) => [x.chance, x.cond]), [[undefined, undefined], [0.5, undefined], [undefined, { n: 2, of: 4 }], [0.75, { n: 1, of: 2 }], [undefined, undefined]]);
  const file = parseProject(JSON.parse(JSON.stringify(serializeProject(song))));
  assert.deepEqual(whens(file), whens(song));
  assert.equal(writeAutosave(song).ok, true);
  const back = preservePreviousSession();
  assert.deepEqual(whens(back.project), whens(song));
  assert.deepEqual(back.project.clips[0].notes.find((x) => x.note === 'D1').expr.bend[1], { at: 0.1, value: 1 });
  const link = await songLink(song, 'https://example.com/app');
  const shared = await projectFromHash(link.slice(link.indexOf('#')));
  assert.deepEqual(whens(shared), whens(song));
  // The draw comes from the clip's id: a link keeps it, so the same notes play for whoever opens it
  assert.equal(shared.clips[0].id, song.clips[0].id);
});

test('the dice keep the kick and snare, re-roll the rest within the style, and repeat for a seed', () => {
  let id = 0;
  const newId = () => `d${id++}`;
  const beat = [
    ...[0, 0.25, 0.5, 0.75].map((at, i) => n(`k${i}`, 'C1', at)),
    ...[0.25, 0.75].map((at, i) => n(`c${i}`, 'D#1', at)),
    ...[0.125, 0.375, 0.625, 0.875].map((at, i) => n(`h${i}`, 'A#1', at)),
  ];
  assert.equal(guessDrumStyle(beat, 1), 'house');
  const a = rollDrums(beat, { lengthBars: 1, seed: 7, newId });
  const b = rollDrums(beat, { lengthBars: 1, seed: 7, newId });
  assert.deepEqual(a.map((x) => [x.note, x.startOffset, x.velocity, x.chance]), b.map((x) => [x.note, x.startOffset, x.velocity, x.chance]));
  const skeleton = (ns) => ns.filter((x) => x.note === 'C1' || x.note === 'D#1').map((x) => `${x.note}@${x.startOffset}`).sort();
  assert.deepEqual(skeleton(a), skeleton(beat));
  assert.ok(a.some((x) => x.note === 'F#1' || x.note === 'A#1'), 'the hats come back');
  // Different seeds give different hats
  const takes = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(rollDrums(beat, { lengthBars: 1, seed, newId }).filter((x) => x.note !== 'C1' && x.note !== 'D#1').map((x) => [x.note, x.startOffset, x.chance]))));
  assert.ok(takes.size > 2);
  // One row: only that drum changes
  const row = rollDrums(beat, { lengthBars: 1, seed: 3, newId, row: 'C1' });
  assert.deepEqual(row.filter((x) => x.note !== 'C1').map((x) => x.id).sort(), beat.filter((x) => x.note !== 'C1').map((x) => x.id).sort());
  assert.ok(row.some((x) => x.note === 'C1' && x.startOffset === 0), 'the downbeat kick stays');
  // Nothing written yet: a whole beat in the style
  assert.ok(rollDrums([], { lengthBars: 2, seed: 1, newId, style: 'rock' }).some((x) => x.note === 'D1'));
  // Everything stays inside the section
  for (const x of rollDrums(beat, { lengthBars: 1, seed: 11, newId })) assert.ok(x.startOffset >= 0 && x.startOffset < 1);
});
