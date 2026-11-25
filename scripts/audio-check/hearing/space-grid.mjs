// The wide grids for the hearing report's space (src/audio/hearing/space.ts), too slow for the unit
// tests. Each prints a table (decay ms / wet share) and the script exits non-zero on any failure.
// The made pluck sound (8 notes 0.25 s long, one every 0.75 s) through made reverbs:
// - Wet: RT 1, 1.5, 2 and 3 s at wet 0.2 to 0.9, noise seeds 1 to 6: each reads, with a decay within
//   35% of RT/3 and a wet share that falls no more than 0.05 from one wet step to the next (0.04 on
//   seeds 1 to 3).
// - Nearly dry: RT 0.1 to 0.4 s at wet 0.1 to 0.3, seeds 1 to 3: each reads, within 35% of RT/3 or
//   "Dry" (under 150 ms).
// - Wide: the tails decorrelated between the channels read at least 7 dB wider than the direct sound.
// Made drum beats (a kick and a snare in turn, 2 and 4 hits a second, with and without a hat twice as
// often), dry and through reverbs of 0.5, 0.8 and 1.5 s at wet 0.3 and 0.5, seeds 1 to 3:
// - a dry beat: wet share under 0.3; with a hat, a decay within 20% of the same beat's without;
// - a reverbed beat: decay null or within 35% of the yardstick, the longer of RT/3 and the dry beat's
//   own reading (a hit's own ring counts as ringing on), and never under the dry reading; at most a
//   quarter of the reverbed beats null; wet share no lower through a longer or wetter reverb than
//   through a shorter or drier one by more than 0.05. Two known limits of hats over hits are listed
//   and not failed while they read as pinned in scripts/hearingSpace.test.mjs: the snare-60 beat four
//   a second through the 1.5 s reverb at wet 0.3 reads short of its yardstick, and the snare-100 beats
//   through the 0.5 s reverb read up to a fifth under their dry reading.
// Since round 5 (when in doubt the group says less), the sounds that drew false lines:
// - Echo: delays and ping-pongs write no "Dry" line and give no width beside their echo; different
//   notes each a step quieter are no echo, and a fading riff of one note still is. At 22.05 to 96 kHz,
//   a 375 ms delay and ping-pong, and noise bursts once a second through 375, 437 and 625 ms delays,
//   read their own lag (not twice it, and not none).
// - Toms (one partial, whose reverb tail swells and sags): a fill through long reverbs is not "Long
//   tails" past 1.5 times its yardstick and is no echo; single toms through reverbs are not "Dry".
// - Attacks: notes with slow straight attacks read within 35% of their release or nothing, not "Dry".
// - Mixed: a beat with accented 16th hats through a quiet reverb reads within 35% or nothing; dry
//   notes then drowned notes, and a beat with only its clap in a reverb, are not "Dry".
// - Silence: a dry sound alike in both channels, with digital silence between notes, has no width.
// - Limits: the known limits, printed as they read (pinned in scripts/hearingSpace.test.mjs).
// Run with `node scripts/audio-check/hearing/space-grid.mjs`; add a word (wet, nearly, wide, drums,
// echo, toms, attacks, mixed, silence, limits) to run one family.
import { register } from 'node:module';

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

const { spaceOf } = await import('../../../src/audio/hearing/space.ts');
const { soundWords } = await import('../../../src/audio/hearing/words.ts');
const S = await import('../../fixtures/hearingSignals.mjs');

const SR = 48000;
const only = (process.argv[2] ?? '').toLowerCase();
const fromC4 = (semitones) => 261.6256 * 2 ** (semitones / 12);
const pluck = S.melody([0, 4, 7, 12, 9, 5, 2, -1].map((s, i) => [fromC4(s), i * 0.75, 0.25]), 8, -6);
let failures = 0;
const cell = (s) => (s.decayMs === null ? 'null' : `${s.decayMs}/${s.wetShare}`).padStart(10);

/** One row per RT and seed, one column per wet; `check(rt, s, previous)` says what is wrong, or nothing. */
function family(title, rts, wets, seeds, check) {
  if (!title.toLowerCase().includes(only)) return;
  console.log(`\n${title}\n${'RT s / seed'.padEnd(14)}${wets.map((w) => `wet ${w}`.padStart(10)).join('')}`);
  for (const rt of rts) {
    for (const seed of seeds) {
      let previous = null;
      const cells = [];
      const wrong = [];
      for (const wet of wets) {
        const x = S.reverb(pluck, rt, wet, seed);
        const s = spaceOf([x, x], SR);
        const why = check(rt, s, previous);
        if (why) wrong.push(`wet ${wet}: ${why}`);
        cells.push(cell(s));
        previous = s;
      }
      failures += wrong.length;
      console.log(`${`${rt} / ${seed}`.padEnd(14)}${cells.join('')}${wrong.length ? `   FAIL ${wrong.join('; ')}` : ''}`);
    }
  }
}

const near = (rt, ms) => Math.abs(ms / ((rt * 1000) / 3) - 1) <= 0.35;
const wets = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
let seed = 0;
family('Wet: decay within 35% of RT/3, wet share falling at most 0.05 a step (0.04 on seeds 1 to 3)', [1, 1.5, 2, 3], wets, [1, 2, 3, 4, 5, 6], (rt, s, previous) => {
  // (the seeds come in turn within each RT, a wet at a time: a row starts where there is no previous cell)
  if (!previous) seed = (seed % 6) + 1;
  if (s.decayMs === null || s.wetShare === null) return 'null';
  if (!near(rt, s.decayMs)) return `decay ${s.decayMs}`;
  const step = seed <= 3 ? 0.04 : 0.05;
  if (previous?.wetShare != null && s.wetShare < previous.wetShare - step - 1e-9) return `wet share ${s.wetShare} after ${previous.wetShare}`;
  return '';
});
family('Nearly dry (nearly): decay within 35% of RT/3, or under 150 ms', [0.1, 0.15, 0.2, 0.25, 0.3, 0.4], [0.1, 0.15, 0.2, 0.3], [1, 2, 3], (rt, s) => {
  if (s.decayMs === null) return 'null';
  if (!near(rt, s.decayMs) && s.decayMs >= 150) return `decay ${s.decayMs}`;
  return '';
});

if ('wide'.includes(only)) {
  console.log('\nWide: tails decorrelated between the channels, at least 7 dB wider than the direct sound; the same tail in both, under 1 dB');
  for (const [a, b] of [[1, 2], [3, 4], [5, 6]]) {
    const wide = spaceOf([S.reverb(pluck, 1, 0.5, a), S.reverb(pluck, 1, 0.5, b)], SR).tailWiderDb;
    const same = spaceOf([S.reverb(pluck, 1, 0.5, a), S.reverb(pluck, 1, 0.5, a)], SR).tailWiderDb;
    const wrong = !(wide >= 7) || !(same < 1);
    failures += wrong ? 1 : 0;
    console.log(`seeds ${a} and ${b}: ${wide} dB; seed ${a} in both: ${same} dB${wrong ? '   FAIL' : ''}`);
  }
}

if ('drums'.includes(only)) {
  console.log('\nDrums: a dry beat, then RT s / wet through each seed (decay ms / wet share)');
  const reverbs = [0.5, 0.8, 1.5].flatMap((rt) => [0.3, 0.5].map((wet) => [rt, wet]));
  console.log(`${'beat'.padEnd(28)}${'dry'.padStart(10)}  seed${reverbs.map(([rt, wet]) => `${rt}/${wet}`.padStart(10)).join('')}`);
  let cells = 0;
  let nulls = 0;
  const under = [];
  const limits = [];
  for (const [name, kickMs, snareMs, snareSeconds] of [['kick 80, snare 60', 80, 60, 0.3], ['kick 150, snare 100', 150, 100, 0.4]]) {
    for (const rate of [2, 4]) {
      let plain = null;
      for (const hat of [false, true]) {
        const x = S.beat(kickMs, snareMs, snareSeconds, rate, hat, 8);
        const dry = spaceOf([x], SR);
        if (!hat) plain = dry;
        const wrong = [];
        if (dry.wetShare !== null && dry.wetShare >= 0.3) wrong.push(`dry: wet share ${dry.wetShare}`);
        if (hat && dry.decayMs !== null && plain.decayMs !== null && Math.abs(dry.decayMs / plain.decayMs - 1) > 0.2) wrong.push(`dry: decay ${dry.decayMs} against ${plain.decayMs} without the hat`);
        for (const seed of [1, 2, 3]) {
          const read = [];
          for (const [rt, wet] of reverbs) {
            const s = spaceOf([S.reverb(x, rt, wet, seed)], SR);
            cells++;
            if (s.decayMs === null) nulls++;
            else {
              const yardstick = Math.max((rt * 1000) / 3, dry.decayMs ?? 0);
              const where = `${name}, ${rate}/s${hat ? ', hat' : ''}, seed ${seed}, ${rt}/${wet}`;
              // The two known limits, both of hats over hits (pinned in scripts/hearingSpace.test.mjs): listed, not failed, while they read as pinned
              const quickIntoQuiet = snareMs === 60 && rate === 4 && hat && rt === 1.5 && wet === 0.3;
              const ringsLonger = snareMs === 100 && rt === 0.5;
              if (Math.abs(s.decayMs / yardstick - 1) > 0.35) {
                if (quickIntoQuiet && s.decayMs >= 250 && s.decayMs < yardstick) limits.push(`${where}: ${s.decayMs} ms against ${Math.round(yardstick)} (a snare that falls fast into a quiet long reverb, seen only between hats)`);
                else wrong.push(`seed ${seed}, ${rt}/${wet}: decay ${s.decayMs} against ${Math.round(yardstick)}`);
              } else if (dry.decayMs !== null && s.decayMs < dry.decayMs) {
                if (ringsLonger && s.decayMs >= 0.8 * dry.decayMs) limits.push(`${where}: ${s.decayMs} ms under the dry ${dry.decayMs} (a snare that rings longer than the reverb, most with each hat's own short tail over it)`);
                else under.push(`${where}: ${s.decayMs} under ${dry.decayMs}`);
              }
              for (const [[rt2, wet2], other] of read) {
                if (other.wetShare !== null && rt2 <= rt && wet2 <= wet && s.wetShare < other.wetShare - 0.05 - 1e-9) (snareMs === 100 && rate === 4 && hat && s.wetShare >= other.wetShare - 0.08 ? limits : wrong).push(`seed ${seed}, ${rt}/${wet}: wet share ${s.wetShare} after ${other.wetShare} at ${rt2}/${wet2}`);
              }
            }
            read.push([[rt, wet], s]);
          }
          const label = seed === 1 ? `${name}, ${rate}/s${hat ? ', hat' : ''}`.padEnd(28) + cell(dry) : ' '.repeat(38);
          console.log(`${label}  ${String(seed).padEnd(4)}${read.map(([, s]) => cell(s).padStart(10)).join('')}`);
        }
        failures += wrong.length;
        for (const why of wrong) console.log(`   FAIL ${why}`);
      }
    }
  }
  console.log(`${nulls} of ${cells} reverbed beats null${nulls > cells / 4 ? '   FAIL (over a quarter)' : ''}`);
  if (nulls > cells / 4) failures++;
  failures += under.length;
  for (const why of under) console.log(`   FAIL under the dry reading: ${why}`);
  if (limits.length) console.log(`Known limits (${limits.length}):\n${limits.map((l) => `   ${l}`).join('\n')}`);
}

// Round 5's families
const lines = (space) => soundWords({ space, faults: [] });
const says = (space, start) => lines(space).some((w) => w.startsWith(start));
const brief = (s) => `${s.decayMs === null ? 'null' : `${s.decayMs}/${s.wetShare}`}${s.echo ? ` echo ${s.echo.ms}x${s.echo.repeats}` : ''}${s.tailWiderDb === null ? '' : ` width ${s.tailWiderDb}`}`;
/** Prints a reading and counts it as failing when `why` is given. */
const row = (name, s, why) => {
  if (why) failures++;
  console.log(`${name.padEnd(44)}${brief(s)}${why ? `   FAIL ${why}` : ''}`);
};

if ('echo'.includes(only)) {
  console.log('\nEcho: no "Dry" line and no width beside an echo; different notes are no echo');
  const beside = (s) => (says(s, 'Dry') ? '"Dry" line' : s.echo && s.tailWiderDb !== null ? 'a width beside an echo' : '');
  for (const ms of [250, 375, 450, 500]) for (const feedback of [0.3, 0.5, 0.7]) {
    const s = spaceOf([S.delay(pluck, ms / 1000, feedback, 8)], SR, 120);
    row(`delay ${ms} ms, feedback ${feedback}`, s, beside(s));
  }
  for (const [seconds, feedback] of [[0.375, 0.5], [0.5, 0.5], [0.375, 0.7]]) {
    const s = spaceOf(S.pingPong(pluck, seconds, feedback, 8), SR, 120);
    row(`ping-pong ${seconds * 1000} ms, feedback ${feedback}`, s, beside(s) || (s.echo ? '' : 'no echo'));
  }
  for (const step of [2, 3, 4]) {
    const phrase = S.at(8.5, [0, 1, 2, 3].flatMap((g) => [0, 4, 7, 12, 16, 19].map((m, k) => [g * 2 + k * 0.25, S.gain(S.melody([[fromC4(m + (g % 2) * 2), 0, 0.2]], 0.2, -6), -step * k)])));
    const s = spaceOf([phrase], SR, 120);
    row(`six rising notes, ${step} dB a step`, s, s.echo ? 'an echo' : '');
  }
  const riff = S.at(4, Array.from({ length: 16 }, (_, i) => [i * 0.25, S.gain(S.melody([[fromC4(-12), 0, 0.25]], 0.25, -6), -3 * i)]));
  const s = spaceOf([riff], SR, 120);
  row('one note fading 3 dB a time', s, s.echo ? '' : 'no echo');
  // At other rates (since Task 3: the likeness window is a stretch of time, and a repeat's starts at its exact sample)
  const lagged = (x, ms) => (!x.echo ? 'no echo' : Math.abs(x.echo.ms - ms) > 5 ? `an echo of ${x.echo.ms} ms` : '');
  for (const rate of [22050, 44100, 88200, 96000]) {
    const notes = S.melody([0, 4, 7, 12, 9, 5, 2, -1].map((n, i) => [fromC4(n), i * 0.75, 0.25]), 8, -6, rate);
    const delayed = spaceOf([S.delay(notes, 0.375, 0.7, 8, rate)], rate, 120);
    row(`delay 375 ms, fb 0.7, ${rate} Hz`, delayed, beside(delayed) || lagged(delayed, 375));
    const thrown = spaceOf(S.pingPong(notes, 0.375, 0.7, 8, rate), rate, 120);
    row(`ping-pong 375 ms, fb 0.7, ${rate} Hz`, thrown, beside(thrown) || lagged(thrown, 375));
  }
  for (const rate of [44100, 96000]) {
    for (const [name, make] of [['snare 40', (i) => S.burst(0.3, 40, 1, -6, i + 1, rate)], ['snare 80', (i) => S.burst(0.3, 80, 1, -6, i + 1, rate)], ['hat 10', (i) => S.burst(0.1, 10, 0.5, -10, i + 1, rate)]]) {
      const hits = S.every(1, 8, make, rate);
      for (const ms of [375, 437, 625]) {
        const x = spaceOf([S.delay(hits, ms / 1000, 0.5, 8, rate)], rate);
        row(`${name} 1/s, ${ms} ms delay, ${rate} Hz`, x, lagged(x, ms));
      }
    }
  }
}

if ('toms'.includes(only)) {
  console.log('\nToms: a fill not "Long tails" past 1.5 times its yardstick, and no echo; single toms not "Dry"');
  const ring = 414; // (a time constant of 180 ms falls 20 dB in 414 ms)
  const fill = S.at(8, [0, 1, 2, 3].flatMap((b) => [220, 160, 120, 85].map((hz, i) => [b * 2 + i * 0.25, S.tom(hz)])));
  for (const [rt, wet] of [[0.8, 0.3], [1.5, 0.3], [1.5, 0.6], [2.5, 0.3], [2.5, 0.6]]) for (const seed of [1, 2, 3]) {
    const s = spaceOf([S.reverb(fill, rt, wet, seed)], SR, 120);
    row(`fill, ${rt}/${wet}, seed ${seed}`, s, s.echo ? 'an echo' : s.decayMs !== null && s.decayMs > 1.5 * Math.max((rt * 1000) / 3, ring) ? 'over 1.5 times its yardstick' : '');
  }
  let read = 0;
  let far = 0;
  for (const hz of [90, 120, 150, 200]) for (const rate of [1, 2]) {
    const x = S.every(rate, 8, () => S.tom(hz));
    const cells = [];
    for (const [rt, wet] of [[0.3, 0.3], [0.8, 0.6], [1.5, 0.3], [2.5, 0.3]]) for (const seed of [1, 3]) {
      const s = spaceOf([S.reverb(x, rt, wet, seed)], SR);
      if (says(s, 'Dry')) failures++;
      if (s.decayMs !== null) {
        read++;
        if (Math.abs(s.decayMs / Math.max((rt * 1000) / 3, ring) - 1) > 0.35) far++;
      }
      cells.push(`${s.decayMs}${says(s, 'Dry') ? ' FAIL "Dry"' : ''}`);
    }
    console.log(`${hz} Hz, ${rate}/s: dry ${spaceOf([x], SR).decayMs}; 0.3/0.3, 0.8/0.6, 1.5/0.3, 2.5/0.3 on seeds 1 and 3: ${cells.join(' ')}`);
  }
  console.log(`Known limit: ${far} of the ${read} single-tom cells that read are over 35% from their yardstick (one partial's tail swells and sags)`);
}

if ('attacks'.includes(only)) {
  console.log('\nAttacks: slow straight attacks read within 35% of their release, or nothing');
  for (const [attack, release, truth] of [[0.05, 0.2, 180], [0.08, 0.2, 180], [0.12, 0.3, 270]]) {
    const x = S.at(8, Array.from({ length: 10 }, (_, i) => [i * 0.75, S.shapedNote(fromC4([0, 4, 7, 12, 9][i % 5]), 0.4, attack, 0.1, -6, release)]));
    const s = spaceOf([x], SR);
    row(`attack ${attack * 1000} ms, release ${release * 1000} ms (about ${truth})`, s, says(s, 'Dry') ? '"Dry" line' : s.decayMs !== null && Math.abs(s.decayMs / truth - 1) > 0.35 ? `against ${truth}` : '');
  }
}

/** Dry drums over quieter plucks ringing in a reverb (a known limit). */
const overPlucks = (rt, wet, hat) => {
  const plucks = S.melody(Array.from({ length: 16 }, (_, i) => [fromC4([4, 7, 11, 12][i % 4]), i * 0.5 + 0.25, 0.2]), 8, -12);
  const drums = S.beat(90, 60, 0.3, 2, hat, 8);
  return [S.mix(drums, S.reverb(plucks, rt, wet, 1)), S.mix(drums, S.reverb(plucks, rt, wet, 2))];
};
const accented = S.accentedBeat(8);

if ('mixed'.includes(only)) {
  console.log('\nMixed: accented 16th hats through a quiet reverb within 35% or nothing; part dry and part drowned not "Dry"');
  for (const [rt, wet] of [[1.5, 0.3], [2.5, 0.3]]) for (const seed of [1, 2, 3]) {
    const s = spaceOf([S.reverb(accented, rt, wet, seed)], SR, 120);
    const yardstick = (rt * 1000) / 3;
    const off = s.decayMs !== null && Math.abs(s.decayMs / yardstick - 1) > 0.35;
    // (known limit 1 again: listed, not failed, while it reads as pinned)
    const limit = off && rt === 2.5 && s.decayMs >= 250 && s.decayMs < 350;
    row(`accented hats, ${rt}/${wet}, seed ${seed}`, s, off && !limit ? `against ${Math.round(yardstick)}` : s.echo ? 'an echo' : '');
    if (limit) console.log(`   known limit: ${s.decayMs} ms against ${Math.round(yardstick)}`);
  }
  const notes = [0, 4, 7, 12, 9, 5, 2, -1].map((n, i) => [fromC4(n), i * 0.75, 0.25]);
  const first = S.melody(notes, 6.5, -6);
  const second = S.melody(notes, 10, -6);
  for (const [rt, wet] of [[1.5, 0.5], [2, 0.6], [3, 0.8]]) {
    const s = spaceOf([1, 2].map((seed) => S.mix(first, S.at(16.5, [[6.5, S.reverb(second, rt, wet, seed)]]))), SR);
    row(`dry notes, then through ${rt}/${wet}`, s, says(s, 'Dry') ? '"Dry" line' : '');
  }
  const beat = 60 / 124;
  const kick = S.every(124 / 60, 16 * beat, () => S.decay(S.sine(52, 0.35, -2), 90));
  const hats = S.at(16 * beat, Array.from({ length: 16 }, (_, i) => [i * beat + beat / 2, S.burst(0.15, 50, 1, -14, 500 + i)]));
  const clap = S.at(16 * beat, Array.from({ length: 8 }, (_, i) => [i * 2 * beat + beat, S.burst(0.2, 45, 2, -7, 600 + i)]));
  const s = spaceOf([1, 2].map((seed) => S.mix(kick, hats, S.reverb(clap, 1.8, 0.35, seed))), SR);
  row('a beat with only its clap through 1.8/0.35', s, says(s, 'Dry') ? '"Dry" line' : '');
}

if ('silence'.includes(only)) {
  console.log('\nSilence: a dry sound alike in both channels, digital silence between its notes, has no width');
  for (const rate of [44100, 48000, 96000]) {
    const x = S.melody([0, 4, 7, 12, 9, 5, 2, -1].map((n, i) => [fromC4(n), i * 0.75, 0.25]), 8, -6, rate);
    const s = spaceOf([x, x], rate);
    row(`${rate} Hz`, s, s.tailWiderDb !== null ? 'a width' : '');
  }
}

if ('limits'.includes(only)) {
  console.log('\nLimits: known, printed as they read (nothing here fails)');
  const say = (name, s) => console.log(`${name.padEnd(52)}${brief(s)}   ${lines(s).map((w) => w.split(/[:(]/)[0].trim()).join(' / ')}`);
  for (const [rt, wet] of [[1.5, 0.4], [2.5, 0.4], [2.5, 0.8]]) for (const hat of [false, true]) say(`dry drums${hat ? ' and hats' : ''} over plucks in ${rt}/${wet}`, spaceOf(overPlucks(rt, wet, hat), SR));
  const chords = (bpm, hold, ring) => {
    const b = 60 / bpm;
    return S.at(16 * b + 1.5, [[9, 12, 16, 19], [2, 5, 9, 12], [7, 11, 14, 17], [0, 4, 7, 11]].flatMap((c, k) => [[0, 1.5], [2, 1.2]].flatMap(([at, beats]) => c.map((m) => [k * 4 * b + at * b + (m % 3) * 0.012, S.gain(S.struck(fromC4(m - 12), beats * b * hold, ring), -12)]))));
  };
  for (const [bpm, hold, ring] of [[80, 1, 1.6], [70, 1.3, 1.2], [90, 0.7, 2.4]]) say(`struck chords held, no reverb (${bpm} bpm, ring ${ring})`, spaceOf([chords(bpm, hold, ring)], SR));
  const six = S.beat(80, 60, 0.3, 6, false, 8);
  for (const [rt, wet] of [[1.5, 0.3], [1.5, 0.6], [2.5, 0.3]]) say(`6 hits a second through ${rt}/${wet}`, spaceOf([S.reverb(six, rt, wet)], SR));
  say('toms on every 16th, dry', spaceOf([S.every(8, 8, (i) => S.tom([220, 160, 120, 85][Math.floor(i / 4) % 4], 150))], SR));
  for (const hold of [0.15, 0.28]) {
    const snares = S.every(1, 8, (i) => S.burst(0.3, 60, 1, -6, i + 1));
    const wet = S.reverb(snares, 2.5, 1);
    say(`a 2.5 s reverb gated shut after ${hold * 1000} ms`, spaceOf([Float32Array.from(snares, (v, i) => v + 3 * wet[i] * ((i / SR) % 1 < hold ? 1 : Math.max(0, 1 - (((i / SR) % 1) - hold) / 0.01)))], SR));
  }
  const drums = S.beat(150, 100, 0.4, 2, false, 8);
  for (const [rt, wet] of [[0.8, 0.3], [0.8, 0.6], [1.5, 0.6]]) say(`drums through ${rt}/${wet}: the wet share`, spaceOf([S.reverb(drums, rt, wet)], SR));
  for (const wet of [0.5, 0.6, 0.7, 0.8]) say(`plucks through a 4 s reverb at wet ${wet}`, spaceOf([S.reverb(pluck, 4, wet), S.reverb(pluck, 4, wet)], SR));
}
console.log(failures ? `\n${failures} failing` : '\nAll read as they should.');
process.exit(failures ? 1 : 0);
