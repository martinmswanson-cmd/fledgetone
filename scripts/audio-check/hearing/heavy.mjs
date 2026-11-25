// The reading check's heavy test song: 16 bars at 140 bpm in E minor from the app's own synths (a
// synthesized techno kit, a distorted wobble bass, an analog lead and a glide pad), with the master
// pushed hard into its limiter. No recorded instruments, so it renders offline. Built with the
// starters' own helpers (src/store/starterKit.ts) and written as a song file.
// Run with `node scripts/audio-check/hearing/heavy.mjs <out.fledgetone.json>`.
import { register } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';

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

const { clip, D, master, progression, project, track } = await import('../../../src/store/starterKit.ts');
const { everyBar } = await import('../../../src/store/demoSong.ts');
const { serializeProject } = await import('../../../src/store/project.ts');
const { withStableIds } = await import('../../../src/store/timelineTypes.ts');

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/audio-check/hearing/heavy.mjs <out.fledgetone.json>');
  process.exit(2);
}
if (existsSync(out)) {
  console.error(`${out} already exists: give another file`);
  process.exit(2);
}

// Stable ids (track-heavy-1 and so on), as the starters have, so an ops file can name a track.
const song = withStableIds('heavy', () => {
  const drums = track('Drums', 'technoKit', { volume: -2 });
  const bass = track('Wobble Bass', 'wobbleBass', { volume: -4, fx: { distortion: { on: true, amount: 0.6 } } });
  const lead = track('Lead', 'lead', { volume: -8, delaySend: 0.15 });
  const pad = track('Pad', 'glidePad', { volume: -10, reverbSend: 0.3 });

  /** Kick on every beat, clap on 2 and 4, closed hats on the off-beats, an open hat to end each 4 bars. */
  const beat = everyBar(4, (b) => [
    ...[0, 4, 8, 12].map((s) => [s, D.kick, 0.95]),
    ...[4, 12].map((s) => [s, D.clap, 0.85]),
    ...[2, 6, 10, b === 3 ? null : 14].filter((s) => s !== null).map((s) => [s, D.closedHat, 0.6]),
    ...(b === 3 ? [[14, D.openHat, 0.6]] : []),
  ]);
  /** The bass holds each bar's root, wobbling in 8th notes. */
  const roots = ['E1', 'E1', 'C2', 'D2'];
  const bassLine = roots.map((n, i) => [i * 16, n, 0.9, '1m']);
  const chords = progression([['E3', 'G3', 'B3'], ['E3', 'G3', 'B3'], ['C3', 'E3', 'G3'], ['D3', 'F#3', 'A3']], 16, '1m', 0.6);
  const melody = [
    [0, 'B4', 0.8, '8n'], [2, 'D5', 0.8, '8n'], [4, 'E5', 0.85, '4n'], [10, 'D5', 0.75, '8n'], [12, 'B4', 0.8, '4n'],
    [16, 'G4', 0.8, '8n'], [18, 'A4', 0.8, '8n'], [20, 'B4', 0.85, '2n'],
    [32, 'C5', 0.8, '8n'], [34, 'B4', 0.8, '8n'], [36, 'G4', 0.8, '4n'], [42, 'E4', 0.75, '8n'], [44, 'G4', 0.8, '4n'],
    [48, 'F#4', 0.8, '8n'], [50, 'A4', 0.8, '8n'], [52, 'D5', 0.85, '2n'],
  ];

  return project(
    'Hearing check: heavy',
    140,
    0,
    [1, 17],
    [drums, bass, lead, pad],
    [
      clip(drums, 'Beat', 1, 4, beat, 4),
      clip(bass, 'Wobble', 1, 4, bassLine, 4, '1/8'),
      clip(pad, 'Chords', 1, 4, chords, 4),
      clip(lead, 'Theme', 9, 4, melody, 2),
    ],
    [
      [1, 'Build'],
      [9, 'Drop'],
    ],
    // the Level pushed 12 dB into the limiter, with the punchy glue in front of it
    { ...master({}, {}, 'punchy'), level: 12 }
  );
});

writeFileSync(out, JSON.stringify(serializeProject(song), null, 2) + '\n', { flag: 'wx' });
console.log(`Wrote ${out}: 16 bars at 140 bpm.`);
