// The hearing report's pictures of a made song, for looking at by eye (src/audio/hearing/pictures.ts,
// hearingOf.ts): 16 bars at 140 bpm of stereo sound built from scripts/fixtures/hearingSignals.mjs (a kick
// on each beat, hats on the off-beats a little to the left, a wobble bass at 1/8 notes for 8 bars then
// 1/16, a band of noise sweeping upward over the last 4 bars, one click at bar 11 beat 3, bar 13 silent).
// Writes every picture as <name>.png, index.txt (each picture's name and what it shows), and difference.png
// (the same sound against itself with 2 to 4 kHz 6 dB louder in bars 5 to 8 only). Not a test.
// Run with `node scripts/audio-check/hearing/picture-sheet.mjs <outDir>`.
import { register } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

const { hearingOf } = await import('../../../src/audio/hearing/hearingOf.ts');
const P = await import('../../../src/audio/hearing/pictures.ts');
const { encodePng } = await import('../../../src/audio/hearing/png.ts');
const S = await import('../../fixtures/hearingSignals.mjs');

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/audio-check/hearing/picture-sheet.mjs <outDir>'); process.exit(1); }
mkdirSync(out, { recursive: true });

const SR = 48000;
const BPM = 140;
const beat = 60 / BPM;
const barSeconds = 4 * beat;
const seconds = 16 * barSeconds;
const bars = Array.from({ length: 16 }, (_, i) => ({ bar: i + 1, start: i * barSeconds, end: (i + 1) * barSeconds, beats: 4 }));
const n = Math.round(seconds * SR);
const barStart = (bar) => (bar - 1) * barSeconds;

// a kick on each beat: a falling-pitch sine thump with a short noise tick on top
const kickOne = (() => {
  const len = Math.round(0.4 * SR); const x = new Float32Array(len); let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR; phase += (2 * Math.PI * (45 + 110 * Math.exp(-t / 0.03))) / SR;
    x[i] = 0.45 * Math.sin(phase) * Math.exp(-t / 0.1) * Math.min(1, (len - i) / (0.03 * SR)); // faded out, so its end is no click
  }
  return S.mix(x, S.gain(S.band(S.burst(0.02, 3, 0, 0, 7), 1500, 6000), -16));
})();
const kick = S.at(seconds, Array.from({ length: 64 }, (_, i) => [i * beat, kickOne]));
// hats on the off-beats, a little to the left
const hatOne = S.band(S.burst(0.06, 12, 0, -14, 3), 7000, 16000);
const hats = S.at(seconds, Array.from({ length: 64 }, (_, i) => [i * beat + beat / 2, hatOne]));
// the wobble bass: 1/8 notes for 8 bars, then 1/16
const eighth = (BPM / 60) * 2;
const wobble = S.at(seconds, [[0, S.wobble(55, 90, 1800, eighth, 8 * barSeconds, -12)], [8 * barSeconds, S.wobble(55, 90, 1800, eighth * 2, 8 * barSeconds, -12)]]);
// a band of noise sweeping up from 400 Hz to 10 kHz over the last 4 bars (a band-pass whose centre moves)
const sweep = (() => {
  const start = barStart(13); const len = Math.round(4 * barSeconds * SR); const noise = S.white(4 * barSeconds, -6, 5);
  const x = new Float32Array(len); let s1 = 0, s2 = 0; const k = 1 / 3; // Q 3
  for (let i = 0; i < len; i++) {
    const fc = 400 * (10000 / 400) ** (i / len); const g = Math.tan((Math.PI * fc) / SR);
    const hp = (noise[i] - (g + k) * s1 - s2) / (1 + g * (g + k)); const bp = g * hp + s1; s1 = g * hp + bp; s2 = g * bp + (g * bp + s2);
    x[i] = bp * 0.25 * Math.min(1, i / (0.05 * SR));
  }
  return S.at(seconds, [[start, x]]);
})();

const left = S.mix(kick, S.gain(hats, 0), wobble, sweep);
const right = S.mix(kick, S.gain(hats, -6), wobble, sweep);
// one click at bar 11 beat 3, in both channels
const click = Math.round((barStart(11) + 2 * beat) * SR);
left[click] += 0.6; right[click] += 0.6;
// bar 13 silent
for (let i = Math.round(barStart(13) * SR); i < Math.round(barStart(14) * SR); i++) left[i] = right[i] = 0;
for (const c of [left, right]) for (let i = 0; i < n; i++) c[i] = Math.max(-1, Math.min(1, c[i]));

const started = performance.now();
const h = hearingOf([left, right], SR, { engine: 'picture-sheet', tempoBpm: BPM, bars, pictures: true });
const taken = (performance.now() - started) / 1000;
const lines = [];
for (const p of h.pictures) {
  writeFileSync(join(out, `${p.name}.png`), await encodePng(p.raster));
  lines.push(`${p.name}: ${p.shows}`);
}

// the difference: the same sound with 2 to 4 kHz 6 dB louder in bars 5 to 8 only
const mid = P.middleOf(left, right);
const extra = S.band(mid, 2000, 4000, SR);
const boost = 10 ** (6 / 20) - 1;
const after = Float32Array.from(mid);
const b0 = Math.round(barStart(5) * SR), b1 = Math.round(barStart(9) * SR), edge = Math.round(0.005 * SR);
for (let i = b0; i < b1; i++) { const g = Math.min(1, (i - b0) / edge, (b1 - i) / edge); after[i] += extra[i] * boost * g; }
const diff = P.differencePicture(mid, after, SR, P.axisFor(0, seconds, bars), 'difference');
writeFileSync(join(out, 'difference.png'), await encodePng(diff.raster));
lines.push(`difference: ${diff.shows}`);

writeFileSync(join(out, 'index.txt'), lines.join('\n\n') + '\n');
console.log(`wrote ${h.pictures.length + 1} pictures to ${out} (hearingOf with pictures took ${taken.toFixed(1)} s)`);
console.log(`faults the report found: ${h.sound.faults.map((f) => `${f.kind} at ${f.seconds ?? 'no one time'}${f.at?.bar ? ` (bar ${f.at.bar}, beat ${f.at.beat})` : ''}`).join('; ') || 'none'}`);
