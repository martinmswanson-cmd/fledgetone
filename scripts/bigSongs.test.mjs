// A song with far more notes than any real one (a damaged or made-up file, or a short share link
// that unpacks to hundreds of thousands of notes) opens with the notes past the most a song opens
// with left out, and says so; nothing in the app works out a least or most by spreading a list
// into Math.min / Math.max (that overflows the call stack on a long list, and the studio stopped
// showing). So with tracks, clips, markers, tempo and time signature changes, lane points and the
// rest (songCaps.ts): opening a song takes time in step with its size (no list is searched once
// for each of its items), and an edit that would go past a cap isn't made. The app's own songs
// open exactly as before. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

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
const { maxOf, minOf } = await import('../src/support/minMax.ts');
const { parseProject, serializeProject, unreadWords, PROJECT_FORMAT, PROJECT_VERSION, MAX_CLIP_NOTES, MAX_SONG_NOTES } = await import('../src/store/project.ts');
const { projectFromHash, songLink } = await import('../src/store/shareLink.ts');
const { applyOps } = await import('../src/agent/ops.ts');
const { createStarter, STARTERS } = await import('../src/store/starters.ts');
const { SONG_CAPS, MAX_LANE_POINTS, MAX_SONG_POINTS, editPastCaps, pastCapsWords, capsWords } = await import('../src/store/songCaps.ts');

const notes = (n, prefix = 'n') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, note: 'C4', startOffset: (i % 64) / 16, duration: '16n', velocity: 0.8 }));
const song = (extra = {}) => ({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  name: 'Big',
  bpm: 120,
  tracks: [{ id: 't1', name: 'Keys', instrumentKey: 'piano' }],
  clips: [],
  ...extra,
});
const clip = (id, count) => ({ id, trackId: 't1', startBar: 1, lengthBars: 4, notes: notes(count, id) });

test('maxOf and minOf answer as Math.max and Math.min do', () => {
  const cases = [[], [3], [1, 5, 2], [-0, 0], [0, -0], [NaN, 1], [1, NaN], [-Infinity], [Infinity, -1]];
  for (const xs of cases) {
    assert.ok(Object.is(maxOf(xs), Math.max(...xs)), `max of ${xs}`);
    assert.ok(Object.is(minOf(xs), Math.min(...xs)), `min of ${xs}`);
    assert.ok(Object.is(maxOf(2, xs), Math.max(2, ...xs)), `max of 2 and ${xs}`);
    assert.ok(Object.is(minOf(xs, 2), Math.min(...xs, 2)), `min of ${xs} and 2`);
  }
  assert.equal(maxOf(1, [4, 2], new Set([7, 3]).values(), 5), 7);
  assert.equal(minOf(new Float32Array([0.5, -0.25]), 0), -0.25);
  assert.equal(maxOf(), -Infinity);
  assert.equal(minOf(), Infinity);
  // A list far past what a spread into a call takes
  const long = Array.from({ length: 500_000 }, (_, i) => (i * 7919) % 100_003);
  assert.throws(() => Math.max(...long), RangeError);
  assert.equal(maxOf(long), 100_002);
  assert.equal(minOf(long), 0);
});

test('nothing in the app spreads a list into Math.min or Math.max', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name)) files.push(p);
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  walk(new URL('../tools/cli/src', import.meta.url).pathname);
  const found = [];
  for (const f of files) {
    if (f.endsWith('support/minMax.ts')) continue;
    const s = readFileSync(f, 'utf8');
    const re = /Math\.(max|min)\(/g;
    let m;
    while ((m = re.exec(s))) {
      // The call's own arguments (depth 1), past strings: a spread there is `...list`
      let depth = 0;
      let quote = null;
      for (let i = m.index + m[0].length - 1; i < s.length; i++) {
        const ch = s[i];
        if (quote) {
          if (ch === '\\') i++;
          else if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') quote = ch;
        else if ('([{'.includes(ch)) depth++;
        else if (')]}'.includes(ch)) {
          if (--depth === 0) break;
        } else if (depth === 1 && s.startsWith('...', i)) {
          found.push(`${f.slice(f.indexOf('/src/') + 1)}:${s.slice(0, m.index).split('\n').length}`);
          break;
        }
      }
    }
  }
  assert.deepEqual(found, [], 'use maxOf / minOf (src/support/minMax.ts) for a list');
});

test("the caps are far above the app's own songs", () => {
  for (const { id } of STARTERS) {
    const p = createStarter(id);
    const all = p.clips.reduce((n, c) => n + c.notes.length, 0);
    assert.ok(maxOf(p.clips.map((c) => c.notes.length)) * 20 < MAX_CLIP_NOTES, id);
    assert.ok(all * 200 < MAX_SONG_NOTES, id);
    // ...and they open with every note, saying nothing was left out
    const back = parseProject(JSON.parse(JSON.stringify(serializeProject(p))));
    assert.equal(back.unread, undefined, id);
    assert.deepEqual(back.clips.map((c) => c.notes.length), p.clips.map((c) => c.notes.length), id);
  }
});

test('a clip past the cap keeps its first notes, and the song says how many were left out', () => {
  const p = parseProject(song({ clips: [clip('c1', MAX_CLIP_NOTES + 5000), clip('c2', 10)] }));
  assert.equal(p.clips[0].notes.length, MAX_CLIP_NOTES);
  assert.equal(p.clips[0].notes[0].id, 'c10');
  assert.equal(p.clips[1].notes.length, 10);
  assert.deepEqual(p.unread, { tracks: 0, clips: 0, notes: 5000 });
});

test('the whole song is capped too: takes, launcher slots and stingers count', () => {
  const clips = Array.from({ length: 12 }, (_, i) => clip(`c${i}`, MAX_CLIP_NOTES));
  const p = parseProject(song({ clips }));
  assert.equal(p.clips.reduce((n, c) => n + c.notes.length, 0), MAX_SONG_NOTES);
  assert.equal(p.unread.notes, 2 * MAX_CLIP_NOTES);
  // A take folder's takes, a launcher slot and a stinger, each past the cap
  const take = (id) => ({ id, name: id, notes: notes(MAX_CLIP_NOTES + 1, id) });
  const q = parseProject(
    song({
      tracks: [{ id: 't1', name: 'Keys', instrumentKey: 'piano', slots: [{ scene: 0, clip: { name: 'S', lengthBars: 4, notes: notes(MAX_CLIP_NOTES + 2, 's') } }] }],
      clips: [{ ...clip('c1', 1), takes: [take('a'), take('b')] }],
      stingers: [{ id: 'st', name: 'Hit', kind: 'victory', instrumentKey: 'piano', lengthBars: 2, notes: notes(MAX_CLIP_NOTES + 3, 'x') }],
    })
  );
  assert.equal(q.unread.notes, 1 + 1 + 2 + 3);
  assert.equal(q.tracks[0].slots[0].clip.notes.length, MAX_CLIP_NOTES);
  assert.ok(q.clips[0].takes.every((t) => t.notes.length === MAX_CLIP_NOTES));
  assert.equal(q.stingers[0].notes.length, MAX_CLIP_NOTES);
});

test('what was left out, in plain words', () => {
  assert.deepEqual(unreadWords({ tracks: 2, clips: 1 }), { parts: '2 tracks and 1 clip', over: '' });
  assert.deepEqual(unreadWords({ tracks: 0, clips: 0, notes: 180000 }), {
    parts: '',
    over: '180,000 notes over the most a song opens with (20,000 in a clip, 200,000 in all)',
  });
});

/** A share link (as the app makes them: see shareLink.ts) whose one clip says it has `count` notes, with `bytes` bytes of them. */
const bombLink = (count, bytes = count * 4) => {
  const json = Buffer.from(JSON.stringify({ version: PROJECT_VERSION, name: 'Tiny link', bpm: 120, tracks: [{ id: 't1', name: 'A', instrumentKey: 'piano' }], clips: [{ id: 'c1', trackId: 't1', startBar: 1, lengthBars: 4 }], p: ['C4'], l: ['8n'] }));
  const uint = (n) => {
    const out = [];
    for (let v = n; ; v = Math.floor(v / 128)) {
      if (v < 128) {
        out.push(v);
        return out;
      }
      out.push((v % 128) | 128);
    }
  };
  return '#s=' + deflateRawSync(Buffer.concat([Buffer.from(uint(json.length)), json, Buffer.from(uint(count)), Buffer.alloc(bytes, 0)]), { level: 9 }).toString('base64url');
};

test('a short link with 200,000 notes in a clip opens with the cap, saying what was left out', async () => {
  const hash = bombLink(200_000);
  assert.ok(hash.length < 2000, `a ${hash.length}-character link`);
  const p = await projectFromHash(hash);
  assert.equal(p.clips[0].notes.length, MAX_CLIP_NOTES);
  assert.deepEqual(p.unread, { tracks: 0, clips: 0, notes: 200_000 - MAX_CLIP_NOTES });
  // A link that says it has millions but hasn't the bytes for them is cut short, not made
  await assert.rejects(projectFromHash(bombLink(50_000_000, 100)), /cut short/);
});

test('a song under the caps goes through a link unchanged', async () => {
  const p = createStarter('celtic');
  const back = await projectFromHash(new URL(await songLink(p, 'https://example.test/')).hash);
  assert.equal(back.unread, undefined);
  assert.equal(back.clips.reduce((n, c) => n + c.notes.length, 0), p.clips.reduce((n, c) => n + c.notes.length, 0));
});

test("an agent's result over the cap is refused in plain words", () => {
  const base = createStarter('lofi');
  const full = { ...base.clips[0], notes: notes(MAX_CLIP_NOTES - 100, 'f') };
  const song = { ...base, clips: [full, ...base.clips.slice(1)] };
  const add = Array.from({ length: 200 }, (_, i) => ({ pitch: 'C4', start: (i % 16) / 16, length: 1 / 16 }));
  const out = applyOps(song, { opsVersion: 1, ops: [{ op: 'add_notes', clipId: full.id, notes: add }] }, { idBase: 'b' });
  assert.equal(out.ok, false);
  assert.match(out.errors[0].message, /^the result has 100 notes over the most a song opens with \(20,000 in a clip, 200,000 in all\) a saved file couldn't keep$/);
  // Under it, the same op is fine
  const fewer = applyOps(song, { opsVersion: 1, ops: [{ op: 'add_notes', clipId: full.id, notes: add.slice(0, 100) }] }, { idBase: 'b' });
  assert.equal(fewer.ok, true, JSON.stringify(fewer.errors));
});

/** The app's own songs, and the songs that come with it as files */
const ownSongs = () => [
  ...STARTERS.map(({ id }) => [id, serializeProject(createStarter(id))]),
  ...['scripts/fixtures/agent-song.fledgetone.json', 'scripts/fixtures/agent-song-edited.fledgetone.json', 'scripts/fixtures/render-song.fledgetone.json', 'site/video/courier.fledgetone.json', 'site/video/first-flight.fledgetone.json'].map((f) => [f, JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))]),
];

test("every cap is far above the app's own songs, and they open with all of it", () => {
  for (const [id, file] of ownSongs()) {
    const lanes = file.tracks.flatMap((t) => (t.automation ?? []).map((l) => l.points.length)).concat(file.clips.flatMap((c) => Object.values(c.expression ?? {}).map((l) => l.length)));
    assert.ok(file.tracks.length * 10 < SONG_CAPS.tracks, id);
    assert.ok(file.clips.length * 100 < SONG_CAPS.clips, id);
    assert.ok((file.markers?.length ?? 0) * 100 < SONG_CAPS.markers, id);
    assert.ok((file.tempoPoints?.length ?? 0) * 100 < SONG_CAPS.tempoPoints, id);
    assert.ok(maxOf(0, lanes) * 100 < MAX_LANE_POINTS, id);
    const back = parseProject(JSON.parse(JSON.stringify(file)));
    assert.equal(back.unread, undefined, id);
    assert.equal(back.tracks.length, file.tracks.length, id);
    assert.equal(back.clips.length, file.clips.length, id);
  }
});

test('a song with tens of thousands of clips (repeated ids among them) opens in time with its size, the first of each id kept', () => {
  const tracks = Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, instrumentKey: 'piano' }));
  const clips = Array.from({ length: SONG_CAPS.clips }, (_, i) => ({ id: `c${i % (SONG_CAPS.clips / 2)}`, trackId: `t${i % 50}`, startBar: 1 + (i % 300), lengthBars: 1, notes: [], name: i < SONG_CAPS.clips / 2 ? 'first' : 'repeat' }));
  const t = performance.now();
  const p = parseProject(song({ tracks, clips }));
  const ms = performance.now() - t;
  assert.equal(p.clips.length, SONG_CAPS.clips / 2);
  assert.ok(p.clips.every((c) => c.name === 'first'));
  // (Searching the list once for each clip took over a second at this size, twelve at 60,000)
  assert.ok(ms < 1500, `${Math.round(ms)} ms`);
  // (Nowhere that reads a song keeps the first of each id by searching the list again for each item)
  for (const f of ['src/store/project.ts', 'src/store/shareLink.ts', 'src/store/songCaps.ts', 'src/agent/ops.ts', 'src/agent/songDiff.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /\ball\.(findIndex|indexOf)\(/, f);
  }
  // Tracks too
  const twice = parseProject(song({ tracks: [...tracks, ...tracks.map((x) => ({ ...x, name: 'again' }))] }));
  assert.equal(twice.tracks.length, 50);
  assert.ok(twice.tracks.every((x) => x.name !== 'again'));
});

test('past the caps on tracks, clips, markers, tempo and time signature changes, stingers, takes and lane points: the first are kept, and the rest counted', () => {
  const over = 7;
  const tracks = Array.from({ length: SONG_CAPS.tracks + over }, (_, i) => ({ id: `t${i}`, name: `T${i}`, instrumentKey: 'piano' }));
  tracks[0].automation = [{ param: 'volume', points: Array.from({ length: MAX_LANE_POINTS + 3 }, (_, i) => ({ bar: 1 + i / 1000, value: 0.5 })) }];
  const clips = Array.from({ length: SONG_CAPS.clips + over }, (_, i) => ({ id: `c${i}`, trackId: 't1', startBar: 1 + (i % 300), lengthBars: 1, notes: [] }));
  clips[0] = { ...clips[0], takes: Array.from({ length: SONG_CAPS.takes + 2 }, (_, i) => ({ id: `k${i}`, name: `K${i}`, notes: [] })) };
  clips[1] = { ...clips[1], expression: { bend: Array.from({ length: MAX_LANE_POINTS + 4 }, (_, i) => ({ at: i / 100000, value: 0 })) } };
  const p = parseProject(
    song({
      tracks,
      clips,
      markers: Array.from({ length: SONG_CAPS.markers + over }, (_, i) => ({ id: `m${i}`, bar: 1 + (i % 400), name: 'M' })),
      tempoPoints: Array.from({ length: SONG_CAPS.tempoPoints + over }, (_, i) => ({ id: `p${i}`, bar: 1.01 + i / 20, bpm: 120 })),
      meterPoints: Array.from({ length: SONG_CAPS.meterPoints + over }, (_, i) => ({ id: `q${i}`, bar: 2 + i, num: 3, den: 4 })),
      stingers: Array.from({ length: SONG_CAPS.stingers + over }, (_, i) => ({ id: `s${i}`, name: 'Hit', kind: 'victory', instrumentKey: 'piano', lengthBars: 2, notes: [] })),
      transitions: Object.fromEntries(Array.from({ length: SONG_CAPS.transitions + over }, (_, i) => [`*>m${i}`, { kind: 'cut' }])),
    })
  );
  assert.equal(p.tracks.length, SONG_CAPS.tracks);
  assert.equal(p.tracks.at(-1).id, `t${SONG_CAPS.tracks - 1}`);
  assert.equal(p.clips.length, SONG_CAPS.clips);
  assert.equal(p.markers.length, SONG_CAPS.markers);
  assert.equal(p.tempoPoints.length, SONG_CAPS.tempoPoints);
  assert.equal(p.stingers.length, SONG_CAPS.stingers);
  assert.equal(p.clips.find((c) => c.id === 'c0').takes.length, SONG_CAPS.takes);
  assert.equal(p.tracks[0].automation[0].points.length, MAX_LANE_POINTS);
  assert.equal(p.clips.find((c) => c.id === 'c1').expression.bend.length, MAX_LANE_POINTS);
  assert.deepEqual(p.unread, {
    tracks: 0,
    clips: 0,
    over: { tracks: over, clips: over, markers: over, tempoPoints: over, meterPoints: over, stingers: over, transitions: over, takes: 2, points: 3 + 4 },
  });
  assert.equal(
    unreadWords(p.unread).over,
    '7 tracks, 7 clips, 7 markers, 7 tempo changes, 7 time signature changes, 2 takes, 7 stingers, 7 transition rules and 7 lane points over the most a song opens with (256 tracks, 10,000 clips, 5,000 markers, 4,000 tempo changes, 400 time signature changes, 256 takes in a clip, 200 stingers, 4,096 transition rules, 50,000 points in a lane, 500,000 in all)'
  );
  // A track left out takes its clips with it (counted as the track)
  const q = parseProject(song({ tracks: Array.from({ length: SONG_CAPS.tracks + 1 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, instrumentKey: 'piano' })), clips: [{ id: 'gone', trackId: `t${SONG_CAPS.tracks}`, startBar: 1, lengthBars: 1, notes: [] }] }));
  assert.deepEqual(q.unread, { tracks: 0, clips: 0, over: { tracks: 1 } });
  assert.equal(q.clips.length, 0);
});

test('lane points are capped in all too, and notes and parts left out are said together', () => {
  const lanes = Array.from({ length: 11 }, () => ({ bend: Array.from({ length: MAX_LANE_POINTS }, (_, i) => ({ at: i / 100000, value: 0 })) }));
  const p = parseProject(song({ clips: lanes.map((expression, i) => ({ ...clip(`c${i}`, 0), expression })) }));
  assert.equal(p.clips.reduce((n, c) => n + (c.expression?.bend?.length ?? 0), 0), MAX_SONG_POINTS);
  assert.deepEqual(p.unread.over, { points: MAX_LANE_POINTS });
  assert.equal(unreadWords({ tracks: 1, clips: 0, notes: 5, over: { markers: 1 } }).over, '1 marker and 5 notes over the most a song opens with (5,000 markers, 20,000 notes in a clip, 200,000 in all)');
  assert.equal(unreadWords({ tracks: 1, clips: 0, notes: 5, over: { markers: 1 } }).parts, '1 track');
});

test("a short link with more clips than a song opens with: its clips past the cap make no notes, and it says what was left out", async () => {
  const p = createStarter('lofi');
  const notes4 = notes(4, 'x');
  const clips = Array.from({ length: SONG_CAPS.clips + 30 }, (_, i) => ({ ...p.clips[0], id: `cl${i}`, startBar: 1 + (i % 300), notes: i >= SONG_CAPS.clips ? notes4 : [] }));
  const hash = new URL(await songLink({ ...p, clips }, 'https://example.test/')).hash;
  const back = await projectFromHash(hash);
  assert.equal(back.clips.length, SONG_CAPS.clips);
  assert.deepEqual(back.unread, { tracks: 0, clips: 0, over: { clips: 30 } });
  assert.ok(back.clips.every((c) => c.notes.length === 0));
});

test("an agent's result past the caps on markers or tracks is refused in plain words", () => {
  const base = createStarter('lofi');
  const full = { ...base, markers: Array.from({ length: SONG_CAPS.markers }, (_, i) => ({ id: `m${i}`, name: 'M', anchor: 'bar', bar: 1 + (i % 300) + i / 100000, seconds: 0 })) };
  const out = applyOps(full, { opsVersion: 1, ops: [{ op: 'add_marker', bar: 399.5, name: 'One more' }] }, { idBase: 'b' });
  assert.equal(out.ok, false);
  assert.equal(out.errors[0].message, "the result has 1 marker over the most a song opens with (5,000 markers) a saved file couldn't keep");
});

test('an edit that would go past a cap is refused; one that stays under, or makes a song already past one smaller, is made', () => {
  const t = { id: 't1' };
  const small = { tracks: [t], clips: [{ notes: [] }], markers: [] };
  const atCap = { ...small, clips: Array.from({ length: SONG_CAPS.clips }, () => ({ notes: [] })) };
  assert.deepEqual(editPastCaps(small, atCap), []);
  assert.deepEqual(editPastCaps(atCap, { ...atCap, clips: [...atCap.clips, { notes: [] }] }), ['clips']);
  // A clip doubled past the most notes in a clip (select all, duplicate), and the song past its most in all
  const big = { ...small, clips: [{ notes: new Array(MAX_CLIP_NOTES / 2 + 1).fill(0) }] };
  assert.deepEqual(editPastCaps(big, { ...big, clips: [{ notes: new Array(MAX_CLIP_NOTES + 2).fill(0) }] }), ['notes']);
  const many = { ...small, clips: Array.from({ length: 10 }, () => ({ notes: new Array(MAX_CLIP_NOTES).fill(0) })) };
  assert.deepEqual(editPastCaps(small, many), []);
  assert.deepEqual(editPastCaps(many, { ...many, clips: [...many.clips, { notes: [0] }] }), ['notes']);
  // Takes and launcher slots count; so do automation and expression points, tracks, markers
  assert.deepEqual(editPastCaps(small, { ...small, clips: [{ notes: [], takes: [{ notes: new Array(MAX_CLIP_NOTES + 1).fill(0) }] }] }), ['notes']);
  assert.deepEqual(editPastCaps(small, { ...small, tracks: [{ slots: [{ clip: { notes: new Array(MAX_CLIP_NOTES + 1).fill(0) } }] }] }), ['notes']);
  assert.deepEqual(editPastCaps(small, { ...small, tracks: [{ automation: [{ points: new Array(MAX_LANE_POINTS + 1).fill(0) }] }] }), ['points']);
  assert.deepEqual(editPastCaps(small, { ...small, tracks: Array.from({ length: SONG_CAPS.tracks + 1 }, () => t), markers: new Array(SONG_CAPS.markers + 1).fill(0) }), ['tracks', 'markers']);
  // Already past (an older version kept it): smaller is fine, more isn't
  const past = { ...small, markers: new Array(SONG_CAPS.markers + 10).fill(0) };
  assert.deepEqual(editPastCaps(past, { ...past, markers: past.markers.slice(1) }), []);
  assert.deepEqual(editPastCaps(past, { ...past, markers: [...past.markers, 0] }), ['markers']);
  assert.equal(pastCapsWords(['notes']), "That would go past the most a song can have (20,000 notes in a clip, 200,000 in all), so it wasn't done.");
  assert.equal(capsWords(['clips', 'tracks']), '256 tracks, 10,000 clips');
});

test('every edit to the song goes through the cap check (the store’s own set)', () => {
  const src = readFileSync(new URL('../src/store/timelineStore.ts', import.meta.url), 'utf8');
  const wrapper = src.slice(src.indexOf('function withLinkedClips'), src.indexOf('export const useTimelineStore'));
  assert.match(wrapper, /editPastCaps\(s, \{ \.\.\.s, \.\.\.next \}\)/);
  assert.match(wrapper, /return s;/);
});
