/**
 * Fledge Synth's oscillator pictures, drawn by the synth's own code: a copy of its WebAssembly
 * on the main thread (the playing one is on the audio thread) answers fledge_wave, one cycle of
 * a table at a position under a warp. The same copy draws a track's user table (handed to it with
 * setPictureTable), turns a parameter's value into the 0..1 the plugin takes (fledgeNormal) and
 * works out a whole sound's values from a preset and a few settings by name (fledgeValues).
 */
import { builtinModule } from './builtinHost';
import type { PluginFamily } from './pluginTypes';
import { USER_CYCLE } from './userTable';

export type FledgeWave = (table: number, pos: number, warp: number, amount: number) => Float32Array;

interface FledgeExports {
  memory: WebAssembly.Memory;
  fledge_wave?: (t: number, p: number, w: number, a: number) => number;
  fledge_picture_buffer?: (frames: number) => number;
  fledge_picture_set?: (frames: number) => number;
  fledge_normal?: (i: number, v: number) => number;
  bb_create: (index: number, sampleRate: number) => number;
  bb_destroy: (h: number) => void;
  bb_params: (h: number) => number;
  bb_param_name: (h: number, i: number) => number;
  bb_get: (h: number, i: number) => number;
  bb_set: (h: number, i: number, v: number) => void;
  bb_set_program: (h: number, i: number) => void;
}

let copy: Promise<FledgeExports | null> | null = null;
function exportsOf(family: PluginFamily): Promise<FledgeExports | null> {
  copy ??= builtinModule(family)
    .then((m) => WebAssembly.instantiate(m, {}))
    .then((inst) => inst.exports as unknown as FledgeExports)
    .catch(() => {
      copy = null;
      return null;
    });
  return copy;
}

/** The drawing function (null if this build's synth can't draw). */
export async function fledgeWave(family: PluginFamily): Promise<FledgeWave | null> {
  const e = await exportsOf(family);
  const wave = e?.fledge_wave;
  if (!e || !wave) return null;
  return (t: number, p: number, w: number, a: number) => {
    // (The call first: making a table can grow the memory, which replaces its buffer)
    const at = wave(t, p, w, a);
    return new Float32Array(e.memory.buffer, at, 256).slice();
  };
}

/** The user table the pictures draw (cycles of USER_CYCLE samples; null: none). */
export async function setPictureTable(family: PluginFamily, cycles: Float32Array | null): Promise<void> {
  const e = await exportsOf(family);
  if (!e?.fledge_picture_set || !e.fledge_picture_buffer) return;
  const frames = cycles ? Math.floor(cycles.length / USER_CYCLE) : 0;
  if (cycles && frames > 0) {
    const ptr = e.fledge_picture_buffer(frames);
    if (!ptr) return;
    new Float32Array(e.memory.buffer, ptr, frames * USER_CYCLE).set(cycles.subarray(0, frames * USER_CYCLE));
  }
  e.fledge_picture_set(frames);
}

/** Parameter `index`'s own value (Hz, dB, a choice's number...) as the 0..1 the plugin takes, or null. */
export async function fledgeNormal(family: PluginFamily, index: number, value: number): Promise<number | null> {
  const e = await exportsOf(family);
  return e?.fledge_normal ? e.fledge_normal(index, value) : null;
}

/**
 * Every value (0..1, in the plugin's order) of preset `program` with `sets` (parameter name: its
 * own value, as Hz, dB or a choice's number) changed, as a saved sound holds them. Null if this
 * build's synth can't say.
 */
export async function fledgeValues(family: PluginFamily, program: number, sets: Record<string, number>): Promise<number[] | null> {
  const e = await exportsOf(family);
  if (!e?.fledge_normal || !e.bb_create) return null;
  const h = e.bb_create(0, 48000);
  if (!h) return null;
  try {
    e.bb_set_program(h, program);
    const n = e.bb_params(h);
    const text = (ptr: number) => {
      const m = new Uint8Array(e.memory.buffer);
      let end = ptr;
      while (m[end]) end++;
      return new TextDecoder().decode(m.subarray(ptr, end));
    };
    const index = new Map<string, number>();
    for (let i = 0; i < n; i++) index.set(text(e.bb_param_name(h, i)), i);
    for (const [name, v] of Object.entries(sets)) {
      const i = index.get(name);
      if (i !== undefined) e.bb_set(h, i, e.fledge_normal(i, v));
    }
    return Array.from({ length: n }, (_, i) => e.bb_get(h, i));
  } finally {
    e.bb_destroy(h);
  }
}
