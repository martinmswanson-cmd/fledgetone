// Sound ids (src/audio/soundIds.ts): a sound's id is a hash of its bytes, and the bytes a file
// carries are checked against the id it gives them, by the id's own form, before anything keeps
// or plays them; a song is pointed at the right id when one moves (src/store/audioClips.ts
// withSoundsMoved). Run with `npm test`.
import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The app imports its own modules without the .ts extension (Vite resolves them); do the same here
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);
const { base64Bytes, carriedBytes, checkSounds, fnvSoundId, isCheckedSound, isFnvSoundId, isShaSoundId, isSoundOf, ownSoundId, sha256, shaSoundId, soundIdOf, withCheckedSounds } = await import('../src/audio/soundIds.ts');
const { referencedSoundIds, withSoundsMoved } = await import('../src/store/audioClips.ts');
const { parseProject } = await import('../src/store/project.ts');

/** The app's id before this change, as soundLibrary.ts made it (the form must not change: files and browsers hold these). */
function oldFnv(bytes) {
  const data = new Uint8Array(bytes);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    a = Math.imul(a ^ data[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ data[i], 0x9e3779b1) >>> 0;
  }
  return `fnv${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${data.length.toString(16)}`;
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 32);
const bytesOf = (n, seed = 1) => {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (Math.imul(i + seed, 2654435761) >>> 24) & 255;
  return b;
};
/** Run `fn` as a browser with no crypto (a page not served over https). */
async function withoutCrypto(fn) {
  const was = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'crypto', was);
  }
}
const carried = (id, bytes, name = 'Sound.wav') => ({ id, name, type: 'audio/wav', size: 1, seconds: 0.5, data: Buffer.from(bytes).toString('base64') });

test('ids are made as before: SHA-256 (first 128 bits) or, without crypto, the FNV pair, a big file a slice at a time', async () => {
  for (const n of [0, 1, 1000, (1 << 22) + 17, 3 * (1 << 22)]) {
    const b = bytesOf(n, n);
    assert.equal(await soundIdOf(b), sha(b));
    assert.equal(await shaSoundId(b), sha(b));
    assert.equal(await fnvSoundId(b), oldFnv(b));
    assert.equal(await withoutCrypto(() => soundIdOf(b)), oldFnv(b));
    // (where there's no crypto the SHA-256 form is still worked out, to check ids by: never to make them)
    assert.equal(await withoutCrypto(() => shaSoundId(b)), sha(b));
  }
  assert.ok(isShaSoundId(sha(bytesOf(10))));
  assert.ok(isFnvSoundId(oldFnv(bytesOf(10))) && isFnvSoundId(oldFnv(bytesOf(0))));
  for (const id of ['snd1', '', 'A'.repeat(32), `${sha(bytesOf(3))}0`]) assert.ok(!isShaSoundId(id), id);
  for (const id of ['snd1', '', 'fnv0123', 'fnv0123456789abcdef01x', 'fnv0123456789abcdef', 'fnv0123456789abcdef0a0', sha(bytesOf(3))]) assert.ok(!isFnvSoundId(id), id);
});

test('bytes are checked against an id by the id\'s own form, never by what the browser has', async () => {
  const mine = bytesOf(5000, 7);
  const other = bytesOf(5000, 8);
  assert.equal(await isSoundOf(sha(mine), mine), true);
  assert.equal(await isSoundOf(sha(mine), other), false);
  assert.equal(await isSoundOf(oldFnv(mine), mine), true);
  assert.equal(await isSoundOf(oldFnv(mine), other), false);
  // An FNV id is checked by FNV even where there is crypto, and a SHA-256 one by SHA-256 where there isn't
  assert.equal(await withoutCrypto(() => isSoundOf(oldFnv(mine), mine)), true);
  assert.equal(await withoutCrypto(() => isSoundOf(sha(mine), mine)), true);
  assert.equal(await withoutCrypto(() => isSoundOf(sha(mine), other)), false);
  assert.equal(await withoutCrypto(() => isSoundOf(oldFnv(mine), other)), false);
  for (const id of ['snd1', 'x', sha(mine).toUpperCase()]) assert.equal(await isSoundOf(id, mine), false, id);
  // The id bytes go under: the given one when it names them, else this browser's own
  assert.equal(await ownSoundId(sha(mine), mine), sha(mine));
  assert.equal(await ownSoundId(oldFnv(mine), mine), oldFnv(mine));
  assert.equal(await ownSoundId(sha(mine), other), sha(other));
  assert.equal(await ownSoundId(oldFnv(mine), other), sha(other));
  assert.equal(await ownSoundId('snd1', mine), sha(mine));
  // Without crypto: a right SHA-256 id stays (a song from a computer with crypto keeps its ids), a wrong one goes to the FNV form
  assert.equal(await withoutCrypto(() => ownSoundId(sha(mine), mine)), sha(mine));
  assert.equal(await withoutCrypto(() => ownSoundId(sha(mine), other)), oldFnv(other));
  assert.equal(await withoutCrypto(() => ownSoundId(oldFnv(mine), other)), oldFnv(other));
  assert.equal(await withoutCrypto(() => ownSoundId('snd1', mine)), oldFnv(mine));
});

test('the SHA-256 worked out here gives the standard answers, and the same ids as the browser\'s own crypto', async () => {
  const hex = async (b) => Buffer.from(await sha256(b)).toString('hex');
  // FIPS 180-4 / NIST examples
  assert.equal(await hex(Buffer.from('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await hex(Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  assert.equal(
    await hex(Buffer.from('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu')),
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'
  );
  assert.equal(await hex(Buffer.alloc(1000000, 'a')), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  // Every length around a block's end and the last block's room for the length, a slice's end, and a few MB
  for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 128, (1 << 20) - 1, 1 << 20, (1 << 20) + 1, 3 * (1 << 20) + 77]) {
    const b = bytesOf(n, n + 3);
    assert.equal(await hex(b), createHash('sha256').update(b).digest('hex'), `${n} bytes`);
    // (the app's own id where there is crypto, as made in a secure page, and the one checked by where there isn't)
    assert.equal(await withoutCrypto(() => shaSoundId(b)), await soundIdOf(b));
  }
  // A view into a bigger buffer is hashed as the bytes it shows
  const whole = bytesOf(5000, 9);
  assert.equal(await withoutCrypto(() => shaSoundId(new Uint8Array(whole.buffer, whole.byteOffset + 7, 3001))), sha(whole.subarray(7, 3008)));
  // Ids the app made in a secure page (Chromium on localhost) for the quiet tone the checks use (330 Hz, 1 s, 16-bit)
  const tone = Buffer.alloc(44 + 88200);
  tone.write('RIFF', 0); tone.writeUInt32LE(36 + 88200, 4); tone.write('WAVE', 8); tone.write('fmt ', 12); tone.writeUInt32LE(16, 16); tone.writeUInt16LE(1, 20); tone.writeUInt16LE(1, 22);
  tone.writeUInt32LE(44100, 24); tone.writeUInt32LE(88200, 28); tone.writeUInt16LE(2, 32); tone.writeUInt16LE(16, 34); tone.write('data', 36); tone.writeUInt32LE(88200, 40);
  for (let i = 0; i < 44100; i++) tone.writeInt16LE(Math.round(0.063 * Math.sin((2 * Math.PI * 330 * i) / 44100) * 32767), 44 + i * 2);
  assert.equal(await withoutCrypto(() => shaSoundId(tone)), '85b08bcb062a5d51de575bd1c66f2d0b');
  assert.equal(await withoutCrypto(() => soundIdOf(tone)), 'fnva603901f41b11dbd158b4');
});

test('the SHA-256 worked out here lets the page have a turn between slices', async () => {
  const big = bytesOf(4 * (1 << 20) + 5, 2);
  let turns = 0;
  let done = false;
  const tick = () => {
    if (done) return;
    turns++;
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      tick();
    };
    port2.postMessage(null);
  };
  const hashing = withoutCrypto(() => shaSoundId(big));
  tick();
  try {
    assert.equal(await hashing, sha(big));
  } finally {
    done = true;
  }
  assert.ok(turns >= 3, `the page had ${turns} turns while 4 MB were hashed`);
});

test("a file's sounds checked: right ones as they are, others under their own ids (and where they moved), unreadable ones left out", async () => {
  const quiet = bytesOf(4000, 1);
  const loud = bytesOf(4000, 2);
  const third = bytesOf(3000, 3);
  const right = carried(sha(quiet), quiet, 'Soft.wav');
  const planted = carried(sha(third), loud, 'Kick.wav');
  const madeUp = carried('snd1', third, 'Tone.wav');
  const phone = carried(oldFnv(quiet), quiet, 'Phone.wav');
  const broken = { ...carried('b', quiet), data: '***not base64***' };
  const { sounds, moved } = await checkSounds([right, planted, madeUp, phone, broken]);
  assert.deepEqual(
    sounds.map((s) => [s.id, s.name]),
    [
      [sha(quiet), 'Soft.wav'],
      [sha(loud), 'Kick.wav'],
      [sha(third), 'Tone.wav'],
      [oldFnv(quiet), 'Phone.wav'],
    ]
  );
  assert.deepEqual([...moved], [[sha(third), sha(loud)], ['snd1', sha(third)]]);
  // Every one comes back under the id of its own bytes (and its real size), and is known as checked
  for (const s of sounds) {
    assert.ok(await isSoundOf(s.id, Buffer.from(s.data, 'base64')), s.id);
    assert.equal(s.size, Buffer.from(s.data, 'base64').length);
    assert.ok(isCheckedSound(s) && Object.isFrozen(s));
  }
  assert.ok(!isCheckedSound(planted) && !isCheckedSound({ ...sounds[0] }));
  // Checked ones aren't looked at again
  const again = await checkSounds(sounds);
  assert.deepEqual(again.sounds, sounds);
  assert.equal(again.moved.size, 0);
  // Two entries under one id: the one whose bytes it names stays, the other goes nowhere
  const twice = await checkSounds([carried(sha(quiet), loud, 'Fake.wav'), carried(sha(quiet), quiet, 'Real.wav')]);
  assert.deepEqual(twice.sounds.map((s) => [s.id, s.name]), [[sha(quiet), 'Real.wav']]);
  assert.equal(twice.moved.size, 0);
  // Two under one made-up id with different bytes: the first is the one the song gets
  const madeTwice = await checkSounds([carried('x', quiet, 'A.wav'), carried('x', loud, 'B.wav')]);
  assert.deepEqual(madeTwice.sounds.map((s) => s.name), ['A.wav']);
  assert.deepEqual([...madeTwice.moved], [['x', sha(quiet)]]);
});

test("a file's base64 is read a slice at a time, as a whole file of it reads", async () => {
  for (const n of [0, 1, 2, 3, 1000, 786431, 786432, 786433, 3 * 786432 + 2]) {
    const b = bytesOf(n, n + 5);
    const text = b.toString('base64');
    assert.deepEqual(Buffer.from(await base64Bytes(text)), b, `${n} bytes`);
    // (as a data: URL reads it: line breaks and spaces don't count, and the last padding may be left off)
    assert.deepEqual(Buffer.from(await base64Bytes(text.replace(/(.{76})/g, '$1\r\n'))), b);
    assert.deepEqual(Buffer.from(await base64Bytes(text.replace(/=+$/, ''))), b);
    const sound = carried('x', b);
    assert.deepEqual(Buffer.from(await carriedBytes(sound)), b);
  }
  for (const bad of ['***', 'AAAAA', 'AA==AAAA', 'A=AA', '%41AA', 'data:audio/wav;base64,AA==']) assert.equal(await base64Bytes(bad), undefined, bad);
  assert.equal(await carriedBytes({ ...carried('x', bytesOf(3)), data: 'not base64!' }), undefined);
});

/** A song with a sound in every place one can be: what withSoundsMoved has to follow. */
const audio = (soundId, more = {}) => ({ soundId, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, ...more });
function everyPlace(a, b) {
  return {
    masterFx: { reverbDecay: 2, delayTime: '8n', delayFeedback: 0.2, room: a },
    clips: [
      { id: 'c1', trackId: 't1', audio: audio(a, { tunedFrom: b, reversedFrom: a, shiftedFrom: b }) },
      { id: 'c2', trackId: 't1', audio: audio(b, { mangled: { from: a, offset: 0, bars: 1, steps: [], was: audio(a, { tunedFrom: b }) } }), takes: [{ id: 'k1', name: 'Take 1', audio: audio(a) }, { id: 'k2', name: 'Take 2' }] },
      { id: 'c3', trackId: 't2', notes: [] },
    ],
    tracks: [
      { id: a, name: 'Named like the sound', sample: { name: 's', soundId: a, root: 60 }, slicer: { soundId: b, name: 'sl', start: 0, end: 1, slices: [0] }, rack: { pads: [{ name: 'p', soundId: a }, { name: 'empty' }] }, multi: { zones: [{ soundId: b, name: 'z' }] }, slots: [{ scene: 0, clip: { id: 'sc', audio: audio(a) } }] },
      { id: 't2', name: 'Keys', sample: { name: 'old', dataUrl: 'data:,x' } },
    ],
  };
}

test('a song pointed at where its sounds moved: every place a sound is read from, and nothing else', () => {
  const p = everyPlace('A', 'B');
  const moved = new Map([['A', 'A2']]);
  const q = withSoundsMoved(p, moved);
  assert.deepEqual(referencedSoundIds(q).sort(), referencedSoundIds(p).map((id) => moved.get(id) ?? id).filter((v, i, all) => all.indexOf(v) === i).sort());
  // (a track whose id happens to be the sound's keeps it: only the places a sound is read from move)
  assert.equal(JSON.stringify(q).match(/"A"/g).length, 1);
  assert.equal(q.tracks[0].id, 'A');
  assert.equal(q.masterFx.room, 'A2');
  assert.equal(q.clips[0].audio.soundId, 'A2');
  assert.equal(q.clips[0].audio.tunedFrom, 'B');
  assert.equal(q.clips[0].audio.reversedFrom, 'A2');
  assert.equal(q.clips[1].audio.mangled.from, 'A2');
  assert.equal(q.clips[1].audio.mangled.was.soundId, 'A2');
  assert.equal(q.clips[1].takes[0].audio.soundId, 'A2');
  assert.equal(q.tracks[0].sample.soundId, 'A2');
  assert.equal(q.tracks[0].slicer.soundId, 'B');
  assert.deepEqual(q.tracks[0].rack.pads.map((pd) => pd.soundId), ['A2', undefined]);
  assert.equal(q.tracks[0].slots[0].clip.audio.soundId, 'A2');
  // Parts with nothing to move stay the same objects; nothing moved: the same song
  assert.equal(q.clips[2], p.clips[2]);
  assert.equal(q.tracks[1], p.tracks[1]);
  assert.equal(q.tracks[0].multi, p.tracks[0].multi);
  assert.equal(withSoundsMoved(p, new Map()), p);
  // (the song it came from is untouched)
  assert.deepEqual(p, everyPlace('A', 'B'));
  // Both at once, without one move feeding the next
  const swapped = withSoundsMoved(p, new Map([['A', 'B'], ['B', 'A']]));
  assert.equal(swapped.clips[0].audio.soundId, 'B');
  assert.equal(swapped.clips[0].audio.tunedFrom, 'A');
});

test('an opened song with a sound under another id plays the bytes it was sent with, under their own id', async () => {
  const quiet = bytesOf(4000, 11);
  const loud = bytesOf(4000, 12);
  // (the loud bytes under the quiet file's id, as a file made to plant them would carry them)
  const file = {
    format: 'fledgetone-project', version: 1, name: 'Remix', bpm: 120,
    tracks: [{ id: 'a1', name: 'Audio', instrumentKey: 'audio' }, { id: 's1', name: 'Keys', instrumentKey: 'sampler', sample: { name: 'k', soundId: sha(quiet), root: 60 } }],
    clips: [{ id: 'c1', trackId: 'a1', name: 'Tone', startBar: 1, lengthBars: 2, notes: [], audio: { soundId: sha(quiet) } }],
    sounds: [carried(sha(quiet), loud, 'Kick.wav')],
  };
  const song = parseProject(file);
  const opened = await withCheckedSounds(song);
  assert.deepEqual(opened.sounds.map((s) => s.id), [sha(loud)]);
  assert.deepEqual(referencedSoundIds(opened), [sha(loud)]);
  assert.ok(!JSON.stringify(opened).includes(sha(quiet)));
  // A right one comes back the same, and a song with no sounds is the same song
  const right = parseProject({ ...file, sounds: [carried(sha(quiet), quiet)] });
  const same = await withCheckedSounds(right);
  assert.deepEqual(referencedSoundIds(same), [sha(quiet)]);
  assert.equal(same.clips, right.clips);
  const none = parseProject({ format: 'fledgetone-project', version: 1, name: 'x', tracks: [], clips: [] });
  assert.equal(await withCheckedSounds(none), none);
  // Where there's no crypto, a song made where there is opens with its ids as they are (the planted one still moves)
  const rightHere = await withoutCrypto(() => withCheckedSounds(parseProject({ ...file, sounds: [carried(sha(quiet), quiet)] })));
  assert.deepEqual(referencedSoundIds(rightHere), [sha(quiet)]);
  const plantedHere = await withoutCrypto(() => withCheckedSounds(song));
  assert.deepEqual(referencedSoundIds(plantedHere), [oldFnv(loud)]);
});

test("a reference video is kept where videos are, never under a sound's id", () => {
  const p = (key) => parseProject({ format: 'fledgetone-project', version: 1, name: 'x', tracks: [], clips: [], video: { key, name: 'v.mp4', start: 0 } }).video.key;
  assert.equal(p('video:v.mp4|10|20'), 'video:v.mp4|10|20');
  assert.equal(p(sha(bytesOf(9))), `video:${sha(bytesOf(9))}`);
});

test('every way a file brings sounds in checks them before the song or sound is used', async () => {
  const { readFileSync } = await import('node:fs');
  const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  // A project file (File > Open, a drop, the phone app), the renderer and the game player
  assert.ok(src('src/components/timeline/projectFile.ts').includes('const project = await withCheckedSounds(parseProject(JSON.parse(await file.text())));'));
  assert.ok(src('src/runtime/render.ts').includes('const p = await withCheckedSounds(parseProject(raw));'));
  assert.ok(src('src/runtime/player.ts').includes('const project = await withCheckedSounds(parseProject(raw));'));
  // My sounds and "Share this sound" files
  const my = src('src/components/mySoundsFile.ts');
  assert.equal(my.match(/= await checkedFile\(file\);/g)?.length, 2);
  assert.ok(!my.includes('parseMySoundsFile(JSON.parse(await file.text()));\n    if (recordings'));
});
