// What Fledge Synth plays to be heard (fledgePhrases.ts): a phrase per preset category (basses a
// low riff with an overlapping pair, leads a tune, keys an arpeggio, chords and pads two held
// chords, effects one long note), two to three seconds long, at moderate velocities; the tour's
// presets exist; the loudness helpers measure and match; and every preset's phrase, played on the
// built engine, comes out within a few dB of the others and under full scale. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const P = await import('../src/audio/plugins/fledgePhrases.ts');
const { FLEDGE_PRESETS } = await import('../src/audio/plugins/fledgeMacros.ts');

test('each preset gets the phrase of its category', () => {
  assert.equal(P.phraseKind('Bass/Wobble'), 'bass');
  assert.equal(P.phraseKind('Lead/Supersaw'), 'lead');
  assert.equal(P.phraseKind('Keys/Glass Pluck'), 'keys');
  assert.equal(P.phraseKind('Chords/Future bass'), 'chords');
  assert.equal(P.phraseKind('Pad/Dark'), 'pad');
  assert.equal(P.phraseKind('FX/Riser'), 'fx');
  assert.equal(P.phraseKind('Init saw'), 'lead');
  assert.equal(P.phraseKind(undefined), 'lead');
  // Every preset's category is one the phrases know (none falls through to a lead by accident)
  for (const name of FLEDGE_PRESETS) {
    const cat = name.split('/')[0];
    if (name.includes('/')) assert.notEqual(P.phraseKind(name) === 'lead', cat !== 'Lead', name);
  }
});

const starts = (notes) => [...new Set(notes.map((n) => n.at))];

test('the phrases: short, in their range, at safe velocities, and shaped for their kind', () => {
  const range = { bass: [33, 50], lead: [60, 84], keys: [55, 80], chords: [40, 72], pad: [40, 72], fx: [55, 72] };
  for (const kind of Object.keys(range)) {
    const preset = { bass: 'Bass/Growl', lead: 'Lead/Rave', keys: 'Keys/Pluck', chords: 'Chords/Gated', pad: 'Pad/Glass', fx: 'FX/Laser' }[kind];
    const notes = P.presetPhrase(preset);
    const len = P.phraseLength(notes);
    assert.ok(len >= 1.5 && len <= 2.6, `${kind} lasts ${len} s`);
    for (const n of notes) {
      assert.ok(n.midi >= range[kind][0] && n.midi <= range[kind][1], `${kind} note ${n.midi}`);
      assert.ok(n.velocity >= 0.4 && n.velocity <= 0.85, `${kind} velocity ${n.velocity}`);
      assert.ok(n.length > 0 && n.at >= 0);
    }
    // In time order
    assert.deepEqual(notes.map((n) => n.at), [...notes.map((n) => n.at)].sort((a, b) => a - b));
  }
  // A bass riff ends in a pair that overlaps (legato: a preset with glide slides)
  const bass = P.presetPhrase('Bass/Wobble');
  assert.ok(bass.length >= 4);
  assert.ok(bass.some((a, i) => bass.slice(i + 1).some((b) => b.at > a.at && b.at < a.at + a.length && b.midi !== a.midi)));
  // A lead: one note at a time, moving
  const lead = P.presetPhrase('Lead/Sine');
  assert.equal(starts(lead).length, lead.length);
  assert.ok(new Set(lead.map((n) => n.midi)).size >= 4);
  // Keys: an arpeggio (one note at a time, never overlapping)
  const keys = P.presetPhrase('Keys/Bell');
  assert.ok(keys.length >= 6);
  keys.forEach((n, i) => i && assert.ok(keys[i - 1].at + keys[i - 1].length <= n.at + 1e-9));
  // Chords and pads: two held chords of three notes or more
  for (const name of ['Chords/Silk Stack', 'Pad/Warm strings']) {
    const notes = P.presetPhrase(name);
    assert.equal(starts(notes).length, 2, name);
    for (const at of starts(notes)) {
      const chord = notes.filter((n) => n.at === at);
      assert.ok(chord.length >= 3);
      assert.ok(chord.every((n) => n.length >= 0.9), 'held');
    }
  }
  // Effects: one long note
  const fx = P.presetPhrase('FX/Reverse Swell');
  assert.equal(fx.length, 1);
  assert.ok(fx[0].length >= 2);
});

test('the tour before adding: a bass, a lead and chords, about six to eight seconds', () => {
  assert.deepEqual(P.TOUR_PRESETS.map(P.phraseKind), ['bass', 'lead', 'chords']);
  for (const p of P.TOUR_PRESETS) assert.ok(FLEDGE_PRESETS.includes(p), p);
  // Each phrase ends before the next one starts
  for (const p of P.TOUR_PRESETS) assert.ok(P.phraseLength(P.presetPhrase(p)) <= P.TOUR_STEP);
  const total = (P.TOUR_PRESETS.length - 1) * P.TOUR_STEP + P.phraseLength(P.presetPhrase(P.TOUR_PRESETS.at(-1))) + P.PHRASE_TAIL;
  assert.ok(total >= 6 && total <= 8.5, `${total} s`);
});

test('loudness: measured from the blocks that sound, and matched under a peak ceiling', () => {
  const sr = 48000;
  const sine = (amp, seconds) => Float32Array.from({ length: sr * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / sr));
  // A sine's power is half its peak squared: -3 dB from its peak
  assert.ok(Math.abs(P.loudnessDb([sine(0.5, 1), sine(0.5, 1)], sr) - (20 * Math.log10(0.5) - 3.01)) < 0.1);
  // Silence after it doesn't make it quieter; silence alone is -Infinity
  const withGap = Float32Array.from({ length: sr * 2 }, (_, i) => (i < sr ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr) : 0));
  assert.ok(Math.abs(P.loudnessDb([withGap], sr) - P.loudnessDb([sine(0.5, 1)], sr)) < 0.1);
  assert.equal(P.loudnessDb([new Float32Array(sr)], sr), -Infinity);
  // Matched: to the target, unless that would take the peak over the ceiling
  const g = P.matchGain([sine(0.1, 1)], sr, -20);
  assert.ok(Math.abs(P.loudnessDb([sine(0.1 * g, 1)], sr) + 20) < 0.1);
  assert.ok(Math.abs(P.matchGain([sine(0.1, 1)], sr, 0, -3) - 10 ** (-3 / 20) / 0.1) < 1e-6);
  assert.equal(P.matchGain([new Float32Array(10)], sr, -20), 1);
});

// The built engine, as the app plays it (scripts/fledgeSound.test.mjs does the same)
const { instance: { exports: e } } = await WebAssembly.instantiate(readFileSync(new URL('../public/fledgetone-plugins/fledge.wasm', import.meta.url)));
const text = (p) => {
  const m = new Uint8Array(e.memory.buffer);
  let end = p;
  while (m[end]) end++;
  return Buffer.from(m.subarray(p, end)).toString('utf8');
};
const SR = 48000;
function play(program, notes) {
  const h = e.bb_create(0, SR);
  e.bb_set_program(h, program);
  e.bb_tempo(h, P.PHRASE_BPM);
  const events = notes.flatMap((n) => [[Math.round(n.at * SR), 0x90, n.midi, Math.round(n.velocity * 127)], [Math.round((n.at + n.length) * SR), 0x80, n.midi, 0]]).sort((a, b) => a[0] - b[0]);
  const total = Math.round((P.phraseLength(notes) + P.PHRASE_TAIL) * SR);
  const out = [new Float32Array(total), new Float32Array(total)];
  let at = 0;
  let k = 0;
  while (at < total) {
    while (k < events.length && events[k][0] <= at) e.bb_midi(h, ...events[k++].slice(1));
    const len = Math.max(1, Math.min(128, (k < events.length ? events[k][0] : total) - at, total - at));
    e.bb_process(h, len);
    out[0].set(new Float32Array(e.memory.buffer, e.bb_buffer(h, 2), len), at);
    out[1].set(new Float32Array(e.memory.buffer, e.bb_buffer(h, 3), len), at);
    at += len;
  }
  e.bb_destroy(h);
  return out;
}

test('every preset’s phrase on the engine: within a few dB of the basses, never near full scale', () => {
  const levels = FLEDGE_PRESETS.map((name, i) => {
    const out = play(i, P.presetPhrase(name));
    let peak = 0;
    for (const ch of out) for (const v of ch) peak = Math.max(peak, Math.abs(v));
    return { name, db: P.loudnessDb(out, SR), peak: 20 * Math.log10(peak) };
  });
  const basses = levels.filter((l) => l.name.startsWith('Bass/')).map((l) => l.db).sort((a, b) => a - b);
  const median = basses[Math.floor(basses.length / 2)];
  for (const l of levels) {
    assert.ok(l.peak < -0.5, `${l.name} peaks at ${l.peak.toFixed(1)} dBFS`);
    // None much louder than the basses (effects may be quieter: a sweep starts low)
    assert.ok(l.db <= median + 5, `${l.name} ${l.db.toFixed(1)} dB vs the basses' ${median.toFixed(1)}`);
    assert.ok(l.db >= median - (l.name.startsWith('FX/') ? 13 : 7), `${l.name} ${l.db.toFixed(1)} dB vs the basses' ${median.toFixed(1)}`);
  }
});
