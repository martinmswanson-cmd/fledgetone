// Unit tests for ducking under a proxy track (src/store/duck.ts). Run with `npm test`.
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

const { proxySpans, duckPoints, DUCK_LOOKAHEAD, DUCK_RELEASE } = await import('../src/store/duck.ts');

const track = (id, extra = {}) => ({ id, name: id, instrumentKey: 'keys', isMuted: false, ...extra });
const note = (startOffset, duration) => ({ id: 'n' + startOffset, note: 'C4', startOffset, duration, velocity: 0.8 });
const clip = (trackId, startBar, notes, extra = {}) => ({ id: 'c' + trackId + startBar, trackId, name: 'c', startBar, lengthBars: 4, isSelected: false, notes, ...extra });

test('no proxy, nothing to duck', () => {
  assert.equal(duckPoints([track('a')], [clip('a', 1, [note(0, '4n')])], 120), null);
});

test('notes and audio clips of a proxy, with short gaps bridged', () => {
  const tracks = [track('music'), track('vo', { duckProxy: { depth: 10 } })];
  const clips = [
    clip('vo', 2, [note(0, '4n'), note(0.3, '4n')]), // 2-2.25 and 2.3-2.55: a 0.05-bar (0.1 s) gap at 120 BPM is bridged
    clip('vo', 5, [], { audio: { soundId: 'x', offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 }, lengthBars: 1 }),
    clip('music', 1, [note(0, '1m')]),
  ];
  assert.deepEqual(proxySpans(tracks, clips, 120).map((s) => [s.from, s.to]), [[2, 2.55], [5, 6]]);
});

test('the curve dips ahead of the proxy and comes back after it', () => {
  const tracks = [track('music'), track('vo', { duckProxy: { depth: 20 } })];
  const pts = duckPoints(tracks, [clip('vo', 3, [note(0, '2n')])], 120);
  const bar = (s) => (s * 120) / 240;
  assert.equal(pts.length, 4);
  assert.ok(Math.abs(pts[0].bar - (3 - bar(DUCK_LOOKAHEAD))) < 1e-9 && pts[0].value === 1);
  assert.ok(Math.abs(pts[1].bar - 3) < 1e-9 && Math.abs(pts[1].value - 0.1) < 1e-9);
  assert.ok(Math.abs(pts[2].bar - 3.5) < 1e-9);
  assert.ok(Math.abs(pts[3].bar - (3.5 + bar(DUCK_RELEASE))) < 1e-9 && pts[3].value === 1);
});

test('a muted proxy ducks nothing; close dips join', () => {
  assert.equal(duckPoints([track('vo', { duckProxy: { depth: 10 }, isMuted: true })], [clip('vo', 3, [note(0, '4n')])], 120), null);
  const pts = duckPoints([track('vo', { duckProxy: { depth: 10 } })], [clip('vo', 3, [note(0, '4n'), note(0.45, '4n')])], 120);
  // 3-3.25 then 3.45-3.7: 0.4 s apart (not bridged), but the release (0.4 s) and look-ahead (0.12 s) overlap
  assert.equal(pts.filter((p) => p.value === 1).length, 2);
});
