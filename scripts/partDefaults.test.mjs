// What a new part starts with by its kind (src/store/partKind.ts): its sends and echo; the length a
// new note is drawn (penLength.ts); and Duck to kick (duckToKick.ts) pumping the music parts.
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

const K = await import('../src/store/partKind.ts');
const P = await import('../src/store/penLength.ts');
const D = await import('../src/store/duckToKick.ts');
const { defaultTrackFx } = await import('../src/store/timelineTypes.ts');

const track = (id, instrumentKey, extra = {}) => ({ id, name: id, color: '#fff', instrumentKey, isMuted: false, isSoloed: false, isArmed: false, volume: 0, pan: 0, eq: { low: 0, mid: 0, high: 0 }, fx: defaultTrackFx(), reverbSend: 0, delaySend: 0, ...extra });

test('each instrument plays its usual kind of part', () => {
  const kinds = { drums: 'drums', designedKit: 'drums', subBass: 'bass', wobbleBass: 'bass', supersaw: 'pad', wavetable: 'pad', polysynthPad: 'pad', lead: 'lead', pluck: 'lead', sawLead: 'lead', fx: 'fx', piano: 'other' };
  for (const [key, kind] of Object.entries(kinds)) assert.equal(K.partKind(key), kind, key);
});

test('a new pad or lead starts in the room, a lead with a dotted-eighth echo; drums and bass start dry', () => {
  const fx = defaultTrackFx();
  const pad = K.startSends('supersaw', fx);
  assert.ok(pad.reverbSend >= 0.15 && pad.reverbSend <= 0.25);
  assert.equal(pad.fx.echo.on, false);
  const lead = K.startSends('lead', fx);
  assert.ok(lead.reverbSend >= 0.15 && lead.reverbSend <= 0.25);
  assert.equal(lead.fx.echo.on, true);
  assert.equal(lead.fx.echo.time, '1/8d');
  assert.ok(lead.fx.echo.mix <= 0.2, 'the echo stays low in the mix');
  for (const key of ['drums', 'subBass', 'wobbleBass']) {
    const s = K.startSends(key, fx);
    assert.equal(s.reverbSend, 0, key);
    assert.equal(s.fx.echo.on, false, key);
  }
  // Anything else as before
  assert.equal(K.startSends('piano', fx).reverbSend, 0.1);
});

test('a new note is drawn at the length last drawn for that kind of part', () => {
  P.forgetPens();
  assert.equal(P.penBars('piano'), 1 / 8);
  assert.equal(P.penBars('supersaw'), 1 / 4, 'pads and chords start at a quarter');
  assert.equal(P.penBars('drums'), 1 / 16);
  assert.equal(P.penBars('fx'), 1);
  P.rememberPen('piano', 3 / 16);
  assert.equal(P.penBars('piano'), 3 / 16);
  assert.equal(P.penBars('lead'), 3 / 16, 'the same pen for every melodic part');
  assert.equal(P.penBars('supersaw'), 1 / 4, 'pads keep theirs');
  assert.equal(P.penBars('drums'), 1 / 16, 'drums keep theirs');
  P.rememberPen('piano', 0);
  P.rememberPen('piano', NaN);
  assert.equal(P.penBars('piano'), 3 / 16, 'a nonsense length is ignored');
  P.forgetPens();
});

test('Duck to kick: a hole for the drums in the bass, the other music parts pumping on the kick, releases in time', () => {
  const tracks = [track('kit', 'drums'), track('bass', 'subBass'), track('pad', 'supersaw'), track('lead', 'lead'), track('voice', 'audio', { name: 'Vocals' }), track('riser', 'fx')];
  const { tracks: out, changed } = D.duckToKick(tracks, [], 128);
  assert.equal(changed, 3);
  const by = Object.fromEntries(out.map((t) => [t.id, t.fx.pump]));
  assert.deepEqual(by.bass, { ...by.bass, ...D.duckPump('bass', 'bass', 128) });
  assert.equal(by.bass.trigger, 'kickSnare');
  assert.equal(by.bass.shape, 'hole');
  assert.ok(by.bass.depth >= 0.8 && by.bass.depth <= 0.9);
  for (const id of ['pad', 'lead']) {
    assert.equal(by[id].on, true);
    assert.equal(by[id].trigger, 'kick');
    assert.ok(by[id].depth > 0.3 && by[id].depth < 0.6);
  }
  for (const id of ['kit', 'voice', 'riser']) assert.equal(by[id].on, false, id);
  // Half a beat at 128 BPM is 234 ms; faster songs come back sooner, within the Pump's range
  assert.equal(D.releaseMs(0.5, 128), 234);
  assert.ok(D.releaseMs(0.5, 174) < D.releaseMs(0.5, 128));
  assert.equal(D.releaseMs(0.3, 20), 600);
  // Again: nothing more to change; another style changes the depths
  assert.equal(D.duckToKick(out, [], 128).changed, 0);
  const future = D.duckToKick(out, [], 128, 'future');
  assert.equal(future.changed, 3);
  assert.ok(future.tracks.find((t) => t.id === 'pad').fx.pump.depth < by.pad.depth);
  // No kick, nothing changes
  const noKick = D.duckToKick(tracks.slice(1), [], 128);
  assert.equal(noKick.changed, 0);
  assert.equal(D.hasKick(tracks.slice(1), []), false);
});
