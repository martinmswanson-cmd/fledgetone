// Unit tests for the heavy bass tools: the distortion curves, the 808 designer's settings, the Sub
// enhancer, glide and Bass Drive settings, the kick clash check, and saving them. Run with `npm test`.
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
const { DRIVE_CHARACTERS, shape, driveCurveFor, driveMakeup } = await import('../src/audio/driveCurves.ts');
const { defaultBass808, bass808Preset, BASS808_PRESETS, normalizeBass808, tuneNote } = await import('../src/store/bass808.ts');
const { subFrequency, normalizeSubLayer, normalizeBassDrive, parseBassFields, SUB_FLOOR_HZ } = await import('../src/store/bassTools.ts');
const { findKickClash, KICK_DUCK } = await import('../src/store/kickClash.ts');
const { serializeProject, parseProject } = await import('../src/store/project.ts');
const { defaultTrackFx, normalizeTrackFx } = await import('../src/store/timelineTypes.ts');
const { compensateTracks, BASS_DRIVE_FRAMES } = await import('../src/audio/delayCompensation.ts');

const track = (id, instrumentKey, extra = {}) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, ...extra });

test('every distortion curve keeps silence silent, is odd (no DC), and stays within -1..1', () => {
  for (const c of DRIVE_CHARACTERS) {
    for (const drive of [0, 0.3, 0.7, 1]) {
      assert.equal(Math.abs(shape(0, c, drive)), 0, `${c} ${drive} at 0`);
      for (let x = -1; x <= 1; x += 0.01) {
        const y = shape(x, c, drive);
        assert.ok(Math.abs(y) <= 1 + 1e-9, `${c} ${drive} bounded at ${x}`);
        assert.ok(Math.abs(y + shape(-x, c, drive)) < 1e-9, `${c} ${drive} odd at ${x}`);
      }
      const curve = driveCurveFor(c, drive);
      assert.equal(curve.length % 2, 1, 'an odd number of points puts 0 on a point');
      assert.equal(Math.abs(curve[(curve.length - 1) / 2]), 0);
    }
  }
});

test("turning the drive up adds harmonics, not much level (the makeup brings the RMS back)", () => {
  for (const c of ['tube', 'hard', 'fold']) {
    for (const drive of [0.2, 0.6, 1]) {
      const g = driveMakeup(c, drive, 0.5);
      let inSq = 0;
      let outSq = 0;
      for (let i = 0; i < 512; i++) {
        const x = 0.5 * Math.sin((2 * Math.PI * (i + 0.5)) / 512);
        inSq += x * x;
        outSq += (g * shape(x, c, drive)) ** 2;
      }
      assert.ok(Math.abs(10 * Math.log10(outSq / inSq)) < 0.5, `${c} ${drive}`);
    }
  }
});

test('808 presets are complete and in range, and named by sound', () => {
  assert.ok(BASS808_PRESETS.length >= 6);
  for (const p of BASS808_PRESETS) {
    const s = bass808Preset(p.name);
    assert.deepEqual(normalizeBass808(s), s, p.name);
  }
  assert.deepEqual(bass808Preset('nope'), defaultBass808());
});

test('808 settings from a file are repaired: out of range clamped, junk dropped, a bad key left off', () => {
  const s = normalizeBass808({ drive: 9, character: 'laser', tone: 5, punch: -3, glide: 'x', tuneToKey: { root: 4, scale: 'nope' } });
  assert.equal(s.drive, 1);
  assert.equal(s.character, 'tube');
  assert.equal(s.tone, 200);
  assert.equal(s.punch, 0);
  assert.equal(s.glide, defaultBass808().glide);
  assert.equal(s.tuneToKey, undefined);
  assert.equal(normalizeBass808('808'), undefined);
  assert.deepEqual(normalizeBass808({ tuneToKey: { root: 2.2, scale: 'minor' } }).tuneToKey, { root: 2, scale: 'minor' });
});

test('tune to key snaps each note to the nearest note of the key, and leaves notes in it alone', () => {
  const key = { tuneToKey: { root: 9, scale: 'minor' } }; // A minor
  assert.equal(tuneNote('A1', key), 'A1');
  assert.equal(tuneNote('C#2', key), 'D2');
  assert.equal(tuneNote('G#1', key), 'A1');
  assert.equal(tuneNote('F#1', { tuneToKey: { root: 0, scale: 'major' } }), 'G1');
  assert.equal(tuneNote('F#1', {}), 'F#1');
});

test('the Sub enhancer goes an octave down unless that would be below hearing', () => {
  assert.equal(subFrequency(110, 'octave'), 55);
  assert.equal(subFrequency(110, 'fundamental'), 110);
  assert.equal(subFrequency(41.2, 'octave'), 41.2);
  assert.ok(subFrequency(60, 'octave') >= SUB_FLOOR_HZ);
  assert.deepEqual(normalizeSubLayer({ mode: 'x', level: 3, decay: -1 }), { mode: 'octave', level: 1, decay: 0 });
});

test('Bass Drive settings are repaired, kept only where a file has them, and counted by delay compensation', () => {
  assert.equal(normalizeTrackFx({}).bassDrive, undefined);
  const fx = normalizeTrackFx({ bassDrive: { on: true, crossover: 5000, drive: 0.4, character: 'fold', mix: 2 } });
  assert.deepEqual(fx.bassDrive, { on: true, crossover: 300, drive: 0.4, character: 'fold', mix: 1, tone: 7000 });
  assert.equal(normalizeBassDrive(null), undefined);
  const plain = track('a', 'subBass');
  const driven = track('b', 'reeseBass', { fx: { ...defaultTrackFx(), bassDrive: fx.bassDrive } });
  const { total, delays } = compensateTracks([plain, driven], 100);
  assert.equal(total, BASS_DRIVE_FRAMES);
  assert.equal(delays.get('a').tail, BASS_DRIVE_FRAMES);
  assert.equal(delays.get('b'), undefined);
});

test('the bass fields survive saving and opening; older files open without them', () => {
  const t = track('808', 'bass808', { bass808: bass808Preset('Drill slide'), subLayer: { mode: 'fundamental', level: 0.3, decay: 1 } });
  const lead = track('lead', 'lead', { glide: 0.12, fx: { ...defaultTrackFx(), bassDrive: { on: true, crossover: 150, drive: 0.7, character: 'hard', mix: 0.8, tone: 5000 } } });
  const p = { name: 'Bass', bpm: 140, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [t, lead, track('old', 'bass808')], clips: [] };
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject(p))));
  assert.deepEqual(back.tracks[0].bass808, t.bass808);
  assert.deepEqual(back.tracks[0].subLayer, t.subLayer);
  assert.equal(back.tracks[1].glide, 0.12);
  assert.deepEqual(back.tracks[1].fx.bassDrive, lead.fx.bassDrive);
  assert.equal(back.tracks[2].bass808, undefined);
  assert.equal(back.tracks[2].glide, undefined);
  assert.equal(back.tracks[2].fx.bassDrive, undefined);
  assert.deepEqual(parseBassFields({ glide: 7 }), { glide: 1 });
});

test('the kick clash check finds kicks on low 808 notes, and the duck clears the warning', () => {
  const drums = track('d', 'drumMachine');
  const bass = track('b', 'bass808');
  const kicks = [0, 0.25, 0.5, 0.75].map((at, i) => ({ id: `k${i}`, note: 'C1', startOffset: at, duration: '16n', velocity: 1 }));
  const notes = [
    { id: 'n1', note: 'F1', startOffset: 0, duration: '4n', velocity: 1 },
    // Rings over the kick at 0.25
    { id: 'n2', note: 'F1', startOffset: 0.125, duration: '4n', velocity: 1 },
    // High enough not to mask
    { id: 'n3', note: 'C4', startOffset: 0.5, duration: '8n', velocity: 1 },
  ];
  const clips = [
    { id: 'c1', trackId: 'd', name: 'Beat', startBar: 1, lengthBars: 1, notes: kicks },
    { id: 'c2', trackId: 'b', name: '808', startBar: 1, lengthBars: 1, notes },
  ];
  const clash = findKickClash([drums, bass], clips, 'b');
  assert.deepEqual(clash, { kicks: 4, together: 1, under: 1, ducked: false });
  const ducked = { ...bass, fx: { ...bass.fx, pump: { ...bass.fx.pump, ...KICK_DUCK } } };
  assert.equal(findKickClash([drums, ducked], clips, 'b').ducked, true);
  // A muted kit's kicks don't count
  assert.equal(findKickClash([{ ...drums, isMuted: true }, bass], clips, 'b').kicks, 0);
});
