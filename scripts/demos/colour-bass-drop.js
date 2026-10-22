// A colour-bass drop (the sound the owner signed off on), built through the app's store and rendered by
// its export path (Loud master with Crunch, the app's MP3 encoder). 100 BPM, E phrygian.
// arg.vol: {track: dB}, arg.levels: true -> each track's own loudness, arg.crunch, arg.loud ('club'),
// arg.ott, arg.glue, arg.duck (style or false), arg.ceiling, arg.variant ('a' | 'b'), arg.stems: ['bass'] -> also a WAV of those tracks,
// arg.file: output name
const ex = await import('/src/audio/exportWav.ts');
const T = await import('/src/store/timelineTypes.ts');
const K = await import('/src/store/partKind.ts');
const { useTimelineStore } = await import('/src/store/timelineStore.ts');
const { FLEDGE_URL, FLEDGE_PRESETS } = await import('/src/audio/plugins/fledgeMacros.ts');
const { paramNamesOf } = await import('/src/audio/plugins/paramNames.ts');
const { withDive, withSlide } = await import('/src/store/slides.ts');
const { presetSound } = await import('/src/store/drumDesign.ts');
const { LOUD_TARGETS, integratedLufs } = await import('/src/audio/effects/loudMaster.ts');
const { midiOf, nameOf } = await import('/src/store/noteTools.ts');
const { durationToBars } = await import('/src/store/timelineTypes.ts');
const { encodeAudio } = await import('/src/audio/encoders.ts');
const { exportCeilingDbtp } = await import('/src/audio/effects/limiter.ts');
const sr = 44100;
// The app's MP3 export ceiling (lower with Crunch), unless asked
const CEIL = arg.ceiling ?? exportCeilingDbtp('mp3', arg.crunch ?? 1);
const V = arg.variant ?? 'a';

if (!paramNamesOf(FLEDGE_URL)) {
  const warm = mkTrack('w', 'plugin', T.defaultTrackFx(), { plugin: { id: 'warm', url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program: 0 } } });
  await ex.renderArrangement({ tracks: [warm], clips: [mkClip('wc', 'w', 1, 1, [{ note: 'C2', startOffset: 0 }])], bpm: 140, swing: 0, masterFx: T.DEFAULT_MASTER_FX, startBar: 1, endBar: 2, ending: 'exact', sampleRate: sr, bypassMaster: true });
}
const names = paramNamesOf(FLEDGE_URL);
const fledge = (id, preset, macros = {}, over = {}) => {
  const program = FLEDGE_PRESETS.indexOf(preset);
  if (program < 0) throw new Error('no preset ' + preset);
  const set = [...Object.entries(macros), ...Object.entries(over)];
  const values = set.length ? names.map((n) => { if (over[n] !== undefined) return over[n]; const m = n.match(/^Macro (\d)$/); return m && macros[m[1]] !== undefined ? macros[m[1]] : null; }) : undefined;
  // (The same plugin id as an earlier song's track is fine now: settings never seen live win)
  return { plugin: { id: 'p-' + id, url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program, ...(values ? { values } : {}) } } };
};
const len = (steps) => `0:0:${steps}`;
let uid = 0;
const N = (note, bar, step, steps, velocity = 0.85) => ({ id: 'x' + uid++, note: typeof note === 'number' ? nameOf(note) : note, startOffset: bar + step / 16, duration: typeof steps === 'string' ? steps : len(steps), velocity });
const m = (n) => (typeof n === 'number' ? n : midiOf(n));
const range = (n) => Array.from({ length: n }, (_, i) => i);
const dive = (s = 12, b = 1 / 32) => (n) => withDive(n, s, b);
const slide = (s, from = 0.5) => (n) => withSlide(n, s, from);
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const BARS = 21;
const tracks = [], clips = [];
const add = (id, key, notes, extra = {}, fxPatch = {}) => {
  const st = K.startSends(key, T.defaultTrackFx());
  const fx = { ...st.fx };
  for (const [k, v] of Object.entries(fxPatch)) fx[k] = { ...fx[k], ...v };
  tracks.push(mkTrack(id, key, fx, { reverbSend: st.reverbSend, ...extra }));
  clips.push({ id: 'c' + id, trackId: id, name: id, startBar: 1, lengthBars: BARS, isSelected: false, notes });
};
// ---------------------------------------------------------------------------------------------
// The music, rewritten from a transcription of the reference: pedal and
// riff harmony instead of a chord progression. E is home; the other roots sit a semitone (F) or a
// tritone (A#) away, every voice above moves by semitones, the top doubles the bass in octaves and
// fifths (power-chord stacks), hooks are syncopated repeated notes or long glided notes, 2-bar cycles.
// arg.take: 'a' tritone flip + repeated-note hook, 'b' E pedal + semitone cluster stabs,
// 'c' the bass carries a chromatic/tritone line that the lead doubles with glides.
// Bars 0-1 break, 2-3 build, 4-19 the drop (16 bars), 20 the end hit.
// ---------------------------------------------------------------------------------------------
const TAKE = arg.take ?? 'a';
// arg.newBass: one legato Fledge bass for all the riff notes (each held into the next) + a Clean Sub on the roots
// {preset, macros, over: {param: 0..1}, vol, subVol, hp (Hz), overlap (16ths), sub: false -> no sub track (the preset's own sub kept)}
const NB = arg.newBass;
const E1 = 28, F1 = 29, AS1 = 34, B1 = 35, C2 = 36;
// The root under drop bar i (0-15; the break uses 0-1) at 16th st
const rootAt = (i, st) => {
  const odd = i % 2 === 1, phraseEnd = i % 4 === 3;
  if (TAKE === 'a') {
    if (!odd) return st < 10 ? E1 : AS1;
    if (phraseEnd) return st < 4 ? AS1 : st < 10 ? E1 : st < 12 ? F1 : AS1;
    return st < 4 ? AS1 : st < 12 ? E1 : F1;
  }
  if (TAKE === 'b') return st < 12 ? E1 : phraseEnd ? AS1 : odd ? F1 : E1;
  // c: the same neighbour-note shape on E and a tritone away on A#:
  // E . . . . . . F . . E . . . . . | A# . . . . . . B . . A# . . . F .   (phrase end: A# . . . B . . . F . . . A# . . .)
  if (!odd) return st < 7 ? E1 : st < 10 ? F1 : E1;
  if (phraseEnd) return st < 4 ? AS1 : st < 8 ? B1 : st < 12 ? F1 : AS1;
  return st < 7 ? AS1 : st < 10 ? B1 : st < 14 ? AS1 : F1;
};
// The bass riffs: [step, octave/fifth/tritone over the root sounding at that step, length, which bass (A square, B formant, C chop), 'g' glide into the next note | fx]
// (Only octaves over the root, the tritone and fifth in the phrase-end run: the pitch class stays, the register leaps)
const RIFF_P = [
  [0, 0, 2, 'A'], [2, 12, 1, 'B'], [3, 0, 1, 'A'], [4, 0, 1, 'C'], [5, 12, 1, 'A'], [6, 24, 1, 'B', 'g'], [7, 0, 1, 'A'],
  [8, 0, 1, 'A'], [9, 12, 1, 'B'], [10, 0, 2, 'A', 'g'], [12, 12, 1, 'C'], [13, 0, 1, 'A'], [14, 0, 1, 'A'], [15, 24, 1, 'B', 'g'],
];
const RIFF_Q = [
  [0, 0, 1, 'A'], [1, 12, 1, 'A'], [2, 0, 1, 'B'], [3, 24, 1, 'B', 'g'], [4, 0, 2, 'A'], [6, 12, 1, 'C'], [7, 0, 1, 'A', 'g'],
  [8, 12, 2, 'B'], [10, 0, 1, 'A'], [11, 12, 1, 'A'], [12, 0, 1, 'C'], [13, 12, 1, 'A', 'g'], [14, 0, 1, 'A'], [15, 24, 1, 'B', 'g'],
];
// (The phrase end: up the octaves through the tritone in 16ths)
const RIFF_E = [
  [0, 0, 1, 'A'], [1, 12, 1, 'B'], [2, 0, 1, 'A'], [3, 6, 1, 'C'], [4, 12, 1, 'A'], [5, 18, 1, 'B'], [6, 12, 1, 'A'], [7, 24, 1, 'B'],
  [8, 0, 2, 'A', dive(12, 1 / 16)], [10, 12, 1, 'C'], [11, 0, 1, 'A'], [12, 6, 1, 'B'], [13, 7, 1, 'B'], [14, 12, 2, 'A', 'g'],
];
const bassN = { A: [], B: [], C: [] };
const playRiff = (riff, bar, i, vel = 0.9) => {
  const abs = riff.map(([st, off]) => rootAt(i, st) + off);
  riff.forEach(([st, , l, which, fx], k) => {
    let n = N(abs[k], bar, st, l, st % 4 === 0 ? vel : vel - 0.1 + 0.05 * rnd());
    if (fx === 'g' && NB) { /* (the legato bass glides into every joined note by itself) */ }
    else if (fx === 'g') { const next = k + 1 < riff.length ? abs[k + 1] : rootAt(i + 1, 0); const d = Math.max(-24, Math.min(24, next - abs[k])); if (d) n = withSlide(n, d, 0.5); }
    else if (fx) n = fx(n);
    bassN[which].push(n);
  });
};
const stabs = [], lead = [], riser = [], drums = [], dropFx = [];
// A stab: the root sounding at that step (the stab sound adds fifth and octave itself: a power chord); up = semitones over the root (1: the cluster chord a semitone up)
const stabAt = (bar, i, steps, vel = 0.85, up = 0) => steps.forEach(([st, l]) => stabs.push(N(rootAt(i, st) + 12 + up, bar, st, l, st % 4 === 0 ? vel : vel - 0.1)));
// Held stabs: the power chord sounds all the time, re-struck on the given steps and wherever the root moves (the reference's top is a sustained stack that follows the bass)
const stabHeld = (bar, i, steps, vel = 0.85) => {
  const at = new Set(steps.map(([st]) => st)); at.add(0);
  for (let st = 1; st < 16; st++) if (rootAt(i, st) !== rootAt(i, st - 1)) at.add(st);
  const s = [...at].sort((x, y) => x - y);
  s.forEach((st, k) => stabs.push(N(rootAt(i, st) + 12, bar, st, (s[k + 1] ?? 16) - st, st % 4 === 0 ? vel : vel - 0.1)));
};
const STABS = {
  a: [[[0, 2], [3, 1], [6, 1], [10, 2], [13, 1]], [[0, 1], [2, 1], [4, 2], [7, 1], [12, 2], [15, 1]]],
  b: [[[0, 3], [8, 2]], [[0, 2], [8, 1], [12, 3]]],
  c: [[[0, 2], [3, 1], [7, 2], [10, 2], [13, 1]], [[0, 2], [4, 2], [6, 1], [8, 2], [11, 1], [14, 2]]],
}[TAKE];
// Take b's cluster hits: the power chord a semitone over the root (F over E), syncopated
const CLUSTER = [[[6, 1], [7, 1], [10, 2], [13, 1]], [[3, 1], [6, 2], [9, 1], [11, 1]]];
// The lead
const C6 = 84, B5 = 83, F6 = 89, E6 = 88, F5 = 77, E5 = 76, DS5 = 75;
// One pitch re-struck on a 3+2+3+2+2+2 / 3+2+3+3+2+2 grid, held to the next hit; the cycle's last hit slips a semitone (B over the F: a tritone)
const HOOK_A = [
  [[2, C6, 3], [5, C6, 2], [7, C6, 3], [10, C6, 2], [12, C6, 2], [14, C6, 2]],
  [[0, C6, 1], [1, C6, 3], [4, C6, 2], [6, C6, 3], [9, C6, 3], [12, C6, 2], [14, B5, 2]],
  // phrase end: a jump to F6, then B5 falling a tritone to F5 over the A#
  [[1, C6, 3], [4, C6, 2], [6, C6, 3], [9, F6, 1], [10, E6, 2], [12, B5, 4, slide(-6, 0.4)]],
];
const leadBar = (i, bar, vel = 0.85) => {
  const odd = i % 2 === 1, phraseEnd = i % 4 === 3;
  const add = (st, note, l, fx, v = st % 4 === 0 ? vel : vel - 0.08) => { let n = N(note, bar, st, l, v); if (fx) n = fx(n); lead.push(n); };
  if (TAKE === 'a') {
    // the repeated note slips a semitone (C to B) in the last four bars
    const hook = !odd ? HOOK_A[0] : phraseEnd ? HOOK_A[2] : HOOK_A[1];
    hook.forEach(([st, note, l, fx]) => add(st, i >= 12 && note === C6 ? B5 : note, l, fx));
  } else if (TAKE === 'b') {
    // an E drone, re-struck each half bar; at phrase ends it bends down to D# and back to E
    if (phraseEnd) { add(0, E5, 8); add(8, E5, 4, slide(-1, 0.3)); add(12, DS5, 4, slide(1, 0.5)); }
    else if (odd) { add(0, E5, 8); add(8, F5, 2, slide(-1, 0.4)); add(10, E5, 6); }
    else { add(0, E5, 8); add(8, E5, 8); }
    if (i >= 8) add(0, i % 4 === 1 ? C6 : B5, 16, i % 4 === 1 ? slide(-1, 0.6) : undefined, vel - 0.15);
  } else {
    // the bass line two (three) octaves up, one long note per root, gliding into the next
    const segs = []; let cur = null;
    for (let st = 0; st < 16; st++) { const r = rootAt(i, st); if (!cur || cur.r !== r) segs.push((cur = { r, st, l: 0 })); cur.l++; }
    segs.forEach((s, k) => {
      const next = k + 1 < segs.length ? segs[k + 1].r : rootAt(i + 1, 0);
      const up = i >= 12 ? 60 : 48; // the last four bars an octave up
      let n = N(s.r + up, bar, s.st, s.l, s.st % 4 === 0 ? vel : vel - 0.05);
      if (next !== s.r && s.l >= 2) n = withSlide(n, Math.max(-24, Math.min(24, next - s.r)), s.l >= 4 ? 0.6 : 0.4);
      lead.push(n);
      // a repeated 16th on the long notes (re-struck off the 8th)
      if (s.l >= 6) lead.push(N(s.r + up, bar, s.st + 3, 1, vel - 0.2));
    });
  }
};

// Drums (Designed Kit rows): kick C1, snare D1, clap D#1, closed hat F#1, open hat A#1, crash C#2, tom low F1, tom mid B1
const KICKS = [[0, 2, 3, 6, 9, 11, 14], [0, 1, 3, 6, 8, 10, 13], [0, 2, 5, 7, 8, 10, 13, 15], [0, 3, 5, 6, 9, 10, 14]];
const HAT_VEL = [0.9, 0.82, 0.38, 0.5];
const hats16 = (bar, from = 0, to = 16, scale = 1) => { for (let st = from; st < to; st++) drums.push(N('F#1', bar, st, 1, Math.min(1, scale * (HAT_VEL[st % 4] + 0.06 * (rnd() - 0.5))))); };

// --- Break (bars 0-1): stabs, the lead, 8th hats
for (let b = 0; b < 2; b++) {
  stabAt(b, b, TAKE === 'b' ? [[0, 3], [8, 2]] : [[0, 2], [3, 1], [6, 1], [10, 1]], 0.45);
  leadBar(b, b, 0.7);
  for (let st = 0; st < 16; st += 2) drums.push(N('F#1', b, st, 1, st % 4 === 0 ? 0.55 : 0.4));
  drums.push(N('D1', b, 12, 1, 0.55));
}
drums.push(N('C#2', 0, 0, 16, 0.6));
if (arg.breakFilter !== false) dropFx.push(N('C#4', 0, 0, 32, 0.9));
// --- Build (bars 2-3): as before; the formant bass climbs E1 up octaves and the tritone
riser.push(N('C4', 2, 0, 31, 0.75));
leadBar(2, 2, 0.85); leadBar(3, 3, 0.85);
for (let st = 0; st < 16; st += 2) drums.push(N('D1', 2, st, 1, 0.3 + 0.2 * (st / 16)));
for (let st = 0; st < 12; st++) drums.push(N('D1', 3, st, 1, 0.5 + 0.25 * (st / 12)));
for (let k = 0; k < 6; k++) drums.push(N('D1', 3, 12 + k / 2, '32n', 0.75 + 0.04 * k));
hats16(2, 0, 16, 0.8); hats16(3, 0, 12, 0.9);
[[2, 0], [2, 8], [3, 0], [3, 4], [3, 8], [3, 10]].forEach(([b, st]) => drums.push(N('C1', b, st, 2, 0.9)));
[[2, 0, 0], [2, 8, 6], [3, 0, 12], [3, 4, 13], [3, 8, 18], [3, 10, 19], [3, 12, 24]].forEach(([b, st, off]) => bassN.B.push(N(E1 + off, b, st, 2, 0.75)));
stabAt(2, 0, [[0, 2], [8, 2]], 0.75); stabAt(3, 0, [[0, 2], [4, 2], [8, 2], [10, 2]], 0.8);

// --- The drop (bars 4-19)
for (let i = 0; i < 16; i++) {
  const b = 4 + i;
  const phraseEnd = i % 4 === 3, bigEnd = i === 7 || i === 15;
  // Bass: riff P and Q in turn, the run E in the second half of each phrase end
  const riff = phraseEnd ? [...RIFF_Q.filter(([s0]) => s0 < 8), ...RIFF_E.filter(([s0]) => s0 >= 8)] : i % 2 === 0 ? RIFF_P : RIFF_Q;
  playRiff(riff, b, i);
  if (arg.heldStabs === false) stabAt(b, i, STABS[i % 2], 0.85); else stabHeld(b, i, STABS[i % 2], 0.85);
  if (TAKE === 'b') stabAt(b, i, CLUSTER[i % 2], 0.8, 1);
  leadBar(i, b, 0.85);
  // Kicks: syncopated, a new pattern each bar, 1-3 16ths apart
  const kick = KICKS[(i + (i >> 2)) % 4];
  kick.forEach((st) => drums.push(N('C1', b, st, 1, st % 4 === 0 ? 1 : 0.88)));
  [4, 12].forEach((st) => drums.push(N('D1', b, st, 2, 1), N('D#1', b, st, 2, 0.6)));
  if (phraseEnd) hats16(b, 0, 12); else hats16(b, 0, i % 2 ? 14 : 16);
  if (!phraseEnd && i % 2) {
    if (i % 4 === 1) [14, 14 + 2 / 3, 15 + 1 / 3].forEach((s) => drums.push(N('F#1', b, s, '32n', 0.55)));
    else [14, 14.5, 15, 15.5].forEach((s, k) => drums.push(N('F#1', b, s, '32n', 0.55 + 0.1 * k)));
  }
  if (phraseEnd) {
    for (let k = 0; k < 8; k++) drums.push(N('D1', b, 12 + k / 2, '32n', 0.45 + 0.07 * k));
    if (bigEnd) [[8, 'D2'], [9, 'D2'], [10, 'B1'], [11, 'F1']].forEach(([st, t]) => drums.push(N(t, b, st, 1, 0.85)));
  }
  if (i % 4 === 1) drums.push(N('D1', b, 7, 1, 0.35));
  if (i % 8 === 0) drums.push(N('C#2', b, 0, 16, 0.75));
}
dropFx.push(N('C4', 7, 14, 2, 0.9), N('E4', 15, 8, 4, 0.9), N('C4', 11, 15, 1, 0.9), N('D4', 19, 12, 4, 0.9));
// --- The end (bar 20): one hit, the bass on E
drums.push(N('C1', 20, 0, 2, 1), N('C#2', 20, 0, 16, 0.8), N('D1', 20, 0, 2, 0.9));
bassN.A.push(N(E1, 20, 0, 8, 0.9)); stabs.push(N(E1 + 24, 20, 0, 6, 0.9)); lead.push(N('E5', 20, 0, 8, 0.8));

const kit = Object.fromEntries(Object.entries({ kick: arg.kick ?? 'crunchKick', snare: arg.snare ?? 'crunchSnare', clap: 'crackClap', closedHat: arg.hat ?? 'sharpHat', openHat: 'openHat', crash: 'crash' }).filter(([, v]) => presetSound(v)).map(([k, v]) => [k, presetSound(v)]));
const vol = { drums: -2.5, bassA: 4, bassB: 4, bassC: 2, stabs: -2, lead: -5, riser: -14, ...(arg.vol ?? {}) };
const wide = { chorus: { on: true, rate: 0.8, depth: 0.85, mix: 0.7 } };
// A parametric EQ: [low shelf 120 Hz, bell 1, bell 2, high shelf] gains (and the bells' Hz)
const eq = (lo, m1f, m1, m2f, m2, hif, hi, cut = 0) => ({ peq: { on: true, bands: [
  { on: false, type: 'lowcut', freq: 40, gain: 0, q: Math.SQRT1_2 }, { on: true, type: 'lowshelf', freq: 120, gain: lo, q: 0.7 },
  { on: true, type: 'bell', freq: m1f, gain: m1, q: 1 }, { on: true, type: 'bell', freq: m2f, gain: m2, q: 1 },
  { on: true, type: 'highshelf', freq: hif, gain: hi, q: 0.7 }, { on: cut > 0, type: 'highcut', freq: cut || 18000, gain: 0, q: Math.SQRT1_2 }] } });
const E_ = arg.eq ?? {};
const bassEq = eq(...(E_.bass ?? [-4, 170, 7, 450, -9, 4000, 8, 9000]));
for (const [row, dl] of Object.entries(arg.rowLevel ?? { closedHat: 4.5, snare: -6 })) if (kit[row]) kit[row].level = dl;
add('drums', 'designedKit', drums, { drumDesign: kit, volume: vol.drums }, eq(...(E_.drums ?? [0, 400, 0, 2500, 0, 4500, 5])));
if (NB) {
  // One voice: every riff note in time order, held into the next one when it follows within a 16th (legato: joined, glided)
  const all = [...bassN.A, ...bassN.B, ...bassN.C].sort((a, b) => a.startOffset - b.startOffset);
  const ov = NB.overlap ?? 0.1;
  const main = all.map((n, k) => {
    const next = all[k + 1];
    if (!next) return n;
    const end = n.startOffset + durationToBars(n.duration);
    if (next.startOffset - end > 1 / 16 - 1e-9 || next.startOffset <= n.startOffset) return n;
    return { ...n, duration: `0:0:${+((next.startOffset - n.startOffset) * 16 + ov).toFixed(4)}` };
  });
  // The sub: the root under each stretch of the drop, held into the next
  const subN = [];
  for (let i = 0; i < 16; i++) for (let st = 0; st < 16; st++) {
    const r = rootAt(i, st);
    const last = subN[subN.length - 1];
    if (last && last.r === r) last.steps++;
    else subN.push({ r, bar: 4 + i, st, steps: 1 });
  }
  const subNotes = subN.map((x) => N(x.r, x.bar, x.st, +(x.steps + ov).toFixed(4), 0.9));
  subNotes.push(N(E1, 20, 0, 8, 0.9));
  const hpEq = { peq: { ...bassEq.peq, bands: bassEq.peq.bands.map((b, k) => (k === 0 ? { ...b, on: (NB.hp ?? 0) > 0, freq: NB.hp || 40 } : b)) } };
  const subOff = NB.sub === false ? {} : { 'Sub level': 0 };
  add('bass', 'plugin', main, { ...fledge('bass', NB.preset ?? 'Bass/Driven Legato', NB.macros ?? {}, { ...subOff, ...(NB.over ?? {}) }), volume: NB.vol ?? 4, reverbSend: 0 }, hpEq);
  if (NB.sub !== false) add('sub', 'plugin', subNotes, { ...fledge('sub', 'Bass/Clean Sub', NB.subMacros ?? {}), volume: NB.subVol ?? 0, reverbSend: 0, name: 'Sub' });
} else {
add('bassA', 'plugin', bassN.A, { ...fledge('bassA', 'Bass/Clipped Square', arg.macA ?? {}), volume: vol.bassA, reverbSend: 0 }, { ...bassEq, chorus: { on: true, rate: 0.5, depth: 0.5, mix: arg.chorusA ?? 0.3 } });
add('bassB', 'plugin', bassN.B, { ...fledge('bassB', 'Bass/Crunch Formant', arg.macB ?? {}), volume: vol.bassB, reverbSend: 0 }, { ...bassEq, chorus: { on: true, rate: 0.6, depth: 0.6, mix: 0.45 } });
add('bassC', 'plugin', bassN.C, { ...fledge('bassC', 'Bass/Resample Chop'), volume: vol.bassC, reverbSend: 0 }, bassEq);
}
add('stabs', 'plugin', stabs, { ...fledge('stabs', 'Bass/Hard Clip Stab'), volume: vol.stabs, reverbSend: 0.05 }, { ...(arg.chorus === false ? {} : wide), ...eq(...(E_.stabs ?? [0, 300, -5, 600, -6, 4000, 6, 10000])) });
add('lead', 'plugin', lead, { ...fledge('lead', 'Lead/Chip Crunch'), volume: vol.lead, reverbSend: 0.12 }, { ...(arg.chorus === false ? {} : wide), ...eq(...(E_.lead ?? [0, 400, -5, 2500, 0, 5000, 5])) });
add('riser', 'plugin', riser, { ...fledge('riser', 'FX/Riser'), volume: vol.riser, reverbSend: 0.2 });
add('drop', 'dropPad', dropFx, { volume: 0 });

const toUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
async function mp3(chans, rate) {
  const enc = await createMp3Encoder();
  enc.configure({ sampleRate: rate, channels: 2, bitrate: 192 });
  const parts = [];
  for (let i = 0; i < chans[0].length; i += 65536) { const b = enc.encode(chans.map((c) => c.subarray(i, i + 65536))); if (b.length) parts.push(new Uint8Array(b)); }
  const f = enc.finalize(); if (f.length) parts.push(new Uint8Array(f));
  return new Blob(parts, { type: 'audio/mpeg' });
}
const health = (chans) => { let bad = 0, peak = 0; for (const c of chans) for (let i = 0; i < c.length; i++) { const v = c[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > peak) peak = Math.abs(v); } return { nonFinite: bad, peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(2) }; };

// arg.dump: return the pitched parts' notes (for the interval/rhythm stats) without rendering
if (arg.dump) return { out: { lead: lead.map((n) => [midiOf(n.note), +(n.startOffset * 16).toFixed(2), n.duration]), stabs: stabs.map((n) => [midiOf(n.note), +(n.startOffset * 16).toFixed(2)]), bass: [...bassN.A, ...bassN.B, ...bassN.C].map((n) => [midiOf(n.note), +(n.startOffset * 16).toFixed(2)]).sort((x, y) => x[1] - y[1]) }, wavs: {} };
useTimelineStore.setState({ tracks, clips, bpm: 100, master: T.defaultMasterSettings() });
const s = useTimelineStore.getState();
const ducked = arg.duck ? s.duckToKick(arg.duck) : 0;
// (The bass ducks under the kick only: the sub stays under the snare, as the reference's does)
if (arg.duck && arg.duckTrigger) useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map((t) => (t.fx.pump?.on && t.fx.pump.trigger === 'kickSnare' ? { ...t, fx: { ...t.fx, pump: { ...t.fx.pump, trigger: arg.duckTrigger, ...(arg.duckDepth ? { depth: arg.duckDepth } : {}) } } } : t)) });
// arg.pumps: {trackId: pump settings} put over what Duck to kick gave (to rebuild a render made with an older Duck to kick)
if (arg.pumps) useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map((t) => (arg.pumps[t.id] ? { ...t, fx: { ...t.fx, pump: { ...t.fx.pump, ...arg.pumps[t.id] } } } : t)) });
if (arg.level) useTimelineStore.getState().setMasterLevel(arg.level, false);
// arg.masterGlue: the master compressor's style ('off', 'tight'...)
if (arg.masterGlue) useTimelineStore.setState({ master: { ...useTimelineStore.getState().master, glue: arg.masterGlue } });
const glued = arg.glue ? useTimelineStore.getState().setGlueMix(true) : 0;
if (arg.ott) useTimelineStore.getState().setMasterOtt({ on: true, ...(typeof arg.ott === 'object' ? arg.ott : {}) });
const loud = arg.loud ?? 'club';
if (arg.loudOff !== true) useTimelineStore.getState().setMasterLoud({ on: true, target: loud, crunch: arg.crunch ?? 1, subTilt: arg.subTilt ?? 0 });
const st = useTimelineStore.getState();
const masterFx = { reverbDecay: st.reverbDecay ?? T.DEFAULT_MASTER_FX.reverbDecay, delayTime: st.delayTime ?? T.DEFAULT_MASTER_FX.delayTime, delayFeedback: st.delayFeedback ?? T.DEFAULT_MASTER_FX.delayFeedback };
const opts = { tracks: st.tracks, clips: st.clips, bpm: st.bpm, swing: 0, masterFx, master: st.master, startBar: 1, endBar: BARS + 1, ending: 'ringOut', sampleRate: sr, peakCeilingDbtp: CEIL, loudTargetLufs: arg.loudOff ? undefined : arg.lufs ?? LOUD_TARGETS[loud].lufs };
const out = { variant: V, ducked, glued, tracks: st.tracks.map((t) => `${t.id} vol ${t.volume} pump ${t.fx.pump?.on ? t.fx.pump.depth + ' ' + t.fx.pump.trigger : 'off'} glue ${t.fx.compressor?.on ? 'comp' : ''}`) };
const wavs = {};
if (arg.levels) {
  const lv = {};
  for (const t of st.tracks) {
    if (t.id === 'drop') continue;
    const b = await ex.renderArrangement({ ...opts, loudTargetLufs: undefined, bypassMaster: true, soundOnly: [t.id], startBar: arg.from ?? 5, endBar: arg.to ?? 21 });
    lv[t.id] = [+integratedLufs(b.getChannelData(0), b.getChannelData(1), sr).toFixed(1), health([b.getChannelData(0), b.getChannelData(1)]).peakDb];
    if ([].concat(arg.solo ?? []).includes(t.id)) wavs[t.id + '-solo'] = await toUrl(new Blob([ex.encodeChannels([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 16)]));
  }
  out.levels = lv;
  return { out, wavs };
}
let stats = null;
const t0 = performance.now();
const buf = await ex.renderArrangement({ ...opts, onMasterStats: (x) => (stats = x) });
const ch = [buf.getChannelData(0), buf.getChannelData(1)];
const file = arg.file ?? 'colour-bass-drop';
wavs[file + '-mp3'] = await toUrl(await encodeAudio(ch, buf.sampleRate, 'mp3', { bitDepth: 16 }));
Object.assign(out, { seconds: +(buf.length / buf.sampleRate).toFixed(2), renderMs: Math.round(performance.now() - t0), ...health(ch), lufs: +integratedLufs(ch[0], ch[1], buf.sampleRate).toFixed(2), loud: stats?.loud, limDb: stats?.limiterPeakDb, limBusy: stats?.limiterBusyShare, clip: stats?.clipper });
// Kick and snare times (s) for the hit check
const at = (n) => n.startOffset * 2.4 + 1105 / sr;
out.onsets = { kicks: drums.filter((n) => n.note === 'C1').map(at), snares: drums.filter((n) => n.note === 'D1' && n.velocity > 0.9).map(at) };
if (arg.stems) {
  // The bass parts alone through the same master settings, push as found (no match): the bass's own movement
  const master = { ...st.master, loud: { ...st.master.loud, push: stats?.loud?.push ?? st.master.loud.push } };
  const b = await ex.renderArrangement({ ...opts, master, loudTargetLufs: undefined, soundOnly: arg.stems });
  wavs[file + '-bass'] = await toUrl(new Blob([ex.encodeChannels([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 16)]));
}
if (arg.pre) {
  // The mix before the master section (32-bit float), whole and without arg.pre's tracks, for working the master offline; plus the master's settings
  const encF = (b) => toUrl(new Blob([ex.encodeChannels([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 32)]));
  wavs[file + '-prefull'] = await encF(await ex.renderArrangement({ ...opts, loudTargetLufs: undefined, bypassMaster: true }));
  wavs[file + '-prenobass'] = await encF(await ex.renderArrangement({ ...opts, loudTargetLufs: undefined, bypassMaster: true, soundOnly: st.tracks.map((t) => t.id).filter((id) => !arg.pre.includes(id)) }));
  out.master = st.master; out.push = stats?.loud?.push; out.ceil = CEIL;
}
if (arg.prem) {
  // The mix through the master chain up to the master section (glue included), Loud off and no limiting (ceiling +24 dBTP):
  // what masterAfter starts from, whole and without arg.prem's tracks (32-bit float); plus the master's settings
  const encF = (b) => toUrl(new Blob([ex.encodeChannels([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 32)]));
  const bare = { ...st.master, loud: { ...st.master.loud, on: false }, clipper: { ...(st.master.clipper ?? {}), on: false } };
  const o2 = { ...opts, master: bare, loudTargetLufs: undefined, peakCeilingDbtp: 24 };
  wavs[file + '-prefull'] = await encF(await ex.renderArrangement(o2));
  wavs[file + '-prenobass'] = await encF(await ex.renderArrangement({ ...o2, soundOnly: st.tracks.map((t) => t.id).filter((id) => !arg.prem.includes(id)) }));
  out.master = st.master; out.push = stats?.loud?.push; out.ceil = CEIL;
}
if (arg.ctx) {
  // The bass in context: the whole mix and the mix without the bass parts, through the same master at the push found (no match)
  const master = { ...st.master, loud: { ...st.master.loud, push: stats?.loud?.push ?? st.master.loud.push } };
  const enc = (b) => toUrl(new Blob([ex.encodeChannels([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 16)]));
  wavs[file + '-full'] = await enc(await ex.renderArrangement({ ...opts, master, loudTargetLufs: undefined }));
  wavs[file + '-nobass'] = await enc(await ex.renderArrangement({ ...opts, master, loudTargetLufs: undefined, soundOnly: st.tracks.map((t) => t.id).filter((id) => !arg.ctx.includes(id)) }));
}
return { out, wavs };
