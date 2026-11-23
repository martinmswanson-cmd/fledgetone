// The wide grids for the hearing report's space (src/audio/hearing/space.ts), too slow for the unit
// tests: the made pluck sound (8 notes 0.25 s long, one every 0.75 s) through made reverbs of many
// lengths, mixes and noise seeds. Wet: RT 1, 1.5, 2 and 3 s at wet 0.2 to 0.9 must each read, with a
// decay within 35% of RT/3 and a wet share that falls no more than 0.05 from one wet step to the
// next. Nearly dry: RT 0.1 to 0.4 s at wet 0.1 to 0.3 must each read, within 35% of RT/3 or "Dry"
// (under 150 ms). Prints a table per family (decay ms / wet share) and exits non-zero on any failure.
// Run with `node scripts/audio-check/hearing/space-grid.mjs`; add a word (wet, dry) to run one family.
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
const cell = (s) => (s.decayMs === null ? 'null' : `${s.decayMs}/${s.wetShare}`).padStart(9);

/** One row per RT and seed, one column per wet; `check(rt, s, previous)` says what is wrong, or nothing. */
function family(title, rts, wets, seeds, check) {
  if (!title.toLowerCase().includes(only)) return;
  console.log(`\n${title}\n${'RT s / seed'.padEnd(14)}${wets.map((w) => `wet ${w}`.padStart(9)).join('')}`);
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
family('Wet: decay within 35% of RT/3, wet share falling at most 0.05 a step', [1, 1.5, 2, 3], wets, [1, 2, 3], (rt, s, previous) => {
  if (s.decayMs === null || s.wetShare === null) return 'null';
  if (!near(rt, s.decayMs)) return `decay ${s.decayMs}`;
  if (previous?.wetShare != null && s.wetShare < previous.wetShare - 0.05) return `wet share ${s.wetShare} after ${previous.wetShare}`;
  return '';
});
family('Nearly dry: decay within 35% of RT/3, or under 150 ms', [0.1, 0.15, 0.2, 0.25, 0.3, 0.4], [0.1, 0.15, 0.2, 0.3], [1, 2, 3], (rt, s) => {
  if (s.decayMs === null) return 'null';
  if (!near(rt, s.decayMs) && s.decayMs >= 150) return `decay ${s.decayMs}`;
  return '';
});
console.log(failures ? `\n${failures} failing` : '\nAll read as they should.');
process.exit(failures ? 1 : 0);
