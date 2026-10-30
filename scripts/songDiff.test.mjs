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
  // 1-16, and the bars its notes ring out into: its release, and the master reverb it sends to); the rename, nowhere
  assert.deepEqual(d.regions, [{ fromBar: 1, toBar: 19 }]);
  assert.deepEqual(d.changes.find((c) => /^Renames/.test(c.text)).heard, []);
  assert.deepEqual(d.audition, { fromBar: 1, toBar: 17 });
});

test('where each change is heard: a track wherever it plays, a bus and a return wherever what plays into them does, the tempo and the master over the whole song', () => {
  const a = base();
  const [keys, drums, bass, flute] = a.tracks;
  const end = (d) => Math.max(...d.regions.map((r) => r.toBar));
  // The flute's level: only where the flute plays (bars 9-16, and its tail: its release, and the master reverb and delay it sends to)
  const quiet = diffSongs(a, { ...a, tracks: a.tracks.map((t) => (t === flute ? { ...t, volume: t.volume - 6 } : t)) });
  assert.deepEqual(quiet.regions, [{ fromBar: 9, toBar: 20 }]);
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
  // (and the drums' tail through the bus, and the master reverb the bus sends to)
  assert.ok(busDown.regions[0].toBar >= 17 && busDown.regions[0].toBar <= 21, JSON.stringify(busDown.regions));
  const retDown = diffSongs(routed, { ...routed, tracks: routed.tracks.map((t) => (t.id === 'ret-1' ? { ...t, volume: t.volume - 3 } : t)) });
  assert.equal(retDown.regions[0].fromBar, 9, 'where the flute plays');
  // A located change far from where a track whose level changes plays: both regions, apart
  const both = diffSongs(a, {
    ...a,
    tracks: a.tracks.map((t) => (t === flute ? { ...t, volume: t.volume - 6 } : t)),
    clips: [...a.clips, { ...a.clips[0], id: 'far', name: 'Tag', trackId: keys.id, startBar: 40, lengthBars: 1, notes: [], expression: undefined }],
  });
  // (the clip with the tail of what it would play: the keys' release and effects, and the master reverb they send to)
  assert.deepEqual(both.regions, [{ fromBar: 9, toBar: 20 }, { fromBar: 40, toBar: 43 }]);
  assert.equal(rangesWords(both.regions), 'bars 9-19 and bars 40-42');
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
  // (the upright bass plays its takes in turn: a note more or less moves every later note of the
  // track onto the other take, so it's heard to where the track stops, see noteMemory.ts)
  assert.deepEqual(d.regions, [{ fromBar: 5, toBar: 18 }]);
  assert.deepEqual(d.audition, { fromBar: 4, toBar: 18 });
  // On an instrument that plays every note the same whatever came before: its bars and their tail
  const as = (key) => (s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === clip.trackId ? { ...t, instrumentKey: key } : t)) });
  const alone = diffSongs(as('pluck')(a), as('pluck')(b));
  assert.deepEqual(alone.regions, [{ fromBar: 5, toBar: 13 }]);
  assert.deepEqual(alone.audition, { fromBar: 4, toBar: 13 });
  // (a recorded piano can cut a note still ringing for a newer one, see noteMemory.ts 'cuts': along
  // the notes ringing into each other, here the whole clip, and the piano's longer tail)
  assert.deepEqual(diffSongs(as('realGrandPiano')(a), as('realGrandPiano')(b)).regions, [{ fromBar: 5, toBar: 20 }]);
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

test('never fewer bars than the truth: a lane is heard wherever its track plays, not only at its points', () => {
  const a = base();
  const keys = a.tracks[0];
  const where = (b) => diffSongs(a, b).regions;
  const all = diffSongs(a, { ...a, tracks: a.tracks.map((t) => (t === keys ? { ...t, volume: t.volume - 3 } : t)) }).regions;
  const lane = (points, param = 'volume') => ({ ...a, tracks: a.tracks.map((t) => (t === keys ? { ...t, automation: [{ param, points }] } : t)) });
  // (scan r5: one point at bar 8 holds its value from bar 1 on, and to the end)
  assert.deepEqual(where(lane([{ bar: 8, value: 0 }])), all);
  for (const param of ['pan', 'send:reverb', 'fx:distortion.amount', 'inst:cutoff']) assert.deepEqual(where(lane([{ bar: 8, value: 0.2 }], param)), all, param);
  // A point redrawn in the middle, or the last one: the whole of where the track plays (the lane moves from the point before)
  const drawn = lane([{ bar: 1, value: 0.8 }, { bar: 9, value: 0.8 }, { bar: 16, value: 0.8 }]);
  for (const v of [[0.8, 0, 0.8], [0.8, 0.8, 0]]) {
    const redrawn = { ...drawn, tracks: drawn.tracks.map((t) => (t.id === keys.id ? { ...t, automation: [{ param: 'volume', points: [{ bar: 1, value: v[0] }, { bar: 9, value: v[1] }, { bar: 16, value: v[2] }] }] } : t)) };
    const d = diffSongs(drawn, redrawn);
    assert.equal(d.changes[0].hear, 'track');
    assert.deepEqual(d.regions, all, JSON.stringify(v));
  }
  // Taken away: the same
  assert.deepEqual(diffSongs(drawn, a).regions, all);
});

test('never fewer bars than the truth: a glide is heard from where it starts, before its own bar', () => {
  const a = base();
  const end = Math.max(...diffSongs(a, { ...a, bpm: 100 }).regions.map((r) => r.toBar));
  // (scan r5: a glide to bar 24, after the clips end, speeds up every bar from bar 1)
  const late = diffSongs(a, { ...a, tempoPoints: [{ id: 'g', bar: 24, bpm: 160, ramp: true }] });
  assert.equal(late.regions[0].fromBar, 1);
  assert.ok(late.regions.at(-1).toBar >= end);
  const inside = diffSongs(a, { ...a, tempoPoints: [{ id: 'g', bar: 9, bpm: 120, ramp: true }] });
  assert.deepEqual(inside.regions.map((r) => r.fromBar), [1]);
  // With a point before it: from that point
  const two = { ...a, tempoPoints: [{ id: 'p', bar: 5, bpm: 90, ramp: false }] };
  assert.equal(diffSongs(two, { ...two, tempoPoints: [...two.tempoPoints, { id: 'g', bar: 13, bpm: 120, ramp: true }] }).regions[0].fromBar, 5);
  // A jump: from its own bar; a jump whose next point glides into it: from the point before it (the glide starts there)
  assert.equal(diffSongs(two, { ...two, tempoPoints: [...two.tempoPoints, { id: 'j', bar: 13, bpm: 120, ramp: false }] }).regions[0].fromBar, 13);
  const glide = { ...a, tempoPoints: [{ id: 'p', bar: 5, bpm: 90, ramp: false }, { id: 'q', bar: 9, bpm: 100, ramp: false }, { id: 'g', bar: 13, bpm: 140, ramp: true }] };
  const moved = diffSongs(glide, { ...glide, tempoPoints: glide.tempoPoints.map((p) => (p.id === 'q' ? { ...p, bpm: 110 } : p)) });
  assert.equal(moved.regions[0].fromBar, 5);
  // A glide taken away: from the point before it too
  assert.equal(diffSongs(glide, { ...glide, tempoPoints: glide.tempoPoints.filter((p) => p.id !== 'g') }).regions[0].fromBar, 9);
});

test('never fewer bars than the truth: a clip with controller lanes changes the clips after it; notes ring out; what is not known is the whole song', () => {
  const a = base();
  const keys = a.tracks[0];
  const first = { ...a.clips.find((c) => c.trackId === keys.id), id: 'held', startBar: 1, lengthBars: 4, expression: { sustain: [{ at: 0, value: 1 }] } };
  const later = { ...first, id: 'later', startBar: 21, lengthBars: 4, expression: undefined };
  const song = { ...a, clips: [...a.clips.filter((c) => c.trackId !== keys.id), first, later] };
  const all = diffSongs(song, { ...song, tracks: song.tracks.map((t) => (t.id === keys.id ? { ...t, volume: t.volume - 3 } : t)) }).regions;
  assert.ok(all.some((r) => r.fromBar <= 21 && r.toBar >= 25), JSON.stringify(all));
  // (scan r5: removed, moved or made shorter, what its lanes held is gone from the later clips too)
  const ops = [
    { ...song, clips: song.clips.filter((c) => c.id !== 'held') },
    { ...song, clips: song.clips.map((c) => (c.id === 'held' ? { ...c, startBar: 2 } : c)) },
    { ...song, clips: song.clips.map((c) => (c.id === 'held' ? { ...c, lengthBars: 2 } : c)) },
  ];
  const holds = (regions, r) => regions.some((x) => x.fromBar <= r.fromBar && x.toBar >= r.toBar);
  // (wherever the track plays, as it is and as it would be: a clip moved later plays later too)
  for (const b of ops) {
    const regions = diffSongs(song, b).regions;
    assert.ok(all.every((r) => holds(regions, r)), JSON.stringify(regions));
  }
  // A clip without lanes: its bars, and the tail of its notes
  const plain = { ...song, clips: song.clips.map((c) => (c.id === 'held' ? { ...c, expression: undefined } : c)) };
  const gone = diffSongs(plain, { ...plain, clips: plain.clips.filter((c) => c.id !== 'held') });
  assert.equal(gone.regions[0].fromBar, 1);
  assert.ok(gone.regions[0].toBar > 5 && gone.regions[0].toBar < 21, JSON.stringify(gone.regions));
  // A note added at the end of a clip: heard past the clip's end, as it rings out (release and effects)
  const clip = plain.clips.find((c) => c.id === 'later');
  const added = diffSongs(plain, { ...plain, clips: plain.clips.map((c) => (c === clip ? { ...c, notes: [...c.notes, { id: 'n', note: 'C5', startOffset: 3.75, duration: '16n', velocity: 1 }] } : c)) });
  assert.equal(added.regions.length, 1);
  assert.equal(added.regions[0].fromBar, 24);
  assert.ok(added.regions[0].toBar >= 26, JSON.stringify(added.regions));
  // A setting of a track the diff knows nothing of: the whole song
  const odd = diffSongs(a, { ...a, tracks: a.tracks.map((t) => (t === keys ? { ...t, someNewSetting: 3 } : t)) });
  assert.equal(odd.changes[0].hear, 'song');
  assert.equal(odd.regions[0].fromBar, 1);
});

test('never fewer bars than the truth: a track tail is as long as its effects ring, through the buses, returns and master effects it feeds (scan r6)', async () => {
  const { trackTails, EFFECT_TAIL_SECONDS } = await import('../src/agent/songDiff.ts');
  const { echoRepeats } = await import('../src/audio/effectTails.ts');
  const a = base();
  const keys = a.tracks[0];
  const plain = { ...a, bpm: 120, tempoPoints: [], masterFx: { reverbDecay: 1, delayTime: '8n', delayFeedback: 0.35 }, tracks: a.tracks.map((t) => ({ ...t, reverbSend: 0, delaySend: 0, distance: 0 })) };
  const withKeys = (song, patch) => ({ ...song, tracks: song.tracks.map((t) => (t.id === keys.id ? { ...t, ...patch(t) } : t)) });
  const tail = (song, id = keys.id) => trackTails([song])(id);
  const bare = tail(plain).seconds;
  // A half-note echo fed back by 0.85 at 120 BPM: a repeat a second, until they've fallen 60 dB
  const echo = withKeys(plain, (t) => ({ fx: { ...t.fx, echo: { ...t.fx.echo, on: true, time: '1/2', feedback: 0.85, mix: 0.5 } } }));
  const echoTail = tail(echo).seconds - bare;
  assert.ok(Math.abs(echoTail - (echoRepeats(0.85) + 1)) < 1e-6, String(echoTail));
  assert.ok(echoTail > 40, 'far past the old 1.5 seconds');
  // A note added on bar 3: heard until the echoes die away, not one bar and a half later
  const clip = echo.clips.find((c) => c.trackId === keys.id);
  const added = diffSongs(echo, { ...echo, clips: echo.clips.map((c) => (c === clip ? { ...c, notes: [...c.notes, { id: 'n', note: 'C5', startOffset: 2, duration: '32n', velocity: 1 }] } : c)) });
  assert.ok(added.regions[0].toBar >= clip.startBar + 2 + echoTail / 2, JSON.stringify(added.regions));
  // Its feedback moved by a lane: at its highest
  const moved = withKeys(echo, (t) => ({ fx: { ...t.fx, echo: { ...t.fx.echo, feedback: 0.1 } }, automation: [{ id: 'l', param: 'fx:echo.feedback', points: [{ bar: 1, value: 0.1 }] }] }));
  assert.ok(Math.abs(tail(moved).seconds - bare - (echoRepeats(0.9) + 1)) < 1e-6);
  // At the song's slowest tempo
  const slow = { ...echo, tempoPoints: [{ id: 'tp', bar: 9, bpm: 60 }] };
  assert.ok(tail(slow).seconds - bare > 2 * echoTail - 1e-6);
  // A long reverb of its own
  const room = withKeys(plain, (t) => ({ fx: { ...t.fx, reverb: { ...t.fx.reverb, on: true, decay: 12, mix: 0.6 } } }));
  assert.ok(tail(room).seconds - bare >= 12);
  // Through a bus with an echo, and a return with a reverb: each added on the way out
  const bus = { ...keys, id: 'bus-1', name: 'Group', instrumentKey: 'bus', output: undefined, sends: undefined, fx: echo.tracks[0].fx };
  const ret = { ...keys, id: 'ret-1', name: 'Hall', instrumentKey: 'return', output: undefined, sends: undefined, fx: room.tracks[0].fx };
  const routed = { ...plain, tracks: [...withKeys(plain, () => ({ output: 'bus-1' })).tracks, bus, ret] };
  assert.ok(tail(routed).seconds - bare >= echoTail + EFFECT_TAIL_SECONDS - 1e-6, 'through the bus');
  const sent = { ...plain, tracks: [...withKeys(plain, () => ({ sends: [{ to: 'ret-1', level: 0.2 }] })).tracks, bus, ret] };
  assert.ok(tail(sent).seconds - bare >= 12, 'through the return');
  // The master delay and reverb, when it sends to them (or a lane moves its send)
  const delayed = withKeys({ ...plain, masterFx: { ...plain.masterFx, delayTime: '4n', delayFeedback: 0.8 } }, () => ({ delaySend: 0.2 }));
  assert.ok(tail(delayed).seconds - bare > 15, String(tail(delayed).seconds));
  const laned = withKeys({ ...plain, masterFx: { ...plain.masterFx, reverbDecay: 10 } }, () => ({ automation: [{ id: 'r', param: 'reverbSend', points: [{ bar: 1, value: 0 }] }] }));
  assert.ok(tail(laned).seconds - bare >= 10);
  // Known tails are sure; a plugin effect's or a plugin instrument's isn't
  assert.equal(tail(echo).sure, true);
  assert.equal(added.sure, true);
  const fx = withKeys(plain, () => ({ pluginFx: [{ id: 'p', url: 'https://example.invalid/fx/index.js', name: 'Space' }] }));
  assert.equal(tail(fx).sure, false);
  assert.equal(tail(withKeys(plain, () => ({ pluginFx: [{ id: 'p', url: 'x', name: 'Space', bypass: true }] }))).sure, true, 'bypassed: not heard');
  assert.equal(tail(withKeys(plain, () => ({ instrumentKey: 'plugin', plugin: { id: 'i', url: 'x', name: 'Synth' } }))).sure, false);
  // A track playing into a bus with a plugin effect: not sure either, and so neither is a change heard there
  const unsureBus = { ...plain, tracks: [...withKeys(plain, () => ({ output: 'bus-1' })).tracks, { ...bus, pluginFx: [{ id: 'p', url: 'x', name: 'Space' }] }] };
  assert.equal(tail(unsureBus).sure, false);
  const busDown = diffSongs(unsureBus, { ...unsureBus, tracks: unsureBus.tracks.map((t) => (t.id === 'bus-1' ? { ...t, volume: t.volume - 3 } : t)) });
  assert.equal(busDown.sure, false);
  // A synth's own long release and an 808's decay count
  assert.ok(tail(withKeys(plain, () => ({ instrumentKey: 'synthDesigner', synth: { amp: { attack: 0, decay: 0, sustain: 1, release: 9 } } }))).seconds >= 9);
  assert.ok(tail(withKeys(plain, () => ({ instrumentKey: 'bass808', bass808: { decay: 8 } }))).seconds >= 8);
});

test('never fewer bars than the truth: a tail counts every way a setting can move, automation, controller lanes (CC 91, CC 93, MIDI learn) and step lanes alike (scan r7)', async () => {
  const { trackTails } = await import('../src/agent/songDiff.ts');
  const { echoRepeats } = await import('../src/audio/effectTails.ts');
  const a = base();
  const keys = a.tracks[0];
  const clip = a.clips.find((c) => c.trackId === keys.id);
  // No sends, no echo of its own; the master delay fed back by 0.8 (a long tail when anything reaches it)
  const plain = {
    ...a,
    bpm: 120,
    tempoPoints: [],
    masterFx: { reverbDecay: 1, delayTime: '4n', delayFeedback: 0.8 },
    tracks: a.tracks.map((t) => ({ ...t, reverbSend: 0, delaySend: 0, distance: 0, automation: [], midiMap: undefined, fx: { ...t.fx, echo: { ...t.fx.echo, on: false }, reverb: { ...t.fx.reverb, on: false }, pump: { ...t.fx.pump, on: false } } })),
    clips: a.clips.map((c) => ({ ...c, expression: undefined, stepLanes: undefined })),
  };
  const withKeys = (song, patch) => ({ ...song, tracks: song.tracks.map((t) => (t.id === keys.id ? { ...t, ...patch(t) } : t)) });
  const withClip = (song, patch) => ({ ...song, clips: song.clips.map((c) => (c.id === clip.id ? { ...c, ...patch(c) } : c)) });
  const tail = (song) => trackTails([song])(keys.id).seconds;
  const bare = tail(plain);
  const fed = tail(withKeys(plain, () => ({ delaySend: 0.5 })));
  assert.ok(fed - bare > 15, 'the master delay rings on');
  // The send moved by the track's automation, its clip's CC 93 lane, or its clip's step lane: each the same as a send
  const ways = {
    automation: withKeys(plain, () => ({ automation: [{ id: 'l', param: 'delaySend', points: [{ bar: 1, value: 1 }] }] })),
    cc93: withClip(plain, () => ({ expression: { cc93: [{ at: 0, value: 1 }] } })),
    step: withClip(plain, () => ({ stepLanes: [{ id: 's', target: 'delaySend', grid: 6, steps: [{ at: 0, value: 1 }] }] })),
  };
  for (const [way, song] of Object.entries(ways)) assert.ok(Math.abs(tail(song) - fed) < 1e-6, `${way}: ${tail(song)} vs ${fed}`);
  // CC 91 reaches the master reverb
  const roomy = { ...plain, masterFx: { ...plain.masterFx, reverbDecay: 10 } };
  assert.ok(tail(withClip(roomy, () => ({ expression: { cc91: [{ at: 0, value: 1 }] } }))) - tail(roomy) >= 10, 'CC 91');
  // A controller mapped by MIDI learn to the echo's feedback: at its highest
  const echo = withKeys(plain, (t) => ({ fx: { ...t.fx, echo: { ...t.fx.echo, on: true, time: '1/2', feedback: 0.05, mix: 0.5 } } }));
  const learned = withClip(withKeys(echo, () => ({ midiMap: [{ cc: 20, param: 'fx:echo.feedback' }] })), () => ({ expression: { cc20: [{ at: 0, value: 1 }] } }));
  assert.ok(Math.abs(tail(learned) - bare - (echoRepeats(0.9) + 1)) < 1e-6, String(tail(learned) - bare));
  // ...and by a step lane
  const stepped = withClip(echo, () => ({ stepLanes: [{ id: 's', target: 'fx:echo.feedback', grid: 6, steps: [{ at: 0, value: 1 }] }] }));
  assert.ok(Math.abs(tail(stepped) - tail(learned)) < 1e-6);
  // A note added under each: heard until the echoes die away, and the rules sure of it
  const late = (song) => ({ ...song, clips: [...song.clips, { ...clip, id: 'late', startBar: 60, notes: clip.notes.slice(0, 1) }] });
  for (const [way, song] of Object.entries({ ...ways, learned, stepped })) {
    const before = late(song);
    const after = { ...before, clips: before.clips.map((c) => (c.id === clip.id ? { ...c, notes: [...c.notes, { id: 'n', note: 'C5', startOffset: 0.5, duration: '32n', velocity: 1 }] } : c)) };
    const d = diffSongs(before, after);
    const needs = clip.startBar + 0.5 + (tail(song) - bare) / 2;
    assert.ok(d.regions[0].toBar >= needs, `${way}: ${JSON.stringify(d.regions)} short of ${needs}`);
    assert.equal(d.sure, true, way);
  }
  // A lane for a setting not known here: not sure
  assert.equal(trackTails([withKeys(plain, () => ({ automation: [{ id: 'x', param: 'fx:echo.time', points: [{ bar: 1, value: 1 }] }] }))])(keys.id).sure, false);
});

test('chainTail: one stage after another, the longest way out through buses and returns, then the master (shared with the export\'s ring-out, scan r7)', async () => {
  const { chainTail } = await import('../src/audio/effectTails.ts');
  const a = base();
  const [lead, other] = a.tracks;
  const bus = { ...other, id: 'bus-1', instrumentKey: 'bus', output: undefined, sends: undefined };
  const ret = { ...other, id: 'ret-1', instrumentKey: 'return', output: undefined, sends: undefined };
  const own = { [lead.id]: 4, 'bus-1': 2, 'ret-1': 10 };
  const stage = (t) => ({ seconds: own[t.id] ?? 0, sure: t.id !== 'bus-1' });
  const master = (t) => (t.id === 'ret-1' ? 3 : 1);
  const tracks = [{ ...lead, output: 'bus-1', sends: [{ to: 'ret-1', level: 0.5 }] }, bus, ret];
  // 4 s of its own, then the return's 10 s and the master's 3 s: longer than through the bus (2 + 1)
  assert.deepEqual(chainTail(tracks[0], tracks, stage, master), { seconds: 17, sure: false });
  // Alone: its own and the master's
  assert.deepEqual(chainTail({ ...lead, output: undefined, sends: undefined }, tracks, stage, master), { seconds: 5, sure: true });
  // A loop of sends is never followed round
  const loop = [{ ...ret, sends: [{ to: 'ret-2', level: 1 }] }, { ...ret, id: 'ret-2', sends: [{ to: 'ret-1', level: 1 }] }];
  assert.ok(Number.isFinite(chainTail(loop[0], loop, stage, master).seconds));
});

test('never fewer bars than the truth: a note of a track another track\'s Pump ducks to is heard as long as that track rings on (scan r7)', () => {
  const a = base();
  const [src, pad] = a.tracks;
  const plain = {
    ...a,
    bpm: 120,
    tempoPoints: [],
    masterFx: { reverbDecay: 10, delayTime: '4n', delayFeedback: 0.3 },
    tracks: a.tracks.map((t) => ({ ...t, reverbSend: 0, delaySend: 0, distance: 0, automation: [], fx: { ...t.fx, echo: { ...t.fx.echo, on: false }, reverb: { ...t.fx.reverb, on: false }, pump: { ...t.fx.pump, on: false } } })),
  };
  const ducking = (song, trigger) => ({ ...song, tracks: song.tracks.map((t) => (t.id === pad.id ? { ...t, reverbSend: 1, fx: { ...t.fx, pump: { ...t.fx.pump, on: true, trigger, source: src.id } } } : t)) });
  const clip = plain.clips.find((c) => c.trackId === src.id);
  const addNote = (song) => ({ ...song, clips: song.clips.map((c) => (c.id === clip.id ? { ...c, notes: [...c.notes, { id: 'n', note: 'C5', startOffset: 0, duration: '32n', velocity: 1 }] } : c)) });
  const alone = diffSongs(plain, addNote(plain)).regions[0].toBar;
  const s = ducking(plain, 'track');
  const ducked = diffSongs(s, addNote(s)).regions[0].toBar;
  // The pad's ducking rings on in the master reverb (10 s: five bars at 120 BPM)
  assert.ok(ducked >= clip.startBar + 5, `${ducked}`);
  assert.ok(ducked > alone);
});

test('in a song not in 4/4 the words name bars as the ruler numbers them, by measure; the numbers stay the song\'s bars (scan r6)', async () => {
  const { wordMeter, barWords } = await import('../src/agent/songDiff.ts');
  const a = { ...base(), meter: { num: 3, den: 4 }, meterPoints: [] };
  const keys = a.tracks[0];
  const clip = { ...a.clips.find((c) => c.trackId === keys.id), id: 'tag', startBar: 7, lengthBars: 1, notes: [], expression: undefined };
  const d = diffSongs(a, { ...a, clips: [...a.clips, clip] });
  const added = d.changes.find((c) => c.clipId === 'tag');
  // (bar 7 of four quarter notes starts 24 beats in: the ruler's measure 9 of 3/4; one 4/4 bar runs into measure 10)
  assert.match(added.text, /at bars 9-10\.$/, added.text);
  assert.equal(added.fromBar, 7, 'the number is the song\'s bar');
  const meter = wordMeter(a);
  assert.equal(barWords({ fromBar: 7, toBar: 10 }, meter), 'bars 9-12');
  assert.equal(barWords({ fromBar: 1, toBar: 2 }, meter), 'bars 1-2');
  // A marker at a beat inside a measure
  const marked = diffSongs(a, { ...a, markers: [...(a.markers ?? []), { id: 'mk', name: 'Hit', anchor: 'bar', bar: 7.25, seconds: 0 }] });
  assert.match(marked.changes[0].text, /at bar 9 beat 2\.$/, marked.changes[0].text);
  // In 4/4, as before
  assert.equal(wordMeter(base()), null);
  assert.equal(barWords({ fromBar: 7, toBar: 10 }, null), 'bars 7-9');
});

test('in a song not in 4/4 the cautions, the before-and-after limit and the selection under a message name bars by measure too (scan r7)', async () => {
  const { applyOps } = await import('../src/agent/ops.ts');
  const { limitWords, unheardWords } = await import('../src/agent/suggestionsStore.ts');
  const { contextWords } = await import('../src/agent/conversation.ts');
  const { wordMeter } = await import('../src/agent/songDiff.ts');
  const a = { ...base(), meter: { num: 3, den: 4 }, meterPoints: [] };
  const meter = wordMeter(a);
  const out = applyOps(a, { opsVersion: 1, ops: [{ op: 'add_marker', name: 'End', bar: 500 }, { op: 'add_tempo_change', bar: 900, bpm: 90 }] }, { idBase: 'sg1' });
  assert.ok(out.ok);
  // (bar 500 starts 1996 beats in: measure 666 beat 2 of 3/4; bar 401, the end of the timeline, 1600 beats in: measure 534 beat 2)
  assert.ok(out.warnings.includes('Bar 666 beat 2 is past the end of the timeline: put at bar 534 beat 2.'), JSON.stringify(out.warnings));
  assert.ok(out.warnings.every((w) => !/\bbar 401\b|\bbar 500\b/.test(w)), JSON.stringify(out.warnings));
  assert.equal(limitWords('bars', meter), 'a before-and-after plays at most 256 quarter notes');
  assert.match(unheardWords([{ fromBar: 70, toBar: 74 }], 'bars', meter), /^bars 93-98 weren’t heard \(a before-and-after plays at most 256 quarter notes\)\.$/);
  assert.equal(contextWords({ context: { bars: { fromBar: 5, toBar: 9 } } }, meter), 'With your selection: bars 6-11');
  // In 4/4, as before
  const plain = applyOps(base(), { opsVersion: 1, ops: [{ op: 'add_marker', name: 'End', bar: 500 }] }, { idBase: 'sg1' });
  assert.ok(plain.warnings.includes('Bar 500 is past the end of the timeline: put at bar 401.'), JSON.stringify(plain.warnings));
  assert.equal(limitWords('bars'), 'a before-and-after plays at most 64 bars');
  assert.equal(contextWords({ context: { bars: { fromBar: 5, toBar: 9 } } }), 'With your selection: bars 5-8');
});

test('a note running on past its clip\'s end is heard to where it stops, as it plays (scan r8)', async () => {
  const { clipSoundEnd, musicEnd } = await import('../src/audio/auditionMath.ts');
  const a = base();
  const plain = { ...a, bpm: 120, tempoPoints: [], masterFx: { reverbDecay: 1, delayTime: '4n', delayFeedback: 0 }, tracks: a.tracks.map((t) => ({ ...t, reverbSend: 0, delaySend: 0, fx: { ...t.fx, echo: { ...t.fx.echo, on: false }, reverb: { ...t.fx.reverb, on: false } } })) };
  const clip = { id: 'one', trackId: plain.tracks[0].id, name: 'One', startBar: 30, lengthBars: 1, notes: [{ id: 'x', note: 'E4', startOffset: 0, duration: '4n', velocity: 0.8 }] };
  const before = { ...plain, clips: [...plain.clips, clip] };
  const long = { id: 'long', note: 'C4', startOffset: 0.5, duration: '16m', velocity: 0.9 };
  const after = { ...before, clips: before.clips.map((c) => (c.id === 'one' ? { ...c, notes: [...c.notes, long] } : c)) };
  const grown = after.clips.find((c) => c.id === 'one');
  assert.equal(clipSoundEnd(grown), 46.5);
  assert.equal(clipSoundEnd(clip), 31);
  // (a note hidden by a trim doesn't play, so it doesn't count)
  assert.equal(clipSoundEnd({ ...grown, notes: [{ ...long, startOffset: 1 }] }), 31);
  assert.ok(musicEnd(after) >= 46.5);
  const d = diffSongs(before, after);
  assert.ok(d.regions.at(-1).toBar >= 46.5, JSON.stringify(d.regions));
  assert.match(texts(d).join(' '), /adds 1 note in bars 30-46/);
  // Moving or removing the clip: where its note stops too
  const moved = diffSongs(after, { ...after, clips: after.clips.map((c) => (c.id === 'one' ? { ...c, startBar: 33 } : c)) });
  assert.ok(moved.regions.at(-1).toBar >= 49.5, JSON.stringify(moved.regions));
  const removed = diffSongs(after, { ...after, clips: after.clips.filter((c) => c.id !== 'one') });
  assert.ok(removed.regions.at(-1).toBar >= 46.5, JSON.stringify(removed.regions));
});

test('a change to a proxy track is heard wherever the tracks ducking under it dip, and ring on (scan r8)', async () => {
  const { DUCK_LOOKAHEAD } = await import('../src/store/duck.ts');
  const a = base();
  const [voice, pad] = a.tracks;
  const song = {
    ...a,
    bpm: 120,
    tempoPoints: [],
    tracks: a.tracks.map((t) => (t.id === voice.id ? { ...t, duckProxy: { depth: 24 }, reverbSend: 0, delaySend: 0 } : t.id === pad.id ? { ...t, reverbSend: 1 } : t)),
    clips: [...a.clips.filter((c) => c.trackId !== voice.id), { id: 'v', trackId: voice.id, name: 'Voice', startBar: 9, lengthBars: 1, notes: [{ id: 'v1', note: 'E5', startOffset: 0, duration: '2n', velocity: 0.9 }] }],
  };
  const gone = { ...song, clips: song.clips.filter((c) => c.id !== 'v') };
  const d = diffSongs(song, gone);
  const r = d.regions[0];
  // From its look-ahead before the voice (in the bar before) to past the voice's end by the pad's reverb
  assert.ok(r.fromBar <= 9 - (DUCK_LOOKAHEAD * 120) / 240, JSON.stringify(d.regions));
  const alone = diffSongs({ ...song, tracks: song.tracks.map((t) => ({ ...t, duckProxy: undefined })) }, { ...gone, tracks: gone.tracks.map((t) => ({ ...t, duckProxy: undefined })) });
  assert.ok(r.toBar > alone.regions[0].toBar, `${JSON.stringify(d.regions)} vs ${JSON.stringify(alone.regions)}`);
  // A note of it changed, too
  const moved = diffSongs(song, { ...song, clips: song.clips.map((c) => (c.id === 'v' ? { ...c, notes: [{ ...c.notes[0], duration: '1m' }] } : c)) });
  assert.ok(moved.regions[0].fromBar < 9 && moved.regions[0].toBar > 11, JSON.stringify(moved.regions));
});

test('never fewer bars than the truth: a track that plays a note by the notes before it hears a note change to where it stops (scan r9)', async () => {
  const { carriesState, LEGATO_INSTRUMENTS, swingReadsClip } = await import('../src/audio/noteMemory.ts');
  const { INSTRUMENTS } = await import('../src/audio/instrumentCatalog.ts');
  const a = base();
  const id = a.tracks[0].id;
  const quiet = (t) => ({ ...t, reverbSend: 0, delaySend: 0, distance: 0, automation: [], output: undefined, sends: undefined, fx: { ...t.fx, echo: { ...t.fx.echo, on: false }, reverb: { ...t.fx.reverb, on: false }, pump: { ...t.fx.pump, on: false } } });
  const n = (k, at, duration = '4n', extra = {}) => ({ id: `n${k}`, note: 'E3', startOffset: at, duration, velocity: 0.8, ...extra });
  // One track: bars 1-4, 9-12 and 30; nothing else plays
  const song = (instrumentKey, more = {}, lastNotes = [n(9, 0)]) => ({
    ...a,
    bpm: 120,
    tempoPoints: [],
    masterFx: { reverbDecay: 1, delayTime: '4n', delayFeedback: 0 },
    tracks: [quiet({ ...a.tracks[0], instrumentKey, ...more })],
    clips: [
      { id: 'a', trackId: id, name: 'A', startBar: 1, lengthBars: 4, notes: [n(1, 0, '1m'), n(2, 1, '1m'), n(3, 2, '1m'), n(4, 3, '1m')] },
      { id: 'b', trackId: id, name: 'B', startBar: 9, lengthBars: 4, notes: [n(5, 0, '1m')] },
      { id: 'c', trackId: id, name: 'C', startBar: 30, lengthBars: 1, notes: lastNotes },
    ],
  });
  const addNote = (s, clipId = 'a', at = 0.5) => ({ ...s, clips: s.clips.map((c) => (c.id === clipId ? { ...c, notes: [...c.notes, n('x', at, '16n')] } : c)) });
  const reaches = (d, bar) => d.regions.some((r) => r.fromBar <= bar && r.toBar > bar);
  const check = (s, label) => diffSongs(s, addNote(s));

  // Nothing remembered: the note's bars and its tail, nowhere near bar 9
  const plain = check(song('pluck'));
  assert.equal(carriesState({ instrumentKey: 'pluck' }), null);
  assert.ok(plain.regions.at(-1).toBar < 9, JSON.stringify(plain.regions));
  // (a recorded piano can cut a note still ringing: along the notes ringing into each other, still
  // not past the gap, and sure: its release is known)
  assert.deepEqual(carriesState({ instrumentKey: 'realGrandPiano' }), { reach: 'joined', sure: true, kinds: ['cuts'] });
  const piano = check(song('realGrandPiano'));
  assert.ok(reaches(piano, 4.5) && !reaches(piano, 9), JSON.stringify(piano.regions));
  assert.equal(piano.sure, true);

  // Takes played in turn (a recorded bass, a recorded kit): every later clip of the track, sure
  for (const key of ['realElectricBass', 'studioKit']) {
    assert.deepEqual(carriesState({ instrumentKey: key })?.kinds, ['takes', 'cuts'], key);
    const d = check(song(key));
    assert.ok(reaches(d, 9) && reaches(d, 30), `${key} ${JSON.stringify(d.regions)}`);
    // (only where the track sounds: not the empty bars between)
    assert.ok(!reaches(d, 20), `${key} ${JSON.stringify(d.regions)}`);
    assert.equal(d.regions[0].fromBar, 1);
    assert.equal(d.sure, true);
  }
  // Strummed (a guitar with one take: the direction of each strum follows the last)
  assert.deepEqual(carriesState({ instrumentKey: 'realNylonGuitar' })?.kinds, ['strum', 'cuts']);
  assert.ok(reaches(check(song('realNylonGuitar')), 30));
  // A change after the last clip is still only from the change on
  const late = diffSongs(song('realElectricBass'), addNote(song('realElectricBass'), 'b'));
  assert.ok(late.regions[0].fromBar >= 9 && reaches(late, 30), JSON.stringify(late.regions));

  // Passes: a note on some passes only, anywhere on the track, counts its clip's place in the run of copies
  const cond = song('pluck', {}, [n(9, 0, '4n', { cond: { n: 2, of: 2 } })]);
  assert.deepEqual(carriesState(cond.tracks[0], cond.clips)?.kinds, ['passes']);
  const passes = check(cond);
  assert.ok(reaches(passes, 30), JSON.stringify(passes.regions));
  // (removing a copy from the run moves the later ones' passes)
  const run = { ...cond, clips: [...cond.clips, { ...cond.clips[2], id: 'c2', startBar: 31 }] };
  assert.ok(reaches(diffSongs(run, { ...run, clips: run.clips.filter((c) => c.id !== 'c') }), 31));

  // A plugin instrument: its own state isn't known here, so to the end and not sure
  const plugin = check(song('plugin', { plugin: { id: 'i', url: 'x', name: 'Synth' } }));
  assert.ok(reaches(plugin, 30));
  assert.equal(plugin.sure, false);

  // A monophonic synth: along the notes joined to the change (each starting before the one before
  // rang out), not past a gap longer than its notes ring
  assert.deepEqual(carriesState({ instrumentKey: 'bass' }), { reach: 'joined', sure: true, kinds: ['legato'] });
  const mono = check(song('bass'));
  assert.ok(reaches(mono, 4.5), JSON.stringify(mono.regions));
  assert.ok(!reaches(mono, 9), JSON.stringify(mono.regions));
  const joined = song('bass');
  joined.clips = joined.clips.map((c) => (c.id === 'b' ? { ...c, startBar: 5 } : c));
  assert.ok(reaches(check(joined), 6.5), 'B joins straight on');
  // (the Sub enhancer's sine carries on the same way, under any pitched instrument)
  assert.deepEqual(carriesState({ instrumentKey: 'pluck', subLayer: { mode: 'octave', level: 0.5, decay: 0 } })?.kinds, ['legato']);

  // Swing decided over the whole clip: a note changed at its end can move its first notes
  const swung = song('pluck');
  swung.clips = swung.clips.map((c) => (c.id === 'a' ? { ...c, groove: { swing: 0.5, grid: 16 } } : c));
  assert.equal(swingReadsClip(swung.clips[0]), true);
  const sw = diffSongs(swung, addNote(swung, 'a', 3.5));
  assert.equal(sw.regions[0].fromBar, 1, JSON.stringify(sw.regions));
  assert.ok(diffSongs(song('pluck'), addNote(song('pluck'), 'a', 3.5)).regions[0].fromBar >= 4);

  // In step with the instruments: every monophonic one in instruments.ts (built by mono(), or
  // reading the legato glide) is listed, and only those
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/audio/instruments.ts', import.meta.url), 'utf8');
  const build = source.slice(source.indexOf('function buildInstrument'));
  const cases = [...build.matchAll(/((?:\s*case '\w+':)+)\s*(?:\{)?([\s\S]*?)(?=\n\s*case '|\n\s*default:)/g)];
  const mono2 = new Set(cases.filter(([, , body]) => /\bmono\(|glideRef|create808Instrument/.test(body)).flatMap(([, labels]) => [...labels.matchAll(/'(\w+)'/g)].map((m) => m[1])));
  assert.deepEqual([...mono2].sort(), [...LEGATO_INSTRUMENTS].sort());
  // ...and every recorded instrument with a second take at some loudness plays its takes in turn
  for (const [key, def] of Object.entries(INSTRUMENTS)) {
    const takes = Object.keys(def.samples?.samples ?? {}).some((name) => Number(name.split('|')[2] ?? 0) > 0);
    if (takes) assert.ok(carriesState({ instrumentKey: key })?.kinds.includes('takes'), key);
  }
});

test('never fewer bars than the truth: a new note that ends a note held over it hears the change to where the held note stops, and taking it away too (scan r10)', async () => {
  const { carriesState, cutsNotes, VOICE_POOL_INSTRUMENTS } = await import('../src/audio/noteMemory.ts');
  const { defaultSynthPatch } = await import('../src/store/synthPatch.ts');
  const a = base();
  const id = a.tracks[0].id;
  const quiet = (t) => ({ ...t, reverbSend: 0, delaySend: 0, distance: 0, automation: [], output: undefined, sends: undefined, fx: { ...t.fx, echo: { ...t.fx.echo, on: false }, reverb: { ...t.fx.reverb, on: false }, pump: { ...t.fx.pump, on: false } } });
  const n = (k, note, at, duration) => ({ id: `n${k}`, note, startOffset: at, duration, velocity: 0.8 });
  // One track: a C4 held for eight bars from bar 1, nothing else
  const song = (instrumentKey, more = {}) => ({
    ...a,
    bpm: 120,
    tempoPoints: [],
    masterFx: { reverbDecay: 1, delayTime: '4n', delayFeedback: 0 },
    tracks: [quiet({ ...a.tracks[0], instrumentKey, ...more })],
    clips: [{ id: 'c', trackId: id, name: 'Line', startBar: 1, lengthBars: 8, notes: [n('held', 'C4', 0, '8m')] }],
  });
  const add = (s, notes) => ({ ...s, clips: s.clips.map((c) => ({ ...c, notes: [...c.notes, ...notes] })) });
  const reaches = (d, bar) => d.regions.some((r) => r.fromBar <= bar && r.toBar > bar);
  const short = (pitch, k = 'x', at = 0.25) => n(k, pitch, at, '16n');
  const cases = [
    // a bowed string's legato change crossfades the held note out
    ['bowed legato', song('realViolin'), [short('A4')]],
    // the oldest of SAME_PITCH repeats of a pitch fades out
    ['same-pitch repeat', song('realPipeOrgan'), [short('C4', 'x1', 0.25), short('C4', 'x2', 0.3125), short('C4', 'x3', 0.375)]],
    // past MAX_NOTES ringing at once, one fades out (the held note among them)
    ['too many notes', song('realGrandPiano'), Array.from({ length: 64 }, (_, i) => n(`m${i}`, ['C', 'D', 'E', 'F', 'G', 'A', 'B'][i % 7] + (1 + Math.floor(i / 7)), 0.25, '16n'))],
    // the designed synth in mono lets the note before give way
    ['designed synth in mono', song('synthDesigner', { synth: { ...defaultSynthPatch(), mono: true } }), [short('E4')]],
    // a voice pool with every voice busy retriggers one still sounding
    ['voice pool', song('keys'), [short('E4')]],
  ];
  for (const [label, s, notes] of cases) {
    assert.ok(cutsNotes(s.tracks[0]), label);
    assert.ok(carriesState(s.tracks[0])?.kinds.includes('cuts'), label);
    const added = diffSongs(s, add(s, notes));
    // (to the held note's end at bar 9, past its release)
    assert.ok(reaches(added, 1.5) && reaches(added, 8.9), `${label} ${JSON.stringify(added.regions)}`);
    assert.equal(added.regions[0].fromBar, 1, label);
    // (what a recorded instrument cuts is known: sure, so no second press for that alone)
    if (s.tracks[0].instrumentKey.startsWith('real')) assert.equal(added.sure, true, label);
    // Taking the short note away lets the held note ring on again: the same bars
    const removed = diffSongs(add(s, notes), s);
    assert.ok(reaches(removed, 8.9), `${label} removed ${JSON.stringify(removed.regions)}`);
    // (and moving it, or changing it, the same)
    const moved = diffSongs(add(s, notes), add(s, notes.map((x) => ({ ...x, startOffset: x.startOffset + 0.0625 }))));
    assert.ok(reaches(moved, 8.9), `${label} moved ${JSON.stringify(moved.regions)}`);
  }
  // The designed synth's own voices (not in mono), the native synths: a voice each note, no limit
  for (const s of [song('synthDesigner', { synth: defaultSynthPatch() }), song('pluck'), song('supersaw'), song('chipLead')]) {
    assert.equal(cutsNotes(s.tracks[0]), false, s.tracks[0].instrumentKey);
    const d = diffSongs(s, add(s, [short('E4')]));
    assert.ok(!reaches(d, 4), `${s.tracks[0].instrumentKey} ${JSON.stringify(d.regions)}`);
  }
  // In mono in either version: the change of the patch is its own; a note added then reads both
  const mono = song('synthDesigner', { synth: { ...defaultSynthPatch(), mono: true } });
  const poly = song('synthDesigner', { synth: defaultSynthPatch() });
  assert.ok(reaches(diffSongs(poly, { ...add(poly, [short('E4')]), tracks: mono.tracks }), 8.9));

  // In step with the instruments: every synth that plays from a limited pool of voices is listed
  const { readFileSync, readdirSync } = await import('node:fs');
  const presets = new URL('../src/audio/presets/', import.meta.url);
  const pooled = new Set();
  for (const f of readdirSync(presets).filter((x) => x.endsWith('.ts'))) {
    const src = readFileSync(new URL(f, presets), 'utf8');
    for (const m of src.matchAll(/export function (\w+)\([^]*?\n\}/g)) if (/createVoicePool\(/.test(m[0]) && m[1] !== 'createVoicePool') pooled.add(m[1]);
  }
  assert.ok(pooled.size > 0);
  const source = readFileSync(new URL('../src/audio/instruments.ts', import.meta.url), 'utf8');
  const build = source.slice(source.indexOf('function buildInstrument'));
  const cases2 = [...build.matchAll(/((?:\s*case '\w+':)+)\s*(?:\{)?([\s\S]*?)(?=\n\s*case '|\n\s*default:)/g)];
  const listed = new Set(cases2.filter(([, , body]) => [...pooled].some((f) => body.includes(`${f}(`))).flatMap(([, labels]) => [...labels.matchAll(/'(\w+)'/g)].map((m) => m[1])));
  assert.deepEqual([...listed].sort(), [...VOICE_POOL_INSTRUMENTS].sort());
});
