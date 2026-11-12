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

test('a note both chords share is held, not glided: only the voices that change move', () => {
  // A block shift up a third: E4 and G4 are in both, so they hold; C4 can't reach B4 (11 semitones)
  const shift = [...chord(['C4', 'E4', 'G4'], 0), ...chord(['E4', 'G4', 'B4'], 0.5)];
  assert.deepEqual(names(G.glidePairs(shift, 1)), ['E4>E4', 'G4>G4']);
  // Gm9 (G2 | A#3 D4 F4 A4) to C13 (C2 | A#3 E4 A4 D5): A#3 and A4 held, F4 down a semitone to E4 (the least movement), D4 ends, D5 starts (the bass a 4th: afresh)
  const gc = [...chord(['G2', 'A#3', 'D4', 'F4', 'A4'], 0), ...chord(['C2', 'A#3', 'E4', 'A4', 'D5'], 0.5)];
  assert.deepEqual(names(G.glidePairs(gc, 1)), ['A#3>A#3', 'F4>E4', 'A4>A4']);
  // A held voice is one note through both chords: no glide in its curve
  const held = G.glideChains(gc, 1).find((c) => c.notes[0].note === 'A4');
  assert.equal(G.chainSound(held, 0, { ms: 150 }, 1, 120).expr, undefined);
  // The moving voices never cross a held one: E4 G4 to G4 C5 holds G4, and E4 doesn't jump over it to C5
  assert.deepEqual(names(G.glidePairs([...chord(['E4', 'G4'], 0), ...chord(['G4', 'C5'], 0.5)], 1)), ['G4>G4']);
  // ...but moves beside it: C4 G4 to D4 G4
  assert.deepEqual(names(G.glidePairs([...chord(['C4', 'G4'], 0), ...chord(['D4', 'G4'], 0.5)], 1)), ['C4>D4', 'G4>G4']);
  // The same notes in any order, the same pairs
  assert.deepEqual(names(G.glidePairs([...gc].reverse(), 1)), names(G.glidePairs(gc, 1)));
});

test('notes of the same pitch pair by their start and id, whatever their order in the clip', () => {
  const a1 = { ...N('C4', 0), id: 'a1' };
  const a2 = { ...N('C4', 0), id: 'a2' };
  const b1 = { ...N('C4', 0.5), id: 'b1' };
  const b2 = { ...N('D4', 0.5), id: 'b2' };
  const ids = (ps) => ps.map((p) => `${p.from.id}>${p.to.id}`).join(' ');
  const want = ids(G.glidePairs([a1, a2, b1, b2], 1));
  for (const order of [[a2, a1, b2, b1], [b1, a2, b2, a1], [b2, b1, a1, a2]]) assert.equal(ids(G.glidePairs(order, 1)), want);
  assert.equal(want, 'a1>b1 a2>b2');
});

test('each glide starts where its chord really sounds: a late chord (swing, a feel, Human) glides late', () => {
  const notes = [N('C4', 0, '8n'), N('D4', 0.125, '8n'), N('E4', 0.25, '4n')];
  const [chain] = G.glideChains(notes, 1);
  // The second note 0.085 s late (swung), the third on time; 120 BPM: 2 s a bar
  const late = (n) => (n === notes[1] ? 0.085 : 0);
  const s = G.chainSound(chain, 0, { ms: 60 }, 1, 120, undefined, late);
  const starts = s.expr.bend.filter((p, i, all) => i > 0 && p.value === all[i - 1].value).map((p) => p.at * 2);
  close(starts[0], 0.25 + 0.085);
  close(starts[1], 0.5);
  // (from part way: its first note late too, everything measured from where it sounds)
  const from = G.chainSound(chain, 1, { ms: 60 }, 1, 120, undefined, late);
  close(from.expr.bend.find((p, i, all) => i > 0 && p.value === all[i - 1].value).at * 2, 0.5 - 0.25 - 0.085);
  close(durationToBars(from.duration) * 2, 1 - 0.25 - 0.085, 0.003);
});

test('the lines are drawn from the notes as they play: the sustain pedal stops a glide there too', () => {
  const notes = [N('C4', 0, '4n'), N('D4', 0.25, '4n')];
  assert.equal(G.clipGlidePairs({ notes, lengthBars: 1 }).length, 1);
  const pedal = { sustain: [{ at: 0, value: 1 }, { at: 1, value: 1 }] };
  assert.equal(G.clipGlidePairs({ notes, lengthBars: 1, expression: pedal }).length, 0);
});

test('no voice zig-zags: one that has just glided up never glides straight back down (nor down then up)', () => {
  // The top line E5 F5 E5 F5 (as the soul turnaround's top voice goes): F5 glided up from E5, so it ends and E5 starts afresh
  const top = [N('E5', 0), N('F5', 0.5), N('E5', 1), N('F5', 1.5)];
  assert.deepEqual(names(G.glidePairs(top, 2)), ['E5>F5', 'E5>F5']);
  // A voice that held in between may turn: up, held, down
  assert.equal(G.glidePairs([N('E5', 0), N('F5', 0.5), N('F5', 1), N('E5', 1.5)], 2).length, 3);
  // The bass too: down a fifth, then not straight back up
  const bass = [...chord(['D3', 'C4', 'F4'], 0), ...chord(['G2', 'B3', 'F4'], 0.5), ...chord(['C3', 'C4', 'E4'], 1)];
  assert.ok(!G.glidePairs(bass, 1.5).some((p) => p.from.note === 'G2' && p.to.note === 'C3'));
});

test('the soul turnaround in F (rich, a chord each half bar): no voice leaps, none zig-zags', async () => {
  const X = await import('../src/store/chills.ts');
  const { keyOf } = await import('../src/store/songKey.ts');
  const { midiOf } = await import('../src/store/noteTools.ts');
  const key = keyOf(5, 'major');
  const prog = X.chillsById('soulTurn');
  const count = X.chillsChords(key, prog).length;
  let id = 0;
  const notes = X.chillsNotes(key, prog, Array.from({ length: count }, (_, i) => ({ start: i / 2, length: 0.5 })), () => `s${++id}`, { range: [36, 96], voicing: 'rich' });
  const pairs = G.glidePairs(notes, count / 2);
  for (const p of pairs) {
    const d = Math.abs(midiOf(p.to.note) - midiOf(p.from.note));
    assert.ok(d <= (p.bass ? G.GLIDE_MAX_BASS : G.GLIDE_MAX_UPPER), `${p.from.note} to ${p.to.note}`);
  }
  for (const c of G.glideChains(notes, count / 2)) {
    const m = c.notes.map((n) => midiOf(n.note));
    for (let i = 2; i < m.length; i++) assert.ok(Math.sign(m[i - 1] - m[i - 2]) * Math.sign(m[i] - m[i - 1]) >= 0, `zig-zag in ${c.notes.map((n) => n.note).join(' ')}`);
  }
  // (before: D4 up a 4th to G4, then F4, then G4; the top E5 F5 E5 E5 E5 F5 E5 F5 F5 E5 F5 as one voice; A4 up a 4th to D5)
  assert.ok(!pairs.some((p) => p.from.note === 'D4' && p.to.note === 'G4'));
  assert.ok(!pairs.some((p) => p.from.note === 'A4' && p.to.note === 'D5'));
});

test('the bass glides a whole step at most, on its own; along the roots (ii, V, I) it starts each note fresh', () => {
  // A ii–V–I in F with its roots under it: D3, G2, C3, F2 move a 4th or a 5th: no bass glide at all (it swooped low and high)
  const iiVI = [...chord(['D3', 'C4', 'F4', 'A4'], 0), ...chord(['G2', 'A#3', 'F4', 'A4'], 0.5), ...chord(['C3', 'A#3', 'E4', 'G4'], 1), ...chord(['F2', 'A3', 'F4', 'A4'], 1.5)];
  assert.deepEqual(G.glidePairs(iiVI, 2).filter((p) => p.bass), []);
  // (and the upper voices never take the bass, nor the bass an upper note)
  for (const p of G.glidePairs(iiVI, 2)) for (const b of ['D3', 'G2', 'C3', 'F2']) assert.ok(p.from.note !== b && p.to.note !== b);
  // A whole step and a half step still glide, in the bass's own time
  const steps = [...chord(['C3', 'A#3', 'E4'], 0), ...chord(['D3', 'A3', 'F4'], 0.5), ...chord(['C#3', 'A3', 'E4'], 1)];
  assert.deepEqual(G.glidePairs(steps, 1.5).filter((p) => p.bass).map((p) => `${p.from.note}>${p.to.note}`), ['C3>D3']);
  assert.deepEqual(G.glidePairs([...chord(['C3', 'A#3', 'E4'], 0), ...chord(['A#2', 'A3', 'F4'], 0.5)], 1).filter((p) => p.bass).map((p) => `${p.from.note}>${p.to.note}`), ['C3>A#2']);
  assert.equal(G.GLIDE_MAX_BASS, 2);
  // An octave away starts afresh too
  const far = [...chord(['G2', 'D4', 'G4'], 0), ...chord(['G1', 'D4', 'G4'], 0.5)];
  assert.deepEqual(names(G.glidePairs(far, 1)), ['D4>D4', 'G4>G4']);
});

test('a voice leaping a 4th while its neighbours hold starts fresh (the soul turnaround at 8 s and 22 s)', () => {
  // C13 (C3 | A#3 C4 D4 A4 E5) to Am7 (A2 | C4 G4 A4 E5): D4 doesn't go up to G4
  const at8 = [...chord(['C3', 'A#3', 'C4', 'D4', 'A4', 'E5'], 0), ...chord(['A2', 'C4', 'G4', 'A4', 'E5'], 0.5)];
  assert.deepEqual(names(G.glidePairs(at8, 1)), ['C4>C4', 'A4>A4', 'E5>E5']);
  // Am7 (A2 | C4 G4 A4 E5) to D7#9 (D3 | C4 F#4 D5 F5): A4 doesn't go up to D5
  const at22 = [...chord(['A2', 'C4', 'G4', 'A4', 'E5'], 0), ...chord(['D3', 'C4', 'F#4', 'D5', 'F5'], 0.5)];
  assert.ok(!G.glidePairs(at22, 1).some((p) => p.from.note === 'A4'));
  assert.ok(G.glidePairs(at22, 1).every((p) => p.from.note !== 'A2'));
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

test('a voice glides a step or two at most (a minor 3rd); a bigger leap starts afresh, as a choir\u2019s voices move', () => {
  assert.deepEqual(G.glidePairs([N('C4', 0), N('C5', 0.5)], 1), []);
  assert.deepEqual(G.glidePairs([N('C4', 0), N('G#4', 0.5)], 1), []);
  assert.deepEqual(G.glidePairs([N('C4', 0), N('G4', 0.5)], 1), []);
  assert.deepEqual(G.glidePairs([N('C4', 0), N('F4', 0.5)], 1), []);
  assert.deepEqual(G.glidePairs([N('C4', 0), N('E4', 0.5)], 1), []);
  assert.equal(G.glidePairs([N('C4', 0), N('D#4', 0.5)], 1).length, 1);
  assert.equal(G.GLIDE_MAX_UPPER, 3);
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
  const notes = [...chord(['C4', 'E4', 'G4'], 0, '4n'), ...chord(['B3', 'D4', 'G4'], 0.25, '4n'), ...chord(['A3', 'C4', 'F4'], 0.5, '4n'), ...chord(['A3', 'C4', 'E4'], 0.75, '4n')];
  const chains = G.glideChains(notes, 1);
  assert.equal(chains.length, 3);
  for (const c of chains) assert.equal(c.notes.length, 4);
  assert.deepEqual(chains.map((c) => c.notes.map((n) => n.note).join(' ')), ['C4 B3 A3 A3', 'E4 D4 C4 C4', 'G4 G4 F4 E4']);
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
  assert.ok(from.expr.bend.some((p) => Math.abs(p.value + 2) < 1e-9), 'B3 down to A3: -2');
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
  // (a change of level takes 150 ms at least, even under a short glide: at 120 BPM, 0.075 bar)
  const lp = louder.expr.pressure;
  close(lp[lp.length - 1].at, 0.5 + 0.15 / 2);
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
  const bassy = [...chord(['G2', 'G3', 'B3'], 0), ...chord(['A2', 'G3', 'C4'], 0.5)];
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
