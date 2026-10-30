// Previews outside the song stop without a click (src/audio/previewFade.ts): a fade of
// PREVIEW_FADE_SECONDS, then the source stops; the game kit's web player (adaptive-music.js) fades
// its music out when asked; and every preview that another one starting stops (exclusivePreview.ts)
// stops that way. Run with `npm test`.
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
const { PREVIEW_FADE_SECONDS, fadeOut, previewVoice } = await import('../src/audio/previewFade.ts');
const { AdaptiveMusic } = await import('../src/gameKit/adaptive-music.js');

/** A stand-in audio context that writes down what's scheduled on it. */
function fakeContext() {
  const ctx = { currentTime: 10, state: 'running', sampleRate: 8000, log: [] };
  const param = (name) => {
    const p = { value: 1 };
    for (const m of ['setValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'cancelAndHoldAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) p[m] = (...a) => (ctx.log.push([name, m, ...a]), p);
    return p;
  };
  let made = 0;
  const node = () => {
    const id = `n${++made}`;
    const listeners = {};
    return {
      id,
      context: ctx,
      connect: (n) => (ctx.log.push([id, 'connect', n.id]), n),
      disconnect: () => ctx.log.push([id, 'disconnect']),
      gain: param(`${id}.gain`),
      frequency: param(`${id}.frequency`),
      Q: param(`${id}.Q`),
      buffer: null,
      loop: false,
      start: (...a) => ctx.log.push([id, 'start', ...a]),
      stop: (...a) => ctx.log.push([id, 'stop', ...a]),
      addEventListener: (type, fn) => (listeners[type] = fn),
      fire: (type) => listeners[type]?.(),
    };
  };
  Object.assign(ctx, { destination: node(), createGain: node, createBiquadFilter: node, createConvolver: node, createBufferSource: node, createBuffer: (c, n) => ({ duration: n / 8000, getChannelData: () => new Float32Array(n) }) });
  return ctx;
}

test('a preview stops with a short fade, from wherever its level is, then the source stops', () => {
  assert.ok(PREVIEW_FADE_SECONDS >= 0.03 && PREVIEW_FADE_SECONDS <= 0.06);
  const ctx = fakeContext();
  const src = ctx.createBufferSource();
  const out = ctx.createGain();
  const voice = previewVoice(src, out);
  // Through a gain of its own
  assert.deepEqual(ctx.log.filter((e) => e[1] === 'connect'), [[src.id, 'connect', voice.fade.id], [voice.fade.id, 'connect', out.id]]);
  ctx.log.length = 0;
  voice.stop();
  const g = `${voice.fade.id}.gain`;
  assert.deepEqual(ctx.log[0], [g, 'cancelAndHoldAtTime', 10], 'a fade-in under way is held where it is');
  assert.deepEqual(ctx.log[1], [g, 'linearRampToValueAtTime', 0, 10 + PREVIEW_FADE_SECONDS]);
  const stop = ctx.log.find((e) => e[1] === 'stop');
  assert.ok(stop[2] >= 10 + PREVIEW_FADE_SECONDS, 'never cut before the fade has ended');
  // Stopped twice: once
  voice.stop();
  assert.equal(ctx.log.filter((e) => e[1] === 'stop').length, 1);
  // Let go once it has ended
  src.fire('ended');
  assert.ok(ctx.log.some((e) => e[0] === voice.fade.id && e[1] === 'disconnect'));
  // Without cancelAndHoldAtTime (Firefox): from the level it has now
  const g2 = ctx.createGain();
  delete g2.gain.cancelAndHoldAtTime;
  g2.gain.value = 0.6;
  ctx.log.length = 0;
  assert.equal(fadeOut(g2), 10 + PREVIEW_FADE_SECONDS);
  assert.deepEqual(ctx.log.map((e) => e.slice(1)), [['cancelScheduledValues', 10], ['setValueAtTime', 0.6, 10], ['linearRampToValueAtTime', 0, 10 + PREVIEW_FADE_SECONDS]]);
});

test('the game kit player fades its music out when asked (and stops at once by default, as games had it)', () => {
  const state = { name: 'Run', file: 'Run.wav', bars: 4, seconds: 8, bpm: 120, timeSignature: [4, 4], beatsPerBar: 4, beatSeconds: 0.5, stems: [] };
  const manifest = { bpm: 120, beatsPerBar: 4, beatSeconds: 0.5, states: [state], stingers: [], transitions: [], intensity: { default: 1, groups: [] } };
  for (const fade of [undefined, 0.04]) {
    const ctx = fakeContext();
    ctx.currentTime = 0;
    const music = new AdaptiveMusic(ctx);
    music.loadFrom(manifest, new Map([['Run.wav', ctx.createBuffer(2, 8 * 8000)]]));
    music.play('Run');
    ctx.currentTime = 3;
    ctx.log.length = 0;
    if (fade === undefined) music.stop();
    else music.stop(fade);
    const stops = ctx.log.filter((e) => e[1] === 'stop');
    assert.ok(stops.length > 0);
    for (const s of stops) assert.ok(Math.abs(s[2] - (3 + (fade ?? 0))) < 1e-9, `stopped at ${s[2]}`);
    const ramp = ctx.log.find((e) => e[1] === 'linearRampToValueAtTime' && e[2] === 0);
    if (fade) assert.ok(Math.abs(ramp[3] - 3.04) < 1e-9, 'faded to silence by then');
    else assert.equal(ramp, undefined);
  }
});

test('each preview another one starting stops fades out (no cut mid-waveform)', () => {
  const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
  for (const p of ['components/sfx/SfxMakerPanel.tsx', 'components/timeline/TuneDialog.tsx', 'components/timeline/VariationsDialog.tsx', 'components/game/rhythmGame.ts']) {
    const src = read(p);
    assert.match(src, /previewVoice\(/, p);
    assert.doesNotMatch(src, /\.connect\(afterMaster\(\)\)/, `${p}: a source straight into the output can't fade`);
  }
  assert.match(read('audio/auditionPart.ts'), /fadeOut\(amp\)/);
  assert.match(read('components/timeline/GameMatrix.tsx'), /useExclusivePreview\('game-audition-pads', \(\) => \{\n\s+player\.current\?\.stop\(PREVIEW_FADE_SECONDS\)/);
  assert.match(read('components/game/GameTryOut.tsx'), /useExclusivePreview\('game-try-out', \(\) => music\.current\?\.stop\(PREVIEW_FADE_SECONDS\)\)/);
});
