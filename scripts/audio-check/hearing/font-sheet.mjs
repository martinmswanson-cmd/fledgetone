// A picture for looking at the hearing report's pixel font and colour ramps (src/audio/hearing/raster.ts,
// font5x7.ts): all 95 glyphs at scale 1 and 2 in rows of 32, sample axis labels, and the HEAT and DIVERGING
// ramps as bars with their names. Not a test; writes one PNG to the path given as the first argument.
// Run with `node scripts/audio-check/hearing/font-sheet.mjs /path/to/font-sheet.png`.
import { register } from 'node:module';
import { writeFileSync } from 'node:fs';

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

const R = await import('../../../src/audio/hearing/raster.ts');
const { encodePng } = await import('../../../src/audio/hearing/png.ts');

const out = process.argv[2];
if (!out) { console.error('usage: node scripts/audio-check/hearing/font-sheet.mjs <output.png>'); process.exit(1); }

const r = R.raster(820, 330, R.PAPER);
const chars = []; for (let c = 32; c < 127; c++) chars.push(String.fromCharCode(c));
let y = 6;
for (const scale of [1, 2]) {
  for (let row = 0; row < chars.length; row += 32) { R.text(r, chars.slice(row, row + 32).join(''), 8, y, R.INK, scale); y += 7 * scale + 5; }
  y += 6;
}
R.line(r, 8, y, 811, y, R.GRID); y += 8;
R.text(r, '20 Hz  100  1 kHz  10 kHz   -60 dB  0 dB   bar 9, beat 3   0:12.5', 8, y, R.INK); y += 16;
R.text(r, '20 Hz  100  1 kHz  10 kHz   -60 dB  0 dB   bar 9, beat 3   0:12.5', 8, y, R.INK, 2); y += 26;
for (const [name, stops] of [['HEAT', R.HEAT], ['DIVERGING', R.DIVERGING]]) {
  R.text(r, name, 8, y + 3, R.INK);
  for (let x = 0; x < 600; x++) R.fillRect(r, 80 + x, y, 1, 14, R.ramp(stops, x / 599));
  y += 22;
}
writeFileSync(out, await encodePng(r));
console.log(`wrote ${out} (${r.width} by ${r.height})`);
