// Two melodic pieces in the vocabulary of the owner's melodic references, built
// through the app's store and rendered by its export path (the app's MP3 encoder), the pattern of colour-bass-drop.js.
// arg.take: 'a' artcore, 175 BPM, Eb major (piano runs, held wash, supersaw hook) |
//           'b' future bass, 130 BPM, A major (chord chops, held vocal-like lead, legato bass)
// arg.vol {track: dB}, arg.levels (each track's own loudness), arg.crunch, arg.loud, arg.lufs, arg.musicPump (dB, music parts),
// arg.dump (notes only), arg.stems [track ids] -> also a WAV of those tracks, arg.file
const ex = await import('/src/audio/exportWav.ts');
const T = await import('/src/store/timelineTypes.ts');
const K = await import('/src/store/partKind.ts');
const { useTimelineStore } = await import('/src/store/timelineStore.ts');
const { FLEDGE_URL, FLEDGE_PRESETS } = await import('/src/audio/plugins/fledgeMacros.ts');
const { paramNamesOf } = await import('/src/audio/plugins/paramNames.ts');
const { withSlide } = await import('/src/store/slides.ts');
const { presetSound } = await import('/src/store/drumDesign.ts');
const { LOUD_TARGETS, integratedLufs } = await import('/src/audio/effects/loudMaster.ts');
const { midiOf, nameOf } = await import('/src/store/noteTools.ts');
const { durationToBars } = await import('/src/store/timelineTypes.ts');
const { encodeAudio } = await import('/src/audio/encoders.ts');
const { exportCeilingDbtp } = await import('/src/audio/effects/limiter.ts');
const { depthOfDb } = await import('/src/audio/effects/duckShape.ts');
const sr = 44100;
const TAKE = arg.take ?? 'a';
const CRUNCH = arg.crunch ?? 0;
const CEIL = arg.ceiling ?? exportCeilingDbtp('mp3');

if (!paramNamesOf(FLEDGE_URL)) {
  const warm = mkTrack('w', 'plugin', T.defaultTrackFx(), { plugin: { id: 'warm', url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program: 0 } } });
  await ex.renderArrangement({ tracks: [warm], clips: [mkClip('wc', 'w', 1, 1, [{ note: 'C2', startOffset: 0 }])], bpm: 140, swing: 0, masterFx: T.DEFAULT_MASTER_FX, startBar: 1, endBar: 2, ending: 'exact', sampleRate: sr, bypassMaster: true });
}
const names = paramNamesOf(FLEDGE_URL);
// A Fledge track: its own plugin id per take and track; macros {n: 0..1}; over {param name: normalised 0..1}
const fledge = (id, preset, macros = {}, over = {}) => {
  const program = FLEDGE_PRESETS.indexOf(preset);
  if (program < 0) throw new Error('no preset ' + preset);
  const set = [...Object.entries(macros), ...Object.entries(over)];
  const values = set.length ? names.map((n) => { if (over[n] !== undefined) return over[n]; const m = n.match(/^Macro (\d)$/); return m && macros[m[1]] !== undefined ? macros[m[1]] : null; }) : undefined;
  return { plugin: { id: `mel-${TAKE}-${id}`, url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program, ...(values ? { values } : {}) } } };
};
const lin = (v, a, b) => (v - a) / (b - a);
const logn = (v, a, b) => Math.log(v / a) / Math.log(b / a);
let uid = 0;
const m = (n) => (typeof n === 'number' ? n : midiOf(n));
// A note at absolute 16th `at` (from bar 0), `steps` long
const N = (note, at, steps, velocity = 0.8) => ({ id: 'x' + uid++, note: nameOf(m(note)), startOffset: Math.max(0, at) / 16, duration: `0:0:${+Math.max(0.25, steps - (at < 0 ? -at : 0)).toFixed(4)}`, velocity: Math.max(0.05, Math.min(1, velocity)) });
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const range = (n) => Array.from({ length: n }, (_, i) => i);

// ---------------------------------------------------------------------------------------------
// Version 2 (owner: "after the opening the melody and synth go everywhere"): ONE lead carries ONE tune, a 4-bar
// sung phrase in A A' A B form (the same notes every time; only the phrase endings differ), grown from what the
// opening already plays. Chords change once a bar on the barline (rich voicings kept), held or in one steady
// rhythm, all under the tune; no runs, counter-lines or bells while it sings; the bass holds the root.
// ---------------------------------------------------------------------------------------------
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const pcs = (s) => s.split(' ').map((x) => PC[x]);
const CH = TAKE === 'a' ? {
  // Eb major
  Ab: { name: 'Abmaj9', bass: 44, voicing: [60, 63, 67, 68, 70], tones: pcs('Ab C Eb G Bb') },
  G7: { name: 'G7(b9)', bass: 43, voicing: [59, 62, 65, 68], tones: pcs('G B D F Ab') },
  Cm: { name: 'Cm9', bass: 48, voicing: [58, 62, 63, 67], tones: pcs('C Eb G Bb D') },
  CmBb: { name: 'Cm9/Bb', bass: 46, voicing: [58, 62, 63, 67], tones: pcs('C Eb G Bb D') },
  Fm: { name: 'Fm9', bass: 41, voicing: [56, 60, 63, 67], tones: pcs('F Ab C Eb G') },
  Bb: { name: 'Bb13sus4', bass: 46, voicing: [56, 60, 63, 67], tones: pcs('Bb Eb Ab C G') },
  Abm: { name: 'Abm6(maj7)', bass: 44, voicing: [59, 63, 65, 67], tones: pcs('Ab Cb Eb F G') },
  EbG: { name: 'Ebmaj9/G', bass: 43, voicing: [58, 62, 63, 65], tones: pcs('Eb G Bb D F') },
  Eb: { name: 'Ebmaj9', bass: 39, voicing: [58, 62, 63, 67], tones: pcs('Eb G Bb D F') },
} : {
  // A major
  A: { name: 'Amaj9', bass: 45, voicing: [61, 64, 68, 69, 71], tones: pcs('A C# E G# B') },
  BA: { name: 'B/A', bass: 45, voicing: [63, 66, 69, 71], tones: pcs('B D# F# A') },
  Fsm: { name: 'F#m11', bass: 42, voicing: [61, 64, 69, 71], tones: pcs('F# A C# E B') },
  G: { name: 'Gmaj9', bass: 43, voicing: [62, 66, 67, 69], tones: pcs('G B D F# A') },
  E7: { name: 'E7sus4(9)', bass: 40, voicing: [62, 66, 69, 71], tones: pcs('E A B D F#') },
  D: { name: 'Dmaj9', bass: 38, voicing: [61, 64, 66, 69], tones: pcs('D F# A C# E') },
  Dm: { name: 'Dm9', bass: 38, voicing: [60, 64, 65, 69], tones: pcs('D F A C E') },
  Csm: { name: 'C#m7', bass: 37, voicing: [59, 64, 68, 71], tones: pcs('C# E G# B') },
};
// The 4-bar phrases' chords, one a bar on the barline
const PH = TAKE === 'a'
  ? { A: ['Ab', 'G7', 'Cm', 'CmBb'], A2: ['Ab', 'G7', 'Cm', 'Bb'], B: ['Fm', 'Bb', 'Abm', 'EbG'] }
  : { A: ['A', 'BA', 'Fsm', 'G'], A2: ['A', 'BA', 'Fsm', 'E7'], B: ['D', 'Dm', 'Csm', 'E7'] };
// THE tune: [16th in the phrase, midi, length]. Mostly chord tones on the strong beats, each phrase ends on a held stable note.
const TUNE = TAKE === 'a' ? {
  //        bar 1 (Abmaj9): Eb  G   Ab- G |  bar 2 (G7b9): F-  Eb D  B  |  bar 3 (Cm9): C  Eb  G-  F | bar 4: Eb (held)
  A: [[0, 75, 4], [4, 79, 4], [8, 80, 6], [14, 79, 2], [16, 77, 6], [22, 75, 2], [24, 74, 4], [28, 71, 4], [32, 72, 4], [36, 75, 4], [40, 79, 6], [46, 77, 2], [48, 75, 12]],
  //        same three bars, bar 4 (Bb13sus): D C Bb (open, a half cadence)
  A2end: [[48, 74, 4], [52, 72, 4], [56, 70, 4]],
  //        the answer: bar 1 (Fm9): C6 Ab G F | bar 2 (Bb13sus): Eb- F G- | bar 3 (Abm6maj7): Ab- G F Eb | bar 4 (Eb/G): Eb (held, home)
  B: [[0, 84, 6], [6, 80, 2], [8, 79, 4], [12, 77, 4], [16, 75, 6], [22, 77, 2], [24, 79, 8], [32, 80, 6], [38, 79, 2], [40, 77, 4], [44, 75, 4], [48, 75, 14]],
} : {
  //        bar 1 (Amaj9): C# E A | bar 2 (B/A): F# D# B | bar 3 (F#m11): C# E F# | bar 4 (Gmaj9): B (held)      (3+3+2 every bar)
  A: [[0, 73, 6], [6, 76, 6], [12, 81, 4], [16, 78, 6], [22, 75, 6], [28, 71, 4], [32, 73, 6], [38, 76, 6], [44, 78, 4], [48, 71, 12]],
  //        bar 4 (E7sus4): E (held: open)
  A2end: [[48, 76, 12]],
  //        the answer: bar 1 (Dmaj9): F# E C# | bar 2 (Dm9): F E D | bar 3 (C#m7): E G# B | bar 4 (E7sus4): B A G# -> home on A (bar 24)
  B: [[0, 78, 6], [6, 76, 6], [12, 73, 4], [16, 77, 6], [22, 76, 6], [28, 74, 4], [32, 76, 6], [38, 80, 6], [44, 83, 4], [48, 83, 6], [54, 81, 6], [60, 80, 4]],
};
const tuneOf = (kind) => (kind === 'B' ? TUNE.B : kind === 'A2' ? [...TUNE.A.filter(([s]) => s < 48), ...TUNE.A2end] : TUNE.A);
// The form: [first bar, phrase kind] - intro 0-7, drop 8-23 (A A' A B), end 24-25
const FORM = [[0, 'A'], [4, 'A2'], [8, 'A'], [12, 'A2'], [16, 'A'], [20, 'B']];
const PLAN = [];
for (const [b0, kind] of FORM) PH[kind].forEach((c, i) => (PLAN[b0 + i] = c));
const END = 384;
PLAN[24] = TAKE === 'a' ? 'Ab' : 'A'; PLAN[25] = TAKE === 'a' ? 'Eb' : 'A'; PLAN[26] = PLAN[25];
const BPM = TAKE === 'a' ? 175 : 130;
const SONG = { loop: PLAN.map((c, b) => ({ from: b * 16, to: b * 16 + 16, name: CH[c].name, bass: CH[c].bass })) };
const chordAt = (t) => CH[PLAN[Math.max(0, Math.min(PLAN.length - 1, Math.floor(t / 16)))]];
const toneRange = (c, lo, hi) => range(hi - lo + 1).map((i) => lo + i).filter((p) => c.tones.includes(((p % 12) + 12) % 12));
const P = { piano: [], wash: [], stack: [], lead: [], lead2: [], counter: [], bass: [], sub: [], riser: [], drums: [], keys: [] };
const bars = (a, b) => range(b - a).map((i) => a + i);
// Held chords, one per bar (cap: voicing notes above it go down an octave, so the chords stay under the tune)
const held = (part, b0, b1, vel, cap = 99, shift = 0) => bars(b0, b1).forEach((b) => chordAt(b * 16).voicing.forEach((p) => { let q = p + shift; while (q > cap) q -= 12; part.push(N(q, b * 16, 16.1, vel)); }));
// The same chord struck 3+3+2 (the opening's rhythm), each hit held to the next
const struck = (part, b0, b1, vel, cap = 99, withBass = false) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16);
  [[0, 6], [6, 6], [12, 4]].forEach(([st, l], k) => [...(withBass ? [c.bass + 12] : []), ...c.voicing].forEach((p) => { let q = p; while (q > cap) q -= 12; part.push(N(q, b * 16 + st, l + 0.15, k ? vel - 0.08 : vel)); }));
});
const tune = (b0, kind, vel, shift = 0, part = P.lead) => tuneOf(kind).forEach(([st, p, l]) => part.push(N(p + shift, b0 * 16 + st, l + 0.1, st % 8 === 0 ? vel : vel - 0.06)));
// The bass: the root held all bar, the octave on the bar's last beat (one move a bar), legato
const bassBars = (b0, b1, octave = true) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16);
  if (octave) { P.bass.push(N(c.bass, b * 16, 12.12, 0.85)); P.bass.push(N(c.bass + 12, b * 16 + 12, 4.12, 0.75)); }
  else P.bass.push(N(c.bass, b * 16, 16.12, 0.85));
  P.sub.push(N(c.bass - 12, b * 16, 16.12, 0.85));
});
const D = (row, t, l = 1, v = 0.8) => P.drums.push(N(row, t, l, v));

if (TAKE === 'a') {
  // --- Intro, the opening the owner liked: bars 0-3 piano alone in 8th broken chords; 4-7 the same plus the tune
  //     (phrase A') on the piano, wash and bass come in, hats; 6-7 the breakbeat at half weight and a short fill.
  const broken = (b0, b1, vel, hi = 72) => bars(b0, b1).forEach((b) => {
    const c = chordAt(b * 16), tones = toneRange(c, 55, hi);
    [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, b * 16, 16, vel + 0.05)));
    for (let st = 0; st < 16; st += 2) P.piano.push(N(tones[[0, 2, 1, 3, 2, 4, 3, 1][st >> 1] % tones.length], b * 16 + st, 2.5, [0, 6, 12].includes(st) ? vel : vel - 0.15));
  });
  broken(0, 8, 0.62);
  tune(4, 'A2', 0.66, 0, P.keys);          // the tune itself, first heard on the piano
  held(P.wash, 4, 8, 0.5);
  bassBars(4, 8, false);
  P.riser.push(N('C4', 96, 32, 0.6));
  // --- Drop (bars 8-23): the lead sings A A' A B; piano keeps its 8th broken chords but under the tune (to C5),
  //     a held wash and a held supersaw stack under the tune; the octave double only in the last A B.
  broken(8, 24, 0.6, 70);
  held(P.wash, 8, 24, 0.55);
  held(P.stack, 8, 24, 0.7, 70);
  [[8, 'A'], [12, 'A2'], [16, 'A'], [20, 'B']].forEach(([b, k]) => tune(b, k, 0.88));
  [[16, 'A'], [20, 'B']].forEach(([b, k]) => tune(b, k, 0.62, 12, P.lead2));
  // a 4-note piano pickup only in the gap between phrases (the last beat before the next phrase), under the lead's next note
  [11, 15, 19].forEach((b) => { const c = chordAt((b + 1) * 16), up = toneRange(c, 60, 75); [12, 13, 14, 15].forEach((st, i) => P.piano.push(N(up[up.length - 4 + i], b * 16 + st, 1.2, 0.55 + 0.04 * i))); });
  bassBars(8, 24);
  // --- End: Abmaj9 then Ebmaj9, the tune's home note held
  [[24, 16, 'Ab'], [25, 24, 'Eb']].forEach(([b, l, k]) => { const c = CH[k]; c.voicing.forEach((p) => P.wash.push(N(p, b * 16, l, 0.55))); [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, b * 16, l, 0.7))); toneRange(c, 60, 75).forEach((p, i) => P.piano.push(N(p, b * 16 + i, l - i, 0.58))); P.bass.push(N(c.bass, b * 16, l + 0.1, 0.8)); P.sub.push(N(c.bass - 12, b * 16, l, 0.8)); });
  P.lead.push(N(75, END, 30, 0.8));
  // --- Drums: as before (two-step breakbeat under the music), fills only at phrase ends
  for (let bar = 4; bar < 8; bar++) range(8).forEach((k) => D('F#1', bar * 16 + 2 * k, 1, k % 2 ? 0.42 : 0.3));
  [96, 112].forEach((t) => { D('C1', t, 2, 0.6); D('C1', t + 10, 2, 0.5); D('D1', t + 4, 2, 0.5); D('D1', t + 12, 2, 0.55); });
  [[120, 'D1'], [121, 'D1'], [122, 'D2'], [123, 'D2'], [124, 'B1'], [125, 'B1'], [126, 'F1'], [127, 'D1']].forEach(([t, r], k) => D(r, t, 1, 0.5 + 0.05 * k));
  D('C1', 64, 2, 0.8); D('C#2', 64, 16, 0.4);
  for (let bar = 8; bar < 24; bar++) {
    const t = bar * 16, i = bar - 8, odd = i % 2 === 1, phraseEnd = i % 8 === 7;
    (odd ? [0, 6, 10] : [0, 10]).forEach((st) => D('C1', t + st, 2, st ? 0.85 : 0.95));
    [4, 12].forEach((st) => { D('D1', t + st, 2, 0.95); D('D#1', t + st, 2, 0.5); });
    (odd ? [7, 9, 15] : [14]).forEach((st) => D('D1', t + st, 1, 0.28));
    range(8).forEach((k) => D(i >= 8 ? 'D#2' : 'F#1', t + 2 * k, 1, k % 2 ? 0.55 : 0.4));
    [3, 11].forEach((st) => D('F#1', t + st, 1, 0.25));
    if (phraseEnd) [8, 10, 12, 13, 14, 15].forEach((st, k) => D(k < 2 ? 'B1' : 'F1', t + st, 1, 0.6 + 0.05 * k));
    if (i % 8 === 0) D('C#2', t, 16, 0.6);
    if (i % 4 === 3 && !phraseEnd) D('A#1', t + 14, 2, 0.45);
  }
  D('C1', END, 2, 0.9); D('C#2', END, 16, 0.6);
} else {
  // --- Intro, the opening the owner liked: electric piano struck 3+3+2 (bars 0-7) over a soft wash; in bars 4-7
  //     the lead sings the tune (phrase A') softly, the bass holds roots, hats and claps come in.
  struck(P.keys, 0, 8, 0.62, 99, true);
  held(P.wash, 0, 4, 0.36); held(P.wash, 4, 8, 0.48);
  tune(4, 'A2', 0.6);
  bassBars(4, 8, false);
  P.riser.push(N('E4', 96, 32, 0.6));
  // --- Drop: the lead sings A A' A B; the chords struck in the same 3+3+2 (kept under the tune, to A4), the held
  //     wash, the bass on the root with one octave a bar; the sine octave double only in the last A B.
  struck(P.stack, 8, 24, 0.82, 69);
  held(P.wash, 8, 24, 0.55, 69);
  [[8, 'A'], [12, 'A2'], [16, 'A'], [20, 'B']].forEach(([b, k]) => tune(b, k, 0.88));
  [[16, 'A'], [20, 'B']].forEach(([b, k]) => tune(b, k, 0.6, 12, P.lead2));
  bassBars(8, 24);
  // --- End: Amaj9, the tune lands home on A5
  const c0 = CH.A;
  c0.voicing.forEach((p) => { P.wash.push(N(p, END, 24, 0.55)); P.keys.push(N(p, END, 24, 0.62)); });
  P.keys.push(N(c0.bass, END, 24, 0.65)); P.lead.push(N(81, END, 16, 0.85));
  P.bass.push(N(c0.bass, END, 20, 0.8)); P.sub.push(N(c0.bass - 12, END, 20, 0.8));
  // --- Drums: as before
  for (let bar = 4; bar < 8; bar++) range(16).forEach((st) => D('F#1', bar * 16 + st, 1, st % 4 === 2 ? 0.4 : st % 2 ? 0.18 : 0.28));
  for (let bar = 4; bar < 8; bar++) [4, 12].forEach((st) => D('D#1', bar * 16 + st, 1, 0.4 + 0.04 * (bar - 4)));
  for (let k = 0; k < 8; k++) D('D#1', 120 + k, 1, 0.45 + 0.05 * k);
  D('C1', 64, 2, 0.8); D('C#2', 64, 16, 0.4);
  for (let bar = 8; bar < 24; bar++) {
    const t = bar * 16, i = bar - 8, odd = i % 2 === 1;
    (odd ? [0, 7, 10] : [0, 10]).forEach((st) => D('C1', t + st, 2, st ? 0.85 : 0.95));
    [4, 12].forEach((st) => { D('D1', t + st, 2, 0.95); D('D#1', t + st, 2, 0.7); });
    range(16).forEach((st) => D('F#1', t + st, 1, st % 4 === 2 ? 0.5 : st % 2 ? 0.22 : 0.35));
    if (odd) D('A#1', t + 14, 2, 0.4);
    if (i % 4 === 3) [13, 13 + 2 / 3, 14 + 1 / 3, 15].forEach((s, k) => D('F#1', t + s, 0.6, 0.4 + 0.08 * k));
    if (i % 8 === 0) D('C#2', t, 16, 0.6);
  }
  D('C1', END, 2, 0.9); D('C#2', END, 16, 0.55);
}

// ---------------------------------------------------------------------------------------------
// Tracks, levels, effects
// ---------------------------------------------------------------------------------------------
const BARS = 27;
const tracks = [], clips = [];
const add = (id, key, notes, extra = {}, fxPatch = {}) => {
  if (!notes.length) return;
  const st = K.startSends(key, T.defaultTrackFx());
  const fx = { ...st.fx };
  for (const [k, v] of Object.entries(fxPatch)) fx[k] = { ...fx[k], ...v };
  tracks.push(mkTrack(id, key, fx, { reverbSend: st.reverbSend, ...extra }));
  clips.push({ id: 'c' + id, trackId: id, name: id, startBar: 1, lengthBars: BARS, isSelected: false, notes });
};
const eq = (lo, m1f, m1, m2f, m2, hif, hi, cut = 0, low = 0) => ({ peq: { on: true, bands: [
  { on: low > 0, type: 'lowcut', freq: low || 40, gain: 0, q: Math.SQRT1_2 }, { on: true, type: 'lowshelf', freq: 120, gain: lo, q: 0.7 },
  { on: true, type: 'bell', freq: m1f, gain: m1, q: 1 }, { on: true, type: 'bell', freq: m2f, gain: m2, q: 1 },
  { on: true, type: 'highshelf', freq: hif, gain: hi, q: 0.7 }, { on: cut > 0, type: 'highcut', freq: cut || 18000, gain: 0, q: Math.SQRT1_2 }] } });
const wide = (mix = 0.5) => ({ chorus: { on: true, rate: 0.6, depth: 0.7, mix } });
const V = TAKE === 'a'
  ? { drums: -11.5, piano: 2, wash: -10, stack: -5, lead: -4.5, lead2: -13, counter: -16, keys: -6, bass: -4, sub: -20, riser: -16, ...(arg.vol ?? {}) }
  : { drums: -7, keys: -21, wash: -10, stack: -6, lead: -6, lead2: -12, counter: -14, bass: -1, sub: -8.5, riser: -15, ...(arg.vol ?? {}) };
const kitA = { kick: 'punchyKick', snare: 'tightSnare', clap: 'crispClap', closedHat: 'tightHat', openHat: 'openHat', crash: 'crash', ride: 'ride', tomLow: 'lowTom', tomMid: 'midTom' };
const kitB = { kick: 'clubKick', snare: 'tightLayerSnare', clap: 'wideClap', closedHat: 'trapHat', openHat: 'openHat', crash: 'crash' };
const kit = Object.fromEntries(Object.entries(TAKE === 'a' ? kitA : kitB).filter(([, v]) => presetSound(v)).map(([k, v]) => [k, presetSound(v)]));
for (const [row, dl] of Object.entries(arg.rowLevel ?? (TAKE === 'a' ? { closedHat: -4, ride: -9 } : { closedHat: -5, openHat: -3 }))) if (kit[row]) kit[row].level = dl;
add('drums', 'designedKit', P.drums, { drumDesign: kit, volume: V.drums }, TAKE === 'a' ? eq(0, 400, 0, 2500, 0, 6000, -2) : eq(0, 400, 0, 5000, -3, 10000, 3));
if (TAKE === 'a') {
  // (the bass: Driven Legato tamed for artcore: less drive, darker, no glide - held roots as the reference's)
  const tame = { 'Pre drive': lin(3, 0, 36), Drive: lin(8, 0, 36), 'Band drive': 0, Cutoff: logn(1400, 20, 20000), Glide: 0, 'Sub level': 0 };
  add('piano', 'realGrandPiano', P.piano, { volume: V.piano, reverbSend: 0.3 }, eq(-2, 300, -1, 3000, 1, 9000, 1));
  add('keys', 'realGrandPiano', P.keys, { volume: V.keys, reverbSend: 0.3 });
  add('wash', 'plugin', P.wash, { ...fledge('wash', 'Pad/Wide Wash', { 1: 0.45, 2: 0.6 }), volume: V.wash, reverbSend: 0.35 }, eq(0, 300, 0, 2000, 0, 8000, -2, 0, 150));
  add('stack', 'plugin', P.stack, { ...fledge('stack', 'Lead/Hardcore Supersaw', { 1: 0.5, 2: 0.2, 3: 0.5 }), volume: V.stack, reverbSend: 0.3 }, { ...wide(0.45), ...eq(0, 400, -2, 2500, 0, 5000, -5, 0, 200) });
  add('lead', 'plugin', P.lead, { ...fledge('lead', 'Lead/Supersaw', { 1: 0.35, 2: 0.6, 3: 0.5 }), volume: V.lead, reverbSend: 0.3 }, { ...wide(0.45), ...eq(0, 500, -2, 3000, 0, 5500, -4, 0, 250) });
  add('lead2', 'plugin', P.lead2, { ...fledge('lead2', 'Lead/Hardcore Supersaw', { 1: 0.5, 2: 0.2, 3: 0.6 }), volume: V.lead2, reverbSend: 0.35 }, wide(0.5));
  add('counter', 'plugin', P.counter, { ...fledge('counter', 'Keys/Bell', { 1: 0.4, 2: 0.6 }), volume: V.counter, reverbSend: 0.35 });
  add('bass', 'plugin', P.bass, { ...fledge('bass', 'Bass/Driven Legato', { 1: 0.2, 2: 0.2, 3: 0 }, tame), volume: V.bass, reverbSend: 0 }, eq(0, 180, 2, 600, -3, 3000, -4, 6000));
  add('sub', 'plugin', P.sub, { ...fledge('sub', 'Bass/Clean Sub'), volume: V.sub, reverbSend: 0, name: 'Sub' });
  add('riser', 'plugin', P.riser, { ...fledge('riser', 'FX/Riser'), volume: V.riser, reverbSend: 0.2 });
} else {
  add('keys', 'realElectricPiano', P.keys, { volume: V.keys, reverbSend: 0.25 }, eq(-2, 300, -1, 2500, 1, 8000, 0));
  add('wash', 'plugin', P.wash, { ...fledge('wash', 'Pad/Wide Wash', { 1: 0.5, 2: 0.6 }), volume: V.wash, reverbSend: 0.3 }, { ...wide(0.6), ...eq(0, 300, 0, 2000, 0, 8000, -2, 0, 150) });
  add('stack', 'plugin', P.stack, { ...fledge('stack', 'Chords/Future bass', { 1: 0.5, 2: 0.9 }), volume: V.stack, reverbSend: 0.2 }, { chorus: { on: true, rate: 0.9, depth: 0.9, mix: 0.8 }, ...eq(0, 350, -2, 2500, 0, 6000, -3, 0, 180) });
  add('lead', 'plugin', P.lead, { ...fledge('lead', 'Lead/Supersaw', { 1: 0.5, 2: 0.7, 3: 0.5 }), volume: V.lead, reverbSend: 0.3 }, { ...wide(0.7), ...eq(0, 500, -2, 3000, 0, 6000, -4, 0, 250) });
  add('lead2', 'plugin', P.lead2, { ...fledge('lead2', 'Lead/Sine', { 2: 0.4 }), volume: V.lead2, reverbSend: 0.35 }, wide(0.4));
  add('counter', 'plugin', P.counter, { ...fledge('counter', 'Keys/Bright Pluck', { 1: 0.4, 2: 0.4 }), volume: V.counter, reverbSend: 0.3 }, eq(0, 400, 0, 2500, 0, 8000, 0, 0, 300));
  add('bass', 'plugin', P.bass, { ...fledge('bass', 'Bass/Driven Legato', { 1: 0.35, 2: 0.3, 3: 0.2 }, { 'Sub level': 0 }), volume: V.bass, reverbSend: 0 }, eq(-3, 170, 3, 600, -8, 1800, -6, 3000, 70));
  add('sub', 'plugin', P.sub, { ...fledge('sub', 'Bass/Clean Sub'), volume: V.sub, reverbSend: 0, name: 'Sub' });
  add('riser', 'plugin', P.riser, { ...fledge('riser', 'FX/Riser'), volume: V.riser, reverbSend: 0.2 });
}

const toUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
const health = (chans) => { let bad = 0, peak = 0; for (const c of chans) for (let i = 0; i < c.length; i++) { const v = c[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > peak) peak = Math.abs(v); } return { nonFinite: bad, peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(2) }; };
if (arg.dump) {
  const d = {}; for (const [k, v] of Object.entries(P)) d[k] = v.map((n) => [midiOf(n.note), +(n.startOffset * 16).toFixed(2), +(durationToBars(n.duration) * 16).toFixed(2), +n.velocity.toFixed(2)]);
  return { out: { bpm: BPM, notes: d, chords: SONG.loop.map((c) => [c.from, c.to, c.name, c.bass]) }, wavs: {} };
}
useTimelineStore.setState({ tracks, clips, bpm: BPM, master: T.defaultMasterSettings() });
const s0 = useTimelineStore.getState();
const ducked = s0.duckToKick('future');
// The music parts' pump: lighter for the artcore take (the reference barely pumps), as Duck to kick sets it otherwise
const musicDb = arg.musicPump ?? (TAKE === 'a' ? -1 : null);
if (musicDb != null) useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map((t) => (t.fx.pump?.on && t.fx.pump.trigger === 'kick' ? { ...t, fx: { ...t.fx, pump: { ...t.fx.pump, depth: depthOfDb(musicDb) } } } : t)) });
// arg.pumpDb {trackId: dB}: a track's pump depth (the sub's hole under kick and snare, say)
const PD = { sub: TAKE === 'a' ? -4 : -3, ...(arg.pumpDb ?? {}) };
useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map((t) => (t.fx.pump?.on && PD[t.id] != null ? { ...t, fx: { ...t.fx, pump: { ...t.fx.pump, depth: depthOfDb(PD[t.id]) } } } : t)) });
const loud = arg.loud ?? 'loud';
useTimelineStore.getState().setMasterLoud({ on: true, target: loud, crunch: CRUNCH, subTilt: 0 });
const st = useTimelineStore.getState();
const masterFx = { reverbDecay: arg.reverbDecay ?? (TAKE === 'a' ? 3.2 : 2.6), delayTime: st.delayTime ?? T.DEFAULT_MASTER_FX.delayTime, delayFeedback: st.delayFeedback ?? T.DEFAULT_MASTER_FX.delayFeedback };
const opts = { tracks: st.tracks, clips: st.clips, bpm: st.bpm, swing: 0, masterFx, master: st.master, startBar: 1, endBar: BARS + 1, ending: 'ringOut', sampleRate: sr, peakCeilingDbtp: CEIL, loudTargetLufs: arg.lufs ?? -10 };
const out = { take: TAKE, bpm: BPM, ducked, crunch: CRUNCH, ceil: CEIL, tracks: st.tracks.map((t) => `${t.id} vol ${t.volume} pump ${t.fx.pump?.on ? t.fx.pump.depth.toFixed(3) + ' ' + t.fx.pump.trigger : 'off'}`) };
const wavs = {};
if (arg.levels) {
  const lv = {};
  for (const t of st.tracks) {
    const b = await ex.renderArrangement({ ...opts, loudTargetLufs: undefined, bypassMaster: true, soundOnly: [t.id], startBar: 9, endBar: 25 });
    // and its width above 250 Hz: side/mid energy (dB) after a first-order high-pass
    const L = b.getChannelData(0), R = b.getChannelData(1); const a = Math.exp(-2 * Math.PI * 250 / sr);
    let pm = 0, ps = 0, xm = 0, ym = 0, xs = 0, ys = 0;
    for (let i = 0; i < L.length; i++) { const mm = 0.5 * (L[i] + R[i]), ss = 0.5 * (L[i] - R[i]); ym = a * (ym + mm - xm); xm = mm; ys = a * (ys + ss - xs); xs = ss; pm += ym * ym; ps += ys * ys; }
    lv[t.id] = [+integratedLufs(L, R, sr).toFixed(1), health([L, R]).peakDb, +(10 * Math.log10((ps + 1e-12) / (pm + 1e-12))).toFixed(1)];
  }
  out.levels = lv;
  return { out, wavs };
}
let stats = null;
const t0 = performance.now();
const buf = await ex.renderArrangement({ ...opts, onMasterStats: (x) => (stats = x) });
const ch = [buf.getChannelData(0), buf.getChannelData(1)];
const file = arg.file ?? `melodic-take-${TAKE}`;
wavs[file + '-mp3'] = await toUrl(await encodeAudio(ch, buf.sampleRate, 'mp3', { bitDepth: 16 }));
Object.assign(out, { seconds: +(buf.length / buf.sampleRate).toFixed(2), renderMs: Math.round(performance.now() - t0), ...health(ch), lufs: +integratedLufs(ch[0], ch[1], buf.sampleRate).toFixed(2), loud: stats?.loud, limDb: stats?.limiterPeakDb, limBusy: stats?.limiterBusyShare, clip: stats?.clipper });
const barS = 240 / BPM;
const at = (n) => n.startOffset * barS;
out.onsets = { kicks: P.drums.filter((n) => n.note === 'C1').map(at), snares: P.drums.filter((n) => n.note === 'D1' && n.velocity > 0.9).map(at) };
if (arg.stems) {
  const master = { ...st.master, loud: { ...st.master.loud, push: stats?.loud?.push ?? st.master.loud.push } };
  const b = await ex.renderArrangement({ ...opts, master, loudTargetLufs: undefined, soundOnly: arg.stems });
  wavs[file + '-stem'] = await toUrl(new Blob([ex.encodeChannels([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 16)]));
}
return { out, wavs };
