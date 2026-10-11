// Shared helpers, prepended to page scripts by run.cjs.
const toneUrl = (await (await fetch('/src/audio/engine.ts')).text()).match(/from "(\/node_modules\/\.vite\/deps\/tone\.js[^"]*)"/)[1];
const Tone = await import(toneUrl);
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
/** Magnitude spectrum (power) of x (Hann-windowed Welch average, size n). */
function spectrum(x, n = 4096) {
  const acc = new Float64Array(n / 2);
  let frames = 0;
  for (let s = 0; s + n <= x.length; s += n / 2) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    fft(re, im);
    for (let k = 0; k < n / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  for (let k = 0; k < n / 2; k++) acc[k] /= Math.max(1, frames);
  return acc;
}
const db = (v) => 10 * Math.log10(Math.max(v, 1e-30));
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
/** Band power between f1 and f2 Hz. */
function band(spec, sr, n, f1, f2) {
  let s = 0;
  for (let k = Math.ceil((f1 * n) / sr); k <= Math.floor((f2 * n) / sr) && k < spec.length; k++) s += spec[k];
  return s;
}
function centroid(spec, sr, n) {
  let a = 0, b = 0;
  for (let k = 1; k < spec.length; k++) { const f = (k * sr) / n; a += f * spec[k]; b += spec[k]; }
  return a / b;
}
const mkTrack = (id, key, fx, extra = {}) => ({ id, name: id, color: '#888', instrumentKey: key, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx, reverbSend: 0, delaySend: 0, ...extra });
let nid = 0;
const mkClip = (id, trackId, startBar, lengthBars, notes) => ({ id, trackId, name: id, startBar, lengthBars, isSelected: false, notes: notes.map((n) => ({ id: 'n' + nid++, velocity: 0.8, duration: '16n', ...n })) });
const MFX = { reverbDecay: 2.4, delayTime: '8n', delayFeedback: 0.3 };
/** Decode a float WAV blob made by encodeChannels (32-bit float, fmt 18 + fact). */
async function wavChannels(blob) {
  const buf = await blob.arrayBuffer();
  const dv = new DataView(buf);
  let off = 12, data = null, ch = 2, bits = 16;
  while (off < buf.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(buf, off, 4)); const size = dv.getUint32(off + 4, true);
    if (id === 'fmt ') { ch = dv.getUint16(off + 10, true); bits = dv.getUint16(off + 22, true); }
    if (id === 'data') { data = [off + 8, size]; break; }
    off += 8 + size + (size & 1);
  }
  const frames = data[1] / (ch * bits / 8);
  const out = Array.from({ length: ch }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    const p = data[0] + (i * ch + c) * (bits / 8);
    out[c][i] = bits === 32 ? dv.getFloat32(p, true) : bits === 16 ? dv.getInt16(p, true) / 32768 : 0;
  }
  return out;
}
/** Stereo stats of two channels: RMS per side (dB), correlation, side/mid ratio (dB). */
function stereoStats(L, R) {
  let ll = 0, rr = 0, lr = 0;
  for (let i = 0; i < L.length; i++) { ll += L[i] * L[i]; rr += R[i] * R[i]; lr += L[i] * R[i]; }
  const n = L.length;
  return { rmsL: r2(db(ll / n)), rmsR: r2(db(rr / n)), corr: Math.round((lr / Math.sqrt(ll * rr + 1e-30)) * 1e4) / 1e4, sideToMid: r2(db((ll + rr - 2 * lr) / (ll + rr + 2 * lr + 1e-30))) };
}
/** A WAV file (16-bit PCM) as a data: URL, from per-channel Float32Arrays. */
function wavDataUrl(channels, sr) {
  const ch = channels.length, frames = channels[0].length, bytes = 44 + frames * ch * 2, dv = new DataView(new ArrayBuffer(bytes));
  const str = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, frames * ch * 2, true);
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) dv.setInt16(44 + (i * ch + c) * 2, Math.max(-32768, Math.min(32767, Math.round(channels[c][i] * 32767))), true);
  let s = ''; const u8 = new Uint8Array(dv.buffer); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(s);
}
