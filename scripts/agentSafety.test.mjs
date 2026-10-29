// Cautions about a suggestion's levels (src/agent/safety.ts): a track up by more than 6 dB, the
// master by more than 3, the Loud master or the clipper switched on. Run with `npm test`.
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
const { checkSafety, TRACK_JUMP_DB, MASTER_JUMP_DB } = await import('../src/agent/safety.ts');
const { applyOps } = await import('../src/agent/ops.ts');
const { createStarter } = await import('../src/store/starters.ts');

const base = () => createStarter('lofi');
const withTrack = (p, i, patch) => ({ ...p, tracks: p.tracks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

test('a track up by more than 6 dB is a warning; up by less is not', () => {
  const a = base();
  assert.equal(TRACK_JUMP_DB, 6);
  assert.deepEqual(checkSafety(a, withTrack(a, 0, { volume: a.tracks[0].volume + 5 })), []);
  const w = checkSafety(a, withTrack(a, 0, { volume: a.tracks[0].volume + 9 }));
  assert.equal(w.length, 1);
  assert.match(w[0], /"Keys" goes up by 9 dB/);
  assert.deepEqual(checkSafety(a, withTrack(a, 0, { volume: a.tracks[0].volume - 20 })), []);
});

test('the master up by more than 3 dB, the Loud master or the clipper switched on', () => {
  const a = base();
  assert.equal(MASTER_JUMP_DB, 3);
  assert.deepEqual(checkSafety(a, { ...a, master: { ...a.master, level: a.master.level + 2 } }), []);
  assert.match(checkSafety(a, { ...a, master: { ...a.master, level: a.master.level + 4 } })[0], /master Level goes up by 4 dB/);
  assert.match(checkSafety(a, { ...a, master: { ...a.master, loud: { on: true, target: 'loud', push: 4, subTilt: 0 } } })[0], /Loud master/);
  assert.match(checkSafety(a, { ...a, master: { ...a.master, clipper: { on: true, drive: 3, softness: 0.5, ceiling: -1 } } })[0], /clipper/);
});

test('a new track set loud, and a volume lane drawn high', () => {
  const a = base();
  const loudNew = { ...a, tracks: [...a.tracks, { ...a.tracks[0], id: 'new', name: 'New', volume: 6 }] };
  assert.deepEqual(checkSafety(a, loudNew), []);
  const lane = withTrack(a, 4, { automation: [{ param: 'volume', points: [{ bar: 1, value: 1 }] }] });
  assert.match(checkSafety(a, lane).join(' '), /"Rain"'s volume automation goes up/);
});

test('applyOps carries the warnings: +9 dB through an op', () => {
  const a = base();
  const out = applyOps(a, { opsVersion: 1, ops: [{ op: 'set_track', trackId: a.tracks[4].id, volumeDb: a.tracks[4].volume + 9 }] }, { idBase: 'sg' });
  assert.ok(out.ok);
  assert.ok(out.warnings.some((w) => /"Rain" goes up by 9 dB/.test(w)), out.warnings.join('\n'));
});
