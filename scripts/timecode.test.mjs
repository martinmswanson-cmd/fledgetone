// Unit tests for the timecode math (drop-frame especially). Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFrameRulerTime,
  formatFrameTimecode,
  frameSeconds,
  frameToLabelCount,
  framesToSeconds,
  isDropFrame,
  labelCountToFrame,
  parseFrameTimecode,
  secondsToFrames,
} from '../src/audio/timecode.ts';

const TWENTY_MINUTES = 20 * 60 * 30;
const RATES = [
  [23.976, false],
  [24, false],
  [25, false],
  [29.97, false],
  [29.97, true],
  [30, false],
  [60, false],
];

test('29.97 drop-frame labels match known values', () => {
  const df = (frame) => formatFrameTimecode(frame, 29.97, true);
  assert.equal(df(0), '00:00:00;00');
  assert.equal(df(1799), '00:00:59;29');
  assert.equal(df(1800), '00:01:00;02');
  assert.equal(df(3597), '00:01:59;29');
  assert.equal(df(3598), '00:02:00;02');
  assert.equal(df(17981), '00:09:59;29');
  assert.equal(df(17982), '00:10:00;00');
  assert.equal(df(17983), '00:10:00;01');
  assert.equal(df(19782), '00:11:00;02');
  assert.equal(df(107892), '01:00:00;00');
  assert.equal(formatFrameRulerTime(1800, 29.97, true), '1:00;02');
  assert.equal(formatFrameRulerTime(107892, 29.97, true), '60:00;00');
});

test('drop-frame runs within a few milliseconds of the clock', () => {
  // An hour of drop-frame labels is 107892 frames: 3599.9964 s
  assert.ok(Math.abs(framesToSeconds(107892, 29.97) - 3600) < 0.004);
  // Non-drop 29.97 drifts 3.6 s an hour behind its labels
  assert.ok(Math.abs(framesToSeconds(108000, 29.97) - 3603.6) < 1e-9);
  assert.equal(framesToSeconds(24, 23.976), 1.001);
  assert.equal(frameSeconds(29.97), 1001 / 30000);
});

test('only 29.97 can be drop-frame', () => {
  assert.equal(isDropFrame(29.97, true), true);
  assert.equal(isDropFrame(29.97, false), false);
  assert.equal(isDropFrame(30, true), false);
  assert.equal(isDropFrame(23.976, true), false);
  assert.equal(formatFrameTimecode(1800, 30, true), '00:01:00:00');
});

test('drop-frame never shows a skipped label', () => {
  for (let frame = 0; frame < TWENTY_MINUTES; frame++) {
    const label = frameToLabelCount(frame, 29.97, true);
    const minutes = Math.floor(label / 1800);
    const intoMinute = label % 1800;
    if (minutes % 10 !== 0 && intoMinute < 2) assert.fail(`frame ${frame} reads as skipped label ${formatFrameTimecode(frame, 29.97, true)}`);
  }
});

test('skipped drop-frame labels mean the next real frame', () => {
  assert.equal(parseFrameTimecode('00:01:00;00', 29.97, true), 1800);
  assert.equal(parseFrameTimecode('00:01:00;01', 29.97, true), 1800);
  assert.equal(parseFrameTimecode('00:01:00;02', 29.97, true), 1800);
  assert.equal(parseFrameTimecode('00:10:00;00', 29.97, true), 17982);
  assert.equal(parseFrameTimecode('00:10:00;01', 29.97, true), 17983);
  // Overflowing fields are normalized first: 60 seconds is the start of minute 1
  assert.equal(parseFrameTimecode('60;00', 29.97, true), 1800);
  assert.equal(labelCountToFrame(1801, 29.97, true), 1800);
});

test('every frame of the first 20 minutes round-trips at every rate', () => {
  for (const [fps, df] of RATES) {
    let prevLabel = -1;
    for (let frame = 0; frame < TWENTY_MINUTES; frame++) {
      const text = formatFrameTimecode(frame, fps, df);
      const back = parseFrameTimecode(text, fps, df);
      if (back !== frame) assert.fail(`${fps}${df ? ' DF' : ''}: frame ${frame} -> ${text} -> ${back}`);
      const ruler = parseFrameTimecode(formatFrameRulerTime(frame, fps, df), fps, df);
      if (ruler !== frame) assert.fail(`${fps}${df ? ' DF' : ''}: ruler label of frame ${frame} reads back as ${ruler}`);
      const label = frameToLabelCount(frame, fps, df);
      if (label <= prevLabel) assert.fail(`${fps}: labels not increasing at frame ${frame}`);
      prevLabel = label;
      if (secondsToFrames(framesToSeconds(frame, fps), fps) !== frame) assert.fail(`${fps}: seconds round trip at frame ${frame}`);
    }
  }
});

test('typed timecodes', () => {
  assert.equal(parseFrameTimecode('00:00:10:15', 30, false), 315);
  assert.equal(parseFrameTimecode('1500', 29.97, true), 450);
  assert.equal(parseFrameTimecode('12', 24, false), 12);
  assert.equal(parseFrameTimecode('90:00', 25, false), 2250);
  assert.equal(parseFrameTimecode('1 02 03 04', 23.976, false), ((62 * 60 + 3) * 24) + 4);
  assert.equal(parseFrameTimecode('abc', 30, false), null);
  assert.equal(parseFrameTimecode('1:2:3:4:5', 30, false), null);
});
