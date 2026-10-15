// Unit tests for the drum tools: the Drum Designer's sounds (src/store/drumDesign.ts, src/audio/drumSynth.ts), the hat roll
// painter (roll in src/store/noteTools.ts), swing per drum row (src/store/drumGroove.ts) and note repeat (src/store/noteRepeat.ts).
// Run with `npm test`.
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

const D = await import('../src/store/drumDesign.ts');
const S = await import('../src/audio/drumSynth.ts');
const T = await import('../src/store/noteTools.ts');
const G = await import('../src/store/drumGroove.ts');
const R = await import('../src/store/noteRepeat.ts');
const { serializeProject, parseProject } = await import('../src/store/project.ts');
const { defaultTrackFx, durationToBars } = await import('../src/store/timelineTypes.ts');

const ROW_OF_GROUP = { Kicks: 'kick', Snares: 'snare', Claps: 'clap', Hats: 'closedHat', Cymbals: 'crash', Percussion: 'cowbell' };
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test('every drum preset renders: finite, at its row loudness (or its peak at the ceiling), faded out, within the longest hit', () => {
  for (const p of D.DRUM_PRESETS) {
    const row = ROW_OF_GROUP[p.group];
    const x = S.renderDrumSound(p.sound, row, 44100, 7);
    assert.ok(x.every(Number.isFinite), `${p.id} finite`);
    const loud = 20 * Math.log10(S.loudestRms(x, 44100));
    const target = S.ROW_LOUDNESS[row] + p.sound.level;
    assert.ok(S.peakOf(x) <= S.DRUM_CEILING + 1e-6, `${p.id} peak`);
    // At its loudness, unless the ceiling held it under (then within 9 dB of it)
    if (S.peakOf(x) < S.DRUM_CEILING - 1e-6) near(loud, target, 0.01);
    else assert.ok(loud < target && loud > target - 9, `${p.id}: ${loud} for ${target}`);
    assert.ok(x.length / 44100 <= S.MAX_HIT_SECONDS + 0.01, `${p.id} length`);
    assert.ok(Math.abs(x[x.length - 1]) < 1e-3, `${p.id} ends faded`);
    // Something happens in the first 5 ms: a drum's attack, not a swell (the shaker's is short)
    const head = x.subarray(0, Math.round(0.03 * 44100));
    assert.ok(S.peakOf(head) > 0.2 * S.peakOf(x), `${p.id} attack`);
  }
});

test('preset names describe sounds (no artist or brand names) and every row has a default', () => {
  for (const p of D.DRUM_PRESETS) assert.match(p.name, /^[A-Z][a-z -]+$/, p.name);
  for (const r of D.DESIGN_ROW_IDS) assert.ok(D.drumPreset(D.DEFAULT_ROW_PRESET[r]), r);
  assert.equal(new Set(D.DRUM_PRESETS.map((p) => p.id)).size, D.DRUM_PRESETS.length);
});

test('a designed drum renders the same every time; its seed picks its noise', () => {
  const snare = D.presetSound('drillSnare');
  const a = S.renderDrumSound(snare, 'snare', 48000, 11);
  const b = S.renderDrumSound(snare, 'snare', 48000, 11);
  assert.deepEqual(a, b);
  const c = S.renderDrumSound(snare, 'snare', 48000, 12);
  assert.notDeepEqual(a, c);
  // The kick is all tone and click: its noise is the click's only
  const kick = D.presetSound('hardTrapKick');
  assert.deepEqual(S.renderDrumSound(kick, 'kick', 48000, 3), S.renderDrumSound(kick, 'kick', 48000, 3));
});

test('the kick sweeps down onto its pitch, and decay sets its length', () => {
  const kick = D.presetSound('hardTrapKick');
  const x = S.renderDrumSound(kick, 'kick', 48000, 1);
  const crossings = (from, to) => {
    let n = 0;
    for (let i = Math.round(from * 48000) + 1; i < Math.round(to * 48000); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  // Late in the hit it rings at its pitch (46 Hz); early on, well above it
  near(crossings(0.25, 0.5), kick.layers[0].pitch, 4);
  assert.ok(crossings(0.005, 0.03) > 1.5 * kick.layers[0].pitch);
  const short = S.renderDrumSound(D.withLayerValue(kick, 0, 'decay', 0.2), 'kick', 48000, 1);
  assert.ok(short.length < x.length * 0.5);
});

test('distortion makes a drum denser at the same loudness, and a preset change keeps the level', () => {
  const kick = D.presetSound('punchyKick');
  const clean = S.renderDrumSound(D.withLayerValue(kick, 0, 'drive', 0.15), 'kick', 44100, 1);
  const dirty = S.renderDrumSound(D.withLayerValue(kick, 0, 'drive', 1), 'kick', 44100, 1);
  near(S.loudestRms(clean, 44100), S.loudestRms(dirty, 44100), 1e-6);
  // Squarer: less peak for the same loudness
  assert.ok(S.peakOf(dirty) < S.peakOf(clean) * 0.9);
  for (const id of ['hardTrapKick', 'drillKick', 'distortedBoomKick']) near(20 * Math.log10(S.loudestRms(S.renderDrumSound(D.presetSound(id), 'kick', 44100, 1), 44100)), S.ROW_LOUDNESS.kick, 0.01);
  // The level knob moves it by its dB
  near(20 * Math.log10(S.loudestRms(S.renderDrumSound({ ...kick, level: -6 }, 'kick', 44100, 1), 44100)), S.ROW_LOUDNESS.kick - 6, 0.01);
});

test('two layers mix, the second after its delay', () => {
  const snare = D.presetSound('fatSnare');
  assert.equal(snare.layers.length, 2);
  const solo = { ...snare, layers: [snare.layers[0]] };
  assert.notDeepEqual(S.renderDrumSound(snare, 'snare', 44100, 1), S.renderDrumSound(solo, 'snare', 44100, 1));
  assert.ok(S.drumSeconds(snare) >= S.drumSeconds(solo));
});

test('a drum design survives saving and opening; a damaged one is repaired', () => {
  const design = { kick: D.presetSound('distortedBoomKick'), closedHat: D.withLayerValue(D.presetSound('trapHat'), 0, 'decay', 0.08) };
  const track = { id: 'k', name: 'Kit', color: '#fff', instrumentKey: 'designedKit', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, drumDesign: design };
  const p = { name: 'Drums', bpm: 140, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [track], clips: [] };
  const back = parseProject(JSON.parse(JSON.stringify(serializeProject(p))));
  assert.deepEqual(back.tracks[0].drumDesign, design);
  const fixed = D.normalizeDrumDesign({ kick: { layers: [{ voice: 'laser', pitch: 1e9, decay: -4, bursts: 2.6 }, {}, {}], level: 99 }, nope: { layers: [{}] }, snare: 'x' });
  assert.deepEqual(Object.keys(fixed), ['kick']);
  assert.equal(fixed.kick.layers.length, 2);
  assert.equal(fixed.kick.layers[0].voice, 'kick');
  assert.equal(fixed.kick.layers[0].pitch, D.LAYER_RANGES.pitch[1]);
  assert.equal(fixed.kick.layers[0].decay, D.LAYER_RANGES.decay[0]);
  assert.equal(fixed.kick.layers[0].bursts, 3);
  assert.equal(fixed.kick.level, D.SOUND_LEVEL[1]);
  assert.equal(D.normalizeDrumDesign(null), undefined);
  // A track from before the Drum Designer has none
  assert.equal(parseProject(JSON.parse(JSON.stringify(serializeProject({ ...p, tracks: [{ ...track, drumDesign: undefined }] })))).tracks[0].drumDesign, undefined);
});

// ---------- the hat roll painter ----------

const N = (id, note, start, duration = '4n', velocity = 0.8) => ({ id, note, startOffset: start, duration, velocity });
const ids = () => {
  let k = 0;
  return () => `r${k++}`;
};
/** A position in Transport ticks (768 a bar), and whether it's a whole tick */
const ticks = (bars) => bars * 768;

test('a roll at each rate lands on whole ticks of its grid, from the note to its end', () => {
  for (const r of T.ROLL_RATES) {
    const out = T.roll([N('h', 'F#1', 0.25, '4n', 1)], r.bars, ids());
    const expected = Math.round(0.25 / r.bars);
    assert.equal(out.length, expected, r.id);
    out.forEach((n, i) => {
      const t = ticks(n.startOffset);
      near(t, Math.round(t), 1e-6);
      near(n.startOffset, 0.25 + i * r.bars, 1e-9);
      near(durationToBars(n.duration), r.bars, 1e-9);
    });
  }
  // A 1/64 roll's hits are 12 ticks apart; 1/16 triplets 32
  assert.deepEqual(T.roll([N('h', 'F#1', 0, '8n')], 1 / 64, ids()).map((n) => ticks(n.startOffset)), [0, 12, 24, 36, 48, 60, 72, 84]);
  assert.deepEqual(T.roll([N('h', 'F#1', 1, '4n')], 1 / 24, ids()).map((n) => ticks(n.startOffset) - 768), [0, 32, 64, 96, 128, 160]);
});

test('roll velocity shapes: rising, falling, swell and even', () => {
  const v = (shape) => T.roll([N('h', 'F#1', 0, '8n', 1)], 1 / 32, ids(), { velocity: shape, from: 0.4 }).map((n) => +n.velocity.toFixed(3));
  assert.deepEqual(v('up'), [0.4, 0.6, 0.8, 1]);
  assert.deepEqual(v('down'), [1, 0.8, 0.6, 0.4]);
  assert.deepEqual(v('flat'), [1, 1, 1, 1]);
  const swell = v('swell');
  assert.equal(swell[0], 0.4);
  assert.equal(swell[3], 0.4);
  assert.ok(swell[1] > 0.9 && swell[2] > 0.9);
  // Unchanged: the TOOLS menu's Roll rises from a third
  assert.deepEqual(T.roll([N('h', 'F#1', 0, '8n', 0.9)], 1 / 32, ids()).map((n) => +n.velocity.toFixed(3)), [0.315, 0.51, 0.705, 0.9]);
});

test('roll pitch: drum hits rise by their own bend, notes by semitones', () => {
  const drums = T.roll([N('h', 'F#1', 0, '4n')], 1 / 16, ids(), { pitch: 6, velocity: 'flat' });
  assert.deepEqual(drums.map((n) => n.note), ['F#1', 'F#1', 'F#1', 'F#1']);
  assert.equal(drums[0].expr, undefined);
  assert.deepEqual(drums.slice(1).map((n) => n.expr.bend[0].value), [2, 4, 6]);
  const notes = T.roll([N('n', 'C4', 0, '4n')], 1 / 16, ids(), { pitch: 7, pitchBy: 'notes', lo: 0, hi: 127 });
  assert.deepEqual(notes.map((n) => n.note), ['C4', 'D4', 'F4', 'G4']);
});

test('a stutter is so many hits across each note, whatever its length', () => {
  const out = T.roll([N('a', 'D1', 0, '2n'), N('b', 'D1', 0.5, '4n')], 1 / 16, ids(), { count: 3, velocity: 'flat' });
  assert.equal(out.length, 6);
  near(out[1].startOffset, 1 / 6, 1e-9);
  near(out[4].startOffset, 0.5 + 1 / 12, 1e-9);
  assert.equal(new Set(out.map((n) => n.id)).size, 6);
  assert.equal(out[0].id, 'a');
});

// ---------- swing per drum row ----------

test('groove templates swing the hats and leave the kick and snare straight', () => {
  for (const t of G.GROOVE_TEMPLATES) {
    const g = G.grooveTemplate(t.id);
    assert.equal(g.swing, 0, t.id);
    assert.equal(g.template, t.id);
    assert.equal(G.rowFeelOf(g, 'C1'), undefined, `${t.id}: kick has no feel`);
    if (t.id !== 'lazy') assert.equal(G.rowFeelOf(g, 'D1'), undefined, `${t.id}: snare straight`);
  }
  assert.equal(G.rowFeelOf(G.grooveTemplate('heavySwing'), 'F#1').swing, 0.5);
  assert.ok(G.rowFeelOf(G.grooveTemplate('lazy'), 'D1').shift > 0);
  assert.ok(G.rowFeelOf(G.grooveTemplate('pushed'), 'F#1').shift < 0);
  // A copy: changing it leaves the template alone
  G.grooveTemplate('lightSwing').rows['F#1'].swing = 0.7;
  assert.equal(G.grooveTemplate('lightSwing').rows['F#1'].swing, 0.22);
});

test('a row feel scales velocity on and off the 8ths, and shifts in time by a share of a 16th', () => {
  const feel = { vel: 0.9, offbeat: 0.5 };
  near(G.feelVelocity(feel, 0.8, 0), 0.72, 1e-9);
  near(G.feelVelocity(feel, 0.8, 48), 0.36, 1e-9);
  near(G.feelVelocity(feel, 0.8, 96), 0.72, 1e-9);
  near(G.feelVelocity(feel, 0.8, 32), 0.36, 1e-9);
  assert.equal(G.feelVelocity(undefined, 0.8, 48), 0.8);
  // 0.1 of a 16th at 120 BPM: 12.5 ms
  near(G.feelShiftSeconds({ shift: 0.1 }, 120), 0.0125, 1e-12);
  near(G.feelShiftSeconds({ shift: -0.2 }, 150), -0.02, 1e-12);
});

test('a groove with rows survives saving and opening; a damaged one is repaired', () => {
  const g = G.withRowFeel(G.grooveTemplate('heavySwing'), 'D1', { shift: 0.05 });
  assert.equal(g.template, undefined);
  assert.equal(g.rows.D1.shift, 0.05);
  const clip = { id: 'c', trackId: 't', name: 'Beat', startBar: 1, lengthBars: 1, notes: [N('n', 'F#1', 0.0625)], isSelected: false, groove: g };
  const track = { id: 't', name: 'Kit', color: '#fff', instrumentKey: 'drums', isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0 };
  const p = { name: 'Groove', bpm: 140, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false }, tracks: [track], clips: [clip] };
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(serializeProject(p)))).clips[0].groove, g);
  const fixed = G.normalizeClipGroove({ swing: 2, grid: 16, rows: { 'F#1': { swing: -1, shift: 9, vel: 'x', offbeat: 1 }, '<script>': { swing: 0.2 }, D1: {} }, template: 'nope' });
  assert.deepEqual(fixed, { swing: 0.75, grid: 16, rows: { 'F#1': { swing: 0, shift: 0.25 } } });
  assert.equal(G.normalizeClipGroove({ swing: 0.3, grid: 12 }), undefined);
  // Old grooves (no rows) read as before
  assert.deepEqual(G.normalizeClipGroove({ swing: 0.5, grid: 8 }), { swing: 0.5, grid: 8 });
  // A row emptied of its feel goes, and an empty rows map with it
  assert.deepEqual(G.withRowFeel({ swing: 0, grid: 16, rows: { D1: { shift: 0.1 } } }, 'D1', { shift: 0 }), { swing: 0, grid: 16 });
});

// ---------- note repeat ----------

test('note repeat rates are whole ticks, and repeats sit on the song grid', () => {
  assert.deepEqual(R.NOTE_REPEAT_RATES.map((r) => R.repeatTicks(r)), [96, 64, 48, 32, 24, 16]);
  for (const r of R.NOTE_REPEAT_RATES) assert.equal(768 % R.repeatTicks(r), 0, `${r} divides a bar`);
  near(R.repeatSeconds('1/16', 120), 0.125, 1e-12);
  near(R.repeatSeconds('1/16T', 150), 0.0666666, 1e-6);
  assert.deepEqual(R.gridTicks(100, 250, 48), [144, 192, 240]);
  assert.deepEqual(R.gridTicks(96, 96, 48), []);
  // Struck just before a line: the first repeat skips it rather than flam
  assert.deepEqual(R.gridTicks(R.firstRepeatAfter(190, 48), 300, 48), [240, 288]);
  assert.deepEqual(R.gridTicks(R.firstRepeatAfter(150, 48), 300, 48), [192, 240, 288]);
});

test('note repeat velocity follows pad pressure, or keeps the strike', () => {
  assert.equal(R.repeatVelocity(0.7, undefined), 0.7);
  near(R.repeatVelocity(0.7, 1), 1, 1e-12);
  near(R.repeatVelocity(0.7, 0), 0.12, 1e-12);
  assert.ok(R.repeatVelocity(0.7, 0.3) < R.repeatVelocity(0.7, 0.6));
  assert.ok(R.isNoteRepeat('1/32T') && R.isNoteRepeat('off') && !R.isNoteRepeat('1/5'));
});
