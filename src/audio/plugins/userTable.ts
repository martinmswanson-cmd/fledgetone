/**
 * Fledge Synth's user table: a sound made into a wavetable. Single cycles are cut from the sound
 * (one cycle long at the pitch found in it, or a length chosen), N of them spread across it, each
 * resampled to 2048 samples, joined end to start and freed of DC; the synth then band-limits them
 * into its octave levels and levels them (engine/fledge-synth/src/tables.rs, user_table). The
 * table travels in the synth's saved settings as 16-bit samples, deflated, in base64 (a share
 * link carries a lighter copy: 8 cycles of 256 samples in 8 bits). Plain maths, so Node can
 * unit-test it.
 */

/** Samples per cycle the synth takes in (tables.rs USER_CYCLE) */
export const USER_CYCLE = 2048;
/** The most cycles a table may have (tables.rs USER_FRAMES_MAX) */
export const USER_FRAMES_MAX = 64;
/** "User table" in the oscillators' table menu (params.rs USER_TABLE) */
export const USER_TABLE_INDEX = 16;
/** The table choice's room to grow (fledgeLayout.ts CAP.table): its stored value is index / (cap - 1) */
export const TABLE_CAP = 64;
/** How many cycles a table is made of, as offered */
export const TABLE_FRAME_COUNTS = [8, 16, 32] as const;
/** Cycle lengths that can be chosen instead of the pitch found (samples of the sound) */
export const FIXED_CYCLES = [512, 1024, 2048] as const;
/** The longest a table's text may be (64 cycles of 2048 16-bit samples, uncompressible, in base64) */
const MAX_DATA = Math.ceil((USER_FRAMES_MAX * USER_CYCLE * 2 * 4) / 3) + 64;
/** A share link's copy: this many cycles at most, of this many samples, in 8 bits */
export const LINK_FRAMES = 8;
export const LINK_CYCLE = 256;

/** A user table as the synth's settings keep it. */
export interface UserTable {
  v: 1;
  /** What it was made from, for display */
  name: string;
  /** How many cycles */
  frames: number;
  /** Samples in each (a power of two, 64 to 2048) */
  size: number;
  /** Stored as 16-bit or (in a share link) 8-bit samples */
  bits: 8 | 16;
  /** The samples, cycle after cycle, little-endian, deflated, in base64 */
  data: string;
}

/** How the table is cut from the sound: one cycle at its pitch, or this many samples a cycle. */
export type CycleChoice = 'pitch' | number;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** A table from a saved file or link, tidied, or undefined if it isn't one (it's then left out). */
export function normalizeUserTable(raw: unknown): UserTable | undefined {
  if (!isObj(raw) || raw.v !== 1) return undefined;
  const frames = raw.frames;
  const size = raw.size;
  if (typeof frames !== 'number' || !Number.isInteger(frames) || frames < 1 || frames > USER_FRAMES_MAX) return undefined;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 64 || size > USER_CYCLE || (size & (size - 1)) !== 0) return undefined;
  if (raw.bits !== 8 && raw.bits !== 16) return undefined;
  if (typeof raw.data !== 'string' || !raw.data || raw.data.length > MAX_DATA || !/^[A-Za-z0-9+/]+=*$/.test(raw.data)) return undefined;
  return { v: 1, name: typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 60) : 'User table', frames, size, bits: raw.bits, data: raw.data };
}

// --- An FFT, for resampling cycles without aliasing ---

function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * One cycle (a power of two long) as `size` samples (a power of two), keeping only the harmonics
 * both can hold: no aliasing going down, nothing made up going up.
 */
export function resampleCycle(cycle: ArrayLike<number>, size: number): Float32Array {
  const n = cycle.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = cycle[i];
  fft(re, im, false);
  const keep = Math.min(n, size) / 2;
  const ore = new Float64Array(size);
  const oim = new Float64Array(size);
  // (The bin at half the shorter length is left out: it has no phase of its own)
  for (let h = 1; h < keep; h++) {
    ore[h] = re[h];
    oim[h] = im[h];
    ore[size - h] = re[n - h];
    oim[size - h] = im[n - h];
  }
  fft(ore, oim, true);
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = ore[i] / n;
  return out;
}

// --- Cutting cycles from a sound ---

/** The sound as one channel. */
export function monoOf(channels: readonly Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  const out = new Float32Array(length);
  for (const ch of channels) for (let i = 0; i < length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/**
 * The sound's period in samples (a fraction of one: the pitch is sampleRate / period), found in
 * `[from, to)` by the cumulative mean normalised difference (as pitch trackers do), between 40 Hz
 * and 1.5 kHz. Null when nothing there repeats clearly (noise, a dense chord).
 */
export function detectPeriod(mono: Float32Array, sampleRate: number, from = 0, to = mono.length): number | null {
  const minLag = Math.max(2, Math.floor(sampleRate / 1500));
  const maxLag = Math.ceil(sampleRate / 40);
  const window = Math.min(Math.max(2 * maxLag, Math.round(sampleRate * 0.06)), Math.floor((to - from) / 2));
  if (window < maxLag) return null;
  // The loudest stretch of the part: where the tone is
  const span = to - from - 2 * window;
  let start = from;
  if (span > 0) {
    let best = -1;
    for (let k = 0; k <= 8; k++) {
      const at = from + Math.round((span * k) / 8);
      let e = 0;
      for (let i = at; i < at + window; i += 4) e += mono[i] * mono[i];
      if (e > best) {
        best = e;
        start = at;
      }
    }
  }
  const d = new Float64Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let sum = 0;
    for (let i = start; i < start + window; i++) {
      const diff = mono[i] - mono[i + lag];
      sum += diff * diff;
    }
    d[lag] = sum;
  }
  // Cumulative mean normalised
  const c = new Float64Array(maxLag + 2);
  c[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    running += d[lag];
    c[lag] = running > 0 ? (d[lag] * lag) / running : 1;
  }
  let lag = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (c[t] < 0.2) {
      while (t + 1 <= maxLag && c[t + 1] < c[t]) t++;
      lag = t;
      break;
    }
  }
  if (lag < 0) {
    // No dip under the threshold: the deepest one, if it's deep enough
    let best = Infinity;
    for (let t = minLag; t <= maxLag; t++) if (c[t] < best) {
      best = c[t];
      lag = t;
    }
    if (best > 0.35) return null;
  }
  // Between samples: a parabola through the dip
  const a = c[lag - 1];
  const b = c[lag];
  const cc = c[lag + 1];
  const den = a - 2 * b + cc;
  const shift = den > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - cc)) / den)) : 0;
  return lag + shift;
}

/** Cubic (Catmull-Rom) read of `x` at the fractional index `t`. */
function cubicAt(x: Float32Array, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const at = (k: number) => x[Math.max(0, Math.min(x.length - 1, k))];
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/** `period` samples of `mono` from `start`, as USER_CYCLE samples joined end to start, without DC. */
function cutCycle(mono: Float32Array, start: number, period: number): Float32Array {
  const out = new Float32Array(USER_CYCLE);
  const step = period / USER_CYCLE;
  for (let i = 0; i < USER_CYCLE; i++) out[i] = cubicAt(mono, start + i * step);
  // The cycle's end leads into its start: any step between them taken out as a straight ramp
  const gap = cubicAt(mono, start + period) - out[0];
  let mean = 0;
  for (let i = 0; i < USER_CYCLE; i++) {
    out[i] -= (gap * i) / USER_CYCLE;
    mean += out[i];
  }
  mean /= USER_CYCLE;
  for (let i = 0; i < USER_CYCLE; i++) out[i] -= mean;
  return out;
}

const correlation = (a: Float32Array, b: Float32Array) => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 4) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
};

export interface TableFromSound {
  /** `frames` cycles of USER_CYCLE samples, one after another */
  cycles: Float32Array;
  frames: number;
  /** The cycle length used, in samples of the sound */
  period: number;
  /** The pitch it was cut at (sampleRate / period) */
  hz: number;
  /** The pitch was found in the sound (else the length chosen, or a fallback, was used) */
  found: boolean;
}

/**
 * Cut `frames` single cycles from `[from, to)` of a sound (seconds; all of it by default), spread
 * evenly from its start to its end, so the table's Position moves through the sound as it changes.
 * `cycle`: one cycle at the pitch found in it ('pitch', falling back to 2048 samples when none is
 * found), or this many samples. Each cycle starts on a rising zero crossing, the one that lines up
 * best with the cycle before (so neighbouring frames blend without cancelling), and is levelled to
 * the same peak. Null when the part is too short or silent.
 */
export function tableFromSound(channels: readonly Float32Array[], sampleRate: number, opts: { frames: number; cycle: CycleChoice; from?: number; to?: number }): TableFromSound | null {
  const mono = monoOf(channels);
  const from = Math.max(0, Math.floor((opts.from ?? 0) * sampleRate));
  const to = Math.min(mono.length, Math.ceil((opts.to ?? mono.length / sampleRate) * sampleRate));
  const frames = Math.max(1, Math.min(USER_FRAMES_MAX, Math.round(opts.frames)));
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak < 1e-5) return null;
  const detected = opts.cycle === 'pitch' ? detectPeriod(mono, sampleRate, from, to) : null;
  const period = typeof opts.cycle === 'number' ? Math.max(16, opts.cycle) : (detected ?? 2048);
  if (to - from < period * 2) return null;
  const cycles = new Float32Array(frames * USER_CYCLE);
  let last: Float32Array | null = null;
  const first = from + period * 0.5;
  const lastAt = to - period * 1.6;
  for (let f = 0; f < frames; f++) {
    const centre = frames === 1 ? (first + lastAt) / 2 : first + ((lastAt - first) * f) / (frames - 1);
    // Rising zero crossings within half a cycle either side
    const lo = Math.max(from + 1, Math.floor(centre - period / 2));
    const hi = Math.min(to - Math.ceil(period) - 2, Math.ceil(centre + period / 2));
    const starts: number[] = [];
    for (let i = lo; i <= hi; i++) if (mono[i - 1] < 0 && mono[i] >= 0) starts.push(i - 1 + mono[i - 1] / (mono[i - 1] - mono[i]));
    if (!starts.length) starts.push(Math.max(from, Math.min(hi, Math.round(centre))));
    let best: Float32Array | null = null;
    let bestScore = -Infinity;
    for (const s of starts) {
      const c = cutCycle(mono, s, period);
      const score = last ? correlation(c, last) : -Math.abs(s - centre);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // Band-limited to what the synth keeps (no DC, nothing on the Nyquist bin)
    const c = resampleCycle(best!, USER_CYCLE);
    let p = 0;
    for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
    const g = p > 1e-6 ? 0.95 / p : 0;
    for (let i = 0; i < c.length; i++) cycles[f * USER_CYCLE + i] = c[i] * g;
    last = c;
  }
  return { cycles, frames, period, hz: sampleRate / period, found: detected !== null };
}

// --- Packing for the settings ---

const toBase64 = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

async function through(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new Error('too big for a table');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Pack `frames` cycles of USER_CYCLE samples as a UserTable: `size` samples a cycle (resampled
 * without aliasing when fewer) in `bits` bits.
 */
export async function packUserTable(cycles: Float32Array, frames: number, name: string, size = USER_CYCLE, bits: 8 | 16 = 16): Promise<UserTable> {
  const n = Math.max(1, Math.min(USER_FRAMES_MAX, frames));
  const bytes = new Uint8Array(n * size * (bits / 8));
  const view = new DataView(bytes.buffer);
  for (let f = 0; f < n; f++) {
    const cycle = cycles.subarray(f * USER_CYCLE, (f + 1) * USER_CYCLE);
    const at = size === USER_CYCLE ? cycle : resampleCycle(cycle, size);
    for (let i = 0; i < size; i++) {
      const v = Math.max(-1, Math.min(1, at[i] || 0));
      const k = f * size + i;
      if (bits === 16) view.setInt16(k * 2, Math.round(v * 32767), true);
      else view.setInt8(k, Math.round(v * 127));
    }
  }
  const packed = await through(bytes, new CompressionStream('deflate-raw'), bytes.length * 2 + 1024);
  return { v: 1, name: name.slice(0, 60) || 'User table', frames: n, size, bits, data: toBase64(packed) };
}

/** A table's cycles as the synth takes them (frames × USER_CYCLE samples), or null if it can't be read. */
export async function unpackUserTable(table: UserTable): Promise<Float32Array | null> {
  try {
    const want = table.frames * table.size * (table.bits / 8);
    const bytes = await through(fromBase64(table.data), new DecompressionStream('deflate-raw'), want);
    if (bytes.length !== want) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(table.frames * USER_CYCLE);
    const cycle = new Float32Array(table.size);
    for (let f = 0; f < table.frames; f++) {
      for (let i = 0; i < table.size; i++) {
        const k = f * table.size + i;
        cycle[i] = table.bits === 16 ? view.getInt16(k * 2, true) / 32767 : view.getInt8(k) / 127;
      }
      out.set(table.size === USER_CYCLE ? cycle : resampleCycle(cycle, USER_CYCLE), f * USER_CYCLE);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The lighter copy a share link carries: at most LINK_FRAMES cycles (picked evenly, first and last
 * kept), LINK_CYCLE samples each (the lowest 127 harmonics), in 8 bits: about 2 KB of the link
 * instead of ~100 KB. The synth plays it a little duller and grainier than the song it came from.
 * A table already that light comes back as it is.
 */
export async function linkUserTable(table: UserTable): Promise<UserTable | null> {
  if (table.bits === 8 && table.size <= LINK_CYCLE && table.frames <= LINK_FRAMES) return table;
  const cycles = await unpackUserTable(table);
  if (!cycles) return null;
  const n = Math.min(LINK_FRAMES, table.frames);
  const picked = new Float32Array(n * USER_CYCLE);
  for (let k = 0; k < n; k++) {
    const f = n === 1 ? 0 : Math.round((k * (table.frames - 1)) / (n - 1));
    picked.set(cycles.subarray(f * USER_CYCLE, (f + 1) * USER_CYCLE), k * USER_CYCLE);
  }
  return packUserTable(picked, n, table.name, LINK_CYCLE, 8);
}

/** How big a table is in a saved song, in kB (for the panel). */
export const userTableKb = (table: UserTable): number => Math.round((table.data.length * 3) / 4 / 1024);
