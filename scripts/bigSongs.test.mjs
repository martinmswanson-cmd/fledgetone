// A song with far more notes than any real one (a damaged or made-up file, or a short share link
// that unpacks to hundreds of thousands of notes) opens with the notes past the most a song opens
// with left out, and says so; nothing in the app works out a least or most by spreading a list
// into Math.min / Math.max (that overflows the call stack on a long list, and the studio stopped
// showing). The app's own songs open exactly as before. Run with `npm test`.
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
  assert.deepEqual(unreadWords({ tracks: 2, clips: 1 }), { parts: '2 tracks and 1 clip', notes: '' });
  assert.deepEqual(unreadWords({ tracks: 0, clips: 0, notes: 180000 }), {
    parts: '',
    notes: '180,000 notes over the most a song opens with (20,000 in a clip, 200,000 in all)',
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
