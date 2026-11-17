// A recorded room on a track's Reverb insert, in exports and live (run with run.cjs):
//
//   APP_URL='http://localhost:5200/?studio' node scripts/audio-check/run.cjs scripts/audio-check/reverb-room.js
//
// The "room" is a made-up recording that can be told apart from any designed room: a click, and
// two more 150 and 300 ms later, each half as loud. A short drum hit plays through a Reverb insert
// set to it (all wet). Measured: where the hits come out in an export (the hit, then 150 and
// 300 ms later, 6 dB down each time); that the designed room gives nothing of the kind; that the
// export is the same twice; a freeze of the track; and the same hits live.
// arg.live === false skips the live part.
const T = await import('/src/store/timelineTypes.ts');
const ex = await import('/src/audio/exportWav.ts');
const lib = await import('/src/audio/soundLibrary.ts');
const { useTimelineStore } = await import('/src/store/timelineStore.ts');
const { liveMix } = await import('/src/audio/engine.ts');
const sr = 44100;
const bpm = 120;

// The recording: a WAV file of three clicks, imported as any room recording is
const n = Math.round(0.5 * sr);
const pcm = new Int16Array(n);
for (const [ms, level] of [[0, 1], [150, 0.5], [300, 0.25]]) pcm[Math.round((ms / 1000) * sr)] = Math.round(level * 30000);
const wav = new DataView(new ArrayBuffer(44 + n * 2));
const text = (at, s) => [...s].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
text(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); text(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
wav.setUint32(24, sr, true); wav.setUint32(28, sr * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); text(36, 'data'); wav.setUint32(40, n * 2, true);
pcm.forEach((v, i) => wav.setInt16(44 + i * 2, v, true));
const meta = await lib.importSoundFile(new File([wav.buffer], 'three clicks.wav', { type: 'audio/wav' }), 'three clicks.wav');

const reverb = (room) => ({ on: true, decay: 1, preDelay: 0, tone: 20000, mix: 1, ...(room ? { room } : {}) });
const drums = (room) => mkTrack('drums', 'designedKit', { ...T.defaultTrackFx(), reverb: reverb(room) });
const clips = [mkClip('d', 'drums', 1, 1, [{ note: 'F#1', startOffset: 0 }])];
const base = { clips, bpm, swing: 0, masterFx: T.DEFAULT_MASTER_FX, startBar: 1, endBar: 2, ending: 'exact', sampleRate: sr, bypassMaster: true };
const render = async (room) => (await ex.renderArrangement({ ...base, tracks: [drums(room)], threads: 1 })).getChannelData(0);
/** The loudest moment of each 10 ms, dB */
const env = (x, rate) => {
  const step = Math.round(rate * 0.01);
  const out = [];
  for (let i = 0; i + step <= x.length; i += step) {
    let p = 0;
    for (let k = 0; k < step; k++) p = Math.max(p, Math.abs(x[i + k]));
    out.push(20 * Math.log10(p + 1e-9));
  }
  return out;
};
/** The hit's level at its start and 150 and 300 ms later, against the first (dB), and the level in between (100 ms on) */
const hits = (e, from = 0) => {
  const at = (ms) => Math.max(e[from + Math.round(ms / 10) - 1] ?? -180, e[from + Math.round(ms / 10)] ?? -180, e[from + Math.round(ms / 10) + 1] ?? -180);
  const first = at(0);
  return { second: +(at(150) - first).toFixed(1), third: +(at(300) - first).toFixed(1), between: +((e[from + 10] ?? -180) - first).toFixed(1), level: +first.toFixed(1) };
};
const recorded = await render(meta.id);
const out = { soundSeconds: meta.seconds };
out.recorded = hits(env(recorded, sr));
out.designed = hits(env(await render(null), sr));
const again = await render(meta.id);
let worst = 0;
for (let i = 0; i < recorded.length; i++) worst = Math.max(worst, Math.abs(recorded[i] - again[i]));
out.again = worst === 0 ? 'same' : +(20 * Math.log10(worst)).toFixed(1);
const frozen = await ex.renderForFreeze({ ...base, tracks: [drums(meta.id)] }, drums(meta.id));
out.freeze = hits(env(frozen.channels[0], frozen.sampleRate));
if (arg.live === false) return out;

const { initAudio } = await import('/src/audio/engine.ts');
await initAudio();
const unhook = (await import('/src/store/timelineStore.ts')).connectTimelineToAudio();
useTimelineStore.getState().loadProject({ name: 'Reverb room check', bpm, swing: 0, tempoPoints: [], tracks: [drums(meta.id)], clips, markers: [], masterFx: T.DEFAULT_MASTER_FX, master: T.defaultMasterSettings(), loopRegion: { inBar: 1, outBar: 5, enabled: false } });
const { createWorkletNode, loadWorklet } = await import('/src/audio/worklets.ts');
const ctx = liveMix.bus.context;
const SRC = `class Rec extends AudioWorkletProcessor { constructor() { super(); this.on = true; this.port.onmessage = () => (this.on = false); } process(inputs) { const x = inputs[0][0]; if (x) this.port.postMessage(x.slice()); return this.on; } } registerProcessor('room-check-rec', Rec);`;
await loadWorklet(ctx, 'room-check-rec', SRC);
const rec = createWorkletNode(ctx, 'room-check-rec', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
const got = [];
rec.port.onmessage = (e) => got.push(e.data);
Tone.connect(liveMix.bus, rec);
await new Promise((r) => setTimeout(r, 2500));
await useTimelineStore.getState().play();
await new Promise((r) => setTimeout(r, 2500));
useTimelineStore.getState().stop();
unhook();
rec.port.postMessage('stop');
Tone.disconnect(liveMix.bus, rec);
const all = new Float32Array(got.reduce((s, b) => s + b.length, 0));
let at = 0;
for (const b of got) { all.set(b, at); at += b.length; }
const live = env(all, ctx.sampleRate);
// The hit is the first moment within 20 dB of the loudest
const top = Math.max(...live);
out.live = hits(live, live.findIndex((v) => v > top - 20));
return out;
