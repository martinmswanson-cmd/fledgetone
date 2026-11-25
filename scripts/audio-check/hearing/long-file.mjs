// How long hearSound (src/audio/hearing/hearSound.ts) takes and how much memory it uses on long files:
// 240 s and 900 s of stereo made sound (a saw bass under noise) at 48000. Not a test; prints seconds taken
// and memory, first for the space and register groups alone (spaceOf and registerOf, before the whole
// report), then for the whole report. Targets: 240 s under 45 s; the two groups on 240 s under 15 s
// together, raising the peak memory by under 200 MB; 900 s finishes under Node's default heap.
// Run with `node scripts/audio-check/hearing/long-file.mjs`; pass a number of seconds to run only that length.
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

const { hearSound } = await import('../../../src/audio/hearing/hearSound.ts');
const { spaceOf } = await import('../../../src/audio/hearing/space.ts');
const { registerOf } = await import('../../../src/audio/hearing/register.ts');

const SR = 48000;
const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
/** The most memory the process has held so far, bytes. */
const peak = () => process.resourceUsage().maxRSS * 1024;

/** One channel of `seconds`: a 55 Hz saw gated four times a second, under noise from `seed`; built a second at a time. */
function made(seconds, seed) {
  const out = new Float32Array(Math.round(seconds * SR));
  let state = seed;
  for (let i = 0; i < out.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const noise = (state / 4294967296 - 0.5) * 0.1;
    const saw = 2 * ((i * 55) / SR - Math.floor((i * 55) / SR + 0.5));
    const gate = ((i * 4) / SR) % 1 < 0.6 ? 1 : 0.2;
    out[i] = 0.4 * saw * gate + noise;
  }
  return out;
}

const only = Number(process.argv[2]);
let failed = false;
for (const seconds of [240, 900]) {
  if (only && only !== seconds) continue;
  const channels = [made(seconds, 1), made(seconds, 2)];
  // The two groups alone, first, so the peak they reach is theirs and not the whole report's
  const groupsFrom = Math.max(peak(), process.memoryUsage().rss);
  const t0 = performance.now();
  spaceOf(channels, SR, 120);
  const t1 = performance.now();
  registerOf(channels, SR);
  const t2 = performance.now();
  const [spaceSeconds, registerSeconds] = [(t1 - t0) / 1000, (t2 - t1) / 1000];
  const groupsRise = Math.max(0, peak() - groupsFrom);
  const groupsOk = seconds !== 240 || (spaceSeconds + registerSeconds < 15 && groupsRise < 200 * 1048576);
  if (!groupsOk) failed = true;
  console.log(
    `${seconds} s, space and register: ${spaceSeconds.toFixed(1)} s and ${registerSeconds.toFixed(1)} s, ${(spaceSeconds + registerSeconds).toFixed(1)} s together, peak raised ${mb(groupsRise)}${seconds === 240 ? ' (target under 15 s and 200 MB)' : ''} ${groupsOk ? 'ok' : 'FAILED'}`
  );
  const before = process.memoryUsage().rss;
  const start = performance.now();
  const report = hearSound(channels, SR, { engine: 'long-file', tempoBpm: 120 });
  const taken = (performance.now() - start) / 1000;
  const after = process.memoryUsage().rss;
  const limit = seconds === 240 ? 45 : Infinity;
  const ok = taken < limit && Number.isFinite(report.seconds);
  if (!ok) failed = true;
  console.log(
    `${seconds} s: ${taken.toFixed(1)} s taken${limit < Infinity ? ` (target under ${limit})` : ''}, rss ${mb(before)} before, ${mb(after)} after, peak (max rss so far) ${mb(peak())}; ${report.along.mid.length} along rows, ${report.words.length} words ${ok ? 'ok' : 'FAILED'}`
  );
}
process.exit(failed ? 1 : 0);
