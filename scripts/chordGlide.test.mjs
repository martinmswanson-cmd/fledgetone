// Glide between chords (src/store/chordGlide.ts): which notes glide into which (the least movement,
// the bass apart, chords of different sizes, a suspension resolving, a held note left alone, no
// leap past a fifth, no note with its own bend or chance), voices through three chords and more,
// the glides' times along a tempo change, nothing across a clip's end, and the clip setting saved,
// linked, worded for an agent and set as one undo step. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const G = await import('../src/store/chordGlide.ts');
const { syncPatterns } = await import('../src/store/patterns.ts');
const { serializeProject, parseProject } = await import('../src/store/project.ts');
const { defaultTrackFx, durationToBars } = await import('../src/store/timelineTypes.ts');

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
let k = 0;
const N = (note, start, duration = '2n', extra = {}) => ({ id: `n${++k}`, note, startOffset: start, duration, velocity: 0.8, ...extra });
const chord = (notes, start, duration = '2n') => notes.map((n) => N(n, start, duration));
const names = (pairs) => pairs.map((p) => `${p.from.note}>${p.to.note}${p.bass ? ' bass' : ''}`);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('each voice goes to the nearest note: the least movement in all', () => {
  const notes = [...chord(['C4', 'E4', 'G4'], 0), ...chord(['C4', 'F4', 'A4'], 0.5)];
  assert.deepEqual(names(G.glidePairs(notes, 1)), ['C4>C4', 'E4>F4', 'G4>A4']);
  // (written in any order)
  assert.deepEqual(names(G.glidePairs([...notes].reverse(), 1)), ['C4>C4', 'E4>F4', 'G4>A4']);
  // G7 to C: the leading note up, the 7th down
  const v = [...chord(['G3', 'B3', 'D4', 'F4'], 0), ...chord(['G3', 'C4', 'C4', 'E4'], 0.5)];
  assert.deepEqual(names(G.glidePairs(v, 1)), ['G3>G3', 'B3>C4', 'D4>C4', 'F4>E4']);
});

test('the bass pairs with the bass, on its own', () => {
  // Gm9 (G2 | G3 Bb3 D4 F4 A4) to C13 (C2 | E4 Bb4 D5 A5)
  const notes = [...chord(['G2', 'G3', 'A#3', 'D4', 'F4', 'A4'], 0), ...chord(['C2', 'E4', 'A#4', 'D5', 'A5'], 0.5)];
  const pairs = G.glidePairs(notes, 1);
  assert.deepEqual(pairs.filter((p) => p.bass).map((p) => `${p.from.note}>${p.to.note}`), ['G2>C2']);
  // (the upper voices never take the bass, nor the bass an upper note)
  for (const p of pairs.filter((q) => !q.bass)) assert.ok(p.from.note !== 'G2' && p.to.note !== 'C2');
  // A bass a fifth down glides; one an octave away starts afresh
  const far = [...chord(['G2', 'D4', 'G4'], 0), ...chord(['G1', 'D4', 'G4'], 0.5)];
  assert.deepEqual(names(G.glidePairs(far, 1)), ['D4>D4', 'G4>G4']);
});

test('chords of different sizes: the extra voices start or end as written', () => {
  const grow = [...chord(['C4', 'E4', 'G4'], 0), ...chord(['C4', 'E4', 'G4', 'B4'], 0.5)];
  const up = G.glidePairs(grow, 1);
  assert.equal(up.length, 3);
  assert.ok(!up.some((p) => p.to.note === 'B4'), 'the new 7th starts on its own');
  const shrink = [...chord(['D4', 'F4', 'A4', 'C5'], 0), ...chord(['D4', 'G4', 'B4'], 0.5)];
  const down = G.glidePairs(shrink, 1);
  assert.equal(down.length, 3);
  assert.equal(new Set(down.map((p) => p.from)).size, 3);
});

test('a suspension resolves: the 4th glides to the 3rd, the held notes left alone', () => {
  // C4 G4 held the whole bar, F4 for 3 beats, then E4 (as the chills progressions write a late suspension)
  const held = [N('C4', 0, '1m'), N('G4', 0, '1m')];
  const notes = [...held, N('F4', 0, '2n.'), N('E4', 0.75, '4n')];
  assert.deepEqual(names(G.glidePairs(notes, 1)), ['F4>E4']);
  // A pedal held over the change is in no pair; the chords around it glide
  const pedal = N('C3', 0, '1m');
  const over = [pedal, ...chord(['E4', 'G4'], 0), ...chord(['F4', 'A4'], 0.5)];
  const pairs = G.glidePairs(over, 1);
  assert.deepEqual(names(pairs), ['E4>F4', 'G4>A4']);
  assert.ok(!pairs.some((p) => p.from === pedal || p.to === pedal));
});

test('a leap of more than a fifth starts afresh', () => {
  assert.deepEqual(G.glidePairs([N('C4', 0), N('C5', 0.5)], 1), []);
  assert.deepEqual(G.glidePairs([N('C4', 0), N('G#4', 0.5)], 1), []);
  assert.equal(G.glidePairs([N('C4', 0), N('G4', 0.5)], 1).length, 1);
  // Notes that don't meet (a gap) don't glide
  assert.deepEqual(G.glidePairs([N('C4', 0, '4n'), N('D4', 0.5)], 1), []);
});

test('notes with their own bend, pressure or chance are never paired', () => {
  const bent = N('E4', 0, '2n', { expr: { bend: [{ at: 0, value: 0 }, { at: 0.25, value: 2 }] } });
  const soft = N('E4', 0, '2n', { expr: { pressure: [{ at: 0, value: 0.5 }] } });
  const chance = N('E4', 0, '2n', { chance: 0.5 });
  const cond = N('E4', 0, '2n', { cond: { n: 1, of: 2 } });
  for (const odd of [bent, soft, chance, cond]) {
    assert.deepEqual(G.glidePairs([odd, N('F4', 0.5)], 1), [], JSON.stringify(odd));
    assert.deepEqual(G.glidePairs([N('D4', 0), { ...odd, startOffset: 0.5 }], 1), []);
  }
  // A curve resting at nothing is plain
  assert.equal(G.glidePairs([N('E4', 0, '2n', { expr: { bend: [{ at: 0, value: 0 }] } }), N('F4', 0.5)], 1).length, 1);
});

test('a voice glides through three chords and more, as one held note', () => {
  const notes = [...chord(['C4', 'E4', 'G4'], 0, '4n'), ...chord(['B3', 'D4', 'G4'], 0.25, '4n'), ...chord(['C4', 'E4', 'A4'], 0.5, '4n'), ...chord(['C4', 'F4', 'A4'], 0.75, '4n')];
  const chains = G.glideChains(notes, 1);
  assert.equal(chains.length, 3);
  for (const c of chains) assert.equal(c.notes.length, 4);
  assert.deepEqual(chains.map((c) => c.notes.map((n) => n.note).join(' ')), ['C4 B3 C4 C4', 'E4 D4 E4 F4', 'G4 G4 A4 A4']);
  // As it sounds: one note from the first chord's start to the last's end, gliding at each change
  const s = G.chainSound(chains[0], 0, { ms: 120 }, 1, 120);
  assert.equal(s.startOffset, 0);
  close(durationToBars(s.duration), 1);
  assert.equal(s.velocity, 0.8);
  assert.equal(s.expr.pressure, undefined, 'the same level throughout: no pressure');
  const bend = s.expr.bend;
  // (2 s a bar at 120: the glide down a semitone starts at the change and takes 0.12 s, eased)
  close(bend.find((p) => p.value === 0 && p.at > 0).at, 0.25);
  const down = bend.filter((p) => p.at > 0.25 && p.at <= 0.25 + 0.06 + 1e-9);
  close(down[down.length - 1].at, 0.25 + 0.12 / 2);
  close(down[down.length - 1].value, -1);
  // eased: it starts and ends slowly
  assert.ok(Math.abs(down[0].value) < 0.05 && Math.abs(down[down.length - 2].value + 1) < 0.05);
  // From part way (playback begun at the second chord): the voice from there, its pitch its own
  const from = G.chainSound(chains[0], 1, { ms: 120 }, 1, 120);
  close(from.startOffset, 0.25);
  close(durationToBars(from.duration), 0.75);
  assert.equal(from.expr.bend[0].value, 0);
  assert.ok(from.expr.bend.some((p) => Math.abs(p.value - 1) < 1e-9), 'B3 up to C4: +1');
});

test('a softer chord: the voice’s pressure follows it, from the loudest, never up past it', () => {
  const a = N('C4', 0, '2n', { velocity: 1 });
  const b = N('D4', 0.5, '2n', { velocity: 0.5 });
  const [chain] = G.glideChains([a, b], 1);
  const s = G.chainSound(chain, 0, { ms: 100 }, 1, 120);
  assert.equal(s.velocity, 1);
  const p = s.expr.pressure;
  assert.equal(p[0].value, 1);
  close(p[p.length - 1].value, 0.5);
  assert.ok(p.every((q) => q.value <= 1 && q.value >= 0.5));
  const louder = G.chainSound(G.glideChains([{ ...a, velocity: 0.5 }, { ...b, velocity: 1 }], 1)[0], 0, { ms: 100 }, 1, 120);
  assert.equal(louder.velocity, 1);
  assert.equal(louder.expr.pressure[0].value, 0.5, 'struck at the first note’s level');
});

test('the glide time is in milliseconds whatever the tempo, and the bass has its own', () => {
  // 120 BPM to bar 2, then 60: the change at bar 2 is 2 s in; the second note (a bar at 60) lasts 4 s
  const tempo = { bpm: 120, points: [{ id: 't', bar: 2, bpm: 60, ramp: false }] };
  const notes = [N('C4', 0, '1m'), N('D4', 1, '1m')];
  const [chain] = G.glideChains(notes, 2);
  const s = G.chainSound(chain, 0, { ms: 200 }, 1, tempo);
  close(s.spb, 2);
  close(durationToBars(s.duration), 3, 2 / 768);
  const pts = s.expr.bend;
  close(pts.find((p) => p.value === 0 && p.at > 0).at, 1);
  close(pts[pts.length - 1].at, (2 + 0.2) / 2);
  close(pts[pts.length - 1].value, 2);
  // The same notes from bar 3, at the slow tempo: the glide still 0.2 s
  const later = G.chainSound(chain, 0, { ms: 200 }, 3, tempo);
  close(later.spb, 4);
  close(later.expr.bend[later.expr.bend.length - 1].at - 1, 0.2 / 4);
  // The bass's own time
  const bassy = [...chord(['G2', 'G3', 'B3'], 0), ...chord(['C2', 'G3', 'C4'], 0.5)];
  const bassChain = G.glideChains(bassy, 1).find((c) => c.bass[0]);
  const b = G.chainSound(bassChain, 0, { ms: 100, bassMs: 300 }, 1, 120);
  close(b.expr.bend[b.expr.bend.length - 1].at, 0.5 + 0.3 / 2);
  // A glide never takes more than half the note it glides into
  const short = G.chainSound(G.glideChains([N('C4', 0, '2n'), N('D4', 0.5, '32n')], 1)[0], 0, { ms: 400 }, 1, 120);
  close(short.expr.bend[short.expr.bend.length - 1].at, 0.5 + 1 / 64);
});

test('nothing glides across the clip’s end, nor into notes hidden by a trim', () => {
  const notes = [N('C4', 0.5), N('D4', 1)];
  assert.deepEqual(G.glidePairs(notes, 1), []);
  assert.equal(G.glidePairs(notes, 2).length, 1);
  // a note before the clip's start (trimmed away) isn't paired either
  assert.deepEqual(G.glidePairs([N('C4', -0.5), N('D4', 0)], 1), []);
});

test('the setting: read from files and links, kept in range, and older files without it', () => {
  assert.deepEqual(G.normalizeClipGlide({ ms: 150 }), { ms: 150 });
  assert.deepEqual(G.normalizeClipGlide({ ms: 5 }), { ms: G.GLIDE_MS_MIN });
  assert.deepEqual(G.normalizeClipGlide({ ms: 9000, bassMs: 200 }), { ms: G.GLIDE_MS_MAX, bassMs: 200 });
  assert.deepEqual(G.normalizeClipGlide({ ms: 150, bassMs: 150 }), { ms: 150 });
  for (const bad of [null, 3, 'x', {}, { ms: 'fast' }, { ms: NaN }]) assert.equal(G.normalizeClipGlide(bad), undefined);
  const track = { id: 't1', name: 'Pad', color: '#fff', instrumentKey: 'wavetable', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0 };
  const clip = (id, extra = {}) => ({ id, trackId: 't1', name: 'Chords', startBar: 1, lengthBars: 2, notes: [N('C4', 0), N('D4', 0.5)], isSelected: false, ...extra });
  const p = { name: 'Glide', bpm: 90, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [track], clips: [clip('a', { glide: { ms: 150, bassMs: 220 } }), clip('b')] };
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject(p))));
  assert.deepEqual(back.clips[0].glide, { ms: 150, bassMs: 220 });
  assert.equal('glide' in back.clips[1], false);
  // A file whose glide this version can't read plays the chords as written
  const odd = parseProject(JSON.parse(JSON.stringify({ ...serializeProject(p), clips: [clip('c', { glide: 'yes' })] })));
  assert.equal('glide' in odd.clips[0], false);
  // (the project's version doesn't change: an older app opens it and plays the chords as written)
  assert.match(src('src/store/project.ts'), /export const PROJECT_VERSION = 1;/);
});

test('linked clips share the glide', () => {
  const notes = [N('C4', 0), N('D4', 0.5)];
  const a = { id: 'a', trackId: 't1', name: 'A', startBar: 1, lengthBars: 1, notes, isSelected: false, pattern: 'p' };
  const b = { ...a, id: 'b', startBar: 5 };
  const edited = [{ ...a, glide: { ms: 200 } }, b];
  const synced = syncPatterns([a, b], edited);
  assert.deepEqual(synced[1].glide, { ms: 200 });
  assert.equal(synced[1].glide, synced[0].glide);
  const off = syncPatterns(synced, [synced[0], (({ glide: _g, ...rest }) => rest)(synced[1])]);
  assert.equal(off[0].glide, undefined);
});

test('switching it is one undo step; no change, no step', () => {
  const store = src('src/store/timelineStore.ts');
  const body = store.slice(store.indexOf('    setClipGlide: (clipId, glide, record = true) =>'), store.indexOf('    setClipGroove: (clipId, groove, record = true) =>'));
  assert.match(body, /=== JSON\.stringify\(next \?\? null\)\) return s;/);
  assert.match(body, /\.\.\.\(record \? pushPast\(s\) : \{\}\)/);
  // An agent's view of the change, in plain words
  const diff = src('src/agent/songDiff.ts');
  assert.match(diff, /glide into each other/);
});

test('only the chord synths built on voices of their own glide', () => {
  for (const key of ['wavetable', 'keys', 'brass']) assert.ok(G.chordGlideSupport({ instrumentKey: key }));
  for (const key of ['piano', 'strings', 'plugin', 'lead', 'bass', 'supersaw', 'multi']) assert.ok(!G.chordGlideSupport({ instrumentKey: key }));
});
