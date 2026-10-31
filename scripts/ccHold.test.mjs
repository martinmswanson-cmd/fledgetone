// Unit tests for what a plugin's controllers hold at a point of the song (src/audio/ccHold.ts):
// a clip's controller lane keeps its value after the clip ends, for the rest of the song, so
// playback started anywhere sets each controller as a playback of the whole song has it there.
// Run with `npm test`.
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
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
const { clipCcEvents, heldCcAt, restingCc, resetsFresh } = await import('../src/audio/ccHold.ts');

const clip = (startBar, lengthBars, expression) => ({ startBar, lengthBars, expression });
/** What a whole-song playback has sent each controller by `bar` (every event before it, in order). */
function wholeSong(clips, bar) {
  const all = clips.flatMap((c, i) => clipCcEvents(c).map((ev, k) => ({ ...ev, order: i * 1e6 + k })));
  all.sort((a, b) => a.at - b.at || a.order - b.order);
  const out = new Map();
  for (const ev of all) if (ev.at < bar) out.set(ev.cc, ev.value);
  return [...out].sort((a, b) => a[0] - b[0]);
}

test("a lane sends where its value changes, from its first point's value, and nothing past the clip's end", () => {
  const ev = clipCcEvents(clip(3, 2, { cc1: [{ at: 0, value: 1 }] }));
  assert.deepEqual(ev, [{ at: 3, cc: 1, value: 1 }]);
  const ramp = clipCcEvents(clip(1, 1, { cc74: [{ at: 0.5, value: 0 }, { at: 1, value: 1 }] }));
  assert.equal(ramp[0].at, 1);
  assert.equal(ramp[0].value, 0, 'its first point held from the clip start');
  assert.ok(ramp.length > 20 && ramp.every((e, i) => i === 0 || e.at > ramp[i - 1].at));
  assert.ok(ramp.every((e) => e.at < 2), 'none at or after its end');
  // Not a controller lane: the mod wheel as dynamics, bend, sustain
  assert.deepEqual(clipCcEvents(clip(1, 1, { mod: [{ at: 0, value: 1 }], bend: [{ at: 0, value: 2 }] })), []);
});

test('a value is held after its clip ends: at any start the controller is as the whole song has it there', () => {
  // Clip A (bars 1-3) turns the wheel up; clip B (bars 3-9) has no lanes; clip C (bars 9-11) brings it half down then CC 74 up
  const clips = [
    clip(1, 2, { cc1: [{ at: 0, value: 1 }] }),
    clip(3, 6, undefined),
    clip(9, 2, { cc1: [{ at: 0, value: 0.5 }], cc74: [{ at: 1, value: 0.25 }] }),
  ];
  const lists = clips.map(clipCcEvents);
  for (const bar of [1, 1.5, 2.99, 3, 5, 8.999, 9, 9.25, 10, 10.5, 12, 40]) {
    assert.deepEqual(heldCcAt(lists, bar), wholeSong(clips, bar), `at bar ${bar}`);
  }
  assert.deepEqual(heldCcAt(lists, 5), [[1, 1]], 'bar 5: clip A ended, its wheel still up');
  assert.deepEqual(heldCcAt(lists, 1), [], 'nothing before the first value: a fresh plugin is left as it is');
  assert.deepEqual(heldCcAt(lists, 12), [[1, 0.5], [74, 0.25]]);
  // A ramp read part way through: the value its last 64th sent
  const ramp = [clipCcEvents(clip(1, 4, { cc74: [{ at: 0, value: 0 }, { at: 4, value: 1 }] }))];
  const [[, v]] = heldCcAt(ramp, 3.3);
  assert.ok(Math.abs(v - (Math.floor(2.3 * 64) / 64) / 4) < 1e-9, String(v));
});

test('overlapping clips: the latest value sent wins; at one place, the later clip', () => {
  const clips = [clip(1, 8, { cc1: [{ at: 0, value: 0.2 }, { at: 4, value: 0.2 }, { at: 4.01, value: 0.9 }] }), clip(3, 1, { cc1: [{ at: 0, value: 0.6 }] })];
  const lists = clips.map(clipCcEvents);
  assert.deepEqual(heldCcAt(lists, 4), [[1, 0.6]], 'the clip begun later, still in its bar');
  assert.deepEqual(heldCcAt(lists, 7), wholeSong(clips, 7));
  assert.ok(heldCcAt(lists, 7)[0][1] > 0.85, 'the long clip moved it again after');
  const same = [clipCcEvents(clip(2, 1, { cc1: [{ at: 0, value: 0.3 }] })), clipCcEvents(clip(2, 1, { cc1: [{ at: 0, value: 0.7 }] }))];
  assert.deepEqual(heldCcAt(same, 3), [[1, 0.7]]);
});

test('a controller moved and not set by then goes back to rest (a loop going round, playing again after Stop)', () => {
  // Loop of bars 1-9; the wheel goes up in bar 5: round again at bar 1 it must be down
  const lists = [clipCcEvents(clip(5, 2, { cc1: [{ at: 0, value: 1 }], cc11: [{ at: 0, value: 0.2 }], cc7: [{ at: 0, value: 0.1 }], cc74: [{ at: 0, value: 0.9 }] }))];
  assert.deepEqual(heldCcAt(lists, 1), [], 'a fresh plugin: nothing sent');
  // Only the ones with a rest MIDI defines: volume and cutoff are left where the plugin has them
  // (its own start isn't a standard one: the JX10's filter and resonance aren't at their middle)
  assert.deepEqual(heldCcAt(lists, 1, new Set([1, 7, 11, 74])), [[1, 0], [11, 1]]);
  assert.deepEqual(heldCcAt(lists, 6, new Set([1])), [[1, 1], [7, 0.1], [11, 0.2], [74, 0.9]], 'past it, held');
  // One whose lane was taken away since it was sent
  assert.deepEqual(heldCcAt([], 3, new Set([2])), [[2, 0]]);
  assert.equal(restingCc(1), 0);
  assert.equal(restingCc(64), 0);
  assert.equal(restingCc(11), 1);
  for (const cc of [2, 4, 65, 66, 67, 68, 69]) assert.equal(restingCc(cc), 0, `CC ${cc}`);
  for (const cc of [3, 7, 8, 10, 70, 71, 74, 79, 91, 93, 119]) assert.equal(restingCc(cc), null, `CC ${cc}`);
});

test('Stop resets a plugin\'s controllers (Reset All Controllers), and the schedule sets them again where it starts', () => {
  const wam = readFileSync(new URL('../src/audio/presets/wamPlugin.ts', import.meta.url), 'utf8');
  const release = wam.slice(wam.indexOf('releaseAll: () => {'), wam.indexOf('cc: (cc: number'));
  assert.match(release, /sendMidi\(inst, \[0xb0, 121, 0\], now\)/);
  const sched = readFileSync(new URL('../src/audio/scheduler.ts', import.meta.url), 'utf8');
  assert.match(sched, /transport\.on\('start', onStart\)/);
  // A plugin moved since it was fresh: Reset All Controllers first, then the held values; the rests
  // only for a plugin whose reset may not put back its own fresh controllers
  assert.match(sched, /instrument\.resetControllers!\(time\)/);
  assert.match(sched, /heldCcAt\(lists, tick, fresh \? undefined : sent\)/);
  const reset = wam.slice(wam.indexOf('resetControllers: (time: number) => {'), wam.indexOf('setPluginParam:'));
  assert.match(reset, /sendMidi\(inst, \[0xb0, 121, 0\], time\);/);
  assert.match(reset, /return !!plugin && resetsFresh\(plugin\.url\);/);
  // The reset centres the bend too: the player's wheel and the knobs played live go again right
  // after it, and the scheduler then sends the song's own bend there (a bent note still sounding,
  // or ringing on after its end, keeps its bend off rest; else the clip's bend lane there, else
  // centre), never a bend left from before
  assert.ok(reset.indexOf('if (liveBend !== undefined) sendBend(liveBend, time)') > reset.indexOf('[0xb0, 121, 0]'));
  assert.doesNotMatch(wam, /bendAt\(/);
  assert.ok(sched.indexOf('holdBends(tick, time, only)') > sched.indexOf('instrument.resetControllers!(time)'));
  assert.match(sched, /const cents = songBendAt\(trackId, instrument, tick, time\);/);
  assert.match(sched, /return own !== undefined && Math\.abs\(own\) >= REST_CENTS \? own : laneBendAt\(trackId, tick, time\);/);
  // A note's own bend is sent in full when it starts, on the audio clock (a busy page can't hold a
  // slide up, a render's ring-out hears it out); a jump drops what's to come and holds the bend it
  // has until the instrument's next note (the song's bend there, cutting the held note's end) or
  // its end; Stop, Pause and Free memory drop every bend to come and centre; a move of the playhead
  // (Tone's "stop" then "start" at one time) keeps the notes sounding on
  assert.doesNotMatch(sched, /scheduleRepeat/);
  assert.match(sched, /for \(const \[t, cents\] of bends\) sendBend\(trackId, instrument, cents, t\);/);
  assert.match(sched, /if \(reset !== undefined\) sendBend\(trackId, instrument, laneBendAt\(trackId, tick, time\), reset, true\);/);
  assert.match(sched, /if \(stoppedAt !== null && stoppedAt !== time\) forgetNotes\(\);/);
  assert.match(sched, /onVoicesLetGo\(\(\) => liveSchedule\?\.letGo\(\)\)/);
  assert.doesNotMatch(sched, /bentNotes\.delete\(instrument\)/);
  assert.match(sched, /if \(cents === 0 && !bent\.has\(instrument\)\) continue;/);
  assert.match(reset, /for \(const \[n, v\] of liveCcs\) sendMidi\(inst, \[0xb0, n, v\], time\)/);
  const liveIn = readFileSync(new URL('../src/audio/liveInput.ts', import.meta.url), 'utf8');
  assert.match(liveIn, /instrument\.cc!\(message\.cc, message\.value, now, true\)/);
  assert.match(liveIn, /instrument\.bend!\(message\.cents, now, true\)/);
  // The player's wheel held where the song's bend is at rest, on every instrument (a plugin keeps it itself)
  const lt = readFileSync(new URL('../src/audio/liveTracks.ts', import.meta.url), 'utf8');
  assert.match(lt, /bend\(live \|\| cents !== 0 \? cents : \(wheel \?\? 0\), time, live, cut\);/);
  assert.match(lt, /lt\.instrument\.bend!\(0, liveMix\.bus\.context\.currentTime, true, true\)/);
  assert.match(lt, /letGo\.forEach\(\(l\) => safely\(l\)\);/);
  // Heard again (unmute, solo) or a plugin just loaded: that track's controllers where the song is
  assert.match(sched, /onTrackHeardAgain\(\(trackId\) => liveSchedule\?\.holdTrack\(trackId, liveContext\.now\(\)\)\)/);
  const live = readFileSync(new URL('../src/audio/liveTracks.ts', import.meta.url), 'utf8');
  assert.match(live, /if \(lt\.audible && !was\) heardTrack\(lt\)/);
  const fledge = readFileSync(new URL('../engine/fledge-synth/src/synth.rs', import.meta.url), 'utf8');
  assert.match(fledge, /121 => self\.reset_controllers\(\)/);
});

test('Reset All Controllers puts the built-in families back as fresh; others also get the rests', () => {
  for (const url of ['builtin:fledge/Fledge Synth', 'builtin:mda/JX10', 'builtin:faust/Piano Model', 'builtin:setbfree/Tonewheel Organ', 'builtin:surge/Surge XT'])
    assert.ok(resetsFresh(url), url);
  for (const url of ['builtin:mutable/Plaits', 'builtin:open303/Open303', 'https://plugins.example/synth/index.js', 'fledge/x'])
    assert.ok(!resetsFresh(url), url);
  // With the reset trusted, nothing but the values clips have sent (no rest that isn't the plugin's own:
  // the organ's wheel at 0 would set its speaker to Slow)
  const lists = [clipCcEvents(clip(5, 2, { cc1: [{ at: 0, value: 1 }], cc74: [{ at: 0, value: 0.9 }] }))];
  assert.deepEqual(heldCcAt(lists, 1, undefined), []);
  assert.deepEqual(heldCcAt(lists, 6, undefined), [[1, 1], [74, 0.9]]);
});
