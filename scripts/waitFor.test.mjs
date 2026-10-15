// Waiting with a limit (src/audio/waitFor.ts): a stuck wait gives up with its message, a stuck download gives up while a slow one doesn't, and neither leaves a timer behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { withTimeout, fetchBytes } = await import('../src/audio/waitFor.ts');

const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

test('a wait gives up after its time with its message, and lets its timer go', async () => {
  const before = timers();
  await assert.rejects(withTimeout(new Promise(() => {}), 30, 'the Piano recordings took too long'), /the Piano recordings took too long/);
  assert.equal(await withTimeout(Promise.resolve(7), 1000, 'never'), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error('failed')), 1000, 'never'), /failed/);
  const stop = new AbortController();
  const waiting = withTimeout(new Promise(() => {}), 10000, 'never', stop.signal);
  stop.abort(new Error('cancelled'));
  await assert.rejects(waiting, /cancelled/);
  assert.equal(timers(), before);
});

test('a download that stops arriving gives up; a slow one that keeps coming does not', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    if (req.url === '/stuck') {
      res.write(Buffer.alloc(100));
      return; // and nothing more
    }
    // Slow: 5 chunks, 40 ms apart
    let n = 0;
    const next = () => {
      res.write(Buffer.alloc(10, n));
      if (++n === 5) res.end();
      else setTimeout(next, 40);
    };
    next();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const started = Date.now();
    await assert.rejects(fetchBytes(`${base}/stuck`, 150), /nothing arrived/);
    assert.ok(Date.now() - started < 2000);
    const bytes = new Uint8Array(await fetchBytes(`${base}/slow`, 150));
    assert.equal(bytes.length, 50);
    assert.equal(bytes[49], 4);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
