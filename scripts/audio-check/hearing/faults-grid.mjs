// The wide grids for the hearing report's faults (src/audio/hearing/faults.ts), too slow for the unit
// tests: healthy music of every kind the app makes (hard-clipped and square basses under drums, noise
// at many levels and seeds, kick loops, held subs) must read no fault, and planted faults must be found.
// Prints a table per family and exits non-zero on any false fault or missed fault.
// Run with `node scripts/audio-check/hearing/faults-grid.mjs`; add a word (clicks, noise, hum, dc) to run only the
// families whose title has it.
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

const { faultsOf } = await import('../../../src/audio/hearing/faults.ts');
const S = await import('../../fixtures/hearingSignals.mjs');
const G = await import('../../fixtures/hearingFaultSignals.mjs');

const SR = 48000;
let failures = 0;
/** `node faults-grid.mjs hum` runs only the families whose title has that word. */
const only = (process.argv[2] ?? '').toLowerCase();
const wanted = (title) => title.toLowerCase().includes(only);
const kinds = (x, kind) => faultsOf(Array.isArray(x) ? x : [x], SR).filter((f) => f.kind === kind);

/** One table row per case: `want` is 0 for healthy (no fault of the kind) or a predicate on the faults found. */
function family(title, kind, cases) {
  if (!wanted(title)) return;
  console.log(`\n${title}`);
  let bad = 0;
  for (const [name, make, want] of cases) {
    const found = kinds(make(), kind);
    const ok = want === undefined ? found.length === 0 : want(found);
    if (!ok) bad++;
    const shown = found.map((f) => (f.seconds === null ? `${f.value ?? f.count}` : `${f.seconds}`)).slice(0, 4).join(' ');
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(52)} ${String(found.length).padStart(3)} ${shown}`);
  }
  console.log(`  ${cases.length - bad} of ${cases.length} as they should be`);
  failures += bad;
}

// ---- Clicks: hard-clipped and square basses under drums

const sec = 6;
const drums = G.drums(sec);
const bassHz = [41.2, 43.65, 46.2, 49, 55, 61.74, 65.4, 73.4, 82.4, 110];
const clipCases = [];
const saws = new Map(bassHz.map((hz) => [hz, S.saw(hz, sec, 0)]));
for (const hz of bassHz)
  for (const c of [0.3, 0.2, 0.15, 0.1])
    for (const g of [0, -6]) clipCases.push([`saw ${hz} Hz +12 dB clipped at ${c}, ${g} dB, drums`, () => S.mix(drums, S.gain(S.clip(S.gain(saws.get(hz), 12), c), g))]);
for (const hz of [41.2, 55, 73.4, 110])
  for (const a of [0.1, 0.2, 0.5]) {
    clipCases.push([`square ${hz} Hz at ${a}, drums`, () => S.mix(drums, G.square(hz, sec, a))]);
    clipCases.push([`band-limited square ${hz} Hz at ${a}, drums`, () => S.mix(drums, G.limitedSquare(hz, sec, a))]);
  }
for (const hz of [41.2, 55, 73.4]) for (const c of [0.5, 0.35, 0.25]) clipCases.push([`saw ${hz} Hz clipped at ${c}, drums`, () => S.mix(drums, S.clip(saws.get(hz), c))]);
family('Clicks in clipped and square basses under kick, hats and snare (none wanted)', 'click', clipCases);

// Planted clicks in the same material, away from a corner: found to the millisecond
const planted = [];
for (const [hz, c, g] of [[55, 0.2, 0], [46.2, 0.1, -6], [73.4, 0.15, 0], [41.2, 0.3, -6], [110, 0.1, 0], [61.74, 0.2, -6]])
  for (const t of [1.1, 2.3, 3.7, 4.9]) planted.push([`click at ${t} s in saw ${hz} Hz +12 dB clipped at ${c}, ${g} dB, drums`, () => S.mix(drums, S.gain(S.clip(S.gain(saws.get(hz), 12), c), g)), t]);
for (const [hz, a] of [[55, 0.2], [110, 0.5], [41.2, 0.1]]) for (const t of [1.1, 3.7]) planted.push([`click at ${t} s in square ${hz} Hz at ${a}, drums`, () => S.mix(drums, G.square(hz, sec, a)), t]);
for (const t of [1.1, 2.3, 3.7, 4.9]) planted.push([`click at ${t} s in the bed`, () => G.bed(sec), t]);
if (wanted('Planted clicks')) {
  console.log('\nPlanted clicks (4 times the RMS around, away from a corner) in that material');
  let found = 0;
  for (const [name, make, t] of planted) {
    const { x, at } = G.plantAwayFromCorners(make(), t);
    const clicks = kinds(x, 'click');
    const ok = clicks.some((f) => Math.abs(f.seconds - at / SR) <= 0.001);
    if (ok) found++;
    console.log(`  ${ok ? 'found ' : 'missed'} ${name.padEnd(60)} (planted at ${(at / SR).toFixed(4)}; ${clicks.length - (ok ? 1 : 0)} other clicks)`);
    if (clicks.length - (ok ? 1 : 0) > 0) failures++;
  }
  console.log(`  ${found} of ${planted.length} found`);
  if (found < Math.ceil(planted.length * 0.75)) failures++;
}

// ---- Clicks: noise at many levels and seeds

const noise = [];
for (const db of [-6, -18, -40])
  for (let seed = 1; seed <= 8; seed++) {
    noise.push([`white ${db} dB seed ${seed}`, () => S.white(30, db, seed)]);
    noise.push([`pink ${db} dB seed ${seed}`, () => S.pink(30, db, seed)]);
  }
family('Clicks in 30 s of white and pink noise (none wanted)', 'click', noise);

// ---- Hum

const hum = [];
for (const rate of [2, 4, 5, 6, 8, 8.33, 10, 12]) {
  hum.push([`55 Hz sine kick, ${rate} a second`, () => G.kickLoop(rate, 10, { hz: 55, decayMs: 150, peak: 0.8 })]);
  hum.push([`kick dropping 110 to 45 Hz, ${rate} a second`, () => G.kickLoop(rate, 10, { hz: 110, toHz: 45, decayMs: 150, peak: 0.8 })]);
}
for (const hz of [50, 60]) {
  hum.push([`a sub at ${hz} Hz for 6 of 10 s`, () => S.at(10, [[2, G.fade(S.sine(hz, 6, -6))]])]);
  hum.push([`a sub at ${hz} Hz for 6 of 10 s over pink`, () => S.mix(S.pink(10, -30, 5), S.at(10, [[2, G.fade(S.saw(hz, 6, -6))]]))]);
}
hum.push(['a note at 61.74 Hz for 2 of 10 s', () => S.mix(S.pink(10, -18, 1), S.at(10, [[3, S.sine(61.74, 2, -12)]]))]);
hum.push(['a held saw at 61.74 Hz', () => S.mix(S.pink(10, -24, 2), S.saw(61.74, 10, -6))]);
hum.push(['a wobble at 49 Hz', () => S.mix(S.pink(10, -24, 2), S.wobble(49, 80, 1500, 2, 10, -6))]);
hum.push(['a saw at 55 Hz clipped', () => S.clip(S.saw(55, 10, 0), 0.5)]);
const is = (hz) => (f) => f.length === 1 && f[0].value === hz;
hum.push(['hum: 60 Hz with 120 Hz over pink (the brief)', () => G.hum60(10), is(60)]);
hum.push(['hum: 50 Hz with 100 and 150 Hz over pink', () => G.hum50(10), is(50)]);
hum.push(['hum: 60 Hz under kick and hats', () => S.mix(G.hum60(10), G.kickAndHats(10)), is(60)]);
hum.push(['hum: 50 Hz under kick and hats', () => S.mix(G.hum50(10), G.kickAndHats(10)), is(50)]);
family('Hum', 'hum', hum);

// ---- DC

const dc = [];
for (const phase of ['sine', 'cosine'])
  for (const tailMs of [100, 250])
    for (const drop of [false, true])
      for (const rate of [1, 2, 3, 4.33, 5, 8])
        dc.push([`${phase}-phase kick, ${tailMs} ms tail${drop ? ', pitch drop' : ''}, ${rate} a second`, () => G.kickLoop(rate, 8, { hz: drop ? 110 : 55, toHz: drop ? 45 : undefined, decayMs: tailMs, peak: 0.8, cosine: phase === 'cosine' })]);
const within = (db) => (f) => f.length === 1 && Math.abs(f[0].value - db) <= 0.5;
dc.push(['the bed + 0.01', () => G.bed(4).map((v) => v + 0.01), within(-40)]);
dc.push(['the bed + 0.01 under a kick loop', () => S.mix(G.bed(8), G.kickLoop(2, 8, { hz: 55, decayMs: 150, peak: 0.8 })).map((v) => v + 0.01), within(-40)]);
// Pink's own slow wander adds to an offset this small, so its value is checked against the signal's own mean
const meanDb = (x) => 20 * Math.log10(Math.abs(x.reduce((a, v) => a + v, 0) / x.length));
const pinkDc = (seed) => S.pink(8, -40, seed).map((v) => v + 0.005);
dc.push(['quiet pink at -40 dB + 0.005 (seed 1)', () => pinkDc(1), within(meanDb(pinkDc(1)))]);
dc.push(['the bed - 0.01', () => G.bed(4).map((v) => v - 0.01), within(-40)]);
family('DC', 'dc', dc);
if (wanted('DC offsets on quiet pink')) {
  let found = 0;
  const values = [];
  for (let seed = 1; seed <= 12; seed++) {
    const x = pinkDc(seed);
    const f = kinds(x, 'dc');
    if (f.length === 1 && Math.abs(f[0].value - meanDb(x)) <= 0.5) found++;
    values.push(f.length ? f[0].value : '-');
  }
  console.log(`\nDC offsets on quiet pink: 0.005 on -40 dB pink, seeds 1 to 12: ${found} of 12 found (${values.join(' ')})`);
  if (found < 10) failures++;
}

console.log(failures === 0 ? '\nAll as they should be.' : `\n${failures} not as they should be.`);
process.exit(failures === 0 ? 0 : 1);
