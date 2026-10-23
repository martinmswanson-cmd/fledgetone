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
const M = await import('../src/audio/drumMeasure.ts');
const F = await import('../src/store/drumFollow.ts');
const K = await import('../src/store/synthKits.ts');
const { INSTRUMENTS, INSTRUMENT_KEYS, RETIRED_INSTRUMENTS, currentInstrumentKey } = await import('../src/audio/instrumentCatalog.ts');

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

// ---------- the layered kick and snare ----------

const SR = 48000;
const render = (id, row = 'kick', seed = 1) => S.renderDrumSound(D.presetSound(id), row, SR, seed);
const LAYERED_KICKS = ['punchKick', 'hardcoreKick', 'deepTailKick', 'clubKick'];
const LAYERED_SNARES = [['bigSnare', 'snare'], ['gatedSnare', 'snare'], ['tightLayerSnare', 'snare'], ['crackClap', 'clap']];
/** The level of `y` (band-passed) in a 10 ms window at `t` seconds against its loudest, dB */
const bandAt = (env, t) => env[Math.round(t * 100)] - Math.max(...env);

test('layered kicks: click, a body falling from its punch pitch onto the tail, the low end gone in time, all under the ceiling', () => {
  for (const id of LAYERED_KICKS) {
    const x = render(id);
    const l = D.presetSound(id).layers[0];
    assert.ok(S.peakOf(x) <= S.DRUM_CEILING + 1e-6, id);
    const m = M.measureKick(x, SR, l.pitch);
    // A click 1.5 to 15 dB under the low end in the first 12 ms
    assert.ok(m.clickDb >= -17 && m.clickDb <= -1.5, `${id} click ${m.clickDb}`);
    // The pitch envelope: well above the tail at the front, on it by the body's end
    assert.ok(m.startHz > 1.8 * l.pitch, `${id} starts at ${m.startHz}`);
    if (id !== 'hardcoreKick') near(m.endHz, l.pitch, 4);
    // Driven body harmonics stay under +7 dB over the fundamental
    assert.ok(m.harmonicsDb <= 7, `${id} harmonics ${m.harmonicsDb}`);
  }
  // The short ones: 30-150 Hz down 20 dB in 100-180 ms (room for a bass)
  for (const id of ['punchKick', 'clubKick']) {
    const m = M.measureKick(render(id), SR, D.presetSound(id).layers[0].pitch);
    assert.ok(m.lowFall20Ms >= 100 && m.lowFall20Ms <= 180, `${id} low end falls 20 dB in ${m.lowFall20Ms} ms`);
  }
});

test('the hard drop kick knocks and clicks where the club kick only thumps, and its tuned sub carries the low end longer', () => {
  /** Energy of `x` in lo-hi Hz from a to b seconds, dB */
  const energy = (x, lo, hi, a, b) => {
    const y = M.band(x, SR, lo, hi);
    let s = 0;
    for (let i = Math.round(a * SR); i < Math.min(y.length, Math.round(b * SR)); i++) s += y[i] * y[i];
    return 10 * Math.log10(s + 1e-12);
  };
  const knock = (x) => energy(x, 200, 1000, 0, 0.06) - energy(x, 30, 150, 0, 0.06);
  const drop = render('dropKick');
  const club = render('clubKick');
  const l = D.presetSound('dropKick').layers[0];
  assert.ok(S.peakOf(drop) <= S.DRUM_CEILING + 1e-6);
  const m = M.measureKick(drop, SR, l.pitch);
  const c = M.measureKick(club, SR, 50);
  // A click at the front a little over the low end (the club kick's is 15 dB under it)
  assert.ok(m.clickDb >= -3 && m.clickDb <= 6, `click ${m.clickDb}`);
  assert.ok(m.clickDb > c.clickDb + 10);
  // The driven body knocks at 200 Hz-1 kHz, 2-7 dB under the low end, 8 dB and more over the club kick
  assert.ok(knock(drop) >= -7 && knock(drop) <= -2, `knock ${knock(drop)}`);
  assert.ok(knock(drop) > knock(club) + 8);
  // Falls from its punch pitch onto a tuned sub (on the song's key) that holds the low end about a quarter of a second
  assert.ok(m.startHz > 2.5 * l.pitch, `starts at ${m.startHz}`);
  assert.ok(m.endHz > l.pitch - 4 && m.endHz < l.pitch + 8, `ends at ${m.endHz}`);
  assert.equal(l.keyTrack, 1);
  assert.ok(m.lowFall20Ms >= 200 && m.lowFall20Ms <= 300, `low end falls 20 dB in ${m.lowFall20Ms} ms`);
  assert.ok(m.lowFall20Ms > c.lowFall20Ms * 1.6);
  // Its drive stays under the hardcore kick's: a punchy kick, not a distorted one
  assert.ok(m.harmonicsDb < M.measureKick(render('hardcoreKick'), SR, 55).harmonicsDb - 8);
});

test('the drop impact is a deep boom that rings on for a second or two, with a noise burst over it', () => {
  const sound = D.presetSound('dropImpact');
  const x = S.renderDrumSound(sound, 'kick', SR, 1);
  assert.equal(sound.layers.length, 2);
  assert.ok(S.peakOf(x) <= S.DRUM_CEILING + 1e-6);
  const boom = M.measureKick(S.renderDrumSound({ ...sound, layers: [sound.layers[0]] }, 'kick', SR, 1), SR, sound.layers[0].pitch);
  // The boom falls from about 300 Hz onto the key over its pitch drop
  assert.ok(boom.startHz > 4 * sound.layers[0].pitch, `starts at ${boom.startHz}`);
  // ...and its low end is still within 20 dB of its peak after 0.8 s, gone by the longest hit
  const env = M.frameDb(M.band(x, SR, 30, 150), SR, 10);
  assert.ok(bandAt(env, 0.8) > -20, `at 0.8 s ${bandAt(env, 0.8)}`);
  assert.ok(x.length / SR >= 1.5 && x.length / SR <= S.MAX_HIT_SECONDS + 0.01);
  // The noise layer: a wash of 2-8 kHz over the boom's ring (0.1-0.6 s) that the boom alone hasn't
  const e = (y, lo, hi) => { const b = M.band(y, SR, lo, hi); let s = 0; for (let i = Math.round(0.1 * SR); i < 0.6 * SR; i++) s += b[i] * b[i]; return 10 * Math.log10(s + 1e-12); };
  const noise = (y) => e(y, 2000, 8000) - e(y, 30, 150);
  const alone = S.renderDrumSound({ ...sound, layers: [sound.layers[0]] }, 'kick', SR, 1);
  assert.ok(noise(x) > noise(alone) + 10, `noise ${noise(x)} vs ${noise(alone)}`);
});

test('the new default kick leaves the sub to the bass; a hardcore kick holds its driven tail through the beat', () => {
  const punch = M.measureKick(render('punchKick'), SR, 52);
  const old = M.measureKick(render('hardTrapKick'), SR, 46);
  assert.ok(punch.subShare < old.subShare * 0.5, `sub ${punch.subShare} vs ${old.subShare}`);
  assert.ok(punch.lowFall20Ms < old.lowFall20Ms * 0.4);
  // Hardcore at 163 BPM (a beat is 368 ms): -2 to -12 dB through it, about -20 dB by 290 ms
  const hard = render('hardcoreKick');
  const env = M.frameDb(M.band(hard, SR, 30, 600), SR, 10);
  for (const t of [0.06, 0.12, 0.2]) {
    const db = bandAt(env, t);
    assert.ok(db <= -0.5 && db >= -13, `hardcore at ${t}s: ${db} dB`);
  }
  const at290 = bandAt(env, 0.29);
  assert.ok(at290 <= -14 && at290 >= -27, `hardcore at 290 ms: ${at290} dB`);
  // ...and more of its harmonics than the punch kick's: it's distorted
  assert.ok(M.measureKick(hard, SR, 55).harmonicsDb > punch.harmonicsDb + 15);
  // Its drive is the body's only: the sub alone renders clean (no harmonics)
  const subOnly = D.withLayerValue(D.withLayerValue(D.presetSound('punchKick'), 0, 'body', 0), 0, 'click', 0);
  assert.ok(M.measureKick(S.renderDrumSound(subOnly, 'kick', SR, 1), SR, 52).harmonicsDb < -35);
});

test('layered snares: a fast transient, a tuned body, wires at 3.5-6 kHz, a room that rings; under the ceiling', () => {
  for (const [id, row] of LAYERED_SNARES) {
    const sound = D.presetSound(id);
    const l = sound.layers[0];
    const x = S.renderDrumSound(sound, row, SR, 1);
    assert.ok(S.peakOf(x) <= S.DRUM_CEILING + 1e-6, id);
    // The transient alone falls 12 dB in 7-25 ms
    const alone = S.renderDrumSound({ ...sound, layers: [{ ...l, body: 0, noise: 0, clap: 0, room: 0 }] }, row, SR, 1);
    const t12 = M.measureSnare(alone, SR).transientFall12Ms;
    assert.ok(t12 >= 7 && t12 <= 25, `${id} transient ${t12} ms`);
    // The wires alone: their centroid at 3.5-6 kHz
    const wires = S.renderDrumSound({ ...sound, layers: [{ ...l, body: 0, click: 0, clap: 0, room: 0 }] }, row, SR, 1);
    const c = M.measureSnare(wires, SR).noiseCentroidHz;
    assert.ok(c >= 3500 && c <= 6000, `${id} wires centroid ${c}`);
  }
  // The body is tuned (120-170 Hz for the big one)
  const big = M.measureSnare(render('bigSnare', 'snare'), SR);
  assert.ok(big.bodyHz >= 120 && big.bodyHz <= 175, `body ${big.bodyHz}`);
  // The room keeps 1-10 kHz from falling 20 dB for 300-700 ms
  assert.ok(big.roomFall20Ms >= 300 && big.roomFall20Ms <= 700, `room ${big.roomFall20Ms}`);
  // By default (a new kit) the snare hits 0 to +2 dB over the kick, as heard
  const kit = D.newKitDesign();
  const dk = M.kPeakDb(S.renderDrumSound(kit.snare, 'snare', SR, 1), SR) - M.kPeakDb(S.renderDrumSound(kit.kick, 'kick', SR, 1), SR);
  assert.ok(dk >= 0 && dk <= 2, `snare over kick ${dk} dB`);
});

test('a gated room holds for an 8th at the song tempo, then stops', () => {
  for (const bpm of [100, 163]) {
    const hold = F.gateHoldFor(bpm);
    near(hold, 30 / bpm, 1e-4);
    const sound = D.presetSound('gatedSnare');
    // (The room alone: the wires have their own decay)
    const gated = { ...sound, layers: [{ ...sound.layers[0], gateHold: hold, body: 0, click: 0, noise: 0, clap: 0 }] };
    const x = S.renderDrumSound(gated, 'snare', SR, 2);
    const env = M.frameDb(M.band(x, SR, 1000, 10000), SR, 5);
    const top = Math.max(...env);
    const at = (t) => env[Math.round(t * 200)] - top;
    // Still ringing just before the gate shuts, gone just after it
    assert.ok(at(hold - 0.01) > -20, `${bpm}: before the gate ${at(hold - 0.01)}`);
    assert.ok(x.length / SR < hold + 0.04 || at(hold + 0.02) < -40, `${bpm}: after the gate ${at(hold + 0.02)}`);
  }
});

test('tune to key: a following pitch sits on the key root nearest its range, and the store keeps it there', () => {
  // A: 55 Hz for a kick's tail; F#: 46.25; F has none in 45-66 Hz, so the nearer octave (43.65)
  near(F.keyPitchHz(9, [45, 66]), 55, 0.01);
  near(F.keyPitchHz(6, [45, 66]), 46.25, 0.01);
  near(F.keyPitchHz(5, [45, 66]), 43.65, 0.01);
  near(F.keyPitchHz(0, [120, 170]), 130.81, 0.01);
  const design = D.newKitDesign();
  assert.equal(design.kick.layers[0].keyTrack, 1);
  const inA = F.followDesign(design, 9, 140);
  near(inA.kick.layers[0].pitch, 55, 0.01);
  assert.equal(inA.kick.preset, 'punchKick');
  // Nothing to change: the same object; no key: the pitch stays
  assert.equal(F.followDesign(inA, 9, 140), inA);
  assert.equal(F.followDesign(design, null, 140).kick.layers[0].pitch, design.kick.layers[0].pitch);
  // A manual note doesn't follow
  const manual = { ...design, kick: D.withLayerValue(D.withLayerValue(design.kick, 0, 'keyTrack', 0), 0, 'pitch', 49) };
  assert.equal(F.followDesign(manual, 9, 140).kick.layers[0].pitch, 49);
  // From the song: an A minor bass line puts the kick on A
  const tracks = [
    { id: 'k', name: 'Kit', instrumentKey: 'designedKit', drumDesign: design },
    { id: 'b', name: 'Bass', instrumentKey: 'subBass' },
  ];
  const notes = ['A1', 'C2', 'E2', 'A1', 'G1', 'A1', 'E2', 'A1'].map((note, i) => ({ id: `n${i}`, note, startOffset: i / 8, duration: '8n', velocity: 0.8 }));
  const clips = [{ id: 'c', trackId: 'b', name: 'Bass', startBar: 1, lengthBars: 1, notes, isSelected: false }];
  const followed = F.followTracks(tracks, clips, 150);
  near(followed[0].drumDesign.kick.layers[0].pitch, 55, 0.01);
  assert.equal(F.followTracks(followed, clips, 150), null);
  // And the hit plays it: late in the tail it rings at 55 Hz
  const x = S.renderDrumSound(followed[0].drumDesign.kick, 'kick', SR, 1);
  near(M.measureKick(x, SR, 55).endHz, 55, 3);
});

test('layered drums render the same every time; the seed picks their noise', () => {
  for (const [id, row] of [['punchKick', 'kick'], ['hardcoreKick', 'kick'], ['bigSnare', 'snare'], ['gatedSnare', 'snare']]) {
    assert.deepEqual(render(id, row, 5), render(id, row, 5), id);
    assert.notDeepEqual(render(id, row, 5), render(id, row, 6), id);
  }
});

// ---------- the synthesized kits and the retired ones ----------

test('the synthesized kits play every row, each at its row loudness, under the ceiling', () => {
  for (const key of K.SYNTH_KITS) {
    assert.equal(INSTRUMENTS[key].kind, 'drums', key);
    assert.equal(INSTRUMENTS[key].samples, undefined, `${key} has no recordings`);
    for (const row of D.DESIGN_ROW_IDS) {
      const sound = K.SYNTH_KIT_DESIGNS[key][row];
      assert.ok(sound, `${key} ${row}`);
      const x = S.renderDrumSound(sound, row, 44100, 3);
      assert.ok(x.every(Number.isFinite) && S.peakOf(x) <= S.DRUM_CEILING + 1e-6, `${key} ${row}`);
      const loud = 20 * Math.log10(S.loudestRms(x, 44100));
      assert.ok(loud <= S.ROW_LOUDNESS[row] + sound.level + 0.01 && loud > S.ROW_LOUDNESS[row] + sound.level - 9, `${key} ${row}: ${loud}`);
    }
  }
  // A copy to start a Designed Kit from
  const copy = K.synthKitDesign('technoKit');
  copy.kick.level = -5;
  assert.notEqual(K.SYNTH_KIT_DESIGNS.technoKit.kick.level, -5);
});

test('the kits with no licence are gone; projects on them open on their replacements, on the same rows', () => {
  for (const key of ['linnDrum', 'cr78', 'acousticKit', 'bongos']) {
    assert.equal(INSTRUMENTS[key], undefined, key);
    assert.ok(!INSTRUMENT_KEYS.includes(key), key);
    assert.ok(INSTRUMENTS[RETIRED_INSTRUMENTS[key]], key);
  }
  for (const def of Object.values(INSTRUMENTS)) {
    const urls = [def.samples?.baseUrl, def.samples?.fallbackUrl].filter(Boolean);
    for (const u of urls) assert.ok(!u.includes('drum-samples'), `${def.key} loads ${u}`);
  }
  assert.equal(currentInstrumentKey('linnDrum'), 'retroDrumMachine');
  assert.equal(currentInstrumentKey('piano'), 'piano');
  const t = (id, instrumentKey) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: -2, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0 });
  const old = {
    name: 'Old kits', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false },
    tracks: [t('a', 'linnDrum'), t('b', 'cr78'), t('c', 'acousticKit'), t('d', 'bongos'), t('e', 'technoKit'), t('f', 'breakbeatKit')],
    clips: [{ id: 'c1', trackId: 'a', name: 'Beat', startBar: 1, lengthBars: 1, isSelected: false, notes: [{ id: 'n', note: 'C1', startOffset: 0, duration: '16n', velocity: 0.9 }, { id: 'm', note: 'D1', startOffset: 0.25, duration: '16n', velocity: 0.9 }] }],
    stingers: [{ id: 's', name: 'Hit', kind: 'victory', instrumentKey: 'cr78', variation: 0, notes: [], lengthBars: 1 }],
    costumes: [{ id: 'x', name: 'Retro', tempo: 1, tracks: { e: { instrument: 'linnDrum' } } }],
  };
  // (A file as this version writes it, with the old kits' names in it)
  const file = JSON.parse(JSON.stringify(serializeProject({ name: 'x', bpm: 120, swing: 0, loopRegion: old.loopRegion, tracks: old.tracks.map((x) => ({ ...x, instrumentKey: 'drums' })), clips: old.clips })));
  file.tracks.forEach((x, i) => (x.instrumentKey = old.tracks[i].instrumentKey));
  const back = parseProject({ ...file, stingers: old.stingers, costumes: old.costumes });
  assert.deepEqual(back.tracks.map((x) => x.instrumentKey), ['retroDrumMachine', 'rhythmBox', 'studioKit', 'latinPercussion', 'technoKit', 'breakbeatKit']);
  // The notes stay on their rows (C1 kick, D1 snare), the faders where they were
  assert.deepEqual(back.clips[0].notes.map((n) => n.note), ['C1', 'D1']);
  assert.equal(back.tracks[0].volume, -2);
  assert.equal(back.stingers[0].instrumentKey, 'rhythmBox');
  assert.equal(back.costumes[0].tracks.e.instrument, 'retroDrumMachine');
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

test('an accelerating roll goes 8ths, 16ths, 32nds, 64ths over the note, on the grid, louder as it goes', () => {
  const out = T.accelRoll([N('s', 'D1', 1, '1m', 1)], ids());
  const gaps = out.slice(1).map((n, i) => Math.round(ticks(n.startOffset - out[i].startOffset)));
  // A bar: a quarter at each rate (96, 48, 24, 12 ticks apart)
  assert.deepEqual([...new Set(gaps)], [96, 48, 24, 12]);
  assert.equal(out.length, 2 + 4 + 8 + 16);
  out.forEach((n) => near(ticks(n.startOffset), Math.round(ticks(n.startOffset)), 1e-6));
  near(out[0].startOffset, 1, 1e-9);
  near(out.at(-1).startOffset + durationToBars(out.at(-1).duration), 2, 1e-9);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].velocity > out[i - 1].velocity);
  near(out[0].velocity, 0.35, 1e-9);
  near(out.at(-1).velocity, 1, 1e-9);
  assert.equal(out[0].id, 's');
  assert.equal(new Set(out.map((n) => n.id)).size, out.length);
  // A beat is too short for 8ths: 16ths, 32nds, 64ths
  const beat = T.accelRoll([N('s', 'D1', 0, '4n', 1)], ids());
  assert.deepEqual([...new Set(beat.slice(1).map((n, i) => Math.round(ticks(n.startOffset - beat[i].startOffset))))], [48, 24, 12]);
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

test("a Designed Kit keeps its own design through a switch to a synthesized kit and back; Edit in Drum Designer starts from the kit's sounds", () => {
  const own = D.newKitDesign();
  own.kick = D.withLayerValue(own.kick, 0, 'decay', 0.31);
  // Designed Kit -> Techno Kit (the design stays on the track) -> Designed Kit: its own design
  assert.deepEqual(K.designedKitStart({ instrumentKey: 'technoKit', drumDesign: own }), {});
  // The Edit in Drum Designer button always starts from the kit's own sounds
  assert.deepEqual(K.designedKitStart({ instrumentKey: 'technoKit', drumDesign: own }, true).drumDesign, K.SYNTH_KIT_DESIGNS.technoKit);
  // A synthesized kit with nothing of its own: its sounds
  assert.deepEqual(K.designedKitStart({ instrumentKey: 'technoKit' }).drumDesign, K.SYNTH_KIT_DESIGNS.technoKit);
  // Started from one kit and not changed, then on another kit: the other kit's sounds
  assert.deepEqual(K.designedKitStart({ instrumentKey: 'rhythmBox', drumDesign: K.synthKitDesign('technoKit') }).drumDesign, K.SYNTH_KIT_DESIGNS.rhythmBox);
  // Another instrument: its own design kept, else a new kit
  assert.deepEqual(K.designedKitStart({ instrumentKey: 'drumMachine', drumDesign: own }), {});
  assert.deepEqual(K.designedKitStart({ instrumentKey: 'drumMachine' }).drumDesign, D.newKitDesign());
});

test('only a Designed Kit follows the song: a design kept on a track switched to another instrument stays as it was', () => {
  const design = D.newKitDesign();
  const notes = ['A1', 'C2', 'E2', 'A1'].map((note, i) => ({ id: `n${i}`, note, startOffset: i / 4, duration: '8n', velocity: 0.8 }));
  const clips = [{ id: 'c', trackId: 'b', name: 'Bass', startBar: 1, lengthBars: 1, notes, isSelected: false }];
  const tracks = [
    { id: 'k', name: 'Kit', instrumentKey: 'technoKit', drumDesign: design },
    { id: 'b', name: 'Bass', instrumentKey: 'subBass' },
  ];
  assert.equal(F.followTracks(tracks, clips, 150), null);
  const designed = [{ ...tracks[0], instrumentKey: 'designedKit' }, tracks[1]];
  near(F.followTracks(designed, clips, 150)[0].drumDesign.kick.layers[0].pitch, 55, 0.01);
});

test("with tempo changes a gated room holds an 8th at the tempo most of its own snares play at", () => {
  const design = { snare: D.presetSound('gatedSnare') };
  const hits = (from, to) => Array.from({ length: (to - from) * 2 }, (_, i) => ({ id: `s${from}-${i}`, note: 'D1', startOffset: i / 2, duration: '16n', velocity: 0.8 }));
  // 8 bars at 120, then 2 bars at 174 (from bar 9): most snares are at 120
  const clips = [
    { id: 'a', trackId: 'k', name: 'A', startBar: 1, lengthBars: 8, notes: hits(1, 9), isSelected: false },
    { id: 'b', trackId: 'k', name: 'B', startBar: 9, lengthBars: 2, notes: hits(9, 11), isSelected: false },
    // (Another track's notes at the other tempo don't count)
    { id: 'x', trackId: 'o', name: 'X', startBar: 9, lengthBars: 2, notes: hits(9, 11).concat(hits(9, 11)).concat(hits(9, 11)).concat(hits(9, 11)), isSelected: false },
  ];
  const points = [{ id: 't', bar: 9, bpm: 174, ramp: false }];
  const tracks = [{ id: 'k', name: 'Kit', instrumentKey: 'designedKit', drumDesign: design }];
  near(F.rowTempo('k', 'snare', clips, 120, points), 120, 1e-9);
  const at = (bpm, pts, cl = clips) => (F.followTracks(tracks, cl, bpm, pts) ?? tracks)[0].drumDesign.snare.layers[0].gateHold;
  near(at(120, points), F.gateHoldFor(120), 1e-9);
  // Most of them at 174 (the song starts at 90 and jumps at bar 3): an 8th at 174
  const late = [{ id: 't', bar: 3, bpm: 174, ramp: false }];
  near(F.rowTempo('k', 'snare', clips, 90, late), 174, 1e-9);
  near(at(90, late), F.gateHoldFor(174), 1e-9);
  // No tempo changes: the song's tempo, as before
  near(at(140, undefined), F.gateHoldFor(140), 1e-9);
  // No snares on the track: the tempo at its other notes, else at bar 1
  near(F.rowTempo('k', 'snare', [{ ...clips[1], notes: clips[1].notes.map((n) => ({ ...n, note: 'C1' })) }], 120, points), 174, 1e-9);
  near(F.rowTempo('k', 'snare', [], 120, points), 120, 1e-9);
});
