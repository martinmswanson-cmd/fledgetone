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

// Version 3 (owner on v2: A "much better; some notes even higher, the piano faster"; B "the clapping felt off, it needs to
// go faster in the drop, it feels repetitive"). Same rule as v2: ONE lead, ONE tune in 4-bar phrases, the same notes
// every time a phrase returns; everything else under it or in its gaps.
// ---------------------------------------------------------------------------------------------
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const pcs = (s) => s.split(' ').map((x) => PC[x]);
const CH = TAKE === 'a' ? {
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
  A: { name: 'Amaj9', bass: 45, voicing: [61, 64, 68, 69, 71], tones: pcs('A C# E G# B') },
  BA: { name: 'B/A', bass: 45, voicing: [63, 66, 69, 71], tones: pcs('B D# F# A') },
  Fsm: { name: 'F#m11', bass: 42, voicing: [61, 64, 69, 71], tones: pcs('F# A C# E B') },
  G: { name: 'Gmaj9', bass: 43, voicing: [62, 66, 67, 69], tones: pcs('G B D F# A') },
  E7: { name: 'E7sus4(9)', bass: 40, voicing: [62, 66, 69, 71], tones: pcs('E A B D F#') },
  D: { name: 'Dmaj9', bass: 38, voicing: [61, 64, 66, 69], tones: pcs('D F# A C# E') },
  Dm: { name: 'Dm9', bass: 38, voicing: [60, 64, 65, 69], tones: pcs('D F A C E') },
  Csm: { name: 'C#m7', bass: 37, voicing: [59, 64, 68, 71], tones: pcs('C# E G# B') },
};
const PH = TAKE === 'a'
  ? { A: ['Ab', 'G7', 'Cm', 'CmBb'], A2: ['Ab', 'G7', 'Cm', 'Bb'], B: ['Fm', 'Bb', 'Abm', 'EbG'] }
  // B3: pass 2's B ends on F#m11 (deceptive) into a one-bar break on E7sus4; the last A gets Dmaj9 under its 3rd bar
  : { A: ['A', 'BA', 'Fsm', 'G'], A2: ['A', 'BA', 'Fsm', 'E7'], B: ['D', 'Dm', 'Csm', 'E7'], Bx: ['D', 'Dm', 'Csm', 'Fsm'], Ax: ['A', 'BA', 'D', 'G'], brk: ['E7'] };
const TUNE = TAKE === 'a' ? {
  A: [[0, 75, 4], [4, 79, 4], [8, 80, 6], [14, 79, 2], [16, 77, 6], [22, 75, 2], [24, 74, 4], [28, 71, 4], [32, 72, 4], [36, 75, 4], [40, 79, 6], [46, 77, 2], [48, 75, 12]],
  A2end: [[48, 74, 4], [52, 72, 4], [56, 70, 4]],
  // the answer, lifted: same first bar, then it climbs to a held Eb6 (the climax) and comes home down the chord to Eb5
  //  Fm9: C6 Ab5 G5 F5 | Bb13sus: Eb5 F5 G5 Bb5 | Abm6(maj7): Eb6 (held) Bb5 Ab5 | Eb/G: G5 F5 Eb5 (held)
  B: [[0, 84, 6], [6, 80, 2], [8, 79, 4], [12, 77, 4], [16, 75, 6], [22, 77, 2], [24, 79, 4], [28, 82, 4], [32, 87, 8], [40, 82, 4], [44, 80, 4], [48, 79, 4], [52, 77, 4], [56, 75, 8]],
} : {
  A: [[0, 73, 6], [6, 76, 6], [12, 81, 4], [16, 78, 6], [22, 75, 6], [28, 71, 4], [32, 73, 6], [38, 76, 6], [44, 78, 4], [48, 71, 12]],
  A2end: [[48, 76, 12]],
  B: [[0, 78, 6], [6, 76, 6], [12, 73, 4], [16, 77, 6], [22, 76, 6], [28, 74, 4], [32, 76, 6], [38, 80, 6], [44, 83, 4], [48, 83, 6], [54, 81, 6], [60, 80, 4]],
};
const tuneOf = (kind) => (kind === 'B' || kind === 'Bx' ? TUNE.B : kind === 'A2' ? [...TUNE.A.filter(([s]) => s < 48), ...TUNE.A2end] : TUNE.A);
// The form
const FORM = TAKE === 'a'
  ? [[0, 'A'], [4, 'A2'], [8, 'A'], [12, 'A2'], [16, 'A'], [20, 'B']]
  : [[0, 'A'], [4, 'A2'], [8, 'A'], [12, 'A2'], [16, 'A'], [20, 'Bx'], [24, 'brk'], [25, 'Ax'], [29, 'B']];
const PLAN = [];
for (const [b0, kind] of FORM) PH[kind].forEach((c, i) => (PLAN[b0 + i] = c));
const ENDBAR = TAKE === 'a' ? 24 : 33;
const END = ENDBAR * 16;
if (TAKE === 'a') { PLAN[24] = 'Ab'; PLAN[25] = 'Eb'; PLAN[26] = 'Eb'; } else { PLAN[33] = 'A'; PLAN[34] = 'A'; PLAN[35] = 'A'; }
const LEN_BARS = TAKE === 'a' ? 27 : 36;
const BPM = TAKE === 'a' ? 175 : 150;
const SONG = { loop: PLAN.map((c, b) => ({ from: b * 16, to: b * 16 + 16, name: CH[c].name, bass: CH[c].bass })) };
const chordAt = (t) => CH[PLAN[Math.max(0, Math.min(PLAN.length - 1, Math.floor(t / 16)))]];
const toneRange = (c, lo, hi) => range(hi - lo + 1).map((i) => lo + i).filter((p) => c.tones.includes(((p % 12) + 12) % 12));
const P = { piano: [], wash: [], stack: [], lead: [], lead2: [], counter: [], bass: [], sub: [], riser: [], drums: [], keys: [] };
const bars = (a, b) => range(b - a).map((i) => a + i);
const held = (part, b0, b1, vel, cap = 99) => bars(b0, b1).forEach((b) => chordAt(b * 16).voicing.forEach((p) => { let q = p; while (q > cap) q -= 12; part.push(N(q, b * 16, 16.1, vel)); }));
const struck = (part, b0, b1, vel, cap = 99, withBass = false) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16);
  [[0, 6], [6, 6], [12, 4]].forEach(([st, l], k) => [...(withBass ? [c.bass + 12] : []), ...c.voicing].forEach((p) => { let q = p; while (q > cap) q -= 12; part.push(N(q, b * 16 + st, l + 0.15, k ? vel - 0.08 : vel)); }));
});
const tune = (b0, kind, vel, shift = 0, part = P.lead) => tuneOf(kind).forEach(([st, p, l]) => part.push(N(p + shift, b0 * 16 + st, l + 0.1, st % 8 === 0 ? vel : vel - 0.06)));
const bassBars = (b0, b1, mode = 'oct') => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16), t = b * 16;
  if (mode === 'hold') P.bass.push(N(c.bass, t, 16.12, 0.85));
  else if (mode === 'oct') { P.bass.push(N(c.bass, t, 12.12, 0.85)); P.bass.push(N(c.bass + 12, t + 12, 4.12, 0.75)); }
  else range(8).forEach((k) => P.bass.push(N(c.bass + (k % 2 ? 12 : 0), t + 2 * k, 2.12, k % 2 ? 0.72 : 0.85))); // 8th pulse root/octave
  P.sub.push(N(c.bass - 12, t, 16.12, 0.85));
});
const D = (row, t, l = 1, v = 0.8) => P.drums.push(N(row, t, l, v));

if (TAKE === 'a') {
  // --- Intro (as A2): piano 8th broken chords; bars 4-7 the tune on the piano, wash, bass, hats, half breakbeat + fill
  const broken8 = (b0, b1, vel, hi = 72) => bars(b0, b1).forEach((b) => {
    const c = chordAt(b * 16), tones = toneRange(c, 55, hi);
    [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, b * 16, 16, vel + 0.05)));
    for (let st = 0; st < 16; st += 2) P.piano.push(N(tones[[0, 2, 1, 3, 2, 4, 3, 1][st >> 1] % tones.length], b * 16 + st, 2.5, [0, 6, 12].includes(st) ? vel : vel - 0.15));
  });
  broken8(0, 8, 0.62);
  tune(4, 'A2', 0.66, 0, P.keys);
  held(P.wash, 4, 8, 0.5);
  bassBars(4, 8, 'hold');
  P.riser.push(N('C4', 96, 32, 0.6));
  // --- Drop: the piano in steady 16ths (up-down arpeggio over 1.5 octaves of chord tones, under the tune: to Bb4), the left
  //     hand's octave held; in each phrase's last bar, while the tune holds its note, the piano runs up high in 16ths and
  //     ends with four 32nds (the gap fill), then drops back under.
  const ARP = [0, 1, 2, 3, 4, 3, 2, 1];
  const flow = (b0, b1, vel, hi = 70) => bars(b0, b1).forEach((b) => {
    const c = chordAt(b * 16), tones = toneRange(c, 53, hi);
    [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, b * 16, 16, vel + 0.08)));
    const phraseEnd = (b - 8) % 4 === 3;
    // (the tune holds from the bar's start only at the end of an A phrase: there the run starts on beat 2; at the end of A'
    // and B the tune still moves until beat 4, so the piano keeps flowing under it and only the last beat flies up in 32nds)
    const holds = phraseEnd && PLAN[b] !== 'Bb' && PLAN[b] !== 'EbG';
    for (let st = 0; st < 16; st++) {
      if (holds && st >= 4) continue;
      if (phraseEnd && !holds && st >= 12) continue;
      P.piano.push(N(tones[ARP[st % 8] % tones.length], b * 16 + st, 1.3, st % 4 === 0 ? vel : vel - 0.18));
    }
    if (phraseEnd && !holds) { const run = toneRange(c, 70, 94); for (let k = 0; k < 8; k++) P.piano.push(N(run[Math.round((k / 7) * (run.length - 1))], b * 16 + 12 + k / 2, 0.6, vel - 0.08 + 0.02 * k)); }
    if (holds) {
      const run = toneRange(c, 63, 98);
      const n16 = 8; // 16ths on steps 4..11, then 8 x 32nd on 12..15
      for (let k = 0; k < n16; k++) P.piano.push(N(run[Math.round((k / 15) * (run.length - 1))], b * 16 + 4 + k, 1.2, vel - 0.12 + 0.02 * k));
      for (let k = 0; k < 8; k++) P.piano.push(N(run[Math.round(((8 + k) / 15) * (run.length - 1))], b * 16 + 12 + k / 2, 0.6, vel - 0.05 + 0.02 * k));
    }
  });
  flow(8, 24, 0.56);
  held(P.wash, 8, 24, 0.55);
  held(P.stack, 8, 24, 0.7, 70);
  // the tune: A, A', then the A an octave UP (lower octave doubled softly under it), then the lifted B with its Eb6 climax
  tune(8, 'A', 0.88); tune(12, 'A2', 0.88); tune(16, 'A', 0.88, 12); tune(20, 'B', 0.9);
  tune(16, 'A', 0.6, 0, P.lead2); tune(20, 'B', 0.55, -12, P.lead2);
  bassBars(8, 24);
  // --- End: Abmaj9 then Ebmaj9; the lead holds Eb5, the piano rolls up to Eb6
  [[24, 16, 'Ab'], [25, 24, 'Eb']].forEach(([b, l, k]) => { const c = CH[k]; c.voicing.forEach((p) => P.wash.push(N(p, b * 16, l, 0.55))); [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, b * 16, l, 0.7))); toneRange(c, 60, 87).forEach((p, i) => P.piano.push(N(p, b * 16 + i / 2, l - i / 2, 0.55))); P.bass.push(N(c.bass, b * 16, l + 0.1, 0.8)); P.sub.push(N(c.bass - 12, b * 16, l, 0.8)); });
  P.lead.push(N(75, END, 30, 0.8));
  // --- Drums (as A2)
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
    if (i % 4 === 0) D('C#2', t, 16, i % 8 === 0 ? 0.6 : 0.45);
    if (i % 4 === 3 && !phraseEnd) D('A#1', t + 14, 2, 0.45);
  }
  D('C1', END, 2, 0.9); D('C#2', END, 16, 0.6);
} else {
  // --- Intro (bars 0-7), now 150 BPM: e-piano 3+3+2, soft wash; bars 4-7 the lead sings A' softly, half-time drums
  //     (kick on 1, snare+clap on 3 only, 8th hats), a snare (not clap) build in the last bar.
  struck(P.keys, 0, 8, 0.62, 99, true);
  held(P.wash, 0, 4, 0.36); held(P.wash, 4, 8, 0.48);
  tune(4, 'A2', 0.6);
  bassBars(4, 8, 'hold');
  P.riser.push(N('E4', 96, 32, 0.6));
  for (let bar = 4; bar < 8; bar++) {
    const t = bar * 16;
    D('C1', t, 2, 0.75); if (bar % 2) D('C1', t + 10, 2, 0.6);
    if (bar < 7) { D('D1', t + 8, 2, 0.75); D('D#1', t + 8, 1, 0.45); }
    range(8).forEach((k) => D('F#1', t + 2 * k, 1, k % 2 ? 0.4 : 0.28));
  }
  [0, 4, 6, 8, 10, 12, 13, 14, 15].forEach((st, k) => D('D1', 112 + st, 1, 0.45 + 0.06 * k));
  // --- Drop: full-time (snare + tight clap exactly on 2 and 4), the energy goes UP per pass
  // pass 1 (bars 8-15, A A'): chords 3+3+2 + wash, bass root + octave, kick 1 / 3-and, 8th hats with 16th ghosts
  // pass 2 (bars 16-23, A B~): 16th hats + off-beat open hats, busier syncopated kick, bass 8th pulse, a pluck answer
  //   in the gaps (the tune's opening figure up an octave, while the tune holds), a snare roll into bar 20, B ends deceptive
  // break (bar 24): drums out, E7sus4 held, a snare build on the last two beats
  // final (bars 25-32, A B): the tune an octave UP over Dmaj9 in its 3rd bar, everything in, then home
  struck(P.stack, 8, 24, 0.82, 69); struck(P.stack, 25, 33, 0.85, 69);
  held(P.wash, 8, 33, 0.55, 69);
  tune(8, 'A', 0.88); tune(12, 'A2', 0.88); tune(16, 'A', 0.88); tune(20, 'Bx', 0.88);
  tune(25, 'Ax', 0.86, 12); tune(29, 'B', 0.88);
  tune(25, 'Ax', 0.62, 0, P.lead2); tune(29, 'B', 0.6, 12, P.lead2);
  P.lead.push(N(76, 24 * 16 + 4, 12, 0.7)); // the break: the lead holds E5 over E7sus4
  bassBars(8, 16, 'oct'); bassBars(16, 24, 'pulse'); bassBars(24, 25, 'hold'); bassBars(25, 33, 'pulse');
  // the pluck's answers: the tune's first figure (C# E A, 3+3+2 squeezed to 16ths) an octave up, in the gaps
  [19, 27].forEach((b) => [[4, 85, 2], [6, 88, 2], [8, 93, 4], [12, 88, 2], [14, 85, 2]].forEach(([st, p, l]) => P.counter.push(N(p, b * 16 + st, l, 0.7))));
  [15].forEach((b) => [[4, 88, 2], [6, 85, 2], [8, 83, 4]].forEach(([st, p, l]) => P.counter.push(N(p, b * 16 + st, l, 0.6))));
  // --- End: Amaj9, the lead lands on A5
  const c0 = CH.A;
  c0.voicing.forEach((p) => { P.wash.push(N(p, END, 24, 0.55)); P.keys.push(N(p, END, 24, 0.62)); });
  P.keys.push(N(c0.bass, END, 24, 0.65)); P.lead.push(N(81, END, 16, 0.85)); P.lead2.push(N(93, END, 12, 0.55));
  P.bass.push(N(c0.bass, END, 20, 0.8)); P.sub.push(N(c0.bass - 12, END, 20, 0.8));
  // --- Drums
  const groove = (bar, busy) => {
    const t = bar * 16, i = bar % 4;
    const kicks = busy ? [[0, 3, 7, 10], [0, 6, 10, 14], [0, 3, 7, 10, 13], [0, 6, 10]][i] : [[0, 10], [0, 7, 10], [0, 10], [0, 7, 10]][i];
    kicks.forEach((st) => D('C1', t + st, 2, st ? 0.85 : 0.95));
    [4, 12].forEach((st) => { D('D1', t + st, 2, 0.95); D('D#1', t + st, 1, 0.55); });
    if (busy) {
      range(16).forEach((st) => D('F#1', t + st, 1, st % 4 === 2 ? 0.5 : st % 2 ? 0.24 : 0.36));
      [2, 6, 10].forEach((st) => D('A#1', t + st, 1, 0.3));
    } else {
      range(8).forEach((k) => D('F#1', t + 2 * k, 1, k % 2 ? 0.5 : 0.36));
      [7, 15].forEach((st) => D('F#1', t + st, 1, 0.2));
    }
  };
  const fill = (bar, kind) => {
    const t = bar * 16;
    if (kind === 'roll') range(8).forEach((k) => D('D1', t + 8 + k, 1, 0.45 + 0.06 * k));
    else if (kind === 'toms') [[8, 'D2'], [10, 'D2'], [12, 'B1'], [13, 'B1'], [14, 'F1'], [15, 'F1']].forEach(([st, r], k) => D(r, t + st, 1, 0.6 + 0.05 * k));
    else if (kind === 'hats') [12, 12.5, 13, 13.5, 14, 14 + 2 / 3, 15 + 1 / 3].forEach((s, k) => D('F#1', t + s, 0.5, 0.35 + 0.08 * k));
  };
  for (let bar = 8; bar < 33; bar++) {
    if (bar === 24) continue;
    const busy = bar >= 16;
    groove(bar, busy);
    const pos = (bar - 8) % 4;
    if (pos === 3) {
      // phrase ends: a different fill each time; drop the kick's last hit for it
      const kinds = { 11: 'hats', 15: 'toms', 19: 'hats', 23: 'roll', 28: 'toms', 32: 'roll' };
      fill(bar, kinds[bar] ?? 'hats');
    }
    if ([8, 12, 16, 20, 25, 29].includes(bar)) D('C#2', bar * 16, 16, bar === 8 || bar === 25 ? 0.7 : 0.5);
  }
  // the break bar: no drums but a snare build on the last two beats
  [8, 10, 12, 13, 14, 15].forEach((st, k) => D('D1', 24 * 16 + st, 1, 0.45 + 0.08 * k));
  D('C1', END, 2, 0.9); D('C#2', END, 16, 0.55);
}

// ---------------------------------------------------------------------------------------------
// Tracks, levels, effects
// ---------------------------------------------------------------------------------------------
const BARS = LEN_BARS;
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
const kitB = { kick: 'clubKick', snare: 'tightLayerSnare', clap: 'snappyClap', closedHat: 'trapHat', openHat: 'openHat', crash: 'crash' };
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
