// Unit tests for the rap vocal chain presets (src/store/vocalChains.ts). Run with `npm test`.
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
const { VOCAL_CHAINS, VOCAL_CHAIN_IDS, vocalChainFx, withVocalChain, matchingVocalChain } = await import('../src/store/vocalChains.ts');
const { defaultTrackFx, normalizeTrackFx } = await import('../src/store/timelineTypes.ts');

const track = () => ({
  id: 't1',
  name: 'Lead vocal',
  color: '#22d3ee',
  instrumentKey: 'audio',
  isMuted: false,
  isSoloed: false,
  isArmed: false,
  volume: -3,
  pan: -0.2,
  eq: { low: 2, mid: 0, high: -1 },
  fx: { ...defaultTrackFx(), pump: { on: true, depth: 0.5, release: 200, trigger: 'kick' }, bassDrive: { on: true, crossover: 100, drive: 0.8, character: 'hard', mix: 1, tone: 5000 } },
  reverbSend: 0.3,
  delaySend: 0.1,
  pluginFx: [{ id: 'p1', url: 'x', name: 'Plug' }],
});

test('every chain has a name, a description and a compressor, and survives a save and reopen unchanged', () => {
  assert.deepEqual(VOCAL_CHAINS.map((c) => c.id), [...VOCAL_CHAIN_IDS]);
  for (const chain of VOCAL_CHAINS) {
    assert.ok(chain.name.length > 2 && chain.description.length > 20, chain.id);
    const fx = vocalChainFx(chain.id);
    assert.equal(fx.compressor.on, true, `${chain.id}: compressor`);
    // Normalizing (as a project file is read) changes nothing: every value is in range
    assert.deepEqual(normalizeTrackFx(JSON.parse(JSON.stringify(fx))), fx, chain.id);
    // A vocal chain never pumps, gates or humanises
    assert.equal(fx.pump.on || fx.gate.on || fx.human.on, false, chain.id);
  }
});

test('the chains sound like their names', () => {
  const fx = Object.fromEntries(VOCAL_CHAIN_IDS.map((id) => [id, vocalChainFx(id)]));
  const lowCut = (f) => f.peq.bands.find((b) => b.type === 'lowcut' && b.on)?.freq ?? 0;
  // Aggressive: the hardest compression of the leads, and saturation
  assert.ok(fx.aggressive.compressor.ratio > fx.clean.compressor.ratio && fx.aggressive.compressor.threshold < fx.clean.compressor.threshold);
  assert.ok(fx.aggressive.bassDrive?.on || fx.aggressive.distortion.on);
  // Ad-lib: thinner (a higher low cut) and more delay than the lead
  assert.ok(lowCut(fx.adlib) > lowCut(fx.clean));
  assert.ok(fx.adlib.echo.on && fx.adlib.echo.mix > fx.clean.echo.mix && fx.adlib.echo.pingPong);
  // Phone: the band squeezed between a low cut and a high cut
  const phoneCut = fx.phone.peq.bands.find((b) => b.type === 'highcut');
  assert.ok(lowCut(fx.phone) >= 400 && phoneCut && phoneCut.freq <= 4000);
  // Dark and wide: the top turned down, chorus and a long room
  assert.ok(fx.darkWide.peq.bands.some((b) => b.type === 'highshelf' && b.gain < 0));
  assert.ok(fx.darkWide.chorus.on && fx.darkWide.reverb.decay > fx.clean.reverb.decay);
  // The leads and the stack tame their S's with the multiband's top band only
  for (const id of ['clean', 'aggressive', 'adlib', 'stack']) {
    const m = fx[id].mbc;
    assert.ok(m.on && m.highFreq >= 5000 && m.bands[0].bypass && m.bands[1].bypass && m.bands[2].ratio > 1, id);
  }
});

test('applying a chain replaces only the inserts (and the Ad-lib pan)', () => {
  const t = track();
  const clean = withVocalChain(t, 'clean');
  assert.deepEqual(clean.fx, vocalChainFx('clean'));
  // The old Bass Drive and Pump are gone, the 3-band EQ is flat
  assert.equal(clean.fx.bassDrive, undefined);
  assert.equal(clean.fx.pump.on, false);
  assert.deepEqual(clean.eq, { low: 0, mid: 0, high: 0 });
  // Everything else as it was
  for (const key of ['id', 'name', 'volume', 'pan', 'reverbSend', 'delaySend', 'pluginFx', 'instrumentKey']) assert.deepEqual(clean[key], t[key], key);
  assert.equal(withVocalChain(t, 'adlib').pan, 0.4);
  // The original track object is untouched
  assert.equal(t.fx.pump.on, true);
  // Applying twice is the same as once
  assert.deepEqual(withVocalChain(clean, 'clean'), clean);
});

test('a track shows which chain it has on until its inserts are changed', () => {
  const t = track();
  assert.equal(matchingVocalChain(t), null);
  for (const id of VOCAL_CHAIN_IDS) assert.equal(matchingVocalChain(withVocalChain(t, id)), id);
  const edited = withVocalChain(t, 'stack');
  edited.fx = { ...edited.fx, compressor: { ...edited.fx.compressor, ratio: 2 } };
  assert.equal(matchingVocalChain(edited), null);
});
