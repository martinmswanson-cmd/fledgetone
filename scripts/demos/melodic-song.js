// "Lanterns": a full melodic artcore song (175 BPM, Eb major; the last drop a semitone up, in E), grown from the
// third melodic take A (melodic-takes-3.js) into intro, verse, lift, drop, post-drop, piano break, swell, build,
// second drop and outro. Built through the app's store like the other demos, saved as a .fledgetone.json project
// (the app's own save path), and rendered by the export path with the app's MP3 encoder. Every Fledge Synth track
// uses a built-in preset as it is (no hidden values), each with its own plugin id.
// Run with scripts/audio-check/run.cjs (see docs/SOUND-RECIPES.md). arg:
//   file          the output name (default "lanterns"): <file>-mp3.wav (an MP3) and <file>.fledgetone.json.wav
//   vol           {track id: dB} over the track levels below; lufs (default -10): the export's loudness target
//   levels        [from bar, to bar] (the app's bar numbers): each track's own loudness there instead of the song
//   dump          the notes only (for the click check)
//   checkUrl      a saved project file to fetch: open it through the app's open path (openProjectFromFile) and render
//                 it again; its fingerprint must match the first render's
const ex = await import('/src/audio/exportWav.ts');
const T = await import('/src/store/timelineTypes.ts');
const K = await import('/src/store/partKind.ts');
const { useTimelineStore, currentProject } = await import('/src/store/timelineStore.ts');
const { serializeProject, parseProject } = await import('/src/store/project.ts');
const { openProjectFromFile } = await import('/src/components/timeline/projectFile.ts');
const { embedSounds } = await import('/src/audio/soundLibrary.ts');
const { referencedSoundIds } = await import('/src/store/audioClips.ts');
const { FLEDGE_URL, FLEDGE_PRESETS } = await import('/src/audio/plugins/fledgeMacros.ts');
const { presetSound } = await import('/src/store/drumDesign.ts');
const { integratedLufs } = await import('/src/audio/effects/loudMaster.ts');
const { midiOf, nameOf } = await import('/src/store/noteTools.ts');
const { encodeAudio } = await import('/src/audio/encoders.ts');
const { exportCeilingDbtp } = await import('/src/audio/effects/limiter.ts');
const { depthOfDb } = await import('/src/audio/effects/duckShape.ts');
const SR = 44100;
const BPM = 175;
const LUFS = arg.lufs ?? -10;
const CEIL = exportCeilingDbtp('mp3', 0);
const FILE = arg.file ?? 'lanterns';
const toUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
const health = (chans) => { let bad = 0, peak = 0; for (const c of chans) for (let i = 0; i < c.length; i++) { const v = c[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > peak) peak = Math.abs(v); } return { nonFinite: bad, peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(2) }; };
// A fingerprint of a render: FNV-1a over every sample's bits, both channels
const fingerprint = (chans) => { let h = 0x811c9dc5; for (const c of chans) { const u = new Uint32Array(c.buffer, c.byteOffset, c.length); for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0; } return h.toString(16); };
// The song as the app renders it on export, from a project (as the store holds it)
const songEnd = (p) => Math.max(...p.clips.map((c) => c.startBar + c.lengthBars));
const songOpts = (p) => ({ tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: p.swing, masterFx: p.masterFx ?? T.DEFAULT_MASTER_FX, master: p.master, markers: p.markers, startBar: 1, endBar: songEnd(p), ending: 'ringOut', sampleRate: SR, peakCeilingDbtp: CEIL, loudTargetLufs: LUFS });
const renderSong = async (p) => {
  let stats = null;
  const t0 = performance.now();
  const buf = await ex.renderArrangement({ ...songOpts(p), onMasterStats: (x) => (stats = x) });
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  return { ch, sr: buf.sampleRate, stats, info: { seconds: +(buf.length / buf.sampleRate).toFixed(2), renderMs: Math.round(performance.now() - t0), ...health(ch), lufs: +integratedLufs(ch[0], ch[1], buf.sampleRate).toFixed(2), fingerprint: fingerprint(ch), limDb: stats?.limiterPeakDb, clip: stats?.clipper } };
};

if (arg.checkUrl) {
  // Open the saved file the way the studio's Open does, then export it again
  const text = await (await fetch(arg.checkUrl)).text();
  const error = await openProjectFromFile(new File([text], `${FILE}.fledgetone.json`, { type: 'application/json' }));
  if (error) return { out: { error } };
  const p = currentProject();
  const r = await renderSong(p);
  const wavs = { [FILE + '-check-mp3']: await toUrl(await encodeAudio(r.ch, r.sr, 'mp3', { bitDepth: 16 })) };
  return { out: { opened: { name: p.name, tracks: p.tracks.length, clips: p.clips.length, markers: p.markers.length, bpm: p.bpm }, ...r.info }, wavs };
}

let uid = 0;
const m = (n) => (typeof n === 'number' ? n : midiOf(n));
// A note at absolute 16th `at` (from the song's start), `steps` long
const N = (note, at, steps, velocity = 0.8) => ({ id: 'x' + uid++, note: nameOf(m(note)), at, startOffset: at / 16, duration: `0:0:${+Math.max(0.25, steps).toFixed(4)}`, velocity: Math.max(0.05, Math.min(1, velocity)) });
const range = (n) => Array.from({ length: n }, (_, i) => i);
const bars = (a, b) => range(b - a).map((i) => a + i);

// ---------------------------------------------------------------------------------------------
// Harmony and tune (take A3's, Eb major): A = Abmaj9 | G7(b9) | Cm9 | Cm9/Bb, A' ends on Bb13sus4, B = Fm9 | Bb13sus4 |
// Abm6(maj7) | Eb/G. New here: the pivot P (Fm9 | Bb13sus4 | B13sus4 | B7(b9): the dominant of E, for the second drop a
// semitone up) and B's last time, ending on the tonic with the tune climbing to Eb6.
// ---------------------------------------------------------------------------------------------
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const pcs = (s) => s.split(' ').map((x) => PC[x]);
const CH = {
  Ab: { bass: 44, voicing: [60, 63, 67, 68, 70], tones: pcs('Ab C Eb G Bb') },
  G7: { bass: 43, voicing: [59, 62, 65, 68], tones: pcs('G B D F Ab') },
  Cm: { bass: 48, voicing: [58, 62, 63, 67], tones: pcs('C Eb G Bb D') },
  CmBb: { bass: 46, voicing: [58, 62, 63, 67], tones: pcs('C Eb G Bb D') },
  Fm: { bass: 41, voicing: [56, 60, 63, 67], tones: pcs('F Ab C Eb G') },
  Bb: { bass: 46, voicing: [56, 60, 63, 67], tones: pcs('Bb Eb Ab C G') },
  Abm: { bass: 44, voicing: [59, 63, 65, 67], tones: pcs('Ab Cb Eb F G') },
  EbG: { bass: 43, voicing: [58, 62, 63, 65], tones: pcs('Eb G Bb D F') },
  Eb: { bass: 39, voicing: [58, 62, 63, 67], tones: pcs('Eb G Bb D F') },
  B13: { bass: 47, voicing: [57, 61, 64, 68], tones: pcs('B E A C# G#') },
  B7: { bass: 47, voicing: [57, 60, 63, 66], tones: pcs('B D# F# A C') },
};
const PH = { A: ['Ab', 'G7', 'Cm', 'CmBb'], A2: ['Ab', 'G7', 'Cm', 'Bb'], B: ['Fm', 'Bb', 'Abm', 'EbG'], Bend: ['Fm', 'Bb', 'Abm', 'Eb'], P: ['Fm', 'Bb', 'B13', 'B7'] };
const TUNE = {
  A: [[0, 75, 4], [4, 79, 4], [8, 80, 6], [14, 79, 2], [16, 77, 6], [22, 75, 2], [24, 74, 4], [28, 71, 4], [32, 72, 4], [36, 75, 4], [40, 79, 6], [46, 77, 2], [48, 75, 12]],
  A2end: [[48, 74, 4], [52, 72, 4], [56, 70, 4]],
  B: [[0, 84, 6], [6, 80, 2], [8, 79, 4], [12, 77, 4], [16, 75, 6], [22, 77, 2], [24, 79, 4], [28, 82, 4], [32, 87, 8], [40, 82, 4], [44, 80, 4], [48, 79, 4], [52, 77, 4], [56, 75, 8]],
  // B's last time: its last bar climbs G5 Bb5 to Eb6 over the tonic and holds it into the outro
  Bend4: [[48, 79, 4], [52, 82, 4], [56, 87, 24]],
  // The pivot: B's first two bars, then up the B13sus4 (G#5 A5 B5 C#6) to D#6 held over B7(b9): the leading tone of E,
  // which the second drop's first note (E6) resolves
  P: [[0, 84, 6], [6, 80, 2], [8, 79, 4], [12, 77, 4], [16, 75, 6], [22, 77, 2], [24, 79, 8], [32, 80, 6], [38, 81, 2], [40, 83, 4], [44, 85, 4], [48, 87, 12]],
};
const tuneOf = (kind) => kind === 'B' ? TUNE.B : kind === 'Bend' ? [...TUNE.B.filter(([s]) => s < 48), ...TUNE.Bend4] : kind === 'A2' ? [...TUNE.A.filter(([s]) => s < 48), ...TUNE.A2end] : kind === 'P' ? TUNE.P : TUNE.A;
// The form, a 4-bar phrase at a time (bars from 0; the app's bar is one more)
const FORM = [[0, 'A'], [4, 'A2'], [8, 'A'], [12, 'A2'], [16, 'B'], [20, 'A2'], [24, 'A'], [28, 'A2'], [32, 'A'], [36, 'B'], [40, 'A'], [44, 'A2'],
  [48, 'A'], [52, 'A2'], [56, 'B'], [60, 'A'], [64, 'A2'], [68, 'P'], [72, 'A'], [76, 'A2'], [80, 'A'], [84, 'B'], [88, 'A'], [92, 'A2'], [96, 'B'], [100, 'Bend'], [104, 'A'], [108, 'A2']];
const SECTIONS = [[0, 'Intro'], [8, 'Verse'], [16, 'Lift'], [24, 'Drop 1'], [40, 'Post-drop'], [48, 'Break'], [56, 'Swell'], [60, 'Build'], [72, 'Drop 2'], [104, 'Outro'], [112, 'End']];
const LEN_BARS = 114;
const KEY_UP = 72; // from here on everything sounds a semitone up (E major)
const PLAN = [], KIND = [], POS = [];
for (const [b0, kind] of FORM) PH[kind].forEach((c, i) => { PLAN[b0 + i] = c; KIND[b0 + i] = kind; POS[b0 + i] = i; });
PLAN[112] = 'Eb'; PLAN[113] = 'Eb';
const chordAt = (t) => CH[PLAN[Math.max(0, Math.min(PLAN.length - 1, Math.floor(t / 16)))]];
const toneRange = (c, lo, hi) => range(hi - lo + 1).map((i) => lo + i).filter((p) => c.tones.includes(((p % 12) + 12) % 12));
const P = { piano: [], keys: [], wash: [], stack: [], lead: [], lead2: [], chop: [], glass: [], bass: [], sub: [], riser: [], swell: [], down: [], drums: [] };

const held = (part, b0, b1, vel, cap = 99) => bars(b0, b1).forEach((b) => chordAt(b * 16).voicing.forEach((p) => { let q = p; while (q > cap) q -= 12; part.push(N(q, b * 16, 16.1, typeof vel === 'function' ? vel(b) : vel)); }));
const tune = (b0, kind, vel, shift = 0, part = P.lead) => tuneOf(kind).forEach(([st, p, l]) => part.push(N(p + shift, b0 * 16 + st, l + 0.1, st % 8 === 0 ? vel : vel - 0.06)));
const bassBars = (b0, b1, mode = 'oct', vel = 0.85, subVel = 0.85) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16), t = b * 16;
  if (mode === 'hold') P.bass.push(N(c.bass, t, 16.12, vel));
  else if (mode === 'oct') { P.bass.push(N(c.bass, t, 12.12, vel)); P.bass.push(N(c.bass + 12, t + 12, 4.12, vel - 0.1)); }
  else range(8).forEach((k) => P.bass.push(N(c.bass + (k % 2 ? 12 : 0), t + 2 * k, 2.12, k % 2 ? vel - 0.13 : vel))); // 8th root/octave
  if (subVel) P.sub.push(N(c.bass - 12, t, 16.12, subVel));
});
const D = (row, t, l = 1, v = 0.8) => P.drums.push(N(row, t, l, v));

// --- The piano's three ways of playing --------------------------------------------------------
// 8th broken chords (the intro's), the left hand's octave held
const broken8 = (b0, b1, vel, hi = 72) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16), tones = toneRange(c, 55, hi);
  [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, b * 16, 16, vel + 0.05)));
  for (let st = 0; st < 16; st += 2) P.piano.push(N(tones[[0, 2, 1, 3, 2, 4, 3, 1][st >> 1] % tones.length], b * 16 + st, 2.5, [0, 6, 12].includes(st) ? vel : vel - 0.15));
});
// A ballad: the chord struck once, then a slow quiet arpeggio under the tune
const ballad = (b0, b1, vel) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16), tones = toneRange(c, 55, 67);
  [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, b * 16, 16, vel + 0.1)));
  c.voicing.filter((p) => p <= 67).forEach((p) => P.piano.push(N(p, b * 16, 8, vel)));
  [4, 6, 10, 12, 14].forEach((st, k) => P.piano.push(N(tones[[1, 2, 3, 2, 1][k] % tones.length], b * 16 + st, 3, vel - 0.12)));
});
// The drop's steady 16th up-down arpeggios under the tune (to Bb4); at a phrase's end, while the tune holds, a run up two
// octaves in 16ths finishing in 32nds; where the tune still moves, only the last beat flies up in 32nds (take A3's)
const ARP = [0, 1, 2, 3, 4, 3, 2, 1];
const flow = (b0, b1, vel, hi = 70) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16), tones = toneRange(c, 53, hi);
  [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, b * 16, 16, vel + 0.08)));
  const phraseEnd = POS[b] === 3;
  const holds = phraseEnd && (KIND[b] === 'A' || KIND[b] === 'P');
  for (let st = 0; st < 16; st++) {
    if (holds && st >= 4) continue;
    if (phraseEnd && !holds && st >= 12) continue;
    P.piano.push(N(tones[ARP[st % 8] % tones.length], b * 16 + st, 1.3, st % 4 === 0 ? vel : vel - 0.18));
  }
  if (phraseEnd && !holds) { const run = toneRange(c, 70, 94); for (let k = 0; k < 8; k++) P.piano.push(N(run[Math.round((k / 7) * (run.length - 1))], b * 16 + 12 + k / 2, 0.6, vel - 0.08 + 0.02 * k)); }
  if (holds) {
    const run = toneRange(c, 63, 98);
    for (let k = 0; k < 8; k++) P.piano.push(N(run[Math.round((k / 15) * (run.length - 1))], b * 16 + 4 + k, 1.2, vel - 0.12 + 0.02 * k));
    for (let k = 0; k < 8; k++) P.piano.push(N(run[Math.round(((8 + k) / 15) * (run.length - 1))], b * 16 + 12 + k / 2, 0.6, vel - 0.05 + 0.02 * k));
  }
});
// --- The vowel chops --------------------------------------------------------------------------
// The tune cut up (the post-drop's hook): the pitch the tune is on, struck in a syncopated 16th rhythm, two of them an
// octave up
const chopCut = (b0, kind, vel) => {
  const notes = tuneOf(kind);
  for (let bar = 0; bar < 4; bar++) [0, 2, 3, 6, 8, 10, 11, 14].forEach((st, k) => {
    const at = bar * 16 + st;
    const n = [...notes].reverse().find(([s]) => s <= at);
    if (n) P.chop.push(N(n[1] + (k === 5 || k === 6 ? 12 : 0), b0 * 16 + at, 1.5, st % 4 ? vel - 0.1 : vel));
  });
};
// The second drop's counter-hook: off-beat answers on the chord's top tones, an octave away from the tune (above it, or
// below it when the tune is up an octave), a two-bar call that comes back every two bars
const counter = (b0, b1, below, vel) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16), tones = below(b) ? toneRange(c, 68, 81) : toneRange(c, 82, 94);
  const top = tones.length - 1;
  const cells = b % 2 ? [[2, top, 2], [5, top - 1, 1.5], [10, top - 2, 2], [13, top - 1, 2]] : [[2, top - 1, 1.5], [7, top, 2], [10, top - 1, 1.5], [14, top - 3, 2]];
  cells.forEach(([st, k, l], i) => P.chop.push(N(tones[Math.max(0, k)], b * 16 + st, l, i === 1 ? vel : vel - 0.08)));
});

// ---------------------------------------------------------------------------------------------
// The arrangement
// ---------------------------------------------------------------------------------------------
// Intro (bars 0-7, take A3's): piano alone; from bar 4 the tune on the piano (A'), the wash, the bass, hats, at bars 6-7
// a half-weight breakbeat and a fill
broken8(0, 8, 0.62);
tune(4, 'A2', 0.66, 0, P.keys);
held(P.wash, 4, 8, 0.45);
bassBars(4, 8, 'hold', 0.7, 0.6);
P.riser.push(N('C4', 96, 32, 0.5));
// Verse (8-15): the tune on the piano (A A'), doubled an octave up by the glass pluck the second time; the 8th broken
// chords kept under it; half-time drums; the bass on the roots
broken8(8, 16, 0.44, 67);
tune(8, 'A', 0.68, 0, P.keys); tune(12, 'A2', 0.7, 0, P.keys);
tune(12, 'A2', 0.5, 12, P.glass);
held(P.wash, 8, 16, 0.5);
bassBars(8, 16, 'hold', 0.6, 0.45);
// (the tune holds Eb5 at the end of the A: a vowel-chop answer in the gap, the first sign of the chops)
[[4, 82, 2], [6, 84, 2], [8, 87, 4]].forEach(([st, p, l]) => P.chop.push(N(p, 11 * 16 + st, l, 0.5)));
// Lift (16-23): the supersaw lead's first entry, singing B then A' at full height, with the held stack and the piano's
// 16ths, but no kick, no bass and no sub (held back for the drop); a riser and a snare build over the last two bars, then
// a one-beat stop with a reverse swell into the drop
flow(16, 24, 0.5);
held(P.wash, 16, 24, 0.55);
held(P.stack, 16, 24, (b) => 0.45 + 0.02 * (b - 16), 70);
tune(16, 'B', 0.8); tune(20, 'A2', 0.82);
P.riser.push(N('C4', 22 * 16, 28, 0.6));
P.swell.push(N('C4', 23 * 16, 16, 0.75));
// Drop 1 (24-39, take A3's drop): A, A', A an octave up (the original octave doubled softly under it), the lifted B
flow(24, 40, 0.56);
held(P.wash, 24, 40, 0.55);
held(P.stack, 24, 40, 0.7, 70);
tune(24, 'A', 0.88); tune(28, 'A2', 0.88); tune(32, 'A', 0.88, 12); tune(36, 'B', 0.9);
tune(32, 'A', 0.6, 0, P.lead2); tune(36, 'B', 0.55, -12, P.lead2);
bassBars(24, 40, 'oct');
// Post-drop (40-47): the lead rests and the vowel chops cut the tune up (A A'), over the wash and the piano's broken 8ths
// (the stack out); the drums thin out over the last four bars and a downlifter falls into the break
broken8(40, 48, 0.5, 70);
held(P.wash, 40, 48, 0.6);
chopCut(40, 'A', 0.85); chopCut(44, 'A2', 0.85);
bassBars(40, 48, 'hold', 0.82, 0.8);
P.down.push(N('C5', 47 * 16 + 8, 24, 0.6));
// Break (48-55): piano alone with the wash: the chord struck once and a slow arpeggio, the tune (A A') in the right hand
ballad(48, 56, 0.42);
tune(48, 'A', 0.74, 0, P.keys); tune(52, 'A2', 0.74, 0, P.keys);
held(P.wash, 48, 56, 0.42);
// Swell (56-59): the B on the piano, the glass pluck an octave over it, the stack swelling bar by bar, the bass back
broken8(56, 60, 0.45, 67);
tune(56, 'B', 0.78, 0, P.keys); tune(56, 'B', 0.42, 12, P.glass);
held(P.wash, 56, 60, 0.55);
held(P.stack, 56, 60, (b) => 0.4 + 0.1 * (b - 56), 70);
bassBars(56, 60, 'hold', 0.6, 0.55);
P.swell.push(N('C4', 59 * 16, 16, 0.6));
// Build (60-71): the lift again, longer: the lead sings A then A' (doubled an octave up), the piano's 16ths, hats then
// snares, still no kick or bass; at bar 68 the pivot (Fm9 Bb13sus4 B13sus4 B7(b9)): a four-on-the-floor kick and a soft
// bass come in, a riser, the tune climbs to D#6, a snare build, a one-beat stop and a reverse swell
flow(60, 72, 0.5);
held(P.wash, 60, 72, 0.55);
held(P.stack, 64, 72, 0.6, 70);
tune(60, 'A', 0.8); tune(64, 'A2', 0.84); tune(64, 'A2', 0.5, 12, P.lead2);
tune(68, 'P', 0.88); tune(68, 'P', 0.55, -12, P.lead2);
bassBars(68, 72, 'hold', 0.75, 0.6);
P.riser.push(N('C4', 68 * 16, 60, 0.65));
P.swell.push(N('C4', 71 * 16, 16, 0.8));
// Drop 2 (72-103, a semitone up): longer, wider, higher. It starts with the A an octave up (the D#6 resolving to E6), then
// A', A, B; the second half again A up, A', B and B's last time; the original octave doubled; the vowel chops' new
// counter-hook throughout; the glass pluck doubling the piano's runs, and from bar 88 a high 8th sparkle; from bar 88
// a busier kick, the bass in 8ths and double-time fills
flow(72, 104, 0.58);
held(P.wash, 72, 104, 0.55);
held(P.stack, 72, 104, 0.75, 70);
const D2 = [[72, 'A', 12, 0], [76, 'A2', 0, null], [80, 'A', 0, 12], [84, 'B', 0, -12], [88, 'A', 12, 0], [92, 'A2', 0, 12], [96, 'B', 0, -12], [100, 'Bend', 0, -12]];
D2.forEach(([b0, kind, shift, dbl]) => { tune(b0, kind, 0.9, shift); if (dbl !== null) tune(b0, kind, dbl > 0 ? 0.45 : dbl < 0 ? 0.55 : 0.6, dbl, P.lead2); });
const leadUp = (b) => D2.some(([b0, , shift]) => shift === 12 && b >= b0 && b < b0 + 4);
counter(72, 104, leadUp, 0.5);
bassBars(72, 88, 'oct'); bassBars(88, 100, 'pulse'); bassBars(100, 104, 'oct');
bars(88, 104).forEach((b) => { const c = chordAt(b * 16), tones = toneRange(c, 82, 96); range(8).forEach((k) => P.glass.push(N(tones[[0, 2, 4, 2, 1, 3, 5, 3][k] % tones.length], b * 16 + 2 * k, 1.5, k % 2 ? 0.3 : 0.38))); });
// Outro (104-111): back to the intro's piano, the tune once more on it (A, A'), the wash, the drums thinning out
broken8(104, 112, 0.48, 67);
tune(104, 'A', 0.64, 0, P.keys); tune(108, 'A2', 0.6, 0, P.keys);
held(P.wash, 104, 112, 0.45);
bassBars(104, 106, 'hold', 0.75, 0.7);
// End (bar 112): Ebmaj9 (Emaj9), the piano rolling up to Eb6, held
{
  const c = CH.Eb, at = 112 * 16;
  c.voicing.forEach((p) => P.wash.push(N(p, at, 24, 0.5)));
  [c.bass, c.bass + 12].forEach((p) => P.piano.push(N(p, at, 24, 0.66)));
  toneRange(c, 60, 87).forEach((p, i) => P.piano.push(N(p, at + i / 2, 24 - i / 2, 0.52)));
  P.keys.push(N(75, at, 24, 0.6));
  P.bass.push(N(c.bass, at, 20, 0.7)); P.sub.push(N(c.bass - 12, at, 20, 0.7));
}
// The glass pluck doubles the second drop's piano runs an octave up
P.piano.filter((n) => n.at >= KEY_UP * 16 && n.at < 104 * 16 && durationToSteps(n) <= 1.25 && m(n.note) >= 70).forEach((n) => P.glass.push(N(m(n.note) + (m(n.note) + 12 <= 100 ? 12 : 0), n.at, durationToSteps(n), n.velocity * 0.75)));
function durationToSteps(n) { return T.durationToBars(n.duration) * 16; }

// --- Drums (the Designed Kit: C1 kick, D1 snare, D#1 clap, F#1 closed hat, A#1 open hat, C#2 crash, D#2 ride, F1 B1 D2 toms)
// Intro (take A3's): hats from bar 4, a half breakbeat in bars 6-7, a fill
for (let bar = 4; bar < 8; bar++) range(8).forEach((k) => D('F#1', bar * 16 + 2 * k, 1, k % 2 ? 0.42 : 0.3));
[96, 112].forEach((t) => { D('C1', t, 2, 0.6); D('C1', t + 10, 2, 0.5); D('D1', t + 4, 2, 0.5); D('D1', t + 12, 2, 0.55); });
[[120, 'D1'], [121, 'D1'], [122, 'D2'], [123, 'D2'], [124, 'B1'], [125, 'B1'], [126, 'F1'], [127, 'D1']].forEach(([t, r], k) => D(r, t, 1, 0.5 + 0.05 * k));
D('C1', 64, 2, 0.8); D('C#2', 64, 16, 0.4);
// Verse: half time (snare on 3), 8th hats with 16th ghosts, a tom fill at the end
for (let bar = 8; bar < 16; bar++) {
  const t = bar * 16, odd = bar % 2 === 1;
  (odd ? [0, 6, 10] : [0, 10]).forEach((st) => D('C1', t + st, 2, st ? 0.8 : 0.9));
  D('D1', t + 8, 2, 0.88); D('D#1', t + 8, 2, 0.45);
  (odd ? [7, 15] : [14]).forEach((st) => D('D1', t + st, 1, 0.24));
  range(8).forEach((k) => D('F#1', t + 2 * k, 1, k % 2 ? 0.5 : 0.36));
  [3, 11].forEach((st) => D('F#1', t + st, 1, 0.22));
  if (bar % 4 === 3 && bar !== 15) D('A#1', t + 14, 2, 0.4);
}
D('C#2', 8 * 16, 16, 0.55); D('C#2', 12 * 16, 16, 0.4);
[[8, 'B1'], [10, 'B1'], [12, 'D2'], [13, 'D2'], [14, 'F1'], [15, 'F1']].forEach(([st, r], k) => D(r, 15 * 16 + st, 1, 0.55 + 0.05 * k));
// Lift: no kick; snare on 2 and 4, 16th hats, open hats; a snare build in bars 22-23 (8ths, then 16ths), stopping on beat 4
for (let bar = 16; bar < 24; bar++) {
  const t = bar * 16;
  if (bar < 22) [4, 12].forEach((st) => { D('D1', t + st, 2, 0.6); D('D#1', t + st, 2, 0.35); });
  range(16).forEach((st) => { if (bar === 23 && st >= 12) return; D('F#1', t + st, 1, st % 4 === 2 ? 0.42 : st % 2 ? 0.2 : 0.3); });
  if (bar < 22) [6, 14].forEach((st) => D('A#1', t + st, 1, 0.28));
}
range(8).forEach((k) => D('D1', 22 * 16 + 2 * k, 1, 0.38 + 0.03 * k));
range(12).forEach((k) => D('D1', 23 * 16 + k, 1, 0.5 + 0.03 * k));
D('C#2', 16 * 16, 16, 0.45); D('C#2', 20 * 16, 16, 0.4);
// The drop's two-step breakbeat (take A3's): kick 1 and 3-and (and the 2-and on odd bars), snare and clap on 2 and 4,
// ghosts; `o.ride` rides instead of 8th hats, `o.hats16` adds 16th hats, `o.busy` the busier kick cycle and ghost 16ths
const dropBar = (bar, o = {}) => {
  const t = bar * 16, odd = bar % 2 === 1;
  const kicks = o.busy ? [[0, 3, 7, 10], [0, 6, 10, 14], [0, 3, 7, 10, 13], [0, 6, 10]][bar % 4] : odd ? [0, 6, 10] : [0, 10];
  kicks.forEach((st) => D('C1', t + st, 2, st ? 0.85 : 0.95));
  [4, 12].forEach((st) => { D('D1', t + st, 2, 0.95); D('D#1', t + st, 2, 0.5); });
  (o.busy ? [2, 7, 9, 15] : odd ? [7, 9, 15] : [14]).forEach((st) => D('D1', t + st, 1, 0.28));
  range(8).forEach((k) => D(o.ride ? 'D#2' : 'F#1', t + 2 * k, 1, k % 2 ? 0.55 : 0.4));
  if (o.hats16) range(8).forEach((k) => D('F#1', t + 2 * k + 1, 1, 0.22));
  else [3, 11].forEach((st) => D('F#1', t + st, 1, 0.25));
};
// Phrase-end fills, a different one each time
const FILLS = {
  toms: [[8, 'B1'], [10, 'B1'], [12, 'F1'], [13, 'F1'], [14, 'F1'], [15, 'F1']],
  hats32: [12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5].map((s) => [s, 'F#1']),
  snare16: [8, 9, 10, 11, 12, 13, 14, 15].map((s) => [s, 'D1']),
  snare32: [12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5].map((s) => [s, 'D1']),
  // a stutter: kick and snare in 32nds, then hats in 32nds
  glitch: [[12, 'C1'], [12.5, 'D1'], [13, 'C1'], [13.5, 'D1'], [14, 'F#1'], [14.25, 'F#1'], [14.5, 'F#1'], [14.75, 'F#1'], [15, 'D1'], [15.5, 'D1']],
};
const fill = (bar, kind) => FILLS[kind].forEach(([s, r], k, a) => D(r, bar * 16 + s, s % 1 ? 0.5 : 1, 0.5 + (0.35 * k) / a.length));
for (let bar = 24; bar < 40; bar++) {
  const i = bar - 24;
  dropBar(bar, { ride: i >= 8 });
  if (i % 8 === 7) fill(bar, 'toms');
  else if (i % 4 === 3) D('A#1', bar * 16 + 14, 2, 0.45);
  if (i % 4 === 0) D('C#2', bar * 16, 16, i === 0 ? 0.7 : i % 8 === 0 ? 0.6 : 0.45);
}
// Post-drop: the beat with 16th hats, then from bar 44 only the kick's 1 and 3-and, then a snare roll and nothing on beat 4
for (let bar = 40; bar < 48; bar++) {
  const t = bar * 16;
  if (bar < 44) dropBar(bar, { ride: true, hats16: true });
  else if (bar < 47) {
    [0, 10].forEach((st) => D('C1', t + st, 2, 0.85));
    [4, 12].forEach((st) => { D('D1', t + st, 2, 0.85); D('D#1', t + st, 2, 0.45); });
    range(8).forEach((k) => D('F#1', t + 2 * k, 1, k % 2 ? 0.45 : 0.32));
  } else { D('C1', t, 2, 0.85); range(12).forEach((k) => D('D1', t + k, 1, 0.4 + 0.03 * k)); }
}
D('C#2', 40 * 16, 16, 0.5); fill(43, 'hats32');
D('C#2', 48 * 16, 16, 0.32);
// Build: hats 8ths, then 16ths and soft snares, then from the pivot a four-on-the-floor kick; a snare build into the stop
for (let bar = 60; bar < 72; bar++) {
  const t = bar * 16;
  if (bar < 64) { range(8).forEach((k) => D('F#1', t + 2 * k, 1, k % 2 ? 0.4 : 0.28)); continue; }
  range(16).forEach((st) => { if (bar === 71 && st >= 12) return; D('F#1', t + st, 1, st % 4 === 2 ? 0.42 : st % 2 ? 0.2 : 0.3); });
  if (bar < 71) [4, 12].forEach((st) => { D('D1', t + st, 2, bar >= 68 ? 0.75 : 0.55); D('D#1', t + st, 2, 0.35); });
  if (bar >= 68) [0, 4, 8, 12].forEach((st) => { if (bar === 71 && st >= 12) return; D('C1', t + st, 2, 0.82); });
}
range(12).forEach((k) => D('D1', 71 * 16 + k, 1, 0.5 + 0.035 * k));
D('C#2', 64 * 16, 16, 0.4); D('C#2', 68 * 16, 16, 0.5);
// Drop 2: 16th hats throughout, the ride from bar 80, the busier kick and ghost 16ths from bar 88; every phrase end its own
// fill, the double-time ones (snare 16ths, snare 32nds, the stutter) in the second half
const FILL2 = { 75: 'toms', 79: 'hats32', 83: 'snare16', 87: 'glitch', 91: 'toms', 95: 'snare32', 99: 'glitch', 103: 'snare16' };
for (let bar = 72; bar < 104; bar++) {
  const i = bar - 72;
  dropBar(bar, { ride: i >= 8, hats16: true, busy: i >= 16 && i < 28 });
  if (FILL2[bar]) fill(bar, FILL2[bar]);
  if (i % 4 === 0) D('C#2', bar * 16, 16, i % 16 === 0 ? 0.72 : 0.5);
}
// Outro: half time thinning to hats, then the piano alone
for (let bar = 104; bar < 108; bar++) {
  const t = bar * 16;
  if (bar < 106) { D('C1', t, 2, 0.8); D('D1', t + 8, 2, 0.75); }
  range(8).forEach((k) => D('F#1', t + 2 * k, 1, (k % 2 ? 0.4 : 0.3) * (bar < 106 ? 1 : 0.7)));
}
D('C#2', 104 * 16, 16, 0.5); D('C#2', 112 * 16, 16, 0.3);

// --- The stops: on beat 4 of bars 23 and 71 everything but the reverse swell stops
for (const bar of [23, 71]) {
  const s = bar * 16 + 12, e = bar * 16 + 16;
  for (const [k, notes] of Object.entries(P)) {
    if (k === 'swell' || k === 'drums') continue;
    P[k] = notes.filter((n) => n.at < s || n.at >= e).map((n) => (n.at < s && n.at + durationToSteps(n) > s ? { ...n, duration: `0:0:${+(s - n.at).toFixed(4)}` } : n));
  }
}
// --- The second drop and after: a semitone up
for (const [k, notes] of Object.entries(P)) if (k !== 'drums') notes.forEach((n) => { if (n.at >= KEY_UP * 16) n.note = nameOf(m(n.note) + 1); });

// ---------------------------------------------------------------------------------------------
// Tracks: each Fledge Synth track a built-in preset as it is, its own plugin id
// ---------------------------------------------------------------------------------------------
const fledge = (id, preset) => {
  const program = FLEDGE_PRESETS.indexOf(preset);
  if (program < 0) throw new Error('no preset ' + preset);
  return { plugin: { id: `lanterns-${id}`, url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program } } };
};
const eq = (lo, m1f, m1, m2f, m2, hif, hi, cut = 0, low = 0) => ({ peq: { on: true, bands: [
  { on: low > 0, type: 'lowcut', freq: low || 40, gain: 0, q: Math.SQRT1_2 }, { on: true, type: 'lowshelf', freq: 120, gain: lo, q: 0.7 },
  { on: true, type: 'bell', freq: m1f, gain: m1, q: 1 }, { on: true, type: 'bell', freq: m2f, gain: m2, q: 1 },
  { on: true, type: 'highshelf', freq: hif, gain: hi, q: 0.7 }, { on: cut > 0, type: 'highcut', freq: cut || 18000, gain: 0, q: Math.SQRT1_2 }] } });
const wide = (mix = 0.5) => ({ chorus: { on: true, rate: 0.6, depth: 0.7, mix } });
const V = { drums: -11.5, piano: 2, keys: 3, wash: -12, stack: -5, lead: -3, lead2: -13, chop: -4, glass: -19, bass: -6.5, sub: -20, riser: -16, swell: -15, down: -17, ...(arg.vol ?? {}) };
const kitRows = { kick: 'punchyKick', snare: 'tightSnare', clap: 'crispClap', closedHat: 'tightHat', openHat: 'openHat', crash: 'crash', ride: 'ride', tomLow: 'lowTom', tomMid: 'midTom' };
const kit = Object.fromEntries(Object.entries(kitRows).filter(([, v]) => presetSound(v)).map(([k, v]) => [k, presetSound(v)]));
kit.closedHat.level = -4; kit.ride.level = -9;
const COLORS = { drums: '#e05d5d', piano: '#f2c14e', keys: '#f7dc8c', wash: '#7fb7e6', stack: '#5a8fd6', lead: '#e58fd0', lead2: '#c97bb8', chop: '#9fd67f', glass: '#b9f0f0', bass: '#a17be0', sub: '#7a5cc0', riser: '#9aa5b1', swell: '#b0bac4', down: '#8a949e' };
const tracks = [], clips = [];
const add = (id, name, key, extra = {}, fxPatch = {}) => {
  const notes = P[id];
  if (!notes.length) return;
  const st = K.startSends(key, T.defaultTrackFx());
  const fx = { ...st.fx };
  for (const [k, v] of Object.entries(fxPatch)) fx[k] = { ...fx[k], ...v };
  tracks.push({ id, name, color: COLORS[id], instrumentKey: key, isMuted: false, isSoloed: false, isArmed: false, volume: V[id], pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx, reverbSend: st.reverbSend, delaySend: 0, ...extra });
  // One clip per section, named after it (each note in the clip it starts in)
  SECTIONS.forEach(([b0, label], i) => {
    const b1 = i + 1 < SECTIONS.length ? SECTIONS[i + 1][0] : LEN_BARS;
    const inside = notes.filter((n) => n.at >= b0 * 16 && n.at < b1 * 16);
    if (!inside.length) return;
    clips.push({ id: `${id}-${i}`, trackId: id, name: label, startBar: b0 + 1, lengthBars: b1 - b0, isSelected: false, notes: inside.map(({ at, ...n }) => ({ ...n, startOffset: (at - b0 * 16) / 16 })) });
  });
};
add('drums', 'Drums', 'designedKit', { drumDesign: kit }, eq(0, 400, 0, 2500, 0, 6000, -2));
add('piano', 'Piano', 'realGrandPiano', { reverbSend: 0.3 }, eq(-2, 300, -1, 3000, 1, 9000, 1));
add('keys', 'Piano tune', 'realGrandPiano', { reverbSend: 0.3 });
add('wash', 'Wash', 'plugin', { ...fledge('wash', 'Pad/Silk Wash'), reverbSend: 0.35 }, eq(0, 300, 0, 2000, 0, 8000, 0, 0, 150));
add('stack', 'Saw stack', 'plugin', { ...fledge('stack', 'Chords/Silk Stack'), reverbSend: 0.3 }, { ...wide(0.45), ...eq(0, 400, -2, 2500, 0, 5000, -5, 0, 200) });
add('lead', 'Lead', 'plugin', { ...fledge('lead', 'Lead/Soaring Saw'), reverbSend: 0.3 }, { ...wide(0.45), ...eq(0, 500, -2, 3000, 0, 5500, -4, 0, 250) });
add('lead2', 'Lead octave', 'plugin', { ...fledge('lead2', 'Lead/Soaring Saw'), reverbSend: 0.35 }, wide(0.5));
add('chop', 'Vowel chops', 'plugin', { ...fledge('chop', 'Keys/Vowel Chop'), reverbSend: 0.3 }, eq(0, 400, 0, 2500, 0, 8000, 0, 0, 300));
add('glass', 'Glass', 'plugin', { ...fledge('glass', 'Keys/Glass Pluck'), reverbSend: 0.35 });
add('bass', 'Bass', 'plugin', { ...fledge('bass', 'Bass/Round Root'), reverbSend: 0 }, eq(0, 180, 2, 600, -3, 3000, -4, 6000));
add('sub', 'Sub', 'plugin', { ...fledge('sub', 'Bass/Clean Sub'), reverbSend: 0 });
add('riser', 'Riser', 'plugin', { ...fledge('riser', 'FX/Riser'), reverbSend: 0.2 });
add('swell', 'Reverse swell', 'plugin', { ...fledge('swell', 'FX/Reverse Swell'), reverbSend: 0.1 });
add('down', 'Downlifter', 'plugin', { ...fledge('down', 'FX/Downlifter'), reverbSend: 0.2 });

if (arg.dump) {
  const d = {}; for (const [k, v] of Object.entries(P)) d[k] = v.map((n) => [midiOf(n.note), +n.at.toFixed(2), +durationToSteps(n).toFixed(2), +n.velocity.toFixed(2)]);
  return { out: { bpm: BPM, notes: d, chords: PLAN.map((c, b) => [b, c]) }, wavs: {} };
}

// The project: through the app's own file format and back, then into the store as Open does
const barS = 240 / BPM;
const markers = SECTIONS.map(([b, name]) => ({ id: 'm' + b, name, anchor: 'bar', bar: b + 1, seconds: b * barS }));
const built = { name: 'Lanterns', bpm: BPM, swing: 0, loopRegion: { inBar: 1, outBar: LEN_BARS + 1, enabled: false }, tracks, clips, masterFx: { ...T.DEFAULT_MASTER_FX, reverbDecay: 3.2 }, master: T.defaultMasterSettings(), markers };
useTimelineStore.getState().loadProject(parseProject(JSON.parse(JSON.stringify(serializeProject(built)))));
// The mix moves as a user makes them: Duck to kick (Future bass / artcore), the music's pump lighter (-1 dB: artcore
// barely pumps), the sub's hole -4 dB; the Loud master on (Loud, no Crunch)
const ducked = useTimelineStore.getState().duckToKick('future');
const PD = { sub: -3 };
useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map((t) => (t.fx.pump?.on && t.fx.pump.trigger === 'kick' ? { ...t, fx: { ...t.fx, pump: { ...t.fx.pump, depth: depthOfDb(PD[t.id] ?? -1) } } } : t)) });
useTimelineStore.getState().setMasterLoud({ on: true, target: 'loud', crunch: 0, subTilt: 0 });
const project = currentProject();
const out = { bpm: BPM, bars: LEN_BARS, ducked, tracks: project.tracks.map((t) => `${t.id} ${t.plugin ? FLEDGE_PRESETS[t.plugin.state.program] : t.instrumentKey} vol ${t.volume} pump ${t.fx.pump?.on ? t.fx.pump.depth.toFixed(3) : 'off'}`) };
const wavs = {};
if (arg.levels) {
  const [from, to] = arg.levels;
  const lv = {};
  for (const t of project.tracks) {
    const b = await ex.renderArrangement({ ...songOpts(project), loudTargetLufs: undefined, bypassMaster: true, soundOnly: [t.id], startBar: from, endBar: to });
    const L = b.getChannelData(0), R = b.getChannelData(1);
    lv[t.id] = [+integratedLufs(L, R, SR).toFixed(1), health([L, R]).peakDb];
  }
  out.levels = lv;
  return { out, wavs };
}
// The project file, as Save writes it
const sounds = await embedSounds(referencedSoundIds(project));
const json = JSON.stringify(serializeProject({ ...project, sounds }), null, 2);
wavs[FILE + '.fledgetone.json'] = await toUrl(new Blob([json], { type: 'application/json' }));
const r = await renderSong(project);
wavs[FILE + '-mp3'] = await toUrl(await encodeAudio(r.ch, r.sr, 'mp3', { bitDepth: 16 }));
Object.assign(out, r.info, { projectBytes: json.length, loud: r.stats?.loud, limBusy: r.stats?.limiterBusyShare });
// (Where the kicks and snares land, for the hit check)
const onset = (n) => (n.at / 16) * barS + 1105 / SR;
out.onsets = { kicks: P.drums.filter((n) => n.note === 'C1').map(onset), snares: P.drums.filter((n) => n.note === 'D1' && n.velocity > 0.9).map(onset) };
return { out, wavs };
