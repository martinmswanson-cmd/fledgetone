// The line shown once a game kit has downloaded (src/audio/gameKitSummary.ts): what's inside, counted from its manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { kitParts, kitSummary } = await import('../src/audio/gameKitSummary.ts');

const state = (stems, costumes) => ({ stems: Array.from({ length: stems }, (_, i) => ({ group: `g${i}`, file: `s${i}.wav`, tracks: [] })), ...(costumes ? { costumes: Array.from({ length: costumes }, () => ({})) } : {}) });

test('only what the kit holds is named, each counted in the singular or plural', () => {
  assert.deepEqual(kitParts({ states: [state(0)], transitions: [], stingers: [] }), ['1 seamless loop']);
  assert.deepEqual(
    kitParts({ states: [state(3, 1), state(3)], transitions: [{ file: 'fill.wav' }, { file: 'fill.wav' }, {}], stingers: [{}], sfx: [{}, {}] }),
    ['2 seamless loops', '6 stems', '1 costume version', '1 transition sound', '1 stinger', '2 sound effects'],
  );
});

test('the sentence names the file, the format and what comes with the sound for that engine', () => {
  const m = { states: [state(2)], transitions: [], stingers: [] };
  assert.equal(kitSummary('Song game kit.zip', m, 'any'), 'Saved "Song game kit.zip" to your downloads. Inside, as WAV files: 1 seamless loop, 2 stems; with audio_manifest.json, players for the web, Godot and Unity, and a README.');
  assert.match(kitSummary('x.zip', m, 'godot'), /the Godot player, an example scene/);
  assert.match(kitSummary('x.zip', m, 'unity'), /the Unity player, an example component/);
});
