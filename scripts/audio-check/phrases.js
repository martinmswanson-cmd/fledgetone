// Render a short phrase per sampled instrument through the export path (its own stem, master
// bypassed): 8 quarter notes rising across the range, then a held note near the top.
// Returns per-note spectral centroid / level, and the stems as WAV data URLs.
const ex = await import('/src/audio/exportWav.ts');
const { defaultTrackFx, DEFAULT_MASTER_FX } = await import('/src/store/timelineTypes.ts');
const { INSTRUMENTS } = await import('/src/audio/instrumentCatalog.ts');
const keys = arg.keys || ['erhu', 'electricGuitar', 'guitar', 'violin', 'cello', 'flute', 'trumpet', 'saxophone', 'frenchHorn', 'harp', 'mandolin'];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const nn = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
const bpm = 100, sr = 44100;
const tracks = [], clips = [];
const plan = {};
for (const key of keys) {
  const [lo, hi] = INSTRUMENTS[key].range;
  const a = lo + 2, b = hi - 2;
  const steps = Array.from({ length: 8 }, (_, i) => Math.round(a + ((b - a) * i) / 7));
  const notes = steps.map((m, i) => ({ note: nn(m), startOffset: i / 4, duration: '4n', velocity: 0.85 }));
  notes.push({ note: nn(Math.round((a + b) / 2) + 7), startOffset: 2, duration: '1m', velocity: 0.85 });
  plan[key] = notes.map((n) => n.note);
  tracks.push(mkTrack(key, key, defaultTrackFx()));
  clips.push(mkClip('c' + key, key, 1, 3, notes));
}
const stems = await ex.renderStems({ tracks, clips, bpm, swing: 0, masterFx: DEFAULT_MASTER_FX, startBar: 1, endBar: 4, ending: 'exact', sampleRate: sr, bypassMaster: true }, 16);
const ctx = new OfflineAudioContext(1, 1, sr);
const wavs = {}, analysis = {};
for (const { track, wav } of stems) {
  const buf = await ctx.decodeAudioData(await wav.arrayBuffer());
  const x = buf.getChannelData(0);
  const beat = (60 / bpm) * sr;
  const notes = plan[track.id].map((note, i) => {
    const start = Math.round(i < 8 ? i * beat : 8 * beat);
    const len = Math.round(i < 8 ? beat : 4 * beat);
    // the loudest 100 ms window inside the note, its spectrum
    let best = 0, bi = start;
    for (let j = start; j + 4410 < start + len; j += 441) { let s = 0; for (let k = 0; k < 4410; k++) s += x[j + k] * x[j + k]; if (s > best) { best = s; bi = j; } }
    const N = 8192; const seg = new Float32Array(N); for (let k = 0; k < N && bi + k < x.length; k++) seg[k] = x[bi + k] * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N));
    // DFT by bands (cheap enough: 8192 points, 64 bins of 100 Hz up to 6.4 kHz + rest)
    const re = new Float32Array(N / 2), im = new Float32Array(N / 2);
    // Goertzel-free: use a real FFT via the AudioContext? keep it simple: compute band energies with a few hundred bins
    const bins = 256; const bandE = new Float64Array(bins);
    for (let b = 1; b < bins; b++) { const f = (b * sr) / N / 2 * 2; let sr_ = 0, si = 0; const w = (2 * Math.PI * b * 16) / N; for (let k = 0; k < N; k++) { sr_ += seg[k] * Math.cos(w * k); si -= seg[k] * Math.sin(w * k); } bandE[b] = sr_ * sr_ + si * si; }
    let tot = 0, cs = 0, hi = 0; for (let b = 1; b < bins; b++) { const f = (b * 16 * sr) / N; tot += bandE[b]; cs += bandE[b] * f; if (f > 2500) hi += bandE[b]; }
    const rms = 20 * Math.log10(Math.sqrt(best / 4410) + 1e-9);
    // how long the note sounds: time until the envelope falls 30 dB below its peak within the note
    let endAt = len; for (let j = bi; j < start + len; j += 441) { let s = 0; for (let k = 0; k < 441 && j + k < x.length; k++) s += x[j + k] * x[j + k]; if (s / 441 < (best / 4410) / 1000) { endAt = j - start; break; } }
    return { note, rms: +rms.toFixed(1), centroid: Math.round(cs / (tot + 1e-12)), hf: +(hi / (tot + 1e-12)).toFixed(3), sounds: +(endAt / sr).toFixed(2) };
  });
  analysis[track.id] = notes;
  wavs[track.id] = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(wav); });
}
return { analysis, wavs };
