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
const { gridTimes, phraseLines, nextMeterLine, onMeterLine, secondsBetween } = await import('../src/audio/tempoMap.ts');
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

// The Game tab's preview counts phrases as the players do (phraseLines): every few measures from
// the state's first whole measure
test('phrase lines are the players\' own: every few of the manifest\'s bar lines', () => {
  const toThree = { base: { num: 4, den: 4 }, points: [{ bar: 3, num: 3, den: 4 }] };
  // 4/4 then 3/4 at bar 3: measures at 1, 2, 3, 3.75, 4.5, ... the 4-bar phrases at 1, 4.5 and 7.5
  assert.deepEqual(phraseLines(1, 9, 4, toThree), [1, 4.5, 7.5]);
  const g = gridTimes(1, 9, 120, toThree);
  const player = g.barTimes.filter((_, i) => i % 4 === 0).map((t) => 1 + t / 2);
  assert.deepEqual(phraseLines(1, 9, 4, toThree), player);
  // Starting part-way through a 3/4 measure: from the next measure line
  const three = { base: { num: 3, den: 4 }, points: [] };
  assert.deepEqual(phraseLines(1.25, 7, 2, three), [1.75, 3.25, 4.75, 6.25]);
  const h = gridTimes(1.25, 7, 120, three);
  assert.deepEqual(h.barTimes.filter((_, i) => i % 2 === 0).map((t) => +(1.25 + t / 2).toFixed(6)), [1.75, 3.25, 4.75, 6.25]);
  // Plain 4/4: every four bars from the start, as before
  assert.deepEqual(phraseLines(1, 9, 4, FOUR), [1, 5]);
  assert.deepEqual(phraseLines(5, 21, 8, FOUR), [5, 13]);
});

test('the web player\'s phrase lines in a state whose time signature changes are the preview\'s', () => {
  const toThree = { base: { num: 4, den: 4 }, points: [{ bar: 3, num: 3, den: 4 }] };
  const g = gridTimes(1, 9, 120, toThree);
  const seconds = secondsBetween(1, 9, 120);
  const state = { name: 'Calm', file: 'Calm.wav', bars: 8, seconds, bpm: 120, timeSignature: [4, 4], beatsPerBar: 4, beatSeconds: 0.5, stems: [], ...g };
  const ctx = fakeContext();
  const music = new AdaptiveMusic(ctx);
  music.loadFrom({ bpm: 120, beatsPerBar: 4, beatSeconds: 0.5, states: [state], stingers: [], transitions: [], intensity: { default: 1, groups: [] } }, new Map());
  music.play('Calm');
  const start = 0.05;
  const lines = phraseLines(1, 9, 4, toThree);
  for (const heard of [1.2, 4, 5, 7.6]) {
    ctx.currentTime = start + secondsBetween(1, heard, 120) - 0.02;
    const want = lines.find((x) => x >= heard - 1e-6);
    const at = want === undefined ? start + seconds : start + secondsBetween(1, want, 120);
    assert.ok(Math.abs(music.nextLine('phrase', 4) - at) < 1e-6, `from ${heard}`);
  }
  music.stop();
});

test('the next bar and beat lines follow the time signature', () => {
  const three = { base: { num: 3, den: 4 }, points: [] };
  const seven = { base: { num: 7, den: 8 }, points: [] };
  // 4/4 as before: the next whole note, the next quarter
  assert.equal(nextMeterLine(1.1, 'bar', FOUR), 2);
  assert.equal(nextMeterLine(2, 'bar', FOUR), 3);
  assert.equal(nextMeterLine(1.1, 'beat', FOUR), 1.25);
  assert.equal(nextMeterLine(1.25, 'beat', FOUR), 1.5);
  // 3/4: bars of three quarters
  assert.equal(nextMeterLine(1.1, 'bar', three), 1.75);
  assert.equal(nextMeterLine(1.8, 'bar', three), 2.5);
  assert.equal(nextMeterLine(1.6, 'beat', three), 1.75);
  // 7/8: the beat is an eighth, the bar seven of them
  assert.equal(nextMeterLine(1.1, 'beat', seven), 1.125);
  assert.equal(nextMeterLine(1.125, 'beat', seven), 1.25);
  assert.equal(nextMeterLine(1.8, 'beat', seven), 1.875);
  assert.equal(nextMeterLine(1.1, 'bar', seven), 1.875);
  assert.ok(onMeterLine(1.875, 'bar', seven) && onMeterLine(2, 'beat', seven) && !onMeterLine(2, 'bar', seven));
});
