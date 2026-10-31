// Check pitch bends in renders and live playback, case by case (each one a bug found before):
//
// - Two bent notes overlapping on an instrument that bends as a whole: when the first ends, the
//   one still sounding keeps its own bend (it was sent back to centre).
// - A bend curve longer than 30 seconds, sent whole when its note starts: a note starting early
//   in it starts at the bend in force then (the curve's start had been dropped).
// - Fledge Synth with a wide bend (more than 2 semitones) still to come: the bends before it play
//   as written, not twelve times too wide, nor ones sent before it too narrow after it.
// - A recorded piano under a clip's bend while a later note's own bend is sent ahead: every note
//   follows the clip's bend (the earlier ones had stopped following it).
// - A note longer than a seamless loop ends where the loop goes round, live and in the file: the
//   loop file is as loud as with a note that just fills the loop (copies piled up pass by pass).
// - The cost: a 16-bar note with a 256-point vibrato under 8th-note chords, played live, doesn't
//   hold the page up for more than a couple of seconds (it froze it for half a minute).
// - A note's own slide in a clip with a bend lane at rest (or a vibrato lane): the slide plays as
//   it does without the lane (the lane's value, said again every 16th, pulled it back each time).
// - A note bent up a tone, let go: its release rings at the bent pitch (it went back to centre at
//   the note's end, so its tail played unbent); a note begun under it and held on past it is
//   back in tune once it ends.
// - A recorded piano, harpsichord and guitar under a clip's bend up a tone: the sound of the key
//   let go (damper, jack, string) plays at the bent pitch too, about as little of the unbent pitch
//   in it as in a played note of the bent pitch (within 10 dB).
// - A note held to the end of a seamless loop across a tempo change: it sounds to the loop's end
//   (it was cut by the tempo where it started: 2 seconds early).
// - Stop during a recorded note's release (cello, organ, piano), live: the release falls on (it
//   jumped back to the note's full level for a moment).
// - A slide played live while the page is held up just as the note is due: it starts at the
//   start of its slide when the note starts late (it came in part way up).
// - A long bent note begun while a shorter bent note is held, or after a plain note let go of a
//   bent one's tail: it keeps its own bend past the shorter one's end and tail (it jumped back to
//   its unbent pitch where that tail would have ended).
// - A note scooped up to its pitch (its own bend back at rest) under a clip's bend that ends with
//   the clip: its tail after the clip's end sounds as a plain note's (the lane's bend held on).
// - A key played live (the on-screen piano) while a song note's bent tail rings: it plays in tune
//   (it took the song note's bend).
// - A Multi Sampler note with its own bend under a clip's bend lane, in the file and live: its
//   own bend adds to the lane's, as an MPE note's does to its master channel's (it played the
//   lane's alone), held, sliding up, and with the lane moving while it sounds.
//
//   npx vite --port 5200                 (in another terminal)
//   node scripts/audio-check/bends.cjs
//
// Pitches are the strongest frequency in a band holding the right one and the wrong ones found
// before; each must be within 0.3% of the right one. It exits
// with 1 when one is off. APP_URL overrides http://localhost:5200/. Needs Playwright with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
const FLEDGE = { id: 'p1', url: 'builtin:fledge/Fledge Synth', name: 'Fledge Synth', state: { builtin: 1 } };
const track = (key) => ({ id: 't1', name: key, instrumentKey: key, volume: -12, pan: 0, reverbSend: 0, delaySend: 0, ...(key === 'plugin' ? { plugin: FLEDGE } : {}) });
const song = (key, clips, loop) => ({ format: 'fledgetone-project', version: 1, name: 'Bends', bpm: 120, swing: 0, loopRegion: loop ?? { inBar: 1, outBar: 3, enabled: false }, tracks: [track(key)], clips });
const n = (id, note, startOffset, duration, velocity, bend) => ({ id, note, startOffset, duration, velocity, ...(bend ? { expr: { bend } } : {}) });
const hz = (name) => 440 * 2 ** ((({ C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 })[name[0]] + (name[1] === '#' ? 1 : 0) + 12 * (Number(name.at(-1)) - 4)) / 12);
const bent = (name, semis) => hz(name) * 2 ** (semis / 12);
// A Multi Sampler of one sine over every key (the sine made in the page: see RENDER)
const MULTI = { zones: [{ soundId: 'sine', name: 'sine', root: 69, lo: 0, hi: 127, velLo: 1, velHi: 127 }], attack: 0.002, release: 0.1 };
const multiSong = (clips) => ({ ...song('multiSampler', clips), tracks: [{ ...track('multiSampler'), multi: MULTI }] });

const cases = [];
// Overlapping bent notes: C4 +2 for a beat, G4 -2 from half a beat for two; G4 alone after 0.5 s
for (const key of ['keys', 'synthDesigner', 'realViolin', 'wavetable', 'brass'])
  cases.push({ what: `${key}, two bent notes overlapping, the later one after the first ends`, song: song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 1, notes: [n('n1', 'C4', 0, '4n', 0.3, [{ at: 0, value: 2 }]), n('n2', 'G4', 0.125, '2n', 0.9, [{ at: 0, value: -2 }])] }]), at: [0.6, 1.1], want: bent('G4', -2), band: [320, 420] });
// A 24-bar slide (48 s) up 2 semitones under an E4 at bar 3: bent by 2/24 of a tone and a little more there
for (const key of ['keys', 'synthDesigner', 'wavetable'])
  cases.push({ what: `${key}, an E4 starting early in a 48-second bend`, song: song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 24, notes: [n('n1', 'A2', 0, '24m', 0.15, [{ at: 0, value: 0 }, { at: 24, value: 2 }]), n('n2', 'E4', 2, '1m', 1)] }]), toBar: 4, at: [4.3, 5.5], want: bent('E4', (2 * 4.9) / 48), band: [310, 350] });
// Fledge Synth: a G4 bent +1 for a beat over a C4 that dives an octave later; and a slow C4 slide with a G5 diving later
cases.push({ what: 'Fledge Synth, a bend before a wide dive to come', song: song('plugin', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('n1', 'C4', 0, '1m', 0.3, [{ at: 0, value: 0 }, { at: 0.75, value: 0 }, { at: 1, value: -12 }]), n('n2', 'G4', 0.25, '4n', 0.9, [{ at: 0, value: 1 }])] }]), at: [0.6, 0.95], want: bent('G4', 1), band: [380, 430] });
const later = song('plugin', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('n1', 'C4', 0, '2m', 0.9, [{ at: 0, value: 0 }, { at: 2, value: 1 }]), n('n2', 'G5', 1, '4n', 0.2, [{ at: 0, value: 0 }, { at: 0.2, value: 0 }, { at: 0.25, value: -12 }])] }]);
cases.push({ what: 'Fledge Synth, a slide after a wide dive was sent', song: later, at: [3.4, 3.8], want: bent('C4', 0.9), band: [262, 295] });
// A recorded piano: a clip bend up a semitone over bar 1's second half, and a G4 with its own short scoop
cases.push({ what: 'Grand piano, an earlier note under a clip bend', song: song('realGrandPiano', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 4, expression: { bend: [{ at: 0, value: 0 }, { at: 0.5, value: 0 }, { at: 1, value: 1 }, { at: 4, value: 1 }] }, notes: [n('a', 'C4', 0, '2m', 0.9), n('b', 'G4', 0.25, '3m', 0.4, [{ at: 0, value: -1 }, { at: 0.05, value: 0 }])] }]), toBar: 5, at: [2.5, 3.5], want: bent('C4', 1), band: [250, 290] });

// A C4 bent up a tone for half a bar, an E4 begun under it and held on past its end: the E4 back in tune once the C4 has ended (the C4's bend rings on with its release only where nothing else sounds on)
for (const key of ['keys', 'subBass', 'synthDesigner'])
  cases.push({ what: `${key}, a note begun under a bent one and held on past it`, song: song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('n1', 'C4', 0, '2n', 0.6, [{ at: 0, value: 2 }]), n('n2', 'E4', 0.25, '1m', 0.9)] }]), at: [1.4, 2.2], want: hz('E4'), band: [310, 380] });
// A G4 bent down a tone for two bars, begun under a C4 bent up for a beat (recorded instruments, their tails short): the G4 keeps its
// own bend after the C4's end and tail (the song's bend sent for after the C4's tail pulled it back to G4)
for (const key of ['realGrandPiano', 'realViolin', 'realCello'])
  cases.push({ what: `${key}, a long bent note begun under a shorter bent one, after the shorter one's tail`, song: song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 3, notes: [n('n1', 'C4', 0, '4n', 0.3, [{ at: 0, value: 2 }]), n('n2', 'G4', 0.125, '2m', 0.9, [{ at: 0, value: -2 }])] }]), toBar: 4, at: [2.5, 3.5], want: bent('G4', -2), band: [320, 420] });
// The same with a quiet plain A5 between (begun under the C4, held on past it) and the G4 begun after the C4's end, while its tail
// would still ring (on keys a synth's long tail, the G4 begun 2 s after the C4's end): the G4 keeps its bend there too
for (const [key, at, from, len, toBar] of [['realGrandPiano', [2.5, 3.5], 0.5, '2m', 4], ['keys', [9, 10], 1.25, '4m', 7]])
  cases.push({ what: `${key}, a long bent note begun after a plain one let go of a bent one's tail`, song: song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: toBar - 1, notes: [n('n1', 'C4', 0, '4n', 0.3, [{ at: 0, value: 2 }]), n('n2', 'A5', 0.125, '2n', 0.15), n('n3', 'G4', from, len, 0.9, [{ at: 0, value: -2 }])] }]), toBar, at, want: bent('G4', -2), band: [320, 420] });

// A Multi Sampler A4 a bar long with its own bend under a clip's bend lane: the two add (each voice bends on its own)
const laneUp = { bend: [{ at: 0, value: 1 }, { at: 2, value: 1 }] };
const multiCases = [
  ['held +2 under a lane of +1', laneUp, [{ at: 0, value: 2 }], [0.5, 1.5], 3],
  ['sliding up to +2 over a beat under a lane of +1', laneUp, [{ at: 0, value: 0 }, { at: 0.25, value: 2 }], [0.8, 1.6], 3],
  ['held +1 under a lane moving from 0 to +2 while it sounds', { bend: [{ at: 0, value: 0 }, { at: 0.5, value: 0 }, { at: 0.625, value: 2 }, { at: 2, value: 2 }] }, [{ at: 0, value: 1 }], [1.55, 1.95], 3],
  ['held +2, no lane', undefined, [{ at: 0, value: 2 }], [0.5, 1.5], 2],
];
const multiOf = ([, expression, bend]) => multiSong([{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, ...(expression ? { expression } : {}), notes: [n('a', 'A4', 0, '1m', 0.9, bend)] }]);
for (const c of multiCases) cases.push({ what: `Multi Sampler, its own bend ${c[0]}`, song: multiOf(c), at: c[3], want: bent('A4', c[4]), band: [430, 540] });

// In the page: render `text` (bars 1..toBar, `ending`) as Export does and return the strongest frequency in `band` over `at`, or the RMS (dB);
// or, with `track`, the strongest frequency in its band every 5 ms over [t0, t1] (15 ms windows); or, with `levels`, the level (dB) of
// each of `freqs` over that stretch; or, with `rms`, the RMS (dB) over each stretch
const RENDER = async ({ text, toBar, ending, at, band, track, levels, freqs, rms }) => {
  const P = await import('/src/store/project.ts');
  const X = await import('/src/audio/exportWav.ts');
  const T = await import('/src/store/timelineTypes.ts');
  const p = P.parseProject(JSON.parse(text));
  // (the Multi Sampler's sine, a sound made here in memory, when `text` uses it)
  if (text.includes('"sine"')) {
    const SL = await import('/src/audio/soundLibrary.ts');
    const b = new OfflineAudioContext(1, 44100 * 8, 44100).createBuffer(1, 44100 * 8, 44100);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100);
    SL.provideMemorySound('sine', b);
  }
  const opts = { tracks: p.tracks, clips: p.clips, bpm: p.bpm, tempoPoints: p.tempoPoints, swing: p.swing, startBar: 1, endBar: toBar, masterFx: p.masterFx ?? T.DEFAULT_MASTER_FX, ending, sampleRate: 44100, markers: [] };
  const audio = await X.renderArrangement(opts);
  const x = audio.getChannelData(0);
  const goertzel = (a, f, sr) => {
    const k = (2 * Math.PI * f) / sr;
    const c = 2 * Math.cos(k);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < a.length; i++) {
      const s0 = a[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (a.length - 1))) + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  if (rms) return rms.map(([a, b]) => { const s = x.subarray(Math.round(a * audio.sampleRate), Math.round(b * audio.sampleRate)); let e = 0; for (const v of s) e += v * v; return 10 * Math.log10(e / Math.max(1, s.length) + 1e-20); });
  if (levels) {
    const a = x.subarray(Math.round(levels[0] * audio.sampleRate), Math.round(levels[1] * audio.sampleRate));
    return freqs.map((f) => 10 * Math.log10(goertzel(a, f, audio.sampleRate) + 1e-30));
  }
  if (track) {
    const out = [];
    for (let t = track.t0; t < track.t1; t += 0.005) {
      const a = x.subarray(Math.round(t * audio.sampleRate), Math.round((t + 0.015) * audio.sampleRate));
      let best = 0;
      let bf = 0;
      for (let f = track.band[0]; f <= track.band[1]; f += 0.5) {
        const p = goertzel(a, f, audio.sampleRate);
        if (p > best) {
          best = p;
          bf = f;
        }
      }
      out.push(bf);
    }
    return out;
  }
  if (!at) {
    let e = 0;
    for (const v of x) e += v * v;
    return 10 * Math.log10(e / x.length + 1e-20);
  }
  const sr = audio.sampleRate;
  const a = x.subarray(Math.round(at[0] * sr), Math.round(at[1] * sr));
  // Goertzel over the band (the right pitch and the wrong ones found before), a hann window, 0.05 Hz steps
  const w = a.map((v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (a.length - 1))));
  let best = 0;
  let bestF = 0;
  for (let f = band[0]; f <= band[1]; f += 0.05) {
    const k = (2 * Math.PI * f) / sr;
    const c = 2 * Math.cos(k);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < w.length; i++) {
      const s0 = w[i] + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const pow = s1 * s1 + s2 * s2 - c * s1 * s2;
    if (pow > best) {
      best = pow;
      bestF = f;
    }
  }
  return bestF;
};

// Play `text` live for `seconds` and return the longest main-thread task (ms)
const PLAY = async ({ text, seconds }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const engine = await (await fetch('/src/audio/engine.ts')).text();
  const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = store.useTimelineStore;
  s.getState().loadProject(P.parseProject(JSON.parse(text)));
  await sleep(3000);
  await T.start();
  const tasks = [];
  const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => tasks.push(e.duration)));
  po.observe({ type: 'longtask' });
  s.getState().seek(1);
  await s.getState().togglePlay();
  await sleep(seconds * 1000);
  if (s.getState().isPlaying) s.getState().stop();
  await sleep(300);
  po.disconnect();
  return Math.max(0, ...tasks);
};

// Play `text` live from bar 1, Stop `stopAfter` seconds in, and return the output's level every 10 ms (dB) from `from` seconds after the first sound to 1.5 s later
const STOP = async ({ text, stopAfter, from }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const engine = await (await fetch('/src/audio/engine.ts')).text();
  const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = store.useTimelineStore;
  s.getState().loadProject(P.parseProject(JSON.parse(text)));
  await sleep(6000);
  await T.start();
  const rec = new T.Recorder();
  T.getDestination().connect(rec);
  rec.start();
  await sleep(100);
  s.getState().seek(1);
  await s.getState().togglePlay();
  await sleep(stopAfter * 1000);
  s.getState().stop();
  await sleep(1500);
  const b = await new AudioContext().decodeAudioData(await (await rec.stop()).arrayBuffer());
  const x = b.getChannelData(0);
  const sr = b.sampleRate;
  const onset = Math.max(0, x.findIndex((v) => Math.abs(v) > 0.001));
  const out = [];
  const w = Math.round(0.01 * sr);
  for (let i = onset + Math.round(from * sr), k = 0; k < 150 && i + w < x.length; i += w, k++) {
    let e = 0;
    for (let j = i; j < i + w; j++) e += x[j] * x[j];
    out.push(10 * Math.log10(e / w + 1e-18));
  }
  return out;
};

// Play `text` live from bar 1, hold the page up for `stall` ms `stallAt` ms in, and return the pitch (autocorrelation, 40 ms) every 50 ms from the first sound
const STALL = async ({ text, stall, stallAt, seconds }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const engine = await (await fetch('/src/audio/engine.ts')).text();
  const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = store.useTimelineStore;
  s.getState().loadProject(P.parseProject(JSON.parse(text)));
  await sleep(3000);
  await T.start();
  const rec = new T.Recorder();
  T.getDestination().connect(rec);
  s.getState().seek(1);
  await sleep(300);
  rec.start();
  await s.getState().togglePlay();
  await sleep(stallAt);
  const end = performance.now() + stall;
  while (performance.now() < end) {}
  await sleep(seconds * 1000 - stallAt);
  if (s.getState().isPlaying) s.getState().stop();
  await sleep(500);
  const b = await new AudioContext().decodeAudioData(await (await rec.stop()).arrayBuffer());
  const x = b.getChannelData(0);
  const sr = b.sampleRate;
  const pitch = (a) => {
    let best = -Infinity;
    let at = 0;
    for (let L = Math.floor(sr / 450); L <= Math.ceil(sr / 180); L++) {
      let c = 0;
      for (let i = 0; i + L < a.length; i++) c += a[i] * a[i + L];
      if (c > best) {
        best = c;
        at = L;
      }
    }
    return sr / at;
  };
  const onset = Math.max(0, x.findIndex((v) => Math.abs(v) > 0.003));
  const out = [];
  for (let t = 0.1; t < seconds - 0.2; t += 0.05) {
    const i = onset + Math.round(t * sr);
    out.push([t, pitch(x.subarray(i, i + Math.round(0.04 * sr)))]);
  }
  return out;
};

// Play `text` live from bar 1, press the on-screen key `midi` `keyAt` seconds in for `keyFor` seconds, and return the strongest frequency in
// `band` and the level every 0.1 s (80 ms windows) from the first sound, for `seconds`
const KEY = async ({ text, keyAt, keyFor, midi, seconds, band }) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const LI = await import('/src/audio/liveInput.ts');
  // (the Multi Sampler's sine, a sound made here in memory, when `text` uses it)
  if (text.includes('"sine"')) {
    const SL = await import('/src/audio/soundLibrary.ts');
    const b = new OfflineAudioContext(1, 44100 * 8, 44100).createBuffer(1, 44100 * 8, 44100);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100);
    SL.provideMemorySound('sine', b);
  }
  const engine = await (await fetch('/src/audio/engine.ts')).text();
  const T = await import(engine.match(/from "([^"]*\/deps\/tone\.js[^"]*)"/)[1]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const s = store.useTimelineStore;
  s.getState().loadProject(P.parseProject(JSON.parse(text)));
  s.setState({ selectedTrackId: 't1' });
  await sleep(3000);
  await T.start();
  const rec = new T.Recorder();
  T.getDestination().connect(rec);
  s.getState().seek(1);
  await sleep(300);
  rec.start();
  await s.getState().togglePlay();
  await sleep(keyAt * 1000);
  LI.pressScreenKey(midi, true);
  await sleep(keyFor * 1000);
  LI.pressScreenKey(midi, false);
  await sleep((seconds - keyAt - keyFor) * 1000);
  if (s.getState().isPlaying) s.getState().stop();
  await sleep(300);
  const b = await new AudioContext().decodeAudioData(await (await rec.stop()).arrayBuffer());
  const x = b.getChannelData(0);
  const sr = b.sampleRate;
  const onset = Math.max(0, x.findIndex((v) => Math.abs(v) > 0.003));
  const goertzel = (a, f) => {
    const k = (2 * Math.PI * f) / sr;
    const c = 2 * Math.cos(k);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < a.length; i++) {
      const s0 = a[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (a.length - 1))) + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  };
  const out = [];
  for (let t = 0.1; t < seconds - 0.2; t += 0.1) {
    const a = x.subarray(onset + Math.round(t * sr), onset + Math.round((t + 0.08) * sr));
    let best = 0;
    let bf = 0;
    let e = 0;
    for (const v of a) e += v * v;
    for (let f = band[0]; f <= band[1]; f += 0.5) {
      const p = goertzel(a, f);
      if (p > best) {
        best = p;
        bf = f;
      }
    }
    out.push([t, bf, 10 * Math.log10(e / a.length + 1e-20)]);
  }
  return out;
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failed = 0;
  const page = async () => {
    const pg = await browser.newPage();
    pg.on('pageerror', (e) => console.error('[pageerror]', e.message));
    await pg.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
    await pg.goto(APP, { waitUntil: 'load', timeout: 120000 });
    await pg.waitForTimeout(1500);
    return pg;
  };
  const report = (ok, line) => {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
  };
  for (const c of cases) {
    const pg = await page();
    const got = await pg.evaluate(RENDER, { text: JSON.stringify(c.song), toBar: c.toBar ?? 3, ending: 'ringOut', at: c.at, band: c.band });
    report(Math.abs(got / c.want - 1) < 0.003, `${c.what}: ${got.toFixed(1)} Hz, want ${c.want.toFixed(1)} Hz`);
    await pg.close();
  }
  // Seamless loop files of bars 1-3 with an A3 from beat 2 of bar 2 held 4 bars, or 100: as loud as each other
  const seam = (dur) => song('synthDesigner', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('n1', 'C4', 0, '2n', 0.6), n('n2', 'E4', 1, '2n', 0.6), n('n3', 'A3', 1.5, dur, 0.6)] }], { inBar: 1, outBar: 3, enabled: true });
  const levels = [];
  for (const dur of ['4m', '100m']) {
    const pg = await page();
    levels.push(await pg.evaluate(RENDER, { text: JSON.stringify(seam(dur)), toBar: 3, ending: 'seamless' }));
    await pg.close();
  }
  report(Math.abs(levels[0] - levels[1]) < 0.5, `seamless loop, a note held 100 bars as loud as one held 4: ${levels[1].toFixed(1)} dB, ${levels[0].toFixed(1)} dB`);
  // The cost, live
  const L = 16;
  const vib = [...Array(256)].map((_, i) => ({ at: +((i * L) / 255).toFixed(6), value: i % 2 ? 0.3 : -0.3 }));
  const chords = [...Array(L * 8)].flatMap((_, k) => ['C4', 'E4', 'G4', 'B4'].map((x, j) => n(`c${k}_${j}`, x, k / 8, '8n', 0.5)));
  for (const key of ['keys', 'synthDesigner', 'realViolin']) {
    const pg = await page();
    const ms = await pg.evaluate(PLAY, { text: JSON.stringify(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: L, notes: [n('n1', 'A2', 0, `${L}m`, 0.6, vib), ...chords] }])), seconds: 10 });
    report(ms < 2000, `${key}, a long vibrato under chords played live: longest hold-up ${Math.round(ms)} ms`);
    await pg.close();
  }
  const render = async (s, opts) => {
    const pg = await page();
    const got = await pg.evaluate(RENDER, { text: JSON.stringify(s), toBar: 3, ending: 'ringOut', ...opts });
    await pg.close();
    return got;
  };
  // A slide up a fifth over bar 1, in a clip whose bend lane rests until bar 1.5 (or with a steady vibrato lane)
  const slide = [n('a', 'C4', 0, '1m', 0.9, [{ at: 0, value: 0 }, { at: 1, value: 7 }])];
  for (const [key, lane] of [['synthDesigner', { bend: [{ at: 0, value: 0 }, { at: 1.5, value: 0 }, { at: 2, value: 1 }] }], ['keys', { bend: [{ at: 0, value: 0 }, { at: 1.5, value: 0 }, { at: 2, value: 1 }] }], ['synthDesigner', { vibrato: [{ at: 0, value: 0.5 }, { at: 2, value: 0.5 }] }]]) {
    const track = { t0: 0.3, t1: 1.9, band: [255, 400] };
    const a = await render(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: slide, expression: lane }]), { track });
    const b = await render(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: slide }]), { track });
    let worst = 0;
    a.forEach((f, i) => {
      const c = 1200 * Math.log2(f / b[i]);
      if (Math.abs(c) > Math.abs(worst)) worst = c;
    });
    report(Math.abs(worst) < 25, `${key}, a note's slide in a clip with a ${lane.vibrato ? 'vibrato' : 'bend'} lane: off the slide by up to ${worst.toFixed(0)} cents`);
  }
  // A C4 bent up a tone for half a bar, let go: its release (just after) at D4
  for (const key of ['wavetable', 'synthDesigner', 'keys']) {
    const f = await render(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 1, notes: [n('a', 'C4', 0, '2n', 0.9, [{ at: 0, value: 2 }])] }]), { toBar: 2, track: { t0: 1.03, t1: 1.12, band: [250, 300] } });
    const med = f.slice().sort((p, q) => p - q)[f.length >> 1];
    report(Math.abs(med / bent('C4', 2) - 1) < 0.01, `${key}, a note bent up a tone let go: its release at ${med.toFixed(1)} Hz, want ${bent('C4', 2).toFixed(1)} Hz`);
  }
  // An 8th-note C4 under a clip's bend up a tone, against a played D4: how much C4 is in what follows its end
  for (const key of ['realGrandPiano', 'realHarpsichord', 'realGuitar']) {
    const lv = (note, expression) => render(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 1, notes: [n('a', note, 0, '8n', 1)], ...(expression ? { expression } : {}) }]), { toBar: 2, levels: [0.26, 0.5], freqs: [hz('C4'), hz('D4')] });
    const b = await lv('C4', { bend: [{ at: 0, value: 2 }, { at: 1, value: 2 }] });
    const d = await lv('D4');
    report(b[0] - b[1] < d[0] - d[1] + 10, `${key}, a C4 under a clip bend up a tone, after its end: C4 ${(b[0] - b[1]).toFixed(1)} dB against D4 (a played D4: ${(d[0] - d[1]).toFixed(1)} dB)`);
  }
  // A C4 scooped up to its pitch (its own bend back at rest) under a clip's bend up a tone that ends with the clip, before the note: its
  // tail after the clip's end as a plain note's (the lane's last value held through it)
  for (const key of ['wavetable', 'synthDesigner', 'keys']) {
    const lane = { bend: [{ at: 0, value: 2 }, { at: 0.5, value: 2 }] };
    const tr = { toBar: 2, track: { t0: 1.03, t1: 1.12, band: [250, 300] } };
    const med = (f) => f.slice().sort((p, q) => p - q)[f.length >> 1];
    const a = med(await render(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 0.5, expression: lane, notes: [n('a', 'C4', 0, '2n', 0.9, [{ at: 0, value: -1 }, { at: 0.05, value: 0 }])] }]), tr));
    const b = med(await render(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 0.5, expression: lane, notes: [n('a', 'C4', 0, '2n', 0.9)] }]), tr));
    report(Math.abs(a / b - 1) < 0.01, `${key}, a scooped note's tail after its clip's bend ends: ${a.toFixed(1)} Hz, a plain note's ${b.toFixed(1)} Hz`);
  }
  // Seamless loop of bars 1-3, 120 BPM then 60 from bar 2 (6 s): an A3 from bar 1.5 held 100 bars sounds to the loop's end
  {
    const s = { ...song('synthDesigner', [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('a', 'A3', 0.5, '100m', 0.6)] }], { inBar: 1, outBar: 3, enabled: true }), tempoPoints: [{ id: 'tp', bar: 2, bpm: 60, ramp: false }] };
    const [early, late] = await render(s, { ending: 'seamless', rms: [[2, 3.5], [4.5, 5.8]] });
    report(Math.abs(early - late) < 3, `seamless loop across a tempo change, a note held to its end: ${late.toFixed(1)} dB near the end, ${early.toFixed(1)} dB earlier`);
  }
  // Stop 0.4 s after a recorded note of bar 2 ends (in its release): its level never rises after the note's end
  for (const key of ['realCello', 'realPipeOrgan', 'realGrandPiano']) {
    const pg = await page();
    const env = await pg.evaluate(STOP, { text: JSON.stringify(song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('a', 'C4', 1, '1m', 0.8)] }])), stopAfter: 4.4, from: 1.9 });
    await pg.close();
    let rise = 0;
    for (let i = 1; i < env.length; i++) if (env[i - 1] > -90) rise = Math.max(rise, env[i] - env[i - 1]);
    report(rise < 6, `${key}, Stop during a note's release, live: its level rises by up to ${rise.toFixed(1)} dB`);
  }
  // A 4-second slide up a fifth, the page held up for 0.4 s just as it starts: within 40 cents of the slide throughout
  for (const key of ['lead', 'plugin']) {
    const pg = await page();
    const s = song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [n('a', 'C4', 0, '2m', 0.8, [{ at: 0, value: 0 }, { at: 2, value: 7 }])] }], { inBar: 1, outBar: 9, enabled: false });
    const got = await pg.evaluate(STALL, { text: JSON.stringify(s), stall: 400, stallAt: 0, seconds: 4 });
    await pg.close();
    let worst = 0;
    for (const [t, f] of got) {
      if (t < 0.3 || t > 3.7) continue;
      const c = 1200 * Math.log2(f / bent('C4', (7 * t) / 4));
      if (Math.abs(c) > Math.abs(worst)) worst = c;
    }
    report(Math.abs(worst) < 40, `${key === 'plugin' ? 'Fledge Synth' : key}, a slide played live with the page held up as it starts: off the slide by up to ${worst.toFixed(0)} cents`);
  }
  // A C4 bent up a tone for half a bar (1 s), nothing after it; an E4 played live on the on-screen piano 1.5 s after Play, in
  // the C4's bent tail: the E4 in tune (the song's bend kept for the C4's tail bent it to F#4)
  for (const key of ['keys', 'synthDesigner', 'realGrandPiano']) {
    const pg = await page();
    const s = song(key, [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 4, notes: [n('a', 'C4', 0, '2n', 0.9, [{ at: 0, value: 2 }])] }]);
    const got = await pg.evaluate(KEY, { text: JSON.stringify(s), keyAt: 1.5, keyFor: 0.8, midi: 64, seconds: 3.2, band: [240, 400] });
    await pg.close();
    const f = got.filter(([t, , db]) => t > 1.45 && t < 2.0 && db > -65).map(([, hzAt]) => hzAt).sort((p, q) => p - q);
    const med = f.length ? f[f.length >> 1] : 0;
    report(Math.abs(med / hz('E4') - 1) < 0.01, `${key}, a key played live in a song note's bent tail: ${med.toFixed(1)} Hz, want ${hz('E4').toFixed(1)} Hz`);
  }
  // The Multi Sampler's A4 with its own bend of +2 under a lane of +1, played live: as in the file (no key pressed: one played off the band, at the end)
  {
    const pg = await page();
    const got = await pg.evaluate(KEY, { text: JSON.stringify(multiOf(multiCases[0])), keyAt: 2.6, keyFor: 0.1, midi: 36, seconds: 3, band: [430, 540] });
    await pg.close();
    const f = got.filter(([t, , db]) => t > 0.4 && t < 1.6 && db > -65).map(([, hzAt]) => hzAt).sort((p, q) => p - q);
    const med = f.length ? f[f.length >> 1] : 0;
    report(Math.abs(med / bent('A4', 3) - 1) < 0.01, `Multi Sampler, its own bend held +2 under a lane of +1, live: ${med.toFixed(1)} Hz, want ${bent('A4', 3).toFixed(1)} Hz`);
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
