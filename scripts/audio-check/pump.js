// The Pump's duck shapes and drum triggers, live against the export (run with run.cjs):
//
//   APP_URL='http://localhost:5200/?studio' node scripts/audio-check/run.cjs scripts/audio-check/pump.js '{"shape":"hole","trigger":"kickSnare"}'
//
// A held 65 Hz sub ducks with a Pump (arg.shape, arg.trigger, arg.depth, arg.release) under a drum
// part (kicks on 1 and 3, a snare on 2, a clap on 4) turned right down. The sub is rendered by the
// export, and played live with its sound taken off the master bus; the dips' depth and timing are
// measured in both, and the two envelopes compared (after lining them up).
const T = await import('/src/store/timelineTypes.ts');
const ex = await import('/src/audio/exportWav.ts');
const { useTimelineStore } = await import('/src/store/timelineStore.ts');
const { liveMix } = await import('/src/audio/engine.ts');
const sr = 44100;
const bpm = 120;
const fx = T.defaultTrackFx();
const pump = { on: true, depth: arg.depth ?? 1 - 10 ** (-18 / 20), release: arg.release ?? 150, trigger: arg.trigger ?? 'kickSnare', ...(arg.shape && arg.shape !== 'smooth' ? { shape: arg.shape } : {}) };
const drums = mkTrack('drums', 'designedKit', T.defaultTrackFx(), { volume: -60 });
const sub = mkTrack('sub', 'subBass', { ...fx, pump });
const hits = [];
for (let b = 0; b < 4; b++) hits.push({ note: 'C1', startOffset: b }, { note: 'D1', startOffset: b + 0.25 }, { note: 'C1', startOffset: b + 0.5 }, { note: 'D#1', startOffset: b + 0.75 });
const clips = [mkClip('d', 'drums', 1, 4, hits), mkClip('s', 'sub', 1, 4, [{ note: 'C2', startOffset: 0, duration: '4m', velocity: 0.9 }])];
const tracks = [drums, sub];

/** The sub's level in 0.5 ms steps, dB (over one cycle of it). */
const STEP = 0.0005;
function envelope(x, rate) {
  const step = Math.round(rate * STEP);
  const win = Math.round(rate / 65.4);
  const out = [];
  for (let i = 0; i + win < x.length; i += step) {
    let s = 0;
    for (let k = 0; k < win; k++) s += x[i + k] * x[i + k];
    out.push(10 * Math.log10(s / win + 1e-12));
  }
  return out;
}

// The export (no master: the sub alone)
const buf = await ex.renderArrangement({ tracks, clips, bpm, swing: 0, masterFx: T.DEFAULT_MASTER_FX, startBar: 1, endBar: 5, ending: 'exact', sampleRate: sr, bypassMaster: true });
const exp = envelope(buf.getChannelData(0), sr);

// Live: the song in the store, played, the master bus recorded
const { initAudio } = await import('/src/audio/engine.ts');
await initAudio();
// (The studio connects the live engine as its timeline mounts; here it's done directly, in case it hasn't)
const unhook = (await import('/src/store/timelineStore.ts')).connectTimelineToAudio();
useTimelineStore.getState().loadProject({ name: 'Pump check', bpm, swing: 0, tempoPoints: [], tracks, clips, markers: [], masterFx: T.DEFAULT_MASTER_FX, master: T.defaultMasterSettings(), loopRegion: { inBar: 1, outBar: 5, enabled: false } });
const { createWorkletNode, loadWorklet } = await import('/src/audio/worklets.ts');
const ctx = liveMix.bus.context;
const SRC = `class Rec extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = () => (this.on = false); } process(inputs) { const x = inputs[0][0]; if (x) this.port.postMessage(x.slice()); return this.on; } } registerProcessor('pump-check-rec', Rec);`;
await loadWorklet(ctx, 'pump-check-rec', SRC);
const rec = createWorkletNode(ctx, 'pump-check-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
const recorded = [];
rec.port.onmessage = (e) => recorded.push(e.data);
Tone.connect(liveMix.bus, rec);
await new Promise((r) => setTimeout(r, 1500));
await useTimelineStore.getState().play();
await new Promise((r) => setTimeout(r, 4000));
const mid = { playing: useTimelineStore.getState().isPlaying, peaks: Object.fromEntries((await import('/src/audio/liveTracks.ts')).liveTrackPeaks()), tracks: useTimelineStore.getState().tracks.map((t) => t.id + ':' + t.instrumentKey) };
await new Promise((r) => setTimeout(r, 5500));
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
const nativeCtx = { sampleRate: ctx.sampleRate, state: ctx.state };
const live = envelope(all, nativeCtx.sampleRate);

// Line them up: the live envelope's best match for the export's over its first bars
const ref = exp.slice(0, Math.round(3 / STEP));
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
const skip = Math.round(0.03 / STEP);
let worst = 0;
let sum = 0;
for (let i = skip; i < ref.length; i++) {
  const d = Math.abs(live[best.lag + i] - ref[i]);
  worst = Math.max(worst, d);
  sum += d;
}
const top = Math.max(...exp.slice(skip, Math.round(0.4 / STEP)));
/** Per hit (every beat at 120 BPM: 500 ms), how deep it dips, how soon it's within 1 dB of that, how long it stays there, and when it's back within 0.5 dB. */
const dips = (env, from0) =>
  Array.from({ length: 6 }, (_, h) => {
    const from = from0 + Math.round((h * 0.5) / STEP);
    const seg = env.slice(from, from + Math.round(0.3 / STEP));
    const low = Math.min(...seg);
    const reach = seg.findIndex((v) => v <= low + 1);
    const held = seg.filter((v) => v <= low + 1).length;
    const back = seg.findIndex((v, i) => i > reach && v >= top - 0.5);
    return { hit: ['kick', 'snare', 'kick', 'clap'][h % 4], depthDb: +(low - top).toFixed(1), downMs: reach * STEP * 1000, heldMs: held * STEP * 1000, backMs: back * STEP * 1000 };
  });
return { pump, exportVsLive: { worstDb: +worst.toFixed(2), meanDb: +(sum / (ref.length - skip)).toFixed(3) }, exportDips: dips(exp, 0), liveDips: dips(live, best.lag) };
