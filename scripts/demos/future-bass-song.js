// A whole future-bass song grown from the third melodic take "b" (A major, 150 BPM, the 3+3+2 tune), built
// through the app's store as a project the studio can open (markers, one clip per section, the Drop pad,
// reversed swells made by the app's own Reverse), rendered by its export path and saved as a
// .fledgetone.json. It goes off the rails on purpose: a fake-out drop, a second drop that switches to the
// colour-bass sound (Driven Legato bass, Crunch kit, power-chord stabs, glitch edits), a breakdown with the
// tune alone and reharmonised, a tempo ramp 150 -> 175 into a final drop a whole step up (B major).
//
//   OUT=out APP_URL=http://localhost:5511/ node scripts/audio-check/run.cjs scripts/demos/future-bass-song.js '{"file":"off-the-rails","save":true}'
//
// makes out/off-the-rails-mp3.wav (an MP3) and out/off-the-rails-project.wav (the .fledgetone.json, rename both). To check
// the saved file opens: copy it into the repo's songs/ folder (not committed; the dev server serves it) and run with
// '{"open":"/songs/off-the-rails.fledgetone.json"}': it is opened through the app's own open path in a fresh browser
// and exported again (the MP3 comes out identical).
// arg.vol {track: dB}, arg.kick / arg.kick2 / arg.impact (Drum Designer preset ids: the main kick, drop 2's, the
// impacts), arg.crunch, arg.lufs (the export's loudness target), arg.loud (the Loud master's target), arg.range
// [from, to] (0-based bars: export only those), arg.levels [from, to] (each track's own loudness there instead),
// arg.subHole / arg.subRelease / arg.subTrigger (the sub's hole for the kick), arg.pumps {track: pump settings},
// arg.stems [track ids] (also a WAV of those tracks through the master), arg.pcm (also the 16-bit WAV),
// arg.dump (notes only), arg.name (the project's name), arg.file
const ex = await import('/src/audio/exportWav.ts');
const T = await import('/src/store/timelineTypes.ts');
const K = await import('/src/store/partKind.ts');
const { useTimelineStore, currentProject, masterFxOf } = await import('/src/store/timelineStore.ts');
const { FLEDGE_URL, FLEDGE_PRESETS } = await import('/src/audio/plugins/fledgeMacros.ts');
const { paramNamesOf } = await import('/src/audio/plugins/paramNames.ts');
const { presetSound } = await import('/src/store/drumDesign.ts');
const { integratedLufs } = await import('/src/audio/effects/loudMaster.ts');
const { midiOf, nameOf } = await import('/src/store/noteTools.ts');
const { durationToBars } = await import('/src/store/timelineTypes.ts');
const { encodeAudio } = await import('/src/audio/encoders.ts');
const { exportCeilingDbtp } = await import('/src/audio/effects/limiter.ts');
const { depthOfDb } = await import('/src/audio/effects/duckShape.ts');
const { duckPump, drumHitGapMs } = await import('/src/store/duckToKick.ts');
const { barToSeconds } = await import('/src/audio/tempoMap.ts');
const { reverseBlock } = await import('/src/store/reverseActions.ts');
const { parseProject, serializeProject } = await import('/src/store/project.ts');
const { referencedSoundIds } = await import('/src/store/audioClips.ts');
const { embedSounds, importEmbeddedSounds } = await import('/src/audio/soundLibrary.ts');
const sr = 44100;
const CRUNCH = arg.crunch ?? 0.4;
const CEIL = exportCeilingDbtp('mp3');
const LUFS = arg.lufs ?? -9;

if (!paramNamesOf(FLEDGE_URL)) {
  const warm = mkTrack('w', 'plugin', T.defaultTrackFx(), { plugin: { id: 'warm', url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program: 0 } } });
  await ex.renderArrangement({ tracks: [warm], clips: [mkClip('wc', 'w', 1, 1, [{ note: 'C2', startOffset: 0 }])], bpm: 140, swing: 0, masterFx: T.DEFAULT_MASTER_FX, startBar: 1, endBar: 2, ending: 'exact', sampleRate: sr, bypassMaster: true });
}
const toUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
const health = (chans) => { let bad = 0, peak = 0; for (const c of chans) for (let i = 0; i < c.length; i++) { const v = c[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > peak) peak = Math.abs(v); } return { nonFinite: bad, peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(2) }; };
const file = arg.file ?? 'future-bass-song';
const wavs = {};
const out = {};

// The export, as the Export dialog makes an MP3 of the whole song with the Loud master matching a target
async function exportSong(p, extra = {}) {
  let stats = null;
  const endBar = arg.range ? arg.range[1] + 1 : Math.max(...p.clips.map((c) => c.startBar + c.lengthBars));
  const opts = { tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: 0, masterFx: p.masterFx, master: p.master, startBar: arg.range ? arg.range[0] + 1 : 1, endBar, ending: 'ringOut', sampleRate: sr, markers: p.markers, intensity: { value: 1, curves: {} }, peakCeilingDbtp: CEIL, keepRingOut: true, loudTargetLufs: LUFS, onMasterStats: (x) => (stats = x), ...extra };
  let buf = await ex.renderArrangement(opts);
  buf = ex.cutRingOut(buf, opts);
  return { buf, stats, opts };
}
async function finish(p, { buf, stats }, tag = '') {
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  wavs[file + tag + '-mp3'] = await toUrl(await encodeAudio(ch, buf.sampleRate, 'mp3', { bitDepth: 16 }));
  // A fingerprint of the rendered samples (to compare a render of the reopened file with this one)
  let h = 0; for (let i = 0; i < ch[0].length; i += 7) h = (h * 31 + Math.round((ch[0][i] + ch[1][i]) * 1e6)) | 0;
  Object.assign(out, { seconds: +(buf.length / buf.sampleRate).toFixed(2), frames: buf.length, hash: h, ...health(ch), lufs: +integratedLufs(ch[0], ch[1], buf.sampleRate).toFixed(2), loud: stats?.loud, limDb: stats?.limiterPeakDb, limBusy: stats?.limiterBusyShare, clip: stats?.clipper });
  if (arg.pcm) wavs[file + tag + '-pcm'] = await toUrl(new Blob([ex.encodeChannels(ch, buf.sampleRate, 16)]));
}

if (arg.open) {
  // ---- Open a saved project file through the app's own open path, then export it again
  const text = await (await fetch(arg.open)).text();
  const project = parseProject(JSON.parse(text));
  // (The embedded sounds go into this browser's sound library as opening does, waited for here)
  if (project.sounds?.length) await importEmbeddedSounds(project.sounds);
  useTimelineStore.getState().loadProject(project);
  await new Promise((r) => setTimeout(r, 500));
  const p = currentProject();
  out.opened = { name: p.name, tracks: p.tracks.length, clips: p.clips.length, markers: p.markers.length, tempoPoints: p.tempoPoints, sounds: project.sounds?.length ?? 0 };
  await finish(p, await exportSong(p), '-reopened');
  return { out, wavs };
}

const names = paramNamesOf(FLEDGE_URL);
// A Fledge track: its own plugin id; macros {n: 0..1}; over {param name: normalised 0..1}
const SOUNDS = {};
const fledge = (id, preset, macros = {}, over = {}) => {
  const program = FLEDGE_PRESETS.indexOf(preset);
  if (program < 0) throw new Error('no preset ' + preset);
  const set = [...Object.entries(macros), ...Object.entries(over)];
  const values = set.length ? names.map((n) => { if (over[n] !== undefined) return over[n]; const m = n.match(/^Macro (\d)$/); return m && macros[m[1]] !== undefined ? macros[m[1]] : null; }) : undefined;
  SOUNDS[id] = { preset, macros, values: over };
  return { plugin: { id: `songb-${id}`, url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program, ...(values ? { values } : {}) } } };
};
const lin = (v, a, b) => (v - a) / (b - a);
const logn = (v, a, b) => Math.log(v / a) / Math.log(b / a);
let uidN = 0;
const m = (n) => (typeof n === 'number' ? n : midiOf(n));
const range = (n) => Array.from({ length: n }, (_, i) => i);
const bars = (a, b) => range(b - a).map((i) => a + i);
// A note at absolute 16th `at` (from bar 0), `steps` long
const N = (note, at, steps, velocity = 0.8) => ({ id: 'x' + uidN++, note: nameOf(m(note)), at, steps: +Math.max(0.25, steps).toFixed(4), velocity: Math.max(0.05, Math.min(1, velocity)) });

// ---------------------------------------------------------------------------------------------
// Harmony, the tune, the form
// ---------------------------------------------------------------------------------------------
const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const pcs = (s) => s.split(' ').map((x) => PC[x]);
const CH = {
  A: { name: 'Amaj9', bass: 45, voicing: [61, 64, 68, 69, 71], tones: pcs('A C# E G# B') },
  BA: { name: 'B/A', bass: 45, voicing: [63, 66, 69, 71], tones: pcs('B D# F# A') },
  Fsm: { name: 'F#m11', bass: 42, voicing: [61, 64, 69, 71], tones: pcs('F# A C# E B') },
  G: { name: 'Gmaj9', bass: 43, voicing: [62, 66, 67, 69], tones: pcs('G B D F# A') },
  E7: { name: 'E7sus4(9)', bass: 40, voicing: [62, 66, 69, 71], tones: pcs('E A B D F#') },
  D: { name: 'Dmaj9', bass: 38, voicing: [61, 64, 66, 69], tones: pcs('D F# A C# E') },
  Dm: { name: 'Dm9', bass: 38, voicing: [60, 64, 65, 69], tones: pcs('D F A C E') },
  Csm: { name: 'C#m7', bass: 37, voicing: [59, 64, 68, 71], tones: pcs('C# E G# B') },
  // the breakdown's new chords under the same tune
  Fsm9: { name: 'F#m9', bass: 42, voicing: [57, 61, 64, 68], tones: pcs('F# A C# E G#') },
  Gsm: { name: 'G#m7', bass: 44, voicing: [59, 63, 66, 68], tones: pcs('G# B D# F#') },
  Bm: { name: 'Bm11', bass: 47, voicing: [57, 61, 62, 66], tones: pcs('B D F# A C# E') },
  Bb: { name: 'Bbmaj7(#11)', bass: 46, voicing: [57, 62, 64, 65], tones: pcs('Bb D F A E') },
  // the dominant of B, into the key change
  Fs7: { name: 'F#7sus4', bass: 42, voicing: [59, 61, 64, 66], tones: pcs('F# B C# E G#') },
};
const PH = { A: ['A', 'BA', 'Fsm', 'G'], A2: ['A', 'BA', 'Fsm', 'E7'], B: ['D', 'Dm', 'Csm', 'E7'], Bx: ['D', 'Dm', 'Csm', 'Fsm'], Ax: ['A', 'BA', 'D', 'G'],
  rA: ['Fsm9', 'Gsm', 'D', 'E7'], rB: ['Bm', 'Bb', 'Csm', 'E7'], A2k: ['A', 'BA', 'Fsm', 'Fs7'] };
// The tune: [16th in the phrase, MIDI, 16ths]; 3+3+2 every bar
const TUNE = {
  A: [[0, 73, 6], [6, 76, 6], [12, 81, 4], [16, 78, 6], [22, 75, 6], [28, 71, 4], [32, 73, 6], [38, 76, 6], [44, 78, 4], [48, 71, 12]],
  A2end: [[48, 76, 12]],
  B: [[0, 78, 6], [6, 76, 6], [12, 73, 4], [16, 77, 6], [22, 76, 6], [28, 74, 4], [32, 76, 6], [38, 80, 6], [44, 83, 4], [48, 83, 6], [54, 81, 6], [60, 80, 4]],
};
const tuneOf = (kind) => (kind.startsWith('B') || kind === 'rB' ? TUNE.B : kind.startsWith('A2') ? [...TUNE.A.filter(([s]) => s < 48), ...TUNE.A2end] : TUNE.A);
// The song (0-based bars): [first bar, phrase, key shift]
const FORM = [
  [0, 'A', 0], [4, 'A', 0], [8, 'A2', 0], // intro: e-piano, the tune softly, the build
  [12, 'A', 0], [16, 'A2', 0], [20, 'A', 0], [24, 'Bx', 0], // drop 1
  [28, 'rA', 0], [32, 'rB', 0], // breakdown: the tune alone, new chords
  [36, 'A', 0], [40, 'A2', 0], // half-time verse
  [44, 'B', 0], // build 2 and the fake-out
  [48, 'A', 0], [52, 'A2', 0], [56, 'A', 0], [60, 'B', 0], // drop 2: the colour-bass switch
  [64, 'rB', 0], [68, 'A2k', 0], // bridge: stripped, then the tempo ramp
  [72, 'A', 2], [76, 'A2', 2], [80, 'Ax', 2], [84, 'B', 2], [88, 'A2', 2], [92, 'B', 2], // final drop in B, 175 BPM
  [96, 'A', 2], [100, 'A', 2], // outro
];
const PLAN = [], SHIFT = [];
for (const [b0, kind, sh] of FORM) PH[kind].forEach((c, i) => { PLAN[b0 + i] = c; SHIFT[b0 + i] = sh; });
const LEN = 104;
const SECTIONS = [[0, 'Intro'], [8, 'Build'], [12, 'Drop'], [28, 'Breakdown'], [36, 'Half-time'], [44, 'Fake-out'], [48, 'Drop 2'], [64, 'Bridge'], [68, 'Speed up'], [72, 'Final drop'], [96, 'Outro']];
const sectionOf = (bar) => SECTIONS.filter(([b]) => b <= bar).pop();
const chordAt = (t) => { const b = Math.max(0, Math.min(LEN - 1, Math.floor(t / 16))); const c = CH[PLAN[b]]; const s = SHIFT[b]; return s ? { ...c, bass: c.bass + s, voicing: c.voicing.map((p) => p + s), tones: c.tones.map((p) => (p + s) % 12) } : c; };
const shiftAt = (t) => SHIFT[Math.max(0, Math.min(LEN - 1, Math.floor(t / 16)))];
const P = {};
const part = (k) => (P[k] ??= []);
const held = (k, b0, b1, vel, cap = 99) => bars(b0, b1).forEach((b) => chordAt(b * 16).voicing.forEach((p) => { let q = p; while (q > cap) q -= 12; part(k).push(N(q, b * 16, 16.1, vel)); }));
const RH332 = [[0, 6], [6, 6], [12, 4]];
const struck = (k, b0, b1, vel, cap = 99, withBass = false, rh = RH332) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16);
  rh.forEach(([st, l], i) => [...(withBass ? [c.bass + 12] : []), ...c.voicing].forEach((p) => { let q = p; while (q > cap) q -= 12; part(k).push(N(q, b * 16 + st, l + 0.15, i ? vel - 0.08 : vel)); }));
});
const tune = (b0, kind, vel, k = 'lead', oct = 0) => { const sh = SHIFT[b0] ?? 0; tuneOf(kind).forEach(([st, p, l]) => part(k).push(N(p + sh + oct, b0 * 16 + st, l + 0.1, st % 8 === 0 ? vel : vel - 0.06))); };
const bassBars = (b0, b1, mode = 'oct', k = 'bass', vel = 0.85) => bars(b0, b1).forEach((b) => {
  const c = chordAt(b * 16), t = b * 16;
  if (mode === 'hold') part(k).push(N(c.bass, t, 16.12, vel));
  else if (mode === 'oct') { part(k).push(N(c.bass, t, 12.12, vel)); part(k).push(N(c.bass + 12, t + 12, 4.12, vel - 0.1)); }
  else range(8).forEach((i) => part(k).push(N(c.bass + (i % 2 ? 12 : 0), t + 2 * i, 2.12, i % 2 ? vel - 0.13 : vel)));
});
const subBars = (b0, b1, vel = 0.85) => bars(b0, b1).forEach((b) => part('sub').push(N(chordAt(b * 16).bass - 12, b * 16, 16.12, vel)));
// Drum rows: kick C1, snare D1, clap D#1, closed hat F#1, open hat A#1, toms F1 B1 D2, crash C#2
const D = (k, row, t, l = 1, v = 0.8) => part(k).push(N(row, t, l, v));

// ---------------------------------------------------------------------------------------------
// The music
// ---------------------------------------------------------------------------------------------
// --- Intro (0-11): e-piano struck 3+3+2 with a soft wash; 4-7 the lead sings A softly over half-time drums;
//     8-11 the build: A' with the chords in, hats to 16ths, a snare roll, the riser; the last beat of bar 11 is a gap
struck('keys', 0, 12, 0.62, 99, true);
held('wash', 0, 4, 0.36); held('wash', 4, 12, 0.48, 69);
tune(4, 'A', 0.62); tune(8, 'A2', 0.72);
struck('stack', 8, 11, 0.5, 69);
bassBars(4, 8, 'hold'); bassBars(8, 11, 'hold', 'bass', 0.55); subBars(8, 11, 0.7);
part('bass').push(N(CH.E7.bass, 11 * 16, 12, 0.6)); part('sub').push(N(CH.E7.bass - 12, 11 * 16, 12, 0.7));
part('riser').push(N('E4', 8 * 16, 44, 0.45));
for (let bar = 4; bar < 8; bar++) {
  const t = bar * 16;
  D('drums', 'C1', t, 2, 0.8); if (bar % 2) D('drums', 'C1', t + 10, 2, 0.65);
  if (bar < 7) { D('drums', 'D1', t + 8, 2, 0.75); D('drums', 'D#1', t + 8, 1, 0.45); }
  range(8).forEach((k) => D('drums', 'F#1', t + 2 * k, 1, k % 2 ? 0.4 : 0.28));
}
[0, 4, 6, 8, 10, 12, 13, 14, 15].forEach((st, k) => D('drums', 'D1', 112 + st, 1, 0.45 + 0.05 * k));
for (let bar = 8; bar < 12; bar++) {
  const t = bar * 16;
  D('drums', 'C1', t, 2, 0.75); if (bar % 2) D('drums', 'C1', t + 10, 2, 0.6);
  if (bar >= 10) [4, 8].forEach((st) => D('drums', 'C1', t + st, 2, 0.6));
  range(bar < 10 ? 8 : 12).forEach((k) => D('drums', 'F#1', t + (bar < 10 ? 2 * k : k), 1, 0.25 + 0.015 * k));
}
// the snare roll: 8ths, then 16ths, then 32nds, rising (stops for the gap)
range(8).forEach((k) => D('drums', 'D1', 9 * 16 + 2 * k, 1, 0.25 + 0.025 * k));
range(16).forEach((k) => D('drums', 'D1', 10 * 16 + k, 1, 0.35 + 0.012 * k));
range(24).forEach((k) => D('drums', 'D1', 11 * 16 + k / 2, 0.5, 0.45 + 0.012 * k));

part('swell').push(N(CH.E7.bass + 12, 11 * 16, 16, 0.8), ...CH.E7.voicing.map((p) => N(p, 11 * 16, 16, 0.8)));
// (the build's last two bars muffle down on the Drop pad's Filter, so the drop opens out full)
part('drop').push(N('C#4', 10 * 16, 28, 0.9));

// --- Drop 1 (12-27): full time, snare + clap on 2 and 4; pass 1 sparse, pass 2 busy; an impact and a downlifter on the
//     downbeat; the last bar sweeps down (Drop pad Filter) and the last beat echoes away into the breakdown
const groove = (k, bar, busy) => {
  const t = bar * 16, i = bar % 4;
  const kicks = busy ? [[0, 3, 7, 10], [0, 6, 10, 14], [0, 3, 7, 10, 13], [0, 6, 10]][i] : [[0, 10], [0, 7, 10], [0, 10], [0, 7, 10]][i];
  kicks.forEach((st) => D(k, 'C1', t + st, 2, st ? 0.88 : 1));
  [4, 12].forEach((st) => { D(k, 'D1', t + st, 2, 0.95); D(k, 'D#1', t + st, 1, 0.55); });
  if (busy) {
    range(16).forEach((st) => D(k, 'F#1', t + st, 1, st % 4 === 2 ? 0.5 : st % 2 ? 0.24 : 0.36));
    [2, 6, 10].forEach((st) => D(k, 'A#1', t + st, 1, 0.3));
  } else {
    range(8).forEach((n) => D(k, 'F#1', t + 2 * n, 1, n % 2 ? 0.5 : 0.36));
    [7, 15].forEach((st) => D(k, 'F#1', t + st, 1, 0.2));
  }
};
const fill = (k, bar, kind) => {
  const t = bar * 16;
  if (kind === 'roll') range(8).forEach((n) => D(k, 'D1', t + 8 + n, 1, 0.45 + 0.06 * n));
  else if (kind === 'toms') [[8, 'D2'], [10, 'D2'], [12, 'B1'], [13, 'B1'], [14, 'F1'], [15, 'F1']].forEach(([st, r], n) => D(k, r, t + st, 1, 0.6 + 0.05 * n));
  else if (kind === 'hats') [12, 12.5, 13, 13.5, 14, 14 + 2 / 3, 15 + 1 / 3].forEach((s, n) => D(k, 'F#1', t + s, 0.5, 0.35 + 0.08 * n));
};
struck('stack', 12, 28, 0.82, 69);
held('wash', 12, 28, 0.55, 69);
tune(12, 'A', 0.88); tune(16, 'A2', 0.88); tune(20, 'A', 0.88); tune(24, 'Bx', 0.88);
bassBars(12, 20, 'oct'); bassBars(20, 28, 'pulse'); subBars(12, 28);
[23].forEach((b) => [[4, 85, 2], [6, 88, 2], [8, 93, 4], [12, 88, 2], [14, 85, 2]].forEach(([st, p, l]) => part('counter').push(N(p, b * 16 + st, l, 0.7))));
[19].forEach((b) => [[4, 88, 2], [6, 85, 2], [8, 83, 4]].forEach(([st, p, l]) => part('counter').push(N(p, b * 16 + st, l, 0.6))));
for (let bar = 12; bar < 28; bar++) {
  groove('drums', bar, bar >= 20);
  if ((bar - 12) % 4 === 3) fill('drums', bar, { 15: 'hats', 19: 'toms', 23: 'hats', 27: 'roll' }[bar]);
  if ((bar - 12) % 4 === 0) D('drums', 'C#2', bar * 16, 16, bar === 12 || bar === 20 ? 0.7 : 0.5);
}
D('impact', 'C1', 12 * 16, 16, 0.95); part('down').push(N('C5', 12 * 16, 32, 0.6));
part('drop').push(N('C#4', 27 * 16, 12, 0.9), N('F4', 27 * 16 + 12, 4, 0.9));

// --- Breakdown (28-35): the e-piano alone plays the tune over new chords (F#m9 G#m7 Dmaj9 E7sus4 | Bm11 Bbmaj7#11
//     C#m7 E7sus4), the wash creeps back in the second half; a reversed swell into the half-time verse
struck('keys', 28, 36, 0.5, 69, true);
tune(28, 'rA', 0.72, 'keys'); tune(32, 'rB', 0.72, 'keys');
held('wash', 32, 36, 0.34, 69);
part('swell').push(N(CH.A.bass + 12, 35 * 16, 16, 0.8), ...CH.A.voicing.map((p) => N(p, 35 * 16, 16, 0.8)));

// --- Half-time verse (36-43): the lead sings A A' over half-time drums (kick 1 and 3-and, snare on 3), the
//     colour-bass bass growling low under it (held roots, gliding), the e-piano and wash
struck('keys', 36, 44, 0.5, 69, true);
held('wash', 36, 44, 0.42, 69);
tune(36, 'A', 0.76); tune(40, 'A2', 0.8);
bassBars(36, 44, 'hold', 'bass', 0.7);
subBars(36, 44, 0.8);
for (let bar = 36; bar < 44; bar++) {
  const t = bar * 16;
  [0, 10].forEach((st) => D('drums', 'C1', t + st, 2, st ? 0.75 : 0.88)); if (bar % 2) D('drums', 'C1', t + 7, 2, 0.65);
  D('drums', 'D1', t + 8, 2, 0.85); D('drums', 'D#1', t + 8, 1, 0.5);
  range(8).forEach((k) => D('drums', 'F#1', t + 2 * k, 1, k % 2 ? 0.4 : 0.27));
  if (bar === 39) fill('drums', bar, 'hats');
  if (bar === 36) D('drums', 'C#2', t, 16, 0.55);
}

// --- Build 2 and the fake-out (44-47): the B phrase with the chords in 8ths, a snare roll, the riser; bar 46 drops
//     (impact, drums, chords) for two beats, then Tape stop slows it all to a halt; bar 47 is the tune's first figure
//     chopped in 32nds alone through the Gate, the snare flams up, and drop 2 comes in
tune(44, 'B', 0.84);
struck('stack', 44, 46, 0.62, 69, false, range(8).map((i) => [2 * i, 2]));
bassBars(44, 46, 'pulse'); subBars(44, 47, 0.8);
part('riser').push(N('E4', 44 * 16, 32, 0.6));
range(16).forEach((k) => D('drums', 'D1', 44 * 16 + 2 * k, 1, 0.35 + 0.02 * k));
range(16).forEach((k) => D('drums', 'D1', 45 * 16 + k, 1, 0.5 + 0.02 * k));
bars(44, 46).forEach((b) => range(8).forEach((k) => D('drums', 'F#1', b * 16 + 2 * k + 1, 1, 0.35)));
bars(44, 46).forEach((b) => [0, 4, 8, 12].forEach((st) => D('drums', 'C1', b * 16 + st, 2, 0.85)));
// the fake drop
D('impact', 'C1', 46 * 16, 16, 0.85);
struck('stack', 46, 47, 0.82, 69); held('wash', 46, 47, 0.55, 69); bassBars(46, 47, 'oct');
groove('drums', 46, true); D('drums', 'C#2', 46 * 16, 16, 0.6);
// (the lead's B phrase goes on through bar 46; its last bar gives way to the chopped figure)
P.lead = P.lead.filter((n) => !(n.at >= 47 * 16 && n.at < 48 * 16));
part('drop').push(N('D4', 46 * 16 + 8, 8, 0.9));
// bar 47: the tune's first figure chopped: C#5 E5 A5 in 32nds, each a step up the octave, through the Gate
[[0, 73], [3, 76], [6, 81], [8, 85], [10, 88], [12, 93]].forEach(([st, p], k) => { const l = k < 5 ? (k === 2 ? 2 : 3) : 4; for (let s = 0; s < l; s += 0.5) part('chop').push(N(p, 47 * 16 + st + s, 0.45, 0.9 - 0.05 * (s % 1))); });
part('drop').push(N('E4', 47 * 16, 12, 0.9), N('C4', 47 * 16 + 14, 2, 0.9));
range(16).forEach((k) => D('drums', 'D1', 47 * 16 + k, 1, 0.3 + 0.025 * k));
range(8).forEach((k) => D('drums', 'F#1', 47 * 16 + 2 * k, 1, 0.3));
part('riser').push(N('E4', 47 * 16, 16, 0.5));
part('swell').push(N(CH.E7.bass + 12, 47 * 16, 16, 0.8), ...CH.E7.voicing.map((p) => N(p, 47 * 16, 16, 0.8)));

// --- Drop 2 (48-63): the colour-bass switch, same tune, same chords as power chords: the Crunch kit's syncopated
//     drop drums, one legato Driven Legato bass leaping octaves on each chord's root (gliding, held into the next
//     note), a Clean Sub on the roots, held power-chord stabs, the lead singing the tune with a chip lead an
//     octave up chopping its long notes into 16ths, glitch edits on the Drop pad at the phrase ends
const lowRoot = (p) => { let r = p % 12; while (r < 28) r += 12; return r; };
const RIFF_P = [[0, 0, 2], [2, 12, 1], [3, 0, 1], [4, 0, 1], [5, 12, 1], [6, 24, 1], [7, 0, 1], [8, 0, 1], [9, 12, 1], [10, 0, 2], [12, 12, 1], [13, 0, 1], [14, 0, 1], [15, 24, 1]];
const RIFF_Q = [[0, 0, 1], [1, 12, 1], [2, 0, 1], [3, 24, 1], [4, 0, 2], [6, 12, 1], [7, 0, 1], [8, 12, 2], [10, 0, 1], [11, 12, 1], [12, 0, 1], [13, 12, 1], [14, 0, 1], [15, 24, 1]];
const RIFF_E = [[0, 0, 1], [1, 12, 1], [2, 0, 1], [3, 7, 1], [4, 12, 1], [5, 19, 1], [6, 12, 1], [7, 24, 1], [8, 0, 2], [10, 12, 1], [11, 0, 1], [12, 7, 1], [13, 12, 1], [14, 19, 2]];
const KICKS2 = [[0, 2, 3, 6, 9, 11, 14], [0, 1, 3, 6, 8, 10, 13], [0, 2, 5, 7, 8, 10, 13, 15], [0, 3, 5, 6, 9, 10, 14]];
const STABS = [[[0, 2], [3, 1], [6, 1], [10, 2], [13, 1]], [[0, 1], [2, 1], [4, 2], [7, 1], [12, 2], [15, 1]]];
const HAT_VEL = [0.9, 0.82, 0.38, 0.5];
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
for (let bar = 48; bar < 64; bar++) {
  const i = bar - 48, t = bar * 16, c = chordAt(t), r = lowRoot(c.bass), phraseEnd = i % 4 === 3;
  const riff = phraseEnd ? [...RIFF_Q.filter(([s]) => s < 8), ...RIFF_E.filter(([s]) => s >= 8)] : i % 2 ? RIFF_Q : RIFF_P;
  riff.forEach(([st, off, l]) => part('cbass').push(N(r + off, t + st, l, st % 4 === 0 ? 0.9 : 0.8 + 0.05 * rnd())));
  part('sub').push(N(r, t, 16.1, 0.9));
  // held stabs (the power chord on the root, re-struck on the pattern)
  const s = STABS[i % 2].map(([st]) => st);
  s.forEach((st, k) => part('stabs').push(N(r + 12, t + st, (s[k + 1] ?? 16) - st, st % 4 === 0 ? 0.85 : 0.75)));
  KICKS2[(i + (i >> 2)) % 4].forEach((st) => D('drums2', 'C1', t + st, 1, st % 4 === 0 ? 1 : 0.88));
  [4, 12].forEach((st) => { D('drums2', 'D1', t + st, 2, 1); D('drums2', 'D#1', t + st, 2, 0.6); });
  for (let st = 0; st < (phraseEnd ? 12 : i % 2 ? 14 : 16); st++) D('drums2', 'F#1', t + st, 1, Math.min(1, HAT_VEL[st % 4] + 0.06 * (rnd() - 0.5)));
  if (!phraseEnd && i % 2) [14, 14.5, 15, 15.5].forEach((s2, k) => D('drums2', 'F#1', t + s2, 0.5, 0.55 + 0.1 * k));
  if (phraseEnd) range(8).forEach((k) => D('drums2', 'D1', t + 12 + k / 2, 0.5, 0.45 + 0.07 * k));
  if (i % 8 === 7) [[8, 'D2'], [9, 'D2'], [10, 'B1'], [11, 'F1']].forEach(([st, r2]) => D('drums2', r2, t + st, 1, 0.85));
  if (i % 8 === 0) D('drums2', 'C#2', t, 16, 0.75);
}
tune(48, 'A', 1); tune(52, 'A2', 1); tune(56, 'A', 1); tune(60, 'B', 1);
// the chip lead: the tune an octave up, its long notes chopped into 16ths; at the phrase ends the held note flips octaves
[[48, 'A'], [52, 'A2'], [56, 'A'], [60, 'B']].forEach(([b0, kind]) => tuneOf(kind).forEach(([st, p, l]) => {
  const end = st + l >= 48 && l >= 6;
  for (let s = 0; s < l; s++) part('chop').push(N(p + 12 + (end && s % 2 ? 12 : 0), b0 * 16 + st + s, 0.8, s ? 0.62 : 0.8));
}));
D('impact', 'C1', 48 * 16, 16, 1); part('down').push(N('C5', 48 * 16, 32, 0.6));
part('drop').push(N('C4', 51 * 16 + 14, 2, 0.9), N('C4', 55 * 16 + 12, 4, 0.9), N('D#4', 59 * 16, 16, 0.9), N('E4', 62 * 16 + 8, 8, 0.9), N('C4', 63 * 16 + 12, 4, 0.9));

// --- Bridge (64-71): drums out, a downlifter; the tune's answer alone on a sine over the held wash with the
//     breakdown's chords; then the tempo ramps 150 -> 175 over four bars (A' with the chords in 8ths, a snare roll
//     speeding up, the riser) onto F#7sus4, the dominant of B; a reversed swell fills the gap before the final drop
part('down').push(N('C5', 64 * 16, 32, 0.6));
tune(64, 'rB', 0.8, 'lead2');
held('wash', 64, 68, 0.5, 69);
bars(64, 68).forEach((b) => part('sub').push(N(chordAt(b * 16).bass - 12, b * 16, 16.1, 0.6)));
D('drums', 'C1', 64 * 16, 2, 1);
tune(68, 'A2k', 0.72);
struck('stack', 68, 71, 0.5, 69, false, range(8).map((i) => [2 * i, 2]));
struck('stack', 71, 72, 0.55, 69, false, [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2]]);
held('wash', 68, 72, 0.5, 69);
bassBars(68, 71, 'hold', 'bass', 0.55); part('bass').push(N(CH.Fs7.bass, 71 * 16, 12, 0.6)); subBars(68, 71, 0.8); part('sub').push(N(CH.Fs7.bass - 12, 71 * 16, 12, 0.8));
part('riser').push(N('E4', 68 * 16, 60, 0.45));
bars(68, 72).forEach((b) => [0, 4, 8, 12].forEach((st) => (b < 71 || st < 12) && D('drums', 'C1', b * 16 + st, 2, 0.7)));
range(16).forEach((k) => D('drums', 'D1', 68 * 16 + 2 * k, 1, 0.25 + 0.012 * k));
range(16).forEach((k) => D('drums', 'D1', 70 * 16 + k, 1, 0.38 + 0.012 * k));
range(24).forEach((k) => D('drums', 'D1', 71 * 16 + k / 2, 0.5, 0.45 + 0.01 * k));
bars(68, 72).forEach((b) => range(b < 71 ? 16 : 12).forEach((st) => D('drums', 'F#1', b * 16 + st, 1, 0.22 + 0.1 * ((b - 68) / 4))));
const B_ = (c) => ({ ...c, bass: c.bass + 2, voicing: c.voicing.map((p) => p + 2) });
part('swell').push(N(B_(CH.A).bass + 12, 71 * 16, 16, 0.8), ...B_(CH.A).voicing.map((p) => N(p, 71 * 16, 16, 0.8)));
part('drop').push(N('C#4', 70 * 16, 28, 0.9));

// --- Final drop (72-95), 175 BPM, B major: everything in and busy; the third pass sings A an octave up over the new
//     chord, then B; the last pass has the chip lead chopping the tune (pitched edits) and glitches before home
struck('stack', 72, 96, 0.84, 71);
held('wash', 72, 96, 0.55, 71);
tune(72, 'A', 0.88); tune(76, 'A2', 0.88); tune(80, 'Ax', 0.86, 'lead', 12); tune(84, 'B', 0.88); tune(88, 'A2', 0.88); tune(92, 'B', 0.9);
tune(80, 'Ax', 0.62, 'lead2'); tune(84, 'B', 0.6, 'lead2', 12); tune(92, 'B', 0.62, 'lead2', 12);
bassBars(72, 96, 'pulse'); subBars(72, 96);
[[88, 'A2']].forEach(([b0, kind]) => tuneOf(kind).forEach(([st, p, l]) => { for (let s = 0; s < l; s++) part('chop').push(N(p + 2 + 12 + (s % 4 === 3 ? 12 : 0), b0 * 16 + st + s, 0.8, s ? 0.6 : 0.78)); }));
[75, 83].forEach((b) => [[4, 85, 2], [6, 88, 2], [8, 93, 4], [12, 88, 2], [14, 85, 2]].forEach(([st, p, l]) => part('counter').push(N(p + 2, b * 16 + st, l, 0.7))));
for (let bar = 72; bar < 96; bar++) {
  groove('drums3', bar, true);
  if ((bar - 72) % 4 === 3) fill('drums3', bar, { 75: 'hats', 79: 'toms', 83: 'hats', 87: 'roll', 91: 'toms', 95: 'roll' }[bar]);
  if ((bar - 72) % 4 === 0) D('drums3', 'C#2', bar * 16, 16, bar % 8 === 0 ? 0.7 : 0.5);
}
D('impact', 'C1', 72 * 16, 16, 1); part('down').push(N('C5', 72 * 16, 32, 0.6));
part('drop').push(N('C4', 79 * 16 + 14, 2, 0.9), N('E4', 87 * 16 + 12, 4, 0.9), N('C4', 91 * 16 + 12, 2, 0.9), N('C4', 91 * 16 + 14, 2, 0.9), N('F4', 95 * 16 + 12, 4, 0.9));

// --- Outro (96-103): the e-piano 3+3+2 as the song began, the lead sings A softly, then Bmaj9 rings
struck('keys', 96, 100, 0.6, 99, true);
held('wash', 96, 100, 0.45, 71);
tune(96, 'A', 0.6);
const c0 = B_(CH.A), END = 100 * 16;
c0.voicing.forEach((p) => { part('wash').push(N(p, END, 40, 0.5)); part('keys').push(N(p, END, 40, 0.6)); });
part('keys').push(N(c0.bass, END, 40, 0.62)); part('lead').push(N(83, END, 24, 0.72)); part('lead2').push(N(95, END, 16, 0.45));
part('bass').push(N(c0.bass, END, 24, 0.75)); part('sub').push(N(c0.bass - 12, END, 24, 0.75));
D('drums3', 'C1', END, 2, 0.9); D('drums3', 'C#2', END, 16, 0.5); D('impact', 'C1', END, 16, 0.6);

// The gaps before the drops: everything stops on the last beat (the swell, the Drop pad and the snare roll aside)
const gapAt = (bar, from) => { const g0 = bar * 16 + from, g1 = bar * 16 + 16; for (const k of Object.keys(P)) { if (['swell', 'drop', 'impact'].includes(k)) continue;
  P[k] = P[k].filter((n) => !(n.at >= g0 && n.at < g1)).map((n) => (n.at < g0 && n.at + n.steps > g0 ? { ...n, steps: g0 - n.at } : n)); } };
gapAt(11, 12); gapAt(71, 12);

// ---------------------------------------------------------------------------------------------
// Tracks: one clip per section where a part plays; levels; effects
// ---------------------------------------------------------------------------------------------
const tracks = [], clips = [];
const COLORS = { drums: '#f97316', drums2: '#ef4444', drums3: '#f59e0b', impact: '#dc2626', keys: '#a3e635', wash: '#38bdf8', stack: '#818cf8', lead: '#f472b6', lead2: '#fb7185', counter: '#c084fc', chop: '#e879f9', bass: '#22c55e', cbass: '#16a34a', sub: '#15803d', stabs: '#eab308', riser: '#94a3b8', down: '#64748b', swell: '#67e8f9', drop: '#f43f5e' };
const NAMES = { drums: 'Drums', drums2: 'Drums (drop 2)', drums3: 'Drums (final)', impact: 'Impacts', keys: 'E-piano', wash: 'Wash', stack: 'Chords', lead: 'Lead', lead2: 'Lead double', counter: 'Pluck', chop: 'Chopped lead', bass: 'Bass', cbass: 'Colour bass', sub: 'Sub', stabs: 'Stabs', riser: 'Riser', down: 'Downlifter', swell: 'Swells', drop: 'Drop pad' };
const add = (id, key, extra = {}, fxPatch = {}) => {
  const notes = P[id] ?? [];
  if (!notes.length) return;
  const st = K.startSends(key, T.defaultTrackFx());
  const fx = { ...st.fx };
  for (const [k, v] of Object.entries(fxPatch)) fx[k] = { ...fx[k], ...v };
  tracks.push(mkTrack(id, key, fx, { reverbSend: st.reverbSend, name: NAMES[id] ?? id, color: COLORS[id] ?? '#888', ...extra }));
  // one clip per section the part plays in (each note in the section it starts in, cut at that section's end)
  const ends = [...SECTIONS.map(([b]) => b), LEN];
  SECTIONS.forEach(([b0, name], k) => {
    const b1 = ends[k + 1];
    const mine = notes.filter((n) => n.at >= b0 * 16 && n.at < b1 * 16);
    if (!mine.length) return;
    const lengthBars = b1 - b0;
    clips.push({ id: `c-${id}-${b0}`, trackId: id, name: name, startBar: b0 + 1, lengthBars, isSelected: false,
      notes: mine.map((n) => { const st = n.at - b0 * 16; const l = Math.min(n.steps, lengthBars * 16 - st); return { id: n.id, note: n.note, startOffset: st / 16, duration: `0:0:${+l.toFixed(4)}`, velocity: n.velocity, ...(n.bend ? { bend: n.bend } : {}) }; }) });
  });
};
const eq = (lo, m1f, m1, m2f, m2, hif, hi, cut = 0, low = 0) => ({ peq: { on: true, bands: [
  { on: low > 0, type: 'lowcut', freq: low || 40, gain: 0, q: Math.SQRT1_2 }, { on: true, type: 'lowshelf', freq: 120, gain: lo, q: 0.7 },
  { on: true, type: 'bell', freq: m1f, gain: m1, q: 1 }, { on: true, type: 'bell', freq: m2f, gain: m2, q: 1 },
  { on: true, type: 'highshelf', freq: hif, gain: hi, q: 0.7 }, { on: cut > 0, type: 'highcut', freq: cut || 18000, gain: 0, q: Math.SQRT1_2 }] } });
const wide = (mix = 0.5) => ({ chorus: { on: true, rate: 0.6, depth: 0.7, mix } });
const V = { drums: -7, drums2: -8, drums3: -7, impact: -5, keys: -21, wash: -12, stack: -6, lead: -3, lead2: -11, counter: -13, chop: -11, bass: -1, cbass: 2, sub: -8.5, stabs: -4, riser: -15, down: -12, swell: -12, ...(arg.vol ?? {}) };
const kitOf = (ids, levels = {}) => { const k = Object.fromEntries(Object.entries(ids).filter(([, v]) => v && presetSound(v)).map(([r, v]) => [r, presetSound(v)])); for (const [r, dl] of Object.entries(levels)) if (k[r]) k[r].level = dl; return k; };
const KICK = arg.kick ?? 'dropKick';
// (the kick's tail tuned by hand, A1 then B1 after the key change, so it no longer follows the song's key or is its preset)
const tuneKick = (kit, hz) => { if (kit.kick) { kit.kick.layers = kit.kick.layers.map((l) => (l.voice === 'layerKick' ? { ...l, keyTrack: 0, pitch: hz } : l)); delete kit.kick.preset; } return kit; };
const kitB = { kick: KICK, snare: 'tightLayerSnare', clap: 'snappyClap', closedHat: 'trapHat', openHat: 'openHat', crash: 'crash', tomLow: 'lowTom', tomMid: 'midTom', tomHigh: 'highTom' };
const drumsKit = tuneKick(kitOf(kitB, { closedHat: -5, openHat: -3, ...(arg.rowLevel ?? {}) }), 55);
const finalKit = tuneKick(kitOf(kitB, { closedHat: -5, openHat: -3, ...(arg.rowLevel ?? {}) }), 61.74);
const crunchKit = kitOf({ kick: arg.kick2 ?? 'crunchKick', snare: 'crunchSnare', clap: 'crackClap', closedHat: 'sharpHat', openHat: 'openHat', crash: 'crash', tomLow: 'lowTom', tomMid: 'midTom', tomHigh: 'highTom' }, { closedHat: 1.5, snare: -6 });
const impactKit = kitOf({ kick: arg.impact ?? 'dropImpact' });
add('drums', 'designedKit', { drumDesign: drumsKit, volume: V.drums }, eq(0, 400, 0, 5000, -3, 10000, 3));
add('drums2', 'designedKit', { drumDesign: crunchKit, volume: V.drums2 }, eq(0, 400, 0, 2500, 0, 4500, 5));
add('drums3', 'designedKit', { drumDesign: finalKit, volume: V.drums3 }, eq(0, 400, 0, 5000, -3, 10000, 3));
add('impact', 'designedKit', { drumDesign: impactKit, volume: V.impact, reverbSend: 0.25 });
add('keys', 'realElectricPiano', { volume: V.keys, reverbSend: 0.25 }, eq(-2, 300, -1, 2500, 1, 8000, 0));
add('wash', 'plugin', { ...fledge('wash', 'Pad/Wide Wash', { 1: 0.5, 2: 0.6 }), volume: V.wash, reverbSend: 0.3 }, { ...wide(0.6), ...eq(0, 300, 0, 2000, 0, 8000, -2, 0, 150) });
add('stack', 'plugin', { ...fledge('stack', 'Chords/Future bass', { 1: 0.5, 2: 0.9 }), volume: V.stack, reverbSend: 0.2 }, { chorus: { on: true, rate: 0.9, depth: 0.9, mix: 0.8 }, ...eq(0, 350, -2, 2500, 0, 6000, -3, 0, 180) });
add('lead', 'plugin', { ...fledge('lead', 'Lead/Supersaw', { 1: 0.5, 2: 0.7, 3: 0.5 }), volume: V.lead, reverbSend: 0.3 }, { ...wide(0.7), ...eq(0, 500, -2, 3000, 0, 6000, -4, 0, 250) });
add('lead2', 'plugin', { ...fledge('lead2', 'Lead/Sine', { 2: 0.4 }), volume: V.lead2, reverbSend: 0.35 }, wide(0.4));
add('counter', 'plugin', { ...fledge('counter', 'Keys/Bright Pluck', { 1: 0.4, 2: 0.4 }), volume: V.counter, reverbSend: 0.3 }, eq(0, 400, 0, 2500, 0, 8000, 0, 0, 300));
add('chop', 'plugin', { ...fledge('chop', 'Lead/Chip Crunch'), volume: V.chop, reverbSend: 0.12 }, { ...wide(0.7), ...eq(0, 400, -5, 2500, 0, 5000, 3, 0, 300) });
add('bass', 'plugin', { ...fledge('bass', 'Bass/Driven Legato', { 1: 0.35, 2: 0.3, 3: 0.2 }, { 'Sub level': 0 }), volume: V.bass, reverbSend: 0 }, eq(-3, 170, 3, 600, -8, 1800, -6, 3000, 70));
// (the colour bass: every riff note held into the next when it follows within a 16th, so the legato bass glides)
if (P.cbass) P.cbass = P.cbass.map((n, k, all) => { const nx = all[k + 1]; if (!nx || nx.at - (n.at + n.steps) > 1 + 1e-9 || nx.at <= n.at) return n; return { ...n, steps: +(nx.at - n.at + 0.1).toFixed(4) }; });
add('cbass', 'plugin', { ...fledge('cbass', 'Bass/Driven Legato', {}, { 'Sub level': 0 }), volume: V.cbass, reverbSend: 0 }, eq(-4, 170, 7, 450, -9, 4000, 8, 9000, 70));
add('sub', 'plugin', { ...fledge('sub', 'Bass/Clean Sub'), volume: V.sub, reverbSend: 0 });
add('stabs', 'plugin', { ...fledge('stabs', 'Bass/Hard Clip Stab'), volume: V.stabs, reverbSend: 0.05 }, { chorus: { on: true, rate: 0.8, depth: 0.85, mix: 0.7 }, ...eq(0, 300, -5, 600, -6, 4000, 6, 10000) });
add('riser', 'plugin', { ...fledge('riser', 'FX/Riser'), volume: V.riser, reverbSend: 0.2 });
add('down', 'plugin', { ...fledge('down', 'FX/Downlifter'), volume: V.down, reverbSend: 0.3 });
add('swell', 'plugin', { ...fledge('swell', 'Pad/Wide Wash', { 1: 0.5, 2: 0.6 }), volume: V.swell, reverbSend: 0.6 }, wide(0.6));
add('drop', 'dropPad', { volume: 0 });

if (arg.dump) {
  const d = {}; for (const [k, v] of Object.entries(P)) d[k] = v.map((n) => [midiOf(n.note), n.at, n.steps, +n.velocity.toFixed(2)]);
  return { out: { notes: d, plan: PLAN, shift: SHIFT }, wavs: {} };
}

// ---------------------------------------------------------------------------------------------
// Into the store as a project (as opening a file does), then the app's own edits
// ---------------------------------------------------------------------------------------------
const tempoPoints = [{ id: 'tp-hold', bar: 69, bpm: 150, ramp: false }, { id: 'tp-up', bar: 73, bpm: 175, ramp: true }];
const tempo = { bpm: 150, points: tempoPoints };
const markers = SECTIONS.map(([b, name], k) => ({ id: 'm' + k, name, anchor: 'bar', bar: b + 1, seconds: barToSeconds(b + 1, tempo) }));
useTimelineStore.getState().loadProject({ name: arg.name ?? 'Off the Rails', bpm: 150, tempoPoints, swing: 0, loopRegion: { inBar: 13, outBar: 29, enabled: false }, tracks, clips, markers,
  masterFx: { reverbDecay: arg.reverbDecay ?? 2.6, delayTime: T.DEFAULT_MASTER_FX.delayTime, delayFeedback: T.DEFAULT_MASTER_FX.delayFeedback }, master: T.defaultMasterSettings() });
// The swells: each chord hit played backwards (the app's Reverse on its clip), so it rises into the next downbeat
await new Promise((r) => setTimeout(r, 1500));
const S = useTimelineStore.getState();
const swellClips = S.clips.filter((c) => c.trackId === 'swell');
// (each swell is its own clip: split the one per section into one per hit)
const hits = [];
for (const c of swellClips) { const byBar = new Map(); for (const n of c.notes) { const b = Math.floor(n.startOffset); byBar.set(b, [...(byBar.get(b) ?? []), { ...n, startOffset: n.startOffset - b }]); } for (const [b, notes] of byBar) hits.push({ ...c, id: `${c.id}-${b}`, startBar: c.startBar + b, lengthBars: 1, notes }); }
useTimelineStore.setState({ clips: [...S.clips.filter((c) => c.trackId !== 'swell'), ...hits] });
out.reverse = [];
for (const h of hits) out.reverse.push(await reverseBlock(h.startBar, h.startBar + 1, h.id));
// the reversed audio tracks: named, levelled
let rk = 0;
useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.filter((t) => t.id !== 'swell' || useTimelineStore.getState().clips.some((c) => c.trackId === 'swell')).map((t) => (t.instrumentKey === 'audio' ? { ...t, name: `Reverse swell ${++rk}`, volume: V.swellAudio ?? 0, color: COLORS.swell } : t)) });
// Duck to kick (Future bass); then the colour-bass drop's parts duck as the bass-music style does, and the sub
// makes a deeper, longer hole for the kick's tuned tail
const st0 = useTimelineStore.getState();
out.ducked = st0.duckToKick('future');
const gap = drumHitGapMs(st0.tracks, st0.clips, 150);
const PUMPS = {
  cbass: duckPump('bass', 'bass', 150, gap, true), stabs: duckPump('music', 'bass', 150, gap), chop: duckPump('music', 'bass', 150, gap),
  sub: { on: true, depth: depthOfDb(arg.subHole ?? -10), release: arg.subRelease ?? 170, trigger: arg.subTrigger ?? 'kick', shape: 'hole' },
  ...(arg.pumps ?? {}),
};
useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map((t) => (PUMPS[t.id] ? { ...t, fx: { ...t.fx, pump: { ...t.fx.pump, ...PUMPS[t.id] } } } : t)) });
useTimelineStore.getState().setMasterLoud({ on: true, target: arg.loud ?? 'loud', crunch: CRUNCH, subTilt: arg.subTilt ?? -2 });
const p = currentProject();
out.tracks = p.tracks.map((t) => `${t.id} ${t.name} vol ${t.volume} pump ${t.fx.pump?.on ? (+t.fx.pump.depth).toFixed(3) + ' ' + t.fx.pump.trigger + ' ' + t.fx.pump.release : 'off'}`);
out.clips = p.clips.length;
out.sounds = SOUNDS;

if (arg.levels) {
  // each track's own loudness over bars [from, to) (0-based), before the master, and its peak
  const [b0, b1] = arg.levels; const lv = {};
  for (const t of p.tracks) {
    const b = await ex.renderArrangement({ tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: 0, masterFx: p.masterFx, master: p.master, startBar: b0 + 1, endBar: b1 + 1, ending: 'exact', sampleRate: sr, bypassMaster: true, soundOnly: [t.id] });
    const L = b.getChannelData(0), R = b.getChannelData(1);
    const v = integratedLufs(L, R, sr); if (Number.isFinite(v) && v > -70) lv[t.id] = [+v.toFixed(1), health([L, R]).peakDb];
  }
  out.levels = lv;
  return { out, wavs };
}
const r = await exportSong(p);
await finish(p, r);
// Kick and snare times (s) for the hit check, through the tempo map
// (The MP3 decodes to the exact sample: no encoder delay to allow for)
const lat = 0;
const t0 = arg.range ? barToSeconds(arg.range[0] + 1, tempo) : 0;
const sec = (n) => barToSeconds(1 + n.at / 16, tempo) + lat - t0;
const hitsOf = (keys, row, v = 0) => keys.flatMap((k) => (P[k] ?? []).filter((n) => n.note === row && n.velocity > v).map(sec)).filter((x) => x >= 0).sort((a, b) => a - b);
out.onsets = { kicks: hitsOf(['drums', 'drums2', 'drums3'], 'C1'), snares: hitsOf(['drums', 'drums2', 'drums3'], 'D1', 0.9), impacts: hitsOf(['impact'], 'C1'), drumAll: ['drums', 'drums2', 'drums3', 'impact'].flatMap((k) => (P[k] ?? []).map(sec)).filter((x) => x >= 0).sort((a, b) => a - b), noteStarts: [...new Set(Object.entries(P).filter(([k]) => k !== 'drop').flatMap(([, v]) => v.map((n) => +sec(n).toFixed(3))))].filter((x) => x >= 0).sort((a, b) => a - b), sections: markers.map((mk) => [mk.name, +mk.seconds.toFixed(3)]) };
if (arg.stems) {
  const master = { ...p.master, loud: { ...p.master.loud, push: r.stats?.loud?.push ?? p.master.loud.push } };
  const b = await ex.renderArrangement({ ...r.opts, master, loudTargetLufs: undefined, keepRingOut: false, soundOnly: arg.stems });
  wavs[file + '-stem'] = await toUrl(new Blob([ex.encodeChannels([b.getChannelData(0), b.getChannelData(1)], b.sampleRate, 16)]));
}
if (arg.save) {
  // The project file as the studio's Save writes it: the arrangement and the sounds it plays (the reversed swells)
  const sounds = await embedSounds(referencedSoundIds(p));
  const json = JSON.stringify(serializeProject({ ...p, sounds }), null, 2);
  wavs[file + '-project'] = await toUrl(new Blob([json], { type: 'application/json' }));
  out.projectBytes = json.length;
}
return { out, wavs };
