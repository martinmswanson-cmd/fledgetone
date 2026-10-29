/**
 * The one signal a multichannel sound is analysed on (the phase vocoder's phases, the
 * harmonic-percussive split, the hits): the channels added up, each turned the right way up to
 * agree with the loudest one, so a stereo sound whose sides are out of phase (left the negative of
 * right) doesn't cancel to nothing and get treated as silence. And whether any channel sounds in a
 * stretch of samples. Plain arrays, so Node can unit-test it.
 */

/** The channels added up (one channel: itself), each flipped where it runs against the loudest. */
export function analysisMix(input: readonly Float32Array[]): Float32Array {
  if (input.length === 1) return input[0];
  const length = input[0]?.length ?? 0;
  const energy = input.map((ch) => {
    let e = 0;
    for (let i = 0; i < length; i++) e += ch[i] * ch[i];
    return e;
  });
  const loudest = input[energy.indexOf(Math.max(...energy))];
  const mix = new Float32Array(length);
  for (const ch of input) {
    let dot = 0;
    for (let i = 0; i < length; i++) dot += ch[i] * loudest[i];
    const sign = dot < 0 ? -1 : 1;
    for (let i = 0; i < length; i++) mix[i] += sign * ch[i];
  }
  return mix;
}

/** Blocks of `block` samples in which any channel is not silent, as running counts (for quick "any sound from a to b?" checks). */
export function soundingBlocks(input: readonly Float32Array[], block: number): { any: (from: number, to: number) => boolean } {
  const length = input[0]?.length ?? 0;
  const blocks = Math.ceil(length / block);
  const count = new Int32Array(blocks + 1);
  for (let b = 0; b < blocks; b++) {
    let any = 0;
    const end = Math.min(length, (b + 1) * block);
    for (const ch of input) {
      for (let i = b * block; i < end; i++) {
        if (ch[i] !== 0) {
          any = 1;
          break;
        }
      }
      if (any) break;
    }
    count[b + 1] = count[b] + any;
  }
  return {
    any(from, to) {
      const a = Math.max(0, Math.floor(from / block));
      const b = Math.min(blocks, Math.ceil(to / block));
      return b > a && count[b] !== count[a];
    },
  };
}
