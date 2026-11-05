// Pause and Play near what's heard: the moment heard just after a start (src/audio/transport.ts heardMoment), a
// Drum Kit clap's later slaps going with their hit (src/audio/presets/native.ts callOffComing), and which pooled
// synth voice takes a note (src/audio/presets/poly.ts choosePoolVoice). Run with `npm test`.
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

const { heardMoment } = await import('../src/audio/transport.ts');
const { createVoiceSet } = await import('../src/audio/presets/native.ts');
const { choosePoolVoice } = await import('../src/audio/presets/poly.ts');

test('just after Play, until the start itself is heard, the place heard is where Play started', () => {
  // (the Transport, asked about a time before its start, reports where it was before: bar 1 here)
  const stale = () => 1;
  const start = { bar: 3, at: 10 };
  assert.deepEqual(heardMoment(9.97, start, stale), { bar: 3, at: 10 });
  assert.deepEqual(heardMoment(9.999, start, stale), { bar: 3, at: 10 });
  // Once it's heard, the Transport's own position
  assert.deepEqual(heardMoment(10, start, () => 3), { bar: 3, at: 10 });
  assert.deepEqual(heardMoment(10.5, start, () => 3.125), { bar: 3.125, at: 10.5 });
  assert.deepEqual(heardMoment(4, null, () => 2), { bar: 2, at: 4 });
});

/** A stand-in for a NativeVoice: what's done to its amp and sources. */
function fakeVoice(start, seconds, hit) {
  const log = [];
  const gain = {
    cancelAndHoldAtTime: (t) => log.push(['hold', t]),
    cancelScheduledValues: (t) => log.push(['cancel', t]),
    setValueAtTime: (v, t) => log.push(['set', v, t]),
    linearRampToValueAtTime: (v, t) => log.push(['ramp', v, t]),
    setTargetAtTime: (v, t) => log.push(['target', v, t]),
  };
  const source = { stop: () => {}, onended: null };
  return { log, voice: { start, hit, stopAt: start + seconds, sources: [source], nodes: [], amp: { gain } } };
}

/** A clap as the kit makes it: slaps at the hit, +11 and +23 ms, the room at +30 ms. */
function clap(t) {
  return [0, 0.011, 0.023, 0.03].map((offset, i) => fakeVoice(t + offset, i === 3 ? 0.45 : 0.05, t));
}

test('Pause once a clap is heard: its later slaps and its room ring on, as Play goes on after it', () => {
  const voices = createVoiceSet({});
  const parts = clap(1);
  parts.forEach((p) => voices.add(p.voice));
  // Heard: 16 ms into the clap; on the clock, 58 ms in (the output latency later)
  voices.callOffComing(1.058, 1.016);
  // Only the silence each had at its own end from the start; nothing faded or called off
  for (const p of parts) assert.deepEqual(p.log, [['set', 0, p.voice.stopAt]]);
});

test('Pause before a clap is heard: all of it fades out (Play plays it again); Stop calls off what is still to come', () => {
  const voices = createVoiceSet({});
  const parts = clap(1);
  parts.forEach((p) => voices.add(p.voice));
  voices.callOffComing(1.02, 0.99);
  // Begun on the clock (the first two slaps): faded from where they are; still to come: never started
  for (const p of parts.slice(0, 2)) {
    assert.ok(p.voice.stopAt > 1.02 && p.voice.stopAt <= 1.03, `stops at the fade's end (${p.voice.stopAt})`);
    assert.ok(p.log.some(([what]) => what === 'hold' || what === 'cancel'));
  }
  for (const p of parts.slice(2)) {
    assert.equal(p.voice.stopAt, p.voice.start, 'called off, never starts');
    assert.ok(p.log.some(([what, v, t]) => what === 'set' && v === 0 && t === 1.02));
  }
  const stop = createVoiceSet({});
  const later = clap(2);
  later.forEach((p) => stop.add(p.voice));
  stop.callOffComing(1.5);
  for (const p of later) assert.equal(p.voice.stopAt, p.voice.start, 'called off, never starts');
});

test('a voice of its own (no hit given) goes by its own start, as before', () => {
  const voices = createVoiceSet({});
  const early = fakeVoice(1, 0.5);
  const late = fakeVoice(1.03, 0.5);
  voices.add(early.voice);
  voices.add(late.voice);
  voices.callOffComing(1.06, 1.02);
  assert.equal(early.voice.stopAt, 1.5, 'heard: rings on');
  assert.ok(late.voice.stopAt < 1.07, 'not heard yet: fades');
});

const slot = (start, end, velocity = 1) => ({ start, end, velocity, releasedAt: end - 0.1 });
const REST = 256 / 44100;

test('a pool voice is free for a note only once it has rested two render blocks', () => {
  const a = slot(0, 1);
  // Ended exactly where the note starts, or less than two blocks before: another voice is made
  assert.equal(choosePoolVoice([a], 1, REST, 8), 'new');
  assert.equal(choosePoolVoice([a], 1 + REST / 2, REST, 8), 'new');
  assert.equal(choosePoolVoice([a], 1 + REST, REST, 8), a);
  // Another voice that has rested is taken instead (the one freed last)
  const b = slot(0, 0.5);
  const c = slot(0, 0.7);
  assert.equal(choosePoolVoice([a, b, c], 1, REST, 8), c);
});

test('with every voice made, one just ended still plays the note before a sounding one is stolen', () => {
  const ended = slot(0, 1);
  const sounding = slot(0.5, 2);
  assert.equal(choosePoolVoice([ended, sounding], 1.001, REST, 2), ended);
  // None ended: the quietest sounding one, never a note dropped
  const s2 = slot(0.6, 2.5, 0.5);
  assert.ok([sounding, s2].includes(choosePoolVoice([sounding, s2], 1, REST, 2)));
});

test('back to back notes use two voices in turn, not ever more', () => {
  const voices = [];
  for (let i = 0; i < 50; i++) {
    const t = i * 0.3;
    const pick = choosePoolVoice(voices, t, REST, 8);
    const v = pick === 'new' ? (voices.push(slot(-Infinity, -Infinity)), voices[voices.length - 1]) : pick;
    // Each note rings until exactly the next one starts
    Object.assign(v, slot(t, t + 0.3));
  }
  assert.equal(voices.length, 2);
});
