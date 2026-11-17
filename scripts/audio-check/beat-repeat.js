// Fledge Repeat following the song, in exports and live (run with run.cjs):
//
//   APP_URL='http://localhost:5200/?studio' node scripts/audio-check/run.cjs scripts/audio-check/beat-repeat.js
//
// A sub playing a different note on every 8th plays through Fledge
// Repeat set to fill the last quarter note of every bar with 16ths. Measured: which beats of the
// export differ from the same song without the plugin (only each bar's last), that the export is
// the same twice, and how close live playback comes to the export.
// arg.live === false skips the live part.
const T = await import('/src/store/timelineTypes.ts');
const ex = await import('/src/audio/exportWav.ts');
const { useTimelineStore } = await import('/src/store/timelineStore.ts');
const { liveMix } = await import('/src/audio/engine.ts');
const sr = 44100;
const bpm = 120;
// Every 1 bar, for 1/4, 16ths (the values as the plugin stores them: the middle of each choice)
const values = [0, 0.3, 0.3, 0.4375, 1, 0, 0.5, 1, 1];
const plug = { id: 'rep', url: 'builtin:fledge-repeat/Fledge Repeat', name: 'Fledge Repeat', state: { builtin: 1, values } };
const sub = (withIt) => mkTrack('sub', 'subBass', T.defaultTrackFx(), withIt ? { pluginFx: [plug] } : {});
// (A different note on every 8th, each a 16th long: a repeated 16th is plainly not what the track plays next)
const PITCHES = ['C2', 'D2', 'E2', 'G2', 'A2', 'C3', 'D3', 'E3'];
const clips = [mkClip('s', 'sub', 1, 4, Array.from({ length: 32 }, (_, k) => ({ note: PITCHES[(k * 3) % 8], startOffset: k / 8, duration: '16n', velocity: 0.5 + 0.4 * ((k * 5) % 8) / 8 })))];
const base = { clips, bpm, swing: 0, masterFx: T.DEFAULT_MASTER_FX, startBar: 1, endBar: 5, ending: 'exact', sampleRate: sr, bypassMaster: true };
const render = async (withIt) => (await ex.renderArrangement({ ...base, tracks: [sub(withIt)], threads: 1 })).getChannelData(0);
const beat = Math.round((60 / bpm) * sr);
/** For each of the 16 beats, how far two renders are apart at their worst (dB; "same" when not at all). */
const perBeat = (a, b) => Array.from({ length: 16 }, (_, k) => {
  let w = 0;
  for (let i = k * beat; i < (k + 1) * beat && i < a.length && i < b.length; i++) w = Math.max(w, Math.abs(a[i] - b[i]));
  return w === 0 ? 'same' : Math.round(20 * Math.log10(w));
});
const plain = await render(false);
const first = await render(true);
const out = {};
out.peak = +Math.max(...first.subarray(0, sr)).toFixed(3);
out.levelPerBar = [0, 1, 2, 3].map((b) => { let s = 0; for (let i = b * 4 * beat; i < (b + 1) * 4 * beat; i++) s += first[i] * first[i]; return Math.round(10 * Math.log10(s / (4 * beat) + 1e-12)); });
out.beatsChanged = perBeat(plain, first).map((d, k) => (d === 'same' || d < -80 ? null : k + 1)).filter(Boolean);
out.changeDb = perBeat(plain, first);
const again = await render(true);
out.again = perBeat(first, again).every((d) => d === 'same') ? 'same' : perBeat(first, again);
if (arg.live === false) return out;

const STEP = 0.0005;
function envelope(x, rate) {
  const step = Math.round(rate * STEP);
  const win = Math.round(rate / 65.4);
  const res = [];
  for (let i = 0; i + win < x.length; i += step) {
    let s = 0;
    for (let k = 0; k < win; k++) s += x[i + k] * x[i + k];
    res.push(10 * Math.log10(s / win + 1e-12));
  }
  return res;
}
const exp = envelope(first, sr);
const { initAudio } = await import('/src/audio/engine.ts');
await initAudio();
const unhook = (await import('/src/store/timelineStore.ts')).connectTimelineToAudio();
useTimelineStore.getState().loadProject({ name: 'Beat repeat check', bpm, swing: 0, tempoPoints: [], tracks: [sub(true)], clips, markers: [], masterFx: T.DEFAULT_MASTER_FX, master: T.defaultMasterSettings(), loopRegion: { inBar: 1, outBar: 5, enabled: false } });
const { createWorkletNode, loadWorklet } = await import('/src/audio/worklets.ts');
const ctx = liveMix.bus.context;
const SRC = `class Rec extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = () => (this.on = false); } process(inputs) { const x = inputs[0][0]; if (x) this.port.postMessage(x.slice()); return this.on; } } registerProcessor('repeat-check-rec', Rec);`;
await loadWorklet(ctx, 'repeat-check-rec', SRC);
const rec = createWorkletNode(ctx, 'repeat-check-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
const recorded = [];
rec.port.onmessage = (e) => recorded.push(e.data);
Tone.connect(liveMix.bus, rec);
await new Promise((r) => setTimeout(r, 2500));
await useTimelineStore.getState().play();
await new Promise((r) => setTimeout(r, 9000));
useTimelineStore.getState().stop();
unhook();
rec.port.postMessage('stop');
Tone.disconnect(liveMix.bus, rec);
const all = new Float32Array(recorded.reduce((n, b) => n + b.length, 0));
let at = 0;
for (const b of recorded) {
  all.set(b, at);
  at += b.length;
}
const live = envelope(all, ctx.sampleRate);
const ref = exp.slice(0, Math.round(7.5 / STEP));
let best = { lag: 0, err: Infinity };
for (let lag = 0; lag + ref.length < live.length; lag += 4) {
  let e = 0;
  for (let i = 0; i < ref.length; i += 12) e += Math.abs(live[lag + i] - ref[i]);
  if (e < best.err) best = { lag, err: e };
}
for (let lag = Math.max(0, best.lag - 4); lag <= best.lag + 4; lag++) {
  let e = 0;
  for (let i = 0; i < ref.length; i += 3) e += Math.abs(live[lag + i] - ref[i]);
  if (lag === best.lag - 4 || e < best.fine) Object.assign(best, { fine: e, lag });
}
const skip = Math.round(0.05 / STEP);
let worst = 0, sum = 0, big = 0;
const where = [];
// (Where the sound is: in the gaps between notes, 40 dB and more under them, the level is next to
// nothing and a hair's difference in a note's tail is many dB)
const top = Math.max(...ref);
for (let i = skip; i < ref.length; i++) {
  if (ref[i] < top - 40 && live[best.lag + i] < top - 40) continue;
  const d = Math.abs(live[best.lag + i] - ref[i]);
  if (d > 1 && (!where.length || i * STEP * 1000 - where[where.length - 1][1] > 20)) where.push([Math.round(i * STEP * 1000), Math.round(i * STEP * 1000), +(live[best.lag + i] - ref[i]).toFixed(1)]);
  else if (d > 1) where[where.length - 1][1] = Math.round(i * STEP * 1000);
  worst = Math.max(worst, d);
  sum += d;
  if (d > 1) big++;
}
out.exportVsLive = { worstDb: +worst.toFixed(2), meanDb: +(sum / (ref.length - skip)).toFixed(3), msOver1Db: +(big * STEP * 1000).toFixed(1), where };
return out;
