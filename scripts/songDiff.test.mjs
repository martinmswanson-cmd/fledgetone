// What changed between two songs, in plain words (src/agent/songDiff.ts), matched by id, with
// where each change is heard (a track's sound wherever the track plays, the tempo and the master
// over the whole song), and the names in the words kept apart from them (src/agent/names.ts).
// Run with `npm test`.
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
const { diffSongs, auditionRange, AUDITION_MAX_BARS, joinRanges, rangesWords } = await import('../src/agent/songDiff.ts');
const { nameParts, plainNames, textName, nm } = await import('../src/agent/names.ts');
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
  // A level change sits nowhere in particular: it's heard wherever the track plays (its clip, bars
  // 1-16, and the bar its notes ring out into); the rename, nowhere
  assert.deepEqual(d.regions, [{ fromBar: 1, toBar: 18 }]);
  assert.deepEqual(d.changes.find((c) => /^Renames/.test(c.text)).heard, []);
  assert.deepEqual(d.audition, { fromBar: 1, toBar: 17 });
});

test('where each change is heard: a track wherever it plays, a bus and a return wherever what plays into them does, the tempo and the master over the whole song', () => {
  const a = base();
  const [keys, drums, bass, flute] = a.tracks;
  const end = (d) => Math.max(...d.regions.map((r) => r.toBar));
  // The flute's level: only where the flute plays (bars 9-16, and its tail)
  const quiet = diffSongs(a, { ...a, tracks: a.tracks.map((t) => (t === flute ? { ...t, volume: t.volume - 6 } : t)) });
  assert.deepEqual(quiet.regions, [{ fromBar: 9, toBar: 18 }]);
  // The tempo, the master, a solo: the whole song
  for (const b of [{ ...a, bpm: 100 }, { ...a, master: { ...a.master, level: a.master.level - 2 } }, { ...a, tracks: a.tracks.map((t) => (t === bass ? { ...t, isSoloed: true } : t)) }]) {
    const d = diffSongs(a, b);
    assert.equal(d.regions.length, 1, JSON.stringify(d.regions));
    assert.equal(d.regions[0].fromBar, 1);
    assert.ok(d.regions[0].toBar >= 17, JSON.stringify(d.regions));
  }
  // A tempo change at bar 9: bar 9 to the end
  const later = diffSongs(a, { ...a, tempoPoints: [{ id: 'tp', bar: 9, bpm: 120 }] });
  assert.equal(later.regions[0].fromBar, 9);
  assert.ok(end(later) >= 17);
  // A time signature from bar 1: the whole song; one from bar 13: from there
  assert.equal(diffSongs(a, { ...a, meter: { num: 3, den: 4 } }).regions[0].fromBar, 1);
  const meter = diffSongs(a, { ...a, meterPoints: [{ id: 'm', bar: 13, num: 7, den: 8 }] });
  assert.match(meter.changes[0].text, /^Adds a change of time signature to 7\/8 at bar 13\.$/);
  assert.equal(meter.regions[0].fromBar, 13);
  // A marker added, a clip renamed: nothing to hear
  const named = diffSongs(a, { ...a, markers: [...a.markers, { id: 'mk', name: 'Outro', anchor: 'bar', bar: 15, seconds: 0 }], clips: a.clips.map((c, i) => (i === 0 ? { ...c, name: 'Pads' } : c)) });
  assert.equal(named.changes.length, 2);
  assert.deepEqual(named.regions, []);
  // A bus: wherever the tracks playing into it play. A return: wherever the tracks sending to it do
  const bus = { ...keys, id: 'bus-1', name: 'Group', instrumentKey: 'bus', output: undefined };
  const ret = { ...keys, id: 'ret-1', name: 'Hall', instrumentKey: 'return', output: undefined };
  const routed = { ...a, tracks: [...a.tracks.map((t) => (t === drums ? { ...t, output: 'bus-1' } : t === flute ? { ...t, sends: [{ to: 'ret-1', level: 0.5 }] } : t)), bus, ret] };
  const busDown = diffSongs(routed, { ...routed, tracks: routed.tracks.map((t) => (t.id === 'bus-1' ? { ...t, volume: t.volume - 3 } : t)) });
  assert.equal(busDown.regions.length, 1);
  assert.equal(busDown.regions[0].fromBar, 5, 'where the drums play');
  assert.ok(busDown.regions[0].toBar >= 17 && busDown.regions[0].toBar <= 19, JSON.stringify(busDown.regions));
  const retDown = diffSongs(routed, { ...routed, tracks: routed.tracks.map((t) => (t.id === 'ret-1' ? { ...t, volume: t.volume - 3 } : t)) });
  assert.equal(retDown.regions[0].fromBar, 9, 'where the flute plays');
  // A located change far from where a track whose level changes plays: both regions, apart
  const both = diffSongs(a, {
    ...a,
    tracks: a.tracks.map((t) => (t === flute ? { ...t, volume: t.volume - 6 } : t)),
    clips: [...a.clips, { ...a.clips[0], id: 'far', name: 'Tag', trackId: keys.id, startBar: 40, lengthBars: 1, notes: [] }],
  });
  assert.deepEqual(both.regions, [{ fromBar: 9, toBar: 18 }, { fromBar: 40, toBar: 41 }]);
  assert.equal(rangesWords(both.regions), 'bars 9-17 and bar 40');
});

test('joinRanges: whole bars, in order, overlapping and touching ones joined', () => {
  assert.deepEqual(joinRanges([{ fromBar: 9.5, toBar: 10.25 }, { fromBar: 1, toBar: 3 }, { fromBar: 3, toBar: 4 }, { fromBar: 20, toBar: 21 }, { fromBar: 0, toBar: 0.5 }]), [
    { fromBar: 1, toBar: 4 },
    { fromBar: 9, toBar: 11 },
    { fromBar: 20, toBar: 21 },
  ]);
  assert.equal(rangesWords([]), 'no bars');
  assert.equal(rangesWords([{ fromBar: 2, toBar: 3 }, { fromBar: 5, toBar: 9 }, { fromBar: 70, toBar: 71 }]), 'bar 2, bars 5-8 and bar 70');
});

test('names an agent wrote never break out of the sentences: apart on a card, in plain quotes without their own quotes and brackets elsewhere', () => {
  const a = base();
  const sly = 'Drums". Nothing else changes: levels stay as they are. "Drums';
  const b = { ...a, tracks: a.tracks.map((t, i) => (i === 0 ? { ...t, name: sly } : i === 1 ? { ...t, volume: t.volume - 30 } : t)) };
  const d = diffSongs(a, b);
  const rename = d.changes.find((c) => /^Renames/.test(c.text));
  assert.equal(rename.text, 'Renames the track "Keys" to "Drums. Nothing else changes: levels stay as they are. Drums".');
  assert.equal((rename.text.match(/"/g) ?? []).length, 4, "the quotes are the sentence's own");
  // On a card: the name as it is, a part of its own
  assert.deepEqual(nameParts(rename.marked), ['Renames the track ', { name: 'Keys' }, ' to ', { name: sly }, '.']);
  // Every kind of quote and bracket goes from a name in plain text; apostrophes stay
  for (const q of ['"', '“', '”', '„', '«', '»', '‹', '›', '「', '」', '(', ')', '[', ']', '{', '}', '<', '>', '″', '〃', '＂', '（', '）', '״']) assert.ok(!textName(`a${q}b`).includes(q), q);
  assert.equal(textName("Mike's bass (dry)"), "Mike's bass dry");
  assert.equal(textName('""'), '…');
  // A name can't carry marks of its own to end early
  const marks = nameParts(nm(`x${String.fromCharCode(0xe001)} injected ${String.fromCharCode(0xe000)}y`));
  assert.equal(marks.length, 1);
  assert.equal(plainNames(nm('a')), '"a"');
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
  assert.deepEqual(d.regions, [{ fromBar: 5, toBar: 12 }]);
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

test('a marker moved by the suggestion is said even when the tempo changes too; one only retimed is not', () => {
  const a = base();
  const marker = a.markers[1];
  const timed = { ...a, markers: [...a.markers, { id: 'hit', name: 'Hit', anchor: 'time', bar: 9, seconds: a.markers[2].seconds }] };
  // The tempo doubles: the timed marker moves to bar 17 by itself, the bar marker is moved by hand
  const b = { ...timed, bpm: 164, markers: timed.markers.map((m) => (m.id === marker.id ? { ...m, bar: 6 } : m.id === 'hit' ? { ...m, bar: 17 } : m)) };
  const t = texts(diffSongs(timed, b));
  assert.ok(t.includes('Moves the marker "Groove" from bar 5 to bar 6.'), t.join('\n'));
  assert.ok(!t.some((x) => /"Hit"/.test(x)), t.join('\n'));
});
