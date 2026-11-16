// A plugin's sidechain, in exports and live (run with run.cjs):
//
//   APP_URL='http://localhost:5200/?studio' node scripts/audio-check/run.cjs scripts/audio-check/sidechain.js
//
// A held 65 Hz sub has a Fledge Compressor listening to a drum track (a kick on every beat) that
// is turned right down, so only the sub is heard. Measured: how far the sub dips on each kick in
// the mix; that it doesn't with no sidechain, or with the drums muted; that a stem of the sub
// alone and a freeze of it dip the same; that a mix rendered in parts is the mix rendered in one
// piece; and how close live playback comes to the export.
// arg.live === false skips the live part; arg.preset picks the compressor's preset (default 1).
const T = await import('/src/store/timelineTypes.ts');
const ex = await import('/src/audio/exportWav.ts');
const { useTimelineStore } = await import('/src/store/timelineStore.ts');
const { liveMix } = await import('/src/audio/engine.ts');
const sr = 44100;
const bpm = 120;
const comp = (sidechain) => ({ id: 'comp', url: 'builtin:fledge-compressor/Fledge Compressor', name: 'Fledge Compressor', state: { builtin: 1, program: arg.preset ?? 1, values: [] }, ...(sidechain ? { sidechain } : {}) });
const drums = (extra = {}) => mkTrack('drums', 'designedKit', T.defaultTrackFx(), { volume: -60, ...extra });
const sub = (sidechain) => mkTrack('sub', 'subBass', T.defaultTrackFx(), { pluginFx: [comp(sidechain)] });
const keys = mkTrack('keys', 'piano', T.defaultTrackFx(), { volume: -60 });
const hits = [];
for (let b = 0; b < 4; b++) for (let q = 0; q < 4; q++) hits.push({ note: 'C1', startOffset: b + q / 4 });
const chords = [];
for (let b = 0; b < 4; b++) chords.push({ note: 'C4', startOffset: b, duration: '2n' }, { note: 'G4', startOffset: b + 0.5, duration: '2n' });
const clips = [mkClip('d', 'drums', 1, 4, hits), mkClip('s', 'sub', 1, 4, [{ note: 'C2', startOffset: 0, duration: '4m', velocity: 0.9 }]), mkClip('k', 'keys', 1, 4, chords)];

/** The level in 0.5 ms steps, dB (over one cycle of the sub). */
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
/** How far the level dips after each of the first six kicks (every 500 ms), against its highest in the first two seconds. */
const dips = (env, from0 = 0) => {
  const top = Math.max(...env.slice(from0 + Math.round(0.05 / STEP), from0 + Math.round(2 / STEP)));
  return Array.from({ length: 6 }, (_, h) => {
    const from = from0 + Math.round((h * 0.5) / STEP);
    return +(Math.min(...env.slice(from, from + Math.round(0.3 / STEP))) - top).toFixed(1);
  });
};
const base = { clips, bpm, swing: 0, masterFx: T.DEFAULT_MASTER_FX, startBar: 1, endBar: 5, ending: 'exact', sampleRate: sr, bypassMaster: true };
const render = async (tracks, more = {}) => (await ex.renderArrangement({ ...base, tracks, ...more })).getChannelData(0);
const worstDiff = (a, b) => {
  let w = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) w = Math.max(w, Math.abs(a[i] - b[i]));
  return w === 0 ? 'same' : +(20 * Math.log10(w)).toFixed(1);
};

const keyed = [drums(), sub('drums'), keys];
const mix = await render(keyed, { threads: 1 });
const exp = envelope(mix, sr);
const out = { preset: arg.preset ?? 1 };
out.mixDips = dips(exp);
out.noSidechainDips = dips(envelope(await render([drums(), sub(null), keys], { threads: 1 }), sr));
out.drumsMutedDips = dips(envelope(await render([drums({ isMuted: true }), sub('drums'), keys], { threads: 1 }), sr));
out.again = worstDiff(mix, await render(keyed, { threads: 1 }));
out.inParts = worstDiff(mix, await render(keyed, { threads: 4 }));
// A stem of the sub alone: the drums are built for the compressor only
const stemSound = new Map();
const stems = await ex.renderStems({ ...base, tracks: keyed }, 24, undefined, async (channels) => {
  const blob = new Blob([]);
  stemSound.set(blob, channels[0].slice());
  return blob;
});
const stem = stems.find((s) => s.track.id === 'sub');
out.stemNames = stems.map((s) => s.track.id);
out.stemDips = stem ? dips(envelope(stemSound.get(stem.wav), sr)) : null;
const frozen = await ex.renderForFreeze({ ...base, tracks: keyed }, keyed[1]);
out.freezeDips = dips(envelope(frozen.channels[0], frozen.sampleRate));
if (arg.live === false) return out;

// Live: the song in the store, played, the master bus recorded
const { initAudio } = await import('/src/audio/engine.ts');
await initAudio();
const unhook = (await import('/src/store/timelineStore.ts')).connectTimelineToAudio();
useTimelineStore.getState().loadProject({ name: 'Sidechain check', bpm, swing: 0, tempoPoints: [], tracks: keyed, clips, markers: [], masterFx: T.DEFAULT_MASTER_FX, master: T.defaultMasterSettings(), loopRegion: { inBar: 1, outBar: 5, enabled: false } });
const { createWorkletNode, loadWorklet } = await import('/src/audio/worklets.ts');
const ctx = liveMix.bus.context;
const SRC = `class Rec extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = () => (this.on = false); } process(inputs) { const x = inputs[0][0]; if (x) this.port.postMessage(x.slice()); return this.on; } } registerProcessor('sidechain-check-rec', Rec);`;
await loadWorklet(ctx, 'sidechain-check-rec', SRC);
const rec = createWorkletNode(ctx, 'sidechain-check-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
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
// Line them up: the live envelope's best match for the export's over its first three seconds
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
let worst = 0, sum = 0;
for (let i = skip; i < ref.length; i++) {
  const d = Math.abs(live[best.lag + i] - ref[i]);
  worst = Math.max(worst, d);
  sum += d;
}
out.liveDips = dips(live, best.lag);
out.exportVsLive = { worstDb: +worst.toFixed(2), meanDb: +(sum / (ref.length - skip)).toFixed(3) };
return out;
