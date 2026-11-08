// The sound library keeps a sound only under the id its bytes hash to (src/audio/soundLibrary.ts):
// a project, My sounds or "Share this sound" file can say any id for the bytes it carries, and
// bytes that aren't what the id names must never be kept, played or saved under it. Run in Node
// with this browser's storage (IndexedDB) and decoding faked in memory. Run with `npm test`.
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here.
// The live audio engine and the DSP worker are stood in for: the library only asks the live rate.
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  if (specifier === './engine' && context.parentURL?.endsWith('/soundLibrary.ts')) return { url: 'data:text/javascript,export const liveMix = { bus: { context: { sampleRate: 44100 } } };', shortCircuit: true };
  if (specifier === './dspRun' && context.parentURL?.endsWith('/soundLibrary.ts')) return { url: 'data:text/javascript,export class DspDropped extends Error {} export const runDsp = async () => { throw new Error("no worker here"); };', shortCircuit: true };
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);

// ---------- this browser, faked ----------

/** IndexedDB in memory: the stores the library makes, their records, and the requests it uses. */
const stores = new Map();
const later = (fn) => setTimeout(fn, 0);
const asRequest = (run) => {
  const req = { result: undefined, error: null, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    try {
      req.result = run();
      req.onsuccess?.();
    } catch (err) {
      req.error = err;
      req.onerror?.();
    }
  });
  return req;
};
const copy = (v) => (v && typeof v === 'object' && !(v instanceof Blob) ? structuredClone(v) : v);
const db = {
  objectStoreNames: { contains: (name) => stores.has(name) },
  createObjectStore: (name, opts) => stores.set(name, { keyPath: opts?.keyPath, records: new Map() }),
  transaction() {
    const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
    tx.objectStore = (name) => {
      const store = stores.get(name);
      return {
        get: (key) => asRequest(() => copy(store.records.get(key))),
        getAll: () => asRequest(() => [...store.records.values()].map(copy)),
        put: (value, key) => {
          store.records.set(store.keyPath ? value[store.keyPath] : key, copy(value));
          return asRequest(() => key);
        },
        delete: (key) => {
          store.records.delete(key);
          return asRequest(() => undefined);
        },
      };
    };
    later(() => tx.oncomplete?.());
    return tx;
  },
  close() {},
};
globalThis.indexedDB = {
  open() {
    const req = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    later(() => {
      req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

/** What's kept under `id` in the fake storage: the bytes and the meta. */
const kept = async (id) => {
  const data = stores.get('sound-data')?.records.get(id);
  return { bytes: data ? Buffer.from(await data.arrayBuffer()) : undefined, meta: stores.get('sound-meta')?.records.get(id) };
};
/** Put bytes under an id as a browser did before the app checked them (a planted copy). */
const plant = (id, bytes, name) => {
  stores.get('sound-meta').records.set(id, { id, name, type: 'audio/wav', size: bytes.length, seconds: 0.1 });
  stores.get('sound-data').records.set(id, new Blob([bytes], { type: 'audio/wav' }));
};

/** Decoding: a 16-bit WAV's samples as they are (any other bytes can't be decoded). */
globalThis.OfflineAudioContext = class {
  constructor(_channels, _length, sampleRate) {
    this.sampleRate = sampleRate;
  }
  async decodeAudioData(buffer) {
    const bytes = Buffer.from(buffer);
    if (bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('EncodingError');
    const n = (bytes.length - 44) >> 1;
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = bytes.readInt16LE(44 + i * 2) / 32768;
    return { sampleRate: this.sampleRate, length: n, duration: n / 44100, numberOfChannels: 1, getChannelData: () => data };
  }
};

/** Reading a file as a data: URL (how a saved file's sounds are put in base64). */
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((bytes) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`;
      this.onload?.();
    }, (err) => {
      this.error = err;
      this.onerror?.();
    });
  }
};

// ---------- sounds ----------

/** A 0.1 s WAV: a quiet sine (-24 dBFS peak) or a full-scale square, at `hz`. */
function wav(kind, hz) {
  const rate = 44100;
  const n = 4410;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = kind === 'quiet' ? 0.063 * Math.sin((2 * Math.PI * hz * i) / rate) : Math.sin((2 * Math.PI * hz * i) / rate) >= 0 ? 0.999 : -0.999;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
/** The app's id for bytes: the first 128 bits of their SHA-256. */
const shaId = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 32);
/** The app's FNV id (a browser with no crypto). */
function fnvId(data) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    a = Math.imul(a ^ data[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ data[i], 0x9e3779b1) >>> 0;
  }
  return `fnv${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${data.length.toString(16)}`;
}
const carried = (id, bytes, name) => ({ id, name, type: 'audio/wav', size: bytes.length, seconds: 0.1, data: bytes.toString('base64') });
const peakDb = (buffer) => {
  let peak = 0;
  for (const v of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(v));
  return Math.round(20 * Math.log10(peak));
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const L = await import('../src/audio/soundLibrary.ts');
// (the stores are made on the first use)
await L.storedSounds();

test("a file's sound under another sound's id is never kept, played or saved under that id", async () => {
  const quiet = wav('quiet', 330);
  const loud = wav('loud', 220);
  const qId = shaId(quiet);
  // Opening a file that carries the loud bytes under the quiet file's id (no clip plays it)
  await L.importEmbeddedSounds([carried(qId, loud, 'Kick.wav')]);
  await settle();
  assert.equal((await kept(qId)).bytes, undefined, 'nothing kept under the id it was given');
  assert.equal(L.soundFileName(qId), undefined, 'no name for it either');
  // (filed under its own id, as any file of those bytes would be)
  assert.deepEqual((await kept(shaId(loud))).bytes, loud);
  // The musician's own quiet file, loaded afterwards, is what plays at every rate and what Save carries
  const meta = await L.importSoundFile(new Blob([quiet], { type: 'audio/wav' }), 'My tone.wav');
  assert.equal(meta.id, qId);
  assert.deepEqual((await kept(qId)).bytes, quiet);
  assert.equal(peakDb(await L.decodeSound(qId, 44100)), -24);
  assert.equal(peakDb(await L.decodeSound(qId, 48000)), -24);
  assert.equal(peakDb(await L.decodeSound(qId, 88200)), -24);
  const [saved] = await L.embedSounds([qId]);
  assert.deepEqual(Buffer.from(saved.data, 'base64'), quiet);
  assert.equal(saved.name, 'My tone.wav');
});

test('a browser that kept other bytes under an id before the check: they never play or go into a file, and the right file puts its bytes back', async () => {
  const quiet = wav('quiet', 331);
  const loud = wav('loud', 221);
  const qId = shaId(quiet);
  plant(qId, loud, 'Kick.wav');
  // After a reload a song that plays it finds it not in this browser, rather than 25 dB louder
  await assert.rejects(L.decodeSound(qId, 48000));
  assert.equal(L.soundStatus(qId), 'missing');
  assert.deepEqual(await L.embedSounds([qId]), []);
  // Loading the file it names (even with the old name known in this page) keeps its own bytes
  L.ensureSound(qId);
  await settle();
  const meta = await L.importSoundFile(new Blob([quiet], { type: 'audio/wav' }), 'My tone.wav');
  assert.equal(meta.name, 'My tone.wav');
  assert.deepEqual((await kept(qId)).bytes, quiet);
  assert.equal((await kept(qId)).meta.name, 'My tone.wav');
  assert.equal(peakDb(await L.decodeSound(qId, 48000)), -24);
  assert.deepEqual(Buffer.from((await L.embedSounds([qId]))[0].data, 'base64'), quiet);
});

test("a song that carries a sound's right bytes puts them in place of other bytes kept under its id", async () => {
  const quiet = wav('quiet', 332);
  const loud = wav('loud', 222);
  const qId = shaId(quiet);
  plant(qId, loud, 'Kick.wav');
  const moved = await L.importEmbeddedSounds([carried(qId, quiet, 'Soft tone.wav')]);
  assert.equal(moved?.size ?? 0, 0);
  assert.deepEqual((await kept(qId)).bytes, quiet);
  assert.equal((await kept(qId)).meta.name, 'Soft tone.wav');
  assert.equal(peakDb(await L.decodeSound(qId, 48000)), -24);
  await settle();
  assert.equal(L.soundStatus(qId), 'ready');
});

test('an id in the form made without crypto is checked by that form too', async () => {
  const quiet = wav('quiet', 333);
  const loud = wav('loud', 223);
  const fId = fnvId(quiet);
  // Other bytes under it (a My sounds or sound file's recording): kept under their own id only
  await L.importEmbeddedSounds([carried(fId, loud, 'Snare.wav')]);
  await settle();
  assert.equal((await kept(fId)).bytes, undefined);
  assert.equal(L.soundFileName(fId), undefined);
  // Its own bytes (a song saved on a phone without crypto): kept under it, and they play
  await L.importEmbeddedSounds([carried(fId, quiet, 'Tone.wav')]);
  assert.deepEqual((await kept(fId)).bytes, quiet);
  assert.equal(peakDb(await L.decodeSound(fId, 48000)), -24);
});

test('a made-up id (a hand-made file) keeps nothing under it: the bytes go under their own', async () => {
  const quiet = wav('quiet', 334);
  await L.importEmbeddedSounds([carried('snd1', quiet, 'Tone.wav')]);
  await settle();
  assert.equal((await kept('snd1')).bytes, undefined);
  assert.notEqual(L.soundStatus('snd1'), 'ready');
  assert.deepEqual((await kept(shaId(quiet))).bytes, quiet);
});

test('a sound kept under its own id is still found and played as before', async () => {
  const quiet = wav('quiet', 335);
  const id = shaId(quiet);
  const meta = await L.importSoundFile(new Blob([quiet], { type: 'audio/wav' }), 'Mine.wav');
  assert.equal(meta.id, id);
  const again = await L.importSoundFile(new Blob([quiet], { type: 'audio/wav' }), 'Mine again.wav');
  // (the same bytes: stored once, under the first name)
  assert.equal(again.name, 'Mine.wav');
  assert.equal(peakDb(await L.decodeSound(id, 22050)), -24);
  const [saved] = await L.embedSounds([id]);
  assert.deepEqual(Buffer.from(saved.data, 'base64'), quiet);
});
