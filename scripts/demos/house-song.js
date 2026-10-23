// "Night Rails": Off the Rails turned melodic modern house, after the owner's favourite house track (135 BPM, four on
// the floor, off-beat open hats, claps on 2 and 4, a sustained sub ducked by the kick with the bass leaning on the
// off-beats, D with phrygian colours: Bb, C and Eb around a major tonic, orchestral layers). 140 BPM, D major with
// phrygian borrowings (Bb, C, Eb), the last drop a whole step up in E. Off the Rails' 3+3+2 tune idea grown into a
// singable 8-bar hook; its kick and bass (Hard drop kick, Driven Legato over a Clean Sub) kept as the engine.
// Built through the app's store as a project (markers, one clip per section, filter automation, the Drop pad),
// exported as the Export dialog does and saved as a .fledgetone.json.
//
//   OUT=out APP_URL=http://localhost:5511/ node scripts/audio-check/run.cjs scripts/demos/house-song.js '{"file":"night-rails","save":true}'
//
// makes out/night-rails-mp3.wav (an MP3) and out/night-rails-project.wav (the .fledgetone.json; rename both). To check
// the saved file opens: copy it into the repo's songs/ folder (not committed; the dev server serves it) and run with
// '{"open":"/songs/night-rails.fledgetone.json"}': it is opened through the app's open path in a fresh browser and
// exported again (the MP3 comes out identical).
// arg.vol {track: dB}, arg.crunch, arg.lufs (the export's target), arg.loud (the Loud master's), arg.range [from, to]
// (0-based bars: export only those), arg.levels [from, to] (each track's own loudness there instead), arg.subHole /
// arg.subRelease, arg.duck (Duck to kick style), arg.dump (notes only), arg.name, arg.file
const ex = await import('/src/audio/exportWav.ts');
const T = await import('/src/store/timelineTypes.ts');
const K = await import('/src/store/partKind.ts');
const { useTimelineStore, currentProject } = await import('/src/store/timelineStore.ts');
const { FLEDGE_URL, FLEDGE_PRESETS } = await import('/src/audio/plugins/fledgeMacros.ts');
const { paramNamesOf } = await import('/src/audio/plugins/paramNames.ts');
const { presetSound } = await import('/src/store/drumDesign.ts');
const { integratedLufs } = await import('/src/audio/effects/loudMaster.ts');
const { midiOf, nameOf } = await import('/src/store/noteTools.ts');
const { encodeAudio } = await import('/src/audio/encoders.ts');
const { exportCeilingDbtp } = await import('/src/audio/effects/limiter.ts');
const { depthOfDb } = await import('/src/audio/effects/duckShape.ts');
const { barToSeconds } = await import('/src/audio/tempoMap.ts');
const { AUTOMATION } = await import('/src/audio/automation.ts');
const { parseProject, serializeProject } = await import('/src/store/project.ts');
const { referencedSoundIds } = await import('/src/store/audioClips.ts');
const { embedSounds, importEmbeddedSounds } = await import('/src/audio/soundLibrary.ts');
const sr = 44100;
const BPM = 140;
const CRUNCH = arg.crunch ?? 0.2;
const CEIL = exportCeilingDbtp('mp3', CRUNCH);
const LUFS = arg.lufs ?? -9;

if (!paramNamesOf(FLEDGE_URL)) {
  const warm = mkTrack('w', 'plugin', T.defaultTrackFx(), { plugin: { id: 'warm', url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program: 0 } } });
  await ex.renderArrangement({ tracks: [warm], clips: [mkClip('wc', 'w', 1, 1, [{ note: 'C2', startOffset: 0 }])], bpm: 140, swing: 0, masterFx: T.DEFAULT_MASTER_FX, startBar: 1, endBar: 2, ending: 'exact', sampleRate: sr, bypassMaster: true });
}
const toUrl = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
const health = (chans) => { let bad = 0, peak = 0; for (const c of chans) for (let i = 0; i < c.length; i++) { const v = c[i]; if (!Number.isFinite(v)) bad++; else if (Math.abs(v) > peak) peak = Math.abs(v); } return { nonFinite: bad, peakDb: +(20 * Math.log10(peak + 1e-12)).toFixed(2) }; };
const file = arg.file ?? 'night-rails';
const wavs = {};
const out = {};

// The export, as the Export dialog makes an MP3 of the whole song with the Loud master matching a target
async function exportSong(p) {
  let stats = null;
  const endBar = arg.range ? arg.range[1] + 1 : Math.max(...p.clips.map((c) => c.startBar + c.lengthBars));
  const opts = { tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: 0, masterFx: p.masterFx, master: p.master, startBar: arg.range ? arg.range[0] + 1 : 1, endBar, ending: 'ringOut', sampleRate: sr, markers: p.markers, intensity: { value: 1, curves: {} }, peakCeilingDbtp: CEIL, keepRingOut: true, loudTargetLufs: LUFS, onMasterStats: (x) => (stats = x), ...(arg.solo ? { soundOnly: arg.solo } : {}) };
  let buf = await ex.renderArrangement(opts);
  buf = ex.cutRingOut(buf, opts);
  return { buf, stats, opts };
}
async function finish({ buf, stats }, tag = '') {
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  wavs[file + tag + '-mp3'] = await toUrl(await encodeAudio(ch, buf.sampleRate, 'mp3', { bitDepth: 16 }));
  let h = 0; for (let i = 0; i < ch[0].length; i += 7) h = (h * 31 + Math.round((ch[0][i] + ch[1][i]) * 1e6)) | 0;
  Object.assign(out, { seconds: +(buf.length / buf.sampleRate).toFixed(2), frames: buf.length, hash: h, ...health(ch), lufs: +integratedLufs(ch[0], ch[1], buf.sampleRate).toFixed(2), loud: stats?.loud, limDb: stats?.limiterPeakDb, clip: stats?.clipper });
}

if (arg.open) {
  // ---- Open a saved project file through the app's own open path, then export it again
  const project = parseProject(JSON.parse(await (await fetch(arg.open)).text()));
  if (project.sounds?.length) await importEmbeddedSounds(project.sounds);
  useTimelineStore.getState().loadProject(project);
  await new Promise((r) => setTimeout(r, 500));
  const p = currentProject();
  out.opened = { name: p.name, tracks: p.tracks.length, clips: p.clips.length, markers: p.markers.length, automation: p.tracks.filter((t) => t.automation?.length).length };
  await finish(await exportSong(p), '-reopened');
  return { out, wavs };
}

const names = paramNamesOf(FLEDGE_URL);
// A Fledge track: its own plugin id; macros {n: 0..1}; over {param name: normalised 0..1}
const SOUNDS = {};
const fledge = (id, preset, macros = {}, over = {}, label) => {
  const program = FLEDGE_PRESETS.indexOf(preset);
  if (program < 0) throw new Error('no preset ' + preset);
  for (const n of Object.keys(over)) if (!names.includes(n)) throw new Error('no parameter ' + n);
  const set = [...Object.entries(macros), ...Object.entries(over)];
  const values = set.length ? names.map((n) => { if (over[n] !== undefined) return over[n]; const m = n.match(/^Macro (\d)$/); return m && macros[m[1]] !== undefined ? macros[m[1]] : null; }) : undefined;
  SOUNDS[id] = { preset, ...(label ? { as: label } : {}), macros, values: Object.fromEntries(Object.entries(over).map(([k, v]) => [k, +v.toFixed(4)])) };
  return { plugin: { id: `songc-${id}`, url: FLEDGE_URL, name: 'Fledge Synth', state: { builtin: 1, program, ...(values ? { values } : {}) } } };
};
// Fledge's knobs, normalised: log ranges (seconds 0.005-10 s, cutoff 20 Hz-20 kHz), percents 0-1
const logn = (v, a, b) => Math.log(v / a) / Math.log(b / a);
const sec = (s) => logn(s, 0.005, 10);
const hz = (f) => logn(f, 20, 20000);
const bip = (v) => (v + 1) / 2; // a -1..1 knob (Filter envelope)
let uidN = 0;
const m = (n) => (typeof n === 'number' ? n : midiOf(n));
const range = (n) => Array.from({ length: n }, (_, i) => i);
const bars = (a, b) => range(b - a).map((i) => a + i);
const N = (note, at, steps, velocity = 0.8) => ({ id: 'x' + uidN++, note: nameOf(m(note)), at, steps: +Math.max(0.25, steps).toFixed(4), velocity: Math.max(0.05, Math.min(1, velocity)) });

// ---------------------------------------------------------------------------------------------
// Harmony, the hook, the form
// ---------------------------------------------------------------------------------------------
const CH = {
  D: { name: 'Dadd9', bass: 38, voicing: [62, 64, 66, 69] },
  Bb: { name: 'Bbmaj7', bass: 34, voicing: [62, 65, 69, 70] },
  C: { name: 'Cadd9', bass: 36, voicing: [60, 62, 64, 67] },
  Asus: { name: 'Asus4', bass: 33, voicing: [62, 64, 69] },
  Eb: { name: 'Ebmaj7', bass: 39, voicing: [62, 63, 67, 70] },
  Gm: { name: 'Gm9', bass: 31, voicing: [58, 62, 65, 69] },
  A7: { name: 'A7', bass: 33, voicing: [61, 64, 67, 69] },
  Ebx: { name: 'Ebmaj9', bass: 39, voicing: [58, 62, 63, 65] },
  Bm: { name: 'Bm7', bass: 35, voicing: [57, 62, 66, 69] },
};
// The hook's two halves (A over D Bb C Asus4, B over D Eb Gm A7), the breakdown's reharmonised A (D Ebmaj9 C Asus4)
const PH = { A: ['D', 'Bb', 'C', 'Asus'], B: ['D', 'Eb', 'Gm', 'A7'], rA: ['D', 'Ebx', 'C', 'Asus'], rB: ['Bm', 'Eb', 'Gm', 'A7'] };
// The hook: Off the Rails' 3+3+2 tune idea (a rising arpeggio, then answers falling), [16th in the phrase, MIDI, 16ths]
const HOOK = {
  A: [[0, 66, 6], [6, 69, 6], [12, 74, 4], [16, 74, 6], [22, 70, 6], [28, 65, 4], [32, 64, 6], [38, 67, 6], [44, 69, 4], [48, 64, 12], [60, 57, 4]],
  B: [[0, 66, 6], [6, 69, 6], [12, 74, 4], [16, 75, 6], [22, 74, 6], [28, 70, 4], [32, 70, 6], [38, 69, 6], [44, 67, 4], [48, 69, 6], [54, 67, 6], [60, 64, 4]],
};
const hookOf = (k) => (k === 'B' || k === 'rB' ? HOOK.B : HOOK.A);
// The song (0-based bars): [first bar, phrase, key shift]
const FORM = [];
const at = (b0, kinds, sh = 0) => kinds.forEach((k, i) => FORM.push([b0 + 4 * i, k, sh]));
at(0, ['A', 'B', 'A', 'B', 'A', 'B', 'A']); // intro, verse, groove, build (bars 0-27)
at(28, ['A', 'B', 'A', 'B']); // drop 1
at(44, ['A', 'B']); // the chop break
at(52, ['rA', 'rB', 'rA']); // breakdown
at(64, ['A', 'B']); // build 2 and the fake-out
at(72, ['A', 'B', 'A', 'B', 'A', 'B'], 2); // final drop in E (72-95)
at(96, ['A', 'A'], 2); // outro
const LEN = 104;
const PLAN = [], SHIFT = [];
for (const [b0, kind, sh] of FORM) PH[kind].forEach((c, i) => { PLAN[b0 + i] = c; SHIFT[b0 + i] = sh; });
PLAN[100] = PLAN[101] = PLAN[102] = PLAN[103] = 'D';
const SECTIONS = [[0, 'Intro'], [8, 'Verse'], [16, 'Groove'], [24, 'Build'], [28, 'Drop'], [44, 'Chop break'], [52, 'Breakdown'], [64, 'Build 2'], [72, 'Final drop'], [96, 'Outro']];
const chordAt = (t) => { const b = Math.max(0, Math.min(LEN - 1, Math.floor(t / 16))); const c = CH[PLAN[b]]; const s = SHIFT[b]; return s ? { ...c, bass: c.bass + s, voicing: c.voicing.map((p) => p + s) } : c; };
const P = {};
const part = (k) => (P[k] ??= []);
const voiced = (c, cap) => c.voicing.map((p) => { let q = p; while (q > cap) q -= 12; return q; });
// Chords struck on a rhythm [[16th, length]...] per bar
const stab = (k, b0, b1, rh, vel, cap = 99, oct = 0) => bars(b0, b1).forEach((b) => { const c = chordAt(b * 16); rh.forEach(([st, l], i) => voiced(c, cap).forEach((p) => part(k).push(N(p + oct, b * 16 + st, l, i ? vel - 0.06 : vel)))); });
const held = (k, b0, b1, vel, cap = 99, oct = 0) => stab(k, b0, b1, [[0, 16.1]], vel, cap, oct);
const hook = (b0, kind, vel, k = 'lead', oct = 0) => { const sh = SHIFT[b0] ?? 0; hookOf(kind).forEach(([st, p, l]) => part(k).push(N(p + sh + oct, b0 * 16 + st, l + 0.1, st % 8 === 0 ? vel : vel - 0.06))); };
const hooks = (b0, b1, vel, k = 'lead', oct = 0) => { for (let b = b0; b < b1; b += 4) { const f = FORM.find(([x]) => x === b); hook(b, f ? f[1] : 'A', vel, k, oct); } };
// House stab rhythms: off-beat 8ths, and a syncopated one (the "and" of 1, 2-and, 3, 4-and)
const OFF = [[2, 1.5], [6, 1.5], [10, 1.5], [14, 1.5]];
const SYNC = [[2, 1.5], [6, 1], [7, 1.5], [10, 1.5], [14, 1]];
// The bass: the sub holds the root (ducked by the kick); the Driven Legato bass leans on the off-beats, rolling
const ROLL = [[2, 0, 2], [6, 0, 1.5], [7, 12, 1], [10, 0, 2], [13, 12, 1], [14, 0, 2]];
const ROLL2 = [[2, 0, 2], [5, 12, 1], [6, 0, 2], [10, 0, 1.5], [11, 12, 1], [14, 7, 1], [15, 12, 1]];
const bassBars = (b0, b1, vel = 0.85, pat = null) => bars(b0, b1).forEach((b) => { const c = chordAt(b * 16); (pat ?? (b % 2 ? ROLL2 : ROLL)).forEach(([st, off, l]) => part('bass').push(N(c.bass + off, b * 16 + st, l, st % 4 === 2 ? vel : vel - 0.08))); });
const subBars = (b0, b1, vel = 0.85) => bars(b0, b1).forEach((b) => part('sub').push(N(chordAt(b * 16).bass - 12, b * 16, 16.1, vel)));
// Drum rows: kick C1, snare D1, clap D#1, closed hat F#1, open hat A#1, toms F1 B1, rim D2 (tom high row), shaker G#2 (perc row), crash C#2, ride D#2
const D = (row, t, l = 1, v = 0.8, k = 'drums') => part(k).push(N(row, t, l, v));
const groove = (b0, b1, { kick = true, clap = true, hats = true, tops = true, perc = true, k = 'drums', kv = 1 } = {}) => bars(b0, b1).forEach((b) => {
  const t = b * 16;
  if (kick) [0, 4, 8, 12].forEach((st) => D('C1', t + st, 2, kv, k));
  if (clap) [4, 12].forEach((st) => D('D#1', t + st, 2, 0.95, k));
  if (hats) [2, 6, 10, 14].forEach((st) => D('A#1', t + st, 1, 0.8, k));
  if (tops) range(16).forEach((st) => st % 4 !== 2 && D('F#1', t + st, 1, st % 4 === 0 ? 0.28 : st % 2 ? 0.3 : 0.36, k));
  if (perc) { range(16).forEach((st) => D('G#2', t + st, 1, st % 2 ? 0.55 : 0.35, k)); [3, 10, b % 2 ? 15 : 13].forEach((st) => D('D2', t + st, 1, 0.5, k)); }
});
const clapRoll = (b, from, vel0 = 0.4, k = 'drums') => range(16 - from).forEach((i) => D('D#1', b * 16 + from + i, 1, vel0 + (0.5 * i) / (16 - from), k));

// ---------------------------------------------------------------------------------------------
// The music
// ---------------------------------------------------------------------------------------------
// --- Intro (0-7): the groove from the first bar (kick, off-beat hats, shaker), the sub and the rolling bass under a
//     closed filter that opens, the chord stabs filtered; the hook's first figure teased on the pluck in bars 4-7
groove(0, 8, { clap: false, tops: false });
range(4).forEach((b) => D('D#1', (4 + b) * 16 + 12, 2, 0.8));
subBars(0, 8, 0.8); bassBars(0, 8, 0.8);
stab('stabs', 0, 8, OFF, 0.7, 69);
[4, 6].forEach((b) => [[0, 66, 3], [3, 69, 3], [6, 74, 2]].forEach(([st, p, l]) => part('pluck').push(N(p, b * 16 + st * 2, l * 2, 0.62))));
D('C#2', 0, 16, 0.5);
// --- Verse (8-15): the hook on the plucky lead, the stabs open, the full groove
groove(8, 16, { perc: false });
subBars(8, 16); bassBars(8, 16);
stab('stabs', 8, 16, SYNC, 0.78, 69);
hooks(8, 16, 0.8, 'pluck');
held('pad', 8, 16, 0.45, 69);
D('C#2', 8 * 16, 16, 0.6);
// --- Groove (16-23): stripped to drums, bass and short violins bouncing on the chords (the reference's B section);
//     the vowel chop answers the hook's first figure
groove(16, 24);
subBars(16, 24); bassBars(16, 24, 0.9);
bars(16, 24).forEach((b) => { const c = chordAt(b * 16); range(8).forEach((i) => part('vln').push(N(voiced(c, 76)[[0, 2, 1, 3, 2, 1, 3, 2][i] % c.voicing.length] + 12, b * 16 + 2 * i, 1.6, i % 2 ? 0.55 : 0.7))); });
[17, 19, 21, 23].forEach((b) => [[8, 78, 2], [10, 81, 2], [12, 86, 4]].forEach(([st, p, l]) => part('chop').push(N(p, b * 16 + st, l, 0.7))));
D('C#2', 16 * 16, 16, 0.5);
// --- Build (24-27): the hook on the pluck again, claps rolling, the stabs in 8ths, the riser; the last beat is a gap
//     with a reverse swell rising into the drop
groove(24, 28, { perc: false });
subBars(24, 28); bassBars(24, 28, 0.8);
stab('stabs', 24, 28, range(8).map((i) => [2 * i, 1.5]), 0.7, 69);
hooks(24, 28, 0.78, 'pluck');
clapRoll(26, 8, 0.25); clapRoll(27, 0, 0.35);
part('drop').push(N('C#4', 26 * 16, 28, 0.9));
part('riser').push(N('D4', 24 * 16, 60, 0.5));
part('swell').push(N('A4', 27 * 16, 16, 0.8), N('D5', 27 * 16, 16, 0.8));

// --- Drop 1 (28-43): the hook on the soaring lead (A B A B), the stabs, strings holding the chords, the rolling bass,
//     the impact; the second half the short violins bounce under it
groove(28, 44);
subBars(28, 44); bassBars(28, 44);
stab('stabs', 28, 44, SYNC, 0.8, 69);
hooks(28, 44, 0.9, 'lead');
hooks(36, 44, 0.55, 'lead2', 12);
held('strings', 28, 44, 0.55, 74);
held('pad', 28, 44, 0.45, 69);
bars(36, 44).forEach((b) => { const c = chordAt(b * 16); range(8).forEach((i) => part('vln').push(N(voiced(c, 76)[[0, 2, 1, 3, 2, 1, 3, 2][i] % c.voicing.length] + 12, b * 16 + 2 * i, 1.6, i % 2 ? 0.5 : 0.62))); });
D('C1', 28 * 16, 16, 0.95, 'impact'); [28, 36].forEach((b) => D('C#2', b * 16, 16, 0.75));
part('drop').push(N('C4', 35 * 16 + 14, 2, 0.9));
// --- The chop break (44-51): off the rails for a moment: the groove keeps going but the music is cut up: the vowel
//     chop sings the hook's figure in stutters, the bass turns into Off the Rails' octave-leaping riff, the Drop pad
//     gates and stutters it; then back
groove(44, 52, { tops: true, perc: true });
subBars(44, 52);
const RIFF = [[0, 0, 2], [2, 12, 1], [3, 0, 1], [4, 0, 1], [5, 12, 1], [6, 24, 1], [7, 0, 1], [8, 0, 1], [9, 12, 1], [10, 0, 2], [12, 12, 1], [13, 0, 1], [14, 0, 1], [15, 24, 1]];
bars(44, 52).forEach((b) => { const c = chordAt(b * 16); RIFF.forEach(([st, off, l]) => part('bass').push(N(c.bass - 12 + off, b * 16 + st, l, st % 4 === 0 ? 0.9 : 0.8))); });
bars(44, 52).forEach((b) => { const sh = 0; [[0, 66], [3, 69], [6, 74], [8, 74], [9, 74], [10, 78], [12, 81], [14, 74]].forEach(([st, p], i) => part('chop').push(N(p + sh + (b % 4 === 3 && i > 4 ? 12 : 0), b * 16 + st, st < 8 ? 2.5 : 1, 0.75))); });
stab('stabs', 44, 52, [[0, 1], [3, 1], [6, 1], [10, 2]], 0.75, 69);
part('drop').push(N('E4', 47 * 16 + 8, 8, 0.9), N('C4', 49 * 16 + 12, 4, 0.9), N('D#4', 50 * 16, 16, 0.9), N('C4', 51 * 16 + 8, 4, 0.9), N('C4', 51 * 16 + 14, 2, 0.9));
D('C1', 44 * 16, 16, 0.8, 'impact');

// --- Breakdown (52-63): the drums out; the orchestra: strings and choir on the phrygian chords (D Ebmaj9 C Asus4 |
//     Bm7 Eb Gm9 A7), the hook sung by solo strings (violins) slowly, a timpani roll into the build
held('strings', 52, 64, 0.6, 74);
held('choir', 56, 64, 0.5, 72);
hooks(52, 64, 0.72, 'vlnLead');
bars(52, 64).forEach((b) => part('sub').push(N(chordAt(b * 16).bass - 12, b * 16, 16.1, 0.55)));
held('pad', 52, 64, 0.4, 69);
part('down').push(N('C5', 52 * 16, 32, 0.6));
range(32).forEach((i) => D('A2', 62 * 16 + i, 1, 0.3 + 0.02 * i, 'timp'));
part('timp').push(N('D2', 64 * 16, 8, 0.95));

// --- Build 2 (64-71): the beat back in, the hook on the pluck an octave up, a long clap roll, the riser; bar 70 hits
//     like the drop, then the Drop pad's Tape stop pulls everything to a halt and bar 71 is the hook's figure alone,
//     stuttering up into the key change (the final drop is a whole step up, in E)
groove(64, 70, { perc: false });
subBars(64, 70); bassBars(64, 70, 0.8);
stab('stabs', 64, 70, range(8).map((i) => [2 * i, 1.5]), 0.66, 69);
hooks(64, 70, 0.75, 'pluck', 12);
clapRoll(68, 0, 0.22); clapRoll(69, 0, 0.32);
part('drop').push(N('C#4', 68 * 16, 28, 0.9));
part('riser').push(N('D4', 66 * 16, 60, 0.5));
// the fake drop
groove(70, 71); D('C1', 70 * 16, 16, 0.85, 'impact');
stab('stabs', 70, 71, SYNC, 0.8, 69); held('strings', 70, 71, 0.6, 74); bassBars(70, 71); subBars(70, 71);
[[0, 66, 6], [6, 69, 6]].forEach(([st, p, l]) => part('lead').push(N(p, 70 * 16 + st, l, 0.9)));
part('drop').push(N('D4', 70 * 16 + 8, 8, 0.9));
// bar 71: F#5 A5 D6 (the hook's opening) stuttered in 32nds, stepping up to the new key's G#5 B5 E6
[[0, 66], [2, 69], [4, 74], [8, 68], [10, 71], [12, 76]].forEach(([st, p]) => range(st < 8 ? 4 : 4).forEach((i) => part('chop').push(N(p, 71 * 16 + st + i / 2, 0.45, 0.8))));
part('swell').push(N('B4', 71 * 16, 16, 0.8), N('E5', 71 * 16, 16, 0.8));
range(8).forEach((i) => D('D#1', 71 * 16 + 8 + i, 1, 0.4 + 0.07 * i));

// --- Final drop (72-95), E major: everything; brass on the downbeats, the choir, the hook an octave up from bar 80
//     with the lower octave under it, the strings bouncing, then home
groove(72, 96);
subBars(72, 96); bassBars(72, 96);
stab('stabs', 72, 96, SYNC, 0.8, 71);
hooks(72, 80, 0.9, 'lead'); hooks(80, 96, 0.88, 'lead', 12); hooks(80, 96, 0.62, 'lead2');
held('strings', 72, 96, 0.6, 76);
held('pad', 72, 96, 0.45, 71);
held('choir', 80, 96, 0.5, 74);
bars(72, 96).forEach((b) => { const c = chordAt(b * 16); [[0, 3], [10, 2]].forEach(([st, l]) => voiced(c, 72).forEach((p) => part('brass').push(N(p, b * 16 + st, l, st ? 0.62 : 0.75)))); });
bars(88, 96).forEach((b) => { const c = chordAt(b * 16); range(8).forEach((i) => part('vln').push(N(voiced(c, 78)[[0, 2, 1, 3, 2, 1, 3, 2][i] % c.voicing.length] + 12, b * 16 + 2 * i, 1.6, i % 2 ? 0.5 : 0.62))); });
D('C1', 72 * 16, 16, 1, 'impact'); [72, 80, 88].forEach((b) => D('C#2', b * 16, 16, 0.8));
clapRoll(87, 8, 0.4);
part('drop').push(N('C4', 79 * 16 + 14, 2, 0.9), N('E4', 87 * 16 + 12, 4, 0.9), N('C4', 95 * 16 + 14, 2, 0.9));
// --- Outro (96-103): the groove and the bass, the stabs closing their filter, the hook's last time on the pluck; a
//     final E chord
groove(96, 102, { clap: true });
subBars(96, 102, 0.8); bassBars(96, 102, 0.8);
stab('stabs', 96, 102, OFF, 0.72, 71);
hooks(96, 100, 0.7, 'pluck');
const E_ = { ...CH.D, bass: CH.D.bass + 2, voicing: CH.D.voicing.map((p) => p + 2) };
E_.voicing.forEach((p) => { part('strings').push(N(p, 102 * 16, 24, 0.55)); part('pad').push(N(p, 100 * 16, 40, 0.42)); });
part('pluck').push(N(76, 100 * 16, 8, 0.7), N(80, 100 * 16 + 6, 8, 0.6), N(83, 100 * 16 + 12, 12, 0.6));
part('sub').push(N(E_.bass - 12, 102 * 16, 20, 0.75)); D('C1', 102 * 16, 2, 0.95); D('C#2', 102 * 16, 16, 0.55);

// ---------------------------------------------------------------------------------------------
// Tracks: one clip per section where a part plays; levels; effects; filter automation
// ---------------------------------------------------------------------------------------------
const tracks = [], clips = [];
const NAMES = { drums: 'Drums', impact: 'Impact', timp: 'Timpani', bass: 'Bass', sub: 'Sub', stabs: 'Chord stabs', pluck: 'Pluck lead', lead: 'Lead', lead2: 'Lead double', chop: 'Vowel chop', pad: 'Pad', strings: 'Strings', vln: 'Short violins', vlnLead: 'Violins (hook)', choir: 'Choir', brass: 'Brass', riser: 'Riser', down: 'Downlifter', swell: 'Reverse swell', drop: 'Drop pad' };
const COLORS = { drums: '#f97316', impact: '#dc2626', timp: '#b45309', bass: '#22c55e', sub: '#15803d', stabs: '#818cf8', pluck: '#e879f9', lead: '#f472b6', lead2: '#fb7185', chop: '#c084fc', pad: '#38bdf8', strings: '#fbbf24', vln: '#f59e0b', vlnLead: '#eab308', choir: '#a3e635', brass: '#facc15', riser: '#94a3b8', down: '#64748b', swell: '#67e8f9', drop: '#f43f5e' };
const add = (id, key, extra = {}, fxPatch = {}, automation) => {
  const notes = P[id] ?? [];
  if (!notes.length) return;
  const st = K.startSends(key, T.defaultTrackFx());
  const fx = { ...st.fx };
  for (const [k, v] of Object.entries(fxPatch)) fx[k] = { ...fx[k], ...v };
  tracks.push(mkTrack(id, key, fx, { reverbSend: st.reverbSend, name: NAMES[id] ?? id, color: COLORS[id] ?? '#888', ...extra, ...(automation ? { automation } : {}) }));
  const ends = [...SECTIONS.map(([b]) => b), LEN];
  SECTIONS.forEach(([b0, name], k) => {
    const b1 = ends[k + 1];
    const mine = notes.filter((n) => n.at >= b0 * 16 && n.at < b1 * 16);
    if (!mine.length) return;
    const lengthBars = b1 - b0;
    clips.push({ id: `c-${id}-${b0}`, trackId: id, name, startBar: b0 + 1, lengthBars, isSelected: false,
      notes: mine.map((n) => { const s0 = n.at - b0 * 16; const l = Math.min(n.steps, lengthBars * 16 - s0); return { id: n.id, note: n.note, startOffset: s0 / 16, duration: `0:0:${+l.toFixed(4)}`, velocity: n.velocity }; }) });
  });
};
const eq = (lo, m1f, m1, m2f, m2, hif, hi, cut = 0, low = 0) => ({ peq: { on: true, bands: [
  { on: low > 0, type: 'lowcut', freq: low || 40, gain: 0, q: Math.SQRT1_2 }, { on: true, type: 'lowshelf', freq: 120, gain: lo, q: 0.7 },
  { on: true, type: 'bell', freq: m1f, gain: m1, q: 1 }, { on: true, type: 'bell', freq: m2f, gain: m2, q: 1 },
  { on: true, type: 'highshelf', freq: hif, gain: hi, q: 0.7 }, { on: cut > 0, type: 'highcut', freq: cut || 18000, gain: 0, q: Math.SQRT1_2 }] } });
const wide = (mix = 0.5) => ({ chorus: { on: true, rate: 0.6, depth: 0.7, mix } });
// A filter lane: [bar (0-based), Hz, curve?]...; the track's Filter insert on, low-pass
const lpf = { filter: { on: true, type: 'lowpass', cutoff: 20000, resonance: 1.2, slope: 24 } };
const sweep = (pts) => [{ param: 'filterCutoff', points: pts.map(([b, f, c]) => ({ bar: b + 1, value: +AUTOMATION.filterCutoff.toNorm(f).toFixed(4), ...(c ? { curve: c } : {}) })) }];
const V = { drums: -8, impact: -7, timp: -12, bass: 1, sub: -1.5, stabs: -5, pluck: 1, lead: -2, lead2: -13, chop: -9, pad: -13, strings: -20, vln: -14, vlnLead: -8, choir: -12, brass: -11, riser: -15, down: -13, swell: -10, ...(arg.vol ?? {}) };
const kitOf = (ids, levels = {}) => { const k = Object.fromEntries(Object.entries(ids).filter(([, v]) => v && presetSound(v)).map(([r, v]) => [r, presetSound(v)])); for (const [r, dl] of Object.entries(levels)) if (k[r]) k[r].level = dl; return k; };
// (the kick's tail tuned by hand: A1, the fifth of D; the final drop's is moved with the key in the kit below)
const tuneKick = (kit, hzv, tail) => { if (kit.kick) { kit.kick.layers = kit.kick.layers.map((l) => (l.voice === 'layerKick' ? { ...l, keyTrack: 0, pitch: hzv, ...(tail ? { tail } : {}) } : l)); delete kit.kick.preset; } return kit; };
const kitHouse = { kick: arg.kick ?? 'dropKick', snare: 'tightLayerSnare', clap: 'crispClap', closedHat: 'tightHat', openHat: 'offbeatHat', tomLow: 'lowTom', tomMid: 'midTom', tomHigh: 'woodRim', cowbell: 'shaker', crash: 'crash', ride: 'ride' };
const drumKit = tuneKick(kitOf(kitHouse, { kick: -2, closedHat: -2, openHat: 1, cowbell: -5, tomHigh: -7, clap: 0, ...(arg.rowLevel ?? {}) }), 55, arg.kickTail ?? 0.22);
// (one drum track through the key change: its kick stays on A1, the fifth of D and the fourth of E)
add('drums', 'designedKit', { drumDesign: drumKit, volume: V.drums }, eq(0, 400, 0, 5500, 3, 9000, 4));
add('impact', 'designedKit', { drumDesign: kitOf({ kick: 'dropImpact' }), volume: V.impact, reverbSend: 0.25 });
add('timp', 'realTimpani', { volume: V.timp, reverbSend: 0.3 });
add('bass', 'plugin', { ...fledge('bass', 'Bass/Driven Legato', { 1: 0.3, 2: 0.25, 3: 0.25 }, { 'Sub level': 0, Glide: logn(0.03, 0.001, 2) }, 'Driven Legato, shorter glide'), volume: V.bass, reverbSend: 0 },
  { ...eq(0, 170, 2, 600, -6, 2000, -3, 5000, 45), ...lpf }, sweep([[0, 350], [7, 5000, 0.4], [8, 20000]]));
add('sub', 'plugin', { ...fledge('sub', 'Bass/Clean Sub'), volume: V.sub, reverbSend: 0 });
// House chord stab: Silk Stack made short (a pluck that decays in ~0.2 s with no sustain), its filter snapping shut
add('stabs', 'plugin', { ...fledge('stabs', 'Chords/Silk Stack', { 1: 0.55, 2: 0.3, 3: 0.3 }, { 'Amp decay': sec(0.22), 'Amp sustain': 0, 'Amp release': sec(0.12), 'Filter envelope': bip(0.45), 'Filter decay': sec(0.16), 'Filter sustain': 0.1 }, 'House chord stab'), volume: V.stabs, reverbSend: 0.18 },
  { ...wide(0.65), ...eq(-2, 350, -2, 2500, 1, 7000, 3, 0, 200), ...lpf },
  sweep([[0, 300], [7, 6000, 0.5], [8, 20000], [96, 20000], [102, 500, -0.3]]));
// Plucky lead: Soaring Saw with the sustain taken away (a plucked supersaw for the verse hook)
add('pluck', 'plugin', { ...fledge('pluck', 'Lead/Soaring Saw', { 1: 0.3, 2: 0.4, 3: 0.4 }, { 'Amp decay': sec(0.28), 'Amp sustain': 0.15, 'Amp release': sec(0.18) }, 'Plucky saw lead'), volume: V.pluck, reverbSend: 0.22 }, { ...wide(0.5), ...eq(0, 500, -2, 3000, 1, 7000, 1, 0, 250) });
add('lead', 'plugin', { ...fledge('lead', 'Lead/Soaring Saw', { 1: 0.4, 2: 0.6, 3: 0.4 }), volume: V.lead, reverbSend: 0.25 }, { ...wide(0.6), ...eq(0, 500, -2, 3000, 1, 7000, 0, 0, 250) });
add('lead2', 'plugin', { ...fledge('lead2', 'Keys/Glass Pluck', { 1: 0.4, 2: 0.4 }), volume: V.lead2, reverbSend: 0.3 });
add('chop', 'plugin', { ...fledge('chop', 'Keys/Vowel Chop', { 1: 0.5, 2: 0.3 }), volume: V.chop, reverbSend: 0.15 }, eq(0, 400, -2, 2500, 1, 8000, 0, 0, 300));
add('pad', 'plugin', { ...fledge('pad', 'Pad/Silk Wash', { 1: 0.4, 2: 0.5 }), volume: V.pad, reverbSend: 0.3 }, { ...wide(0.6), ...eq(0, 300, 0, 2000, 0, 8000, -2, 0, 180) });
add('strings', 'realStrings', { volume: V.strings, reverbSend: 0.35 }, { ...wide(0.5), ...eq(-2, 300, -1, 3000, 1, 8000, 2, 0, 120) });
add('vln', 'realViolinsShort', { volume: V.vln, reverbSend: 0.3 }, { ...wide(0.5), ...eq(0, 300, -2, 3000, 1, 8000, 2, 0, 200) });
add('vlnLead', 'realViolins', { volume: V.vlnLead, reverbSend: 0.4 });
add('choir', 'realChoirOoh', { volume: V.choir, reverbSend: 0.45 }, eq(0, 300, -1, 3000, 0, 8000, 0, 0, 150));
add('brass', 'realBrass', { volume: V.brass, reverbSend: 0.3 }, eq(-2, 300, -1, 2000, 1, 8000, 0, 0, 120));
add('riser', 'plugin', { ...fledge('riser', 'FX/Riser'), volume: V.riser, reverbSend: 0.2 });
add('down', 'plugin', { ...fledge('down', 'FX/Downlifter'), volume: V.down, reverbSend: 0.3 });
add('swell', 'plugin', { ...fledge('swell', 'FX/Reverse Swell', { 1: 0.5, 2: 0.4 }), volume: V.swell, reverbSend: 0.2 });
add('drop', 'dropPad', { volume: 0 });

if (arg.dump) {
  const d = {}; for (const [k, v] of Object.entries(P)) d[k] = v.map((n) => [midiOf(n.note), n.at, n.steps, +n.velocity.toFixed(2)]);
  return { out: { notes: d, plan: PLAN, shift: SHIFT }, wavs: {} };
}

// ---------------------------------------------------------------------------------------------
// Into the store as a project (as opening a file does), then the app's own edits
// ---------------------------------------------------------------------------------------------
const tempo = { bpm: BPM, points: [] };
const markers = SECTIONS.map(([b, name], k) => ({ id: 'm' + k, name, anchor: 'bar', bar: b + 1, seconds: barToSeconds(b + 1, tempo) }));
useTimelineStore.getState().loadProject({ name: arg.name ?? 'Night Rails', bpm: BPM, tempoPoints: [], swing: 0, loopRegion: { inBar: 29, outBar: 45, enabled: false }, tracks, clips, markers,
  masterFx: { reverbDecay: arg.reverbDecay ?? 2.4, delayTime: T.DEFAULT_MASTER_FX.delayTime, delayFeedback: T.DEFAULT_MASTER_FX.delayFeedback }, master: T.defaultMasterSettings() });
await new Promise((r) => setTimeout(r, 1000));
// Duck to kick (the reference's music barely dips: Future bass's -2 dB); the sub makes way for the kick's tuned tail
out.ducked = useTimelineStore.getState().duckToKick(arg.duck ?? 'future');
// (the music parts dip about 1 dB with the kick, as the reference's chords and strings barely do)
const musicDb = arg.musicPump ?? -1;
useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map((t) => (t.fx.pump?.on && t.fx.pump.trigger === 'kick' ? { ...t, fx: { ...t.fx, pump: { ...t.fx.pump, depth: depthOfDb(musicDb) } } } : t)) });
const PUMPS = { sub: { on: true, depth: depthOfDb(arg.subHole ?? -10), release: arg.subRelease ?? 170, trigger: 'kick', shape: 'hole' }, ...(arg.pumps ?? {}) };
useTimelineStore.setState({ tracks: useTimelineStore.getState().tracks.map((t) => (PUMPS[t.id] ? { ...t, fx: { ...t.fx, pump: { ...t.fx.pump, ...PUMPS[t.id] } } } : t)) });
useTimelineStore.getState().setMasterLoud({ on: true, target: arg.loud ?? 'loud', crunch: CRUNCH, subTilt: arg.subTilt ?? -2 });
const p = currentProject();
out.tracks = p.tracks.map((t) => `${t.id} vol ${t.volume} pump ${t.fx.pump?.on ? (+t.fx.pump.depth).toFixed(3) + ' ' + t.fx.pump.trigger : 'off'}`);
out.clips = p.clips.length;
out.sounds = SOUNDS;
if (arg.levels) {
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
await finish(r);
const lat = 1105 / sr;
const t0 = arg.range ? barToSeconds(arg.range[0] + 1, tempo) : 0;
const secOf = (n) => barToSeconds(1 + n.at / 16, tempo) + lat - t0;
const hitsOf = (keys, row, v = 0) => keys.flatMap((k) => (P[k] ?? []).filter((n) => n.note === row && n.velocity > v).map(secOf)).filter((x) => x >= 0).sort((a, b) => a - b);
out.onsets = { kicks: hitsOf(['drums'], 'C1'), snares: hitsOf(['drums'], 'D#1', 0.9), impacts: hitsOf(['impact'], 'C1'),
  drumAll: ['drums', 'impact', 'timp'].flatMap((k) => (P[k] ?? []).map(secOf)).filter((x) => x >= 0).sort((a, b) => a - b),
  noteStarts: [...new Set(Object.entries(P).filter(([k]) => k !== 'drop').flatMap(([, v]) => v.map((n) => +secOf(n).toFixed(3))))].filter((x) => x >= 0).sort((a, b) => a - b),
  sections: markers.map((mk) => [mk.name, +mk.seconds.toFixed(3)]) };
if (arg.save) {
  const sounds = await embedSounds(referencedSoundIds(p));
  const json = JSON.stringify(serializeProject({ ...p, sounds }), null, 2);
  wavs[file + '-project'] = await toUrl(new Blob([json], { type: 'application/json' }));
  out.projectBytes = json.length;
}
return { out, wavs };
