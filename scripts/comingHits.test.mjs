// Stop and Pause on a drum kit built from Tone's synths (src/audio/presets/toneStop.ts, createComingHits): hits still to
// come are called off; on Pause, a hit begun since the place being heard (not heard yet, and to play again on Play) fades out.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { createComingHits, UNHEARD_FADE } = await import('../src/audio/presets/toneStop.ts');

/** A stand-in for a Tone synth: what's done to its envelope, pitch and release, in order. */
function fakeSynth() {
  const log = [];
  const signal = (name) => ({
    cancelAndHoldAtTime: (t) => log.push([`${name}.hold`, t]),
    cancelScheduledValues: (t) => log.push([`${name}.cancel`, t]),
    linearRampToValueAtTime: (v, t) => log.push([`${name}.ramp`, v, t]),
  });
  return {
    log,
    envelope: { _sig: signal('env') },
    frequency: signal('freq'),
    triggerRelease: (t) => log.push(['release', t]),
  };
}

test('Stop: the hit to come is called off, the one ringing left alone', () => {
  const s = fakeSynth();
  const hits = createComingHits(() => 0);
  hits.add(s, 1);
  hits.add(s, 2);
  hits.callOff(1.5);
  assert.deepEqual(s.log, [['env.cancel', 2], ['freq.cancel', 2], ['release', 2]]);
});

test('Pause before a hit begun is heard: it fades out to 0 over a few ms, and the next never starts', () => {
  const s = fakeSynth();
  const hits = createComingHits(() => 0);
  hits.add(s, 1.48);
  hits.add(s, 1.501);
  // heard 1.46 (now 1.5 less the output latency): the hit at 1.48 has begun but isn't heard yet
  hits.callOff(1.5, 1.46);
  assert.deepEqual(s.log, [
    ['env.hold', 1.5],
    ['env.ramp', 0, 1.5 + UNHEARD_FADE],
    ['freq.cancel', 1.501],
    // (after the fade: a release begun during it would fall from there more slowly)
    ['release', 1.5 + UNHEARD_FADE],
  ]);
  assert.ok(UNHEARD_FADE > 0.001 && UNHEARD_FADE <= 0.01, 'a short fade, not a cut');
});

test('Pause after a hit was heard: it rings on (Play goes on after it)', () => {
  const s = fakeSynth();
  const hits = createComingHits(() => 0);
  hits.add(s, 1.4);
  hits.callOff(1.5, 1.46);
  assert.deepEqual(s.log, []);
});

test('the last hit begun is kept as hits are added, so a Pause still finds it', () => {
  const s = fakeSynth();
  let clock = 0;
  const hits = createComingHits(() => clock);
  hits.add(s, 1);
  hits.add(s, 1.2);
  clock = 1.3;
  // (1 is dropped: 1.2 has begun since; 1.2 is kept)
  hits.add(s, 1.4);
  hits.callOff(1.3, 1.15);
  assert.deepEqual(s.log.slice(0, 2), [['env.hold', 1.3], ['env.ramp', 0, 1.3 + UNHEARD_FADE]]);
  assert.deepEqual(s.log.at(-1), ['release', 1.4]);
});
