// What changed between two songs, in plain words (src/agent/songDiff.ts), matched by id, with the
// bars to listen to. Run with `npm test`.
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
const { diffSongs, auditionRange, AUDITION_MAX_BARS } = await import('../src/agent/songDiff.ts');
const { createStarter } = await import('../src/store/starters.ts');

const base = () => createStarter('lofi');
const texts = (d) => d.changes.map((c) => c.text);

test('the same song: no changes', () => {
  const d = diffSongs(base(), base());
  assert.deepEqual(d.changes, []);
  assert.equal(d.bars, null);
});

test('levels, pans, mutes and names in plain words', () => {
  const a = base();
  const b = { ...a, tracks: a.tracks.map((t, i) => (i === 0 ? { ...t, volume: t.volume + 3, pan: -0.4, isMuted: true, name: 'Rhodes' } : t)) };
  const d = diffSongs(a, b);
  const t = texts(d);
  assert.ok(t.includes('Renames the track "Keys" to "Rhodes".'), t.join('\n'));
  assert.ok(t.some((x) => /^Turns "Rhodes" up by 3 dB \(-11\.5 dB to -8\.5 dB\)\.$/.test(x)), t.join('\n'));
  assert.ok(t.includes('Pans "Rhodes" to L40 (was C).'));
  assert.ok(t.includes('Mutes "Rhodes".'));
  assert.deepEqual(d.touchedTracks, [a.tracks[0].id]);
  assert.equal(d.bars, null);
  // A level change sits nowhere in particular: it's heard where the track first plays
  assert.deepEqual(d.audition, { fromBar: 1, toBar: 9 });
});

test('notes added, changed and removed, with their bars', () => {
  const a = base();
  const clip = a.clips[2];
  const notes = [...clip.notes.slice(1).map((n, i) => (i === 0 ? { ...n, velocity: 0.1 } : n)), { id: 'new', note: 'C3', startOffset: 6, duration: '4n', velocity: 0.8 }];
  const b = { ...a, clips: a.clips.map((c) => (c === clip ? { ...c, notes } : c)) };
  const d = diffSongs(a, b);
  assert.equal(d.changes.length, 1);
  assert.match(d.changes[0].text, /^In "Bass" on "Bass": adds 1 note, changes 1 note, removes 1 note in bars 5-11\.$/);
  assert.deepEqual(d.touchedClips, [clip.id]);
  assert.deepEqual(d.audition, { fromBar: 4, toBar: 12 });
});

test('clips, markers, tempo and master', () => {
  const a = base();
  const b = {
    ...a,
    bpm: 90,
    clips: [...a.clips.slice(1).map((c, i) => (i === 0 ? { ...c, startBar: c.startBar + 2 } : c)), { ...a.clips[0], id: 'c-new', name: 'Again', startBar: 17, notes: [] }],
    markers: a.markers.map((m, i) => (i === 1 ? { ...m, name: 'Verse' } : m)),
    master: { ...a.master, level: a.master.level + 1 },
  };
  const t = texts(diffSongs(a, b));
  for (const want of ['Changes the tempo from 82 to 90 BPM.', 'Renames the marker "Groove" to "Verse".', 'Removes the clip "Chords" from "Keys" (bars 1-16).', 'Adds the clip "Again" on "Keys" at bars 17-32.'])
    assert.ok(t.includes(want), `missing: ${want}\n${t.join('\n')}`);
  assert.ok(t.some((x) => /^Moves the clip "Dusty beat" from bar 5 to bar 7\.$/.test(x)), t.join('\n'));
  assert.ok(t.some((x) => /^Turns the master Level up by 1 dB/.test(x)));
});

test('the audition starts a bar before the change and is at most AUDITION_MAX_BARS long', () => {
  assert.deepEqual(auditionRange({ fromBar: 9, toBar: 10 }, { clips: [] }), { fromBar: 8, toBar: 10 });
  assert.deepEqual(auditionRange({ fromBar: 1, toBar: 3 }, { clips: [] }), { fromBar: 1, toBar: 3 });
  assert.deepEqual(auditionRange({ fromBar: 5, toBar: 80 }, { clips: [] }), { fromBar: 4, toBar: 4 + AUDITION_MAX_BARS });
});
