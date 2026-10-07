/**
 * A minimal .zip writer for bundling exported stems into one download. Files are STOREd
 * (not compressed): WAV audio barely compresses, and storing keeps this small and fast. The
 * file data stays in its Blobs; only the headers are built here.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (the zip / PNG polynomial) of `data`. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Date and time in MS-DOS format, as zip headers store them (2-second resolution, local time). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export interface ZipEntry {
  /** Path inside the archive (UTF-8). */
  name: string;
  data: Blob;
}

/** Bundle `entries` into a .zip file. */
export async function createZip(entries: ZipEntry[], modified = new Date()): Promise<Blob> {
  const { time, date } = dosDateTime(modified);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.data.size;
    // Read one file at a time for its checksum, so a set of big stems isn't all in memory at once
    const crc = crc32(new Uint8Array(await entry.data.arrayBuffer()));
    if (offset + size + 30 + name.length > 0xffffffff) throw new Error('the stems are too big for one zip file (over 4 GB)');

    // Fields shared by the local header (from offset 4) and the central directory entry (from 6)
    const common = new DataView(new ArrayBuffer(26));
    common.setUint16(0, 20, true); // version needed to extract: 2.0
    common.setUint16(2, 0x0800, true); // flags: the name is UTF-8
    common.setUint16(4, 0, true); // method: stored
    common.setUint16(6, time, true);
    common.setUint16(8, date, true);
    common.setUint32(10, crc, true);
    common.setUint32(14, size, true); // compressed size
    common.setUint32(18, size, true); // uncompressed size
    common.setUint16(22, name.length, true);
    common.setUint16(24, 0, true); // extra field length

    const local = new Uint8Array(30 + name.length);
    new DataView(local.buffer).setUint32(0, 0x04034b50, true);
    local.set(new Uint8Array(common.buffer), 4);
    local.set(name, 30);
    parts.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true); // version made by: 2.0, MS-DOS attributes
    central.set(new Uint8Array(common.buffer), 6);
    // comment length, disk number, internal and external attributes stay 0
    view.setUint32(42, offset, true);
    central.set(name, 46);
    directory.push(central);

    offset += local.length + size;
  }

  const directorySize = directory.reduce((sum, d) => sum + d.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true); // entries on this disk
  end.setUint16(10, entries.length, true); // entries in total
  end.setUint32(12, directorySize, true);
  end.setUint32(16, offset, true); // where the central directory starts
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
