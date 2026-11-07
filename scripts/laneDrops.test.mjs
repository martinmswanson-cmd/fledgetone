// What a track's lane takes when something is dropped on it: sound files from the desktop (Audio
// tracks) and clips dragged within the timeline, nothing else. The retired sound deck's drag data
// (application/x-bos-beat-box-<instrument>) is no longer read, so a drag from another page or
// program carrying it adds nothing. Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
});
const src = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('nothing in the app reads or sets the retired deck drag type', () => {
  const hits = files(root).filter((path) => readFileSync(path, 'utf8').includes('x-bos-beat-box-'));
  assert.deepEqual(hits, []);
});

test('the store has no deck drop', () => {
  const store = src('store/timelineStore.ts');
  assert.ok(!/\bdropOnTrack\b/.test(store));
  assert.ok(!/\bdraggingInstrument\b/.test(store));
});

test('a lane only takes a drop of sound files, on an Audio track', () => {
  const lane = src('components/timeline/TrackLane.tsx');
  const handler = (name) => {
    const start = lane.indexOf(`${name}={(e) => {`);
    assert.ok(start >= 0, `${name} handler`);
    return lane.slice(start, lane.indexOf('\n      }}', start));
  };
  for (const name of ['onDragOver', 'onDrop']) {
    const body = handler(name);
    assert.match(body, /if \(isAudio && hasFiles\(e\)\)/);
    // preventDefault (which is what accepts a drop) only inside that check
    const guarded = body.slice(body.indexOf('if (isAudio && hasFiles(e))'));
    assert.equal(body.split('preventDefault').length, guarded.split('preventDefault').length);
  }
});
