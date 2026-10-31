// Names every object already has ("toString", "constructor", "__proto__"...) given where the app
// looks a key up: an instrument, a note, an id or a table key in a project file, a share link, a
// My sounds file or an agent's ops. Each is refused or read as a plain name, nothing reaches the
// prototype, and the app's own songs open exactly as they were saved. Also: settings a file gives
// out of the app's own ranges (EQ, a freeze's level, note and video positions) come back in range.
// Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

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
const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: (k) => stored.delete(k) };
const { parseProject, serializeProject, PROJECT_FORMAT, PROJECT_VERSION } = await import('../src/store/project.ts');
const { projectFromHash, songLink } = await import('../src/store/shareLink.ts');
const { parseSound, parseMySoundsFile, MY_SOUNDS_FORMAT } = await import('../src/store/mySounds.ts');
const { applyOps, checkOpsShape } = await import('../src/agent/ops.ts');
const { createStarter } = await import('../src/store/starters.ts');
const { STARTERS } = await import('../src/store/starters.ts');
const { isInstrumentKey, pumpHitOf } = await import('../src/audio/instrumentCatalog.ts');
const { trackIntensityLevel } = await import('../src/store/intensity.ts');
const { paramMix } = await import('../src/store/gameParams.ts');
const { stableJson } = await import('../src/agent/fingerprint.ts');

const NAMES = ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__'];
const notes = [{ id: 'n1', note: 'C3', startOffset: 0, duration: '8n', velocity: 0.5 }];
const file = (extra) => JSON.parse(JSON.stringify({ format: PROJECT_FORMAT, version: PROJECT_VERSION, name: 'Hostile', bpm: 120, tracks: [], clips: [], ...extra }));
const clean = () => assert.equal(({}).polluted, undefined, 'nothing reached every object');
/** Every id, key and pitch in a song: none of them a name every object has. */
const noPrototypeNames = (p) => {
  const walk = (v, path) => {
    if (typeof v !== 'object' || v === null) return;
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    assert.equal(Object.getPrototypeOf(v), Object.prototype, `${path} is a plain object`);
    for (const [k, x] of Object.entries(v)) {
      if (k !== 'name') assert.ok(!(k in Object.prototype), `${path}.${k}`);
      if (typeof x === 'string' && ['id', 'trackId', 'soundId', 'to', 'output', 'note', 'instrumentKey'].includes(k)) assert.ok(!(x in Object.prototype), `${path}.${k} = ${x}`);
      walk(x, `${path}.${k}`);
    }
  };
  walk(p, 'song');
};

test('a track whose instrument is a name every object has is left out of a project, and the rest opens', () => {
  assert.equal(isInstrumentKey('piano'), true);
  for (const name of NAMES) {
    assert.equal(isInstrumentKey(name), false, name);
    const p = parseProject(file({ tracks: [{ id: 't0', name: 'Keys', instrumentKey: 'piano' }, { id: 't1', name: 'Odd', instrumentKey: name }], clips: [{ id: 'c1', trackId: 't1', startBar: 1, lengthBars: 1, notes }], stingers: [{ id: 's', name: 'S', kind: 'victory', instrumentKey: name, lengthBars: 1, notes }], costumes: [{ name: 'C', tracks: { t0: { instrument: name } } }] }));
    assert.deepEqual(p.tracks.map((t) => t.id), ['t0'], name);
    assert.deepEqual(p.unread, { tracks: 1, clips: 0 }, name);
    assert.equal(p.clips.length, 0, name);
    assert.equal(p.stingers.length, 0, name);
    assert.deepEqual(p.costumes[0].tracks, {}, name);
  }
  // Nothing readable at all: it says why
  assert.throws(() => parseProject(file({ tracks: [{ id: 't1', name: 'Odd', instrumentKey: 'toString' }] })), /missing its id, name or instrument/);
  clean();
});

test('ids and table keys that are such names open as plain ids, still joined up, and notes named so are left out', () => {
  for (const name of NAMES) {
    const raw = file({
      tracks: [
        { id: name, name: 'Keys', instrumentKey: 'piano', stemGroup: name, output: 'bus', sends: [{ to: 'ret', level: 0.5 }], automation: [{ param: `send:ret`, points: [{ bar: 1, value: 0.5 }] }], sample: { soundId: name }, folder: { id: name, name: 'F' } },
        { id: 'bus', name: 'Bus', instrumentKey: 'bus' },
        { id: 'ret', name: 'Return', instrumentKey: 'return', fx: { pump: { on: true, source: name } } },
      ],
      clips: [{ id: name, trackId: name, startBar: 1, lengthBars: 1, pattern: name, notes: [...notes, { id: name, note: name, startOffset: 0, duration: '8n', velocity: 0.5 }], audio: undefined }],
      markers: [{ id: name, name: 'Calm', bar: 1 }],
      stateOptions: { [name]: { shuffleBars: 4 } },
      transitions: { [`${name}>*`]: { kind: 'cut' } },
      costumes: [{ name: 'C', tracks: { [name]: { mute: true } } }],
      intensity: { value: 0.5, curves: { [name]: [[0, 0.25], [1, 0.25]] } },
    });
    const p = parseProject(raw);
    noPrototypeNames({ ...p, intensity: undefined });
    const keys = p.tracks[0];
    assert.equal(keys.id, `${name}_`, name);
    assert.equal(p.clips[0].trackId, keys.id, 'the clip is still on its track');
    assert.equal(p.clips[0].id, `${name}_`);
    assert.deepEqual(p.clips[0].notes.map((n) => n.note), ['C3'], 'the note named so is left out');
    assert.equal(p.tracks[2].fx.pump.source, keys.id, 'the Pump still ducks to it');
    assert.equal(keys.sample.soundId, `${name}_`);
    assert.equal(p.markers[0].id, `${name}_`);
    assert.deepEqual(Object.keys(p.stateOptions), [`${name}_`]);
    assert.deepEqual(Object.keys(p.costumes[0].tracks), [keys.id]);
    // A stem group is the musician's own name: kept as typed, its curve found as its own
    assert.equal(keys.stemGroup, name);
    assert.ok(Object.hasOwn(p.intensity.curves, name), name);
    assert.equal(trackIntensityLevel(keys, p.intensity.curves, 0.5), 0.25, name);
    assert.equal(trackIntensityLevel(keys, {}, 0.5) > 0, true, `${name}: no curve of its own reads as the default`);
    // The game's parameter layers by that group: a number, not something found on every object
    const mix = paramMix([{ value: 1, targets: [{ kind: 'layer', group: name, from: 0, to: 1, start: 0, end: 0.5 }] }]);
    assert.equal(mix.layers[name], 0.5, name);
    assert.equal(paramMix([]).layers[name], undefined, name);
    assert.equal(pumpHitOf('studioKit', name), null, name);
  }
  clean();
});

test('a share link with such names, or a "__proto__" in a track, opens as plain data', async () => {
  const p = parseProject(file({ tracks: [{ id: 't1', name: 'Keys', instrumentKey: 'piano', stemGroup: 'constructor' }], clips: [{ id: 'c1', trackId: 't1', startBar: 1, lengthBars: 1, notes }] }));
  const link = await songLink(p, 'http://localhost/');
  const back = await projectFromHash(link.slice(link.indexOf('#')));
  assert.equal(back.tracks[0].stemGroup, 'constructor');
  assert.equal(back.tracks[0].instrumentKey, 'piano');
  // Hand-made: a track with a "__proto__" of its own, a track playing "toString", and a note named "valueOf"
  const json = `{"version":${PROJECT_VERSION},"name":"p","bpm":120,"tracks":[{"id":"t1","name":"A","instrumentKey":"piano","__proto__":{"isMuted":true,"polluted":1,"volume":-30}},{"id":"t2","name":"B","instrumentKey":"toString"}],"clips":[],"p":["valueOf"],"l":["8n"]}`;
  const enc = new TextEncoder().encode(json);
  const head = [];
  for (let v = enc.length; ; v = Math.floor(v / 0x80)) {
    if (v < 0x80) {
      head.push(v);
      break;
    }
    head.push((v % 0x80) | 0x80);
  }
  const hash = '#s=' + deflateRawSync(Buffer.concat([Buffer.from(head), Buffer.from(enc)])).toString('base64url');
  const q = await projectFromHash(hash);
  assert.deepEqual(q.tracks.map((t) => [t.id, t.instrumentKey, t.isMuted, t.volume]), [['t1', 'piano', false, 0]]);
  assert.deepEqual(q.unread, { tracks: 1, clips: 0 });
  noPrototypeNames(q);
  // A link whose tracks aren't objects doesn't throw on the way in
  const bad = `{"version":${PROJECT_VERSION},"name":"p","bpm":120,"tracks":[5,{"id":"t1","name":"A","instrumentKey":"piano"}],"clips":[],"p":[],"l":[]}`;
  const benc = new TextEncoder().encode(bad);
  const q2 = await projectFromHash('#s=' + deflateRawSync(Buffer.concat([Buffer.from([benc.length]), Buffer.from(benc)])).toString('base64url'));
  assert.deepEqual(q2.tracks.map((t) => t.id), ['t1']);
  clean();
});

test('a saved sound or My sounds file naming such an instrument is refused; its ids come back plain', () => {
  for (const name of NAMES) {
    assert.equal(parseSound({ id: 's', name: 'Odd', settings: { instrumentKey: name } }), null, name);
    const f = parseMySoundsFile(JSON.parse(JSON.stringify({ format: MY_SOUNDS_FORMAT, version: 1, favourites: [name, 'piano'], sounds: [{ id: 's1', name: 'Odd', settings: { instrumentKey: name } }, { id: 's2', name: 'Kit', settings: { instrumentKey: 'drumRack', rack: { pads: [{ name: 'Kick', soundId: name }] } } }], recordings: [{ id: name, name: 'kick', data: 'data:audio/wav;base64,AA==' }] })));
    assert.deepEqual(f.favourites, ['piano'], name);
    assert.deepEqual(f.sounds.map((s) => s.id), ['s2'], name);
    assert.equal(f.sounds[0].settings.rack.pads[0].soundId, `${name}_`, 'the pad still finds its recording');
    assert.equal(f.recordings[0].id, `${name}_`);
  }
  assert.equal(parseSound({ id: 's', name: 'Text', settings: 'piano' }), null);
  clean();
});

test("an agent's op, field, instrument or setting named so is refused, and nothing changes", () => {
  const song = createStarter('lofi');
  const before = stableJson(song);
  const track = song.tracks[0].id;
  for (const name of NAMES) {
    const refused = (ops, path) => {
      const out = applyOps(song, { opsVersion: 1, ops }, { idBase: 'h' });
      assert.equal(out.ok, false, `${name}: ${JSON.stringify(ops)}`);
      if (path) assert.ok(out.errors.some((e) => e.path.startsWith(path)), `${name}: ${JSON.stringify(out.errors)}`);
    };
    refused([{ op: name }], 'ops[0].op');
    refused([{ op: 'set_instrument', trackId: track, instrument: name }], 'ops[0].instrument');
    refused([{ op: 'add_track', instrument: name }], 'ops[0].instrument');
    refused([{ op: 'set_insert', trackId: track, insert: name, settings: {} }], 'ops[0].insert');
    refused([{ op: 'set_insert', trackId: track, insert: 'chorus', settings: JSON.parse(`{"${name}": 1}`) }], 'ops[0].settings');
    refused([{ op: 'set_master', ott: JSON.parse(`{"${name}": 1}`) }], 'ops[0].ott');
    refused([{ op: 'set_automation', trackId: track, param: name, points: [{ bar: 1, value: 0.5 }] }], 'ops[0].param');
    refused([{ op: 'set_synth_preset', trackId: track, preset: name }]);
    // A field of that name an op doesn't have
    const extra = JSON.parse(`{"op":"set_tempo","bpm":100,"${name}":1}`);
    assert.ok(checkOpsShape({ opsVersion: 1, ops: [extra] }).some((e) => e.path.startsWith('ops[0].')), name);
    refused([extra]);
  }
  assert.equal(stableJson(song), before);
  clean();
});

test("a file's EQ, freeze level, note, marker, video and stinger values come back in the app's own ranges", () => {
  const p = parseProject(
    file({
      tracks: [{ id: 't1', name: 'A', instrumentKey: 'piano', eq: { low: 1e300, mid: -1e300, high: 400 }, frozen: { soundId: 's', startBar: -1e300, seconds: 1e300, gainDb: 900, fingerprint: 'f' } }],
      clips: [{ id: 'c1', trackId: 't1', startBar: 1, lengthBars: 4, notes: [{ id: 'a', note: 'C4', startOffset: -1e300, duration: '8n', velocity: 1 }, { id: 'b', note: 'D4', startOffset: 1e300, duration: '8n', velocity: 1 }] }],
      meterPoints: [{ bar: 1e300, num: 3, den: 4 }],
      markers: [{ id: 'm', name: 'M', anchor: 'time', seconds: 1e300 }],
      stingers: [{ id: 's', name: 'S', kind: 'victory', instrumentKey: 'piano', lengthBars: 2, notes: [{ id: 'x', note: 'C4', startOffset: 1e300, duration: '8n', velocity: 1e300 }] }],
      video: { key: 'k', name: 'v', start: -1e300 },
    })
  );
  assert.deepEqual(p.tracks[0].eq, { low: 12, mid: -24, high: 12 });
  assert.equal(p.tracks[0].frozen.gainDb, 24);
  assert.equal(p.tracks[0].frozen.startBar, 1);
  assert.equal(p.tracks[0].frozen.seconds, 3600);
  assert.deepEqual(p.clips[0].notes.map((n) => n.startOffset), [-400, 400]);
  assert.equal(p.meterPoints[0].bar, 400);
  assert.equal(p.markers[0].seconds, 36000);
  assert.deepEqual([p.stingers[0].notes[0].startOffset, p.stingers[0].notes[0].velocity], [2, 1]);
  assert.equal(p.video.start, -36000);
  // In range: as it was
  const q = parseProject(file({ tracks: [{ id: 't1', name: 'A', instrumentKey: 'piano', eq: { low: -24, mid: 3.5, high: 12 }, frozen: { soundId: 's', startBar: 3, seconds: 12.5, gainDb: 7.25, fingerprint: 'f' } }] }));
  assert.deepEqual(q.tracks[0].eq, { low: -24, mid: 3.5, high: 12 });
  assert.deepEqual(q.tracks[0].frozen, { soundId: 's', startBar: 3, seconds: 12.5, gainDb: 7.25, fingerprint: 'f' });
});

test("every starter song opens exactly as it's saved", () => {
  for (const { id } of STARTERS) {
    const song = createStarter(id);
    const saved = serializeProject(song);
    const opened = serializeProject(parseProject(JSON.parse(JSON.stringify(saved))));
    assert.equal(stableJson(opened), stableJson(saved), id);
    noPrototypeNames(opened);
  }
});

test("a list of ids follows its parts' new ids: Glue off takes away the bus it made, whatever that bus's id", async () => {
  const { removeGlue } = await import('../src/store/glueMix.ts');
  for (const busId of ['toString', '__proto__', 'constructor', 'b1']) {
    const raw = {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      name: 'G',
      bpm: 120,
      tracks: [
        { id: 'k', name: 'Keys', instrumentKey: 'piano', output: busId },
        { id: busId, name: 'Music bus', instrumentKey: 'bus' },
      ],
      clips: [],
      master: { glueMix: { buses: [busId], changes: [{ trackId: 'k', field: 'output', from: null, to: busId }] } },
    };
    const p = parseProject(JSON.parse(JSON.stringify(raw)));
    assert.deepEqual(p.master.glueMix.buses, [p.tracks[1].id], busId);
    const off = removeGlue(p.tracks, p.master.glueMix);
    assert.deepEqual(off.map((t) => [t.id, t.output ?? null]), [['k', null]], busId);
  }
});
