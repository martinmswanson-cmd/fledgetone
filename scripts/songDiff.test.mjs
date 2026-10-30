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
