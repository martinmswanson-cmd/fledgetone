// What a note's small differences and its noise are picked by (src/audio/songPlace.ts): a song's note by its place in the song, the same live from wherever playback began, on every pass of a loop and in every export; a note played by hand by its time on the audio clock. Run with `npm test`.
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

const { atSongPlace, noteJitter, placeOf, struckLater } = await import('../src/audio/songPlace.ts');
const { noiseKey, noiseStart, trackSeed } = await import('../src/audio/seededNoise.ts');

const key = noiseKey(trackSeed('track-1'), 'snare');

test('a note played by hand is picked by its time on the audio clock, as before', () => {
  assert.equal(placeOf(12.5), 12.5);
  // 'F#1@250' hashed with salt 37 (a recorded hit's level)
  assert.equal(noteJitter('F#1', 0.25, 37), -0.8003483428154952);
  assert.notEqual(noteJitter('F#1', 0.75, 37), noteJitter('F#1', 0.25, 37));
});

test("a song's note is picked by its place, wherever the audio clock is when it plays", () => {
  // The same hat 2.5 s into the song: played from bar 1 a while after the page opened, from bar 2
  // later on, on a loop's third pass, after a pause, and in an export (its clock from 0.25 s)
  const clocks = [14.73, 99.123456, 1234.5, 3.141592653589793, 0.25 + 2.5 + 0.3 / 44100];
  const jitters = clocks.map((at) => atSongPlace(at, 2.5, () => [noteJitter('F#1', at, 37), noteJitter('F#1', at, 5), noiseStart(key, at)]));
  for (const j of jitters) assert.deepEqual(j, jitters[0]);
  // ...and it's what a note at that time would have been picked by
  assert.deepEqual(jitters[0], [noteJitter('F#1', 2.5, 37), noteJitter('F#1', 2.5, 5), noiseStart(key, 2.5)]);
  // Another place, another pick: every hit still differs from the next
  const picks = new Set(Array.from({ length: 64 }, (_, i) => atSongPlace(100 + i * 0.5, i * 0.5, () => noteJitter('F#1', 100 + i * 0.5, 37))));
  assert.equal(picks.size, 64);
  const starts = new Set(Array.from({ length: 64 }, (_, i) => atSongPlace(7 + i * 0.125, i * 0.125, () => noiseStart(key, 7 + i * 0.125))));
  assert.equal(starts.size, 64);
});

test("what starts later within a song's note keeps how much later (a strum's later string, a clap's later slap)", () => {
  const strum = (at) => atSongPlace(at, 4, () => [noteJitter('E3', at + 0.012, 7), noteJitter('B3', at + 0.024, 7), noiseStart(key, at + 0.011)]);
  assert.deepEqual(strum(50), strum(0.25 + 4));
  assert.deepEqual(strum(50), [noteJitter('E3', 4.012, 7), noteJitter('B3', 4.024, 7), noiseStart(key, 4.011)]);
});

test("a song's note struck later than asked (the page held up) is picked as it would have been on time", () => {
  const onTime = atSongPlace(20, 1, () => [noteJitter('C4', 20, 71), noiseStart(key, 20)]);
  const moved = atSongPlace(20, 1, () => struckLater(0.0123, () => [noteJitter('C4', 20.0123, 71), noiseStart(key, 20.0123)]));
  assert.deepEqual(moved, onTime);
  // Played by hand, a moved note is picked by where it plays (no place to go back to)
  assert.equal(struckLater(0.0123, () => noteJitter('C4', 20.0123, 71)), noteJitter('C4', 20.0123, 71));
  // (Not moved: as it is)
  assert.equal(atSongPlace(20, 1, () => struckLater(0, () => placeOf(20.5))), 1.5);
});

test('outside a note of the song, the clock counts again (after one that failed too)', () => {
  assert.equal(atSongPlace(30, 3, () => atSongPlace(31, 4, () => placeOf(31)) + placeOf(30)), 7);
  assert.throws(() =>
    atSongPlace(30, 3, () => {
      throw new Error('a note that failed');
    })
  );
  assert.equal(placeOf(30), 30);
  assert.equal(noteJitter('F#1', 0.25, 37), -0.8003483428154952);
});

test("a swung note's lateness in a tempo glide is the map's at its tick, not the tempo the Transport has as the scheduler runs (scan r43)", async () => {
  const { noteLateness, swingDelay } = await import('../src/audio/transport.ts');
  const { tempoAt } = await import('../src/audio/tempoMap.ts');
  const PPQ = 192;
  const glide = { bpm: 110, points: [{ id: 'p1', bar: 9, bpm: 150, ramp: true }] };
  // An off-beat 16th in bar 1, bar 5 and bar 8: the tempo at its own tick (the song's swing, a clip's
  // own on an 8th grid, a row's own and its shift)
  for (const tick of [PPQ / 4, 4 * 4 * PPQ + PPQ / 4, 7 * 4 * PPQ + 3 * PPQ + PPQ / 4]) {
    const bpm = tempoAt(tick / (4 * PPQ) + 1, glide);
    assert.equal(noteLateness({ swung: true }, tick, 0.5, glide, PPQ), swingDelay(0.5, bpm, PPQ));
    assert.equal(noteLateness({ swung: true, groove: { swing: 0.3, grid: 8 } }, tick, 0.5, glide, PPQ), swingDelay(0.3, bpm, PPQ, 8));
    assert.equal(noteLateness({ swung: true, rowSwing: { swing: 0.2, grid: 16 }, shift: 0.25 }, tick, 0.5, glide, PPQ), swingDelay(0.2, bpm, PPQ, 16) + (0.25 * 15) / bpm);
    // not swung, and no shift: on its tick
    assert.equal(noteLateness({ swung: false }, tick, 0.5, glide, PPQ), 0);
  }
  // So what's picked for it, by its place plus its lateness, is the same for the whole song, a
  // range from bar 5 and at 48 kHz, live and exported: nothing of when it's scheduled is in it
  const tick = 4 * 4 * PPQ + PPQ / 4;
  const late = noteLateness({ swung: true }, tick, 0.5, glide, PPQ);
  assert.equal(late, noteLateness({ swung: true }, tick, 0.5, { ...glide }, PPQ));
  // A steady tempo: as before
  assert.equal(noteLateness({ swung: true }, PPQ / 4, 0.3, 120, PPQ), swingDelay(0.3, 120, PPQ));
});

/** A stand-in for a live Tone context (or an export's): its clock. */
function fakeContext({ now = 10, offline = false } = {}) {
  const raw = { currentTime: now, sampleRate: 44100, baseLatency: 0.01 };
  return { rawContext: raw, isOffline: offline, sampleRate: 44100, state: 'running', get currentTime() { return raw.currentTime; } };
}

test("a song's Tone drum hit moved later live (the page held up) picks its noise as it would have on time (scan r43)", async () => {
  // (No browser here: nothing is an OfflineAudioContext)
  globalThis.OfflineAudioContext ??= class {};
  const { monotonicHits } = await import('../src/audio/presets/monotonic.ts');
  // Asked for 10.0 s (2.5 s into the song); the clock already at 10.05 s: it lands later
  const live = fakeContext({ now: 10.05 });
  const hit = monotonicHits(live);
  const first = atSongPlace(10, 2.5, () => hit(10, (t) => ({ t, place: placeOf(t), noise: noiseStart(key, t) })));
  assert.ok(first.t > 10.05, `${first.t} lands past the clock`);
  assert.deepEqual([first.place, first.noise], [2.5, noiseStart(key, 2.5)]);
  // A second hit on the voice asked for the same moment (another clip's) comes a millisecond after,
  // as in an export: picked a millisecond on, as there
  const second = atSongPlace(10, 2.5, () => hit(10, (t) => ({ t, place: placeOf(t) })));
  assert.ok(Math.abs(second.t - first.t - 0.001) < 1e-9);
  assert.ok(Math.abs(second.place - 2.501) < 1e-9);
  // On time, and in an export: as before
  const onTime = atSongPlace(11, 3.5, () => hit(11, (t) => [t, placeOf(t)]));
  assert.deepEqual(onTime, [11, 3.5]);
  const exported = monotonicHits(fakeContext({ now: 0, offline: true }));
  assert.deepEqual(atSongPlace(2.75, 2.5, () => exported(2.75, (t) => [t, placeOf(t)])), [2.75, 2.5]);
  // Played by hand: picked where it lands, as before
  live.rawContext.currentTime = 20;
  const byHand = hit(19.99, (t) => [t, placeOf(t)]);
  assert.equal(byHand[1], byHand[0]);
});

test("a song's Tone note struck later than asked picks its noise burst as it would have on time (scan r43)", async () => {
  const Tone = await import('tone');
  await import('../src/audio/toneFixes.ts');
  // A NoiseSynth (a Drum Machine's snare or hat) asked for 10.004 s while the clock is at 10 s: less
  // than a render callback ahead, so it's struck a callback past the clock
  const context = { currentTime: 10, sampleRate: 44100, isOffline: false, rawContext: { baseLatency: 0.01 } };
  const bursts = [];
  const synth = Object.create(Tone.NoiseSynth.prototype);
  Object.defineProperties(synth, {
    context: { value: context },
    toSeconds: { value: (t) => t },
    log: { value: () => {} },
    envelope: { value: { attack: 0.001, decay: 0.1, sustain: 0, triggerAttack(t) { this._struckAt = t; } } },
    noise: { value: { start: (t) => bursts.push({ t, place: placeOf(t), noise: noiseStart(key, t) }), stop: () => {} } },
  });
  atSongPlace(10.004, 2.5, () => synth.triggerAttack(10.004, 1));
  assert.equal(bursts.length, 1);
  assert.ok(bursts[0].t > 10.01, `${bursts[0].t} is a callback past the clock`);
  assert.deepEqual([bursts[0].place, bursts[0].noise], [2.5, noiseStart(key, 2.5)]);

  // Its noise started past the clock by Tone (the clock moved on as it was set): picked where it was asked for
  const started = [];
  const noise = Object.create(Tone.Noise.prototype);
  Object.defineProperties(noise, {
    context: { value: { currentTime: 10.02, isOffline: false, state: 'running' } },
    toSeconds: { value: (t) => t },
    log: { value: () => {} },
    _synced: { value: false },
    _state: { value: { getValueAtTime: () => 'stopped', setStateAtTime: () => {}, get: () => null } },
    _start: { value: (t) => started.push([t, placeOf(t)]) },
  });
  atSongPlace(10, 2.5, () => noise.start(10));
  assert.deepEqual(started, [[10.02, 2.5]]);
  // (played by hand: where it lands)
  noise.start(10);
  assert.deepEqual(started[1], [10.02, 10.02]);
});
