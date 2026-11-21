// Unit tests for the hearing report's pictures (src/audio/hearing/pictures.ts) and for hearingOf, which
// makes the sound report and its set of pictures together (src/audio/hearing/hearingOf.ts), on made
// signals. Run with `npm test`.
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

const P = await import('../src/audio/hearing/pictures.ts');
const R = await import('../src/audio/hearing/raster.ts');
const { hearingOf, parseSavedHearing, detailRanges } = await import('../src/audio/hearing/hearingOf.ts');
const S = await import('./fixtures/hearingSignals.mjs');

const near = (a, b, tol, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what} ${a} is not within ${tol} of ${b}`);

const rowBrightness = (p) => Array.from({ length: P.PICTURE.bottom - P.PICTURE.top }, (_, i) => { let s = 0; for (let x = P.PICTURE.left; x < P.PICTURE.right; x += 7) s += R.pixel(p.raster, x, P.PICTURE.top + i).reduce((a, b) => a + b); return s; });
const colBrightness = (p) => Array.from({ length: P.PICTURE.right - P.PICTURE.left }, (_, i) => { let s = 0; for (let y = P.PICTURE.top; y < P.PICTURE.bottom; y += 5) s += R.pixel(p.raster, P.PICTURE.left + i, y).reduce((a, b) => a + b); return s; });
const argmax = (a) => a.indexOf(Math.max(...a));
/** The dB a HEAT colour stands for, by searching the ramp for the nearest colour. */
const dbOfHeat = (c) => {
  let best = 0, bestD = Infinity;
  for (let i = 0; i <= 9000; i++) {
    const t = i / 9000; const r = R.ramp(R.HEAT, t); const d = r.reduce((s, v, k) => s + Math.abs(v - c[k]), 0);
    if (d < bestD) { bestD = d; best = t; }
  }
  return P.LEVEL_DB.floor + best * (P.LEVEL_DB.top - P.LEVEL_DB.floor);
};
const same = (a, b) => a.every((v, i) => v === b[i]);

test('a sine is a bright line at its frequency', () => {
  const p = P.spectrogramPicture(S.sine(1000, 2, -6), 48000, P.axisFor(0, 2), { name: 'spectrogram', title: 't' });
  assert.ok(Math.abs(Math.log2(P.hzOfY(P.PICTURE.top + argmax(rowBrightness(p))) / 1000)) < 0.09);
  assert.equal(p.width, 1500); assert.equal(p.height, 700); assert.equal(p.kind, 'spectrogram');
});
test('a click is a bright column at its time', () => {
  const x = S.sine(200, 2, -40); x[48000] = 1; const axis = P.axisFor(0, 2);
  const p = P.spectrogramPicture(x, 48000, axis, { name: 's', title: 't' });
  assert.ok(Math.abs(P.PICTURE.left + argmax(colBrightness(p)) - P.xOfSeconds(1.0, axis)) <= 3);
});
test('the frequency scale runs from 20 Hz to 20 kHz', () => { near(P.hzOfY(P.PICTURE.bottom), 20, 0.5); near(P.hzOfY(P.PICTURE.top), 20000, 300); near(P.hzOfY(P.yOfHz(440)), 440, 1); });
test('a bar axis is labelled in bars, a plain one in time', () => {
  const bars = Array.from({ length: 8 }, (_, i) => ({ bar: 9 + i, start: i * 2, end: i * 2 + 2, beats: 4 }));
  const a = P.axisFor(0, 16, bars); assert.equal(a.unit, 'bars'); assert.deepEqual(a.ticks.map((t) => t.label), ['9', '10', '11', '12', '13', '14', '15', '16']);
  const s = P.axisFor(0, 90); assert.equal(s.unit, 'seconds'); assert.ok(s.ticks.some((t) => t.label === '1:00'));
});
test('no difference draws as none', () => {
  const x = S.pink(2, -18, 1); const p = P.differencePicture(x, x, 48000, P.axisFor(0, 2), 'difference');
  // inside the played range (column 700 is 0.95 s in; row 300 is about 1 kHz, where the noise is well over -80 dB), the scale's middle exactly
  const mid = R.ramp(R.DIVERGING, 0.5); const some = R.pixel(p.raster, 700, 300);
  assert.deepEqual(some, mid); assert.deepEqual(P.divergingStep(0.5), mid);
});
test('a boost shows on its side of the scale, at its place', () => {
  const x = S.pink(2, -18, 1); const y = S.mix(x, S.band(S.pink(2, -12, 2), 2000, 4000));
  const p = P.differencePicture(x, y, 48000, P.axisFor(0, 2), 'difference'); const more = R.DIVERGING.at(-1);
  const inBand = R.pixel(p.raster, 700, Math.round(P.yOfHz(2800))); const outside = R.pixel(p.raster, 700, Math.round(P.yOfHz(200)));
  const toward = (c) => c.reduce((s, v, i) => s - Math.abs(v - more[i]), 0); assert.ok(toward(inBand) > toward(outside));
});
test('the set of pictures for 16 bars of a stereo song', () => {
  const l = S.pink(32, -18, 1), r = S.pink(32, -18, 2); const bars = Array.from({ length: 16 }, (_, i) => ({ bar: 1 + i, start: i * 2, end: i * 2 + 2, beats: 4 }));
  const h = hearingOf([l, r], 48000, { engine: 't', bars, pictures: true });
  assert.deepEqual(h.pictures.map((p) => p.name), ['spectrogram', 'spectrogram-bars-1-8', 'spectrogram-bars-9-16', 'stereo', 'level', 'spectrum', 'chroma']);
  assert.ok(h.pictures.every((p) => p.shows.length > 10));
});
test('a fault gets a close-up named for its place; asked moments too', () => {
  const x = S.mix(S.sine(110, 8, -12), S.sine(440, 8, -18)); x[5 * 48000] += 0.5; const bars = Array.from({ length: 4 }, (_, i) => ({ bar: 9 + i, start: i * 2, end: i * 2 + 2, beats: 4 }));
  const names = hearingOf([x], 48000, { engine: 't', bars, pictures: true, closeUps: [1.25] }).pictures.map((p) => p.name);
  assert.ok(names.includes('closeup-bar-11-beat-3')); assert.ok(names.includes('closeup-bar-9-beat-3')); assert.ok(!names.includes('stereo'), 'mono has no stereo picture (Review Focus 1)');
});
test('detail ranges: none for 8 bars, groups of 8 after, at most twelve spread evenly; every 30 s without bars (Review Focus 2)', () => {
  const barsOf = (n) => Array.from({ length: n }, (_, i) => ({ bar: 1 + i, start: i * 2, end: i * 2 + 2, beats: 4 }));
  assert.deepEqual(detailRanges(0, 16, barsOf(8)), []);
  assert.deepEqual(detailRanges(0, 18, barsOf(9)), [
    { fromSeconds: 0, toSeconds: 16, name: 'spectrogram-bars-1-8' },
    { fromSeconds: 16, toSeconds: 18, name: 'spectrogram-bars-9-9' },
  ]);
  const hundred = detailRanges(0, 200, barsOf(100));
  assert.equal(hundred.length, 12);
  assert.equal(hundred[0].name, 'spectrogram-bars-1-8'); assert.equal(hundred.at(-1).name, 'spectrogram-bars-97-100');
  assert.ok(hundred.every((d, i) => i === 0 || d.fromSeconds > hundred[i - 1].fromSeconds), 'in order');
  assert.deepEqual(hundred.at(-1), { fromSeconds: 192, toSeconds: 200, name: 'spectrogram-bars-97-100' });
  // only the bars inside the range count
  assert.deepEqual(detailRanges(16, 34, barsOf(100)).map((d) => d.name), ['spectrogram-bars-9-16', 'spectrogram-bars-17-17']);
  assert.deepEqual(detailRanges(0, 30), []);
  assert.deepEqual(detailRanges(0, 31), [
    { fromSeconds: 0, toSeconds: 30, name: 'spectrogram-0m00-0m30' },
    { fromSeconds: 30, toSeconds: 31, name: 'spectrogram-0m30-0m31' },
  ]);
  const long = detailRanges(0, 400); // 400 s asks for 14; 12 are kept
  assert.equal(long.length, 12); assert.ok(long.every((d) => /^spectrogram-\d+m\d\d-\d+m\d\d$/.test(d.name)));
  assert.equal(long[0].name, 'spectrogram-0m00-0m30'); assert.equal(long.at(-1).name, 'spectrogram-6m30-6m40');
  assert.ok(long.every((d, i) => i === 0 || d.fromSeconds > long[i - 1].fromSeconds), 'in order');
});
test('a short hit and silence still get an overview (Review Focus 3)', () => {
  assert.ok(hearingOf([S.at(0.08, [[0.005, S.burst(0.07, 15, 0, -6, 1)]])], 48000, { engine: 't', pictures: true }).pictures.some((p) => p.name === 'spectrogram'));
  assert.deepEqual(hearingOf([new Float32Array(48000)], 48000, { engine: 't', pictures: true }).pictures.map((p) => p.name), ['spectrogram', 'level']);
});
test('a saved hearing is recognised, anything else refused', () => {
  const sound = hearingOf([S.pink(2, -18, 1)], 48000, { engine: 't' }).sound;
  assert.equal(parseSavedHearing({ fledgetoneHearing: 1, of: 'a.wav', range: { fromSeconds: 0, toSeconds: 2 }, sound }).of, 'a.wav');
  for (const bad of [null, {}, { fledgetoneHearing: 2, sound }, { fledgetoneHearing: 1 }]) assert.throws(() => parseSavedHearing(bad), /not a saved hearing/);
});

// The controller's additions

test('a sine reads its own peak level in dB through the stepped scale, within 1 dB', () => {
  for (const hz of [50, 1000, 12000]) for (const db of [-6, -30, -60]) {
    const p = P.spectrogramPicture(S.sine(hz, 2, db), 48000, P.axisFor(0, 2), { name: 's', title: 't' });
    const y = P.PICTURE.top + argmax(rowBrightness(p));
    near(dbOfHeat(R.pixel(p.raster, 735, y)), db, 1, `a sine of ${hz} Hz at ${db} dB`);
  }
});
test('every sample reaches the picture: a short burst between two column centres still lights its column', () => {
  const sr = 48000; const seconds = 240; const axis = P.axisFor(0, seconds);
  const columns = P.PICTURE.right - P.PICTURE.left; const perColumn = seconds / columns;
  const boundary = 600 * perColumn; // the edge between column 599 and 600, half way between their centres
  const x = S.at(seconds, [[boundary - 0.01, S.gain(S.white(0.02, -12, 3), 0)]], sr);
  const p = P.spectrogramPicture(x, sr, axis, { name: 's', title: 't' });
  const col = argmax(colBrightness(p));
  assert.ok(col === 599 || col === 600, `brightest column ${col}`);
  assert.ok(colBrightness(p)[col] > colBrightness(p)[300] * 2);
});
test('frequencies above half the sample rate are the ground colour', () => {
  const p = P.spectrogramPicture(S.pink(2, -18, 1, 22050), 22050, P.axisFor(0, 2), { name: 's', title: 't' });
  assert.ok(same(R.pixel(p.raster, 700, Math.round(P.yOfHz(15000))), R.PAPER));
  assert.ok(!same(R.pixel(p.raster, 700, Math.round(P.yOfHz(8000))), R.PAPER));
});
test('a mono level picture is centred; a stereo one has left above and right below', () => {
  const mid = (P.PICTURE.top + P.PICTURE.bottom) / 2;
  const loud = S.sine(1000, 2, -1); // a cycle is shorter than a column, so every column spans the whole swing
  const mono = P.levelPicture([loud], 48000, P.axisFor(0, 2), [null, null], 'level');
  const lit = (p, y) => !same(R.pixel(p.raster, 735, y), R.PAPER) && !same(R.pixel(p.raster, 735, y), R.GRID);
  assert.ok(lit(mono, Math.round(mid) - 100) && lit(mono, Math.round(mid) + 100), 'mono reaches both ways from the centre');
  const stereo = P.levelPicture([loud, new Float32Array(loud.length)], 48000, P.axisFor(0, 2), [null, null], 'level');
  const quarter = (P.PICTURE.bottom - P.PICTURE.top) / 4;
  assert.ok(lit(stereo, Math.round(P.PICTURE.top + quarter - 40)), 'the loud left channel shows above');
  assert.ok(!lit(stereo, Math.round(P.PICTURE.bottom - quarter - 40)), 'the silent right channel shows nothing below');
});
test('NaN and Infinity in the samples draw as the cleaned sound does', () => {
  const x = S.pink(2, -18, 1); const dirty = Float32Array.from(x); dirty[1000] = NaN; dirty[50000] = Infinity; dirty[70000] = -Infinity;
  const clean = Float32Array.from(dirty, (v) => (Number.isFinite(v) ? v : 0));
  const a = hearingOf([dirty], 48000, { engine: 't', pictures: true }).pictures;
  const b = hearingOf([clean], 48000, { engine: 't', pictures: true }).pictures;
  assert.deepEqual(a.map((p) => p.name), b.map((p) => p.name));
  for (let i = 0; i < a.length; i++) assert.ok(same(a[i].raster.data, b[i].raster.data), a[i].name);
});
test('an axis of no length, and a very short one, give finite numbers; 0.08 s is ticked in ms', () => {
  for (const [from, to] of [[3, 3], [3, 2]]) {
    const a = P.axisFor(from, to);
    assert.ok(Number.isFinite(P.xOfSeconds(from, a)) && Number.isFinite(P.xOfSeconds(to + 1, a)));
    assert.ok(a.ticks.every((t) => Number.isFinite(t.seconds)));
  }
  const short = P.axisFor(0, 0.08);
  assert.ok(short.ticks.length >= 3 && short.ticks.every((t) => /ms$|^0$/.test(t.label)), short.ticks.map((t) => t.label).join());
});
test('no picture throws on empty or silent audio, and each draws its axes', () => {
  const empty = new Float32Array(0); const silent = new Float32Array(48000); const axis = P.axisFor(0, 1);
  const spectrum = { freqs: [100, 1000], mid: [-200, -200], side: [-200, -200] };
  for (const x of [empty, silent]) {
    const pictures = [
      P.spectrogramPicture(x, 48000, axis, { name: 's', title: 't' }),
      P.spectrogramPicture(x, 48000, axis, { name: 's', title: 't', kind: 'stereo' }),
      P.levelPicture([x, x], 48000, axis, [], 'level'),
      P.levelPicture([], 48000, axis, [], 'level'),
      P.spectrumPicture(spectrum, 'this', null, 'spectrum'),
      P.chromaPicture([], 1, axis, 'chroma'),
      P.closeUpPicture([x], 48000, 0.5, 'here', 'closeup'),
      P.closeUpPicture([], 48000, 0.5, 'here', 'closeup'),
      P.differencePicture(x, x, 48000, axis, 'difference'),
    ];
    for (const p of pictures) {
      assert.equal(p.raster.width, 1500);
      assert.ok(same(R.pixel(p.raster, P.PICTURE.left, P.PICTURE.bottom), R.GRID), `${p.name} draws its box`);
    }
  }
});
test('a short hit gets no spectrum picture; small makes only the overview and the spectrum', () => {
  const hit = hearingOf([S.at(0.08, [[0.005, S.burst(0.07, 15, 0, -6, 1)]])], 48000, { engine: 't', pictures: true });
  assert.equal(hit.sound.tone, undefined); assert.ok(!hit.pictures.some((p) => p.name === 'spectrum'));
  const small = hearingOf([S.pink(3, -18, 1), S.pink(3, -18, 2)], 48000, { engine: 't', pictures: true, small: true, prefix: 'bass-' });
  assert.deepEqual(small.pictures.map((p) => p.name), ['bass-spectrogram', 'bass-spectrum']);
});
test('a small hearing (a track of a per-track listen) has no per-second grids; a full one keeps them', () => {
  const x = [S.pink(3, -18, 1), S.pink(3, -18, 2)];
  const small = hearingOf(x, 48000, { engine: 't', small: true });
  assert.equal('along' in small.sound, false, 'a small hearing computes no grids');
  assert.ok(small.sound.tone && small.sound.words.length > 0, 'the rest of the report is there');
  const full = hearingOf(x, 48000, { engine: 't' });
  assert.equal(full.sound.along.mid.length, 3);
  const { along: _along, ...rest } = full.sound;
  assert.deepEqual(small.sound, rest, 'and is otherwise the same report');
});
test('the spectrum picture is drawn from the report itself, with what it is set against', () => {
  const a = [S.pink(3, -18, 1)]; const b = hearingOf([S.pink(3, -24, 2)], 48000, { engine: 't' }).sound;
  const h = hearingOf(a, 48000, { engine: 't', pictures: true, against: { sound: b, label: 'the reference' } });
  const drawn = h.pictures.find((p) => p.name === 'spectrum');
  const again = P.spectrumPicture(h.sound.tone.spectrum, 'this sound', { spectrum: b.tone.spectrum, label: 'the reference' }, 'spectrum', { fromSeconds: 0, toSeconds: 3 });
  assert.ok(same(drawn.raster.data, again.raster.data));
  assert.match(drawn.shows, /the reference/);
});
test('without pictures, the report is what hearSound gives and nothing is drawn', async () => {
  const { hearSound } = await import('../src/audio/hearing/hearSound.ts');
  const x = [S.pink(2, -18, 1)];
  const h = hearingOf(x, 48000, { engine: 't' });
  assert.deepEqual(h.pictures, []); assert.deepEqual(h.sound, hearSound(x, 48000, { engine: 't' }));
});
test('shows says what a picture is without judging it', () => {
  const l = S.pink(2, -18, 1), r = S.pink(2, -18, 2);
  const h = hearingOf([l, r], 48000, { engine: 't', pictures: true, closeUps: [1] });
  for (const p of [...h.pictures, P.differencePicture(l, r, 48000, P.axisFor(0, 2), 'difference')]) {
    assert.doesNotMatch(p.shows, /\b(good|bad|too|should)\b/i, p.name);
    assert.ok(p.shows.split(/\.\s/).length <= 3, `${p.name}: ${p.shows}`);
  }
  assert.match(P.differencePicture(l, r, 48000, P.axisFor(0, 2), 'difference').shows, /Red is where the second is louder than the first/);
});

test('every picture keeps to 256 colours or fewer, and a spectrogram is written as an indexed PNG', async () => {
  const { encodePng } = await import('../src/audio/hearing/png.ts');
  const colours = (p) => { const seen = new Set(); const d = p.raster.data; for (let i = 0; i < d.length; i += 3) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); return seen.size; };
  const l = S.mix(S.pink(3, -18, 1), S.sine(220, 3, -12)), r = S.mix(S.pink(3, -18, 2), S.sine(330, 3, -20)); l[60000] += 0.5;
  const h = hearingOf([l, r], 48000, { engine: 't', pictures: true, closeUps: [1.5], against: { sound: hearingOf([S.pink(3, -24, 3)], 48000, { engine: 't' }).sound, label: 'the other' } });
  const pictures = [...h.pictures, P.differencePicture(l, S.mix(l, S.band(S.pink(3, -12, 4), 2000, 4000)), 48000, P.axisFor(0, 3), 'difference'), P.spectrumPicture(h.sound.tone.spectrum, 'this', null, 'spectrum-alone')];
  assert.deepEqual([...new Set(pictures.map((p) => p.kind))].sort(), ['chroma', 'closeup', 'difference', 'level', 'spectrogram', 'spectrum', 'stereo']);
  for (const p of pictures) assert.ok(colours(p) <= 256, `${p.name} has ${colours(p)} colours`);
  const png = await encodePng(h.pictures[0].raster);
  assert.equal(png[25], 3, 'colour type 3, indexed');
});
test('the grid stays under the data: visible on silence, never in place of a level', () => {
  const axis = P.axisFor(0, 2); const inside = (p, c) => { let n = 0; for (let y = P.PICTURE.top; y < P.PICTURE.bottom; y++) for (let x = P.PICTURE.left; x < P.PICTURE.right; x++) if (R.pixel(p.raster, x, y).join() === c.join()) n++; return n; };
  assert.ok(inside(P.spectrogramPicture(new Float32Array(96000), 48000, axis, { name: 's', title: 't' }), R.GRID) > 100, 'the grid shows on silence');
  const loud = P.spectrogramPicture(S.white(2, -10, 1), 48000, axis, { name: 's', title: 't' });
  assert.equal(inside(loud, R.GRID), 0, 'no grid dot over the noise');
});
