// "Does it hit?" for any WAV: the measurements of src/audio/hitCheck.ts, judged against a style's
// targets (src/audio/hitTargets.ts) when one is given.
//
//   node scripts/audio-check/hit-check.mjs song.wav --bpm 140 [--style dubstep] [--from 32 --to 64]
//        [--grid 32.05] [--onsets onsets.json] [--bass bass.wav] [--json]
//
// --from/--to pick a stretch (seconds), --grid a downbeat time (found from the onsets when not
// given), --onsets a JSON file of {"kicks": [s...], "snares": [s...]} for the drum measures
// (sidechain, sub ducking, how far the kick and snare poke out), --bass a render of the same
// stretch with only the bass parts (the bass movement is then read from it). --json prints the
// raw report.
// --styles lists the styles. Reads 16-, 24- and 32-bit PCM and 32-bit float WAVs.
import { register } from 'node:module';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`),
);

/** A WAV file's channels as Float32Arrays, and its sample rate. */
export function readWav(path) {
  const buf = fs.readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`);
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    let size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
      if (fmt.format === 0xfffe) fmt.format = buf.readUInt16LE(body + 24);
    } else if (id === 'data' && fmt) {
      size = Math.min(size, buf.length - body);
      const bytes = fmt.bits / 8;
      const frames = Math.floor(size / (bytes * fmt.channels));
      const out = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < fmt.channels; c++) {
          const p = body + (i * fmt.channels + c) * bytes;
          let v;
          if (fmt.format === 3) v = bytes === 4 ? buf.readFloatLE(p) : buf.readDoubleLE(p);
          else if (bytes === 2) v = buf.readInt16LE(p) / 32768;
          else if (bytes === 3) v = buf.readIntLE(p, 3) / 8388608;
          else if (bytes === 4) v = buf.readInt32LE(p) / 2147483648;
          else v = (buf[p] - 128) / 128;
          out[c][i] = v;
        }
      }
      return { channels: out, sampleRate: fmt.sampleRate };
    }
    at = body + size + (size & 1);
  }
  throw new Error(`${path} has no audio data`);
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

/** The report as text lines. */
export function formatReport(r) {
  const L = r.loudness;
  const out = [];
  out.push(`${r.seconds.toFixed(1)} s at ${r.bpm} BPM, grid from ${r.gridStart.toFixed(3)} s`);
  out.push(`Loudness: integrated ${f1(L.integrated)} LUFS, short-term mean ${f1(L.shortTermMean)} max ${f1(L.shortTermMax)}, true peak ${f1(L.truePeak)} dBTP, crest ${f1(L.crest)} dB`);
  out.push('Bands (dB of the mix, sides/middle dB, L-R correlation):');
  for (const b of r.bands) out.push(`  ${b.id.padEnd(9)} ${f1(b.db).padStart(6)}   S/M ${f1(b.sideToMid).padStart(6)}   corr ${f2(b.corr)}`);
  const S = r.sustain;
  out.push(
    `Sustain: frames under RMS-6 ${f1(S.below6)}%, -12 ${f1(S.below12)}%, -20 ${f1(S.below20)}% | swing per 16th ${f1(S.swing16)} dB, per beat ${f1(S.swingBeat)} dB | quietest 10% ${f1(S.quietFloor)} dB${S.afterHits !== undefined ? ` | 60 ms+ after hits ${f1(S.afterHits)} dB` : ''}`,
  );
  const move = (M, what) => [
    `Bass movement (100 Hz-4 kHz, ${what}): ${M.kind}; centroid ${Math.round(M.centroidHz)} Hz, jump ${f2(M.jump)} oct per 16th, ${f1(M.over025)}% > 0.25 oct, ${f1(M.over05)}% > 0.5 oct`,
    `  top rate ${f2(M.topRateCyclesPerBeat)} per beat holds ${f1(M.topRateShare)}% | autocorr 1/16 ${f2(M.ac16)}, 1/8 ${f2(M.ac8)}, 1/4 ${f2(M.acBeat)}, 1/2 ${f2(M.acHalfBar)}, bar ${f2(M.acBar)}, 2 bars ${f2(M.ac2Bar)}`,
  ];
  out.push(...move(r.movement, r.movementOf === 'bass' ? 'the bass parts alone' : 'the mix'));
  if (r.mixMovement) out.push(...move(r.mixMovement, 'the mix'));
  out.push(`Pump (250 Hz-4 kHz through the beat): dips ${f1(r.pump.dip)} dB under where it comes back to (${f1(r.pump.depth)} under its top) at ${r.pump.atMs} ms | ${r.pump.profile.map(f1).join(' ')}`);
  if (r.drums) {
    const D = r.drums;
    out.push(
      `Drums: ${D.kicks} kicks, ${D.snares} snares | K-weighted peaks kick ${f1(D.kickPeak)} dB, snare ${f1(D.snarePeak)} dB (over the mix: ${f1(D.kickOverMix)}, ${f1(D.snareOverMix)}) | mids dip after kick ${f1(D.sidechain)} dB at ${D.sidechainAtMs} ms | sub after snare ${f1(D.subDuck)} dB`,
    );
    for (const [k, v] of Object.entries(D.curves)) out.push(`  ${k.padEnd(16)} ${v.map((x) => f1(x).padStart(5)).join(' ')}`);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const { hitCheck } = await import('../../src/audio/hitCheck.ts');
  const T = await import('../../src/audio/hitTargets.ts');
  if (args.includes('--styles')) {
    for (const s of T.HIT_STYLES) console.log(`${s.id.padEnd(12)} ${s.name}`);
    return;
  }
  const valued = new Set(['--bpm', '--style', '--from', '--to', '--grid', '--onsets', '--bass']);
  const file = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  if (!file) {
    console.log('usage: node scripts/audio-check/hit-check.mjs <wav> [--bpm N] [--style X] [--from s --to s] [--grid s] [--onsets file.json] [--bass bass.wav] [--json] [--styles]');
    process.exit(1);
  }
  const { channels, sampleRate } = readWav(file);
  const onsets = opt('onsets') ? JSON.parse(fs.readFileSync(opt('onsets'), 'utf8')) : {};
  const num = (v) => (v === undefined ? undefined : Number(v));
  const started = Date.now();
  const report = hitCheck({ channels, sampleRate, bpm: num(opt('bpm')) ?? 120, start: num(opt('from')), end: num(opt('to')), gridStart: num(opt('grid')), kicks: onsets.kicks, snares: onsets.snares, bassChannels: opt('bass') ? readWav(opt('bass')).channels : undefined });
  const took = Date.now() - started;
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  console.log(`== ${file}`);
  for (const line of formatReport(report)) console.log(line);
  const style = opt('style');
  if (style) {
    const s = T.styleById(style);
    console.log(`\nAgainst ${s.name}:`);
    for (const j of T.judgeHits(report, s.id)) {
      const mark = j.status === 'ok' ? 'ok  ' : j.status === 'na' ? '--  ' : j.status === 'low' ? 'LOW ' : 'HIGH';
      console.log(`  ${mark} ${j.label.padEnd(30)} ${j.shown.padStart(10)}   target ${j.targetShown}${j.status === 'low' || j.status === 'high' ? `\n         ${j.advice}` : ''}`);
    }
  }
  console.log(`(measured in ${took} ms)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
