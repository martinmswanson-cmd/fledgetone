// Share links (src/store/shareLink.ts): a song packed into "#s=...", opened back the same, and
// links in the older "#song=..." packing still opening.
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
const { isShareHash, projectFromHash, songLink } = await import('../src/store/shareLink.ts');
const { parseProject, PROJECT_FORMAT, PROJECT_VERSION, serializeProject } = await import('../src/store/project.ts');

const note = (id, n, at, duration = '8n', velocity = 0.8, expr) => ({ id, note: n, startOffset: at, duration, velocity, ...(expr ? { expr } : {}) });

/** A small song touching what a link carries: effects, sends, notes (a triplet, one before the clip, one bent), a stinger, a costume and a transition pointing at ids. */
const SONG = parseProject({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  name: 'Link test',
  bpm: 132,
  swing: 0.1,
  loopRegion: { inBar: 1, outBar: 5, enabled: true },
  tracks: [
    { id: 'track-lead-long-random-id', name: 'Lead', color: '#f472b6', instrumentKey: 'rhodes', isMuted: false, isSoloed: false, isArmed: false, volume: -9, pan: 0.25, eq: { low: 0, mid: 2, high: 0 }, reverbSend: 0.3, delaySend: 0, fx: { chorus: { on: true, rate: 0.8, depth: 0.5, mix: 0.3 } }, sends: [{ to: 'track-bass-long-random-id', level: 0.2 }] },
    { id: 'track-bass-long-random-id', name: 'Bass', color: '#155e75', instrumentKey: 'uprightBass', isMuted: true, isSoloed: false, isArmed: false, volume: -4, pan: 0, eq: { low: 0, mid: 0, high: 0 }, reverbSend: 0, delaySend: 0 },
  ],
  clips: [
    {
      id: 'clip-a',
      trackId: 'track-lead-long-random-id',
      name: 'Tune',
      startBar: 1,
      lengthBars: 2,
      notes: [note('n1', 'E4', 0.25, '4n', 0.65), note('n2', 'C4', 0), note('n3', 'G4', 1 / 6, '8t', 0.9), note('n4', 'A3', -0.125), note('n5', 'D5', 1, '2n', 0.7, { bend: [{ at: 0, value: 0 }, { at: 0.25, value: 2 }] })],
    },
    { id: 'clip-b', trackId: 'track-bass-long-random-id', name: 'Low', startBar: 3, lengthBars: 1, notes: [note('n6', 'C2', 0, '1m')] },
  ],
  stingers: [{ id: 'stinger-long-random-id', name: 'Win', kind: 'victory', instrumentKey: 'pluck', variation: 0, lengthBars: 1, notes: [note('s1', 'C5', 0, '16n'), note('s2', 'G5', 0.0625, '4n')] }],
  costumes: [{ id: 'costume-long-random-id', name: 'quiet', tempo: 1, tracks: { 'track-bass-long-random-id': { mute: true } } }],
  markers: [{ id: 'marker-long-random-id', name: 'Calm', anchor: 'bar', bar: 1, kind: 'section' }],
  transitions: { 'Calm>*': { kind: 'stinger', stingerId: 'stinger-long-random-id' } },
});

/** The song with ids by order of appearance and notes sorted, to compare a song before and after a link. */
function canon(p) {
  const d = serializeProject(p);
  const ids = new Map();
  for (const k of ['tracks', 'clips', 'markers', 'stingers', 'costumes']) for (const x of d[k] ?? []) ids.set(x.id, `${k}${ids.size}`);
  const sorted = (notes) => notes.map((n) => ({ ...n, id: '' })).sort((a, b) => a.startOffset - b.startOffset || a.note.localeCompare(b.note));
  d.clips = d.clips.map((c) => ({ ...c, notes: sorted(c.notes) }));
  d.stingers = d.stingers?.map((s) => ({ ...s, notes: sorted(s.notes) }));
  let s = JSON.stringify(d);
  for (const [a, b] of ids) s = s.replace(new RegExp(`(?<=[":])${a}(?=")`, 'g'), b);
  return JSON.parse(s);
}

test('a song comes back from its link as it was', async () => {
  const link = await songLink(SONG, 'https://example.com/app');
  assert.ok(link.startsWith('https://example.com/app#s='));
  const back = await projectFromHash(link.slice(link.indexOf('#')));
  assert.deepEqual(canon(back), canon(SONG));
  // The details most at risk: the muted track, the effect and send, the bent note, the costume's track
  assert.equal(back.tracks[1].isMuted, true);
  assert.equal(back.tracks[0].fx.chorus.on, true);
  assert.equal(back.tracks[0].fx.chorus.rate, 0.8);
  assert.equal(back.tracks[0].sends[0].to, back.tracks[1].id);
  assert.deepEqual(back.clips[0].notes.find((n) => n.note === 'D5').expr.bend[1], { at: 0.25, value: 2 });
  assert.ok(back.costumes[0].tracks[back.tracks[1].id]?.mute);
  assert.equal(back.stingers[0].notes.length, 2);
  assert.equal(Object.values(back.transitions)[0].stingerId, back.stingers[0].id);
});

test('the link leaves out the long ids and the settings at their defaults', async () => {
  const link = await songLink(SONG, '');
  const json = JSON.stringify(await projectFromHash(link));
  assert.ok(!json.includes('long-random-id'));
  // Packed, it is much shorter than the song written out
  assert.ok(link.length < JSON.stringify(serializeProject(SONG)).length / 4, `${link.length}`);
});

test('a link made before the tighter packing still opens', async () => {
  // songLink(SONG) as the app made it before ("#song=", notes as lists): see git history
  const OLD =
    '#song=7VfLbuM2FP2V4nZX0KkoS35oUWCSNMGgU7ToDNBF4AUtUTZrPhSSiscI9O_FpR6WH2ln0UUX2RiSzHN57utc8hVKYxXzkMHauMmaMz9Zm6-Typq_eO6BwAu3ThgNGSWgmeKQwSehd9957vDvdaUgo9OYgNsLvYEsuqEEpDHVH3wTcK8g9C2zwYCpfXhMCXDN1pIXkHlb84aAtyzfOcieXkEUkIGP4LghZwUQyI00FjL4vkzm8XoGBIR23taKa_8LP0AGdmsK7vAP92vt0XrJpOP4_tlIc_Lhg1Wj9xcja9xrsiRQMY1-xMjyGR2QZg9ZREAhs5jAVmy2kEUNActfuF1_5rpAxJRAwSU7dO8Eyq8IL4TzxvouGvjbbcqUqbUPyAbdU5XlzqGPJ8v81nK3NbKAbBJHBCzzwkCWEFBsx-sKsgDfGlu7HopRDSs5ml8gscoj6ZsU_fjab1oK6fnFhocKwy7NvmIOw5nX3pQlZDSKcH_ujGY6D6bn0ZxGs_mC0sUsTeYzAk4ahMdJQ6CqVXVmfCAyR0uSM8chm6Jdb8Vmg2RgJ_IdNFhHpTiD57Z2vR_eaA5ZGkjtQ44wBcE72hDYBO9P0G1AgP5IsXwGKksCkutNF6CGAM-35jwoQrXQBdZiyXmxZvkOAUnPZBaYVEJvfjfYC20S-minQ71cRCRnB8jim5hAZfk9lhBkmOnW7DKYHSVtWyt2XkteqK7_UgLFQTMlcte9VsLng2tVW9Mj6Jrpou28qzWQ19jopUVcEmFYhQ7V_Xwt_w0ZF-DRittyWQ52aHxp6CpyzaUcUGl0hqL_jom_EYQ9fcpxEZ0jRyRPo4TgcZjoVex5pFYNAbXOz7Ihzf6hZY4m0HL7Og0mmfdd1UV01D_RDU3HiTyRjGSQjGnPKUY_3tCVGEumXUYvlsWXtuhN2qyahoDjw_YGFZwCttULl0FN0d1e2-lR2287hem1naYpn6dXtL2urNhsfbd-EPg2id-u70mv71fFPXpT3P8_0n4iZTS0e69js0Em0ndtf9f2d21_1_b_RNubFYFcimp0Ps9j6A7tH8-P619qzYGA88z6_uTftuAtsy6coDVkT0_wcwKELmMCiQYyS1fkCe4SIBGBhQayiPDDI66JFwQWHsgyfPowBTJZzsar7lMg89mCQKyBzKPVcdbk01Oeo9HzyexPaE5PadKe5l0cOFEVdlthMBRzntuHMAPavr_vGz3pJsWXVlOQY_vhYSQrQTBKjOcUJ4s11YMNpLpCUczuuB2FWyVH3ndMKiDANM4F7Alm8SbWRdrx3IRSiY5EQxl6_5Zap70CBo0V-rGvbVP77rkhsBcFLr865mgQZ6NNGM_tnQ5PBF7ozYkf3ZeJNHozsUwXRk1EcfTtT4Hx2gmcsvAicm_s4cphoJJ1vsPbKbOCteM3IqCN5-O9Qq5NmAp3aZ_q38rScd9O9Np2YKAzHS670uTCH8KdaSghFx_tPF7auYlmeFUcGUsuba3Oait0lHG-VmPG3Zc3o_NcC45K5LmqTMh2f21-xcrOXkHVSLONP-7hLdNOIK-wCEvnpx_wqQtxlw8YcvXxH7LUNM3f';
  assert.ok(isShareHash(OLD));
  const back = await projectFromHash(OLD);
  // That packing left out a note's own expression (the new one keeps it)
  const withoutExpr = { ...SONG, clips: SONG.clips.map((c) => ({ ...c, notes: c.notes.map(({ expr: _expr, ...n }) => n) })) };
  assert.deepEqual(canon(back), canon(withoutExpr));
});

test('only song links are read', async () => {
  assert.equal(isShareHash('#settings'), false);
  assert.equal(await projectFromHash('#settings'), null);
  await assert.rejects(projectFromHash('#s=not-a-song'));
});

test('a link keeps mod wheel lanes as dynamics, and leaves a recorded room out', async () => {
  const lane = [{ at: 0, value: 0.2 }, { at: 1, value: 0.9 }];
  const song = { ...SONG, masterFx: { reverbDecay: 3, delayTime: '8n', delayFeedback: 0.3, room: 'hall-sound' }, clips: SONG.clips.map((c, i) => (i === 0 ? { ...c, expression: { mod: lane } } : c)) };
  const link = await songLink(song, 'https://example.com/app');
  const back = await projectFromHash(link.slice(link.indexOf('#')));
  assert.deepEqual(back.clips[0].expression.mod, lane);
  assert.equal(back.clips[0].expression.vibrato, undefined);
  assert.equal(back.masterFx.room, undefined);
  assert.equal(back.masterFx.reverbDecay, 3);
});

test("a game song's transition rules and state options, keyed by marker ids, survive the link", async () => {
  const game = {
    ...SONG,
    markers: [
      { id: 'marker-calm-long-random-id', name: 'Calm', anchor: 'bar', bar: 1, kind: 'section' },
      { id: 'marker-fight-long-random-id', name: 'Fight', anchor: 'bar', bar: 3, kind: 'section' },
    ],
    transitions: { 'marker-calm-long-random-id>marker-fight-long-random-id': { kind: 'stinger', stingerId: 'stinger-long-random-id' } },
    stateOptions: { 'marker-fight-long-random-id': { shuffleBars: 2 } },
  };
  const back = await projectFromHash((await songLink(game, '')).replace(/^[^#]*/, ''));
  const [calm, fight] = back.markers.map((m) => m.id);
  assert.deepEqual(Object.keys(back.transitions), [`${calm}>${fight}`]);
  assert.equal(back.transitions[`${calm}>${fight}`].stingerId, back.stingers[0].id);
  assert.deepEqual(back.stateOptions, { [fight]: { shuffleBars: 2 } });
});

test("a clip's measured groove feel, and one taken from audio, ride along in the link", async () => {
  const user = { id: 'user-k1', name: 'From audio 1', about: '', from: '8 bars at 124 BPM', bpm: 124, roles: { hats: { t: [0, 0.2, 0, 0.2, 0, 0.2, 0, 0.2, 0, 0.2, 0, 0.2, 0, 0.2, 0, 0.2], v: Array(16).fill(1) } } };
  const song = { ...SONG, clips: [{ ...SONG.clips[0], groove: { swing: 0, grid: 16, feel: { id: 'houseShuffle', amount: 0.7, role: 'lead' } } }, { ...SONG.clips[1], groove: { swing: 0, grid: 16, feel: { id: 'user-k1', amount: 1, user } } }] };
  const link = await songLink(song, 'https://example.com/app');
  const back = await projectFromHash(link.slice(link.indexOf('#')));
  assert.deepEqual(back.clips[0].groove.feel, { id: 'houseShuffle', amount: 0.7, role: 'lead' });
  assert.deepEqual(back.clips[1].groove.feel.user.roles, user.roles);
});
