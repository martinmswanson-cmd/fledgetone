/**
 * Turns a Raster into the bytes of a PNG file: 8-bit RGB, no interlace, filter 0 on every row, one
 * IDAT chunk. Compression is the platform's own `CompressionStream('deflate')` (zlib format, which is
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

/** The PNG file for a picture: 8-bit RGB, no interlace, filter 0 on every row. */
export async function encodePng(r: Raster): Promise<Uint8Array> {
  const rowBytes = r.width * 3;
  const raw = new Uint8Array(r.height * (1 + rowBytes));
  for (let y = 0; y < r.height; y++) raw.set(r.data.subarray(y * rowBytes, (y + 1) * rowBytes), y * (1 + rowBytes) + 1);
  const header = new Uint8Array(13); const hv = new DataView(header.buffer);
  hv.setUint32(0, r.width); hv.setUint32(4, r.height); header[8] = 8; header[9] = 2; // 8 bits, colour type 2 (RGB); compression, filter, interlace stay 0
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
