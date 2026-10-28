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
// The harmony: an 8-bar loop of chord segments [from, to) in 16ths of the loop (from -2: the chord
// arrives an 8th before the bar), each with the bass note, the held voicing (wash/stack) and the
// chord tones the arpeggios and runs use (pitch classes, root first).
// ---------------------------------------------------------------------------------------------
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const pcs = (s) => s.split(' ').map((x) => PC[x]);
const SONGS = {
  // Eb major. IVmaj9 (2.5 bars) - III7(b9 #5) - vim9 (bass walking down to Bb) - iim9 - V13sus (same upper
  // voicing as the ii) - ivm6(maj7) (the borrowed minor iv: C slips to Cb) - I/3, every change off the barline.
  a: {
    bpm: 175, loop: [
      { from: -2, to: 38, name: 'Abmaj9', bass: 44, voicing: [60, 63, 67, 68, 70], tones: pcs('Ab C Eb G Bb') },
      { from: 38, to: 54, name: 'G7(b9,#5)', bass: 43, voicing: [59, 63, 65, 68], tones: pcs('G B Eb F Ab') },
      { from: 54, to: 64, name: 'Cm9', bass: 48, voicing: [58, 62, 63, 67], tones: pcs('C Eb G Bb D') },
      { from: 64, to: 72, name: 'Cm9/Bb', bass: 46, voicing: [58, 62, 63, 67], tones: pcs('C Eb G Bb D') },
      { from: 72, to: 88, name: 'Fm9', bass: 41, voicing: [56, 60, 63, 67], tones: pcs('F Ab C Eb G') },
      { from: 88, to: 102, name: 'Bb13sus', bass: 46, voicing: [56, 60, 63, 67], tones: pcs('Bb Eb Ab C G') },
      { from: 102, to: 116, name: 'Abm6(maj7)', bass: 44, voicing: [59, 63, 65, 67], tones: pcs('Ab Cb Eb F G') },
      { from: 116, to: 126, name: 'Eb/G', bass: 43, voicing: [58, 62, 63, 65], tones: pcs('Eb G Bb D F') },
    ],
  },
  // A major with lydian and mixolydian colours. Imaj9 - II/I (B over an A pedal: A lydian) - vim11 - bVIImaj9 |
  // IVmaj9 - ivm9 (C# slips to C, F# to F) - iiim7 - bVImaj7#11 - V7sus4(9).
  b: {
    bpm: 130, loop: [
      { from: -2, to: 14, name: 'Amaj9', bass: 45, voicing: [61, 64, 68, 69, 71], tones: pcs('A C# E G# B') },
      { from: 14, to: 30, name: 'B/A', bass: 45, voicing: [63, 66, 69, 71, 73], tones: pcs('B D# F# A C#') },
      { from: 30, to: 46, name: 'F#m11', bass: 42, voicing: [61, 64, 69, 71], tones: pcs('F# A C# E B') },
      { from: 46, to: 62, name: 'Gmaj9', bass: 43, voicing: [62, 66, 67, 69], tones: pcs('G B D F# A') },
      { from: 62, to: 78, name: 'Dmaj9', bass: 38, voicing: [61, 64, 66, 69], tones: pcs('D F# A C# E') },
      { from: 78, to: 94, name: 'Dm9', bass: 38, voicing: [60, 64, 65, 69], tones: pcs('D F A C E') },
      { from: 94, to: 110, name: 'C#m7', bass: 37, voicing: [59, 64, 68, 71], tones: pcs('C# E G# B') },
      { from: 110, to: 120, name: 'Fmaj7#11', bass: 41, voicing: [60, 64, 67, 69, 71], tones: pcs('F A C E B') },
      { from: 120, to: 126, name: 'E7sus4(9)', bass: 40, voicing: [62, 66, 69, 71], tones: pcs('E A B D F#') },
    ],
  },
};
const SONG = SONGS[TAKE];
const BPM = SONG.bpm;
const LOOP = 128;
// The chord sounding at absolute 16th t (loops start at loopStarts)
let loopStarts = [];
const chordAt = (t) => {
  let base = loopStarts[0];
  for (const s of loopStarts) if (t >= s - 2) base = s;
  const r = t - base;
  return SONG.loop.find((c) => r >= c.from && r < c.to) ?? SONG.loop[0];
};
// Chord segments in absolute 16ths between a and b
const segments = (a, b) => {
  const out = [];
  for (let t = a; t < b; t++) {
    const c = chordAt(t), last = out[out.length - 1];
    if (last && last.c === c) last.to = t + 1; else out.push({ c, from: t, to: t + 1 });
  }
  return out;
};
// Chord tones of c in [lo, hi], ascending
const toneRange = (c, lo, hi) => range(hi - lo + 1).map((i) => lo + i).filter((p) => c.tones.includes(((p % 12) + 12) % 12));

const parts = { piano: [], wash: [], stack: [], lead: [], lead2: [], counter: [], bass: [], sub: [], riser: [], drums: [], keys: [] };
const P = parts;
// Held chords: the voicing for each segment (shift: octaves), re-struck at bar lines inside long segments when `restrike`
const held = (part, a, b, vel, shift = 0, restrike = false) => {
  for (const s of segments(a, b)) {
    const cuts = [s.from];
    if (restrike) for (let t = Math.ceil((s.from + 1) / 16) * 16; t < s.to; t += 16) if (t - s.from >= 6 && s.to - t >= 6) cuts.push(t);
    cuts.push(s.to);
    for (let k = 0; k + 1 < cuts.length; k++) s.c.voicing.forEach((p) => part.push(N(typeof shift === 'function' ? shift(p) : p + shift, cuts[k], cuts[k + 1] - cuts[k] + 0.1, vel - (k ? 0.1 : 0))));
  }
};
// The bass: the chord's bass note held (legato: each note joins the next), with the given extra moves inside each bar
const bassLine = (a, b, riff, vel = 0.85) => {
  for (let t = a; t < b; t++) {
    const c = chordAt(t), st = ((t % 16) + 16) % 16;
    const prev = t > a ? chordAt(t - 1) : null;
    const hit = riff.find((x) => x[0] === st);
    if (hit || prev !== c || t === a) {
      const iv = hit && prev === c ? hit[1] : 0;
      P.bass.push({ t, p: c.bass + iv, vel: hit ? hit[2] ?? vel : vel });
    }
  }
};
const finishBass = (end, overlap = 0.12) => {
  const xs = P.bass.sort((x, y) => x.t - y.t);
  P.bass = xs.map((x, k) => N(x.p, x.t, ((xs[k + 1]?.t ?? end) - x.t) + overlap, x.vel));
};
const subLine = (a, b, oct = -12) => { for (const s of segments(a, b)) P.sub.push(N(s.c.bass + oct, s.from, s.to - s.from + 0.12, 0.85)); };

// =============================================================================================
// TAKE A: artcore, 175, Eb major. Bars 0-7 intro/build, 8-23 the drop (the loop twice), 24-25 the end.
// =============================================================================================
if (TAKE === 'a') {
  loopStarts = [0, 128, 256];
  const DROP = 128, END = 384;
  // The hook: one 2-bar cell of four pitches (Bb5 C6 Eb6 G5), syncopated, held; over the altered and the
  // borrowed chords its C slips a semitone to B/Cb (cells 1 and 3), the vocabulary's semitone slip.
  const CELL = [[0, 82, 2], [2, 84, 1], [3, 82, 3], [6, 79, 2], [8, 82, 2], [10, 84, 4], [14, 87, 4], [18, 84, 2], [20, 82, 6], [26, 79, 2], [28, 82, 4]];
  const hook = (start, cells, vel, shift = 0, part = P.lead) => {
    for (let k = 0; k < cells; k++) CELL.forEach(([st, p, l]) => {
      const slip = (k % 4 === 1 || k % 4 === 3) && p === 84 && (st === 10 || st === 18);
      part.push(N((slip ? 83 : p) + shift, start + k * 32 + st, l, (st % 4 === 0 ? vel : vel - 0.08) + 0.04 * (rnd() - 0.5)));
    });
  };
  // Piano: left hand = the bass an octave over + its 10th/5th, held per chord; right hand = broken chords in 8ths
  // (3+3+2 accents) and, at the end of each 2-bar cell, a 16th run up through the chord tones (the runs of the reference).
  const piano = (a, b, runs = true, vel = 0.7, busy = false) => {
    for (const s of segments(a, b)) {
      [s.c.bass, s.c.bass + 12].forEach((p) => P.piano.push(N(p, s.from, s.to - s.from, vel + 0.05)));
    }
    for (let t = a; t < b; t++) {
      const c = chordAt(t), st = ((t - a) % 32 + 32) % 32, bst = ((t % 16) + 16) % 16;
      const tones = toneRange(c, 60, 80);
      if (runs && st >= 20 && st < 28) {
        // the run: up through two octaves of chord tones, a 16th each
        const run = toneRange(c, 62, 92);
        const i = Math.round(((st - 20) / 7) * (run.length - 1));
        P.piano.push(N(run[i], t, 1.2, vel - 0.05 + 0.02 * (st - 20)));
        continue;
      }
      const eighth = bst % 2 === 0;
      const sixteenth = busy && (bst === 3 || bst === 11);
      if (!eighth && !sixteenth) continue;
      const idx = [0, 2, 1, 3, 2, 4, 3, 1][(bst >> 1) % 8] % tones.length;
      const accent = bst === 0 || bst === 6 || bst === 12;
      P.piano.push(N(tones[idx], t, eighth ? 2.5 : 1.2, accent ? vel : vel - 0.15));
    }
  };
  // --- Intro (bars 0-3: piano alone, slower: chords + 8ths without runs; 4-7: wash, bass, hats; 6-7 the build)
  piano(0, 64, false, 0.62);
  piano(64, DROP, true, 0.68);
  held(P.wash, 32, DROP, 0.5);
  bassLine(64, DROP, [[0, 0, 0.85], [10, 0, 0.75]]);
  subLine(64, DROP);
  // the hook previewed by the piano, an octave down, in bars 4-7
  hook(64, 2, 0.62, -12, P.keys);
  P.riser.push(N('C4', 96, 32, 0.7));
  // --- The drop (bars 8-23)
  held(P.wash, DROP, END, 0.55);
  held(P.stack, DROP - 2, END, 0.78, (p) => (p + 12 <= 76 ? p + 12 : p), true); // (the stack stays under the hook: the hook is its top voice)
  piano(DROP, END, true, 0.72, true);
  hook(DROP, 8, 0.85);
  hook(DROP + 128, 4, 0.7, 12, P.lead2);
  // the counter-line in the second half: answers in the hook's held Bb (cell steps 21-25), falling 16ths through
  // the chord an octave over the hook, and a pickup at the cell's end
  for (let k = 4; k < 8; k++) {
    const t0 = DROP + k * 32;
    const c = chordAt(t0 + 22); const fall = toneRange(c, 86, 100).reverse();
    [21, 22, 23, 24, 25].forEach((st, i) => P.counter.push(N(fall[i % fall.length], t0 + st, 1.5, 0.7 - 0.05 * i)));
    const c2 = chordAt(t0 + 30); const up = toneRange(c2, 84, 98);
    [30, 31].forEach((st, i) => P.counter.push(N(up[i + 1], t0 + st, 1.5, 0.6)));
  }
  bassLine(DROP, END, [[0, 0, 0.85], [10, 0, 0.75], [14, 12, 0.7]]);
  subLine(DROP, END);
  // --- The end (bars 24-25): Abmaj9 then Ebmaj9, piano, wash, the hook's Bb then G
  const endCh = [{ at: END, c: SONG.loop[0], l: 16 }, { at: END + 16, c: { ...SONG.loop[7], voicing: [58, 62, 63, 67], bass: 39 }, l: 24 }];
  for (const { at, c, l } of endCh) {
    c.voicing.forEach((p) => P.wash.push(N(p, at, l, 0.55)));
    [c.bass - 12, c.bass].forEach((p) => P.piano.push(N(p, at, l, 0.72)));
    toneRange(c, 60, 87).forEach((p, i) => P.piano.push(N(p, at + i, l - i, 0.6)));
    P.bass.push({ t: at, p: c.bass, vel: 0.8 }); P.sub.push(N(c.bass - 12, at, l, 0.8));
  }
  P.lead.push(N(82, END, 14, 0.8), N(79, END + 16, 20, 0.75));
  finishBass(END + 40);
  // --- Drums (Designed Kit): two-step breakbeat at 175 under the music; intro hats from bar 4, a snare build in 6-7
  const D = (row, t, l = 1, v = 0.8) => P.drums.push(N(row, t, l, v));
  for (let bar = 4; bar < 8; bar++) range(8).forEach((k) => D('F#1', bar * 16 + 2 * k, 1, k % 2 ? 0.42 : 0.3));
  // bars 6-7: the breakbeat comes in at half weight (no snare roll), a short snare/tom fill on the last two beats
  [96, 112].forEach((t) => { D('C1', t, 2, 0.6); D('C1', t + 10, 2, 0.5); D('D1', t + 4, 2, 0.5); D('D1', t + 12, 2, 0.55); });
  [[120, 'D1'], [121, 'D1'], [122, 'D2'], [123, 'D2'], [124, 'B1'], [125, 'B1'], [126, 'F1'], [127, 'D1']].forEach(([t, r], k) => D(r, t, 1, 0.5 + 0.05 * k));
  D('C1', 64, 2, 0.8); D('C#2', 64, 16, 0.4);
  for (let bar = 8; bar < 24; bar++) {
    const t = bar * 16, i = bar - 8, odd = i % 2 === 1, phraseEnd = i % 8 === 7;
    (odd ? [0, 6, 10] : [0, 10]).forEach((st) => D('C1', t + st, 2, st ? 0.85 : 0.95));
    [4, 12].forEach((st) => { D('D1', t + st, 2, 0.95); D('D#1', t + st, 2, 0.5); });
    (odd ? [7, 9, 15] : [14]).forEach((st) => D('D1', t + st, 1, 0.28));
    const ride = i >= 8;
    range(8).forEach((k) => D(ride ? 'D#2' : 'F#1', t + 2 * k, 1, k % 2 ? 0.55 : 0.4));
    [3, 11].forEach((st) => D('F#1', t + st, 1, 0.25));
    if (phraseEnd) { [8, 10, 12, 13, 14, 15].forEach((st, k) => D(k < 2 ? 'B1' : 'F1', t + st, 1, 0.6 + 0.05 * k)); }
    if (i % 8 === 0) D('C#2', t, 16, 0.6);
    if (i % 4 === 3 && !phraseEnd) D('A#1', t + 14, 2, 0.45);
  }
  D('C1', END, 2, 0.9); D('C#2', END, 16, 0.6);
}

// =============================================================================================
// TAKE B: future bass, 130, A major. Bars 0-7 intro/build, 8-23 the drop, 24-25 the end.
// =============================================================================================
if (TAKE === 'b') {
  loopStarts = [0, 128, 256];
  const DROP = 128, END = 384;
  // The lead: long held colour tones (a C# held over four chords, then an E over four more), re-struck off the
  // beat, a short turn every two bars, and the D#/D (lydian II, then bVII) cross-relation.
  const LEAD = [
    [0, 73, 10], [10, 71, 2], [12, 73, 4],
    [16, 73, 6], [22, 75, 2], [24, 78, 8],
    [32, 76, 10], [42, 73, 2], [44, 76, 4],
    [48, 78, 6], [54, 76, 2], [56, 74, 4], [60, 73, 4],
    [64, 76, 6], [70, 76, 4], [74, 78, 2], [76, 76, 4],
    [80, 76, 6], [86, 74, 2], [88, 76, 6],
    [94, 80, 6], [100, 76, 4], [104, 73, 4], [108, 76, 2],
    [110, 76, 4], [114, 79, 2], [116, 81, 4], [120, 78, 4], [124, 76, 4],
  ];
  const lead = (start, vel, shift = 0, part = P.lead) => LEAD.forEach(([st, p, l]) => part.push(N(p + shift, start + st, l + 0.1, (st % 4 === 0 ? vel : vel - 0.06) + 0.04 * (rnd() - 0.5))));
  // Chord chops: the voicing an octave up, struck in a syncopated 16th rhythm (two bars), held between hits only a little
  const CHOP = [[[0, 2], [3, 2], [6, 1], [8, 2], [11, 2], [14, 2]], [[0, 3], [4, 1], [6, 2], [10, 1], [12, 2], [15, 1]]];
  const chops = (a, b, vel) => {
    for (let t = a; t < b; t++) {
      const bar = Math.floor(t / 16), st = t % 16;
      const h = CHOP[bar % 2].find((x) => x[0] === st);
      // and on every chord change that falls between hits
      const change = t > a && chordAt(t) !== chordAt(t - 1);
      if (!h && !change) continue;
      const c = chordAt(t);
      c.voicing.forEach((p) => P.stack.push(N(p, t, h ? h[1] : 1, (st % 4 === 0 ? vel : vel - 0.1))));
    }
  };
  // Electric piano (intro): the chord with its bass, struck 3+3+2 (dotted quarters)
  const epiano = (a, b, vel) => {
    for (let t = a; t < b; t++) {
      const st = t % 16, c = chordAt(t);
      const change = t > a && c !== chordAt(t - 1);
      if (![0, 6, 12].includes(st) && !change && t !== a) continue;
      let l = 1; while (t + l < b && ![0, 6, 12].includes((t + l) % 16) && chordAt(t + l) === c) l++;
      [c.bass + 12, ...c.voicing].forEach((p, i) => P.keys.push(N(p, t, l + 0.2, vel - (i ? 0.05 : 0))));
    }
  };
  // The pluck counter-line (second half of the drop): chord tones in 16ths grouped 3+3+2, rising, an octave over the lead
  const pluck = (a, b, vel) => {
    const shape = [0, 1, 2, 1, 2, 3, 2, 4];
    for (let t = a; t < b; t++) {
      const c = chordAt(t), tones = toneRange(c, 76, 93), st = t % 8;
      if ((t % 32) >= 28) continue; // breathe at the end of each 2 bars
      P.counter.push(N(tones[shape[st] % tones.length], t, 1, [0, 3, 6].includes(st) ? vel : vel - 0.2));
    }
  };
  // --- Intro
  epiano(0, DROP, 0.62);
  held(P.wash, 0, 64, 0.36);
  held(P.wash, 64, DROP, 0.48);
  lead(64, 0.55);          // the lead previewed, soft, in bars 4-7
  bassLine(64, DROP, []);
  subLine(64, DROP);
  P.riser.push(N('E4', 96, 32, 0.7));
  // --- Drop
  held(P.wash, DROP, END, 0.55);
  chops(DROP - 2, END, 0.85);
  lead(DROP, 0.85);
  lead(DROP + 128, 0.85);
  lead(DROP + 128, 0.6, 12, P.lead2);
  pluck(DROP + 128, END, 0.7);
  // The bass: per bar, octave leaps and the fifth, joined (legato glides) - the future-bass bass that moves inside one root
  bassLine(DROP, END, [[3, 12, 0.75], [4, 0, 0.8], [6, 12, 0.75], [8, 0, 0.85], [10, 7, 0.75], [12, 12, 0.75], [14, 0, 0.8]]);
  subLine(DROP, END);
  // --- End: Amaj9, wash + e-piano + lead C#
  const c0 = SONG.loop[0];
  c0.voicing.forEach((p) => { P.wash.push(N(p, END, 24, 0.55)); P.keys.push(N(p, END, 24, 0.62)); });
  P.keys.push(N(c0.bass, END, 24, 0.65)); P.lead.push(N(73, END, 16, 0.8));
  P.bass.push({ t: END, p: c0.bass, vel: 0.8 }); P.sub.push(N(c0.bass - 12, END, 20, 0.8));
  finishBass(END + 20);
  // --- Drums: backbeat 2 & 4 with sparse syncopated kicks and rolling 16th hats
  const D = (row, t, l = 1, v = 0.8) => P.drums.push(N(row, t, l, v));
  for (let bar = 4; bar < 8; bar++) range(16).forEach((st) => D('F#1', bar * 16 + st, 1, st % 4 === 2 ? 0.4 : st % 2 ? 0.18 : 0.28));
  // bars 4-7: claps on 2 and 4 under the hats, a 16th clap fill only on the last two beats
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
