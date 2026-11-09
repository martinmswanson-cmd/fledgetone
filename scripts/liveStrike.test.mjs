// The one rule every live note and hit is struck by (src/audio/soundLead.ts strikeWhole): where it goes is
// decided once, all of it set for that time, its last step (what makes it heard) taken only while the clock
// still leaves a render callback's room before it; held up while it was set, it's undone and struck again
// whole, later. Never struck again once it can have been heard. Exports: set once, where asked.
// Run with `npm test`.
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
const L = await import('../src/audio/soundLead.ts');
const P = await import('../src/audio/songPlace.ts');

const SR = 44100;
const BLOCK = 128 / SR;
/** At a baseLatency of 10 ms: four blocks, and a frame. */
const ROOM = 4 * BLOCK + 1 / SR;
const LEAD = 4 * BLOCK;

function clock({ now = 1, offline = false } = {}) {
  return { currentTime: now, sampleRate: SR, isOffline: offline, rawContext: { baseLatency: 0.01 } };
}

/** A note of `parts` whose setting holds the page up by steps[try] (seconds of clock), logging what's done. */
function note(context, steps = []) {
  const log = [];
  let tries = 0;
  const build = (at) => {
    const n = tries++;
    log.push(['set', n, at]);
    L.ifUndone(() => log.push(['undo', n, 'a']));
    L.ifUndone(() => log.push(['undo', n, 'b']));
    L.whenHeard(() => log.push(['heard', n, at]));
    context.currentTime += steps[n] ?? 0;
    return at;
  };
  return { log, build };
}

test('a live note set with the clock standing still is set once, a callback past the clock (or where asked, when that is later), and heard as its last step (scan r44)', () => {
  const context = clock();
  const { log, build } = note(context);
  assert.equal(L.strikeWhole(context, 1.001, build), 1 + ROOM);
  assert.deepEqual(log, [['set', 0, 1 + ROOM], ['heard', 0, 1 + ROOM]]);
  const later = note(context);
  assert.equal(L.strikeWhole(context, 1.2, later.build), 1.2);
});

test('the clock stepping on while a note is set (even a block: the callbacks don\'t always come evenly): undone (last thing first), never heard, and set whole again a callback past the clock as it is then (scan r44)', () => {
  const context = clock();
  const { log, build } = note(context, [BLOCK]);
  const at = L.strikeWhole(context, 1.001, build);
  assert.ok(Math.abs(at - (1 + BLOCK + ROOM)) < 1e-12, `${at}`);
  assert.deepEqual(log.map(([what, n, x]) => [what, n, typeof x === 'number' ? 'at' : x]), [
    ['set', 0, 'at'],
    ['undo', 0, 'b'],
    ['undo', 0, 'a'],
    ['set', 1, 'at'],
    ['heard', 1, 'at'],
  ]);
});

test('a note held up at every try is set four times at most; the last, a callback later still, is heard however it went (scan r44)', () => {
  const context = clock();
  const { log, build } = note(context, [0.02, 0.02, 0.02, 0.03]);
  const before = { ...L.strikeCounts };
  const at = L.strikeWhole(context, 1, build);
  assert.equal(log.filter(([what]) => what === 'set').length, 4);
  assert.deepEqual(log.filter(([what]) => what === 'heard').map(([, n]) => n), [3]);
  assert.ok(Math.abs(at - (1.06 + ROOM + LEAD)) < 1e-12, `${at}`);
  assert.equal(L.strikeCounts.again - before.again, 3);
  assert.equal(L.strikeCounts.late - before.late, 1);
});

test('the parts of one hit (a snare\'s noise and snap) are struck as one: each set for the hit\'s time, heard together at its end, undone together (scan r44)', () => {
  const context = clock();
  const log = [];
  let tries = 0;
  const at = L.strikeWhole(context, 1, (t) => {
    const n = tries++;
    for (const part of ['noise', 'snap']) {
      // (Each part struck on its own, inside the hit: it takes the hit's time)
      const got = L.strikeWhole(context, t, (u) => {
        L.whenHeard(() => log.push(['heard', part, u]));
        L.ifUndone(() => log.push(['undo', part, n]));
        return u;
      });
      assert.equal(got, t);
      if (part === 'noise' && n === 0) {
        context.currentTime += 3 * BLOCK;
      }
    }
    return t;
  });
  assert.deepEqual(log, [
    ['undo', 'snap', 0],
    ['undo', 'noise', 0],
    ['heard', 'noise', at],
    ['heard', 'snap', at],
  ]);
});

test('a part that begins before the note (an envelope run ahead) needs the clock to leave a callback before it (scan r44)', () => {
  const context = clock();
  let tries = 0;
  L.strikeWhole(context, 1.05, (at) => {
    tries++;
    // (Run ahead only with room for it: see native.ts roomAhead)
    if (at - 0.004 >= L.attackRoom(context)) L.beginsAt(at - 0.004);
    if (tries === 1) {
      context.currentTime = 1.05 - 0.004 - ROOM + BLOCK;
    }
  });
  assert.equal(tries, 2);
});

test('a strike Tone refuses (a start at or before one it already has) is undone and tried again later; refused at the last try, the error passes on (scan r44)', () => {
  const context = clock();
  let tries = 0;
  const undone = [];
  const at = L.strikeWhole(context, 1, (t) => {
    L.ifUndone(() => undone.push(t));
    if (tries++ === 0) throw new Error('Start time must be strictly greater than previous start time');
    return t;
  });
  assert.equal(tries, 2);
  assert.equal(undone.length, 1);
  assert.ok(at > 1 + ROOM);
  assert.throws(() => L.strikeWhole(clock(), 1, () => {
    throw new Error('refused');
  }), /refused/);
});

test('an export\'s note is set once, where asked, whatever its clock does: heard at once, nothing undone (scan r44)', () => {
  const context = clock({ offline: true });
  const { log, build } = note(context, [0.5]);
  assert.equal(L.strikeWhole(context, 1.0001, build), 1.0001);
  assert.deepEqual(log, [['set', 0, 1.0001], ['heard', 0, 1.0001]]);
});

test('a song\'s note struck later keeps what is picked for it by its place in the song, as in the export (scan r42, r44)', () => {
  const context = clock();
  const asked = 1.001;
  const place = 12.5;
  const picks = [];
  let tries = 0;
  P.atSongPlace(asked, place, () =>
    L.strikeWhole(context, asked, (at) => {
      if (tries++ === 0) {
        context.currentTime += 3 * BLOCK;
      }
      picks.push([P.placeOf(at), P.noteJitter('C4', at, 7)]);
    })
  );
  assert.equal(picks.length, 2);
  for (const [at, jitter] of picks) {
    assert.equal(at, place);
    assert.equal(jitter, P.atSongPlace(asked, place, () => P.noteJitter('C4', asked, 7)));
  }
});
