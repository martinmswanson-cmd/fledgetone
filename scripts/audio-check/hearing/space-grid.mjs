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
// Run with `node scripts/audio-check/hearing/space-grid.mjs`; add a word (wet, dry, wide, drums) to
// run one family.
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
family('Nearly dry: decay within 35% of RT/3, or under 150 ms', [0.1, 0.15, 0.2, 0.25, 0.3, 0.4], [0.1, 0.15, 0.2, 0.3], [1, 2, 3], (rt, s) => {
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
              const ringsLonger = snareMs === 100 && hat && rt === 0.5;
              if (Math.abs(s.decayMs / yardstick - 1) > 0.35) {
                if (quickIntoQuiet && s.decayMs >= 250 && s.decayMs < yardstick) limits.push(`${where}: ${s.decayMs} ms against ${Math.round(yardstick)} (a snare that falls fast into a quiet long reverb, seen only between hats)`);
                else wrong.push(`seed ${seed}, ${rt}/${wet}: decay ${s.decayMs} against ${Math.round(yardstick)}`);
              } else if (dry.decayMs !== null && s.decayMs < dry.decayMs) {
                if (ringsLonger && s.decayMs >= 0.8 * dry.decayMs) limits.push(`${where}: ${s.decayMs} ms under the dry ${dry.decayMs} (each hat's own short tail over a snare that rings longer than the reverb)`);
                else under.push(`${where}: ${s.decayMs} under ${dry.decayMs}`);
              }
              for (const [[rt2, wet2], other] of read) {
                if (other.wetShare !== null && rt2 <= rt && wet2 <= wet && s.wetShare < other.wetShare - 0.05 - 1e-9) wrong.push(`seed ${seed}, ${rt}/${wet}: wet share ${s.wetShare} after ${other.wetShare} at ${rt2}/${wet2}`);
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
console.log(failures ? `\n${failures} failing` : '\nAll read as they should.');
process.exit(failures ? 1 : 0);
