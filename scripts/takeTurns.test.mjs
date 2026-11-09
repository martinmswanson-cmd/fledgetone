// Which take a recorded instrument plays for a song's note, and which way a guitar strums a song's chord
// (src/audio/takeTurns.ts trackTakes): worked out from the song's start as the instrument plays the notes (only
// the ones that play, each at the loudness it really plays at), so they're the same live from wherever playback
// began, after a pause, on every pass of a loop and in every export, and a sound never plays the same recording
// twice running where a kit counting its own hits from bar 1 never did. Run with `npm test`.
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

const { humanVelocities, loudnessOf, recordedLoudness, sampledLoudnesses, takeOf, takesFollowPlaces, takesKind, trackTakes } = await import('../src/audio/takeTurns.ts');
const { readFileSync } = await import('node:fs');
const { drumHits } = await import('../src/audio/drumHits.ts');
const { jitterAt, noteJitter, atSongPlace } = await import('../src/audio/songPlace.ts');
const { noteDrift, noteSeed } = await import('../src/audio/human.ts');
const { notePlays } = await import('../src/store/noteChance.ts');
const { strumPlan, strumsDown } = await import('../src/audio/guitarStrum.ts');
const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
const { DRUM_NOTES } = await import('../src/store/drumNotes.ts');

/** Transport ticks: 192 a quarter note; at 120 BPM a quarter is half a second */
const Q = 192;
const BAR = 4 * Q;
const placeOfTick = (tick) => (tick / Q) * 0.5;
const KITS = ['studioKit', 'sessionKit', 'brushKit', 'latinPercussion', 'percussionExtras'];
/** A new recorded-kit track's Human insert (the kit's player feel) */
const KIT_FEEL = { human: { on: true, timing: 0.06, dynamics: 0.2, pitch: 0 }, together: true };

/** A track's song items: one group per tick of `notes` ({ tick, note, velocity, chance? }), its seeds as the scheduler makes them. */
function items(notes, clipId = 'c') {
  const byTick = new Map();
  for (const n of notes) {
    if (!byTick.has(n.tick)) byTick.set(n.tick, []);
    byTick.get(n.tick).push(n);
  }
  return [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, ns]) => {
      const conds = ns.some((n) => n.chance !== undefined) ? ns.map((n) => (n.chance !== undefined ? { chance: n.chance } : null)) : undefined;
      return { tick, notes: ns.map((n) => ({ note: n.note, velocity: n.velocity, duration: '16n' })), seeds: ns.map((n) => noteSeed(clipId, n.note, tick)), ...(conds ? { conds, pass: 0 } : {}), place: placeOfTick(tick) };
    });
}

/** Hits of `note` every `step` ticks from `from` over `bars` bars at `velocity` (or a velocity per tick). */
const every = (note, step, { from = 0, bars = 8, velocity = 0.8, chance } = {}) => {
  const out = [];
  for (let tick = from; tick < bars * BAR; tick += step) out.push({ tick, note, velocity: typeof velocity === 'function' ? velocity(tick) : velocity, ...(chance !== undefined ? { chance } : {}) });
  return out;
};

/**
 * What a fresh recorded kit plays for the song from bar 1, written out the plain way: for each group the notes
 * that play, their velocities under the Human insert, the hits the kit plays (an Expressive kit's own level in
 * them), each hit's loudness, and a count per sound and loudness (the kit's own counter). Each hit with the take
 * the song's turns give it (trackTakes), to check they agree.
 */
function kitPlays(key, expressive, feel, list) {
  const tops = INSTRUMENTS[key].samples.layers;
  const takes = trackTakes(key, expressive, feel, list);
  const count = new Map();
  const hits = [];
  list.forEach((g, gi) => {
    const kept = g.notes.map((_, i) => i).filter((i) => !g.conds?.[i] || notePlays(g.conds[i], g.seeds[i], g.pass));
    if (!kept.length) return;
    const notes = kept.map((i) => g.notes[i]);
    const seeds = kept.map((i) => g.seeds[i]);
    const velocities = feel ? humanVelocities({ notes, seeds }, feel) : notes.map((n) => n.velocity);
    const place = feel ? g.place + noteDrift(seeds[0], feel.human).late : g.place;
    for (const h of drumHits(notes.map((n, k) => ({ ...n, velocity: velocities[k] })), (row, salt) => jitterAt(row, place, salt), expressive, false)) {
      const note = DRUM_NOTES[h.row];
      const l = recordedLoudness(h.velocity, tops, tops.length, () => true);
      const k = `${note}|${l}`;
      const n = count.get(k) ?? 0;
      count.set(k, n + 1);
      const turns = takes[gi].turns[kept[h.index]];
      hits.push({ note, place, rec: `${l}.${n % 2}`, song: turns ? `${l}.${takeOf(turns[l], 2)}` : 'none' });
    }
  });
  return hits;
}

/** Consecutive hits of one sound on the same recording */
function repeats(hits) {
  const last = new Map();
  let n = 0;
  for (const h of [...hits].sort((a, b) => a.place - b.place)) {
    if (last.get(h.note) === h.song) n++;
    last.set(h.note, h.song);
  }
  return n;
}

test("a new kit track's default feel (Expressive, the player feel, the piano roll's 0.8) never repeats a recording", () => {
  // Hats in 8ths, kick and snare on the beats, at 0.8: a loudness edge of the four-loudness kits, where the
  // Human drift and the kit's own level differences take hits either side of it
  const notes = [...every('F#1', Q / 2), ...every('C1', 2 * Q), ...every('D1', 2 * Q, { from: Q })];
  for (const key of KITS) {
    const hits = kitPlays(key, true, KIT_FEEL, items(notes));
    assert.equal(repeats(hits), 0, key);
    // each hit plays the take a kit counting its own hits from bar 1 plays (what a whole-song export has)
    for (const h of hits) assert.equal(h.song, h.rec, `${key} ${h.note} at ${h.place}`);
    // both loudnesses either side of the edge are heard
    assert.ok(new Set(hits.filter((h) => h.note === 'F#1').map((h) => h.rec.split('.')[0])).size >= 2, key);
  }
});

test('every velocity, every Human dynamics up to its most, Expressive or not: no recording twice running', () => {
  for (const key of KITS) {
    for (const dynamics of [0, 0.2, 0.6, 1]) {
      const feel = dynamics ? { human: { on: true, timing: dynamics / 2, dynamics, pitch: 0 }, together: true } : undefined;
      for (const expressive of [true, false]) {
        // bar b at 0.05 * (b + 1): 16th hats, quarter kicks, accented snare with ghost notes between, a 32nd roll
        const notes = [];
        for (let b = 0; b < 20; b++) {
          const v = 0.05 * (b + 1);
          for (let s = 0; s < 16; s++) notes.push({ tick: b * BAR + (s * Q) / 4, note: 'F#1', velocity: v });
          for (let q = 0; q < 4; q++) notes.push({ tick: b * BAR + q * Q, note: 'C1', velocity: v });
          for (let s = 0; s < 16; s++) notes.push({ tick: b * BAR + (s * Q) / 4, note: 'D1', velocity: s % 4 === 2 ? 0.95 : s % 2 ? Math.max(0.05, v * 0.35) : v });
          for (let s = 24; s < 32; s++) notes.push({ tick: b * BAR + (s * Q) / 8, note: 'D2', velocity: v });
        }
        const hits = kitPlays(key, expressive, feel, items(notes));
        assert.equal(repeats(hits), 0, `${key} dynamics ${dynamics} ${expressive ? 'Expressive' : 'plain'}`);
        for (const h of hits) assert.equal(h.song, h.rec);
      }
    }
  }
});

test('notes on a chance count only where they play: the export pass decides them', () => {
  const notes = every('F#1', Q / 2, { chance: 0.5 });
  for (const feel of [undefined, KIT_FEEL]) {
    const list = items(notes);
    const hits = kitPlays('studioKit', true, feel, list);
    assert.ok(hits.length > 10 && hits.length < notes.length);
    assert.equal(repeats(hits), 0);
    for (const h of hits) assert.equal(h.song, h.rec);
    // a note that sits the export's pass out still has a turn (a live loop's later pass may play it): the
    // take after the hits before it
    const takes = trackTakes('studioKit', true, feel, list);
    const out = list.flatMap((g, gi) => g.notes.map((_, i) => [g, i, takes[gi].turns[i]])).filter(([g, i]) => !notePlays(g.conds[i], g.seeds[i], 0));
    assert.ok(out.length > 0 && out.every(([, , t]) => Array.isArray(t)));
  }
});

test('a closed hat an open hat replaces is not counted; an open hat and its closed hat count on their own', () => {
  const notes = [...every('F#1', Q / 4), ...every('A#1', Q, { from: Q / 2 })];
  const hits = kitPlays('studioKit', false, undefined, items(notes));
  assert.equal(hits.filter((h) => h.note === 'F#1').length, notes.length - notes.filter((n) => n.note === 'A#1').length * 2);
  assert.equal(repeats(hits), 0);
  for (const h of hits) assert.equal(h.song, h.rec);
});

test("a song's turns depend only on the song: a hit from bar 5 has the turn it has in the whole song", () => {
  const notes = every('F#1', Q / 2, { bars: 12 });
  const list = items(notes);
  const whole = trackTakes('studioKit', true, KIT_FEEL, list);
  // worked out again (as for a range export or playing from bar 5): the same
  const again = trackTakes('studioKit', true, KIT_FEEL, list);
  assert.deepEqual(again, whole);
  // the 32 hats before bar 5 count, played or not
  const at5 = list.findIndex((g) => g.tick === 4 * BAR);
  assert.equal(at5, 32);
  assert.equal(whole[at5].turns[0].reduce((a, b) => a + b, 0), 32);
});

test('a sampled note counts at every loudness it plays from: blended either side of an edge, or under the mod wheel', () => {
  const tops = INSTRUMENTS.realUprightBass.samples.layers;
  // near an edge both loudnesses play
  assert.deepEqual(sampledLoudnesses(tops[1] + 0.01, tops, null), [1, 2]);
  assert.deepEqual(sampledLoudnesses(0.1, tops, null), [0]);
  // the mod wheel picks two loudnesses of its own
  assert.deepEqual(sampledLoudnesses(0.1, tops, 1), [2, 3]);
  // One note, its velocity drifting across an edge (the Human insert's dynamics at its most): at each
  // loudness it plays from, its takes alternate
  const human = { on: true, timing: 0.5, dynamics: 1, pitch: 0 };
  const notes = every('C2', Q / 2, { velocity: 0.55 });
  const list = items(notes);
  const takes = trackTakes('realUprightBass', false, { human, together: false }, list);
  const lastAt = new Map();
  let blended = 0;
  list.forEach((g, gi) => {
    const v = humanVelocities(g, { human, together: false })[0];
    const layers = sampledLoudnesses(v, tops, null);
    if (layers.length > 1) blended++;
    for (const l of layers) {
      const take = takeOf(takes[gi].turns[0][l], 2);
      assert.notEqual(lastAt.get(l), take, `loudness ${l} at tick ${g.tick}`);
      lastAt.set(l, take);
    }
  });
  assert.ok(blended > 5);
  // the mod wheel's events (a clip's lane) pick the loudnesses until the clip's end hands back to velocity
  const wheel = [{ tick: 0, wheel: { value: 0.9, end: false } }, ...items(every('C2', Q, { bars: 2, velocity: 0.2 })), { tick: 2 * BAR, wheel: { value: null, end: true } }, ...items(every('C2', Q, { from: 2 * BAR, bars: 3, velocity: 0.2 }))];
  const w = trackTakes('realDoubleBass', false, undefined, wheel);
  const under = w.filter((x, i) => x && wheel[i].tick < 2 * BAR).map((x) => x.turns[0]);
  const after = w.filter((x, i) => x && wheel[i].tick >= 2 * BAR).map((x) => x.turns[0]);
  // under the wheel the two loudest count; after it the softest (velocity 0.2)
  assert.deepEqual(under.map((t) => [t[1], t[2]]), under.map((_, k) => [k, k]));
  assert.deepEqual(after.map((t) => t[0]), after.map((_, k) => k));
});

test('two notes played in turn each play their takes in turn, and a chord plays at its loudest note', () => {
  const notes = every('C3', Q, { velocity: 0.6 }).flatMap((n) => [n, { ...n, tick: n.tick + Q / 2, note: 'C4' }]);
  const list = items(notes);
  const t = trackTakes('realHarpsichord', false, undefined, list);
  const c3 = list.flatMap((g, i) => (g.notes[0].note === 'C3' ? [takeOf(t[i].turns[0][0], 2)] : []));
  assert.deepEqual(c3, c3.map((_, k) => k % 2));
  // a chord's notes at 0.9, 0.3: both count at the loudness 0.9 plays at
  const chord = trackTakes('realUprightBass', false, undefined, [{ tick: 0, notes: [{ note: 'C2', velocity: 0.9, duration: '8n' }, { note: 'G2', velocity: 0.3, duration: '8n' }], seeds: [1, 2], place: 0 }]);
  assert.deepEqual(chord[0].turns.map((x) => x.join()), ['0,0,0,0', '0,0,0,0']);
  const second = trackTakes('realUprightBass', false, undefined, [0, Q].map((tick) => ({ tick, notes: [{ note: 'G2', velocity: 0.9, duration: '8n' }, { note: 'G2', velocity: 0.3, duration: '8n' }], seeds: [1, 2], place: placeOfTick(tick) })));
  // (the second chord's G2s: the loudness 0.9 plays at counted twice before them, the softest never)
  assert.equal(second[1].turns[0][loudnessOf(0.9, INSTRUMENTS.realUprightBass.samples.layers)], 2);
  assert.equal(second[1].turns[1][0], 0);
});

test("a guitar strums a song's chord by the song's strums before it, the same from wherever playback begins", () => {
  // Chords on every 8th at 120 BPM (a quarter of a second apart): down, up, down, up from the song's start
  const chord = (tick, extra = {}) => ['C3', 'E3', 'G3'].map((note) => ({ tick, note, velocity: 0.7, ...extra }));
  const notes = [];
  for (let tick = Q / 2; tick < 8 * BAR; tick += Q / 2) notes.push(...chord(tick));
  const list = items(notes);
  const t = trackTakes('realGuitar', false, undefined, list);
  const dirs = t.map((x) => (x.down ? 'd' : 'u'));
  assert.deepEqual(dirs, dirs.map((_, k) => (k % 2 ? 'u' : 'd')));
  // bar 5's first chord follows the 31 before it: an upstroke, where a guitar starting there would go down
  const at5 = list.findIndex((g) => g.tick === 4 * BAR);
  assert.equal(t[at5].down, false);
  // chords half a second apart or more all start down again
  const slow = trackTakes('realGuitar', false, undefined, items(every('x', Q, { bars: 2 }).flatMap((n) => chord(n.tick))));
  assert.ok(slow.every((x) => x.down === true));
  // a single note isn't strummed and doesn't turn the hand
  const mixed = items([...chord(0), { tick: Q / 2, note: 'C3', velocity: 0.7 }, ...chord(Q)]);
  assert.deepEqual(trackTakes('realGuitar', false, undefined, mixed).map((x) => x.down), [true, false, true]);
  // a chord that sits the export's pass out doesn't turn the hand either (counted, the third would go down)
  const gated = items([...chord(0), ...chord(Q / 4, { chance: 0.01 }), ...chord(Q / 2)]);
  assert.deepEqual(trackTakes('realGuitar', false, undefined, gated).map((x) => x.down), [true, false, false]);
});

test('a song chord is strummed the way it was given; a chord played by hand after the strum before it', () => {
  // just after a downstroke: by hand, the hand comes back up (high to low)
  const last = { at: 0, down: true };
  assert.equal(strumsDown(last, 0.25), false);
  assert.equal(strumsDown(last, 0.6), true);
  assert.equal(strumsDown(null, 0.25), true);
  const byHand = strumPlan([48, 52, 55], 0.25, 1, 0.7, last, 7);
  assert.equal(byHand.strum.down, false);
  assert.ok(byHand.notes[2].delay < byHand.notes[0].delay);
  // a song's chord given as a downstroke plays low to high whatever was strummed before
  const song = strumPlan([48, 52, 55], 0.25, 1, 0.7, last, 7, true);
  assert.equal(song.strum.down, true);
  assert.ok(song.notes[0].delay < song.notes[2].delay);
});

test("an Expressive kit's level differences are worked out ahead from a note's place as the kit picks them", () => {
  // what the scheduler works out for a note's place (jitterAt) is what the kit hashes while it plays (noteJitter)
  for (const place of [0, 0.5, 1.2345, 17.0625, 123.4567]) {
    const live = atSongPlace(1000 + place, place, () => noteJitter('closedHat', 1000 + place, 5));
    assert.equal(jitterAt('closedHat', place, 5), live);
  }
  // a loudness the row has no recording at: the nearest softer, else the nearest harder
  assert.equal(recordedLoudness(0.9, [0.3, 0.55, 0.8, 1], 4, (l) => l !== 3), 2);
  assert.equal(recordedLoudness(0.1, [0.3, 0.55, 0.8, 1], 4, (l) => l > 1), 2);
  assert.equal(loudnessOf(1.2, [0.3, 0.55, 0.8, 1]), 3);
  assert.equal(takeOf(5, 2), 1);
});

test("only an Expressive kit's and a strummed instrument's takes follow the tempo and the swing; the rest are kept while they change", () => {
  // A song with accents, chords, chances and Human drift, its notes' places at two tempos with swing
  const song = (key) => {
    const kit = INSTRUMENTS[key].kind === 'drums';
    const notes = [];
    for (let tick = 0; tick < 8 * BAR; tick += Q / 4) {
      const v = 0.3 + 0.7 * (((tick / (Q / 4)) * 7) % 10) / 10;
      if (kit) notes.push({ tick, note: [DRUM_NOTES.closedHat, DRUM_NOTES.kick, DRUM_NOTES.snare][(tick / (Q / 4)) % 3], velocity: v, ...(tick % BAR === Q ? { chance: 0.5 } : {}) });
      else for (const note of tick % Q === 0 ? ['C3', 'E3', 'G3'] : ['C3']) notes.push({ tick, note, velocity: v });
    }
    return items(notes);
  };
  const at = (list, scale, swing) => list.map((g) => ({ ...g, place: g.place * scale + ((g.tick / (Q / 4)) % 2 ? swing : 0) }));
  let followed = 0;
  let checked = 0;
  for (const key of Object.keys(INSTRUMENTS)) {
    if (!takesKind(key)) continue;
    for (const expressive of [false, true])
      for (const feel of [undefined, KIT_FEEL]) {
        const list = song(key);
        const a = trackTakes(key, expressive, feel, at(list, 1, 0));
        const b = trackTakes(key, expressive, feel, at(list, 0.83, 0.041));
        const same = JSON.stringify(a) === JSON.stringify(b);
        if (!takesFollowPlaces(key, expressive)) {
          assert.ok(same, `${key} ${expressive} ${!!feel}: kept at another tempo, but its takes change`);
          checked++;
        } else if (!same) followed++;
      }
  }
  assert.ok(checked > 40, `${checked}`);
  // (the others do change: a kit's level differences and a guitar's strums follow the places)
  assert.ok(followed > 10, `${followed}`);
  assert.equal(takesFollowPlaces('studioKit', true), true);
  assert.equal(takesFollowPlaces('studioKit', false), false);
  assert.equal(takesFollowPlaces('realGuitar', false), true);
  assert.equal(takesFollowPlaces('realHarpsichord', true), false);
});

test("Play works the takes out before the Transport starts; a tempo or swing drag while playing doesn't work them out at every step", () => {
  const store = readFileSync(new URL('../src/store/timelineStore.ts', import.meta.url), 'utf8');
  const play = store.slice(store.indexOf('    play: async (startAt) => {'), store.indexOf('    pause: () => {'));
  assert.ok(play.indexOf('liveTakesReady()') > 0 && play.indexOf('liveTakesReady()') < play.indexOf('startTransportAt('));
  const sched = readFileSync(new URL('../src/audio/scheduler.ts', import.meta.url), 'utf8');
  const takesOf = sched.slice(sched.indexOf('  const takesOf = (trackId: string)'), sched.indexOf('  /** `group` with its notes\' turns'));
  // while playing, the same version at another tempo or swing keeps the turns worked out before
  assert.match(takesOf, /live && known && known\.version === t\.version && transport\.state === 'started'\) return known\.of/);
  assert.match(sched, /function liveTakesSoon\(\)/);
  assert.match(sched.slice(sched.indexOf('export function syncTransport')), /liveTakesSoon\(\);/);
});
