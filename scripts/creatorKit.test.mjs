// Versions of a song (src/store/songVersions.ts) and the channel kit's plan (src/store/channelKit.ts).
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

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

const { versionLeavesOut, versionTracks } = await import('../src/store/songVersions.ts');
const { planChannelKit, MAX_LOOP_BARS } = await import('../src/store/channelKit.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

const track = (id, instrumentKey, extra = {}) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, ...extra });
const melody = (notes) => notes.map((n, i) => ({ id: `n${i}`, note: n, startOffset: i / 8, duration: '8n', velocity: 0.8 }));
const clip = (id, trackId, notes) => ({ id, trackId, name: id, startBar: 1, lengthBars: 2, notes, isSelected: false });

test('the underscore leaves out the lead, the no-drums version the drums; muted tracks stay muted', () => {
  const tracks = [track('Lead', 'piano'), track('Chords', 'piano'), track('Kit', 'drums'), track('Off', 'piano', { isMuted: true })];
  const line = melody(['C5', 'D5', 'E5', 'G5', 'A5', 'G5', 'E5', 'D5']);
  const chord = ['C4', 'E4', 'G4'].map((n, i) => ({ id: `c${i}`, note: n, startOffset: 0, duration: '1n', velocity: 0.7 }));
  const clips = [clip('a', 'Lead', line), clip('b', 'Chords', [...chord, ...chord.map((c) => ({ ...c, id: `${c.id}b`, startOffset: 1 }))]), clip('c', 'Kit', melody(['C2', 'D2', 'C2', 'D2'])), clip('d', 'Off', line)];
  const out = versionLeavesOut(tracks, clips);
  assert.deepEqual(out.underscore.map((t) => t.id), ['Lead']);
  assert.deepEqual(out.noDrums.map((t) => t.id), ['Kit']);
  const under = versionTracks(tracks, clips, 'underscore');
  assert.deepEqual(under.filter((t) => t.isMuted).map((t) => t.id), ['Lead', 'Off']);
  assert.equal(versionTracks(tracks, clips, 'full'), tracks);
  // Nothing to leave out: no version
  assert.equal(versionTracks([tracks[1]], [clips[1]], 'noDrums'), null);
});

test('the channel kit loops the main section, finds a calmer one, and times the intro and outro', () => {
  // 120 BPM: a bar is 2 seconds
  const toSeconds = (bar) => (bar - 1) * 2;
  const sections = [
    { name: 'Intro', from: 1, to: 5, weight: 0.3 },
    { name: 'Main', from: 5, to: 45, weight: 1 },
    { name: 'Outro', from: 45, to: 49, weight: 0.5 },
  ];
  const plan = planChannelKit(sections, 49, toSeconds);
  assert.equal(plan.main.name, 'Main');
  assert.deepEqual(plan.loop, { from: 5, to: 5 + MAX_LOOP_BARS });
  assert.deepEqual(plan.calm, { from: 1, to: 5 });
  // About 6 seconds: 3 bars; the outro from the last phrase line at least 8 seconds from the end
  assert.deepEqual(plan.intro, { from: 5, to: 8 });
  assert.deepEqual(plan.outro, { from: 45, to: 49 });
  // One section: no calmer one; an empty song: no plan
  assert.equal(planChannelKit([{ name: 'All', from: 1, to: 9, weight: 1 }], 9, toSeconds).calm, null);
  assert.equal(planChannelKit([], 1, toSeconds), null);
});
