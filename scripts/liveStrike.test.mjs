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
/** Where a note struck again goes: three blocks past the clock, and a frame (see soundLead.ts retryRoom). */
const RETRY = (3 * 128 + 1) / SR;

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

test('the clock stepping on to within a block of the note while it is set: undone (last thing first), never heard, and set whole again two blocks past the clock as it is then (scan r44)', () => {
  const context = clock();
  const { log, build } = note(context, [5 * BLOCK]);
  const at = L.strikeWhole(context, 1.001, build);
  assert.ok(Math.abs(at - (1 + 5 * BLOCK + RETRY)) < 1e-12, `${at}`);
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
        context.currentTime += 5 * BLOCK;
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
      context.currentTime = 1.05 - 0.004 - BLOCK / 2;
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
        context.currentTime += 5 * BLOCK;
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

test('the clock stepping on a block or two while a note is set, still two blocks short of it after: set once, where it was put (scan r44)', () => {
  for (const step of [BLOCK, 2 * BLOCK]) {
    const context = clock();
    const { log, build } = note(context, [step]);
    assert.equal(L.strikeWhole(context, 1.001, build), 1 + ROOM, `stepped ${step}`);
    assert.deepEqual(log.map(([what]) => what), ['set', 'heard'], `stepped ${step}`);
  }
});

test('held up inside its last step to within a block of the note (it may have reached the sound late: silent, or a burst): undone as heard, faded out by 3 ms on, and struck again (scan r44)', () => {
  const context = clock();
  const undone = [];
  let tries = 0;
  const at = L.strikeWhole(context, 1.001, (t) => {
    const n = tries++;
    L.ifUndone((gone, heard) => undone.push([n, gone, heard]));
    L.whenHeard(() => {
      if (n === 0) context.currentTime += 5 * BLOCK;
    });
    return t;
  });
  assert.equal(tries, 2);
  assert.deepEqual(undone, [[0, 1 + 5 * BLOCK + L.UNDO_FADE, true]]);
  assert.ok(Math.abs(at - (1 + 5 * BLOCK + RETRY)) < 1e-12, `${at}`);
});

test('before a strike made again, what waits for any time is readied first, and the strike comes no sooner than where that says (scan r44)', () => {
  const context = clock();
  const seen = [];
  let tries = 0;
  const at = L.strikeWhole(
    context,
    1.001,
    (t) => {
      seen.push(['build', t]);
      if (tries++ === 0) context.currentTime += 0.02;
      return t;
    },
    undefined,
    (from) => {
      seen.push(['prepare', from]);
      return from + 0.001;
    }
  );
  assert.equal(seen[1][0], 'prepare');
  assert.ok(Math.abs(seen[1][1] - (1.02 + RETRY)) < 1e-12);
  assert.ok(Math.abs(at - (1.02 + RETRY + 0.001)) < 1e-12, `${at}`);
});
