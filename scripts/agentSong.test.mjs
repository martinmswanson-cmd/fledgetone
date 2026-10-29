// The song as an agent reads it (src/agent/agentSong.ts): its shape, every starter under 30 KB,
// never a sound or a video in it, notes a page at a time, and detail left out (and said so) when a
// song is too big. Run with `npm test`.
import { register } from 'node:module';
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
const { toAgentSong, agentNotes, agentAutomation, AGENT_SONG_SCHEMA, AGENT_SONG_MAX_BYTES, MAX_NOTES_PER_CALL } = await import('../src/agent/agentSong.ts');
const { createStarter, STARTERS } = await import('../src/store/starters.ts');

const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

test('a starter as an agent reads it: ids, mix, sections, key', () => {
  const p = createStarter('lofi');
  const s = toAgentSong(p, { revision: 7, appVersion: '1.2.3' });
  assert.equal(s.schema, AGENT_SONG_SCHEMA);
  assert.equal(s.revision, 7);
  assert.equal(s.app.version, '1.2.3');
  assert.equal(s.tempo.bpm, 82);
  assert.equal(s.meter.base, '4/4');
  assert.equal(s.lengthBars, 16);
  assert.ok(s.lengthSeconds > 40 && s.lengthSeconds < 50);
  assert.deepEqual(s.tracks.map((t) => t.id), p.tracks.map((t) => t.id));
  assert.deepEqual(s.clips.map((c) => c.id), p.clips.map((c) => c.id));
  assert.deepEqual(s.markers.map((m) => m.name), ['Intro', 'Groove', 'Melody']);
  assert.deepEqual(s.sections.map((x) => [x.name, x.fromBar, x.toBar]), [['Intro', 1, 5], ['Groove', 5, 9], ['Melody', 9, 17]]);
  const drums = s.tracks.find((t) => t.role === 'drums');
  assert.ok(drums, 'the drums are called drums');
  const keys = s.tracks[0];
  assert.equal(keys.volumeDb, p.tracks[0].volume);
  // Only inserts that are on, and only their settings that differ from the defaults
  for (const t of s.tracks) for (const i of t.inserts) assert.ok(p.tracks.find((x) => x.id === t.id).fx[i.insert].on);
  assert.ok(s.clips.every((c) => c.kind === 'notes' && c.notes > 0 && c.range));
  assert.equal(typeof s.key, 'string');
});

test('every starter reads in under 30 KB, without anything left out', () => {
  for (const { id } of STARTERS) {
    const s = toAgentSong(createStarter(id));
    assert.ok(bytes(s) < AGENT_SONG_MAX_BYTES, `${id}: ${bytes(s)} bytes`);
    assert.deepEqual(s.omitted, [], id);
  }
});

test('never a sound, a video or a plugin state', () => {
  const p = createStarter('latin');
  const withMedia = {
    ...p,
    sounds: [{ id: 'snd1', name: 'Secret take', type: 'audio/wav', data: 'data:audio/wav;base64,UklGRg==' }],
    video: { key: 'v', name: 'Secret cut.mp4', type: 'video/mp4', start: 0, data: 'data:video/mp4;base64,AAAA' },
    tracks: p.tracks.map((t, i) => (i ? t : { ...t, plugin: { id: 'p', url: 'builtin:x/Y', name: 'Y', state: { secret: 'PLUGIN-STATE' } } })),
  };
  const text = JSON.stringify(toAgentSong(withMedia));
  for (const s of ['data:', 'Secret take', 'Secret cut', 'PLUGIN-STATE', 'base64']) assert.ok(!text.includes(s), `found ${s}`);
});

test('a song too big to read whole leaves detail out, and says what', () => {
  const p = createStarter('celtic');
  const s = toAgentSong(p, { maxBytes: 3000 });
  assert.ok(bytes(s) <= 3000, `${bytes(s)} bytes`);
  assert.ok(s.omitted.length >= 1);
  assert.ok(s.tracks.every((t) => t.inserts.every((i) => i.settings === undefined)));
});

test('notes a page at a time, in song order, with their ids', () => {
  const p = createStarter('celtic');
  const total = p.clips.reduce((n, c) => n + c.notes.filter((x) => x.startOffset < c.lengthBars).length, 0);
  const first = agentNotes(p, { limit: 100 });
  assert.equal(first.notes.length, 100);
  assert.equal(first.total, total);
  assert.equal(first.next, '100');
  let all = [...first.notes];
  let cursor = first.next;
  while (cursor) {
    const page = agentNotes(p, { limit: 100, cursor });
    all = all.concat(page.notes);
    cursor = page.next;
  }
  assert.equal(all.length, total);
  for (let i = 1; i < all.length; i++) assert.ok(all[i].bar >= all[i - 1].bar);
  assert.ok(agentNotes(p, { limit: 1e9 }).notes.length <= MAX_NOTES_PER_CALL);
  const clip = p.clips[1];
  const one = agentNotes(p, { clipId: clip.id });
  assert.ok(one.notes.every((n) => n.clipId === clip.id && n.bar === clip.startBar + n.start));
  const range = agentNotes(p, { fromBar: 5, toBar: 6 });
  assert.ok(range.notes.length > 0 && range.notes.every((n) => n.bar >= 5 && n.bar < 6));
});

test('automation lanes with every point', () => {
  const p = createStarter('lofi');
  const lane = { param: 'volume', points: [{ bar: 1, value: 0.5 }, { bar: 5, value: 0.8, curve: 0.3 }] };
  const q = { ...p, tracks: p.tracks.map((t, i) => (i === 1 ? { ...t, automation: [lane] } : t)) };
  const lanes = agentAutomation(q);
  assert.equal(lanes.length, 1);
  assert.deepEqual(lanes[0].points, lane.points);
  assert.equal(lanes[0].label, 'Volume');
  assert.equal(toAgentSong(q).tracks[1].automation[0].pointCount, 2);
});

test('a song with very many tracks or markers still fits, with tracks and clips both in it and what was left out said', () => {
  const p = createStarter('lofi');
  const tracks = Array.from({ length: 205 }, (_, i) => ({ ...p.tracks[0], id: `t${i}`, name: `Track number ${i} with a long-ish name` }));
  const clips = tracks.map((t, i) => ({ ...p.clips[0], id: `c${i}`, trackId: t.id, startBar: 1 + i, notes: p.clips[0].notes.slice(0, 1) }));
  const big = toAgentSong({ ...p, tracks, clips });
  assert.ok(bytes(big) <= AGENT_SONG_MAX_BYTES, `${bytes(big)} bytes`);
  assert.ok(big.tracks.length > 0 && big.clips.length > 0, 'tracks and clips both listed');
  assert.ok(big.clips.every((c) => big.tracks.some((t) => t.id === c.trackId)), "no clip of a track that isn't listed");
  assert.ok(big.omitted.some((o) => /^\d+ of 205 tracks, from "Track number \d+/.test(o)), big.omitted.join('\n'));

  const markers = Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, name: `Marker with a fairly long name ${i}`, bar: 1 + i, seconds: i * 2, anchor: 'bar' }));
  const marked = toAgentSong({ ...p, markers });
  assert.ok(bytes(marked) <= AGENT_SONG_MAX_BYTES, `${bytes(marked)} bytes`);
  assert.equal(marked.clips.length, p.clips.length, 'the clips are all there');
  assert.ok(marked.omitted.some((o) => /^\d+ of 400 markers, from bar \d+ on$/.test(o)), marked.omitted.join('\n'));

  // Clips crowded out entirely are said so plainly
  const tiny = toAgentSong(p, { maxBytes: 2600 });
  assert.ok(bytes(tiny) <= 2600, `${bytes(tiny)} bytes`);
  if (!tiny.clips.length) assert.ok(tiny.omitted.some((o) => /^all \d+ clips/.test(o)), tiny.omitted.join('\n'));
});
