// Live sound let go of without a click (src/audio/letGoQuietly.ts): a track given another instrument or
// deleted while it plays rings out or fades, and delay compensation is set at once while nothing can be heard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { retirePlan, mayBeHeard, RETIRE_HOLD, RETIRE_FADE, RETIRE_SECONDS, DELETE_FADE } = await import('../src/audio/letGoQuietly.ts');

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('an instrument let go of rings through its release, fades to silence, and is disposed only after', () => {
  const plan = retirePlan(10);
  // The voices' own releases (the Synth Designer's 50 ms, a kit's 30 ms fades) play at full level
  assert.ok(plan.hold - 10 >= 0.15 - 1e-9);
  assert.ok(plan.silent > plan.hold && plan.silent - plan.hold >= 0.3, 'a fade long enough not to click');
  assert.ok(plan.dispose > plan.silent, 'silent before it goes');
  assert.ok(plan.dispose - 10 <= 1 + 1e-9, 'gone within a second: switching back and forth never piles up');
  assert.equal(RETIRE_HOLD + RETIRE_FADE < RETIRE_SECONDS, true);
  assert.ok(DELETE_FADE >= 0.01 && DELETE_FADE <= 0.03);
});

test('a change can be heard only while the audio runs and the song plays or something still rings', () => {
  // Opened before the first Play: the audio hasn't started
  assert.equal(mayBeHeard({ running: false, playing: false, now: 0.36, ringsUntil: Infinity }), false);
  assert.equal(mayBeHeard({ running: false, playing: true, now: 0.36, ringsUntil: Infinity }), false);
  assert.equal(mayBeHeard({ running: true, playing: true, now: 5, ringsUntil: -Infinity }), true);
  assert.equal(mayBeHeard({ running: true, playing: false, now: 5, ringsUntil: 6 }), true);
  assert.equal(mayBeHeard({ running: true, playing: false, now: 7, ringsUntil: 6 }), false);
  assert.equal(mayBeHeard({ running: true, playing: false, now: 0, ringsUntil: -Infinity }), false);
});

test('live instruments and channels are never disposed while they may sound', () => {
  const live = read('../src/audio/liveTracks.ts');
  // No instrument released and disposed back to back (its release cut dead)
  assert.doesNotMatch(live, /releaseAll\(\)\);?\s*\n\s*(lt\.)?instrument\.dispose\(\)/);
  assert.doesNotMatch(live, /lt\.instrument\.dispose\(\);\s*\n\s*lt\.strip\.dispose\(\)/);
  // A new instrument: the old one retired on its own feed; a deleted track faded out first
  assert.match(live, /retireInstrument\(track\.id, lt\);\s*\n\s*lt\.instrument = liveInstrument\(track\.instrumentKey, lt\.feed,/);
  assert.match(live, /whenPlayed\(strip\.fadeOut\(DELETE_FADE\), \(\) => \{/);
  assert.match(live, /whenPlayed\(plan\.dispose, \(\) => \{\s*\n\s*instrument\.dispose\(\);\s*\n\s*feed\.dispose\(\);/);
  // Nothing more goes to it from the moment it's let go of, once
  assert.match(live, /function retireInstrument[\s\S]*?letGoOf\(instrument\);\s*\n\s*safely\(\(\) => instrument\.releaseAll\(\)\);/);
  // Delay compensation glides only while it can be heard
  assert.match(live, /lt\.strip\.setAlignment\(delays\.get\(id\) \?\? null, heardNow\(lt\)\)/);
  const strip = read('../src/audio/effects/trackStrip.ts');
  assert.match(strip, /dryLink\.set\(seconds\(delays\?\.dry \?\? 0\), glide\)/);
  assert.match(strip, /if \(barrier && glide\) \{/);
  const link = read('../src/audio/effects/delayLink.ts');
  assert.match(link, /if \(!live \|\| !glide\) \{/);
});
