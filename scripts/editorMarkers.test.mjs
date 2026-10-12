// Unit tests for marker files for video editors (src/store/editorMarkers.ts). Run with `npm test`.
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

const { editorMarkerFile } = await import('../src/store/editorMarkers.ts');

const markers = [{ name: 'Drop', seconds: 10 }, { name: 'Intro & <start>', seconds: 0 }, { name: 'Hit 1', seconds: 61.5 }];
const o = { title: 'My Song', fps: 30, dropFrame: false, startHour: 0 };

test('Resolve EDL: one marker event per marker, in time order, at the right timecode', () => {
  const edl = editorMarkerFile('resolve', markers, { ...o, startHour: 1 }, 70);
  const lines = edl.split('\r\n');
  assert.equal(lines[0], 'TITLE: My Song');
  assert.equal(lines[1], 'FCM: NON-DROP FRAME');
  assert.match(lines[3], /^001 .* 01:00:00:00 01:00:00:01 01:00:00:00 01:00:00:01/);
  assert.match(lines[4], /\|M:Intro & <start> \|D:1/);
  assert.match(lines[6], / 01:00:10:00 /);
  assert.match(lines[9], / 01:01:01:15 /);
});

test('Premiere XML: markers at frame numbers, names escaped', () => {
  const x = editorMarkerFile('premiere', markers, o, 70);
  assert.match(x, /<xmeml version="4">/);
  assert.match(x, /<name>Intro &amp; &lt;start&gt;<\/name>\s*<in>0<\/in>/);
  assert.match(x, /<name>Drop<\/name>\s*<in>300<\/in>/);
  assert.match(x, /<duration>2100<\/duration>/);
});

test('FCPXML: rational times on the frame grid, drop-frame at 29.97', () => {
  const x = editorMarkerFile('fcpx', markers, { ...o, fps: 29.97, dropFrame: true }, 70);
  assert.match(x, /frameDuration="1001\/30000s"/);
  assert.match(x, /tcFormat="DF"/);
  assert.match(x, /<marker start="299299\/30000s" duration="1001\/30000s" value="Drop"\/>/);
});

test('CSV with quoting', () => {
  const csv = editorMarkerFile('csv', [{ name: 'A, "B"', seconds: 2 }], o, 10);
  assert.equal(csv, 'Name,Timecode,Seconds\r\n"A, ""B""",00:00:02:00,2.000\r\n');
});

test('1 hour start in drop-frame is 107892 frames', () => {
  const x = editorMarkerFile('premiere', [], { ...o, fps: 29.97, dropFrame: true, startHour: 1 }, 5);
  assert.match(x, /<string>01:00:00;00<\/string>\s*<frame>107892<\/frame>/);
});
