// Game states with tempo or time signature changes inside them: the bar lines and beats the game
// kit writes into the manifest (gridTimes in src/audio/tempoMap.ts), and the web player
// (adaptive-music.js) switching on them. Run with `npm test`.
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
const { gridTimes } = await import('../src/audio/tempoMap.ts');
const { AdaptiveMusic } = await import('../src/gameKit/adaptive-music.js');

const FOUR = { base: { num: 4, den: 4 }, points: [] };
const slowsDown = { bpm: 120, points: [{ bar: 5, bpm: 60, ramp: false }] };

test('a state at one tempo and time signature needs no bar lines of its own', () => {
  assert.equal(gridTimes(1, 9, { bpm: 120, points: [] }, FOUR), null);
  assert.equal(gridTimes(9, 17, slowsDown, FOUR), null);
  assert.equal(gridTimes(1, 7, 90, { base: { num: 3, den: 4 }, points: [] }), null);
});

test('a tempo change inside a state: its bar lines, beats and tempo markers', () => {
  const g = gridTimes(1, 9, slowsDown, FOUR);
  assert.deepEqual(g.barTimes, [0, 2, 4, 6, 8, 12, 16, 20]);
  assert.equal(g.beatTimes.length, 32);
  assert.deepEqual(g.beatTimes.slice(14, 19), [7, 7.5, 8, 9, 10]);
  assert.deepEqual(g.tempoChanges, [{ seconds: 0, bpm: 120, timeSignature: [4, 4] }, { seconds: 8, bpm: 60, timeSignature: [4, 4] }]);
});

test('a time signature change, and a state starting part-way through a measure', () => {
  const meter = { base: { num: 4, den: 4 }, points: [{ bar: 3, num: 3, den: 4 }] };
  const g = gridTimes(1, 4.5, 120, meter);
  assert.deepEqual(g.barTimes, [0, 2, 4, 5.5]);
  assert.deepEqual(g.tempoChanges.map((c) => [c.seconds, c.timeSignature.join('/')]), [[0, '4/4'], [4, '3/4']]);
  // From beat 3 of a 4/4 bar: the next bar line is a beat... two beats in
  const h = gridTimes(1.5, 3.5, 120, FOUR);
  assert.deepEqual(h.barTimes, [1, 3]);
  assert.deepEqual(h.beatTimes, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
});

/** A stand-in audio context: the player only schedules, so nothing needs to sound. */
function fakeContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect: (n) => n, disconnect() {}, gain: param(), frequency: param(), Q: param(), type: '', buffer: null, start() {}, stop() {}, loop: false });
  return { currentTime: 0, state: 'running', sampleRate: 8000, destination: node(), createGain: node, createBiquadFilter: node, createConvolver: node, createBufferSource: node, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }) };
}

test('the web player switches on the bar lines the manifest gives', () => {
  const g = gridTimes(1, 9, slowsDown, FOUR);
  const state = { name: 'Run', file: 'Run.wav', bars: 8, seconds: 24, bpm: 120, timeSignature: [4, 4], beatsPerBar: 4, beatSeconds: 0.5, stems: [], ...g };
  const manifest = { bpm: 120, beatsPerBar: 4, beatSeconds: 0.5, states: [state, { ...state, name: 'Rest', barTimes: undefined, beatTimes: undefined }], stingers: [], transitions: [], intensity: { default: 1, groups: [] } };
  const ctx = fakeContext();
  const music = new AdaptiveMusic(ctx);
  music.loadFrom(manifest, new Map());
  music.play('Run');
  const start = 0.05;
  ctx.currentTime = start + 9;
  // Real bars at 8, 12, 16 s: the one after 9 s is 12 (one beat length would say 10)
  assert.ok(Math.abs(music.nextLine('bar') - (start + 12)) < 1e-6);
  assert.ok(Math.abs(music.nextLine('beat') - (start + 10)) < 1e-6);
  // Round the loop: after the last bar line (20 s) comes the loop's start
  ctx.currentTime = start + 21;
  assert.ok(Math.abs(music.nextLine('bar') - (start + 24)) < 1e-6);
  // A lead-in that needs more room waits for a later line
  ctx.currentTime = start + 9;
  assert.ok(Math.abs(music.nextLine('bar', 4, 3.5) - (start + 16)) < 1e-6);
  // A state without them keeps one bar length (older manifests)
  music.play('Rest');
  const restAt = ctx.currentTime + 0.05;
  ctx.currentTime = restAt + 9;
  assert.ok(Math.abs(music.nextLine('bar') - (restAt + 10)) < 1e-6);
});

test('pieces of a shuffled state are cut at its own bar lines', () => {
  const g = gridTimes(1, 9, slowsDown, FOUR);
  const state = { name: 'Run', file: 'Run.wav', bars: 8, seconds: 24, bpm: 120, timeSignature: [4, 4], beatsPerBar: 4, beatSeconds: 0.5, stems: [], shuffleBars: 2, ...g };
  const ctx = fakeContext();
  const music = new AdaptiveMusic(ctx);
  music.loadFrom({ bpm: 120, beatsPerBar: 4, beatSeconds: 0.5, states: [state], stingers: [], transitions: [], intensity: { default: 1, groups: [] } }, new Map());
  music.play('Run');
  assert.deepEqual(music.current.bounds, [[0, 4], [4, 8], [8, 16], [16, 24]]);
  music.stop();
});
