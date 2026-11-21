// The guard of the hearing report's group versions (HEARING_VERSIONS in src/audio/hearing/types.ts).
// A saved hearing is compared with a new one group by group, on the groups whose versions match, so a
// group whose numbers or thresholds change must have its version raised: an older saved hearing is then
// said to be stale in that group rather than compared as if nothing had moved. This test pins a handful
// of numbers of each group for one made, fixed sound (a gated saw with noise, a click planted in it,
// stereo). When a pin fails, the group moved: raise its version and update the pin. Run with `npm test`.
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

const { hearSound } = await import('../src/audio/hearing/hearSound.ts');
const { HEARING_VERSIONS } = await import('../src/audio/hearing/types.ts');
const S = await import('./fixtures/hearingSignals.mjs');

// The sound: 4 seconds, a 110 Hz saw gated at 4 Hz (12 dB deep) with its own pink noise in each channel
// 24 dB under it, and one sample raised by 0.4 in both channels 2.3037 s in (between the saw's corners)
const SECONDS = 4;
const channel = (seed) => S.mix(S.gate(S.saw(110, SECONDS, -6), 4, -12), S.pink(SECONDS, -30, seed));
const left = channel(1);
const right = channel(2);
const CLICK_AT = Math.round(2.3037 * 48000);
left[CLICK_AT] += 0.4;
right[CLICK_AT] += 0.4;
const report = hearSound([left, right], 48000, { engine: 'pin', tempoBpm: 120 });

/** The versions these pins were measured at: a group raised past its pin needs its numbers measured again. */
const PINNED_VERSIONS = { tone: 1, texture: 1, movement: 1, dynamics: 1, attack: 1, stereo: 1, pitch: 1, faults: 1 };

const what = (group) => `the ${group} group moved: raise HEARING_VERSIONS.${group} in src/audio/hearing/types.ts and update this pin`;
/** One pinned number of a group. */
const pin = (group, name, actual, expected, tolerance) =>
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tolerance, `${name} is ${actual}, pinned at ${expected} (within ${tolerance}): ${what(group)}`);
/** One pinned value of a group that is not a number. */
const same = (group, name, actual, expected) => assert.deepEqual(actual, expected, `${name} is ${JSON.stringify(actual)}, pinned at ${JSON.stringify(expected)}: ${what(group)}`);
const region = (list, start) => list.find((x) => x.name.startsWith(start))?.db;

test('the versions are the ones these pins were measured at', () => {
  assert.deepEqual(
    { ...HEARING_VERSIONS },
    PINNED_VERSIONS,
    'a version in HEARING_VERSIONS (src/audio/hearing/types.ts) differs from the one pinned here: measure that group of this sound again, update its pins below, and set PINNED_VERSIONS to match'
  );
  assert.deepEqual(report.versions, { ...HEARING_VERSIONS }, 'a report carries the versions it was measured at');
});

test('tone: the pinned numbers hold', () => {
  const t = report.tone;
  pin('tone', 'centreHz', t.centreHz, 445, 5);
  pin('tone', 'rolloffHz', t.rolloffHz, 1441, 15);
  pin('tone', 'tiltDbPerOctave', t.tiltDbPerOctave, -0.8, 0.1);
  pin('tone', 'subVsBassDb', t.subVsBassDb, -20.2, 0.2);
  pin('tone', 'the bass region', region(t.regions, 'bass'), -2.2, 0.1);
  pin('tone', 'the presence region', region(t.regions, 'presence'), -20.2, 0.2);
  same('tone', 'the number of narrow peaks', t.peaks.length, 5);
  pin('tone', 'the first peak, Hz', t.peaks[0].hz, 110.1, 0.3);
  pin('tone', 'the first peak, dB over its surroundings', t.peaks[0].overDb, 25.4, 0.3);
  pin('tone', 'the spectrum at 110 Hz, middle', t.spectrum.mid[t.spectrum.freqs.findIndex((f) => Math.abs(Math.log2(f / 110)) < 1 / 12)], -20.2, 0.3);
});

test('texture: the pinned numbers hold', () => {
  const t = report.texture;
  pin('texture', 'flatness', t.flatness, 0.02, 0.01);
  pin('texture', 'roughness', t.roughness, 0.29, 0.02);
  pin('texture', 'percussiveShare', t.percussiveShare, 0.11, 0.02);
  same('texture', 'flatTops', t.flatTops, null);
});

test('movement: the pinned numbers hold', () => {
  const m = report.movement;
  pin('movement', 'changeDb', m.changeDb, 4.9, 0.2);
  same('movement', 'the bands that move', m.modulations.map((x) => `${x.band} ${x.note}`), ['low 1/8', 'mid 1/8', 'high 1/8']);
  const band = (name) => m.modulations.find((x) => x.band === name);
  pin('movement', 'the low band, Hz', band('low').hz, 4, 0.1);
  pin('movement', 'the low band, dB deep', band('low').depthDb, 12.5, 0.3);
  pin('movement', 'the mid band, dB deep', band('mid').depthDb, 12.2, 0.3);
  pin('movement', 'the high band, dB deep', band('high').depthDb, 9.0, 0.3);
});

test('dynamics: the pinned numbers hold', () => {
  const d = report.dynamics;
  pin('dynamics', 'lufs', d.lufs, -12.8, 0.1);
  pin('dynamics', 'shortTermMaxLufs', d.shortTermMaxLufs, -12.8, 0.1);
  pin('dynamics', 'truePeakDbtp', d.truePeakDbtp, -4.4, 0.1);
  pin('dynamics', 'crestDb', d.crestDb, 10.2, 0.1);
  same('dynamics', 'rangeLu (4 seconds are too few to have one)', d.rangeLu, null);
});

test('attack: the pinned numbers hold', () => {
  const a = report.attack;
  pin('attack', 'onsetsPerSecond', a.onsetsPerSecond, 4, 0.1);
  pin('attack', 'riseMs', a.riseMs, 5.5, 0.3);
  same('attack', 'single', a.single, null);
});

test('stereo: the pinned numbers hold', () => {
  const s = report.stereo;
  pin('stereo', 'correlation', s.correlation, 0.97, 0.01);
  pin('stereo', 'balanceDb', s.balanceDb, 0, 0.1);
  pin('stereo', 'monoLossDb', s.monoLossDb, -0.1, 0.1);
  pin('stereo', 'lowSideDb', s.lowSideDb, -21.7, 0.3);
  pin('stereo', 'the width of the bass', region(s.width, 'bass'), -25, 0.3);
  pin('stereo', 'the width of the air', region(s.width, 'air'), -6.1, 0.3);
});

test('pitch: the pinned numbers hold', () => {
  const p = report.pitch;
  same('pitch', 'the tempo, as given', [p.tempo.bpm, p.tempoKnown], [120, true]);
  same('pitch', 'the key', [p.key.name, p.key.runnerUp], ['A major', 'A minor']);
  pin('pitch', 'the key, how sure', p.key.confidence, 0.75, 0.03);
  pin('pitch', 'tuningCents', p.tuningCents, -7, 1);
  pin('pitch', 'the pitch class A', p.chroma[9], 1, 0.001);
  pin('pitch', 'the pitch class E', p.chroma[4], 0.43, 0.03);
});

test('faults: the pinned numbers hold', () => {
  same('faults', 'the kinds of fault found', report.faults.map((f) => f.kind), ['click']);
  const click = report.faults[0];
  pin('faults', 'the click, seconds', click.seconds, 2.304, 0.001);
  pin('faults', 'the click, the size of its jump in dBFS', click.value, -8, 0.1);
  same('faults', 'the click, its channel (both: none named)', click.channel, undefined);
});

test('the words of this sound are the ones pinned (a threshold that moves changes them)', () => {
  assert.deepEqual(
    report.words,
    [
      'The spectral centre sits at 445 Hz: dark.',
      'There is little sub bass (20.2 dB under the bass).',
      'A narrow peak at 110 Hz stands 25.4 dB over its surroundings (a resonance, or a held note).',
      'A narrow peak at 220 Hz stands 22.2 dB over its surroundings (a resonance, or a held note).',
      'A narrow peak at 330 Hz stands 20.3 dB over its surroundings (a resonance, or a held note).',
      '2 more narrow peaks: 550 Hz, 440 Hz.',
      'Mostly held sound (11% percussive).',
      'The low band (40-250 Hz) moves at 4.0 Hz (1/8 notes), 12.5 dB deep.',
      'The mid band (250 Hz-4 kHz) moves at 4.0 Hz (1/8 notes), 12.2 dB deep.',
      'The high band (4-16 kHz) moves at 4.0 Hz (1/8 notes), 9.0 dB deep.',
      'Nearly mono (correlation 0.97).',
      'Sounds in A major (or A minor).',
      'A click, a jump of -8.0 dBFS, at 0:02.30.',
    ],
    'the words of the pinned sound changed. If a number or a threshold moved, raise the version of the group whose line it is (HEARING_VERSIONS in src/audio/hearing/types.ts) and update this pin; if only the wording changed, update this pin'
  );
});
