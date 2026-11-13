/**
 * The Glide Pad's own room (presets/glidePad.ts): decaying noise, a different one in each ear (so
 * it spreads the pad wide), each ear's energy 1, made the same from a fixed seed every time, at a
 * context's own rate (an export's room is the very one heard live). Pure, unit tested.
 */

/** The room's length (seconds) and how fast it dies away (its level falls by e every this many seconds) */
export const ROOM_SECONDS = 3.5;
export const ROOM_FALL = 0.9;

export function darkRoomChannels(rate: number): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.round(ROOM_SECONDS * rate);
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(n), new Float32Array(n)];
  out.forEach((x, c) => {
    // (a fixed-seed generator: the same room every time, another in each ear)
    let seed = (0x9e3779b9 ^ Math.imul(c + 1, 0x85ebca6b)) >>> 0;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const v = (seed / 4294967296) * 2 - 1;
      // (a 5 ms fade in: no click at its start)
      x[i] = v * Math.exp(-i / rate / ROOM_FALL) * Math.min(1, i / (0.005 * rate));
      energy += x[i] * x[i];
    }
    const k = 1 / Math.sqrt(energy);
    for (let i = 0; i < n; i++) x[i] *= k;
  });
  return out;
}
