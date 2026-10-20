/**
 * Fledge Synth's oscillator pictures, drawn by the synth's own code: a copy of its WebAssembly
 * on the main thread (the playing one is on the audio thread) answers fledge_wave, one cycle of
 * a table at a position under a warp.
 */
import { builtinModule } from './builtinHost';
import type { PluginFamily } from './pluginTypes';

export type FledgeWave = (table: number, pos: number, warp: number, amount: number) => Float32Array;

let drawer: Promise<FledgeWave | null> | null = null;

/** The drawing function (null if this build's synth can't draw). */
export function fledgeWave(family: PluginFamily): Promise<FledgeWave | null> {
  drawer ??= builtinModule(family)
    .then((m) => WebAssembly.instantiate(m, {}))
    .then((inst) => {
      const e = inst.exports as { memory: WebAssembly.Memory; fledge_wave?: (t: number, p: number, w: number, a: number) => number };
      const wave = e.fledge_wave;
      if (!wave) return null;
      return (t: number, p: number, w: number, a: number) => {
        // (The call first: making a table can grow the memory, which replaces its buffer)
        const at = wave(t, p, w, a);
        return new Float32Array(e.memory.buffer, at, 256).slice();
      };
    })
    .catch(() => {
      drawer = null;
      return null;
    });
  return drawer;
}
