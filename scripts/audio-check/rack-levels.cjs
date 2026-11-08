// Check that a Drum Rack pad plays as loud live as in the export: a one-channel sound at the
// centre, the same panned, and a two-channel sound at the centre.
//
//   npx vite --port 5200                 (in another terminal; restart it after editing src/)
//   node scripts/audio-check/rack-levels.cjs
//
// Each case is a song of one Drum Rack track playing one pad; it is played live in the app (the
// master output taken as it plays) and exported in the same page (as the command line renders it,
// a 32-bit WAV), and the level of each side over the first hit is compared (dB RMS, the two lined
// up by their first sound). The live and exported levels must be within 0.2 dB on both sides. It
// exits with 1 when any case differs. APP_URL overrides http://localhost:5200/. Needs Playwright
// with Chromium.
let playwright;
try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const APP = process.env.APP_URL || 'http://localhost:5200/';
const LIMIT_DB = 0.2;

/** A short decaying tone as a WAV file (one or two channels: the two the same tone, the right a little quieter). */
function toneWav(channels) {
  const sr = 44100, n = sr * 1.5;
  const pcm = Buffer.alloc(n * 2 * channels);
  for (let i = 0; i < n; i++) {
    const v = 12000 * (Math.sin((2 * Math.PI * 220 * i) / sr) + 0.4 * Math.sin((2 * Math.PI * 660 * i) / sr)) * Math.exp((-i / sr) * 0.5);
    for (let c = 0; c < channels; c++) pcm.writeInt16LE(Math.round(v * (c ? 0.7 : 1)), (i * channels + c) * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2 * channels, 28); h.writeUInt16LE(2 * channels, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const bytes = Buffer.concat([h, pcm]);
  // (under its own id, as the app files a sound: a file's sound under another id is moved to its own when opened)
  const id = require('crypto').createHash('sha256').update(bytes).digest('hex').slice(0, 32);
  return { id, name: 'Tone', type: 'audio/wav', size: bytes.length, seconds: 1.5, data: bytes.toString('base64') };
}

function song(sound, pan) {
  const pads = Array.from({ length: 16 }, (_, i) => ({ name: `p${i}`, ...(i === 0 ? { soundId: sound.id } : {}), gain: 0, pan: i === 0 ? pan : 0, pitch: 0, decay: 0, lowpass: 20000, highpass: 20, drive: 0, choke: 0 }));
  return {
    format: 'fledgetone-project', version: 1, name: 'Rack levels', bpm: 120, swing: 0, loopRegion: { inBar: 1, outBar: 5, enabled: false },
    tracks: [{ id: 't1', name: 'Rack', instrumentKey: 'drumRack', volume: -6, pan: 0, reverbSend: 0, delaySend: 0, rack: { pads } }],
    clips: [{ id: 'c1', trackId: 't1', name: 'A', startBar: 1, lengthBars: 2, notes: [{ id: 'n0', note: 'C2', startOffset: 0, duration: '2n', velocity: 0.9 }] }],
    sounds: [sound],
  };
}

const CASES = [
  { name: 'one channel, centre', song: song(toneWav(1), 0) },
  { name: 'one channel, panned right', song: song(toneWav(1), 0.8) },
  { name: 'two channels, centre', song: song(toneWav(2), 0) },
];

// In the page: play `text` live and export it, and give each side's level over its first hit
const RUN = async (text) => {
  const store = await import('/src/store/timelineStore.ts');
  const P = await import('/src/store/project.ts');
  const LT = await import('/src/audio/liveTracks.ts');
  const LC = await import('/src/audio/liveContext.ts');
  const SL = await import('/src/audio/soundLibrary.ts');
  const NN = await import('/src/audio/nativeNodes.ts');
  const R = await import('/src/runtime/render.ts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raw = NN.nativeContextOf(LC.liveContext);
  const sr = raw.sampleRate;
  const p = P.parseProject(JSON.parse(text));
  if (p.sounds?.length) await SL.importEmbeddedSounds(p.sounds);
  const s = store.useTimelineStore;
  s.getState().loadProject(p);
  await LC.liveContext.resume?.();
  await sleep(1000);
  // Once to make the instrument and load its sound, then for real
  await s.getState().togglePlay();
  for (let w = 0; w < 100 && !LT.scheduledInstrument('t1'); w++) await sleep(100);
  s.getState().stop();
  const inst = LT.scheduledInstrument('t1');
  if (inst) await Promise.race([inst.ready, sleep(30000)]);
  await sleep(2000);
  const left = [], right = [];
  const tap = raw.createScriptProcessor(1024, 2, 2);
  tap.onaudioprocess = (ev) => {
    left.push(Float32Array.from(ev.inputBuffer.getChannelData(0)));
    right.push(Float32Array.from(ev.inputBuffer.getChannelData(1)));
  };
  NN.nativeOutputOf(LC.liveDestination).connect(tap);
  tap.connect(raw.destination);
  s.getState().seek(1);
  await sleep(300);
  await s.getState().togglePlay();
  await sleep(2000);
  s.getState().stop();
  await sleep(200);
  tap.disconnect();
  const join = (parts) => {
    const out = new Float32Array(parts.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of parts) { out.set(c, o); o += c.length; }
    return out;
  };
  const live = [join(left), join(right)];
  const result = await R.renderSong(JSON.parse(text), { format: 'wav', bitDepth: 32 });
  const b64 = await R.take(result.files[0].id, 0, result.files[0].bytes);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const decoded = await new OfflineAudioContext(2, 1, sr).decodeAudioData(bytes.buffer);
  const exported = [decoded.getChannelData(0), decoded.getChannelData(1)];
  // Lined up by their first sound, the level from 0.1 to 0.3 s after it on each side
  const first = (sides) => { for (let i = 0; i < sides[0].length; i++) if (Math.abs(sides[0][i]) > 1e-3 || Math.abs(sides[1][i]) > 1e-3) return i; return -1; };
  const db = (x, from) => { let sum = 0; const a = from + Math.round(0.1 * sr), z = from + Math.round(0.3 * sr); for (let i = a; i < z; i++) sum += x[i] * x[i]; return 20 * Math.log10(Math.sqrt(sum / (z - a)) + 1e-12); };
  const fl = first(live), fe = first(exported);
  if (fl < 0 || fe < 0) return { error: `no sound (${fl < 0 ? 'live' : 'export'})` };
  return { live: live.map((x) => db(x, fl)), exported: exported.map((x) => db(x, fe)) };
};

(async () => {
  const browser = await playwright.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  let failed = false;
  try {
    for (const c of CASES) {
      const page = await browser.newPage();
      page.on('pageerror', (e) => console.error('[pageerror]', e.message));
      await page.addInitScript(() => localStorage.setItem('bosBeatbox.welcomeSeen', 'true'));
      await page.goto(APP, { waitUntil: 'load', timeout: 120000 });
      await page.waitForTimeout(1000);
      const r = await page.evaluate(RUN, JSON.stringify(c.song));
      await page.close();
      if (r.error) {
        failed = true;
        console.log(`${c.name}: FAIL ${r.error}`);
        continue;
      }
      const diffs = r.live.map((l, i) => l - r.exported[i]);
      const ok = diffs.every((d) => Math.abs(d) <= LIMIT_DB);
      if (!ok) failed = true;
      const f = (v) => v.toFixed(2);
      console.log(`${c.name}: ${ok ? 'ok' : 'FAIL'}  export L ${f(r.exported[0])} R ${f(r.exported[1])} dB, live L ${f(r.live[0])} R ${f(r.live[1])} dB (live − export ${diffs.map(f).join(' / ')} dB)`);
    }
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
