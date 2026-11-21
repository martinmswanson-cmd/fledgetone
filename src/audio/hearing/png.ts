/**
 * Turns a Raster into the bytes of a PNG file: indexed when it has 256 colours or fewer, else 8-bit RGB;
 * no interlace, filter 0 or 2 on each row, one IDAT chunk. Compression is the platform's own `CompressionStream('deflate')` (zlib format, which is
 * what PNG wants), so it runs the same in Node 18+ and in a browser page, with no dependency.
 */
import type { Raster } from './raster';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One chunk: length, type and body, then the CRC-32 of the type and body. */
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length); const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

async function deflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  // write and read at once: awaiting the write first would stall once the stream's buffer fills
  const written = writer.write(raw as Uint8Array<ArrayBuffer>).then(() => writer.close());
  const packed = new Response(stream.readable).arrayBuffer();
  const [bytes] = await Promise.all([packed, written]);
  return new Uint8Array(bytes);
}

/** The picture's colours in order of first appearance, with each pixel's index; null as soon as a 257th colour shows. */
function indexColours(r: Raster): { palette: number[]; indices: Uint8Array } | null {
  const seen = new Map<number, number>(); const palette: number[] = [];
  const n = r.width * r.height; const indices = new Uint8Array(n); const d = r.data;
  let lastKey = -1; let lastIndex = 0;
  for (let i = 0, k = 0; i < n; i++, k += 3) {
    const key = (d[k] << 16) | (d[k + 1] << 8) | d[k + 2];
    if (key !== lastKey) {
      let at = seen.get(key);
      if (at === undefined) {
        if (seen.size === 256) return null;
        at = seen.size; seen.set(key, at); palette.push(d[k], d[k + 1], d[k + 2]);
      }
      lastKey = key; lastIndex = at;
    }
    indices[i] = lastIndex;
  }
  return { palette, indices };
}

/** Filter each row of `rowBytes` bytes: whichever of filter 0 and filter 2 has the smaller sum of absolute signed bytes. */
function filterRows(pixels: Uint8Array, rowBytes: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (1 + rowBytes)); const up = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
    const above = y > 0 ? pixels.subarray((y - 1) * rowBytes, y * rowBytes) : null;
    let none = 0; let diff = 0;
    for (let i = 0; i < rowBytes; i++) {
      const v = row[i]; const u = (v - (above ? above[i] : 0)) & 255;
      up[i] = u; none += v < 128 ? v : 256 - v; diff += u < 128 ? u : 256 - u;
    }
    const at = y * (1 + rowBytes);
    if (diff < none) { raw[at] = 2; raw.set(up, at + 1); } else raw.set(row, at + 1);
  }
  return raw;
}

/**
 * The PNG file for a picture: 8-bit, no interlace. A picture of 256 colours or fewer is indexed (a
 * palette in order of first appearance, one byte a pixel); any other is RGB. Each row uses filter 0 or
 * filter 2 (up), whichever gives the smaller sum of absolute bytes, since spectrograms repeat down columns.
 */
export async function encodePng(r: Raster): Promise<Uint8Array> {
  const indexed = indexColours(r);
  const raw = indexed ? filterRows(indexed.indices, r.width, r.height) : filterRows(r.data, r.width * 3, r.height);
  const header = new Uint8Array(13); const hv = new DataView(header.buffer);
  hv.setUint32(0, r.width); hv.setUint32(4, r.height); header[8] = 8; header[9] = indexed ? 3 : 2; // 8 bits; colour type 3 (indexed) or 2 (RGB); compression, filter, interlace stay 0
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header)];
  if (indexed) parts.push(chunk('PLTE', Uint8Array.from(indexed.palette)));
  parts.push(chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
