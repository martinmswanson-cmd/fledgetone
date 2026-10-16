// A synthesised voice for checking the vocal tools (tests and demo renders): a glottal pulse train
// with a natural spectral tilt, through vowel formants, with consonant noise (S's, T's, K's),
// syllable envelopes, accents and breaths. Seeded, so it's the same every run. Two styles:
// - 'rap': spoken rhythm on 16ths at 140 BPM, a male voice around 130 Hz with spoken inflections
//   and loud accents (peaky, for the compressors), with bright S's (for the de-essers);
// - 'sung': a melodic hook in A minor, sung a little off the notes (up to 35 cents), with slides
//   between notes and vibrato on long ones (for the hard tune).

const VOWELS = {
  a: [[730, 90], [1090, 110], [2440, 160], [3400, 250], [4500, 350]],
  e: [[530, 70], [1840, 100], [2480, 160], [3500, 250], [4500, 350]],
  i: [[300, 60], [2290, 100], [3010, 160], [3700, 250], [4600, 350]],
  o: [[570, 70], [840, 90], [2410, 160], [3400, 250], [4500, 350]],
  u: [[320, 60], [900, 90], [2240, 160], [3300, 250], [4400, 350]],
};
const FORMANT_GAINS = [1, 0.8, 1.6, 1.4, 1.2];

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A two-pole resonator's coefficients. */
function resonator(f, bw, sr) {
  const r = Math.exp((-Math.PI * bw) / sr);
  return { a1: 2 * r * Math.cos((2 * Math.PI * f) / sr), a2: -r * r, g: (1 - r) * 2 };
}

/**
 * The voice: { samples (mono Float32Array), sampleRate, notes: [{start, end, midi}] for sung }.
 * `style` 'rap' or 'sung'; `seconds` (rap: 4 bars at 140 BPM = 6.86 s).
 */
export function testVoice({ style = 'rap', sampleRate = 44100, seed = 7 } = {}) {
  const random = rng(seed);
  const bpm = style === 'rap' ? 140 : 90;
  const sixteenth = 60 / bpm / 4;
  // The syllables: [start (s), length (s), vowel, consonant, accent, pitch (Hz)]
  const syl = [];
  if (style === 'rap') {
    // 4 bars of 16ths, with rests; a phrase per bar ending lower
    for (let bar = 0; bar < 4; bar++) {
      const pattern = [1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0];
      for (let s = 0; s < 16; s++) {
        if (!pattern[(s + bar * 3) % 16] || (s >= 14)) continue;
        const start = (bar * 16 + s) * sixteenth;
        const len = sixteenth * (0.75 + 0.2 * random());
        const vowel = 'aeiou'[Math.floor(random() * 5)];
        const cons = ['s', 't', 'k', '', '', 'sh'][Math.floor(random() * 6)];
        const accent = s % 4 === 0 ? 1 : 0.45 + 0.25 * random();
        // Spoken inflection: up on accents, falling through the phrase
        const semis = 2.5 * accent - (s / 16) * 4 + (random() - 0.5) * 2;
        syl.push({ start, len, vowel, cons, accent, hz: 130 * 2 ** (semis / 12), glide: -1.5 });
      }
    }
  } else {
    // A hook: A minor notes, held, each sung off by up to 35 cents, sliding in from the last
    const beat = 60 / bpm;
    const tune = [
      [69, 1], [72, 0.5], [71, 0.5], [69, 1], [67, 1],
      [64, 1.5], [67, 0.5], [69, 2],
      [72, 1], [74, 0.5], [72, 0.5], [71, 1], [69, 1],
      [67, 1], [69, 3],
    ];
    let t = 0.1;
    for (const [midi, beats] of tune) {
      const off = (random() - 0.5) * 0.7;
      syl.push({ start: t, len: beats * beat * 0.92, vowel: 'aeoiu'[Math.floor(random() * 5)], cons: random() < 0.3 ? 's' : '', accent: 0.8 + 0.2 * random(), hz: 440 * 2 ** ((midi - 69 + off - 12) / 12), midi: midi - 12, glide: 0, vibrato: beats >= 1 });
      t += beats * beat;
    }
  }
  const total = (style === 'rap' ? 64 * sixteenth : syl[syl.length - 1].start + syl[syl.length - 1].len) + 0.4;
  const n = Math.round(total * sampleRate);
  const out = new Float32Array(n);
  let phase = 0;
  let lastFlow = 0;
  let prevHz = syl[0].hz;
  const state = [0, 0, 0, 0, 0].map(() => ({ y1: 0, y2: 0 }));
  for (const sy of syl) {
    const a = Math.round(sy.start * sampleRate);
    const b = Math.min(n, Math.round((sy.start + sy.len) * sampleRate));
    const consLen = sy.cons === 's' || sy.cons === 'sh' ? 0.07 : sy.cons ? 0.025 : 0;
    const voicedFrom = a + Math.round(consLen * sampleRate);
    // Consonant: filtered noise before the vowel
    if (consLen) {
      const centre = sy.cons === 's' ? 7000 : sy.cons === 'sh' ? 3500 : sy.cons === 't' ? 4500 : 1800;
      const rz = resonator(centre, centre * 0.5, sampleRate);
      let y1 = 0, y2 = 0;
      for (let i = a; i < voicedFrom && i < n; i++) {
        const k = (i - a) / (voicedFrom - a);
        const env = sy.cons === 's' || sy.cons === 'sh' ? Math.sin(Math.PI * k) : Math.exp(-k * 6);
        const w = random() * 2 - 1;
        const y = rz.g * w + rz.a1 * y1 + rz.a2 * y2;
        y2 = y1;
        y1 = y;
        out[i] += y * env * (sy.cons === 's' ? 1.1 : 0.5) * sy.accent;
      }
    }
    const coefs = VOWELS[sy.vowel].map(([f, bw]) => resonator(f, bw, sampleRate));
    const len = b - voicedFrom;
    for (let i = voicedFrom; i < b; i++) {
      const k = (i - voicedFrom) / Math.max(1, len);
      const tSec = (i - voicedFrom) / sampleRate;
      // Pitch: slide in from the last note over 60 ms, a spoken fall, vibrato after 250 ms on sung notes
      const slide = Math.min(1, tSec / 0.06);
      let hz = prevHz * (1 - slide) + sy.hz * slide;
      hz *= 2 ** ((sy.glide * k) / 12);
      if (sy.vibrato && tSec > 0.25) hz *= 2 ** ((0.35 * Math.sin(2 * Math.PI * 5.5 * tSec) * Math.min(1, (tSec - 0.25) / 0.3)) / 12);
      hz *= 1 + 0.004 * Math.sin(2 * Math.PI * 3.1 * (i / sampleRate)); // jitter
      phase += hz / sampleRate;
      if (phase >= 1) phase -= 1;
      // Glottal flow (Rosenberg): opens over 40% of the cycle, closes sharply over 12%, then shut.
      // What the mouth radiates is its derivative (about -6 dB per octave, as a voice), plus breath.
      const g = phase < 0.4 ? 0.5 * (1 - Math.cos((Math.PI * phase) / 0.4)) : phase < 0.52 ? Math.cos((Math.PI / 2) * ((phase - 0.4) / 0.12)) : 0;
      const src = (g - lastFlow) * (sampleRate / hz) * 0.15 + 0.02 * (random() * 2 - 1);
      lastFlow = g;
      // Envelope: 15 ms attack, held, 40 ms release
      const atk = Math.min(1, (i - voicedFrom) / (0.015 * sampleRate));
      const rel = Math.min(1, (b - i) / (0.04 * sampleRate));
      const env = atk * rel * sy.accent;
      let y = 0;
      coefs.forEach((c, f) => {
        const s = state[f];
        const v = c.g * src + c.a1 * s.y1 + c.a2 * s.y2;
        s.y2 = s.y1;
        s.y1 = v;
        y += v * FORMANT_GAINS[f];
      });
      out[i] += y * env;
    }
    prevHz = sy.hz;
  }
  // A DC block (the glottal pulse is one-sided), a little breath noise floor, then peak at -6 dBFS
  let x1 = 0, y1 = 0;
  for (let i = 0; i < n; i++) {
    const y = out[i] - x1 + 0.995 * y1;
    x1 = out[i];
    y1 = y;
    out[i] = y + 0.0004 * (random() * 2 - 1);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const scale = 0.5 / peak;
  for (let i = 0; i < n; i++) out[i] *= scale;
  return { samples: out, sampleRate, notes: syl.filter((s) => s.midi !== undefined).map((s) => ({ start: s.start, end: s.start + s.len, midi: s.midi })) };
}

/** A 16-bit mono or stereo WAV file's bytes. */
export function wavBytes(channels, sampleRate) {
  const n = channels[0].length;
  const c = channels.length;
  const buf = new ArrayBuffer(44 + n * c * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * c * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, c, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * c * 2, true);
  v.setUint16(32, c * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * c * 2, true);
  for (let i = 0; i < n; i++) for (let ch = 0; ch < c; ch++) v.setInt16(44 + (i * c + ch) * 2, Math.max(-32768, Math.min(32767, Math.round(channels[ch][i] * 32767))), true);
  return new Uint8Array(buf);
}
